---
name: commit
description: >-
  Create a git commit in this repository following its house rules: a fixed author identity, an
  English subject and body, and a trailer naming the model that made the change. Use this whenever
  the user asks to commit, "save this", make a commit, or check in changes in the tetrio_report_app
  repo. It stages and commits only; it never pushes without an explicit go-ahead. Prefer this over a
  raw `git commit` so the author, language, and Model trailer stay consistent in `git log`.
---

# Commit

This repo's `AGENTS.md` fixes how commits must look so `git log` stays consistent across the
different models and tools that touch it. Follow these rules exactly; they override your default
commit habits for this repository.

## The rules (from AGENTS.md)

1. **Author** must be `61bi-234469 <121346275+61bi-234469@users.noreply.github.com>` — set it on the
   commit itself, don't rely on ambient git config.
2. **Language**: subject and body in **English**, even when the conversation is in Japanese.
3. **Model trailer**: end the message with a trailer naming the model that made the change, e.g.
   `Model: GPT-5.5 Codex` or `Model: Claude Opus 4.8`. Use the model powering the current session,
   not a guess. Match the existing `Model: <Vendor> <Name>` style seen in `git log`.
4. **No push** to any remote without explicit user confirmation immediately beforehand. This skill
   stops at the commit.
5. **Leave unrelated changes intact.** If the worktree has user edits unrelated to your task, do not
   stage or revert them — stage only the files your change touched.

## Steps

1. Review what changed: `git status` and `git diff` (and `git diff --staged` if anything is already
   staged). Read enough to write an honest subject line.
2. Stage only the files that belong to this change with explicit paths (`git add <path> ...`). Do not
   `git add -A` / `git add .` if the worktree has unrelated modifications — check step-5 rule first.
3. Write the message. Subject: concise, imperative, English (e.g. `Add replay review candidates to
   web report`). Body (optional but preferred for non-trivial changes): explain the *why*, wrapped at
   ~72 columns. Blank line, then the `Model:` trailer.
4. Commit with the author pinned. Use a here-doc for the message so multi-line bodies survive:

   ```bash
   git commit --author="61bi-234469 <121346275+61bi-234469@users.noreply.github.com>" -F - <<'EOF'
   <subject line>

   <body paragraph explaining why, if warranted>

   Model: <Vendor> <Name>
   EOF
   ```

5. Confirm with `git log -1 --format='%an <%ae>%n%n%B'` that the author and Model trailer landed, and
   report the result to the user. Do **not** push.

## Message shape (from real history)

```
Move report generation to the browser to fit the Workers free tier

Server-side analysis exceeds the 10ms free-tier CPU budget by ~20x even
at 100 matches. Add a thin GET /api/league-page proxy that streams the
upstream body without parsing it and move analysis/render into a client
script, reusing the existing Node/Workers-agnostic code unchanged.

Model: Claude Sonnet 5
```

Keep the subject under ~72 chars, describe intent over mechanics, and always close with the trailer.
