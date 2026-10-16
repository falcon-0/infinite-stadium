# Infinite Stadium submission preparation

Updated October 16, 2026. The product now focuses on fans watching a synthetic match and asking questions without stopping playback. Studio has been removed from site navigation; former Studio links open Watch. Older producer demonstrations are historical and must not represent the final product.

## Project pitch

Infinite Stadium helps football fans understand the match as they watch. Follow a synthetic match, ask a question in your own words, and receive an answer tied to the moment you were watching. The match keeps playing. Azure AI interprets the question, retrieves match evidence and reviews the answer; the application computes supported statistics and ordered events. Fans can change their language, level of detail and player focus.

## What is built

- Twenty synthetic fixtures across five authored passage families, with fictional clubs and players.
- A schematic 22-player replay at fixed 2× demo pace, synchronized score, compact statistics and short contextual insights.
- Open Azure match conversation with pinned timestamps, bounded follow-up context and explicit event revisions.
- Received-event queries, server-computed calculations and a separate model reviewer. Incorrect assumptions and unsupported explanations must not become match facts.
- Personalization and English, Spanish, French and Portuguese match-answer support. Menus and curated general football-rule references still include English.
- Automatic recorded recaps; AI recap generation is a separate provider request.
- Vercel Hobby hosting, server-only Azure configuration and Free Upstash shared access sessions and model reservations. No paid account upgrade.

Automatic context, animation and recorded recaps are deterministic. The application is a synthetic-event companion, not licensed Premier League video streaming or video recognition. The legacy producer source remains in the repository for historical reproducibility, but is outside the submitted fan workflow.

## Judging rubric and evidence

| Criterion | Weight | Evidence and practical limit |
| --- | --- | --- |
| Technological implementation | 20% | Reproducible source build, CI on Windows/Linux, browser checks, persistent shared usage guard; long-term model availability still needs securing |
| Agentic design and innovation | 20% | Question analyst, read-only tools and independent reviewer with bounded repair; role count alone does not prove superiority over one agent |
| Real-world impact | 20% | Ask during uninterrupted viewing and revisit a pinned moment; real fan validation is still pending |
| User experience and presentation | 20% | Focused Watch experience, compact stats and optional preferences; final Watch-only recording and owner review pending |
| Category adherence | 20% | Synthetic events → interpreted facts → explanations → on-screen experience → personalization; category selection still needs owner review |

Latest Watch-only release: all eight local gates passed, 1,085 tests passed and one platform-specific skip. The old Studio-link redirect, responsive Watch layout, multilingual ordinal wording and isolated source-package checks passed. This does not certify broad AI answer quality.

Production checks confirmed health/assets, private-file blocking, login/logout, persistent reservations and terminal SSE. A real scorer question returned A. Reed at 01:56 using two model calls. A later bounded hosted check returned a Spanish scorer, Spanish follow-up assist and a cross-fixture Reed/Mensah correction; it also exposed awkward Spanish ordinal wording, now repaired locally. A malformed one-letter question returned a validation response. Saved reports retain failures and latency; these are developer checks, not independent fan testing or broad accuracy evidence.

The current trial is working. Hosting on Vercel does not extend Azure credits or trial duration. The authorized friend's trial has not been activated, and no account switch is being performed now. Cash remains $0. Continuity through judging is not secured yet.

## Submission links and fields

| Field | Current state |
| --- | --- |
| Innovation Studio project | https://innovationstudio.microsoft.com/hackathons/insidethegamedeveloperhackathon/project/126399 — profile exists; final entry not submitted |
| Public source | https://github.com/falcon-0/infinite-stadium |
| Website | https://infinite-stadium-lime.vercel.app — AI sign-in instructions belong in the private organizer field |
| Public demonstration video | YouTube selected; upload pending |
| Category | Provisional Best Multi-Agent System; demonstrate useful collaboration without unsupported comparative claims |
| Final source commit | Freeze after the current checks and owner review |

The final demo needs a Watch-only recording. Existing mixed Watch/Studio cuts are superseded. Astra is preparing a separate motion preview; captions and original sound effects remain the chosen format, with no voice-over required. Do not fabricate AI responses or shorten genuine response waits. Clearly distinguish an editorial diagram from functioning app footage.

## Remaining submission decisions

1. Complete the Watch-only release and production checks.
2. Review the final Watch-only video, then upload to YouTube and verify signed-out access.
3. Run the prepared final-stage fan tasks with actual participants and record their feedback honestly.
4. Verify model access through judging and test any later authorized account change.
5. Confirm eligibility, category, final fields and private judge access instructions with the owner; submit only after owner review.

Official rules rechecked October 16: https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md. Submission ends October 27 at 11:59 PM Pacific; judging ends November 10 at 11:59 PM Pacific. The video must be under two minutes, show the functioning project, and have a public URL on YouTube, Vimeo, Facebook Video or Youku. GitHub MP4 downloads are supplemental. A public GitHub repository and working judge access are required. Announcements are due by November 20. No final submission has been made.
