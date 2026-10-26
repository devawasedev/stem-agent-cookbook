import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startFixture } from '../fixture-server.mjs';
import { endpoint, StemClient, syntheticWorkflow } from '../stem-client.mjs';
import { authorize, pkce } from '../oauth.mjs';
const execute = promisify(execFile);
const cwd = fileURLToPath(new URL('..', import.meta.url));

test('Node synthetic workflow saves, recalls, inspects and removes only its created memory', async () => {
  const fixture = await startFixture();
  try {
    const client = new StemClient({ url: fixture.url, allowLocal: true });
    await client.call('remember', { text: 'Pre-existing synthetic fixture note', source: 'notes' });
    const result = await syntheticWorkflow(client, { marker: 'isolated-node-test' });
    assert.equal(result.recalled, true); assert.equal(result.graphContainsCreatedMemory, true); assert.equal(result.deleteAcknowledged, true); assert.equal(fixture.memoryCount(), 1);
  } finally { await fixture.close(); }
});

test('PKCE is fresh, URL-safe and SHA256-derived', () => {
  const a = pkce(), b = pkce(); assert.match(a.verifier, /^[A-Za-z0-9_-]{43}$/); assert.match(a.challenge, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(a.verifier, b.verifier); assert.notEqual(a.challenge, a.verifier);
});

test('Node OAuth fixture verifies state, PKCE, resource audience, stem-only scope and revocation', async () => {
  const fixture = await startFixture();
  try {
    const grant = await authorize({ resource: fixture.url, allowLocal: true, onAuthorizationUrl: async authUrl => {
      const authorizeResponse = await fetch(authUrl, { redirect: 'manual' });
      const callback = new URL(authorizeResponse.headers.get('location'));
      const invalid = new URL(callback); invalid.searchParams.set('state', 'wrong');
      assert.equal((await fetch(invalid)).status, 400);
      assert.equal((await fetch(callback)).status, 200);
    } });
    const client = new StemClient({ url: fixture.url, accessToken: grant.accessToken, allowLocal: true });
    await syntheticWorkflow(client); client.forgetToken(); assert.equal(await grant.revoke(), true); assert.equal(grant.accessToken, undefined);
    assert.deepEqual(fixture.observations, { pkceVerified: true, authorizationResourceMatched: true, tokenResourceMatched: true, scope: 'stem', revoked: 2 });
  } finally { await fixture.close(); }
});

test('Python synthetic workflow is runnable using the standard library', async () => {
  const fixture = await startFixture();
  try {
    const result = await execute('python3', ['smoke.py', '--fixture', fixture.url], { cwd, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    const receipt = JSON.parse(result.stdout); assert.equal(receipt.recalled, true); assert.equal(receipt.deleteAcknowledged, true); assert.equal(receipt.modelEvaluation, false); assert.equal(fixture.memoryCount(), 0); assert.equal(result.stderr, '');
  } finally { await fixture.close(); }
});

test('Python OAuth fixture exercises PKCE/DCR without recording tokens', async () => {
  const fixture = await startFixture();
  const script = 'import sys,json,urllib.request\nfrom oauth_client import authorize\nfrom stem_client import StemClient,synthetic_workflow\ngrant=authorize(sys.argv[1],allow_local=True,on_authorization_url=lambda url: urllib.request.urlopen(url).close())\nclient=StemClient(sys.argv[1],grant.access_token,allow_local=True)\nresult=synthetic_workflow(client)\nclient.forget_token()\nresult["revoked"]=grant.revoke()\nprint(json.dumps(result))';
  try {
    const result = await execute('python3', ['-c', script, fixture.url], { cwd, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    assert.equal(JSON.parse(result.stdout).revoked, true); assert.equal(result.stderr, ''); assert.equal(fixture.memoryCount(), 0); assert.equal(fixture.observations.pkceVerified, true); assert.equal(fixture.observations.revoked, 2);
  } finally { await fixture.close(); }
});

test('Endpoint validation rejects query tokens, URL credentials, remote HTTP and implicit localhost', () => {
  for (const value of ['https://awase.dev/stem?access_token=secret', 'https://user:secret@awase.dev/stem', 'https://awase.dev/stem#secret', 'http://example.com/stem', 'http://localhost/stem']) assert.throws(() => endpoint(value));
  assert.throws(() => endpoint('http://127.0.0.1/stem'));
  assert.equal(endpoint('http://127.0.0.1:123/stem', { allowLocal: true }).hostname, '127.0.0.1');
});

test('Bearer requests do not follow HTTP redirects', async () => {
  let reached = 0;
  const destination = createServer((req, res) => { reached++; res.end('{}'); });
  await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve));
  const source = createServer((req, res) => { res.writeHead(302, { location: `http://127.0.0.1:${destination.address().port}/` }); res.end(); });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  try {
    const client = new StemClient({ url: `http://127.0.0.1:${source.address().port}/stem`, allowLocal: true, accessToken: 'synthetic-token' });
    await assert.rejects(client.tools(), /Connection failed/); assert.equal(reached, 0);
  } finally { source.closeAllConnections(); destination.closeAllConnections(); await Promise.all([new Promise(resolve => source.close(resolve)), new Promise(resolve => destination.close(resolve))]); }
});

test('RPC errors do not echo raw server messages or tokens and do not retry', async () => {
  let calls = 0;
  const client = new StemClient({ accessToken: 'private-synthetic-token', fetchImpl: async (_url, options) => {
    calls++; const id = JSON.parse(options.body).id;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: 'private-synthetic-token' } }), { headers: { 'content-type': 'application/json' } });
  } });
  await assert.rejects(client.call('remember', { text: 'synthetic' }), error => !error.message.includes('private-synthetic-token'));
  assert.equal(calls, 1);
});

test('Protocol mismatch and unsupported SSE are reported instead of pretending compatibility', async () => {
  const version = new StemClient({ fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2026-07-28' } }), { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(version.initialize(), /version/);
  const sse = new StemClient({ fetchImpl: async () => new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }) });
  await assert.rejects(sse.tools(), /full MCP SDK/);
});

test('Catalog snapshot matches the five core tools when run in the source repository', async t => {
  let source;
  try { source = await import('../../../packages/stem/src/stem-mcp.mjs'); } catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND') { t.skip('Standalone archive: repository source is not present.'); return; } throw error; }
  const snapshot = JSON.parse(await readFile(new URL('../fixtures/tool-catalog.json', import.meta.url), 'utf8'));
  assert.deepEqual(snapshot, source.TOOLS);
});

test('CLI fixture flags cannot target production', async () => {
  for (const [binary, args] of [['node', ['smoke.mjs']], ['python3', ['smoke.py']]]) {
    await assert.rejects(execute(binary, [...args, '--fixture', 'https://awase.dev/stem'], { cwd, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }), error => error.stderr.includes('Fixture mode accepts only'));
  }
});
