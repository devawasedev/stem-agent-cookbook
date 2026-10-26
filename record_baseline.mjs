import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const execute = promisify(execFile);
const cwd = fileURLToPath(new URL('.', import.meta.url));
const tests = (await readdir(new URL('./test/', import.meta.url))).filter(name => name.endsWith('.test.mjs')).sort().map(name => `test/${name}`);
try {
  const { stdout } = await execute(process.execPath, ['--test', '--test-reporter=tap', ...tests], { cwd, maxBuffer: 2_000_000 });
  const count = name => Number(stdout.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? NaN);
  if (!Number.isInteger(count('tests')) || count('fail') !== 0 || count('cancelled') !== 0) throw new Error('A clean complete test summary is required.');
  const files = ['stem-client.mjs', 'oauth.mjs', 'stem_client.py', 'oauth_client.py', 'shared_memory_demo.mjs', 'shared_memory_reader.py', 'fixture-server.mjs', 'fixtures/tool-catalog.json', 'evals/golden-prompts.json', 'evals/evaluate.mjs', ...tests];
  const hashes = {};
  for (const name of files) hashes[name] = createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex');
  const python = (await execute('python3', ['--version'])).stdout.trim();
  const receipt = { kind: 'local-deterministic-test-baseline', recordedAt: new Date().toISOString(), status: 'passed', runtimes: { node: process.version, python }, tests: { total: count('tests'), passed: count('pass'), skipped: count('skipped'), failed: count('fail') }, evidence: ['Node synthetic save/recall/graph/delete against a disposable local fixture', 'Python synthetic save/recall/graph/delete against that fixture', 'Node and Python PKCE/DCR against an automatic synthetic OAuth fixture', 'Node save and separate Python-process exact recall with exact-ID cleanup on a local fixture', 'Client safety, uncertainty/redaction and evaluation scorer arithmetic checks'], limitations: ['Not a deployed STEM test', 'Not real provider OAuth or consent verification', 'No LLM calls or model performance measurement', 'Fixture search and graph are simplified'], modelEvaluation: null, providerOAuthVerification: null, sourceSha256: hashes };
  await writeFile(new URL('./evals/baseline.json', import.meta.url), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ status: receipt.status, tests: receipt.tests, evidence: receipt.kind }));
} catch { console.error('Local checks failed or could not run; baseline was not replaced. Run node --test test/*.test.mjs for diagnostics.'); process.exitCode = 1; }
