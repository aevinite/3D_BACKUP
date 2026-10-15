// Round 3 · E — WHAT THE ORDERING SCREENS CALL IN lib/menu.ts, AND THE TOKEN LOOKUP (the real files).
//
//   · callWaiter — the bell's send straight to the database: every answer it can get, worded upward;
//   · getSettings — one read shared by everyone who asks at once, kept 8 s, NEVER kept when it failed;
//   · restaurantOfToken (lib/guestTokenRestaurant.ts) — every way the lookup can come up empty.
// The browser's supabase client is REAL; its requests reach the fake phone's network through one switch
// (the client may keep hold of whichever network function existed when it was first loaded).
import { check, real, ROOT } from "./h.mjs";
import { phone } from "../phone.mjs";
import { G } from "../stubs/state.mjs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const FH = "00000000-0000-0000-0000-000000000001";
const REAL_FETCH = globalThis.fetch;
const SWITCH = (...a) => (globalThis.__t3r3fetch || REAL_FETCH)(...a);
{ const saved = globalThis.fetch; globalThis.fetch = SWITCH; await import(pathToFileURL(join(ROOT, "lib/supabase.ts")).href); globalThis.fetch = saved; }
async function on(respond, fn) {
  const P = await phone({ respond }); globalThis.__t3r3fetch = globalThis.fetch;
  try { const M = await real("lib/menu.ts"); return await fn(M, P); } finally { globalThis.__t3r3fetch = null; P.restore(); }
}
const rpcAnswer = (status, json) => ({ status, json });

check("R3-E01", "E", "the bell's send: a call that landed is ok, with no beacon", () => on(() => rpcAnswer(200, { ok: true }), async (M, P) => {
  const r = await M.callWaiter("7", "Water", FH); await P.settle(20);
  const beacon = P.fetches.filter((f) => f.url.includes("/api/guest/limit-hit")).length;
  return { ok: r.ok === true && !r.reason && beacon === 0 && P.fetches[0].url.includes("/rpc/lfh_call_waiter_table") && P.fetches[0].body.p_table === "7", note: JSON.stringify(r) };
}));
check("R3-E02", "E", "…a table at its call limit is ok-but-limited, and the owner's phone is told once (the limit beacon)", () => on((u) => (u.includes("limit-hit") ? rpcAnswer(200, { ok: true }) : rpcAnswer(200, { ok: true, reason: "rate_limited" })), async (M, P) => {
  const r = await M.callWaiter("7", "Water", FH); await P.settle(20);
  const b = P.fetches.filter((f) => f.url.includes("/api/guest/limit-hit"));
  return { ok: r.reason === "rate_limited" && b.length === 1 && b[0].body.fn === "lfh_call_waiter_table" && b[0].body.rid === FH && b[0].init.keepalive === true, note: `${b.length} beacon(s)` };
}));
check("R3-E03", "E", "…a table that does not exist comes back with the database's own sentence for the popup (item 29)", () => on(() => rpcAnswer(200, { ok: false, reason: "unknown_table", error: "Table 45 doesn't exist — tables are 1–30." }), async (M) => {
  const r = await M.callWaiter("45", "Water", FH);
  return { ok: r.ok === false && r.reason === "unknown_table" && /Table 45 doesn't exist/.test(r.error || ""), note: JSON.stringify(r) };
}));
check("R3-E04", "E", "…a database that did not answer (statement timeout, gateway, dropped connection) is BUSY — saved and sent later", async () => {
  const out = [];
  for (const [label, respond] of [["57014", () => rpcAnswer(500, { code: "57014", message: "canceling statement due to statement timeout" })], ["503 page", () => ({ status: 503, raw: "upstream request timeout" })], ["Failed to fetch", () => new TypeError("Failed to fetch")]]) {
    out.push(await on(respond, async (M) => { try { await M.callWaiter("7", "Water", FH); return `${label}: no throw`; } catch (e) { return M.isServerBusy(e) ? null : `${label}: thrown but not busy (${String(e).slice(0, 60)})`; } }));
  }
  const bad = out.filter(Boolean); return { ok: !bad.length, note: bad.join(" · ") || "3 kinds of no-answer → busy" };
});
check("R3-E05", "E", "…a database that REFUSED the value is not busy — the diner is told, nothing is saved to retry", () => on(() => rpcAnswer(400, { code: "23514", message: "new row violates check constraint" }), async (M) => {
  try { await M.callWaiter("7", "Water", FH); return { ok: false, note: "no throw" }; } catch (e) { return { ok: !M.isServerBusy(e), note: String(e).slice(0, 80) }; }
}));
check("R3-E06", "E", "…and it refuses to run at all without a restaurant (never restaurant #1 by default)", () => on(() => rpcAnswer(200, { ok: true }), async (M, P) => {
  let threw = false; try { await M.callWaiter("7", "Water", ""); } catch { threw = true; }
  return { ok: threw && P.fetches.length === 0, note: `${P.fetches.length} request(s)` };
}));
check("R3-E07", "E", "the settings read: ten screens asking at once make ONE request, and a second ask within 8 s makes none", () => on(() => rpcAnswer(200, { table_count: 30, sessions_enabled: false, tax_rate: 0.05 }), async (M, P) => {
  await Promise.all(Array.from({ length: 10 }, () => M.getSettings(FH))); const a = P.fetches.length; await M.getSettings(FH);
  return { ok: a === 1 && P.fetches.length === 1, note: `${a} then ${P.fetches.length}` };
}));
check("R3-E08", "E", "…a FAILED read is never kept: the next ask asks again (item 31 — a failure is not an answer)", () => {
  let n = 0;
  return on(() => (n++ === 0 ? rpcAnswer(500, { code: "57014", message: "canceling statement due to statement timeout" }) : rpcAnswer(200, { table_count: 12, tax_rate: 0.18 })), async (M) => {
    let first = "ok"; try { await M.getSettings(FH); } catch { first = "threw"; }
    const s = await M.getSettings(FH);
    return { ok: first === "threw" && s.tableCount === 12 && Math.abs(s.taxRate - 0.18) < 1e-9, note: `first ${first} · then tables ${s.tableCount}, tax ${s.taxRate}` };
  });
});
check("R3-E09", "E", "…no settings row at all reads as the safe defaults (no floor-plan limit, sessions off), never a crash", () => on(() => rpcAnswer(200, null), async (M) => {
  const s = await M.getSettings(FH);
  return { ok: s.tableCount === 0 && s.sessionsEnabled === false && s.menuEnabled !== undefined, note: `tables ${s.tableCount} · sessions ${s.sessionsEnabled}` };
}));
check("R3-E10", "E", "…each restaurant has its own copy: French House's settings never answer for another", () => on((u, i) => rpcAnswer(200, { table_count: JSON.parse(i.body).p_restaurant_id === FH ? 30 : 10 }), async (M) => {
  const a = await M.getSettings(FH), b = await M.getSettings("00000000-0000-0000-0000-00000000aaaa");
  return { ok: a.tableCount === 30 && b.tableCount === 10, note: `${a.tableCount} / ${b.tableCount}` };
}));
// ── the token lookup ───────────────────────────────────────────────────────────────────────────
const tok = async (setup) => { G.reset(); setup(); const M = await real("lib/guestTokenRestaurant.ts"); return M; };
check("R3-E11", "E", "a token's restaurant: found through its session, as a plain id", async () => {
  const M = await tok(() => { G.TABLES.session_members = [{ token: "t1", session_id: "s1" }]; G.TABLES.sessions = [{ id: "s1", restaurant_id: FH }]; });
  const r = await M.restaurantOfToken("t1"); const scoped = G.READS.every((x) => x.limit === 1);
  return { ok: r === FH && scoped && G.READS.length === 2, note: `${r} · ${G.READS.length} reads, each limit 1` };
});
check("R3-E12", "E", "…and \"\" — never a guess — for no token, an unknown token, a session that is gone, a malformed id, or a failing read", async () => {
  const cases = [
    ["no token", () => {}, undefined], ["unknown token", () => {}, "nope"],
    ["session gone", () => { G.TABLES.session_members = [{ token: "t1", session_id: "s9" }]; }, "t1"],
    ["malformed id", () => { G.TABLES.session_members = [{ token: "t1", session_id: "s1" }]; G.TABLES.sessions = [{ id: "s1", restaurant_id: "not-a-uuid" }]; }, "t1"],
    ["read fails", () => { G.THROW_FROM = "session_members"; }, "t1"],
  ];
  const bad = []; for (const [label, setup, t] of cases) { const M = await tok(setup); let r; try { r = await M.restaurantOfToken(t); } catch { r = "THREW"; } if (r !== "") bad.push(`${label} → ${JSON.stringify(r)}`); }
  return { ok: !bad.length, note: bad.join(" · ") || `${cases.length} empty cases` };
});
