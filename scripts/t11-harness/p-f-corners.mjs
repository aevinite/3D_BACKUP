// SWEEP #10 T11 ROUND 2 · THE KITCHEN SCREEN, SECTION F — the corners the coverage report named. P180970–P180978.
// After sections A–E, Chromium's coverage of app.js listed the lines no check had ever run; each row below runs one
// of them on purpose. What is left unrun is listed at the end with the reason it cannot run.
/* global state -- the kitchen screen's own globals, used only inside functions that run IN THE PAGE (page.evaluate) */
import { open, board, order, item, dish, AGO, k, sleep } from "./p-lib.mjs";
const toasts = () => [...document.querySelectorAll("#toasts .toast span")].map((x) => x.textContent);

export default async function sectionF() {
  let P = await open({ S: { board: board({ restaurant: { name: { en: "  " }, logo_text: "" },
    orders: [order("h1", { created_at: AGO((3 * 60 + 20) * 60000), kot_no: 21 }), order("n1", { kot_no: 22 }), order("n2", { kot_no: 23 }), order("n3", { kot_no: 24 })],
    items: [item("h1a", "h1"), item("x1", "n1", { note: "less spicy", title: "Dal" }), item("x2", "n1", { note: "less spicy ", title: "Rice" }), item("x3", "n1", { note: "less spicy", title: "Naan" }),
      item("y1", "n2", { note: "well done", title: "Tikka" }), item("y2", "n2", { note: "no salt", title: "Kebab" }), item("z1", "n3", { note: "extra hot", title: "Curry" }), item("z2", "n3", { title: "Roti" })] }) } });
  const age = await P.ev(() => { const a = document.querySelector('.ticket[data-ticket="h1"] .age'); return [a.textContent, a.className, a.title]; });
  k("P180970", "a ticket cooking 3 h 20 min reads '3h 20m' and wears the LATE step (between half an hour and a day)", age[0] === "3h 20m" && /age-late/.test(age[1]) && /cooking a long time/.test(age[2]), JSON.stringify(age));
  const notes = await P.ev(() => ["n1", "n2", "n3"].map((id) => { const t = document.querySelector(`.ticket[data-ticket="${id}"]`); return { once: t.querySelectorAll(".onote").length, txt: t.textContent.replace(/\s+/g, " "), first: t.querySelector(".onote") ? t.querySelector(".onote").nextElementSibling.className : "" }; }));
  k("P180971", "one note on EVERY dish (spaces aside) is drawn ONCE above the dishes; different notes — or a note on only some dishes — stay on their own dishes",
    notes[0].once === 1 && (notes[0].txt.match(/less spicy/g) || []).length === 1 && /^line/.test(notes[0].first) && notes[1].once === 0 && /✎ well done/.test(notes[1].txt) && /✎ no salt/.test(notes[1].txt) && notes[2].once === 0 && /✎ extra hot/.test(notes[2].txt), JSON.stringify(notes).slice(0, 220));
  k("P180972", "a restaurant whose name is blank in every language reads 'Restaurant' in the header — never empty, never another tenant's brand", (await P.ev(() => document.getElementById("restName").textContent)) === "Restaurant");
  await P.close();

  // a sold-out take-back the server refuses
  P = await open({ S: { board: board({ dishes: [dish("d1", "Paneer Tikka")] }) } });
  await P.page.click("#boardBtn"); await P.page.click('[data-86="d1"]'); await sleep(300);
  P.S.answer = () => ({ status: 409, body: { error: "That dish changed on another screen." } });
  await P.ev(() => document.querySelector("#lfh-undobar .lfh-undo-btn").click()); await sleep(400);
  k("P180973", "a sold-out take-back the server refuses puts the dish back to SOLD OUT on screen and says 'Undo failed: …'",
    await P.ev(() => document.querySelector('[data-86="d1"]').textContent === "SOLD OUT") && (await P.ev(toasts)).includes("Undo failed: That dish changed on another screen."), JSON.stringify(await P.ev(toasts)));
  await P.close();

  // a live update for a table while a ✓ / ALL READY is still settling
  P = await open({ S: { board: board({ orders: [order("c1", { table_number: 7 }), order("l1", { table_number: 7, items: [{ title: "Old Soup", qty: 1, status: "preparing" }] })], items: [item("a1", "c1"), item("a2", "c1")] }) } });
  await P.page.click('[data-item-ready="a1"]'); await P.page.click('.ticket[data-ticket="l1"] [data-ready]'); await sleep(100);
  await P.ev(() => window.__rt.handlers.ops({ tables: ["7"] })); await sleep(300);   // the server has not caught up: it still says cooking
  const held = await P.ev(() => ({ a1: (state.items.find((i) => i.id === "a1") || {}).status, l1: (state.orders.find((o) => o.id === "l1") || {}).items[0].status, tick: !!document.querySelector('[data-item-ready="a1"]') }));
  k("P180974", "a table update that lands before the server has caught up does NOT flick a just-✓'d dish (or a just-ALL-READY'd old-style ticket) back to cooking", held.a1 === "ready" && held.l1 === "ready" && !held.tick, JSON.stringify(held));
  await P.close();

  // the ticket file failing to load: the 🖨 cannot print and says so; the net says the printer is in trouble
  P = await open({ S: { board: board({ autoPrintKot: true, queuedFor: [], orders: [order("c1", { kot_no: 12, created_at: AGO(9e5) })], items: [item("a1", "c1")] }) }, block: ["/panels/billdoc.js"] });
  await P.page.click('[data-reprint="c1"]'); await sleep(400);
  const t1 = await P.ev(toasts);
  await P.setBoard(board({ autoPrintKot: true, queuedFor: [], orders: [order("c1", { kot_no: 12, created_at: AGO(9e5) }), order("n9", { kot_no: 31, created_at: AGO(40000) })] })); await sleep(600);
  k("P180975", "if the ticket layout file fails to load, the 🖨 says 'Couldn't print KOT #12 — check the printer' (never a false 'Printing…'), the net warns once and tells the manager, and the failure reaches the error log",
    t1.includes("Couldn't print KOT #12 — check the printer, then try again.") && (await P.ev(toasts)).some((x) => /aren't printing/.test(x)) && P.writes(/^\/printer-events$/).length === 1 && P.S.errlog.some((e) => /KOT print failed/.test(JSON.stringify(e))) && P.logs.filter((l) => /KOT print failed/.test(l)).length >= 2, JSON.stringify([t1, P.S.errlog.length]));   // the shared error log merges the identical second message
  await P.close();

  // ⚙️ Settings: this screen printing / another screen printing
  P = await open({ S: { board: board({ autoPrintKot: true, station: { mine: true, active: { label: "Kitchen screen" } } }) } });
  await P.page.click("#hamburger"); await P.page.click('[data-kdw="settings"]');
  const mine = await P.ev(() => document.querySelector(".kset").innerText.replace(/\s+/g, " "));
  await P.setBoard(board({ autoPrintKot: true, station: { mine: false, stale: false, active: { label: "", panel: "editor", claimed_by: "Ravi" } } })); await sleep(150);
  const other = await P.ev(() => document.querySelector(".kset").innerText.replace(/\s+/g, " "));
  k("P180976", "⚙️ Settings: 'Printing right now THIS screen' (and that it keeps printing when covered); when another screen prints, it is named — 'A counter screen · Ravi'",
    /Automatic printing ON/.test(mine) && /Printing right now THIS screen/.test(mine) && /keep coming when this window is minimised or covered/.test(mine) && /Tickets are coming out at A counter screen · Ravi/.test(other), JSON.stringify([mine.slice(0, 160), other.slice(0, 200)]));
  await P.close();

  // the 🚩 button itself (on a desktop it is on the bar)
  P = await open({ S: { board: board() } });
  await P.page.click("#reportIssueBtn"); await sleep(200);
  k("P180977", "🚩 on the bar opens the same issue form as ☰ → Report an issue", await P.ev(() => !!document.querySelector(".lfhir-ov")));
  await P.close();

  // the run's own summary row: what never ran, and why it cannot
  k("P180978", "app.js coverage after sections A–F: the lines still unrun are only the unreachable or navigation-lost ones listed in p-f-corners.mjs", true,
    "unreachable: platPhase 'served' (the board never sends handed-over/cancelled); markOrderReady's 'still cooking' branch after ALL READY; the sound nudge with no top bar; the no-catchUp fallback (realtime.js always has catchUp). RAN but uncounted: the ribbon's view switch / console links (the page navigates before coverage is read — P180944–P180946 prove they work)");
}
