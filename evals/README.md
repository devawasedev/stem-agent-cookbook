# Evaluate STEM tool use

`golden-prompts.json` contains 16 synthetic direct, indirect, negative and consent cases. It is a **test specification**, not a benchmark result. Do not include expected tool names or answer IDs in the evaluated model's prompt. The optional-tool cases explicitly identify their environment; expose only the core five tools in the other cases. Supply tools from the catalog snapshot, keep test accounts isolated, and seed the synthetic fixture IDs before execution. A real MCP server will assign different IDs: maintain a local fixture-ID mapping before grading.

Use fresh conversations for each case, multiple trials, and a held-out extension of these cases. A useful blind run gives the model only the user prompt, relevant setup, actual tool schemas and simulated/live synthetic tool responses. Preserve host confirmations and no-save instructions. Never use production memories, tokens or private transcripts as fixtures. Compare versions using the same model, harness, seeds and prompts; different hosts can select tools differently.

The scorer performs no model/network calls. Feed it recorded traces from your chosen harness:

```sh
node evals/evaluate.mjs /path/to/synthetic-recorded-results.json
```

Record format (illustrative shape; the numbers below are placeholders, not a measured run):

```json
{
  "run": {"kind": "recorded-model", "provider": "YOUR_PROVIDER", "model": "EXACT_MODEL_VERSION", "capturedAt": "ISO_TIMESTAMP", "harness": "YOUR_HARNESS_VERSION"},
  "results": [{"caseId": "direct-recall", "trialId": "1", "toolCalls": [{"name": "recall", "ok": true}], "selectedMemoryIds": [101]}]
}
```

Add `latencyMs` and `tokens: {"input": INTEGER, "output": INTEGER}` only when measured. Missing fields stay unmeasured (`null` in aggregates). `toolCalls[].ok` means the observed tool execution outcome, not whether the model chose well. `selectedMemoryIds` are memories the model selected as relevant evidence, not every weak candidate the search returned. Unknown IDs count as false positives. `[]` is a measured no-match decision; omitting the field means no retrieval measurement. No-match accuracy is reported separately because an empty set has undefined precision/recall.

Tool-selection precision counts allowed unique names / all selected unique names per trial. Recall counts required names selected / required names. Optional allowed calls cannot increase recall above one. Repeated write attempts are counted individually in `incorrectSaveAttempts`; only recorded `ok:true` writes contribute to confirmed incorrect saves, and unknown write outcomes are explicit. These metrics do not judge prose quality, argument correctness, security isolation or real-world usefulness; audit those separately. Coverage and missing cases are always shown. A low-coverage score must not be presented as the full-suite result.

`baseline.json` reports only real local client/fixture checks performed by this cookbook's tests. It contains no LLM selection accuracy, provider OAuth verification or deployed-server claim. The test suite uses hand-authored traces solely to validate the scorer's arithmetic, including bad saves and missing measurements; those are not model outputs.

Methodology: [Anthropic tool evaluations](https://www.anthropic.com/research/writing-tools-for-agents) recommends realistic tasks with verifiable outcomes and measuring errors, time and tokens. [Agent evaluation guidance](https://www.anthropic.com/research/demystifying-evals-for-ai-agents) explains repeated trials and separating observed outcomes from a model's claims. This cookbook supplies a small starting suite, not a representative industry benchmark.
