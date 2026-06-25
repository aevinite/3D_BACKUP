# Local DB Validation — Quick Reference

## What this is

A throwaway local PostgreSQL cluster for validating migrations offline.
No cloud. No secrets. No Supabase API calls.

## One-time setup (already done — repeat only if you wipe the scratch dir)

```sh
# Install PostgreSQL 17
brew install postgresql@17

# Init a throwaway cluster in scratch (outside the repo)
/opt/homebrew/opt/postgresql@17/bin/initdb \
  -D /private/tmp/claude-501/-Users-aevinite-Documents-Projects-backup-Menu/aaf1afaa-8870-43bc-8528-abf58e393fc8/scratchpad/lfh-localpg \
  -U lfh_super --locale=en_US.UTF-8 -E UTF-8

# Start it on port 55432
/opt/homebrew/opt/postgresql@17/bin/pg_ctl \
  -D /private/tmp/claude-501/-Users-aevinite-Documents-Projects-backup-Menu/aaf1afaa-8870-43bc-8528-abf58e393fc8/scratchpad/lfh-localpg \
  -l /tmp/lfh-pg.log -o "-p 55432" start
```

## Re-run the validator (after editing any migration)

```sh
# From the repo root:
node scripts/local-db-validate.mjs
```

The script drops and recreates `lfh_dev` on every run — fully idempotent.

## Stop the cluster when done

```sh
/opt/homebrew/opt/postgresql@17/bin/pg_ctl \
  -D /private/tmp/claude-501/-Users-aevinite-Documents-Projects-backup-Menu/aaf1afaa-8870-43bc-8528-abf58e393fc8/scratchpad/lfh-localpg \
  stop
```

## Bootstrap stubs created

The file `scratchpad/lfh-bootstrap.sql` scaffolds the Supabase objects that
migrations assume but vanilla PostgreSQL does not have:

| Stub | Why needed |
|------|-----------|
| `CREATE EXTENSION pgcrypto` | `gen_random_uuid()` used in every table's PK default |
| roles `anon`, `authenticated`, `service_role` (NOLOGIN) | `GRANT … TO anon` etc. in every migration |
| `CREATE SCHEMA auth` + stub functions `auth.uid()`, `auth.role()`, `auth.email()` | Future-proofing (no migration currently uses these, but any RLS policy that references `auth.uid()` will compile) |
| `CREATE PUBLICATION supabase_realtime` | Several migrations call `ALTER PUBLICATION supabase_realtime ADD TABLE …` |

## Notes

- `pg_cron` is NOT available locally — both migrations that use it (053, 060)
  are already wrapped in `EXCEPTION WHEN OTHERS THEN` blocks, so they skip the
  scheduling step silently and still pass.
- The data dir is in `/private/tmp/…` (outside the repo) so it is never
  committed and does not interfere with other sessions.
- Port 55432 was chosen to avoid clashing with any system PostgreSQL on 5432.
