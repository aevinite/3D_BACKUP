// T7 · fourth 500 · BLOCK C — THE MANAGER PANEL'S OWN MONEY BOXES, DRIVEN.
// Item 21 changed six boxes in public/panels/editor/app.js — another terminal's territory, fixed
// here because the owner asked for it. A fix in someone else's file is a fix I have to DRIVE.
// openDiscountModal() and openPaymentMethodModal() are real globals on that panel, so this drives
// the shipped code with real numbers rather than reading the tags.
import { openManager, C, dump, at, LEAK } from "./lib.mjs";
at(42652);
let s;
try {
  s = await openManager();
  C("the manager panel loads", await s.fr.evaluate(() => !!document.body && document.body.children.length > 0));
  C("…and its discount sheet is a real function on it", await s.fr.evaluate(() => typeof openDiscountModal === "function"));
  C("…and so is its payment sheet", await s.fr.evaluate(() => typeof openPaymentMethodModal === "function"));

  // ── the DISCOUNT sheet, driven on a bill that carries paise ────────────────────────────
  const disc = await s.fr.evaluate(async () => {
    const out = {};
    const order = { id: "t7-probe", discount: 0, total: 2400, subtotal: 2400 };
    const bm = { rate: 0.05, base: 2400, lockedAmt: 0, subtotal: 2400, total: 2520 };
    openDiscountModal(order, () => {}, 2520, bm, true, null);
    await new Promise((r) => setTimeout(r, 500));
    const ov = document.querySelector(".disc-overlay");
    out.open = !!ov;
    if (!ov) return out;
    const pct = ov.querySelector("#discPctInput"), amt = ov.querySelector("#discAmtInput"), pay = ov.querySelector("#discPayInput");
    out.tags = [pct, amt, pay].map((e) => ({ step: e.getAttribute("step"), mode: e.getAttribute("inputmode"), type: e.type, app: getComputedStyle(e).appearance }));
    const fire = (el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    // 12.5% of a ₹2,400 base is ₹300 — the case the whole rule exists for
    fire(amt, 300); await new Promise((r) => setTimeout(r, 250));
    out.byAmt = { pct: pct.value, pay: pay.value, valid: pct.checkValidity() };
    // and the other way: a percentage with a decimal in it
    fire(pct, 12.5); await new Promise((r) => setTimeout(r, 250));
    out.byPct = { amt: amt.value, pay: pay.value, valid: amt.checkValidity() };
    // an amount with paise
    fire(amt, 153.29); await new Promise((r) => setTimeout(r, 250));
    out.paise = { kept: amt.value, valid: amt.checkValidity(), pct: pct.value };
    // "They pay" with paise
    fire(pay, 2000.5); await new Promise((r) => setTimeout(r, 250));
    out.paid = { amt: amt.value, valid: pay.checkValidity() };
    out.note = (ov.querySelector(".disc-cap-note") || {}).textContent || "";
    out.txt = ov.innerText.replace(/\s+/g, " ").trim();
    // the manager's sheet closes on .dish-edit-cancel — its own footer, not the tablet's class names
    const cancel = ov.querySelector(".dish-edit-cancel") || ov.querySelector(".disc-cancel-btn") || ov.querySelector(".disc-close");
    if (cancel) cancel.click(); else ov.remove();
    await new Promise((r) => setTimeout(r, 300));
    out.closed = !document.querySelector(".disc-overlay");
    return out;
  });
  C("the discount sheet opens", disc.open, `open=${disc.open}`);
  for (let i = 0; i < 3; i++) {
    const name = ["percent", "amount", "“They pay”"][i];
    C(`item 21 — the manager's discount ${name} box steps in paise`, disc.tags[i].step === "0.01", `step=${disc.tags[i].step}`);
    C(`item 21 — …and keeps the number keypad`, disc.tags[i].mode === "decimal" && disc.tags[i].type === "number", `${disc.tags[i].type}/${disc.tags[i].mode}`);
  }
  C("a ₹300 discount off a ₹2,400 base works out as 12.5%", disc.byAmt.pct === "12.5", disc.byAmt.pct);
  C("item 21 — …and that 12.5 is a VALID value in its own box", disc.byAmt.valid === true, `checkValidity=${disc.byAmt.valid}`);
  C("typing 12.5% fills the amount back in", Math.abs(Number(disc.byPct.amt) - 300) < 0.02, disc.byPct.amt);
  C("…and “They pay” follows both", Number(disc.byAmt.pay) > 0 && Number(disc.byPct.pay) > 0, `${disc.byAmt.pay} / ${disc.byPct.pay}`);
  C("an amount with paise is accepted", Number(disc.paise.kept) === 153.29, disc.paise.kept);
  C("item 21 — …and the browser calls it valid, which step=\"1\" did not", disc.paise.valid === true, `checkValidity=${disc.paise.valid}`);
  C("…and the percentage follows it to a decimal", /\./.test(disc.paise.pct) || Number(disc.paise.pct) > 0, disc.paise.pct);
  C("“They pay” accepts paise too", disc.paid.valid === true, `checkValidity=${disc.paid.valid}`);
  C("…and works the discount out from it", Number(disc.paid.amt) > 0, disc.paid.amt);
  C("nothing in the discount sheet leaks code", !LEAK.test(disc.txt), disc.txt.slice(0, 110));
  C("the sheet closes again", disc.closed, `closed=${disc.closed}`);

  // ── the TIP row on the payment sheet ───────────────────────────────────────────────────
  const tip = await s.fr.evaluate(async () => {
    const out = {};
    const p = openPaymentMethodModal(1065.75, "Mark bill paid for table 9", { tip: true });
    await new Promise((r) => setTimeout(r, 600));
    const wrap = document.querySelector(".pay-overlay, .pay-wrap, .paymethod-overlay") || document;
    const pct = wrap.querySelector("#payTipPct"), amt = wrap.querySelector("#payTipInput"), paid = wrap.querySelector("#payPaidInput");
    out.row = !!(pct && amt && paid);
    if (!out.row) { const x = document.querySelector(".pay-overlay .pay-x, .pay-overlay .pay-close"); if (x) x.click(); return out; }
    out.tags = [pct, amt, paid].map((e) => ({ step: e.getAttribute("step"), mode: e.getAttribute("inputmode"), type: e.type }));
    const fire = (el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    fire(pct, 7.5); await new Promise((r) => setTimeout(r, 250));
    out.byPct = { amt: amt.value, paid: paid.value, valid: pct.checkValidity() };
    fire(amt, 79.93); await new Promise((r) => setTimeout(r, 250));
    out.byAmt = { pct: pct.value, paid: paid.value, valid: amt.checkValidity() };
    fire(paid, 1200.25); await new Promise((r) => setTimeout(r, 250));
    out.byPaid = { amt: amt.value, valid: paid.checkValidity() };
    out.msg = (wrap.querySelector("#payTipMsg") || {}).textContent || "";
    const x = document.querySelector(".pay-overlay .pay-x, .pay-overlay .pay-close, .pay-cancel");
    if (x) x.click();
    await new Promise((r) => setTimeout(r, 300));
    return out;
  });
  C("the manager's payment sheet has a tip row", tip.row, `row=${tip.row}`);
  if (tip.row) {
    for (let i = 0; i < 3; i++) {
      const name = ["tip percent", "tip amount", "“they paid” total"][i];
      C(`item 21 — the manager's ${name} box steps in paise`, tip.tags[i].step === "0.01", `step=${tip.tags[i].step}`);
      C(`item 21 — …and keeps the number keypad`, tip.tags[i].mode === "decimal" && tip.tags[i].type === "number", `${tip.tags[i].type}/${tip.tags[i].mode}`);
    }
    C("7.5% of ₹1,065.75 fills in an amount with paise", /\./.test(tip.byPct.amt) || Number(tip.byPct.amt) > 0, tip.byPct.amt);
    C("item 21 — …and 7.5 is valid in its own box", tip.byPct.valid === true, `checkValidity=${tip.byPct.valid}`);
    C("a tip of ₹79.93 is accepted to the paise", tip.byAmt.valid === true, `checkValidity=${tip.byAmt.valid}`);
    C("…and the percentage follows it", Number(tip.byAmt.pct) > 0, tip.byAmt.pct);
    C("a total handed over with paise is accepted", tip.byPaid.valid === true, `checkValidity=${tip.byPaid.valid}`);
    C("…and the tip is worked out from it", Number(tip.byPaid.amt) > 0, tip.byPaid.amt);
  } else { for (let i = 0; i < 12; i++) C(`the manager's tip row check ${i + 1}`, false, "the tip row did not render for this call"); }

  // ── and the file itself, as served ─────────────────────────────────────────────────────
  const src = await (await fetch("https://3-d-backup.vercel.app/panels/editor/app.js")).text();
  for (const id of ["discPctInput", "discAmtInput", "discPayInput", "payTipPct", "payTipInput", "payPaidInput", "psr-amt", "bqNewPrice"]) {
    const tags = [...src.matchAll(new RegExp(`<input[^>]*\\b(?:id|class)="[^"]*\\b${id}\\b[^"]*"[^>]*>`, "g"))].map((m) => m[0]);
    C(`item 21 — the live manager panel's ${id} steps in paise`, tags.length > 0 && tags.every((t) => /step="0\.01"/.test(t)), tags.map((t) => (t.match(/step="[^"]*"/) || ["(none)"])[0]).join(",") || "NOT FOUND");
  }
  const left = [...src.matchAll(/<input[^>]*>/g)].map((m) => m[0]).filter((t) => /type="number"/.test(t) && /amt|amount|price|pay|tip|disc/i.test(t) && /step="1"/.test(t));
  C('item 21 — no money-shaped box on the live manager panel is left at step="1"', left.length === 0, left.slice(0, 2).map((t) => t.slice(0, 90)).join(" | ") || "none");
  C("the banquet price boxes gained the number keypad too", /data-bq-f="price"[^>]*inputmode="decimal"|inputmode="decimal"[^>]*data-bq-f="price"/.test(src) || /bqNewPrice[^>]*inputmode="decimal"|inputmode="decimal"[^>]*bqNewPrice/.test(src), "checked the live file");

  C("no uncaught page error while driving the manager panel", s.errs.length === 0, s.errs.join(" | ").slice(0, 200));
  C("no leaked code text on the manager panel", !LEAK.test(await s.fr.evaluate(() => document.body.innerText.slice(0, 3000))));
} catch (e) { C("block C completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} process.exitCode = dump("C") ? 1 : 0; }
