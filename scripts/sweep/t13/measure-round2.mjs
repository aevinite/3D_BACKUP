// Round 2 is planned from a MEASUREMENT, not a fresh idea.
// Round 1 filed 557 checks. This asks: of everything my territory names, and of every WAY a check
// can be made, what did round 1 not reach?
import { readFileSync, readdirSync } from "node:fs";
const W = "/Users/aevinite/Documents/Projects/wt-s8-t13/";
const LED = W + ".claude/sweep/LEDGER/";

// ── 1 · what did round 1 actually DO, by kind? ───────────────────────────────────────────────
const mine = readFileSync(LED + "T13-S8.md", "utf8").split("\n").filter((l) => /^\|\s*P\d{5,6}\s*\|/.test(l));
const byHow = {};
for (const l of mine) {
  const cells = l.split(/(?<!\\)\|/);
  const how = (cells[3] || "").trim().slice(0, 60);
  const kind = /getComputedStyle|opened the real page/.test(how) ? "COMPUTED (browser)"
    : /GET \/api|drove /.test(how) ? "DRIVEN (real app)"
    : /lifted each function|ran it/.test(how) ? "EXECUTED (real source)"
    : "READ (source)";
  byHow[kind] = (byHow[kind] || 0) + 1;
}
console.log("ROUND 1, by how it was verified:");
for (const [k, v] of Object.entries(byHow).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log(`  ${String(mine.length).padStart(4)}  total\n`);

// ── 2 · what does the territory NAME that no check of mine mentions? ─────────────────────────
const FILES = {
  "app/owner/page.tsx": "page",
  "app/owner/layout.tsx": "layout",
  "app/owner/marketing/page.tsx": "marketing",
  "app/owner/online/page.tsx": "online",
  "app/api/owner/analytics/route.ts": "analytics",
  "app/api/owner/overview/route.ts": "overview",
};
const hay = mine.join("\n").toLowerCase();
const named = new Map();
const add = (n, w) => { if (n && n.length > 2 && !named.has(n)) named.set(n, w); };
for (const [f, tag] of Object.entries(FILES)) {
  const t = readFileSync(W + f, "utf8");
  for (const m of t.matchAll(/\b(?:const|let|function|type)\s+([A-Za-z_$][\w$]*)/g)) add(m[1], tag + ":symbol");
  for (const m of t.matchAll(/\.((?:ow2|owr|owd|own|hq|rv|owx)[\w-]*)/g)) add(m[1], tag + ":css");
  for (const m of t.matchAll(/sb\.rpc\("(\w+)"/g)) add(m[1], tag + ":rpc");
  for (const m of t.matchAll(/useState<?[^>]*>?\(\s*(?:null|\[\]|\{\}|false|true|"")/g)) {/* counted below */}
  for (const m of t.matchAll(/const \[(\w+), set\w+\]/g)) add(m[1], tag + ":state");
  for (const m of t.matchAll(/useBackClose\("([^"]+)"/g)) add(m[1], tag + ":backlayer");
  for (const m of t.matchAll(/aria-label="([^"]{4,40})"/g)) add(m[1], tag + ":aria");
  for (const m of t.matchAll(/onKeyDown|onKeyUp|onKeyPress/g)) add("keyboard-handler", tag + ":keyboard");
}
const uncovered = [...named].filter(([n]) => !hay.includes(n.toLowerCase()));
console.log(`NAMED THINGS: ${named.size}   ·   named by NO round-1 row: ${uncovered.length}`);
const grouped = {};
for (const [n, w] of uncovered) (grouped[w] ??= []).push(n);
for (const [w, ns] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length))
  console.log(`  ${String(ns.length).padStart(3)}  ${w}: ${ns.slice(0, 14).join(" · ")}${ns.length > 14 ? " …" : ""}`);

// ── 3 · which STATES did round 1 drive, and which did it never reach? ────────────────────────
const states = {
  "the switched-off state (Reports removed by the admin)": /switched off|offNote|reports are switched off/i,
  "a FAILED read (500 / dropped connection)": /failed read|actsErr|couldn.t load|500/i,
  "a PARTIAL read (some restaurants did not answer)": /partial/i,
  "the ADMIN acting as this owner (?rid pin)": /admin.{0,20}act|scopePin|\?rid/i,
  "keyboard only, no mouse": /keyboard|tabIndex|Enter/i,
  "the offline / no-signal path": /offline|service worker|sw\.js/i,
  "a restaurant that is switched OFF (active=false)": /active.{0,12}false|inactive/i,
  "two tabs of the same panel at once": /two tabs|second tab/i,
  "the 60-second auto-refresh actually firing": /60s|auto-refresh|backstop/i,
  "the instant-paint snapshot on a reload": /snapshot|instant-paint|readSnap/i,
};
console.log("\nSTATES, and how many round-1 rows mention each:");
for (const [s, re] of Object.entries(states)) {
  const n = mine.filter((l) => re.test(l)).length;
  console.log(`  ${String(n).padStart(4)}  ${s}`);
}
