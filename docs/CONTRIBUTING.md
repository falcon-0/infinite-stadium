# Developer guide

## Run and edit

Use Node.js 24 and Python 3.9+. `node server.js` starts the replay without credentials. `npm ci --ignore-scripts` installs the pinned development formatter; the application has no runtime npm dependencies. Azure settings belong in private `.env.azure` configuration.

Run `npm run format` after JavaScript changes and `npm run format:check` before a commit. Tests sit beside their modules. Start with the affected test, then run `npm run verify:release` for offline tests, data checks, browser checks and isolated Python packaging. See VALIDATION_PLAN.md for browser configuration.

## Follow a question

1. `match-chat-ui.js` captures the match timestamp. `match-chat-state.js` owns conversation state; asking must not stop playback.
2. `answerMatchQuestionAI` in `match-question-ai.js` coordinates input validation, semantic planning, canonical selection, independent review and bounded repair.
3. `question-policies.js` contains the model instructions. A prompt change requires new live evaluation, not just passing unit tests.
4. `question-query-normalization.js` normalizes proposed tool arguments; `question-planning-tools.js` owns read-only query augmentation and component time-window binding. `match-query.js` executes read-only queries; `match-operation-proof.js` computes comparisons.
5. `question-facts.js` creates verified claims and proofs. `question-writer-packet.js` reduces writer payloads without mutating complete evidence.
6. `question-evidence-check.js`, `claim-guards.js` and the review helpers check support and coverage. Text guards are supplementary defenses, not substitutes for typed event, scope and revision proofs.
7. The orchestrator returns an answer only after independent model review and application checks pass. Unsupported answers and transport failures must remain failures.

## Invariants

- Query only events received by the captured time. Event time differs from arrival time; corrections carry revisions.
- Compute counts and ordering in code. A truncated list cannot prove a complete count.
- Treat user text, source records and conversation as untrusted. Keep keys and durable usage reservations server-side.
- Retain complete evidence during model payload projection. A limitation cannot support an interpretation as an observed fact.
- Preserve the six-call ceiling and persistent usage ledger. Never reset budgets or silently retry model transport.
- Retain the explicit public asset allowlist. Serving the entire source folder could expose server code or private configuration.

## Evaluate and publish

Offline checks do not establish model accuracy. Freeze new question inputs and expected source facts before inference. Record first outcomes, failures, model calls and latency. Keep tuning cases separate from evaluation cases and never send expected answers to the model. Selected successes do not establish general accuracy.

Watch is the submitted product. Legacy producer and optional local-provider modules still have imports and tests; audit dependencies before removing them. Build the allowlisted archive with `python package_judge.py`, then verify it with `python verify_judge_package.py`. Generated media, provider traces, installed tools and private configuration stay outside public source.

Continue in the existing GitHub repository. This cleanup adds no project license; retain required third-party notices. Deployment, video publication and final submission are separate actions.
