# reference/ — the FROZEN old version (do not edit)

This folder is the safety net taken **before** the unified-app rewrite, on
2026-06-13. It exists so nothing we built so far is ever lost and so the new
app can copy exact behaviour from the old one.

## What's inside
- **code-snapshot/** — REMOVED 2026-09-27. It was an untracked local copy of the
  old code; the git tag below holds exactly the same thing, and that tag is now
  pushed to GitHub too, so the copy protected nothing extra.
- **DATABASE.md** — the live Supabase schema (tables, columns, RPC functions)
  at freeze time. The rewrite reuses this SAME database — don't recreate it.

## Also frozen in git
A git tag **`pre-rewrite-reference`** points at the exact commit of the old
version. To inspect or restore it later:
```
git show pre-rewrite-reference
git checkout pre-rewrite-reference   # look around, read-only
```

## Rule
Treat everything here as **read-only reference material**. The rewrite happens
outside this folder. We only ever read from here to match old behaviour.
