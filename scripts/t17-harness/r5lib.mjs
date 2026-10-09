// Round 5 shared kit. A suite run with R5_STRICT=1 exits 1 on the first failed check (the mutation runner uses that).
import { root as ROOT } from "./hooks.mjs";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export const rootFile = (rel) => pathToFileURL(ROOT + "/" + rel).href;
export { randomUUID };
export const root = ROOT;
export const { G, resetWorld } = await import(root + "/scripts/panel-stubs/state.mjs");
G.FAIL = {}; G.FAIL_NTH = {}; G.CALLS = {};
export const { NextRequest } = await import("next/server.js");
process.env.SESSION_SECRET = "r5-session-secret-not-real";
delete process.env.ADMIN_PASSWORD; delete process.env.STAFF_PASSWORD; delete process.env.EDITOR_PASSWORD; delete process.env.TURNSTILE_SECRET_KEY;
process.env.ADMIN_PASSWORD = "r5-admin-password-not-real";
export const ADMIN_PW = process.env.ADMIN_PASSWORD;
export const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const sign = (u, iat = Date.now(), secret = process.env.SESSION_SECRET) => `${u.id}.${iat}.${b64url(createHmac("sha256", secret).update(`${u.id}:${u.role}:${u.token_version ?? 0}:${iat}`).digest())}`;
export const sha = async (s) => createHash("sha256").update(s).digest("hex");
export function req(url, { method = "GET", cookies = {}, headers = {}, json, form, body } = {}) {
  const h = new Headers(headers);
  const ck = Object.entries(cookies).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join("; ");
  if (ck) h.set("cookie", ck);
  let b = body;
  if (json !== undefined) { b = typeof json === "string" ? json : JSON.stringify(json); h.set("content-type", "application/json"); }
  if (form !== undefined) b = new URLSearchParams(form);
  return new NextRequest(new URL(url, "http://r5.local"), { method, headers: h, body: b });
}
const hashCache = new Map();
export async function hashOf(pw) { if (!hashCache.has(pw)) { const UA = await import("@/lib/userAuth.ts"); hashCache.set(pw, await UA.hashSecret(pw)); } return hashCache.get(pw); }
export const RID_A = "00000000-0000-4000-8000-0000000000a1", RID_B = "00000000-0000-4000-8000-0000000000b2", RID_C = "00000000-0000-4000-8000-0000000000c3";
export async function person(o = {}) {
  return { id: randomUUID(), username: "ravi", role: "manager", restaurant_id: RID_A, name: "Ravi", phone: null, active: true, deleted_at: null,
    pin_hash: null, token_version: 0, can_self_reset: true, can_self_set_pin: false, profile_confirmed: true, permissions: null, assigned_tables: null,
    failed_count: 0, locked_until: null, last_seen_at: new Date().toISOString(), password_hash: await hashOf(o.pw || "right-pass-1"), ...o };
}
export function world(fix = {}) { resetWorld(); G.FAIL = {}; G.FAIL_NTH = {}; G.CALLS = {}; for (const [k, v] of Object.entries(fix)) G.FIX[k] = JSON.parse(JSON.stringify(v)); }
export const rows = [];
const STRICT = !!process.env.R5_STRICT;
const QUIET = !!process.env.T17_QUIET;
export function t(file, check, ok, note = "", how = "round 5 · hermetic harness: the real file run against an in-memory database (no network)") {
  rows.push({ file, check, how, ok: ok === true, note: String(note ?? "").slice(0, 220) });
  if (!STRICT && (!QUIET || ok !== true)) console.log(`${ok === true ? "✅" : "❌"} ${file} — ${check}${note ? " :: " + String(note).slice(0, 160) : ""}`);
  if (STRICT && ok !== true) { console.log("KILLED by: " + check); process.exit(1); }
}
export function save(path) { if (STRICT) return; if (process.env.T17_SAVE) writeFileSync(path, JSON.stringify(rows, null, 1)); console.log(`\n${rows.length} rows · ${rows.filter((r) => r.ok).length} ✅ · ${rows.filter((r) => !r.ok).length} ❌`); }
export const quiet = async (fn) => { const e = console.error, w = console.warn; const logs = []; console.error = (...a) => logs.push(a.join(" ")); console.warn = (...a) => logs.push(a.join(" ")); try { return { v: await fn(), logs }; } catch (err) { return { err, logs }; } finally { console.error = e; console.warn = w; } };
export const NET = []; export const refuseNet = async (u) => { NET.push(String(u)); throw new TypeError("r5: network refused"); };
globalThis.fetch = refuseNet;
G.RPC_IMPL = {
  lfh_guest_restaurant: ({ p_slug }) => { const r = (G.FIX.restaurants || []).find((x) => x.slug === p_slug); return r ? { ...r } : null; },
  lfh_slug_moved: ({ p_slug }) => (G.FIX.slug_redirects || []).find((x) => x.old_slug === p_slug)?.new_slug ?? null,
  lfh_staff_login_failed: ({ p_ids, p_max = 5, p_lock_seconds = 60 }) => (G.FIX.staff_users || []).filter((u) => (p_ids || []).includes(u.id)).map((u) => { const n = (u.failed_count || 0) + 1; if (n >= p_max) { u.failed_count = 0; u.locked_until = new Date(Date.now() + p_lock_seconds * 1000).toISOString(); } else u.failed_count = n; return { id: u.id, failed_count: u.failed_count, locked_until: u.locked_until ?? null }; }),
  lfh_throttle_fail: ({ p_key, p_max, p_lock_ms }) => { G.FIX.login_throttle ||= []; let r = G.FIX.login_throttle.find((x) => x.key === p_key); if (!r) { r = { key: p_key, fail_count: 0, locked_until: null }; G.FIX.login_throttle.push(r); } r.fail_count = (r.fail_count || 0) + 1; if (!(r.locked_until && new Date(r.locked_until) > new Date())) r.locked_until = null; const n = r.fail_count; if (n >= p_max) { r.fail_count = 0; r.locked_until = new Date(Math.max(r.locked_until ? new Date(r.locked_until).getTime() : 0, Date.now() + p_lock_ms)).toISOString(); return [{ fail_count: n, locked: true }]; } return [{ fail_count: n, locked: false }]; },
};
export const isRedirect = (e) => e && typeof e.url === "string" && /^redirect /.test(e.message || "");
export const isNotFound = (e) => e && e.message === "notFound";
export const R = (globalThis.__R4 ||= { cookies: {}, headers: {} });
export const go = async (fn) => { try { return { v: await fn() }; } catch (e) { if (isRedirect(e)) return { redirect: e.url }; if (isNotFound(e)) return { notFound: true }; return { err: e }; } };
