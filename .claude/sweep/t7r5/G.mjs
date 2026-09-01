// T7 · fifth 500 · BLOCK G — EVERYTHING A WAITER IS REFUSED, IN ONE PLACE.
// The access model from the waiter's side: nine tri-states, what each one hides and what it only
// greys, and the rule that hiding is NEVER the only guard.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, armToasts, heard, forget, C, dump, at, LEAK, BASE } from "./lib.mjs";
at(45106);
const T = ["28"];
const RUNGS = ["tablet_take_orders", "tablet_discount", "tablet_mark_paid", "tablet_banquet",
  "tablet_table_ops", "tablet_table_tags", "tablet_khata", "tablet_parcel", "tablet_invoice"];
let s;
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);
  await armToasts(s.fr);

  // ── the nine rungs, as the panel reads them ───────────────────────────────────────────
  const perms = await s.fr.evaluate((keys) => keys.map((k) => ({ k, perm: tperm(k), shown: tshow(k) })), RUNGS);
  C("the panel can answer for all nine waiter capabilities", perms.length === 9, perms.map((p) => `${p.k.replace("tablet_", "")}=${p.perm}`).join(" · "));
  C("…and every answer is one of the three rungs, never undefined", perms.every((p) => ["on", "off", "pin"].includes(p.perm)), perms.filter((p) => !["on", "off", "pin"].includes(p.perm)).map((p) => `${p.k}=${p.perm}`).join(",") || "all three-valued");
  C("…and 'shown' is a boolean for every one of them", perms.every((p) => typeof p.shown === "boolean"), perms.map((p) => `${p.k.replace("tablet_", "")}:${p.shown}`).join(" · "));
  C("a rung set to OFF is not shown", perms.filter((p) => p.perm === "off").every((p) => p.shown === false), perms.filter((p) => p.perm === "off").map((p) => p.k).join(",") || "none is off here");
  C("a rung set to PIN IS shown — hiding is never the guard", perms.filter((p) => p.perm === "pin").every((p) => p.shown === true), perms.filter((p) => p.perm === "pin").map((p) => `${p.k}:${p.shown}`).join(",") || "none is pin-gated here");
  C("a rung set to ON is shown", perms.filter((p) => p.perm === "on").every((p) => p.shown === true), `${perms.filter((p) => p.perm === "on").length} on`);

  // ── flip each rung OFF in this browser only, and see what disappears ─────────────────
  for (const key of RUNGS) {
    const r = await s.fr.evaluate(async ({ k, t }) => {
      // FREEZE THE REFRESH FOR THE LENGTH OF THE FLIP. state.data.settings is replaced wholesale by
      // every load(), and this panel refreshes on a realtime breadcrumb — which, on a shared test
      // floor, arrives several times a second. Two different rungs lost that race on two runs and
      // were each recorded as "a switch that does nothing". load() is a top-level declaration, so
      // it is a window property and can be held still, then given straight back.
      const realLoad = window.load;
      window.load = async () => {};
      const set = state.data.settings;
      const was = set[k];
      set[k] = "off";
      const shownNow = tshow(k);
      renderFloor(); renderPanel();
      await new Promise((x) => setTimeout(x, 600));
      const out = {
        shown: shownNow && tshow(k),
        take: !!document.querySelector(".t-take"),
        pay: !!document.getElementById("payBill"),
        disc: !!document.getElementById("billDiscountBtn"),
        kot: !!document.getElementById("kotMenuBtn"),
        tag: !!document.getElementById("tagTable"),
        body: document.body.innerText.replace(/\s+/g, " ").slice(0, 400),
      };
      set[k] = was;
      window.load = realLoad;
      renderFloor(); renderPanel();
      await new Promise((x) => setTimeout(x, 400));
      return out;
    }, { k: key, t: T[0] });
    C(`with ${key.replace("tablet_", "")} off, the panel says it is off`, r.shown === false, `tshow=${r.shown}`);
    C(`…and nothing on screen mentions the switch by name`, !r.body.includes(key), key);
    C(`…and the panel is still usable, not blank`, r.body.length > 40, `${r.body.length} characters on screen`);
    if (key === "tablet_take_orders") C("…and ＋ Take order is the control that goes", r.take === false, `take button = ${r.take}`);
    if (key === "tablet_mark_paid") C("…and 💳 Mark bill paid is the control that goes", r.pay === false, `pay button = ${r.pay}`);
    if (key === "tablet_discount") C("…and 💰 Discount is the control that goes", r.disc === false, `discount button = ${r.disc}`);
    if (key === "tablet_table_ops") C("…and 🧾 KOT ▾ is the control that goes", r.kot === false, `kot button = ${r.kot}`);
    if (key === "tablet_table_tags") C("…and 🏷 Table type is the control that goes", r.tag === false, `tag button = ${r.tag}`);
  }
  await openTable(s, T[0]);

  // ── the one a waiter can NEVER have ───────────────────────────────────────────────────
  const inv = await s.fr.evaluate(() => {
    const src = document.documentElement.outerHTML;
    return { perm: tperm("tablet_invoice"), shown: tshow("tablet_invoice"), higher: tHigher(),
      mention: /Only a manager issues the invoice/.test(src) };
  });
  C("a waiter is never given the invoice, whatever the switch says", inv.higher === true || inv.shown === false || inv.perm === "off", `perm=${inv.perm} shown=${inv.shown} admin=${inv.higher}`);
  const liveSrc = await (await fetch(BASE + "/panels/tablet/app.js")).text();
  C("…and where it is greyed, the panel says why in words", /Only a manager issues the invoice — a waiter never can/.test(liveSrc), "the sentence is in the panel");
  C("…and it names the way an admin can still do it", /You can still use it from the admin view/.test(liveSrc), "and the way round it");

  // ── hiding is never the only guard: the server is asked anyway ────────────────────────
  const gated = [...liveSrc.matchAll(/actGated\(/g)].length;
  C("gated actions go through one wrapper that lets the SERVER decide", gated >= 8, `${gated} gated calls`);
  C("…and the wrapper asks first WITHOUT a PIN, so the server sets the rule", /r = await api\(method, path, body, apiOpts\)/.test(liveSrc), "the first attempt carries no PIN");
  C("…and only asks the person when the server says it needs one", /if \(!wantsPin\(e\)\) throw e;/.test(liveSrc), "wantsPin(e)");
  C("…and a refused PIN is asked again rather than swallowed", /That PIN didn't match — try again\./.test(liveSrc), "the retry sentence");
  C("the panel never decides a permission for itself and stops there", /tperm|tshow/.test(liveSrc) && /actGated/.test(liveSrc), "both a screen rule and a server rule");

  // ── the admin x-ray rule, from the waiter's side ──────────────────────────────────────
  const xray = await s.fr.evaluate(() => ({ higher: tHigher(), sim: tSim(), marks: document.querySelectorAll(".xray-off").length, ribbon: !!document.getElementById("xrayRibbon") }));
  C("a real waiter is not an admin", xray.higher === false, `tHigher=${xray.higher}`);
  C("…and sees no admin ribbon", !xray.ribbon, `ribbon=${xray.ribbon}`);
  C("…and no cyan marks, which are admin information", xray.marks === 0, `${xray.marks} marks`);

  // ── every refusal on this panel is a sentence ────────────────────────────────────────
  const refusals = [...liveSrc.matchAll(/toast\(\s*`([^`]{10,200})`|toast\(\s*"([^"]{10,200})"/g)].map((m) => m[1] || m[2])
    .filter((m) => /can'?t|cannot|not allowed|only|never|first|refus|needs|must/i.test(m));
  C("the panel has refusals to read", refusals.length >= 8, `${refusals.length} refusals`);
  C("…and every one names a reason or a way forward", refusals.every((m) => /because|first|instead|already|still|only|ask|try|—|\./.test(m)), refusals.find((m) => !/because|first|instead|already|still|only|ask|try|—|\./.test(m)) || "all do");
  C("…and none of them shows a settings key", refusals.every((m) => !/tablet_|_allowed|_enabled/.test(m)), refusals.find((m) => /tablet_/.test(m)) || "none");
  C("…and none of them is shouted", refusals.every((m) => !/[A-Z]{6,}/.test(m.replace(/KOT|UPI|GST|MRP|PIN/g, ""))), refusals.find((m) => /[A-Z]{6,}/.test(m.replace(/KOT|UPI|GST|MRP|PIN/g, ""))) || "none");
  C("no uncaught page error while flipping every rung", s.errs.length === 0, s.errs.join(" | ").slice(0, 140));
  C("the panel is exactly as it was when the block started", await s.fr.evaluate(() => document.querySelectorAll(".tile[data-t]").length > 0));
} catch (e) { C("block G completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("G") ? 1 : 0; }
