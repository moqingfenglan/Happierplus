import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { findSessionLog } from '../dist/history.js';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridgeEntry = path.join(packageDir, 'dist', 'index.js');
const workspace = path.join(packageDir, '.tmp', 'real-smoke');
fs.mkdirSync(workspace, { recursive: true });

const bridge = spawn(process.execPath, [bridgeEntry], {
  cwd: workspace,
  env: { ...process.env, HARNESSLINK_DEBUG: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});
bridge.stderr.on('data', (chunk) => process.stderr.write(`[bridge] ${chunk}`));

const pending = new Map();
let nextId = 1;
const texts = [];
let updates = 0;
let activeSessionId = null;

readline.createInterface({ input: bridge.stdout }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
    return;
  }
  if (message.method === 'session/update') {
    updates++;
    const update = message.params?.update ?? {};
    if (message.params?.sessionId === activeSessionId && update.sessionUpdate === 'agent_message_chunk') {
      texts.push(update.content?.text ?? '');
    }
  }
  if (message.method === 'session/request_permission') {
    bridge.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: { outcome: { outcome: 'selected', optionId: message.params?.options?.[0]?.optionId } },
    })}\n`);
  }
});

function request(method, params) {
  const id = nextId++;
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout waiting for ${method}`));
    }, 60000);
  });
  bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return promise;
}

try {
  const init = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  });
  console.log('loadSession advertised:', init.agentCapabilities?.loadSession === true);

  const list = await request('session/list', {});
  console.log('sessions:', list.sessions?.length ?? 0);

  const candidates = (list.sessions ?? []).filter((session) => findSessionLog(session.sessionId)).slice(0, 5);
  let replayed = false;
  for (const candidate of candidates) {
    const beforeReplay = updates;
    try {
      const loaded = await request('session/load', {
        sessionId: candidate.sessionId,
        cwd: candidate.cwd,
        mcpServers: [],
      });
      if (loaded && updates - beforeReplay > 0) {
        console.log('loaded:', candidate.sessionId, 'replay updates:', updates - beforeReplay);
        replayed = true;
        break;
      }
    } catch (error) {
      console.log('skip occupied/unreadable session:', candidate.sessionId, error.message.slice(0, 100));
    }
  }
  if (candidates.length > 0 && !replayed) {
    throw new Error('expected at least one session/load with history replay');
  }

  const created = await request('session/new', { cwd: workspace, mcpServers: [] });
  activeSessionId = created.sessionId;
  console.log('new session:', created.sessionId);

  const modelOption = created.configOptions?.find((option) => option.id === 'model');
  const accountModel = modelOption?.options
    ?.flatMap((group) => group.options ?? [])
    ?.find((option) => /deepseek-account/.test(option.value));
  if (accountModel) {
    await request('session/set_config_option', {
      sessionId: created.sessionId,
      configId: 'model',
      value: accountModel.value,
    });
    console.log('model:', accountModel.value);
  }

  const result = await request('session/prompt', {
    sessionId: created.sessionId,
    prompt: [{ type: 'text', text: 'Reply with exactly the word PONG and nothing else.' }],
  });
  console.log('stopReason:', result.stopReason, 'updates:', updates);
  console.log('text:', texts.join('').slice(0, 200));
  if (result.stopReason !== 'end_turn') throw new Error('unexpected stop reason');
  if (!texts.join('').includes('PONG')) throw new Error('expected PONG');
  console.log('real smoke: ok');
} finally {
  bridge.kill();
}
