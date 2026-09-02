// Sweep #8 · T5 round 3 · band T5 (P96182–P96200) — SABOTAGE.
//
// Round 3's 467 checks are all green. That is only worth something if they can go RED, so each of
// the claims they rest on is deliberately broken here and something has to notice. Round 2's
// sabotage band earned itself the first time it ran — it found that both of this terminal's
// runners exited 0 on a red run, and that three separate checks could not see their own fault.
//
//   node scripts/sweep/t5/round3-sabotage.mjs
//
// EVERY FILE IS RESTORED — on success, on failure, and on Ctrl-C.
import { check, report, ROOT } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const originals = new Map();
const restoreAll = () => { for (const [f, b] of originals) fs.writeFileSync(path.join(ROOT, f), b); originals.clear(); };
for (const sig of ["SIGINT", "SIGTERM", "uncaughtException"])
  process.on(sig, (e) => { restoreAll(); if (e) console.error(e); process.exit(1); });

const node = process.execPath;
const RUNNERS = [["scripts/sweep/t5/round3.mjs"], ["scripts/sweep/t5/round2.mjs"], ["scripts/sweep/t5/static.mjs"]];

// A DICTIONARY VALUE IS A MOVING TARGET, so a case may name a KEY instead of a literal string.
// The first version spelled out `hi.noFavourites`'s exact value, and the very next commit —
// giving each language one consistent sentence ending — changed it, so the case went stale and
// reported the guard as asleep. `{ lang, key }` finds the line whatever it currently says.
function lineOf(body, lang, key) {
  const i = body.indexOf(`\n  ${lang}: {`);
  if (i < 0) return null;
  const seg = body.slice(i, body.indexOf("\n  },", i));
  for (const l of seg.split("\n")) if (l.trimStart().startsWith(`${key}: "`) && l.trimEnd().endsWith('",')) return l;
  return null;
}
function sabotage(file, from, to, extra = []) {
  const p = path.join(ROOT, file);
  if (!originals.has(file)) originals.set(file, fs.readFileSync(p, "utf8"));
  const body = originals.get(file);
  if (from && typeof from === "object") {
    const line = lineOf(body, from.lang, from.key);
    if (!line) return { applied: false, why: `no ${from.lang}.${from.key} in ${file}` };
    from = line;
    to = line.replace(/: ".*",$/, `: ${JSON.stringify(to)},`);
  }
  if (!body.includes(from)) return { applied: false, why: `the sabotage target is not in ${file}` };
  fs.writeFileSync(p, body.replace(from, to));
  let red = false, caughtBy = "";
  try {
    for (const args of [...extra.map((g) => [g]), ...RUNNERS]) {
      try { execFileSync(node, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
      catch { red = true; caughtBy = args[0]; break; }
    }
  } finally { fs.writeFileSync(p, body); }
  return { applied: true, red, caughtBy };
}

let id = 96182;
const CASES = [
  // ── the dictionary: the 342 rows are the biggest band this terminal has ever filed ──
  ["a Hindi value replaced by the English one", "lib/i18n.ts",
    { lang: "hi", key: "noFavourites" }, "No favourites yet.", []],
  ["a Korean value replaced by the English one", "lib/i18n.ts",
    { lang: "ko", key: "back" }, "Back", []],
  ["the {q} token dropped from a search headline", "lib/i18n.ts",
    'noSearchResults: "No dishes found for \\u201c{q}\\u201d"', 'noSearchResults: "No dishes found"', []],
  ["the {heart} token dropped from the favourites line", "lib/i18n.ts",
    "Open any dish, then tap the {heart}", "Open any dish, then tap the heart", []],
  // Aimed at a chip that EXISTS. The first version aimed at `filterAll`, which round 1 retired
  // for having no render site — so the band caught its own stale target, which is the point of it.
  ["a filter chip made too long for a 360px phone", "lib/i18n.ts",
    'filterVeg: "\ud83c\udf3f Veg"', 'filterVeg: "\ud83c\udf3f Absolutely every vegetarian dish we make"', []],
  ["a code token leaked into a value", "lib/i18n.ts",
    'notAvailable: "Not available"', 'notAvailable: "Not available ${x}"', []],
  ["a value emptied", "lib/i18n.ts", { lang: "en", key: "back" }, "", []],
  ["two apostrophe styles mixed inside one value", "lib/i18n.ts",
    'noMatchSub: "Try turning a filter off."', 'noMatchSub: "Don’t. Don\'t."', []],
  ["doubled punctuation in a value", "lib/i18n.ts",
    'noMatch: "No dishes match these filters."', 'noMatch: "No dishes match these filters.."', []],
  // ── the last-resort page's untouched half ──
  ["a signal tier's colour broken, so red no longer means red", "public/offline.html",
    '{ n: 0, label: "No signal",  colour: "#ef4444"', '{ n: 0, label: "No signal",  colour: "#22c55e"', []],
  ["two tiers given the same word", "public/offline.html",
    '{ n: 4, label: "Okay",       colour: "#22c55e"', '{ n: 4, label: "Good",       colour: "#22c55e"', []],
  ["a tier's note written in developer language", "public/offline.html",
    'note: "nothing is getting through"', 'note: "rtt exceeded the downlink budget"', []],
  ["the game's frame step uncapped, so a woken tab teleports the plates", "public/offline.html",
    "var dt = Math.min(48, now - (last || now)); last = now;", "var dt = now - (last || now); last = now;", []],
  ["the tray unclamped, so it can be dragged off the canvas", "public/offline.html",
    "tray.x = Math.max(tray.w / 2, Math.min(W - tray.w / 2, x));", "tray.x = x;", []],
  ["the difficulty uncapped, so it stops being a distraction", "public/offline.html",
    "speed = Math.min(0.38, speed + 0.007);", "speed = speed + 0.007;", []],
  ["a device the browser calls offline still reading as having signal", "public/offline.html",
    "if (navigator.onLine === false) return 0;", "/* trust the link */", []],
  // ── the star picker ──
  ["a star made unreachable by the keyboard", "components/StarRating.tsx",
    "tabIndex={0}", "tabIndex={-1}", []],
  ["Space no longer picking a star, so it is mouse-and-Enter only", "components/StarRating.tsx",
    'if (e.key === "Enter" || e.key === " ") {', 'if (e.key === "Enter") {', []],
];
for (const [why, file, from, to, extra] of CASES) {
  const r = sabotage(file, from, to, extra || []);
  check(`P${id++}`, `SABOTAGE — ${why} — is caught`, () =>
    (r.applied && r.red) || (!r.applied ? r.why : "NOTHING went red with the fault put back — no check covers this"));
}
const touched = new Map(originals);
restoreAll();
check(`P${id++}`, "every file this band broke is byte-identical again afterwards", () => {
  const bad = [...touched].filter(([f, b]) => fs.readFileSync(path.join(ROOT, f), "utf8") !== b);
  return bad.length === 0 || `left modified: ${bad.map(([f]) => f).join(", ")}`;
});
if (id > 96201) throw new Error(`the sabotage band overran its slice: ended at P${id}`);
process.exit(report("T5 round 3 — sabotage") ? 1 : 0);
