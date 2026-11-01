# dsh-happier-workspace-bridge

A small DeepSeek Harness desktop plugin that makes **ACP-created sessions** (for
example, sessions started from Happier through `dsh --profile acp`) appear in
the DSH desktop sidebar.

## Why

DSH's desktop sidebar groups sessions by an explicit workspace record
(`workspace.sessionIds`). The ACP profile writes session logs but never mounts
the workspace registry, so ACP sessions are persisted yet ungrouped.

This plugin runs inside the desktop process, scans root ACP sessions, creates
the workspace for their `cwd` when missing, and calls the canonical
`workspace.attachSession()` API. Desktop-created sessions (those with an
`agentPreset` header) are left untouched.

## Install

```powershell
dsh plugin --profile desktop add "file:C:\path\to\packages\dsh-workspace-bridge"
```

Then add to `~/.dsh/profiles/desktop/cordis.patch.yml`:

```yaml
- id: happier-workspace-bridge
  name: "dsh-happier-workspace-bridge"
```

Restart the DeepSeek Harness desktop app.

## Scope

- Root sessions only (`delegationDepth === 0`).
- ACP sessions only (no `agentPreset`); desktop sessions are already grouped.
- Missing directories are skipped and logged at debug level.
- Idempotent: already-attached sessions are not written again.
