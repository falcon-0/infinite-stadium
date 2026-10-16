# Deployment handover

October 14, 2026. This is an executable preparation guide, not a completed deployment. The current local app uses Node.js; Docker's Linux daemon is unavailable on the development computer. No hosting resource or billing upgrade has been created by this pass.

## Decide what judges will receive

The downloadable source archive runs the synthetic replay, deterministic context, Studio and recorded recaps without accounts or model inference. Open Watch conversation requires the configured Azure model. A replay-only build must not be represented as a working AI demonstration.

For the hosted experience, secure a service that runs a persistent Node process and supports streaming responses. Static-only hosting cannot run this application's SSE and AI server. Confirm zero-cash operation and model access for the judging period before selecting a service; an expiring trial is insufficient evidence of continuity. Do not transfer keys from someone else's account as a substitute for a deployment plan.

## Runtime configuration

| Setting | Requirement |
| --- | --- |
| HOST | `0.0.0.0` for hosted/container binding |
| PORT | Host-assigned port, or 8080 in the container |
| PUBLIC_ORIGIN | Actual HTTPS origin, without path/query |
| APP_ACCESS_TOKEN | Private random value of at least 32 characters; supply through host secrets |
| AZURE_OPENAI_ENDPOINT / DEPLOYMENT / API_KEY | Server secrets for the authorized deployment |
| MAX_DAILY_MODEL_CALLS | Development limit currently 900, with the existing ledger preserved; normal questions use two or three calls; one optional correction cycle can bring the maximum to five. Set an appropriate approved allowance for the deployed resource. |
| MODEL_BUDGET_FILE | `/app/.runtime/azure-model-budget.json` in Docker, backed by writable persistent storage |

Use one server instance: the persistent ledger is not a distributed global quota. Preserve it through restarts and redeployment. Do not publish `.env.azure`, runtime files, access codes or provider credentials. TLS comes from the host/reverse proxy. Public binding deliberately refuses missing access control or an invalid HTTPS origin.

## Pre-deployment validation

1. Run `npm run verify:release` and inspect every stage's exit code.
2. For a container host, build the included Dockerfile when a working Docker daemon is available: `docker build -t infinite-stadium:release .`.
3. Follow the local Docker check in JUDGE_SETUP.md using a disposable access token and no model credentials. Confirm non-root execution, frontend modules, SSE completion and access enforcement. This step is still unverified.
4. Put the image on the selected container host, mount the persistent runtime directory writable by the `node` user, and configure the secrets above. Set the actual public origin before startup.
5. Open the real HTTPS deployment in a clean browser. Authenticate using the judge access flow. Verify the match list, two distinct fixtures, score, statistics, mobile layout, recap and Studio correction handling.
6. Within the approved budget, ask a scorer/count question and a follow-up while playback advances. Check the pinned timestamp, no future evidence, requested language and honest missing-data response.
7. Restart only the deployed instance. Confirm the usage reservations persist. Check access enforcement again. Never reset the ledger as a verification shortcut.
8. Record the public URL, release commit, deployment date, availability owner and tested browser in SUBMISSION.md. Put private judge access instructions only in the organizer's designated private field.

## Direct Node hosting alternative

Docker is optional. A host supporting Node.js 24 can run `node server.js` from the release source, with the same environment settings, HTTPS origin and access controls above. Mount the project's `.runtime` directory on the host's persistent writable disk. Set `MODEL_BUDGET_FILE` to a safe JSON filename inside that directory; the server deliberately rejects arbitrary paths outside it. Run a single instance. Do not place `.env.azure` in the public source or deploy the development ledger as a fresh allowance.

Use the same acceptance checks for direct Node hosting; a working local process does not establish public hosting or judging-period availability.

## Operational acceptance

- HTTPS loads and the access flow succeeds from a separate browser.
- SSE is not buffered into a single response by the host.
- Model failures show a concise availability message; no scripted answer masquerades as AI.
- Remaining allowance supports a complete question before inference starts.
- Corrections invalidate affected explanations and producer approvals.
- The source ZIP has no secrets and still launches independently.
- The host/model access remains available for the required judging window, with no unapproved cash charges.

Use artifacts/release/report.json for local proof. Neither that report nor a successful model request proves any of the hosted acceptance checks above.

## Judging-period availability decision (checked October 14)

The organizer's rules require free working-project access until November 10, 2026, 11:59 PM Pacific Time, and permit a website, functioning demo, or test build. They also say judges may assess the submitted description and video without testing. A video does not remove the access obligation. See sections 1, 4.3 and 4.8 of the [official rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md).

Unused trial credit does not extend an Azure account's trial period: Microsoft says the subscription and services are disabled when its credit is exhausted or expires after 30 days. The account's actual expiry has not been independently checked in its billing portal. No pay-as-you-go upgrade is authorized. See [Microsoft's free-account guidance](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/avoid-charges-free-account).

The practical zero-cash contingency is a separately authorized resource whose owner is eligible for Microsoft's offer and whose granted trial covers the whole judging period. For example, an eligible offer activated on October 20 would have its nominal 30-day window extending beyond November 10; Microsoft must actually grant the offer and the owner must verify its expiry, model availability and spending protection. Keep the account under its owner's control and use appropriate project access rather than sharing account passwords. Configure this application's server-side endpoint, deployment and key through private host settings, preserving the existing usage ledger. The owner confirmed on October 14 that the friend's authorized trial is not active yet. No such contingency resource is currently configured or verified.

Before claiming continuity, verify the real expiry and resource owner, run the same scoring/correction/conversation smoke tests against that deployed model, test HTTPS access in a separate browser session, and record the actual public link and final availability check. The source archive remains a reproducible recorded experience without credentials; it does not by itself provide live AI. Experimental local inference has not passed the full conversation workload and is not a verified replacement. These are outstanding delivery dependencies, not completed infrastructure.

## October 14 continuity research

Keep Azure as the judged inference path. The authorized friend's eligible trial is the leading conditional bridge: an October 20 activation would nominally extend its 30-day window to November 19, beyond November 10 judging. Actual eligibility, activation, expiry, model deployment, quota and remaining credit must be checked on that resource; it is not active or secured now. The owner has said the student offer is unavailable, so it is not the current plan. See [Azure's account terms](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account) and [credit-expiry guidance](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/avoid-charges-free-account).

A new GitHub Models adapter would not solve expiry: [GitHub's current documentation](https://docs.github.com/en/github-models) confirms retirement for all customers on July 30, 2026. Foundry Local can avoid hosted inference charges, but the existing local Studio path has not demonstrated equivalent open Watch answers or latency; [Microsoft's description](https://learn.microsoft.com/en-us/azure/foundry-local/what-is-foundry-local) is not evidence that our application works with it.

Other free providers are not verified replacements. [Groq's published free GPT-OSS limits](https://console.groq.com/docs/rate-limits) include 8,000 tokens per minute and 200,000 per day, while a current stage commonly sends 8–12k input tokens before its output. Gemini has a long context and schema support, but quotas are project-specific and [its terms](https://ai.google.dev/gemini-api/terms) impose paid-service conditions for applications available to UK/EEA/Swiss users. Neither has been configured, evaluated or promised to judges. There is no verified zero-cash hosted substitute available to this project today.
