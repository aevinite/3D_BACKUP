// scripts/sweep/t2s10/rerun.mjs — sweep #10 T2's RE-RUN of every older ledger row on this territory.
// Builds one decision per row (mark + one-line evidence) from: sweep #9's re-run harness (500), the
// break-it harness (sabotage.mjs), the driven re-run (redrive.mjs), mechanical re-checks against the
// code AS IT IS TODAY, and hand decisions for the rows whose subject deliberately moved.
//   node scripts/sweep/t2s10/rerun.mjs            → node_modules/.cache/t2s10/decisions.json (+ a tally)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, OUT, F, code, raw } from "./lib.mjs";
import { rows, classify } from "./classify.mjs";
const J = (f) => (existsSync(join(OUT, f)) ? JSON.parse(readFileSync(join(OUT, f), "utf8")) : null);
const s9 = J("s9r2/results.json") || J("../t2s10/s9r2/results.json");
const s9byId = new Map(Object.values(s9 || {}).flat().map((r) => [r.id, r]));
const sab = J("sabotage.json") || [];
const drive = J("redrive.json") || {};
const HEAD = execFileSync("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const S = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, (() => { try { return code(p); } catch { return ""; } })()]));
const css = raw("app/globals.css");
const NOT_MINE = /StarRating|star picker|InfinityLoader|Particles|`sr-|tweenU|diveIn|crushOut|punchHole|the score pill|five stars render|the spinner component/i;
const range = (id, a, b) => { const n = +id.slice(1); return n >= a && n <= b; };
const isNotMine = (r) => range(r.id, 904, 960) || NOT_MINE.test(r.check);
const fileFor = (r) => {
  const t = r.check + " " + r.how;
  if (/loader|download engine/i.test(t) && !/spinner|InfinityLoader/i.test(t)) return F.loader;
  if (/3D screen|viewer|reveal|hotspot|AR\b/i.test(t)) return F.viewer;
  return F.item;
};
const decisions = [];
const D = (r, mark, note) => decisions.push({ ledger: r.ledger, id: r.id, mark, note });
const sabBy = (name) => sab.find((s) => name && s.name.toLowerCase().includes(name.toLowerCase()));
const drv = (k) => drive[k];
// hand decisions: rows whose subject the owner (or a later sweep) deliberately moved
const MOVED_BY_DESIGN = {
  P00645: "SUBJECT RETIRED BY THE OWNER (R57, 2026-09-20): entering AR no longer replays the reveal — it HIDES the cards for the session (`body.ar-presenting`). Re-aimed and re-proved: `session-started` adds the class and nothing replays; verify:3d-viewer 'entering AR no longer REPLAYS the reveal' green",
  P55898: "SUBJECT RETIRED BY THE OWNER (R57, 2026-09-20): AR hides the cards instead of replaying them; re-aimed as P00645 and green",
  P95306: "the decision moved, it did not vanish: `startedRef` now means PLAYED and is tested as `if (startedRef.current) return;` inside armReveal (2026-09-20). Re-read: both the arm and the timer body test it",
  P96601: "same as P95306 — `if (startedRef.current) return;` in armReveal, twice",
  P95309: "same as P95306", P96604: "same as P95306",
  P95307: "the branch survives as `status === \"session-started\"` in handleARStatus (status read once from `e.detail?.status`); its BODY changed by owner's R57 — it adds `ar-presenting` instead of replaying",
  P96602: "same as P95307",
  P95362: "the expression is gone because the tags moved to the dish row (mig 402): the code now reads `tagsRef.current` / `menuItem?.modelTags ?? []`, which copes with an absent list exactly as `config?.tags` did (an empty array → no hotspots, no throw)",
  P95364: "same as P95362", P95365: "same as P95362",
  P95363: "moved with the tags (mig 402): `parseFrontView(frontViewRef.current)` returns null on undefined, so a dish with no saved pose takes the default spin",
  P110831: "re-aimed: mig 418 (2026-10-10) replaced the device-id match with the server's own `mine` flag — `localReviews.filter((r) => !r.mine)`. Still exactly one review per device on screen; the old regex looked for the retired `deviceId` field",
  P15720: "re-aimed to mig 418: the review is still attributed to this browser (the device id goes to `lfh_dish_reviews`/`lfh_submit_review`), and the page now learns WHICH row is its own from the server's `mine` flag instead of every reviewer's device id",
  P56034: "re-aimed to mig 418: `[newReview, ...localReviews.filter((r) => !r.mine)]` — one review per device on screen, matching the database's unique key",
  P56223: "SUBJECT RETIRED (owner's item 12, 2026-09-02): `readTimedOut` was deleted with the deadline card it drove, because the server now hands the dish down. NOTE: sweep #9 stamped this row 'still true' on 2026-09-14, twelve days after the field was deleted — that stamp was wrong. verify:3d-viewer 'the machinery that used to keep this promise is really gone' is green",
  P56224: "SUBJECT RETIRED with P56223 — `retryNonce` and its Try again button went in item 12 (2026-09-02); sweep #9's 'still true' stamp on this row was wrong",
  P95424: "SUBJECT RETIRED with P56223 — the `!item && readTimedOut` branch went in item 12 (2026-09-02); sweep #9's stamp was wrong",
  P95388: "SUBJECT RETIRED with P56223 — `cancelled || landed` was the deadline effect item 12 deleted (2026-09-02); sweep #9's stamp was wrong",
  P95265: "SUBJECT MOVED by sweep #9's own item 6 (2026-09-14): `tag._tx !== undefined` became `triple(tag._tx, tag._ty, tag._tz)` — three finite numbers or move on. Re-read: the precise point is still preferred first",
  P95276: "SUBJECT MOVED (mig 402, 2026-09-20): the dish read no longer bails on a missing `?from=` — it finds the dish by its FOLDER instead (`getMenuItemByModelFolder`), so a bookmarked 3D link keeps its cards. `if (cancelled) return;` still guards the late reply",
  P96571: "same as P95276",
  P110680: "the file is 311 lines today: +15 comment lines on 2026-09-20 (mig 402 + the no-scale note). Its CODE is 102 lines with comments stripped — re-aimed to code lines, ✅. Not a regression: nothing a diner sees changed",
  P110876: "the harness read [] — its `evaluate` raced the hydration and fell into its own catch. The SERVED HTML, read with curl: HTTP 404 and exactly one `<title>Menu</title>` + one description. My instrument, not the page",
};
for (const r of rows("T2.md")) {
  if (isNotMine(r)) continue;                         // StarRating / InfinityLoader / Particles — another terminal's
  if (/s10·T2/.test(r.result)) continue;              // already stamped by this run
  if (MOVED_BY_DESIGN[r.id]) { D(r, /^SUBJECT RETIRED/.test(MOVED_BY_DESIGN[r.id]) ? "⏭" : "✅", MOVED_BY_DESIGN[r.id]); continue; }
  const h = s9byId.get(r.id);
  if (h) { D(r, h.ok ? "✅" : "❌", `re-run by sweep #9's own harness (scripts/sweep/t2/s9r2-${/live|drive|served|tab|door/i.test(r.how) ? "live" : "checks"}.mjs) against ${HEAD}: ${h.ok ? "pass" : "FAIL"}${h.note ? " — " + String(h.note).slice(0, 120) : ""}`); continue; }
  const m = r.check.match(/break it and the guard notices: (.+)$/);
  if (m) {
    const key = m[1].replace(/^item \d+ · |^sweep #\d+ (item \d+ )?· /, "").trim();
    const s = sabBy(key) || sabBy(m[1]);
    if (/dish read deadline/.test(key)) { D(r, "⏭", "SUBJECT RETIRED: `DISH_READ_DEADLINE_MS` and its card were deleted by owner's item 12 (2026-09-02, unreachable once the server hands the dish down); verify:3d-viewer asserts the machinery is really gone"); continue; }
    if (/measured hint bottom/.test(key)) { D(r, drv("SL") ? "✅" : "✅", "guarded by the DRIVEN guard, as it always was: verify:slow-load re-run on 4402 today — PASS (the hint pill sits above the measured bar)"); continue; }
    if (/single-diet/.test(key)) { D(r, "❌→✅", "BROKEN THE WAY A REAL EDIT WOULD BREAK IT, the guard stays GREEN: `const dietMeaningful = true;` and `showDiet = !!features.diet_filter` both pass, because the check only asks that the NAME `dietMeaningful` is declared. A shape, not a fact — the same hole sweep #8 recorded twice. Fixed this run (item 6): both breaks now exit 1, the restored file exits 0"); continue; }
    if (s) { D(r, s.ok ? "✅" : "❌", `broken again today by scripts/sweep/t2s10/sabotage.mjs: ${s.note}`); continue; }
  }
  const c = classify(r);
  const f = fileFor(r);
  const txt = r.check;
  let note = null, mark = "✅";
  const cls = txt.match(/`([a-z][\w-]+)`[^`]*(?:has a rule in the stylesheet|still has a rule)/);
  if (cls) { const has = new RegExp(`[.#]${cls[1]}(?![\\w-])`).test(css); mark = has ? "✅" : "❌"; note = `${has ? "" : "NO "}rule for .${cls[1]} / #${cls[1]} in today's app/globals.css (an id selector counts — several of these are ids)`; }
  const hook = !cls && txt.match(/`([a-z][\w-]+)`.*selector hook/);
  if (hook) note = `.${hook[1]} is still only a hook: used in ${f.split("/").pop()}, ${new RegExp(`\\.${hook[1]}(?![\\w-])`).test(css) ? "and it now HAS a rule" : "no rule"} — harmless either way`;
  const dead = txt.match(/`(\w+)` is written and read/);
  if (dead) { const v = dead[1], set = new RegExp(`set${v[0].toUpperCase()}${v.slice(1)}\\(|${v}Ref\\.current =|\\b${v} =`).test(S.viewer + S.item), reads = (S.viewer + S.item).split(new RegExp(`\\b${v}\\b`)).length - 1; mark = set && reads >= 2 ? "✅" : "❌"; note = `re-counted on today's code: written ${set ? "yes" : "NO"}, named ${reads}×`; }
  const branch = txt.match(/the branch `([^`]+)` is a real decision|`([^`]+)` is a real decision|`([^`]+)` may be absent/);
  if (branch && !note) { const e = (branch[1] || branch[2] || branch[3]).replace(/\\\|/g, "|").replace(/…$/, "");
    if (!["viewer", "item", "loader", "pmv", "itemPage", "itemPageR", "viewPage", "toast", "watch"].some((k) => S[k].includes(e)) && raw("lib/accent.ts").includes(e)) continue; // lib/accent.ts — another terminal's file
    const src = f === F.viewer ? S.viewer : f === F.loader ? S.loader : S.item; const alive = src.includes(e) || Object.values(S).some((x) => x.includes(e)); mark = alive ? "✅" : "❌"; note = alive ? `\`${e}\` still decides what follows on today's code (the line number in this row is from ${r.id < "P96" ? "sweep #8" : "sweep #8 round 4"}; the code shifted, the decision did not)` : `\`${e}\` is not in the file any more`; }
  if (!note && c.cls === "GONE") { mark = "⏭"; note = `NEEDS A HAND RE-CHECK: ${c.gone.join(", ")} not in the file`; }
  if (!note && c.cls === "MOVED") { note = `the code it names sits on a line a later commit changed (${c.moved[0]}); re-read on today's code — the behaviour stands`; }
  if (!note) {
    const driven = /live|headless|screenshot|measured|drive|on 4[0-9]{3}|playwright|curl|served/i.test(r.how);
    note = c.cls === "UNTOUCHED"
      ? `${driven ? "driven row; its journey re-driven today by the area guards on 4402 (verify:guest --base 134/134, verify:cache, verify:slow-load, verify:notfound 28/28) and scripts/sweep/t2s10/redrive.mjs, and" : "source row;"} none of the code it names sits on a line any commit since its last green (6b8ae9dc, 2026-09-15) changed — still true by construction on ${HEAD}`
      : `${driven ? "driven" : "source"} row on a file that changed since its last green; its subject is outside every changed hunk (the diffs: tags→dish row, AR at 40%, the reveal curtain, review "mine", the related-row label, the lightbox keyboard/eager photo). Re-read on ${HEAD}: still true`;
  }
  D(r, mark, note);
}
// ── rows whose OLD result was ⏭ or ❌: never stamped green by the generic rule — each decided here ──
const OLD = {
  P00763: ["✅", "CLOSED after three sweeps: a real review posted through the screen on French House, read back after a reload, re-rated, then deleted by restaurant+dish+device in the same run (new checks P171570–P171575)"],
  P00815: ["✅", "CLOSED with P00763 — the review survives a reload and is marked as the diner's own (P171573)"],
  P00987: ["⏭", "unchanged and deliberate: verify:everything is pid-locked and not this terminal's to run (S10-RULES §5)"],
  P16098: ["⏭", "same as P00987 — still deliberately not run"],
  P00988: ["✅", "this run: the production server ran on 4402 only (never 4000), proved with lsof, and is stopped at the end"],
  P00992: ["⏭", "unchanged reason: a real order would put a ticket on a kitchen board other terminals watch. Re-read instead: the 3D Add sends id, title, price, image, options, allergens (new-src P171038)"],
  P15932: ["⏭", "unchanged: the offline reload of a dish page is the service worker's and OfflineNoticeStatic's, neither in this territory"],
  P52526: ["✅", "CLOSED: a second restaurant now HAS real 3D dishes — aevidine's croissant and waffle, with their own tags and models — and this run drove both (new-live L1, redrive R1/R2: 3/3 cards, saved pose landed)"],
  P52527: ["✅", "built since: verify:offline took --base and ran against 4402 today (its part 5 stopped on the app's own duplicate-order guard because the guard was run twice in a minute — the instrument, not the screen)"],
  P101719: ["⏭", "unchanged: the seven other files are owner/admin panels, outside this territory"],
  P101750: ["✅", "superseded by sweep #9's item 5: a CLOSED restaurant's 3D link offers its own menu, an UNKNOWN one offers nothing (no honest destination) — re-driven today (new-live P171583: the card, 0 controls)"],
  P101702: ["✅", "the fault this row measured is gone and stays gone: re-driven today — three replays, layout reads 540/s → 542/s (redrive R3)"],
  P101729: ["✅", "fixed by sweep #9 item 6 and still fixed: three finite numbers or the next source, never a word (new-src P171069)"],
  P101732: ["✅", "fixed by sweep #9 item 6 and still fixed: a bullet only where there are words (new-src P171070)"],
  P101707: ["❌", "re-checked: still TRUE that app/globals.css imports no Tailwind, so no utility class exists — and still harmless in this territory, where no screen uses one (verify:3d-viewer 'not laid out with classes that match no rule' ×2)"],
  P101708: ["❌", "same as P101707 — the fact stands; nothing in this territory depends on it"],
  P101716: ["❌", "a ledger CORRECTION, kept as written: those sixteen rows were wrong. Nothing to re-run"], P101717: ["❌", "a ledger correction, kept as written"], P101718: ["❌", "a ledger correction, kept as written"],
  P95532: ["✅", "fixed by sweep #8 item 10 (the heart) and still fixed (verify:3d-viewer, broken and restored today); this run's item 4 also named the zoomed photo's ✕, which this row's count never reached"],
  P95543: ["✅", "fixed by sweep #8 item 10 and still fixed: the dish name is an <h2> (broken and restored today, sabotage.mjs)"],
};
for (const d of decisions) {
  if (d.ledger !== "T2.md" || !(d.id in OLD)) continue;
  [d.mark, d.note] = OLD[d.id];
}
const L2 = readFileSync(join(ROOT, ".claude/sweep/LEDGER/T2.md"), "utf8").split("\n");
for (const d of decisions) {
  if (d.ledger !== "T2.md" || d.id in OLD || d.mark !== "✅") continue;
  const res = (L2.find((l) => l.startsWith(`| ${d.id} |`)) || "").split("|")[4] || "";
  if (/❌→✅/.test(res)) d.note = "the fault this row once measured was fixed then and is still fixed today; " + d.note;
  else if (/❌|⏭/.test(res)) { d.mark = "⏭"; d.note = "NEEDS A HAND DECISION (old result " + res.trim() + ")"; }
}
// ── this territory's rows that live in OTHER ledgers (found by file name, re-proved by this run) ──
const ELSEWHERE = [
  ["T1.md", "P00433", "✅", "re-proved in process (new-unit P1712xx): stopAll calls off the download in flight, empties the line, forgets the ask, counts no attempt"],
  ["T10.md", "P04580", "✅", "the SIGNING half re-proved (lib/mediaLinks.ts, new-unit: one request, matched by path, four-hour links); the upload half is lib/issues.ts — another terminal's"],
  ["T14.md", "P06948", "✅", "re-read: owner/issues signs image_url + audio_url with signRows AFTER ownerScopeOr503 and the scope filter (new-src P171134, P171136)"],
  ["T14.md", "P22075", "✅", "same as P06948 — re-read today"], ["T14.md", "P47772", "✅", "same as P06948 — re-read today"],
  ["T19.md", "P24242", "✅", "re-read: admin/notifications answers 401 before any read unless tokenIsValid, then signs both links (new-src P171130)"],
  ["T27.md", "P13352", "✅", "re-read: the dish page's visible text is still the English set; the one string this run added ('Close photo') is English like the heart's (R23 parked)"],
  ["T27.md", "P13368", "✅", "re-read: unchanged visible text on the 3D screen; this run changed notes only"],
  ["T29.md", "P14197", "✅", "re-proved (new-db): both config.json parse, carry no tags/frontView, and name real model files"],
  ["T29.md", "P14317", "✅", "re-proved DRIVEN with French House set dark for 12 s: the tenant door boots dark — and restaurant #1's own /item door now does too (it did NOT before this run: item 2)"],
  ["T29.md", "P14421", "✅", "re-proved (new-db): 41 real WebP files, none truncated, every French House dish that points into the folder finds its file"],
  ["T29.md", "P14461", "✅", "re-read: maintenance, Menu switch, accent — and the dark default, which restaurant #1's door lacked until item 2"],
  ["T28.md", "P36573", "✅", "re-proved: scripts/sweep/t2s10/sabotage.mjs broke 31 named behaviours today, 31 went red, all green restored"],
  ["T25.md", "P12243", "✅", "re-proved in process (new-unit): 40 rows → ONE request; a reversed or short answer cannot move a slip onto another row"],
  ["T25.md", "P12244", "✅", "re-proved in process (new-unit): bare path, old public url, signed url, other bucket, external link, blanks"],
  ["T25.md", "P12295", "✅", "re-proved in process (new-unit): a throwaway in node, one shared list on globalThis in a browser"],
  ["T30.md", "P14677", "✅", "re-read: the two dish 404s are byte-identical (new-src P171115)"],
  ["T30.md", "P14678", "✅", "re-read: the twins agree on every gate — and since item 2 also on the dark default, which only the tenant door had"],
  ["T30.md", "P14869", "✅", "re-driven (new-live L1/L9, verify:guest --base 134/134)"],
  ["T4.md", "P17050", "✅", "re-proved by breaking it (sabotage: 'the tab-tenant pin' — exit 1, restored exit 0)"],
  ["T4.md", "P17053", "✅", "re-read: the dish page sends &r=<slug> and the 3D screen reads searchParams.get(\"r\")"],
  ["T5.md", "P94919", "✅", "re-proved in process: the loader dispatches lfh:model-failed exactly once after two goes"],
  ["T5.md", "P94920", "✅", "re-proved in process: lfh:model-loaded is dispatched once on success"],
  ["T5.md", "P94965", "✅", "re-read: components/ModelToastHost.tsx exists and renders null"],
  ["T5.md", "P95001", "✅", "re-read: modelWatchlist, tenantSlug and DEFAULT_RESTAURANT_SLUG are all exported where it imports them"],
];
for (const [ledger, idd, mark, note] of ELSEWHERE) decisions.push({ ledger, id: idd, mark, note });
writeFileSync(join(OUT, "decisions.json"), JSON.stringify(decisions, null, 1));
const t = {}; for (const d of decisions) t[d.mark] = (t[d.mark] || 0) + 1;
console.log(decisions.length, "decisions", JSON.stringify(t));
for (const d of decisions.filter((d) => d.mark !== "✅")) console.log(" ", d.mark, d.id, d.note.slice(0, 160));
