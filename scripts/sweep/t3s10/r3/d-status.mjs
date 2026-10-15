// Round 3 · D — THE ORDER-STATUS RULES, EXHAUSTIVELY FOR SMALL LISTS (lib/orderStatus.ts, the real file).
//
// Every list of up to three orders over every status × age band × dismissed × hidden, against the rules
// in plain words: nothing dismissed or older than three hours shows; nothing that should show is lost;
// unfinished above finished; newest first inside each; the red dot means "a hidden order is still
// cooking". And what a phone's storage can really hold: a corrupted list, an unknown status, a missing
// time — the strip and the bill must survive all of it.
import { check, real } from "./h.mjs";
import { phone } from "../phone.mjs";

const ST = ["received", "preparing", "served", "cancelled"];
const NOW = 1_800_000_000_000, H = 3_600_000;
const AGES = [0, 60_000, 3 * H - 1, 3 * H + 1];
function* orders() { let n = 0; for (const status of ST) for (const age of AGES) for (const dismissed of [false, true]) for (const stripHidden of [false, true]) yield { id: "o" + n++, tableNumber: "4", total: 1, itemCount: 1, status, placedAt: NOW - age, dismissed, stripHidden }; }
const ALL = [...orders()];   // 64 distinct orders
const fin = (s) => s === "served" || s === "cancelled";
async function S() { const P = await phone(); try { return { M: await real("lib/orderStatus.ts"), P }; } catch (e) { P.restore(); throw e; } }

check("R3-D01", "D", "every list of 1–2 orders from 64 kinds (4,096 lists): exactly the right orders show, in the right order", async () => {
  const { M, P } = await S(); try {
    let bad = 0, n = 0, ex = "";
    const lists = [...ALL.map((a) => [a]), ...ALL.flatMap((a) => ALL.filter((b) => b !== a).map((b) => [a, { ...b, id: b.id + "b" }]))];
    for (const l of lists) {
      n++; const out = M.liveActiveOrders(l, NOW);
      const want = l.filter((o) => !o.dismissed && NOW - o.placedAt <= 3 * H);
      const order = out.every((o, i) => i === 0 || (fin(out[i - 1].status) ? fin(o.status) && out[i - 1].placedAt >= o.placedAt : (fin(o.status) || out[i - 1].placedAt >= o.placedAt)));
      if (out.length !== want.length || !want.every((w) => out.includes(w)) || !order) { bad++; ex ||= JSON.stringify(l.map((o) => [o.status, o.placedAt - NOW, o.dismissed])); }
    }
    return { ok: bad === 0, note: bad ? `${bad} wrong, e.g. ${ex.slice(0, 120)}` : `${n} lists` };
  } finally { P.restore(); }
});
check("R3-D02", "D", "the red dot lights exactly when a hidden order that still shows is still cooking (every 1–2 order list)", async () => {
  const { M, P } = await S(); try {
    let bad = 0, n = 0;
    for (const a of ALL) for (const b of ALL) { n++; const l = [a, { ...b, id: b.id + "b" }]; const want = l.some((o) => !o.dismissed && NOW - o.placedAt <= 3 * H && o.stripHidden && !fin(o.status)); if (M.hasHiddenLiveOrder(l, NOW) !== want) bad++; }
    return { ok: bad === 0, note: `${n} lists · ${bad} wrong` };
  } finally { P.restore(); }
});
check("R3-D03", "D", "exactly three hours old still shows; a millisecond over does not (the edge, both sides)", async () => {
  const { M, P } = await S(); try {
    const a = M.liveActiveOrders([{ ...ALL[0], placedAt: NOW - 3 * H, dismissed: false }], NOW).length, b = M.liveActiveOrders([{ ...ALL[0], placedAt: NOW - 3 * H - 1, dismissed: false }], NOW).length;
    return { ok: a === 1 && b === 0, note: `at 3h: ${a} · at 3h+1ms: ${b}` };
  } finally { P.restore(); }
});
check("R3-D04", "D", "a CORRUPTED saved list never throws: null, numbers, text, arrays and half-orders inside it are left out", async () => {
  const { M, P } = await S(); try {
    const junk = [null, 5, "x", [], {}, { id: 7 }, { id: "ok1", status: "preparing", placedAt: NOW - 1000, tableNumber: "4", total: 1, itemCount: 1 }, { id: "ok2", placedAt: "soon", status: "served" }, { id: "ok3", status: "weird", placedAt: NOW }];
    P.ls.setItem("lfh_active_orders:french-house", JSON.stringify(junk));
    let read, live, dot, err = "";
    try { read = M.readActiveOrders(); live = M.liveActiveOrders(read, NOW); dot = M.hasHiddenLiveOrder(read, NOW); } catch (e) { err = String(e).slice(0, 100); }
    const ids = (live || []).map((o) => o.id);
    return { ok: !err && Array.isArray(live) && ids.includes("ok1") && live.every((o) => o && typeof o.id === "string" && ["received", "preparing", "served", "cancelled"].includes(o.status) && Number.isFinite(o.placedAt)) && dot === false,
      note: err || `kept ${JSON.stringify(ids)}` };
  } finally { P.restore(); }
});
check("R3-D05", "D", "a saved list that is not a list at all (an object, text, broken JSON) reads as no orders", async () => {
  const { M, P } = await S(); try {
    const out = [];
    for (const raw of ['{"a":1}', '"x"', "{", "null", "5", ""]) { P.ls.setItem("lfh_active_orders:french-house", raw); let r; try { r = M.readActiveOrders(); } catch { r = "THREW"; } out.push(Array.isArray(r) && r.length === 0); }
    return { ok: out.every(Boolean), note: out.map((x) => (x ? "·" : "✗")).join("") };
  } finally { P.restore(); }
});
check("R3-D06", "D", "writing and reading back is the same list, and one restaurant's orders never show at another", async () => {
  const { M, P } = await S(); try {
    const l = ALL.slice(0, 5); M.writeActiveOrders(l); const back = M.readActiveOrders();
    P.win.location.pathname = "/r/aangan-garden-restaurant/menu"; const there = M.readActiveOrders();
    return { ok: JSON.stringify(back) === JSON.stringify(l) && there.length === 0, note: `${back.length} back · ${there.length} at the other restaurant` };
  } finally { P.restore(); }
});
check("R3-D07", "D", "every status has a label, a line and an icon, and the steps are the three a diner sees in order", async () => {
  const { M, P } = await S(); try {
    const ok = ST.every((s) => M.STATUS_COPY[s] && M.STATUS_COPY[s].label && M.STATUS_COPY[s].sub && /^fa-/.test(M.STATUS_COPY[s].icon)) && JSON.stringify(M.STEPS) === JSON.stringify(["received", "preparing", "served"]);
    return { ok, note: ST.map((s) => M.STATUS_COPY[s]?.label).join(" / ") };
  } finally { P.restore(); }
});
check("R3-D08", "D", "the timing constants mean what the screens say: 60 s backstop, 5 s linger, 3 h follow", async () => {
  const { M, P } = await S(); try { return { ok: M.RT_BACKUP_MS === 60_000 && M.SERVED_LINGER_MS === 5_000 && M.MAX_AGE_MS === 3 * H, note: `${M.RT_BACKUP_MS} · ${M.SERVED_LINGER_MS} · ${M.MAX_AGE_MS}` }; } finally { P.restore(); }
});
