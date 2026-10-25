---
name: deploy-web
description: >-
  Push and deploy the web edition (web/) of the TETR.IO report app. Use whenever the user asks to
  push develop, deploy, release, publish, or "mainへのマージ・デプロイ" for the web app. Covers both
  targets: the develop Worker (auto-deployed by GitHub Actions on a develop push) and the production
  Worker (merge develop into main, then wrangler deploy). Prefer this over improvising git push /
  wrangler commands so the merge-commit convention, Actions monitoring, and URL verification stay
  consistent.
---

# Deploy Web Edition

Two deploy targets exist. Figure out which one the user asked for before touching git:

- **develop deploy** — push `develop`; `.github/workflows/deploy-web-develop.yml` runs
  `npm run check` and deploys the Worker `league-report-develop`
  (`https://league-report-develop.61bi.workers.dev`).
- **production release** — merge `develop` into `main`, push `main`, then deploy the Worker
  `league-report` manually with wrangler from `web/`.

"デプロイ" alone in past requests has meant either; if the request doesn't make the target clear
(e.g. "push、デプロイまでお願いします" right after develop work → develop; "mainへのマージ、デプロイ
まで" → production), ask. A user request to deploy **is** the push confirmation required by
AGENTS.md — do not re-ask, but never push anything the user did not name.

## Step 0 — Preflight

1. `git status` — the worktree should be clean apart from unrelated user edits (leave those alone).
   Anything that belongs in the deploy must be committed first via `.agents/skills/commit/SKILL.md`.
2. Run the local gate even though Actions repeats it (fail fast, and production deploy has no CI
   gate at all):

   ```powershell
   npm.cmd run check --prefix web
   ```

## Develop deploy

1. `git push origin develop`.
2. Watch the workflow:

   ```powershell
   gh run list --workflow "deploy web develop" --branch develop --limit 3
   gh run watch <run-id> --exit-status
   ```

   On failure, `gh run view <run-id> --log-failed`. Known failure modes (missing
   `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets, token scope, workers.dev subdomain)
   are catalogued in `docs/2026_07_03_develop_actions_deploy_notes.md` (local-only).
3. Verify the deployed URL:

   ```powershell
   curl.exe -s -o $env:TEMP\dev_root.html -w "status=%{http_code}`n" https://league-report-develop.61bi.workers.dev/
   ```

   Expect 200. Use a GET, not `curl.exe -I`: the Worker rejects every method but GET
   (`web/src/index.ts`), so a HEAD request answers 405 on a perfectly good deploy. (Right after a
   workers.dev subdomain change, Windows TLS can transiently fail even though the deploy
   succeeded — retry.)

## Production release

1. Merge with the fixed convention seen in `git log main` (English subject
   `Merge develop into main`, fixed author, **no** Model trailer on merge commits):

   ```powershell
   git checkout main
   git -c user.name="61bi-234469" -c user.email="121346275+61bi-234469@users.noreply.github.com" merge develop -m "Merge develop into main"
   ```

2. `git push origin main`. No workflow deploys production; continue.
3. Build and deploy from `web/` (wrangler does not build the client bundle itself, and
   `web/public/report.js` is Git-ignored, so the build step is mandatory):

   ```powershell
   npm.cmd run build:client --prefix web
   npx.cmd wrangler deploy
   ```

   Run wrangler from `web/`. If wrangler is not authenticated (`npx.cmd wrangler whoami` fails and
   `CLOUDFLARE_API_TOKEN` is unset), stop and ask the user to authenticate — do not guess at
   credentials.
4. Verify the URL wrangler prints with a GET, expect 200 (the Worker answers 405 to HEAD, so
   `curl.exe -I` fails on a good deploy):

   ```powershell
   curl.exe -s -o $env:TEMP\prod_root.html -w "status=%{http_code}`n" <url>
   ```
5. Return to the development branch: `git checkout develop`.

## Report back

State plainly: what was pushed/merged (commit hashes), which Worker was deployed, the Actions run
result or wrangler output, and the HTTP status of the deployed URL. If any step was skipped or
failed, say so explicitly.
