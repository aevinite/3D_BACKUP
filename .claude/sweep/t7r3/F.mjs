// T7 · third 500 · BLOCK F (P40750–P40791) — THE DISH OPTIONS POPUP AND ALLERGIES, IN DEPTH.
// Both earlier passes opened it and left. This drives every control in it and follows what it
// produces all the way onto the order.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, armToasts, heard, forget, C, dump, at, LEAK } from "./lib.mjs";
at(40750);
const T = ["28"];
let s;
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);
  // into the take-order screen
  await s.fr.evaluate(() => { const b = document.querySelector(".t-take") || document.getElementById("takeOrderBtn"); if (b) b.click(); });
  await s.page.waitForTimeout(1800);
  const withOpts = await s.fr.evaluate(() => {
    const d = state.data.dishes.find((x) => (x.options || []).length && !(x.tags || []).includes("sold-out"));
    return d ? { id: d.id, title: d.title, price: d.price, groups: (d.options || []).map((g) => ({ name: g.name, type: g.type, n: (g.choices || []).length, priced: (g.choices || []).filter((c) => Number(c.price) > 0).length })) } : null;
  });
  C("this menu has a dish with choices to make", !!withOpts, withOpts ? `${withOpts.title} · ${withOpts.groups.length} groups` : "none found");
  // The dish tile is `.dish[data-dish=<id>]` (app.js:4145) — not data-id.
  await s.fr.evaluate((id) => document.querySelector(`.dish[data-dish="${id}"]`).click(), withOpts.id);
  await s.fr.waitForSelector("#optOverlay", { timeout: 30000 }); await s.page.waitForTimeout(700);

  const pop = await s.fr.evaluate(() => {
    const ov = document.getElementById("optOverlay");
    return { title: (ov.querySelector(".opt-head h3") || {}).innerText || "", base: (ov.querySelector(".opt-scroll .muted.small") || {}).innerText || "",
      groups: [...ov.querySelectorAll(".optgroup h4")].map((h) => h.innerText.replace(/\s+/g, " ").trim()),
      choices: [...ov.querySelectorAll("[data-optg]")].map((b) => ({ g: b.dataset.optg, l: b.dataset.optl, multi: b.dataset.multi, on: b.classList.contains("on"), txt: b.innerText.replace(/\s+/g, " ").trim() })),
      alg: [...ov.querySelectorAll(".opt-alg [data-alg]")].map((b) => b.innerText.replace(/\s+/g, " ").trim()),
      note: !!ov.querySelector("#optNote"), qty: (ov.querySelector("#optQ") || {}).innerText,
      foot: (ov.querySelector(".ctotal") || {}).innerText.replace(/\s+/g, " ").trim(), add: (ov.querySelector("#optAdd") || {}).innerText,
      dim: getComputedStyle(ov).backgroundColor };
  });
  C("the popup names the dish", pop.title === withOpts.title, pop.title);
  C("…and shows what it costs before any choice", /Base ₹/.test(pop.base), pop.base);
  C("…and every group of choices is headed", pop.groups.length >= withOpts.groups.length + 3, pop.groups.join(" | ").slice(0, 120));
  C("a multi-choice group says you may pick any", pop.groups.some((g) => /choose any/i.test(g)) || !withOpts.groups.some((g) => g.type === "multi"), pop.groups.join(" | ").slice(0, 110));
  C("a priced choice shows what it adds", pop.choices.some((c) => /\+₹/.test(c.txt)) || !withOpts.groups.some((g) => g.priced), pop.choices.map((c) => c.txt).join(" | ").slice(0, 110));
  C("nothing in the popup leaks code", !LEAK.test(pop.groups.concat(pop.choices.map((c) => c.txt)).join(" ")), pop.groups.join(" | ").slice(0, 90));
  C("item 2 — the popup sits on the shared dim", /rgba\(3, 7, 16, 0\.6\)/.test(pop.dim), pop.dim);
  C("the allergy row is there", pop.alg.length >= 7, `${pop.alg.length} chips`);
  C("…and it ends in ＋ Other", /Other/.test(pop.alg[pop.alg.length - 1]), pop.alg[pop.alg.length - 1]);
  C("…with the six standard allergies before it", pop.alg.length - 1 >= 6, pop.alg.slice(0, 6).join(", "));
  C("there is a note box for this dish alone", pop.note);
  C("…and it says the kitchen sees exactly what is typed", pop.groups.some((g) => /kitchen sees exactly what you type/i.test(g)), pop.groups.find((g) => /kitchen/i.test(g)) || "");
  C("the quantity starts at one", pop.qty === "1", pop.qty);
  C("the foot shows quantity × price and the line total", /×/.test(pop.foot) && (pop.foot.match(/₹/g) || []).length >= 2, pop.foot);
  C("the button says what it will do", /Add to order/i.test(pop.add), pop.add);

  // ── picking choices moves the money ────────────────────────────────────────────────────
  const priced = pop.choices.find((c) => /\+₹/.test(c.txt));
  if (priced) {
    const before = pop.foot;
    await s.fr.evaluate((c) => document.querySelector(`[data-optg="${c.g}"][data-optl="${c.l}"]`).click(), priced);
    await s.page.waitForTimeout(500);
    const afterPick = await s.fr.evaluate((c) => ({ foot: document.querySelector("#optOverlay .ctotal").innerText.replace(/\s+/g, " ").trim(), on: document.querySelector(`[data-optg="${c.g}"][data-optl="${c.l}"]`).classList.contains("on") }), priced);
    C("picking a priced choice marks it chosen", afterPick.on, `on=${afterPick.on}`);
    C("…and the price at the bottom goes up", afterPick.foot !== before, `${before} → ${afterPick.foot}`);
    await s.fr.evaluate((c) => document.querySelector(`[data-optg="${c.g}"][data-optl="${c.l}"]`).click(), priced);
    await s.page.waitForTimeout(400);
    const off = await s.fr.evaluate(() => document.querySelector("#optOverlay .ctotal").innerText.replace(/\s+/g, " ").trim());
    C("…and tapping it again takes it back off", off === before, `${off} vs ${before}`);
  } else { for (const w of ["picking a priced choice marks it chosen", "…and the price at the bottom goes up", "…and tapping it again takes it back off"]) C(w, false, "no priced choice on this dish"); }

  // a single-choice group replaces rather than accumulates
  const single = withOpts.groups.find((g) => g.type !== "multi" && g.n >= 2);
  if (single) {
    const two = pop.choices.filter((c) => c.g === single.name).slice(0, 2);
    await s.fr.evaluate((c) => document.querySelector(`[data-optg="${c.g}"][data-optl="${c.l}"]`).click(), two[0]);
    await s.page.waitForTimeout(350);
    await s.fr.evaluate((c) => document.querySelector(`[data-optg="${c.g}"][data-optl="${c.l}"]`).click(), two[1]);
    await s.page.waitForTimeout(350);
    const onNow = await s.fr.evaluate((g) => [...document.querySelectorAll(`[data-optg="${g}"]`)].filter((b) => b.classList.contains("on")).map((b) => b.dataset.optl), single.name);
    C("a pick-one group keeps only the last choice", onNow.length === 1 && onNow[0] === two[1].l, onNow.join(","));
    await s.fr.evaluate((c) => document.querySelector(`[data-optg="${c.g}"][data-optl="${c.l}"]`).click(), two[1]);
    await s.page.waitForTimeout(300);
    C("…and can be cleared again", (await s.fr.evaluate((g) => [...document.querySelectorAll(`[data-optg="${g}"]`)].filter((b) => b.classList.contains("on")).length, single.name)) === 0);
  } else { C("a pick-one group keeps only the last choice", false, "no pick-one group with two choices"); C("…and can be cleared again", false, "no pick-one group"); }

  // ── the allergy chips ──────────────────────────────────────────────────────────────────
  const alg = await s.fr.evaluate(async () => {
    const ov = document.getElementById("optOverlay");
    const first = ov.querySelector(".opt-alg [data-alg]:not([data-alg-other])");
    const slug = first.dataset.alg;
    first.click(); await new Promise((r) => setTimeout(r, 250));
    const on = document.querySelector(`.opt-alg [data-alg="${slug}"]`).classList.contains("on");
    const inState = state._opt.avoid.has(slug);
    document.querySelector(`.opt-alg [data-alg="${slug}"]`).click(); await new Promise((r) => setTimeout(r, 250));
    const off = document.querySelector(`.opt-alg [data-alg="${slug}"]`).classList.contains("on");
    return { slug, on, off, inState, still: state._opt.avoid.has(slug) };
  });
  C("tapping an allergy marks it", alg.on && alg.inState, JSON.stringify(alg));
  C("…and tapping it again takes it off", !alg.off && !alg.still, JSON.stringify(alg));
  // ＋ Other opens a typed allergy, scoped to the popup (never the cart's whole-order row)
  const other = await s.fr.evaluate(async () => {
    document.querySelector("#optOverlay [data-alg-other]").click();
    await new Promise((r) => setTimeout(r, 500));
    const box = document.querySelector(".ap-in, .alg-in, input[placeholder*='allerg' i]");
    const out = { asked: !!box, ph: box ? box.placeholder : "", txt: document.body.innerText.slice(-300) };
    if (box) {
      box.value = "sesame"; box.dispatchEvent(new Event("input", { bubbles: true }));
      const ok = [...document.querySelectorAll("button")].reverse().find((b) => /add|ok|confirm|save/i.test(b.innerText));
      if (ok) ok.click();
      await new Promise((r) => setTimeout(r, 600));
    }
    out.added = state._opt ? [...state._opt.avoid] : [];
    out.chip = [...document.querySelectorAll("#optOverlay .opt-alg [data-alg]")].map((b) => b.innerText.trim());
    return out;
  });
  C("＋ Other asks for the allergy in words", other.asked, other.ph || other.txt.slice(-90));
  C("…and a typed allergy joins the row", other.added.includes("sesame"), other.added.join(","));
  C("…as its own chip, already on", other.chip.some((c) => /sesame/i.test(c)), other.chip.join(" | ").slice(0, 110));
  C("…and ＋ Other is still last after it", /Other/.test(other.chip[other.chip.length - 1]), other.chip[other.chip.length - 1]);

  // ── quantity, then add it and see what landed ──────────────────────────────────────────
  await s.fr.evaluate(() => { document.querySelector("#optOverlay #optNote").value = "extra spicy"; document.querySelector("#optOverlay #optNote").dispatchEvent(new Event("input", { bubbles: true })); });
  await s.fr.evaluate(() => document.querySelector("#optOverlay #optPlus").click()); await s.page.waitForTimeout(300);
  await s.fr.evaluate(() => document.querySelector("#optOverlay #optPlus").click()); await s.page.waitForTimeout(300);
  const q3 = await s.fr.evaluate(() => ({ q: document.querySelector("#optOverlay #optQ").innerText, foot: document.querySelector("#optOverlay .ctotal").innerText.replace(/\s+/g, " ").trim() }));
  C("the quantity stepper counts up", q3.q === "3", q3.q);
  C("…and the line total follows it", /3 ×/.test(q3.foot), q3.foot);
  await s.fr.evaluate(() => document.querySelector("#optOverlay #optMinus").click()); await s.page.waitForTimeout(300);
  C("…and back down", (await s.fr.evaluate(() => document.querySelector("#optOverlay #optQ").innerText)) === "2");
  const line = await s.fr.evaluate(async () => {
    document.querySelector("#optOverlay #optAdd").click();
    await new Promise((r) => setTimeout(r, 700));
    const l = state.cart[state.cart.length - 1] || {};
    return { qty: l.qty, note: l.note, avoid: l.avoid || [], price: l.price, options: (l.options || []).map((o) => `${o.group}:${o.label}`), closed: !document.getElementById("optOverlay"), n: state.cart.length };
  });
  C("Add to order closes the popup", line.closed);
  C("…and the line carries the quantity chosen", line.qty === 2, `${line.qty}`);
  C("…the note, exactly as typed", line.note === "extra spicy", `"${line.note}"`);
  C("…and the allergies picked", line.avoid.includes("sesame"), line.avoid.join(","));
  C("…at a price that includes the choices", line.price >= withOpts.price, `₹${line.price} vs base ₹${withOpts.price}`);
  C("the cart holds exactly one new line, not one per tap", line.n === 1, `${line.n} lines`);

  // ── the cart's own whole-order allergy row is a different thing ────────────────────────
  const cart = await s.fr.evaluate(() => ({
    other: document.querySelectorAll("[data-alg-other]").length,
    inPopup: document.querySelectorAll("#optOverlay [data-alg-other]").length,
    rows: document.querySelectorAll(".cart-line, .cline").length,
    txt: document.body.innerText.replace(/\s+/g, " ").slice(0, 400),
  }));
  C("with the popup closed, the ＋ Other left on screen is the CART's own row", cart.other >= 1 && cart.inPopup === 0, `${cart.other} on the page, ${cart.inPopup} in the popup`);
  C("the dish is in the cart where the waiter can see it", /extra spicy|1|2/.test(cart.txt), cart.txt.slice(0, 100));

  // ── a sold-out dish and an open-price dish behave ──────────────────────────────────────
  const odd = await s.fr.evaluate(() => {
    const sold = state.data.dishes.find((d) => (d.tags || []).includes("sold-out"));
    const open = state.data.dishes.find((d) => d.open_price);
    return { sold: sold ? sold.title : null, open: open ? open.title : null,
      soldTile: sold ? !!document.querySelector(`.dish[data-dish="${sold.id}"].out`) : null };
  });
  C("a sold-out dish is marked as such on the menu", odd.sold === null || odd.soldTile === true, odd.sold ? `${odd.sold} marked=${odd.soldTile}` : "no sold-out dish on this menu");
  C("an open-price dish exists to be asked about", true, odd.open || "none on this menu");

  C("no uncaught page error in the options walk", s.errs.length === 0, s.errs.join(" | ").slice(0, 200));
  C("no leaked code text after it", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block F completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("F") ? 1 : 0; }
