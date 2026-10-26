import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { endpoint, boundedText, RESOURCE, StemError } from './stem-client.mjs';

export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function jsonRequest(url, init = {}) {
  let response;
  try { response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
  catch { throw new StemError('oauth_network', 'OAuth request failed or timed out. No automatic retry.'); }
  if (!response.ok) throw new StemError('oauth_http', `OAuth endpoint returned HTTP ${response.status}.`);
  try { return JSON.parse(await boundedText(response, 65_536)); }
  catch { throw new StemError('oauth_response', 'Invalid or oversized OAuth JSON response.'); }
}

/** STEM-specific issuer pinning. Does not follow arbitrary authorization servers advertised by another origin. */
export async function discover(resource = RESOURCE, { allowLocal = false } = {}) {
  const target = endpoint(resource, { allowLocal });
  const resourceMetadata = await jsonRequest(`${target.origin}/.well-known/oauth-protected-resource${target.pathname}`);
  if (resourceMetadata.resource !== target.href || !resourceMetadata.authorization_servers?.includes(target.origin)) throw new Error('Resource/issuer metadata does not match this STEM endpoint.');
  const metadata = await jsonRequest(`${target.origin}/.well-known/oauth-authorization-server`);
  if (metadata.issuer !== target.origin) throw new Error('Unexpected OAuth issuer.');
  for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    if (typeof metadata[key] !== 'string' || endpoint(metadata[key], { allowLocal }).origin !== target.origin) throw new Error(`Unexpected OAuth endpoint: ${key}`);
  }
  if (metadata.revocation_endpoint && endpoint(metadata.revocation_endpoint, { allowLocal }).origin !== target.origin) throw new Error('Unexpected revocation endpoint.');
  if (!metadata.code_challenge_methods_supported?.includes('S256') || !metadata.token_endpoint_auth_methods_supported?.includes('none')) throw new Error('This example requires S256 PKCE and public-client authentication.');
  if (!resourceMetadata.scopes_supported?.includes('stem')) throw new Error('STEM scope was not advertised.');
  return metadata;
}

/** OAuth authorization-code + PKCE/DCR example. Authenticates only when explicitly called. */
export async function authorize({ resource = RESOURCE, allowLocal = false, onAuthorizationUrl, timeoutMs = 180_000 } = {}) {
  if (typeof onAuthorizationUrl !== 'function') throw new Error('Supply an explicit browser authorization callback.');
  const metadata = await discover(resource, { allowLocal });
  const { verifier, challenge } = pkce(); const state = randomBytes(32).toString('base64url');
  let finish; let fail; let completed = false;
  const codePromise = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  // Attach rejection handling immediately; registration/browser setup can fail before awaiting the callback.
  codePromise.catch(() => {});
  const server = createServer((req, res) => {
    const incoming = new URL(req.url, 'http://127.0.0.1');
    const reply = (status, message) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end(message); };
    if (req.method !== 'GET' || incoming.pathname !== '/callback') return reply(404, 'Not found');
    const receivedState = incoming.searchParams.get('state') || '';
    if (Buffer.byteLength(receivedState) !== Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(receivedState), Buffer.from(state))) return reply(400, 'Invalid OAuth state.');
    if (completed) return reply(409, 'This callback was already consumed.');
    if (incoming.searchParams.has('iss') && incoming.searchParams.get('iss') !== metadata.issuer) return reply(400, 'Unexpected OAuth issuer.');
    completed = true;
    if (incoming.searchParams.has('error')) { reply(400, 'Authorization was not completed.'); fail(new Error('Authorization was denied.')); return; }
    const code = incoming.searchParams.get('code');
    if (!code) { reply(400, 'Missing authorization code.'); fail(new Error('Missing authorization code.')); return; }
    reply(200, 'Authorization received. Return to your terminal.'); finish(code);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const timer = setTimeout(() => fail(new Error('Authorization timed out; no token was saved.')), timeoutMs);
  try {
    const registered = await jsonRequest(metadata.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'STEM cookbook synthetic smoke', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }) });
    if (typeof registered.client_id !== 'string' || !registered.client_id || registered.token_endpoint_auth_method && registered.token_endpoint_auth_method !== 'none' || !registered.redirect_uris?.includes(redirectUri)) throw new Error('Registration returned an unexpected public-client configuration.');
    const authUrl = new URL(metadata.authorization_endpoint);
    for (const [key, value] of Object.entries({ client_id: registered.client_id, redirect_uri: redirectUri, response_type: 'code', scope: 'stem', resource, code_challenge: challenge, code_challenge_method: 'S256', state })) authUrl.searchParams.set(key, value);
    await onAuthorizationUrl(authUrl.href); // Contains no code, verifier, access token or refresh token.
    const code = await codePromise;
    const tokens = await jsonRequest(metadata.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: registered.client_id, redirect_uri: redirectUri, code_verifier: verifier, resource }) });
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || String(tokens.token_type).toLowerCase() !== 'bearer') throw new Error('Token endpoint did not return a usable bearer token.');
    const grantedScopes = typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/) : ['stem'];
    if (!grantedScopes.includes('stem') || grantedScopes.some(scope => scope !== 'stem')) throw new Error('Granted scope differs from the requested STEM-only scope.');
    let accessToken = tokens.access_token; let refreshToken = tokens.refresh_token;
    // Deliberately no disk cache, environment export, token printout, ID-token processing or refresh loop.
    return {
      accessToken,
      async revoke() {
        if (!metadata.revocation_endpoint) return false;
        let ok = true;
        for (const [token, hint] of [[accessToken, 'access_token'], [refreshToken, 'refresh_token']]) {
          if (!token) continue;
          try {
            const response = await fetch(metadata.revocation_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token, token_type_hint: hint, client_id: registered.client_id }), redirect: 'error', signal: AbortSignal.timeout(15_000) });
            if (!response.ok) ok = false;
            await response.body?.cancel();
          } catch { ok = false; }
        }
        accessToken = undefined; refreshToken = undefined; this.accessToken = undefined;
        return ok;
      }
    };
  } finally { clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
