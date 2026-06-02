// v2 dining-session client API. Thin wrappers around the lfh_* RPCs, plus
// per-table token storage and the location check. Browser-only (uses
// localStorage / navigator.geolocation at call time). The guest app talks ONLY
// to these RPCs with the anon key — never to the tables directly.

// Grab the shared database connection we set up in supabase.ts.
import { supabase } from "./supabase";

// ── per-device session token, keyed by table ──────────────────────────────
// Re-scanning a DIFFERENT table must not reuse the old token, so we store the
// table alongside it and treat a table mismatch as "no session here".
// "localStorage" is the browser's little notepad that survives page refreshes;
// KEY is the label we file this note under.
const KEY = "lfh_session";

// The shape of the session note we keep on the device: which table it's for,
// the secret token that proves we're in the session, our member id, and whether
// we're the table "owner" (first to scan) or a "guest" who joined.
export interface StoredSession {
  table: string;
  token: string;
  memberId: string;
  role: "owner" | "guest";
}

// Read the saved session back. Pass a table to make sure the saved one is for
// THAT table (so a guest who walks to a new table doesn't reuse the old token).
// Returns null if there's nothing saved or anything goes wrong.
export function getStoredSession(table?: string): StoredSession | null {
  // Wrapped in try/catch because localStorage can throw (e.g. private mode) and
  // the saved text might be corrupt — we'd rather quietly return null than crash.
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    // It's stored as text, so JSON.parse turns it back into an object.
    const s = JSON.parse(raw) as StoredSession;
    if (table && s.table !== table) return null; // token belongs to another table
    return s;
  } catch {
    return null;
  }
}
// Save the session note. JSON.stringify turns the object into text to store.
export function storeSession(s: StoredSession) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}
// Forget the session entirely (used on "leave table" / sign-out).
export function clearStoredSession() {
  try { localStorage.removeItem(KEY); } catch {}
}

// ── location (the main gate) ───────────────────────────────────────────────
// The possible outcomes of the location check, in plain words: skipped, close
// enough, too far, permission denied, no GPS, or it took too long.
export type LocationReason = "bypassed" | "near" | "far" | "denied" | "unavailable" | "timeout";
// What checkLocation hands back: did it succeed, are they near, why, and the
// coordinates it found (null if it couldn't get them).
export interface LocationResult { ok: boolean; near: boolean; reason: LocationReason; lat: number | null; lng: number | null; }

// Works out the straight-line distance in METRES between two GPS points using
// the "haversine" formula (accounts for the curve of the Earth). You don't need
// the math — just know: give it two lat/lng pairs, get back how far apart they are.
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000; // Earth's radius in metres
  // Degrees -> radians (the units the trig functions expect).
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  // The haversine formula. "**" means "to the power of", so x ** 2 is x squared.
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Returns whether the guest is physically near the café. SOFT gate:
//  - if the café coords aren't set yet (stub), everyone is "near" so the flow
//    stays usable until the owner sets the location in the editor;
//  - denied/unavailable/far are reported so the UI can offer the staff-request
//    fallback (never a hard block).
export async function checkLocation(
  geoLat: number | null,
  geoLng: number | null,
  radiusM: number
): Promise<LocationResult> {
  // We always try for a fix when geolocation is available — the coords are sent
  // to the server so it can enforce the geofence itself. When café coords aren't
  // set yet (stub), the soft "near" result keeps the flow usable.
  // No GPS available at all (e.g. running on a server, or an old browser).
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    // If the café hasn't set its coords yet, let everyone through ("bypassed").
    if (geoLat == null || geoLng == null) return { ok: true, near: true, reason: "bypassed", lat: null, lng: null };
    // Café coords ARE set but we can't check — report it so the UI can react.
    return { ok: false, near: false, reason: "unavailable", lat: null, lng: null };
  }
  // Getting GPS is asynchronous (it calls us back later), so we wrap it in a
  // Promise and "resolve" once the browser gives us an answer.
  return new Promise<LocationResult>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      // SUCCESS: the browser found the device's position.
      (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        // Café coords not set yet -> soft pass, but keep the real coords we got.
        if (geoLat == null || geoLng == null) return resolve({ ok: true, near: true, reason: "bypassed", lat, lng });
        // Measure how far the guest is from the café centre.
        const d = distanceMeters(lat, lng, geoLat, geoLng);
        // Within the allowed radius -> "near"; otherwise -> "far".
        resolve(d <= radiusM ? { ok: true, near: true, reason: "near", lat, lng } : { ok: true, near: false, reason: "far", lat, lng });
      },
      // FAILURE: translate the browser's error code into our plain reason word.
      (err) => resolve({ ok: false, near: false, reason: err.code === err.PERMISSION_DENIED ? "denied" : err.code === err.TIMEOUT ? "timeout" : "unavailable", lat: null, lng: null }),
      // Options: ask for best accuracy, give up after 10s, accept a fix cached
      // within the last 60s (maximumAge) to answer faster.
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// ── RPC wrappers ───────────────────────────────────────────────────────────
// Every RPC returns a JSON object shaped like { ok: boolean, reason?, ... }.
// "[k: string]: unknown" just means the object may also carry extra fields we
// don't list here.
type RpcResult = { ok: boolean; reason?: string; [k: string]: unknown };

// One small helper every wrapper below uses. It calls a database function by
// name (`fn`) with some arguments (`args`) and always returns a tidy result, so
// callers can just check `.ok` instead of juggling errors themselves.
async function rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(fn, args);
  // Database said no -> report failure with its message.
  if (error) return { ok: false, reason: error.message };
  // Got data -> use it; got nothing -> treat as a failure ("empty").
  return (data as RpcResult) ?? { ok: false, reason: "empty" };
}

// ── RPC wrappers: each one-liner below just calls a specific database function.
// Naming each its own function keeps the rest of the app readable.

// Look up a returning customer by phone number.
export const recognizeCustomer = (phone: string) => rpc("lfh_recognize_customer", { p_phone: phone });
// Pre-check: is this table already held by someone? Drives the head-vs-guest UI
// branch before we ask the guest for anything.
export const tableStatus = (table: string) => rpc("lfh_table_status", { p_table: table });
// Join (auto-opens the table for the first scanner). Coords are sent so the
// server can enforce the geofence itself; pass null when location is bypassed.
export const joinSession = (table: string, name: string | null, lat: number | null, lng: number | null) =>
  rpc("lfh_join_session", { p_table: table, p_name: name, p_lat: lat, p_lng: lng });
// Fetch the current state of a session (who's in it, status, etc.) by token.
export const getSessionState = (token: string) => rpc("lfh_session_state", { p_token: token });
// Leave the table (the widget's "leave" / "change table" / "unmerge"). If the
// head leaves, the RPC hands the table to the next approved member, or closes it.
export const leaveSession = (token: string) => rpc("lfh_leave_session", { p_token: token });
// Ask to open/join/access a table (used when a guest can't auto-join, e.g. the
// table is held and auto-approve is off, so the head must approve them).
export const requestAccess = (table: string, type: "open" | "join" | "access", name: string | null, phone: string | null) =>
  rpc("lfh_request", { p_table: table, p_type: type, p_name: name, p_phone: phone });
// The table's head approves a pending member (owner-only; proven by ownerToken).
export const approveMember = (ownerToken: string, memberId: string, name: string | null) =>
  rpc("lfh_approve_member", { p_owner_token: ownerToken, p_member_id: memberId, p_name: name });
// The head removes a member from the table.
export const removeMember = (ownerToken: string, memberId: string) =>
  rpc("lfh_remove_member", { p_owner_token: ownerToken, p_member_id: memberId });
// The head toggles "let new people in automatically" on/off.
export const setAutoApprove = (ownerToken: string, value: boolean) =>
  rpc("lfh_set_auto_approve", { p_owner_token: ownerToken, p_value: value });
// Text a one-time code (OTP) to a phone number to confirm it's really theirs.
export const sendOtp = (phone: string) => rpc("lfh_send_otp", { p_phone: phone });
// Check the code the guest typed against the one we sent.
export const verifyOtp = (token: string, phone: string, code: string) =>
  rpc("lfh_verify_otp", { p_token: token, p_phone: phone, p_code: code });
// Shared session cart (migration 019). getSessionCart reads it; setSessionCart
// writes it (approved members only — the RPC enforces that).
export const getSessionCart = (token: string) => rpc("lfh_get_cart", { p_token: token });
export const setSessionCart = (token: string, cart: unknown[]) => rpc("lfh_set_cart", { p_token: token, p_cart: cart });
// Place the whole table's order, with the money totals and any allergy notes.
export const placeSessionOrder = (token: string, items: unknown[], subtotal: number, tax: number, total: number, allergies: string[]) =>
  rpc("lfh_place_order", { p_token: token, p_items: items, p_subtotal: subtotal, p_tax: tax, p_total: total, p_allergies: allergies });
// Call a waiter from within a live session, with a reason (e.g. "need help").
export const callWaiterSession = (token: string, reason: string) =>
  rpc("lfh_call_waiter", { p_token: token, p_reason: reason });
