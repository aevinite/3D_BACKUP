// T6 · the STATIC half of both rounds, re-runnable: no server, no browser, no database.
//   node scripts/sweep/t6/static.mjs
// Covers the ledger blocks that read the code:
//   round 1  P59701-P59965   every data-* hook, api() path, constant, state key and empty state
//   round 2  P60217-P60538   is every declaration in this half actually REACHED?
//   plus     P60205-P60216   the twelve faults round 1 found — still fixed?
import { ROOT, read, strip, MINE_END, reporter } from "./lib.mjs";

const RAW = read("public/panels/editor/app.js");
if (!RAW) { console.log("editor/app.js is not in this checkout — nothing to check."); process.exit(0); }
const CODE = strip(RAW);
const LINES = RAW.split("\n");
const mineRaw = LINES.slice(0, MINE_END).join("\n");
const mineCode = CODE.split("\n").slice(0, MINE_END).join("\n");
const ROUTE = read("app/api/editor/[...path]/route.ts");
const HTML = read("public/panels/editor/index.html");
const TABLET = read("public/panels/tablet/app.js");
const KITCHEN = read("public/panels/kitchen/app.js");
const BILLDOC = read("public/panels/billdoc.js");
const R = reporter("T6 STATIC");

// ── A · every data-* hook the top half EMITS is read back somewhere ───────────────────────────
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const emitted = new Map();
for (const m of mineRaw.matchAll(/data-([a-z][a-z0-9-]*)\s*=\s*["'`]/g))
  if (!emitted.has(m[1])) emitted.set(m[1], LINES.findIndex((l) => l.includes(`data-${m[1]}`)) + 1);
for (const [attr, ln] of [...emitted].sort()) {
  const byQuery = RAW.includes(`[data-${attr}]`) || RAW.includes(`[data-${attr}=`);
  const byDataset = new RegExp(`\\.dataset\\.${camel(attr)}\\b`).test(RAW);
  const isHook = /^(menu-part|mgr-hide|action|arg|path|num|tab|cu|cu-fmt|bill-print-btn|bill-print-sid|memb|nw-table|nw-all|nw-none|sec-|au-|perm-|staff-|khata-|bulk|logview-side|orders-view|settings-section|cat|idx|i|n|mode|method|special|oc|v|tip-pct|dish|ret|copy-link|lfh-fit-base|floor-table|take-order|quick-accept|qop)/.test(attr);
  R.add(`data-${attr}= is read back somewhere (emitted line ${ln})`, byQuery || byDataset || isHook,
        byQuery || byDataset || isHook ? "" : "emitted and NOTHING reads it");
}
// ── B · every api() path names something the editor route answers ─────────────────────────────
for (const c of [...new Set([...mineRaw.matchAll(/api\(\s*"(GET|POST|PATCH|DELETE)"\s*,\s*[`"]([^`"]+)/g)].map((m) => m[1] + " " + m[2]))].sort()) {
  const path = c.slice(c.indexOf(" ") + 1);
  const seg = path.replace(/^\//, "").split(/[/?$]/)[0];
  const known = seg === "" || ROUTE.includes(`"${seg}`) || new RegExp(`startsWith\\("${seg}`).test(ROUTE);
  R.add(`${c} names a path the editor route answers`, known, known ? "" : `route has no mention of "${seg}" — the call would 404`);
}
// ── C · every UPPER_CASE constant is read, not just declared ──────────────────────────────────
const TALLY_CONST = new Map();
for (const m of CODE.matchAll(/[A-Za-z_$][\w$]*/g)) TALLY_CONST.set(m[0], (TALLY_CONST.get(m[0]) || 0) + 1);
for (const cn of [...new Set([...mineCode.matchAll(/(?:^|\n)const\s+([A-Z][A-Z0-9_]{2,})\s*=/g)].map((m) => m[1]))]) {
  const uses = (TALLY_CONST.get(cn) || 0) - 1;
  R.add(`the constant ${cn} is read somewhere`, uses > 0, uses > 0 ? `${uses} use(s)` : "declared and never read — dead");
}
// ── D · every state.* key read is also written ────────────────────────────────────────────────
for (const k of [...new Set([...CODE.matchAll(/state\.([a-zA-Z_$][\w$]*)/g)].map((m) => m[1]))].sort()) {
  const written = new RegExp(`state\\.${k}\\s*=[^=]|\\b${k}\\s*:`).test(CODE);
  R.add(`state.${k} is written somewhere, not only read`, written, written ? "" : "read but never assigned — undefined forever (the state.helper scar)");
}
// ── E · every empty state says WHY it is empty ────────────────────────────────────────────────
for (const e of [...new Set([...mineRaw.matchAll(/class="(?:empty|sx-empty)[^"]*">([\s\S]{0,200}?)<\/div>/g)]
  .map((m) => m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()).filter(Boolean))]) {
  const ok = /[.!?…]|—/.test(e) || /\$\{/.test(e) || e.replace(/\$\{[^}]*\}/g, "").trim().length > 24;
  R.add(`the empty state "${e.slice(0, 46)}" says why, not just that`, ok, ok ? "" : "a bare label with no reason and no next step");
}
// ── F · round 2: is every declaration in this half REACHED? ───────────────────────────────────
// Line numbers from ONE pass over the lines, never `slice(0, m.index).split()` per match — that
// was O(n^2) over a 1.3 MB file and took this suite past two minutes.
const decl = new Map();
mineCode.split("\n").forEach((l, i) => {
  const f = l.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
  if (f && !decl.has(f[1])) { decl.set(f[1], i + 1); return; }
  const c = l.match(/^const\s+([A-Za-z_$][\w$]*)\s*=/);
  if (c && !decl.has(c[1])) decl.set(c[1], i + 1);
});
// numSel and openSectionsModal are KNOWN unreachable and deliberately kept: both were built for
// something the owner asked for and never wired up (reported as P60232 / P60326, awaiting his call).
// `$` cannot be word-matched, so it is counted by hand.
const KEPT_UNREACHABLE = new Map([
  ["numSel", 'a "pick a number, don\'t type one" field (owner, 2026-08-02) that nothing calls — reported, awaiting his decision'],
  ["openSectionsModal", 'the second door to the waiter rota for a manager who cannot reach Settings — reported, awaiting his decision'],
]);
// ONE pass counting every identifier in the file, instead of a whole-file regex per name.
const TALLY = new Map();
for (const m of CODE.matchAll(/[A-Za-z_$][\w$]*/g)) TALLY.set(m[0], (TALLY.get(m[0]) || 0) + 1);
for (const [name, line] of [...decl].sort((a, b) => a[1] - b[1])) {
  if (name === "$") { R.add("`$` (the find-an-element shorthand) is used", (CODE.match(/\$\(/g) || []).length > 5, ""); continue; }
  const uses = (TALLY.get(name) || 0) - 1;
  const ok = uses > 0 || HTML.includes(name);
  if (!ok && KEPT_UNREACHABLE.has(name)) { R.add(`${name} is reached from somewhere`, "skip", KEPT_UNREACHABLE.get(name)); continue; }
  R.add(`${name} is reached from somewhere, not just declared`, ok,
        ok ? "" : `declared at line ${line} and referenced NOWHERE in the repo — dead`);
}
// ── G · the twelve faults round 1 and round 2 found: STILL fixed? (the regression half) ───────
const reg = [
  ["item 1 · no bare browser dialog is left in the manager panel",
    () => ![...strip(RAW).replace(/window\.(prompt|confirm|alert)/g, "SAFE_$1").matchAll(/(?:^|[^.\w$])(alert|confirm|prompt)\s*\(/g)].length, "a prompt()/confirm() came back"],
  ["item 1 · renaming the printing computer still asks in the panel", () => /await promptDialog\("What should this computer be called\?"/.test(RAW), ""],
  ["item 1 · …and unlinking it does too", () => /await confirmDialog\(/.test(RAW) && /Unlink /.test(RAW), ""],
  ["item 2 · billsCapped reads rows+parcels, the fields the read returns", () => /Array\.isArray\(r\.rows\)/.test(RAW) && /Array\.isArray\(r\.parcels\)/.test(RAW), "back to reading .today/.previous?"],
  ["item 2 · …against the route's own 500-row bound, named once", () => /BILLS_WINDOW_CAP\s*=\s*500/.test(RAW), ""],
  ["item 2 · …and the Previous-bills search still consults it", () => /ordersViewKey\(\) === "previous" && billsCapped\(\)/.test(RAW), ""],
  ["item 3 · restoreBill's queue flag lives at function scope, not inside the try", () => /let okCount = 0, failCount = 0, anyQueued = false;/.test(RAW), ""],
  ["item 3 · …and a restore that changed nothing says so", () => /Nothing on this bill needed restoring/.test(RAW), ""],
  ["item 4 · the dish-edit save's queue flag is declared before the try", () => /let anyQueued = false;\s*\n\s*try \{/.test(RAW), ""],
  ["item 5 · the print label carries WHICH bill it is about", () => /data-bill-print-sid/.test(RAW), ""],
  ["item 5 · …and the relabel is scoped to that one bill", () => /data-bill-print-sid=\\"\$\{CSS\.escape\(sid\)\}/.test(RAW) || /CSS\.escape\(sid\)/.test(RAW), ""],
  ["item 6 · the undo toast reports the RESTORE's answer, not the delete's", () => /const _undoQ = await api\("POST", "\/" \+ kind, payload\);/.test(RAW), ""],
  ["item 8 · the four dead constants are gone", () => !/^const (STATUS_META|STATUS_RANK|REASONS_DELETE|REASONS_CLOSE)\b/m.test(strip(RAW)), ""],
  ["item 8 · …and so is the unread data-ch attribute", () => !/data-ch="/.test(RAW), ""],
  ["item 9 · no undo bar over a delete that deleted nothing", () => /if \(!done\) return;/.test(RAW), ""],
  ["item 12 · the five dead screens are gone", () => !/(function accessDefaultsCardHtml|function accessUsersCardHtml|function billRecordCardHtml|function parcelRecordCardHtml|const itemsOf)\b/.test(strip(RAW)), ""],
  ["item 12 · …and the machinery only they used", () => !/\bACCESS_CAPS\b|\bfunction triSel\b|\bfunction accessCapsFor\b|\[data-perm-user\]/.test(strip(RAW)), ""],
  ["item 13 · a rota's tables must be >= 1, so a blank cannot become table 0", () => /Number\.isFinite\(n\) && n >= 1/.test(RAW), ""],
  ["item 7 · maint.js asks for its deadline through the shared helper", () => /window\.LFH_PANEL_DEADLINE \? window\.LFH_PANEL_DEADLINE\(\) : undefined/.test(read("public/panels/maint.js")), "the bare deadline() call came back"],
  ["item 7 · …and maint.js is still CRLF (its guard checks that)", () => { const b = read("public/panels/maint.js"); const crlf = (b.match(/\r\n/g) || []).length, lf = (b.match(/\n/g) || []).length; return crlf > 0 && crlf === lf; }, "line endings were tidied"],
];
for (const [label, fn, why] of reg) { let ok; try { ok = !!fn(); } catch (e) { ok = false; } R.add(label, ok, ok ? "" : (why || "regressed")); }
// ── H · the cross-panel single-definition rules this territory shares ─────────────────────────
R.add("discPct is the ONE definition — editor, tablet and billdoc all call it",
  /function discPct\(subtotal, disc\) \{ return LFH_BILLDOC\.discPct/.test(RAW) && /discPct/.test(BILLDOC) && /discPct/.test(TABLET), "");
R.add("billMath is a one-line door onto LFH_BILLDOC.billMoney and derives nothing",
  /function billMath\(orders\) \{ return LFH_BILLDOC\.billMoney/.test(RAW), "");
R.add("kotWhen lives in ONE place — editor and kitchen both call it",
  /LFH_BILLDOC\.kotWhen/.test(RAW) && /LFH_BILLDOC\.kotWhen/.test(KITCHEN), "");
R.add("the manager panel uses the same five status words as every other surface",
  [...new Set([...RAW.matchAll(/"(received|preparing|served|ready|cancelled)"/g)].map((m) => m[1]))].sort().join(" ") === "cancelled preparing ready received served", "");
R.add("no popstate listener of its own — the back-button manager owns that",
  (RAW.match(/addEventListener\(\s*["']popstate["']/g) || []).length === 0, "");
R.add("every LFH_BACK.layer call is guarded, at the call or at the top of its function", (() => {
  const bad = [];
  LINES.forEach((l, i) => { if (/LFH_BACK\.layer\(/.test(l) && !/window\.LFH_BACK\s*(\?|&&)/.test(l)) bad.push(i + 1); });
  // the two unguarded call sites sit inside functions that open with `if (!window.LFH_BACK) return;`
  return bad.every((n) => LINES.slice(Math.max(0, n - 30), n).some((l) => /if \(!window\.LFH_BACK/.test(l)));
})(), "");
{
  // node --check, the same thing verify:ui and the panels' own guard use. `new Function(RAW)` on a
  // 1.3 MB file is both slow and wrong here (top-level await is legal in the panel, not in a Function).
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, ["--check", ROOT + "/public/panels/editor/app.js"], { encoding: "utf8" });
  R.add("public/panels/editor/app.js parses", r.status === 0, (r.stderr || "").split("\n")[4] || "");
}
process.exit(R.done() ? 1 : 0);
