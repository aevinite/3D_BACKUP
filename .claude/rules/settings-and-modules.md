---
paths:
  - "lib/accessModel.ts"
  - "lib/accessTree.ts"
  - "lib/features.ts"
  - "supabase/migrations/**"
---
# Settings, feature switches & new modules

Moved out of `CLAUDE.md` on 2026-09-02, path-scoped. Verbatim.

- **Feature switches (mig 035):** `settings.features` + `useFeatures()`; four backend-only flags
  (`verification`, `payments`, `aggregators`, `gst_invoice`) stay invisible in every UI.
- **🧱 A new MODULE adds no column to `settings`** (110 already): declare `moduleBag: true` in
  `lib/accessModel.ts`, ladder goes in `settings.modules` (mig 326). `verify:settings-columns`.
