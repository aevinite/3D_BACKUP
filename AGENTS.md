# Agent instructions -> see `CLAUDE.md`

All project rules for AI agents live in **[`CLAUDE.md`](./CLAUDE.md)** in this same folder. Read
that file, not this one.

This file used to hold a full copy of those rules. The copy went stale — it stopped being updated
2026-07-26 while `CLAUDE.md` kept changing — so two files gave contradictory instructions and an
agent reading this one worked from rules that were weeks out of date. It is now a pointer so that
cannot happen again: there is exactly **one** source of truth.

Why the rules are split the way they are: `docs/PROJECT-HISTORY.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
