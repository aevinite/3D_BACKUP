// T7 · fourth 500 · BLOCK B — THE SPLIT SCREEN'S NEW TIP ROW (PR #1187, landed 2026-08-30).
// It arrived in my own territory file, written by another lane, on the day of this pass — and it
// came carrying the step="1" fault I had fixed hours earlier (item 21b). Nothing has driven it.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, armToasts, heard, forget, C, dump, at, LEAK } from "./lib.mjs";
import { setSplit } from "./flags.mjs";
at(42594);
const T = ["14"];
let s;
const openSplit = async () => {
  await openTable(s, T[0]);
  await s.fr.evaluate(() => document.getElementById("kotMenuBtn").click());
  await s.fr.waitForSelector("[data-kotop]", { timeout: 30000 });
  await s.page.waitForTimeout(400);
  await s.fr.evaluate(() => document.querySelector('[data-kotop="split"]').click());
  await s.fr.waitForSelector(".sb-tabs", { timeout: 30000 });
  await s.page.waitForTimeout(800);
};
try {
  await setSplit(true);
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);
  await armToasts(s.fr);
  const prep = await s.fr.evaluate(async (t) => {
    const ds = state.data.dishes.filter((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out")).slice(0, 2);
    for (const d of ds) { await api("POST", "/order", { table: t, items: [{ id: d.id, qty: 1 }], allergies: [], confirmDuplicate: true }); await new Promise((r) => setTimeout(r, 800)); }
    await selectTable(t);
    for (const o of state.data.orders.filter((o) => String(o.table_number) === t && o.status === "received")) await api("POST", `/orders/${o.id}/accept`);
    await selectTable(t);
    return state.data.orders.filter((o) => String(o.table_number) === t && o.status !== "cancelled").length;
  }, T[0]);
  await s.page.waitForTimeout(1500);
  C("the fixture built a two-ticket bill to split", prep >= 2, `${prep} tickets`);

  await openSplit();
  const due = await s.fr.evaluate((t) => { const rate = effRate(); const pay = partyOrders(t).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled" && o.status !== "received"); return Math.round(pay.reduce((x, o) => x + (Number(o.total) || 0) - (Number(o.discount) || 0) * (1 + rate), 0) * 100) / 100; }, T[0]);
  const exact = (n) => "₹" + (Math.abs(n - Math.round(n)) < 0.005 ? Math.round(n).toLocaleString("en-IN") : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  // ── the row exists, and says what it is ────────────────────────────────────────────────
  const row = await s.fr.evaluate(() => {
    const r = document.querySelector(".sb-tip");
    if (!r) return null;
    return { txt: r.innerText.replace(/\s+/g, " ").trim(),
      pct: !!r.querySelector(".pay-tip-pct"), amt: !!r.querySelector(".pay-tip-amt"), paid: !!r.querySelector(".pay-tip-paid"),
      picks: [...r.querySelectorAll(".pay-tip-pick")].map((b) => b.innerText.trim()),
      pickH: [...r.querySelectorAll(".pay-tip-pick")].map((b) => Math.round(b.getBoundingClientRect().height)),
      steps: [...r.querySelectorAll("input")].map((i) => i.getAttribute("step")),
      modes: [...r.querySelectorAll("input")].map((i) => i.getAttribute("inputmode")),
      belowParts: (() => { const rows = document.querySelectorAll(".sb-row"); const last = rows[rows.length - 1]; return last ? r.getBoundingClientRect().top >= last.getBoundingClientRect().top : null; })(),
      aboveGo: (() => { const g = document.querySelector(".sb-go"); return g ? r.getBoundingClientRect().bottom <= g.getBoundingClientRect().bottom : null; })() };
  });
  C("the split screen has a tip row", !!row, row ? "present" : "MISSING — PR #1187's row is gone");
  C("…and it asks the question in words", /Add a tip/i.test(row.txt), row.txt.slice(0, 60));
  C("…and says it is optional", /optional/i.test(row.txt), row.txt.slice(0, 90));
  C("…and says it is on top of the whole bill", /on top of the whole bill/i.test(row.txt), row.txt.slice(0, 120));
  C("…and says plainly that it is NOT divided between the parts", /not divided between the parts/i.test(row.txt), row.txt.slice(0, 200));
  C("…and explains that the three boxes follow each other", /Change any one of the three/i.test(row.txt), row.txt.slice(0, 160));
  C("it has all three linked boxes", row.pct && row.amt && row.paid, JSON.stringify({ pct: row.pct, amt: row.amt, paid: row.paid }));
  C("item 21b — every one of them steps in paise", row.steps.every((v) => v === "0.01"), row.steps.join(","));
  C("…and asks for the number keypad", row.modes.every((v) => v === "decimal"), row.modes.join(","));
  C("it offers quick percentages", row.picks.length >= 3, row.picks.join(" · "));
  C("…including a way back to none", row.picks.some((p) => /none/i.test(p)), row.picks.join(" · "));
  C("…and every one is a 44px target", row.pickH.every((h) => h >= 44), row.pickH.join(","));
  C("the tip sits BELOW the parts, where it cannot be read as one of them", row.belowParts === true, `below=${row.belowParts}`);
  C("…and above the Collect button", row.aboveGo === true, `above=${row.aboveGo}`);
  C("nothing in the tip row leaks code", !LEAK.test(row.txt), row.txt.slice(0, 110));

  // ── it opens with NO tip, and the button says so ───────────────────────────────────────
  const zero = await s.fr.evaluate(() => ({ pct: document.querySelector(".pay-tip-pct").value, amt: document.querySelector(".pay-tip-amt").value, paid: document.querySelector(".pay-tip-paid").value, go: document.querySelector(".sb-go").textContent.trim() }));
  C("it opens with no tip typed in", zero.pct === "" && zero.amt === "", `pct="${zero.pct}" amt="${zero.amt}"`);
  C("…and the button offers just the bill", zero.go.includes(exact(due)) && /in parts/.test(zero.go), zero.go);
  C("…and the word 'tip' is not on the button until there is one", !/tip/i.test(zero.go), zero.go);

  // ── the three boxes really follow each other ───────────────────────────────────────────
  const chain = await s.fr.evaluate(async (d) => {
    const out = {};
    const pct = document.querySelector(".pay-tip-pct"), amt = document.querySelector(".pay-tip-amt"), paid = document.querySelector(".pay-tip-paid"), go = document.querySelector(".sb-go");
    const fire = (el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    fire(pct, 10); await new Promise((r) => setTimeout(r, 200));
    out.byPct = { amt: amt.value, paid: paid.value, go: go.textContent.trim() };
    fire(amt, 250); await new Promise((r) => setTimeout(r, 200));
    out.byAmt = { pct: pct.value, paid: paid.value, go: go.textContent.trim() };
    fire(paid, Math.round(d) + 500); await new Promise((r) => setTimeout(r, 200));
    out.byPaid = { pct: pct.value, amt: amt.value, go: go.textContent.trim() };
    const none = [...document.querySelectorAll(".pay-tip-pick")].find((b) => /none/i.test(b.innerText));
    if (none) { none.click(); await new Promise((r) => setTimeout(r, 250)); }
    out.afterNone = { pct: pct.value, amt: amt.value, go: go.textContent.trim() };
    const ten = [...document.querySelectorAll(".pay-tip-pick")].find((b) => b.dataset.tipPct === "10");
    if (ten) { ten.click(); await new Promise((r) => setTimeout(r, 250)); }
    out.afterTen = { pct: pct.value, amt: amt.value, primary: ten ? ten.classList.contains("primary") : null };
    return out;
  }, due);
  C("typing a percentage fills in the amount", Math.abs(Number(chain.byPct.amt) - Math.round(due * 10) / 100) < 0.02, `10% of ${due} → ${chain.byPct.amt}`);
  C("…and the total they hand over", Number(chain.byPct.paid) > due, chain.byPct.paid);
  C("…and the button names the tip separately from the bill", /tip/i.test(chain.byPct.go) && chain.byPct.go.includes(exact(due)), chain.byPct.go);
  C("typing an amount fills in the percentage", Number(chain.byAmt.pct) > 0, `₹250 → ${chain.byAmt.pct}%`);
  C("…and the percentage is right", Math.abs(Number(chain.byAmt.pct) - Math.round((250 / due) * 1000) / 10) < 0.11, `${chain.byAmt.pct}% for ₹250 of ₹${due}`);
  C("typing what they handed over works out the tip", Math.abs(Number(chain.byPaid.amt) - (Math.round(due) + 500 - due)) < 1.01, `paid ${Math.round(due) + 500} → tip ${chain.byPaid.amt}`);
  C("tapping None clears the tip", chain.afterNone.pct === "" && chain.afterNone.amt === "", JSON.stringify(chain.afterNone));
  C("…and the button goes back to just the bill", !/tip/i.test(chain.afterNone.go), chain.afterNone.go);
  C("a quick percentage fills both boxes", Number(chain.afterTen.amt) > 0 && Number(chain.afterTen.pct) === 10, JSON.stringify(chain.afterTen));
  C("…and marks itself as the chosen one", chain.afterTen.primary === true, `primary=${chain.afterTen.primary}`);

  // ── THE RULE THAT MATTERS: a tip must never change what the parts must add up to ───────
  const guard = await s.fr.evaluate(async (d) => {
    const out = {};
    const fire = (el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    fire(document.querySelector(".pay-tip-amt"), 300); await new Promise((r) => setTimeout(r, 250));
    out.sumLine = document.querySelector(".sb-sum").textContent.trim();
    out.amts = [...document.querySelectorAll(".sb-amt")].map((i) => Number(i.value) || 0);
    out.total = Math.round(out.amts.reduce((a, b) => a + b, 0) * 100) / 100;
    out.due = d;
    return out;
  }, due);
  C("a tip does NOT change the parts", Math.abs(guard.total - due) < 0.02, `${guard.amts.join(" + ")} = ${guard.total} vs bill ${due}`);
  C("…and the running line still measures against the BILL, not bill+tip", /add up to/i.test(guard.sumLine) && guard.sumLine.includes(exact(due)), guard.sumLine);
  C("…so a tip can never make a balanced split look short", !/still to cover|more than/i.test(guard.sumLine), guard.sumLine);

  // ── the refusals around a big tip ──────────────────────────────────────────────────────
  const big = await s.fr.evaluate(async (d) => {
    const out = {};
    const fire = (el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    fire(document.querySelector(".pay-tip-amt"), Math.round(d) + 100); await new Promise((r) => setTimeout(r, 250));
    out.bigger = document.querySelector(".pay-tip-msg").textContent.trim();
    out.biggerShown = getComputedStyle(document.querySelector(".pay-tip-msg")).display !== "none";
    fire(document.querySelector(".pay-tip-amt"), 999999); await new Promise((r) => setTimeout(r, 250));
    out.ceiling = document.querySelector(".pay-tip-msg").textContent.trim();
    out.midType = document.querySelector(".pay-tip-amt").value;   // deliberately NOT rewritten mid-keystroke
    // …and on BLUR every box snaps back to the value really kept. That is the rule ("a refused
    // figure must not be left on screen"), and blurring is what a person does next — reading the
    // box while the caret is still in it measures a state nobody is ever left looking at.
    document.querySelector(".pay-tip-amt").dispatchEvent(new Event("blur", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    out.kept = document.querySelector(".pay-tip-amt").value;
    fire(document.querySelector(".pay-tip-paid"), 1); await new Promise((r) => setTimeout(r, 250));
    out.less = document.querySelector(".pay-tip-msg").textContent.trim();
    fire(document.querySelector(".pay-tip-amt"), 100); await new Promise((r) => setTimeout(r, 250));
    out.cleared = document.querySelector(".pay-tip-msg").textContent.trim();
    // a blank "they paid" box must not wipe the tip
    const paid = document.querySelector(".pay-tip-paid");
    paid.value = ""; paid.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    out.afterBlank = document.querySelector(".pay-tip-amt").value;
    return out;
  }, due);
  C("a tip bigger than the bill is allowed, and asked about", /bigger than the bill/i.test(big.bigger), big.bigger.slice(0, 110));
  C("…and it is actually shown, not just set", big.biggerShown, `shown=${big.biggerShown}`);
  C("…and the sentence quotes the bill to the paise", big.bigger.includes(exact(due)), big.bigger.slice(0, 110));
  C("a tip past the ceiling is refused in words", /most a tip can be/i.test(big.ceiling), big.ceiling.slice(0, 110));
  C("…and the box is not rewritten under the caret, mid-keystroke", big.midType === "999999", big.midType);
  C("…but on blur it snaps back to the figure really kept", Number(big.kept) <= 100000 && Number(big.kept) > 0, `${big.midType} → ${big.kept}`);
  C("handing over LESS than the bill is explained, not silently made a tip", /less than the bill/i.test(big.less), big.less.slice(0, 130));
  C("…and that sentence says what the box actually means", /TOTAL they handed over/i.test(big.less), big.less.slice(0, 150));
  C("an ordinary tip clears the warning again", big.cleared === "", `"${big.cleared}"`);
  C("emptying the 'they paid' box does not wipe a tip already typed", Number(big.afterBlank) === 100, big.afterBlank);

  // ── the tip survives changing HOW the bill is divided ──────────────────────────────────
  const across = await s.fr.evaluate(async () => {
    const out = {};
    for (const m of ["custom", "dish", "ticket", "equal"]) {
      const tab = document.querySelector(`.sb-tab[data-mode="${m}"]`);
      if (!tab || tab.classList.contains("sb-tab-off")) { out[m] = "n/a"; continue; }
      tab.click(); await new Promise((r) => setTimeout(r, 500));
      out[m] = { tip: document.querySelector(".pay-tip-amt") ? document.querySelector(".pay-tip-amt").value : null, row: !!document.querySelector(".sb-tip") };
    }
    return out;
  });
  for (const m of ["custom", "dish", "ticket", "equal"]) {
    C(`the tip row is on the "${m}" way of dividing too`, across[m] === "n/a" || across[m].row === true, JSON.stringify(across[m]));
    C(`…and the tip typed is not lost when the way of dividing changes`, across[m] === "n/a" || Number(across[m].tip) === 100, JSON.stringify(across[m]));
  }

  // ── what the SERVER is asked for ──────────────────────────────────────────────────────
  const sent = await s.fr.evaluate(async () => {
    const out = { calls: [] };
    const real = window.LFH_OUTBOX.send.bind(window.LFH_OUTBOX);
    window.LFH_OUTBOX.send = async (o) => { out.calls.push({ path: o.path, body: JSON.parse(JSON.stringify(o.body || {})) }); return { ok: true }; };
    document.querySelector(".sb-go").click();
    await new Promise((r) => setTimeout(r, 1500));
    window.LFH_OUTBOX.send = real;
    return out;
  });
  const split = sent.calls.find((c) => /pay-split/.test(c.path));
  const tipCall = sent.calls.find((c) => /tip/.test(c.path));
  C("Collect posts the split to the one route that carries a pay-later part", !!split, sent.calls.map((c) => c.path).join(" · ") || "(nothing sent)");
  C("…and the parts it sends add up to the BILL, never bill+tip", !!split && Math.abs(split.body.splits.reduce((a, l) => a + Number(l.amount), 0) - due) < 0.02, split ? split.body.splits.map((l) => l.amount).join(" + ") : "");
  C("…and no part carries a tip of its own — one tip for the table", !!split && split.body.splits.every((l) => !("tip" in l)), split ? JSON.stringify(split.body.splits[0]) : "");
  C("the tip is recorded as its own thing", !!tipCall, tipCall ? tipCall.path : "(no tip call)");
  C("…once, not once per part", sent.calls.filter((c) => /tip/.test(c.path)).length <= 1, `${sent.calls.filter((c) => /tip/.test(c.path)).length} tip calls`);
  C("…and it is the figure that was typed", !tipCall || Math.abs(Number(tipCall.body.tip ?? tipCall.body.amount ?? 0) - 100) < 0.02, JSON.stringify(tipCall ? tipCall.body : {}));

  C("no uncaught page error across the tip walk", s.errs.length === 0, s.errs.join(" | ").slice(0, 200));
  C("no leaked code text on the split screen", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block B completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("B") ? 1 : 0; }
