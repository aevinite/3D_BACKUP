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
  // WHAT this saved thing IS (improvement #4, 2026-08-06). The queue held orders only; calling a
  // waiter — the thing a diner does when something is WRONG, and the request most likely to come
  // from the corner with no bars — simply failed. Absent on rows written before this existed, so
  // it is read as "order" everywhere, which is what they are.
  // "leave" joined the two on 2026-08-30: a diner telling the restaurant they have left a table,
  // saved and sent by the phone exactly like an order, so a dead connection cannot leave a table
  // holding a head who walked out.
  kind?: "order" | "call" | "leave";
  reason?: string;                  // the waiter-call note ("kind" === "call")
  // The basket as a PERSON sees it — id AND name for each line (improvement #5). `items` carries
  // ids and `track.items` carries names, and pairing them by position would work only for as long
  // as both are built from the same array in the same order. That is exactly the kind of
  // assumption that quietly breaks a diner's order, so the pairing is stored once, explicitly.
  lines?: { id: string; title: string }[];
  // Set when the server refused this order because of ONE dish, so the phone can offer to send
  // the rest. Holds that dish's NAME, which is what the refusal names.
  blocked?: string;
  // …and its LINE ID where we could work it out. The name alone was not enough: `unknown_item`
  // answers with the dish's id (the row was not found, so there is nothing else to send), so
  // `blocked` held an id, `orderRestWithout` compared it against each line's TITLE, matched
  // nothing, and re-queued the whole basket unchanged — a button that visibly did something and
  // changed nothing, for ever. An id is what the basket is actually keyed by, so match on it.
  blockedId?: string;
  mode: "session" | "public";
  token?: string; table?: string; restaurantId?: string; restaurantSlug?: string;
  items: unknown[]; allergies: string[];
  track?: GuestTrack;
  at: number; status: "queued" | "failed"; error?: string;
  // Rounds of each kind of non-answer so far. All three are persisted with the order, so a
  // reload does not reset the count and an order cannot retry in silence forever.
  tries?: number;      // the server answered 5xx — see SERVER_MAX_TRIES
  netTries?: number;   // the request never completed (dropped / timed out) — NET_MAX_TRIES
  busyTries?: number;  // the server keeps saying it is still handling this id — BUSY_MAX_TRIES
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

/**
 * WHY AN ORDER WAS REFUSED, in words a diner can act on. THE ONE COPY.
 *
 * There were three: this one, `orderFailMsg` in SessionGate, and an inline pair of `if`s in
 * CartPanel. The two complete ones agreed; the third — the QR path, which is the busiest — knew
 * only `sold_out` and `staff_priced_item` and answered everything else with "please try again".
 * For `rate_limited` that is actively harmful advice: the diner taps again, trips the 8-per-minute
 * table limit again, and each trip pings the owner's phone with a "limit reached" alert about a
 * guest who was only doing what the app told them to. Wording lives here once so a new reason
 * added to the RPCs can only be missing in one place.
 */
export function reasonMsg(reason?: string, opts?: { dish?: string; queued?: boolean }): string {
  // `queued` = this order had been SAVED on the phone and is only being refused now, so the past
  // tense ("while you were offline") is the true sentence. A live refusal happens while the person
  // is standing at the screen, so it says what to do instead. Same code, two honest tenses.
  const q = opts?.queued;
  const dish = opts?.dish ? `“${opts.dish}”` : "";
  switch (reason) {
    case "session_closed": return q ? "Your table was closed while you were offline." : "This table has been closed — please ask your server.";
    case "not_approved": return q ? "You weren't approved to order on this table." : "You're not approved to order on this table yet.";
    case "blocked": return "This order was blocked — please ask a member of staff.";
    case "otp_required": return q ? "Phone verification was needed." : "Please confirm your phone number first.";
    case "invalid_token": return q ? "Your table session expired." : "Your table session has expired — please scan the code again.";
    case "sold_out": return q
      ? (dish ? `${dish} sold out while you were offline.` : "A dish sold out while you were offline.")
      : (dish ? `Sold out: ${dish} — please remove it to order.` : "A dish just sold out — please remove it to order.");
    // `dish` here is only ever a real NAME — see dishFor() below for why that matters on this
    // one reason in particular.
    case "unknown_item": return dish
      ? `${dish} is no longer on the menu — please remove it.`
      : "A dish is no longer on the menu — please remove it.";
    // mig 253: the dish is priced by staff at order time, so it cannot be self-ordered.
    case "staff_priced_item": return "One dish needs a member of staff — its price is set when you order, so please ask your server.";
    // mig 306: the dish was taken OFF the menu. Deliberately worded like unknown_item rather than
    // like sold_out — "sold out" would promise it is coming back, and hidden makes no such promise.
    case "hidden_item": return dish
      ? `${dish} isn't on the menu — please remove it to order.`
      : "A dish isn't on the menu any more — please remove it to order.";
    case "empty_order": return q ? "The order was empty." : "There's nothing in your order yet.";
    // The refusal that MUST never say "try again": doing so trips the same per-table limit and
    // fires another alert at the owner. Tell them to wait, which is the thing that actually works.
    case "rate_limited": return "That's a lot of orders in a row — please wait a moment, then order again.";
    case "server_busy": return "The restaurant's system couldn't take this one.";
    // A saved waiter call that sat too long. Telling the diner is the honest end: a waiter
    // arriving twenty minutes late for something nobody remembers is worse than not arriving.
    case "call_too_old": return "Your call for a server was too old to send — please call again if you still need someone.";
    case "unknown_restaurant": return "We couldn't tell which restaurant this order was for.";
    case "off_plan_table": return "That table number isn't one this restaurant has — please check it.";
    case "bad_body": return "Something was wrong with this order.";
    // The two size ceilings (T9 improvement 7, 2026-08-06). A real basket never reaches them, so the
    // wording assumes something went wrong on the phone rather than blaming the person's appetite —
    // and it tells them the one thing that works: ask a member of staff.
    case "order_too_big": return q
      ? "This saved order was too large to send — please ask a member of staff."
      : "That's too many items for one order — please send it in two, or ask a member of staff.";
    case "allergies_too_long": return "The allergy note was too long to send — please shorten it, or tell a member of staff.";
    // NEVER echo a code we don't have words for. An unrecognised reason is a machine word (or,
    // worse, a database message) and means nothing to a diner — say the honest general thing and
    // let the server log carry the detail.
    default: return q ? "Couldn't send this order — please order again." : "Order didn't go through — please try again.";
  }
}

/**
 * Pull the refusal CODE (and the dish it named) out of the Error that postGuestOrder throws.
 *
 * The two live paths were matching the PROSE of that message with `/sold_out/i.test(msg)` — the
 * thing the "never decide UI behaviour by pattern-matching a server's prose" rule exists to stop.
 * The code is right there in the string, so read it ONCE, here, and let every caller branch on a
 * code instead of a sentence. Kept beside reasonMsg because the two are only ever used together.
 */
export function refusalOf(err: unknown): { reason?: string; dish?: string } {
  const msg = String((err as Error)?.message || "");
  return {
    reason: (msg.match(/Order failed:\s*([a-z_]+)/) || [])[1],
    dish: (msg.match(/\(([^)]+)\)/) || [])[1],
  };
}

/**
 * THE DISH TO NAME IN A REFUSAL — a NAME, or nothing. Never an id.
 *
 * Every refusal that names a dish sends its TITLE (`lfh_price_order` → `v_mi.title` for
 * sold_out and price_required) except ONE: `unknown_item` fires precisely because the row was
 * not found, so all the server has left to send is the id it was asked for. On any restaurant
 * that isn't #1 that id is `<slug>__<8 hex>` (the tenant-namespaced id the editor route mints),
 * so the diner was reading:
 *
 *     “paneer-tikka__a1b2c3d4” is no longer on the menu — please remove it.
 *
 * — a machine string in front of a customer, and one that matches nothing on their screen, so
 * "please remove it" could not be acted on either. reasonMsg's own rule ("NEVER echo a code we
 * don't have words for") guarded the `reason` slot and not the `item` slot beside it.
 *
 * So the id is resolved against the basket the phone is still holding. If it maps to a dish the
 * diner can see, name that; if it doesn't, say the general sentence and name nothing.
 */
export function dishFor(
  reason: string | undefined,
  token: string | undefined,
  items?: ReadonlyArray<{ id?: string; title?: string } | unknown>,
): string | undefined {
  if (!token) return undefined;
  if (reason !== "unknown_item") return token;   // already a title
  const hit = (items || []).find((i) => String((i as { id?: string })?.id || "") === token);
  const title = (hit as { title?: string } | undefined)?.title;
  return title ? String(title) : undefined;
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

// ── THE SERVER MAY ASK FOR A LONGER WAIT (improvement I10, owner 2026-08-12) ─────────────────────
//
// The backoff above is the phone guessing. The SERVER knows things the phone cannot — how many
// replays are in flight, how long the database has been unhappy — so when it refuses with
// `server_busy` it now sends `retryAfter` (seconds) and this is where that lands.
//
// Deliberately only ever LENGTHENS the wait (`Math.max`): a server asking for more room always gets
// it, and a server asking for less can never talk a phone into hammering it faster than the local
// backoff already allows. Cleared as soon as anything succeeds, so one busy moment does not slow the
// queue down for the rest of the evening. Ignoring the field entirely — which every older build
// does — is exactly as correct as it was before, which is what makes this a hint and not a protocol.
let serverAskedWaitMs = 0;
const SERVER_WAIT_CAP_MS = 5 * 60_000;   // however busy it claims to be, we come back within 5 min

/** Record a `retryAfter` (seconds) from a server refusal. Ignores junk and absurd values. */
export function noteServerRetryAfter(seconds: unknown): void {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return;
  serverAskedWaitMs = Math.min(s * 1000, SERVER_WAIT_CAP_MS);
}

function scheduleRetry(progressed?: boolean) {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (!queued.length) { retryStep = 0; serverAskedWaitMs = 0; return; }
  if (progressed) { retryStep = 0; serverAskedWaitMs = 0; }   // the server answered → back to fast retries
  const base = retryStep === 0 ? RETRY_FIRST_MS : Math.min(RETRY_BASE_MS * Math.pow(2, retryStep - 1), RETRY_MAX_MS);
  // The phone's own jittered backoff, or the server's request — whichever is longer.
  const wait = Math.max(Math.round(base * (0.75 + Math.random() * 0.5)), serverAskedWaitMs);
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
  lines?: { id: string; title: string }[];
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

/**
 * SAVE A WAITER CALL FOR LATER (improvement #4).
 *
 * Same machinery as a saved order — same at-most-once id, same backoff, same "never leave saved
 * work with nothing to send it" timer — so there is one queue to reason about rather than two.
 * The one thing that differs is that a call GOES STALE: `STALE_CALL_MS` on both sides.
 */
export async function enqueueGuestCall(p: {
  mode: "session" | "public"; token?: string; table?: string; restaurantId?: string; restaurantSlug?: string;
  reason?: string; actionId?: string;
}): Promise<{ ok: true; queued: true; action_id: string; persisted: boolean }> {
  ensureStarted();
  const { actionId, ...rest } = p;
  // ONE RAISED HAND, NOT SIX. Saved ORDERS are capped at MAX_QUEUED because each one is a
  // different order and they all matter; a CALL is not like that — pressing the bell five times
  // in a dead spot means one thing, and delivering five of them on reconnect sends a waiter over
  // for a table that asked once. Nothing bounded this at all before, so a diner tapping the bell
  // could fill the phone's storage until it refused, and that refusal lands on the NEWEST tap.
  //
  // So a still-unsent call for the same table/session simply keeps its place and takes the newer
  // note — the diner's most recent words — instead of queuing beside it. The at-most-once id is
  // kept too, so a call already in flight can't ring twice.
  const sameTable = (x: GuestOrder) =>
    isCall(x) && x.mode === p.mode && String(x.table || "") === String(p.table || "") && String(x.token || "") === String(p.token || "");
  const already = queued.find(sameTable);
  if (already) {
    already.at = Date.now();
    if (p.reason) already.reason = p.reason;
    const kept = await persist(already);
    notify();
    ensureRetry();
    return { ok: true, queued: true, action_id: already.id, persisted: kept };
  }
  const item: GuestOrder = {
    id: actionId || uuid(), kind: "call", status: "queued", at: Date.now(),
    ...rest, restaurantSlug: p.restaurantSlug || tenantSlug(), items: [], allergies: [],
  };
  queued.push(item);
  // …and the same ceiling every other saved thing has, for a phone that somehow gets past the
  // collapse above (several tables on one device, a browser that lost the queue mid-write).
  while (queued.length > MAX_QUEUED) {
    const oldest = queued[0];
    await moveToFailed(oldest, "This one waited too long to send — please ask a member of staff if you still need someone.");
  }
  const persisted = await persist(item);
  notify();
  ensureRetry();
  return { ok: true, queued: true, action_id: item.id, persisted };
}

// A saved call older than this is not worth delivering — see the same constant on the server
// (app/api/guest/call-waiter/route.ts). Caught here first so a stale one never leaves the phone.
const STALE_CALL_MS = 10 * 60 * 1000;

// How long ONE send may wait for an answer before we treat it as "no answer" and let the
// backoff try again. This was missing entirely, and it was the one write path in the app with
// no deadline (the staff queue has had one since 2026-08-01, and the diner's ONLINE order got
// one at the same time — see lib/menu.ts orderDeadline). A browser fetch has no timeout of its
// own, so on a connection that HANGS rather than drops — a café Wi-Fi with a dead uplink, which
// is exactly what this queue exists for — the await below never settled. `flushing` then stayed
// true forever, which made ensureRetry() a no-op and made every wake-up ('online',
// visibilitychange, the diner tapping Try again) return at the top of flushGuestOutbox. The
// queue was wedged with NO timer pending: the order never went and nothing on screen changed.
// Same 15s as the staff twin, and for the same reason — a route can make two or three database
// calls of up to 8s, so anything shorter would abandon writes that were about to succeed.
const SEND_TIMEOUT_MS = 15_000;
// Guarded, not assumed: `AbortSignal.timeout` is recent and READING it throws on an older
// phone. lib/menu.ts was bitten by exactly that (the throw was caught and mis-reported as "the
// restaurant is busy"), so do what it now does and fall back to no signal rather than break.
function sendDeadline(): AbortSignal | undefined {
  try {
    return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(SEND_TIMEOUT_MS)
      : undefined;
  } catch { return undefined; }
}

const isCall = (it: GuestOrder) => it.kind === "call";
const isLeave = (it: GuestOrder) => it.kind === "leave";

/**
 * THE LIST THAT ACTUALLY HAS NAMES ON IT.
 *
 * `items` is the payload built for the SERVER — `{id, qty, options, removed, note}` — and it
 * carries no title at all, by design (the server prices and names everything itself; nothing
 * about a dish is trusted from the phone). `lines` is the same basket as a PERSON sees it,
 * `{id, title}`.
 *
 * Every dishFor() call in this file was handed `items`, so the id could never resolve to a name
 * and a saved order refused with `unknown_item` fell back to "A dish is no longer on the menu"
 * — while the name sat one field away on the same row. Older rows (saved before `lines` existed,
 * and every session order until 2026-08-12) have no `lines`, so fall back to `items`: that
 * cannot resolve a name either, but it is exactly the behaviour those rows had before.
 */
const namedLines = (it: GuestOrder): ReadonlyArray<{ id?: string; title?: string } | unknown> =>
  (it.lines && it.lines.length ? it.lines : it.items);

/**
 * WHICH LINE of the basket the server refused, as an ID.
 *
 * `unknown_item` answers with the id itself; `sold_out` and `hidden_item` answer with the title,
 * so the id has to come back off the basket. Returns undefined when we genuinely cannot tell —
 * and `orderRestWithout` then refuses to guess rather than re-sending the same basket.
 */
function blockedLineId(it: GuestOrder, reason?: string, token?: string): string | undefined {
  const t = String(token || "").trim();
  if (!t) return undefined;
  if (reason === "unknown_item") return t;   // the token IS the id on this one
  const hit = (it.lines || []).find((l) => String(l.title || "").trim().toLowerCase() === t.toLowerCase());
  return hit?.id;
}

function doPost(item: GuestOrder) {
  if (isLeave(item)) {
    return fetch("/api/guest/leave", {
      method: "POST",
      signal: sendDeadline(),
      headers: { "Content-Type": "application/json", "X-LFH-Action-Id": item.id },
      body: JSON.stringify({ token: item.token, restaurantId: item.restaurantId }),
    });
  }
  if (isCall(item)) {
    return fetch("/api/guest/call-waiter", {
      method: "POST",
      signal: sendDeadline(),
      headers: {
        "Content-Type": "application/json",
        "X-LFH-Action-Id": item.id,      // rings the floor ONCE however many times this is sent
      },
      // `at` is when the DINER TAPPED, not when the phone got round to it — the server refuses a
      // call that has gone stale, because a waiter walking over for something nobody remembers is
      // worse than not going.
      body: JSON.stringify({ mode: item.mode, token: item.token, table: item.table, restaurantId: item.restaurantId, reason: item.reason, at: item.at }),
    });
  }
  return fetch("/api/guest/place-order", {
    method: "POST",
    signal: sendDeadline(),
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

// The OTHER two ways a saved order can stop moving. The 5xx case above was bounded; these two
// were not — each simply `break`ed out of the loop with no counter, so the backoff kept trying
// for the life of the tab and the diner was never told and given nothing to tap. The staff queue
// bounds all three (AUTH/BUSY/NET_MAX_TRIES in public/panels/outbox.js) precisely because "a
// change stuck in waiting is the worst place for it" — a row that is merely Waiting has no
// buttons. Six rounds of the backoff is roughly four minutes, matching SERVER_MAX_TRIES.
const NET_MAX_TRIES = 6;    // the request itself never completed (dropped, or hit the deadline)
const BUSY_MAX_TRIES = 6;   // the server keeps answering 409 "still handling this id"

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
    // WALK THE QUEUE — one stuck order must not hold the next (improvement #6).
    //
    // This took queued[0] and `break`ed, so a second basket could not go until the first had spent
    // all six of its rounds (about four minutes) — and the diner, who had just re-ordered BECAUSE
    // the first seemed not to work, watched both sit still.
    //
    // Skipping is safe here in a way it is not for staff edits: two baskets are independent
    // ORDERS, not two changes to one value. Each becomes its own ticket, so the only thing
    // reordering costs is which one gets the lower ticket number. A staff discount landing after a
    // payment would be wrong; a second order landing first is merely a different order of service.
    let idx = 0;
    while (idx < queued.length && !isOffline()) {
      const item = queued[idx];
      // Too old to be worth ringing the floor for — say so instead of sending it.
      // They re-joined the very table this leave was for — drop it rather than throw them out.
      if (leaveIsStale(item)) { await removeItem(item.id); notify(); continue; }
      if (isCall(item) && Date.now() - (item.at || 0) > STALE_CALL_MS) {
        // `queued: true` like every other refusal that reaches this file: it is a SAVED thing being
        // turned down later, and the guard in verify:order-retry holds the whole queue to that.
        await moveToFailed(item, reasonMsg("call_too_old", { queued: true }));
        notify(); continue;
      }
      let res: Response;
      try { res = await doPost(item); }
      catch {
        // The request never completed: genuinely offline, dropped, or it hit the deadline above.
        if (isOffline()) break;                          // no signal → stop, keep the queue; that is what it is for
        // ONLINE and still not getting through. This used to `break` with no counter, so it
        // retried in silence for the life of the tab: the order sat on "Waiting" with the diner
        // never told and nothing to tap. Bounded now, exactly like the staff queue.
        item.netTries = (item.netTries || 0) + 1;
        if (item.netTries < NET_MAX_TRIES) { await persist(item); idx++; continue; }
        await moveToFailed(item, "We couldn't reach the restaurant — please order again.");
        notify(); continue;
      }
      // Read the body ONCE: the old code parsed it inside the 409 branch and then again
      // below, where the already-consumed stream yielded null — so a clash message never
      // reached the guest.
      const j = await res.json().catch(() => null) as
        | { ok?: boolean; order_id?: string; duplicate?: boolean; reason?: string; item?: string; retry?: boolean; retryAfter?: number; clash?: { plain?: string } }
        | null;
      // THE SERVER MAY ASK FOR MORE ROOM (improvement I10). Read before any branch below returns,
      // so a refusal that carries the hint still lengthens the next wait — that is the whole point:
      // the hint arrives ON the refusal that proves the server is struggling.
      if (j?.retryAfter != null) noteServerRetryAfter(j.retryAfter);
      // Idempotency says a request under this id is in flight → wait and try again. A stale claim
      // is taken over after 30s (lib/idempotency.ts), so if it KEEPS saying this something is
      // wrong and the diner has to hear about it rather than watch "Waiting" all evening. This
      // also used to `break` forever with no counter.
      if (res.status === 409 && j?.retry) {
        item.busyTries = (item.busyTries || 0) + 1;
        if (item.busyTries < BUSY_MAX_TRIES) { await persist(item); idx++; continue; }
        await moveToFailed(item, "The restaurant's system is still busy with this one — please order again.");
        notify(); continue;
      }
      if (res.status === 409 && j?.clash?.plain) {          // the table moved on while offline
        await moveToFailed(item, j.clash.plain); notify(); continue;
      }
      // A CALL succeeds with no order_id — there is nothing to track, the floor just knows.
      if (res.ok && j?.ok && (isCall(item) || isLeave(item))) { progressed = true; await removeItem(item.id); notify(); continue; }
      if (res.ok && j?.ok && j.order_id) { progressed = true; recordActive(item, j.order_id as string); await removeItem(item.id); notify(); continue; }
      // Already placed on a prior sync whose reply we lost. The server echoes the original
      // order_id back with the duplicate, so we can still show it to the guest.
      //
      // A DUPLICATE THAT SAYS `ok:false` IS NOT A PLACED ORDER. It is the server replaying a
      // refusal it remembered (see lib/idempotency.ts). This branch used to remove those too, so
      // an order the diner had been promised would send simply vanished — no ticket, no entry in
      // their list, no message. Now it is surfaced like any other refusal.
      if (res.ok && j?.duplicate) {
        if (j.ok === false) { await moveToFailed(item, reasonMsg(j.reason, { queued: true, dish: dishFor(j.reason, j.item, namedLines(item)) })); notify(); continue; }
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
        if (item.tries < SERVER_MAX_TRIES) { await persist(item); idx++; continue; }
        await moveToFailed(item, "The restaurant's system didn't take this one — please order again.");
        notify(); continue;
      }
      // Server accepted the call but rejected the order (state changed while offline),
      // or a hard 4xx → surface it instead of losing it.
      // `queued: true` because EVERY refusal that reaches this file is a saved order being turned
      // down later — so the diner reads why the order they placed never arrived ("your table was
      // closed while you were offline") instead of an instruction aimed at someone standing at the
      // screen right now ("please ask your server"). The two live paths pass no flag and get the
      // present tense, which is correct for them.
      // NAME THE DISH where the server named one. This passed no dish at all, so a saved order
      // refused for a sold-out dish read "A dish sold out while you were offline" when the
      // server had told us exactly which one. dishFor() keeps an id out of the sentence.
      // ONE DISH IS THE PROBLEM, not the basket (improvement #5). sold_out / hidden_item /
      // unknown_item all name a single dish, and the whole order was thrown away for it — a table
      // of six losing everything because one dish ran out, and rebuilding the basket by hand.
      // Remember which line it was so the phone can offer to send the rest.
      const oneDish = dishFor(j?.reason, j?.item, namedLines(item));
      if (oneDish && ["sold_out", "hidden_item", "unknown_item"].includes(String(j?.reason))) {
        item.blocked = oneDish;
        item.blockedId = blockedLineId(item, j?.reason, j?.item);
      }
      await moveToFailed(item, reasonMsg(j?.reason, { queued: true, dish: oneDish })); notify(); continue;
    }
  } finally {
    flushing = false;
    notify();
    scheduleRetry(progressed);
  }
}

export async function dismissGuestFailed(id: string) { await removeItem(id); notify(); }

/**
 * TAKE BACK A REQUEST FOR STAFF THAT HAS NOT GONE YET (owner picked this, 2026-08-30).
 *
 * WHERE THE LINE SITS, AND WHY IT IS HERE AND NOT ROUND AN ORDER. A saved ORDER deliberately has no
 * cancel: by the time a diner looks at it, the kitchen may already hold it — the reply is what was
 * lost, not the order — and throwing it away would destroy real work. Nobody has cooked a glass of
 * water. A queued CALL has not rung anything yet; it is a bell that has not been pressed.
 *
 * So this refuses anything that is not a call, by kind, rather than trusting the caller — the UI
 * only offers the button on a call, but a guard that depends on a render is not a guard.
 *
 * It also refuses a call that is no longer QUEUED. One already moved to `failed` is handled by
 * "Remove"; one already sent is gone from the list entirely. Returning a reason rather than a bare
 * false lets the screen say something true instead of going quiet — the tap-in-silence rule.
 */
/**
 * SAVE "I'VE LEFT THIS TABLE" AND SEND IT WHEN THE SIGNAL RETURNS (owner picked this, 2026-08-30).
 *
 * Only ONE leave per token can be waiting: leaving twice is the same fact, and a second row would
 * just be a second request for the restaurant to answer.
 */
export async function enqueueGuestLeave(p: {
  token: string; restaurantId?: string; restaurantSlug?: string; actionId?: string;
}): Promise<{ ok: true; queued: true; action_id: string; persisted: boolean }> {
  ensureStarted();
  const existing = queued.find((x) => isLeave(x) && String(x.token || "") === String(p.token || ""));
  if (existing) {
    const kept = await persist(existing);
    notify(); ensureRetry();
    return { ok: true, queued: true, action_id: existing.id, persisted: kept };
  }
  const item: GuestOrder = {
    id: p.actionId || uuid(), kind: "leave", status: "queued", at: Date.now(),
    token: p.token, mode: "session", restaurantId: p.restaurantId,
    restaurantSlug: p.restaurantSlug || tenantSlug(), items: [], allergies: [],
  };
  queued.push(item);
  while (queued.length > MAX_QUEUED) {
    const oldest = queued[0];
    await moveToFailed(oldest, "This one waited too long to send — please tell a member of staff if it still matters.");
  }
  const persisted = await persist(item);
  notify(); ensureRetry();
  return { ok: true, queued: true, action_id: item.id, persisted };
}

/**
 * THE ONE DECISION THIS FEATURE NEEDED, AND THE ANSWER (owner asked what should happen, 2026-08-30).
 *
 * What if the diner RE-JOINS the same table before the saved "I've left" has gone? Sending it then
 * would throw them out of the table they are now sitting at — the app would undo something the
 * person has just done, on their behalf, with no way to see it coming. So a saved leave is DROPPED
 * the moment this device holds a live session on the same token again.
 *
 * Checked at send time rather than on rejoin, because the rejoin can happen while the tab is shut.
 */
function leaveIsStale(it: GuestOrder): boolean {
  if (!isLeave(it)) return false;
  try {
    const raw = tgetFor("lfh_session", it.restaurantSlug || tenantSlug());
    if (!raw) return false;
    const s = JSON.parse(raw) as { token?: string };
    return !!s?.token && s.token === it.token;   // they are back on the very session they left
  } catch { return false; }
}

export async function cancelQueuedCall(id: string): Promise<{ ok: boolean; reason?: "not_found" | "not_a_call" }> {
  const it = queued.find((x) => x.id === id);
  if (!it) return { ok: false, reason: "not_found" };
  if (!isCall(it)) return { ok: false, reason: "not_a_call" };
  await removeItem(id);
  notify();
  return { ok: true };
}

/**
 * SEND THE REST OF THE BASKET, WITHOUT THE DISH THAT WAS REFUSED (improvement #5).
 *
 * A saved order refused because ONE dish sold out used to cost the diner the whole basket: a table
 * of six lost everything for one item and had to build it again from scratch, on a phone, having
 * already waited. Everything needed to do better is already on the device — the lines, their names
 * and the id they were saved under — so this drops the offending line and queues what is left.
 *
 * A NEW at-most-once id on purpose: this is a DIFFERENT order from the one the server refused, and
 * reusing the old id would let the server's memory of that refusal answer for it.
 */
export async function orderRestWithout(id: string): Promise<{ ok: boolean; left: number }> {
  const it = failed.find((x) => x.id === id);
  if (!it || !it.blocked) return { ok: false, left: 0 };
  const allLines = it.lines || [];
  // DROP BY ID WHERE WE HAVE ONE. Matching on the NAME was the whole bug: `unknown_item` puts an
  // id in `blocked`, so the comparison never matched, nothing was dropped, and the "rest" that got
  // re-queued was the identical basket — refused again for the identical reason, for ever. Names
  // are also not unique; ids are what the basket is keyed by.
  const dropName = String(it.blocked).trim().toLowerCase();
  const keptLines = it.blockedId
    ? allLines.filter((l) => l.id !== it.blockedId)
    : allLines.filter((l) => String(l.title || "").trim().toLowerCase() !== dropName);
  // NOTHING WAS ACTUALLY DROPPED → we could not identify the line, so do not re-send the same
  // basket. This is the guard that makes the button honest: it either removes something or says
  // it can't, and it never quietly re-queues an order the server has already turned down.
  if (keptLines.length === allLines.length) return { ok: false, left: 0 };
  const keptIds = new Set(keptLines.map((l) => l.id));
  const keptItems = (it.items || []).filter((x) => keptIds.has(String((x as { id?: string })?.id || "")));
  // Nothing left, or we cannot tell the lines apart → don't guess at a diner's order.
  if (!keptLines.length || !keptItems.length) return { ok: false, left: 0 };
  // THE DINER'S OWN SUMMARY MUST KEEP THE REAL QUANTITIES. This rebuilt every line as "1 ×", so
  // someone who ordered three coffees and lost one dish then watched a tracker saying "1 × Coffee".
  // The order reaching the kitchen was always right; only the diner's copy of it was wrong, which
  // is the worst place to be wrong quietly. The quantities are on `keptItems`, keyed by the same id.
  const qtyOf = (lineId: string) => {
    const line = keptItems.find((x) => String((x as { id?: string })?.id || "") === lineId) as { qty?: unknown } | undefined;
    const n = Number(line?.qty);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };
  await removeItem(it.id);
  await enqueueGuestOrder({
    mode: it.mode, token: it.token, table: it.table, restaurantId: it.restaurantId, restaurantSlug: it.restaurantSlug,
    items: keptItems, allergies: it.allergies || [], lines: keptLines,
    track: { ...(it.track || {}), itemCount: keptItems.length, items: keptLines.map((l) => ({ title: l.title, qty: qtyOf(l.id) })) },
  });
  notify();
  void flushGuestOutbox();
  return { ok: true, left: keptItems.length };
}

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
  // A person asking for a fresh go is asking for a FRESH go: clear all three attempt counters,
  // not just the 5xx one. Resetting only `tries` left the other two at their ceiling, so one tap
  // of Try again bought a single attempt and the order fell straight back into "Couldn't send".
  it.status = "queued"; it.error = undefined; it.tries = 0; it.netTries = 0; it.busyTries = 0;
  retryStep = 0;                       // …and reset the backoff, so it goes now rather than in two minutes
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
  // …and FOCUS, the fourth signal the staff queue has always had. It overlaps heavily with
  // visibilitychange on a phone, but not completely: unlocking a phone with this tab already
  // visible fires focus and not visibilitychange, and that is precisely the moment a diner picks
  // their phone back up to see whether the order went. Costs one extra flush attempt per unlock,
  // and flushGuestOutbox returns immediately when there is nothing queued.
  window.addEventListener("focus", () => { void flushGuestOutbox(); });
  // DON'T CREATE A DATABASE ON A PHONE THAT NEVER QUEUES ANYTHING (improvement #17).
  // Measured on the deployed site: `lfh_guest_outbox` existed after a plain menu visit, because
  // the connection badge subscribes on mount and the restore pass opened it. Harmless, but every
  // diner's phone gained a database it would never use.
  //
  // The obvious fix — a localStorage "this device has queued before" marker — is the WRONG one:
  // clear site data selectively, or have the marker evicted on its own, and a genuinely saved
  // order would never be restored. Losing a diner's order to save an empty database is a bad
  // trade. `indexedDB.databases()` answers the question without creating anything, so we only
  // open when there is really something to restore. Where it isn't supported (Firefox) we do
  // exactly what we did before, which is the safe direction.
  void (async () => {
    try {
      const list = (indexedDB as { databases?: () => Promise<{ name?: string }[]> }).databases;
      if (typeof list === "function") {
        const dbs = await list.call(indexedDB);
        if (Array.isArray(dbs) && !dbs.some((d) => d?.name === DB_NAME)) {
          notify();          // nothing was ever saved on this device — publish the empty snapshot and stop
          return;
        }
      }
    } catch { /* can't tell → fall through and open it, exactly as before */ }
    restoreQueue();
  })();
}

/** Read back whatever this device saved in an earlier session and get it moving again. */
function restoreQueue() {
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
