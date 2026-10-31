import fs from 'node:fs';
import path from 'node:path';
import { decompress } from 'fzstd';

import { dshHome } from './dsh.js';
import type { JsonRpcNotification } from './protocol.js';

export interface SessionEvent {
  type: string;
  seq?: number;
  time?: number;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  arguments?: string;
  [key: string]: unknown;
}

const MAX_HISTORY_BYTES = 32 * 1024 * 1024;

/**
 * Find the durable log for a DSH session. DSH stores sessions under
 * `$DSH_HOME/sessions/<workspace-hash>/session-<uuid>/session.v4.jsonl.zstd`;
 * the workspace hash is not derivable from a session id, so scan the two levels.
 */
export function findSessionLog(sessionId: string, home: string = dshHome()): string | null {
  const safeId = sessionId.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(safeId)) return null;
  const dirName = safeId.startsWith('session-') ? safeId : `session-${safeId}`;
  const root = path.join(home, 'sessions');
  if (!fs.existsSync(root)) return null;

  for (const workspace of fs.readdirSync(root, { withFileTypes: true })) {
    if (!workspace.isDirectory()) continue;
    const candidate = path.join(root, workspace.name, dirName, 'session.v4.jsonl.zstd');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function readSessionEvents(file: string, maxBytes = MAX_HISTORY_BYTES): SessionEvent[] {
  const stat = fs.statSync(file);
  if (stat.size > maxBytes) return [];

  const compressed = fs.readFileSync(file);
  const raw = decompress(new Uint8Array(compressed));
  const text = Buffer.from(raw).toString('utf8');

  const events: SessionEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as SessionEvent;
      if (parsed && typeof parsed.type === 'string') events.push(parsed);
    } catch {
      // A torn final frame is expected while a session is being written.
    }
  }
  return events;
}

/**
 * Convert DSH durable events into ACP `session/update` notifications.
 *
 * Only root sessions are replayed; subagent transcripts are intentionally out
 * of scope (the product goal is the root session's status and result).
 */
export function eventsToAcpUpdates(
  sessionId: string,
  events: SessionEvent[],
  maxEvents = readMaxEvents(),
): JsonRpcNotification[] {
  const sessionEvent = events.find((event) => event.type === 'session');
  const delegationDepth = Number(sessionEvent?.delegationDepth ?? 0);
  if (delegationDepth > 0) return [];

  const selected = events.length > maxEvents ? events.slice(-maxEvents) : events;
  const updates: JsonRpcNotification[] = [];

  const push = (update: Record<string, unknown>): void => {
    updates.push({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId, update },
    });
  };

  for (const event of selected) {
    switch (event.type) {
      case 'user/message': {
        for (const block of contentOf(event)) {
          if (block.type === 'text' && block.text) {
            push({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: block.text } });
          }
        }
        break;
      }

      case 'assistant/message': {
        const message = (event.data?.message ?? {}) as { content?: ContentBlock[] };
        for (const block of Array.isArray(message.content) ? message.content : []) {
          if (block.type === 'reasoning' && block.text) {
            push({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: block.text } });
          } else if (block.type === 'text' && block.text) {
            push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: block.text } });
          } else if (block.type === 'tool-call' && block.id) {
            push({
              sessionUpdate: 'tool_call',
              toolCallId: block.id,
              title: block.name ?? 'tool',
              status: 'pending',
              ...(block.arguments ? { rawInput: parseMaybeJson(block.arguments) } : {}),
            });
          }
        }
        break;
      }

      case 'tool/result': {
        const message = (event.data?.message ?? {}) as {
          toolCallId?: string;
          isError?: boolean;
          content?: ContentBlock[];
        };
        if (!message.toolCallId) break;
        const text = (message.content ?? [])
          .filter((block) => block.type === 'text' && block.text)
          .map((block) => block.text)
          .join('');
        push({
          sessionUpdate: 'tool_call_update',
          toolCallId: message.toolCallId,
          status: message.isError || event.data?.error ? 'failed' : 'completed',
          ...(text ? { content: [{ type: 'text', text }] } : {}),
        });
        break;
      }

      default:
        break;
    }
  }

  return updates;
}

function contentOf(event: SessionEvent): ContentBlock[] {
  const data = event.data as { content?: ContentBlock[] } | undefined;
  return Array.isArray(data?.content) ? data.content : [];
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readMaxEvents(): number {
  const parsed = Number.parseInt(process.env.HARNESSLINK_MAX_EVENTS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2000;
}
