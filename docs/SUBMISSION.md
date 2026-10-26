# Submission draft

## Pitch

Infinite Stadium helps football fans understand the moment they are watching without missing the next play. Ask a question in your own words while a synthetic match continues. The assistant answers against the evidence available at the captured timestamp and offers a route back to the supporting moment.

## Implemented

The Watch experience combines twenty synthetic fixtures, a schematic replay, compact statistics, timed narratives, open Azure conversation, bounded follow-ups and recaps. Source queries compute supported quantities and event order; a separate model review checks relevance and support. Late corrections and confirmations are handled at their received time. English, Spanish, French and Portuguese content paths support personalization alongside audience detail and club preferences.

These are authored two-minute passages with fictional teams and players. There is no licensed match footage, automatic video recognition, full-match player award or calibrated winner prediction. Navigation and some general rule references remain English. Studio is not in the submitted user journey; legacy modules remain in source for reproducibility.

## Five-stage challenge fit

| Stage | Implementation |
| --- | --- |
| Ingest | Synthetic events, metadata and tracking with arrival times and revisions |
| Interpret | Received-state statistics, event queries and ordered action links |
| Explain | Supported match facts, contextual interpretation and precise uncertainty |
| Render | Watch replay, synchronized statistics, short narratives and moment links |
| Personalize | Audience detail, club preference and supported language content |

## Microsoft integration and prize fit

Azure OpenAI supplies hosted model inference. Our Node.js orchestration coordinates semantic planning, read-only match queries, source-backed answer composition and an independent model review. Current event revisions, captured timestamps, typed quantity proofs and bounded repairs keep answers connected to the available match evidence. Vercel hosts the application; Upstash persists access sessions and usage reservations.

The project addresses the overall match-intelligence challenge and its five-stage pipeline. The official rules distinguish overall Grand Prizes from four Category Prizes. An enterprise adoption path would build on the implemented access controls, usage limits and traceable evidence, starting with a controlled streaming pilot; production service commitments and measured adoption would need validation. The inspected portal has not confirmed a separate category selection. Category fit is not a claim of enterprise deployment or a prize prediction.

## Equal-weight judging criteria

Technology: reproducible source, CI, protected public AI and durable model reservations. Agentic design: semantic planning, read-only tools and separate answer review with bounded repair. Impact: ask about a moment while viewing continues. UX: focused Watch layout and optional deeper evidence. Category: the five-stage synthetic-data pipeline above.

Working code and selected checks support these claims. Internal reviews are not organizer scores; broad reliability, comparative superiority and measured fan benefit are not established.

## Delivery checklist

- Public website: https://infinite-stadium-lime.vercel.app/?view=watch . Supply the judge access code through the permitted submission field, not this repository.
- Source: https://github.com/falcon-0/infinite-stadium . The approved source cleanup is merged. Validate any later runtime changes before updating the published source or website.
- Demo: [approved 118-second Watch-only video](https://youtu.be/Ay6WmVt-LIA), uploaded as Unlisted on October 25. The film includes actual app footage, captions, English translations of the French and Spanish examples, and credited sound effects. Some recorded response waits are shortened in the edit.
- Availability: verify the configured Azure account, remaining credit and quota through the organizer's judging window.
- Project page: the video URL is saved in the description, alongside the website and public repository. The title, tagline, keywords, description, challenge and Writing Code fields were checked on October 26. The outdated player-selection claim was removed. No final Submit action was clicked; the inspected portal exposed no separate final-submit control or confirmation, so final competition status must not be inferred from saving the description. With owner approval, AI testing and unlock instructions were saved in the visible project description on October 26. The access code is not duplicated in this repository.

See README, JUDGE_SETUP and EVALUATION_EVIDENCE for implementation and verification details. Do not claim a selectable-player control or fully translated interface without checking the actual current product.
