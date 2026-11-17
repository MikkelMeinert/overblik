# Overblik

A personal overview: capture box, today's blocks, next-up per block, Tankebænken stones, backlog.
Single-file PWA, no build step. Served from GitHub Pages; all data lives in a private data repo (`overblik-data`).

- `index.html`: the app. Settings (GitHub user, data repo, branch, fine-grained token) are stored in the browser only.
- `manifest.webmanifest`, `icon-180.png`, `icon-512.png`: home-screen install.
- `tests/test_sync.js`: Playwright test against a mocked GitHub API. Covers sync, conflicts, offline queueing and the template week. Run `node tests/test_sync.js`; exit code 0 means every check passed. Needs `npm install playwright` and `npx playwright install chromium` once.

This repo is public, so it holds no personal data. The week shown under Today is read from `template.json` in the data repo and cached in the browser; without it the app shows an empty day. The contracts for all data files are in `overblik-data/HUB.md`.
