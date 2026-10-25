# Architecture and deployment

## Request path

Synthetic event and tracking messages carry event time, arrival time and revision identity. `match-stream.js` builds the received snapshot. Watch renders that snapshot and captures the displayed time when a question is sent.

`match-question-ai.js` uses Azure for semantic planning and a separate coverage/support review. Read-only `match-query.js` queries and typed `match-operation-proof.js` calculations produce source-bound facts. `question-evidence-check.js` checks subject, metric, time window and revision. Source-context requests can use the complete received roster rather than inventing an event query. Bounded repairs have a maximum of six model calls; there is no promise that every request can be answered.

Conversation state rejects stale fixture answers and future context after a rewind. Facts, general explanations and unsupported inferences have different evidence requirements. Confirmations and corrections must affect dependent answers without rewriting what was available earlier.

## Local configuration

Use Node.js24. Run `node server.js` for replay or `npm run start:azure` with a private `.env.azure`. The provided `.env.example` contains placeholders only. A compatible Azure deployment must support v1 Chat Completions. A model deployment is separate from website hosting.

Loopback is the default. Public server binding requires the access token, allowed HTTPS origin and durable budget settings documented in `.env.example`. HTTPS is provided by the hosting platform or reverse proxy. Never place keys in browser JavaScript, a URL, a repository or an archive.

## Vercel

`api/index.js` and `vercel-handler.js` adapt the Node server for Vercel. Configure Azure endpoint, deployment and key as server-only environment variables. Public access uses an opaque session and a separately supplied project code. Upstash Redis supplies shared access sessions and model-call reservations across serverless replicas. Use a persistent namespace and retain the existing usage ledger across redeployments.

The daily guard counts model-call reservations, not Azure dollars. A timeout, provider quota or expired subscription can still prevent an answer. Never reset the ledger to bypass the guard. No automatic paid upgrade is part of deployment.

Replay events negotiate gzip in `stream-transport.js` and flush each event immediately. Clients that do not accept gzip retain the same event data without compression. Selected hosted checks confirm smaller transfers and advancing playback; model generation and network conditions still determine total answer latency.

## Portable hosting

The Node server can run behind another HTTPS host. Docker is optional packaging, not a requirement for the product. The Docker image uses a non-root Node user; persistent local budget storage needs a writable mounted `.runtime` directory. A serverless host needs shared storage rather than an ephemeral disk ledger.

Optional local-provider adapters remain experimental and are not certified replacements for Azure judging access. A later account switch requires an authorized compatible deployment and fresh connection checks; changing a key alone does not establish equivalent model behavior or availability.

## Release checks

Build from an explicitly selected tested snapshot. Run all eight release gates and verify source, distribution, archive and extracted-package identities. After deployment check served assets, signed-out access, a successful authorized question, preference application and the model-unavailable state. Keep first failures separate from retunes.

The accepted Watch interface retains the Montserrat font. The readable source and multilingual clarification fixes were merged into the public repository after local release gates, hosted Azure checks and independent Linux, Windows and browser CI passed. A real browser check verifies that a delayed identity reply retains the original evidence timestamp while playback continues. These selected checks do not establish universal answer reliability or latency. The approved 118-second demo is uploaded and linked in the project description. The current Azure trial expires on November 4, before judging ends on November 10; an owner-managed account switch or paid continuation still needs verification. No account upgrade is automatic. Private deployment receipts and test captures stay outside the published source.
