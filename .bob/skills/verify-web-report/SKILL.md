---
name: verify-web-report
description: >-
  Verify the TETR.IO web report (web/) after changing rendering, charts, analysis, or the Worker.
  Runs the deterministic gate (npm run check) and then renders the report in a real browser to
  confirm chapters and charts appear without errors. Use this whenever the user asks to verify,
  test, check, or confirm a web/ report change works — after editing anything under web/src/render,
  web/src/charts, web/src/analysis, web/src/index.ts, or web/public — or before committing/deploying
  the web edition. Prefer this over a bare "npm test" whenever the change could affect what the
  report looks like in the browser.
---

# Verify Web Report

Purpose: confirm a change to the web edition (`web/`) is actually correct — both that the code still
passes its own checks and that the generated report renders in a browser. The web app moves all
aggregation and rendering into the browser (`web/public/report.js`, built from `web/src/`), so a
green `npm run check` proves the logic but not that the page paints. Do both.

## Step 1 — Deterministic gate

From `web/`, run the full check. This is the same command CI runs.

```powershell
npm run check --prefix web
```

`npm run check` = typecheck + client bundle build + vitest. If it fails, stop and fix the source
before touching the browser — a broken bundle will only produce misleading browser results. Note the
golden-parity tests (`python-golden.test.ts`) compare metric output against the Python edition; if
those fail after a metric change, that is a real parity regression, not noise.

If the change is purely non-visual (types, a helper with unit-test coverage, test-only edits), you
may stop here and report the check result. Otherwise continue to the browser step.

## Step 2 — Render in a browser

Start the dev server and open the report. Use whatever browser-automation tooling this agent has:
Claude Code has `preview_*` tools (server name `web-dev`, port 8788, from `.claude/launch.json`);
otherwise start the server with `npm run dev --prefix web` (default port 8787) and drive it with your
available browser tool. Do not verify by curling HTML alone — the report is rendered client-side, so
you need a real browser to know it painted.

1. Start / reuse the dev server.
2. The report needs live data: the Worker is a thin proxy to the TETRA CHANNEL API, so generating a
   report fetches a **real public TETR.IO handle**. Use a username the user gave you for this task.
   If none was given, ask for one public handle to test with — do not invent one, and never use a
   real opponent's handle from local data. `your_username` is a placeholder and will not fetch.
3. Open the app root, fill the `input[name="username"]` field with the test handle, leave
   `select[name="max_matches"]` at `100` (fast), and submit the form
   (`form.report-form` → the submit button). Generation runs client-side and streams progress into
   `#progress`.
4. Wait for the report to render, then verify:
   - Browser console must be **error-free**. A thrown error usually means a chart config or analysis
     field is missing.
   - Confirm the chapter structure is present. Active chapters are 1 and 3–13 (chapter 2 was
     removed); each renders a `第N章` heading. Spot-check that the page is a report, not an error
     screen.
   - If a chart change was the point of the edit, confirm the expected chart ids exist in the DOM
     (e.g. `01_tr_history`, `29_session_decay`).
5. If anything is wrong, read the relevant source under `web/src/`, fix it, let the client rebuild
   (`npm run build:client --prefix web`, or rerun `npm run dev`), reload the page, and re-check.

## Step 3 — Report back with proof

Only after the page renders cleanly:

- Capture a screenshot of the rendered report (or the specific chapter/chart that changed) so the
  user can see it, not just take your word.
- State the `npm run check` result plainly (pass/fail, and which tests if any failed).
- If you had to skip the browser step because the change was non-visual, say so and why.

Never tell the user to open the browser and check manually — verify it yourself and show the result.
