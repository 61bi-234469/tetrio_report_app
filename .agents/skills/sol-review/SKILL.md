---
name: sol-review
description: >-
  Get an independent code/plan review from "Sol" — a second model (OpenAI `gpt-6.1-sol`) driven
  non-interactively through the Codex CLI — on a change in this repository. Use this whenever the
  user asks for a Sol review, an independent review, 独立レビュー, a second opinion, or a pre-push /
  pre-deploy review; and before deploying or pushing a large or risky change (web/src/analysis,
  web/src/render, the Worker in web/src/index.ts, the Python pipeline, CI workflows, or the
  instruction files AGENTS.md / .agents/skills). Prefer this over reviewing your own diff alone —
  the point is a reviewer that did not write the code.
---

# Sol Review

"Sol" is not a tool in this repo; it is a **second model asked to review your work**. It runs as a
one-shot, read-only Codex CLI session on this checkout, so it reads the real files and the real diff
rather than your summary of them. Your own review of your own diff is not a Sol review.

Review output is local-only. `docs/` is Git-ignored (`.gitignore`), so briefs and logs live there and
are never committed.

## When to ask for one

- The user asks for it ("Sol レビュー", "独立レビュー", "second opinion", "レビューして").
- Before pushing `develop` with `web/` changes — that push auto-deploys the develop Worker, so it is
  a de-facto deploy (see `.agents/skills/deploy-web/SKILL.md`).
- Before a production release (`develop` → `main` + `wrangler deploy`).
- Large or hard-to-reverse changes: metric formulas and `web/src/analysis`, the renderer and caveat
  catalog, `web/src/index.ts` (the Worker proxy), the legacy Python pipeline, `.github/workflows`,
  or the instruction files themselves.

Skip it for typo fixes, copy tweaks, and other changes where a reviewer could not plausibly find a
blocking issue.

## Step 0 — Preconditions

Run the deterministic gate **before** asking Sol; do not spend a review on a red build. For `web/`
changes that means `npm.cmd run check --prefix web` (see `.agents/skills/verify-web-report/SKILL.md`).

Use the npm-installed Codex CLI, not the `codex.exe` that may be on `PATH` (it is older and may not
know the `sol` models):

```powershell
& "$env:APPDATA\npm\codex.cmd" --version   # expect 0.162.1 or newer
```

If that path does not exist, stop and tell the user Codex CLI is not installed — do not silently
fall back to reviewing the change yourself and calling it a Sol review.

## Step 1 — Write the brief to a file

`codex.cmd` truncates a multi-line prompt at its first line, so **the request must be a file** and
the prompt a single line pointing at it.

Put it in `docs/reviews/` (create the directory if needed) as
`YYYY_MM_DD_<topic>_sol_brief.md`. A good brief is short and specific:

```markdown
# Review request: <one-line subject>

Repository rules: read AGENTS.md first. This is a read-only review: do not edit files.

## Change
Not yet committed. Read it with:
`git diff` (unstaged), `git diff --cached` (staged), and
`git status --short` + `git ls-files --others --exclude-standard` for new files.
(For an already-committed change instead: `git diff <base>..HEAD`.)
Files in scope: web/src/analysis/foo.ts, web/src/render/bar.ts.
Ignore unrelated edits in <paths> — they are the user's, not part of this change.
Background / plan: docs/<YYYY_MM_DD_topic>.md.

## What I already verified
npm run check: pass (typecheck + client build + N vitest tests, golden parity included).
Rendered the report in a browser for handle <handle the user gave>: chapters 1 and 3-13 present,
console error-free.

## Please check
1. Correctness of <the specific formula / aggregation / edge case>, including empty and single-match
   inputs and DQ handling.
2. Parity with the Python edition (web/test/python-golden.test.ts) — did I change a metric without
   updating the golden expectation?
3. Worker budget: the Worker must stay a thin proxy; flag any heavy computation moved into
   web/src/index.ts.
4. Report style: Japanese 常体 / 体言止め, recurring caveats registered in web/src/render/caveats.ts
   by ID rather than written inline (AGENTS.md "Report Writing Style").
5. Anything else that should block a push to develop.

Reply with findings ranked high/medium/low, each with file:line and a concrete failure scenario, or
"no blocking issues".
```

Rules for the brief:

- **Say where the change actually is.** Most reviews here happen *before* the commit, so
  `git diff <base>..HEAD` is empty and a reviewer that trusts it can return "no blocking issues"
  without having read your code. Name the state explicitly: unstaged (`git diff`), staged
  (`git diff --cached`), untracked (`git ls-files --others --exclude-standard`), or committed
  (`git diff <base>..HEAD`). Sol can run these itself in the read-only sandbox; if you prefer, dump
  the combined diff to `docs/reviews/<name>.diff` and point at it.
- If the worktree holds unrelated user edits, list them and tell Sol to ignore them — AGENTS.md
  requires leaving them intact, and they must not be mistaken for your change.
- State what you already checked, so the review does not re-run your tests instead of thinking.
- Ask for a ranked verdict in a fixed shape — vague briefs get vague prose back.
- **Privacy**: no real TETR.IO handles other than `61bi_234469`, no opponent data, no contents of
  `web/test/fixtures/raw/`. Use `your_username` as a placeholder.

## Step 2 — Run Sol

From the PowerShell tool, at the repo root. `$null |` keeps the CLI from waiting on stdin; redirect
everything to a log because the session streams progress.

```powershell
$codex = "$env:APPDATA\npm\codex.cmd"
$brief = "docs/reviews/2026_10_25_example_sol_brief.md"
$log   = "docs/reviews/2026_10_25_example_sol_stream.log"
$null | & $codex exec -m gpt-6.1-sol -c model_reasoning_effort=high `
  -c 'windows.sandbox="unelevated"' -c approval_policy=never -s read-only `
  "Read $brief and carry out the review it describes." > $log 2>&1
Write-Output "exit=$LASTEXITCODE"
```

Notes:

- `-s read-only` plus `approval_policy=never` keeps the session non-interactive and unable to edit
  the worktree. `--dangerously-bypass-approvals-and-sandbox` does not work here; do not reach for it.
- A high-effort review takes several minutes. Run it with `run_in_background` (or a generous timeout)
  rather than polling, and do not shorten the brief to make it finish faster.
- Implementation work by a second model uses `gpt-5.6-luna` with `model_reasoning_effort=xhigh`;
  reviews use a `sol` model. Keep the reviewer different from the implementer.
- If the model is rejected with HTTP 400 "not supported when using Codex with a ChatGPT account",
  retry with `-m gpt-6-sol` and say in your report which model actually reviewed.

## Step 3 — Save and act on the findings

1. Extract Sol's verdict from the log into `docs/reviews/<same_prefix>_final.md`. Keep the stream log
   next to it.
2. Fix every **high** finding, and every **medium** you agree with. If you disagree, say why
   explicitly — to the user and in the final notes — instead of quietly dropping it. Sol is a
   reviewer, not an authority: a finding that is wrong about this codebase should be refuted with
   file evidence, not obeyed.
3. Re-run the deterministic gate after fixing, then ask for another round. Iterate until the reply is
   "no blocking issues". Two to three rounds is normal for a substantial change.
4. Record the outcome where this repo keeps records: append to the plan file's 対応結果 section in
   `docs/` (AGENTS.md "Data and Privacy") — how many rounds, what was raised, how each was resolved,
   and the final verdict.
5. When you report to the user, state the model and effort used, the number of rounds, and the final
   verdict. Never claim a review happened if the CLI failed.

## What Sol cannot do

The Codex sandbox has no browser and no desktop capture. Sol cannot confirm that the report actually
paints — the browser step in `.agents/skills/verify-web-report/SKILL.md` stays yours, and a Sol
"no blocking issues" does not substitute for it.
