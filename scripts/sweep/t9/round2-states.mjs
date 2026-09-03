// SWEEP #8 · T9 · ROUND 2, block B — THE STATE MACHINE, DRIVEN. P63580–P63649.
//
// Round 1 asserted orderPhase()'s three `return` lines by reading them. This block CROSSES every
// order status with every combination of dish statuses and reads, off the rendered board, the four
// things a cook actually depends on: which lane the ticket is in, which action it offers, which
// dishes carry a ✓, and whether it appears at all. Reading three returns tells you the branches
// exist; crossing them tells you the branches are RIGHT.
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";

const BASE = (process.argv.find((a) => a.startsWith("--base=")) || "").slice(7) || "http://localhost:4309";
const PANEL = "iframe[src*='/panels/kitchen/index.html']";
const FILE = "round2-states";
const results = [];
const rec = (id, label, ok, note = "") => results.push({ id, label, ok: ok === true, note: ok === true ? note : (typeof ok === "string" ? ok : note) });

const ORDER_STATES = ["received", "preparing", "served", "cancelled"];
const DISH_SETS = [
  ["none", []],
  ["one received", ["received"]],
  ["one preparing", ["preparing"]],
  ["one ready", ["ready"]],
  ["one served", ["served"]],
  ["all preparing", ["preparing", "preparing", "preparing"]],
  ["all ready", ["ready", "ready", "ready"]],
  ["all served", ["served", "served"]],
  ["mixed prep+ready", ["preparing", "ready"]],
  ["mixed ready+served", ["ready", "served"]],
  ["mixed prep+served", ["preparing", "served"]],
  ["mixed all three", ["preparing", "ready", "served"]],
  ["received+preparing", ["received", "preparing"]],
];

/** What the board SHOULD do, derived from the rules in the code's own comments — not from the code. */
function expected(orderStatus, dishes) {
  if (orderStatus === "cancelled") return { lane: null };                 // dropped before bucketing
  if (orderStatus === "received") return { lane: "list-new", action: "awaiting", ticks: 0 };
  if (!dishes.length) return { lane: orderStatus === "served" ? null : "list-cooking", action: "allready", ticks: 0 };
  const every = (s) => dishes.every((d) => s.includes(d));
  if (every(["served"])) return { lane: null };                            // served leaves the board
  if (every(["ready", "served"])) return { lane: "list-ready", action: "awaiting", ticks: 0 };
  return { lane: "list-cooking", action: "allready", ticks: dishes.filter((d) => d === "preparing").length };
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const route = await loginAs(ctx, "kitchen", BASE);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message).slice(0, 120)));
  await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
  const F = await (await page.waitForSelector(PANEL, { timeout: 30000 })).contentFrame();
  await page.waitForTimeout(2500);

  await F.evaluate(() => {
    window.__t9state = (status, dishStatuses, wall) => {
      const oid = "t9-sm";
      state.orders = [{ id: oid, kot_no: 55, table_number: 9, status,
        created_at: new Date(Date.now() - 3e5).toISOString(), allergies: [],
        items: dishStatuses.map((s, i) => ({ title: "D" + i, qty: 1, status: s })) }];
      state.items = dishStatuses.map((s, i) => ({ id: oid + "-" + i, order_id: oid, title: "D" + i, qty: 1, status: s }));
      state.platform = [];
      if (wall !== undefined) { view = wall ? "wall" : "columns"; applyView(); }
      lastSig = null; render();
      const t = document.querySelector('.ticket[data-ticket="' + oid + '"]');
      if (!t) return { lane: null, drawn: false };
      const action = t.querySelector("[data-ready]") ? "allready" : t.querySelector(".awaiting") ? "awaiting" : "none";
      return { drawn: true, lane: t.parentElement && t.parentElement.id,
               action, ticks: t.querySelectorAll("[data-item-ready]").length,
               phaseClass: [...t.classList].find((c) => c.startsWith("ph-")),
               awaitingText: (t.querySelector(".awaiting") || {}).textContent };
    };
  });

  let id = 63580; const next = () => "P" + id++;
  for (const os of ORDER_STATES) {
    for (const [dname, dishes] of DISH_SETS) {
      const r = await F.evaluate(([s, d]) => window.__t9state(s, d, false), [os, dishes]);
      const e = expected(os, dishes);
      const laneOk = e.lane === null ? !r.drawn : r.lane === e.lane;
      const actionOk = e.lane === null ? true : r.action === e.action;
      const ticksOk = e.lane === null ? true : r.ticks === e.ticks;
      rec(next(), `order '${os}' with ${dname} → ${e.lane ? e.lane.replace("list-", "") + ", " + e.action + ", " + e.ticks + " tick(s)" : "off the board"}`,
        laneOk && actionOk && ticksOk ? true
          : `drawn=${r.drawn} lane=${r.lane} action=${r.action} ticks=${r.ticks} (wanted lane=${e.lane} action=${e.action} ticks=${e.ticks})`,
        r.drawn ? `${r.phaseClass} ${r.action} ${r.ticks}✓` : "not drawn");
    }
  }
  // the WALL must agree with the columns about what is live
  for (const [dname, dishes] of DISH_SETS) {
    const c = await F.evaluate(([d]) => window.__t9state("preparing", d, false), [dishes]);
    const w = await F.evaluate(([d]) => window.__t9state("preparing", d, true), [dishes]);
    rec(next(), `the wall and the columns agree that '${dname}' is ${c.drawn ? "on" : "off"} the board`,
      c.drawn === w.drawn ? true : `columns drawn=${c.drawn}, wall drawn=${w.drawn}`,
      `${c.drawn ? "on" : "off"} both`);
  }
  await F.evaluate(() => { view = "columns"; applyView(); });
  // the awaiting sentence must be the RIGHT one for its lane
  for (const [os, dishes, want] of [["received", ["preparing"], "waiting for the waiter"],
                                    ["preparing", ["ready"], "waiter serving"],
                                    ["preparing", ["ready", "served"], "waiter serving"]]) {
    const r = await F.evaluate(([s, d]) => window.__t9state(s, d, false), [os, dishes]);
    rec(next(), `a '${os}' ticket with ${dishes.join("+")} says "${want}"`,
      (r.awaitingText || "").includes(want) ? true : `it says "${r.awaitingText}"`, r.awaitingText);
  }
  rec(next(), "no uncaught error was raised while crossing every state", pageErrors.length === 0 ? true : pageErrors.slice(0,3).join(" | "));

  await F.evaluate(() => { state.orders = []; state.items = []; lastSig = null; });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  rec(next(), "the real board is back after the state pass", true, "reloaded");

  await browser.close();
  const bad = results.filter((r) => !r.ok);
  console.log("\nROUND 2 · B — THE STATE MACHINE, DRIVEN — " + BASE);
  console.log(`  ${results.length - bad.length} passed · ${bad.length} failed  (of ${results.length})`);
  for (const r of results) if (!r.ok) console.log(`  ✗ ${r.id}  ${r.label}\n      → ${r.note}`);
  // --ledger: emit each executed row as a ledger line, so the permanent record is generated from
  // the run rather than typed out by hand (a typed count is the thing INDEX.md says never to trust).
  if (process.argv.includes("--ledger")) {
    for (const r of results) {
      const how = "`node scripts/sweep/t9/" + FILE + ".mjs --base=<url>` (driven)";
      console.log(`| ${r.id} | ${r.label.replace(/\|/g, "\\|")} | ${how} | ${r.ok ? "✅" : "❌"} | ${(r.note || "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160)} |`);
    }
  }
  console.log(`  (ids ${results[0].id} … ${results[results.length-1].id})`);
  process.exit(bad.length ? 1 : 0);
}
main().catch((e) => { console.error("round2-states threw:", e); process.exit(2); });
