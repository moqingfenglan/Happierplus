# dsh-acp-bridge

A stdio ACP proxy that makes **DeepSeek Harness** work as a first-class backend in **Happier**.

```
Happier daemon ──ACP──> dsh-acp-bridge ──ACP──> dsh --profile acp
```

## What it fixes

| Problem | Fix |
|---|---|
| Happier calls `session/load`; DSH only implements `session/resume` | rewrites `session/load` to `session/resume` |
| DSH does not replay history when resuming | replays root-session events from `session.v4.jsonl.zstd` |
| DSH may print non-JSON lines to stdout | drops them and logs to stderr |
| DSH's default model route may be unavailable | select a model through ACP config options, or set it in the DSH profile |

The bridge also advertises `agentCapabilities.loadSession = true`, because it implements that capability on DSH's behalf. Without it, Happier will not offer session resume even when the backend is configured for it.

## Install

```powershell
npm install
npm run build
powershell -ExecutionPolicy Bypass -File ..\..\scripts\install-windows.ps1
```

The installer writes `%LOCALAPPDATA%\HarnessLink\bin\dsh-acp-bridge.cmd` and prints the exact command to paste into Happier's **Custom ACP** backend editor.

## Configure in Happier

**Settings → AI & Agents → AI backends → Custom backends → Add ACP backend**

| Field | Value |
|---|---|
| Title | DeepSeek Harness |
| Command | `C:\Users\<you>\AppData\Local\HarnessLink\bin\dsh-acp-bridge.cmd` |
| Args | *(empty)* |
| Supports session resume | on |
| Default model | optional; choose `deepseek-account/deepseek-flash` in the session |

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `DSH_BIN` | auto-detected | Executable used to start DSH |
| `DSH_INSTALL_DIR` | `%LOCALAPPDATA%\Programs\DeepSeek Harness` | Windows install root |
| `HARNESSLINK_DSH_PROFILE` | `acp` | DSH profile (do not use `DSH_PROFILE`; DSH sets that itself) |
| `DSH_ARGS_JSON` | — | Full argv override as a JSON array |
| `DSH_HOME` | `~/.dsh` | Session and credentials root |
| `HARNESSLINK_HISTORY` | `1` | Set `0` to skip history replay |
| `HARNESSLINK_MAX_EVENTS` | `2000` | Max events replayed |
| `HARNESSLINK_DEBUG` | `0` | Verbose stderr logging |

## Scope

- Root sessions only; subagent sessions (`delegationDepth > 0`) are skipped.
- `fs/*`, `terminal/*`, and modes are not implemented by DSH's ACP surface.
- Image input is not advertised by the installed DSH build; attachments still work through Happier's file-path flow.
- This package does not bundle DeepSeek Harness. Install it separately.

## Test

```powershell
npm test        # unit tests
npm run smoke   # fake ACP server, protocol contract
node scripts/real-smoke.mjs  # requires a real DSH install and login
```
