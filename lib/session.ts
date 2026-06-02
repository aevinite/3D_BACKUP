// v2 dining-session client API. Thin wrappers around the lfh_* RPCs, plus
// per-table token storage and the location check. Browser-only (uses
// localStorage / navigator.geolocation at call time). The guest app talks ONLY
// to these RPCs with the anon key — never to the tables directly.

import { supabase } from "./supabase";

// ── per-device session token, keyed by table ──────────────────────────────
// Re-scanning a DIFFERENT table must not reuse the old token, so we store the
// table alongside it and treat a table mismatch as "no session here".
const KEY = "lfh_session";

export interface StoredSession {
  table: string;
  token: string;
  memberId: string;
  role: "owner" | "guest";
}

export function getStoredSession(table?: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (table && s.table !== table) return null; // token belongs to another table
    return s;
  } catch {
    return null;
  }
}
export function storeSession(s: StoredSession) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}
export function clearStoredSession() {
  try { localStorage.removeItem(KEY); } catch {}
}

// ── location (the main gate) ───────────────────────────────────────────────
export type LocationReason = "bypassed" | "near" | "far" | "denied" | "unavailable" | "timeout";
export interface LocationResult { ok: boolean; near: boolean; reason: LocationReason; lat: number | null; lng: number | null; }

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
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
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    if (geoLat == null || geoLng == null) return { ok: true, near: true, reason: "bypassed", lat: null, lng: null };
    return { ok: false, near: false, reason: "unavailable", lat: null, lng: null };
  }
  return new Promise<LocationResult>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        if (geoLat == null || geoLng == null) return resolve({ ok: true, near: true, reason: "bypassed", lat, lng });
        const d = distanceMeters(lat, lng, geoLat, geoLng);
        resolve(d <= radiusM ? { ok: true, near: true, reason: "near", lat, lng } : { ok: true, near: false, reason: "far", lat, lng });
      },
      (err) => resolve({ ok: false, near: false, reason: err.code === err.PERMISSION_DENIED ? "denied" : err.code === err.TIMEOUT ? "timeout" : "unavailable", lat: null, lng: null }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// ── RPC wrappers ───────────────────────────────────────────────────────────
// Every RPC returns a JSON object shaped like { ok: boolean, reason?, ... }.
type RpcResult = { ok: boolean; reason?: string; [k: string]: unknown };

async function rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, reason: error.message };
  return (data as RpcResult) ?? { ok: false, reason: "empty" };
}

export const recognizeCustomer = (phone: string) => rpc("lfh_recognize_customer", { p_phone: phone });
// Pre-check: is this table already held by someone? Drives the head-vs-guest UI
// branch before we ask the guest for anything.
export const tableStatus = (table: string) => rpc("lfh_table_status", { p_table: table });
// Join (auto-opens the table for the first scanner). Coords are sent so the
// server can enforce the geofence itself; pass null when location is bypassed.
export const joinSession = (table: string, name: string | null, lat: number | null, lng: number | null) =>
  rpc("lfh_join_session", { p_table: table, p_name: name, p_lat: lat, p_lng: lng });
export const getSessionState = (token: string) => rpc("lfh_session_state", { p_token: token });
// Leave the table (the widget's "leave" / "change table" / "unmerge"). If the
// head leaves, the RPC hands the table to the next approved member, or closes it.
export const leaveSession = (token: string) => rpc("lfh_leave_session", { p_token: token });
export const requestAccess = (table: string, type: "open" | "join" | "access", name: string | null, phone: string | null) =>
  rpc("lfh_request", { p_table: table, p_type: type, p_name: name, p_phone: phone });
export const approveMember = (ownerToken: string, memberId: string, name: string | null) =>
  rpc("lfh_approve_member", { p_owner_token: ownerToken, p_member_id: memberId, p_name: name });
export const removeMember = (ownerToken: string, memberId: string) =>
  rpc("lfh_remove_member", { p_owner_token: ownerToken, p_member_id: memberId });
export const setAutoApprove = (ownerToken: string, value: boolean) =>
  rpc("lfh_set_auto_approve", { p_owner_token: ownerToken, p_value: value });
export const sendOtp = (phone: string) => rpc("lfh_send_otp", { p_phone: phone });
export const verifyOtp = (token: string, phone: string, code: string) =>
  rpc("lfh_verify_otp", { p_token: token, p_phone: phone, p_code: code });
// Shared session cart (migration 019). getSessionCart reads it; setSessionCart
// writes it (approved members only — the RPC enforces that).
export const getSessionCart = (token: string) => rpc("lfh_get_cart", { p_token: token });
export const setSessionCart = (token: string, cart: unknown[]) => rpc("lfh_set_cart", { p_token: token, p_cart: cart });
export const placeSessionOrder = (token: string, items: unknown[], subtotal: number, tax: number, total: number, allergies: string[]) =>
  rpc("lfh_place_order", { p_token: token, p_items: items, p_subtotal: subtotal, p_tax: tax, p_total: total, p_allergies: allergies });
export const callWaiterSession = (token: string, reason: string) =>
  rpc("lfh_call_waiter", { p_token: token, p_reason: reason });
