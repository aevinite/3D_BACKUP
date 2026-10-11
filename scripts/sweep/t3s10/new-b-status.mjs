// Block B — lib/orderStatus.ts, the rules the floating strip and the Live-status tab share, CALLED in
// memory on the fake phone (its storage helpers are tenant-scoped, so the phone's address matters).
import { check, fresh } from "./lib.mjs";
import { phone } from "./phone.mjs";

const F = "lib/orderStatus.ts";
const HOW = "STUB — real lib/orderStatus.ts in memory";
async function S(fn, opts = {}) { const P = await phone(opts); try { return await fn(fresh("lib/orderStatus.ts", "client"), P); } finally { P.restore(); } }
const NOW = 1_800_000_000_000;
const O = (id, status, ageMin = 1, extra = {}) => ({ id, tableNumber: "4", total: 100, itemCount: 1, status, placedAt: NOW - ageMin * 60_000, ...extra });

check("P172160", F, "the three happy-path steps are received → preparing → served, in that order", HOW, () => S((M) => M.STEPS.join(">") === "received>preparing>served"));
check("P172161", F, "cancelled is OFF the happy path (not a step), so the step dots never light for it", HOW, () => S((M) => !M.STEPS.includes("cancelled")));
check("P172162", F, "every status has a headline, a sub-line and an icon — nothing renders blank", HOW, () => S((M) =>
  ["received", "preparing", "served", "cancelled"].every((s) => M.STATUS_COPY[s] && M.STATUS_COPY[s].label && M.STATUS_COPY[s].sub && /^fa-/.test(M.STATUS_COPY[s].icon))));
check("P172163", F, "received reads 'Awaiting accept' — the same word the per-dish pill uses", HOW, () => S((M) => M.STATUS_COPY.received.label === "Awaiting accept"));
check("P172164", F, "preparing says 'Preparing', never 'Cooking' (owner: COOKING IS NOT A THING THERE IS PREPARING)", HOW, () => S((M) => /^Preparing/.test(M.STATUS_COPY.preparing.label) && !/cook/i.test(JSON.stringify(M.STATUS_COPY))));
check("P172165", F, "a cancelled order tells the diner what to do (ask a member of staff)", HOW, () => S((M) => /staff/i.test(M.STATUS_COPY.cancelled.sub)));
check("P172166", F, "served and cancelled are final; received and preparing are not", HOW, () => S((M) =>
  M.isFinalStatus("served") && M.isFinalStatus("cancelled") && !M.isFinalStatus("received") && !M.isFinalStatus("preparing")));
check("P172167", F, "a staff-only 'ready' status is NOT treated as final (the dish has not reached the table)", HOW, () => S((M) => !M.isFinalStatus("ready")));
check("P172168", F, "a dismissed order drops off the live list", HOW, () => S((M) => M.liveActiveOrders([O("a", "received", 1, { dismissed: true })], NOW).length === 0));
check("P172169", F, "an order older than three hours drops off; one at 2h59 stays", HOW, () => S((M) =>
  M.liveActiveOrders([O("old", "received", 181), O("ok", "received", 179)], NOW).map((o) => o.id).join() === "ok"));
check("P172170", F, "a SERVED order stays on the live list (until the meal ends) — no timed disappearance", HOW, () => S((M) =>
  M.liveActiveOrders([O("s", "served", 30, { finalizedAt: NOW - 20 * 60_000 })], NOW).length === 1));
check("P172171", F, "a CANCELLED order stays on the live list too, so the diner can read why", HOW, () => S((M) =>
  M.liveActiveOrders([O("c", "cancelled", 30, { finalizedAt: NOW - 20 * 60_000 })], NOW).length === 1));
check("P172172", F, "what the kitchen still OWES sits above what has arrived (owner, 2026-09-20)", HOW, () => S((M) => {
  const ids = M.liveActiveOrders([O("served-new", "served", 1), O("waiting-old", "received", 20)], NOW).map((o) => o.id).join();
  return { ok: ids === "waiting-old,served-new", note: ids };
}));
check("P172173", F, "within the unfinished group, newest first", HOW, () => S((M) =>
  M.liveActiveOrders([O("p-old", "preparing", 20), O("r-new", "received", 2)], NOW).map((o) => o.id).join() === "r-new,p-old"));
check("P172174", F, "within the finished group, newest first", HOW, () => S((M) =>
  M.liveActiveOrders([O("s-old", "served", 40), O("c-new", "cancelled", 5)], NOW).map((o) => o.id).join() === "c-new,s-old"));
check("P172175", F, "an order moves exactly ONCE — down, when it is served — the rest keep their places", HOW, () => S((M) => {
  const before = [O("a", "received", 3), O("b", "received", 2), O("c", "received", 1)];
  const after = before.map((o) => (o.id === "b" ? { ...o, status: "served" } : o));
  const x = M.liveActiveOrders(before, NOW).map((o) => o.id).join(), y = M.liveActiveOrders(after, NOW).map((o) => o.id).join();
  return { ok: x === "c,b,a" && y === "c,a,b", note: `${x} → ${y}` };
}));
check("P172176", F, "the live list does not change the list it was given (it copies before sorting)", HOW, () => S((M) => {
  const list = [O("a", "served", 1), O("b", "received", 5)]; M.liveActiveOrders(list, NOW); return list[0].id === "a";
}));
check("P172177", F, "a hidden strip on a still-cooking order lights the red dot", HOW, () => S((M) => M.hasHiddenLiveOrder([O("a", "preparing", 1, { stripHidden: true })], NOW) === true));
check("P172178", F, "…but not for a SERVED order whose strip was hidden (nothing left to wait for)", HOW, () => S((M) => M.hasHiddenLiveOrder([O("a", "served", 1, { stripHidden: true })], NOW) === false));
check("P172179", F, "…nor for a visible strip", HOW, () => S((M) => M.hasHiddenLiveOrder([O("a", "preparing", 1)], NOW) === false));
check("P172180", F, "…nor for a hidden order that has aged out", HOW, () => S((M) => M.hasHiddenLiveOrder([O("a", "preparing", 200, { stripHidden: true })], NOW) === false));
check("P172181", F, "the tracked orders are read from THIS restaurant's own storage key", HOW, () => S((M, P) => {
  P.ls.setItem("lfh_active_orders:french-house", JSON.stringify([O("fh", "received")]));
  P.ls.setItem("lfh_active_orders:aangan-garden-restaurant", JSON.stringify([O("aa", "received")]));
  return M.readActiveOrders().map((o) => o.id).join() === "fh";
}));
check("P172182", F, "…and a tab on Aangan reads only Aangan's", HOW, () => S((M, P) => {
  P.ls.setItem("lfh_active_orders:french-house", JSON.stringify([O("fh", "received")]));
  P.ls.setItem("lfh_active_orders:aangan-garden-restaurant", JSON.stringify([O("aa", "received")]));
  return M.readActiveOrders().map((o) => o.id).join() === "aa";
}, { path: "/r/aangan-garden-restaurant/menu" }));
check("P172183", F, "corrupt saved text reads as an empty list, never a crash", HOW, () => S((M, P) => { P.ls.setItem("lfh_active_orders:french-house", "{not json"); return Array.isArray(M.readActiveOrders()) && M.readActiveOrders().length === 0; }));
check("P172184", F, "a saved non-list (an object, a number) reads as an empty list", HOW, () => S((M, P) => {
  P.ls.setItem("lfh_active_orders:french-house", JSON.stringify({ id: "x" })); const a = M.readActiveOrders().length;
  P.ls.setItem("lfh_active_orders:french-house", "5"); const b = M.readActiveOrders().length; return a === 0 && b === 0;
}));
check("P172185", F, "writing then reading round-trips the list exactly", HOW, () => S((M) => { const l = [O("a", "received"), O("b", "served")]; M.writeActiveOrders(l); return JSON.stringify(M.readActiveOrders()) === JSON.stringify(l); }));
check("P172186", F, "storage that refuses a write does not throw at the diner", HOW, () => S((M) => { M.writeActiveOrders([O("a", "received")]); return true; }, { lsFail: true }));
check("P172187", F, "the backup re-read is a full minute — realtime drives the instant updates (no fast poll)", HOW, () => S((M) => M.RT_BACKUP_MS === 60_000));
check("P172188", F, "no 1.5-second poll constant survives for anything to grow back onto (owner, 2026-09-18)", HOW, () => S((M) => !("POLL_MS" in M)));
check("P172189", F, "an order stops being followed after three hours", HOW, () => S((M) => M.MAX_AGE_MS === 3 * 60 * 60 * 1000));
check("P172190", F, "'now' is an argument, so the age rule is exact at the boundary (exactly 3h is still shown)", HOW, () => S((M) =>
  M.liveActiveOrders([{ ...O("edge", "received"), placedAt: NOW - M.MAX_AGE_MS }], NOW).length === 1));
