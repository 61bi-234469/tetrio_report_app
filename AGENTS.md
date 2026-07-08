# AGENTS.md

## Project Overview
- Unofficial TETR.IO Tetra League report generator ("戦績レポート for TETR.IO"). Public, MIT-licensed repository; not affiliated with TETR.IO / osk.
- Two editions live side by side:
  - **Web edition (current)** in `web/` — a Cloudflare Workers app. All new features go here.
  - **Python edition (legacy)** in `python/` — Windows GUI/CLI pipeline. Maintenance only; do not add features.
- Keep the unofficial notice, trademark note, and third-party formula attribution (TetraStats) consistent across `NOTICE.md`, `README.md`, `THIRD_PARTY_NOTICES.md`, and the report footers (`python/src/report_builder/content/partials/footer.html` and the web renderer) when touching related text.

## Web Edition (`web/`)
- Requires Node.js 22+. Run all npm commands from `web/`. In PowerShell, invoke `npm.cmd` / `npx.cmd` (the `npm.ps1` shims can fail under execution policy).
- `npm run dev` builds the client bundle and starts `wrangler dev` (default `http://localhost:8787`). Prefer `npm run dev:8788` — port 8787 is often occupied by a stray workerd, and `.claude/launch.json` (`web-dev`) and the skills assume 8788.
- `npm run check` runs typecheck + client build + vitest. Run it before committing `web/` changes; CI (`.github/workflows/web.yml`) runs the same.
- Deployment: pushing `develop` with `web/` changes auto-deploys the develop Worker `league-report-develop` via `.github/workflows/deploy-web-develop.yml` — a push to `develop` is a de-facto deploy. The production Worker `league-report` is released by merging `develop` into `main` and running `wrangler deploy` from `web/`. Deploy only on explicit user request; follow `.agents/skills/deploy-web/SKILL.md`.
- Architecture constraint: the Worker stays a lightweight proxy to the TETRA CHANNEL API (`/api/league-page`); aggregation and rendering run in the browser so the app fits the Workers free tier. Do not move heavy computation into the Worker.
- `web/public/report.js` is a build artifact (Git-ignored); edit the sources under `web/src/` instead.
- Tests live in `web/test/`, including golden tests (`python-golden.test.ts`) that keep metric parity with the Python edition. Fixtures are anonymized; raw pre-anonymization inputs belong in the Git-ignored `web/test/fixtures/raw/` only.

## Python Edition (`python/`, legacy)
- Targets Windows 10/11, Python 3.10+, PowerShell 5.1+. `python/レポート作成GUI.bat` launches `python/src/tetrio_report_gui.pyw`.
- Pipeline: fetch data with `python/src/api_export/tetrio_league_export.py`, then build the HTML report with `python/src/report_builder/make_report.ps1` (which owns `.venv` creation and dependency install).
- Keep the GUI a thin orchestrator; do not duplicate analysis or rendering logic in `tetrio_report_gui.pyw`. Keep metric formulas centralized in `tetrio_league_export.py` and `python/src/report_builder/scripts/report_analysis.py`.
- Validate with the smallest relevant command (the specific script or `make_report.ps1`) rather than the full GUI flow. Use `-Open` only when the user wants the report opened.

## Data and Privacy
- Never commit downloaded TETR.IO data, generated HTML reports, chart images, cache files, or virtual environments. `python/data/`, `python/reports/`, `python/gui_config.json`, `docs/`, `python/src/report_builder/{cache,charts,output,input,.venv}` are reproducible or local-only (see `.gitignore`).
- `docs/` holds local-only design notes and is Git-ignored; new plans and records go there, not into tracked files. Name new files `YYYY_MM_DD_<topic>.md`. After implementing a plan doc, append a dated results section (対応結果) to the same file: what was done, review findings and their resolution, and verification results — including any verification step that could not be completed and must be redone.
- `your_username` is the placeholder player identifier in defaults, docs, and samples. Do not commit real TETR.IO handles, opponent data, or other personal identifiers into tracked source or fixtures.
- Exception: `61bi_234469` is the repository owner's own TETR.IO handle and may appear in checked-in sample reports when the owner explicitly permits it. Keep other player/opponent identifiers anonymized unless similarly authorized.

## Report Writing Style
- User-facing report text is concise Japanese in plain form (常体), not desu/masu (敬体). Default to noun-ending (体言止め); use a plain declarative verb (だ・である／〜する・〜ない) only when a verb is needed. This keeps strings short, stays consistent, and maps cleanly to a future English (neutral declarative) translation.
- Prefer quantitative, direct statements about what a metric uses and shows. Do not lead with limitations or stack hedges inline.
- In the web edition, register recurring caveats in the catalog (`web/src/render/caveats.ts`) and reference them by ID instead of writing warning prose into each figure.
- Good: `保存済みデータから勝率を推定。` / Avoid (desu/masu + hedge-stacking): `この勝率は実際のマッチメイキング仕様を再現したものではなく、保存済みデータから計算した推定値です。`
- This applies to the report body (chapters, leads, grain labels, block headlines/captions, caveats, glossary, footer, empty-state messages). The `web/` landing page (`web/public/index.html`) is separate marketing/instruction copy and is not covered by this rule.

## Skills
- Reusable task procedures live in `.agents/skills/`. Follow them exactly rather than improvising the equivalent steps from scratch.
- Before committing, follow `.agents/skills/commit/SKILL.md` (fixed author, English message, `Model:` trailer, no push without explicit confirmation).
- Before reporting a `web/` change as verified, follow `.agents/skills/verify-web-report/SKILL.md` (run `npm run check`, then render the report in a real browser).
- To push or release the web edition, follow `.agents/skills/deploy-web/SKILL.md` (develop auto-deploy via Actions; production via merge to `main` + `wrangler deploy`).
- To refresh `samples/sample_web_report.html`, follow `.agents/skills/update-web-sample-report/SKILL.md`.
- If a skill's verification step cannot be completed in the current environment (e.g. no browser tooling), do not report the task as verified — state exactly which step was skipped and why, and record it so the next session can finish it.

## Git and Delivery Rules
- Use `develop` as the sole development branch. Make routine development commits directly on `develop`; do not create branches without explicit user approval.
- Treat `main` as the production branch. Do not commit directly to `main`.
- Before making a commit, set the git author to `61bi-234469 <121346275+61bi-234469@users.noreply.github.com>`.
- Write commit messages in English (subject and body) so they read consistently in `git log`.
- Include the model name in commit messages so it is visible in `git log` (for example, a trailer such as `Model: GPT-5.5 Codex`).
- Do not push to any remote without explicit user confirmation immediately beforehand.
- If the worktree contains unrelated user changes, leave them intact and work around them.
