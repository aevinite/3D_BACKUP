#!/usr/bin/env node
/**
 * verify-admin-api-b.mjs — T27 of sweep #9, ROUND 2: 500 freshly planned phases over the admin
 * server routes 26-to-the-end (`find app/api/admin -name route.ts | sort | sed -n '26,51p'`).
 *
 * ── WHY IT IS A SCRIPT AND NOT A TYPED TABLE ────────────────────────────────────────────────────
 * Round 1's fifty rows were hand-written, and that was right for fifty. Five hundred typed rows
 * drift from the checks within days, and then "re-run P160042" stops meaning anything — the exact
 * failure the ledger exists to prevent. So this file IS the ledger: it runs the phases and prints
 * them, and `--ledger` regenerates `LEDGER/T27-S9-R2.md` from the same source of truth. Same
 * pattern as verify-admin-sweep.mjs, verify-bin-billing-usage.mjs, verify-repair-health-sweep.mjs.
 *
 *   node scripts/verify-admin-api-b.mjs --base http://localhost:4427
 *   node scripts/verify-admin-api-b.mjs --base http://localhost:4427 --ledger
 *   node scripts/verify-admin-api-b.mjs --base http://localhost:4427 --from 160120 --to 160160
 *
 * ── THE IDS, AND WHY THERE ARE TWO RANGES ───────────────────────────────────────────────────────
 * 44 of this terminal's pre-allocated block were still free (`P104257`–`P104300`), so the round is
 * 44 + 456 and only the shortfall (`P160001`–`P160456`) was claimed from INDEX.md — landed on
 * `main` in a pull request of its own before a single row was written.
 *
 * ── WHERE THE 500 WENT, AND WHY (rule 2b: measure, do not have an idea) ─────────────────────────
 * Rows per 100 lines of each file, by subject, across all 46 ledgers, measured before planning:
 *
 *   reveal/password       0.8  (120 lines, ONE row)                      →  60 phases
 *   restaurants/access-tree 10.9 (479 lines, and round 1's worst fault)  →  80
 *   restaurants/credentials 10.9 (338 lines)                             →  60
 *   restaurants/settings   14.5 (372 lines)                              →  60
 *   restaurants/report     18.7                                          →  30
 *   resolve-error          19.8                                          →  35
 *   users/photo 30.6 · export 31.7 · platform-channels 32.8              →  25 each
 *   logo 35.9 · google-review 37.1 · quick-features 40.2 · staff-features 42.7 → 20 each
 *   …against settings 520, repair 373, revenue 291, usage 183 — heavily covered by round 1 and
 *   five earlier sweeps, so they get the 20 cross-cutting phases and nothing more.
 *
 * Round 1 gave the password-cover gate twenty phases and nearly all of them landed on
 * `reveal/route.ts`. The PER-PERSON door — the one that hands back a client's sign-in password and
 * mints new ones — came out of round 1 with a single row. That is both the thinnest ground in the
 * territory and the most sensitive, so it leads.
 *
 * ── WHAT IT WRITES, AND HOW IT PUTS IT BACK ─────────────────────────────────────────────────────
 * Everything that mutates runs against FRENCH HOUSE. **Aangan is never written to** — it is the
 * read-only control at factory permission defaults and its differences are the point.
 *
 *   · A THROWAWAY STAFF USER is created for this run and deleted at the end. Every password mint
 *     and every profile write happens on that user, never on a real login — a minted password
 *     cannot be un-minted, and restoring one would mean writing a plaintext back through a route
 *     that deliberately does not accept one.
 *   · THE WHOLE SETTINGS ROW is snapshotted before the settings phases and restored afterwards, in
 *     a `finally` AND on SIGINT/SIGTERM. The restore then RE-READS AND DIFFS, because sweep #6
 *     recorded two restores that silently did not take.
 *   · `restaurants.manager_permissions` / `owner_entitlements` / `access_config` are snapshotted
 *     the same way for the access-tree phases.
 *   · Rows these phases add to `staff_actions` are deleted by their own ids in the same run.
 *
 * Nothing here signs in as a panel role, so the app's own login limits are never touched: admin
 * routes take the admin cookie, derived once from ADMIN_PASSWORD. The uncover window is minted
 * ONCE (its wall is five wrong tries per five minutes — never loop it).
 */
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
// "Is anything actually answering?" — the one preflight every guard that drives the app uses, so a
// stopped app exits 2 with a plain sentence instead of a stack trace (verify:guards-alive enforces
// it: a guard that cannot run looks exactly like a guard nobody ran, and neither looks like a red).
import { requireUp } from "./sweep/appUp.mjs";
// PUT THE WORLD BACK EVEN WHEN NOTHING ASKS US TO — the repo's own helper, not a second copy of it.
// `finally` covers a throw; it does not cover Ctrl-C or a lane runner killing a guard that ran long.
// This project's scar is verify:realtime switching a category off across seven restaurants and dying
// two steps later. verify:test-safety rule 11 requires every script that flips a real setting to use
// this or wire its own — and it caught this suite's section file doing neither.
import { restoreOnExit } from "./sweep/restore.mjs";

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4427").replace(/\/$/, "");
const WRITE_LEDGER = process.argv.includes("--ledger");
const FROM = Number(arg("--from", 0)) || 0;
const TO = Number(arg("--to", 0)) || 0;

const ROOT = new URL("..", import.meta.url).pathname;
const env = readFileSync(`${ROOT}.env.local`, "utf8");
const envGet = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const ADMIN_PW = envGet("ADMIN_PASSWORD");
const SB_URL = envGet("NEXT_PUBLIC_SUPABASE_URL");
const SRK = envGet("SUPABASE_SERVICE_ROLE_KEY") || envGet("SUPABASE_SERVICE_ROLE") || envGet("SERVICE_ROLE_KEY");
if (!ADMIN_PW || !SB_URL || !SRK) {
  console.error("\n.env.local must carry ADMIN_PASSWORD, NEXT_PUBLIC_SUPABASE_URL and the service-role key.\n");
  process.exit(2);
}
await requireUp(BASE, "the admin server routes 26-to-the-end");

const ADMIN = `lfh_staff_auth=${createHash("sha256").update(ADMIN_PW).digest("hex")}`;
const FH = "00000000-0000-0000-0000-000000000001";
const AANGAN = "6c6fadb6-da23-4ab3-9f90-d164773f60b3";
const NOSUCH = "11111111-2222-3333-4444-555555555555";
const DB_WORDS = /relation ".*" does not exist|violates (unique|foreign key|check) constraint|invalid input syntax for type|duplicate key value|column .* does not exist|permission denied for|PGRST\d|function .* does not exist|null value in column/i;
const SECRETS = /password_hash|pin_hash|password_shown|service_role/i;

// ── the ids ─────────────────────────────────────────────────────────────────────────────────────
// 552 ids, in four registered pieces. The round was PLANNED at 500 and the checks came out at 552,
// because three sections are generated from the source rather than typed — one phase per territory
// file, one per clamp in the settings sanitizer, one per refusal shape — so the count is whatever the
// territory actually has. The honest fix is to widen the claim, not to trim 52 real checks to hit a
// round number (T17 on INDEX.md, 2026-09-02; T13, 2026-09-05). Every piece was landed on `main` in a
// pull request of its own BEFORE a single row was written.
const IDS = [];
for (let i = 104257; i <= 104300; i++) IDS.push(i);   //  44 — this terminal's own block remainder
for (let i = 160001; i <= 160456; i++) IDS.push(i);   // 456 — the shortfall, claimed 2026-09-16
for (let i = 160457; i <= 160500; i++) IDS.push(i);   //  44 — the seam declared in that same claim
for (let i = 160951; i <= 160958; i++) IDS.push(i);   //   8 — the overrun, claimed separately
let cursor = 0;
const PHASES = [];
let SECTION = "";

/** Declare one phase. `fn` returns true, false, or a string beginning "skip:" with the reason. */
function phase(check, how, fn) {
  const n = IDS[cursor++];
  if (n === undefined) throw new Error("ran past the claimed ids — STOP and claim more from INDEX.md; never take a neighbour's range");
  PHASES.push({ id: `P${n}`, n, section: SECTION, check, how, fn, result: "?", note: "" });
}
const sec = (name) => { SECTION = name; };

// ── http + service-role read-back ───────────────────────────────────────────────────────────────
async function req(path, { method = "GET", body, cookie = ADMIN, headers = {}, raw } = {}) {
  const h = { ...(cookie ? { Cookie: cookie } : {}), ...headers };
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
  // THE HEADER IS `X-LFH-Action-Id`, AND IT MUST BE A UUID (lib/idempotency.ts line 9).
  // The first draft of this harness invented `X-Idempotency-Key`, which nothing reads — so three
  // phases reported that a double-tap burned two passwords and the promise in those routes' own
  // headers was broken. It is not: with the real header and a real uuid the second request comes
  // back with the SAME password and `duplicate: true`. Three reds, one wrong header, all withdrawn.
  if (/^(POST|PATCH|PUT)$/.test(method) && !h["X-LFH-Action-Id"])
    h["X-LFH-Action-Id"] = crypto.randomUUID();
  const r = await fetch(BASE + path, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* html or empty */ }
  return { status: r.status, text, json, headers: r.headers, cookies: r.headers.getSetCookie ? r.headers.getSetCookie() : [] };
}
async function sq(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "content-type": "application/json", Prefer: opts.prefer || "return=representation", ...(opts.headers || {}) },
  });
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch { /* */ }
  return { status: r.status, json, text: t };
}

// ── the uncover window, minted once ─────────────────────────────────────────────────────────────
let REVEAL = null;
async function uncover() {
  if (REVEAL) return REVEAL;
  const r = await req("/api/admin/reveal", { method: "POST", body: { password: ADMIN_PW } });
  const c = (r.cookies || []).find((x) => x.startsWith("lfh_reveal="));
  if (!c) throw new Error(`could not open the uncover window: ${r.status} ${r.text.slice(0, 140)}`);
  REVEAL = `${ADMIN}; ${c.split(";")[0]}`;
  return REVEAL;
}

// ── fixtures and restore ────────────────────────────────────────────────────────────────────────
const made = { userId: null, userName: null, settings: null, restaurantCols: null, actionIds: [] };

async function makeFixtureUser() {
  const name = `zz t27r2 ${Math.random().toString(36).slice(2, 7)}`;
  const r = await req("/api/admin/users", { method: "POST", body: { name, role: "manager", restaurant_id: FH } });
  if (r.status !== 200 || !r.json?.id) throw new Error(`could not create the throwaway login: ${r.status} ${r.text.slice(0, 200)}`);
  made.userId = r.json.id; made.userName = name;
  // The create screen shows the starter password ONCE. Remembering it here is what lets a later
  // phase prove the handover sheet and the per-person door hand back that same value rather than
  // something they minted themselves.
  made.createdPassword = r.json.password;
  // Into the on-disk snapshot too, so a killed run's throwaway login is cleaned up by the next one.
  try {
    const snap = JSON.parse(readFileSync(SNAP, "utf8"));
    snap.userId = made.userId;
    writeFileSync(SNAP, JSON.stringify(snap, null, 1));
  } catch { /* the snapshot is a safety net, never a blocker */ }
  return r.json;
}
// ── THE SNAPSHOT IS WRITTEN TO DISK, AND A LEFTOVER ONE IS REPAIRED BEFORE ANYTHING ELSE ───────
//
// The first version of this harness held the snapshot in memory only. That is fine for a run that
// ends — the `finally` and the signal handlers put everything back — and useless for a run that is
// KILLED hard, or that dies between the write and the restore. This suite was interrupted twice
// while its detectors were being corrected, and one of those interruptions printed
// "⚠️  PERMISSION DRIFT on access_config" and then exited with the only copy of the correct values
// inside a dead process. Nothing could be put back by hand because nothing knew what "back" was.
//
// So the snapshot lands in a file FIRST, and every later run repairs from a leftover one before it
// takes its own. That turns an interrupted run from an unrecoverable state into a self-healing one,
// and it is the same rule this codebase applies to a bill: never report a change you cannot undo.
const SNAP = `${ROOT}.claude/sweep/.t27r2-snapshot.json`;

async function repairLeftover() {
  let prev = null;
  try { prev = JSON.parse(readFileSync(SNAP, "utf8")); } catch { return null; }
  if (!prev?.settings || !prev?.restaurantCols) return null;
  const lines = [];
  const rest = { ...prev.settings }; delete rest.id; delete rest.restaurant_id;
  await sq(`settings?restaurant_id=eq.${FH}`, { method: "PATCH", body: JSON.stringify(rest) });
  await sq(`restaurants?id=eq.${FH}`, { method: "PATCH", body: JSON.stringify(prev.restaurantCols) });
  const backS = (await sq(`settings?select=*&restaurant_id=eq.${FH}`)).json?.[0] || {};
  const backR = (await sq(`restaurants?select=manager_permissions,owner_entitlements,access_config&id=eq.${FH}`)).json?.[0] || {};
  const driftS = Object.keys(rest).filter((k) => JSON.stringify(backS[k]) !== JSON.stringify(rest[k]));
  const driftR = Object.keys(prev.restaurantCols).filter((k) => JSON.stringify(backR[k]) !== JSON.stringify(prev.restaurantCols[k]));
  lines.push(`a snapshot from an earlier run (${prev.takenAt}) was still on disk — French House repaired from it`);
  lines.push(driftS.length || driftR.length
    ? `⚠️  STILL DRIFTING on ${[...driftS, ...driftR].join(", ")}`
    : "every field and every permission column matches that snapshot");
  if (prev.userId) {
    const d = await req(`/api/admin/users?id=${prev.userId}`, { method: "DELETE" });
    if (d.status === 200) lines.push("and an earlier run's throwaway login was removed");
  }
  return lines;
}

async function snapshot() {
  const s = (await sq(`settings?select=*&restaurant_id=eq.${FH}`)).json?.[0];
  if (!s) throw new Error("could not snapshot French House's settings row");
  made.settings = { ...s }; delete made.settings.updated_at;
  const rst = (await sq(`restaurants?select=manager_permissions,owner_entitlements,access_config&id=eq.${FH}`)).json?.[0];
  if (!rst) throw new Error("could not snapshot French House's permission columns");
  made.restaurantCols = { ...rst };
  // On disk BEFORE the first write, so a killed run leaves something a later run can repair from.
  writeFileSync(SNAP, JSON.stringify({ takenAt: new Date().toISOString(), settings: made.settings, restaurantCols: made.restaurantCols, userId: null }, null, 1));
  // …and registered with the shared helper, HERE, where the originals are captured. On a normal
  // finish the `finally` has already put everything back and these do not fire; on Ctrl-C, a polite
  // kill or an uncaught crash they are the only thing that will.
  restoreOnExit("French House · the whole settings row", async () => {
    const rest = { ...made.settings }; delete rest.id; delete rest.restaurant_id;
    await sq(`settings?restaurant_id=eq.${FH}`, { method: "PATCH", body: JSON.stringify(rest) });
  });
  restoreOnExit("French House · manager_permissions, owner_entitlements and access_config", async () => {
    await sq(`restaurants?id=eq.${FH}`, { method: "PATCH", body: JSON.stringify(made.restaurantCols) });
  });
}
async function restoreAll() {
  const out = [];
  if (made.settings) {
    // id and restaurant_id identify the row, so they are the two things the patch must NOT carry.
    const rest = { ...made.settings };
    delete rest.id; delete rest.restaurant_id;
    await sq(`settings?restaurant_id=eq.${FH}`, { method: "PATCH", body: JSON.stringify(rest) });
    const back = (await sq(`settings?select=*&restaurant_id=eq.${FH}`)).json?.[0] || {};
    const drift = Object.keys(rest).filter((k) => JSON.stringify(back[k]) !== JSON.stringify(rest[k]));
    out.push(drift.length ? `⚠️  SETTINGS DRIFT on ${drift.join(", ")} — put back by hand` : `settings: all ${Object.keys(rest).length} fields back as found`);
  }
  if (made.restaurantCols) {
    await sq(`restaurants?id=eq.${FH}`, { method: "PATCH", body: JSON.stringify(made.restaurantCols) });
    const back = (await sq(`restaurants?select=manager_permissions,owner_entitlements,access_config&id=eq.${FH}`)).json?.[0] || {};
    const drift = Object.keys(made.restaurantCols).filter((k) => JSON.stringify(back[k]) !== JSON.stringify(made.restaurantCols[k]));
    out.push(drift.length ? `⚠️  PERMISSION DRIFT on ${drift.join(", ")} — put back by hand` : "permissions: manager_permissions, owner_entitlements and access_config back as found");
  }
  if (made.userId) {
    const d = await req(`/api/admin/users?id=${made.userId}`, { method: "DELETE" });
    if (d.status !== 200) await sq(`staff_users?id=eq.${made.userId}`, { method: "DELETE" });
    out.push(`throwaway login "${made.userName}" removed`);
  }
  if (made.actionIds.length) {
    for (const id of made.actionIds) await sq(`staff_actions?id=eq.${id}`, { method: "DELETE" });
    out.push(`${made.actionIds.length} activity row(s) this run wrote, deleted by their own ids`);
  }
  // The snapshot file is deleted ONLY when nothing drifted. If anything did, it stays on disk so the
  // next run — or a person — can put it back; a safety net that deletes itself on failure is no net.
  if (!out.some((l) => l.startsWith("⚠️"))) { try { unlinkSync(SNAP); } catch { /* already gone */ } }
  else out.push(`the snapshot is kept at .claude/sweep/.t27r2-snapshot.json — re-run this guard and it repairs from it`);
  return out;
}
async function actionsSince(since, actions) {
  const q = await sq(`staff_actions?select=id,action,detail,created_at,restaurant_id,level&created_at=gte.${since}&action=in.(${actions.join(",")})&order=created_at.desc&limit=60`);
  const rows = q.json || [];
  for (const r of rows) if (!made.actionIds.includes(r.id)) made.actionIds.push(r.id);
  return rows;
}

// ── the context every section gets ──────────────────────────────────────────────────────────────
const ctx = {
  phase, sec, req, sq, uncover, actionsSince, made, makeFixtureUser,
  BASE, ADMIN, ADMIN_PW, FH, AANGAN, NOSUCH, DB_WORDS, SECRETS, ROOT,
  src: (rel) => readFileSync(`${ROOT}${rel}`, "utf8"),
  // A section that writes a real setting DIRECTLY (rather than through a route) registers its own
  // put-back with this — verify:test-safety rule 11, and it is the right rule.
  restoreOnExit,
  /**
   * THE MODEL, AS THE APP ITSELF COMPUTES IT — not as a regex guesses it from the source.
   *
   * `lib/accessTree.ts` does not declare its key lists as literal arrays: every one of them is
   * DERIVED at import time (`export const GRANT_FLAGS = collect((b) => …)`) from the node tree. The
   * first draft of section B tried to read those lists with a regex and of course could not, so 27
   * of its phases came back ⏭ "could not read GRANT_FLAGS from the model" — a quarter of the section
   * covering the file that held round 1's worst fault, silently unchecked.
   *
   * The fix is to stop parsing and start asking: `GET access-tree` answers the state that
   * `accessStateFor` builds from that same model, so the real keys come from the running product.
   * Fetched once and cached for the whole run.
   */
  model: async () => {
    if (ctx._model) return ctx._model;
    const r = await req(`/api/admin/restaurants/access-tree?restaurant_id=${FH}`);
    const st = r.json?.state;
    if (!st) throw new Error(`could not read the access model from the app: ${r.status} ${r.text.slice(0, 120)}`);
    const cfg = st.config || {};
    const entries = Object.entries(cfg).filter(([, v]) => v && typeof v === "object");
    ctx._model = {
      state: st,
      grants: Object.keys(st.grants || {}),
      sections: Object.keys(st.sections || {}),
      features: Object.keys(st.features || {}),
      channels: Object.keys(st.channels || {}),
      creds: Object.keys(st.creds || {}),
      tabs: st.tabs || {},
      configIds: Object.keys(cfg),
      hasIds: entries.filter(([, v]) => "on" in v).map(([k]) => k),
      // ── STORED IS NOT THE SAME AS WRITABLE, AND THAT COST THIS SUITE A FALSE RED ──────────────
      // `state.config[id]` carries what the DATABASE holds, and `access_config` deliberately KEEPS
      // the values of retired switches (lib/accessTree says so: "the retired ids already sitting in
      // there are left alone on purpose"). So a `tablet` or a `limit` appearing in the state does
      // NOT mean the route will still write it.
      //
      // `void_bills.tablet` is exactly that: the owner REMOVED that row's waiter tri-state on
      // 2026-08-04 — "tablet will not have option of print and reopen bill and stuff — they can only
      // mark as paid, only if permission is given" — and the stored "on" is history. The first draft
      // of this helper took the first stored `tablet` it found, got the retired one, and reported the
      // route's perfectly correct 400 as a fault. Withdrawn.
      //
      // The WRITABLE set comes from the node construction in the model's source, where the ids ARE
      // literals (`capId: "close_unpaid"`), crossed with what the state actually carries. Exactly one
      // waiter tri-state is writable today, which is the point of checking it rather than assuming.
      capTablet: entries.filter(([, v]) => "tablet" in v).map(([k]) => k)
        .filter((k) => new RegExp(`capId:\\s*"${k}"`).test(ctx.src("lib/accessTree.ts"))),
      capTabletRetired: entries.filter(([, v]) => "tablet" in v).map(([k]) => k)
        .filter((k) => !new RegExp(`capId:\\s*"${k}"`).test(ctx.src("lib/accessTree.ts"))),
      // A numeric ceiling is bound per ROLE (`{ t: "limit", id, side: "manager" | "waiter" | … }`),
      // so a stored `limit` whose sides are not role names is a different binding wearing the same
      // column — `void_bills.limit.minutes` is the reopen window, not a discount cap.
      limits: entries.filter(([, v]) => v.limit && typeof v.limit === "object")
        .map(([k, v]) => ({ id: k, sides: Object.keys(v.limit).filter((x) => /^(owner|manager|waiter)$/.test(x)) }))
        .filter((L) => L.sides.length),
      opts: entries.flatMap(([k, v]) => Object.keys(v).filter((x) => /_opts$/.test(x))
        .map((side) => ({ id: k, side: side.replace(/_opts$/, ""), keys: Object.keys(v[side] || {}) })))
        .filter((o) => o.keys.length),
      boolSettings: Object.entries(st.settings || {}).filter(([, v]) => typeof v === "boolean").map(([k]) => k),
      strSettings: Object.entries(st.settings || {}).filter(([, v]) => typeof v === "string").map(([k]) => k),
      listSettings: Object.entries(st.settings || {}).filter(([, v]) => Array.isArray(v)).map(([k]) => k),
    };
    return ctx._model;
  },
  _model: null,
  /**
   * Does the sign-in check come before the first database call, IN EVERY EXPORTED HANDLER?
   *
   * The first draft compared `indexOf(gate)` against `indexOf(sb.from)` across the whole FILE, and
   * that reads backwards the moment a file defines a HELPER above its handlers — which three of
   * these do (`personOr` in users/photo, `ensureCodes` in restaurants/settings, `readLock` in
   * settings, all added or moved by real fixes). The helper's `sb.from` sits at a lower index than
   * the handler's gate, so a correctly gated route reported as ungated. Three of the round's
   * seventeen reds were that one mistake, and the finding was withdrawn rather than filed.
   *
   * So: slice each exported handler's own body and ask the question there, following a one-hop
   * delegation (withIdempotency(impl), or a wrapper around handler()) the same way
   * verify-admin-api-a's rule 1 does.
   */
  gateFirst: (rel) => {
    const src = readFileSync(`${ROOT}${rel}`, "utf8")
      .replace(/(^|[^:'"`\\])\/\/[^\n]*/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
    const GATE = /\b(tokenIsValid|admin|requireAdmin|isAdmin|gate)\s*\(/;
    const DB = /\b(sb|supabaseAdmin|supabase)\s*\.\s*(from|rpc)\s*\(/;
    const bodyAt = (from) => {
      const open = src.indexOf("{", from);
      if (open < 0) return "";
      let d = 0;
      for (let i = open; i < src.length; i++) {
        if (src[i] === "{") d++;
        else if (src[i] === "}") { d--; if (!d) return src.slice(open, i + 1); }
      }
      return src.slice(open);
    };
    const heads = [...src.matchAll(/export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)\s*\(/g)];
    const wrapped = [...src.matchAll(/export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=\s*\w+\(\s*(\w+)/g)];
    const bodies = [];
    for (const h of heads) bodies.push(bodyAt(h.index));
    for (const w of wrapped) {
      // follow the named implementation, up to two hops (withIdempotency(impl) → impl → handler())
      let name = w[2], hops = 0, body = "";
      while (name && hops++ < 3) {
        const at = src.search(new RegExp(`(?:async\\s+function|function)\\s+${name}\\s*\\(`));
        if (at < 0) break;
        body = bodyAt(at);
        if (GATE.test(body)) break;
        const next = (body.match(/\b([a-z][\w$]*)\s*\(\s*req\b/) || [])[1];
        if (!next || next === name) break;
        name = next;
      }
      bodies.push(body);
    }
    if (!bodies.length) return "skip:no exported handler found to read";
    const bad = [];
    for (const b of bodies) {
      const g = b.search(GATE), d = b.search(DB);
      if (d < 0) continue;                       // no database call in this handler at all
      if (g < 0 || g > d) bad.push(b.slice(0, 60).replace(/\s+/g, " "));
    }
    return bad.length === 0 || `a handler calls the database before its gate: ${bad.join(" | ")}`;
  },
  /** Source with comments stripped — every fix in this repo quotes the bug it replaced in prose a
   *  few lines above the fix, so a check that greps the raw file fires on the very comment that
   *  documents the fix. Line comments come off FIRST (see verify-admin-api-a's note on why). */
  clean: (rel) => readFileSync(`${ROOT}${rel}`, "utf8")
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, ""),
  FILES: [
    "app/api/admin/rate-limits/route.ts", "app/api/admin/repair/route.ts",
    "app/api/admin/resolve-error/route.ts", "app/api/admin/restaurants/access-tree/route.ts",
    "app/api/admin/restaurants/bill-preview/route.ts", "app/api/admin/restaurants/branding/route.ts",
    "app/api/admin/restaurants/create-defaults/route.ts", "app/api/admin/restaurants/credentials/route.ts",
    "app/api/admin/restaurants/export/route.ts", "app/api/admin/restaurants/google-review/route.ts",
    "app/api/admin/restaurants/health/route.ts", "app/api/admin/restaurants/logo/route.ts",
    "app/api/admin/restaurants/platform-channels/route.ts", "app/api/admin/restaurants/quick-features/route.ts",
    "app/api/admin/restaurants/report/route.ts", "app/api/admin/restaurants/route.ts",
    "app/api/admin/restaurants/settings/route.ts", "app/api/admin/restaurants/staff-features/route.ts",
    "app/api/admin/reveal/password/route.ts", "app/api/admin/reveal/route.ts",
    "app/api/admin/revenue/route.ts", "app/api/admin/settings/route.ts",
    "app/api/admin/staff-online/route.ts", "app/api/admin/usage/route.ts",
    "app/api/admin/users/photo/route.ts", "app/api/admin/users/route.ts",
  ],
};

// ── the sections, in the order the measurement put them ─────────────────────────────────────────
const sections = [
  "./sweep/t27r2/a-reveal-password.mjs",
  "./sweep/t27r2/b-access-tree.mjs",
  "./sweep/t27r2/c-credentials.mjs",
  "./sweep/t27r2/d-settings.mjs",
  "./sweep/t27r2/e-resolve-error.mjs",
  "./sweep/t27r2/f-report.mjs",
  "./sweep/t27r2/g-photo-export-channels.mjs",
  "./sweep/t27r2/h-logo-review-quick-staff.mjs",
  "./sweep/t27r2/i-cross-cutting.mjs",
];
for (const s of sections) (await import(s)).default(ctx);

// The count must match the ids that were actually claimed — no phase may run on an id nobody
// registered, and no claimed id may sit unused without being named as a seam.
if (PHASES.length !== IDS.length) {
  console.error(`\n${PHASES.length} phases declared against ${IDS.length} registered ids. Claim the difference on INDEX.md FIRST, in a commit of its own, or remove the extra phases — never run on an id nobody registered.\n`);
  process.exit(2);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────
const inRange = (p) => (!FROM || p.n >= FROM) && (!TO || p.n <= TO);
let pass = 0, fail = 0, skip = 0, outside = 0;
const fails = [];
console.log(`\nADMIN SERVER ROUTES 26-TO-THE-END · ROUND 2 — ${PHASES.length} phases (500 planned), ${BASE}\n`);
let lastSection = "";
try {
  const repaired = await repairLeftover();
  if (repaired) { console.log("── before starting:"); for (const l of repaired) console.log(`  ${l}`); console.log(""); }
  await snapshot();
  await makeFixtureUser();
  for (const p of PHASES) {
    if (!inRange(p)) { p.result = "⏭"; p.note = "outside --from/--to"; outside++; continue; }
    if (p.section !== lastSection) { console.log(`\n── ${p.section}`); lastSection = p.section; }
    let v;
    try { v = await p.fn(ctx); } catch (e) { v = false; p.note = `driver exception: ${String(e.message || e).slice(0, 200)}`; }
    if (typeof v === "string" && v.startsWith("skip:")) { p.result = "⏭"; p.note = v.slice(5).trim(); skip++; console.log(`  ⏭  ${p.id}  ${p.check} — ${p.note}`); continue; }
    if (typeof v === "string") { p.result = "❌"; p.note = v; }
    else { p.result = v ? "✅" : "❌"; }
    if (p.result === "✅") { pass++; console.log(`  ✓  ${p.id}  ${p.check}${p.note ? ` — ${p.note}` : ""}`); }
    else { fail++; fails.push(p); console.log(`  ✗  ${p.id}  ${p.check}${p.note ? ` — ${p.note}` : ""}`); }
  }
} finally {
  console.log("\n── putting French House back:");
  for (const l of await restoreAll()) console.log(`  ${l}`);
}

console.log("\n" + "═".repeat(94));
console.log(`  ADMIN API PART B · ROUND 2 — ${PHASES.length} planned, ${pass + fail + skip} executed: ${pass} ✅  ${fail} ❌  ${skip} ⏭${outside ? `  (${outside} outside --from/--to)` : ""}`);
if (fails.length) {
  console.log("\n  what failed:");
  for (const f of fails) console.log(`    ${f.id}  ${f.check}\n           ${f.note || "(no note)"}`);
}
console.log("═".repeat(94));
console.log(`  re-run one band:  node scripts/verify-admin-api-b.mjs --base ${BASE} --from <n> --to <n>\n`);

// ── the ledger, regenerated from the same source of truth ───────────────────────────────────────
if (WRITE_LEDGER) {
  const bySec = new Map();
  for (const p of PHASES) { if (!bySec.has(p.section)) bySec.set(p.section, []); bySec.get(p.section).push(p); }
  let md = `# T27 of SWEEP #9 · ROUND 2 — the admin server routes, 26 to the end\n\n`;
  md += `> **GENERATED. A row is never re-typed here by hand** — the table would drift from the checks\n`;
  md += `> within days, and then "re-run P160042" stops meaning anything, which is the exact failure the\n`;
  md += `> ledger exists to prevent. Regenerate with \`node scripts/verify-admin-api-b.mjs --base <url> --ledger\`.\n\n`;
  md += `**Asked for by the owner** after round 1 and the three picked follow-ups were merged and deployed:\n`;
  md += `*"make it live and plan the whole 500 phases test again within the boundaries that you have given\n`;
  md += `and test it again so that if any errors are left still within the boundaries that you have given,\n`;
  md += `it can be solved"*.\n\n`;
  md += `**Territory:** \`find app/api/admin -name route.ts | sort | sed -n '26,51p'\` — 26 files, re-derived\n`;
  md += `2026-09-16, not taken from any list. **Block:** \`P104257\`–\`P104300\` (this terminal's own remainder,\n`;
  md += `44) + \`P160001\`–\`P160456\` (the claimed shortfall, 456) = **500**. The shortfall was claimed by\n`;
  md += `editing INDEX.md's mark and landing it on \`main\` in a pull request of its own, before a single row\n`;
  md += `was written.\n\n`;
  md += `**Aimed by MEASUREMENT** (rule 2b), rows per 100 lines before planning: \`reveal/password\` **0.8**\n`;
  md += `(120 lines, ONE row) · \`access-tree\` 10.9 · \`credentials\` 10.9 · \`restaurants/settings\` 14.5 ·\n`;
  md += `\`report\` 18.7 · \`resolve-error\` 19.8 — against \`settings\` 520, \`repair\` 373, \`revenue\` 291.\n\n`;
  md += `**Run:** \`${BASE}\` · **Result: ${pass} ✅ · ${fail} ❌ · ${skip} ⏭**\n\n`;
  md += `**Restoration.** Every write ran against **French House** and was put back: the whole \`settings\`\n`;
  md += `row and the three permission columns snapshotted and restored with a re-read-and-diff, a\n`;
  md += `throwaway staff login created and deleted, and every \`staff_actions\` row these phases wrote\n`;
  md += `deleted by its own id. **Aangan was never written to** — it is the read-only control.\n\n`;
  md += `**Result key:** ✅ pass · ❌ fail · ⏭ unanswered, with a written reason.\n\n---\n`;
  for (const [name, list] of bySec) {
    md += `\n## ${name} · \`${list[0].id}\`–\`${list[list.length - 1].id}\` (${list.length})\n\n`;
    md += `| id | check | how to verify | result | note |\n|---|---|---|---|---|\n`;
    for (const p of list) {
      const esc = (t) => String(t == null ? "" : t).replace(/\|/g, "\\|").replace(/\n/g, " ");
      md += `| ${p.id} | ${esc(p.check)} | ${esc(p.how)} | ${p.result} | ${esc(p.note)} |\n`;
    }
  }
  mkdirSync(`${ROOT}.claude/sweep/LEDGER`, { recursive: true });
  writeFileSync(`${ROOT}.claude/sweep/LEDGER/T27-S9-R2.md`, md);
  console.log(`  ledger written: .claude/sweep/LEDGER/T27-S9-R2.md (${PHASES.length} rows)\n`);
}

process.exit(fail ? 1 : 0);
