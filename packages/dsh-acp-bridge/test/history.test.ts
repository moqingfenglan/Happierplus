import { describe, expect, it } from 'vitest';

import { eventsToAcpUpdates, type SessionEvent } from '../src/history.js';

function updatesOf(events: SessionEvent[]) {
  return eventsToAcpUpdates('session-test', events);
}

describe('eventsToAcpUpdates', () => {
  it('maps a root session transcript into ACP updates', () => {
    const updates = updatesOf([
      { type: 'session', delegationDepth: 0 },
      {
        type: 'user/message',
        data: { content: [{ type: 'text', text: 'hi' }] },
      },
      {
        type: 'assistant/message',
        data: {
          message: {
            content: [
              { type: 'reasoning', text: 'thinking' },
              { type: 'text', text: 'hello' },
              { type: 'tool-call', id: 'call-1', name: 'write', arguments: '{"path":"a.txt"}' },
            ],
          },
        },
      },
      {
        type: 'tool/result',
        data: {
          message: {
            toolCallId: 'call-1',
            content: [{ type: 'text', text: 'ok' }],
          },
        },
      },
    ]);

    expect(updates.map((update) => (update.params as { update: { sessionUpdate: string } }).update.sessionUpdate)).toEqual([
      'user_message_chunk',
      'agent_thought_chunk',
      'agent_message_chunk',
      'tool_call',
      'tool_call_update',
    ]);

    const toolCall = (updates[3]?.params as { update: Record<string, unknown> }).update;
    expect(toolCall).toMatchObject({
      toolCallId: 'call-1',
      title: 'write',
      status: 'pending',
      rawInput: { path: 'a.txt' },
    });

    const toolResult = (updates[4]?.params as { update: Record<string, unknown> }).update;
    expect(toolResult).toMatchObject({ toolCallId: 'call-1', status: 'completed' });
  });

  it('does not replay subagent sessions', () => {
    const updates = updatesOf([
      { type: 'session', delegationDepth: 1 },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'child' }] } } },
    ]);
    expect(updates).toEqual([]);
  });

  it('marks failed tool results', () => {
    const updates = updatesOf([
      { type: 'session', delegationDepth: 0 },
      {
        type: 'tool/result',
        data: { message: { toolCallId: 'call-2', isError: true, content: [{ type: 'text', text: 'boom' }] } },
      },
    ]);
    expect((updates[0]?.params as { update: Record<string, unknown> }).update.status).toBe('failed');
  });
});
