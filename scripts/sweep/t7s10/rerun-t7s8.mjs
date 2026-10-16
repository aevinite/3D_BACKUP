// scripts/sweep/t7s10/rerun-t7s8.mjs — which of sweep #8 terminal 7's rows (T7.md from line 4,173:
// P60701–P61700 and round three P98801–P99300) are about MY third of editor/app.js, and what did
// they say when their own runners were re-run today?
//
// Sweep #8's T7 owned app.js lines ~9,300 → end, plus inventory.js and floor-layouts.js. Its rows
// name only the runner in their "how" column, so the subject is read from each check's own SOURCE:
//   · a check that reads inventory.js / floor-layouts.js / index.html / the tablet / clash.ts only → not mine;
//   · otherwise the FIRST regex literal in it is searched in app.js today: landing in my third → mine,
//     landing elsewhere → not mine, landing nowhere → "gone" (a person judges it — see JUDGED below);
//   · a driven check (live.mjs / round3-live.mjs) is mine when the SCREEN it drives is drawn in my
//     third (the floor, the table popup, take-order, the bell) — by its title and the selectors it uses.
//
//   node scripts/sweep/t7s10/rerun-t7s8.mjs <static.json> <round3.json> <live.txt> <r3live.txt> [--json out]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, APP, inMine, lineAt } from "./lib.mjs";
import { codeOf } from "../t7/lib.mjs";

const [fStatic, fR3, fLive, fR3Live] = process.argv.slice(2);
const AC = codeOf(APP);
const blocks = (file) => {
  const src = readFileSync(join(ROOT, "scripts/sweep/t7", file), "utf8");
  const out = new Map();
  const re = /(?:^|\n)(?:await )?(?:check|skip)\(\s*"(P\d{5})[^"]*"/g;
  const hits = [...src.matchAll(re)];
  hits.forEach((m, i) => out.set(m[1], src.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : src.length)));
  return out;
};
const firstRegexAt = (body) => {
  for (const m of body.matchAll(/(?<![\w)\]])\/((?:\\.|\[(?:\\.|[^\]])*\]|[^/\n*])(?:\\.|\[(?:\\.|[^\]])*\]|[^/\n])*)\/([gimsuy]*)/g)) {
    let rx; try { rx = new RegExp(m[1], m[2].replace("g", "")); } catch { continue; }
    let at = APP.search(rx); if (at < 0) at = AC.search(rx);
    if (at >= 0) return at;
  }
  return -1;
};
const OTHER_SRC = /\b(INV|INVC|INVAPI|FL|HTML|TAB|CLASH)\b/;
const APP_SRC = /\b(A|ACT|AC|APP)\b/;
function ownerStatic(body) {
  if (OTHER_SRC.test(body) && !APP_SRC.test(body.replace(/^[^\n]*\n?/, ""))) return { owner: "other", why: "reads another file" };
  const at = firstRegexAt(body);
  if (at >= 0) return { owner: inMine(at) ? "mine" : "other", why: `lands at line ${lineAt(at)}` };
  return { owner: "gone", why: "its pattern matches nowhere today" };
}
// Screens my third draws (driven rows).
const MY_SCREEN = /floor|tile|\.ftile|table popup|floating|data-floating-table|take[- ]order|\.to-|the bell|bellRows|needs you|stats strip|legend|✎ Edit|tp-detail|tp-bill|sp-/i;
const NOT_MY_SCREEN = /inventory|stock|to-order|waste|recipe|usage|expense|count screen|ingredient|print it here|printing|KOT menu|discount sheet|split|stuck kitchen slip|stuck BILL|print job/i;
const results = [];
const S = blocks("static.mjs"), R3 = blocks("round3.mjs"), L = blocks("live.mjs"), R3L = blocks("round3-live.mjs");
const J = (f) => JSON.parse(readFileSync(f, "utf8"));
for (const [arr, src, name] of [[J(fStatic), S, "static.mjs"], [J(fR3), R3, "round3.mjs"]]) {
  for (const r of arr) {
    const body = src.get(r.id) || "";
    const o = ownerStatic(body);
    results.push({ id: r.id, runner: name, what: r.what, ok: r.ok, note: r.note, ...o });
  }
}
const liveLines = (f) => readFileSync(f, "utf8").split("\n").map((l) => l.match(/^\s*(✅|❌|⏭)\s+(P\d{5})\s+(.*)$/)).filter(Boolean);
for (const [f, src, name] of [[fLive, L, "live.mjs"], [fR3Live, R3L, "round3-live.mjs"]]) {
  for (const m of liveLines(f)) {
    const body = src.get(m[2]) || "";
    const title = m[3];
    const mineScreen = MY_SCREEN.test(title + " " + body) && !NOT_MY_SCREEN.test(title);
    results.push({ id: m[2], runner: name, what: title.replace(/ — .*$/, ""), ok: m[1] === "✅" ? true : m[1] === "❌" ? false : null, note: (title.match(/ — (.*)$/) || [])[1] || "", owner: mineScreen ? "mine" : "other", why: mineScreen ? "drives a screen my third draws" : "drives another third's screen" });
  }
}
const by = (o) => results.filter((r) => r.owner === o);
console.log(`sweep-8 T7 rows: ${results.length} · mine ${by("mine").length} (✅ ${by("mine").filter((r) => r.ok).length} · ❌ ${by("mine").filter((r) => r.ok === false).length}) · gone ${by("gone").length} · other ${by("other").length}`);
for (const r of [...by("mine"), ...by("gone")].filter((r) => r.ok !== true)) console.log(`  ${r.ok === false ? "❌" : "⏭"} ${r.owner.padEnd(5)} ${r.id} ${r.runner} ${r.what.slice(0, 80)} [${r.why}]`);
for (const r of by("gone").filter((r) => r.ok === true)) console.log(`  ✅ gone  ${r.id} ${r.what.slice(0, 80)}`);
const ji = process.argv.indexOf("--json"); if (ji >= 0) writeFileSync(process.argv[ji + 1], JSON.stringify(results, null, 1));
