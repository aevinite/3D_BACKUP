-- avlive-schema-fingerprint.sql — "do the two databases hold the same SHAPE?", in one short line.
--
-- READ-ONLY. It reads catalogue views only — function signatures, table names, column names and
-- permission flags. It never reads a customer, a bill, an order or any other row of data, which is
-- what makes it safe to point at a paying client's database.
--
-- WHY A FINGERPRINT. The release script ends by announcing that the stacks are level, and that is
-- the script grading its own homework. This is the independent second opinion — but the AV applier
-- only prints the first ~120 characters of an answer, so the question has to be small. Hashing the
-- sorted lists gives one short string per database: equal strings mean identical schemas, and a
-- difference tells you WHICH of the five to go and look at.
--
--   backup:   node scripts/run-migration.mjs ../scripts/avlive-schema-fingerprint.sql   (or curl)
--   AV live:  node scripts/apply-migration-avlive.mjs scripts/avlive-schema-fingerprint.sql
--
-- The AV-live line is blocked by the owner's own deny rule, by design — he runs that one himself.
--
-- Reads as:  <functions>/<hash> T<tables>/<hash> C<columns>/<hash> open<n> norls<n>
--   open  = lfh_* functions a guest or signed-in user may execute (44 is the deliberate set)
--   norls = tables with row-level security off (0 is correct)

SELECT
     (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
  || '/' || (SELECT left(md5(string_agg(s,'|' ORDER BY s)),8) FROM (
       SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS s
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') a)
  || ' T' || (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r')
  || '/' || (SELECT left(md5(string_agg(t,'|' ORDER BY t)),8) FROM (
       SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r') b)
  || ' C' || (SELECT count(*)::text FROM information_schema.columns WHERE table_schema='public')
  || '/' || (SELECT left(md5(string_agg(c,'|' ORDER BY c)),8) FROM (
       SELECT table_name||'.'||column_name AS c FROM information_schema.columns WHERE table_schema='public') d)
  || ' open' || (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname LIKE 'lfh\_%'
         AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')))
  || ' norls' || (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity)
  AS fp;
