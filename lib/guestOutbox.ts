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
  tries?: number;   // rounds of "the server couldn't take it" so far — see SERVER_MAX_TRIES
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
// Resolves TRUE when the order really reached the device's storage, FALSE when it didn't
// (private browsing, storage full, quota refused). It used to swallow the failure and resolve
// either way, so the diner was told "Saved — will send when you're back online" for an order
// that existed only in a JavaScript variable and died on the next reload. The caller decides
// what to say; this just stops lying about it.
function idbWrite(fn: (s: IDBObjectStore) => void): Promise<boolean> {
  return db().then((d) => new Promise<boolean>((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  })).catch(() => false);
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

export function reasonMsg(reason?: string): string {
  switch (reason) {
    case "session_closed": return "Your table was closed while you were offline.";
    case "not_approved": return "You weren't approved to order on this table.";
    case "blocked": return "This order was blocked.";
    case "otp_required": return "Phone verification was needed.";
    case "invalid_token": return "Your table session expired.";
    case "sold_out": return "A dish sold out while you were offline.";
    case "unknown_item": return "A dish is no longer on the menu.";
    // mig 253: the dish is priced by staff at order time, so it cannot be self-ordered.
    case "staff_priced_item": return "A dish now needs a member of staff to price it.";
    case "empty_order": return "The order was empty.";
    // The one refusal code the RPC returns that had no wording — it reached the phone as the
    // literal word "rate_limited" (mig 240).
    case "rate_limited": return "Too many orders in a row — please wait a moment and order again.";
    case "server_busy": return "The restaurant's system couldn't take this one.";
    case "unknown_restaurant": return "We couldn't tell which restaurant this order was for.";
    case "off_plan_table": return "That table number isn't one this restaurant has.";
    case "bad_body": return "Something was wrong with this order.";
    // NEVER echo a code we don't have words for. An unrecognised reason is a machine word (or,
    // worse, a database message) and means nothing to a diner — say the honest general thing and
    // let the server log carry the detail.
    default: return "Couldn't send this order — please order again.";
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

async function persist(item: GuestOrder): Promise<boolean> { return idbWrite((s) => s.put(item)); }
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

// ── the retry timer ────────────────────────────────────────────────────────────
// This was a bare `setInterval(flush, 15_000)` that ran for the life of the tab. Two problems,
// both of them the staff queue's own lessons (public/panels/outbox.js) never applied here:
//
//  · A FIXED BEAT IS A RETRY STORM. Every phone in the restaurant holding a saved order hit the
//    server on the same 15-second tick, so a system that was merely struggling never got a quiet
//    moment to recover. Each round now waits longer than the last and each phone rolls its own
//    ±25%, so the load spreads instead of pulsing.
//  · IT NEVER STOPPED. It ticked forever even with an empty queue. Now a timer exists only while
//    something is actually waiting, and `ensureRetry()` guarantees one exists the moment anything
//    is saved — the "never leave saved work with nothing to send it" rule.
const RETRY_FIRST_MS = 5_000;    // one dropped request on a fine connection is the common case
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 120_000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryStep = 0;

function scheduleRetry(progressed?: boolean) {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (!queued.length) { retryStep = 0; return; }
  if (progressed) retryStep = 0;                       // the server answered → back to fast retries
  const base = retryStep === 0 ? RETRY_FIRST_MS : Math.min(RETRY_BASE_MS * Math.pow(2, retryStep - 1), RETRY_MAX_MS);
  const wait = Math.round(base * (0.75 + Math.random() * 0.5));
  retryStep = Math.min(retryStep + 1, 8);
  // A timer is kept even while the phone reports itself offline: flushGuestOutbox() returns
  // without touching the network in that case, and it means a connection that comes back WITHOUT
  // firing an "online" event (a Wi-Fi that never admitted it was down) still gets a retry.
  retryTimer = setTimeout(() => { retryTimer = null; void flushGuestOutbox(); }, wait);
}

/** There is a timer pending for whatever is in the queue — or there is about to be. */
function ensureRetry() {
  if (flushing) return;        // the running flush schedules the next round itself
  if (retryTimer) return;
  if (!queued.length) return;
  scheduleRetry();
}

// ── the public enqueue: called by the cart when offline ─────────────────────────
export async function enqueueGuestOrder(p: {
  mode: "session" | "public"; token?: string; table?: string; restaurantId?: string; restaurantSlug?: string;
  items: unknown[]; allergies: string[]; track?: GuestTrack; actionId?: string;
}): Promise<{ ok: true; queued: true; action_id: string; persisted: boolean }> {
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
  // Over the ceiling → move the OLDEST to the failed list (never silently delete it): it is the
  // one least likely to still be wanted, and the diner can see it and decide.
  while (queued.length > MAX_QUEUED) {
    const oldest = queued[0];
    await moveToFailed(oldest, "This one waited too long to send — please order it again if you still want it.");
  }
  // `persisted: false` = it is queued in memory and WILL send, but it did not reach this phone's
  // storage, so closing the tab loses it. The caller must word its message accordingly rather
  // than promising "we'll send it automatically" for something that can't survive a reload.
  const persisted = await persist(item);
  notify();
  // NEVER leave saved work with nothing to send it. Deliberately a scheduled retry rather than an
  // immediate flush: the two reasons an order lands here are "no signal" (nothing to try) and
  // "the restaurant's system just refused to answer" (trying again in the same breath is how a
  // struggling system is kept down). The first wait is short — see RETRY_FIRST_MS.
  ensureRetry();
  return { ok: true, queued: true, action_id: item.id, persisted };
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

// How many rounds of the same non-answer before it stops being a spinner and becomes the diner's
// decision. The staff queue has had this since 2026-08-01; the guest queue had NO counter at all,
// so an order the server kept refusing sat in "Waiting" for the life of the tab with the diner
// never told and no control to touch. Six rounds of the backoff above is roughly four minutes.
const SERVER_MAX_TRIES = 6;

// A CEILING ON WHAT ONE PHONE MAY HOLD. Nothing bounded this: a device left with no signal could
// pile up orders until IndexedDB refused, and the failure would land on the NEWEST order (the one
// the diner is watching) rather than the oldest. Well above any real basket count — a table that
// has genuinely placed 25 unsent orders has a different problem — and the OLDEST is dropped first,
// with the diner told, so nothing disappears quietly.
const MAX_QUEUED = 25;

export async function flushGuestOutbox() {
  if (flushing) return;                 // the running round schedules the next one itself
  if (!queued.length) { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } retryStep = 0; return; }
  // Reported offline → don't touch the network, but LEAVE A TIMER BEHIND. Returning bare here is
  // how a queue loses its last timer: the retry fires during a one-second blip, finds
  // `navigator.onLine === false`, gives up, and from then on nothing sends however good the
  // connection becomes — because a phone that never admitted it was down never fires "online"
  // either. (The staff queue was fixed for exactly this; the diner's had the same shape.)
  if (isOffline()) { scheduleRetry(false); return; }
  flushing = true;
  let progressed = false;
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
      if (res.ok && j?.ok && j.order_id) { progressed = true; recordActive(item, j.order_id as string); await removeItem(item.id); notify(); continue; }
      // Already placed on a prior sync whose reply we lost. The server echoes the original
      // order_id back with the duplicate, so we can still show it to the guest.
      //
      // A DUPLICATE THAT SAYS `ok:false` IS NOT A PLACED ORDER. It is the server replaying a
      // refusal it remembered (see lib/idempotency.ts). This branch used to remove those too, so
      // an order the diner had been promised would send simply vanished — no ticket, no entry in
      // their list, no message. Now it is surfaced like any other refusal.
      if (res.ok && j?.duplicate) {
        if (j.ok === false) { await moveToFailed(item, reasonMsg(j.reason)); notify(); continue; }
        progressed = true;
        if (j.order_id) recordActive(item, j.order_id as string);
        await removeItem(item.id); notify(); continue;
      }
      // A TRANSIENT server error (5xx — e.g. the route's 502 on a DB timeout/deadlock) is NOT a
      // business rejection: keep the order queued and let the backoff resend it rather than
      // marking it permanently failed. But NOT FOREVER IN SILENCE — after several rounds the
      // diner has to be able to see it and act, exactly as staff can.
      if (!res.ok && res.status >= 500) {
        item.tries = (item.tries || 0) + 1;
        if (item.tries < SERVER_MAX_TRIES) { await persist(item); break; }
        await moveToFailed(item, "The restaurant's system didn't take this one — please order again.");
        notify(); continue;
      }
      // Server accepted the call but rejected the order (state changed while offline),
      // or a hard 4xx → surface it instead of losing it.
      await moveToFailed(item, reasonMsg(j?.reason)); notify(); continue;
    }
  } finally {
    flushing = false;
    notify();
    scheduleRetry(progressed);
  }
}

export async function dismissGuestFailed(id: string) { await removeItem(id); notify(); }

/**
 * Put ONE failed order back in the queue and try it now. The diner had no way at all to do this —
 * the only control was "Dismiss", i.e. throw it away — so an order that failed for a reason that
 * has since passed (the system was busy, the kitchen un-sold-out the dish) could not be sent
 * without building the whole basket again.
 */
export async function retryGuestFailed(id: string) {
  const it = failed.find((x) => x.id === id);
  if (!it) return;
  failed = failed.filter((x) => x.id !== id);
  it.status = "queued"; it.error = undefined; it.tries = 0;
  // A person asking for a fresh go is asking for it NOW: reset the backoff too.
  retryStep = 0;
  queued.push(it);
  await persist(it);
  notify();
  ensureRetry();
  void flushGuestOutbox();
}

function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => { void flushGuestOutbox(); });
  window.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void flushGuestOutbox(); });
  idbAll().then((all) => {
    queued = all.filter((x) => x.status !== "failed").sort((a, b) => a.at - b.at);
    failed = all.filter((x) => x.status === "failed");
    notify();
    // An order restored from a previous session gets a timer too, not just a single attempt.
    ensureRetry();
    void flushGuestOutbox();
  });
}

// ── React hook for the connection badge ─────────────────────────────────────────
function subscribe(cb: () => void) { ensureStarted(); listeners.add(cb); return () => { listeners.delete(cb); }; }
function getSnapshot() { return snapshot; }
const EMPTY = { queued: [] as GuestOrder[], failed: [] as GuestOrder[], count: 0 };
function getServerSnapshot() { return EMPTY; }
export function useGuestOutbox() { return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot); }
