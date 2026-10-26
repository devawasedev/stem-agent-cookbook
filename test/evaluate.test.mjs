import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, suite } from '../evals/evaluate.mjs';
const run = { kind: 'deterministic-test', note: 'Hand-authored scorer arithmetic tests; never model results.' };

test('Golden cases cover direct, indirect, negative and consent behavior with unique IDs', () => {
  assert.equal(new Set(suite.cases.map(item => item.id)).size, suite.cases.length);
  assert.deepEqual(new Set(suite.cases.map(item => item.category)), new Set(['direct', 'indirect', 'negative', 'consent']));
  for (const item of suite.cases) assert.ok(item.requiredTools.every(name => item.allowedTools.includes(name)));
});

test('Scorer separates selection, retrieval, incorrect saves and missing measurements', () => {
  const report = evaluate({ run, results: [
    { caseId: 'direct-recall', toolCalls: [{ name: 'recall', ok: true }, { name: 'remember', ok: true }], selectedMemoryIds: [101, 102], latencyMs: 50, tokens: { input: 100, output: 20 } },
    { caseId: 'explicit-no-save', toolCalls: [{ name: 'remember' }, { name: 'remember', ok: false }] },
    { caseId: 'indirect-scheduling', toolCalls: [] }
  ] });
  assert.equal(report.toolSelection.precision, 1 / 3 === .333333 ? 1 / 3 : .333333);
  assert.equal(report.toolSelection.recall, .5);
  assert.deepEqual(report.saving, { incorrectSaveAttempts: 3, incorrectSavesConfirmed: 1, saveOutcomesUnknown: 1 });
  assert.equal(report.retrieval.precision, .5); assert.equal(report.retrieval.recall, 1); assert.equal(report.retrieval.missingTrials, 1);
  assert.equal(report.latency.measuredTrials, 1); assert.equal(report.tokens.inputTotal, 100); assert.equal(report.coverage.cases, 3);
});

test('Optional allowed tools cannot inflate recall and wrong automatic save is counted', () => {
  const report = evaluate({ run, results: [{ caseId: 'manual-explicit-save', toolCalls: [{ name: 'memory_status' }, { name: 'remember', ok: true }, { name: 'remember_automatically', ok: true }] }] });
  assert.equal(report.toolSelection.recall, 1); assert.equal(report.saving.incorrectSavesConfirmed, 1);
});

test('Empty/no-match evidence is distinct from missing measurements', () => {
  const report = evaluate({ run, results: [{ caseId: 'no-saved-match', toolCalls: [{ name: 'recall', ok: true }], selectedMemoryIds: [] }] });
  assert.equal(report.retrieval.emptyMatchAccuracy, 1); assert.equal(report.retrieval.precision, null); assert.equal(report.retrieval.recall, null); assert.equal(report.tokens.inputTotal, null); assert.equal(report.latency.p95Ms, null);
});

test('Invalid/duplicate cases and absent model provenance cannot silently inflate scores', () => {
  assert.throws(() => evaluate({ run: { kind: 'recorded-model' }, results: [] }), /provenance/);
  assert.throws(() => evaluate({ run, results: [{ caseId: 'unknown', toolCalls: [] }] }), /Unknown/);
  const result = { caseId: 'web-weather', toolCalls: [] };
  assert.throws(() => evaluate({ run, results: [result, result] }), /duplicate/);
  assert.throws(() => evaluate({ run, results: [{ ...result, latencyMs: -1 }] }), /Invalid/);
  assert.throws(() => evaluate({ run, results: [{ ...result, tokens: { input: 1.5 } }] }), /Invalid/);
});
