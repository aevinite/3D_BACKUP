---
paths:
  - "public/panels/**"
  - "components/**/*.tsx"
  - "app/api/**/route.ts"
---
# Panel & overlay rules

Moved out of `CLAUDE.md` on 2026-09-02 (path-scoped so they load exactly when you touch this
code, instead of costing tokens in every session). Verbatim; nothing was reworded.

- **👆 A tap must never vanish in silence:** no silent `return` on a user action — hold it
  (`tapGuard().act()`), or refuse visibly; never leave a promise unresolved; overlays with
  `.confirm-overlay` stamp `data-closing`; branch on server reason CODES, not prose.
  `npm run verify:taps` runs as a hook on panel edits.
- **Mobile back button:** every popup/overlay registers `useBackClose(...)` (guest) or
  `LFH_BACK.layer(...)` (panels) the moment it's built — never hand-roll pushState/popstate.
- **Offline layer is LIVE — keep extending:** read `docs/OFFLINE-SYNC.md` before touching a panel
  or write endpoint; every staff write is wrapped `withIdempotency(...)` + goes through `api()`
  (X-LFH-Action-Id); on the guest side ONLY place-order is queued so far — don't rebuild the
  staff outbox on a misreading.
