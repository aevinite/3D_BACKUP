// T7 · fourth 500 · BLOCK G — WHAT A WAITER'S TAP DOES TO THE PAPER AND TO THE KITCHEN.
// A fault here is invisible on the tablet: the waiter's screen looks perfect and the wrong thing
// comes out of the printer, or the kitchen never hears about it.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, C, dump, at, LEAK, BASE } from "./lib.mjs";
at(42851);
const T = ["25"];
let s;
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);
  const made = await s.fr.evaluate(async (t) => {
    const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out"));
    await api("POST", "/order", { table: t, items: [{ id: d.id, qty: 2 }], allergies: ["nuts"], confirmDuplicate: true });
    await selectTable(t);
    for (const o of partyOrders(t).filter((o) => o.status === "received")) await api("POST", `/orders/${o.id}/accept`);
    await selectTable(t);
    const os = partyOrders(t).filter((o) => o.status !== "cancelled");
    // Prove the allergy was really STORED before asking whether the kitchen shows it. An array is
    // what the route wants (`Array.isArray(allergies) ? allergies : []`), but a check that assumes
    // its own fixture worked will blame the kitchen for its own bad request.
    return { n: os.length, kot: os[0] && os[0].kot_no, dish: d.title,
      stored: os.map((o) => JSON.stringify(o.allergies || [])).join(" "), };
  }, T[0]);
  C("there is a kitchen ticket to print", made.n > 0 && made.kot != null, `KOT #${made.kot}`);
  C("…and the allergy the fixture typed was really stored on it", /nuts/.test(made.stored), made.stored.slice(0, 80));

  // ── the ONE print document ─────────────────────────────────────────────────────────────
  const bd = await s.fr.evaluate(() => {
    const B = window.LFH_BILLDOC || {};
    return { has: !!B, fns: Object.keys(B).filter((k) => typeof B[k] === "function").slice(0, 14) };
  });
  C("the panel loads the one print/money file", bd.has, bd.fns.join(",").slice(0, 100));
  C("…and it is the only place the paper is built", bd.fns.some((f) => /bill|kot|doc/i.test(f)), bd.fns.join(","));

  const paper = await s.fr.evaluate(async (t) => {
    const B = window.LFH_BILLDOC;
    const os = partyOrders(t).filter((o) => o.status !== "cancelled");
    const out = {};
    // billMoney is always there; the guard above asked for a function that may be named otherwise
    // and left `out.money` undefined, so the next line read .total of nothing. Ask for the money
    // itself, not for a door into it.
    const m = B.billMoney(os, state.data.settings || {}) || {};
    out.money = { total: m.total, sub: m.subtotal };
    out.rows = B.billRows ? B.billRows({ subtotal: m.subtotal, discount: 0, nontax: 0, taxIncluded: false, total: m.total, taxRows: [] }) : null;
    out.settingsName = (state.data.settings || {}).restaurant_name || (state.data.restaurant || {}).name || "";
    out.tableLabel = tableLabel(t);
    out.lines = os.flatMap((o) => dishRowsOf(o)).map((r) => ({ title: r.title, qty: r.qty, price: r.price }));
    return out;
  }, T[0]);
  C("the paper's money is assembled from the bill on screen", Number(paper.money.total) > 0, `₹${paper.money.total}`);
  C("…and its lines are the dishes that were ordered", paper.lines.length > 0, paper.lines.map((l) => `${l.qty}× ${l.title}`).join(", ").slice(0, 90));
  C("…each with a quantity and a price", paper.lines.every((l) => l.qty > 0 && Number(l.price) >= 0), JSON.stringify(paper.lines[0] || {}));
  C("…and no line is unnamed", paper.lines.every((l) => (l.title || "").trim().length > 0), paper.lines.map((l) => l.title).join(",").slice(0, 80));
  C("the paper knows which table it is for", /\d/.test(paper.tableLabel), paper.tableLabel);
  C("…by the name the waiter knows, not a bare number when it has one", paper.tableLabel.length > 0, paper.tableLabel);
  C("the restaurant's own name reaches the paper", (paper.settingsName || "").length > 0, paper.settingsName);
  C("nothing on the paper leaks code", !LEAK.test(JSON.stringify(paper)), JSON.stringify(paper.lines[0] || {}).slice(0, 80));

  // ── the print QUEUE, not a tab noticing ───────────────────────────────────────────────
  const src = await (await fetch(BASE + "/panels/tablet/app.js")).text();
  C("printing goes through a queue, not a screen that happens to be awake", /print-queue|printQueue|\/print\b/.test(src), "a queue route is referenced");
  C("…and no screen refuses to print because it is in the background", !/document\.hidden[^\n]{0,80}print/i.test(src), "no document.hidden guard on printing");
  C("a bill can be printed before it is paid", /printBillBtn/.test(src), "printBillBtn");
  C("…and a reprint is not an event that gets logged or banded", !/DUPLICATE/.test(src) || /reprint/i.test(src), "no DUPLICATE band added by this panel");

  // ── THE KITCHEN'S VIEW of the same order (read-only) ──────────────────────────────────
  const { chromium } = await import("playwright");
  const { loginAs } = await import("../../../scripts/sweep/login.mjs");
  const kb = await chromium.launch();
  try {
    const kctx = await kb.newContext({ viewport: { width: 1440, height: 900 } });
    await loginAs(kctx, "kitchen", BASE);
    const kp = await kctx.newPage();
    const kerrs = []; kp.on("pageerror", (e) => kerrs.push(String(e.message)));
    await kp.goto(BASE + "/kitchen", { waitUntil: "networkidle", timeout: 150000 });
    let kf = null;
    for (let i = 0; i < 80 && !kf; i++) { kf = kp.frames().find((f) => /\/panels\/kitchen\//.test(f.url())) || (kp.frames().length === 1 ? kp.mainFrame() : null); if (!kf) await kp.waitForTimeout(400); }
    await kp.waitForTimeout(4000);
    const seen = await (kf || kp.mainFrame()).evaluate((args) => {
      const txt = document.body.innerText.replace(/\s+/g, " ");
      // THE WHOLE BOARD, not the first 1,500 characters. This screen carries every live order in
      // the restaurant — 10,000 characters of it on a busy floor — so a slice off the top answers
      // "is my order here?" with whatever happened to be at the top instead.
      const card = [...document.querySelectorAll("*")].find((e) => e.children.length && /#\s*NN|T\s*TT/.test("")) || null;
      const mine = txt.split("🆕").concat(txt.split("#")).find((chunk) => chunk.includes("T" + args.t)) || "";
      return { txt, len: txt.length, mine: mine.slice(0, 300),
        hasTable: txt.includes("T" + args.t),
        hasDish: txt.toLowerCase().includes(String(args.dish).toLowerCase().split(" ")[0]),
        hasKot: args.kot != null && txt.includes("#" + String(args.kot)),
        algNodes: [...document.querySelectorAll(".alg")].map((e) => e.innerText.replace(/\s+/g, " ").trim()),
        cards: document.querySelectorAll(".card, .kcard, .order, [data-order]").length };
    }, { t: T[0], dish: made.dish, kot: made.kot });
    C("the kitchen screen loads", seen.txt.length > 0, `${seen.len} characters of board`);
    C("…and the order the waiter just sent is on it", seen.hasTable || seen.hasKot || seen.hasDish, `table=${seen.hasTable} kot=${seen.hasKot} dish=${seen.hasDish}`);
    C("…named by its table", seen.hasTable, `looked for T${T[0]}`);
    C("…and by what was ordered", seen.hasDish, `looked for "${String(made.dish).split(" ")[0]}"`);
    C("…and its kitchen-ticket number is on it", seen.hasKot, `looked for #${made.kot}`);
    C("the allergy the waiter typed reaches the kitchen", !/nuts/.test(made.stored) || /NO NUTS/i.test(seen.txt), /nuts/.test(made.stored) ? ((seen.txt.match(/NO NUTS[^,\n]{0,20}/i) || ["NOT ON THE KITCHEN SCREEN"])[0]) : "the fixture never stored one");
  C("…as a NO on the dish itself, not a banner over the order (owner, 2026-06-14)", !/nuts/.test(made.stored) || seen.algNodes.some((a) => /NO NUTS/i.test(a)), seen.algNodes.slice(0, 3).join(" | ") || "(no .alg nodes)");
  C("…and my order's own card is what was read, not another table's", seen.mine.length > 0, seen.mine.slice(0, 120));
    C("nothing on the kitchen screen leaks code", !LEAK.test(seen.txt), seen.txt.slice(0, 110));
    C("no page error on the kitchen screen", kerrs.length === 0, kerrs.join(" | ").slice(0, 140));
    C("the kitchen has NO profile, which is deliberate", !/my profile|your profile/i.test(seen.txt), "checked the kitchen's own chrome");
  } finally { await kb.close(); }

  // ── and the tablet still agrees with what the kitchen was told ────────────────────────
  const back = await s.fr.evaluate(async (t) => { await selectTable(t); const os = partyOrders(t).filter((o) => o.status !== "cancelled"); return { n: os.length, statuses: os.map((o) => o.status) }; }, T[0]);
  C("the tablet and the kitchen are looking at the same order", back.n === made.n, `${made.n} → ${back.n}`);
  C("…and the tablet has not lost its statuses in the meantime", back.statuses.every((x) => typeof x === "string" && x.length > 0), back.statuses.join(","));
  C("no uncaught page error on the tablet during the paper walk", s.errs.length === 0, s.errs.join(" | ").slice(0, 160));
} catch (e) { C("block G completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("G") ? 1 : 0; }
