import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridgeEntry = path.join(packageDir, 'dist', 'index.js');
const fakeDsh = path.join(packageDir, 'test', 'fixtures', 'fake-dsh.mjs');

const bridge = spawn(process.execPath, [bridgeEntry], {
  cwd: packageDir,
  env: {
    ...process.env,
    DSH_BIN: process.execPath,
    DSH_ARGS_JSON: JSON.stringify([fakeDsh]),
    HARNESSLINK_HISTORY: '0',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

bridge.stderr.on('data', (chunk) => process.stderr.write(`[bridge] ${chunk}`));

const pending = new Map();
let nextId = 1;

readline.createInterface({ input: bridge.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    throw new Error(`bridge wrote non-JSON to stdout: ${line}`);
  }
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
});

function request(method, params) {
  const id = nextId++;
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout waiting for ${method}`));
    }, 10000);
  });
  bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return promise;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const init = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  });
  assert(init.agentCapabilities?.loadSession === true, 'bridge must advertise loadSession=true');

  const loaded = await request('session/load', { sessionId: 'fake-session', cwd: process.cwd(), mcpServers: [] });
  assert(loaded.method === 'session/resume', 'session/load must be translated to session/resume');
  assert(loaded.sessionId === 'fake-session', 'session id must be preserved');

  const created = await request('session/new', { cwd: process.cwd(), mcpServers: [] });
  assert(created.sessionId === 'fake-session', 'session/new must pass through');

  const prompted = await request('session/prompt', {
    sessionId: created.sessionId,
    prompt: [{ type: 'text', text: 'hello' }],
  });
  assert(prompted.stopReason === 'end_turn', 'prompt must pass through');

  console.log('smoke: ok');
} finally {
  bridge.kill();
}
