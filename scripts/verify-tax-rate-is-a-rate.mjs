// verify-tax-rate-is-a-rate — A STAMPED TAX RATE IS A FRACTION, NEVER A PERCENTAGE.
//
// WHY THIS EXISTS (T33, sweep #9 round 2, 2026-09-17). `orders.tax_rate` is the rate the tax on
// that bill was actually charged at, stamped once so a historical bill survives a GST change. Every
// reader treats it as a FRACTION — `lfh_fill_disc_gross` computes
// `discount * (1 + COALESCE(NULLIF(tax_rate, 0), lfh_effective_tax_rate(rid)))`.
//
// On the dev stack 41,159 orders held 0.050000 for 5% and TEN held `5`, all from one day. To every
// reader those ten said five hundred per cent. No figure was wrong, because all ten carried
// `discount = 0` — but one discount on any of them would have grossed at 600% instead of 105%,
// driven `net_amount` to −₹390, and migration 390's floor would have shown it as ₹0 collected. The
// fix that stops a takings column reading below zero would have HIDDEN this one.
//
// HOW THEY GOT IN, WHICH IS THE PART WORTH GUARDING. `lfh_plausible_tax_rate` already refuses 5
// and `lfh_stamp_order_tax_rate` consults it — neither failed. The trigger only FILLS the column
// when it arrives null, so a writer that supplies its own `tax_rate` was never checked, and nothing
// validated the column. Migration 396 repaired the ten and put a CHECK on the column. This guard is
// what notices if that CHECK is ever dropped, if a row gets past it, or if the app starts writing a
// percentage again at a call site.
//
// THREE HALVES:
//   A  SOURCE  — migration 396 still declares the constraint, and its repair still carries a
//                one-time ledger key (a re-seed must not clear a rate that is legitimate by then).
//   B  LIVE    — the CHECK is installed, and no row in the table is outside the band.
//   C  CALLERS — no TypeScript call site writes a bare integer into tax_rate. A CHECK catches the
//                write at runtime; this catches it in review, which is cheaper.
//
// READ-ONLY. Exit 1 = a rate could be a percentage again. Exit 2 = could not run.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const ok = (good, msg) => { console.log(`${good ? "✓" : "✗"} ${msg}`); if (!good) bad++; };
const head = (t) => console.log(`\n── ${t}`);

// ── A · the migration still says it ───────────────────────────────────────────────────────────
head("A · migration 396 declares the constraint, and its repair is write-once");
{
  const MIG = join(root, "supabase", "migrations");
  const f = readdirSync(MIG).find((x) => /^396_a_stamped_tax_rate_must_be_a_rate\.sql$/.test(x));
  if (!f) { ok(false, "396_a_stamped_tax_rate_must_be_a_rate.sql is missing from supabase/migrations"); }
  else {
    const src = readFileSync(join(MIG, f), "utf8");
    ok(/orders_tax_rate_is_a_rate/.test(src), "it names the constraint orders_tax_rate_is_a_rate");
    ok(/tax_rate\s*>=\s*0\s*AND\s*tax_rate\s*<=\s*0\.5/i.test(src),
      "the band it declares is 0..0.5 — the same outer bound lfh_plausible_tax_rate uses, not a second invented number");
    ok(/lfh_already_applied\('396_null_impossible_tax_rates'\)/.test(src),
      "the UPDATE that repairs live rows is wrapped in the one-time ledger, so a re-seed cannot clear a rate that is legitimate by then");
    ok(/pg_constraint[\s\S]{0,300}orders_tax_rate_is_a_rate/.test(src),
      "the constraint is added only IF NOT EXISTS, so the file is safe to run twice");
    ok(!/UPDATE\s+public\.orders[\s\S]{0,200}\b(total|subtotal|tax|discount|disc_gross)\s*=/i.test(src),
      "it writes no money column — only the stamped rate is cleared (compliance: a sale is never edited)");
  }
}

// ── B · the database enforces it, and holds nothing outside the band ──────────────────────────
head("B · the live column refuses a percentage, and every row is inside the band");
{
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) {
    console.log("⏭  skipped: no .env.local, so there is no database to ask. Half A already read the folder,");
    console.log("   which is the source of truth for both databases. Not a failure.");
  } else {
    const env = Object.fromEntries(readFileSync(envPath, "utf8").split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
    if (!env.SUPABASE_ACCESS_TOKEN || !env.NEXT_PUBLIC_SUPABASE_URL) {
      console.log("⏭  skipped: no SUPABASE_ACCESS_TOKEN in .env.local. Half A stands.");
    } else {
      const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
      // A slow endpoint is BUSY, not broken (the rule this repo applies to its own rig): a
      // generous deadline and jittered backoff, then stand down with a sentence rather than a
      // stack trace. A refusal is not retried — that answer is real.
      const sleep = (ms) => { const t = Date.now() + ms; while (Date.now() < t) { /* no timers */ } };
      let rows = null, why = "";
      for (let i = 0; i < 5 && !rows; i++) {
        try {
          const out = execFileSync("curl", ["-4", "-s", "--max-time", "120", "-X", "POST",
            `https://api.supabase.com/v1/projects/${ref}/database/query`,
            "-H", `Authorization: Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
            "-H", "Content-Type: application/json", "--data-binary", "@-"],
            { input: JSON.stringify({ read_only: true, query: `
              SELECT (SELECT count(*)::int FROM orders WHERE tax_rate IS NOT NULL
                        AND (tax_rate < 0 OR tax_rate > 0.5))                        AS out_of_band,
                     (SELECT count(*)::int FROM orders WHERE tax_rate IS NOT NULL)   AS stamped,
                     (SELECT count(*)::int FROM orders WHERE tax_rate > 1)           AS percentages,
                     (SELECT coalesce(pg_get_constraintdef(oid), 'NONE') FROM pg_constraint
                       WHERE conrelid = 'public.orders'::regclass
                         AND conname = 'orders_tax_rate_is_a_rate')                  AS check_def` }),
            encoding: "utf8", maxBuffer: 1 << 26 });
          const j = JSON.parse(out);
          if (!Array.isArray(j)) { why = String((j && j.message) || out).slice(0, 140); break; }
          rows = j;
        } catch (e) { why = String(e?.message || e).slice(0, 90); sleep(2 ** i * 800); }
      }
      if (!rows) {
        console.log(`⏭  skipped: could not reach the database (${why}). Half A stands.`);
      } else {
        const r = rows[0];
        ok(r.check_def !== "NONE" && /tax_rate/.test(String(r.check_def)),
          `the CHECK is installed: ${r.check_def}`);
        ok(Number(r.out_of_band) === 0,
          `no order holds a rate outside 0..0.5 (${r.stamped} orders carry a stamped rate)`);
        ok(Number(r.percentages) === 0,
          `and none holds a value above 1, which is what a percentage written as a whole number looks like (${r.percentages})`);
      }
    }
  }
}

// ── C · no call site writes a percentage ──────────────────────────────────────────────────────
head("C · no SHIPPED call site writes a whole number into tax_rate");
// ONLY app/ AND lib/, AND THAT IS NOT LAZINESS. The first version of this half walked the whole
// repo and flagged two lines in `scripts/sweep/t27r2/` — which are DELIBERATE negative tests
// ("a tax rate above 100% cannot be stored", saving 9 to prove it is refused). A guard that fails
// on a test proving the opposite of the fault protects nothing: people learn to ignore its red, and
// the day a real one appears it is one line in a list everybody skips. That is the same reasoning
// verify-rpc-scoped.mjs writes down for the `reference/` snapshot.
//
// So the scope is the SHIPPED code: a route or a library that writes a percentage is a fault, and a
// probe that writes one on purpose is a check doing its job. The database CHECK from migration 396
// is what covers everything else, including any script.
{
  const ROOTS = ["app", "lib"];
  const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build"]);
  const files = [];
  (function walkAll() {
    for (const r of ROOTS) {
      const base = join(root, r);
      if (!existsSync(base)) continue;
      (function walk(d) {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(join(d, e.name)); continue; }
          if (/\.(ts|tsx)$/.test(e.name)) files.push(join(d, e.name));
        }
      })(base);
    }
  })();
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    for (const m of src.matchAll(/tax_rate\s*:\s*([0-9]+(?:\.[0-9]+)?)/g))
      if (Number(m[1]) > 0.5) offenders.push(`${f.replace(root + "/", "")}: tax_rate: ${m[1]}`);
  }
  ok(files.length > 50, `read ${files.length} shipped source files under app/ and lib/ (if this drops to nothing the walk broke, not the app)`);
  ok(offenders.length === 0, offenders.length === 0
    ? "no shipped call site assigns a tax_rate above 0.5 — every one writes a fraction"
    : `${offenders.length} call site(s) write a whole-number rate: ${offenders.join("; ")}. tax_rate is a FRACTION — 0.05, not 5.`);
}

console.log(bad === 0
  ? "\n✅ a stamped tax rate is a fraction, and the column refuses anything else."
  : `\n❌ ${bad} problem(s) — a tax rate could be a percentage again.`);
process.exit(bad === 0 ? 0 : 1);
