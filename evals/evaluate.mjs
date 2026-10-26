import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export const suite = JSON.parse(await readFile(new URL('./golden-prompts.json', import.meta.url), 'utf8'));
const saving = new Set(['remember', 'remember_automatically']);
const divide = (a, b) => b ? Number((a / b).toFixed(6)) : null;
const percentile = (values, percentile) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * percentile) - 1)] : null;

/** Recorded traces are supplied by the caller. This grader makes no model calls and fabricates no results. */
export function evaluate(recording, golden = suite) {
  if (!recording || !['recorded-model', 'deterministic-test'].includes(recording.run?.kind) || !Array.isArray(recording.results)) throw new Error('Supply {run:{kind:"recorded-model"|"deterministic-test",...},results:[...]}.');
  if (recording.run.kind === 'recorded-model' && (!recording.run.model || !recording.run.provider || !recording.run.capturedAt)) throw new Error('Recorded model results require provider, model and capturedAt provenance.');
  const cases = new Map(golden.cases.map(item => [item.id, item])); const seen = new Set(); const covered = new Set();
  let allowedSelections = 0, selections = 0, requiredFound = 0, requiredTotal = 0, incorrectSaveAttempts = 0, incorrectSavesConfirmed = 0, saveOutcomesUnknown = 0, toolErrors = 0;
  let retrievalTP = 0, retrievalFP = 0, retrievalFN = 0, retrievalSamples = 0, retrievalMissing = 0, emptyMatchCases = 0, emptyMatchCorrect = 0;
  const latency = [], inputTokens = [], outputTokens = [], details = [];
  for (const record of recording.results) {
    const testCase = cases.get(record.caseId); const trialId = record.trialId ?? '1'; const key = `${record.caseId}:${trialId}`;
    if (!testCase || seen.has(key) || typeof trialId !== 'string' || !trialId) throw new Error('Unknown case ID or duplicate/invalid trial.');
    if (!Array.isArray(record.toolCalls) || record.toolCalls.some(call => !call || typeof call.name !== 'string' || !call.name || (call.ok !== undefined && typeof call.ok !== 'boolean'))) throw new Error('Each trace needs toolCalls:[{name,ok?}].');
    seen.add(key); covered.add(record.caseId);
    const names = new Set(record.toolCalls.map(call => call.name));
    const unexpected = [...names].filter(name => !testCase.allowedTools.includes(name));
    const missing = testCase.requiredTools.filter(name => !names.has(name));
    selections += names.size; allowedSelections += names.size - unexpected.length;
    requiredTotal += testCase.requiredTools.length; requiredFound += testCase.requiredTools.length - missing.length;
    for (const call of record.toolCalls) {
      if (call.ok === false) toolErrors++;
      if (saving.has(call.name) && (!testCase.saveAllowed || !testCase.allowedTools.includes(call.name))) {
        incorrectSaveAttempts++;
        if (call.ok === true) incorrectSavesConfirmed++;
        if (call.ok === undefined) saveOutcomesUnknown++;
      }
    }
    if (testCase.expectedMemoryIds !== undefined) {
      if (record.selectedMemoryIds === undefined) retrievalMissing++;
      else {
        if (!Array.isArray(record.selectedMemoryIds) || record.selectedMemoryIds.some(id => !Number.isSafeInteger(id))) throw new Error('selectedMemoryIds must contain numeric memory IDs used as relevant answer evidence.');
        const selected = new Set(record.selectedMemoryIds), expected = new Set(testCase.expectedMemoryIds);
        retrievalSamples++;
        for (const id of selected) { if (expected.has(id)) retrievalTP++; else retrievalFP++; }
        for (const id of expected) if (!selected.has(id)) retrievalFN++;
        if (!expected.size) { emptyMatchCases++; if (!selected.size) emptyMatchCorrect++; }
      }
    }
    for (const [value, collector, name] of [[record.latencyMs, latency, 'latencyMs'], [record.tokens?.input, inputTokens, 'tokens.input'], [record.tokens?.output, outputTokens, 'tokens.output']]) {
      if (value !== undefined) {
        if (!Number.isFinite(value) || value < 0 || name.startsWith('tokens') && !Number.isInteger(value)) throw new Error(`Invalid ${name}. Missing measurements must be omitted, not guessed.`);
        collector.push(value);
      }
    }
    details.push({ caseId: record.caseId, trialId, category: testCase.category, unexpectedTools: unexpected, missingTools: missing });
  }
  return {
    schemaVersion: 1, suite: golden.suite, provenance: recording.run,
    interpretation: recording.run.kind === 'recorded-model' ? 'Scores of supplied model traces; provenance is caller-reported, not independently verified.' : 'Deterministic grader test only; not model performance.',
    coverage: { cases: covered.size, totalCases: cases.size, trials: seen.size, missingCases: [...cases.keys()].filter(id => !covered.has(id)) },
    toolSelection: { precision: divide(allowedSelections, selections), recall: divide(requiredFound, requiredTotal), allowedSelections, totalSelections: selections, requiredFound, requiredTotal, unit: 'unique tool name per trial' },
    saving: { incorrectSaveAttempts, incorrectSavesConfirmed, saveOutcomesUnknown },
    retrieval: { precision: divide(retrievalTP, retrievalTP + retrievalFP), recall: divide(retrievalTP, retrievalTP + retrievalFN), truePositives: retrievalTP, falsePositives: retrievalFP, falseNegatives: retrievalFN, measuredTrials: retrievalSamples, missingTrials: retrievalMissing, emptyMatchAccuracy: divide(emptyMatchCorrect, emptyMatchCases), meaning: 'Selected relevant memory IDs, not all ranked candidates returned by recall.' },
    reliability: { toolErrors },
    latency: { measuredTrials: latency.length, medianMs: percentile(latency, .5), p95Ms: percentile(latency, .95) },
    tokens: { inputMeasuredTrials: inputTokens.length, outputMeasuredTrials: outputTokens.length, inputTotal: inputTokens.length ? inputTokens.reduce((a, b) => a + b, 0) : null, outputTotal: outputTokens.length ? outputTokens.reduce((a, b) => a + b, 0) : null },
    details
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) { console.error('Usage: node evals/evaluate.mjs path/to/synthetic-recorded-results.json'); process.exitCode = 2; }
  else {
    try { console.log(JSON.stringify(evaluate(JSON.parse(await readFile(process.argv[2], 'utf8'))), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
