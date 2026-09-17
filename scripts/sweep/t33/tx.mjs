// T33 sweep #9 round 2 — the DRIVEN engine.
//
// WHY THIS EXISTS. Round 1's fifty checks read the database: installed function bodies, the
// catalogue, row counts. Not one of them made the database DO the thing and looked at the answer,
// and that is the gap this round is aimed at (S9-RULES rule 2b — measure, then aim).
//
// HOW IT IS SAFE ON A SHARED DEV DATABASE WITH OTHER TERMINALS LIVE. Every probe runs inside ONE
// transaction that ends in ROLLBACK, so nothing is ever committed — the cleanest possible cleanup,
// and there is no fixture left for another terminal to trip over and none of mine to delete by id.
// A probe that needs a restaurant uses FRENCH HOUSE (writable per the sweep rules); Aangan, the
// read-only control, is never written to.
//
// A REFUSAL IS A RESULT, SO IT MUST NOT ABORT THE BATCH. `t33_try` is created inside the
// transaction and runs a statement through EXECUTE with its own exception handler, returning the
// SQLSTATE and message instead of poisoning the surrounding transaction. That is what lets ~30
// refusal probes share one round trip, which matters: five terminals share this endpoint and the
// sweep rules say be gentle.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const env = Object.fromEntries(readFileSync(join(root, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
export const REF = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (REF !== "wnsfcizclkbobwzcxqsf") { console.error(`refusing: expected the dev project, got ${REF}`); process.exit(2); }

const spin = (ms) => { const t = Date.now() + ms; while (Date.now() < t) { /* no timers needed */ } };
const post = (body, tries = 6) => {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const out = execFileSync("curl", ["-4", "-s", "--max-time", "180", "-X", "POST",
        `https://api.supabase.com/v1/projects/${REF}/database/query`,
        "-H", `Authorization: Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        "-H", "Content-Type: application/json", "--data-binary", "@-"],
        { input: JSON.stringify(body), encoding: "utf8", maxBuffer: 1 << 28 });
      const j = JSON.parse(out);
      if (!Array.isArray(j)) {
        const msg = (j && j.message) || String(out).slice(0, 400);
        throw Object.assign(new Error(msg), { sqlError: /ERROR:/.test(msg) });
      }
      return j;
    } catch (e) {
      last = String(e.message || e).slice(0, 400);
      if (e.sqlError) throw e;                       // a real SQL fault is an answer, not a blip
      spin(Math.round(2 ** i * 700 * (0.6 + Math.random() * 0.8)));
    }
  }
  throw new Error(`the dev database could not be read after ${tries} tries: ${last}`);
};

/** Read-only query. */
export const q = (sql) => post({ query: sql, read_only: true });
export const one = (sql) => q(sql)[0];

/** The refusal helper + French House, available to every probe batch. */
const PREAMBLE = `
CREATE OR REPLACE FUNCTION t33_try(p_sql text) RETURNS text LANGUAGE plpgsql AS $t33$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || left(SQLERRM, 180);
END $t33$;
`;

/**
 * Runs `sql` inside BEGIN … ROLLBACK and returns the rows of its final SELECT.
 * `sql` must end in exactly one SELECT. Nothing it writes is ever committed.
 */
export function tx(sql) {
  const body = sql.trim().replace(/;*$/, ";");   // the final SELECT must be terminated, or ROLLBACK parses as part of it
  const rows = post({ query: `BEGIN;\n${PREAMBLE}\n${body}\nROLLBACK;` });
  return rows;
}
export const tx1 = (sql) => tx(sql)[0];

/** French House's id, read once. */
export const RID = one(`SELECT id FROM restaurants WHERE slug = 'french-house' AND deleted_at IS NULL LIMIT 1`)?.id;
if (!RID) { console.error("refusing: French House was not found — every driven probe needs it"); process.exit(2); }
