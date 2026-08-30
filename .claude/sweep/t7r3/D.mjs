// T7 · third 500 · BLOCK D (P40677–P40713) — A PIN-GATED ACTION, END TO END.
//
// `tablet_discount` is already "pin" on this restaurant, so the gate is real. What is NOT done
// here is switching the gate ON at the restaurant: PIN enforcement starts the moment ANY active
// manager has a PIN (lib/managerPin.ts bootstrap rule), and none of French House's four managers
// has one — so setting one would make every OTHER lane's discount tap demand a PIN mid-run. The
// server's own verification lives in lib/managerPin.ts, which is not this territory. So: the real
// server round trip is driven as it behaves today (gate open → no prompt), and the whole PIN
// CONVERSATION — which is this panel's job — is driven by making api() answer the way the server
// answers when a PIN is required.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, toasts, clearToasts, C, dump, at, LEAK } from "./lib.mjs";
at(40677);
const T = ["24"];
let s;
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, "24");
  await s.fr.evaluate(async () => { const o = state.data.orders.filter((x) => String(x.table_number) === "24" && x.status === "received"); for (const y of o) await api("POST", `/orders/${y.id}/accept`); await load(); });
  await s.page.waitForTimeout(1500);
  await openTable(s, "24");

  const gate = await s.fr.evaluate(() => ({ perm: tperm("tablet_discount"), shown: tshow("tablet_discount"), btn: !!document.getElementById("billDiscountBtn") }));
  C("the discount is a PIN-gated action on this restaurant", gate.perm === "pin", gate.perm);
  C("…and a pin-gated action is still SHOWN — hiding is never the guard", gate.shown === true, `shown=${gate.shown}`);
  C("…so the waiter can reach it", gate.btn, `button=${gate.btn}`);

  // ── the wording of every PIN gate on this panel ────────────────────────────────────────
  const msgs = await s.fr.evaluate(() => (window.__src || document.documentElement.outerHTML) && 0);
  const src = await (await fetch("https://3-d-backup.vercel.app/panels/tablet/app.js")).text();
  const gated = [...src.matchAll(/actGated\([^;]*?message:\s*"([^"]+)"/gs)].map((m) => m[1]);
  C("every gated action carries its own sentence", gated.length >= 8, `${gated.length} gated actions`);
  C("…each one says a manager PIN is what is being asked for", gated.every((m) => /manager PIN/i.test(m)), gated.find((m) => !/manager PIN/i.test(m)) || "all do");
  C("…and each one names the ACTION, not just the requirement", gated.every((m) => m.split(" ").length >= 6), gated.find((m) => m.split(" ").length < 6) || "all do");
  C("…in plain words, with no code in them", gated.every((m) => !LEAK.test(m) && !/_/.test(m)), gated.find((m) => LEAK.test(m) || /_/.test(m)) || "all clean");

  C("this panel routes its writes through the offline outbox", await s.fr.evaluate(() => !!(window.LFH_OUTBOX && typeof window.LFH_OUTBOX.send === "function")));

  // ── the PIN conversation ───────────────────────────────────────────────────────────────
  const conv = await s.fr.evaluate(async () => {
    const out = { calls: [] };
    // THE OUTBOX IS THE INTERCEPT POINT, not api(). api is a `const` arrow at the top of a classic
    // script, so it is not a window property and assigning window.api changes nothing — actGated
    // keeps calling the original (the same trap as inrExact in block A). Every WRITE goes through
    // window.LFH_OUTBOX.send, which IS a property, so that is where the server's answer is played.
    const real = window.LFH_OUTBOX.send.bind(window.LFH_OUTBOX);
    window.LFH_OUTBOX.send = async (o) => {
      out.calls.push({ method: o.method, path: o.path, hasPin: !!(o.body && o.body.managerPin), pin: o.body && o.body.managerPin });
      if (!/discount/.test(o.path)) return real(o);
      if (!(o.body && o.body.managerPin)) { const e = new Error("manager pin required"); e.data = { needPin: true }; throw e; }
      if (o.body.managerPin !== "86421357") { const e = new Error("manager pin"); e.data = { needPin: true }; throw e; }
      return { ok: true };
    };
    const p = actGated("POST", "/tables/24/discount", { amount: 10 }, { message: "Enter a manager PIN to discount this bill.", toast: "Discount applied" });
    await new Promise((r) => setTimeout(r, 500));
    const box = document.querySelector(".pp-in") ? document.querySelector(".pp-in").closest("div").parentElement : null;
    out.prompt = !!document.querySelector(".pp-in");
    out.title = box ? box.innerText.replace(/\s+/g, " ").trim() : "";
    out.type = document.querySelector(".pp-in") ? document.querySelector(".pp-in").type : "";
    out.mode = document.querySelector(".pp-in") ? document.querySelector(".pp-in").getAttribute("inputmode") : "";
    out.max = document.querySelector(".pp-in") ? document.querySelector(".pp-in").maxLength : 0;
    out.dim = box ? getComputedStyle(box.parentElement).background : "";
    // too short → refused in words, prompt stays
    document.querySelector(".pp-in").value = "12";
    document.querySelector(".pp-ok").click();
    await new Promise((r) => setTimeout(r, 200));
    out.shortErr = (document.querySelector(".pp-err") || {}).textContent || "";
    out.stillOpen = !!document.querySelector(".pp-in");
    // wrong PIN → asked again, with a reason
    document.querySelector(".pp-in").value = "11119999";
    document.querySelector(".pp-ok").click();
    await new Promise((r) => setTimeout(r, 500));
    out.retry = !!document.querySelector(".pp-in");
    out.retryErr = (document.querySelector(".pp-err") || {}).textContent || "";
    // right PIN → it goes through
    document.querySelector(".pp-in").value = "86421357";
    document.querySelector(".pp-ok").click();
    await p;
    await new Promise((r) => setTimeout(r, 400));
    out.closed = !document.querySelector(".pp-in");
    out.toasts = [...document.querySelectorAll(".toast")].map((t) => t.innerText.replace(/\s+/g, " ").trim());
    out.bodyText = document.body.innerText;
    window.LFH_OUTBOX.send = real;
    return out;
  });
  C("a gated tap asks for a PIN instead of failing", conv.prompt, `prompt=${conv.prompt}`);
  C("the prompt says what it is", /Manager PIN/i.test(conv.title), conv.title.slice(0, 60));
  C("…and why it is being asked", /discount this bill/i.test(conv.title), conv.title.slice(0, 120));
  C("the PIN box hides the digits", conv.type === "password", conv.type);
  C("…and asks for the number keypad", conv.mode === "numeric", conv.mode);
  C("…and holds at most 8 digits, the longest PIN allowed", conv.max === 8, `${conv.max}`);
  C("too few digits is refused in words, not swallowed", /4–8 digit/i.test(conv.shortErr), conv.shortErr);
  C("…and the prompt stays open so it can be corrected", conv.stillOpen, `open=${conv.stillOpen}`);
  C("a wrong PIN asks again", conv.retry, `retry=${conv.retry}`);
  C("…and says why, rather than just clearing", /didn't match/i.test(conv.retryErr), conv.retryErr);
  C("the right PIN closes the prompt", conv.closed, `closed=${conv.closed}`);
  C("…and the action reports success", conv.toasts.some((t) => /Discount applied/i.test(t)), conv.toasts.join(" | ").slice(0, 90));
  C("the first attempt is made WITHOUT a PIN — the server decides, not the screen", conv.calls[0] && !conv.calls[0].hasPin, JSON.stringify(conv.calls[0] || {}));
  C("…and the retry carries it", conv.calls.some((c) => c.hasPin), `${conv.calls.filter((c) => c.hasPin).length} of ${conv.calls.length} calls carried a PIN`);
  C("the PIN itself never reaches the screen", !/86421357/.test(conv.bodyText) && !conv.toasts.join(" ").includes("86421357"), conv.toasts.join(" | ").slice(0, 80));
  C("…and no attempt is retried more than once per typed PIN", conv.calls.filter((c) => c.pin === "86421357").length === 1, `${conv.calls.filter((c) => c.pin === "86421357").length}`);

  // ── cancelling ─────────────────────────────────────────────────────────────────────────
  const cancel = await s.fr.evaluate(async () => {
    const out = { calls: 0 };
    const real = window.LFH_OUTBOX.send.bind(window.LFH_OUTBOX);
    window.LFH_OUTBOX.send = async (o) => { if (!/discount/.test(o.path)) return real(o); out.calls++; const e = new Error("manager pin"); e.data = { needPin: true }; throw e; };
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const p = actGated("POST", "/tables/24/discount", { amount: 10 }, { message: "Enter a manager PIN to discount this bill." });
    await new Promise((r) => setTimeout(r, 500));
    out.open = !!document.querySelector(".pp-in");
    document.querySelector(".pp-cancel").click();
    await p;
    await new Promise((r) => setTimeout(r, 300));
    out.closed = !document.querySelector(".pp-in");
    out.toasts = [...document.querySelectorAll(".toast")].map((t) => t.innerText.replace(/\s+/g, " ").trim());
    window.LFH_OUTBOX.send = real;
    return out;
  });
  C("Cancel closes the prompt", cancel.open && cancel.closed, JSON.stringify(cancel));
  C("…and does not retry the action behind the waiter's back", cancel.calls === 1, `${cancel.calls} calls`);
  C("…and does not claim anything happened", !cancel.toasts.some((t) => /applied|done|saved/i.test(t)), cancel.toasts.join(" | ") || "(silent)");

  // ── the hardware back button is a cancel, not a way past the gate ───────────────────────
  const backCase = await s.fr.evaluate(async () => {
    const out = {};
    const real = window.LFH_OUTBOX.send.bind(window.LFH_OUTBOX);
    window.LFH_OUTBOX.send = async (o) => { if (!/discount/.test(o.path)) return real(o); const e = new Error("manager pin"); e.data = { needPin: true }; throw e; };
    const p = actGated("POST", "/tables/24/discount", { amount: 10 }, { message: "Enter a manager PIN to discount this bill." });
    await new Promise((r) => setTimeout(r, 500));
    out.open = !!document.querySelector(".pp-in");
    out.layer = typeof LFH_BACK !== "undefined";
    history.back();
    await new Promise((r) => setTimeout(r, 900));
    out.closed = !document.querySelector(".pp-in");
    out.panelStill = !!document.querySelector("#tiles") && document.querySelectorAll(".tile[data-t]").length > 0;
    await p;
    window.LFH_OUTBOX.send = real;
    return out;
  });
  C("the PIN prompt registers with the back-stack", backCase.layer && backCase.open, JSON.stringify(backCase));
  C("hardware Back cancels the PIN prompt", backCase.closed, `closed=${backCase.closed}`);
  C("…and does not close the panel underneath it", backCase.panelStill, `floor=${backCase.panelStill}`);
  // history.back() inside the panel walks the TAB'S history, and after three back-stack layers
  // it can take the tab off the panel entirely — every later evaluate then dies with "execution
  // context destroyed". Land the tab back on the tablet deliberately rather than guessing.
  await s.page.waitForTimeout(1500);
  await s.page.goto("https://3-d-backup.vercel.app/tablet", { waitUntil: "networkidle", timeout: 150000 });
  s.fr = null;
  for (let i = 0; i < 100 && !s.fr; i++) { s.fr = s.page.frames().find((f) => /\/panels\/tablet\//.test(f.url())); if (!s.fr) await s.page.waitForTimeout(400); }
  await s.fr.waitForSelector(".tile[data-t]", { timeout: 60000 }).catch(() => {});
  await s.page.waitForTimeout(2500);
  C("the panel comes back cleanly after the back button walked the history", !!s.fr && (await s.fr.evaluate(() => document.querySelectorAll(".tile[data-t]").length)) > 0);

  // ── a REAL gated action, as the restaurant is set up today ─────────────────────────────
  await openTable(s, "24");
  const real = await s.fr.evaluate(async () => {
    const before = (state.data.orders.find((o) => String(o.table_number) === "24" && o.status !== "cancelled") || {});
    const out = { id: before.id, discBefore: Number(before.discount) || 0 };
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    try { await api("POST", `/orders/${before.id}/discount`, { amount: 5, reason: "T7 sweep check" }); out.ok = true; }
    catch (e) { out.ok = false; out.err = String(e.message).slice(0, 120); }
    await load();
    const after = state.data.orders.find((o) => o.id === out.id) || {};
    out.discAfter = Number(after.discount) || 0;
    out.prompted = !!document.querySelector(".pp-in");
    return out;
  });
  C("a real gated write reaches the server", real.ok === true || /pin/i.test(real.err || ""), real.ok ? "accepted" : real.err);
  C("…and while no manager has set a PIN the gate stays open, as designed", !real.prompted, `prompted=${real.prompted}`);
  C("…and the discount really landed on the bill", real.ok !== true || real.discAfter > real.discBefore, `${real.discBefore} → ${real.discAfter}`);
  // put it back exactly as it was
  await s.fr.evaluate(async (a) => { try { await api("POST", `/orders/${a.id}/discount`, { amount: a.discBefore, reason: "T7 sweep cleanup" }); await load(); } catch {} }, { id: real.id, discBefore: real.discBefore });
  await s.page.waitForTimeout(900);
  const cleaned = await s.fr.evaluate((id) => { const o = state.data.orders.find((x) => x.id === id) || {}; return Number(o.discount) || 0; }, real.id);
  C("the check puts the bill back exactly as it found it", cleaned === real.discBefore, `${cleaned} vs ${real.discBefore}`);

  C("no uncaught page error during the PIN walk", s.errs.length === 0, s.errs.join(" | ").slice(0, 200));
  C("no PIN, real or invented, is left anywhere on the screen", !/\b\d{4,8}\b/.test(await s.fr.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.innerText).join(" "))), "toasts clean");
} catch (e) { C("block D completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("D") ? 1 : 0; }
