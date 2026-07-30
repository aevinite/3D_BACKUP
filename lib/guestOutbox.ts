"use client";
// guestOutbox.ts — the OFFLINE ORDER QUEUE for the GUEST menu (offline sync, 2026-07-07).
// Twin of public/panels/outbox.js (staff), but for guest orders, which are placed a
// different way (browser RPCs, not fetch to /api).
//
// The ONLINE path is UNTOUCHED — components call the normal RPC directly. Only when
// the guest is OFFLINE does the cart divert here: the order is saved on-device
// (IndexedDB, survives reload) and the guest sees "saved — will send when you're back
// online". On reconnect it's POSTed to /api/guest/place-order with an X-LFH-Action-Id,
// so the same at-most-once guard the staff panels use (migration 138) makes a replay
// place the order ONCE — never a duplicate. On a successful send we record the order
// into the guest's active-orders list so the normal tracker follows it from then on.
import { useSyncExternalStore } from "react";
import { tgetFor, tsetFor, tenantSlug } from "@/lib/tenantStorage";

export type GuestTrack = { tableNumber?: string; total?: number; itemCount?: number; items?: { title: string; qty: number }[] };
export type GuestOrder = {
  id: string;                       // action_id (uuid) — the at-most-once key
  mode: "session" | "public";
  token?: string; table?: string; restaurantId?: string; restaurantSlug?: string;
  items: unknown[]; allergies: string[];
  track?: GuestTrack;
  at: number; status: "queued" | "failed"; error?: string;
};

const DB_NAME = "lfh_guest_outbox";
const STORE = "orders";
const listeners = new Set<() => void>();
let queued: GuestOrder[] = [];
let failed: GuestOrder[] = [];
let started = false;
let flushing = false;
let snapshot: { queued: GuestOrder[]; failed: GuestOrder[]; count: number } = { queued: [], failed: [], count: 0 };

// ── tiny IndexedDB wrapper ────────────────────────────────────────────────────
let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function idbAll(): Promise<GuestOrder[]> {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const r = d.transaction(STORE, "readonly").objectStore(STORE).getAll();
      r.onsuccess = () => resolve((r.result as GuestOrder[]) || []);
      r.onerror = () => reject(r.error);
    });
  } catch { return []; }
}
function idbWrite(fn: (s: IDBObjectStore) => void): Promise<void> {
  return db().then((d) => new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  })).catch(() => {});
}

// ── helpers ───────────────────────────────────────────────────────────────────
const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));

// A FUNCTION (not a direct `navigator.onLine` read) so TypeScript can't narrow the
// value away between the guard and the loop, and so it's re-evaluated each pass.
const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

function recompute() { snapshot = { queued: queued.slice(), failed: failed.slice(), count: queued.length + failed.length }; }
function notify() {
  recompute();
  listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
  try { window.dispatchEvent(new CustomEvent("lfh:guest-outbox-changed")); } catch { /* ignore */ }
}

function reasonMsg(reason?: string): string {
  switch (reason) {
    case "session_closed": return "Your table was closed while you were offline.";
    case "not_approved": return "You weren't approved to order on this table.";
    case "blocked": return "This order was blocked.";
    case "otp_required": return "Phone verification was needed.";
    case "invalid_token": return "Your table session expired.";
    case "sold_out": return "A dish sold out while you were offline.";
    case "unknown_item": return "A dish is no longer on the menu.";
    case "empty_order": return "The order was empty.";
    default: return reason || "Couldn't send this order.";
  }
}

// Record a successfully-sent order into the guest's active-orders list so the normal
// OrderTracker follows its status (exactly what the online cart flow does).
function recordActive(item: GuestOrder, orderId: string) {
  if (!orderId) return; // a duplicate reply with no id → nothing to track (already recorded on the first send)
  try {
    // Scope the tracker entry to the order's OWN restaurant, not whatever page the
    // tab happens to be on when the outbox flushes (fixes an offline order showing
    // under the wrong restaurant on the same device).
    const slug = item.restaurantSlug || tenantSlug();
    const raw = tgetFor("lfh_active_orders", slug);
    const list = raw ? JSON.parse(raw) : [];
    const arr = Array.isArray(list) ? list : [];
    if (arr.some((o: { id?: string }) => o?.id === orderId)) return; // already tracked — don't double-add
    arr.push({
      id: orderId,
      tableNumber: item.track?.tableNumber ?? item.table ?? "",
      total: item.track?.total ?? 0,
      itemCount: item.track?.itemCount ?? 0,
      items: item.track?.items ?? [],
      status: "received",
      placedAt: Date.now(),
    });
    tsetFor("lfh_active_orders", slug, JSON.stringify(arr));
    window.dispatchEvent(new Event("lfh:order-placed"));
  } catch { /* tracker record is best-effort */ }
}

async function persist(item: GuestOrder) { await idbWrite((s) => s.put(item)); }
async function removeItem(id: string) {
  queued = queued.filter((x) => x.id !== id);
  failed = failed.filter((x) => x.id !== id);
  await idbWrite((s) => s.delete(id));
}
async function moveToFailed(item: GuestOrder, reason: string) {
  queued = queued.filter((x) => x.id !== item.id);
  item.status = "failed"; item.error = reason;
  failed.push(item);
  await persist(item);
}

// ── the public enqueue: called by the cart when offline ─────────────────────────
export async function enqueueGuestOrder(p: {
  mode: "session" | "public"; token?: string; table?: string; restaurantId?: string; restaurantSlug?: string;
  items: unknown[]; allergies: string[]; track?: GuestTrack; actionId?: string;
}): Promise<{ ok: true; queued: true; action_id: string }> {
  ensureStarted();
  // Remember which restaurant this order belongs to NOW (we're on its page), so the
  // tracker entry lands under the right restaurant even if the tab moves on before the
  // outbox flushes.
  const restaurantSlug = p.restaurantSlug || tenantSlug();
  // Reuse the SAME at-most-once id the ONLINE attempt already used, when the caller
  // passes one. Without this, an order that COMMITTED online but whose reply was lost,
  // then retried after the phone dropped offline, was queued under a brand-new id and
  // placed a SECOND time on reconnect (the server's dedup couldn't tie the retry to the
  // original). A shared id makes it place exactly once (audit fix 2026-07-08).
  const { actionId, ...rest } = p;
  const item: GuestOrder = { id: actionId || uuid(), status: "queued", at: Date.now(), ...rest, restaurantSlug, items: p.items || [], allergies: p.allergies || [] };
  queued.push(item);
  await persist(item);
  notify();
  return { ok: true, queued: true, action_id: item.id };
}

function doPost(item: GuestOrder) {
  return fetch("/api/guest/place-order", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LFH-Action-Id": item.id,
      // Everything sent from here is by definition a REPLAY — it was saved on this phone
      // while it had no signal. These two markers let the server refuse an order whose
      // table has moved on (closed/billed, or a different party now), instead of adding
      // it to someone else's bill. See lib/clash.ts.
      "X-LFH-Replay": "1",
      "X-LFH-Queued-At": new Date(item.at || Date.now()).toISOString(),
    },
    body: JSON.stringify({ mode: item.mode, token: item.token, table: item.table, restaurantId: item.restaurantId, items: item.items, allergies: item.allergies }),
  });
}

export async function flushGuestOutbox() {
  if (flushing || isOffline() || !queued.length) return;
  flushing = true;
  try {
    while (queued.length && !isOffline()) {
      const item = queued[0];
      let res: Response;
      try { res = await doPost(item); }
      catch { break; }                                   // still offline → stop, keep queue
      // Read the body ONCE: the old code parsed it inside the 409 branch and then again
      // below, where the already-consumed stream yielded null — so a clash message never
      // reached the guest.
      const j = await res.json().catch(() => null) as
        | { ok?: boolean; order_id?: string; duplicate?: boolean; reason?: string; retry?: boolean; clash?: { plain?: string } }
        | null;
      if (res.status === 409 && j?.retry) break;           // idempotency "processing" → try later
      if (res.status === 409 && j?.clash?.plain) {          // the table moved on while offline
        await moveToFailed(item, j.clash.plain); notify(); continue;
      }
      if (res.ok && j?.ok && j.order_id) { recordActive(item, j.order_id as string); await removeItem(item.id); notify(); continue; }
      // Already placed on a prior sync whose reply we lost. The server now echoes the
      // original order_id back with the duplicate, so we can still show it to the guest
      // (previously this silently dropped the order and the guest thought it failed).
      if (res.ok && j?.duplicate) { if (j.order_id) recordActive(item, j.order_id as string); await removeItem(item.id); notify(); continue; }
      // A TRANSIENT server error (5xx — e.g. the route's 502 on a DB timeout/deadlock) is
      // NOT a business rejection: keep the order queued and let the periodic re-flush resend
      // it, rather than marking it permanently failed and stranding the guest (who has no
      // manual retry). Only a genuine rejection (sold out / session closed → carries a
      // `reason`) moves to failed. (audit fix 2026-07-09 — "no lost orders")
      if (!res.ok && res.status >= 500) break;
      // Server accepted the call but rejected the order (state changed while offline),
      // or a hard 4xx → surface it instead of losing it.
      await moveToFailed(item, reasonMsg(j?.reason)); notify(); continue;
    }
  } finally { flushing = false; notify(); }
}

export async function dismissGuestFailed(id: string) { await removeItem(id); notify(); }

function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => { flushGuestOutbox(); });
  // A flaky reconnect may never fire a clean "online" event, and a flush that broke mid-way
  // (network throw → break) wasn't rescheduled — so a queued order could sit "Waiting"
  // until a page reload. Retry on a cheap 15s timer (no-ops when offline/empty/already
  // flushing) and whenever the tab regains focus, mirroring the staff outbox. (fix 2026-07-09)
  setInterval(() => { flushGuestOutbox(); }, 15_000);
  window.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") flushGuestOutbox(); });
  idbAll().then((all) => {
    queued = all.filter((x) => x.status !== "failed").sort((a, b) => a.at - b.at);
    failed = all.filter((x) => x.status === "failed");
    notify();
    flushGuestOutbox();
  });
}

// ── React hook for the connection badge ─────────────────────────────────────────
function subscribe(cb: () => void) { ensureStarted(); listeners.add(cb); return () => { listeners.delete(cb); }; }
function getSnapshot() { return snapshot; }
const EMPTY = { queued: [] as GuestOrder[], failed: [] as GuestOrder[], count: 0 };
function getServerSnapshot() { return EMPTY; }
export function useGuestOutbox() { return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot); }
