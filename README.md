# Infinite Stadium

A football companion that answers questions about the moment you are watching while the match keeps moving.

[Open the demo](https://infinite-stadium-lime.vercel.app/?view=watch) · [Run locally](docs/JUDGE_SETUP.md) · [Developer guide](docs/CONTRIBUTING.md) · [Architecture and deployment](docs/DEPLOYMENT.md) · [Validation](docs/VALIDATION_PLAN.md)

## Watch, ask, understand

Choose a synthetic fixture and play it. Ask a question in your own words. The assistant captures the displayed match time, queries the evidence available at that time and answers beside the replay. Playback continues during the request. Moment links let you revisit the supporting action when you choose.

The application computes supported statistics and event order. Azure AI interprets the question, selects evidence and separately reviews whether the answer covers the request. Late confirmations and corrections change what is known; future information must not leak into earlier answers.

Twenty fixtures cover five authored two-minute passage families. The schematic replay runs at a fixed 2× pace with compact statistics, timed narratives and a recap. Viewing options change the audience detail and language of subsequent supported content. English, Spanish, French and Portuguese paths are implemented; menus and some general rules remain English. This is synthetic football data with fictional teams and players, not licensed Premier League footage or video recognition.

## Run locally

Use Node.js 24. No package installation or credentials are needed for the synthetic replay.

```sh
node server.js
```

Open http://127.0.0.1:4173/. The server reports AI unavailability until a provider is configured. It does not label recorded content as a live model answer.

For Azure conversation, copy the placeholder settings from `.env.example` to a private `.env.azure`, configure your own deployment and run:

```sh
npm run start:azure
```

Keep credentials server-side. See [deployment](docs/DEPLOYMENT.md) for public access protection, durable usage reservations and provider continuity.

## Verify

```sh
npm test
npm run validate:data
npm run verify:release
```

The release verifier also needs Python 3.9+ and runs without model calls. Browser checks use an explicitly configured Playwright installation; the CI browser job installs its pinned runtime. See [validation](docs/VALIDATION_PLAN.md) for exact scope and limitations.

## Source map

| Area | Main files |
| --- | --- |
| Synthetic data and received state | `comparison-fixture.js`, `match-stream.js`, `stream-state.js` |
| Watch experience | `stream-ui.js`, `pitch-renderer.js`, `match-chat-ui.js`, `fan-experience.css` |
| Conversation and source checks | `match-question-ai.js`, `match-query.js`, `question-evidence-check.js`, `match-operation-proof.js` |
| Time and follow-ups | `match-chat-state.js`, `source-sequence-proof.js`, `source-context-answer.js` |
| Narratives, recaps and languages | `narratives.js`, `recap-workflow.js`, `localization.js` |
| Hosting and access | `server.js`, `vercel-handler.js`, `access-sessions.js`, `persistent-budget.js` |
| Reproducible checks | `*.test.js`, `release-check.js`, `package_judge.py`, `verify_judge_package.py` |

Tests sit beside their modules. They are retained to make behavior reviewable. Optional local-provider experiments and legacy producer modules remain for reproducibility; they are not part of the submitted Watch journey. Installed models, agent configuration, raw provider traces, videos and build snapshots are excluded from Git and the source archive.

## Evidence and practical limits

The release passed all eight local gates: 1,331 tests passed, one platform skip and zero failures. Earlier development checks included ten selected successful Azure answers, with four hosted examples taking 3.283–5.266 seconds. These are selected development checks, not a representative accuracy benchmark or a latency guarantee. Later stress tests exposed incomplete answers, extra information, slow requests and local provider connection failures. The corrected French identity follow-up, Spanish turnover question, Portuguese foot lookup and attacking comparison passed their recorded regression checks. These tuned cases remain separate from a representative accuracy benchmark. The current build also passed protected hosted checks for both multilingual turnover questions and retains the current Watch layout. Server-side processing in those two checks took 8.1 and 11.0 seconds; other questions and network conditions vary. Private development traces are retained locally; the compact evidence record below summarizes the public claims and limitations.

See [the compact evidence record](docs/EVALUATION_EVIDENCE.json) and [research](docs/RESEARCH.md). AI interpretation remains fallible, and unavailable intentions, pressing causes or chance quality must not be invented. The short passages do not establish a full-match player award or future winner. Azure availability depends on the configured account, quota and credit. The public source is available at [falcon-0/infinite-stadium](https://github.com/falcon-0/infinite-stadium). Final video approval and judging-period continuity remain separate delivery checks.

## Build a clean source handoff

`python package_judge.py` creates an allowlisted source ZIP under ignored `artifacts/judge/`. `python verify_judge_package.py` extracts and checks it in isolation. `prepare_public_source.py` prepares a new Git-ready folder from an explicitly selected tested release; it never commits, pushes or deploys. Development snapshots and private configuration stay local.
