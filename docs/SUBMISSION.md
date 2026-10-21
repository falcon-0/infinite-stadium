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

## Equal-weight judging criteria

Technology: reproducible source, CI, protected public AI and durable model reservations. Agentic design: semantic planning, read-only tools and separate answer review with bounded repair. Impact: ask about a moment while viewing continues. UX: focused Watch layout and optional deeper evidence. Category: the five-stage synthetic-data pipeline above.

Working code and selected checks support these claims. Internal reviews are not organizer scores; broad reliability, comparative superiority and measured fan benefit are not established.

## Delivery checklist

- Public website: https://infinite-stadium-lime.vercel.app/?view=watch . Supply the judge access code through the permitted submission field, not this repository.
- Source: prepare the current clean source publication, verify its parity and publish the approved repository URL. The current local checkout has no configured Git remote.
- Demo: final Watch-only video, under two minutes, with actual app footage, captions and approved sound. YouTube upload and owner approval remain pending.
- Availability: verify the configured Azure account, remaining credit and quota through the organizer's judging window.
- Final form: verify current required fields, links and rules before the owner submits. No final submission has been performed.

See README, JUDGE_SETUP and EVALUATION_EVIDENCE for implementation and verification details. Do not claim a selectable-player control or fully translated interface without checking the actual current product.
