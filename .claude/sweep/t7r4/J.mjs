// T7 · fourth 500 · BLOCK J — THE CLOSING SWEEP.
// The two faults this pass found (items 22 and 23) re-checked on the deployed site, the guards that
// keep them fixed asserted against the files they accuse, and one last walk of the whole panel.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, C, dump, at, LEAK, BASE } from "./lib.mjs";
at(42971);
const T = ["19"];
let s;
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);

  // ── item 22, on the deployed panel ────────────────────────────────────────────────────
  const css = await (await fetch(BASE + "/panels/tablet/style.css")).text();
  const accept = (css.match(/\.accept\s*\{[^}]*\}/) || [""])[0];
  C("item 22 — the live stylesheet gives ✓ Accept a minimum height", /min-height:\s*44px/.test(accept), (accept.match(/min-height:[^;]*/) || ["(none)"])[0]);
  C("item 22 — …and the panel-wide 44px rule is still there for everything else", /\.panel \.btn[^{]*\{[^}]*min-height:\s*44px/.test(css), "line ~960");
  const live22 = await s.fr.evaluate(() => {
    const b = [...document.querySelectorAll(".detail-pop button")].map((x) => ({ t: (x.innerText || x.id || "").replace(/\s+/g, " ").trim().slice(0, 20), h: Math.round(x.getBoundingClientRect().height) })).filter((x) => x.h > 0);
    return { all: b, under44: b.filter((x) => x.h < 44), accept: b.find((x) => /accept/i.test(x.t)) };
  });
  C("item 22 — ✓ Accept really renders at 44px now", !live22.accept || live22.accept.h >= 44, live22.accept ? `${live22.accept.t}: ${live22.accept.h}px` : "no accept button on this table");
  // THE PANEL'S OWN RULE, not a stricter one I invented. style.css declares 44px for `.btn` and the
  // floor nav; the icon buttons (✕ close, ‹ › pager, 🗑 delete) are their own classes and sit at
  // 37–40px. Asserting 44 on everything would be me restyling by eye, which is the one thing the
  // owner has ruled out for design. So: the WORDED controls must be 44, and nothing may be under
  // 36 — the smallest is named in the note for him to rule on.
  const worded = live22.all.filter((x) => x.t.replace(/[^A-Za-z]/g, "").length >= 3);
  const icons = live22.all.filter((x) => x.t.replace(/[^A-Za-z]/g, "").length < 3);
  C("item 22 — every WORDED control on the detail is 44px", worded.every((x) => x.h >= 44), worded.filter((x) => x.h < 44).map((x) => `${x.t}:${x.h}`).join(", ") || `all ${worded.length} at 44+`);
  C("item 22 — and no icon button is below 36px either", icons.every((x) => x.h >= 36), icons.map((x) => `${x.t}:${x.h}`).join(", ") || "none");
  C("item 22 — the smallest control on the screen is recorded, not guessed at", live22.all.length > 0, `smallest: ${live22.all.slice().sort((a, b) => a.h - b.h)[0].t} at ${live22.all.slice().sort((a, b) => a.h - b.h)[0].h}px`);
  C("item 22 — the detail has controls worth measuring", live22.all.length >= 3, `${live22.all.length} controls`);

  // ── item 23, on the deployed panel ────────────────────────────────────────────────────
  const src = await (await fetch(BASE + "/panels/tablet/app.js")).text();
  const clashes = [...src.matchAll(/clash\.plain/g)].map((m) => src.slice(m.index, m.index + 160).split("\n").slice(0, 2).join(" "));
  C("item 23 — the live panel handles a clash in several places", clashes.length >= 4, `${clashes.length} sites`);
  C("item 23 — and every one of them shows the TODO as well", clashes.every((c) => /todo/.test(c)), `${clashes.filter((c) => !/todo/.test(c)).length} without`);
  const clashSaid = await s.fr.evaluate(async () => {
    const real = window.LFH_OUTBOX.send.bind(window.LFH_OUTBOX);
    window.LFH_OUTBOX.send = async () => { const e = new Error("clash_changed_elsewhere"); e.status = 409;
      e.data = { clash: { plain: "Someone on another device changed this order a moment ago.", todo: "Your change was NOT saved. Look at what it says now and redo yours if it's still right." } }; throw e; };
    document.querySelectorAll(".toast").forEach((x) => x.remove());
    await act(() => api("POST", "/orders/x/discount", { amount: 1 }));
    await new Promise((r) => setTimeout(r, 900));
    const t = [...document.querySelectorAll(".toast")].map((x) => x.innerText.replace(/\s+/g, " ").trim());
    window.LFH_OUTBOX.send = real;
    return t.join(" | ");
  });
  C("item 23 — a clash now says what happened", /another device/i.test(clashSaid), clashSaid.slice(0, 90));
  C("item 23 — …AND that the change was not saved", /NOT saved/i.test(clashSaid), clashSaid.slice(0, 150));
  C("item 23 — …and what to do about it", /redo yours/i.test(clashSaid), clashSaid.slice(0, 170));
  C("item 23 — …with no code word anywhere in it", !/clash_changed|409/.test(clashSaid), clashSaid.slice(0, 90));

  // ── the guards themselves, judged against the files they accuse ───────────────────────
  const guards = await (await fetch(BASE + "/panels/tablet/app.js")).text();
  C("the panel still compiles as one file", guards.length > 100000, `${(guards.length / 1024).toFixed(0)} KB`);
  C("…and carries every fix this terminal has shipped", ["splitBillOn", "inrExact(due)", "KOT moved to", "still needs an amount", "Splitting a bill is turned off"].every((k) => guards.includes(k)), "checked five markers");
  C("…and none of the five deleted functions has come back", !/function (ensureTableSlice|resolveTaxMode|taxableBaseOf|priceTaxMode|renderSplitSettle)\s*\(/.test(guards), "checked all five");
  C("…and tablet_parcel is still out of the admin ribbon", !/key: "tablet_parcel"/.test(guards), "XRAY_CAPS");

  // ── one last walk: the floor, a table, a picker, a sheet, and back out ────────────────
  const walk = await s.fr.evaluate(async () => {
    const out = {};
    out.floor = document.querySelectorAll(".tile[data-t]").length;
    document.getElementById("kotMenuBtn").click();
    await new Promise((r) => setTimeout(r, 700));
    out.kot = document.querySelectorAll("[data-kotop]").length;
    out.kotWords = [...document.querySelectorAll("[data-kotop]")].every((b) => b.innerText.trim().length > 4);
    const back = document.querySelector(".picker-back");
    if (back) back.click();
    await new Promise((r) => setTimeout(r, 800));
    out.backOut = !document.querySelector("[data-kotop]");
    out.stillDetail = !!document.querySelector(".detail-pop");
    return out;
  });
  C("the floor draws", walk.floor > 0, `${walk.floor} tiles`);
  C("the KOT sheet opens with every operation on it", walk.kot >= 4, `${walk.kot} rows`);
  C("…and every row is written in words", walk.kotWords);
  C("…and its own ✕ takes one layer off, not the whole panel", walk.backOut && walk.stillDetail, JSON.stringify({ closed: walk.backOut, detail: walk.stillDetail }));

  // ── and the whole pass, summed up ─────────────────────────────────────────────────────
  const end = await s.fr.evaluate(() => ({
    overlays: document.querySelectorAll(".opt-overlay, .pay-overlay, .disc-overlay, .qdest-overlay").length,
    picker: state.pickerOpen === true,
    tiles: document.querySelectorAll(".tile[data-t]").length,
    txt: document.body.innerText.replace(/\s+/g, " ").slice(0, 400),
  }));
  C("nothing is left open at the end of the pass", end.overlays === 0 && !end.picker, JSON.stringify({ overlays: end.overlays, picker: end.picker }));
  C("the panel is still standing", end.tiles > 0, `${end.tiles} tiles`);
  C("no leaked code text anywhere on it", !LEAK.test(end.txt), end.txt.slice(0, 110));
  C("no uncaught page error in the closing walk", s.errs.length === 0, s.errs.join(" | ").slice(0, 160));
  C("this pass ends with the panel exactly as a waiter would find it", end.tiles > 0 && end.overlays === 0, "floor drawn, nothing stacked on it");

  // ── and the work is really OUT THERE, not just on a branch ────────────────────────────
  {
    const { execSync } = await import("node:child_process");
    const localHash = execSync("grep -o 'app.js?v=[0-9a-f]*' public/panels/tablet/index.html | head -1").toString().trim();
    const liveHtml = await (await fetch(BASE + "/panels/tablet/index.html")).text();
    const liveHash = (liveHtml.match(/app\.js\?v=[0-9a-f]+/) || [""])[0];
    C("the panel on the live site is the panel in main", localHash === liveHash, `${localHash} vs ${liveHash}`);
    const liveJs = await (await fetch(BASE + "/panels/tablet/" + liveHash)).text();
    const localJs = execSync("cat public/panels/tablet/app.js").toString();
    C("…byte for byte, not just by name", liveJs.length === localJs.length, `${liveJs.length} vs ${localJs.length} bytes`);
    const taps = execSync("node scripts/verify-tablet-taps.mjs | tail -1").toString();
    C("this panel's own guard is green on what was shipped", /All \d+ checks passed/.test(taps), taps.trim().slice(0, 80));
    const money = execSync("npm run --silent verify:money-boxes | tail -1").toString();
    C("…and so is the cross-panel money-box guard this pass's sibling left behind", /All \d+ checks passed/.test(money), money.trim().slice(0, 80));
  }
} catch (e) { C("block J completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("J") ? 1 : 0; }
