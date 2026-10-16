// scripts/sweep/t2s10/new-regress.mjs — sweep #10 T2, NEW checks, block R (P171701–P171800): this
// run's own fixes, proved the hard way. Each new guard is BROKEN once and must go red, then restored
// and must go green; the area's other guards are re-run over the fixed tree; and the two screens are
// driven in the iPhone's own engine (WebKit) and in Firefox, which Chrome-only checks never see.
//   node scripts/sweep/t2s10/new-regress.mjs --base http://localhost:4402
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { webkit, firefox } from "playwright";
import { check, run, idGen, F, ROOT, BASE } from "./lib.mjs";
const id = idGen(171701);
const C = (file, what, how, fn) => check(id(), file, what, how, fn);
const guard = () => spawnSync("node", ["scripts/verify-3d-viewer.mjs"], { cwd: ROOT, encoding: "utf8" });
const originals = new Map();
const restoreAll = () => { for (const [f, s] of originals) writeFileSync(join(ROOT, f), s); };
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restoreAll(); process.exit(130); });
const breakIt = (file, find, repl) => () => {
  const p = join(ROOT, file); const src = readFileSync(p, "utf8"); originals.set(file, src);
  const hit = typeof find === "string" ? src.includes(find) : find.test(src);
  if (!hit) return { ok: false, note: "the code to break is not in the file" };
  writeFileSync(p, src.replace(find, repl)); const r1 = guard(); writeFileSync(p, src); const r2 = guard();
  return { ok: r1.status === 1 && r2.status === 0, note: `exit ${r1.status} over the break, ${r2.status} restored` };
};
const BR = [
  ["item 1: delete the after-Quick-Look restore", F.viewer, /const st = mv\.getAttribute\("ar-status"\);\s*if \(st !== "session-started" && st !== "object-placed"\) endArSizing\(\);/, ""],
  ["item 1: forget to await activateAR", F.viewer, "try { await mv.activateAR!(); } catch {}", "mv.activateAR!();"],
  ["item 1: drop the 'undo the last handoff first' line", F.viewer, "if (arRestoreRef.current) endArSizing();", ""],
  ["item 2: take the dark boot script off restaurant #1's door", F.itemPage, '{settings.menuDefaultMode === "dark" && (', '{false && ('],
  ["item 2: let the two doors' scripts drift by one character", F.itemPage, "setAttribute('data-theme','dark');}catch(e){}})();", "setAttribute('data-theme','dark') ;}catch(e){}})();"],
  ["item 3: drop the note box's maxLength", F.item, "maxLength={REVIEW_NOTE_MAX}", ""],
  ["item 3: change the page's number away from the database's", F.item, "const REVIEW_NOTE_MAX = 500;", "const REVIEW_NOTE_MAX = 800;"],
  ["item 4: drop the ✕'s name", F.item, 'aria-label="Close photo"', ""],
  ["item 5: put the anchor back in the Tab order", F.pmv, /(className="hotspot hs-anchor"\s*id=\{`hs-\$\{tag\.id\}`\}\s*)tabIndex=\{-1\}/, "$1"],
  ["item 5: put the card back in the Tab order", F.pmv, /(className="hotspot hs-tag"\s*id=\{`hs-tag-\$\{tag\.id\}`\}\s*)tabIndex=\{-1\}/, "$1"],
  ["item 7: put the wrong rejection number back", F.viewer, "tags may not be removed (R57)", "tags may not be removed (R44)"],
  ["item 6: the veg mark derived as always-meaningful", F.item, /const dietMeaningful =\n[^;]*;/, "const dietMeaningful = true;"],
];
try {
  C("scripts/verify-3d-viewer.mjs", "the 3D guard is green over the fixed tree before anything is broken", "run it", () => guard().status === 0);
  for (const [name, file, find, repl] of BR) C(file, `break it once — ${name} — and verify:3d-viewer goes red, then green again`, "mutate, run, restore, run", breakIt(file, find, repl));
} finally { /* restores happen inside each break; this is the belt */ }
const npm = (args) => spawnSync("npm", ["run", "-s", ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 << 20 });
for (const [g, extra, file] of [
  ["verify:cache", ["--", "--base", BASE], F.loader], ["verify:slow-load", ["--", "--base", BASE], F.viewer], ["verify:guest", ["--", "--base", BASE], F.item],
  ["verify:notfound", ["--", "--base", BASE], F.nf], ["verify:ui", [], F.item], ["verify:taps", [], F.item], ["verify:dead-css", [], F.item],
  ["verify:server-only", [], F.media], ["verify:rejected", [], F.viewer], ["typecheck", [], F.viewer],
]) C(file, `${g} is green over the fixed tree${extra.length ? " (driven on " + BASE + ")" : ""}`, `npm run ${g}`, () => { const r = npm([g, ...extra]); const last = (r.stdout + r.stderr).trim().split("\n").filter(Boolean).slice(-1)[0] || ""; return { ok: r.status === 0, note: last.slice(0, 140) }; });
// ── the iPhone's own engine, and Firefox ─────────────────────────────────────────────────────────
for (const [ename, engine, dev] of [["WebKit (iPhone's engine)", webkit, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }], ["Firefox", firefox, { viewport: { width: 1280, height: 800 } }]]) {
  const S = {};
  C(F.viewer, `${ename}: the 3D screen reveals its dish with all three cards`, "drive /view/Croissant", async () => { try { S.b = await engine.launch(); } catch (e) { S.skip = `${ename} could not start on this Mac (${/profile folder/.test(String(e)) ? "it could not create its temporary profile folder" : String(e).split("\n")[0].slice(0, 80)}) — the machine, not the app. Re-run node scripts/sweep/t2s10/new-regress.mjs where it starts`; return { skip: S.skip }; } const ctx = await S.b.newContext(dev); S.p = await ctx.newPage(); S.err = []; S.p.on("pageerror", (e) => S.err.push(String(e).slice(0, 100))); await S.p.goto(BASE + "/view/Croissant?from=avocado-and-cream-cheese", { waitUntil: "load" }); const up = await S.p.waitForFunction(() => { const c = [...document.querySelectorAll(".hs-card-wrap")]; return c.length === 3 && c.every((x) => x.style.opacity === "1"); }, null, { timeout: 40000 }).then(() => true, () => false); return { ok: up, note: up ? "3/3" : "cards never arrived" }; });
  C(F.viewer, `${ename}: the dish ends at its full size, spinner gone`, "read", async () => { if (S.skip) return { skip: S.skip }; const m = await S.p.evaluate(() => ({ s: String(document.querySelector("#mv")?.scale), load: !!document.querySelector("#load") })); return { ok: m.s === "1 1 1" && !m.load, note: JSON.stringify(m) }; });
  C(F.viewer, `${ename}: the AR button says so plainly where this browser has no AR`, "tap AR VIEW", async () => { if (S.skip) return { skip: S.skip }; await S.p.click(".ar-btn"); const t = await S.p.waitForFunction(() => /AR isn.t available on this device/.test(document.body.innerText), null, { timeout: 5000 }).then(() => true, () => false); const cls = await S.p.evaluate(() => document.body.classList.contains("ar-presenting")); return { ok: t && !cls, note: `toast ${t}, ar-presenting ${cls}` }; });
  C(F.item, `${ename}: the dish page draws the dish, its price and a working Add`, "drive /r/aevidine/item/…", async () => { if (S.skip) return { skip: S.skip }; await S.p.goto(BASE + "/r/aevidine/item/avocado-and-cream-cheese", { waitUntil: "load" }); await S.p.waitForTimeout(1500); const m = await S.p.evaluate(() => ({ t: document.querySelector("#detail-title")?.textContent, pr: document.querySelector("#detail-price")?.textContent, add: !!document.querySelector(".btn-gold:not([disabled])"), max: document.querySelector("#review-text")?.maxLength ?? null })); return { ok: m.t === "Avocado & Cream Cheese" && /₹/.test(m.pr || "") && m.add, note: JSON.stringify(m) }; });
  C(F.item, `${ename}: the zoom opens and its ✕ is named and closes it`, "tap the photo, read, tap ✕", async () => { if (S.skip) return { skip: S.skip }; await S.p.click(".detail-visual"); await S.p.waitForSelector(".img-lightbox"); const n = await S.p.getAttribute(".img-lightbox-close", "aria-label"); await S.p.click(".img-lightbox-close"); const gone = await S.p.waitForFunction(() => !document.querySelector(".img-lightbox"), null, { timeout: 3000 }).then(() => true, () => false); return { ok: n === "Close photo" && gone, note: `${n} · closed ${gone}` }; });
  C(F.item, `${ename}: no page error on either screen`, "count", async () => { if (S.skip) return { skip: S.skip }; const e = S.err.slice(); await S.b.close(); return { ok: !e.length, note: e.join(" | ") || "none" }; });
}
process.exit(await run("new-regress") ? 1 : 0);
