/** @typedef {{id:number,text:string,source:string,type:string,ts:number,score:number}} Memory */
/** @typedef {{query:string,count:number,results:Memory[]}} RecallResult */

export const RESOURCE = 'https://awase.dev/stem';
export const PROTOCOL_VERSION = '2025-06-18';

/** Reject credentials, query strings and fragments; local HTTP is an explicit fixture exception. */
export function endpoint(value, { allowLocal = false } = {}) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error('Endpoint must not contain credentials, query parameters or a fragment.');
  if (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:' && url.hostname === '127.0.0.1')) {
    throw new Error('HTTPS required; only explicit 127.0.0.1 fixtures may use HTTP.');
  }
  return url;
}

export class StemError extends Error {
  constructor(code, message) { super(message); this.name = 'StemError'; this.code = code; }
}

/** Read bounded HTTP bodies, keeping credentials and raw server errors out of diagnostics. */
export async function boundedText(response, maxBytes = 1_048_576) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new StemError('response_too_large', 'Response exceeds the cookbook safety limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Minimal client for STEM's JSON-response Streamable HTTP subset, not a general MCP SDK. */
export class StemClient {
  #token; #session; #id = 0;
  constructor({ url = RESOURCE, accessToken, allowLocal = false, fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
    this.url = endpoint(url, { allowLocal }).href;
    if (accessToken !== undefined && (typeof accessToken !== 'string' || !accessToken.trim() || /[\r\n]/.test(accessToken))) throw new Error('Invalid in-memory access token.');
    this.#token = accessToken; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }
  async rpc(method, params = {}, { notification = false } = {}) {
    const id = notification ? undefined : ++this.#id;
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL_VERSION };
    if (this.#token) headers.Authorization = `Bearer ${this.#token}`;
    if (this.#session) headers['Mcp-Session-Id'] = this.#session;
    let response;
    try {
      response = await this.fetch(this.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }), redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
    } catch { throw new StemError('network_error', 'Connection failed or timed out; do not automatically retry writes.'); }
    if (response.status === 401) throw new StemError('unauthorized', 'Authorization expired or missing. Reconnect using OAuth.');
    if (response.status === 403) throw new StemError('forbidden', 'This connection does not have permission for that operation.');
    if (response.status === 429) throw new StemError('rate_limited', 'Rate limited. Respect Retry-After; inspect uncertain writes before retrying.');
    if (!response.ok) throw new StemError(`http_${response.status}`, `MCP request failed with HTTP ${response.status}.`);
    const session = response.headers.get('mcp-session-id');
    if (session) this.#session = session;
    const raw = await boundedText(response);
    if (notification && !raw) return;
    if (!response.headers.get('content-type')?.includes('application/json')) throw new StemError('unsupported_transport', 'This minimal example requires JSON responses. Use a full MCP SDK for SSE streams.');
    let body;
    try { body = JSON.parse(raw); } catch { throw new StemError('invalid_json', 'The MCP response is not valid JSON.'); }
    if (body.jsonrpc !== '2.0' || body.id !== id) throw new StemError('invalid_response', 'The MCP response does not match this request.');
    if (body.error) throw new StemError(`rpc_${body.error.code}`, 'The server rejected the MCP request. Check the method and arguments.');
    if (!body.result || typeof body.result !== 'object') throw new StemError('invalid_result', 'Missing MCP result.');
    return body.result;
  }
  async initialize() {
    const result = await this.rpc('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'stem-cookbook', version: '1.0.0' } });
    if (result.protocolVersion !== PROTOCOL_VERSION) throw new StemError('unsupported_version', 'The server selected a version this minimal client does not implement.');
    await this.rpc('notifications/initialized', {}, { notification: true });
    return result;
  }
  async tools() { return (await this.rpc('tools/list')).tools; }
  async call(name, args) {
    const result = await this.rpc('tools/call', { name, arguments: args });
    if (result.isError) throw new StemError('tool_error', 'The STEM tool reported an error. Check arguments, consent, capacity and permissions; writes are not retried.');
    if (result.structuredContent !== undefined) return result.structuredContent;
    const text = result.content?.find(item => item.type === 'text')?.text;
    try { return JSON.parse(text); } catch { throw new StemError('invalid_tool_result', 'Expected a structured JSON tool result.'); }
  }
  /** @returns {Promise<RecallResult>} */
  recall(query, limit = 8) { return this.call('recall', { query, limit }); }
  forgetToken() { this.#token = undefined; this.#session = undefined; }
}

/** Explicit synthetic save, recall, graph inspection, delete. Never deletes IDs obtained by search. */
export async function syntheticWorkflow(client, { marker = `stem-cookbook-${crypto.randomUUID()}` } = {}) {
  await client.initialize();
  const tools = await client.tools();
  for (const name of ['remember', 'recall', 'graph', 'forget']) {
    if (!tools?.some(tool => tool.name === name)) throw new Error(`Required tool unavailable: ${name}`);
  }
  const text = `${marker}: Synthetic project Lantern chooses amber for its demo label.`;
  let createdId; let result;
  try {
    const saved = await client.call('remember', { text, source: 'notes', type: 'decision', tags: ['cookbook', 'synthetic'], autolink: false });
    if (saved.ok !== true || !Number.isSafeInteger(saved.id) || saved.id <= 0) throw new Error('Save did not return a valid ID; do not guess a cleanup ID.');
    createdId = saved.id;
    const recalled = await client.recall(marker, 8);
    if (!recalled.results?.some(memory => memory.id === createdId && memory.text === text)) throw new Error('Synthetic memory was not returned exactly; retrieval may be bounded.');
    const graph = await client.call('graph', { limit: 1000 });
    // graph is bounded; absence here is diagnostic, not proof the save disappeared.
    result = { kind: 'synthetic-workflow', saved: true, recalled: true, graphContainsCreatedMemory: graph.nodes?.some(node => node.id === `m${createdId}`) === true };
  } finally {
    if (createdId !== undefined) {
      try {
        const deleted = await client.call('forget', { id: createdId });
        if (deleted.ok !== true || deleted.forgot !== createdId) throw new Error('Unexpected delete result.');
      } catch { throw new StemError('cleanup_failed', `Cleanup was not confirmed for synthetic memory ID ${createdId}. Inspect that exact ID before retrying.`); }
    }
  }
  const after = await client.recall(marker, 8);
  if (after.results?.some(memory => memory.id === createdId)) throw new Error('Deleted synthetic memory still appeared in recall.');
  return { ...result, deleteAcknowledged: true, absentFromSubsequentRecall: true };
}
