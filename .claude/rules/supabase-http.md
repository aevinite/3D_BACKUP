---
paths:
  - "lib/**"
  - "scripts/verify-cache.mjs"
  - "supabase/**"
---
# Supabase HTTP gotcha

Moved verbatim out of `CLAUDE.md` on 2026-09-03.

- Supabase HEAD lies about Cache-Control — use GET with `Range: bytes=0-0`.
