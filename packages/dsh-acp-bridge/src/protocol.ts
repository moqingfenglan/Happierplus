export type JsonRpcId = string | number | null;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return typeof (message as JsonRpcRequest).method === 'string' && 'id' in message;
}

export function isResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return !('method' in message) && 'id' in message;
}

export function isNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return typeof (message as JsonRpcNotification).method === 'string' && !('id' in message);
}

/**
 * ACP uses newline-delimited JSON. Anything that is not a JSON-RPC object is
 * non-protocol output (DSH plugins sometimes log to stdout), so callers must
 * treat `null` as "drop this line".
 */
export function parseJsonRpcLine(line: string): JsonRpcMessage | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return null;
  try {
    const value = JSON.parse(trimmed) as Partial<JsonRpcMessage>;
    if (!value || value.jsonrpc !== '2.0') return null;
    return value as JsonRpcMessage;
  } catch {
    return null;
  }
}

export function serializeJsonRpc(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}
