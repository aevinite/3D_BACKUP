// scripts/sweep/t3s10/r4/db.mjs — round 4's one door to the DEV database: SQL through the Management API and
// PostgREST with the service key, both from .env.local. It refuses to start unless that file points at the
// dev project (wnsfcizclkbobwzcxqsf) — the client stack is never reachable from here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../r3/h.mjs";

const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split("\n").map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
export const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const REF = (URL_.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
if (REF !== "wnsfcizclkbobwzcxqsf") { console.error("db.mjs: .env.local is not the dev project — refusing to run"); process.exit(2); }
const KEY = env.SUPABASE_SERVICE_ROLE_KEY, TOKEN = env.SUPABASE_ACCESS_TOKEN;
export const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// The Management API answers 429 when a run asks too fast (area B sends ~200 queries in a few minutes): wait
// 2, 4, 8, 16, 30, 30, 30 s — about two minutes in all — before calling it unanswered.
const pause = (k) => new Promise((s) => setTimeout(s, Math.min(30_000, 2000 * 2 ** k)));
export async function sql(query) {
  for (let k = 0; k < 8; k++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query }) });
    const t = await r.text();
    if (r.status === 429 || r.status >= 500) { await pause(k); continue; }
    if (!r.ok) throw new Error(`sql ${r.status}: ${t.slice(0, 300)}`);
    return JSON.parse(t);
  }
  throw new Error("sql: the database did not answer after 8 tries");
}
export async function rest(path, { method = "GET", body, prefer } = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json", ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  return { status: r.status, json: j, text: t };
}
export const FH_ID = async () => ((await rest("restaurants?select=id&slug=eq.french-house")).json || [])[0]?.id;

// ── A CALL THAT LEAVES NOTHING BEHIND ──────────────────────────────────────────────────────────────────
// inTx(call, read) runs one function call inside a DO block that ALWAYS ends by raising an exception, so
// Postgres rolls back every row the call wrote — the order, its session, the waiter call, the rate-limit
// counter, any queued notification. What the call answered (or the error it raised, with its SQLSTATE) and
// what `read` saw inside the same transaction come back in the exception's message. `call` is a SQL
// expression returning json; `read` (optional) is a SELECT … INTO x that may use r (the answer).
export async function inTx(call, read = "") { return inTxPrep("", call, read); }
// inTxPrep(prep, call, read): `prep` (plain plpgsql statements — an UPDATE, a PERFORM of an earlier call) runs
// first, inside the same rolled-back block, so a check can set the scene (a dish sold out, an order already
// accepted, six calls already waiting) without the scene ever being real. `p` is a json variable the prep may
// use. NEVER put a call inside an UPDATE's WHERE: Postgres runs it once per ROW scanned (round 4 did that once —
// it placed thousands of rolled-back orders and held table 27 for two minutes).
export async function inTxPrep(prep, call, read = "") {
  const q = `DO $r4$ DECLARE r json; x json; p json; BEGIN
    ${prep}
    BEGIN r := (${call})::json; EXCEPTION WHEN OTHERS THEN r := json_build_object('__err', SQLSTATE, 'msg', SQLERRM); END;
    ${read}
    RAISE EXCEPTION 'R4:%', json_build_object('r', r, 'x', x)::text;
  END $r4$;`;
  for (let k = 0; k < 8; k++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query: q }) });
    const t = await res.text();
    if (res.status === 429 || res.status >= 500) { await pause(k); continue; }
    let msg = t; try { msg = JSON.parse(t).message || t; } catch { /* raw */ }
    const m = msg.match(/R4:(\{[\s\S]*\})/);
    if (!m) throw new Error(`inTx: no result in ${msg.slice(0, 300)}`);
    return JSON.parse(m[1]);
  }
  throw new Error("inTx: the database did not answer after 8 tries");
}
export const lit = (v) => v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
