# Infinite Stadium validation and build plan

## Current completion plan - October 14

Finish the viewing and AI experience before final-stage participant sessions. Watch is now match selection, received-only animation, action-by-action commentary, compact statistics, language and open questions. Studio separately retains audience treatments, review and exports. Do not restore rejected fan controls to satisfy an old checklist.

Use `npm run verify:release` for local automated gates. It includes the twenty-match query/display consistency matrix and the packaged module graph. Current behavior and external delivery gaps are in SUBMISSION.md. The current video plan is DEMO_SCRIPT.md; older walkthroughs below are historical and may describe removed controls.

Questions pin the displayed match time without pausing. Check scorers and zero results, arbitrary player totals, passes and receivers, historical questions, follow-ups, requested detail and language, missing observations, corrections and model unavailability. Offline tool correctness is distinct from actual model interpretation. Preserve the configured 900-call daily guard and persistent ledger. The owner authorized development using existing trial credit, with $0 cash and no account upgrade. Normal questions use two or three calls; one bounded repair may bring the total to five.

Final-stage fan/football/native-language reviews remain near submission, as requested. Actual independent participant count is zero. Use the prepared tasks and blank records later; do not invent results. Public hosting, a public repository, real demonstration recording and submission are still delivery gates, not consequences of passing tests.

## Recording and historical notes

Use the current 115-second script in DEMO_SCRIPT.md. The checkpoints below are dated historical evidence, not the current Watch layout or current provider allowance.

## Latest checkpoint: fact-selected studio stories (October 6)

The main explanation button now uses a constrained fact-selection workflow on both Azure and local Microsoft Agent Framework inference. The model gathers received evidence, selects current fact IDs, and a separate model reviews editorial relevance. Application templates render the selected facts in English, Spanish, French or Portuguese with complete citations. The interface labels this authorship explicitly. Free prose remains an experimental draft path under Testing tools. Local selection uses compact numbered fact slots, and the server maps them back to canonical fact IDs before rendering. Neither model review nor canonical wording establishes source completeness, football realism or real-world truth.

Two earlier Azure spot checks exposed unsupported wording and incomplete aggregate/score citations despite model reviewer approval. Targeted safeguards were added, followed by the separate fact-selection path. One actual analyst fact-selection check at received time 180s returned five supported claims in 9.886 seconds with three model calls, four tools, no repair, 9,740 input tokens and 165 output tokens. The score included both contributing goals. These are one-case measurements, not a model accuracy estimate or evidence of comparative performance.

A new actual local canonical newcomer check at received time 32s returned three claims in **108.4 seconds**, using three model calls, two evidence tools, no repair, **1,864 input and 60 output tokens**. The goal, recovery-to-shot interval and completed-pass count retained their full reference sets. Output wording came from application templates; Qwen3 selected tools and fact slots and reviewed editorial relevance. The shared local deadline is 180 seconds with at most five worker/model calls and one repair. This is one case on this machine, not live-performance or model-accuracy evidence. Run `npm run probe:local -- --fact` only when intentional local model work is wanted. The local canonical evaluation adapter is available through `npm run evaluate -- --local --adapter=fact-selection`; ordinary offline evaluation makes no model calls.

Canonical stories can be downloaded as machine-readable studio cues from their evidence details. Cues include event time, received time, duration, exact revisions and explicit `human-review-required` status. Export rejects changed preferences and superseded references. This is a review artifact, not a production publishing integration. Catch-up retains received revision history, labels missing history as uncertain, and processes actual deletion records without inventing citations.

Deployment preparation now supports an optional project access code through an HttpOnly session cookie scoped to `/api`, with a one-hour expiry and logout. The main UI can unlock AI without saving the code in browser storage or exposing the Azure key. A disposable-code browser check confirmed unlock/lock behavior with no model calls. This does not constitute a public deployment. Session state and the daily model-call limit are in memory; restarting or scaling the server resets them.

`npm run validate:data` audits four fixture kinds at three seeds. The twelve checked variants had no contract errors or configured heuristic warnings after fixing short-fixture pass endpoints. Pending endpoints stay unknown; completed endpoints match the authored reception. Checks cover revision identity, received timing, roster stability, bounds, coordinate conversion and action/sample links. Motion warnings exclude explicit resets and use adjustable thresholds. Passing these checks does not prove football realism.

The current checkpoint passed 356 Node tests and twelve mocked Python framework tests using `.venv\Scripts\python.exe`. The offline evaluation produced 13 template drafts, five correct abstentions and no template failures; model adapters were skipped. Human semantic review, independent football plausibility, external user testing, a fresh-computer installation, public hosting and judging-period continuity remain open.

Status: implemented prototype evidence and proposed acceptance checkpoints. Prepared 3 October 2026 following three independent research reviews; updated after Innovation Studio onboarding and the latest development verification. Proposed targets are not achieved results. See [research and sources](RESEARCH.md).

Our next commitment is a short validation sprint. The architecture and primary audience remain adjustable until the experiments below establish a useful and technically credible end-to-end experience. Starting development does not remove the option to change scope.

## Current budget decision, October 5

The user requires **strictly $0 in ongoing service costs** and project availability through **November 20**. Do not activate pay-as-you-go or permit cash charges. On October 5 the user explicitly authorized up to $5 of existing trial credit for connecting and testing GPT-4.1 mini; this supersedes the earlier ban on credit-consuming Azure checks for that bounded experiment only. The student offer is unavailable to the user. Earlier inspection found no subscription; the user subsequently activated an Azure account on October 5. The portal now shows one Active subscription, Owner access, $200 remaining credit and current reported cost 0.00. These account facts do not establish model quota or a working deployment. A 30-day trial activated October 5 would expire before the desired availability date; activating it just before submission creates access and testing risk.

The working alternative is local inference through Ollama plus Microsoft Agent Framework. The approximately 2.5 GB `qwen3:4b` model and pinned Python provider are installed. The reported hardware is approximately 16 GB RAM and NVIDIA Quadro P1000 graphics. CUDA failed because the installed driver rejected Ollama's PTX; CPU inference works. Automatic provider tool calling did not return usable output, so the local workflow uses structured tool selection, application invocation of actual framework `FunctionTool` objects, a drafting agent and a separate reviewer. Node enforces received evidence and citation revisions. The integrated Match insights UI supports this provider through `npm run start:local`; the Azure main explanation button now uses the constrained fact-selection workflow described above.

Historical local checks, October 5: an initial real analyst probe took 126,824 ms, with three model calls and one measurement tool. Its reviewer approved while listing an issue; this is not a valid success or evidence of semantic quality. Contradictory approvals are now rejected and the review schema makes approval incompatible with issues. The three-case CPU comparison completed: the single-call path returned one draft, timed out once and correctly abstained once; the role workflow returned two structurally valid drafts and correctly abstained once. One role draft was an instruction echo incorrectly approved by its reviewer, so structural success overstates useful output. This known echo is now rejected, its task field removed and context reduced; the full comparison has not been rerun after those changes. An earlier real HTTP draft succeeded in 44.675 seconds with one model call, but omitted a recovery citation needed for its sentence. That historical checkpoint passed 61 Node tests and two Python framework contract tests. Human football review and useful coordination remain unresolved. Do not claim live-play narrative latency, multi-agent superiority or broad model accuracy from this experiment. Deterministic facts and timed overlays remain separate from on-demand AI generation.

### Latest implemented evidence

An earlier checkpoint passed **113 Node tests and three Python framework contract tests**. Framework tests use mocked model responses. An earlier actual English local newcomer case returned three supported claims in **105.6 seconds**, reporting **817 input and 248 output tokens** from one model call. Both available buildup facts had complete supporting references cited (2/2 reference coverage). This is a single spot check, not model accuracy or a general semantic-validation result. No new Azure model checks were made for this development verification.

The main screen now selects a recent story with explicit expiry, displays the exact selected positional sample with participant names and separates current replay time from scene time. Its responsive layout places the story before the pitch on narrow screens. Reading a selected moment pauses replay. Evidence-key caching reuses pending inspections across unchanged ticks and suppresses stale results after corrections. Bounded catch-up highlights distinguish new actions, late arrivals and corrections; missing historical revisions make the earlier score unavailable. Viewer comprehension, native-language quality and formal keyboard/mobile user testing remain unverified.

The default extended UI fixture has twelve scripted phases: zero-based phases 2, 6 and 9 contain intercepted passes, and phases 4 and 8 retain possession without a shot. At the completed horizon it has 50 current events, seven shots, twelve passes, nine completed (75% known-outcome accuracy), a 2-1 score, 361 revision-one positional frames and seven frame corrections. Twenty-second reset intervals are explicit fixture resets, not simulated play. Independent football plausibility review remains required.

The investigator now has five read-only tools, including `get_match_patterns`: received counts and recovery-before-shot sequences in the 120-second window ending at the selected moment. Each aggregate carries supporting revisions. Evidence-window counts and chronology do not establish tactical pressure or causation. The latest tests cover these facts and request races; neither tool count nor test count proves useful agent coordination.

The rules permit a test build under section 4.8, so a reproducible downloadable local build is the proposed $0 judging route. Verify it on a fresh computer and keep access through November 20, exceeding the November 10 judging-period minimum. No always-online public model service has been secured. A public frontend alone is not a live AI deployment. Microsoft Agent Framework is explicitly named in the multi-agent category; eligibility and category claims must still reflect the working submission and the stage-one technology requirements. See [rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md) and [native local provider documentation](https://learn.microsoft.com/en-us/agent-framework/integrations/by-component/model-providers/ollama).

Azure onboarding follow-up, October 5: opening Foundry and signing in triggered automatic provisioning of a Foundry resource. Provisioning completed in West US 3. The user approved up to $5 of trial credit and $0 cash spending, with no pay-as-you-go upgrade. GPT-4.1 mini (2025-04-14) was deployed as `infinite-stadium-mini`, Global Standard, with DefaultV2 guardrails. Initial allocation was 10,000 TPM; the role workflow hit token throttling, so allocation was changed to 50,000 TPM. A real single-draft HTTP call succeeded in 3.629 seconds (573 input and 137 output tokens); the final role check succeeded in 12.200 seconds with three model calls, four tools and a reviewer approval (7,199 input and 414 output tokens), after compaction of positional evidence. Earlier endpoint/diagnostic attempts were throttled. The browser button also generated a real Azure draft. These are connectivity checks; human football quality and controlled baseline comparison remain pending. The account-specific endpoint and key are kept in ignored `.env.azure`, not source or the judging ZIP. The app itself still runs locally; only model inference is cloud-hosted. The exact credit-expiry timestamp has not been verified. The longer free-service allowance shown in the subscription overview is separate from trial-credit expiry. No pay-as-you-go upgrade was performed. Keep local inference available, and do not treat account activation as Azure integration or continuity through November 20. Next gates: determine a cash-free continuity route through November 20. The trial account alone does not solve that date requirement.

GitHub Models is not a fallback: [GitHub documents its retirement](https://docs.github.com/en/github-models) on July 30, 2026. Existing Azure adapter code may remain as an optional integration, but Foundry and Azure Cloud Native are no longer our presumed prize categories. Historical Azure intentions later in this document are superseded by this budget decision.

## Canonical AI segment recap

The existing collapsed **Match recap** panel now has one optional **Create AI recap** action. It freezes received time and current preferences, pauses playback and gathers the full received segment rather than the selected moment's rolling window. The model chooses from typed overview, team shot totals, pass outcomes, goal score changes and favorite-player involvement; application templates render the selected facts in English, Spanish, French or Portuguese. The overview leads, and selected goal highlights stay chronological. Recorded pass percentages use only known outcomes and disclose pending attempts.

This workflow uses two model roles normally, at most four calls with one repair, and no model-selected tools. Local SDK phases use compact numeric slots; Azure selects current fact IDs. The server supplies complete citations after selection, keeping citation lists out of the editorial model context. The limits are 60 seconds on Azure and a shared 180 seconds locally. Failed selections or repeated editorial rejection withhold the AI recap. The deterministic recap remains available during failure or cancellation and returns whenever the AI recap becomes superseded by received evidence, time or preferences. No automatic cloud call runs on segment completion.

An actual local browser check at received time 362s returned a three-claim recap in **94.2 seconds**, using two model calls, **1,967 input and 38 output tokens**. Its citations were complete, but it selected the first goal and equalizer while omitting the later goal behind the recorded 2-1 score. Model editorial approval missed this coverage gap. The workflow now requires the latest supported goal change when its after-score matches the received overview; omission receives one repair and then withholding. This coverage rule does not establish source completeness or broader editorial quality.

A second actual local browser check with the coverage guard returned the overview, first goal and latest recorded lead change at 05:28. It completed in **83.5 seconds** with **three model calls, 2,939 input and 52 output tokens**. All supporting goal revisions were visible in its citations. These are two spot checks, not a controlled quality or latency comparison. The UI also confirmed that changing received time marks the old recap superseded and restores the current recorded recap.

Run `npm run evaluate:recap` for the dedicated offline report. Its independently specified cases cover pending pass outcomes, a pre-completion cutoff, whole-segment counts at a different seed, a short received pass, exact favorite-player actor coverage and empty inventory. The template run returned five drafts and one correct empty-inventory abstention with no failures. Model evaluation requires explicit `--local --adapter=fact-selection` or `--live --adapter=fact-selection`; do not run these unintentionally. Reports describe selected fact kinds, reference coverage, timing and reported tokens; human editorial and translation review remains pending.

These are fictional segment recaps, including in-progress or short fixtures, not full-match results. A reported zero count describes the received inventory and does not establish provider completeness. The route is `POST /api/agent/recap`; authorization, process generation locking, cancellation and the Azure call budget apply to it as well.

## Product hypothesis

A producer can turn a complex match moment into an accurate, understandable, personalized explanation faster using Infinite Stadium than using a plain event feed and manual authoring. Viewers should understand the moment better, with fewer misleading statements and without excessive interruption.

Two candidate presentations will share the same technical foundation: an interactive moment explainer for fans, and an experimental descriptive presentation for audio-first users. Accessibility needs and football expertise are separate preferences. Choose the primary audience using feedback; do not claim an accessibility benefit without involving intended users.

## Rules that affect implementation

The [official rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md) require a new project created after registration opened September 29, synthetic football-realistic data, a public repository, a working project, English submission materials or translations, and a video shorter than two minutes. Submission closes October 27 at 11:59 PM Pacific. Maintain free judge access through November 10. Check eligibility and submission terms directly before submission.

Implementation, agentic innovation, impact, UX and presentation, and category fit each carry 20%. Choose the category matching demonstrated results. A multi-agent category claim needs evidence of purposeful coordination and an advantage over a single agent. Development does not have to wait for October 6, but any additional platform instructions need reconciliation.

## Judging readiness — 5 October 2026

### Full challenge brief: implementation checkpoints

The user supplied the complete Synthetic Match Insights Engine challenge description on October 5. The five-stage workflow is the core acceptance path; the listed metrics and video auto-eventing are features to consider, rather than proof that real footage is required.

| Stage | Current evidence | Work still required |
| --- | --- | --- |
| Ingest | Clock-gated replay; integrated eight-second and six-minute scripted fixtures; synchronized event/frame corrections; resumable SSE delivery connected to the browser | Fresh-machine judging setup; plausibility review of scripted reset intervals |
| Interpret | Event totals, bounded recovery-before-shot patterns, nearest-opponent geometry, pass endpoint displacement, known-outcome accuracy, sampled player and shot-ball displacement rates | Football plausibility review; pass difficulty with an evaluated model; avoid presenting interval samples as instantaneous speed |
| Explain | Received-event summaries, Azure investigator/reviewer main button, five bounded tools and one repair attempt; historical actual Azure connectivity and latest single-case local check | Controlled live model evaluation; compare role workflow with the single-call baseline; independent semantic review |
| Render | Unified story and exact selected positional scene, named participants, evidence inspector, corrected recap and bounded catch-up; expiry/corrections checked across all 363 extended-fixture ticks | Producer review/publishing workflow; keyboard/mobile user testing; comprehension comparison |
| Personalize | Browser audience/language/club/player controls; English, Spanish, French and Portuguese narrative/recap templates; language-aware AI prompts | Validate audience differences and language quality with users; measure real multilingual generation |

The narrative backend selects received shots/goals and generates a segment recap with revision dependencies, repair comparisons and expired-overlay filtering. The integrated viewer also provides received-evidence catch-up summaries. An optional Azure recap-drafting path has only mock-provider coverage. A full-match recap remains outside the scripted segment. The separate spatial lab is retained as an engineering fixture. Multilingual quality and production readiness remain unverified; latency and tokens have narrow development measurements, not a controlled performance result. Synthetic video auto-eventing is a possible stretch experiment after the full pipeline works.

This section maps the organizer's five equally weighted criteria to reviewable project evidence. It is a gap assessment, not a predicted judging score. A passing unit test is not evidence of live model quality, user benefit or production readiness.

| Criterion (20% each) | Present evidence | Required work before submission | What judges can inspect |
| --- | --- | --- | --- |
| Technological implementation | Unified received event/position evidence, deterministic metrics, seeded extended fixture, correction checks, Azure adapters and installed local Microsoft Agent Framework provider | Verify reliable local generation, measure actual latency and semantic support, document the clean judging setup | Readable module boundaries, meaningful tests, data invariants and measured model usage |
| Agentic design and innovation | Custom Node investigator/reviewer workflow with five bounded tools and one repair; implemented Microsoft Agent Framework local selector, tools, investigator and reviewer; narrow actual model checks | Complete controlled actual model tests; compare role coordination with templates and a single-agent baseline; demonstrate useful coordination | Tool activity, structured findings, shared evidence revisions, a visible reviewer decision and failure recovery |
| Real-world impact and applicability | Producer-assisted explanation is a hypothesis; reliability behaviour is demonstrable locally | Test a specific producer task and viewer comprehension; deploy a usable prototype; measure latency, cost and failure behaviour | Actual task results, participant counts, supported versus unsupported claims, deployment limitations and operational controls |
| User experience and presentation | Unified recent-story viewer, exact selected scene, audience templates, evidence details, corrected recap and bounded catch-up; responsive story-first mobile layout | Validate audience adaptations and comprehension; check keyboard/mobile behaviour with users; rehearse a demo under two minutes | One interesting moment explained visually, an audience change, evidence correction and a resulting recap |
| Adherence to category | Azure inference privately configured; custom role workflow connected to the main Azure button; native Microsoft Agent Framework local workflow exercised with a real model | Investigate Multi-Agent under the $0 cash constraint and approved trial-credit cap; demonstrate useful coordination before selecting the category | A category-to-feature explanation backed by a working test build, traces and evaluation |

### The complete experience we must demonstrate

A synthetic moment arrives. The deterministic engine updates match facts. The investigator requests only received events and positions through bounded tools, then produces an evidence-linked finding. The reviewer accepts, qualifies or rejects the finding. The approved finding becomes an analyst or newcomer presentation with a synchronized scene. A provider revision invalidates affected output and triggers bounded repair. A consolidated recap uses current approved findings.

The main integrated viewer joins received events, the selected positional scene and recap. Earlier independent labs remain under Testing tools. AI output is still a draft requiring human review; there is no completed producer approval/publishing workflow or consolidated recap of approved AI findings. Nearest-opponent distance is a geometric measurement, not established pressure or a tactical cause. The reviewer must check factual support beyond whether citation IDs exist.

### Build order and completion gates

1. **Shared evidence contract, October 6–9:** Integrate positions into observed event sequences, attach revision-aware metric dependencies, and keep hidden canonical history outside application tools. Gate: a bounded question returns correct measurements and scene evidence; late data, missing positions and revisions behave correctly.
2. **Real AI and bounded investigation, October 10–13:** Evaluate the local Microsoft Agent Framework call and investigator/reviewer handoffs under the strict $0 cash budget. Gate: evaluate held-out cases, including insufficient evidence and a reviewer rejection; report quality, latency and tokens for all three baselines. Local CPU latency and semantic reliability remain unresolved; Azure inference is privately configured, with additional testing bounded by the approved trial-credit cap.
3. **Complete broadcast workflow, October 14–17:** Connect approved findings to two audience treatments, the scene, revision repair and an actual recap. Gate: the same moment stays consistent across outputs, and delayed model results cannot replace newer evidence.
4. **Value and deployment proof, October 18–20:** Conduct a small disclosed producer/fan evaluation, measure service latency and usage, and select the category supported by results. Gate: report observed outcomes and limitations without inventing adoption, accuracy or accessibility claims.
5. **Submission readiness, October 21–26:** Freeze features, verify a fresh setup and public judging access, review licences and secrets, polish the UI, and record the demo. Gate: public repository, English pitch/testing instructions, working judge link and video under two minutes; submit early and retain access through November 10.

These dates are work targets, not achieved milestones. If access or experiments slip, reduce optional formats and service complexity. Do not replace a required live AI demonstration with a mock labelled as live.

### Proof package

- Architecture diagram describing implemented services, evidence tools, state and agent roles; distinguish proposed components.
- Reproducible scenario suite with held-out seeds and football plausibility review; include quiet, delayed, missing and revised evidence.
- Evaluation results with denominators, representative failures, baseline comparisons, latency and token/cost measurements.
- Producer/viewer task observations with participant counts and consent; no invented testimonials or market projections.
- Public README with setup, technology roles, limitations, judge instructions and licences; no credentials or confidential materials.
- Approximately 110-second demo: 0–10 s problem; 10–35 s arrival and explanation; 35–55 s scene and evidence; 55–75 s audience change; 75–95 s correction and recovery; 95–110 s recap and actual evaluation evidence.

The development assistant's research subagents do not count as the product's multi-agent implementation. More services and agents do not earn evidence by themselves; every addition needs a demonstrated role.

## The first validation sprint

Budget proposal: three focused working days, roughly 18 to 24 hours of developer attention. This is an estimate, not a commitment established from the user's schedule. Spend no more than one day investigating simulator installation and export. Do not provision paid resources until access and intended spending are understood.

| Work | Output | Evidence for proceeding | Response if unsuccessful |
| --- | --- | --- | --- |
| Data source spike | Coherent positions and labelled events that replay identically | Export a short attack and restart it without inconsistencies | Use a bounded seeded scenario generator; stop simulator dependency work. |
| One explanation | A question produces a scene and a bounded answer grounded in events | Correct entities, measurements and references on scenarios unseen by the prompt author | Reduce supported questions and inspect the data model. |
| One correction | A changed event updates dependent facts and scene | No stale dependent claim remains visible as current; unrelated outputs remain unchanged | Reduce output formats until revision integrity is established. |
| Presentation comparison | General fan and descriptive versions of the same moment | Directional feedback from intended users on comprehension and interruption | Revise the experience; avoid adopting a persona based on assumed preferences. |
| Model access | Successful authenticated backend call and usage measurement | Actual model availability, quota and workable latency | Keep local tests moving, but flag cloud AI delivery as unresolved. |

The first fan-facing question should be observational, such as Which movement opened this passing lane in the recorded sequence? Avoid claiming knowledge of player intent or a guaranteed alternative outcome.

## Synthetic data architecture

Generate a canonical world history for the evaluation harness and a separate observed feed for the application. Introduce controlled delays, missing positions, duplicate messages and corrections only into the observed feed. The production agents cannot read hidden canonical history. A replay must reproduce what was known then, not simply filter the final corrected dataset by match time.

Use at least six scenario families: a straightforward attack, a high recovery, an off-ball run opening space, a quiet period with no justified tactical story, a revised event identity or type, and missing or delayed tracking. Vary seeds, teams, direction of attack and timings. Reserve development-independent scenarios; generator labels and scene titles must not leak the desired story to the agents.

Validate basic invariants: monotonic frame times, unique player identities, positions within allowed bounds, bounded velocities, consistent score changes, possession transitions, and no impossible instantaneous player movement. A football-knowledgeable reviewer must assess plausibility. Passing these checks proves software constraints, not equivalence to professional football.

[Google Research Football](https://github.com/google-research/football) is a candidate exporter, not a selected dependency. Review its [observations](https://raw.githubusercontent.com/google-research/football/master/gfootball/doc/observation.md), [scenarios](https://raw.githubusercontent.com/google-research/football/master/gfootball/doc/scenarios.md), setup and component licences. Avoid training reinforcement-learning policies. Export JSON and render our own scenes if feasible; keep the simulator outside the online production path. The custom-generator fallback is simpler to control but needs independent realism review.

## Shared evidence and publishing model

Each event needs a stable ID, match time, arrival time, revision number and supersession state. Each computed metric records its time window, formula version and input revisions. Each claim is explicitly a recorded fact, computed metric, interpretation or simulated alternative. Scenes, captions, narration jobs and recaps reference claim versions.

Use explicit relationships such as derived_from, supports and invalidated_by. Semantic similarity links are not sufficient for deciding what a correction invalidates. Preserve earlier versions for replay and auditing.

When evidence changes, recompute affected metrics, withdraw or revise affected interpretations, update active graphics and recaps, and cancel obsolete queued speech. If stale audio has already played, record that exposure and optionally issue a concise correction. Keep unrelated outputs stable. Late model responses must not overwrite newer valid state.

Separate fast factual updates from slower story investigations. A goal should update the deterministic scoreboard immediately after the accepted event; editorial reasoning should not block it. Define replay pause, live clock, scene playback and speech time explicitly rather than treating them as one clock.

## Agent experiment

Compare three implementations on the same test cases: deterministic templates, one tool-using agent, and a bounded investigator plus reviewer workflow. A deterministic scheduler can initially select and publish scenes. Add an AI director only if editorial selection requires it and evaluation supports the choice.

Tools should expose constrained queries for events, possession sequences, counts, player positions, simple passing-lane geometry and evidence validation. Do not call a model for every frame. Share a verified story across audiences, then adapt presentation. Set retry limits, tool-call budgets and deadlines. Store tool inputs, outputs and editorial decisions for inspection; do not present internal model chain-of-thought as a product artifact.

Microsoft Foundry inference is privately configured and available alongside the local Ollama/Microsoft Agent Framework path. Azure resource onboarding and a bounded model deployment completed as recorded above; the app itself remains locally hosted. Cash spending stays at $0, with only up to $5 of existing trial credit approved for connection/testing. No pay-as-you-go upgrade was performed. A free judging-access continuity route remains unresolved.

Measure local model memory, elapsed time, tool reliability and semantic support. Package installation and model download are not proof of a usable live-play experience. For any later explicitly funded Azure path, verify permissions, quota and the total measured service cost first. Start without Kubernetes, a vector database or web search unless a concrete requirement justifies them.

## Evaluation and decision gates

The following thresholds are proposed engineering targets. Some local latency and failure measurements are recorded above; the acceptance thresholds below have not been met.

| Test | Proposed acceptance evidence | Limit of the conclusion |
| --- | --- | --- |
| Typed facts | Zero accepted wrong counts, identities or future-event references in 100 adversarial checks | Does not establish zero future errors or correct tactical interpretation. |
| Correction integrity | All affected active outputs in the test matrix invalidated or revised; obsolete queued speech cancelled; unrelated outputs retained | Does not measure the commercial frequency or cost of corrections. |
| Semantic support | Football reviewer labels claims as supported, qualified, unsupported or misleading | Small human review is directional and requires disclosed sample size. |
| Multi-agent benefit | Better relevant quality or recovery than the single-agent baseline, with latency and token cost reported | More agents or longer traces are not improvement by themselves. |
| Latency | Initial target p95 story delivery within 8 seconds on the measured deployment; immediate deterministic fact updates | Target may need revision for actual model quotas and speech duration. |
| Viewer value | Randomized presentation order; compare comprehension, missed action, effort and preference | A small convenience sample cannot establish general accessibility or market demand. |
| Producer value | Complete a defined explanation task faster without increased factual errors | A prototype task does not establish adoption or willingness to pay. |

Track unsupported claims that were blocked and unsupported claims that escaped. Include cases where the correct response is insufficient evidence or no story. Evaluate stale-claim exposure time, missed major moments, unnecessary regeneration and narration interruptions. Report actual denominators and examples, not just percentages or selected successes.

For accessibility validation, involve blind or partially sighted participants and ideally a trained descriptive commentator. Do not substitute sighted participants closing their eyes as evidence of usability for blind people. Prototype text and keyboard control first, then test timing and speech. Participation and outreach have not been arranged or performed.

## Interview prompts

For a producer, ask them to describe the last correction they handled, which outputs needed changing, how existing tools helped, and what took time. Ask them to perform a concrete authoring task with the prototype. Avoid only asking whether they like the idea.

For a fan, ask them to explain a sequence after using each presentation. Ask what information was missing, distracting or too late. For descriptive modes, ask about location detail, expert terminology, interruptions, catch-up behaviour and independent controls. Do not presume users want a synthetic commentator replacing a human.

## Scope boundaries

Required candidate scope: synthetic observed feed, interactive explanation, deterministic fact tools, evidence-linked output, two audience treatments, one correction workflow, recap and evaluation.

Optional after the core works: one additional language, on-demand speech, bounded geometric alternatives, additional matches, or an embeddable overlay. Choose one extension at a time from evidence.

Defer a custom full football game engine, photorealistic rendering, player recognition from real footage, unrestricted coaching advice, calibrated scoring predictions without a validated model, and thousands of simultaneous broadcasts. These remain possible later products, not claims about the hackathon prototype.

## Proposed calendar

| Dates in October 2026 | Deliverable |
| --- | --- |
| 3 to 5 | Research record, data spike, audience prototypes and access checks |
| 6 to 9 | Versioned feed, replay, computed facts and first deployed explanation |
| 10 to 13 | Real AI tools, investigator and reviewer experiment, unseen scenarios |
| 14 to 17 | Audience adaptations, synchronized scenes, revisions and recap |
| 18 to 20 | External feedback, latency and cost measurements, category selection |
| 21 to 23 | Feature freeze, interface polish, deployment and failure recovery |
| 24 to 26 | Public repository, clean setup check, demo under two minutes, early submission |
| 27 | Contingency |

If a milestone slips, remove an optional format or audience, not the correctness boundary. Preserve useful components across pivots. Freeze the core workflow only after the validation sprint; freeze optional features only after measured performance and presentation are adequate.

## Demonstration outline

Aim for approximately 110 seconds. Introduce a football understanding problem, show an interesting synthetic moment, ask for an explanation, inspect the linked scene and evidence, change audience mode, inject a labelled event correction, show repaired outputs, and end with a concise recap plus real evaluation results. Do not manufacture an AI mistake and present it as spontaneous, or label prerecorded outputs as live generation.

## Current decision

Continue development of the interactive explanation studio while prioritizing semantic evaluation, football plausibility, viewer comprehension and a reproducible judging setup. Preserve accessibility as a candidate requiring co-design and correction propagation as shared reliability infrastructure. New features should address demonstrated gaps and remain bounded by the approved budget. Do not claim unique market ownership, guaranteed winning potential, or validated user benefit.

## Viewer and player recap checkpoint, October 6

The local player-mode browser check for D. Silva at 362s returned overview, latest supported lead and ten actor actions (five shots, one goal, zero passes and recoveries), with ten actor-event citations. It took 160.0 seconds, four model calls, one repair, 4,820 input and 169 output tokens. Application rules forced repair after the model omitted the profile and its reviewer approved. This spot check does not establish live readiness or model accuracy. An incorrect timeline appeared in a reviewer suggestion; suggestions remain explicitly unverified execution diagnostics, outside canonical claims and cues.

Browser preferences retain only validated audience, language, club and player choices in one project key. Visible checks confirmed reload restored player/French/D. Silva without a model request, and reset restored defaults while retaining 03:00 replay time. The requested phone viewport had equal document/client widths (360px); screenshot capture was unavailable, so this is a geometry check, not visual certification. A read-only audit found and prompted a fix for reset claiming saved removal when browser storage removal failed. Denied storage now reports a session-only reset.

The dedicated offline recap evaluator now requires the latest supported score change and available chosen-player profile. Its independent D. Silva expectation checks all ten actor references and counts, rejecting generic team-count or earlier-goal substitutes even when their wording and citations are canonical. Six cases returned five drafts and one correct empty-inventory abstention, with no failures or actual model calls. The full checkpoint passed 329 Node and twelve mocked Python framework tests.

An actual keyboard browser check ran the withdrawal fixture from 8s through 12s at 1x speed. Focus began on the goal's Inspect moment button and moved to the remaining receive-event button after deletion; the score returned to 0-0. Studio preview pending checks now preserve the timing/evidence disclosure while clearing all claims. That disclosure fix received source review but has not received a new live AI browser check.

## Recap rundown and endpoint visualization checkpoint, October 6

Canonical recap download now performs server-side fixture reconstruction and validates current record bodies, canonical wording, complete inventory, latest supported score and chosen-player requirements without a model call. The review artifact excludes execution, traces, suggestions and access inputs. Six seconds per ordered segment is proposed review pacing, separate from live overlay timing. The UI validates before and after export and cancels on replay/preference changes. Four HTTP tests cover budget invariance, access/origin/body guards, corruption, changed scope and actual withdrawal. Thirteen module tests cover exact canonical snapshots and review artifact limits. A labeled mock-provider browser check saved the two-segment/50-reference JSON; its default Downloads file was parsed and copied to project artifacts. The event waiter timed out despite successful saving. Seeking removed export eligibility. A deliberate mock-provider failure followed by a seek confirmed old errors disappear.

The pitch now displays at most two exact ball-sample endpoint links, with time intervals and an explicit distinction from trajectories. Eight fixture/adversarial tests cover correction, missing/future/conflicting samples, interruptions, pending passes and unavailable shot links. Main-site browser checks confirmed two links at 32s and only the available pass at 28s, without model calls. Tracking content changes under an unchanged revision now fail stream materialization; actual newer corrections and reordered duplicate objects remain valid. Screenshot capture was unavailable, so these geometry/text checks do not certify visual polish. The full current checkpoint passed 356 Node tests; Python framework source is unchanged from the twelve mocked tests.

## Received dataset and persistent request counter checkpoint, October 6

The received-only dataset export was checked through full and partial browser downloads, parsed JSON and recomputed full content hash. The completed extended fixture preserves 69 event revisions and 368 frame revisions; current state resolves 50 events and 361 frames through exact references. Partial export keeps pending outcomes unknown. Raw withdrawals and received-time cutoffs remain intact. Data realism and third-party viewer usefulness still require independent review.

An optional persistent Azure request counter reserves before provider calls and retains counts across restart on a shared filesystem. Mock HTTP checks confirmed an exhausted restarted server returns 429 without another provider call. This does not meter dollars, reconstruct historic usage, coordinate separate files or guarantee a cloud budget. Full Node suite: 381 pass, one Windows symlink-creation skip, zero failures. No new actual model calls.

Readiness follow-up: healthy Azure configuration stays distinct from exhausted or unavailable counters, and the main AI controls respect availability. Three focused HTTP cases cover the status combinations and preserved authorization fields; a mock-browser exhausted case kept recorded goals, links and recap usable. Returning to current play preserves keyboard focus on Play/Pause. Final suite:384 pass,one Windows symlink-creation skip,zero failures.

## Held-out local analyst prompt experiment, October 6

A real Qwen3:4b/Microsoft Agent Framework check used the corrected wide fixture, seed902, observed10s, Spanish analyst mode. Before the prompt change it returned two canonical claims (goal and supported lead), in80.996 seconds using three model calls,1,770 input and57 output tokens. It chose only event and score tools. The prompt now asks analysts to inspect window patterns and spatial audiences to inspect sampled geometry, while permitting irrelevant context to be omitted. It adds no model round, schema change or forced claim.

The repeated case inspected event and pattern tools; application rules separately supplied score evidence. It again selected only goal and lead, in54.877 seconds using three calls,2,037 input and55 output tokens, no repair. Reconstructing each executed-tool catalog reproduced its claims exactly, with the corrected shot revision2 and actual SDK tool trace. This demonstrates changed evidence inspection, not richer analyst output. One run per prompt does not establish speed or quality improvement; native-language and independent football review remain open. Both runs used local inference and no Azure credit. Focused workflow checks (22) and existing SDK mocks (12) passed after the prompt edits; the preceding isolated full readiness checkpoint passed384 Node checks with one Windows symlink skip.

## Fan language and audience coverage checkpoint, October 6

Main stories, live cards and recaps now use match clocks and plain football language across four story languages. Explicit confirmed off-target, saved, blocked and on-target outcomes retain their distinct meanings. A non-goal alone does not establish any of those categories, and pending or inconsistent outcomes cannot become confirmed descriptions. Off target does not establish wide versus over the bar. The corrected D. Silva shot at118s now reads naturally as missing the target at01:58. Sampled measurements use a matching supported player name or a neutral label instead of internal roster IDs. Measurement semantics, full revisions and synthetic-data limitations remain in evidence details; translations still require native review.

Analyst and spatial workflows now gather their bounded audience foundation (patterns or measurements) and require the model to choose at least one nonredundant supported context fact when a candidate exists. Simple score repetition and an anchor-only one-shot count do not qualify. Missing context gets one repair, then withholding; neither application nor reviewer silently inserts claims. Empty candidate sets stay optional and newcomer/player rules remain unchanged. Selected SDK/model tool names and application foundation reads stay separate. Azure offers only useful sources not already read, avoiding another round just to repeat foundation evidence. This is an application coverage rule, not proof of tactical understanding or editorial quality.

A real Azure Spanish analyst check on corrected wide902 at10s returned three claims, including the supported pass count, in7.098 seconds with three model calls,7,163 input and112 output tokens. That check preceded tool-advertisement and fan-wording edits. A later actual browser check on extended17 at122s returned five natural English analyst claims for D. Silva's off-target shot, recovery chronology, completed pass, sampled opponent distance and moment score. It displayed12.2 seconds, three calls,10,633 input and134 output tokens; the shot and position references were revision2. The actual browser recap returned five claims in5.2 seconds with two calls,2,827 input and147 output tokens. Northbridge's pass line correctly showed one completed and one unsuccessful outcome (50%). These are one-case measurements, not comparative speed, football-quality or language-quality estimates.

The actual story cue and recap rundown downloaded and were parsed: five story claims and five recap segments with18 full-inventory dependencies. No additional inference was needed for export. Reviewer style suggestions remain unverified diagnostics, outside claims and exports. At the requested360px phone viewport, document and client widths both measured345px with the scrollbar, the story preceded the pitch and disclosures were closed. Screenshot capture was unavailable; geometry and text checks do not certify visual quality. The normal viewport was restored.

After generation, availability refresh preserves successful output and its ready message, while a newly exhausted counter disables further AI requests. A labeled mock-provider browser check confirmed successful outputs survive exhaustion and keyboard focus moves from the disabled recap button to its evidence summary. These checks made no model calls. The runtime counter is now also excluded from Docker build context. The preceding full suite passed410 Node checks with one Windows symlink-creation skip, and fourteen actual SDK transport mocks passed. Offline story/recap checks had no failures; all twelve fixture variants had no contract errors or configured heuristic warnings. Model, football and independent viewer quality remain unverified beyond the recorded spot checks.

## Four Astra reviews: next product priorities, October 7

Four independent source reviews covered fan experience, challenge compliance, studio production and real-world impact. These are expert code reviews, not participant research or evidence of market demand. The official rules were checked against Microsoft's repository on October 7.

The common strength is correction-aware consistency across facts, selected scenes, stories and recap. The main gaps are meaningful football interpretation, purposeful agent contribution, a completed producer task, football plausibility and independently verified usability/judge access. Feature count is not the next success measure.

Product direction: help a returning fan understand what changed and how the key chance developed, while giving a producer a reviewable, evidence-linked version of that same story. This shares one intelligence pipeline but requires different presentation depth. Do not claim a unique market moat, validated user benefit or live production readiness.

Priorities and acceptance gates:

1. Fan journey: return, see current score, catch up on three chronological highlights, inspect one buildup, and resume. Normal replay speed must permit reading. Player mode must explain how to choose a player and distinguish unknown identity from zero activity. Story language must be described honestly and marked for assistive reading. Test selected-time versus replay-time comprehension and keyboard/mobile operation with actual viewers.
2. Football meaning: add one bounded comparative story over equal received-event windows, describing a change in recorded chance creation without inferring pressure or tactical causation. Include supporting counts, boundaries and coverage. Quiet/insufficient cases abstain; an affecting correction changes or removes the comparison. Validate with structurally different authored passages and an independent football-literate reviewer.
3. Producer task: candidate, review, approve/reject, assemble a short local rundown. Decisions attach to exact audience/language and evidence versions. Corrections supersede affected approvals and identify affected exports; unrelated approved items remain stable. This is review preparation, not autonomous broadcasting.
4. Agent value: compare deterministic selection, a single canonical fact selector and selector plus reviewer using the same catalogs, mandatory coverage and hard validators. Report task relevance, omissions, refusals, latency and tokens; application-detected problems are separate from model-discovered issues. Extra roles stay only when they add observed value.
5. Independent proof and delivery: prepare counterbalanced fan tasks and a producer correction task; recruit actual participants separately rather than substitute subagents. Record individual results and disclosed small sample sizes. Verify installation and one actual generation on another computer. Publish only when authorized; prepare the public repository, English material and under-two-minute video, with free judge access through November 10.

Immediate implemented responses: default replay is now 1x; Player follower without a selection gives a Choose a player action that opens and focuses the selector; the paused return control says Return to current moment; player-follow shots share supported outcome wording and reject conflicting same-revision categories. A received-event team comparison module is prepared and tested but not yet added to the main interface; its role should remain subordinate to the primary journey.

Deferred: video analysis, additional languages, arbitrary momentum scores, autonomous live publishing and specialized accessibility benefit claims. Native-language review, intended-user accessibility evaluation and real football plausibility remain external validation needs. Do not treat Azure inference as cloud app hosting.

Verification: 426 Node checks passed, one Windows symlink-creation test skipped, zero failures. The player-selection prompt and focus action were checked in the project browser. No AI provider calls were made for this review response.

## Prepared comparison and formative test materials, October 7

Status: materials prepared; no participant recruitment, sessions, human ratings or new provider calls have been performed for this work. The user chose to prepare test materials first. Automated tests and subagent reviews are not participant feedback. The proposed gates below are decisions for a small formative study, not achieved results or statistical claims.

### Fixed-catalog implementation comparison

Run `node canonical-comparison-cli.js` to save a JSON report under `artifacts/evaluations/`. This command is strictly offline: it reads no provider configuration and rejects provider flags. It records the actual inputs, complete bounded fact catalogs and hashes, shared coverage requirements and slot limits, deterministic baseline selections and canonical claims. The two model arms are explicitly skipped and every human rating starts null. An offline run establishes preparation and structural validation only.

The three arms are a disclosed deterministic ranking, a single selector, and a selector plus editorial reviewer. Every arm uses the same received event sequence, score, patterns and measurements through `createInvestigationTools`, then the same `storyFacts`, `requiredStoryTools`, `storyRequirements`, `storyContextRequirement` and `renderFactStory` code. Both AI arms allow one repair; only the reviewer arm adds editorial judgments. This is an isolated fixed-catalog ablation, not a run of the production dynamic tool-selection workflow and not a test of tool-discovery skill. The deterministic ranking prioritizes required facts plus one relevant context; it is not a proven optimal editorial baseline.

The injectable library interface is `runCanonicalComparison({cases, completion, maxModelCalls: 6, providerLabel, timeoutMs})`. The callback receives `{role, payload, prompt, signal, arm}`; role is `selection` or `review`. Payload includes the detached catalog, requirements, audience context requirement, maximum slots, preferences and scope, plus the attempt/repair issues or selected claims. It returns `{content, usage: {promptTokens, completionTokens}, refused}`; content is an object or JSON string. No live adapter is supplied until the caller integrates the existing shared persistent request budget. The global report cap is six model calls and the deadline is at most sixty seconds. These limits do not replace provider spending controls. Use one case per provider report so the global cap can cover both AI arms; a budget-exhausted later arm must not be counted as equivalent coverage.

Each attempted selection retains selected IDs, mandatory/context omissions and application acceptance. Application issues remain separate from reviewer-discovered editorial issues. Reports include withholding, explicit refusal, call count, measured elapsed time, reported token totals and whether token usage is complete. A failed transport is not a successful abstention. No model-produced prose enters claims; the application renders every arm. Blind human assessment should compare the arms on useful context and comprehension, not differences in fluent wording. Record all failures and all cases; do not report only successful outputs or derive an accuracy percentage from structural validity.

Before a real comparison, freeze six to eight independently reviewed cases and the scoring rubric. Include a completed buildup, pending action, corrected score, quiet period, missing or delayed evidence, and a player-relevant action. Existing CLI cases prepare pending, corrected, spatial and unavailable-anchor checks; they do not by themselves constitute this full independent set. Use the same provider/model settings and evidence in the AI arms. Rotate arm execution order across cases if latency is compared; the current library order is fixed and is unsuitable for causal latency claims without that control. A football-literate human should blind-rate relevance, redundancy, unsupported inference and major omissions. Native-language quality needs a native speaker; leave that field null otherwise. Keep an extra role only when observed task benefit or useful error recovery justifies its added latency/calls beyond the shared hard checks.

### Fan sessions: five or six actual participants

Recruitment and consent are still required separately. Invite a mix of casual and regular football viewers; record self-described familiarity, device and relevant access preferences. Avoid collecting unnecessary personal data. Ask permission before recording a session. Use anonymous labels F01–F06; these are blank slots, not enrolled participants. No outreach has been sent.

Prepare two equivalent synthetic passages with different teams/timings/outcomes, frozen before sessions. Presentation A is a plain chronological received-event feed; B is Infinite Stadium with the same received information. For alternating participants use A-then-B or B-then-A, and rotate which passage appears in each presentation. Do not show the identical answer twice and call the resulting familiarity a product benefit. Conduct the first task without interface training. Then explain any blocked control and record that help was needed. Keep AI off for this initial UX comparison; separately disclose any later cached or actual AI output.

Use the following fixed task script, with expected answers derived independently from each frozen received snapshot:

1. “You have returned after a break. Tell me the current score and the most important change since you left.” Start timing when the view appears. Record the first answer verbatim, time, action count and any help. Correct answers must use received current revisions rather than future or withdrawn events.
2. “Show me how this chance developed. What do the recorded events tell you?” Record whether the participant identifies the relevant recovery/pass/shot sequence and uses the linked visual. Ask “What does this evidence not tell us?” Record unsupported claims about intent, pressure or causal certainty separately from simple factual mistakes.
3. While an earlier moment is selected, ask “Which time does this story describe, and what is the current replay time? Continue following play.” Record confusion, help, and successful return. Repeat with keyboard-only operation or the participant's normal narrow phone layout where appropriate.
4. Introduce the same labeled received correction in both conditions. Ask “What is the current account now? Is the earlier statement still valid?” Record correction discovery, understanding and any stale statement treated as current. Do not imply the simulated correction was spontaneous real-match footage.
5. Ask the participant to choose a player and find a recorded action. Include a player with no received identity/action at the cutoff. Distinguish “not yet observed” from “did nothing.” End with open feedback: “What helped? What slowed you down? When, if ever, would you use this?” Do not lead with feature names or ask whether the product is innovative.

Blank observation record, one per participant/condition/task: participant ID; familiarity; device/input method; condition and passage ID; order; consent recorded (yes/no); first response verbatim; elapsed seconds; actions; help required; task success (yes/no/unclear); current-versus-selected-time error; unsupported inference; correction understood; effort rating 1–5; preference and reason; observer notes. Leave missing observations null, not zero. Publish individual task outcomes and the denominator; store identifying or consent details separately from public artifacts.

Proposed formative gate: at least five of six participants (or four of five if only five attend) correctly state score and key sequence within thirty seconds without assistance, and all understand the current corrected account after the correction task. Report both target and observed results, including failures. The small convenience sample can reveal problems; it cannot establish broad demand, accessibility benefit, market size, or a statistically reliable treatment effect. If the gate fails, revise the specific confusing interaction and retest it rather than adding unrelated features.

### Independent football and producer tasks

Ask at least one football-knowledgeable reviewer, independently of the fixture author, to examine the frozen passages before fan sessions. Provide event/sample timing and the visible explanation, but hide expected story labels. Ask them to mark implausible movement, possession transitions, reset artifacts, ambiguous measurements, missing context and unsupported causal language. Record each issue and whether it was fixed or remains a limitation. This is qualitative plausibility review of synthetic passages, not validation of a professional-match simulator.

If two or three actual match-content creators/producers are available later, use anonymous slots P01–P03 and counterbalance a manual plain-feed task against the studio workflow. Task: prepare a short explanation and three-item rundown for a specified audience; then process one received correction affecting a selected item while leaving an unrelated item unchanged. Record completion time, manual edits, review/approval steps, missed corrections, stale approved/exported claims and the accuracy of the final rendition. Ask what artifact they can actually use in their existing process. A downloadable JSON file alone does not establish operational fit. Report producer benefit as untested if no producers participate; developer role-play cannot replace them.

No specialized accessibility claim will be inferred from sighted participants or automated checks. Any later accessibility study must involve intended users, and any translation-quality claim needs native review. All materials stay local until separate publication authorization. The study needs real people to establish user benefit; the present deliverable is the reviewable protocol and offline comparison preparation.


## October 14 frozen conversation evaluation

`conversational-evaluation-cli.js prepare --repeat=2 --out=FILE` creates a versioned case plan and hashes the actual prompt-bearing and root JavaScript sources, including uncommitted changes. The separately authorized live runner accepts `--live --plan=FILE --repeat-index=1` (and 2), rejects changed builds, retains every failure, and records model outputs, schema names, usage and timings. The daily persistent ledger is shared with the website; it is never reset for evaluations.

Score saved reports with the offline `score --plan=FILE --report=FILE --out=FILE` command. Explicit reviewer records distinguish automated adjudication from actual human review. Successful generation alone has no correctness score. Frozen cases are candidate holdouts; after using failures to tune the system, label them regression cases and prepare a new holdout before making generalization claims.

For the reviewer-contribution audit, compare the original analyst draft against the final answer on the same evidence. Attribute deterministic validation catches separately from reviewer catches, and record introduced refusals, repaired errors and missed errors. This paired contribution check is not an independently generated single-agent ablation. No human participation or reviewer advantage is implied by running these tools.
