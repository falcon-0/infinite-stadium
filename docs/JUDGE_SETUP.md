# Run and review Infinite Stadium

## Local replay

Use Node.js 24, extract the source and run `node server.js`. Open http://127.0.0.1:4173/. No account, Python environment or installed model is required for synthetic playback.

Choose a match and press Play. The fixed 2× replay contains a two-minute authored passage. Score, statistics and narratives follow received events. At the end, View recap opens a recorded summary.

## Live AI

Live questions require server-side Azure configuration. Copy placeholders from `.env.example` into a private `.env.azure`, configure a compatible Azure v1 Chat Completions deployment, and run `npm run start:azure`. Never commit or distribute the private file. The public demo uses a separately supplied access code; the code and provider credentials are intentionally absent from source.

Ask during playback. The question retains its captured time while playback advances. A moment link is an optional navigation action, not an automatic pause. Follow-ups use bounded earlier user context and the current requested snapshot. Switching fixtures or rewinding must not admit stale future answers.

In Viewing options choose a language and Apply view. Supported statistics, narratives, recaps and future answers change language; previous conversation turns retain their original language. Some navigation and rules references remain English.

## A useful review sequence

1. Play Northbridge–Harbour and ask about a completed action while the clock continues.
2. Ask a short follow-up and inspect its moment link.
3. Compare a pending outcome with the later received confirmation. In this fixture the shot at01:56 is confirmed at01:58.
4. Apply Spanish and ask about the scorer and assist after confirmation; inspect the recap.

These are suggested review tasks, not prerecorded substitute model outputs. Questions remain open text.

## Reproduce checks

Run `npm test`, `npm run validate:data` and `npm run verify:release`. The full release verifier also needs Python3.9+. It makes no provider calls. Browser checks require Playwright as described in the CI workflow and validation document.

For a source archive run `python package_judge.py`, then `python verify_judge_package.py`. The verifier validates hashes, extracts to a fresh temporary folder, starts its own loopback server, requests the module graph and checks pending/confirmed state. It installs nothing and does not use private Azure configuration.

## Limits

This is a schematic synthetic replay, not a real-match stream. AI responses can be slow or fail; unavailable AI is explicitly reported. Source consistency does not prove a real-world fact. Selected automated checks are not a human study or universal correctness guarantee.
