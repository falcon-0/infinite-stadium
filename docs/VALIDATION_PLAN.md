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

The M runtime passed1,310 tests with one skip and zero failures across eight gates. Original K native checks covered six selected answers; L public checks covered four, with observed3.283–5.266second responses. M preserves the backend bytes. L recorded-response desktop/mobile checks passed12/12. A real Spanish scorer/assist interaction and Spanish recap were separately inspected. See EVALUATION_EVIDENCE.json for attribution and preserved adverse results.

These results do not establish broad unfamiliar-question accuracy, native-language quality, long-term availability or comparative superiority. Further contextual-integrity questions are tested separately and may expose new failures. Real fan checks can add evidence of comprehension; they do not replace source/AI verification and are not claimed as completed here.
