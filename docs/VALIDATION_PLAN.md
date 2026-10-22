# Validation and known limits

## Reproducible offline checks

`npm test` checks the event engine, conversation, query scopes, calculations, answer guards, persistence, access control, rendering and server behavior. Tests are kept beside modules so a reviewer can reproduce the contracts.

`npm run verify:release` runs eight stages: Node tests, synthetic data validation, fixture catalogue evaluation, recorded moment evaluation, recorded recap evaluation, packaging tests, source packaging and extracted cleanroom checks. It clears provider configuration and makes no model calls. Python3.9+ is needed for packaging. Source and archive identities bind the result to the exact tested files.

Browser tests require an explicit Playwright runtime. CI has a required browser job with `REQUIRE_BROWSER_TESTS=1`; local environments can report a platform skip when the runtime is absent. Mocked/recorded browser results do not establish live Azure performance.

## Live AI protocol

Freeze questions, inputs, source expectations and candidate hashes before inference. Send only the actual user input to the application. Preserve first failures and retunes separately. Record observed wall time and actual model calls; never report a small selected set as overall accuracy or a controlled speed comparison. Owner Azure testing uses the existing quota ledger; no cash upgrade or automatic transport retry.

## High-value contracts

- A question captures displayed match time without pausing playback.
- A fixture switch or rewind rejects stale/future context.
- Delayed arrivals and corrections do not leak backward.
- Counts preserve metric, player, team and exact window boundaries.
- A relative follow-up resolves an actual source anchor instead of the nearest event.
- Complete roster questions use the received roster, not only players appearing in event history.
- Shots, passes and recoveries do not by themselves establish chance quality, possession, pressing, intention or dominance.
- Unknown causes are precise limitations; known requested facts remain useful and visible.
- Unsupported questions clarify or give a useful boundary rather than hallucinating.
- Localization is checked by actual applied content; language controls alone are not proof.

## Current evidence

The current candidate runs the eight release gates, including required browser checks, packaging and isolated archive startup. The recorded release report binds results to exact source files. Recent source cleanup and multilingual follow-up fixes also passed GitHub Linux, Windows and browser CI before merge.

Selected actual Azure checks include a French identity clarification at a later playback time: the answer retains the original question cutoff and the browser keeps playing. Fresh unfamiliar questions exposed a wrong latest-versus-longest substitution and a Spanish percentage answered with a definition. Their first failures are retained privately, separately from subsequent fixes and retests. The revised typed shot-share operation computes on-target attempts divided by all attempts, with complete query proofs, zero-denominator handling and unknown-outcome guards. Unsupported physical pass rankings must not substitute time order.

The latest local candidate passes all eight gates with 1,351 tests passed, one skipped and none failed. Keeper answers combine the saved shot and collecting goalkeeper into one statement while retaining both event citations and the ordered window. Independent goal information remains available when pass-distance ranking cannot be established. Legacy fixture roster frames now carry the same authored player labels as their events, allowing canonical facts without a freeform fallback. Named-event temporal clauses are retained in request coverage. Fronted temporal alternatives stay together within their own request piece; subsequent independent questions retain their separate completeness checks. A canonical linked goalkeeper collection can prove positive chronology against an ordered source anchor using exact current revisions and times; it cannot establish absence, counts, causation or the next action. Wrong direction, actor, revision, time and unproved anchors remain rejected. A selected source-proved zero can answer a neutral quantity question without a redundant correction paragraph; independent review still checks the exact requested entity, outcome, window and any genuine premise correction. Explicit player subsets can use complete individual counts; an all-player request still needs complete grouped coverage. The quantity wire schema factors action states from population labels to avoid repeating every action/grouping combination. Runtime checks retain population, ID, outcome, qualifier and window constraints. Smaller serialized schema size is not a measured latency improvement.

These are selected developer regressions, not an overall accuracy estimate or a controlled latency benchmark. Historical long responses and network interruptions remain known limitations. Simulated reviewer scores are not organizer grades. Friend feedback exists, but no controlled fan-benefit study is claimed.

An approved final video, final portal attestations and Azure credit, expiry and quota through judging still require confirmation. Private traces, credentials and generated development artifacts are excluded from the public repository.
