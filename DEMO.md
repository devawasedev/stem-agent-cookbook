# One saved note, two MCP clients

This walkthrough saves one synthetic note using Node.js, starts a separate Python MCP client that retrieves the exact same note, then deletes only the memory ID returned by the save. A successful **live** receipt demonstrates shared saved context across these two language clients using one authorized STEM account and one OAuth grant. It does not establish Claude, ChatGPT, Cursor or another LLM host's compatibility, independent account authorization, model tool selection, bulk history import or agent-to-agent messaging.

## Observed live result — October 25, 2026

A live rerun from **2026-10-26 01:43:27 to 01:43:41 UTC** (October 25 in Pacific time) passed all six checks. Node saved the synthetic note; a fresh Python MCP session recalled its exact ID and full expected text. Node deleted that directly returned ID and confirmed its absence from a subsequent bounded recall. Access/refresh token revocation was acknowledged; the client registration may remain.

The [sanitized live receipt](./evals/live-shared-memory-20261025.json) records Node **22.23.1**, Python **3.9.6**, MCP **2025-06-18**, UTC timestamps and SHA-256 hashes for the actual five runtime source files. The workflow took **14.575 seconds**, excluding **112.457 seconds** spent in authorization. Within that one run, the Node save round trip was **2.098 seconds** and Python recall was **2.257 seconds**. These are observed single-run wall-clock durations, including network time, not a latency benchmark or service guarantee.

An earlier attempt reached the Node save but failed in Python; its exact-ID cleanup and revocation succeeded. Public no-token checks subsequently found default Python urllib requests rejected with HTTP403, while a truthful cookbook/Python product User-Agent reached metadata200 and expected anonymous MCP401. The successful rerun above used that product identification. No browser/crawler identity was used and no server protection was changed.

This is **a reproducible walkthrough plus a real live receipt**. No video or screen recording has been produced. Both language clients used one authorized OAuth grant in a synthetic account; no LLM host was part of this run.

## Start with the disposable local fixture

Requirements: Node.js 22+ and Python 3.9+. No packages need installing.

```sh
node fixture-server.mjs
```

In another terminal, replace `PORT` with the printed local port:

```sh
node shared_memory_demo.mjs --fixture http://127.0.0.1:PORT/stem
```

The output labels itself `local-transport-fixture-only`. A fixture success is never live service evidence. The fixture's automatic authorization and exact-substring retrieval are simplified test behavior.

## Run against STEM with an isolated test account

Use an account that contains only synthetic sample data, because ranked recall may return other candidate memories to the client process. Keep this terminal running until cleanup finishes.

```sh
node shared_memory_demo.mjs --live-synthetic \
  --receipt /absolute/path/to/new-stem-demo-receipt.json
```

The receipt's parent directory must already exist. The CLI refuses to overwrite an existing file and gives a new receipt owner-only file permissions. Omit `--receipt` to print the sanitized result without saving a file.

1. Open the authorization URL printed in the terminal. It contains a public client ID, OAuth state and PKCE challenge; it contains no access token, refresh token, authorization code or verifier.
2. On the first-party STEM page, confirm you are signing into the dedicated synthetic account. Choose manual saving for this test connection. If your personal account appears, switch accounts before approving.
3. Complete the email/sign-in and consent steps. Return through “Continue to your AI” to the local `127.0.0.1` callback. The callback displays “Authorization received. Return to your terminal.” The CLI allows up to ten minutes for sign-in.
4. Node opens an MCP session and saves one uniquely marked note: `Synthetic project Lantern chooses amber for its demo label.` It sets `autolink:false`.
5. A fresh Python process opens its own MCP session and recalls the marker. The child receives the token over a private stdin pipe. No token is placed in a command argument, environment variable, file or receipt. It compares both the saved ID and complete expected synthetic text in memory.
6. Node deletes exactly the ID it received from its save, then checks a subsequent bounded recall for that ID. It attempts revocation of the access and refresh tokens. The OAuth client registration may remain visible in STEM settings.

The script never calls `remember_automatically`, changes memory preferences or touches IDs obtained only from search. A Python failure still triggers known-ID cleanup. A lost save response cannot be safely cleaned up automatically: the receipt identifies the unique synthetic marker and does not guess an ID. An unconfirmed deletion reports only the exact created ID for follow-up. Never rerun an uncertain write just to get a green result.

## Read the evidence

An actual successful receipt has `ok:true`, all `checks` true, `cleanup.confirmed:true` and an `evidence` value of `live-authorized-synthetic-workflow`. `oauthRevocationAcknowledged` reports the separate revocation result; it does not prove removal of the client registration or refresh-token behavior in every host. The CLI prints no recalled text, account identity, token or server error body.

The receipt records UTC run times, actual Node/Python versions, the negotiated supported MCP protocol, source SHA-256 hashes, and single-run wall-clock timings for initialization, save, Python recall and cleanup. Authorization timing includes time spent by the person in the browser. These are observed round-trip durations, not service-only latency, a repeated benchmark, model token usage or a service-level guarantee. Python process time also includes process startup. Bounded recall absence plus a delete acknowledgment is a useful cleanup check, not an account-wide erasure audit.

The dated receipt bundled here comes from an actual successful live rerun; fixture output is never substituted for it. Publish a fresh sanitized receipt when demonstrating a different source version, retaining failed attempts and their resolution in the accompanying report.

## Recording a truthful short demonstration

Record the real terminal workflow after account verification, keeping the authorization screen and URL outside the shared recording. Show the command, the successful checks in the sanitized receipt, the measured timings and the deletion result. A short caption can say:

> In this recorded run, Node saved a synthetic project decision. A separate Python MCP session retrieved that exact saved note from the same STEM account. The script then deleted its own note and checked bounded recall. Both clients used one authorized OAuth grant. This is a live developer-client demonstration, not an LLM-host benchmark.

Use that caption only after an actual successful live run. Include the run date, source revision or hashes and the receipt. A replay or edited visualization of the receipt must be labeled as such; do not present it as a screen recording of an assistant.

For a separate Claude-to-ChatGPT demonstration, use two actual connected hosts on the same dedicated synthetic account. Obtain the save ID from the first host's real tool response, then verify exact saved context in a fresh second-host chat. Record the host/model versions, prompts, actual tool outputs with credentials redacted, any confirmation screens and cleanup of the exact saved ID. A model's assertion that it saved or recalled something is insufficient without the tool result. Report any unsuccessful host attempt instead of substituting a client fixture.
