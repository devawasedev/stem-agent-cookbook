# STEM agent cookbook

Connect to `https://awase.dev/stem`, save a selected piece of context and retrieve it from another compatible assistant connected to the same STEM account. This directory is a standalone, dependency-free starting point for Node.js and Python clients. It contains no account credentials or production memories.

Public entry: [STEM developers](https://awase.dev/developers). Connection guide: [STEM cookbook](https://awase.dev/developers/cookbook). Product capability reference: [STEM for agents](https://awase.dev/agents).

## Run locally first

Requirements: Node.js **22+** and Python **3.9+**. No `npm install` or `pip install` is needed for the core examples. Unzip the download and enter `stem-agent-cookbook/`.

```sh
node --test test/*.test.mjs
```

The tests run a disposable server bound to `127.0.0.1` on a random port. They exercise both languages, synthetic OAuth PKCE/DCR, cleanup, credential redaction, redirect refusal, and scorer arithmetic. They do not contact an AI provider or your STEM account. The source-catalog parity test runs in the STEM repository and skips in the standalone archive because the production source is not bundled.

For a visible walkthrough, start the fixture in one terminal:

```sh
node fixture-server.mjs
```

Copy the printed URL into a second terminal (replace `PORT`):

```sh
node smoke.mjs --fixture http://127.0.0.1:PORT/stem
python3 smoke.py --fixture http://127.0.0.1:PORT/stem
```

Each example saves one uniquely marked synthetic note, recalls that exact note, inspects the graph, and deletes only the numeric ID returned by its own save. It then checks that the ID does not appear in another bounded recall. It never deletes IDs merely found by a search. Stop the fixture with Ctrl-C; its in-memory data disappears.

The fixture approximates the public wire shapes; its exact-substring search, simple graph and automatic OAuth grant are **not** STEM production retrieval, authentication, account isolation, consent enforcement, TLS or provider compatibility tests. All data is synthetic. Do not expose this fixture to a network or use it as a backend.

## Reproduce a Node-to-Python shared-memory demo

[`DEMO.md`](./DEMO.md) walks through one Node save followed by an exact recall from a fresh Python MCP session, with exact-ID cleanup and a sanitized timing receipt. Both clients use one user-authorized OAuth grant. This demonstrates two language clients sharing saved context, not two independently authorized LLM hosts.

```sh
node shared_memory_demo.mjs --fixture http://127.0.0.1:PORT/stem
# Only after choosing a dedicated synthetic account:
node shared_memory_demo.mjs --live-synthetic --receipt /absolute/path/to/new-receipt.json
```

The child receives credentials over stdin rather than command arguments, files or environment variables. Receipt fields distinguish local fixtures, live attempts, confirmed retrieval and cleanup. The [October 25 live result](./DEMO.md#observed-live-result--october-25-2026) includes a sanitized receipt with actual timings and exact-source hashes; it is a developer-client run, not an LLM-host test or screen recording.

## Explicit live synthetic smoke

Only run this when you intend to authorize a real test connection. Prefer a dedicated STEM account containing synthetic data. These commands create an OAuth client registration, ask you to sign in in your browser, save one synthetic memory to that account, remove that exact memory, and attempt token revocation:

```sh
node smoke.mjs --live-synthetic
# Or use Python instead, not both unless you want two registrations:
python3 smoke.py --live-synthetic
```

Select **manual saving** for this connection in the first-party authorization screen. The examples request only `stem`, and they never call `remember_automatically` or change memory settings. They do not reuse existing browser tokens, account keys, environment secrets or connector credentials. A normal browser sign-in is still needed. The authorization URL printed by the CLI contains a public client ID, state and PKCE challenge; it never contains a token, code verifier or authorization code. Callback logging is disabled. Tokens stay in process memory, are sent only in the Authorization header to the configured resource, and are never saved or printed. Revocation attempts cover the returned access/refresh tokens. A registered OAuth client may remain visible after the smoke; manage that specific test connection in STEM settings if desired.

Failures are not silently retried: `remember` and `link` can duplicate writes. If a response is lost before a new ID is known, the client cannot safely infer what to delete; inspect the uniquely marked synthetic note yourself. If a known-ID cleanup fails, the CLI reports that ID. A deletion acknowledgment plus absence in bounded recall is useful evidence, not an account-wide erasure audit. The graph is also bounded, so a missing graph node is reported rather than treated as proof of data loss. The examples do not log recalled text, but using a personal account may expose other ranked candidate memories to the client process. Use a clean test account to avoid that exposure.

## How authorization works

`oauth.mjs` and `oauth_client.py` discover STEM's protected-resource metadata at `/.well-known/oauth-protected-resource/stem`, verify the exact resource, and pin the authorization server and its endpoints to the resource's origin. They require public-client authentication and S256 PKCE, register a loopback callback using DCR, generate fresh state/verifier values, validate state (and issuer when returned), and exchange the one-use code with the same redirect URI and `resource=https://awase.dev/stem`. The client rejects unexpected granted scopes. TLS validation remains enabled; redirects are refused for metadata/token/MCP requests so credentials cannot follow another origin.

This is a deliberately STEM-specific tutorial, not a generic discovery library. It uses the supported legacy `2025-06-18` JSON-response Streamable HTTP subset and does not implement SSE subscriptions, refresh rotation, pagination, the `2026-07-28` request model, CIMD, or every OAuth provider. It rejects an unsupported negotiated protocol rather than pretending to support it. A server's `structuredContent` is used when present, with JSON text fallback. For a full application use a maintained MCP SDK, preserve per-user token boundaries, and test your host/version. DCR remains a backward-compatibility mechanism in the [current MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization); a production client should use CIMD when both sides support it. [Legacy authorization requirements](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) explain the PKCE, discovery and resource parameters used here.

Python requests identify the actual cookbook and Python runtime with a `stem-agent-cookbook/1.0.0 Python/...` User-Agent. They do not impersonate a browser or search crawler. A blocked or challenged request still fails; the client does not disable TLS, rotate identities, solve challenges or change server protections.

## Actual core tools

`fixtures/tool-catalog.json` is a checked snapshot of STEM's five core tool definitions. Fetch `tools/list` on your actual connection to discover its current catalog. Some connections additionally expose consent-gated tools; their availability is not assumed by the smoke.

| Tool | Example arguments | What matters |
|---|---|---|
| `remember` | `{"text":"Selected context","source":"notes","type":"note","autolink":false}` | Explicit save; returns numeric ID; repeated calls create duplicates. |
| `recall` | `{"query":"Project Lantern","limit":8}` | Ranked, bounded candidates; inspect relevance; does not read unsaved chats. |
| `graph` | `{"limit":1000}` | Short labels and display IDs such as `m12`; not full text or total account inventory. |
| `link` | `{"from":12,"to":11,"type":"builds_on"}` | Numeric IDs from this account; creates a relationship between memories, not assistant accounts. |
| `forget` | `{"id":12}` | Destructive; delete only the item the user identified; no undo. |

An origin label such as `claude` or `chatgpt` is metadata, not authorization to fetch that provider's chat history. Selected context must be supplied by the user or already saved in STEM. Connecting the same account in two supported hosts enables shared saved context; it does not give STEM universal transcript access. Host confirmation requirements and explicit no-save instructions still apply.

## Framework recipes and evaluations

`recipes/README.md` supplies small FastMCP and LangChain recipes based on current official documentation. They are optional integrations with their own dependencies; they are not included in the dependency-free runtime claim. No provider calls or framework compatibility scores are reported from merely reviewing their code.

`evals/golden-prompts.json` defines 16 synthetic direct, indirect, negative and consent tasks. `evals/evaluate.mjs` grades supplied recorded results, with separate tool-selection precision/recall, incorrect saves, selected-memory retrieval, latency and token fields. Missing measurements stay missing. See `evals/README.md` for the data contract, fixture-ID mapping and limitations.

```sh
node evals/evaluate.mjs /path/to/synthetic-recorded-results.json
node record_baseline.mjs
```

`evals/baseline.json` contains only the measured local deterministic test summary, source hashes and explicit null model metrics. The scorer's hand-authored arithmetic tests are not a model benchmark. A live OAuth smoke is still not an LLM tool-selection evaluation. Publish model/provider/harness versions, coverage, repeated trials and observed outcomes with any future model result.

## Rebuild the download

```sh
python3 build_archive.py
# Optional explicit output path:
python3 build_archive.py --output /absolute/output/stem-agent-cookbook.zip
```

The builder uses a fixed file allowlist, rejects symlink inputs and normalizes ZIP metadata. It includes a `SHA256SUMS` manifest and prints the ZIP SHA-256. It excludes tokens, environment files, local result recordings, Python caches, dependency folders and generated archives. Default output is `dist/stem-agent-cookbook.zip`; archive bytes are reproducible for the same source files and compression implementation. The output archive is a distribution artifact, not a credential store.

## License scope

The example code and documentation in this cookbook are available under the [MIT License](./LICENSE), copyright 2026 Awase LLC. This license applies only to the cookbook directory and its distributed copies. It does not license STEM's backend, account data, hosted service, branding or other repository directories. Service access remains subject to its published terms and each user's authorization.
