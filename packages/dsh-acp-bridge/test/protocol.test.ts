import { describe, expect, it } from 'vitest';

import { isRequest, isResponse, parseJsonRpcLine, serializeJsonRpc } from '../src/protocol.js';

describe('protocol', () => {
  it('drops non-protocol stdout', () => {
    expect(parseJsonRpcLine('[llm-deepseek-account] model listing loaded 2 model(s)')).toBeNull();
    expect(parseJsonRpcLine('')).toBeNull();
    expect(parseJsonRpcLine('{"jsonrpc":"2.0","id":1')).toBeNull();
    expect(parseJsonRpcLine('{"foo":1}')).toBeNull();
  });

  it('parses requests and responses', () => {
    const request = parseJsonRpcLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    expect(request && isRequest(request)).toBe(true);

    const response = parseJsonRpcLine('{"jsonrpc":"2.0","id":1,"result":{}}');
    expect(response && isResponse(response)).toBe(true);
  });

  it('serializes one line per message', () => {
    expect(serializeJsonRpc({ jsonrpc: '2.0', id: 1, method: 'ping' })).toBe(
      '{"jsonrpc":"2.0","id":1,"method":"ping"}\n',
    );
  });
});
