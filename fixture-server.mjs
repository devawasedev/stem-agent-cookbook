// Isolated, disposable loopback transport fixture. This is NOT STEM's deployed backend or OAuth service.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const catalog = JSON.parse(await readFile(new URL('./fixtures/tool-catalog.json', import.meta.url), 'utf8'));
const random = () => randomBytes(24).toString('base64url');

export async function startFixture() {
  const memories = new Map(); const edges = []; const clients = new Map(); const codes = new Map(); const tokens = new Set();
  const observations = { pkceVerified: false, authorizationResourceMatched: false, tokenResourceMatched: false, scope: null, revoked: 0 };
  let sequence = 0; let origin;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 65_536) return json(413, { error: 'too_large' }); }
      if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource/stem') return json(200, { resource: `${origin}/stem`, authorization_servers: [origin], scopes_supported: ['stem'], bearer_methods_supported: ['header'] });
      if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') return json(200, { issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`, registration_endpoint: `${origin}/oauth/register`, revocation_endpoint: `${origin}/oauth/revoke`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
      if (req.method === 'POST' && url.pathname === '/oauth/register') {
        const data = JSON.parse(raw); const redirect = new URL(data.redirect_uris?.[0]);
        if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || redirect.pathname !== '/callback' || redirect.search || redirect.hash || redirect.username || redirect.password || data.token_endpoint_auth_method !== 'none') return json(400, { error: 'invalid_redirect_uri' });
        const client_id = random(); clients.set(client_id, redirect.href);
        return json(201, { client_id, redirect_uris: [redirect.href], token_endpoint_auth_method: 'none' });
      }
      if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
        const p = url.searchParams; const registered = clients.get(p.get('client_id'));
        if (!registered || p.get('redirect_uri') !== registered || p.get('resource') !== `${origin}/stem` || p.get('scope') !== 'stem' || p.get('code_challenge_method') !== 'S256') return json(400, { error: 'invalid_request' });
        observations.authorizationResourceMatched = true; observations.scope = p.get('scope');
        const code = random(); codes.set(code, { clientId: p.get('client_id'), redirect: registered, challenge: p.get('code_challenge') });
        const callback = new URL(registered); callback.searchParams.set('code', code); callback.searchParams.set('state', p.get('state')); callback.searchParams.set('iss', origin);
        // Fixture-only auto grant. Real OAuth requires account authentication and user authorization.
        res.writeHead(302, { location: callback.href, 'cache-control': 'no-store' }); return res.end();
      }
      if (req.method === 'POST' && url.pathname === '/oauth/token') {
        const p = new URLSearchParams(raw); const grant = codes.get(p.get('code')); codes.delete(p.get('code'));
        if (!grant || grant.clientId !== p.get('client_id') || grant.redirect !== p.get('redirect_uri') || p.get('resource') !== `${origin}/stem` || p.get('grant_type') !== 'authorization_code' || createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') !== grant.challenge) return json(400, { error: 'invalid_grant' });
        observations.pkceVerified = true; observations.tokenResourceMatched = true;
        const access_token = random(); const refresh_token = random(); tokens.add(access_token); tokens.add(refresh_token);
        return json(200, { access_token, refresh_token, token_type: 'Bearer', scope: 'stem', expires_in: 60 });
      }
      if (req.method === 'POST' && url.pathname === '/oauth/revoke') { tokens.delete(new URLSearchParams(raw).get('token')); observations.revoked++; res.writeHead(200); return res.end(); }
      if (url.pathname !== '/stem' || req.method !== 'POST') return json(404, { error: 'not_found' });
      if (req.headers.authorization && !tokens.has(req.headers.authorization.replace(/^Bearer /, ''))) return json(401, { error: 'unauthorized' });
      const message = JSON.parse(raw);
      if (message.id === undefined) { res.writeHead(202); return res.end(); }
      const reply = result => json(200, { jsonrpc: '2.0', id: message.id, result });
      if (message.method === 'initialize') return reply({ protocolVersion: '2025-06-18', serverInfo: { name: 'stem-cookbook-fixture', version: '1.0.0' }, capabilities: { tools: {} } });
      if (message.method === 'tools/list') return reply({ tools: catalog });
      if (message.method !== 'tools/call') return json(200, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
      const { name, arguments: args = {} } = message.params; let result;
      if (name === 'remember' && typeof args.text === 'string' && args.text.trim()) {
        const id = ++sequence; memories.set(id, { id, text: args.text, source: args.source || 'notes', type: args.type || 'note', ts: Date.now(), score: 1 });
        result = { ok: true, id, source: args.source || 'notes', type: args.type || 'note', autolinked: [] };
      } else if (name === 'recall' && typeof args.query === 'string' && args.query.trim()) {
        const results = [...memories.values()].filter(item => item.text.includes(args.query) && (!args.source || args.source === item.source) && (!args.type || args.type === item.type)).slice(0, Math.max(1, Math.min(50, Math.floor(args.limit) || 8)));
        result = { query: args.query, count: results.length, results };
      } else if (name === 'graph') {
        const nodes = [...memories.values()].slice(0, args.limit || 300).map(item => ({ id: `m${item.id}`, label: item.text.slice(0, 42), layer: 4, source: item.source, type: item.type, ts: item.ts, degree: 0 }));
        result = { layers: [], nodes: [...nodes, { id: 'core', label: 'Core', layer: 0 }, { id: 'you', label: 'You', layer: 5 }], edges, counts: { memories: nodes.length, links: edges.length } };
      } else if (name === 'forget' && Number.isSafeInteger(args.id) && args.id > 0) {
        memories.delete(args.id); for (let i = edges.length - 1; i >= 0; i--) if (edges[i].from === `m${args.id}` || edges[i].to === `m${args.id}`) edges.splice(i, 1);
        result = { ok: true, forgot: args.id };
      } else if (name === 'link' && memories.has(args.from) && memories.has(args.to)) {
        const id = edges.length + 1; edges.push({ from: `m${args.from}`, to: `m${args.to}`, type: args.type || 'relates', weight: args.weight ?? 1 }); result = { ok: true, id, from: args.from, to: args.to, type: args.type || 'relates', weight: args.weight ?? 1 };
      } else return reply({ content: [{ type: 'text', text: 'Fixture tool error' }], isError: true });
      return reply({ structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
    } catch { return json(400, { error: 'invalid_fixture_request' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: `${origin}/stem`, observations, memoryCount: () => memories.size, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startFixture(); console.log(fixture.url);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await fixture.close(); process.exit(0); });
}
