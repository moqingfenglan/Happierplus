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

export const name = 'happier-workspace-bridge';

export const inject = ['workspaceRegistry', 'sessions', 'sessionPersistence'];

export function apply(ctx) {
  const logger = ctx.logger ?? console;
  const inFlight = new Set();
  const settled = new Set();

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
        logger.info?.(`[happier-workspace-bridge] attached ${sessionId} -> ${workspace.path}`);
      }
      settled.add(sessionId);
    } catch (error) {
      // Missing/unreadable directories are expected: leave the session ungrouped.
      logger.debug?.(
        `[happier-workspace-bridge] skipped ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      inFlight.delete(sessionId);
    }
  };

  const reconcile = async () => {
    for (const session of ctx.sessions?.list?.() ?? []) {
      await ensure(session?.id ?? session?.header?.id, session?.header);
    }

    if (typeof ctx.sessionPersistence?.list !== 'function') return;
    for (const snapshot of await ctx.sessionPersistence.list()) {
      const header = snapshot?.header ?? snapshot;
      await ensure(header?.id ?? snapshot?.id, header);
    }
  };

  void reconcile().catch((error) => {
    logger.warn?.('[happier-workspace-bridge] reconcile failed', error);
  });

  ctx.on('session/event', (session, event) => {
    if (!session) return;
    if (event?.type !== 'session' && event?.type !== 'user/message') return;
    void ensure(session.id ?? session.header?.id, session.header);
  });
}
