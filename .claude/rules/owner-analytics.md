---
paths:
  - "components/owner/**"
  - "lib/ownerCache.ts"
  - "app/owner/**"
  - "app/api/owner/**"
---
# Owner panel — charts & analytics

Moved out of `CLAUDE.md` on 2026-09-02, path-scoped. Verbatim.

- **Charts are DYNAMIC, never a lonely 1-bar plot:** route through `populated()` / `NotEnough` /
  `ScrollX` in `components/owner/Charts.tsx`; sparse timelines auto-drill to finer buckets.
- **Analytics/dashboards use the compute-on-view snapshot cache** (`lib/ownerCache.ts`,
  `cachedOwnerPayload`, fingerprint-gated; Refresh forces live) — never recompute per open, never
  a blind cron.

Creating a NEW chart or dashboard? Read this file first — the rule is about the shape of the
thing you are about to write, not only about editing what exists.
