/**
 * dsh-happier-workspace-bridge
 *
 * DSH's ACP profile (`dsh --profile acp`) is automation-only: it persists
 * sessions but does not mount the desktop workspace registry. The desktop
 * sidebar lists sessions by explicit `workspace.sessionIds`, so ACP-created
 * sessions never appear under a project even though their logs exist.
 *
 * This plugin runs inside the desktop process (where `ctx.workspaceRegistry`
 * is the canonical owner) and attaches root ACP sessions to the workspace for
 * their recorded cwd. Desktop-created sessions already carry `agentPreset`;
 * they are left untouched.
 */

import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'happier-workspace-bridge';

export const inject = ['workspaceRegistry', 'sessions', 'sessionPersistence'];

const logFile = join(
  process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'),
  'happier-workspace-bridge.log',
);

function log(message) {
  try {
    appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // diagnostics must never break the host
  }
}

export function apply(ctx) {
  const logger = ctx.logger ?? console;
  const inFlight = new Set();
  const settled = new Set();

  log('plugin loaded');

  const ensure = async (sessionId, header) => {
    if (!sessionId || !header || typeof header !== 'object') return;
    if (header.agentPreset !== undefined) return; // desktop-created, already accounted
    if (Number(header.delegationDepth ?? 0) > 0) return; // subagent transcript
    const cwd = typeof header.cwd === 'string' ? header.cwd : '';
    if (!cwd) return;
    if (settled.has(sessionId) || inFlight.has(sessionId)) return;

    inFlight.add(sessionId);
    try {
      const workspace = await ctx.workspaceRegistry.create(cwd);
      if (!workspace) return;
      if (!workspace.sessionIds.includes(sessionId)) {
        await workspace.attachSession(sessionId);
        log(`attached ${sessionId} -> ${workspace.path}`);
        logger.info?.(`[happier-workspace-bridge] attached ${sessionId} -> ${workspace.path}`);
      }
      settled.add(sessionId);
    } catch (error) {
      log(`skipped ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      logger.debug?.(
        `[happier-workspace-bridge] skipped ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      inFlight.delete(sessionId);
    }
  };

  const reconcile = async () => {
    let live = 0;
    for (const session of ctx.sessions?.list?.() ?? []) {
      live += 1;
      await ensure(session?.id ?? session?.header?.id, session?.header);
    }

    let persisted = 0;
    if (typeof ctx.sessionPersistence?.list === 'function') {
      for (const snapshot of await ctx.sessionPersistence.list()) {
        persisted += 1;
        const header = snapshot?.header ?? snapshot;
        await ensure(header?.id ?? snapshot?.id, header);
      }
    }
    log(`reconcile done live=${live} persisted=${persisted}`);
  };

  void reconcile().catch((error) => {
    log(`reconcile failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    logger.warn?.('[happier-workspace-bridge] reconcile failed', error);
  });

  ctx.on('session/event', (session, event) => {
    if (!session) return;
    if (event?.type !== 'session' && event?.type !== 'user/message') return;
    void ensure(session.id ?? session.header?.id, session.header);
  });
}

export default { name, inject, apply };
