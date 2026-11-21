# Overblik

A personal overview: capture box, today's blocks, next-up per block, Tankebænken stones, backlog.
Single-file PWA, no build step. Served from GitHub Pages; all data lives in a private data repo (`overblik-data`).

- `index.html`: the app. Settings (GitHub user, data repo, Tankebænken repo, branch, fine-grained token on both repos) are stored in the browser only.
- `manifest.webmanifest`, `icon-180.png`, `icon-512.png`: home-screen install.
- `sw.js`: service worker. Caches the shell so the app opens offline, and shows the evening push. Bump `CACHE` on every deploy.
- `tests/test_log.js`: block-by-block logging on Today (one tap per block, item by item in Praktisk, Hus and Fremtid, log.json merged per row). Run `node tests/test_log.js`.
- `tests/test_beach.js`: the Beach card from beach.json (7 days, grouping, stale and blocked notes). Run `node tests/test_beach.js`.
- `tests/test_capture.js`: the block guessed while typing (his own past filing first, seed words second, Praktisk without a signal; a tapped chip wins). Run `node tests/test_capture.js`.
- `tests/test_tb.js`: Tankebænken folded in (journal, reading and library, ideas) against a mocked tankebaenken-data repo in the old app's format. Run `node tests/test_tb.js`.
- `tests/test_push.js`: the service worker, offline opening and the push opt-in, served over a local http server with the push service stubbed. Run `node tests/test_push.js`.
- `tests/test_sync.js`: Playwright test against a mocked GitHub API. Covers sync, conflicts, offline queueing and the template week. Run `node tests/test_sync.js`; exit code 0 means every check passed. Needs `npm install playwright` and `npx playwright install chromium` once.

This repo is public, so it holds no personal data. The week shown under Today is read from `template.json` in the data repo and cached in the browser; without it the app shows an empty day. The public VAPID key in `index.html` is public by design; its private half is a secret of the data repo's Action. The contracts for all data files are in `overblik-data/HUB.md`.
