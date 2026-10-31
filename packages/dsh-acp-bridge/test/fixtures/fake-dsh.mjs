import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

rl.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (!request || request.jsonrpc !== '2.0' || request.id === undefined) return;

  switch (request.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: 'fake-dsh', version: '0.0.0' },
          agentCapabilities: {
            promptCapabilities: { image: false },
            sessionCapabilities: { list: {}, resume: {}, close: {} },
          },
        },
      });
      // Deliberately pollute stdout: the bridge must drop this line.
      process.stdout.write('[fake-dsh] a plugin logged to stdout\n');
      break;

    case 'session/resume':
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          method: 'session/resume',
          sessionId: request.params?.sessionId,
          configOptions: [],
        },
      });
      break;

    case 'session/new':
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: { sessionId: 'fake-session', configOptions: [] },
      });
      break;

    case 'session/prompt':
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: { stopReason: 'end_turn' },
      });
      break;

    default:
      send({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      });
  }
});
