/** A real Node → Python same-account workflow, with an explicit local-fixture mode. */
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { StemClient, RESOURCE, PROTOCOL_VERSION, endpoint } from './stem-client.mjs';
import { authorize } from './oauth.mjs';

const round = value => Math.round(value * 1000) / 1000;
const TEXT_SUFFIX = ': Synthetic project Lantern chooses amber for its demo label.';
const SOURCE_FILES = ['shared_memory_demo.mjs', 'shared_memory_reader.py', 'stem-client.mjs', 'stem_client.py', 'oauth.mjs'];

/** Credentials travel in a private stdin pipe, never command arguments, environment or disk. */
export function readWithPython(payload, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-I', '-B', '-c', 'import runpy,sys;sys.path.insert(0,sys.argv[1]);runpy.run_path(sys.argv[1]+"/shared_memory_reader.py",run_name="__main__")', fileURLToPath(new URL('.', import.meta.url))], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // No process environment credentials, Python startup hooks or inherited proxy settings.
      env: { PATH: process.env.PATH || '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1' },
    });
    let stdout = ''; let size = 0; let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('python_reader_timeout')); }, timeoutMs);
    child.on('error', () => finish(new Error('python_reader_unavailable')));
    child.stdin.on('error', () => { /* A terminated child is handled by error/close. */ });
    child.stdout.on('data', data => {
      size += data.length;
      if (size > 4096) { child.kill('SIGKILL'); finish(new Error('python_reader_oversized')); return; }
      stdout += data.toString('utf8');
    });
    // Consume but never echo child diagnostics; they may include platform-specific data.
    child.stderr.on('data', () => {});
    child.on('close', code => {
      if (settled) return;
      let value; try { value = JSON.parse(stdout); } catch { finish(new Error('python_reader_invalid')); return; }
      if (code !== 0 || value.ok !== true || value.exactSyntheticMatch !== true || !/^\d+\.\d+\.\d+$/.test(value.pythonVersion || '')) { finish(new Error('python_reader_failed')); return; }
      const timings = value.timings;
      if (!timings || !['pythonInitializeMs', 'pythonRecallMs'].every(key => Number.isFinite(timings[key]) && timings[key] >= 0)) { finish(new Error('python_reader_invalid')); return; }
      // Allowlist output fields: never propagate arbitrary child/server output.
      finish(null, { exactSyntheticMatch: true, pythonVersion: value.pythonVersion, timings: { pythonInitializeMs: timings.pythonInitializeMs, pythonRecallMs: timings.pythonRecallMs } });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

/** Deletes only the ID directly returned by this run's remember call, even on reader failure. */
export async function sharedMemoryWorkflow(client, { url, accessToken, allowLocal = false, reader = readWithPython, marker = `stem-shared-demo-${randomUUID()}` } = {}) {
  const receipt = {
    schemaVersion: 1, kind: 'node-to-python-shared-memory', startedAt: new Date().toISOString(),
    modelEvaluation: false, llmHostCompatibilityTest: false, independentlyAuthorizedClients: false,
    sessionBoundary: 'Two MCP client sessions, one user-authorized OAuth grant',
    protocolVersion: PROTOCOL_VERSION, runtimes: { node: process.version, python: null },
    checks: { nodeInitialized: false, requiredToolsAvailable: false, syntheticSaveAcknowledged: false, pythonExactRecall: false, deleteAcknowledged: false, absentFromSubsequentBoundedRecall: false },
    timings: {}, cleanup: { attempted: false, confirmed: false }, failures: [],
  };
  const started = performance.now(); let createdId; let stage = 'node_initialize';
  const text = marker + TEXT_SUFFIX;
  const measure = async (name, fn) => { const start = performance.now(); try { return await fn(); } finally { receipt.timings[name] = round(performance.now() - start); } };
  try {
    await measure('nodeInitializeMs', () => client.initialize()); receipt.checks.nodeInitialized = true;
    stage = 'tools_list'; const tools = await measure('toolsListMs', () => client.tools());
    if (!['remember', 'recall', 'forget'].every(name => tools?.some(tool => tool.name === name))) throw new Error();
    receipt.checks.requiredToolsAvailable = true;
    stage = 'synthetic_save';
    const saved = await measure('nodeRememberMs', () => client.call('remember', { text, source: 'notes', type: 'decision', tags: ['cookbook', 'synthetic', 'shared-client-demo'], autolink: false }));
    if (saved.ok !== true || !Number.isSafeInteger(saved.id) || saved.id <= 0) throw new Error();
    createdId = saved.id; receipt.checks.syntheticSaveAcknowledged = true;
    stage = 'python_recall';
    const python = await measure('pythonProcessMs', () => reader({ url, accessToken, allowLocal, marker, expectedId: createdId, expectedText: text }));
    if (python.exactSyntheticMatch !== true) throw new Error();
    receipt.checks.pythonExactRecall = true; receipt.runtimes.python = python.pythonVersion;
    Object.assign(receipt.timings, python.timings);
  } catch {
    receipt.failures.push(stage);
    // A lost write response must never lead to guessing/deleting search results.
    if (stage === 'synthetic_save' && createdId === undefined) receipt.cleanup.uncertainSaveMarker = marker;
  } finally {
    if (createdId !== undefined) {
      receipt.cleanup.attempted = true;
      try {
        const deleted = await measure('nodeForgetMs', () => client.call('forget', { id: createdId }));
        if (deleted.ok !== true || deleted.forgot !== createdId) throw new Error();
        receipt.checks.deleteAcknowledged = true;
      } catch { receipt.failures.push('delete_confirmation'); receipt.cleanup.unconfirmedMemoryId = createdId; }
      if (receipt.checks.deleteAcknowledged) {
        try {
          const after = await measure('nodeRecallAfterDeleteMs', () => client.recall(marker, 8));
          if (!Array.isArray(after.results) || after.results.some(memory => memory.id === createdId)) throw new Error();
          receipt.checks.absentFromSubsequentBoundedRecall = true; receipt.cleanup.confirmed = true;
        } catch { receipt.failures.push('bounded_deletion_check'); receipt.cleanup.unconfirmedMemoryId = createdId; }
      }
    }
  }
  receipt.timings.workflowMs = round(performance.now() - started);
  receipt.ok = Object.values(receipt.checks).every(Boolean) && receipt.failures.length === 0;
  receipt.finishedAt = new Date().toISOString();
  return receipt;
}

export function parseArguments(args) {
  const input = [...args]; let receiptPath;
  const index = input.indexOf('--receipt');
  if (index >= 0) { receiptPath = input[index + 1]; if (!receiptPath || !isAbsolute(receiptPath)) throw new Error('Receipt path must be absolute.'); input.splice(index, 2); }
  const live = input.length === 1 && input[0] === '--live-synthetic';
  const fixture = input.length === 2 && input[0] === '--fixture';
  if (!live && !fixture) throw new Error('Usage: node shared_memory_demo.mjs --live-synthetic [--receipt /absolute/new.json]\n       node shared_memory_demo.mjs --fixture http://127.0.0.1:PORT/stem [--receipt /absolute/new.json]');
  const url = live ? RESOURCE : input[1];
  const target = endpoint(url, { allowLocal: fixture });
  if (fixture && (target.protocol !== 'http:' || target.hostname !== '127.0.0.1')) throw new Error('Fixture mode accepts only an explicit HTTP 127.0.0.1 endpoint.');
  return { live, fixture, url, receiptPath };
}

export async function main(args) {
  let options;
  try { options = parseArguments(args); } catch (error) { console.error(error.message); return 2; }
  let grant; let client; let receipt;
  try {
    const hashes = {};
    for (const name of SOURCE_FILES) hashes[name] = createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex');
    const authorizationStarted = performance.now();
    if (options.live) grant = await authorize({ timeoutMs: 600_000, onAuthorizationUrl: async authUrl => {
      console.log('Open this URL in your browser. Confirm the dedicated synthetic STEM account and select manual saving. This run saves one synthetic note, shares its token privately with a local Python child, deletes only that note, and attempts revocation.');
      console.log(authUrl);
    } });
    const authorizationMs = options.live ? round(performance.now() - authorizationStarted) : null;
    client = new StemClient({ url: options.url, accessToken: grant?.accessToken, allowLocal: options.fixture });
    receipt = await sharedMemoryWorkflow(client, { url: options.url, accessToken: grant?.accessToken ?? null, allowLocal: options.fixture });
    receipt.evidence = options.live ? 'live-authorized-synthetic-workflow' : 'local-transport-fixture-only';
    receipt.authorizationMs = authorizationMs;
    receipt.sourceSha256 = hashes;
  } catch {
    receipt = { schemaVersion: 1, kind: 'node-to-python-shared-memory', ok: false, evidence: options.live ? 'live-attempt-not-verified' : 'local-fixture-attempt-not-verified', failures: ['authorization_or_demo_setup'], modelEvaluation: false, llmHostCompatibilityTest: false };
  } finally {
    client?.forgetToken();
    if (grant) { receipt.oauthRevocationAcknowledged = await grant.revoke(); receipt.registrationMayRemain = true; }
  }
  console.log(JSON.stringify(receipt));
  if (options.receiptPath) {
    try { await writeFile(options.receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch { console.error('Receipt was not written: path must be new and its parent directory must exist. The sanitized receipt is printed above.'); return 1; }
  }
  return receipt.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
