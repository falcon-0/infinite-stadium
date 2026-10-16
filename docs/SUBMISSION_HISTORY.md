# Infinite Stadium submission pack

Working material, October 7, 2026. This is an unpublished submission draft, not a declaration that the project is ready. The final recording plan is in [DEMO_SCRIPT.md](DEMO_SCRIPT.md); current run instructions are in [JUDGE_SETUP.md](JUDGE_SETUP.md), provider setup in [README.md](../README.md), and dated historical measurements in [DEVELOPMENT_HISTORY.md](DEVELOPMENT_HISTORY.md).

## October 8 implementation update

Watch remains primary. Ask the match now uses open conversation rather than intent templates: the model plans composable event queries, an analyst writes from retrieved results, and a reviewer checks the answer. Counts and zero results have citable query-scope references as well as event citations. Queries cover exact player/team/action/outcome/body-part/assist filters, time windows, sorting and aggregation. Foot use and the confirmed assist are authored synthetic metadata, never inferred from animation.

Question timestamps remain pinned while playback continues. Technical sources are hidden from Watch; no event-button list or suggested next questions appears. Context includes two bounded prior turns. Automatic live insight cards remain deterministic, not continuous AI commentary.

Mocked workflow, query, correction and budget tests pass. The latest three-call conversation requires a future actual Azure quality evaluation. The owner retained the exhausted 12-call daily guard. Earlier model checks found time-unit and evidence-classification failures; new guards address those cases, but comprehensive language-model reliability is not established. No independent participant testing has occurred.

## Project narrative

**Name:** Infinite Stadium

**Pitch:** Infinite Stadium helps a fan understand a chance and a producer trust its explanation. It turns received synthetic football events into a match companion: what happened, why it matters, and a replay of the buildup. The same evidence becomes a concise fan story, sampled analyst context, a player-focused view, or a multilingual segment recap. An AI workflow selects supporting facts; the application verifies their references and renders the wording. When the underlying events change, affected stories and producer approvals require renewed review.

**Problem:** An event feed tells a viewer that a shot happened. Understanding its significance means connecting the outcome, score, recent actions and the viewer's interests. A producer also needs to know whether those facts remain current when a provider amends an event. Manually connecting and checking these pieces interrupts viewing and takes production time. These are the problems the prototype targets; measured time savings and improved fan comprehension remain hypotheses.

**What we built:** A JavaScript web application with received-time event streaming, revision-aware match state, a schematic 22-player replay, selected-moment explanations, short buildup replays, four story languages and separate Watch and Studio workspaces. Newcomers see a concise account; analysts also see sampled measurements; player followers can follow a chosen player's received involvement. Studio supports human review, a correction inbox, approved rundown preview and machine-readable exports. No action publishes a broadcast.

**How AI contributes:** On request, the canonical workflow gathers bounded evidence, selects supported facts and performs an editorial review. Application rules require essential moment and supported goal-consequence facts. Validation checks current dependencies; templates supply the final wording and citations. The instant match card, animation and recorded recap do not invoke a model. Describe this as AI-assisted evidence and fact selection, not unrestricted AI-written live commentary.

**Microsoft technology actually integrated:** The Azure path uses custom Node orchestration with a configured Microsoft Foundry deployment of GPT-4.1 mini. The optional local path uses Microsoft Agent Framework with Ollama. The application itself currently runs on the development computer. An Azure-hosted application, production broadcast integration and published GitHub delivery are not completed claims.

## Rules snapshot and owner checks

Verified against the [organizer's official rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md) on October 8. Recheck that source before submission; section references below identify the controlling text.

| Milestone | Pacific Time, 2026 |
| --- | --- |
| Registration | September 29, 09:00–October 20, 12:00 |
| Submission/hacking | October 6, 09:00–October 27, 23:59 |
| Judging | October 27, 09:00–November 10, 23:59 |
| Announcement deadline | November 20, 23:59 |

Solo entrants must have reached local majority at entry; teams allow four members. Residency exclusions include Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea, Sudan, Syria and other prohibited jurisdictions. Section 3 also excludes organizer/judge connections, specified relatives/households, affiliates and conflicts.

Sections 4.3–4.9 require new work after registration opened, synthetic football-realistic data, authorized assets, original ownership, no prior contest win, a public GitHub repository, English materials/translations, and a public demonstration video under two minutes. Supply a working website/demo/test build, private-site credentials if needed, and free unrestricted judge access through **November 10 at 23:59 Pacific**. Judges may use only the submitted media. Read sections 4.11–4.12 and 7 before agreeing to submission terms.

November 20 remains our requested availability target, beyond the judging minimum. Neither date has an operational continuity plan verified yet.

Owner confirmations still needed: the section 3 attestations; actual registration completion; project creation provenance; asset/software rights; acceptance of submission terms; chosen entrant identity; and authorization for public delivery. Do not put identity documents, private credentials or billing details in this repository.

## Challenge implementation map

The mapping below describes this implementation, not a completeness certificate. See [challenge sections 4.1–4.2 and evaluation section 6](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md).

| Pipeline stage | Reviewable implementation | Practical limit or remaining proof |
| --- | --- | --- |
| Ingest | Synthetic events and sampled positions are received through one replay clock; revisions and withdrawals are retained. | Authored short passages; no commercial event feed or full-match distribution. |
| Interpret | Known outcomes, score consequences, bounded action sequences, shot-pattern changes and sampled measurements. | No validated pressure classifier, pass-difficulty model or video auto-eventing. |
| Explain | Separate outcome, significance and buildup; uncertain outcomes stay explicit. Canonical AI explanations retain supporting references. | Tactical causation is not inferred from chronology. Independent football review remains pending. |
| Render | Match-first Watch view; received-only buildup replay; separate producer rundown and timed cue artifacts. | Schematic 2D display, not live video or a production graphics-provider integration. |
| Personalize | Watch exposes language and freeform questions; Studio retains distinct audience-oriented treatments. AI response-language selection and requested detail now reach the model. | The casual-fan versus analyst experience still needs a convincing demonstration; cloud multilingual quality and native-language review remain pending. |

## Rubric evidence

The five rows each carry 20% under the [official rubric](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md).

| Criterion | Evidence to show | Required proof still missing |
| --- | --- | --- |
| Technological implementation | Current source, revision checks, received-only replay, maintained test suite, provider separation. | Fresh-computer setup and final deployment verification. |
| Agentic design and innovation | Bounded tool selection, fact selection, editorial review, shared evidence and rejection/repair paths. | A controlled comparison demonstrating an advantage over a simpler workflow. |
| Real-world impact and applicability | A fan understands a moment; a producer can trace, review and replace an affected story. | Actual participant feedback, observed benefit and production operations evidence. |
| User experience and presentation | One story beside the match, optional details, two-step buildup exploration, responsive layout. | Final fan and accessibility checks on the release build. |
| Category adherence | Demonstrate the deployed Microsoft integration and purposeful workflow actually present. | Final category selection based on the released behavior. |

The strongest current category candidate is **Best Multi-Agent System**, subject to proving useful coordination. Distinct roles alone do not establish superiority. Do not claim Azure Cloud Native readiness from an Azure inference endpoint. Foundry integration is real, but the current project does not demonstrate a broad Foundry management or deployment workflow.

## Validation ledger

| Status | Evidence as of this preparation pass |
| --- | --- |
| Implemented | Watch, Studio, received-event meaning, replay, personalization, canonical explanation/recap paths, correction-aware human approval and exports. |
| Internally checked | 545 Node checks passed and one Windows symlink skip, 546 total; 9 packaging tests and 14 local SDK mock tests passed. The default passage's 01:36 off-target approval was superseded by its 01:38 saved correction; the inspected replacement alone entered the approved preview. These are developer checks, not participant results. |
| Historical actual model checks | Azure and local providers have returned canonical results in documented development spot checks. See dated measurements in [development history](DEVELOPMENT_HISTORY.md); they are single-case observations. |
| Latest cloud outcome | An actual current-build Azure UI check succeeded on October 7: sustained seed 17, received time 118s, anchor `comparison-sustained-17-shot-116` revision 2, Newcomer/English. It returned A. Reed's goal and Northbridge's 0–0 to 1–0 lead change with the same current shot reference. Displayed execution: 5.2s, two model calls, two application tools, 2,802 input tokens, 50 output tokens, no repair, model editorial approval. This one case does not establish latency, reliability or comparative quality. The earlier timeout remains in development history. |
| Not validated | Independent participant benefit, native-language quality, full-match physics, production reliability, multi-agent advantage and a fresh-computer AI installation. |
| Not delivered | Public source, public demo video, final accessible judge build/site and the Innovation Studio submission. |

Actual independent participant count remains **zero**. Participant work is reserved for the final stage close to submission. Do not convert developer reviews, subagent reviews or automated checks into user-study results.

The October 7 Azure allowance reached 12/12 reserved requests after this check. The existing trial-credit ceiling and zero-cash constraint remain unchanged; further model calls or unrestricted judging access are not implied by a successful development check.

## Judge instructions to accompany the released build

**Release fields to complete:** public source URL — pending; build/download or hosted URL — pending; video URL — pending; release commit/hash — pending; tested operating system/browser — pending; AI provider and access instructions — pending; availability owner and endpoint/build verification date — pending.

For the current source build, Node.js 20+ runs the deterministic experience:

```sh
npm start
```

Open `http://localhost:4173`. This command alone does not install or enable a model. It is a reproducible non-model tour, not a substitute for providing a working AI path in the final submission.

1. In **Watch**, choose **Play match**. The default is a fictional two-minute passage. Pause or use received replay time to inspect it.
2. Open **Key moments**, select a shot and read its outcome and significance. **Watch buildup** plays a short received clip; **Stop replay** restores the selected evidence scene.
3. In **Personalize your view**, compare Newcomer and Analyst. Then choose another story language or Player follower with a selected player. The replay clock should remain at the requested time.
4. With the released AI provider ready, select **Explain this moment**. Read the result and its evidence. If it fails, retain the recorded interpretation and capture the actual error; do not label it a completed AI response.
5. In **Studio**, open **Producer review workbench**. Add a current candidate, inspect it, approve it, then preview the approved rundown. Changed evidence can invalidate approval and identify affected exports.
6. Return to **Watch**, reach the end of the passage, and open **View recap** or **Match recap**. The received recap is available without a model; **Create AI recap** is a separate request.

Optional local AI setup is documented in README. On Windows, it requires Python, Ollama and model setup before `npm run start:local`; `powershell -File setup-local.ps1` installs the optional Python dependencies and downloads the configured model. An earlier CPU explanation took over a minute. Validate setup and document hardware on a separate computer before using this as the judge delivery route.

Azure instructions must be supplied for the final authorized environment, not copied from private `.env.azure`. The project access code, if used, belongs in the submission testing instructions rather than public source. Never publish the Azure key.

## Release completion checklist

- [x] Complete one successful current-build Azure UI workflow and record its displayed execution; the narrow result is documented above.
- [ ] Verify the actual AI route offered to judges, including continuity and error recovery. The current source ZIP alone does not configure a provider. Keep the existing trial-credit ceiling and zero-cash constraint.
- [ ] Choose and verify a judge-access route that remains usable for the entire required period. A private development URL is not delivered access. Do not rely on an unverified trial expiry or a model counter that blocks judges.
- [ ] Run the final fan, football and language reviews; document actual participants, findings and resulting changes. Keep unperformed evaluations marked pending.
- [ ] Extract the packaged source on a separate computer; follow only the included instructions. Verify replay, model setup, cancellation, a correction, Studio review and recap.
- [ ] Select the category using actual released evidence. Keep architecture claims separate from measured advantages.
- [ ] Review licenses, accidental secrets, recorded footage and public metadata; prepare the exact release commit and checksum.
- [ ] Obtain the owner's public-delivery and submission decisions, then publish the intended repository/build/video and fill the release fields above.
- [ ] Record the functioning application using [DEMO_SCRIPT.md](DEMO_SCRIPT.md); verify every visible claim against the released build.
- [ ] Complete the Innovation Studio project fields, link the challenge, verify all external links from a signed-out session, and preserve the submission receipt.

This file prepares the materials and decisions. It does not authorize publication, spending, account upgrades or submission.


## Current release gaps - October 8

Twenty fixtures have separate clubs, lineups, timelines and ball routes, generated from five authored passage families. They share a schematic rendering engine. Watch uses fixed 2.5x playback with no visible speed control. Both server packet cadence and display cursor use the chosen rate. Event results remain tied to match time rather than wall time. Technical sources and developer navigation are hidden from the fan view.

Remaining work, in priority order:

1. Validate real Azure answers across facts, counts, follow-ups, missing attributes, corrections and all selected languages when the existing daily allowance permits. Keep the 12-call guard and overall trial budget; mocked tests do not prove model understanding.
2. Improve animation and football plausibility. Current passes, keeper reactions and support movement are schematic; 2.5x is a demo pace setting, not a physics fix. Obtain a football-knowledgeable review near submission.
3. Deliver a visible, defensible explanation of why selected moments matter alongside continuous play-by-play. Routine action captions are deterministic and are not AI tactical analysis.
4. Demonstrate meaningful personalization without restoring the rejected dropdown clutter. Language and user-directed depth are implemented paths, not yet sufficient proof of a compelling analyst-versus-casual-fan experience.
5. Verify judge-accessible deployment, secure AI access, costs and fresh-computer setup. Select a prize category supported by the actual deployed implementation; multiple model roles alone do not prove multi-agent advantage.
6. Near submission, run fan/accessibility checks, refresh the source package, finalize the English pitch and under-two-minute video, then obtain authorization for public delivery and submission. No participant evidence or publication is claimed today.


### Twenty-fixture and pace verification

The catalogue contains 20 fixtures across five authored families; pairwise tests verify different action timelines and ball routes, and fixture audits check every entry at the received horizon. The full suite reports 621 passed, one platform skip and zero failures. A local stream probe measured ten match seconds in 3.999 wall seconds at fixed 2.5x. Browser checks confirmed the new counterattacking and end-to-end selections, desktop playback, and a 375px phone layout without horizontal overflow. The lobby does not start a stream before selection. These checks do not establish physical realism or actual Azure answer quality. No model calls were made in this pass.


### Compact match list, passing variety and AI retrieval

The lobby uses 20 linked list rows rather than large cards, verified on desktop and at 375px without horizontal overflow. Wide-play fixtures include an outside-foot trivela pass and an authored cross into the box. Ball flights use ground/loft/curve variants with height interpolation and a separate ground shadow. Pass categories and technique are queryable provider metadata; no inferred body mechanics or physics certification is claimed.

AI retrieval now treats confirmed goals and saves as on-target attempts, groups official synthetic assist credits by the assisting player, supplies all 22 roster identities, and anchors recent context to the latest received action rather than an old shot. Aggregate packets use complete counts with query-scope evidence instead of repeating event rows and group evidence. Three bounded model calls remain; no Azure budget increase or live inference was performed. The full offline suite passes 630 tests with one platform skip. Real Azure interpretation quality and independent football plausibility review remain pending.


### Displayed-time questions and linked evidence

Watch captures the displayed replay second and drops automatic editorial anchors from ordinary live questions. Explicitly inspected moments retain their anchor. The AI pipeline now validates input independently of the deterministic recorded-search path, exposes recent actions to its planner, follows explicit provider links through passes, receptions, shots and recoveries, and focuses explanations on retrieved historical moments when requested. Linked context is limited to four roots, sixteen additional records and three graph steps; missing or withdrawn events cannot be revived. This context is not a complete inventory and does not prove absence, intent or an official assist.

Queries support intended recipient identity with successful-pass filtering, zero-count roster players, and zero-valued team totals. Scope references include roster identity so roster-dependent answers cannot reuse the same evidence identity after that roster changes. Offline tests cover these cases, historical buildup, corrections, future-event exclusion and displayed-time pinning. The final suite passed 638 tests with one platform skip and zero failures. Browser checks confirmed the allowance message updates while paused, without waiting for another match packet. The live server reports the daily model-call limit reached, and the fan panel now distinguishes that from an outage. No Azure model calls or budget changes were made. Actual model quality still requires evaluation when the retained allowance renews.


### Live AI validation — October 9, 2026
The owner authorized increasing the local daily model-call guard from 12 to 40 while retaining the $5 total trial-credit ceiling, $0 cash spending, and no account upgrade. The persistent ledger was retained; its normal UTC date rollover started the next daily count. This guard counts requests, not dollars.

Live Azure testing exposed intermittent transport failures, invalid evidence references, and planner fields placed at the wrong query nesting level. The analyst now uses short request-local scope references which are validated and restored to canonical content-addressed references after review. The planner adapter relocates recognized fields without changing their values; conflicting or unsupported fields still fail closed. Recent-momentum instructions require a bounded comparison instead of whole-segment totals.

Successful live cases covered no scorer yet, most shots, a recent two-team comparison, a recorded trivela, and a Spanish explanation. These were real model calls, not mocked responses. The Spanish and momentum wording still warrants broader editorial evaluation; this sample does not establish arbitrary-question reliability. Earlier failed outputs are retained in local artifacts. At the end of this batch, 25 of 40 daily calls were reserved, leaving 15; each complete question normally uses three calls. No cash purchase or account upgrade was performed.


October 9 follow-up: browser testing exposed a planner window extending beyond a question asked at 00:00. The adapter now clips only the upper bound to received time; the query engine still rejects invalid ranges and never reads future events. A live retest correctly reported no recorded pass at kickoff. A subsequent browser question asked at 00:20 identified R. Lewis and receiver L. Fischer while the replay continued to 02:00, with the answer still labelled 00:20. The interface refreshes AI availability after requests. The server rejects new questions before inference when fewer than three call reservations remain, preserving the unused remainder instead of spending it on a partial workflow. After this batch the ledger stood at 39/40. Earlier 25/40 was the prior batch snapshot, not the current balance. This validates that specific journey, not all follow-ups or general match reasoning.


## October 14 verification notes preserved from the submission draft

## Current verification

The local release gate checks the Node suite, isolated browser journeys, synthetic data, catalogue consistency, moment and recap templates, source packaging, and a clean archive launch. The current result and exact test counts are in `artifacts/release/report.json` and `artifacts/release/tests.log`. Browser checks cover conversation continuity and a phone-size watch/chat layout. These are automated consistency checks, not fan validation or model-quality scores.

October 14 development checks exercised scoring, assists, false-premise questions and turnover causation. Latest corrected samples identified the actual shot taker and recovery without inventing a forcing player. Earlier runs exposed unsupported explanations and failed answers. Broader consistency remains unverified; a successful generation is not a quality score.

The wider v15 development sample exposed serious failures: only one of eight questions was fully correct and useful. Subsequent routing, typed-operation and evidence checks improved the separate v19 wide sample to six useful, correct answers out of eight, with two withheld answers and remaining verbosity concerns. This is a small development sample, not general accuracy. See `artifacts/evaluations/adjudication-wide-v19-2026-10-14T23-15-33-799Z.json`.

The separate v19 rules/attribute sample remains a release blocker: only two of six responses were fully correct, three were withheld, and one delivered handball explanation incorrectly limited penalty offences to deliberate handball. Knowledge-citation handling and conditional-rule reasoning require correction and fresh live tests. See `artifacts/evaluations/adjudication-rules-v19-2026-10-14T23-16-29-741Z.json`. The two attribute contrasts were captured at 01:04, while the latest pass outcome was still pending; they do not establish correct handling of a subsequently confirmed failed pass.

The latest frozen v19 local release passed all eight gates: 888 tests, 887 passing and one optional skip, plus data, catalogue, templates, packaging and clean archive checks. A two-turn browser check used the preceding v18 backend, took approximately 10.5 and 4.8 seconds, and preserved question timestamps while playback continued. It is not a browser verification of later backend changes.

The v20 rules retest remained blocked: of six requests, two delivered correct/useful answers, two delivered incorrect answers and two were withheld. The model again introduced a false universal rule condition and silently narrowed an unqualified latest-pass question to completed passes. The v20 release suite also encountered an intermittent persistent-ledger 503 (896 passed, one failed, one optional skip); its cause is under investigation. Neither successful unit checks nor a model's approval establishes release readiness. Selected development audits, including failures, are included in `docs/EVALUATION_EVIDENCE.json`.

The subsequent v21 release passed eight local gates (909 tests: 908 passing, one optional skip). Tests from the extracted source ZIP passed with 904 passing and five environment/platform skips. Live v21 rules had four fully correct/useful answers, one incomplete answer and one wrong outcome statement. A separate holdout stopped after two withheld requests and a provider rate-limit failure, leaving four unexecuted cases. These results still block a broad answer-quality claim. The original ledger 503 was not reproduced; persistence robustness was improved and tested, without claiming its precise cause was established.

Sourced rules currently use English application-rendered fact text selected by AI; the output declares the actual language and provenance. This does not establish rules translation quality. Other match-conversation language routes remain model generated and need broader review.

The v22 holdout completed all seven requests without provider rate limiting: three substantive useful answers, one appropriate name clarification and three withheld answers, with no incorrect answer delivered in that sample. Median response time was 12.8 seconds. The v23 canonical-fact implementation passed all eight local release gates (944 tests: 943 passing, one optional skip), but its subsequent seven-request cloud test still withheld three answers. Redundant model explanations exceeded the response contract in two requests; independent review found that the last-pass rejection overlooked an explicit pass-to-recovery link in the source. Response composition and reviewer handling of recorded links are being corrected; these development results do not establish general reliability or submission readiness. The saved reports preserve both versions and their source fingerprints.

The later v24 retest delivered all seven responses: five substantive answers and one clarification were fully useful, while a comparison omitted its requested assessment. A fresh five-question set then had three fully useful answers, one wrong-event response and one withheld answer. V25 passed all eight local release gates (976 tests: 975 passing, one optional skip); the extracted ZIP separately passed 971 tests with five environment/platform skips. The v25 fresh cloud retest delivered four of five responses, with remaining overrefusal and repetitive wording under correction. These small development sets are preserved with source hashes and independent automated adjudications; they are not broad accuracy or official judging scores.

October 12 live Azure checks correctly answered first-scorer and zero-goal questions, and the visible application answered a most-shots question. Other requests failed to connect. A causal-attribution test was withheld by the deterministic guard because the generated claim exceeded the evidence. These small checks are not a broad correctness or reliability certification. The shared persistent daily guard is now 900 calls (expanded October 14 with the existing ledger preserved) following the user's expanded trial-credit testing authorization; cash spending remains $0 with no pay-as-you-go upgrade. The call ledger is not a dollar-cost meter.

October 13 targeted Azure checks answered first scorer, recent activity comparison, last recorded left-foot pass and a Spanish scorer question in 3.2–6.2 seconds, with two calls each. The Spanish answer initially overstated the current score as final; analyst/reviewer instructions now disallow full-time verdicts, and a retest answered only scorer and assist in 6.8 seconds. These are small development observations, not measured accuracy or a latency guarantee.

Docker is installed but its Linux daemon is unavailable on this computer. A successful container launch and public hosting are not verified. An isolated Node launch from the packaged source is a separate check.



## Superseded mixed Watch/Studio preparation — October 16

# Infinite Stadium submission preparation

Current status: October 16, 2026. The Innovation Studio project profile exists at https://innovationstudio.microsoft.com/hackathons/insidethegamedeveloperhackathon/project/126399 and is linked to the challenge. Creating that profile did not complete the competition submission.

A focused 71.04-second captioned Watch demo is prepared locally at `artifacts/demo/infinite-stadium-demo.mp4`, using genuine Azure answers, follow-up context and uninterrupted playback. It has not been published and does not demonstrate all Studio features. The latest v62 release passed all eight local gates (1,079 passed, one optional/platform skip). A six-question Azure development check now covers first scorer, explicit assist, provisional player pick, linked buildup, a genuine follow-up and recent shooting activity. The final reviewed answers took 10.3–22.0 seconds and two or three model calls. The pressure case needed a targeted reviewer-prompt fix; prior failed and verbose results remain in the audit. This is a tuned development sample across consecutive builds, not a broad reliability score.

The combined local Watch/Studio demo is now `artifacts/demo/infinite-stadium-watch-studio-demo.mp4` (94.08 seconds, silent with captions). Studio correction and replacement approval checks passed without inference. The false-score correction, metric-qualified keeper comparison and provisional player assessment have returned useful Azure answers. The final-pass lookup now succeeds with an executed ordering proof. Two targeted shot-choice phrasings now return specific uncertainty on Azure; motives remain unrecorded. The same two questions now return one saved-shot fact and one specific unknown-reason statement in 15.8–16.4 seconds with three calls, versus 32.7–35.3 seconds and four calls before. This small tuned comparison is not a general response-time guarantee. Past withheld responses remain in the audit. Public access now works; trial continuity remains unresolved.

Four additional tuned fan questions now have developer-audited Azure answers: keeper involvement, individual passing accuracy, the latest left-foot attempt and correction of an assumed penalty miss. Final answers took21.5–32.9seconds across consecutive builds. Raw failures and network interruptions remain preserved; these samples do not establish broad accuracy or speed.


Latest deployment validation (October 16): all eight local release gates passed, with 1,084 tests passed and one platform-specific skip. Production health/assets passed; private files returned 404; authenticated Azure answered "Who scored first?" with A. Reed at 01:56 and two calls. Shared reservations advanced from 10 to 12 without resetting the existing ledger. Logout revoked access. Production SSE delivered two terminal frames and completion; the browser clock and statistics advanced during playback. This is a bounded deployment check, not a broad AI accuracy certificate.

A 116.07-second, 1080p motion graphics owner-review cut is prepared at `artifacts/demo/infinite-stadium-motion-demo-v1.mp4`. It retains genuine 94.08-second Watch/Studio footage and waits, plus a clearly separated synthetic goal diagram. It is silent and has not been uploaded to YouTube. The required public video URL must be on YouTube, Vimeo, Facebook Video or Youku; GitHub MP4 downloads are supplemental only.

## Ready-to-use project description

**Infinite Stadium** is a synthetic football companion for viewers and coverage producers. Choose a match, follow the play and ask natural football questions without interrupting playback. The assistant pins each question to the displayed match moment and uses received contribution evidence. Supported comparisons and ordered endpoints become typed operations with server-computed proofs and application-rendered facts; known unrecorded-intention questions can select schema-grounded limitation facts, while other qualitative questions use bounded model-written prose. A model reviews request relevance, with additional evidence checks on prose. Counts, zero results and later corrections have explicit handling. Live testing still exposes interpretation and answer-quality gaps, so unrestricted football-question reliability is not claimed.

The Watch experience combines a schematic 22-player replay, synchronized score and compact statistics, action-by-action commentary, short contextual explanations and an end-of-segment recap. Twenty fixtures vary clubs, lineups, timelines and routes across five authored passage families. A collapsed Viewing options drawer offers simple explanations, detailed analysis, language and a player to follow from the full current roster. These choices reach the AI while explicit questions retain priority. Conversational requests let viewers ask for further detail.

Studio serves producers separately: audience-specific treatments, graphic previews, correction-aware approvals and timed rundown exports. When a provider amends an event, affected approvals require renewed review. It is a local production prototype, not a connected broadcast system.

The integrated Azure inference path uses a Microsoft Foundry deployment of GPT-4.1 mini with custom Node orchestration. An optional local structured workflow uses Microsoft Agent Framework with Ollama. The website is deployed on Vercel Hobby at https://infinite-stadium-lime.vercel.app using the current Azure model and a Free Upstash shared session/usage store. Azure website hosting remains an optional alternative.

## Official delivery requirements

Rechecked October 14 against the [official rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md). Submit by October 27, 2026, 23:59 Pacific. The entry needs a public GitHub repository, a public functioning demonstration video under two minutes, a project description and working access for judges. Read the organizer's full rules for eligibility, permissions and access obligations. Announcement is due by November 20; judging ends November 10. These dates do not extend an Azure trial.

## Challenge coverage and remaining evidence

| Area | Implemented | Still needed |
| --- | --- | --- |
| Ingest and interpret | Synthetic events, sampled positions, revisions, withdrawals, known-outcome statistics | Independent football plausibility review; full-match simulation is not claimed |
| Explain and render | Action headline, short deterministic context, freeform Azure conversation, schematic replay and Studio cues | Stronger sustained realism and broad live-model quality evaluation |
| Personalize | Persisted viewing choices, full-roster player following, profile-aware open conversation, separate Studio treatments | Demonstrate genuinely different useful responses; native-language review |
| Agentic workflow | Answer-or-query analyst and reviewer; optional bounded retrieval and shared evidence | Controlled comparison against a simpler workflow; role count alone is insufficient |
| Applicability | Uninterrupted viewing and correction-aware producer review | Real fan feedback, public access, operational verification |

## Current verification and handover

The final v30 local release passed all eight gates: **1,027 tests passed, one optional/platform check skipped (1,028 total)**. This includes real Chrome phone/desktop checks, 2× pacing, continued playback during preference changes, dataset consistency, source packaging and an isolated launch. It does not certify model quality, public hosting or a working Docker daemon.

Watch now uses a labelled fixed 2× pace: a two-minute passage takes about one minute. Automatic context lasts roughly eight wall-clock seconds. The full 22-player picker, persisted viewing preferences, compact mobile spotlight and actual club labels are verified. Studio retains its separate playback controls.

Historical v29 baseline (superseded by later repairs): AI usefulness was the main blocker. The v29 first-exposure run delivered one useful but repetitive answer from six attempts; five answerable questions were withheld. One additional keeper regression was withheld. The owner requested wrapping up, so the remaining five planned regression cases were not executed. Seven saved results used 31 model calls. The v30 minimal contract fix restores a grounded break assessment in an exact offline replay, but other numeric-scope, correction-binding and hidden-relative-anchor failures remain. No fresh cloud validation was claimed after that fix. Historical results and failures are retained in EVALUATION_EVIDENCE.json and DEVELOPMENT_HISTORY.md.

No independent human participants have tried the build. Fan testing remains near submission as requested. The GitHub source and downloadable demo assets are the public delivery route; working hosted AI access through November10 remains pending. The friend's authorized trial is not active; continuity is not secured. Cash spending stays $0 with no pay-as-you-go upgrade.

The current v62 source passed release checks and identical-input Azure latency checks: passing accuracy13.563seconds/2calls versus32.523seconds/3calls, latest left-foot action10.431seconds/2calls versus21.526seconds/5calls. Independent review remains mandatory. These two tuned samples do not certify arbitrary-question speed or correctness. The captioned Watch/Studio video remains a genuine earlier capture, not a recording of these latency changes.

## October 14 internal regrade

Three Astra reviewers reassessed source and saved evaluations after remediation: Technology 16/20, Agentic 14/20, Impact 11/20, UX 14/20, Category 12/20; total 67/100. This is an internal mock assessment, not an organizer score or winning prediction. Experience review was source/report based, not independent current visual or participant validation.

The final targeted probability regression released a supported shot outcome and an explicit unavailable-probability statement after the deterministic guard triggered a rewrite. The preceding recovery regression correctly distinguished recovery from unknown forcing responsibility. These tuned regressions do not establish general answer quality or reviewer-specific superiority. The audit preserves earlier causal failures, over-refusals, incomplete assist citations and provider rate limiting. Fresh multi-turn and cross-fixture evaluation, real fan feedback and operational continuity remain outstanding.

## Release fields

| Field | State |
| --- | --- |
| Innovation Studio profile and challenge link | Created |
| Public GitHub source URL | https://github.com/falcon-0/infinite-stadium |
| Judge website or test-build URL | https://infinite-stadium-lime.vercel.app (AI requires private project access code) |
| Required public video URL | Pending YouTube upload; GitHub MP4 download is supplemental only |
| Final category | Provisional Best Multi-Agent System; justify using measured benefit |
| Final release commit | Pending freeze after final checks |
| Live model availability through judging | Not secured by the expiring trial |
| Independent participant feedback | Zero participants; reserved for final stage |

## Final release sequence

1. Run `npm run verify:release`; inspect the reports and fix any failure.
2. Finish browser/football realism review and live-model question, follow-up and multilingual checks within the approved allowance.
3. Run the prepared final-stage fan sessions. Record actual observations and changes, without presenting internal checks as participants.
4. Verify a deployment with HTTPS, server-only credentials, persistent budget storage and a funded or zero-cost continuity plan. See DEPLOYMENT.md.
5. Publish the reviewed source and release archive, record the actual application using DEMO_SCRIPT.md, and verify links from a signed-out browser.
6. Complete the project fields, review eligibility and agreements, and submit before the deadline.

Historical notes are in SUBMISSION_HISTORY.md and DEVELOPMENT_HISTORY.md. They do not supersede this current status.
