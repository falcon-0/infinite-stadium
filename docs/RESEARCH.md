# Infinite Stadium research and decision record

Research date: 3 October 2026. Status: candidate selection, not a final product commitment.

This record helps the solo developer choose an ambitious but demonstrable entry for Inside the Game. The current local prototype is a six-minute synthetic event replay with deterministic commentary. It does not yet implement AI investigation, continuous positional simulation, narration, correction propagation, or a production broadcast integration.

The current recommendation is to validate an interactive match explanation experience with an evidence and correction engine underneath it. A broad AI newsroom overlaps substantially with existing products. An independent market review must not interpret a vendor's silence about a feature as proof that the feature is missing.

## Research method and limits

Three parallel research tracks examined competition winners, competitors and user needs, and rules and feasibility. The primary review also looked for counterexamples to the proposed novelty. Sources include organizer announcements, original project submissions, vendor documentation, research manuscripts, and RNIB user research.

An award announcement verifies an award. A submission or vendor page describes claimed capabilities; it does not independently establish performance, adoption, or why judges selected it. Winners alone cannot reveal whether a feature caused success because comparable losing submissions and private scoring are unavailable. No claim of exhaustive coverage of all past winners is made. No interviews, product trials, model benchmarks, or simulator installation experiments have been completed during this research.

## Winner mechanisms worth adapting

Microsoft's [official 2025 winners list](https://microsoft.github.io/AI_Agents_Hackathon/) verifies seven category awards. The adaptations below are design proposals, not findings about what caused those wins.

| Winner | Source describes | Proposed adaptation |
| --- | --- | --- |
| RiskWise, overall | Explainable procurement risk monitoring | Follow developing stories and uncertainty over time. |
| Apollo, C# | Collaborative research and knowledge-gap checks | Investigate missing evidence before drafting a claim. |
| Bits2Brain, Java | Linked knowledge and visual navigation | Connect a story to supporting events and scenes. |
| WorkWizee, Copilot | Actions across operational tools | Publish an approved scene and manage its subsequent revisions. |
| ModelProof, JavaScript/TypeScript | Response comparisons and audits | Show validation results; compute facts independently of the language models. |
| TARIFFED, Azure AI Agent Service | Structured domain data and callable tools | Query match statistics through typed, constrained tools. |
| Konveyor, Python | Contextual explanations and learning gaps | Let audience preferences affect detail and terminology. |

Original submissions: [RiskWise](https://github.com/microsoft/AI_Agents_Hackathon/issues/526), [Apollo](https://github.com/microsoft/AI_Agents_Hackathon/issues/681), [Bits2Brain](https://github.com/microsoft/AI_Agents_Hackathon/issues/638), [WorkWizee](https://github.com/microsoft/AI_Agents_Hackathon/issues/587), [ModelProof](https://github.com/microsoft/AI_Agents_Hackathon/issues/517), [TARIFFED](https://github.com/microsoft/AI_Agents_Hackathon/issues/349), [Konveyor](https://github.com/microsoft/AI_Agents_Hackathon/issues/645).

The WorkWizee submission distinguishes pending integrations from implemented ones. Claimed time savings should not be treated as independently established. Some organizer showcase descriptions use speculative implementation language; the original submissions are better evidence for what authors actually described.

Sports precedents include [SoccerVision](https://paris.aitinkerers.org/hackathons/h_FwbOwyDjzgU/entries/ht_XaHbga4cZes), a second-place Paris AI Tinkerers project describing video analysis and commentary, and [Ghostbusters](https://edge-operations.nfl.com/programs-initiatives/innovation/big-data-bowl), the NFL's 2026 Big Data Bowl winner using hypothetical defender distributions. These establish relevant precedents, not validation of our soccer model or our integration.

## Competing capabilities

| Source | Documented or claimed overlap | Implication |
| --- | --- | --- |
| [Premier League Companion](https://www.microsoft.com/en/customers/story/25725-premier-league-azure-ai-foundry) | Match retrieval, conversational exploration and personalized content | Football chat and audience feeds are established. |
| [Bundesliga and AWS](https://aws.amazon.com/ai/generative-ai/customers/bundesliga/) | Story discovery and multilingual live commentary | Automatic story generation alone is not distinctive. |
| [OptaAI Studio](https://www.statsperform.com/products/opta-ai-studio/) | Research, narrative validation, live discovery, graphics and highlights | Our previous broad studio pitch has a close commercial precedent. |
| [Sportradar AI Researcher](https://developer.sportradar.com/broadcast/reference/ai-researcher-overview) | Official live data, complex queries, content, API and MCP access | Tool-based sports research is established; the listed coverage is US sports, not soccer. |
| [Deltatre DIVA](https://documentation.deltatre.com/docs/diva-platform) | Synchronized overlays, timelines, commentary, captions and alternate audio | Synchronization and alternate views are valuable implementation requirements, not novelty claims. |
| [WSC Sports](https://wsc-sports.com/platform/) | AI analysis and personalized content production | Recaps and distribution complete our workflow but cannot anchor differentiation. |
| [Beyond Sports](https://www.beyondsports.nl/news/statsperform-englishpremieleague-beyondsports-ddegf-m2gtp-58wsl-s4mmp-jfnrg-grxn5-tapkm) | Tracking-driven virtual recreations | A virtual pitch is a medium for explanation. |
| [Neuron Systems and NVIDIA](https://www.nvidia.com/en-us/case-studies/neuron-systems/) | Multi-agent commentary, multilingual audio and auditable traces | Agent personas and audit logs already have a direct precedent. Vendor-reported performance was not independently replicated. |
| [LiveCast Studio](https://www.livecaststudio.com/) | Source-dated facts, uncertainty and a producer cockpit | Even source-visible commentator assistance has a direct marketing precedent; adoption is unverified. |

The research did not establish an incumbent's exact equivalent to cross-output claim invalidation. It also did not establish that incumbents lack it. Correction propagation is a testable design hypothesis, not a defensible world-first claim.

## Research precedents and user evidence

[TacticAI](https://deepmind.google/blog/tacticai-ai-assistant-for-football-tactics/) investigates corner-kick alternatives with Liverpool FC. It does not validate a generic language model as a full-match tactical predictor. We should initially show deterministic geometry and explicitly simulated branches rather than uncalibrated goal probabilities.

[Sporthesia](https://arxiv.org/abs/2209.03434) links language to sports visualizations. The author-hosted [InsightChaser manuscript](https://ssxiexiao.github.io/papers/insightchaser.pdf) describes visual-text links, knowledge graphs and interactive tactical explanation. Consequently, combining an LLM, a graph and pitch annotations is not by itself a novel research contribution. The manuscript was reviewed as an author source, not proof of independently replicated performance or publication status.

RNIB's [first 2022 focus group](https://media.rnib.org.uk/documents/RNIB_first_focus_group_on_accessibility_of_football_broadcasts_2022.pdf) involved six participants with varying sight loss. Participants described missing spatial detail and synchronization problems; preferences about commentary density differed. The [second focus group](https://www.rnib.org.uk/documents/1945/RNIB_second_focus_group_on_accessibility_of_football_broadcasts_2022.pdf) adds evidence on descriptive commentary. These small qualitative studies motivate co-design; they do not establish demand for our AI product or a preference for synthetic voices. [RNIB's June 2026 update](https://www.rnib.org.uk/news/making-sport-more-accessible-from-broadcast-to-live-experience/) describes continuing work and user research in accessible sports broadcasting.

Design implication: expertise and accessibility are independent settings. A blind supporter may be a tactical expert. Audio-first must not mean beginner mode. An audio description must describe only available data; event feeds do not reveal gestures, expressions or stadium atmosphere.

## A documented data problem

[Sportradar's API basics](https://developer.sportradar.com/soccer/docs/soccer-ig-api-basics) explicitly describe event corrections and statistical revisions. Its [extended timeline documentation](https://developer.sportradar.com/soccer/reference/soccer-extended-sport-event-extended-timeline) distinguishes system processing timestamps from on-pitch time and notes later additions and corrections.

Proposed response: record both event time and arrival time, preserve revisions, and link every published claim to the input versions and calculations it used. A delayed event must not leak backward into what the system supposedly knew earlier. A revision should invalidate dependent content without changing unrelated content.

Source consistency is not absolute truth. If a source is wrong and never corrected, our system cannot guarantee that its supported claim is true. The interface should describe support and uncertainty rather than display a misleading universal truth badge.

## Candidate comparison

The assessments below are qualitative judgments, not objective scores or winning probabilities.

| Candidate | Advantage | Principal risk | Proposed disposition |
| --- | --- | --- | --- |
| Complete autonomous broadcast network | Large visual ambition | Strong incumbent overlap, speech timing and huge scope | Retain as long-term vision. |
| Tactical counterfactual laboratory | Analytical depth | Credibility depends on a validated model and rich positions | Optional later experiment. |
| Interactive moment explainer | Visible fan benefit with a short demo | Existing visual-explanation research; utility needs testing | Lead prototype candidate. |
| Accessible match companion | Direct qualitative evidence of unmet needs | Requires co-design and cannot assume preference for AI | Test as a first-class audience mode. |
| Correction-aware publishing engine | Clear engineering evaluation | May matter more to producers than viewers | Shared foundation and secondary demonstration. |
| Synthetic football agent benchmark | Reproducibility and reusable developer artifact | Weak fan-facing demo by itself | Companion artifact, not main product. |

## Proposed product and user journey

Working product: Infinite Stadium, a producer-assisted interactive match explanation studio. Proposed first buyer: a digital match-centre or studio producer. Proposed first end user: a fan who wants an explanation of a specific moment. Neither willingness to pay nor adoption is validated.

The primary action is Explain this moment. The system chooses the relevant received sequence, computes supporting quantities, drafts a bounded explanation, constructs a synchronized scene from approved visual primitives, and provides a producer preview. Viewers can select detail level, language, presentation format and player interest independently. A concise recap is assembled from approved story versions.

The first demo should lead with an interesting football sequence. It should then show two genuinely different explanations and one correction flowing through affected graphics and recap content. An accessibility mode should be presented as experimental until tested with intended users. Already-spoken audio cannot be undone; obsolete queued speech can be cancelled and a concise correction can be issued.

## Decisions still open

- Whether the best initial audience is general fans, analysts or people needing richer description.
- Whether target users value evidence inspection enough to use it during a match.
- Whether the correction workload is frequent or costly enough to support a distinct commercial product.
- Whether a specialist-agent workflow beats one tool-using agent at acceptable latency and cost.
- Whether an existing simulator is practical in this environment, and what export and licensing conditions apply.
- Whether Azure access, model quotas and any hackathon credits will be available in time.
- Whether interactive scenes can be generated reliably without manual authoring for each test scenario.

No external outreach was sent, no accounts were provisioned, and no product implementation was changed by this research.

## Fan presentation research, October 5, 2026

This follow-up responds to the user's concern that the prototype asks people to handle too many options and too much data. The sources below were reviewed alongside the current stream UI. These are design hypotheses and a proposed evaluation; no fan interviews or usability sessions have been conducted. Earlier research and its dated account-status statements are historical.

### Evidence and its practical limits

- [Nielsen Norman Group: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) recommends keeping frequent tasks visible and putting specialized options behind clear labels. Its guidance also warns against excessive disclosure levels. Application: hiding every feature in accordions is insufficient; decide which tasks deserve the first screen. This is general usability guidance, not a football user study.
- [Bundesliga: Match Momentum](https://www.bundesliga.com/en/bundesliga/news/bundesliga-match-facts-aws-match-momentum-34052) describes using the graphic at halftime/post-match and situationally during significant shifts or key events. Application: select meaningful moments instead of constantly adding statistics. Its five-minute offensive-activity method uses richer real-match inputs than our fixture; neither the formula nor its validity transfers to our synthetic data.
- [Premier League/Microsoft customer story](https://www.microsoft.com/en/customers/story/25725-premier-league-azure-ai-foundry) describes personalized, contextually relevant fan experiences built from multiple data sources. Application: emphasize relevance to a club, player or question. This vendor case study does not establish that our proposed layout improves comprehension.
- [NN/G: choosing chart types](https://www.nngroup.com/articles/choosing-chart-types/) starts from the point the audience should understand, then chooses a visual to communicate it. Application: use a buildup diagram for a sequence, paired bars for a team comparison and a timeline for change over time. A large pitch is justified only when location helps answer the question.
- [W3C: Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide) explains distraction from changing content and user control over auto-updates. Application: stabilize a story while it is being read and make returning to current play explicit. Our existing pause control is only part of an accessibility assessment; conformance has not been established.

### Users and tasks to test

| Context | User question | First useful output | Optional depth |
| --- | --- | --- | --- |
| Casual fan following play | What just changed, and how did that chance develop? | Score/time and one concise story with a relevant visual | Buildup sequence and understandable supporting facts |
| Fan returning after a break | What did I miss? | Short chronological catch-up of key moments | Open a moment or the full recap |
| Analyst exploring a moment | What evidence supports this interpretation? | Same selected moment with comparable quantities and explicit intervals | Event revisions, formulas and underlying samples |
| Studio producer preparing an output | Is this current, supported and suitable to publish? | Preview, timing and review state | Evidence, agent trace and correction controls in a separate workspace |

The proposed primary path is the casual fan's moment-comprehension task. The analyst and producer need different depth and controls; they should not share a default screen full of technical tools. This is a scope recommendation, not validated demand or a final commercial buyer decision.

### Current interface risks

The current pitch renders 22 numbered tracks while the explanation concerns one moment. Relevant players are not clearly named on that graphic. Latest positions can be shown alongside an explanation of an earlier shot. A template card, deterministic paragraph and AI draft can repeat the same facts. Raw evidence IDs and execution metadata remain prominent once a draft is opened. Even a collapsed Testing tools panel presents engineering concepts to viewers. A long AI wait can become the main interaction, although recorded context is already available.

These observations come from code review and prototype inspection, not observed fan behaviour. We should test whether they cause confusion rather than claiming that they do for every viewer.

### Proposed first-screen contract

Show the teams, score and match time; one current story; one visual that directly explains that story; and a clear action to explore its buildup. Distinguish synthetic replay and recorded-moment time from current play. Do not repeat the same paragraph in several cards. Provide a short immediate recorded explanation; deeper AI wording is optional and remains marked as a draft until reviewed. Do not imply that a measured sequence establishes tactical causation.

For the existing early goal, a candidate headline is: "Northbridge scored eight seconds after winning the ball." A supporting visual would name Cole and Reed, highlight the received recovery/pass/shot sequence and dim unrelated players. Recorded endpoints must not be presented as reconstructed continuous trajectories. A short explanation and its visual refer to the same moment and revisions. Spatial values belong in optional detail unless they directly answer the viewer's question.

Keep personalization reachable without requiring setup before receiving value. Remember preferences only with an explicit product decision about storage. Offer a catch-up entry point when useful. Move developer diagnostics out of the eventual viewer route, while retaining them for engineering and producer review. During reading, keep the selected story stable; visibly indicate that it refers to an earlier time and offer a way back to current play. A correction should use plain language, with exact revisions available in evidence details.

### Compare two small designs before further polish

Candidate A is a story-first view: a concise headline, supporting buildup graphic and one detail action. Candidate B is a pitch-first view: a clearly labelled selected moment, highlighted participants and an attached story. Use identical received evidence and wording in both. Test desktop and a narrow phone layout. Avoid decorative charts, extra modes or an unvalidated momentum score during this comparison.

Recruit an initial small formative group of casual and regular football viewers, then evaluate the analyst/producer path separately. Five or six fan sessions is a proposed practical starting point, not a statistically representative sample or completed study. Counterbalance design order to reduce familiarity effects. Do not explain the interface before the initial task.

Ask participants to identify the score and relevant player, explain the recorded buildup, find what they missed, open support for a claim, and handle a correction without treating an obsolete version as current. Record task completion, time to first correct interpretation, wrong inferences, navigation errors and self-reported effort. Ask what the interface says and what it cannot establish; preference alone is insufficient.

Prototype targets to test: understand the main story within roughly ten seconds, reach supporting evidence with one action, and identify current versus selected-moment time correctly. These are proposed targets, not measured results or established UX standards. Repeated confusion about a player, timing or causation blocks acceptance even if participants prefer the visual styling. Use findings to choose the default layout and information hierarchy, then refine presentation. This research step made no UI changes and used no model credits.

## Alternative project directions and judging continuity

This comparison is an editorial assessment of possible directions, not evidence that any concept will win. No alternate product, accessibility study or customer validation has been completed. Keep the required ingest → interpret → explain → render → personalize pipeline in every candidate.

| Direction | Concrete demonstration | Distinction to test | Solo feasibility and risk |
| --- | --- | --- | --- |
| Studio producer agent | Select one significant received moment, gather facts, review a narrative, emit a timed overlay and withdraw it after a correction | Demonstrable correction handling and editorial restraint rather than another stats dashboard | Best reuse of current stream and agent. Needs genuine story selection, publication state, latency and reviewer evaluation |
| Accessible match companion | Describe the event and spatial context in plain language, offer captions and user-controlled audio, adapt detail level | Understanding and control for viewers who struggle with dense visuals | Strong impact hypothesis; co-design with intended users essential. Do not copy proprietary haptic hardware or claim accessibility from speech alone |
| Catch-up director | Explain what changed since a viewer's selected departure time, with a short personalized sequence and evidence | Useful context without making viewers read an entire timeline | Highly feasible using existing events/recap; must handle score corrections and distinguish historical from current state |
| Synthetic broadcast testing platform | Generate scenario families, delayed corrections, missing packets and adversarial claims; evaluate narrative/overlay consumers | Reproducible evidence of system robustness for studios | Feasible developer product but must also demonstrate fan-facing rendering and personalization to meet the challenge |
| Tactical question explorer | Answer bounded questions about received buildup, show supporting samples and explicitly abstain on unsupported causal questions | Inspectable reasoning instead of confident tactical speculation | Medium feasibility; evidence coverage and football meaning are harder than chat UI. No unsupported counterfactual outcome claims |
| Personalized animated recap studio | Compose a short synthetic pitch animation, narration and captions from a selected sequence | A shareable explanation without needing licensed match video | Medium-to-high scope; synchronization/export add work, and video authoring already has substantial prior art |

Evidence informing the comparison:

- [Official rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md), §§4.1, 4.4 and 4.8: alternative forms are permitted, but a functioning project and public repository are required alongside a demonstration video under two minutes. Access can be a website, functioning demo or test build. Judges may choose not to test it. Testing availability lasts through November 10; November 20 is the announcement deadline, not the stated end of judging.
- [Bundesliga Match Momentum](https://www.bundesliga.com/en/bundesliga/news/bundesliga-match-facts-aws-match-momentum-34052): established broadcast analytics already provide offensive momentum and situational graphics. A generic momentum chart is therefore weak differentiation; we must not reproduce its football meaning with an unvalidated arbitrary score.
- [SportsBuddy research](https://arxiv.org/abs/2502.08621): the authors describe an interactive sports video storytelling system combining tracking, timeline views and visual cues, used by over 150 sports users. Animated explanation and authoring need a narrower distinctive benefit than simply combining narration and graphics.
- [OneCourt accessibility case](https://blogs.microsoft.com/accessibility/onecourt-revolutionizing-accessibility-in-live-sports/): combines live data, haptic spatial information and audio description, developed with blind and low-vision fans. The opportunity is meaningful but an accessibility claim requires intended-user evaluation; this prototype has no such evidence.
- [Pacers live captioning case](https://www.microsoft.com/en/customers/story/23957-pacers-sports-and-entertainment-azure-ai-foundry): demonstrates Azure-based live captioning for arena and mobile use. Captions alone are established practice; interpretation and synchronization would need to add value.
- [Azure account FAQ](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account): the trial credit lasts up to 30 days; without upgrading, services are disabled. The free offer is limited to one per new customer. A friend's separately owned, authorized resource is a possible technical configuration change, not a guaranteed entitlement or hosting solution.

Provisional recommendation: develop Infinite Stadium toward the studio producer direction, with catch-up as a focused audience feature. Preserve accessible plain-language presentation throughout; defer claims of specialized accessibility outcomes until co-design/testing. Do not build all six concepts. Validate correction recovery, supported claims, useful story selection and whether a fan understands the selected moment before expanding.

Continuity plan: retain the public-source/test-build path and a clearly labelled local provider; make Azure endpoint/deployment/credentials replaceable on the server. The current app is hosted on the user's computer, so replacing AI credentials alone does not make its website publicly available. Any alternate deployment must be tested before submission. Do not require judges to purchase services or rely on a static recorded result as a substitute for a working AI project. The current daily model-call limit and local-only inference restrictions still require a concrete judge-access plan before submission.


## Synthetic fixture contract research, October 6

Metrica's official sample documentation describes synchronized event/tracking records, a normalized coordinate scale, and a 105 by 68 metre pitch. Our authored events use a different 0 to 100 scale, while player/ball samples use metres; the validator explicitly tests that conversion. [Metrica documentation](https://github.com/metrica-sports/sample-data)

Provider event semantics cannot be borrowed blindly. StatsBomb's ball receipt records can describe intended receipt locations; our authored `receive` action explicitly means successful reception. The pass/reception tests therefore enforce this project's documented contract. [StatsBomb official specification](https://raw.githubusercontent.com/statsbomb/open-data/master/doc/StatsBomb%20Open%20Data%20Specification%20v1.1.pdf)

The implemented validator separates hard schema/consistency errors from configurable sample-rate warnings. It found and helped repair completed short-fixture passes whose endpoints still matched their starting location. Nine authored kind/seed variants now pass those checks. This is internal consistency evidence; no real Premier League data was imported, and no independent physical or tactical realism has been established. FIFA's external tracking tests illustrate the stronger reference validation needed for measured performance claims. [FIFA EPTS testing process](https://inside.fifa.com/innovation/standards/epts/epts-testing-process)


## Azure recap output contract, October 6

[Microsoft structured output documentation](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs) lists GPT-4.1 mini version 2025-04-14 and the v1 API as supported. The new recap uses strict JSON schemas for current fact-ID selection and editorial decisions. Microsoft lists array minItems, maxItems and uniqueItems as unsupported, so the server retains independent size, uniqueness, mandatory coverage, chronology and citation validation. The request schema restricts format and current IDs; it does not establish editorial usefulness or football truth. Selection and review output budgets are 256 and 384 tokens.
