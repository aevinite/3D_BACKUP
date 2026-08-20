// kitchen/ui/app.js — the kitchen screen's brain. Polls the live board every
// 2 seconds and draws orders as big KOT tickets in three columns: New (VIEW ONLY
// — the waiter accepts, not the kitchen), Cooking (tick each dish ready), Ready
// (recently finished, for glory).
// Also: the 86 board (sold-out toggles with an UNDO toast — kitchens move fast,
// so no confirm dialog; a 6-second undo is safer than a popup mid-rush) and a
// chime when a brand-new order lands (mutable, remembered per device).

// REJECTED (owner, 2026-07-29, re-confirmed 2026-08-05 and 2026-08-07): the KITCHEN HAS NO PROFILE.
// His words on 2026-08-07 — "Kitchen panel will not have profile or stuff like that. I have already
// told this." So this flag stops maint.js injecting its everyday "👤 Profile" button into this bar.
// It is the same mechanism the waiter tablet uses, and it must be set BEFORE maint.js's async init.
// A cook keeps their login, their PIN and their action log; there is no profile, no pay record and no
// button that says Profile. `lib/staffProfileShared.ts` PROFILE_ROLES already excludes kitchen — this
// closes the last door that still said the word. Do not add one back, and do not offer it as an
// "improvement": see docs/REJECTED-IDEAS.md → R7. (maint.js still shows the ONE-TIME "👋 Finish
// setup" capture, which is a LOGIN thing — name/phone for PIN reset — not a profile.)
window.LFH_SUPPRESS_SETTINGS_BTN = true;
// ...and NOTHING AT ALL from maint.js's profile side, including the one-time "👋 Finish setup"
// card (settled 2026-08-08). The flag above only hides the everyday button; this one means the
// kitchen has no profile surface whatsoever, which is what he actually said. A cook's name and
// phone are set by the owner on the staff screen if they are wanted; the card never appears here.
window.LFH_NO_PROFILE_AT_ALL = true;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// __lfhPerf: cheap, always-on render counters — IDENTICAL to the manager's and the waiter
// tablet's, which have had them since the 300-table freeze work (owner perf 2026-06-27). The
// KITCHEN had none, despite carrying the same incremental-patch design (reconcileList) and the
// same rush-hour freeze history: "the kitchen froze at dinner" could only ever be answered with a
// theory. Read it from the panel console at any time as `__lfhPerf`.
//   fullRenders  — whole-board paints (render → renderColumns/renderWall)
//   patches      — how many tickets those paints actually REPLACED (the rest were reused in place;
//                  a healthy rush shows paints with very few replacements)
//   tilesPatched — cumulative replaced tickets, so a rebuild-everything regression shows up as
//                  patches climbing in step with the ticket count
//   lastMs       — how long the most recent paint took
//   longTasks    — main-thread tasks over 50ms, i.e. the freeze symptom itself
// Costs nothing: no network, no storage, invisible to a cook, and the observer no-ops where the
// API is unavailable.
window.__lfhPerf = window.__lfhPerf || { fullRenders: 0, patches: 0, tilesPatched: 0, lastMs: 0, longTasks: 0 };
try {
  if (typeof PerformanceObserver === "function") {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.duration > 50) window.__lfhPerf.longTasks++; })
      .observe({ entryTypes: ["longtask"] });
  }
} catch {}

const state = { orders: [], items: [], dishes: [], platform: [], platformAccept: false, tableNames: {}, tableTags: {}, knownIds: null, muted: localStorage.getItem("kds_muted") === "1" };
// Platform (Zomato/Swiggy/Website/Parcel) source badges shown on a platform ticket.
const PLAT_META = {
  zomato:   { label: "ZOMATO",  cls: "z" },
  swiggy:   { label: "SWIGGY",  cls: "s" },
  takeaway: { label: "WEBSITE", cls: "t" }, // the restaurant's own site (mig 209)
  parcel:   { label: "PARCEL",  cls: "p" }, // staff counter parcel — never "Takeaway"
  other:    { label: "PLATFORM", cls: "o" },
};
// Which layout the cook is using: "columns" (New/Cooking/Ready) or "wall" (every
// live order at once, oldest first — the "expansion"). Persisted per device.
let view = localStorage.getItem("kds_view") === "wall" ? "wall" : "columns";

// ── tiny helpers ─────────────────────────────────────────────────────────────
// PER-TAB restaurant pin (ADMIN "view as" only): ?rid= comes in via the iframe URL and
// is echoed on every API call so this tab never shifts restaurants when the admin opens
// another restaurant's panel (the act-as cookie is browser-wide — owner bug, 2026-07-03).
// Empty for real staff logins; the server ignores it for them.
const PANEL_RID = new URLSearchParams(location.search).get("rid") || "";
// ACTUAL-VIEW toggle (owner, 2026-07-28): ?view=real on an admin-view tab makes whoami
// answer as the real kitchen screen. Per-tab like ?rid, echoed on every call.
const PANEL_VIEW_REAL = PANEL_RID && new URLSearchParams(location.search).get("view") === "real";
// VISIT-A-PERSON'S-PANEL (owner, 2026-08-02): ?as=<staff id> on an admin-view tab —
// opened from that kitchen login's profile. The KDS has no per-person settings, so this
// only names whose screen it is (and implies the real view). Re-checked server-side.
const PANEL_AS = PANEL_RID ? (new URLSearchParams(location.search).get("as") || "") : "";
const ridQ = (path) => {
  if (!PANEL_RID) return path;
  path += (path.includes("?") ? "&" : "?") + "rid=" + encodeURIComponent(PANEL_RID);
  if (PANEL_VIEW_REAL) path += "&view=real";
  if (PANEL_AS) path += "&as=" + encodeURIComponent(PANEL_AS);
  return path;
};
// ── A DEVICE THE STAFF HAVE BLOCKED SHOWS NOTHING AT ALL (owner, 2026-08-18) ─────────────────────
//
// Blocking a device used to take away its BUTTONS and leave the board on screen: every write on
// /api/<panel> has checked the block list since it shipped, but the READ never did — so a screen
// somebody had deliberately blocked carried on showing live tickets, and the only way to silence it
// was to pull it off the wifi. His answer when it was put to him was one line — **"do 9th goees
// completely black"** — so it does.
//
// The server refuses the board read with `reason: "device_blocked"` (a CODE — this panel branches on
// codes, never on wording, so the sentence can change without breaking the wall). This paints over
// the whole viewport, once, and never takes it down. There is no retry and nothing to dismiss: the
// point of a block is that this screen stops being a working screen until staff lift it.
//
// AND IT STOPS THE DEVICE TALKING. `blockedWallUp` is checked at the top of api() below, so the very
// next call short-circuits before it reaches the network. Without that the panel would sit behind a
// black screen re-asking for a board it can never have — every few seconds, for the rest of the
// shift — which is the flavour of pointless traffic the egress rules exist to stop, and it would
// fill the error log with a refusal nobody needs told twice.
//
// Plain words, and no detail: it says who to ask, and nothing about why. The person holding the
// tablet is not always the person the block is about.
let blockedWallUp = false;
function showBlockedWall() {
  if (blockedWallUp) return;
  blockedWallUp = true;
  const w = document.createElement("div");
  w.id = "lfh-blocked-wall";
  w.setAttribute("role", "alertdialog");
  w.setAttribute("aria-label", "This device has been blocked");
  // Inline styles on purpose: a blocked screen must go dark even if the panel's stylesheet is the
  // thing that failed to load, and this is the one overlay that cannot afford to depend on CSS.
  w.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#000;color:#e5e7eb;"
    + "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;"
    + "text-align:center;padding:28px;font-family:system-ui,sans-serif;-webkit-user-select:none;user-select:none";
  const icon = document.createElement("div");
  icon.textContent = "\u26D4";
  icon.style.cssText = "font-size:56px;line-height:1";
  const head = document.createElement("div");
  head.textContent = "This device has been blocked";
  head.style.cssText = "font-size:21px;font-weight:800;letter-spacing:.01em";
  const sub = document.createElement("div");
  sub.textContent = "Ask a manager to unblock it.";
  sub.style.cssText = "font-size:14.5px;color:#94a3b8;max-width:34ch;line-height:1.55";
  w.appendChild(icon); w.appendChild(head); w.appendChild(sub);
  document.body.appendChild(w);
  // If a timer that was already in flight paints an overlay after us, put the wall back in front.
  // Only when something genuinely landed on top — never an unconditional re-append every tick.
  setInterval(() => { if (document.body.lastElementChild !== w) document.body.appendChild(w); }, 3000);
}
const blockedError = () => { const e = new Error("This device has been blocked by staff."); e.status = 403; e.blocked = true; return e; };

const api = async (method, path, body, opts) => {
  // Blocked by staff → this device has stopped being a working screen. Refuse before the network,
  // so a walled panel never asks for anything again (see showBlockedWall above).
  if (blockedWallUp) throw blockedError();
  // Writes go through the offline outbox (sent now if online, else saved + replayed
  // on reconnect, at-most-once). GETs stay a plain fetch. Same contract as before.
  if (method !== "GET" && window.LFH_OUTBOX) {
    // `expect` travels as X-LFH-Expect so the server can refuse rather than overwrite a change
    // another screen made in the meantime. The kitchen's writes are all one-way transitions
    // today (accept / ready / sold-out), so nothing passes it yet — but the parameter has to
    // EXIST, or a value edit added here later is silently unprotectable and no guard would say so.
    return window.LFH_OUTBOX.send({ base: "/api/kitchen", method, path: ridQ(path), body, panel: "kitchen", expect: opts && opts.expect, table: opts && opts.table });
  }
  // Was the offline layer in charge when this read STARTED? On a device's first visit it is not,
  // so nothing it fetched in that window was ever saved — see public/panels/swreg.js.
  const uncontrolled = !(navigator.serviceWorker && navigator.serviceWorker.controller);
  const url = "/api/kitchen" + ridQ(path);
  let r;
  try {
    r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  } catch (netErr) {
    netErr.offline = true; // no reply at all → offline, not a broken server
    throw netErr;
  }
  if (r.status === 401) { location.href = "/login"; throw new Error("login"); }
  // Live reply or the device's saved copy? The offline bar needs to know.
  if (window.LFH_OFF) window.LFH_OFF.noteResponse(r);
  const j = await r.json().catch(() => null);
  // Blocked by staff → the whole screen goes dark and stays dark (see showBlockedWall above).
  if (r.status === 403 && j && j.reason === "device_blocked") { showBlockedWall(); throw blockedError(); }
  if (!r.ok) { const e = new Error((j && j.error) || r.statusText); e.status = r.status; e.offline = (j && j.offline === true) || r.headers.get("X-LFH-Offline") === "1"; e.busy = (j && j.busy === true) || r.headers.get("X-LFH-Busy") === "1"; throw e; }
  // Hand a first-visit read to the offline layer, so the kitchen board opens with no internet
  // on the SAME shift it was first opened. No second request — the body is already here.
  if (uncontrolled && method === "GET" && j && window.LFH_WARM) {
    try { window.LFH_WARM.data(new URL(url, location.origin).href, JSON.stringify(j)); } catch (e) { /* best effort */ }
  }
  return j;
};
// ── table naming (mig 131) ───────────────────────────────────────────────────
// The restaurant's OWN name for a table ("A1", "Patio"), from settings.table_names.
// Empty string when that table has no name, so callers fall back to the number.
const tname = (t) => (((state.tableNames || {})[String(t)]) || "").trim();
// What a cook should READ for table t. The floor name wins whenever there is one:
// if the owner renamed table 1 to "A1", the ticket and the printed KOT must say "A1",
// because that is what is written on the table (owner 2026-07-29). No name → the plain
// number. Display only — every id/bill still uses the number.
const tshort = (t) => tname(t) || `T${t}`;              // tight spots (ticket header)
// T7, never "Table 7" (owner, 2026-08-05: "it should always be T7"). A table with a NAME set
// shows the name instead. One short form everywhere — panels, tickets and the printed bill.
const tlong = (t) => (t == null || t === "" ? "T?" : (tname(t) || `T${t}`)); // prints, toasts
// WHERE a ticket is for. There is deliberately NO parcel case here (T4 sweep, 2026-08-06):
// this used to branch on `o.source === "parcel"` and print "PARCEL", but `orders` has no
// `source` column, so the branch could never once run. A parcel is not an `orders` row at all —
// it lives in `aggregator_orders` and is drawn by platTicketHtml(), which shows a PARCEL source
// badge and no table. Keeping an unreachable branch that reads a non-existent column is worse
// than not having one: it reads as handled. `tlong`'s "T?" is the real guard for a row with no
// table (a banquet bill with the table left blank), and that one IS reachable.
const whereFor = (o, long) => (long ? tlong(o && o.table_number) : tshort(o && o.table_number));
// How old a ticket is, in the words a cook reads. GUARDED against a missing or unparseable
// timestamp (T4 sweep, 2026-08-04): this used to do the arithmetic blind, so `null` printed
// "496071h 45m" (the 1970 epoch) and a garbage value printed "NaNh NaNm" — straight into the
// ticket header, and `NaN` on a staff screen is on verify:live's own leaked-value list. A
// platform/aggregator ticket is the realistic way in, since its created_at comes from a webhook.
// Every other date read on this panel is already guarded; this was the one that wasn't.
const ageMinutes = (ts) => {
  if (ts == null || ts === "") return null;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t) || t <= 0) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));   // a device clock ahead of the server reads "just now"
};
const timeAgo = (ts) => {
  const m = ageMinutes(ts);
  if (m == null) return "";               // say nothing rather than nonsense
  if (m < 1) return "just now";
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  // PAST A DAY, SAY DAYS (T4 sweep, 2026-08-11). There was no day step, so a ticket on an overnight
  // open session read "117h 48m" — measured on ALL TWENTY tickets of the live board, the oldest at
  // 117h — and a cook had to divide by 24 to learn it was nearly five days old. At a glance "117h"
  // reads as roughly a hundred minutes, which is the opposite of the truth; "4d 21h" is right
  // immediately. The minutes are deliberately dropped past a day: nobody needs them at that range
  // and the ticket header is a tight space. Under 24h nothing changes at all.
  if (h >= 24) return Math.floor(h / 24) + "d " + (h % 24) + "h";
  return h + "h " + (m % 60) + "m";
};
// WALL VIEW IS FIRST-COME-FIRST-SERVED, so its sort key must never be NaN (T4 sweep, 2026-08-11).
// `new Date(bad) - new Date(good)` is NaN, and a comparator that answers NaN leaves the ticket
// wherever the sort engine happens to drop it — the board silently stops being FIFO, which is the
// one thing the wall exists to be. ageMinutes() above was hardened against exactly this value
// (a platform/aggregator ticket's created_at comes from a webhook, so it is the realistic way in);
// the sort that decides WHAT A COOK COOKS FIRST was not. An undateable ticket sorts LAST, never
// first: a row we cannot place in the queue must not be allowed to jump it.
const orderTime = (ts) => {
  const t = ts == null || ts === "" ? NaN : new Date(ts).getTime();
  return Number.isFinite(t) ? t : Infinity;
};
// Compared, not subtracted — Infinity − Infinity is NaN, so two undateable tickets would put the
// comparator right back where it started.
const cmpTime = (x, y) => { const a = orderTime(x), b = orderTime(y); return a < b ? -1 : a > b ? 1 : 0; };
// A STUCK TICKET MUST NOT LOOK LIKE A FRESH ONE (T4 sweep, 2026-08-04). The live board carried a
// Cooking ticket 44 HOURS old and another at 13h, rendered in exactly the same small grey text as
// "5m" — so a cook scanning the board had no signal that anything had been sitting. These are real
// tickets on overnight open sessions and must never be hidden; they just have to be visible AS old.
// REJECTED (owner, 2026-08-07): no second ageing signal for food that is READY and sitting
// uncollected. This warning is for a ticket that has been COOKING too long, and that is all the
// board needs. See docs/REJECTED-IDEAS.md → R5.
// A THIRD STEP, BECAUSE "LATE" STOPPED MEANING ANYTHING (owner picked this, 2026-08-11).
// The two steps ended at 2 hours, so a ticket 3 hours old and one FIVE DAYS old wore the same red.
// Measured on the live board: all twenty tickets were red at once, and when everything is red a cook
// scanning the pass cannot tell which one has genuinely been sitting — the signal was there and
// carried no information. Anything from yesterday or earlier is a different KIND of thing (an
// overnight table nobody closed) from a ticket that is running twenty minutes behind tonight.
//
// AND IT IS NOT A COLOUR (his instruction, same day: a printer is black and white, so colour is
// "no use"). He is right about more than the printer: the two existing steps are hue-only, which
// fails a colour-blind cook, a sun-washed screen and a cheap panel alike. So the stale step is a
// bordered BOX with the word DAY in it — a shape and a word, either of which survives alone. The
// paper half of the same instruction is LFH_BILLDOC.kotWhen(), which prints the DAY on the ticket.
//
// This is NOT R5. R5 refused an ageing signal on the READY column — food cooked and waiting to be
// carried out. This is the COOKING warning that already exists, given the step it was missing.
const AGE_WARN_MIN = 30, AGE_LATE_MIN = 120, AGE_STALE_MIN = 24 * 60;
const ageClass = (ts) => {
  const m = ageMinutes(ts);
  if (m == null) return "";
  return m >= AGE_STALE_MIN ? " age-stale" : m >= AGE_LATE_MIN ? " age-late" : m >= AGE_WARN_MIN ? " age-warn" : "";
};
// The words a cook reads on hover / long-press — different at each step, because "open a long time"
// says nothing useful about a five-day-old ticket.
const ageTitle = (ts) => {
  const m = ageMinutes(ts);
  if (m == null) return "";
  if (m >= AGE_STALE_MIN) return "This ticket is from an earlier day — it is almost certainly a table nobody closed";
  if (m >= AGE_LATE_MIN) return "This ticket has been cooking a long time";
  if (m >= AGE_WARN_MIN) return "This ticket has been cooking over half an hour";
  return "";
};
const toast = (msg, undoFn) => {
  const t = document.createElement("div");
  t.className = "toast";
  // message · optional UNDO · always a ✕ so staff can dismiss it now (owner, 2026-06-21)
  t.innerHTML = `<span>${esc(msg)}</span>${undoFn ? '<button class="undo">UNDO</button>' : ""}<button class="toast-x" aria-label="Dismiss">✕</button>`;
  if (undoFn) t.querySelector(".undo").onclick = () => { undoFn(); t.remove(); };
  t.querySelector(".toast-x").onclick = () => t.remove();
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 4000);
};

// A short two-note chime for new orders (WebAudio — no sound file needed).
let audioCtx = null;
// A KDS is usually a wall display nobody ever taps. WebAudio's autoplay policy starts
// a context created outside a user gesture in "suspended" state, so the FIRST order
// chimed silently and the display never beeped until someone touched it (bug M8,
// 2026-07-05). Fix: create the context eagerly and resume() it on the first ANY user
// gesture (one-time), and also try to resume() on every chime in case it lapsed.
function primeAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const p = audioCtx.resume?.();
    if (p && p.then) p.then(() => updateSoundNudge()).catch(() => {}); // resume() is async — re-check once it settles
  } catch {}
  updateSoundNudge();
}
if (typeof window !== "undefined") {
  const once = () => { primeAudio(); ["pointerdown", "keydown", "touchstart"].forEach((e) => window.removeEventListener(e, once)); };
  ["pointerdown", "keydown", "touchstart"].forEach((e) => window.addEventListener(e, once, { once: true, passive: true }));
}
// Is sound actually usable right now (context exists AND is running, not suspended)?
const audioReady = () => !!(audioCtx && audioCtx.state === "running");
// A wall-mounted KDS nobody ever taps never fires a user gesture, so the AudioContext stays
// suspended and the chime is silent forever. Show a big one-tap "enable sound" affordance
// WHILE sound is on but the context isn't running yet; tapping it primes+resumes the context
// (that tap IS the user gesture the autoplay policy needs). It hides itself the instant the
// context is running or the cook mutes. (The eager gesture-priming above still runs too.)
let soundNudgeEl = null;
function updateSoundNudge() {
  const need = !state.muted && !audioReady();
  if (need) {
    if (!soundNudgeEl) {
      soundNudgeEl = document.createElement("button");
      soundNudgeEl.id = "soundNudge"; soundNudgeEl.type = "button"; soundNudgeEl.className = "sound-nudge";
      soundNudgeEl.textContent = "🔊 Tap to enable sound — new orders are silent";
      soundNudgeEl.onclick = () => { primeAudio(); setTimeout(updateSoundNudge, 250); };
      // IT SITS UNDER THE TOP BAR, IT DOES NOT FLOAT OVER THE BOARD (T4 sweep, 2026-08-04). This
      // used to be appended to <body> as a fixed, pulsing pill centred near the bottom — so on a
      // phone it landed on top of a ticket, and on any width a full Cooking column (i.e. a rush)
      // put it over a ticket and potentially over its ALL READY button. It cannot be dismissed by
      // design (a silent KDS is a real problem and must keep saying so), which is exactly why it
      // must not cover anything: inserted in the normal flow it RESERVES its own row and the board
      // starts below it. Keeping the nudge honest and keeping the board unobstructed are both
      // required — this is how you get both.
      const bar = document.querySelector("header.topbar");
      if (bar && bar.parentNode) bar.parentNode.insertBefore(soundNudgeEl, bar.nextSibling);
      else (document.body || document.documentElement).appendChild(soundNudgeEl);
    }
    soundNudgeEl.hidden = false;
  } else if (soundNudgeEl) {
    soundNudgeEl.hidden = true;
  }
}
const chime = () => {
  if (state.muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume?.();
    [[880, 0], [1175, 0.18]].forEach(([f, at]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + at + 0.35);
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime + at); o.stop(audioCtx.currentTime + at + 0.4);
    });
  } catch {}
  updateSoundNudge(); // if the context couldn't run, surface the "enable sound" nudge
};

// ── drawing the board ────────────────────────────────────────────────────────
// The per-dish rows of one order (session orders have order_items; legacy
// orders carry their dishes in the order's own items JSON).
// itemsByOrderId(): build the order_id → item-rows index ONCE per render pass so the
// board no longer runs state.items.filter() per order per ticket. It used to be called
// 3× per order (orderPhase + ticketHtml twice) → O(orders × items) each render, which is
// the rush-hour freeze. Callers pass the pre-filtered slice into rowsOf(o, slice); the
// surgical single-order callers (markItemReady/moveCardToReady) still pass nothing and
// fall back to a one-off filter, which is cheap for one order.
const itemsByOrderId = () => {
  const m = new Map();
  for (const it of (state.items || [])) {
    if (it == null || it.order_id == null) continue;
    let arr = m.get(it.order_id); if (!arr) m.set(it.order_id, (arr = []));
    arr.push(it);
  }
  return m;
};
const rowsOf = (o, dbRowsOpt) => {
  const dbRows = dbRowsOpt || state.items.filter((i) => i.order_id === o.id);
  if (dbRows.length) return dbRows.map((r) => ({ id: r.id, title: r.title, qty: r.qty, status: r.status, note: r.note, options: r.options, removed: r.removed, added_allergens: r.added_allergens, removed_flag: r.removed_flag, fromDb: true }));
  return (Array.isArray(o.items) ? o.items : []).map((i) => ({ id: null, title: i.title, qty: i.qty || 1, status: i.status || o.status, note: i.note, options: i.options, removed: i.removed, fromDb: false }));
};

function ticketHtml(o, rows) {
  rows = rows || rowsOf(o);
  // NO common allergy banner anywhere (owner, 2026-06-14). The order-wide "avoid" is
  // DISTRIBUTED onto every item, so each dish shows its own "NO x" — matching the
  // manager and tablet. Each item = its own removals ∪ the order-wide allergens.
  const orderAllergies = Array.isArray(o.allergies) ? o.allergies : [];
  const lines = rows.map((r) => {
    const lineRemoved = [...new Set([...(Array.isArray(r.removed) ? r.removed : []), ...orderAllergies])];
    // Allergens render as HTML so a staff-ADDED one carries a green "＋"; options/note
    // stay escaped text. A removed allergen flags "✎−" on the dish name (built below).
    const added = new Set((Array.isArray(r.added_allergens) ? r.added_allergens : []).map((x) => String(x).toLowerCase()));
    const segs = [];
    if (Array.isArray(r.options) && r.options.length) segs.push(esc(r.options.map((op) => `+ ${op.label || op}`).join(" · ")));
    if (lineRemoved.length) segs.push(lineRemoved.map((x) => `NO ${esc(String(x).toUpperCase())}${added.has(String(x).toLowerCase()) ? `<sup class="alg-add" title="Added after the order was placed">＋</sup>` : ""}`).join(", "));
    if (r.note) segs.push(esc(`✎ ${r.note}`));
    const small = segs.length ? `<small>${segs.join(" · ")}</small>` : "";
    const remMark = r.removed_flag ? ` <span class="alg-removed" title="An allergen was removed after the order was placed">✎−</span>` : "";
    // Each cooking dish gets a ✓ to mark it READY (cooked). Once ready it shows a
    // pink "ready" tag (waiter still has to carry it out); once the waiter serves
    // it on the tablet it reads "served".
    const tick = r.fromDb && r.status === "preparing"
      ? `<button class="tick" data-item-ready="${esc(r.id)}">✓</button>`
      : r.status === "ready" ? `<span class="done rdy">ready</span>`
        : r.status === "served" ? `<span class="done">served ✓</span>` : "";
    const lineCls = r.status === "served" ? "line-done" : r.status === "ready" ? "line-ready" : "";
    return `<div class="line ${lineCls}">
      <span class="qty">${esc(r.qty)}×</span>
      <span class="ltitle">${esc(r.title)}${remMark}${small}</span>
      ${tick}</div>`;
  }).join("");
  const allCooked = rows.length > 0 && rows.every((r) => r.status === "ready" || r.status === "served");
  // The kitchen does NOT accept orders (owner, 2026-06-14): a new order is shown
  // for visibility only — the waiter/manager accepts it. The kitchen's only job is
  // moving a COOKING dish to READY (the ✓ ticks, or "ALL READY").
  const action = o.status === "received"
    ? `<div class="awaiting">🆕 new — waiting for the waiter to accept</div>`
    : (!allCooked
      ? `<button class="big ready" data-ready="${esc(o.id)}">ALL READY</button>`
      : `<div class="awaiting">✓ ready — waiter serving</div>`);
  // Manual PRINT button — on EVERY ticket for EVERY restaurant (owner 2026-07-21: "it
  // should be for everyone"). Any kitchen with any printer can print a ticket on demand
  // (or reprint after a jam / paper-out). Only the AUTOMATIC printing stays gated by the
  // admin entitlement + owner toggle (autoPrintKot). Independent of the auto-print
  // tracking (printedIds) — it just runs printKot for this order's current dishes.
  const reprintBtn = `<button class="reprint" data-reprint="${esc(o.id)}" title="Print this kitchen ticket" aria-label="Print kitchen ticket">🖨</button>`;
  // Special table type (mig 166): a small coloured badge next to the table number so
  // cooks know to prioritise (👑 VIP · 🏠 Family · 🤝 Owner's guest). Read-only here.
  // The violet was #8b5cf6, which measured 4.23:1 against the white label at 10px/800 — under the
  // 4.5:1 that size needs, and the only one of the three marks that missed (Family 4.70, Guest
  // 7.60). Of all three to be the faint one it was the worst choice: VIP is the mark that means
  // pull this ticket forward. Same violet taken one step darker measures 5.31:1. The badge looks
  // the same at arm's length; it is simply readable now. (T6 re-check, 2026-08-19, pixel-sampled
  // on the running board in both skins — these colours are inline, so one value fixes both.)
  const TAG_BADGE = { vip: ["👑 VIP", "#7c46e0"], family: ["🏠 FAMILY", "#e11d48"], guest: ["🤝 GUEST", "#aab4c4"] };
  // THE MARK BELONGS TO THE TABLE, NOT THE ORDER (fixed 2026-08-06, T4 sweep). This read `o.tag`
  // for the whole life of the feature — and `orders` has no `tag` column, so the badge was never
  // once drawn and a cook had no way to see that table 6 was the owner's guest. The board now
  // ships `tableTags` ({ "6": "vip" }) the same way it ships `tableNames`, and the ticket looks
  // its own table up. A parcel has no table, so it has no mark either.
  const ttag = (state.tableTags || {})[String(o.table_number)] || "";
  const tb = TAG_BADGE[ttag];
  const tagBadge = tb ? `<span class="ttag" style="background:${tb[1]};color:${ttag === "guest" ? "#1c2230" : "#fff"}">${tb[0]}</span>` : "";
  return `<div class="ticket st-${esc(o.status)}" data-ticket="${esc(o.id)}">
    <div class="thead"><span class="kot">#${esc(o.kot_no ?? "—")}</span><span class="tbl"${o.table_number == null || o.table_number === "" ? "" : ` title="T${esc(o.table_number)}"`}>${esc(whereFor(o, false))}</span>${tagBadge}<span class="age${ageClass(o.created_at)}"${ageTitle(o.created_at) ? ` title="${esc(ageTitle(o.created_at))}"` : ""}>${ageMinutes(o.created_at) >= AGE_STALE_MIN ? `<i class="age-day">DAY</i>` : ""}${esc(timeAgo(o.created_at))}</span>${reprintBtn}</div>
    ${lines}${action}</div>`;
}

// A kitchen ticket's column comes from its DISHES, not the coarse order status:
// New = not accepted; Ready = every dish cooked (awaiting the waiter); Cooking =
// anything in between. Fully-served orders have been delivered and leave the board.
function orderPhase(o, rows) {
  if (o.status === "received") return "new";
  rows = rows || rowsOf(o);
  if (!rows.length) return o.status === "served" ? "served" : "cooking";
  if (rows.every((r) => r.status === "served")) return "served";
  if (rows.every((r) => r.status === "ready" || r.status === "served")) return "ready";
  return "cooking";
}
// ONE delegated click handler for every ticket action (✓ per-dish ready, ALL READY, the
// platform accept/ready/hand buttons). Attached ONCE to a stable ancestor (document.body,
// which is never replaced) so the incremental tile patcher can add/remove/replace ticket
// nodes freely WITHOUT re-binding a listener per card — the old bindButtons() re-bound
// every button on every whole-board redraw, and a replaced node would orphan its handler
// (the exact reason the board was rebuilt wholesale before). e.target.closest() finds the
// clicked control on whichever card it lives, patched or not.
let clickDelegationBound = false;
function bindDelegation() {
  if (clickDelegationBound) return;
  clickDelegationBound = true;
  document.body.addEventListener("click", (e) => {
    const reprint = e.target.closest("[data-reprint]");
    if (reprint) { reprintOrder(reprint.dataset.reprint); return; }
    const ready = e.target.closest("[data-ready]");
    if (ready) { markOrderReady(ready.dataset.ready); return; }
    // The kitchen ✓ marks a dish READY (cooked) — the waiter serves it on the tablet.
    const item = e.target.closest("[data-item-ready]");
    if (item) { markItemReady(item.dataset.itemReady, item); return; }
    // Platform-order actions (accept gated by the manager toggle on the server too).
    const pa = e.target.closest("[data-plat-accept]");
    if (pa) { platAct(pa.dataset.platAccept, "accepted"); return; }
    const pr = e.target.closest("[data-plat-ready]");
    if (pr) { platAct(pr.dataset.platReady, "ready"); return; }
    const ph = e.target.closest("[data-plat-hand]");
    if (ph) { platAct(ph.dataset.platHand, "handed_over"); return; }
  });
}
// ── platform (Zomato/Swiggy/takeaway) tickets ────────────────────────────────
// Which kitchen column a platform order sits in (mirrors orderPhase for dine-in).
function platPhase(st) {
  if (st === "new") return "new";
  if (st === "accepted" || st === "preparing") return "cooking";
  if (st === "ready") return "ready";
  return "served"; // handed_over/cancelled — already filtered out by the board API
}
// One platform ticket. Same ticket look as dine-in but with a coloured source
// badge instead of a table number, and platform actions. ACCEPT only shows when
// the manager toggle (state.platformAccept) allows the kitchen to accept.
function platTicketHtml(p) {
  const meta = PLAT_META[p.source] || PLAT_META.other;
  const items = Array.isArray(p.items) ? p.items : [];
  const lines = items.map((it) => {
    const rem = Array.isArray(it.removed) && it.removed.length ? `<small>${it.removed.map((x) => `NO ${esc(String(x).toUpperCase())}`).join(", ")}</small>` : "";
    const note = it.note ? `<small>${esc("✎ " + it.note)}</small>` : "";
    return `<div class="line"><span class="qty">${esc(it.qty)}×</span><span class="ltitle">${esc(it.title)}${rem}${note}</span></div>`;
  }).join("");
  let action;
  if (p.status === "new") {
    action = state.platformAccept
      ? `<button class="big" data-plat-accept="${esc(p.id)}">ACCEPT</button>`
      : `<div class="awaiting">🆕 new — manager will accept</div>`;
  } else if (p.status === "accepted" || p.status === "preparing") {
    action = `<button class="big ready" data-plat-ready="${esc(p.id)}">ALL READY</button>`;
  } else {
    action = `<button class="big" data-plat-hand="${esc(p.id)}">HANDED OVER</button>`;
  }
  return `<div class="ticket plat plat-${esc(meta.cls)} st-plat-${esc(p.status)}" data-ticket="plat-${esc(p.id)}">
    <div class="thead"><span class="src-badge ${esc(meta.cls)}">${esc(meta.label)}</span><span class="kot">#${esc(p.kot_no ?? "—")}</span><span class="age${ageClass(p.created_at)}"${ageTitle(p.created_at) ? ` title="${esc(ageTitle(p.created_at))}"` : ""}>${ageMinutes(p.created_at) >= AGE_STALE_MIN ? `<i class="age-day">DAY</i>` : ""}${esc(timeAgo(p.created_at))}</span></div>
    ${p.customer_name ? `<div class="plat-cust-line">${esc(p.customer_name)}</div>` : ""}
    ${lines}${action}</div>`;
}
// Advance a platform order (accept/ready/handed_over), then refresh.
function platAct(id, status) {
  api("POST", `/platform/${id}/status`, { status })
    .then((r) => { if (r && r.queued) { toast("Saved on this device ✓ — it will send by itself."); return; } freshLoad(); })
    .catch((e) => { toast("Failed: " + e.message); freshLoad(); });
}

// INCREMENTAL tile patcher. Given a container and the DESIRED ordered list of tickets
// ({ id, html }), it reconciles the DOM in place: it REUSES an existing card node when its
// id is unchanged, only REPLACES a card whose html actually changed, ADDS new cards, and
// REMOVES cards that left — instead of blowing away and rebuilding every ticket's DOM on
// every update (the rush-hour freeze: a full innerHTML rebuild + re-bind on each poll).
// Cards keep their identity across updates, so a card the cook is mid-tap on isn't yanked
// out from under them. Button clicks are handled by the ONE delegated handler on body, so
// added/replaced nodes need NO re-binding. The rendered html is stashed on the node
// (`__kdsHtml`) purely as the cheap change check — a stale value (after a surgical optimistic
// tweak) just means the next reconcile refreshes that one card, which is correct.
function reconcileList(container, desired) {
  if (!container) return;
  if (!desired.length) {
    // Only (re)write the empty placeholder if it isn't already the sole child — avoids a
    // needless rebuild/flicker when an already-empty column re-renders.
    if (!(container.children.length === 1 && container.firstElementChild && container.firstElementChild.classList.contains("empty"))) {
      container.innerHTML = `<div class="empty">Nothing here.</div>`;
    }
    return;
  }
  // Index existing ticket nodes by their id; drop anything without a data-ticket (skeleton
  // shimmer cards, the "Nothing here" placeholder, strays).
  const existing = new Map();
  for (const node of Array.from(container.children)) {
    const id = node.getAttribute("data-ticket");
    if (id != null) existing.set(id, node); else node.remove();
  }
  let prev = null;
  for (const d of desired) {
    let node = existing.get(d.id);
    if (node) {
      existing.delete(d.id);
      if (node.__kdsHtml !== d.html) { // content actually changed → swap just this card
        const tmp = document.createElement("div"); tmp.innerHTML = d.html;
        const fresh = tmp.firstElementChild;
        if (fresh) { fresh.__kdsHtml = d.html; container.replaceChild(fresh, node); node = fresh; window.__lfhPerf.tilesPatched++; window.__lfhPerf.patches++; }
      }
    } else { // a brand-new card
      const tmp = document.createElement("div"); tmp.innerHTML = d.html;
      node = tmp.firstElementChild;
      if (node) node.__kdsHtml = d.html;
    }
    if (!node) continue;
    // Keep the DOM order matching `desired`: place this card right after the previous one.
    const target = prev ? prev.nextSibling : container.firstChild;
    if (node !== target) container.insertBefore(node, target);
    prev = node;
  }
  // Anything still in `existing` is no longer on the board — remove it.
  for (const node of existing.values()) node.remove();
}

// Tell the reconciler it no longer knows what a card says, so the next paint MUST rebuild it.
//
// `__kdsHtml` is reconcileList()'s cheap change-check: the html a card was last drawn from. Every
// path that REBUILDS a card re-stamps it. The ✓ does not rebuild a card — it edits one line of it
// in place — and it must not stamp either, because that would claim the card matches html it was
// never built from. What it owes instead is to say the stamp is now meaningless, on the one path
// where the edit is then undone with no server round trip to repaint behind it: a refused write.
// Without that the reconciler compares desired html to a stamp older than the edit, matches, and
// reuses a node the edit already changed — which is exactly how a refused ✓ left a cook unable to
// re-send a dish. (T6 re-check, 2026-08-19. The undo bar does NOT need this — measured; see the
// note in undoReady.)
function forgetCardHtml(orderId) {
  if (orderId == null) return;
  const card = document.querySelector(`.ticket[data-ticket="${window.CSS && CSS.escape ? CSS.escape(String(orderId)) : orderId}"]`);
  if (card) card.__kdsHtml = null;
}
// COLUMNS view — the classic New → Cooking → Ready board. Dine-in tickets first,
// then platform tickets, in each column.
// REJECTED (owner, 2026-08-07): do NOT collapse or hide an EMPTY column on a phone to win back the
// ~101px its "Nothing here." box costs. The three columns a kitchen thinks in — New / Cooking / Ready —
// are always all three, whatever is in them. See docs/REJECTED-IDEAS.md → R3.
function renderColumns() {
  const map = itemsByOrderId(); // build the item index ONCE, not per ticket
  const buckets = { new: [], cooking: [], ready: [], served: [] };
  state.orders.forEach((o) => {
    if (o.status === "cancelled") return;
    const rows = rowsOf(o, map.get(o.id) || []);
    buckets[orderPhase(o, rows)].push({ o, rows });
  });
  const pb = { new: [], cooking: [], ready: [] };
  (state.platform || []).forEach((p) => { const c = platPhase(p.status); if (pb[c]) pb[c].push(p); });
  const draw = (key, list, plist) => {
    const desired = list.map(({ o, rows }) => ({ id: String(o.id), html: ticketHtml(o, rows) }))
      .concat((plist || []).map((p) => ({ id: "plat-" + p.id, html: platTicketHtml(p) })));
    reconcileList($("#list-" + key), desired);
    $("#count-" + key).textContent = String(list.length + (plist ? plist.length : 0)); // show "0", not a blank pill, when a column is empty (2026-07-05)
  };
  draw("new", buckets.new, pb.new); draw("cooking", buckets.cooking, pb.cooking); draw("ready", buckets.ready, pb.ready);
}
// WALL view (the "expansion") — EVERY live ticket in one dense grid, FIRST-COME-
// FIRST-SERVED (oldest top-left); fully-ready tickets sink to the end. Same tickets
// + same ✓/ALL-READY actions as the columns. (owner, 2026-06-19)
function renderWall() {
  const map = itemsByOrderId(); // build the item index ONCE, not per ticket
  const live = [];
  state.orders.forEach((o) => {
    if (o.status === "cancelled") return;
    const rows = rowsOf(o, map.get(o.id) || []);
    const phase = orderPhase(o, rows);
    if (phase !== "served") live.push({ o, rows, phase });
  });
  // ONE QUEUE, NOT TWO (T6 sweep, 2026-08-17). The wall exists to be first-come-first-served —
  // this file and index.html both say "oldest first" — and it wasn't: dine-in tickets were sorted
  // among themselves, platform tickets were sorted among themselves, and then the two lists were
  // simply glued together. So every delivery ticket sat behind every dine-in ticket whatever the
  // clock said. On a restaurant taking Zomato/Swiggy/Website/counter-parcel orders that means an
  // hour-old delivery order rendered below a one-minute-old table order, at the bottom of a dense
  // grid a cook reads top-left first — the food most likely to be late is the food shown last, and
  // a late delivery order is the one the restaurant is penalised for. They are now sorted in ONE
  // pass on the same two keys the wall already used: not-ready before ready, then oldest first.
  // cmpTime, not a bare date subtraction — see the note on orderTime(): a webhook timestamp we
  // can't read used to make this comparator answer NaN and quietly un-FIFO the board. A platform
  // ticket's created_at comes from exactly such a webhook, which is why it must go through the
  // same guarded comparator as a dine-in one rather than a private sort of its own.
  const desired = live.map(({ o, rows, phase }) => ({ id: String(o.id), at: o.created_at, ready: phase === "ready", html: ticketHtml(o, rows) }))
    .concat((state.platform || []).map((p) => ({ id: "plat-" + p.id, at: p.created_at, ready: platPhase(p.status) === "ready", html: platTicketHtml(p) })));
  desired.sort((a, b) => (a.ready - b.ready) || cmpTime(a.at, b.at));
  reconcileList($("#wall"), desired);
}
// Paint the ACTIVE view. Every render() caller (load, loadTables, applyView) repaints
// whichever layout the cook is on — via the incremental reconciler, not a full rebuild.
// Timed + counted for __lfhPerf (see the note at the top of this file): every board paint goes
// through here, so this is the one place that needs to measure.
function render() {
  const _t0 = performance.now();
  const r = view === "wall" ? renderWall() : renderColumns();
  window.__lfhPerf.fullRenders++;
  window.__lfhPerf.lastMs = performance.now() - _t0;
  return r;
}
// Switch layout: show/hide the two <main>s, clear the inactive one, repaint, persist.
function applyView() {
  const wall = view === "wall";
  $("#cols").hidden = wall; $("#wall").hidden = !wall;
  // Set the ICON and the WORD separately — a plain textContent here would wipe the two <i>
  // spans the phone layout hides the words with (T4 sweep, 2026-08-04).
  { const b = $("#viewBtn"), ic = b.querySelector(".bi"), w = b.querySelector(".bw");
    if (ic && w) { ic.textContent = wall ? "▭" : "▦"; w.textContent = wall ? "Columns" : "Wall view"; }
    else b.textContent = wall ? "▭ Columns" : "▦ Wall view"; }   // fallback if the spans ever go
  if (wall) { $("#list-new").innerHTML = $("#list-cooking").innerHTML = $("#list-ready").innerHTML = ""; }
  else { $("#wall").innerHTML = ""; }
  render();
}

// Run an action then refresh immediately (snappier than waiting for the poll).
// Used by the 86-board toggle/undo — a single deliberate tap, so a reload is fine.
// freshLoad, not load: this runs a WRITE and then refreshes, so it must not be handed a read that
// started before the write (see the note on freshLoad).
//
// REJECTED (owner, 2026-08-13): do NOT give this the manager/tablet `errText()` treatment — the
// shared helper that tells "no internet", "the system is very busy" and a clash apart instead of
// "Failed: <code>". Offered as sweep idea I6 and turned down: *"i don't thing i6 is require mainly
// in kitchen panel is only use for kot print"*. This screen prints KOTs; it does not edit values,
// so the clash wording it would gain is one it can never reach. `Failed: <message>` stays, and the
// kitchen being the odd one of the three panels here is deliberate, not drift. See
// docs/REJECTED-IDEAS.md R21.
const act = async (fn) => { try { await fn(); await freshLoad(); } catch (e) { toast("Failed: " + e.message); } };

// Marking dishes READY is OPTIMISTIC. In a rush the cook taps ✓ down a long ticket
// one after another; we flip the dish locally + redraw INSTANTLY, fire the API in the
// background, and reconcile with ONE refetch after the taps stop. (Was: await POST +
// a full board reload PER tap → each tap waited a round-trip and the DOM rebuild
// between taps ate the next tap → "clicking ready one by one doesn't work" in a rush.)
// pendingReady keeps a just-tapped dish showing ready even if a realtime/poll refetch
// lands mid-rush before the server caught up. (owner, 2026-06-18)
const pendingReady = new Set();
// Order-level optimistic overlay for LEGACY orders (no order_items rows — their dishes live
// in orders[].items JSON). markOrderReady() adds the order id here so load()/loadTables() can
// re-apply the "ready" overlay to that order's legacy items after they replace state.orders
// with fresh server rows — otherwise a slow-DB reconcile reverts a just-tapped legacy order
// to cooking until the server catches up (item-keyed pendingReady can't cover legacy items,
// which have no id). (bug: legacy orders revert during optimistic ALL-READY)
const pendingReadyOrders = new Set();
let readyReconcileTimer = null;
function scheduleReadyReconcile() {
  if (readyReconcileTimer) clearTimeout(readyReconcileTimer);
  readyReconcileTimer = setTimeout(() => {
    readyReconcileTimer = null;
    // Refetch FIRST — while the optimistic overlay still protects the just-tapped dishes —
    // and clear pendingReady only AFTER the server-confirmed board has landed. Clearing the
    // overlay BEFORE the refetch (the old order) stripped the protection during the very
    // refresh most likely to be stale, so a slow DB briefly flipped a ready dish back to
    // cooking. load() re-applies the overlay during its run, so the painted board stays
    // ready; we drop the overlay once the fetch resolves.
    //
    // freshLoad(), NOT load() — and this is the one caller that must not share (found while
    // re-checking my own coalescer, 2026-08-11). load() now hands a caller the read ALREADY IN
    // FLIGHT, which is right for a refresh and WRONG here: a read that started before the cook's ✓
    // cannot contain it, so `.finally` would drop the optimistic overlay against a board that still
    // says "cooking" and flick every ticked dish back until the trailing refresh landed — precisely
    // the flicker the refetch-first ordering above exists to prevent. So: wait for whatever is in
    // flight, then start a read of our own. loadImpl keeps its loadSeq latest-wins guard, so calling
    // it directly is safe.
    freshLoad().catch(() => {}).finally(() => { pendingReady.clear(); pendingReadyOrders.clear(); });
  }, 2500);
}
function setLocalReady(matches) {
  (state.items || []).forEach((i) => { if (i.status !== "served" && matches(i)) { i.status = "ready"; pendingReady.add(i.id); } });
  // Legacy orders carry their dishes in the order's items JSON (no order_items rows).
  (state.orders || []).forEach((o) => { if (Array.isArray(o.items)) o.items = o.items.map((i) => (i.status !== "served" && matches({ ...i, order_id: o.id })) ? { ...i, status: "ready" } : i); });
  // Adopt the optimistic state as the baseline so a poll/realtime refetch carrying the
  // SAME (server-confirmed) data won't rebuild the tickets under the cook's finger.
  lastSig = boardSig({ orders: state.orders, items: state.items, dishes: state.dishes, platform: state.platform, platformAccept: state.platformAccept });
  // NOTE: no render() here — callers do a SURGICAL card update instead of a whole-board
  // repaint (a full render() re-buckets/rebuilds every ticket, eating a concurrent tap).
}
// Mark ONE dish ready (the ✓ tick). Update ONLY this dish's line IN PLACE — do NOT
// rebuild the whole board. A full render() per tap (a) re-buckets the ticket so it
// jumps to the Ready column mid-rush and (b) destroys+recreates the other ✓ buttons,
// so the cook's next rapid tap lands on a replaced node and is eaten ("clicking ready
// one by one doesn't work"). The ticket re-buckets to Ready exactly once, on the
// debounced reconcile after the taps stop. (owner, 2026-06-18)
function markItemReady(id, btn) {
  const it = (state.items || []).find((x) => x.id === id);
  // NEVER A SILENT RETURN ON A TAP (owner's rule; T4 sweep, 2026-08-04). The ✓ only renders for a
  // dish that is still cooking, so this is a defensive path — but a poll or a realtime refetch can
  // land between the paint and the finger, and then the cook's tap did nothing and SAID nothing,
  // which is indistinguishable from a broken button and leaves no trace to debug.
  if (!it) { toast("That dish just changed — refreshing the board."); load().catch(() => {}); return; }
  if (it.status === "served") { toast(`${it.title || "That dish"} is already served.`); return; }
  const prev = it.status; // remember where it was so a mis-tap can be taken back
  it.status = "ready"; pendingReady.add(id);
  if (btn) { const line = btn.closest(".line"); if (line) { line.classList.add("line-ready"); btn.outerHTML = '<span class="done rdy">ready</span>'; } }
  // Adopt the optimistic state as the baseline so a poll/realtime refetch carrying the
  // SAME (server-confirmed) data won't rebuild the tickets under the cook's finger.
  lastSig = boardSig({ orders: state.orders, items: state.items, dishes: state.dishes, platform: state.platform, platformAccept: state.platformAccept });
  // If THIS tick made the WHOLE order ready, slide its card to the Ready column NOW
  // (don't wait for the 2.5s reconcile) — moving just this one card, so other tickets'
  // ✓ buttons survive and the cook's next rapid tap isn't eaten. (owner, 2026-06-19)
  const o = (state.orders || []).find((x) => x.id === it.order_id);
  if (o && orderPhase(o) === "ready") moveCardToReady(o);
  api("POST", `/items/${id}/status`, { status: "ready" }).then((r) => {
    // Saved on this device rather than sent — say so, and skip the reconcile (which would refetch
    // the board and paint the dish back as still cooking, exactly the "did my tap work?" moment
    // this panel had no answer for).
    if (r && r.queued) { toast("Saved on this device ✓ — it will send by itself."); return; }
    scheduleReadyReconcile();
    // A ✓ is easy to mis-tap in a rush — give the cook a few seconds to send the
    // dish back to where it was (owner undo bar, 2026-07-22).
    if (window.LFH_UNDO) LFH_UNDO.show({
      message: `${it.title || "Dish"} marked ready`,
      sub: o ? `${tlong(o.table_number)} · tap undo to put it back` : "Tap undo to put it back",
      icon: "🔥",
      onUndo: () => undoReady([{ id, prev }]),
    });
  }).catch((e) => {
    // THE OPTIMISTIC OVERLAY MUST NOT OUTLIVE A REFUSED WRITE (T6 sweep, 2026-08-17 — watched
    // happening). `pendingReady` is what keeps a just-tapped dish showing ready while the server
    // catches up, and it was only ever cleared on the SUCCESS path (scheduleReadyReconcile's
    // .finally). So when the server said no — "that dish isn't on this restaurant's board any
    // more" after the manager cancelled the KOT, a 403 from a blocked device, a 400 — the cook got
    // a four-second red toast and then the board went on painting the dish READY for ever: every
    // later /board read re-applied the overlay, the ticket had already slid into the Ready lane,
    // and the ✓ was gone so there was no way to try again. Nothing was saved, so the waiter was
    // never told the dish was done and the guest waited on a dish the pass believed was finished.
    // Drop the overlay and put the dish back where it was, THEN reconcile from the server: if the
    // write did land and only the reply was lost, the refetch simply paints it ready again.
    pendingReady.delete(id);
    if (it.status !== "served") it.status = prev;
    // …AND THE CARD HAS TO BE ALLOWED TO REDRAW (T6 re-check, 2026-08-19 — the first version of
    // this fix put the DATA back and left the SCREEN wrong). The tap above patches this one line
    // surgically: `btn.outerHTML = …` removes the ✓ from the DOM without touching the card's
    // `__kdsHtml`, which is the copy reconcileList() compares against to decide whether to repaint.
    // So once the status is restored the desired html matches that stale copy exactly, the
    // reconciler concludes "unchanged, reuse the node", and the node it reuses is the one with no
    // ✓ on it. Measured on a ticket with two cooking dishes: the dish reads `preparing` on the
    // server and everywhere else, and the cook still cannot re-send it — no ✓, and none arriving
    // on the next read, or the one after. It only comes back when something ELSE changes that
    // ticket's html, which for a ticket showing "DAY 12d 1h" is the age text, once an hour.
    // A single-dish ticket hid this: finishing it moves the card to the Ready lane, and
    // moveCardToReady() rebuilds the card and re-stamps __kdsHtml on the way. Nothing rebuilds a
    // card that never changed lane.
    // Clearing the stamp is the whole fix: the next reconcile sees "I have no idea what this card
    // says" and repaints it from the truth. Cheap, and it cannot make anything else stale.
    forgetCardHtml(o ? o.id : it.order_id);
    toast("Failed: " + e.message);
    freshLoad();
  });
}

// Take back a "marked ready": drop the optimistic overlay, restore each dish's
// prior status locally + on the server, then reconcile from the truth. Shared by
// the single-✓ and ALL-READY paths. Reverting is a rare manual tap, so a full
// load() at the end (instead of surgical patching) is fine and keeps state honest.
async function undoReady(snap, orderId) {
  if (orderId != null) pendingReadyOrders.delete(orderId);
  snap.forEach((s) => {
    pendingReady.delete(s.id);
    const it = (state.items || []).find((x) => x.id === s.id);
    if (it && it.status !== "served") it.status = s.prev;
  });
  // (The take-back does NOT need forgetCardHtml. It looks like it should — the tap patched the card
  // in place, so the stamp is stale here too — but it was measured both ways, tapping UNDO the
  // instant the bar appears, and the board behaves identically: the freshLoad() at the end of this
  // function is what puts the ✓ back, in about the same moment either way. Adding the call changed
  // nothing a cook could see, so it is not here. T6 re-check, 2026-08-19.)
  render();
  try {
    // ONE REQUEST FOR THE WHOLE TICKET (owner-picked improvement, 2026-08-07). This used to be
    // `for (const s of snap) await api(...)` — one round trip per dish, in series — so taking back a
    // 12-dish "ALL READY" meant twelve waits on restaurant wifi, on the exact tap a cook makes the
    // instant they realise they were too quick. /orders/:id/unready restores each dish to the status
    // it actually had (the snapshot travels in the body, because a ticket can hold a mix of
    // 'received' and 'preparing' and a blanket write would move the wrong ones).
    //
    // The per-dish loop is KEPT as the fallback, and not out of caution: the single-✓ undo passes no
    // orderId (it takes back one dish, which may not be the whole ticket), and an OFFLINE replay of a
    // bulk unready would have to be re-checked against a board that has since moved. One dish is one
    // round trip either way, so the fallback costs nothing where it is used.
    if (orderId != null && snap.length > 1) {
      const r = await api("POST", `/orders/${orderId}/unready`, { dishes: snap.map((s) => ({ id: s.id, prev: s.prev })) });
      if (r && r.queued) { toast("Saved on this device ✓ — it will send by itself."); return; }
    } else {
      for (const s of snap) await api("POST", `/items/${s.id}/status`, { status: s.prev });
    }
  } catch (e) {
    toast("Undo failed: " + e.message);
  }
  freshLoad();   // a write just landed — do not accept a read that predates it
}
// Move ONE fully-ready ticket into the Ready column without a whole-board rebuild:
// re-render just that card (now shows "ready — waiter serving", no buttons), drop it
// in #list-ready, and recount/refill both columns.
function moveCardToReady(o) {
  const card = document.querySelector(`.ticket[data-ticket="${o.id}"]`);
  if (!card) return;
  const html = ticketHtml(o);
  const tmp = document.createElement("div"); tmp.innerHTML = html;
  const fresh = tmp.firstElementChild;
  if (!fresh) return;
  fresh.__kdsHtml = html; // keep the reconcile change-check in sync (buttons are delegated)
  // WALL view: just refresh this ONE card in place (footer → "ready — waiter serving",
  // ✓ buttons gone). The full re-sort to the end happens on the debounced reconcile —
  // rebuilding the whole grid per tap would jump cards + eat the cook's next tap.
  if (view === "wall") { card.replaceWith(fresh); return; }
  // COLUMNS view: slide the finished card into the Ready column + recount, without a
  // whole-board rebuild (so other tickets' ✓ buttons survive a rapid rush).
  const readyList = document.getElementById("list-ready");
  if (!readyList || card.parentElement === readyList) return;
  readyList.querySelector(".empty")?.remove();
  card.remove();
  readyList.appendChild(fresh);
  ["new", "cooking", "ready"].forEach((key) => {
    const list = document.getElementById("list-" + key); if (!list) return;
    const n = list.querySelectorAll(".ticket").length;
    const c = document.getElementById("count-" + key); if (c) c.textContent = String(n); // "0" on empty, matching the full-render pill (was n||"" → blank→"0" flicker)
    if (n === 0 && !list.querySelector(".empty")) list.innerHTML = `<div class="empty">Nothing here.</div>`;
  });
}
// Mark every not-served dish on an order ready (the "ALL READY" button). Update the board
// SURGICALLY (move just this card to Ready), NOT a whole-board render() — a full repaint
// re-buckets/rebuilds every ticket and eats a cook's concurrent tap on another card. Same
// surgical approach as the single-✓ path (markItemReady → moveCardToReady).
function markOrderReady(orderId) {
  // Snapshot each dish's prior status BEFORE we flip it, so an accidental "ALL READY"
  // can be taken back to exactly where each dish was (owner undo bar, 2026-07-22).
  const snap = (state.items || [])
    .filter((i) => i.order_id === orderId && i.status !== "served")
    .map((i) => ({ id: i.id, prev: i.status }));
  pendingReadyOrders.add(orderId); // legacy-order overlay so a slow-DB reconcile can't revert it
  setLocalReady((i) => i.order_id === orderId);
  const o = (state.orders || []).find((x) => x.id === orderId);
  if (o) {
    if (orderPhase(o) === "ready") moveCardToReady(o); // fully ready → slide its card over
    else { // (defensive) still cooking somehow → just refresh this one card in place
      const card = document.querySelector(`.ticket[data-ticket="${o.id}"]`);
      if (card) { const html = ticketHtml(o); const tmp = document.createElement("div"); tmp.innerHTML = html; const fresh = tmp.firstElementChild; if (fresh) { fresh.__kdsHtml = html; card.replaceWith(fresh); } }
    }
  }
  api("POST", `/orders/${orderId}/ready`).then((r) => {
    if (r && r.queued) { toast("Saved on this device ✓ — it will send by itself."); return; } // saved on this device, not sent
    scheduleReadyReconcile();
    // Offer a takeback only when we captured per-dish rows to revert (session
    // orders); legacy JSON-item orders have no per-dish id, so we skip the bar there.
    if (snap.length && window.LFH_UNDO) {
      LFH_UNDO.show({
        message: "All dishes marked ready",
        sub: o ? `${tlong(o.table_number)} · ${snap.length} dish${snap.length > 1 ? "es" : ""}` : `${snap.length} dishes`,
        icon: "🔥",
        onUndo: () => undoReady(snap, orderId),
      });
    }
  }).catch((e) => {
    // Same rule as the single ✓ above, and this one is worse: the whole ticket had already slid
    // into the Ready lane, so a refused ALL READY left a table's entire order sitting on the pass
    // marked finished when the server had recorded nothing. BOTH overlays have to go — the
    // item-keyed one for session orders and the order-keyed one that covers a legacy order's
    // JSON dishes — or the very next read paints it ready again.
    pendingReadyOrders.delete(orderId);
    snap.forEach((s) => pendingReady.delete(s.id));
    toast("Failed: " + e.message);
    freshLoad();
  });
}

// Manual REPRINT (owner 2026-07-07): re-run the KOT print for ONE order's current dishes on
// demand — the safety net for a print-first kitchen when the printer jammed / ran out of paper
// during the automatic print. It calls printKot directly (a local, no-network action), so it
// does NOT touch the auto-print tracking (printedIds) and can be tapped as many times as needed.
function reprintOrder(id) {
  const o = (state.orders || []).find((x) => x.id === id);
  if (!o) { toast("That order isn't on the board any more."); return; }
  const rows = (state.items || []).filter((it) => it.order_id === id); // empty for legacy orders → printKot falls back to o.items
  // The big DUPLICATE banner (owner, 2026-08-04) — but ONLY when this ticket already came out
  // once (printedIds). In a kitchen with no auto-print, this 🖨 button IS the first print, and
  // branding a first print "DUPLICATE" would be a lie on paper.
  const dup = printedIds.has(o.id);
  // Say what actually happened. This used to toast "Reprinting…" unconditionally while printKot
  // swallowed every failure, so a cook who tapped 🖨 after a paper jam was told the ticket was on
  // its way and no paper came out.
  if (printKot(o, rows, state.restaurant, { reprint: dup })) {
    if (!dup) { printedIds.add(o.id); savePrintedIds(); } // a manual FIRST print counts — the next tap is a duplicate
    toast(`${dup ? "Reprinting (marked DUPLICATE)" : "Printing"} KOT #${o.kot_no ?? "—"} · ${tlong(o.table_number)}`);
  } else toast(`Couldn't print KOT #${o.kot_no ?? "—"} — check the printer, then try again.`);
}

// ── the 86 board (sold-out toggles) ──────────────────────────────────────────
function renderDishes() {
  // Trim so a stray space / spaces-only search isn't treated as a real query that matches
  // nothing (it used to blank the whole drawer).
  const q = ($("#dishSearch").value || "").trim().toLowerCase();
  const list = state.dishes.filter((d) => !q || (d.title || "").toLowerCase().includes(q));
  const rows = list.map((d) => {
    const out = (d.tags || []).includes("sold-out");
    return `<div class="dish-row ${out ? "is-out" : ""}">
      <span class="dtitle">${esc(d.title)}<small>${esc(d.category || "")}</small></span>
      <button class="btn ${out ? "danger" : ""}" data-86="${esc(d.id)}" data-out="${out ? "1" : "0"}">${out ? "SOLD OUT" : "available"}</button>
    </div>`;
  }).join("");
  // Never show a blank drawer: an empty result gets an honest message (a cook who mistypes
  // couldn't tell if the board broke), otherwise nothing seeded yet.
  const html = rows || `<div class="dish-row" style="justify-content:center;opacity:.65;pointer-events:none">${q ? `No dishes match “${esc(q)}”` : "No dishes on the menu yet"}</div>`;
  // Skip the rebuild when nothing changed (audit 2026-07-07): a poll while the drawer is
  // open used to blow away #dishList on EVERY refresh, which (a) lost the search box's focus/
  // caret mid-type and (b) orphaned the button node the optimistic toggle + UNDO closure hold,
  // so an UNDO landed on a detached node and the on-screen button kept showing the wrong label.
  if ($("#dishList").__kdsHtml === html) return;
  $("#dishList").innerHTML = html;
  $("#dishList").__kdsHtml = html;
  // OPTIMISTIC sold-out toggle (audit polish 2026-07-07): flip the button + the local
  // dish tag INSTANTLY (no ~1.5s dead window), disable to swallow a rapid double-tap, and
  // roll back on failure. No full load() per tap — the server POST fires the guest 86-sync
  // breadcrumb itself, and the kitchen tickets don't render sold-out, so a whole-board
  // refetch was pure waste. Mirrors the ticket-✓ optimistic+surgical pattern.
  // set86 works by dish ID and RE-QUERIES the on-screen button every time (audit 2026-07-07):
  // renderDishes can rebuild #dishList between the tap and the UNDO, so a captured button node
  // may be detached. Updating the local dish tag is independent of the DOM, so it still happens
  // even if the button isn't currently visible (e.g. filtered out by the search box).
  const set86 = (id, out) => {
    const dish = state.dishes.find((d) => d.id === id);
    if (dish) { const tags = new Set(dish.tags || []); out ? tags.add("sold-out") : tags.delete("sold-out"); dish.tags = [...tags]; }
    const btn = document.querySelector(`[data-86="${window.CSS && CSS.escape ? CSS.escape(id) : id}"]`);
    if (!btn) return;
    btn.dataset.out = out ? "1" : "0";
    btn.textContent = out ? "SOLD OUT" : "available";
    btn.classList.toggle("danger", out);
    btn.closest(".dish-row")?.classList.toggle("is-out", out);
  };
  document.querySelectorAll("[data-86]").forEach((b) => (b.onclick = async () => {
    if (b.disabled) return;
    const id = b.dataset["86"], wasOut = b.dataset.out === "1", nowOut = !wasOut;
    b.disabled = true; set86(id, nowOut);
    try {
      const r = await api("POST", `/dishes/${id}/sold-out`, { value: nowOut });
      // SAVED, NOT SENT. This panel was the only one that never said so: the optimistic tile
      // flipped, nothing reached the server, and a cook could close the tab believing the board
      // was updated. (The offline bar counts it, but the tap itself said nothing.)
      if (r && r.queued) toast("Saved on this device ✓ — it will send by itself.");
      const dish = state.dishes.find((d) => d.id === id);
      // No confirm — kitchens move fast — but always an UNDO escape hatch, now the shared
      // ring-card bar (owner, 2026-07-22). The UNDO targets the dish by ID (re-querying the
      // live button), so it works even after a background refresh rebuilt the list. The
      // server toggle is an explicit set, so a double-tap is harmless.
      const undo86 = async () => {
        set86(id, wasOut);
        try { await api("POST", `/dishes/${id}/sold-out`, { value: wasOut }); }
        catch (e) { set86(id, nowOut); toast("Undo failed: " + e.message); }
      };
      if (window.LFH_UNDO) LFH_UNDO.show({
        message: `${dish ? dish.title : "Dish"} ${wasOut ? "back on the menu" : "marked sold out"}`,
        sub: "Tap undo to change it back",
        icon: "🚫",
        onUndo: undo86,
      });
      else toast(`${dish ? dish.title : "Dish"} ${wasOut ? "back on the menu" : "marked SOLD OUT"}`, undo86);
    } catch (e) {
      set86(id, wasOut); // roll back the optimistic flip
      toast("Failed: " + e.message);
    } finally { b.disabled = false; }
  }));
}

// A fingerprint of everything the board draws — same idea as the tablet: only
// re-render when it changes, so a tap on ACCEPT / a dish ✓ landing exactly when
// the poll fires can't be eaten by a DOM rebuild.
// BULLETPROOF redraw fingerprint. We serialize the FULL drawn rows (minus a few
// heartbeat-only columns) so ANY field that affects a ticket — including columns
// added in the FUTURE — flips the signature and forces a repaint. Do NOT shrink
// this back to a hand-picked field list: a hand-picked list silently missed
// allergy/note edits, so they only appeared after a MANUAL refresh (bug fixed
// 2026-06-17). New editable field on an order/dish? It's already covered here.
// See CLAUDE.md "Live-update redraw guard". RT_VOLATILE = columns that change with
// NO visible effect (heartbeats / derived timestamps) — excluded so idle polls and
// post-action reconciles don't needlessly rebuild the DOM.
const RT_VOLATILE = new Set(["last_activity_at", "updated_at", "cart_updated_at", "served_at"]);
const stableRow = (row) => { const o = {}; for (const k in (row || {})) if (!RT_VOLATILE.has(k)) o[k] = row[k]; return o; };
function boardSig(d) {
  return JSON.stringify([
    (d.orders || []).map(stableRow),
    (d.items || []).map(stableRow),
    (d.dishes || []).map(stableRow),
    (d.platform || []).map(stableRow),
    d.platformAccept,
    // autoPrintKot drives whether the per-ticket 🖨 reprint button renders, so a change to it
    // must flip the signature and force a repaint (read from state — it's not on every caller's d).
    state.autoPrintKot,
    // Table names are DRAWN on every ticket header, so renaming a table in the manager panel
    // must repaint the board — the orders themselves don't change, so without this the ticket
    // would keep showing the old label until the cook manually refreshed.
    state.tableNames,
    state.tableTags,   // drawn on the ticket header too — see tableTagMap in the kitchen route
  ]);
}
let lastSig = null;
// ── the poll ─────────────────────────────────────────────────────────────────
// Rising-ticket guard: act() taps, the 86-board undo, the realtime onEvent and the
// backup timer all call load() independently. Without this, whichever fetch FINISHES
// last wins — even an older snapshot — flashing a stale board. Drop any response
// that a newer load() has already superseded.
let loadSeq = 0;
// The restaurant's display name for the header: prefer the short brand label
// (logo_text), else the English name, else any translation, else a neutral
// fallback. Renders "" while nothing is loaded yet — never "undefined". NEVER a
// hardcoded brand (this app is multi-tenant).
function restDisplayName(r) {
  if (!r) return "";
  if (r.logo_text && String(r.logo_text).trim()) return String(r.logo_text).trim();
  const n = r.name;
  if (typeof n === "string" && n.trim()) return n.trim();
  if (n && typeof n === "object") {
    if (n.en && String(n.en).trim()) return String(n.en).trim();
    const any = Object.values(n).find((v) => v && String(v).trim());
    if (any) return String(any).trim();
  }
  return "Restaurant";
}
function setRestName(r) {
  const el = document.getElementById("restName");
  // Strip the *accent* wordmark markers so a literal '*' never shows in the
  // header (matches lib/brandText stripBrandMarkers; see tablet setRestName).
  if (el) el.textContent = restDisplayName(r).replace(/\*/g, "");
}

// loadTables(tables): TARGETED refetch — fetch ONLY the named tables' orders+items
// (/board?table=N) and merge each table's rows into the cached board, instead of re-reading
// the WHOLE board on every breadcrumb. Dishes/platform are table-agnostic (a platform/menu
// event always arrives as `full`), so a targeted pass leaves them untouched. The merge drops
// the changed orders' old rows by id and adds the fresh ones; then it runs the SAME
// boardSig/render + chime path as load(). ANY surprise → full load() (safe fallback).
// (owner 2026-06-26 — 96%+ of egress was whole-board reads; this scopes it.)
async function loadTables(tables) {
  if (!tables || !tables.length) return load();
  if (!state.knownIds) return load(); // not baselined yet — let load() set it (and never chime on first paint)
  const seq = ++loadSeq;
  let slices;
  try {
    // `&jobs=1` while this screen is the printer: a new order's breadcrumb names its table, so THIS
    // targeted read is what answers it — without the queue riding along, a queued ticket waited for
    // the 60s backstop (measured while building mig 335). Off when auto-print is off, so an ordinary
    // display's slice stays exactly as cheap as before.
    const jobsQ = state.autoPrintKot ? "&jobs=1" : "";
    slices = await Promise.all(tables.map((t) => api("GET", "/board?table=" + encodeURIComponent(t) + jobsQ)));
  } catch (e) { return load(); }      // network/parse blip → safe full reload
  // NOTE: the latest-wins `seq` guard used to sit HERE and `return` — which silently
  // dropped a superseded targeted refetch BEFORE it printed/chimed/merged, so a rush
  // (two new-order breadcrumbs on different tables >200ms apart, or a concurrent full
  // load()) could lose a KOT entirely until the 60s backstop (bug H6, 2026-07-05). The
  // side-effects (print/chime/knownIds) and the state MERGE are idempotent (dedup by
  // id, knownIds prevents a double-print), so we now always apply them and gate only
  // the final render() on staleness — the newer refresh paints the merged-in board.

  // Defensive dedup by row id (fresh row wins over a stale cached copy). The drop/add below
  // keys orders by id and items by order_id; this guarantees a row can never appear twice
  // even if a shift left a row's table_number disagreeing between cache and server.
  const dedupeById = (arr) => { const m = new Map(); for (const x of arr) if (x && x.id != null) m.set(x.id, x); return [...m.values()]; };

  const freshOrders = dedupeById(slices.flatMap((s) => (s && s.orders) || []));
  const freshItems = dedupeById(slices.flatMap((s) => (s && s.items) || []));
  // The special-table marks ride on the TARGETED response too, and they have to: marking a table
  // VIP writes `table_tags`, and that breadcrumb NAMES the table — so this targeted path is what
  // answers it, not a full board read. Taking the whole map (not a per-table merge) is what lets a
  // mark being REMOVED disappear as well; every slice carries the same restaurant-wide map, so the
  // last one is as good as the first. (T4 sweep fix, 2026-08-06)
  const freshTags = slices.map((s) => s && s.tableTags).filter((m) => m && typeof m === "object").pop();
  if (freshTags) state.tableTags = freshTags;

  // CHIME — detect a brand-new dine-in order in the slice BEFORE touching
  // knownIds, then ADD each fresh order's id to the baseline (never reassign it — a
  // reassign would make the next targeted event for a DIFFERENT table false-chime its
  // existing orders as "new"). Platform tickets only arrive on the FULL path (load()).
  // Rings for 'received' (awaiting accept) AND for a GUEST order born 'preparing'
  // (member_id set) — follow-up orders auto-accept since mig 164, so they'd otherwise
  // land on the pass silently. Waiter orders (member_id null) stay chime-free: the
  // waiter is standing at the table. An accepted first order can't double-chime — its
  // id entered knownIds while it was still 'received'.
  const newReceived = freshOrders.filter((o) => (o.status === "received" || (o.status === "preparing" && o.member_id)) && !state.knownIds.has(o.id));
  if (newReceived.length) chime();
  // The targeted slice never carries `queuedFor` (it is a whole-board answer), so the net stays out
  // of it on purpose — the queue prints these, and the next full read runs the net if it must.
  autoPrintNet(state.autoPrintKot, freshOrders, freshItems, state.restaurant, null);
  // The queue rode along on the slice (see `jobs=1` above) — print whatever is waiting, now, rather
  // than on the next whole-board pass. Every slice carries the same restaurant-wide list, so one
  // pass over the last one is enough; the atomic claim makes a repeat harmless anyway.
  { const jl = slices.map((s) => s && s.printJobs).filter((j) => Array.isArray(j) && j.length).pop(); if (jl) processPrintJobs(jl); }
  for (const o of freshOrders) state.knownIds.add(o.id);

  // The set of orders the changed tables used to show (cached) PLUS the orders the slice
  // returned — drop ALL of these from the cached items, then add the slice's fresh items.
  // Keying items by order_id (not session_id) handles today's closed-session items too.
  const changedTables = new Set(tables.map(String));
  const purgedOrderIds = new Set(freshOrders.map((o) => o.id));
  for (const o of (state.orders || [])) if (changedTables.has(String(o.table_number))) purgedOrderIds.add(o.id);

  // ORDERS — drop the changed tables' old rows, add their fresh rows, keep the rest.
  let orders = (state.orders || []).filter((o) => !changedTables.has(String(o.table_number)));
  orders = dedupeById(orders.concat(freshOrders));
  orders.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || ""))); // ascending, same as liveOrdersAndItems
  // Re-apply the LEGACY-order optimistic overlay (see load()) so a just-ALL-READY'd legacy
  // order (dishes in orders[].items, no order_items rows) doesn't revert to cooking on a
  // targeted refetch that landed before the server caught up.
  state.orders = pendingReadyOrders.size
    ? orders.map((o) => (pendingReadyOrders.has(o.id) && Array.isArray(o.items)
        ? { ...o, items: o.items.map((i) => (i.status !== "served" ? { ...i, status: "ready" } : i)) }
        : o))
    : orders;

  // ITEMS — drop every item belonging to a purged order, add the slice's fresh items.
  // Re-apply the pendingReady overlay exactly like load() so a mid-rush ✓ doesn't flicker.
  let items = (state.items || []).filter((it) => !purgedOrderIds.has(it.order_id));
  items = dedupeById(items.concat(freshItems));
  state.items = pendingReady.size
    ? items.map((i) => (pendingReady.has(i.id) && i.status !== "served" ? { ...i, status: "ready" } : i))
    : items;

  // If the 86-board drawer is open, keep it fresh (dishes are unchanged on a targeted pass,
  // but a re-render is cheap and harmless).
  if (!$("#drawerOverlay").hidden) renderDishes();
  // Latest-wins guard, moved to gate ONLY the render (state + prints already applied
  // above so nothing is lost): if a newer refresh started, let IT paint the board.
  if (seq !== loadSeq) return;
  const sig = boardSig({ orders: state.orders, items: state.items, dishes: state.dishes, platform: state.platform, platformAccept: state.platformAccept });
  if (sig === lastSig) return; // nothing visible changed — don't rebuild the tickets
  lastSig = sig;
  render();
}

// Auto-print a KOT (kitchen order ticket) for a brand-new order. Uses a HIDDEN IFRAME (not a
// popup) so no popup-blocker prompt fires; on a kitchen device launched in Chrome "kiosk
// printing" mode it prints silently to the default printer. Default OFF — only runs when the
// admin allowed it AND the owner toggled it on (board.autoPrintKot). Printer-agnostic compact
// layout (works on an 80mm thermal roll or A4). NO prices — a KOT is for the kitchen, not a bill.
function printKot(order, itemRows, restaurant, opts) {
  try {
    const rname = restDisplayName(restaurant).replace(/\*/g, "") || "Kitchen";
    // The table as the FLOOR knows it — its name when the owner gave it one ("A1"), else
    // "Table 7". Printing the raw number on a renamed table sends staff to the wrong table.
    const tlab = whereFor(order, true);   // the table as the FLOOR knows it ("A1"), or "T?" when a bill has no table
    const kot = order.kot_no != null ? order.kot_no : "—";
    // LFH_BILLDOC.kotWhen, not a bare time — a ticket rung five days ago on an overnight table
    // used to print exactly like one rung tonight, and paper has no colour to say otherwise.
    const when = LFH_BILLDOC.kotWhen(order.created_at);
    const rows = (itemRows && itemRows.length)
      ? itemRows
      : (Array.isArray(order.items) ? order.items : []);
    // ONE TICKET, ONE FILE. The kitchen used to carry its own hand-kept copy of this markup,
    // which is how a ticket could look one way here and another way in the manager panel or in
    // the admin’s sample (owner, 2026-08-02: “both should be sync”). The paper is described
    // once, in /panels/billdoc.js; this only decides what goes on it. Nothing looks different.
    const html = LFH_BILLDOC.kotDocHtml({
      title: "KOT " + kot,
      rname: rname,
      head: "KITCHEN TICKET",
      kot: kot,
      tableLabel: tlab,
      when: when,
      lines: rows,
      allergies: Array.isArray(order.allergies) ? order.allergies : [],
      // The big "*** REPRINT · DUPLICATE ***" banner — rendered by billdoc.js itself, so a
      // duplicate looks identical whichever panel asked for it (owner, 2026-08-04).
      reprint: !!(opts && opts.reprint),
    });
    const ifr = document.createElement("iframe");
    ifr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(ifr);
    const d = ifr.contentWindow.document; d.open(); d.write(html); d.close();
    // Remove the hidden print frame only AFTER the browser signals it finished printing.
    // The old blind 1500ms timer often deleted the frame while Chrome's print preview was
    // still open, dropping Chrome's internal print callback ("The provided callback is no
    // longer runnable" — logged as a red client_error). onafterprint fires in both silent/
    // kiosk and preview modes; the long fallback covers a preview the user just walks away from.
    setTimeout(() => {
      const w = ifr.contentWindow;
      let done = false;
      const cleanup = () => { if (done) return; done = true; try { ifr.remove(); } catch (e) {} };
      try { w.onafterprint = cleanup; } catch (e) {}
      // THE PRINT CALL ITSELF IS NOT ALLOWED TO FAIL IN SILENCE (T6 sweep, 2026-08-17). The catch
      // at the bottom of printKot() was written precisely so a kitchen with no paper coming out
      // could be diagnosed from the log instead of guesswork — but it only covers the SYNCHRONOUS
      // setup. The actual print happens here, 250ms later, and its failure was swallowed by an
      // empty catch: printKot had already returned true, so the cook was told "Printing KOT #313",
      // the ticket was recorded in printedIds, and a print-first kitchen could work a whole service
      // with nothing on paper and nothing anywhere saying so. That is the exact thing the function
      // says it must never do. So: un-record the ticket (the next pass retries it, and a manual 🖨
      // is not branded "DUPLICATE" for a ticket that never came out), write it to the Everything
      // Log, and tell the cook and the manager through the same throttled path a synchronous
      // failure already uses — once a minute, never once per ticket.
      // A TICKET NEVER PULLS THE SCREEN AWAY FROM THE PERSON USING IT (owner, 2026-08-20: at Aangan
      // one man is the owner AND the manager — he sits at the counter in the owner panel, in Manager
      // mode, and "the chrome you open is switching the owner panel to the kitchen when the print is
      // being done. I want it works always in background"). This used to call w.focus() FIRST, on every
      // automatic ticket. Focusing a frame is a user-visible focus change, and in a browser where the
      // printing panel is a TAB beside the panel he is working in, that is enough to bring the printing
      // tab forward — so every order yanked him out of the floor plan he was reading.
      // focus() was here for old browsers that printed the PARENT document when an iframe was printed
      // unfocused. Chrome — the only browser a print station runs, and the one this guide sets up —
      // prints the frame either way. So: print WITHOUT touching focus, and keep the old behaviour as a
      // FALLBACK for the one case that justified it, a print() that actually threw.
      try { w.print(); }
      catch (e1) {
        try { w.focus(); w.print(); }
        catch (e) {
          try { if (order && order.id != null) { printedIds.delete(order.id); savePrintedIds(); } } catch (_e) {}
          try { logKotPrintFailure(e); } catch (_e) {}
          try { notePrintTrouble(); } catch (_e) {}
        }
      }
      setTimeout(cleanup, 60000);
    }, 250);
    return true;
  } catch (e) {
    // Printing must NEVER break the board — but it must never LIE either. Everything above is
    // wrapped, so a failure here (billdoc.js missing after a bad deploy, the iframe blocked)
    // used to be swallowed whole: a print-first kitchen could run a service with no tickets
    // and nothing on screen or in the log saying so. Report it instead of returning silently.
    try { logKotPrintFailure(e); } catch (_e) {}
    return false;
  }
}
// One place to say a ticket did not print. It writes to the Everything Log via the shared
// error hook when it exists (errlog.js) and always leaves a console trace, so a kitchen with
// no paper coming out can be diagnosed from the log instead of guesswork.
function logKotPrintFailure(e) {
  const msg = "KOT print failed: " + ((e && e.message) || e);
  if (window.LFH_ERRLOG && typeof window.LFH_ERRLOG.report === "function") window.LFH_ERRLOG.report(msg, "printKot");
  console.error("[kitchen]", msg, e);
}

// Auto-print the KOT for brand-new received orders — the ONE place both load() and
// loadTables() call so print-tracking is consistent (bug H7, 2026-07-05).
//  • `printedIds` is SEPARATE from `knownIds` (which tracks chime/"seen"). A hidden
//    tab's 60s backstop still advances knownIds, so gating print on knownIds meant a
//    backgrounded tab consumed new orders as "seen" and NEVER printed them. Gating on
//    printedIds instead means an unprinted order stays pending until it actually prints.
//  • While the tab is HIDDEN the browser suppresses iframe printing, so we DON'T print
//    (and DON'T mark printed) — the orders flush on the next visible pass instead of
//    being silently lost, and don't flood all at once.
//  • Prints are SERIALIZED (spaced) so a burst doesn't stack N blocking dialogs at once
//    in a non-kiosk browser (partially mitigates M7; kiosk mode prints silently anyway).
//  • It SURVIVES A RELOAD, on this device (fixed 2026-08-06, T4 sweep). It used to be a plain
//    in-memory Set, so reloading the kitchen screen — or reopening the tab next shift — forgot
//    every ticket it had ever printed. The consequence was on PAPER, not on screen: the manual 🖨
//    stamps the big "*** REPRINT · DUPLICATE ***" banner from this Set, so after a reload a cook
//    tapping 🖨 on an already-printed ticket got a second identical ticket with NO duplicate mark
//    — exactly the two-tickets-on-the-rail confusion the banner was added for on 2026-08-04.
//    (The manager's queued reprints were always safe: they carry `reprint` on the print_jobs row.)
//    Keyed per device, which is the honest claim: "this screen has printed this ticket before."
const PRINTED_KEY = "kds_printed_ids";
const printedIds = new Set((() => {
  try {
    const raw = JSON.parse(localStorage.getItem(PRINTED_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch { return []; }   // a corrupt/absent value simply starts empty, exactly as before
})());
// Write the Set back after every change. Cheap (a few hundred short ids at most, and it only runs
// when a ticket is actually printed or pruned), and wrapped because a device with storage disabled
// must still print — it just forgets across reloads, which is the old behaviour, not a new fault.
const savePrintedIds = () => {
  try { localStorage.setItem(PRINTED_KEY, JSON.stringify([...printedIds])); } catch { /* private mode / quota — fall back to in-memory only */ }
};
// When this panel booted. Used so a brand-new order that arrives DURING the first /board
// fetch (the ~1s boot window) is recognised as genuinely new and still auto-prints — the
// old code seeded EVERY order on first load as "already printed", so a KOT placed in that
// window was silently never printed. KOT print is the kitchen's main use, so this matters.
const BOOT_TS = Date.now();
// Serialized (spaced) printer for a queue of orders — the ONE place that actually prints,
// so print-tracking (printedIds) stays consistent and a burst can't stack N blocking
// dialogs at once in a non-kiosk browser. Paused while the tab is hidden mid-burst.
// Tell the cook that automatic printing isn't working — ONCE a minute, not once per ticket.
// A rush that can't print would otherwise bury the board in toasts, and the point is that they
// learn at all, not that they learn twelve times.
let lastPrintTroubleAt = 0;
function notePrintTrouble() {
  if (Date.now() - lastPrintTroubleAt < 60000) return;
  lastPrintTroubleAt = Date.now();
  toast("Kitchen tickets aren't printing — check the printer. Orders are still on the board.");
  // …and tell the MANAGER, not only whoever is standing at this screen (owner, 2026-08-04:
  // "if anything happens in the kitchen it should notify the manager"). Rides the offline
  // outbox, so a report taken with no signal still arrives; the server MERGES repeats
  // (count+1 on the open row), so a rush with a dead printer is one line on the manager's
  // floor, never a flood. Auto-resolved by the next successful print.
  api("POST", "/printer-events", { kind: "auto_fail", note: "Automatic KOT print failed on the kitchen screen" }).catch(() => {});
}

// ── THE KITCHEN END OF THE DURABLE PRINT QUEUE (mig 269) ─────────────────────────────
// The manager's "Reprint in kitchen" is a ROW, and this is how it reaches paper. Jobs ride
// along on the normal /board read (the insert's own breadcrumb triggers one), so a kitchen
// that was closed or offline prints everything that queued up the moment it is back — no
// new poll, nothing to time. CLAIM is a deliberate plain fetch (never the outbox): a claim
// replayed hours later would print a stale ticket behind everyone's back, and a failed
// claim simply waits for the next board pass. The DONE report does ride the outbox — it is
// idempotent, and losing it would make the 2-minute reclaim window reprint the ticket.
const jobsInFlight = new Set();
async function claimPrintJobs(ids) {
  const r = await fetch("/api/kitchen" + ridQ("/print-jobs/claim"), {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
    body: JSON.stringify({ ids }),
  });
  if (!r.ok) throw new Error("claim HTTP " + r.status);
  return (await r.json().catch(() => ({}))).won || [];
}
function processPrintJobs(jobs) {
  // IT NO LONGER REFUSES WHILE HIDDEN (owner, 2026-08-17: "if you minimize, or open another app on
  // the same PC, the KOT prints totally stop"). This used to return early on `document.hidden`,
  // which was the honest thing when a missed ticket was gone forever — the browser may suppress a
  // print from a background window, so trying looked pointless. Since mig 335 the ticket is a ROW:
  // if the print does not happen, the job is reported failed and REQUEUED (five tries, then the
  // manager's floor strip says so), and if it does happen the paper is out. So the right move is to
  // TRY, always. A window Chrome was launched with --disable-backgrounding-occluded-windows (see
  // docs/KITCHEN-PRINT-SETUP.md) prints perfectly well while another app sits on top of it.
  if (!Array.isArray(jobs) || !jobs.length) return;
  const fresh = jobs.filter((j) => j && j.order && !jobsInFlight.has(j.id));
  if (!fresh.length) return;
  fresh.forEach((j) => jobsInFlight.add(j.id));
  claimPrintJobs(fresh.map((j) => j.id)).then((wonIds) => {
    const wonSet = new Set(wonIds);
    // Another kitchen screen won these — the atomic claim is what stops a double print.
    fresh.filter((j) => !wonSet.has(j.id)).forEach((j) => jobsInFlight.delete(j.id));
    const mine = fresh.filter((j) => wonSet.has(j.id));
    let i = 0;
    const step = () => {   // serialized 400ms apart, same as the auto-print queue
      const j = mine[i++]; if (!j) return;
      // A RETRY SAYS SO ON THE PAPER. `reprint` marks the manager's manual reprint; `attempts > 0`
      // marks a job we already tried once — if the first attempt did reach the printer after all,
      // the second sheet is a duplicate, and the one thing worse than two tickets on the rail is
      // two tickets on the rail that both look original (the reason the banner exists, 2026-08-04).
      const okPrint = printKot(j.order, j.items || [], state.restaurant, { reprint: j.reprint !== false || (j.attempts || 0) > 0 });
      // Remember the ORDER as printed, not just the job: the self-healing net below (autoPrintNet)
      // and the manual 🖨 button both read printedIds, and without this a queue-printed ticket would
      // look unprinted to them.
      if (okPrint && j.order && j.order.id) { printedIds.add(j.order.id); savePrintedIds(); }
      if (!okPrint) notePrintTrouble();
      api("POST", `/print-jobs/${j.id}/done`, { ok: okPrint, error: okPrint ? undefined : "print call failed on the kitchen screen" })
        .catch(() => {})
        .finally(() => jobsInFlight.delete(j.id));
      if (i < mine.length) setTimeout(step, 400);
    };
    step();
  }).catch(() => fresh.forEach((j) => jobsInFlight.delete(j.id))); // offline/busy — next board pass retries
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// ☰ MENU → ⚙️ SETTINGS → SIGN OUT, and the printer set-up (owner, 2026-08-19)
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// "Kitchen will have whole separate menu for setup named setting, make 3 line thing so that kitchen
// user can logout and so all that stuff too… all should be linked with the access and control in
// autoprint on and off — make sure if that thing is off then no option should show."
//
// Two things this screen never had: a way to SIGN OUT (there was none, anywhere), and anywhere to see
// how printing is set up. Both live behind ☰ now, in the same shape the waiter tablet uses — ☰ on the
// left, Settings inside it, Sign out inside Settings — so a cook who has used one panel recognises the
// other. Everything about printing DISAPPEARS when automatic printing is off for the restaurant: not
// greyed, not explained, absent (his standing rule of 2026-07-31 about dead controls).
//
// NO PROFILE HERE, deliberately: the kitchen has none and that has been ruled three times
// (2026-07-29, 2026-08-05, and again in lib/staffProfileShared.ts → PROFILE_ROLES). Do not add one.
let kdsDrawerOff = null;
function openKitchenMenu() {
  if (document.querySelector(".kds-dw")) return;
  const back = document.createElement("div"); back.className = "kds-dw-backdrop";
  const dw = document.createElement("aside"); dw.className = "kds-dw"; dw.setAttribute("aria-label", "Menu and settings");
  const rest = restDisplayName(state.restaurant).replace(/\*/g, "") || "this restaurant";
  dw.innerHTML = `<button class="dw-close" type="button" aria-label="Close menu">✕</button>
    <h3>🍳 Kitchen</h3>
    <div class="dw-sub">${esc(rest)}</div>
    <button class="dw-row" type="button" data-kdw="settings">⚙️ Settings</button>
    <button class="dw-row" type="button" data-kdw="printer">🖨 Printer</button>
    <button class="dw-row" type="button" data-kdw="issue">🚩 Report an issue</button>
    <a class="dw-row" href="/print-setup.html" target="_blank" rel="noopener">📖 Printer setup guide</a>
    <div class="dw-foot" id="kdsBuild"></div>`;
  document.body.appendChild(back); document.body.appendChild(dw);
  const close = () => { back.remove(); dw.remove(); if (kdsDrawerOff) { const o = kdsDrawerOff; kdsDrawerOff = null; o(); } };
  kdsDrawerOff = window.LFH_BACK ? LFH_BACK.layer("kitchen-menu", close) : null;
  back.onclick = close;
  dw.querySelector(".dw-close").onclick = close;
  dw.querySelectorAll("[data-kdw]").forEach((b) => (b.onclick = () => {
    const what = b.dataset.kdw; close();
    if (what === "settings") openKitchenSettings();
    else if (what === "printer") openPrinterSheet();
    else if (what === "issue" && window.LFH_ISSUE) LFH_ISSUE.open({ api, rid: PANEL_RID, notify: (m) => toast(m) });
  }));
  // The build tag READS the code (never a typed string): app.js is loaded with its own content hash,
  // so it changes exactly when the file does — which is the only honest answer to "is this screen
  // running the latest code?" (the tablet learned this the hard way, 2026-08-06).
  try {
    const me = [...document.querySelectorAll('script[src*="app.js"]')].pop();
    const v = me ? (new URL(me.src, location.href).searchParams.get("v") || "") : "";
    dw.querySelector("#kdsBuild").textContent = v ? "kitchen " + v : "kitchen (unknown)";
  } catch (e) {}
}

// ── ⚙️ Settings ─────────────────────────────────────────────────────────────────────────────────
// Printing · this screen's own preferences · sign out. Re-rendered in place whenever a board read
// brings news (so "who is printing" can never sit stale while somebody reads it).
let kdsSetOff = null;
function openKitchenSettings() {
  if (document.querySelector(".kset-ov")) return;
  const ov = document.createElement("div"); ov.className = "kset-ov";
  ov.innerHTML = `<div class="kset" role="dialog" aria-label="Kitchen settings"></div>`;
  document.body.appendChild(ov);
  window.__kdsSettingsOpen = true;
  const close = () => {
    window.__kdsSettingsOpen = false;
    if (kdsSetOff) { const o = kdsSetOff; kdsSetOff = null; o(); }
    ov.remove();
  };
  kdsSetOff = window.LFH_BACK ? LFH_BACK.layer("kitchen-settings", close) : null;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  window.__kdsSettingsClose = close;
  renderKitchenSettings();
}
function renderKitchenSettings() {
  const box = document.querySelector(".kset-ov .kset");
  if (!box) return;
  const auto = !!state.autoPrintKot;                       // this SCREEN may print (feature on AND this room)
  const tgt = state.kotPrintTarget || "kitchen";
  const st = state.station || null;
  const printingHere = !!(st && st.mine);
  const heldByOther = !!(st && st.active && !st.mine && !st.stale);
  const holder = st && st.active
    ? `${esc(st.active.label || (st.active.panel === "editor" ? "A counter screen" : "A kitchen screen"))}${st.active.claimed_by ? " · " + esc(st.active.claimed_by) : ""}`
    : "";
  const where = tgt === "counter" ? "the counter screen" : tgt === "both" ? "the kitchen screen, counter as backup" : "the kitchen screen";
  // PRINTING IS ABSENT, NOT GREYED, WHEN IT IS OFF FOR THE RESTAURANT (owner's rule). `auto` is
  // already "on AND this room prints", so a counter-only restaurant sees the explanation once, not a
  // set of controls it can never use.
  const printSection = (!auto && tgt !== "counter") ? "" : `
    <div class="kset-sec">
      <h4>🖨 Printing</h4>
      ${tgt === "counter" && !auto ? `<p class="kset-note">Kitchen tickets print on <b>the counter screen</b> for this restaurant, so this screen prints nothing automatically. The 🖨 button on a ticket still prints here if this screen has a printer of its own.</p>` : `
      <div class="kset-line"><span>Automatic printing</span><b>${auto ? "ON" : "OFF"}</b></div>
      <div class="kset-line"><span>Tickets print on</span><b>${esc(where)}</b></div>
      <div class="kset-line"><span>Printing right now</span><b>${printingHere ? "THIS screen" : st && st.active ? (st.stale ? holder + " (gone quiet)" : holder) : "no screen yet"}</b></div>
      ${printingHere
        ? `<p class="kset-note">Tickets are coming out of this screen's printer. It keeps working when this window is minimised or covered — that is what the setup guide's launcher is for.</p>
           <div class="kset-btns"><button class="btn" type="button" data-kstation="release">Stop printing on this screen</button>
           <a class="btn" href="/print-setup.html" target="_blank" rel="noopener">📖 Setup guide</a></div>`
        : heldByOther
          ? `<p class="kset-note">Tickets are coming out at <b>${holder}</b>. If the printer is actually here, take it over — the other screen stops printing straight away.</p>
             <div class="kset-btns"><button class="btn primary" type="button" data-kstation="take">🖨 Print here instead</button>
             <a class="btn" href="/print-setup.html" target="_blank" rel="noopener">📖 Setup guide</a></div>`
          : `<p class="kset-note">No screen is printing yet. Turn it on here, on the computer the printer is attached to.</p>
             <div class="kset-btns"><button class="btn primary" type="button" data-kstation="take">🖨 Print on this screen</button>
             <a class="btn" href="/print-setup.html" target="_blank" rel="noopener">📖 Setup guide</a></div>`}
      `}
    </div>`;
  box.innerHTML = `
    <div class="kset-head"><h3>⚙️ Settings</h3><button class="btn" type="button" data-kset-close aria-label="Close">✕</button></div>
    ${printSection}
    <div class="kset-sec">
      <h4>This screen</h4>
      <div class="kset-btns">
        <button class="btn" type="button" data-kset-click="muteBtn">🔔 New-order sound</button>
        <button class="btn" type="button" data-kset-click="viewBtn">▦ Board layout</button>
        <button class="btn" type="button" data-kset-click="themeToggle">🌗 Light / dark</button>
      </div>
      <p class="kset-note">These three are remembered on this device only.</p>
    </div>
    <div class="kset-sec">
      <h4>Account</h4>
      <!-- A FORM, not a link: /api/panel-logout is POST-only, because a GET that ends a session fires
           from anything that merely POINTS at the URL — a cook could be signed out mid-service. The
           route answers 303 → /login, so this works with no JavaScript at all. -->
      <!-- target="_top" IS THE WHOLE POINT (measured 2026-08-19). This panel runs inside an IFRAME on
           /kitchen (and /tablet), so a plain form submit navigates the FRAME: the login page loads
           inside the panel while the page around it, and its URL, stay exactly where they were. It
           looks almost right, which is why it survived — the person appears signed out and is not.
           Posting to _top signs the whole window out, which is what "Sign out" says. -->
      <form method="post" action="/api/panel-logout" target="_top" style="margin:0">
        <button type="submit" class="btn kset-danger" style="width:100%">Sign out</button>
      </form>
      <p class="kset-note">Signing out returns this screen to the login page. The board keeps running for everyone else.</p>
    </div>`;
  box.querySelector("[data-kset-close]").onclick = () => window.__kdsSettingsClose && window.__kdsSettingsClose();
  // The three device preferences are the SAME buttons the top bar owns — clicked through, never
  // re-implemented, so there is one place that changes each one (the ⋯ MORE menu does the same).
  box.querySelectorAll("[data-kset-click]").forEach((b) => (b.onclick = () => {
    const el = document.getElementById(b.dataset.ksetClick);
    if (el) el.click();
    renderKitchenSettings();
  }));
  box.querySelectorAll("[data-kstation]").forEach((b) => (b.onclick = async () => {
    if (b.disabled) return;
    b.disabled = true;
    const take = b.dataset.kstation === "take";
    try {
      const r = await api("POST", take ? "/print-station/take" : "/print-station/release", {});
      if (r && r.station) state.station = r.station;
      toast(take ? "This screen now prints the kitchen tickets ✓" : "This screen has stopped printing.");
      renderKitchenSettings();
      if (take) load().catch(() => {});     // anything already waiting prints straight away
    } catch (e) {
      b.disabled = false;
      toast("Couldn't change that: " + (e.message || "try again"));
    }
  }));
}

// ── One-tap printer problem report (owner, 2026-08-04) ──────────────────────────────
// Paper out, a half-printed ticket, a jam — faults a browser cannot see — reach the
// manager's floor with one tap. Same overlay discipline as the 86 board: registered as a
// back layer, closable by ✕/backdrop/back button, and the tap is never swallowed in
// silence (buttons disable while sending, every outcome toasts).
let prSheetOff = null;
function openPrinterSheet() {
  if (document.getElementById("prSheet")) return;
  const KINDS = [
    ["paper_out", "🧻", "Paper roll finished / paper out"],
    ["half_print", "✂️", "Ticket came out half / cut off"],
    ["jam", "📄", "Paper jammed / stuck"],
    ["other", "❓", "Something else is wrong"],
  ];
  const ov = document.createElement("div");
  ov.id = "prSheet"; ov.className = "prsheet-ov";
  // ── WHERE PRINTING STANDS, ON THE KITCHEN SCREEN ITSELF (owner, 2026-08-18) ─────────────────
  // "It should be shown in kitchen panel, able to see the whole thing." A cook at a silent printer
  // should not have to ask anyone whether this screen is even meant to be printing — the two answers
  // that decide it are the admin's, so they are shown as plain sentences, never as dead switches.
  const tgt = state.kotPrintTarget || "kitchen";
  // A COMPUTER, NOT A SCREEN (mig 341). When a helper program owns the kitchen slips, this screen
  // prints nothing at all — and the cook must be able to read WHY and WHERE from here, or a quiet
  // screen beside a working printer is a mystery. The helper's name and printer are the answer.
  const hlp = state.helper && state.helper.owned ? state.helper : null;
  const where = hlp ? (esc(hlp.printer) + " — from " + esc(hlp.agent))
    : tgt === "counter" ? "the counter screen — not this one"
    : tgt === "both" ? "this screen, with the counter as a 30-second backup"
    : "this screen";
  // Who is printing RIGHT NOW (mig 338) — the question a cook at a silent printer actually has.
  const stn = state.station || null;
  const nowPrinting = hlp
    ? (hlp.connected ? esc(hlp.agent) + " (ready)" : esc(hlp.agent) + " — asleep, tickets are waiting")
    : stn && stn.mine ? "THIS screen"
    : stn && stn.active ? (esc(stn.active.label || (stn.active.panel === "editor" ? "A counter screen" : "A kitchen screen")) + (stn.stale ? " (gone quiet)" : ""))
    : "no screen yet";
  const status = `<div class="prsheet-status">
      <div><span>Automatic printing</span><b>${state.autoPrintKot ? "ON" : "OFF"}</b></div>
      <div><span>Tickets print on</span><b>${esc(where)}</b></div>
      <div><span>Printing right now</span><b>${nowPrinting}</b></div>
      ${hlp ? `<p>A printer program on <b>${esc(hlp.agent)}</b> prints these tickets, so this screen never has to be in front and nothing here can stop them.${hlp.connected ? "" : ` It has not been heard from for ${hlp.secondsAgo == null ? "a while" : Math.round(hlp.secondsAgo / 60) + " min"} — tickets are waiting, and print the moment it is back.`}${hlp.backup ? ` If it prints nothing for a minute, ${esc(hlp.backup.printer)} takes over.` : ""}</p>` : ""}
      ${!hlp && !state.autoPrintKot && tgt !== "counter" ? `<p>Nothing prints by itself yet — the manager or your admin turns it on.</p>` : ""}
      ${!hlp && tgt === "counter" ? `<p>This screen is not the printer: tickets come out at the counter. The 🖨 button on a ticket still prints here if this screen has a printer.</p>` : ""}
    </div>`;
  ov.innerHTML = `<div class="prsheet"><div class="prsheet-head"><h3>🖨 Printer</h3><button class="btn" data-prclose>✕</button></div>
    ${status}
    <p class="prsheet-sub">Something wrong? One tap — the manager is told right away.</p>
    ${KINDS.map(([k, ic, l]) => `<button class="btn prsheet-row" data-prkind="${k}"><span>${ic}</span> ${l}</button>`).join("")}
    <!-- THE SETUP GUIDE LIVES HERE ON THIS SCREEN (owner, 2026-08-18: "where is this setup in the app").
         The kitchen panel has no settings screen and its top bar is deliberately fought over to the pixel
         (see buildMoreMenu) — so the guide goes where somebody standing at a misbehaving printer already
         reaches: the 🖨❗ sheet. A link, not a button that does something, so a cook cannot mistake it for a
         report. The full switches live in the manager panel's Settings → Kitchen printing. -->
    <button class="btn prsheet-row prsheet-help" type="button" data-prsettings><span>⚙️</span> Printer settings on this screen</button>
    <a class="btn prsheet-row prsheet-help" href="/print-setup.html" target="_blank" rel="noopener"><span>📖</span> How to set this printer up (full guide)</a></div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); if (prSheetOff) { const off = prSheetOff; prSheetOff = null; off(); } };
  prSheetOff = window.LFH_BACK ? LFH_BACK.layer("printer-problem", close) : null;
  ov.querySelector("[data-prclose]").onclick = close;
  { const sb2 = ov.querySelector("[data-prsettings]"); if (sb2) sb2.onclick = () => { close(); openKitchenSettings(); }; }
  ov.onclick = (e) => { if (e.target === ov) close(); };
  ov.querySelectorAll("[data-prkind]").forEach((b) => (b.onclick = async () => {
    if (b.disabled) return;
    ov.querySelectorAll("[data-prkind]").forEach((x) => (x.disabled = true));
    try {
      const r = await api("POST", "/printer-events", { kind: b.dataset.prkind });
      toast(r && r.queued ? "Saved ✓ — the manager is told the moment you're back online." : "The manager has been told ✓");
      close();
    } catch (e2) {
      ov.querySelectorAll("[data-prkind]").forEach((x) => (x.disabled = false));
      toast("Couldn't send that — try again. " + (e2.message || ""));
    }
  }));
}
// ── THE SELF-HEALING NET (was the whole of auto-print until mig 335) ────────────────────────────
// Auto-print used to work exactly like this and nothing else: diff the board, print what this tab
// had not printed. That is what died whenever the tab was not the front window, because a tab that
// hears nothing sees no new orders — and nothing anywhere remembered the ticket.
//
// Now the DATABASE queues a row for every new order (mig 335) and processPrintJobs above prints it,
// so this is only the net underneath: it prints an order that the queue does not have in hand at
// all, and only once it is 20 seconds old. In normal service it never fires — the row exists within
// milliseconds. It fires when the queue genuinely cannot help:
//   • a database that has not had mig 335 yet (a stack awaiting its release — AV live today),
//   • a job somebody dismissed by mistake,
//   • auto-print switched ON mid-service, when orders already on the board never got a row.
// `queuedFor` comes from the server and lists orders with a job in ANY state — including one another
// screen is printing right now — so the net can never race the queue into a second ticket.
const NET_AFTER_MS = 20000;
function printQueueSerial(queue, allItems, restaurant) {
  if (!queue || !queue.length) return;
  let i = 0;
  const step = () => {
    if (i >= queue.length) return;
    const o = queue[i++];
    if (!printedIds.has(o.id)) {
      // Mark it printed only if it ACTUALLY printed. Marking first meant one failure (a bad
      // deploy leaving billdoc.js missing, say) consumed the ticket forever: the order never
      // printed and never would, on any later pass. A failure now leaves it pending and tells the
      // cook once, rather than never.
      if (printKot(o, (allItems || []).filter((it) => it.order_id === o.id), restaurant)) { printedIds.add(o.id); savePrintedIds(); }
      else notePrintTrouble();
    }
    if (i < queue.length) setTimeout(step, 400);   // serialized, so a burst can't stack N dialogs
  };
  step();
}
function autoPrintNet(autoOn, orders, allItems, restaurant, queuedFor) {
  if (!autoOn) return;
  // Unknown (an old server, or the targeted ?table= slice which never carries it) → assume the
  // queue has everything and do nothing. The net must never be the reason a ticket prints twice.
  if (!Array.isArray(queuedFor)) return;
  const queued = new Set(queuedFor.map(String));
  const cutoff = Date.now() - NET_AFTER_MS;
  printQueueSerial((orders || []).filter((o) => {
    if (o.status !== "received" && o.status !== "preparing") return false;
    if (printedIds.has(o.id) || queued.has(String(o.id))) return false;
    const t = new Date(o.created_at).getTime();
    return Number.isFinite(t) && t < cutoff;   // a bad timestamp is never retro-printed
  }), allItems, restaurant);
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !state.autoPrintKot) return;
    // COMING BACK IS NOW JUST A READ. Anything missed while this screen was in the background is
    // sitting in print_jobs (mig 335), so the honest way to catch up is to fetch the board — the
    // queue comes with it and processPrintJobs prints whatever is still unclaimed. It used to
    // re-diff the board here, which was the only catch-up there was and could not help with an
    // order that had already left the board.
    load().catch(() => {});
  });
  // When the offline outbox drains on reconnect, snap the board to server truth at once
  // (a replayed action could have been rejected → the optimistic tile would otherwise stay
  // wrong until the 60s backstop). outbox.js dispatches this after a flush. (audit 2026-07-07)
  // …AND THE OPTIMISTIC OVERLAY GOES WITH IT (T6 sweep, 2026-08-17 — the offline half of the same
  // fault as the refused ✓ in markItemReady). A tap taken with no signal keeps its dish painted
  // ready through `pendingReady` and skips the reconcile, because there is nothing to reconcile
  // against yet. When the queue finally drains, most replays land and the refetch simply agrees —
  // but a replay the server REFUSES (lib/clash: the table was closed and billed while this screen
  // was offline) leaves the server saying "preparing" and the overlay saying "ready", for the rest
  // of the shift. Clear both overlays once the post-flush read has landed, exactly as
  // scheduleReadyReconcile does after a live tap: after a drain the server is the truth for
  // everything that was queued.
  window.addEventListener("lfh:outbox-flushed", () => {
    if (document.hidden) return;
    load().catch(() => {}).finally(() => { pendingReady.clear(); pendingReadyOrders.clear(); });
  });
  // A read came from this device rather than the server: refetch once, quietly, so a
  // single slow reply can't leave the panel showing older data than it needs to.
  window.addEventListener("lfh:stale-refresh", () => { if (!document.hidden) load().catch(() => {}); });
}

// Coalesce concurrent load() calls onto ONE in-flight board read (T4 sweep, 2026-08-11).
//
// Every open of this panel did TWO whole-board reads: the explicit load() near the bottom of this
// file, and LFH_RT.start's fireAll() → the ops/menu handlers → fullSoon(), whose FIRST call waits
// 0ms (lastFullAt is still 0). `loadSeq` stopped the loser PAINTING; it never stopped the read —
// and /board is by far the biggest thing this panel fetches (orders + items + every menu item +
// platform tickets + settings + restaurant + print jobs). The same gap let the reconnect flush, the
// stale-refresh, the 60s backstop and catchUp overlap into concurrent board reads during a rush,
// which is exactly when the database can least afford it.
//
// This is the shape the TABLET has used since 2026-07-09 and the kitchen never got: everyone shares
// one fetch, plus at most one TRAILING refresh so a change that landed mid-flight isn't missed.
// Post-write reconciles stay correct — if nothing is in flight they start a fresh fetch that
// includes their write; if one is running, the trailing refresh repaints server truth right after,
// and loadSeq still guarantees latest-wins. load() still REJECTS when the read fails, which is what
// backoffPoll/catchUp back off on.
let loadInFlight = null, loadQueued = false;
// Set by the realtime block below (it owns the 4s full-reload window). A no-op until then, so the
// boot read never depends on load order.
let markFullRead = () => {};
// freshLoad(): a read that is GUARANTEED to have started after this call — for the one caller that
// needs to see its own write (scheduleReadyReconcile, which drops the optimistic overlay when it
// resolves). Everything else should use load() and happily share. Waits for any in-flight read to
// settle, then goes to the server itself; loadImpl's own loadSeq still makes the latest paint win.
function freshLoad() {
  return loadInFlight ? loadInFlight.catch(() => {}).then(() => loadImpl()) : loadImpl();
}
function load() {
  if (loadInFlight) { loadQueued = true; return loadInFlight; }
  const p = loadImpl();
  loadInFlight = p;
  // Attach our own handlers so `p` is never an unhandled rejection, then chain the trailing refresh.
  p.then(() => {}, () => {}).then(() => { loadInFlight = null; if (loadQueued) { loadQueued = false; load(); } });
  return p;
}
async function loadImpl() {
  markFullRead();   // this IS a whole-board read — the rate guard must count it
  const seq = ++loadSeq;
  // `?autojobs=1` says "this panel prints from the QUEUE" (mig 335). A panel from before that
  // migration prints by diffing its own board, so the server only hands the new auto rows to a panel
  // that asks — otherwise a device still running last month's app.js would print every ticket twice.
  const data = await api("GET", "/board?autojobs=1");
  if (seq !== loadSeq) return; // a newer refresh started — drop this stale response
  // Table display names FIRST — before any auto-print below, or a ticket printed in the
  // boot window would fall back to the raw number on a renamed table.
  state.tableNames = data.tableNames || {};
  // Which tables are marked VIP / Family / Owner's guest (mig 166). Set alongside the names and
  // BEFORE any auto-print below, for the same reason: a ticket printed in the boot window should
  // carry the mark it is entitled to.
  state.tableTags = data.tableTags || {};
  // Chime only for orders we have NEVER seen (not on the very first load) — dine-in
  // 'received', a GUEST order born 'preparing' (auto-accepted follow-up, mig 164 —
  // member_id set; waiter orders have member_id null and stay silent), OR a
  // brand-new platform order.
  const ids = new Set([...data.orders.map((o) => o.id), ...((data.platform || []).map((p) => p.id))]);
  if (state.knownIds) {
    const newReceived = data.orders.filter((o) => (o.status === "received" || (o.status === "preparing" && o.member_id)) && !state.knownIds.has(o.id));
    const freshPlat = (data.platform || []).some((p) => p.status === "new" && !state.knownIds.has(p.id));
    if (newReceived.length || freshPlat) chime();
    // The QUEUE prints new orders now (processPrintJobs, below — mig 335). This is only the net
    // for an order the queue has no row for at all, and it waits 20s before it acts.
    autoPrintNet(!!data.autoPrintKot, data.orders, data.items, data.restaurant, data.queuedFor);
  } else {
    // FIRST load (no baseline yet): treat orders that already existed BEFORE this panel
    // opened as already handled, so we never retro-print the existing board. But an order
    // that arrived DURING the boot fetch (created at/after BOOT_TS) is genuinely new and, as
    // KOT print is the main use, it MUST still print — the old code seeded EVERY order as
    // printed, so an order placed in the ~1s boot window was silently never printed.
    // Invalid/missing created_at is treated as pre-existing (seeded) so a bad timestamp can
    // never spew an old ticket. (audit 2026-07-07)
    // ONLY SEED WHEN SOMETHING WOULD ACTUALLY HAVE PRINTED IT (2026-08-06). Seeding says "assume
    // this ticket already came out", and on a kitchen with auto-print OFF nothing ever did — so
    // seeding made `printedIds` claim a print that never happened, and the manual 🖨 then branded
    // the cook's genuine FIRST ticket "*** REPRINT · DUPLICATE ***". That is the exact lie the
    // reprint path warns about forty lines up. With auto-print off there is nothing to retro-print
    // either (autoPrintNet returns immediately), so the seed has no other job here.
    // Seeding does NOT hold back the queue: a ticket that queued while this screen was closed still
    // prints from print_jobs the moment the panel opens (that is mig 269's promise, and it is what
    // "the kitchen was shut, then opened" is supposed to do). printedIds only guards the net and the
    // duplicate banner.
    if (data.autoPrintKot) {
      for (const o of data.orders) {
        const t = new Date(o.created_at).getTime();
        if (!Number.isFinite(t) || t < BOOT_TS) printedIds.add(o.id);
      }
      savePrintedIds();   // one write for the whole seeding pass, not one per order
    }
    // An order that landed during boot has its own queued row, so the queue takes it; the net only
    // covers one with no row at all (and never one seeded above).
    autoPrintNet(!!data.autoPrintKot, data.orders, data.items, data.restaurant, data.queuedFor);
  }
  state.autoPrintKot = !!data.autoPrintKot;
  // Which screen the admin chose (mig 336) — shown on the 🖨 sheet so a cook standing at a silent
  // printer can see whether this screen is even supposed to be printing.
  state.kotPrintTarget = data.kotPrintTarget || "kitchen";
  // WHO IS PRINTING (mig 338): { active: {label,panel,claimed_by,last_seen_at}|null, mine, stale }.
  // Shown in ☰ → Settings and on the 🖨 sheet, so "where is the paper coming out?" is answered on
  // the screen instead of by walking to the printer.
  state.station = data.station || null;
  if (window.__kdsSettingsOpen) renderKitchenSettings();   // the sheet is open: keep it truthful
  state.restaurant = data.restaurant || null;
  state.knownIds = ids;
  // Reprints the manager sent to THIS kitchen's printer (mig 269) — claim, print with the
  // DUPLICATE banner, report done. Rides every board read, including the first: a job that
  // queued while this screen was closed prints the moment it opens.
  processPrintJobs(data.printJobs);
  // Bound printedIds on a long (24/7 wall-display) service: an order that has LEFT the board
  // (served/cancelled) can never reappear as a new 'received', so forgetting it can't cause a
  // reprint — this stops the Set growing forever. Only prune the ones no longer on the board.
  // (knownIds is already replaced with the current board `ids` each full load, so it's bounded.)
  if (printedIds.size > 500) { for (const id of printedIds) if (!ids.has(id)) printedIds.delete(id); savePrintedIds(); }
  state.dishes = data.dishes;
  // Re-apply the LEGACY-order optimistic overlay so a just-ALL-READY'd legacy order (dishes
  // in orders[].items, no order_items rows) doesn't revert to cooking when this refetch
  // replaces state.orders before the server caught up. (pendingReady below only covers the
  // order_items rows in state.items — legacy items have no id, so they need this order-keyed
  // overlay too.) Cleared by the reconcile once the rush settles.
  state.orders = pendingReadyOrders.size
    ? data.orders.map((o) => (pendingReadyOrders.has(o.id) && Array.isArray(o.items)
        ? { ...o, items: o.items.map((i) => (i.status !== "served" ? { ...i, status: "ready" } : i)) }
        : o))
    : data.orders;
  state.platform = data.platform || []; state.platformAccept = !!data.platformAccept;
  // Show WHICH restaurant this panel is scoped to (multi-tenant). Set here in load()
  // — NOT in render() — because render() is skipped when the board signature is
  // unchanged, and the name must still appear on the very first load.
  setRestName(data.restaurant);
  // Keep dishes the cook JUST tapped ready showing ready, even if this refetch landed
  // before the server caught up (cleared by the reconcile once the rush settles).
  state.items = pendingReady.size
    ? data.items.map((i) => (pendingReady.has(i.id) && i.status !== "served" ? { ...i, status: "ready" } : i))
    : data.items;
  // If the 86-board drawer is open, keep it fresh regardless (its own render).
  if (!$("#drawerOverlay").hidden) renderDishes();
  const sig = boardSig({ orders: state.orders, items: state.items, dishes: state.dishes, platform: state.platform, platformAccept: state.platformAccept });
  if (sig === lastSig) return; // nothing visible changed — don't rebuild the tickets
  lastSig = sig;
  render();
}

// top-bar wiring
$("#muteBtn").textContent = state.muted ? "🔕" : "🔔";
$("#muteBtn").onclick = () => {
  state.muted = !state.muted;
  localStorage.setItem("kds_muted", state.muted ? "1" : "0");
  $("#muteBtn").textContent = state.muted ? "🔕" : "🔔";
  if (!state.muted) primeAudio(); // unmuting IS a gesture — unlock audio + re-check the nudge
  updateSoundNudge();
};
// 86-board drawer. open/close are wrapped so the phone's BACK button closes the
// drawer (via LFH_BACK) instead of leaving the kitchen panel.
let drawerOff = null;
function openDrawer() {
  $("#drawerOverlay").hidden = false; renderDishes();
  drawerOff = window.LFH_BACK ? LFH_BACK.layer("86-board", closeDrawer) : null;
}
function closeDrawer() {
  $("#drawerOverlay").hidden = true;
  if (drawerOff) { const off = drawerOff; drawerOff = null; off(); }
}
$("#boardBtn").onclick = openDrawer;
{ const pb = $("#printerBtn"); if (pb) pb.onclick = openPrinterSheet; }
// 🚩 Report an issue (subject + optional photo + live voice note) — shared widget.
{ const _ib = document.getElementById("reportIssueBtn"); if (_ib) _ib.onclick = () => { if (window.LFH_ISSUE) LFH_ISSUE.open({ api, rid: PANEL_RID, notify: (m) => toast(m) }); }; }
{ const ham = $("#hamburger"); if (ham) ham.onclick = openKitchenMenu; }
$("#drawerClose").onclick = closeDrawer;
$("#drawerOverlay").onclick = (e) => { if (e.target.id === "drawerOverlay") closeDrawer(); };
$("#dishSearch").oninput = renderDishes;
// Wall ⇄ Columns toggle (the "expansion"). Persist the choice per device.
$("#viewBtn").onclick = () => { view = view === "wall" ? "columns" : "wall"; localStorage.setItem("kds_view", view); applyView(); };
// The clock, but only while it is actually on screen (owner-picked improvement, 2026-08-07). CSS
// hides #clock below 760px, so on a phone this wrote a string into an invisible element once a second
// for as long as the panel was open — and a KDS is open for days. Reading the computed style is the
// honest test (the element exists either way); if it is hidden, or the panel is in a background tab,
// there is nothing to keep up to date.
setInterval(() => {
  const el = $("#clock");
  if (!el || document.hidden) return;
  if (getComputedStyle(el).display === "none") return;
  el.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}, 1000);

// ── ⋯ MORE: the three set-once controls, off the phone bar (T4 sweep, 2026-08-06) ──────────
// WHY THIS EXISTS. Measured on a 360px phone: `header.topbar` was 157px — a fifth of a 780px
// screen — because nine controls were competing for a 324px row and wrapped onto THREE rows. With
// the sound nudge that put the first ticket at y=399, so more than half the screen was chrome
// before a cook could see any food. Nothing small fixed it: tightening the gap saved 2px, hiding
// the connection badge's word freed 44px and still left three rows, narrowing the brand made it
// WORSE. The controls need ~363px with gaps and there are 324px. The only real lever is fewer
// controls, so the question was which ones a cook can afford to be one tap further from.
//
// The split is by WHEN they are used, not by how much they matter:
//   · STAYS on the bar — the connection light, 🚫 Sold out, 🖨❗ printer problem, 🚩 report an
//     issue. These are touched DURING service, some of them urgently.
//   · MOVES in here — 🔔 sound, ▦/▭ board layout, 🌙 theme. All three are per-device preferences
//     set once and then left alone for months (they persist in localStorage precisely because
//     nobody re-picks them mid-rush).
// That is the same trade the waiter tablet already makes: its ☰ drawer holds Theme while the bar
// keeps only the action. One established pattern, not a new idea.
//
// The controls are MOVED, not rebuilt — the real #muteBtn / #viewBtn / #themeToggle nodes are
// relocated, so their handlers, their ids and their state travel with them. Nothing is re-wired and
// there is no second copy to drift (theme.js still finds #themeToggle by id; applyView() still
// finds #viewBtn and its .bi/.bw spans). And because the menu is OUTSIDE .top-actions, the
// word-hiding rule in the phone media block stops applying, so in here they get their words back.
// PHONE ONLY: above 760px the bar has room, so the buttons stay where they were and ⋯ is hidden.
const MORE_MQ = "(max-width: 760px)";
let morePop = null, moreBackOff = null;
// WHERE EACH CONTROL CAME FROM, recorded once before anything is moved. Restoring by "append them
// before the ⋯ button" looked fine and quietly reordered the DESKTOP bar: a context that laid out
// narrow first and then wide put 🔔 after 🖨❗ and 🌙 before 🚩, i.e. the bar a cook has learned
// changed order on them for no reason. Pinning each node's original next-sibling puts every one
// back exactly where index.html authored it, whatever route the layout took to get here.
const MORE_HOME = new Map();
function rememberHomes(ids) {
  for (const id of ids) {
    if (MORE_HOME.has(id)) continue;
    const el = document.getElementById(id);
    if (el && el.parentElement) MORE_HOME.set(id, el.nextElementSibling);
  }
}
function buildMoreMenu() {
  const bar = document.querySelector("header.topbar");
  const btn = document.getElementById("moreBtn");
  if (!bar || !btn || morePop) return;
  morePop = document.createElement("div");
  morePop.id = "morePop";
  morePop.className = "kds-more-pop";
  morePop.hidden = true;
  morePop.setAttribute("role", "menu");
  // A label per row: the buttons themselves are emoji-only (🔔/🔕, ▦/▭, 🌙/☀️), which reads fine
  // as an icon in a bar and badly as a line in a menu.
  // 🚩 joins them for CONSISTENCY, not just for room: on the waiter tablet "Report an issue" lives
  // in the ☰ drawer (it has no bar button at phone width at all), so having it on the bar here and
  // in a menu there would be the same job in two places. It is also an escalation a cook reaches
  // for a few times a month, not during plating. Moving it is what reliably buys the second row
  // back — the connection badge grows when it shows a latency reading ("663 ms" is wider than
  // "Live"), so without this the bar fits on one row only while the network happens to be quick.
  [["muteBtn", "New-order sound"], ["viewBtn", "Board layout"], ["themeToggle", "Theme"], ["reportIssueBtn", "Report an issue"]].forEach(([id, label]) => {
    const row = document.createElement("div");
    row.className = "kds-more-row";
    const t = document.createElement("span");
    t.className = "kmr-label";
    t.textContent = label;
    row.appendChild(t);
    row.dataset.for = id;
    morePop.appendChild(row);
  });
  bar.appendChild(morePop);
  const closeMore = () => {
    if (!morePop || morePop.hidden) return;
    morePop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (moreBackOff) { const off = moreBackOff; moreBackOff = null; off(); }
  };
  const openMore = () => {
    morePop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    // Registered with the back-stack the moment it opens, like every other overlay on this panel,
    // so the phone's hardware Back closes the menu instead of leaving the kitchen screen.
    moreBackOff = window.LFH_BACK ? LFH_BACK.layer("kds-more", closeMore) : null;
  };
  btn.onclick = (e) => { e.stopPropagation(); if (morePop.hidden) openMore(); else closeMore(); };
  // Tapping anything inside is a real action (the moved buttons keep their own handlers) — we just
  // close afterwards so the menu isn't left covering the board. Sound is the exception: a cook
  // muting mid-rush may want to see the icon change and tap again, and closing under their finger
  // is the "tap vanished" feeling, so the menu stays open for that one.
  morePop.addEventListener("click", (e) => {
    const row = e.target.closest(".kds-more-row");
    if (row && row.dataset.for !== "muteBtn" && e.target.closest("button")) setTimeout(closeMore, 120);
  });
  document.addEventListener("click", (e) => {
    if (morePop.hidden) return;
    if (!e.target.closest("#morePop") && !e.target.closest("#moreBtn")) closeMore();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMore(); });
  window.__kdsCloseMore = closeMore;   // used when the layout flips back to desktop
}
// Move the three controls in (phone) or back to the bar (desktop). Idempotent, so it is safe to
// call on every media change and on boot.
function syncMoreMenu() {
  const acts = document.querySelector(".top-actions");
  const btn = document.getElementById("moreBtn");
  if (!acts || !btn) return;
  let phone = false;
  try { phone = window.matchMedia(MORE_MQ).matches; } catch { phone = false; }
  const MOVERS = ["muteBtn", "viewBtn", "themeToggle", "reportIssueBtn"];
  rememberHomes(MOVERS);
  if (phone) {
    buildMoreMenu();
    if (!morePop) return;
    for (const row of morePop.querySelectorAll(".kds-more-row")) {
      const el = document.getElementById(row.dataset.for);
      if (el && el.parentElement !== row) row.appendChild(el);
    }
  } else {
    if (window.__kdsCloseMore) window.__kdsCloseMore();
    // Back to the EXACT slot each one was authored in (see MORE_HOME) — never merely "into the bar".
    for (const id of MOVERS) {
      const el = document.getElementById(id);
      if (!el || el.parentElement === acts) continue;
      const home = MORE_HOME.get(id);
      // A remembered sibling that has since left the bar would throw insertBefore, so fall back to
      // the ⋯ button's slot, which is where these all sit anyway.
      acts.insertBefore(el, home && home.parentElement === acts ? home : btn);
    }
  }
}
syncMoreMenu();
try { window.matchMedia(MORE_MQ).addEventListener("change", syncMoreMenu); } catch (e) { /* older engines keep the boot layout */ }

bindDelegation(); // ONE delegated click handler for all ticket buttons (survives tile patching)
updateSoundNudge(); // show the "enable sound" affordance if this is an untouched wall display
applyView(); // honour the saved layout (sets which <main> shows) before the first paint
// A failed first load that's simply "no internet" stays quiet — the offline bar already
// says so, and shouting "can't reach the database" at a cook mid-service is worse than
// useless. Any OTHER failure still toasts, because that one needs looking at.
//
// …AND A BUSY DATABASE IS NOT A FAULT EITHER (T15 finding P1, 2026-08-14). The guard above only
// recognised "no internet", so a saturated shared instance — the 2026-08-03 morning, 56 rows before
// lunch, every endpoint measured at 65-1000 ms afterwards — put this in front of a cook:
//
//     Can't reach the database: TimeoutError: The operation was aborted due to timeout
//
// which is the exact red toast lib/dbRefusal.ts's BUSY_MESSAGE was written to abolish, in the exact
// words the comment above calls worse than useless. `isBusyErr` already existed in
// public/panels/offline.js (three lines below `isOfflineErr`) and simply wasn't called here.
//
// DELIBERATELY NOT THE R21 TREATMENT. docs/REJECTED-IDEAS.md R21 turned down giving this panel the
// manager/tablet `errText()` helper — *"kitchen panel is only use for kot print"* — and that still
// stands: no shared helper is imported, no clash wording is added, and every other toast on this
// screen keeps its plain `Failed: <message>`. This is one string on the first-load path, using a
// classifier the panel already loads. Do not grow it into errText().
load().catch((e) => {
  if (window.LFH_OFF && window.LFH_OFF.isOfflineErr(e)) return;                  // the offline bar says it
  if (window.LFH_OFF && window.LFH_OFF.isBusyErr && window.LFH_OFF.isBusyErr(e)) // up, but not answering
    return toast("The system is very busy right now — the board will fill in by itself in a moment.");
  toast("Couldn't load the board — try again. " + e.message);
});
// Realtime: refetch only when an order/dish actually changes (instant), instead of
// polling every second. A slow 60s timer is the backup if the WebSocket drops.
// If realtime didn't load for any reason, fall back to a gentle 2s poll.
if (window.LFH_RT) {
  // Split by topic: ops churn → TARGETED loadTables() when the breadcrumb names specific
  // tables, else full load() (platform change, wake, reconnect, initial). menu edits
  // (sold-out / dish edits) always do a full load() so the dish lists + 86 board refresh.
  // FULL-reload rate guard (stress test 2026-07-03): breadcrumbs that can't name a table
  // (pay/close/platform…) force a WHOLE-board reload, and a rush hour fires them constantly —
  // one kitchen screen pulled 278MB in 50min re-reading a big board every few seconds. Collapse
  // full reloads to at most one per 4s, TRAILING (a suppressed burst still lands one reload at
  // the window edge — nothing is ever dropped). Targeted per-table refetches stay instant.
  let lastFullAt = 0, fullTimer = null;
  const fullSoon = () => {
    if (fullTimer) return;
    // A READ THAT IS ALREADY RUNNING COVERS THIS EVENT (T4 sweep, 2026-08-11). Measured on boot:
    // THREE whole-board reads, not one — the explicit load() at the bottom of this file, then the
    // `ops` handler's fireAll (wait 0ms, because lastFullAt is still 0), then the `menu` handler's,
    // which found fullTimer already cleared and so scheduled a THIRD read 4s later. The 4s rate
    // guard can only dedup reloads that are still PENDING; it knew nothing about one in flight.
    // Handing it to the coalescer instead is both cheaper and safer than a time-based skip: NOTHING
    // IS DROPPED — loadQueued forces exactly one trailing refresh after the in-flight read lands, so
    // a change that committed after that read started is still picked up (a blind "skip if a read
    // finished <1.5s ago" would silently lose it until the 60s backstop, which is bug M9 all over).
    // A READ ALREADY RUNNING COVERS THIS EVENT, and its trailing refresh is the proof. NOTHING IS
    // DROPPED: loadQueued forces exactly one refresh after the in-flight read lands, so a change
    // that committed after that read started is still picked up.
    //
    // I TRIED ABSORBING THE BOOT ONE ENTIRELY and took it back out (2026-08-11). realtime.js's
    // start-up fireAll() means "do your initial load", and at boot that load is already in flight,
    // so its trailing refresh looks like pure waste — skipping it would make the boot a reliable 2
    // reads instead of 2-or-3. But it also removes the retry when the boot read FAILS: today the
    // fireAll gives us another attempt about 200ms later, and without it a failed first read waits
    // for the 60s backstop while the socket sits there perfectly healthy. One saved read is not
    // worth a minute of blank board.
    if (loadInFlight) { loadQueued = true; return; }
    const wait = Math.max(0, lastFullAt + 4000 - Date.now());
    fullTimer = setTimeout(() => { fullTimer = null; markFullRead(); load().catch(() => {}); }, wait);
  };
  // Every completed whole-board read counts toward the 4s window, not just the ones this timer
  // started. It was blind to the boot read and to the 60s backstop, so a breadcrumb arriving a
  // moment after either of those fired instantly rather than waiting its turn.
  markFullRead = () => { lastFullAt = Date.now(); };
  LFH_RT.start({
    handlers: {
      ops: (detail) => (detail && !detail.full && detail.tables && detail.tables.length) ? loadTables(detail.tables) : fullSoon(),
      menu: () => fullSoon(),
    },
    // KEEP THE LIVE SOCKET WHILE THIS SCREEN IS THE PRINTER (owner, 2026-08-17). realtime.js drops
    // its channels after two minutes hidden to protect the connection budget — right for a
    // backgrounded display, wrong for the device the tickets come out of: it meant a covered window
    // stopped hearing about orders altogether. Only ever true when auto-print is on, so an ordinary
    // kitchen display still gives its connection back.
    keepAlive: () => !!state.autoPrintKot,
  });
  // Backup sync — but NOT while the tab is hidden: a backgrounded wall display kept
  // firing a full-board read every 60s forever (egress waste). realtime.js already does
  // a fresh full reload via wake() on re-show, so a hidden tab needs no backstop.
  //
  // ONE EXCEPTION, AND IT IS THE POINT OF THIS WHOLE CHANGE: a screen with auto-print ON is not a
  // display, it is the PRINTER. When another window covers it, Chrome calls it hidden — and the old
  // rule then left the printer with no heartbeat at all, so a ticket waited for someone to click on
  // the window (owner, 2026-08-17). A minute of egress on the one device per restaurant that is
  // doing the printing is the cheapest honest answer; realtime normally beats this to it, so it is
  // a backstop, not the mechanism.
  setInterval(() => { if (!document.hidden || state.autoPrintKot) load().catch(() => {}); }, 60000);
  // If realtime isn't connected (blocked/flaky WebSocket, or a database that dropped its
  // realtime connection), LFH_RT.start() swallows the subscribe error and only the 60s backstop
  // runs — a new KOT could sit unseen up to 60s (bug M9, 2026-07-05). LFH_RT.catchUp polls every
  // 5s until the socket is live again, and — the part that matters under load — BACKS OFF while
  // those reads are failing instead of hammering a database that is already struggling at a
  // fixed 5s from every device at once. It is a no-op whenever realtime is working.
  if (window.LFH_RT.catchUp) window.LFH_RT.catchUp(() => load());
  else backoffPoll(5000);
} else {
  // NO REALTIME AT ALL (realtime.js failed to load, or is blocked). This used to be a flat
  // `setInterval(load, 2000)` — a fixed two-second whole-board read, from every kitchen screen in
  // the estate, for as long as the page was open, and it kept firing while the tab was HIDDEN.
  // That is exactly the shape CLAUDE.md's rush rule 4 forbids, and the reason is that a saturated
  // database is what drops realtime in the first place: the moment things get bad, every device
  // switches to hammering it in lockstep and keeps it down. The TABLET's identical branch was
  // rewritten for this; the kitchen was left behind (T4 sweep, 2026-08-04).
  backoffPoll(2000);
}
// The same behaviour LFH_RT.catchUp() gives, written out here because reaching either caller
// means catchUp itself is unavailable: quick while the reads succeed, doubling to a minute for as
// long as they FAIL, straight back to quick on the first success, ±20% jitter so twenty screens
// never poll on the same beat, and nothing at all while the tab is hidden or the device is offline.
function backoffPoll(baseMs) {
  let step = 0;
  const spread = (ms) => Math.round(ms * (0.8 + Math.random() * 0.4));
  const tick = async () => {
    if (document.hidden || navigator.onLine === false) step = 0;   // nothing to catch up on
    else {
      try { await load(); step = 0; }
      catch (e) { step = Math.min(step + 1, 8); }
    }
    setTimeout(tick, spread(Math.min(baseMs * Math.pow(2, step), 60000)));
  };
  setTimeout(tick, spread(baseMs));
}

// ── HIERARCHY X-RAY ribbon (Phase 4, 2026-07-06) ─────────────────────────────
// The kitchen has no permission-gated actions (yet), so this is the "viewed by a
// higher role" marker only: an amber ribbon naming the admin view + Exit. Same
// language as the manager/tablet ribbons; add zones here when kitchen gets gated
// controls. One whoami request at boot — no polling.
(function kitchenXray() {
  const css = `
  #xrayRibbon { display: flex; align-items: center; gap: 12px; padding: 6px 14px;
    background: color-mix(in srgb, #d97706 14%, var(--panel, #101826)); border-bottom: 1px solid color-mix(in srgb, #d97706 40%, transparent);
    font-size: 12px; color: var(--text, #e8eefc); position: relative; z-index: 40;
    /* WRAP, so the admin's own bar cannot push the panel sideways. At 360px the "Exit view"
       button sat at x364 against a 360px screen — a 4px overflow that made an admin-viewed
       kitchen the one panel that scrolled sideways on a phone (T12 phone sweep, 2026-08-05).
       flex-wrap + a row gap costs nothing on a desktop, where it never wraps. */
    flex-wrap: wrap; row-gap: 6px; max-width: 100%; box-sizing: border-box; }
  #xrayRibbon .rb-tag { font-weight: 800; letter-spacing: .04em; color: #f59e0b; text-transform: uppercase; font-size: 11px; }
  #xrayRibbon .rb-rest { color: var(--muted, #9fb0cc); font-weight: 600; }
  #xrayRibbon .rb-crumbs { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; flex-wrap: wrap; }
  #xrayRibbon .rb-crumbs a { color: #f59e0b; text-decoration: none; cursor: pointer; }
  #xrayRibbon .rb-crumbs a:hover { text-decoration: underline; }
  /* LIGHT SKIN: the ribbon's own words were the least readable text in the product — amber
     ink on the ribbon's 14% amber wash measured 1.85:1 (T11 sweep, 2026-08-13). The WASH and
     the border keep the bright amber, so the stripe still reads as a warning at a glance;
     only the ink deepens, to 5.10:1. The dark skin keeps #f59e0b, where amber on a dark
     panel was already fine. This ribbon is how an admin knows whose panel they are in. */
  html[data-theme="light"] #xrayRibbon .rb-tag,
  html[data-theme="light"] #xrayRibbon .rb-crumbs a { color: #8a5a06; }
  #xrayRibbon .rb-sep { font-size: 10px; color: var(--muted, #9fb0cc); }
  #xrayRibbon .rb-spacer { margin-left: auto; }
  #xrayRibbon button { font: inherit; cursor: pointer; border-radius: 999px; border: 1px solid var(--line, #26324a);
    background: transparent; color: var(--muted, #9fb0cc); font-weight: 700; padding: 4px 12px; }`;
  const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);

  // Flip this admin-view TAB between the full admin view and the "actual kitchen" view
  // (?view=real). Pure URL state — reloading with/without the param is the whole toggle.
  // Leaving the real view also drops the person pin (?as=) — the full admin view is
  // nobody's screen, so it must stop carrying a name.
  const setViewReal = (on) => {
    const u = new URL(location.href);
    if (on) u.searchParams.set("view", "real"); else { u.searchParams.delete("view"); u.searchParams.delete("as"); }
    location.replace(u.toString());
  };
  api("GET", "/whoami").then((w) => {
    const sim = !!(w && w.simulated); // ACTUAL-VIEW mode: real kitchen render, slim ribbon back
    if (!w || (!w.higherView && !sim)) return;
    const rb = document.createElement("div"); rb.id = "xrayRibbon";
    const who = sim || w.actor === "admin" ? "Admin" : w.actor.charAt(0).toUpperCase() + w.actor.slice(1);
    // ADMIN came from the console → show the PATH (Restaurants › name › Kitchen
    // panel), the owner panel's breadcrumb language (owner, 2026-07-06). Any other
    // higher role keeps the plain name — no console to crumb back to.
    const body = who === "Admin"
      ? `<nav class="rb-crumbs" aria-label="Breadcrumb"><a id="xrayHome">Restaurants</a>` +
        `<span class="rb-sep">›</span><span id="xrayRest"></span>` +
        `<span class="rb-sep">›</span><span>Kitchen panel</span></nav>`
      : `<span class="rb-rest" id="xrayRest"></span>`;
    // The kitchen has no gated controls, so the "actual view" only drops the admin extras;
    // the toggle still exists on every panel (owner 2026-07-28: one per panel, default off).
    const simBtn = sim
      ? `<button id="xraySimBtn" title="Back to the full admin view">See full admin view</button>`
      : (who === "Admin" && PANEL_RID
        ? `<button id="xraySimBtn" title="Reload this tab showing exactly what the real kitchen screen sees">👁 See actual panel</button>`
        : "");
    // The KDS has no permission rows at all, so there is nothing to mark cyan here. SAY that,
    // rather than leaving the admin to wonder whether the marks failed to render (owner,
    // 2026-08-02 — every other panel shows a count next to the ribbon, and a kitchen with no
    // count at all looked like the same feature quietly broken). When a person is pinned the
    // line names them, because "nothing is restricted" is exactly the answer being asked for.
    const kdsNote = sim ? "" :
      `<span class="rb-rest" style="font-weight:600">· ${w.asName ? `${esc(w.asName)} sees the whole kitchen screen` : "nothing is restricted on this screen"}</span>`;
    rb.innerHTML =
      `<span class="rb-tag">${who} view${sim ? (w.asName ? ` · as ${esc(w.asName)}` : " · as real kitchen") : (w.asName ? ` · ${esc(w.asName)}'s access` : "")}</span>` +
      body +
      kdsNote +
      `<span class="rb-spacer"></span>` +
      simBtn +
      `<button id="xrayExit">Exit view</button>`;
    document.body.insertBefore(rb, document.body.firstChild);
    const simB = document.getElementById("xraySimBtn");
    if (simB) simB.onclick = () => setViewReal(!sim);
    const home = document.getElementById("xrayHome");
    if (home) home.onclick = () => {
      try { window.top.location.href = "/aevinite/restaurants"; } catch { window.location.href = "/aevinite/restaurants"; }
    };
    // The restaurant name lands with the first /board load — mirror it when it does.
    const restEl = document.getElementById("restName");
    if (restEl) {
      const mirror = () => { const t = restEl.textContent || ""; const me = document.getElementById("xrayRest"); if (me && me.textContent !== t) me.textContent = t; };
      mirror();
      new MutationObserver(mirror).observe(restEl, { childList: true, characterData: true, subtree: true });
    }
    document.getElementById("xrayExit").onclick = async () => {
      try { await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) }); } catch {}
      try { window.top.location.href = "/aevinite/restaurants"; } catch { window.location.href = "/aevinite/restaurants"; }
    };
  }).catch(() => {});
})();
