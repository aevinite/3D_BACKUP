// T7 · third 500 · BLOCK H (P40817–P40847) — THE TAKEBACK BARS.
// Seven actions on this panel offer an undo. A takeback that looks right and does nothing is worse
// than none at all, so each one is driven: raised, counted down, tapped, and checked.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, armToasts, heard, forget, C, dump, at, LEAK } from "./lib.mjs";
at(40817);
const T = ["31"];
let s;
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);
  await armToasts(s.fr);
  const has = await s.fr.evaluate(() => ({ undo: !!window.LFH_UNDO, show: !!(window.LFH_UNDO && window.LFH_UNDO.show) }));
  C("the panel has one shared takeback bar", has.undo && has.show, JSON.stringify(has));

  // ── what a bar looks like, and that it counts down ─────────────────────────────────────
  const bar = await s.fr.evaluate(async () => {
    let undone = false;
    LFH_UNDO.show({ message: "Something happened", sub: "T31 · tap undo to put it back", icon: "💳", seconds: 5, onUndo: () => { undone = true; } });
    await new Promise((r) => setTimeout(r, 400));
    const el = document.getElementById("lfh-undobar");
    const out = { found: !!el, txt: el ? el.innerText.replace(/\s+/g, " ").trim() : "", btn: "" };
    if (el) {
      const b = [...el.querySelectorAll("button")].find((x) => /undo/i.test(x.innerText));
      out.btn = b ? b.innerText.replace(/\s+/g, " ").trim() : "";
      out.rect = (() => { const r2 = el.getBoundingClientRect(); return { h: +r2.height.toFixed(0), bottom: +r2.bottom.toFixed(0), w: +r2.width.toFixed(0) }; })();
      // The countdown is a DRAINING RING (stroke-dashoffset), not a number in the text — reading
      // innerText twice reports "no countdown" about a card that is visibly emptying.
      const ring = el.querySelector(".lfh-undo-ring svg *[stroke-dashoffset], .lfh-undo-ring circle, .lfh-undo-ring path");
      out.ring = !!ring;
      out.first = ring ? getComputedStyle(ring).strokeDashoffset : "";
      await new Promise((r) => setTimeout(r, 2200));
      out.later = ring ? getComputedStyle(ring).strokeDashoffset : "";
      out.shown = el.classList.contains("show");
      const b2 = [...el.querySelectorAll("button")].find((x) => /undo/i.test(x.innerText));
      if (b2) b2.click();
      await new Promise((r) => setTimeout(r, 500));
      out.undone = undone;
      out.gone = !el.classList.contains("show");
    }
    return out;
  });
  C("a takeback bar appears when one is offered", bar.found, bar.txt.slice(0, 100));
  C("…and says what happened", /Something happened/.test(bar.txt), bar.txt.slice(0, 90));
  C("…and what tapping it will do", /tap undo/i.test(bar.txt), bar.txt.slice(0, 110));
  C("…and it names the table", /T31/.test(bar.txt), bar.txt.slice(0, 90));
  C("…with an Undo button on it", /undo/i.test(bar.btn), bar.btn);
  C("…that is big enough for a thumb", !bar.rect || bar.rect.h >= 40, bar.rect ? `${bar.rect.h}px tall` : "");
  C("…and sits on screen, not off the bottom", !bar.rect || bar.rect.bottom <= 900, bar.rect ? `bottom ${bar.rect.bottom}` : "");
  C("the bar has a ring that drains as the seconds run out", bar.ring, `ring=${bar.ring}`);
  C("…and it really moves", bar.later !== bar.first, `${bar.first} → ${bar.later}`);
  C("tapping Undo really calls the takeback", bar.undone === true, `undone=${bar.undone}`);
  C("…and the bar goes away once it has been used", bar.gone, `gone=${bar.gone}`);
  C("nothing on the bar leaks code", !LEAK.test(bar.txt), bar.txt.slice(0, 110));

  // ── it goes away on its own, and does NOT act when it does ─────────────────────────────
  const expiry = await s.fr.evaluate(async () => {
    let called = false;
    LFH_UNDO.show({ message: "Left alone", sub: "T31 · nobody taps this", icon: "⏱", seconds: 2, onUndo: () => { called = true; } });
    await new Promise((r) => setTimeout(r, 4200));
    // hide() drops the `show` class and leaves the card in the DOM with its old words, so
    // "is the text still there" is not the question — "is the card still up" is.
    const el = document.getElementById("lfh-undobar");
    return { called, still: !!el && el.classList.contains("show") };
  });
  C("a bar nobody taps disappears by itself", !expiry.still, `still there = ${expiry.still}`);
  C("…and running out is NOT the same as tapping undo", expiry.called === false, `onUndo called = ${expiry.called}`);

  // ── two takebacks in a row: the second replaces the first, never stacks ────────────────
  const two = await s.fr.evaluate(async () => {
    const hits = [];
    LFH_UNDO.show({ message: "First thing", sub: "T31", icon: "1", seconds: 6, onUndo: () => hits.push("first") });
    await new Promise((r) => setTimeout(r, 400));
    LFH_UNDO.show({ message: "Second thing", sub: "T31", icon: "2", seconds: 6, onUndo: () => hits.push("second") });
    await new Promise((r) => setTimeout(r, 500));
    const cards = [...document.querySelectorAll("#lfh-undobar")];
    const visible = cards.filter((b) => b.classList.contains("show"));
    const txt = visible.map((b) => b.innerText.replace(/\s+/g, " ").trim());
    const b = visible.map((v) => [...v.querySelectorAll("button")].find((x) => /undo/i.test(x.innerText))).find(Boolean);
    if (b) b.click();
    await new Promise((r) => setTimeout(r, 400));
    return { n: visible.length, txt, hits };
  });
  C("a second takeback replaces the first — they never stack up", two.txt.every((t) => !/First thing/.test(t)) || two.n === 1, `${two.n} on screen: ${two.txt.join(" | ").slice(0, 90)}`);
  C("…and Undo then takes back the SECOND thing, the one that just happened", two.hits.join(",") === "second", two.hits.join(",") || "(nothing called)");

  // ── a takeback that FAILS says so ──────────────────────────────────────────────────────
  const failed = await s.fr.evaluate(async () => {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    LFH_UNDO.show({ message: "Will fail", sub: "T31", icon: "✕", seconds: 5, onUndo: () => api("POST", "/calls/00000000-0000-0000-0000-000000000000/reopen").then(() => load()).catch((e) => { toast("Undo failed: " + errText(e), false); load(); }) });
    await new Promise((r) => setTimeout(r, 400));
    const el = document.getElementById("lfh-undobar");
    const b = el && [...el.querySelectorAll("button")].find((x) => /undo/i.test(x.innerText));
    if (b) b.click();
    await new Promise((r) => setTimeout(r, 2500));
    return { toasts: [...document.querySelectorAll(".toast")].map((t) => t.innerText.replace(/\s+/g, " ").trim()) };
  });
  C("a takeback that the server refuses is said out loud", failed.toasts.length > 0, failed.toasts.join(" | ").slice(0, 110) || "(silent)");
  C("…and says it was the UNDO that failed, not the original action", failed.toasts.some((t) => /undo failed/i.test(t)), failed.toasts.join(" | ").slice(0, 110));

  // ── every takeback in the file is wired to something ───────────────────────────────────
  const src = await (await fetch("https://3-d-backup.vercel.app/panels/tablet/app.js")).text();
  const shows = [...src.matchAll(/LFH_UNDO\.show\(\{([\s\S]{0,600}?)\}\);/g)].map((m) => m[1]);
  C("the panel offers a takeback in several places", shows.length >= 5, `${shows.length} takeback bars`);
  C("every one of them says what happened", shows.every((b) => /message:/.test(b)), `${shows.filter((b) => !/message:/.test(b)).length} without a message`);
  C("…and every one is wired to a real takeback", shows.every((b) => /onUndo:/.test(b)), `${shows.filter((b) => !/onUndo:/.test(b)).length} with no onUndo`);
  // undobar.js caps every window at 5 seconds (owner, 2026-08-26) and defaults to 3, so a caller
  // asking for 6 is not a fault — asking for one or two is, because nobody can reach it.
  C("…and gives the waiter time to reach it", shows.every((b) => { const m = b.match(/seconds:\s*(\d+)/); return !m || Number(m[1]) >= 3; }), shows.map((b) => (b.match(/seconds:\s*(\d+)/) || [])[1] || "default").join(","));
  C("…and none of them promises an undo it cannot do offline in silence", shows.every((b) => !/onUndo:\s*\(\)\s*=>\s*\{\s*\}/.test(b)));
  const undoFails = [...src.matchAll(/Undo failed/g)].length;
  C("a failing takeback has its own sentence", undoFails >= 2, `${undoFails} places say "Undo failed"`);

  // ── settling a bill offers its takeback for real ───────────────────────────────────────
  await openTable(s, T[0]);
  const payUndo = await s.fr.evaluate(async (t) => {
    const out = {};
    await load();
    out.open = !!sessionOf(t);
    out.fn = typeof offerPayUndo;
    document.querySelectorAll(".toast").forEach((x) => x.remove());
    offerPayUndo(t, { message: "Bill paid", icon: "💳" });
    await new Promise((r) => setTimeout(r, 500));
    const el = document.getElementById("lfh-undobar");
    out.bar = !!el && el.classList.contains("show") && /Bill paid/.test(el.innerText);
    out.txt = el ? el.innerText.replace(/\s+/g, " ").trim() : "";
    out.toasts = [...document.querySelectorAll(".toast")].map((x) => x.innerText.replace(/\s+/g, " ").trim());
    if (el) { const b = [...el.querySelectorAll("button")].find((x) => /✕|close|dismiss/i.test(x.innerText)); if (b) b.click(); }
    return out;
  }, T[0]);
  C("settling an OPEN table offers the takeback", payUndo.open ? payUndo.bar : true, `open=${payUndo.open} bar=${payUndo.bar}`);
  C("…and it says the bill was paid", !payUndo.bar || /Bill paid/.test(payUndo.txt), payUndo.txt.slice(0, 90));
  C("…and that undo reopens the bill", !payUndo.bar || /reopen/i.test(payUndo.txt), payUndo.txt.slice(0, 110));
  C("…and on a table already closed it just says so instead", payUndo.open || payUndo.toasts.some((t) => /Bill paid/.test(t)), payUndo.toasts.join(" | ").slice(0, 90));

  C("no uncaught page error across the takeback walk", s.errs.length === 0, s.errs.join(" | ").slice(0, 200));
  C("no leaked code text after it", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block H completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("H") ? 1 : 0; }
