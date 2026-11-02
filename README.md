# HarnessLink

**A mobile control room for DeepSeek Harness, built on [Happier](https://github.com/happier-dev/happier).**

HarnessLink lets one phone follow and control DeepSeek Harness sessions running on several computers — alongside Codex, Claude and OpenCode sessions that Happier already supports.

This repository starts with the piece that makes DSH work inside Happier: a small ACP bridge.

```
Phone (Happier)
   │  E2E encrypted
Happier Relay
   │
Happier Daemon
   │  stdio ACP
dsh-acp-bridge
   │  stdio ACP
dsh --profile acp
```

## Why a bridge?

DeepSeek Harness ships an automation-only ACP server (`dsh --profile acp`), but it differs from what Happier expects in four places:

1. DSH supports `session/resume`; Happier calls `session/load`.
2. DSH does not replay history when resuming.
3. DSH may write non-protocol log lines to stdout.
4. DSH's default model route can be wrong for the installed credentials.

`dsh-acp-bridge` is a transparent JSON-RPC proxy that fixes those four things and stays out of the way otherwise.

## Status

Working end to end:

- **Android app v0.1.6** — DSH whale icon, native `DeepSeek Harness` agent, in-app APK updates.
- **Custom ACP** — the bridge below works with the stock Happier daemon.
- **Native DSH** — works with the HarnessLink fork daemon (`0.2.17-dsh`).
- **DSH desktop sidebar** — `packages/dsh-workspace-bridge` attaches ACP sessions to workspaces.
- **Codex / ChatGPT** — Codex CLI sessions are available from the same app.

The Android app and the Happier fork live in
[moqingfenglan/Happierplus-app](https://github.com/moqingfenglan/Happierplus-app).
This repository keeps the bridge, the DSH workspace plugin and the Windows setup scripts.

See [docs/DSH-Happier-手机控制台-完整方案.md](docs/DSH-Happier-手机控制台-完整方案.md) for the design and environment notes.

## Quick start (Windows)

```powershell
# 1) install dependencies and build
npm install
npm run build

# 2) smoke test against a fake ACP server
npm run smoke

# 3) point Happier's Custom ACP backend at the built entry point
#    command: node
#    args:    C:\path\to\harnesslink\packages\dsh-acp-bridge\dist\index.js
```

The bridge auto-detects a standard Windows DeepSeek Harness install. Override with:

| Variable | Default | Meaning |
|---|---|---|
| `DSH_BIN` | auto-detected | Path to `DeepSeek Harness.exe` (or `dsh` on macOS/Linux) |
| `DSH_INSTALL_DIR` | `%LOCALAPPDATA%\Programs\DeepSeek Harness` | Install root on Windows |
| `HARNESSLINK_DSH_PROFILE` | `acp` | DSH profile to boot (avoid `DSH_PROFILE`, which DSH itself sets) |
| `DSH_ARGS_JSON` | — | Full argv override, JSON array (used by tests) |
| `DSH_HOME` | `~/.dsh` | Session/credentials root |
| `HARNESSLINK_HISTORY` | `1` | Replay session history on `session/load` |
| `HARNESSLINK_MAX_EVENTS` | `2000` | Max historical events replayed |
| `HARNESSLINK_DEBUG` | `0` | Verbose logs to stderr |

## Layout

```
packages/dsh-acp-bridge/         the ACP proxy + history replay
packages/dsh-workspace-bridge/   DSH desktop workspace membership plugin
scripts/install-windows.ps1      Windows bridge shims and acp-dsh profile
docs/                            design and operations notes
.github/workflows/               CI
```

## Releases

- Android APK: [latest release](https://github.com/moqingfenglan/Happierplus-app/releases/latest)
- Fork CLI: built by `cli-windows.yml` in the app repository.

## License

MIT. Happier is MIT; DeepSeek Harness is a separate product and is not bundled here.

