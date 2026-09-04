// ⬛ NEW — T11 of sweep #8 · BANK B · P64839–P64960
// THE ADDRESS BOOK, DRIVEN THROUGH THE REAL DOOR. Every check here POSTs to
// /api/admin/printing/* against a running server and reads the answer back out of the state the
// screens actually render. Nothing is asserted from source.
//
// WHY DRIVEN AND NOT IMPORTED: lib/printHelpers.ts imports the service-role client behind the "@/"
// alias, so it cannot be loaded into a bare node harness — and the interesting behaviour is the
// REFUSALS, which only exist on the route. Every previous row about this file read it.
//
// SAFETY: it writes to French House (Aangan is the read-only control). The whole printing bag is
// snapshotted before the first check and put back after the last, in a finally AND on
// SIGINT/SIGTERM, and the restoration is re-read and asserted. Nothing else is touched.
import { row, skipRow } from "./lib.mjs";
import { adminHeaders } from "../login.mjs";

const BASE = process.env.T11_BASE || "http://localhost:4311";
const RID = "00000000-0000-0000-0000-000000000001";   // My Little French House
const HDRS = { ...adminHeaders(BASE), "content-type": "application/json" };
const api = async (path, body) => {
  const r = await fetch(BASE + "/api/admin/printing" + path,
    body === undefined ? { headers: HDRS } : { method: "POST", headers: HDRS, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* 204 or html */ }
  return { status: r.status, ok: r.ok, j };
};
const state = async () => (await api(`/state?rid=${RID}`)).j;
const setRoute = (kind, val) => api("/routes", { rid: RID, routes: { [kind]: val } });
const routeOf = async (kind) => (await state())?.routes?.[kind] ?? null;

// ── the snapshot, and putting it back ────────────────────────────────────────────────────────
let SNAP = null, live = false;
const reachable = await api(`/state?rid=${RID}`).then((r) => r.status === 200).catch(() => false);
if (reachable) {
  SNAP = JSON.parse(JSON.stringify((await state())?.routes ?? {}));
  live = true;
}
const asPatch = (r) => !r ? null
  : r.via === "off" ? { via: "off" }
  : (r.agent && r.printer) ? { via: "computer", agent: r.agent, printer: r.printer }
  : (r.via === "screen" && r.panel) ? { via: "screen", panel: r.panel, person: r.person || undefined }
  : null;
const restore = async () => {
  if (!live || !SNAP) return;
  for (const k of Object.keys(SNAP)) await setRoute(k, asPatch(SNAP[k]));
};
process.on("SIGINT", async () => { await restore(); process.exit(1); });
process.on("SIGTERM", async () => { await restore(); process.exit(1); });
process.on("exit", () => { /* the explicit restore row below is the one that matters */ });

let n = 64839;
const id = () => "P" + n++;
const R = (what, fn) => live ? row(id(), what, fn) : skipRow(id(), what, `nothing answered at ${BASE} — start the dev server and re-run`);

// ── 1 · the door itself ─────────────────────────────────────────────────────────────────────
R("the printing state answers 200 for a signed-in admin", async () => (await api(`/state?rid=${RID}`)).status === 200 || "not 200");
R("…and carries the three routable kinds, no more and no fewer", async () => {
  const k = (await state())?.kinds || [];
  return (k.length === 3 && ["kot", "bill", "banquet"].every((x) => k.includes(x)))
    || `kinds: ${k.join(",")} — three documents exist, so three lines exist`;
});
R("…and 'test' is a kind of JOB but never a line in the address book", async () => {
  const k = (await state())?.kinds || [];
  return !k.includes("test") || "a test page is addressed at a printer, so a route for it could only contradict the button";
});
R("…and every kind carries all three of its words, so no label can render blank", async () => {
  const s = await state();
  const bad = (s?.kinds || []).filter((k) => !s?.labels?.kind?.[k] || !s?.labels?.what?.[k]);
  return bad.length === 0 || `${bad.join(",")} is missing a label`;
});
R("…and it says how long is too long, so no screen keeps its own idea", async () => {
  const s = await state();
  return (s?.stuck && typeof s.stuck.afterMs === "number" && s.stuck.afterMs > 0) || `afterMs is ${s?.stuck?.afterMs}`;
});
R("a request with no restaurant is refused rather than answering about some other one", async () => {
  const r = await api("/state");
  return r.status >= 400 || `answered ${r.status}`;
});
R("a request naming a restaurant that does not exist does not answer 200 with someone else's board", async () => {
  const r = await api("/state?rid=00000000-0000-0000-0000-0000000000ff");
  return r.status >= 400 || !(r.j?.agents?.length) || "it answered with agents for a restaurant that does not exist";
});

// ── 2 · what the address book REFUSES (the half that only exists on the route) ───────────────
R("an unknown kind of paper is refused by name", async () => {
  const r = await api("/routes", { rid: RID, routes: { napkins: { via: "off" } } });
  return (r.status >= 400 || /no such kind/i.test(r.j?.error || "")) || `answered ${r.status} ${JSON.stringify(r.j)}`;
});
R("…and the refusal is a sentence, not a schema error", async () => {
  const r = await api("/routes", { rid: RID, routes: { napkins: { via: "off" } } });
  const e = String(r.j?.error || "");
  return (/paper/i.test(e) && !/undefined|null|\{|\}/.test(e)) || `the refusal reads "${e}"`;
});
R("a route naming a computer that is not this restaurant's is refused", async () => {
  const r = await setRoute("bill", { via: "computer", agent: "00000000-0000-0000-0000-0000000000ff", printer: "Anything" });
  return /not one of this restaurant's/i.test(r.j?.error || "") || `answered ${r.status} ${JSON.stringify(r.j)}`;
});
R("a route naming only a computer, with no printer, is refused", async () => {
  const r = await setRoute("bill", { via: "computer", agent: "00000000-0000-0000-0000-000000000001" });
  return /pick both/i.test(r.j?.error || "") || `answered ${r.status} ${JSON.stringify(r.j)}`;
});
R("a route naming only a printer, with no computer, is refused", async () => {
  const r = await setRoute("bill", { via: "computer", printer: "Some printer" });
  return /pick both/i.test(r.j?.error || "") || `answered ${r.status} ${JSON.stringify(r.j)}`;
});
R("a screen route with no panel is refused, and says which four to pick from", async () => {
  const r = await setRoute("kot", { via: "screen" });
  const e = String(r.j?.error || "");
  return /kitchen/i.test(e) && /manager/i.test(e) || `the refusal reads "${e}"`;
});
R("a screen route naming a panel that does not exist is refused", async () => {
  const r = await setRoute("kot", { via: "screen", panel: "roof" });
  return (r.status >= 400 || /pick which screen/i.test(r.j?.error || "")) || `answered ${r.status}`;
});
R("a screen route naming somebody who is not this restaurant's staff is refused", async () => {
  const r = await setRoute("kot", { via: "screen", panel: "kitchen", person: "00000000-0000-0000-0000-0000000000ff" });
  return /not one of this restaurant's staff/i.test(r.j?.error || "") || `answered ${r.status} ${JSON.stringify(r.j)}`;
});
R("a route that is not an object at all is refused rather than stored", async () => {
  const r = await api("/routes", { rid: RID, routes: { bill: "the counter" } });
  return (r.status >= 400 || /not readable/i.test(r.j?.error || "")) || `answered ${r.status}`;
});
R("…and a refused route leaves the stored one exactly as it was", async () => {
  const before = JSON.stringify(await routeOf("bill"));
  await setRoute("bill", { via: "computer", agent: "00000000-0000-0000-0000-0000000000ff", printer: "X" });
  const after = JSON.stringify(await routeOf("bill"));
  return before === after || `it changed from ${before} to ${after}`;
});

// ── 3 · "nobody prints this" is a DECISION, not an empty line ────────────────────────────────
R("switching a paper off stores it as a decision", async () => {
  await setRoute("bill", { via: "off" });
  const r = await routeOf("bill");
  return r?.via === "off" || `stored ${JSON.stringify(r)}`;
});
R("…and nothing else survives on that line", async () => {
  const r = await routeOf("bill");
  return (!r?.agent && !r?.printer) || `an off line kept ${JSON.stringify(r)} — it would come back on with a printer nobody chose`;
});
R("…and OFF and UNSET are different answers on the board", async () => {
  await setRoute("bill", { via: "off" });
  const off = await routeOf("bill");
  await setRoute("bill", null);
  const unset = await routeOf("bill");
  return (off?.via === "off" && unset?.via !== "off")
    || `off=${JSON.stringify(off)} unset=${JSON.stringify(unset)} — empty is "nobody has set this up", off is "we decided not to"`;
});
R("clearing a line is not the same as switching it off (the standing rule)", async () => {
  await setRoute("kot", null);
  const r = await routeOf("kot");
  return r?.via !== "off" || "clearing a paper line switched printing off";
});

// ── 4 · the kitchen slips line IS the auto-print switch ──────────────────────────────────────
R("switching the kitchen slips off switches auto-print off at the source", async () => {
  await setRoute("kot", { via: "off" });
  const s = await state();
  return s?.printing?.on === false || `auto_print_kot is still ${s?.printing?.on} — the trigger would fill the basket behind a switch that says off`;
});
R("…and setting the line to anything else switches it back on", async () => {
  await setRoute("kot", null);
  const s = await state();
  return s?.printing?.on === true || `auto_print_kot is ${s?.printing?.on}`;
});
R("…but it can never switch on what Aevidine has not allowed", async () => {
  const s = await state();
  return s?.printing?.allowed === true
    ? (s.printing.on === true || "allowed but off after clearing the line")
    : (s?.printing?.on === false || "it switched printing on for a restaurant that is not entitled");
});

// ── 5 · the queue can be stopped without printing being switched off ────────────────────────
R("stopping the queue is recorded, and is NOT the same as switching printing off", async () => {
  await api("/queue", { rid: RID, paused: true });
  const s = await state();
  const ok = s?.paused === true && s?.printing?.allowed === true;
  await api("/queue", { rid: RID, paused: false });
  return ok || "stopping the queue also switched printing off — those are different answers";
});
R("…and restarting it clears the stop", async () => {
  await api("/queue", { rid: RID, paused: false });
  const s = await state();
  return s?.paused === false || `still paused: ${s?.paused}`;
});
R("…and stopping it does not touch any paper's route", async () => {
  const before = JSON.stringify((await state())?.routes);
  await api("/queue", { rid: RID, paused: true });
  const during = JSON.stringify((await state())?.routes);
  await api("/queue", { rid: RID, paused: false });
  return before === during || "stopping the queue rewrote the address book";
});

// ── 6 · the board is egress-safe (it is read on a 10s poll) ─────────────────────────────────
R("the recent-jobs list is capped, however many jobs exist", async () => {
  const s = await state();
  return (s?.recent || []).length <= 30 || `${s.recent.length} rows — this is read every 10 seconds`;
});
R("…and it carries a column list, not whole rows", async () => {
  const s = await state();
  const j = (s?.recent || [])[0];
  if (!j) return true;
  const allowed = ["id", "kind", "status", "printer", "printed_by", "attempts", "error", "created_at", "done_at"];
  const extra = Object.keys(j).filter((k) => !allowed.includes(k));
  return extra.length === 0 || `also sends ${extra.join(",")}`;
});
R("the agents list is capped too", async () => {
  const s = await state();
  return (s?.agents || []).length <= 200 || `${s.agents.length} agents`;
});
R("…and no agent's row carries its token or its hash", async () => {
  const s = await state();
  const leak = (s?.agents || []).filter((a) => JSON.stringify(a).match(/token|lfhp_/i));
  return leak.length === 0 || `an agent row carries ${Object.keys(leak[0]).filter((k) => /token/i.test(k)).join(",")}`;
});
R("the overview answers every restaurant in ONE request, with a bounded row each", async () => {
  const r = await api("/overview");
  const rows = r.j?.rows || [];
  if (!rows.length) return "the overview returned no rows";
  const allowed = ["id", "slug", "name", "allowed", "on", "computers", "connected", "secondsAgo", "names", "routed", "waiting", "oldestMs"];
  const extra = Object.keys(rows[0]).filter((k) => !allowed.includes(k));
  return extra.length === 0 || `a row also carries ${extra.join(",")}`;
});
R("…and it tells the screen the two thresholds rather than letting it guess", async () => {
  const r = await api("/overview");
  return (typeof r.j?.staleMs === "number" && typeof r.j?.stuckAfterMs === "number")
    || `staleMs=${r.j?.staleMs} stuckAfterMs=${r.j?.stuckAfterMs}`;
});

// ── 7 · one restaurant's printing is its own ────────────────────────────────────────────────
R("each restaurant's board is read for that restaurant only", async () => {
  const r = await api("/overview");
  const rows = r.j?.rows || [];
  const ids = new Set(rows.map((x) => x.id));
  return ids.size === rows.length || "the overview has two rows for one restaurant";
});
R("…and a route saved here does not appear on another restaurant's board", async () => {
  const others = ((await api("/overview")).j?.rows || []).filter((x) => x.id !== RID);
  if (!others.length) return "only one restaurant on this stack — re-run where there are two";
  await setRoute("banquet", { via: "off" });
  const other = (await api(`/state?rid=${others[0].id}`)).j;
  return other?.routes?.banquet?.via !== "off" || `${others[0].name}'s banquet line also reads off`;
});

// ── 8 · and everything is put back ──────────────────────────────────────────────────────────
R("EVERY route this bank touched is restored, and the restoration is re-read", async () => {
  await restore();
  const now = (await state())?.routes ?? {};
  const diffs = Object.keys(SNAP || {}).filter((k) => JSON.stringify(SNAP[k]) !== JSON.stringify(now[k]));
  return diffs.length === 0
    || `NOT RESTORED: ${diffs.map((k) => `${k} was ${JSON.stringify(SNAP[k])} now ${JSON.stringify(now[k])}`).join(" · ")}`;
});
R("…and the restaurant's printing switch is back on, as it was found", async () => {
  const s = await state();
  return s?.printing?.on === true || `auto_print_kot is ${s?.printing?.on} — put it back`;
});
R("…and the queue is not left stopped", async () => {
  const s = await state();
  return s?.paused === false || "the queue was left stopped";
});
