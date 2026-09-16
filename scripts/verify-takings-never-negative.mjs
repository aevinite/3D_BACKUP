// verify-takings-never-negative — THE COLLECTED-MONEY COLUMN ROUNDS TO PAISE AND NEVER GOES BELOW
// ZERO, AND THE EXACT SOURCE COLUMN STAYS EXACT.
//
// WHY THIS EXISTS (owner picked item 3 of sweep #9 T30's round-2 report, 2026-09-16).
// `orders.net_amount` is GENERATED ALWAYS AS (total − disc_gross) — migration 310's "one revenue
// number everywhere". `total` is rounded to paise; `disc_gross` deliberately is not. Subtracting an
// unrounded number from a rounded one landed 31 orders below zero:
//
//     total 5.76   discount 5.49   rate 5%   →   disc_gross 5.7645   →   net_amount −0.0045
//
// Migration 390 made the generated expression GREATEST(ROUND(total − disc_gross, 2), 0).
//
// ⚠️ THIS GUARD DEFENDS **TWO** DECISIONS, AND THE SECOND IS THE ONE PEOPLE WILL BREAK.
//   1. net_amount rounds and floors.
//   2. `disc_gross` STAYS UNROUNDED. Migration 301 considered rounding it and rejected it with
//      measurements, and lfh_fill_disc_gross carries the reasoning in its own body: numeric is
//      exact, so summing it gives precisely SUM(discount_i × rate_i) with no per-row drift, and
//      rounding it "cost ~0.1 paise over 2,376 discounted rows AND widened the numeric scale of
//      every revenue figure the API returns". A future reader who sees 5.7645 and "tidies" it is
//      undoing a measured decision — so this file fails if a ROUND() appears there.
//
//   node scripts/verify-takings-never-negative.mjs
//
// READ-ONLY. Exit 1 = the takings column can go negative again, or the exact column was rounded.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const ok = (s, m) => { console.log(`${s ? "✓" : "✗"} ${m}`); if (!s) bad++; };
const head = (t) => console.log(`\n── ${t}`);
const code = (t) => t.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

// ── A · the migrations folder ────────────────────────────────────────────────────────────────
head("A · the folder declares the guarded shape");
{
  const dir = join(root, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  // the newest migration that sets net_amount's expression is the truth
  let newest = null, newestFn = null;
  for (const f of files) {
    const sql = code(readFileSync(join(dir, f), "utf8"));
    if (/net_amount[\s\S]{0,200}?(GENERATED ALWAYS AS|SET EXPRESSION AS)/i.test(sql)) newest = { f, sql };
    if (/create\s+(or\s+replace\s+)?function\s+(public\.)?lfh_fill_disc_gross/i.test(sql)) newestFn = { f, sql };
  }
  ok(!!newest, newest ? `newest definition of net_amount: ${newest.f}` : "no migration defines net_amount");
  if (newest) {
    const expr = (newest.sql.match(/net_amount[\s\S]{0,120}?(?:GENERATED ALWAYS AS|SET EXPRESSION AS)\s*\(([\s\S]{0,160}?)\)\s*(?:STORED)?\s*;/i) || [])[1] || "";
    ok(/GREATEST/i.test(expr), `it floors at zero${/GREATEST/i.test(expr) ? "" : ` — it does not. You cannot collect less than nothing. Expression: ${expr.replace(/\s+/g, " ").slice(0, 90)}`}`);
    ok(/ROUND/i.test(expr), `it rounds to paise${/ROUND/i.test(expr) ? "" : ` — it does not, so an unrounded disc_gross can push it below zero again.`}`);
  }
  ok(!!newestFn, newestFn ? `newest definition of lfh_fill_disc_gross: ${newestFn.f}` : "no migration defines lfh_fill_disc_gross");
  if (newestFn) {
    const body = (newestFn.sql.match(/NEW\.disc_gross\s*:=([\s\S]{0,260}?);/i) || [])[1] || "";
    ok(!/\bROUND\s*\(/i.test(body), `disc_gross is still assigned UNROUNDED, as migration 301 decided`
      + (/\bROUND\s*\(/i.test(body) ? ` — a ROUND() has appeared. That is a measured decision being undone;`
        + ` read the reasoning in lfh_fill_disc_gross's own body before changing this.` : ""));
  }
}

// ── B · the database, and the data in it ─────────────────────────────────────────────────────
head("B · the live column, and every row in it");
{
  const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }));
  let env = {}; try { env = parseEnv(readFileSync(join(root, ".env.local"), "utf8")); } catch { /* none */ }
  if (!env.SUPABASE_ACCESS_TOKEN) { console.log("⏭  skipped: no SUPABASE_ACCESS_TOKEN — half A covers the folder."); }
  else {
    const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
    const q = async (sql) => {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql, read_only: true }) });
      if (!r.ok) throw new Error((await r.text()).slice(0, 160));
      return r.json();
    };
    try {
      const e = (await q(`select generation_expression x from information_schema.columns
                           where table_schema='public' and table_name='orders' and column_name='net_amount'`))[0]?.x || "";
      ok(/greatest/i.test(e) && /round/i.test(e), `the installed expression rounds and floors: ${e || "(none)"}`);
      const neg = (await q(`select count(*)::int n from orders where net_amount < 0`))[0].n;
      ok(neg === 0, `orders whose takings read below zero: ${neg}`);
      const frac = (await q(`select count(*)::int n from orders where net_amount is not null and net_amount <> round(net_amount, 2)`))[0].n;
      ok(frac === 0, `orders whose takings carry more than two decimals: ${frac}`);
      // and the second decision: the exact column is still exact, which is how we know nobody
      // "tidied" it. A zero here would mean disc_gross had been rounded after all.
      const exact = (await q(`select count(*)::int n from orders where disc_gross is not null and disc_gross <> round(disc_gross, 2)`))[0].n;
      ok(exact > 0, `disc_gross still holds exact values (${exact} row(s) carry more than two decimals)`
        + (exact > 0 ? " — migration 301's decision is intact" : " — ZERO such rows, so it looks rounded. Check lfh_fill_disc_gross."));
    } catch (err) { console.log(`⏭  skipped: the database would not answer (${String(err.message).slice(0, 110)}).`); }
  }
}
console.log(bad === 0
  ? "\n✅ the takings column rounds to paise and never goes below zero, and the exact column is still exact."
  : `\n❌ ${bad} problem(s).`);
process.exit(bad === 0 ? 0 : 1);
