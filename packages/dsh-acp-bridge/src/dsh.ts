import path from 'node:path';
import os from 'node:os';

export interface DshLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * Resolve how to start the DeepSeek Harness ACP profile.
 *
 * The packaged Windows app exposes its CLI through an Electron-as-Node entry
 * point. On macOS/Linux we assume `dsh` is on PATH, which is how the CLI
 * installer exposes it.
 */
export function resolveDshLaunch(): DshLaunch {
  const profile = process.env.HARNESSLINK_DSH_PROFILE?.trim() || 'acp';

  if (process.env.DSH_BIN) {
    const args = parseArgsOverride() ?? ['--profile', profile];
    return { command: process.env.DSH_BIN, args, env: { ...process.env } };
  }

  if (process.platform === 'win32') {
    const installDir =
      process.env.DSH_INSTALL_DIR?.trim() ||
      path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness');
    const exe = path.join(installDir, 'DeepSeek Harness.exe');
    const cliEntry = path.join(
      installDir,
      'resources',
      'app.asar',
      'dsh',
      'node_modules',
      '@deepseek-ai',
      'dsh-desktop-host',
      'lib',
      'cli.js',
    );
    return {
      command: exe,
      args: ['--expose-internals', cliEntry, '--profile', profile],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    };
  }

  return {
    command: 'dsh',
    args: ['--profile', profile],
    env: { ...process.env },
  };
}

function parseArgsOverride(): string[] | null {
  const raw = process.env.DSH_ARGS_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
      throw new Error('DSH_ARGS_JSON must be a JSON array of strings');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid DSH_ARGS_JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function dshHome(): string {
  return process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh');
}

