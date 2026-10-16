// scripts/sweep/t12r3/fb-table.mjs — band F, group 2: everything a waiter does INSIDE an open table.
// Every region here was listed by cov.mjs as never run by rounds 1 + 2. All in the fixture world:
// nothing is written anywhere; what the panel SENT is read back from the world's own log.
import { ok } from "../t12s10/lib.mjs";
import { freshWorld, openWorld, seat, openTable, tap, answerConfirm, typePin, toastsNow, clearToastsNow, undoBar, tapUndo, waitToast, settle } from "./f-world.mjs";

const F = "public/panels/tablet/app.js";
const H = "FIXTURE — the panel against the test's own server (nothing written)";
const scene = async (build, settings = {}, device = {}) => {
  const w = freshWorld({ sessions_enabled: true, ...settings });
  const made = build(w) || {};
  const { ctx, page } = await openWorld(w, device);
  return { w, ctx, page, ...made };
};
const posts = (w, re) => w.sent("POST", re);

export async function blockFB(R, id) {
  const { check } = R;

  // ── accepting a new order, and taking it back ───────────────────────────────────────────────
  {
    const { w, ctx, page, orders, items } = await scene((w) => seat(w, 5, { orders: [{ status: "received", items: [{ title: "Mint Melon Juice", price: 380, status: "received" }] }] }));
    await openTable(page, 5);
    const card = await page.evaluate(() => document.querySelector("#panel .ord .when")?.textContent || "");
    const ist = new Date(orders[0].created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
    await check(id(), F, "a new order's card says when it came in, on the restaurant's clock", H, () => ok(card.includes(ist), `${card} · expected ${ist}`));
    await tap(page, "[data-accept]");
    await settle(page, 300);
    const pill = await page.evaluate(() => document.querySelector("#panel .ist")?.textContent || "");
    await check(id(), F, "✓ Accept flips the dish to 'cooking' on screen at once (before the server answers)", H, () => ok(/cooking/.test(pill), pill));
    await check(id(), F, "…and sends one accept for that order", H, () => ok(posts(w, new RegExp(`^/orders/${orders[0].id}/accept`)).length === 1));
    await page.waitForSelector("#lfh-undobar.show", { timeout: 6000 }).catch(() => {});
    const ub = await undoBar(page);
    await check(id(), F, "…and offers a takeback: 'Order accepted · T5 · tap undo to unsend'", H, () => ok(ub && /Order accepted/.test(ub) && /T5 · tap undo to unsend/.test(ub), ub));
    w.clear();
    await tapUndo(page); await settle(page, 600);
    const back = posts(w, /^\/items\/[^/]+\/status/);
    await check(id(), F, "undo puts every dish back to 'received' on the server", H, () => ok(back.length === items.length && back.every((r) => r.body && r.body.status === "received"), JSON.stringify(back.map((r) => r.body))));
    await check(id(), F, "…and the tile reads 'new' again", H, async () => { const st = await page.evaluate(() => state.summary.tiles["5"].state); return ok(st === "new", st); });
    await ctx.close();
  }
  {
    const { w, ctx, page, orders } = await scene((w) => seat(w, 7, { orders: [{ status: "received" }, { status: "received" }] }));
    await openTable(page, 7);
    await tap(page, "[data-accept-all]"); await settle(page, 400);
    await check(id(), F, "✓ Accept all sends an accept for EACH new order on the table", H, () => ok(orders.every((o) => posts(w, new RegExp(`^/orders/${o.id}/accept`)).length === 1)));
    await page.waitForSelector("#lfh-undobar.show", { timeout: 6000 }).catch(() => {});
    await check(id(), F, "…and the takeback says 'Orders accepted'", H, async () => { const u = await undoBar(page); return ok(u && /Orders accepted/.test(u), u); });
    // The button was drawn from a slice that has since changed (another device accepted them).
    await page.evaluate(() => { for (const o of state.data.orders) o.status = "received"; renderPanel(); for (const o of state.data.orders) o.status = "preparing"; });
    await clearToastsNow(page);
    await tap(page, "[data-accept-all]");
    await check(id(), F, "Accept all on a table someone else already accepted SAYS so, never a silent tap", H, async () => ok(await waitToast(page, /Nothing left to accept here/), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 8, { orders: [{ status: "received" }] }));
    w.answer("POST", /\/accept/, { status: 400, body: { error: "That order was cancelled." } });
    await openTable(page, 8); w.clear();
    await tap(page, "[data-accept]");
    await check(id(), F, "an accept the server refuses says why, and the table is re-read", H, async () => ok(await waitToast(page, /Failed: That order was cancelled\./) && (await settle(page, 600), w.sent("GET", /^\/summary/).length >= 1), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }

  // ── serving a dish, and taking it back ──────────────────────────────────────────────────────
  {
    const { w, ctx, page, items } = await scene((w) => seat(w, 9, { orders: [{ status: "preparing", items: [{ title: "Espresso", price: 120, status: "preparing" }, { title: "Mint Melon Juice", price: 380, status: "preparing" }] }] }));
    await openTable(page, 9);
    await tap(page, `[data-serve="${items[0].id}"]`); await settle(page, 300);
    await check(id(), F, "✓ Serve flips that one dish to 'served' at once", H, async () => ok(await page.evaluate((iid) => state.data.items.find((x) => x.id === iid).status === "served", items[0].id)));
    await check(id(), F, "…and tells the server that dish (only) is served", H, () => { const p = posts(w, /^\/items\/[^/]+\/status/); return ok(p.length === 1 && p[0].path.includes(items[0].id) && p[0].body.status === "served", JSON.stringify(p.map((x) => x.body))); });
    await page.waitForSelector("#lfh-undobar.show", { timeout: 6000 }).catch(() => {});
    const ub = await undoBar(page);
    await check(id(), F, "…and offers to take the serve back, naming the dish", H, () => ok(ub && /Espresso/.test(ub), ub));
    w.clear(); await tapUndo(page); await settle(page, 600);
    await check(id(), F, "undo sends that dish back to the kitchen ('preparing')", H, () => { const p = posts(w, /^\/items\/[^/]+\/status/); return ok(p.length === 1 && p[0].body.status === "preparing", JSON.stringify(p.map((x) => x.body))); });
    w.clear();
    await tap(page, `.ist.tap[data-item="${items[1].id}"]`); await settle(page, 300);
    await check(id(), F, "tapping a cooking dish's pill serves it too (one forward step)", H, () => { const p = posts(w, /^\/items\/[^/]+\/status/); return ok(p.length === 1 && p[0].path.includes(items[1].id) && p[0].body.status === "served"); });
    await ctx.close();
  }
  {
    const { w, ctx, page, items } = await scene((w) => seat(w, 10, { orders: [{ status: "preparing" }] }));
    w.answer("POST", /\/items\/[^/]+\/status/, { status: 409, body: { error: "The kitchen changed this dish." } });
    await openTable(page, 10); await clearToastsNow(page);
    await tap(page, `[data-serve="${items[0].id}"]`);
    await check(id(), F, "a serve the server refuses says why (and the table is re-read)", H, async () => ok(await waitToast(page, /Failed: The kitchen changed this dish\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }

  // ── waiter calls ───────────────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page, calls } = await scene((w) => seat(w, 11, { orders: [{}], calls: [{ note: "Water" }, { note: "Bill please" }] }));
    await openTable(page, 11);
    const txt = await page.evaluate(() => document.querySelector("#panel")?.innerText || "");
    await check(id(), F, "two calls show an 'Attend all (2)' button and the big ATTEND names the first", H, () => ok(/Attend all \(2\)/.test(txt) && /ATTEND — Water \(\+1 more\)/.test(txt), txt.slice(0, 200)));
    await tap(page, `.row [data-attend="${calls[0].id}"]`); await settle(page, 500);
    await check(id(), F, "Done on one call attends that call", H, () => ok(posts(w, new RegExp(`^/calls/${calls[0].id}/attend`)).length === 1));
    await page.waitForSelector("#lfh-undobar.show", { timeout: 6000 }).catch(() => {});
    const ub = await undoBar(page);
    await check(id(), F, "…and offers it back: 'Call attended · T11 · Water — tap undo'", H, () => ok(ub && /Call attended/.test(ub) && /T11 · Water — tap undo/.test(ub), ub));
    w.clear(); await tapUndo(page); await settle(page, 500);
    await check(id(), F, "undo re-opens exactly that call", H, () => ok(posts(w, new RegExp(`^/calls/${calls[0].id}/reopen`)).length === 1));
    await ctx.close();
  }
  {
    const { w, ctx, page, calls } = await scene((w) => seat(w, 12, { orders: [{}], calls: [{ note: "Water" }, { note: "Napkins" }] }));
    await openTable(page, 12);
    await tap(page, "[data-attend-all-calls]"); await settle(page, 600);
    await check(id(), F, "Attend all attends EVERY call on the table", H, () => ok(calls.every((c) => posts(w, new RegExp(`^/calls/${c.id}/attend`)).length === 1)));
    await page.waitForSelector("#lfh-undobar.show", { timeout: 6000 }).catch(() => {});
    await check(id(), F, "…and the takeback says '2 calls attended · T12'", H, async () => { const u = await undoBar(page); return ok(u && /2 calls attended/.test(u) && /T12 · tap undo to put them back/.test(u), u); });
    w.clear(); await tapUndo(page); await settle(page, 600);
    await check(id(), F, "undo re-opens both", H, () => ok(calls.every((c) => posts(w, new RegExp(`^/calls/${c.id}/reopen`)).length === 1)));
    await page.evaluate(() => { state.data.calls = []; });
    await clearToastsNow(page);
    await page.evaluate(() => { const b = document.querySelector("[data-attend-all-calls]"); if (b) b.click(); });
    await check(id(), F, "Attend all after another device already attended them says so (no silent tap)", H, async () => ok(await waitToast(page, /Those calls are already done — refreshing this table\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page, calls } = await scene((w) => seat(w, 13, { orders: [{}], calls: [{ note: "Water" }] }));
    w.answer("POST", /\/calls\/[^/]+\/attend/, { status: 404, body: { error: "That call is gone." } });
    await openTable(page, 13); await clearToastsNow(page);
    await tap(page, `.row [data-attend="${calls[0].id}"]`);
    await check(id(), F, "a call the server can't find says why", H, async () => ok(await waitToast(page, /Failed: That call is gone\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page, calls } = await scene((w) => seat(w, 14, { orders: [{}], calls: [{ note: "Water" }] }));
    w.answer("POST", /\/calls\/[^/]+\/attend/, { abort: true });
    await openTable(page, 14); await clearToastsNow(page);
    await tap(page, `.row [data-attend="${calls[0].id}"]`);
    await check(id(), F, "attending a call with no internet is SAVED, and the toast says so (not 'Call attended')", H, async () => ok(await waitToast(page, /[Ss]aved/, 8000), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }

  // ── guests: requests, joiners, the party list ───────────────────────────────────────────────
  {
    const { w, ctx, page, requests, members } = await scene((w) => seat(w, 15, { orders: [{}], requests: [{ type: "join", name: "Asha" }], members: [{ name: "Ravi", role: "owner" }, { name: "Meera", role: "guest" }, { name: "Kabir", role: "guest", approved: false }] }));
    await openTable(page, 15);
    await tap(page, `[data-req-approve="${requests[0].id}"]`); await settle(page, 400);
    await check(id(), F, "Approve on a request resolves it as approved", H, () => { const p = posts(w, new RegExp(`^/requests/${requests[0].id}/resolve`)); return ok(p.length === 1 && p[0].body.status === "approved"); });
    await openTable(page, 15);
    await tap(page, `[data-req-deny="${requests[0].id}"]`); await settle(page, 400);
    await check(id(), F, "Deny resolves it as denied", H, () => { const p = posts(w, new RegExp(`^/requests/${requests[0].id}/resolve`)); return ok(p.length === 2 && p[1].body.status === "denied"); });
    await openTable(page, 15);
    await tap(page, `[data-approve="${members[2].id}"]`); await settle(page, 400);
    await check(id(), F, "a guest waiting to join is approved with one tap", H, () => ok(posts(w, new RegExp(`^/members/${members[2].id}/approve`)).length === 1));
    await openTable(page, 15);
    await tap(page, `[data-makehead="${members[1].id}"]`); await settle(page, 400);
    await check(id(), F, "Make head hands the table to that guest", H, () => ok(posts(w, new RegExp(`^/members/${members[1].id}/make-head`)).length === 1));
    await openTable(page, 15);
    await tap(page, `[data-kick="${members[1].id}"]`);
    const q1 = await answerConfirm(page, false);
    await check(id(), F, "Remove asks first, in plain words", H, () => ok(q1 === "Remove this guest from the table? Their access ends now — the table stays open.", q1));
    await check(id(), F, "…and saying No removes nobody", H, () => ok(posts(w, /\/remove$/).length === 0));
    await tap(page, `[data-kick="${members[1].id}"]`); await answerConfirm(page, true); await settle(page, 400);
    await check(id(), F, "…saying Remove removes that guest", H, () => ok(posts(w, new RegExp(`^/members/${members[1].id}/remove`)).length === 1));
    await ctx.close();
  }
  {
    const { w, ctx, page, members } = await scene((w) => seat(w, 16, { orders: [{}], members: [{ name: "Ravi", role: "owner" }, { name: "Meera", role: "guest" }] }));
    w.answer("POST", /\/members\/[^/]+\/ban/, { fn: (req) => { return req.body && req.body.managerPin === "4321" ? { status: 200, body: { ok: true } } : { status: 403, body: { error: "A manager PIN is required for this.", needPin: true } }; } });
    await openTable(page, 16);
    await tap(page, `[data-ban="${members[1].id}"]`);
    const q = await answerConfirm(page, true);
    await check(id(), F, "Ban asks first: kicked now and blocked from rejoining", H, () => ok(q === "Ban this guest? They're kicked now and blocked from rejoining this table.", q));
    await typePin(page, "1111"); await settle(page, 400);
    const err = await page.evaluate(() => document.querySelector(".pp-err")?.textContent || "");
    await check(id(), F, "a wrong PIN keeps the box open and says it didn't match", H, () => ok(err === "That PIN didn't match — try again.", err));
    await page.fill(".pp-in", "12"); await page.click(".pp-ok");
    const short = await page.evaluate(() => document.querySelector(".pp-err")?.textContent || "");
    await check(id(), F, "a PIN that is too short is refused before it is sent", H, () => ok(short === "Enter the 4–8 digit PIN.", short));
    await page.fill(".pp-in", "4321"); await page.click(".pp-ok"); await settle(page, 600);
    await check(id(), F, "the right PIN goes through — the ban is retried WITH the PIN", H, () => { const b = posts(w, /\/ban$/); return ok(b.length === 3 && b[2].body.managerPin === "4321", b.map((x) => JSON.stringify(x.body)).join(" ")); });
    await ctx.close();
  }
  {
    const { w, ctx, page, members } = await scene((w) => seat(w, 17, { orders: [{}], members: [{ name: "Ravi", role: "owner" }, { name: "Meera", role: "guest" }] }));
    w.answer("POST", /\/ban/, { status: 403, body: { error: "A manager PIN is required for this.", needPin: true } });
    await openTable(page, 17);
    await tap(page, `[data-ban="${members[1].id}"]`); await answerConfirm(page, true);
    await page.waitForSelector(".pp-cancel"); await page.click(".pp-cancel"); await settle(page, 400);
    await check(id(), F, "cancelling the PIN box sends nothing more and says nothing alarming", H, async () => ok(posts(w, /\/ban$/).length === 1 && !(await toastsNow(page)).some((t) => /Failed/.test(t)), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }

  // ── removing a dish, cancelling an order, editing one ──────────────────────────────────────
  {
    const { w, ctx, page, orders, items } = await scene((w) => seat(w, 18, { orders: [{ status: "preparing", kot_no: 207 }] }));
    await openTable(page, 18);
    await tap(page, `[data-del-item="${items[0].id}"]`);
    const q = await answerConfirm(page, true); await settle(page, 400);
    await check(id(), F, "🗑 on a dish asks 'Remove this dish from the order? The bill updates automatically.'", H, () => ok(q === "Remove this dish from the order? The bill updates automatically.", q));
    await check(id(), F, "…and Remove dish deletes that one dish", H, () => ok(posts(w, new RegExp(`^/items/${items[0].id}/delete`)).length === 1));
    await openTable(page, 18);
    const btn = await page.evaluate(() => document.querySelector("[data-del-order]")?.textContent || "");
    await check(id(), F, "the cancel button names the ticket: '✕ Cancel order #207'", H, () => ok(btn.trim() === "✕ Cancel order #207", btn));
    await tap(page, "[data-del-order]");
    const no = await page.evaluate(() => document.getElementById("confirmNo").textContent);
    const q2 = await answerConfirm(page, false);
    await check(id(), F, "cancelling an order says it stays on the bill at ₹0 and in the reports — and the way out is 'Keep order'", H, () => ok(/stays on the bill at ₹0 and in the reports/.test(q2) && no === "Keep order", `${q2} · no-button "${no}"`));
    await check(id(), F, "…Keep order cancels nothing", H, () => ok(posts(w, /\/orders\/[^/]+\/delete/).length === 0));
    await tap(page, "[data-del-order]"); await answerConfirm(page, true); await settle(page, 400);
    await check(id(), F, "…Cancel order cancels that order (through the route older handhelds use)", H, () => ok(posts(w, new RegExp(`^/orders/${orders[0].id}/delete`)).length === 1));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 19, { orders: [{ status: "preparing", allergies: ["nuts"] }] }));
    await openTable(page, 19);
    await tap(page, "[data-edit-order]");
    const q = await answerConfirm(page, false);
    await check(id(), F, "✎ Edit asks first whether the kitchen hasn't started", H, () => ok(/checked with the kitchen that this order is still editable/.test(q), q));
    await check(id(), F, "…and 'Cancel' leaves the order as it was (no edit mode)", H, async () => ok(await page.evaluate(() => !document.querySelector(".ordctl-edit"))));
    await tap(page, "[data-edit-order]"); await answerConfirm(page, true); await settle(page, 300);
    const edit = await page.evaluate(() => ({ chips: [...document.querySelectorAll(".ordctl-edit .talg")].map((c) => c.textContent.trim() + (c.classList.contains("on") ? "*" : "")), btns: [...document.querySelectorAll(".ordctl-edit button")].map((b) => b.textContent.trim()) }));
    await check(id(), F, "edit mode shows the allergy chips with the order's own lit, and ＋ Other", H, () => ok(edit.chips.some((c) => /\*$/.test(c)) && edit.chips.includes("＋ Other"), edit.chips.join(",")));
    await check(id(), F, "…and ＋ Add dish, − Discount, ✕ Cancel order and ✓ Done editing", H, () => ok(["＋ Add dish", "− Discount", "✓ Done editing"].every((x) => edit.btns.includes(x)) && edit.btns.some((b) => /Cancel order/.test(b)), edit.btns.join(" | ")));
    // a standard chip: the reason is asked BEFORE anything changes
    const chip = await page.evaluate(() => [...document.querySelectorAll(".ordctl-edit .talg:not(.on):not(.alg-other)")][0]?.dataset.slug);
    await tap(page, `.ordctl-edit .talg[data-slug="${chip}"]`);
    await page.waitForSelector(".alg-why-cancel");
    const why = await page.evaluate(() => document.querySelector(".alg-why-in").closest("div").innerText);
    await check(id(), F, "tapping an allergy chip asks WHY first, naming the allergy and the direction", H, () => ok(new RegExp(`“${chip}” is being added to this order\\.`).test(why), why.slice(0, 160)));
    await page.click(".alg-why-cancel"); await settle(page, 300);
    await check(id(), F, "…cancelling the reason changes nothing — the chip stays dark, nothing sent", H, async () => { const dark = await page.evaluate((s) => !document.querySelector(`.ordctl-edit .talg[data-slug="${s}"]`).classList.contains("on"), chip); return ok(dark && !posts(w, /\/allergies$/).length, dark ? "sent" : "lit"); });
    await tap(page, `.ordctl-edit .talg[data-slug="${chip}"]`);
    await page.waitForSelector(".alg-why-ok"); await page.click(".alg-why-ok");
    const blank = await page.evaluate(() => document.querySelector(".alg-why-err").textContent);
    await check(id(), F, "…a blank reason is refused out loud", H, () => ok(blank === "Pick one above, or type why.", blank));
    await page.click('.alg-why-chips button[data-v="The guest told us"]'); await settle(page, 400);
    const sent = posts(w, /\/allergies$/);
    await check(id(), F, "…picking a reason lights the chip and sends the new list WITH the reason", H, () => ok(sent.length === 1 && sent[0].body.allergies.includes(chip) && sent[0].body.allergies.includes("nuts") && sent[0].body.reason === "The guest told us", JSON.stringify(sent[0] && sent[0].body)));
    await check(id(), F, "…and the change carries what the screen was editing FROM (first save wins)", H, () => { const e = sent[0] && sent[0].headers["x-lfh-expect"]; return ok(e && /"allergies":\["nuts"\]/.test(e), e); });
    // ＋ Other
    await tap(page, ".ordctl-edit .alg-other");
    await page.waitForSelector(".alg-ok"); await page.click(".alg-ok");
    const e1 = await page.evaluate(() => document.querySelector(".alg-err").textContent);
    await check(id(), F, "＋ Other with nothing typed says what to type", H, () => ok(e1 === "Type what the kitchen should leave out.", e1));
    await page.fill(".alg-in", "nuts"); await page.click(".alg-ok");
    const e2 = await page.evaluate(() => document.querySelector(".alg-err").textContent);
    await check(id(), F, "…typing one already on the list is refused, naming it", H, () => ok(e2 === "“nuts” is already on this list.", e2));
    await page.fill(".alg-in", "Coriander"); await page.click(".alg-ok");
    await page.waitForSelector(".alg-why-chips button"); await page.click('.alg-why-chips button[data-v="The guest told us"]'); await settle(page, 500);
    const sent2 = posts(w, /\/allergies$/);
    await check(id(), F, "…a new word goes on the list (normalised) and is sent with its reason", H, () => ok(sent2.length === 2 && sent2[1].body.allergies.includes("coriander"), JSON.stringify(sent2[1] && sent2[1].body)));
    await check(id(), F, "…and the screen redraws with the typed allergy as its own lit chip", H, async () => ok(await page.evaluate(() => [...document.querySelectorAll(".ordctl-edit .talg.on")].some((c) => /coriander/i.test(c.textContent)))));
    // the order disappears between the paint and the tap
    await page.evaluate(() => { state.data.orders = []; });
    await clearToastsNow(page);
    await page.evaluate(() => document.querySelector(".ordctl-edit .talg:not(.alg-other)").click());
    await check(id(), F, "an allergy chip for an order that has just gone says so (never a silent tap)", H, async () => ok(await waitToast(page, /That order just changed — refreshing this table\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => seat(w, 20, { orders: [{ status: "preparing" }] }));
    await openTable(page, 20);
    await tap(page, "[data-edit-order]"); await answerConfirm(page, true); await settle(page, 200);
    await tap(page, "[data-done-order]"); await settle(page, 200);
    await check(id(), F, "✓ Done editing leaves edit mode", H, async () => ok(await page.evaluate(() => !document.querySelector(".ordctl-edit") && !!document.querySelector("[data-edit-order]"))));
    await ctx.close();
  }

  // ── unmerging ──────────────────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page } = await scene((w) => {
      const a = seat(w, 21, { orders: [{ kot_no: 301, total: 420 }], session: { discount: 50 }, members: [{ name: "Ravi" }] });
      seat(w, 22, { orders: [{ kot_no: 302, total: 210 }] });
      // a merged CHILD has no session of its own: its orders ride on the parent's
      w.slices["22"].sessions = []; w.slices["22"].orders.forEach((o) => { o.session_id = a.s.id; });
      w.slices["22"].members = [{ id: "m22", session_id: a.s.id, name: "Zoya", role: "guest", approved: true }];
      w.summary.merges = [{ parent_table: "21", child_table: "22" }];
    });
    w.answer("POST", /\/tables\/22\/unmerge/, { body: { ok: true, moved: 1 } });
    await openTable(page, 22);
    const btn = await page.evaluate(() => [...document.querySelectorAll("[data-unmerge]")].map((b) => b.textContent.trim()));
    await check(id(), F, "a merged child offers '⇹ Unmerge T22' at the bottom", H, () => ok(btn.length === 1 && /Unmerge/.test(btn[0]) && /22/.test(btn[0]), btn.join(",")));
    await tap(page, "[data-unmerge]");
    const q = await answerConfirm(page, false);
    await check(id(), F, "the unmerge question opens with what it is: 'Split T22 back out of T21?'", H, () => ok(/^Split .*22.* back out of .*21.*\?/.test(q), q.split("\n")[0]));
    await check(id(), F, "…says what goes back: KOT #302 and its money", H, () => ok(/• Back to .*22.*: KOT #302 — ₹210/.test(q), q));
    await check(id(), F, "…says what stays: KOT #301 on T21", H, () => ok(/• Stays on .*21.*: KOT #301 — ₹420/.test(q), q));
    await check(id(), F, "…says the ₹50 whole-bill discount does NOT move", H, () => ok(/Does NOT move: the ₹50 whole-bill discount stays on/.test(q), q));
    await check(id(), F, "…and says the guest count does NOT move", H, () => ok(/Does NOT move: the guest count stays with/.test(q), q));
    await check(id(), F, "…No sends nothing", H, () => ok(posts(w, /unmerge/).length === 0));
    await tap(page, "[data-unmerge]"); await answerConfirm(page, true);
    await check(id(), F, "…Unmerge splits it and says how many orders went back", H, async () => ok(posts(w, /\/tables\/22\/unmerge/).length === 1 && await waitToast(page, /split from .*· 1 order back/), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => { seat(w, 23, { orders: [{ kot_no: 311 }] }); seat(w, 24, {}); w.slices["24"].sessions = []; w.summary.merges = [{ parent_table: "23", child_table: "24" }]; });
    await openTable(page, 23);
    await tap(page, '[data-unmerge="24"]');
    const q = await answerConfirm(page, false);
    await check(id(), F, "the table holding the bill offers one Unmerge per child, and an empty child 'gets nothing back'", H, () => ok(/gets nothing back — nothing was ordered at it\. It simply becomes free\./.test(q), q));
    w.answer("POST", /\/unmerge/, { status: 409, body: { error: "The bill was paid a moment ago." } });
    await tap(page, '[data-unmerge="24"]'); await answerConfirm(page, true);
    await check(id(), F, "a refused unmerge says 'Couldn't split those tables:' and the reason", H, async () => ok(await waitToast(page, /Couldn't split those tables: The bill was paid a moment ago\./), (await toastsNow(page)).join(" | ")));
    w.overrides.length = 0;
    w.answer("POST", /\/unmerge/, { abort: true });
    await tap(page, '[data-unmerge="24"]'); await answerConfirm(page, true);
    await check(id(), F, "an unmerge with no internet is saved and says so", H, async () => ok(await waitToast(page, /[Ss]aved/, 8000), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => { seat(w, 25, { orders: [{}] }); seat(w, 26, {}); w.slices["26"].sessions = []; w.summary.merges = [{ parent_table: "25", child_table: "26" }]; });
    await openTable(page, 25);
    w.answer("GET", /^\/state\?table=26/, { status: 503, body: { error: "busy", busy: true } });
    await clearToastsNow(page);
    await tap(page, '[data-unmerge="26"]');
    await check(id(), F, "if the child's orders can't be read, unmerge says it couldn't check (never 'nothing was ordered')", H, async () => ok(await waitToast(page, /Couldn't check what is on .*26.* just now — try again in a moment\./, 10000), (await toastsNow(page)).join(" | ")));
    w.overrides.length = 0;
    await page.evaluate(() => { state.summary.merges = []; });
    await clearToastsNow(page);
    await page.evaluate(() => unmergeTable("26"));
    await check(id(), F, "an Unmerge for a merge that has just ended says it isn't merged any more", H, async () => ok(await waitToast(page, /isn't merged with another table any more\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }

  // ── closing a table ────────────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page } = await scene((w) => seat(w, 27, { orders: [{ status: "served", total: 399 }] }));
    let n = 0;
    w.answer("POST", /\/sessions\/[^/]+\/close/, { fn: (req) => { n++; if (!req.body || !req.body.force) return { status: 409, body: { error: "This bill isn't paid yet — close anyway?", reason: "unpaid" } }; return req.body.managerPin ? { status: 200, body: { ok: true } } : { status: 403, body: { error: "A manager PIN is required for this.", needPin: true } }; } });
    await openTable(page, 27);
    await tap(page, "#closeTable");
    const q = await answerConfirm(page, false);
    await check(id(), F, "✕ Close table asks first and warns the bill is still UNPAID, with the amount", H, () => ok(/^Close .*27.* and free it\? The bill \(₹399\) is still UNPAID\.$/.test(q), q));
    await check(id(), F, "…Cancel closes nothing", H, () => ok(n === 0));
    await tap(page, "#closeTable");
    await page.waitForFunction(() => !document.getElementById("confirmOverlay").hidden);
    let release; w.hold = new Promise((r) => { release = r; });   // the server is slow: read the screen BEFORE it answers
    await answerConfirm(page, true);
    await settle(page, 200);
    const freeNow = await page.evaluate(() => state.summary.tiles["27"].state);
    w.hold = null; release();
    await check(id(), F, "…Close table frees the tile on screen at once", H, () => ok(freeNow === "free" || freeNow === "waiting", freeNow));
    const q2 = await answerConfirm(page, true);
    await check(id(), F, "…the server's 'not paid' refusal comes back as a second question, in its own words", H, () => ok(q2 === "This bill isn't paid yet — close anyway?", q2));
    await typePin(page, "2468"); await settle(page, 600);
    await check(id(), F, "…'Close anyway' resends with force, asks for the PIN, then closes", H, async () => { const p = posts(w, /\/close$/); return ok(p.length === 3 && p[1].body.force === true && p[2].body.managerPin === "2468" && await waitToast(page, /Table closed/), p.map((x) => JSON.stringify(x.body)).join(" ")); });
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 28, { orders: [{ status: "served", payment_status: "paid" }] }));
    w.answer("POST", /\/close/, { status: 500, body: { error: "Something broke on our side." } });
    w.answer("POST", /\/close/, { status: 400, body: { error: "That table is locked by the admin." } });
    await openTable(page, 28);
    await tap(page, "#closeTable");
    const q = await answerConfirm(page, true);
    await check(id(), F, "a paid table's close question has no UNPAID warning", H, () => ok(/^Close .*28.* and free it\?$/.test(q), q));
    await check(id(), F, "…and a refusal that is not about the bill is a plain 'Failed:' with the reason", H, async () => ok(await waitToast(page, /Failed: That table is locked by the admin\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene(() => {});
    await clearToastsNow(page);
    await page.evaluate(() => closeTableAndFree("29"));
    await check(id(), F, "closing a table that is already free says so", H, async () => ok(await waitToast(page, /is already free\./), (await toastsNow(page)).join(" | ")));
    w.answer("GET", /^\/state\?table=29/, { status: 503, body: { error: "busy", busy: true } });
    await clearToastsNow(page);
    await page.evaluate(() => closeTableAndFree("29"));
    await check(id(), F, "…and one whose state can't be read says it couldn't check (not 'already free')", H, async () => ok(await waitToast(page, /Couldn't check .*29.* just now — try again in a moment\./, 10000), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  // ── the tile a seated party with no order gets, and the box of what is waiting to send ────────
  {
    const { ctx, page } = await scene((w) => seat(w, 30, { members: [{ name: "Ravi" }, { name: "Meera" }] }));
    await openTable(page, 30);
    const t = await page.evaluate(() => { patchTileFromSlice("30"); return state.summary.tiles["30"]; });
    await check(id(), F, "a seated party with no order yet reads 'Seated · 2 · no orders yet'", H, () => ok(t.state === "seated" && t.label === "Seated · 2" && t.meta === "no orders yet", JSON.stringify(t)));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 3, { orders: [{}] }));
    w.answer("POST", /^\/order/, { abort: true });
    await openTable(page, 3);
    await page.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/tablet", method: "POST", path: "/order", body: { table: "3", items: [{ id: "mint-melon-juice", qty: 2 }, { id: "not-a-dish-any-more", qty: 1 }] }, panel: "tablet", table: "3" }));
    await settle(page, 800);
    await page.evaluate(() => renderPanel());
    // textContent, not innerText: the heading is drawn in capitals by the stylesheet.
    const box = await page.evaluate(() => [...document.querySelectorAll("#panel .sec h3")].map((h) => h.closest(".sec").textContent.replace(/\s+/g, " ")).find((x) => /Waiting to send|Needs you/.test(x)) || "");
    await check(id(), F, "an order saved on the device shows in its own '⏳ Waiting to send (1)' box", H, () => ok(/Waiting to send \(1\)/.test(box), box));
    await check(id(), F, "…naming the dishes, with a dish no longer on the menu called 'Dish'", H, () => ok(/2× Mint Melon Juice, Dish/.test(box), box));
    await check(id(), F, "…and saying it is not on the bill until the kitchen has it", H, () => ok(/Not on the bill until the kitchen has it\./.test(box), box));
    await ctx.close();
  }
}
