// scripts/sweep/t24-run.mjs — the executor behind .claude/sweep/LEDGER/T24-S8.md.
//
// Sweep #8, terminal 24 · territory: app/api/editor/[...path]/route.ts lines 1 → ~3,000 —
// the helper block, the whole GET handler, the floor-snapshot write wrapper, and the first
// POST branches. Every manager action in the product goes through this file.
//
//   node scripts/sweep/t24-run.mjs                 # run everything, print the ledger table
//   node scripts/sweep/t24-run.mjs --quiet         # only ✗ rows
//   node scripts/sweep/t24-run.mjs --ledger        # emit the markdown table only
//   node scripts/sweep/t24-run.mjs --only P77801   # one row
//
// A row is `check(id, what, how, fn)`. `fn` returns true / false / "skip: <reason>".
// Nothing here writes to the database. The LIVE half needs this terminal's own dev server
// (T24_BASE, default http://127.0.0.1:4324) — never port 4000, which is the owner's window.
import * as F from "./t24-fixtures.mjs";

const ARGV = process.argv.slice(2);
const QUIET = ARGV.includes("--quiet");
const LEDGER_ONLY = ARGV.includes("--ledger");
const ONLY = (ARGV.find((a) => a.startsWith("--only")) || "").split("=")[1]
  || (ARGV.includes("--only") ? ARGV[ARGV.indexOf("--only") + 1] : null);

// ── THIS TERMINAL'S PRE-ALLOCATED ID BLOCK ────────────────────────────────────────────────────
// P77701–P78700, sweep #8 terminal 24's alone. Ids are handed out in LOAD ORDER from one counter,
// so a check inserted in the middle shifts every id after it — which is why the generated
// per-statement block carries a lock-the-count row of its own. Append at the end; never renumber.
export const ID_FLOOR = 77701;
export const ID_CEILING = 78700;
let nextId = ID_FLOOR;
export const nid = () => {
  if (nextId > ID_CEILING) throw new Error(`terminal 24's id block P${ID_FLOOR}-P${ID_CEILING} is exhausted — STOP and say so, do not take another terminal's range`);
  return "P" + nextId++;
};

const rows = [];
const defs = [];
export const check = (id, what, how, fn) => defs.push({ id, what, how, fn });

const s = (x) => String(x).replace(/\|/g, "\\|").replace(/\n/g, " ");

async function main() {
  const seen = new Set();
  for (const d of defs) {
    if (seen.has(d.id)) throw new Error(`duplicate id ${d.id}`);
    seen.add(d.id);
  }
  for (const d of defs) {
    if (ONLY && d.id !== ONLY) continue;
    let res, note = "";
    try {
      res = await d.fn();
    } catch (e) {
      res = false;
      note = `threw: ${(e && e.message) || e}`.slice(0, 120);
    }
    let mark;
    if (typeof res === "string" && res.startsWith("skip:")) { mark = "⏭"; note = res.slice(5).trim(); }
    else if (res && typeof res === "object") { mark = res.ok ? "✅" : "❌"; note = res.note || note; }
    else mark = res ? "✅" : "❌";
    rows.push({ ...d, mark, note });
    if (!LEDGER_ONLY && (!QUIET || mark === "❌")) {
      console.log(`${mark} ${d.id}  ${d.what}${note ? `   — ${note}` : ""}`);
    }
  }
  const bad = rows.filter((r) => r.mark === "❌");
  const skipped = rows.filter((r) => r.mark === "⏭");
  if (LEDGER_ONLY) {
    console.log("| id | what | how | result | notes |");
    console.log("|---|---|---|---|---|");
    for (const r of rows) console.log(`| ${r.id} | ${s(r.what)} | ${s(r.how)} | ${r.mark} | ${s(r.note)} |`);
  } else {
    console.log(`\n${rows.length} checks · ${rows.length - bad.length - skipped.length} ✅ · ${bad.length} ❌ · ${skipped.length} ⏭`);
    if (bad.length) { console.log("\nfailures:"); for (const b of bad) console.log(`  ${b.id}  ${b.what}${b.note ? ` — ${b.note}` : ""}`); }
  }
  process.exit(bad.length ? 1 : 0);
}

export function run() { return main(); }
export { F };
