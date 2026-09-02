---
paths:
  - "public/panels/**"
  - "app/globals.css"
  - "**/*.css"
  - "components/**"
  - "lib/modelLoader.ts"
---
# Rendering, theming & cache gotchas

Moved verbatim out of `CLAUDE.md`'s "Known gotchas" on 2026-09-03, path-scoped so they load
when you touch the code they bite in. Stories: `docs/CLAUDE-DETAIL.md` → `## Known gotchas`.

- **Don't narrow `boardSig`** (kitchen/tablet redraw fingerprint) back to a field list — new
  volatile columns go in `RT_VOLATILE`; guarded by `scripts/verify-board-sig.mjs`.
- **"Blur" = frosted glass**, ONE unprefixed `backdrop-filter` line — hand-adding `-webkit-` makes
  the build DROP it (`docs/CLAUDE-DETAIL.md` → What "blur" means).
- **Light mode: which surfaces even HAVE it.** GUEST menu: a toggle (`lfh_theme`; a tenant's default is an
  ADMIN setting, not always dark). Manager/kitchen/tablet panels: `lfh_panel_theme`, default LIGHT, **remembered per staff
  member**. The **owner console DOES have light mode** — its own ☀/🌙 in `OwnerShell.tsx`, stored as
  **`aevidine_skin`** (localStorage + cookie), survives a reload, and pushed into the embed by
  postMessage (`useOwnerSkin`). DARK stays the default. So light-skin checks on `/owner` are real:
  drive **`aevidine_skin`**, never `lfh_theme` (that key does nothing there — the mistake that made
  an old note here claim "dark-only"; full story: `docs/CLAUDE-DETAIL.md`).
- Staff can run a weeks-old panel: `?v=` is a content hash — `verify:panel-cache`.

**Creating a NEW panel screen, overlay or stylesheet?** Read this file first — a path-scoped
rule fires when you READ a matching file, so it can miss a greenfield write.
