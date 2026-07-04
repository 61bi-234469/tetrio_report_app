---
name: update-web-sample-report
description: Regenerate the tracked web sample report for this repository. Use when the user asks to create, refresh, update, or replace samples/sample_web_report.html from the local web app using 61bi_234469, 300 matches, and anonymization.
---

# Update Web Sample Report

## Purpose

Refresh `samples/sample_web_report.html` with the current web edition output for the repository owner's public handle `61bi_234469`, using 300 matches and anonymization enabled.

## Workflow

1. Work from the repository root and confirm the branch/worktree state:

   ```powershell
   git status --short --branch
   ```

2. From `web/`, run the deterministic check before generating the sample:

   ```powershell
   npm.cmd run check
   ```

3. Ensure the local web app is serving on `http://127.0.0.1:8788/`.

   Prefer the repo script when present:

   ```powershell
   cd C:\Users\user\tetrio_report_app\web
   npm.cmd run dev:8788
   ```

   If running it in the background for automation, redirect stdout/stderr to local ignored log files and stop the process after verification. Do not commit those logs.

4. Generate the complete standalone sample from the Worker endpoint, not from a serialized browser DOM:

   ```powershell
   Invoke-WebRequest `
     -Uri "http://127.0.0.1:8788/api/report?username=61bi_234469&max_matches=300&anonymize=on" `
     -UseBasicParsing `
     -OutFile "C:\Users\user\tetrio_report_app\samples\sample_web_report.html"
   ```

   This preserves the original self-contained HTML, embedded Chart.js runtime, and chart configuration. Avoid saving `document.documentElement.outerHTML` from a browser unless the endpoint is unavailable, because it serializes post-render DOM state and can create noisy diffs.

5. Verify the generated sample with static checks. Use Python for the Japanese
   strings so PowerShell code pages do not affect the check:

   ```powershell
   @'
   from pathlib import Path

   html = Path("samples/sample_web_report.html").read_text(encoding="utf-8")
   checks = {
       "handle_absent": "61bi_234469" not in html,
       "subject_anonymized": "\u5bfe\u8c61\u30d7\u30ec\u30a4\u30e4\u30fc\uff1a<b>\u30d7\u30ec\u30a4\u30e4\u30fc</b>" in html,
       "match_count_300": "\u516c\u5f0f\u30de\u30c3\u30c1\u6570 300" in html,
       "chart_init_present": "new Chart(el,cfg);" in html,
       "replay_links_absent": 'href="https://tetr.io' not in html,
   }
   print(checks)
   if not all(checks.values()):
       raise SystemExit(1)
   '@ | python -
   ```

   Expected:
   - `61bi_234469`: no matches.
   - subject is anonymized as `プレイヤー`.
   - official match count is 300.
   - `new Chart(el,cfg);`: at least one match.
   - `href="https://tetr.io`: no matches when anonymized.

6. Verify the sample renders in a real browser.

   If `file://` is blocked by the browser tool, serve the repo root through a temporary local HTTP server:

   ```powershell
   py -3 -m http.server 8790 --bind 127.0.0.1
   ```

   Open `http://127.0.0.1:8790/samples/sample_web_report.html` and confirm:
   - The header shows the anonymized player label (`プレイヤー`).
   - The header shows official match count 300.
   - There are 29 `canvas` elements.
   - Chapter 1 chart `01_tr_history` visibly renders.
   - Browser console has no errors.

   Stop the temporary HTTP server before finishing.

7. Inspect the final diff:

   ```powershell
   git diff --stat -- samples/sample_web_report.html
   git diff -- samples/sample_web_report.html
   ```

   It is normal for the generated date and filename date to change. Do not stage local logs, Wrangler state, generated screenshots, `web/public/report.js`, or other ignored runtime artifacts.

## Notes

- `61bi_234469` is explicitly allowed by the repository privacy rules as the owner's own handle.
- Use `npm.cmd` and `npx.cmd` in PowerShell to avoid execution-policy failures from `npm.ps1` / `npx.ps1`.
- If Wrangler local runtime crashes after the response is produced, regenerate through `/api/report` and verify the saved HTML. Treat `web/.wrangler-config/` and Wrangler logs as local-only artifacts.
