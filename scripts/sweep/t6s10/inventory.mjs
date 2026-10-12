// scripts/sweep/t6s10/inventory.mjs — WHICH existing ledger rows are about MY half of editor/app.js?
//
// Earlier sweeps cut the product differently, so no ledger file is "mine". This walks every ledger
// row and decides, from the row's own words, whether its SUBJECT sits in lines 1..MY_LAST_LINE:
//
//   · a `read the shipped file · has(app, /re/)` row (T5.md's own re-runnable form) is mine when the
//     FIRST place its pattern matches in app.js is in my half — the line the row is actually about;
//   · any other row is mine when every app.js name it mentions (functions, constants, data-*
//     attributes, state keys) is DECLARED or EMITTED in my half, and it names no other subject file;
//   · a row that names only the panel in general ("the Bills tab", "the dashboard") is matched by
//     the screen it names, through SCREENS below — each screen's renderer lives in exactly one half.
//
//   node scripts/sweep/t6s10/inventory.mjs            # counts per ledger
//   node scripts/sweep/t6s10/inventory.mjs --list     # every row, with the reason it is mine
//   node scripts/sweep/t6s10/inventory.mjs --json f   # write the list for the re-run scripts
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, APP, CODE, MY_END_AT, DECLS } from "./lib.mjs";

const LEDGER = join(ROOT, ".claude/sweep/LEDGER");
const A = process.argv.slice(2);

// A name counts only if it is long enough to be specific and is declared in app.js at all.
const firstDecl = (n) => (DECLS.get(n) || [])[0];
const emittedAt = (attr) => { const i = APP.search(new RegExp(`data-${attr}\\s*=\\s*["'\`]|data-${attr}[\\s>"]`)); return i; };
// The screens a row can name without naming a function, and the function that draws each one.
const SCREENS = [
  [/\bbills? (tab|record|list|screen)|previous[- ]bills|bill-line|bill receipt|\.bill-rcp|billReceipt|the record\b/i, "ordersPreviousHtml"],
  [/\bpay later\b|khata/i, "ordersKhataHtml"],
  [/\bdashboard\b|\bkpi\b|dash-card|chSales|chHours|day parts/i, "loadDashboard"],
  [/\bratings?\b tab|guest ratings|renderRatings/i, "renderRatings"],
  [/\bsettings\b.*\b(section|tables|users|billing|sessions|sections)\b|formGeneral|table setting card/i, "formGeneral"],
  [/\bgst report\b/i, "openGstReport"],
  [/\bz[- ]report\b|day[- ]close/i, "openZReport"],
  [/\bstaff watch\b/i, "openStaffRisk"],
  [/\bmenu (winners|matrix)\b/i, "openMenuMatrix"],
  [/\bpay(ment)? (sheet|method|modal)|split payment|openPaymentMethodModal/i, "openPaymentMethodModal"],
  [/\bdish (form|editor)\b|formItems|\bcategory form|formCategories|tag form|formFilters/i, "formItems"],
];
const OTHER_FILES = /route\.ts|index\.html|style\.css|tablet\/app\.js|kitchen\/app\.js|billdoc\.js|inventory\.js|floor-layouts|outbox\.js|offline\.js|backstack|layout\.tsx|page\.tsx|lib\/[a-zA-Z]+\.ts|migration|mig \d{3}\b.*\bsql|supabase\//;

function classify(row, file) {
  const text = row.check + " " + row.how + " " + row.note;
  // T5.md's executable form: attribute by where the pattern lands.
  const dsl = row.how.match(/read the shipped files? · (.*)$/);
  if (dsl && /\bapp\b/.test(dsl[1]) && !/\b(html|css|route|editorRoute|mgrPage|mgrLayout|edPage|tab|kit|doc|inv|fl|outbox)\b\s*,/.test(dsl[1].replace(/has\(app,|hasNot\(app,|count\(app,/g, ""))) {
    const re = dsl[1].match(/has(?:Not)?\(\s*(?:app|noComments\(app\)|noCommentsFn\(app\))\s*,\s*(\/(?:\\.|[^/])+\/[a-z]*)\s*\)/);
    if (re) {
      let rx; try { const body = re[1].replace(/¦/g, "|"); const last = body.lastIndexOf("/"); rx = new RegExp(body.slice(1, last), body.slice(last + 1)); } catch { rx = null; }
      if (rx) {
        const m = APP.search(rx);
        if (m >= 0) return m < MY_END_AT ? { mine: true, why: `pattern lands at line ${APP.slice(0, m).split("\n").length}` } : { mine: false, why: "pattern lands in the other halves" };
        // An ABSENCE assertion (hasNot) or a pattern that no longer matches: decide by the names.
      }
    }
  }
  if (/\b(sweep10|S10)\b/.test(file) && !/T6-S10/.test(file)) { /* another sweep-10 terminal's row: theirs unless it is clearly about my half */ }
  const names = new Set();
  for (const m of text.matchAll(/`([A-Za-z_$][\w$]{3,})(?:\(\))?`|\b([a-z][a-z0-9]*[A-Z][A-Za-z0-9]{2,})\b/g)) { const n = m[1] || m[2]; if (DECLS.has(n)) names.add(n); }
  const attrs = new Set([...text.matchAll(/\bdata-([a-z][a-z0-9-]{2,})/g)].map((m) => m[1]));
  const mineN = [...names].filter((n) => firstDecl(n) < MY_END_AT), otherN = [...names].filter((n) => firstDecl(n) >= MY_END_AT);
  const mineA = [...attrs].filter((a) => { const i = emittedAt(a); return i >= 0 && i < MY_END_AT; });
  const otherA = [...attrs].filter((a) => { const i = emittedAt(a); return i >= MY_END_AT; });
  const mentionsApp = /editor\/app\.js|manager panel|\bapp\.js\b/i.test(text);
  if ((mineN.length || mineA.length) && !otherN.length && !otherA.length) return { mine: true, why: `names ${[...mineN, ...mineA.map((a) => "data-" + a)].slice(0, 3).join(", ")}` };
  if ((mineN.length || mineA.length) && (otherN.length || otherA.length)) return { mine: "shared", why: `names both halves: ${[...mineN, ...otherN].slice(0, 4).join(", ")}` };
  if (otherN.length || otherA.length) return { mine: false, why: `names ${[...otherN, ...otherA].slice(0, 2).join(", ")}` };
  if (mentionsApp || file === "T5.md" || file === "T6.md") {
    for (const [re, fn] of SCREENS) if (re.test(text) && DECLS.has(fn)) return firstDecl(fn) < MY_END_AT ? { mine: true, why: `screen drawn by ${fn}` } : { mine: false, why: `screen drawn by ${fn}` };
  }
  return { mine: false, why: "no subject in my half" };
}

const out = [];
for (const file of readdirSync(LEDGER).filter((f) => /^T\d+.*\.md$/.test(f)).sort()) {
  const lines = readFileSync(join(LEDGER, file), "utf8").split("\n");
  // Only sections that are about the manager panel at all, or rows that name it.
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (!/^\| P\d{5,6} \|/.test(L)) continue;
    const c = L.split(/(?<!\\)\|/).map((x) => x.trim());
    const row = { file, line: i + 1, id: c[1], check: c[2] || "", how: c[3] || "", result: c[4] || "", note: c.slice(5).join(" | ") };
    const sectionIsManager = (file === "T5.md" && i < 1636) || (file === "T6.md" && i >= 1830);
    const namesApp = /editor\/app\.js|editor app\.js/.test(L);
    if (!sectionIsManager && !namesApp) continue;
    if (file === "T6-S10.md") continue;          // my own new ledger
    if (!sectionIsManager && OTHER_FILES.test(row.check) && !namesApp) continue;
    const k = classify(row, file);
    out.push({ ...row, mine: k.mine, why: k.why, sectionIsManager });
  }
}
const mine = out.filter((r) => r.mine === true), shared = out.filter((r) => r.mine === "shared");
if (A.includes("--list")) for (const r of [...mine, ...shared]) console.log(`${r.mine === true ? "MINE  " : "SHARED"} ${r.id} ${r.file}:${r.line}  ${r.check.slice(0, 80)}  [${r.why}]`);
const by = {};
for (const r of out) { const k = r.file; by[k] ||= { seen: 0, mine: 0, shared: 0 }; by[k].seen++; if (r.mine === true) by[k].mine++; if (r.mine === "shared") by[k].shared++; }
console.log(Object.entries(by).map(([k, v]) => `${k.padEnd(14)} seen ${String(v.seen).padStart(5)}  mine ${String(v.mine).padStart(5)}  shared ${String(v.shared).padStart(4)}`).join("\n"));
console.log(`TOTAL mine ${mine.length} · shared ${shared.length} · looked at ${out.length}`);
const ji = A.indexOf("--json"); if (ji >= 0) writeFileSync(A[ji + 1], JSON.stringify(out, null, 1));
