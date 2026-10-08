// verify-money-pointers.mjs — every pointer in the money and compliance files leads where it says.
//
// WHY THIS EXISTS (sweep #10, terminal 30, 2026-10-09). These files are the ones a session is told
// to read BEFORE it touches billing — docs/COMPLIANCE-GUARDRAILS.md says so in its first line — and
// three of them were sending the reader to the wrong place:
//
//   · docs/CANCEL-AND-LOSS-SPEC.md said the cancel-and-loss work is "Migration 337". The file was
//     renumbered to 340 on 2026-08-19 (two other files had also taken 337) and the doc never moved;
//     337 is a report about the takings. Ledger row P14078 had passed it as "names no migration
//     number at all, so it cannot be stale" — true when written, false once §4b was added.
//   · lib/tax.ts said lfh_resolve_tax_mode / lfh_split_items_tax are "migration 269" (that one is
//     about printing) and lfh_order_discount_base is "271" (the session's split state). They live
//     in 270, restated by 272.
//   · docs/COMPLIANCE-GUARDRAILS.md said admin_purge_restaurant "has been rewritten six times" and
//     that verify:admin-restaurants "still reads migration 342 only". Twelve files defined it, and
//     that guard had long since been pointed at the newest one.
//
// None of those breaks a bill. Each one costs the next person a wrong file at the exact moment they
// are about to change money, which is why it is checked rather than re-found by the next sweep.
//
// Static, instant, no server and no database:  node scripts/verify-money-pointers.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

// The money and compliance territory of sweep #10 terminal 30 — the files this guard speaks for.
const FILES = [
  "docs/BUSINESS-LOGIC-AUDIT.md", "docs/CANCEL-AND-LOSS-SPEC.md", "docs/COMPLIANCE-GUARDRAILS.md",
  "docs/SAAS-EFFICIENCY-PLAYBOOK.md", "lib/clash.ts", "lib/clashCompare.ts", "lib/dbRefusal.ts",
  "lib/discountCap.ts", "lib/idempotency.ts", "lib/idempotencyRule.ts", "lib/money.mjs",
  "lib/money.ts", "lib/paySplit.ts", "lib/payments.ts", "lib/readGuard.ts", "lib/tax.ts",
  "lib/taxFiling.ts", "tests/money.test.mjs", "tests/order-totals.e2e.mjs",
];

let passed = 0, failed = 0;
const ok = (m) => { passed++; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed++; console.log(`  ✗ ${m}`); };
const check = (cond, good, why) => (cond ? ok(good) : bad(why));

const migs = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
const migText = new Map(migs.map((f) => [f, read(`supabase/migrations/${f}`)]));
// Several migration numbers are used twice here (established practice), so a number names a SET.
const byNum = (n) => migs.filter((f) => f.startsWith(String(n).padStart(3, "0") + "_"));
const definers = (fn) => migs.filter((f) => new RegExp(String.raw`FUNCTION\s+(public\.)?${fn}\b`, "i").test(migText.get(f)));

console.log("\nMONEY POINTERS · every pointer in the money and compliance files leads where it says\n");

// ── 1. A database function named beside a migration number is IN that migration ─────────────────
// The line and the one after it are read together, because a comment wraps: "(migration\n// 269)".
{
  let seen = 0;
  const wrong = [];
  for (const f of FILES) {
    const lines = read(f).split("\n");
    lines.forEach((line, i) => {
      const fns = [...line.matchAll(/\b((?:lfh|admin|rt)_[a-z0-9_]+)\b/g)].map((m) => m[1]);
      if (!fns.length) return;
      const next = (lines[i + 1] || "").replace(/^\s*(\/\/|\*|--)?/, "");
      const nums = [...(line + " " + next).matchAll(/(?:\bmig(?:ration)?s?\.?\s*|\(|\/)(\d{3})\b/gi)].map((m) => m[1]);
      if (!nums.length) return;
      for (const fn of fns) {
        seen++;
        if (!nums.some((n) => byNum(n).some((m) => migText.get(m).includes(fn)))) {
          wrong.push(`${f}:${i + 1} names ${fn} beside migration ${nums.join("/")}, and none of those mention it`);
        }
      }
    });
  }
  if (!wrong.length) ok(`all ${seen} "function + migration number" pointers name a migration that really contains that function`);
  else for (const w of wrong) bad(w);
  // A guard that matched nothing would pass forever; lib/tax.ts alone carries several of these.
  check(seen >= 4, `…and there were ${seen} of them to check, so this is not passing on an empty set`,
    `only ${seen} pointers were found — the pattern has stopped matching the way these files write them`);
}

// ── 2. Every path, npm script and migration file named in these files exists ──────────────────────
{
  const all = FILES.map(read).join("\n");
  const paths = [...new Set([...all.matchAll(/\b((?:lib|app|scripts|public|components|tests|supabase\/migrations)\/[A-Za-z0-9_.\/\[\]-]+\.(?:ts|tsx|mjs|js|md|sql))\b/g)].map((m) => m[1]))];
  const missing = paths.filter((p) => !existsSync(join(root, p)));
  check(!missing.length, `all ${paths.length} file paths named in these files exist`, `named but missing: ${missing.join(", ")}`);
  const scripts = JSON.parse(read("package.json")).scripts || {};
  const named = [...new Set([...all.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map((m) => m[1]))];
  const gone = named.filter((k) => !scripts[k]);
  check(!gone.length, `all ${named.length} \`npm run …\` commands named in these files are real npm scripts`, `named but not in package.json: ${gone.join(", ")}`);
}

// ── 3. The cancel-and-loss spec names the migration that actually built it ───────────────────────
{
  const spec = read("docs/CANCEL-AND-LOSS-SPEC.md");
  const m = /Migration \*\*(\d{3})\*\*/.exec(spec);
  const built = definers("lfh_cancel_classify");
  check(!!m && byNum(m[1]).some((f) => built.includes(f)),
    `docs/CANCEL-AND-LOSS-SPEC.md names migration ${m ? m[1] : "?"}, which is where lfh_cancel_classify is defined`,
    `docs/CANCEL-AND-LOSS-SPEC.md names migration ${m ? m[1] : "(none)"}, but lfh_cancel_classify is defined in ${built.join(", ") || "no migration at all"}`);
}

// ── 4. The compliance doc does not hard-code how many times the purge was rewritten ──────────────
{
  const doc = read("docs/COMPLIANCE-GUARDRAILS.md");
  const n = definers("admin_purge_restaurant").length;
  check(!/admin_purge_restaurant`?\s+has been rewritten\s+\w+\s+times/i.test(doc),
    `the compliance doc no longer types a rewrite count for admin_purge_restaurant (${n} files define it today)`,
    "docs/COMPLIANCE-GUARDRAILS.md hard-codes how many times admin_purge_restaurant was rewritten — that count went stale once already; give the command instead");
  check(/grep -liE "FUNCTION\\s\+\(public\\\.\)\?admin_purge_restaurant" supabase\/migrations\/\*\.sql/.test(doc),
    "…and it gives the command that re-derives the list",
    "docs/COMPLIANCE-GUARDRAILS.md no longer gives the command that lists every migration defining admin_purge_restaurant");
  const followsNewest = /purgeMigs/.test(read("scripts/verify-admin-restaurants.mjs"));
  check(!(followsNewest && /verify:admin-restaurants`? still reads migration 342 only/i.test(doc)),
    "…and it does not claim verify:admin-restaurants reads migration 342 only, which stopped being true",
    "docs/COMPLIANCE-GUARDRAILS.md says verify:admin-restaurants reads migration 342 only, but that guard follows the newest purge (purgeMigs)");
}

console.log(`\n${failed ? "✗ FAIL" : "✓ PASS"} — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
