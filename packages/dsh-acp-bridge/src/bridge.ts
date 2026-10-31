import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

import { dshHome, resolveDshLaunch } from './dsh.js';
import { eventsToAcpUpdates, findSessionLog, readSessionEvents } from './history.js';
import { debug, log } from './log.js';
import {
  isRequest,
  isResponse,
  parseJsonRpcLine,
  serializeJsonRpc,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest,
} from './protocol.js';

interface LoadRequest {
  sessionId: string;
  originalId: JsonRpcId;
}

class Bridge {
  private readonly initializeIds = new Set<JsonRpcId>();
  private readonly loadRequests = new Map<JsonRpcId, LoadRequest>();
  private clientQueue: Promise<void> = Promise.resolve();
  private upstreamQueue: Promise<void> = Promise.resolve();
  private closing = false;

  constructor(private readonly upstream: ChildProcessWithoutNullStreams) {}

  start(): void {
    const clientLines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    clientLines.on('line', (line) => {
      this.clientQueue = this.clientQueue
        .then(() => this.handleClientLine(line))
        .catch((error) => log('client line failed:', errorMessage(error)));
    });
    clientLines.on('close', () => this.closeUpstream());

    const upstreamLines = readline.createInterface({ input: this.upstream.stdout, crlfDelay: Infinity });
    upstreamLines.on('line', (line) => {
      this.upstreamQueue = this.upstreamQueue
        .then(() => this.handleUpstreamLine(line))
        .catch((error) => log('upstream line failed:', errorMessage(error)));
    });

    this.upstream.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim()) log('dsh:', line.trim());
      }
    });

    this.upstream.on('error', (error) => {
      log('failed to start DSH:', error.message);
      process.exit(1);
    });

    this.upstream.on('exit', (code, signal) => {
      log(`DSH exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
      process.exit(code ?? 1);
    });

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        log(`received ${signal}, shutting down`);
        this.closeUpstream();
        setTimeout(() => process.exit(0), 250).unref();
      });
    }
  }

  private handleClientLine(line: string): void {
    const message = parseJsonRpcLine(line);
    if (!message) {
      log('dropping non-JSON line from Happier');
      return;
    }

    if (isRequest(message) && message.id !== null) {
      if (message.method === 'initialize') {
        this.initializeIds.add(message.id);
      }
      if (message.method === 'session/load') {
        this.translateLoad(message);
        return;
      }
    }

    this.writeUpstream(message);
  }

  /**
   * DSH implements `session/resume` but not `session/load`. Happier only knows
   * how to ask for `session/load`, so rewrite the method and remember the
   * original request id to answer with later.
   */
  private translateLoad(request: JsonRpcRequest): void {
    const params = (request.params ?? {}) as { sessionId?: unknown };
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
    if (!sessionId) {
      this.writeClient({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32602, message: 'session/load requires a sessionId' },
      });
      return;
    }

    this.loadRequests.set(request.id, { sessionId, originalId: request.id });
    debug(`translating session/load -> session/resume for ${sessionId}`);
    this.writeUpstream({ ...request, method: 'session/resume' });
  }

  private handleUpstreamLine(line: string): void {
    const message = parseJsonRpcLine(line);
    if (!message) {
      // DSH plugins occasionally log to stdout; never let that reach Happier.
      log('dropping non-protocol stdout from DSH');
      return;
    }

    if (isResponse(message)) {
      if (this.initializeIds.delete(message.id)) {
        this.advertiseLoadSupport(message);
        this.writeClient(message);
        return;
      }

      const load = this.loadRequests.get(message.id);
      if (load) {
        this.loadRequests.delete(message.id);
        if (message.error) {
          this.writeClient({ ...message, id: load.originalId });
          return;
        }
        this.replayHistory(load.sessionId);
        this.writeClient({ ...message, id: load.originalId });
        return;
      }
    }

    this.writeClient(message);
  }

  /**
   * Happier negotiates `loadSession` from the initialize response. DSH does not
   * advertise it, but the bridge implements it on top of `session/resume`, so
   * the bridge must advertise it on DSH's behalf.
   */
  private advertiseLoadSupport(response: JsonRpcMessage): void {
    if (!('result' in response) || !response.result || typeof response.result !== 'object') return;
    const result = response.result as Record<string, unknown>;
    const capabilities =
      result.agentCapabilities && typeof result.agentCapabilities === 'object'
        ? (result.agentCapabilities as Record<string, unknown>)
        : (result.agentCapabilities = {});
    capabilities.loadSession = true;
  }

  private replayHistory(sessionId: string): void {
    if (process.env.HARNESSLINK_HISTORY === '0') return;

    try {
      const file = findSessionLog(sessionId, dshHome());
      if (!file) {
        debug(`no durable log found for ${sessionId}`);
        return;
      }
      const events = readSessionEvents(file);
      const updates = eventsToAcpUpdates(sessionId, events);
      debug(`replaying ${updates.length} update(s) from ${file}`);
      for (const update of updates) this.writeClient(update);
    } catch (error) {
      log('history replay failed:', errorMessage(error));
    }
  }

  private writeClient(message: JsonRpcMessage): void {
    if (!process.stdout.writable) return;
    process.stdout.write(serializeJsonRpc(message));
  }

  private writeUpstream(message: JsonRpcMessage): void {
    if (!this.upstream.stdin.writable) return;
    this.upstream.stdin.write(serializeJsonRpc(message));
  }

  private closeUpstream(): void {
    if (this.closing) return;
    this.closing = true;
    try {
      this.upstream.stdin.end();
    } catch {
      // already closed
    }
    setTimeout(() => {
      try {
        this.upstream.kill();
      } catch {
        // already gone
      }
    }, 1500).unref();
  }
}

export function runBridge(): void {
  const launch = resolveDshLaunch();
  log(`starting DSH profile (${launch.command} ${launch.args.join(' ')})`);

  const upstream = spawn(launch.command, launch.args, {
    env: launch.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;

  new Bridge(upstream).start();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
