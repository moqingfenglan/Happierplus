const prefix = '[dsh-acp-bridge]';

export function log(...args: unknown[]): void {
  console.error(prefix, ...args);
}

export function debug(...args: unknown[]): void {
  if (process.env.HARNESSLINK_DEBUG === '1') {
    console.error(prefix, ...args);
  }
}
