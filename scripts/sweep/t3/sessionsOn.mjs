// scripts/sweep/t3/sessionsOn.mjs — DINING SESSIONS ON FOR THIS RUN, AND BACK OFF AFTER IT.
//
// WHY (sweep #10 T3 round 2, item 8 — the owner picked it, 2026-10-12). Dining sessions are OFF at every
// restaurant by default, French House included (see commit 1eedf685, which taught verify:session-ux and
// verify:edge-cases the same lesson). Every runner in this folder that drives the join-a-table gate was
// written while French House had them ON, so on today's stack they crashed at the gate's first box
// (`.sg-input`) — and a crash there took every row AFTER it down with it: the offline basket, the whole
// end-to-end order, the cross-panel block. 48 rows were left unanswered on fixture state alone.
//
// So the runners switch French House ON for their own run and put back exactly what they found — in the
// caller's `finally`, AND on Ctrl-C, a crash or a script that simply runs out of work (./restore.mjs).
// Aangan is never touched: it is the read-only control, and block 3a's sticker rows need it OFF.
import { readFileSync } from "node:fs";
import { restoreOnExit, restoreNow } from "../restore.mjs";

const RID = "00000000-0000-0000-0000-000000000001";   // My Little French House — the one written to
const env = (() => {
  try {
    const t = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
    const g = (k) => (t.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
    return { url: g("NEXT_PUBLIC_SUPABASE_URL"), key: g("SUPABASE_SERVICE_ROLE_KEY") };
  } catch { return {}; }
})();
async function sb(method, path, body) {
  const r = await fetch(`${env.url}/rest/v1/${path}`, { method, headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${t.slice(0, 120)}`);
  return t ? JSON.parse(t) : null;
}
let were = null;
/** Switch French House's dining sessions ON for this run. Returns the put-back (also wired to every exit). */
export async function sessionsOnForRun(log = console.log) {
  if (!env.url || !env.key) { log("· no .env.local keys — dining sessions left as they are"); return async () => {}; }
  const [st] = await sb("GET", `settings?restaurant_id=eq.${RID}&select=sessions_enabled`);
  were = st ? st.sessions_enabled === true : null;
  if (were === false) {
    const putBack = async () => { if (were === false) { await sb("PATCH", `settings?restaurant_id=eq.${RID}`, { sessions_enabled: false }); were = null; } };
    restoreOnExit("French House · dining sessions back OFF", putBack);
    await sb("PATCH", `settings?restaurant_id=eq.${RID}`, { sessions_enabled: true });
    const [now] = await sb("GET", `settings?restaurant_id=eq.${RID}&select=sessions_enabled`);
    if (!now || now.sessions_enabled !== true) { await restoreNow(); throw new Error("could not switch dining sessions on for the run"); }
    log("· French House dining sessions switched ON for this run (they were OFF) — put back on exit");
    return putBack;
  }
  return async () => {};
}
