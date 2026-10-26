import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from '../fixture-server.mjs';
import { StemClient } from '../stem-client.mjs';
import { authorize } from '../oauth.mjs';
import { readWithPython, sharedMemoryWorkflow, parseArguments } from '../shared_memory_demo.mjs';
const execute = promisify(execFile);
const cwd = fileURLToPath(new URL('..', import.meta.url));

test('Node saves and a separate Python process recalls; only the created note is removed', async () => {
  const fixture = await startFixture(); let grant;
  try {
    grant = await authorize({ resource: fixture.url, allowLocal: true, onAuthorizationUrl: async url => { await (await fetch(url)).text(); } });
    const client = new StemClient({ url: fixture.url, allowLocal: true, accessToken: grant.accessToken });
    await client.call('remember', { text: 'Pre-existing synthetic note retained', source: 'notes' });
    const receipt = await sharedMemoryWorkflow(client, { url: fixture.url, accessToken: grant.accessToken, allowLocal: true });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.checks.pythonExactRecall, true);
    assert.equal(receipt.cleanup.confirmed, true);
    assert.equal(receipt.independentlyAuthorizedClients, false);
    assert.equal(receipt.llmHostCompatibilityTest, false);
    assert.equal(receipt.modelEvaluation, false);
    assert.equal(fixture.memoryCount(), 1);
    assert.match(receipt.runtimes.python, /^3\./);
    for (const value of Object.values(receipt.timings)) assert.ok(Number.isFinite(value) && value >= 0);
    assert.ok(!JSON.stringify(receipt).includes(grant.accessToken));
    assert.ok(!JSON.stringify(receipt).includes('Pre-existing synthetic note retained'));
    client.forgetToken();
  } finally { if (grant) await grant.revoke(); await fixture.close(); }
});

test('Python failure still deletes only the exact ID from remember and suppresses raw diagnostics', async () => {
  const fixture = await startFixture();
  try {
    const client = new StemClient({ url: fixture.url, allowLocal: true });
    await client.call('remember', { text: 'Keep this other synthetic note', source: 'notes' });
    const receipt = await sharedMemoryWorkflow(client, { url: fixture.url, allowLocal: true, reader: async () => { throw new Error('secret-token-and-recalled-text'); } });
    assert.equal(receipt.ok, false);
    assert.equal(receipt.cleanup.confirmed, true);
    assert.deepEqual(receipt.failures, ['python_recall']);
    assert.equal(fixture.memoryCount(), 1);
    assert.ok(!JSON.stringify(receipt).includes('secret-token-and-recalled-text'));
  } finally { await fixture.close(); }
});

test('An uncertain save is never retried and no cleanup ID is inferred from search', async () => {
  const calls = [];
  const client = { initialize: async () => {}, tools: async () => ['remember', 'recall', 'forget'].map(name => ({ name })), call: async name => { calls.push(name); throw new Error('lost response'); } };
  const receipt = await sharedMemoryWorkflow(client, { marker: 'stem-shared-demo-uncertain-write' });
  assert.equal(receipt.ok, false);
  assert.deepEqual(calls, ['remember']);
  assert.equal(receipt.cleanup.attempted, false);
  assert.equal(receipt.cleanup.uncertainSaveMarker, 'stem-shared-demo-uncertain-write');
  assert.deepEqual(receipt.failures, ['synthetic_save']);
});

test('Failed deletion reports only the exact created ID and is not replaced by a success claim', async () => {
  const calls = [];
  const client = { initialize: async () => {}, tools: async () => ['remember', 'recall', 'forget'].map(name => ({ name })), call: async (name, args) => { calls.push({ name, args }); if (name === 'remember') return { ok: true, id: 7 }; throw new Error('raw private server error'); } };
  const reader = async () => ({ exactSyntheticMatch: true, pythonVersion: '3.11.0', timings: { pythonInitializeMs: 1, pythonRecallMs: 2 } });
  const receipt = await sharedMemoryWorkflow(client, { reader });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.cleanup.unconfirmedMemoryId, 7);
  assert.equal(receipt.cleanup.confirmed, false);
  assert.deepEqual(calls.filter(call => call.name === 'forget'), [{ name: 'forget', args: { id: 7 } }]);
  assert.deepEqual(receipt.failures, ['delete_confirmation']);
});

test('Python child rejects invalid data without printing supplied credentials or text', async () => {
  await assert.rejects(readWithPython({ url: 'https://invalid.example/stem', accessToken: 'private-synthetic-token', allowLocal: false, marker: 'stem-shared-demo-safe', expectedId: 3, expectedText: 'private-synthetic-text' }), error => error.message === 'python_reader_failed');
});

test('Fixture CLI writes a sanitized new receipt and refuses overwriting an existing file', async () => {
  const fixture = await startFixture(); const temp = await mkdtemp(join(tmpdir(), 'stem-shared-demo-'));
  try {
    const path = join(temp, 'receipt.json');
    const result = await execute('node', ['shared_memory_demo.mjs', '--fixture', fixture.url, '--receipt', path], { cwd });
    assert.equal(result.stderr, '');
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.ok, true); assert.equal(receipt.evidence, 'local-transport-fixture-only');
    assert.equal(receipt.authorizationMs, null);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), receipt);
    assert.equal(Object.keys(receipt.sourceSha256).length, 5);
    const before = await readFile(path);
    await assert.rejects(execute('node', ['shared_memory_demo.mjs', '--fixture', fixture.url, '--receipt', path], { cwd }), error => error.stderr.includes('Receipt was not written'));
    assert.deepEqual(await readFile(path), before);
    assert.equal(fixture.memoryCount(), 0);
  } finally { await fixture.close(); await rm(temp, { recursive: true, force: true }); }
});

test('Demo CLI requires an explicit mode and cannot aim fixture mode at production', () => {
  assert.throws(() => parseArguments([]), /Usage/);
  assert.throws(() => parseArguments(['--fixture', 'https://awase.dev/stem']), /Fixture mode accepts only/);
  assert.throws(() => parseArguments(['--live-synthetic', '--receipt', 'relative.json']), /absolute/);
  assert.equal(parseArguments(['--live-synthetic']).url, 'https://awase.dev/stem');
});
