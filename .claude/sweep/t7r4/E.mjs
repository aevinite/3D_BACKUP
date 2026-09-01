// T7 · fourth 500 · BLOCK E — TAKING AN ORDER, END TO END.
// The waiter's most-used screen: find the dish, put it in the cart, say what to avoid, send it.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, armToasts, heard, forget, C, dump, at, LEAK } from "./lib.mjs";
at(42777);
const T = ["15"];
let s;
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);
  await armToasts(s.fr);
  await s.fr.evaluate(() => { const b = document.getElementById("takeOrder") || document.querySelector(".t-take"); b.click(); });
  await s.page.waitForTimeout(2000);

  const screen = await s.fr.evaluate(() => ({
    dishes: document.querySelectorAll(".dish[data-dish]").length,
    cats: document.querySelectorAll("[data-cat], .catchip").length,
    search: !!document.querySelector("#dishSearch, .om-search input, input[type='search']"),
    cart: !!document.querySelector(".om-cart, .cart, #cart"),
    send: !!document.querySelector("#sendOrder, .om-send, [data-send]"),
    txt: document.body.innerText.replace(/\s+/g, " ").slice(0, 300),
  }));
  C("the take-order screen opens with a menu on it", screen.dishes > 0, `${screen.dishes} dishes`);
  C("…grouped into categories", screen.cats > 0, `${screen.cats} categories`);
  C("…with a way to search", screen.search);
  C("…and somewhere for the order to collect", screen.cart);
  C("nothing on it leaks code", !LEAK.test(screen.txt), screen.txt.slice(0, 100));

  // ── search ─────────────────────────────────────────────────────────────────────────────
  const search = await s.fr.evaluate(async () => {
    const box = document.querySelector("#dishSearch, .om-search input, input[type='search']");
    const all = document.querySelectorAll(".dish[data-dish]").length;
    const first = state.data.dishes.find((d) => !d.open_price && !(d.tags || []).includes("sold-out"));
    const word = (first.title || "").split(" ")[0];
    box.value = word; box.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const found = [...document.querySelectorAll(".dish[data-dish]")].map((d) => d.innerText.replace(/\s+/g, " ").trim());
    box.value = "zzzznotadish"; box.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const none = { n: document.querySelectorAll(".dish[data-dish]").length, txt: (document.querySelector(".om-scroll, .dishgrid") || document.body).innerText.replace(/\s+/g, " ").trim() };
    box.value = ""; box.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    return { all, word, found, none, back: document.querySelectorAll(".dish[data-dish]").length };
  });
  C("searching narrows the menu", search.found.length > 0 && search.found.length <= search.all, `"${search.word}" → ${search.found.length} of ${search.all}`);
  C("…to dishes that actually match", search.found.some((t) => t.toLowerCase().includes(search.word.toLowerCase())), search.found[0] || "");
  C("a search that matches nothing says so", search.none.n === 0 && search.none.txt.length > 5, search.none.txt.slice(0, 90));
  C("…in a sentence, not an empty grid", /no|nothing|match|found/i.test(search.none.txt), search.none.txt.slice(0, 90));
  C("clearing the search brings the whole menu back", search.back === search.all, `${search.back} vs ${search.all}`);

  // ── categories ─────────────────────────────────────────────────────────────────────────
  const cats = await s.fr.evaluate(async () => {
    const chips = [...document.querySelectorAll("[data-cat]")];
    if (!chips.length) return null;
    const before = document.querySelectorAll(".dish[data-dish]").length;
    const pick = chips.find((c) => c.dataset.cat) || chips[0];
    pick.click(); await new Promise((r) => setTimeout(r, 600));
    const after = document.querySelectorAll(".dish[data-dish]").length;
    const marked = pick.classList.contains("on") || pick.classList.contains("primary") || pick.getAttribute("aria-pressed") === "true";
    const all = chips.find((c) => !c.dataset.cat || /all/i.test(c.innerText));
    if (all) { all.click(); await new Promise((r) => setTimeout(r, 600)); }
    return { before, after, marked, back: document.querySelectorAll(".dish[data-dish]").length, label: pick.innerText.trim() };
  });
  C("the menu has category chips", !!cats, cats ? `${cats.label}` : "none found");
  if (cats) {
    C("…tapping one narrows the menu", cats.after > 0 && cats.after <= cats.before, `${cats.before} → ${cats.after}`);
    C("…and the chip shows it is the chosen one", cats.marked, `marked=${cats.marked}`);
    C("…and there is a way back to everything", cats.back >= cats.after, `${cats.after} → ${cats.back}`);
  } else { for (let i = 0; i < 3; i++) C(`category check ${i + 1}`, false, "no category chips"); }

  // ── the cart ───────────────────────────────────────────────────────────────────────────
  const cart = await s.fr.evaluate(async () => {
    const out = {};
    state.cart = [];
    const plain = state.data.dishes.filter((d) => !d.open_price && !(d.options || []).length && !(d.tags || []).includes("sold-out")).slice(0, 2);
    document.querySelector(`.dish[data-dish="${plain[0].id}"]`).click();
    await new Promise((r) => setTimeout(r, 600));
    out.one = state.cart.length;
    document.querySelector(`.dish[data-dish="${plain[0].id}"]`).click();
    await new Promise((r) => setTimeout(r, 600));
    out.twice = { lines: state.cart.length, qty: state.cart[0] && state.cart[0].qty };
    document.querySelector(`.dish[data-dish="${plain[1].id}"]`).click();
    await new Promise((r) => setTimeout(r, 600));
    out.second = state.cart.length;
    out.tileMarked = document.querySelector(`.dish[data-dish="${plain[0].id}"]`).classList.contains("in");
    const total = state.cart.reduce((a, l) => a + l.price * l.qty, 0);
    out.total = Math.round(total * 100) / 100;
    out.shown = (document.querySelector(".om-cart, .cart, .ctotal") || document.body).innerText.replace(/\s+/g, " ").slice(0, 200);
    return out;
  });
  C("tapping a plain dish puts it straight in the order", cart.one === 1, `${cart.one} line`);
  C("tapping it again adds to the same line, not a second one", cart.twice.lines === 1 && cart.twice.qty === 2, JSON.stringify(cart.twice));
  C("a different dish makes its own line", cart.second === 2, `${cart.second} lines`);
  C("a dish already in the order is marked on the menu", cart.tileMarked, `marked=${cart.tileMarked}`);
  C("the order has a running total", cart.total > 0, `₹${cart.total}`);
  C("…and it is on screen somewhere the waiter can read it", /₹/.test(cart.shown), cart.shown.slice(0, 90));

  // ── the whole-order allergy row ────────────────────────────────────────────────────────
  const alg = await s.fr.evaluate(async () => {
    // THE WHOLE-ORDER ALLERGY ROW LIVES ON THE ORDER REVIEW, NOT THE BROWSE SCREEN. On a narrow
    // layout the menu fills the screen and the order is a separate step behind the "View order"
    // pill (`.om.lite:not(.vieworder)`), so looking for the row while browsing finds nothing and
    // calls a working feature missing.
    const pill = document.querySelector(".om-viewpill");
    if (pill && getComputedStyle(pill).display !== "none") { pill.click(); await new Promise((r) => setTimeout(r, 800)); }
    // #orderAlg is the ONE whole-order row ("⚠ Avoid in ALL dishes"), inside the cart. The chips on
    // a placed order's rows (.talg[data-alg]) are a different thing entirely — those edit one KOT.
    const row = document.getElementById("orderAlg");
    if (!row) return null;
    // The whole-order row uses data-OALG, not data-alg — the per-dish popup's chips are data-alg
    // and the placed-order rows' are .talg[data-alg]. Three rows, three attributes, on purpose.
    const chips = [...row.querySelectorAll("[data-oalg]")];
    if (!chips.length) return null;
    const std = chips.find((c) => c.dataset.oalg && !c.dataset.algOther);
    // Tapping redraws the whole row, so the node captured a moment ago is detached — asking IT
    // whether it is "on" always answers no. Re-find the chip by its slug after every tap.
    const slug = std.dataset.oalg;
    const find = () => document.querySelector(`#orderAlg [data-oalg="${slug}"]`);
    find().click(); await new Promise((r) => setTimeout(r, 500));
    const on = find().classList.contains("on");
    const inState = String(state.allergies || "").length > 0;
    find().click(); await new Promise((r) => setTimeout(r, 500));
    return { n: chips.length, on, inState, off: !find().classList.contains("on"), slug,
      last: [...document.querySelectorAll("#orderAlg [data-oalg]")].pop().innerText.trim() };
  });
  C("the order has its own allergy row", !!alg, alg ? `${alg.n} chips` : "none");
  if (alg) {
    C("…tapping an allergy marks it", alg.on, `on=${alg.on}`);
    C("…and it reaches the order, not just the chip", alg.inState !== false, `in state=${alg.inState}`);
    C("…and tapping again takes it off", alg.off, `off=${alg.off}`);
    C("…and the row still ends in ＋ Other", /other/i.test(alg.last), alg.last);
  } else { for (let i = 0; i < 4; i++) C(`whole-order allergy check ${i + 1}`, false, "no allergy row on this screen"); }

  // ── sending it ─────────────────────────────────────────────────────────────────────────
  await forget(s.fr); await armToasts(s.fr);
  const sent = await s.fr.evaluate(async (t) => {
    const out = { calls: [] };
    const real = window.LFH_OUTBOX.send.bind(window.LFH_OUTBOX);
    window.LFH_OUTBOX.send = async (o) => { out.calls.push({ path: o.path, body: o.body }); return real(o); };
    const before = partyOrders(t).length;
    const btn = document.querySelector("#sendOrder, .om-send, [data-send]") || [...document.querySelectorAll("button")].find((b) => /^send/i.test(b.innerText.trim()));
    out.hasButton = !!btn;
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 900));
    // a send asks first — a stray tap must not fire a ticket
    const confirm = document.querySelector("#confirmOverlay:not([hidden]), .confirm-overlay:not([hidden])");
    out.asked = !!confirm;
    out.askedTxt = confirm ? confirm.innerText.replace(/\s+/g, " ").trim() : "";
    const yes = document.querySelector("#confirmYes");
    if (yes) yes.click();
    await new Promise((r) => setTimeout(r, 3000));
    await selectTable(t).catch(() => {});
    out.after = partyOrders(t).length;
    out.before = before;
    out.cart = state.cart.length;
    window.LFH_OUTBOX.send = real;
    return out;
  }, T[0]);
  C("the order screen has a Send", sent.hasButton, `button=${sent.hasButton}`);
  C("sending asks before it fires a ticket", sent.asked, sent.askedTxt.slice(0, 90) || "(no confirm)");
  C("…and the question names what is about to happen", /send|kitchen|order/i.test(sent.askedTxt), sent.askedTxt.slice(0, 110));
  C("saying yes really places the order", sent.after > sent.before, `${sent.before} → ${sent.after} tickets`);
  C("…through the panel's own write path", sent.calls.some((c) => /\/order$/.test(c.path)), sent.calls.map((c) => c.path).join(" · "));
  C("…carrying the table it belongs to", sent.calls.some((c) => c.body && String(c.body.table) === T[0]), JSON.stringify((sent.calls.find((c) => /\/order$/.test(c.path)) || {}).body || {}).slice(0, 90));
  C("…and the cart empties afterwards", sent.cart === 0, `${sent.cart} lines left`);
  const said = (await heard(s.fr)).join(" | ");
  C("the waiter is told it went", said.length > 0, said.slice(0, 110) || "(silent)");
  C("…in words, with no code in them", !LEAK.test(said), said.slice(0, 110));

  C("no uncaught page error while taking an order", s.errs.length === 0, s.errs.join(" | ").slice(0, 200));
} catch (e) { C("block E completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("E") ? 1 : 0; }
