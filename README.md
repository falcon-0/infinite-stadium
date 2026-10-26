# Infinite Stadium

A football companion that answers questions about the moment you are watching while the match keeps moving.

[Watch the 118-second demo](https://youtu.be/Ay6WmVt-LIA) · [Open the app](https://infinite-stadium-lime.vercel.app/?view=watch) · [Run locally](docs/JUDGE_SETUP.md) · [Developer guide](docs/CONTRIBUTING.md) · [Architecture and deployment](docs/DEPLOYMENT.md)

## Watch, ask, understand

Choose a synthetic fixture and play it. Ask a question in your own words. The assistant captures the displayed match time, queries evidence available at that time and answers beside the replay. Playback continues during the request. Moment links let you revisit the supporting action.

The application computes statistics and event order. Azure AI plans the evidence lookup, composes an answer and separately reviews whether it covers the question. Late confirmations and corrections change what is known; future information must not leak into earlier answers.

Twenty fixtures cover five authored two-minute passage families. The schematic replay runs at a fixed 2× pace with compact statistics, timed narratives and a recap. Viewing options change the audience detail and language of subsequent supported content. English, Spanish, French and Portuguese paths are implemented; menus and some general rules remain English. The data, teams and players are synthetic.

![Infinite Stadium synthetic match replay](docs/images/watch.png)

The replay is available without signing in. AI testing instructions are included on the hackathon project page.

## Run locally

Use Node.js 24. No package installation or credentials are needed for the synthetic replay.

```sh
node server.js
```

Open http://127.0.0.1:4173/. For Azure conversation, copy the placeholder settings from `.env.example` into a private `.env.azure`, configure your deployment and run:

```sh
npm run start:azure
```

Keep credentials server-side. [Deployment instructions](docs/DEPLOYMENT.md) cover access protection and durable usage limits.

## Verify

```sh
npm test
npm run validate:data
npm run verify:release
```

The release verifier needs Python 3.9+ and runs without model calls. Browser checks use an explicitly configured Playwright installation; CI installs a pinned runtime. See [validation](docs/VALIDATION_PLAN.md) for the checks and their scope.

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

Tests sit beside their modules. Installed models, credentials, raw provider traces, videos and generated builds are excluded from Git and the source archive.

## Evidence and limits

[Recorded evaluation evidence](docs/EVALUATION_EVIDENCE.json) includes selected question inputs, outcomes, timings and verification scope. These development cases do not establish representative accuracy or a latency guarantee. AI responses can take several seconds.

The application grounds answers in received match records. Unrecorded intentions, pressing causes and chance quality cannot be established from those records. The short passages do not establish a full-match player award or a future winner.

## Reproducible source package

`python package_judge.py` builds an allowlisted source ZIP. `python verify_judge_package.py` verifies it in an isolated directory. The same checks run in CI so the public source remains independently reproducible.
