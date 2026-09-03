// tablet/ui/app.js — the waiter tablet's brain.
//
// TOP (or LEFT on a wide screen): a live floor of table tiles. Each open table
// shows real info — guests, KOT #, a kitchen progress bar and dish-count pills —
// colour-coded by state, with a paid/unpaid outline and a red glow when a guest
// has called. BELOW (or RIGHT): the selected table's detail — every order, each
// DISH with its own status you can tap to advance (new → cooking → served),
// accept phone/app orders, move the table or a single order, and a big ATTEND
// button when there's a waiter call. The cart survives the 1s floor refresh
// because we only redraw the panel when the waiter ISN'T mid-order.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// #9: the tablet has its OWN ☰ hamburger profile menu, so tell the shared maint.js NOT to
// also inject its "👤 Profile" button (two overlapping menus crowded the phone top bar). Set
// before maint.js's async init runs. The one-time "👋 Finish setup" capture still shows.
window.LFH_SUPPRESS_SETTINGS_BTN = true;

// #11: fold diacritics so waiter dish-search matches accented names ("caffe"→"Caffè").
// Same NFD + strip-combining-marks trick the guest menu uses.
const foldAccents = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// __lfhPerf: cheap, always-on perf counters so the floor's render cost can be measured at
// scale (300 tables) — IDENTICAL to the manager's. fullRenders = full floor rebuilds
// (renderFloor); patches = incremental tile patches (patchTabletTiles); tilesPatched = how
// many tiles those patches touched in total; lastMs = how long the most recent render/patch
// took; longTasks = main-thread tasks >50ms (the freeze symptom). The PerformanceObserver
// no-ops where the API is unavailable. Read it from the console to confirm a single-table
// breadcrumb PATCHES (not full-renders) and that long tasks stay near zero under churn.
window.__lfhPerf = window.__lfhPerf || { fullRenders: 0, patches: 0, tilesPatched: 0, lastMs: 0, longTasks: 0 };
try {
  if (typeof PerformanceObserver === "function") {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.duration > 50) window.__lfhPerf.longTasks++; })
      .observe({ entryTypes: ["longtask"] });
  }
} catch {}
// Prices are stored in rupees now (migration 043) — no conversion, just format.
const INR_RATE = 1;
// "en-IN", NOT "en-US": Indian digit grouping is 2,2,3 (₹1,07,880), and this panel was the only
// surface still writing ₹107,880 — the printed bill (billdoc.js) and the manager panel have
// always used en-IN, so the same bill read two different ways depending on which screen you
// looked at. One bill, one way of writing a number.
const inr = (n) => "₹" + Math.round((parseFloat(n) || 0) * INR_RATE).toLocaleString("en-IN");
// See the manager panel's note: inr() rounds to whole rupees, and the ONE place that is wrong is a
// figure the person has to MATCH — the server recomputes the due to the paise.
const inrExact = (v) => {
  const n = (parseFloat(v) || 0) * (typeof INR_RATE === "number" ? INR_RATE : 1);
  return Math.abs(n - Math.round(n)) < 0.005
    ? "₹" + Math.round(n).toLocaleString("en-IN")
    : "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// One dish flows new → cooking → ready → served, then wraps back so a mis-tap is
// undoable. "ready" = kitchen finished it, waiter still has to carry it out (the
// pink alert); "served" = the waiter delivered it. Labels are the words shown.
// Waiter tap flow MATCHES the manager: cooking → served in one tap (the kitchen
// owns "ready"; if they're too busy to mark it, the waiter who carries the food
// just serves it directly). A dish already marked "ready" by the kitchen also
// serves in one tap. (owner, 2026-06-14)
// Forward-only status flow. 'served' is deliberately NOT mapped back to 'received' here (#3):
// a served dish is un-served via the explicit "↩ Send back to kitchen" action in the edit
// modal, not by tapping the tiny pill backwards (which caused silent mis-tap un-serves).
const NEXT_STATUS = { received: "preparing", preparing: "served", ready: "served" };
const STATUS_WORD = { received: "new", preparing: "cooking", ready: "ready", served: "served" };
// The standard allergens staff can toggle per order (keep in sync with lib/allergens.ts).
const ALLERGENS = [
  { slug: "gluten", label: "🌾 Gluten" },
  { slug: "dairy", label: "🥛 Dairy" },
  { slug: "eggs", label: "🥚 Eggs" },
  { slug: "nuts", label: "🥜 Nuts" },
  { slug: "soy", label: "🫘 Soy" },
  { slug: "fish", label: "🐟 Fish" },
];
// The six above are only the COMMON ones. Every allergy row on this panel ends in a
// ＋ Other chip that opens a box to type one ("no coriander", "no ice"), because a real
// kitchen hears far more than six (owner, 2026-08-04). A typed allergy is stored as plain
// text beside the standard slugs, so it rides the SAME rails onto the KOT — never the bill.
const ALG_STD = ALLERGENS.map((a) => a.slug);
// Normalise a typed allergy: lowercase, collapse spaces, strip a leading "no " so
// "No Garlic" / "no-garlic" / "garlic" all store "garlic" (the UI prepends the "no").
// (Commas become spaces: the whole-order list travels as one comma-separated string, so a
// typed comma would silently split one allergy into two.)
const normAlg = (s) => String(s || "").replace(/,/g, " ").trim().toLowerCase().replace(/^no[\s-]+/, "").replace(/\s+/g, " ").slice(0, 24);
// What a chip says: a standard slug shows its emoji + name, a typed one shows 🚫 + the word.
const algLabel = (slug) => { const a = ALLERGENS.find((x) => x.slug === slug); return a ? a.label : "🚫 " + slug; };

const state = {
  // TWO-TIER FLOOR (mig 101, owner perf 2026-06-27): the GRID renders from the slim per-tile
  // `summary` (state/label/counts/pay/badges only); the SELECTED table's full detail comes from
  // its slice in `data` (sessions/members/orders/items/calls/requests). The table-agnostic bundle
  // (settings/dishes/categories) also rides on the full summary load. This is why the tablet no
  // longer ships the whole floor's order rows on every poll — it mirrors the manager exactly.
  summary: { tiles: {}, order_count: 0, latest_order_table: null, calls: [], requests: [], joiners: [], blocklist: [] },
  data: { settings: null, sessions: [], members: [], orders: [], items: [], calls: [], dishes: [], categories: [], requests: [] },
  table: null,          // which table the panel is showing
  ordering: false,      // true while the waiter is building an order (freezes panel redraws)
  cart: [],             // [{ id, title, price, qty }]
  cat: "",              // active category chip in order mode ("" = all)
  dishSearch: "",       // the dish-search text in order mode
  floorFilter: "all",   // which tables the floor shows: all | needs | open | free
  quick: false,         // ⚡ quick order: build the order first, pick the table at the END
  allergies: "",        // order-level allergies (comma list), applied to the whole order
  editOrders: new Set(),// order ids currently in staff EDIT mode (after the kitchen-confirm)
  addToOrderId: null,   // when set, the dish browser ADDS to this existing order (not a new one)
};

// PER-TAB restaurant pin (ADMIN "view as" only): ?rid= comes in via the iframe URL and
// is echoed on every API call so this tab never shifts restaurants when the admin opens
// another restaurant's panel (the act-as cookie is browser-wide — owner bug, 2026-07-03).
// Empty for real staff logins; the server ignores it for them.
const PANEL_RID = new URLSearchParams(location.search).get("rid") || "";
// ACTUAL-VIEW toggle (owner, 2026-07-28): ?view=real on an admin-view tab makes whoami answer
// as the REAL waiter tablet (no tinted extras). Per-tab like ?rid, echoed on every call.
const PANEL_VIEW_REAL = PANEL_RID && new URLSearchParams(location.search).get("view") === "real";
// VISIT-A-PERSON'S-PANEL (owner, 2026-08-02): ?as=<staff id> on an admin-view tab —
// opened from that waiter's profile — makes the server answer as THAT WAITER: their
// section of the floor and their own permission overrides. Echoed on every call like
// ?rid and ?view; re-checked server-side every time; ignored for real staff logins.
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
  // Writes go through the offline outbox: sent now if online, else saved on this
  // device and replayed on reconnect (at-most-once via X-LFH-Action-Id). GETs stay
  // a plain fetch. Same return/throw contract as before (see outbox.js send()).
  if (method !== "GET" && window.LFH_OUTBOX) {
    // `expect` (optional) travels as X-LFH-Expect so the server can refuse instead of
    // overwriting a change someone else made on another device while this person was typing.
    return window.LFH_OUTBOX.send({ base: "/api/tablet", method, path: ridQ(path), body, panel: "tablet", expect: opts && opts.expect, table: opts && opts.table });
  }
  // Was the offline layer in charge when this read STARTED? On a device's first visit it is not,
  // so nothing it fetched in that window was ever saved — see public/panels/swreg.js.
  const uncontrolled = !(navigator.serviceWorker && navigator.serviceWorker.controller);
  const url = "/api/tablet" + ridQ(path);
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
  // Attach the parsed body + status to the error so callers can read server flags like
  // duplicateWarning (#15) / needPin, which a bare message string would have dropped.
  if (!r.ok) { const e = new Error((j && j.error) || r.statusText); e.status = r.status; e.data = j; e.offline = (j && j.offline === true) || r.headers.get("X-LFH-Offline") === "1"; e.busy = (j && j.busy === true) || r.headers.get("X-LFH-Busy") === "1"; throw e; }
  // Hand a first-visit read to the offline layer, so the waiter's floor opens with no internet
  // on the SAME shift it was first opened. No second request — the body is already here.
  if (uncontrolled && method === "GET" && j && window.LFH_WARM) {
    try { window.LFH_WARM.data(new URL(url, location.origin).href, JSON.stringify(j)); } catch (e) { /* best effort */ }
  }
  return j;
};
// #2: a write that returned { queued:true } was saved on THIS device (offline) and will
// sync on reconnect — it did NOT fail. Callers show a friendly "saved" note instead of a
// success/failure toast, and skip the post-write GET (which would reject offline).
const isQueued = (r) => !!(r && r.queued === true);
// Accurate whether offline (syncs on reconnect) or online-with-a-pending-queue (syncs now).
// WHAT TO SAY WHEN A WRITE WAS SAVED INSTEAD OF SENT (improvement #3).
// One sentence used to cover four quite different situations, and "Saved ✓ — syncing
// automatically" is only true for one of them. The queue knows which (`why`, returned by
// LFH_OUTBOX.send), so say it: a waiter who hears "saved" about something the kitchen has not got
// may never chase it, and the busy case is exactly when that matters.
// P3 (T15, 2026-08-14): was "Saved ✓ — syncing automatically." — "syncing" is the one code word
// in the offline family, and this is the most-fired message in the product. The rest of that
// family already speaks plainly ("Saved on this device — not sent yet", "waiting for internet"),
// so this now matches them. A waiter needs to know the work is SAFE and that they need do
// nothing — those are the two facts; "syncing" carried neither.
const OFFLINE_SAVED_MSG = "Saved on this device ✓ — it will send by itself.";
const savedMsg = (r) => {
  const why = r && r.why;
  if (why === "busy") return "Saved ✓ — the system is busy, so the kitchen hasn't got it yet.";
  if (why === "slow") return "Saved ✓ — the system hasn't confirmed it yet.";
  if (why === "behind") return "Saved ✓ — it'll go once this table's earlier change has.";
  return OFFLINE_SAVED_MSG;                 // "offline", and anything we don't recognise
};
// WHAT TO SHOW A WAITER for a failed write. A clash arrives as
// { error: "clash_changed_elsewhere", clash: { plain, todo } } — `e.message` is the CODE, so a
// clash on a LIVE write (two people on the same dish at once, the common case) read as
// "clash_changed_elsewhere". Only the queued path ever rendered the sentence. See lib/clash.ts.
const errText = (e) => (e && e.data && e.data.clash && e.data.clash.plain)
  ? e.data.clash.plain + (e.data.clash.todo ? " " + e.data.clash.todo : "")
  : ((e && e.message) || "unknown error");
// `ms` (optional) for the rare message that must not slip past someone — a conflict with
// another device needs longer than the usual 2.6s glance. Always dismissible via the ✕.
const toast = (msg, ok = true, ms) => {
  const t = document.createElement("div");
  t.className = "toast" + (ok ? "" : " bad");
  const span = document.createElement("span");
  span.textContent = msg;
  t.appendChild(span);
  // ✕ so staff can dismiss the notification immediately (owner, 2026-06-21)
  const x = document.createElement("button");
  x.className = "toast-x";
  x.setAttribute("aria-label", "Dismiss");
  x.textContent = "✕";
  x.onclick = () => t.remove();
  t.appendChild(x);
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), ms || 2600);
};
// Two-step confirm (a promise that resolves true/false) — used before sending
// an order to the kitchen, so a stray tap can't fire a ticket.
// ONE dialog at a time. This box is a single shared element in index.html whose Yes/No
// handlers are reassigned per call — so a second call while one was open replaced those
// handlers and the FIRST promise never resolved: its caller sat awaiting forever and that
// action died with nothing on screen. (Same family as the manager's swallowed "Close
// anyway" tap, 2026-07-29.) The second call is now refused — answered "no" so it returns
// cleanly — and the question already on screen SHAKES so the waiter sees what's waiting.
let confirmOpen = false;
const confirmDialog = (text, yesLabel = "Yes, send it") => new Promise((resolve) => {
  if (confirmOpen) {
    const box = $("#confirmOverlay");
    if (box) { box.classList.remove("cf-nudge"); void box.offsetWidth; box.classList.add("cf-nudge"); }
    resolve(false); return;
  }
  confirmOpen = true;
  $("#confirmText").textContent = text;
  $("#confirmYes").textContent = yesLabel;
  $("#confirmOverlay").hidden = false;
  // Register with the back-stack so the hardware/browser back button closes THIS
  // dialog (as a cancel) instead of the layer underneath / the whole panel.
  let off = null;
  const finish = (val) => { confirmOpen = false; $("#confirmOverlay").hidden = true; $("#confirmOverlay").classList.remove("cf-nudge"); if (off) { off(); off = null; } resolve(val); };
  off = window.LFH_BACK ? LFH_BACK.layer("tablet-confirm", () => finish(false)) : null;
  $("#confirmYes").onclick = () => finish(true);
  $("#confirmNo").onclick = () => finish(false);
});

// Ask for a MANAGER PIN (a self-contained modal so it needs nothing in the HTML).
// Resolves with the typed digits, or null if cancelled. Sensitive tablet actions
// (ban, discount, closing/restarting a busy table) are unlocked by a manager's PIN.
const pinPrompt = (message, errText) => new Promise((resolve) => {
  const ov = document.createElement("div");
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "var(--scrim)", backdropFilter: "blur(3px)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  const box = document.createElement("div");
  Object.assign(box.style, { width: "min(92vw,340px)", background: "var(--panel)", color: "var(--text)", borderRadius: "16px", padding: "20px", boxShadow: "0 20px 60px rgba(0,0,0,.5)", fontFamily: "system-ui,sans-serif" });
  box.innerHTML = `
    <div style="font-size:16px;font-weight:800;margin:0 0 6px">🔑 Manager PIN</div>
    <div style="font-size:13px;color:var(--muted);margin:0 0 12px">${message || "A manager PIN is required for this action."}</div>
    <input class="pp-in" type="password" inputmode="numeric" maxlength="8" placeholder="••••" autocomplete="off"
      style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:18px;letter-spacing:4px;text-align:center;outline:none" />
    <div class="pp-err" style="font-size:12px;color:#fca5a5;min-height:16px;margin:6px 2px 0">${errText || ""}</div>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="pp-cancel" style="flex:1;padding:11px;border:0;border-radius:10px;font-weight:700;background:var(--panel-2);color:var(--text);cursor:pointer">Cancel</button>
      <button class="pp-ok" style="flex:1;padding:11px;border:0;border-radius:10px;font-weight:700;background:var(--gold);color:#14110d;cursor:pointer">Confirm</button>
    </div>`;
  ov.appendChild(box);
  document.body.appendChild(ov);
  const input = box.querySelector(".pp-in");
  const err = box.querySelector(".pp-err");
  setTimeout(() => input.focus(), 50);
  let backOff = window.LFH_BACK ? LFH_BACK.layer("tablet-pin", () => done(null)) : null;
  const done = (val) => { if (backOff) { backOff(); backOff = null; } ov.remove(); resolve(val); };
  box.querySelector(".pp-cancel").onclick = () => done(null);
  box.querySelector(".pp-ok").onclick = () => {
    const v = input.value.trim();
    if (!/^\d{4,8}$/.test(v)) { err.textContent = "Enter the 4–8 digit PIN."; return; }
    done(v);
  };
  input.onkeydown = (e) => { if (e.key === "Enter") box.querySelector(".pp-ok").click(); else if (e.key === "Escape") done(null); };
  ov.onclick = (e) => { if (e.target === ov) done(null); };
});

// reasonPrompt: a themed required text box (same shell as pinPrompt) — used when an
// action needs a WHY, e.g. reversing a paid bill (a refund/correction that gets logged).
// Resolves the trimmed reason, or null if cancelled / left blank.
const reasonPrompt = (message, placeholder) => new Promise((resolve) => {
  const ov = document.createElement("div");
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "var(--scrim)", backdropFilter: "blur(3px)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  const box = document.createElement("div");
  Object.assign(box.style, { width: "min(92vw,360px)", background: "var(--panel)", color: "var(--text)", borderRadius: "16px", padding: "20px", boxShadow: "0 20px 60px rgba(0,0,0,.5)", fontFamily: "system-ui,sans-serif" });
  box.innerHTML = `
    <div style="font-size:16px;font-weight:800;margin:0 0 6px">↩ Reason required</div>
    <div style="font-size:13px;color:var(--muted);margin:0 0 12px">${message || "Why are you making this change?"}</div>
    <input class="rp-in" type="text" maxlength="120" placeholder="${placeholder || "e.g. refund, wrong entry"}" autocomplete="off"
      style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px;outline:none" />
    <div class="rp-err" style="font-size:12px;color:#fca5a5;min-height:16px;margin:6px 2px 0"></div>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="rp-cancel" style="flex:1;padding:11px;border:0;border-radius:10px;font-weight:700;background:var(--panel-2);color:var(--text);cursor:pointer">Cancel</button>
      <button class="rp-ok" style="flex:1;padding:11px;border:0;border-radius:10px;font-weight:700;background:var(--gold);color:#14110d;cursor:pointer">Confirm</button>
    </div>`;
  ov.appendChild(box);
  document.body.appendChild(ov);
  const input = box.querySelector(".rp-in");
  const err = box.querySelector(".rp-err");
  setTimeout(() => input.focus(), 50);
  let backOff = window.LFH_BACK ? LFH_BACK.layer("tablet-reason", () => done(null)) : null;
  const done = (val) => { if (backOff) { backOff(); backOff = null; } ov.remove(); resolve(val); };
  box.querySelector(".rp-cancel").onclick = () => done(null);
  box.querySelector(".rp-ok").onclick = () => {
    const v = input.value.trim();
    if (!v) { err.textContent = "A reason is required."; return; }
    done(v);
  };
  input.onkeydown = (e) => { if (e.key === "Enter") box.querySelector(".rp-ok").click(); else if (e.key === "Escape") done(null); };
  ov.onclick = (e) => { if (e.target === ov) done(null); };
});

// Ask the waiter for a price at order time — used for "open price" dishes (as-per-MRP /
// market-price items like a soft-drink can or mineral water). Resolves a positive number
// (rupees), or null if cancelled. The server re-validates + clamps; this is just the entry.
const pricePrompt = (title, current) => new Promise((resolve) => {
  const ov = document.createElement("div");
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "var(--scrim)", backdropFilter: "blur(3px)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  const box = document.createElement("div");
  Object.assign(box.style, { width: "min(92vw,340px)", background: "var(--panel)", color: "var(--text)", borderRadius: "16px", padding: "20px", boxShadow: "0 20px 60px rgba(0,0,0,.5)", fontFamily: "system-ui,sans-serif" });
  box.innerHTML = `
    <div style="font-size:16px;font-weight:800;margin:0 0 6px">💰 Enter price</div>
    <div style="font-size:13px;color:var(--muted);margin:0 0 12px">Price for <b>${esc(title || "this item")}</b> (per item)</div>
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:20px;font-weight:800;color:var(--muted)">₹</span>
      <input class="pr-in" type="text" inputmode="decimal" maxlength="8" placeholder="0" autocomplete="off"
        value="${current != null && current > 0 ? esc(String(current)) : ""}"
        style="flex:1;min-width:0;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:20px;font-weight:800;outline:none" />
    </div>
    <div class="pr-err" style="font-size:12px;color:#fca5a5;min-height:16px;margin:6px 2px 0"></div>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="pr-cancel" style="flex:1;padding:11px;border:0;border-radius:10px;font-weight:700;background:var(--panel-2);color:var(--text);cursor:pointer">Cancel</button>
      <button class="pr-ok" style="flex:1;padding:11px;border:0;border-radius:10px;font-weight:700;background:var(--gold);color:#14110d;cursor:pointer">Add</button>
    </div>`;
  ov.appendChild(box);
  document.body.appendChild(ov);
  const input = box.querySelector(".pr-in");
  const err = box.querySelector(".pr-err");
  setTimeout(() => { input.focus(); input.select(); }, 50);
  let backOff = window.LFH_BACK ? LFH_BACK.layer("tablet-price", () => done(null)) : null;
  const done = (val) => { if (backOff) { backOff(); backOff = null; } ov.remove(); resolve(val); };
  // Keep only digits + one dot as the waiter types.
  input.oninput = () => { input.value = input.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"); };
  box.querySelector(".pr-cancel").onclick = () => done(null);
  box.querySelector(".pr-ok").onclick = () => {
    const v = Number(input.value);
    if (!v || v <= 0) { err.textContent = "Enter a price greater than 0."; return; }
    if (v > 100000) { err.textContent = "That price looks too high."; return; }
    done(Math.round(v * 100) / 100);
  };
  input.onkeydown = (e) => { if (e.key === "Enter") box.querySelector(".pr-ok").click(); else if (e.key === "Escape") done(null); };
  ov.onclick = (e) => { if (e.target === ov) done(null); };
});

// What the ＋ Other chip opens: type an allergy the six standard chips don't cover.
// Resolves the normalised word, or null if cancelled. Deliberately a small dialog and NOT
// a box parked under the chips — the chip rows redraw on every tap, which would wipe
// half-typed text. Mirrors pricePrompt so it looks like the panel's other one-field asks.
// `already` is the set this row holds, so a repeat is refused OUT LOUD rather than silently.
const allergyPrompt = (already) => new Promise((resolve) => {
  const ov = document.createElement("div");
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "var(--scrim)", backdropFilter: "blur(3px)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  const box = document.createElement("div");
  Object.assign(box.style, { width: "min(92vw,360px)", background: "var(--panel)", color: "var(--text)", borderRadius: "16px", padding: "20px", boxShadow: "0 20px 60px rgba(0,0,0,.5)", fontFamily: "system-ui,sans-serif" });
  box.innerHTML = `
    <div style="font-size:16px;font-weight:800;margin:0 0 6px">⚠ Add an allergy</div>
    <div style="font-size:13px;color:var(--muted);margin:0 0 12px">Anything the kitchen must leave out — it prints on the ticket, not the bill.</div>
    <input class="alg-in" type="text" maxlength="24" placeholder="e.g. coriander" autocomplete="off" autocapitalize="none"
      style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:17px;font-weight:700;outline:none" />
    <div class="alg-err" style="font-size:12px;color:#fca5a5;min-height:16px;margin:6px 2px 0"></div>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="alg-cancel" style="flex:1;padding:11px;border:0;border-radius:10px;font-weight:700;background:var(--panel-2);color:var(--text);cursor:pointer">Cancel</button>
      <button class="alg-ok" style="flex:1;padding:11px;border:0;border-radius:10px;font-weight:700;background:var(--gold);color:#14110d;cursor:pointer">Add</button>
    </div>`;
  ov.appendChild(box);
  document.body.appendChild(ov);
  const input = box.querySelector(".alg-in");
  const err = box.querySelector(".alg-err");
  setTimeout(() => { input.focus(); input.select(); }, 50);
  let backOff = window.LFH_BACK ? LFH_BACK.layer("tablet-allergy", () => done(null)) : null;
  const done = (val) => { if (backOff) { backOff(); backOff = null; } ov.remove(); resolve(val); };
  box.querySelector(".alg-cancel").onclick = () => done(null);
  box.querySelector(".alg-ok").onclick = () => {
    const v = normAlg(input.value);
    // Every refusal SAYS why — an Add that just does nothing reads as a broken button.
    if (!v) { err.textContent = "Type what the kitchen should leave out."; return; }
    if (already && already.has(v)) { err.textContent = `“${v}” is already on this list.`; return; }
    done(v);
  };
  input.oninput = () => { err.textContent = ""; };
  input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); box.querySelector(".alg-ok").click(); } else if (e.key === "Escape") done(null); };
  ov.onclick = (e) => { if (e.target === ov) done(null); };
});

// Run an action that MAY need a manager PIN: try it plainly first (so it stays
// frictionless when no PIN is configured yet, or for the admin super-user); if the
// server answers "manager PIN required", prompt once and retry with it. Reloads on
// success; a cancelled PIN aborts silently; real errors toast.
// DOES THE SERVER WANT A MANAGER PIN? Read the FLAG it sends, not the sentence.
// The gate answers `{ error: "A manager PIN is required for this.", needPin: true }` with a 403
// (app/api/tablet/[...path]/route.ts), and this panel's api() was extended specifically to carry
// that body through on the error — its comment above says so, naming `needPin`. Six places still
// matched the PROSE anyway, so rewording the server's sentence to "A manager's PIN is required"
// would have silently stopped the PIN prompt appearing at all and turned every gated action into
// a bare error. CLAUDE.md: branch on server reason CODES, not prose. The text test is kept as a
// fallback ONLY for a stack whose server predates the flag.
const wantsPin = (e) => !!(e && ((e.data && e.data.needPin === true) || /manager pin/i.test(String(e.message || ""))));
async function actGated(method, path, body, opts = {}) {
  try {
    let r;
    // opts.expect (optional) says what the screen was editing FROM, so a PIN-gated value edit
    // (a discount, say) gets the same no-silent-overwrite protection as a plain one.
    const apiOpts = opts.expect ? { expect: opts.expect } : undefined;
    try {
      r = await api(method, path, body, apiOpts);
    } catch (e) {
      if (!wantsPin(e)) throw e;
      let pin = await pinPrompt(opts.message);
      while (pin) {
        try { r = await api(method, path, { ...(body || {}), managerPin: pin }, apiOpts); break; }
        catch (e2) {
          if (wantsPin(e2)) { pin = await pinPrompt(opts.message, "That PIN didn't match — try again."); continue; }
          throw e2;
        }
      }
      if (!pin) return; // cancelled
    }
    if (isQueued(r)) { toast(savedMsg(r)); return; }  // #2: saved offline — skip the offline GET + the success toast
    await load();
    // THE SERVER'S ANSWER IS HANDED TO onSuccess. Some writes decide something the screen cannot
    // work out for itself — a merge picks which table KEEPS the bill (the lowest number, not the one
    // that was tapped), and until this argument existed the tablet guessed, named the wrong table in
    // its toast, and pointed its undo at a table that was never the child. Every existing callback
    // ignores the argument, so adding it changes nothing for them.
    if (typeof opts.onSuccess === "function") { try { opts.onSuccess(r); } catch (e) {} }
    else if (opts.toast) toast(opts.toast);
  } catch (e) {
    toast("Failed: " + errText(e), false);
  }
}

// ── floor helpers ────────────────────────────────────────────────────────────
// ── MERGED TABLES (mig 249) — the tablet mirrors the manager panel ─────────────────────────
// The floor summary carries the live joins (state.summary.merges: parent_table + child_table).
// A merged CHILD table has no session of its own: its party, bill and money live on the PARENT's
// session, while its orders keep their own table number (that is what makes an unmerge exact).
// Before these helpers the tablet knew none of this — a merged child's tile read "Free", its
// detail said nothing was ordered, and Mark-paid settled half a joint bill.
function mergeList() { return (state.summary && Array.isArray(state.summary.merges)) ? state.summary.merges : []; }
function mergeParentOf(t) {
  const m = mergeList().find((x) => String(x.child_table) === String(t));
  return m ? String(m.parent_table) : null;
}
function mergeChildrenOf(t) {
  return mergeList().filter((m) => String(m.parent_table) === String(t)).map((m) => String(m.child_table))
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
}
// Every table served as one party with t (t included, parent first).
function partyTablesOf(t) {
  const head = mergeParentOf(t) || String(t);
  const all = [String(head), ...mergeChildrenOf(head)];
  return all.length > 1 ? all : [String(t)];
}
// "T6 + T7" for a bill heading — null when t isn't part of a merged party.
function mergeGroupLabel(t) {
  const parent = mergeParentOf(t) || String(t);
  const kids = mergeChildrenOf(parent);
  return kids.length ? [parent, ...kids].map((x) => "T" + x).join(" + ") : null;
}
// Every live order across the whole party, deduped by id — what any whole-bill action must use.
function partyOrders(t) {
  const seen = new Set();
  return partyTablesOf(t).flatMap((x) => ordersOf(x)).filter((o) => (seen.has(o.id) ? false : seen.add(o.id)));
}
// A merged child answers with its PARENT's session — ownership is the session, never the
// table number (mig 232), and the child's party IS the parent's.
const rawSessionOf = (t) => state.data.sessions.find((s) => String(s.table_number) === String(t) && s.status === "open");
const sessionOf = (t) => rawSessionOf(t) || (mergeParentOf(t) ? rawSessionOf(mergeParentOf(t)) : undefined);
// ordersOf(t): the orders of the party sitting at table t RIGHT NOW — see the long note on
// the manager's ordersForTable (owner report, 2026-07-30). An order counts only when it
// carries this table's OPEN-session id, or no session id at all (banquet/legacy rows).
// Matching table_number alone let a NEW party inherit a PREVIOUS party's leftover live
// orders — the manager showed a just-opened table as "Preparing · ₹1,150 due" from 9-day-old
// dishes, and this panel would have carried them onto the new bill. state.data.sessions only
// ever holds NON-closed sessions, so an order pointing at a closed session fails this test.
// `archived` rows are off the floor by definition. Mirrors lfh_table_view_summary.
// Whose orders are at table t? THIS party's — its own session id, or a party-LESS row taken
// during this sitting (banquet / legacy paths, never hidden). An order OLDER than the party is not
// the party's: table 2 held two live orders from 7 July with no session, and admitting every
// party-less row put them on tonight's bill (owner report, 2026-07-31; the manager panel and the
// server slice enforce the same rule, so all three agree).
const ordersOf = (t) => {
  const s = sessionOf(t);
  const since = s && s.opened_at ? new Date(s.opened_at).getTime() - 60000 : 0; // 60s of slack for an order that beat its session row
  return state.data.orders.filter((o) => String(o.table_number) === String(t) && o.status !== "cancelled" && !o.archived
    && (s
      ? (o.session_id === s.id || (!o.session_id && (!since || new Date(o.created_at || 0).getTime() >= since)))
      : !o.session_id));
};
// sliceLoaded(t): has table t's FULL slice (session row or a live order) landed yet? The grid
// runs on the slim summary; a table's full detail slice is only fetched when you tap it. Before
// that first fetch, sessionOf/ordersOf are empty even for an occupied table — so the detail
// briefly showed "closed / no orders" for 3-4s until /state?table=N landed. This lets renderPanel
// paint an instant, summary-accurate "opening…" detail meanwhile (stale-while-revalidate), with
// only the dish rows streaming in. (owner report, 2026-07-02 — tablet was the worst offender.)
const sliceLoaded = (t) => {
  const s = String(t);
  return state.data.sessions.some((x) => String(x.table_number) === s)
      || state.data.orders.some((o) => String(o.table_number) === s && o.status !== "cancelled");
};
const callsOf = (t) => state.data.calls.filter((c) => String(c.table_number) === String(t));
// Waiter-call note → icon (matches the manager's REASON_EMOJI). Case-insensitive so it
// works whatever casing the guest app sent — shows WHAT was called, not just a bell.
function callIcon(note) {
  const n = String(note || "").toLowerCase();
  if (/water/.test(n)) return "💧";
  if (/cutler|fork|spoon/.test(n)) return "🍴";
  if (/napkin/.test(n)) return "🧻";
  if (/clean/.test(n)) return "🧹";
  if (/bill|cheque|\bcheck\b/.test(n)) return "🧾";
  if (/help|waiter|call/.test(n)) return "🙋";
  return "🔔";
}
const joinersOf = (t) => {
  const s = sessionOf(t);
  return s ? state.data.members.filter((m) => m.session_id === s.id && !m.approved) : [];
};
const membersOf = (t) => {
  const s = sessionOf(t);
  return s ? state.data.members.filter((m) => m.session_id === s.id) : [];
};
// An "open" request is MOOT once the table is open (it's already been fulfilled), so
// never show it on an open table — that stale "Asked to open · X" with Approve/Deny was
// a glitch. join/access requests stay valid on an open table. (owner, 2026-06-18)
const reqsOf = (t) => (state.data.requests || []).filter((r) => String(r.table_number) === String(t) && !(r.type === "open" && sessionOf(t)));

// The dish rows for one order. Prefer the real order_items rows (they have an id,
// so each dish can be advanced individually); fall back to the order.items JSON
// (legacy / no per-dish id) exactly like the kitchen does.
function dishRowsOf(o) {
  // Which titles on THIS order were sold at a locked MRP price. The board's order_items rows
  // don't carry the flag (lib/liveBoard.ts ITEM_COLS doesn't fetch it), so it is read off the
  // order's own frozen ticket and matched by title — the same match migration 270's trigger
  // uses, and safe for the same reason: two lines with one title in one order came from one
  // dish. Purely a label; no money is decided by it.
  const mrpTitles = new Set((Array.isArray(o.items) ? o.items : [])
    .filter((ln) => ln && ln.is_mrp === true).map((ln) => String(ln.title || "")));
  const db = (state.data.items || []).filter((i) => i.order_id === o.id);
  if (db.length) return db.map((r) => ({ id: r.id, title: r.title, qty: r.qty || 1, status: r.status || "received", options: r.options, removed: r.removed, note: r.note, price: Number(r.unit_price) || 0, added_allergens: r.added_allergens, removed_flag: r.removed_flag, is_mrp: mrpTitles.has(String(r.title || "")), fromDb: true }));
  const js = Array.isArray(o.items) ? o.items : [];
  return js.map((r) => ({ id: null, title: r.title || r.name, qty: r.qty || 1, status: r.status || o.status || "received", options: r.options, removed: r.removed, note: r.note, price: Number(r.price) || 0, is_mrp: r.is_mrp === true, fromDb: false }));
}

// ── TIER 1: the slim per-tile summary (drives the GRID) ──────────────────────
// summaryTile(t): the server-computed tile for table t (state/label/meta/counts/due/pay +
// badge counts), or a synthetic "free" tile when the summary has none. The grid reads ONLY
// this — never the full board — so an unselected table needs no order rows cached.
function summaryTile(t) {
  const tile = (state.summary.tiles || {})[String(t)];
  if (!tile) return { state: "free", label: "Free", meta: "", members: 0, pending: 0, counts: { nw: 0, ck: 0, rd: 0, sv: 0 }, due: 0, pay: "", hasNew: false, hasCall: false, hasReq: false, hasJoin: false, reqs: 0, calls: 0 };
  // "Open · waiting for guests" is not a state anybody manages any more (owner, 2026-07-31):
  // a party with nothing ordered is an AVAILABLE table. The server RPC still computes it (it's
  // shared with other panels), so it's re-presented here — at the source, so the tiles, the
  // Active/Free filter counts and tileIsOpen() can never tell three different stories.
  if (tile.state === "waiting") return Object.assign({}, tile, { state: "free", label: "Free", meta: "" });
  if (tile.state === "free") return Object.assign({}, tile, { meta: "" }); // "tap to open" is dead wording
  return tile;
}
// The per-restaurant waiter calls for table t (with their notes → the call emoji). Comes from
// the summary's tiny calls[] list (only OPEN-session calls), NOT the full board.
function summaryCallsOf(t) {
  return (state.summary.calls || []).filter((c) => !c.resolved && String(c.table_number).trim() === String(t));
}

// effRate(): the restaurant's effective tax rate as a decimal — mirrors lib/tax.ts and
// SQL lfh_effective_tax_rate (sum of named tax_components, else tax_rate, else 5%). Used
// so the tablet applies the discount BEFORE tax exactly like billMath / the printed bill,
// instead of the old total−discount (which taxed the pre-discount amount and over-stated
// the due by discount×rate). (2026-07-05)
// discPct(subtotal, disc) — "10%" / "12.5%" / "" for a discount, decided ONCE in billdoc.js so
// this screen, the manager's bill and the printed paper all quote the same figure (owner,
// 2026-08-03: "make sure in the bill also the discount percentage is being shown").
function discPct(subtotal, disc) {
  return (typeof LFH_BILLDOC !== "undefined" && LFH_BILLDOC.discPct) ? LFH_BILLDOC.discPct(subtotal, disc) : "";
}
// preTax(gross) — this panel's slim payload carries only tax-INCLUSIVE order totals, so the
// pre-discount subtotal a percentage is measured against is the gross worked back through the
// tax rate. Same base the discount modal uses, so the two can't disagree.
const preTax = (gross) => (Number(gross) || 0) / (1 + effRate());

// ── THE THREE PRICE BEHAVIOURS (migration 270) ───────────────────────────────
// A dish's price is either NET (GST added on top — 'excl', the default and today's
// behaviour), GROSS (GST already inside — 'incl'), or FINAL (never taxed — 'exempt', an
// MRP bottle). This mirrors lib/tax.ts resolveTaxMode() and SQL lfh_resolve_tax_mode(),
// case for case and in the same order. If you change one, change all three — four screens
// quoting four numbers for one meal is the bug this rule exists to prevent.
// (priceTaxMode() went with resolveTaxMode() — it had no other caller, and the guard below caught
// that the moment resolveTaxMode was deleted. billdoc.js has its own, for the printed bill.)
function itemTaxModesOn() {
  return (state.data.settings || {}).item_tax_modes_allowed === true;
}
// (resolveTaxMode() WAS HERE, and it is gone — owner's word, 2026-08-28.)
//
// It mirrored lib/tax.ts + lfh_resolve_tax_mode case for case, and NOTHING on this panel called it.
// It could not: a resolved mode is written onto each line of the frozen ticket by lfh_price_order
// when the order is placed, so orderTaxSplit() below reads `ln.tax_mode` straight off the ticket
// rather than deciding it again — which is the right way round, because the mode that priced a bill
// last week must not be re-derived from today's settings.
//
// A mirror nothing calls is worse than no mirror: it looks like the authority on a money rule while
// drifting from the two places that really decide it. The rule itself is unchanged and still lives
// in lib/tax.ts (resolveTaxMode) and SQL (lfh_resolve_tax_mode); the MANAGER panel keeps its own
// copy and that one IS live (public/panels/editor/app.js) — this note is not permission to touch it.
// itemTaxModesOn() STAYS — dishIsMrp() uses it to decide whether a dish wears the MRP stamp.
// priceTaxMode() did NOT: resolveTaxMode was its only caller, so it went too (I wrote the opposite
// here first and verify:tablet-taps §12 caught it on its very first run — which is the point of it).
/** Does this MENU dish wear the "MRP" stamp? Presentational only — the money comes from
 *  resolveTaxMode(). Same rule as lib/tax.ts isMrpDish(). */
function dishIsMrp(d) {
  return !!d && String(d.tax_mode || "") === "mrp" && itemTaxModesOn();
}

// taxableBaseOf(order) — the part of ONE order's money GST is charged on, which is what a
// discount may be measured against and never a rupee more (an MRP price is final: a discount
// that ate into it would both break the law and break the identity every tile here relies on,
// due = total − discount×(1+rate)).
//
// The order's own frozen ticket (orders.items, written by lfh_price_order) carries each line's
// resolved tax_mode, so the base is rebuilt from it with the SAME per-line rounding the server
// used. When the ticket predates migration 270 — no line carries a mode — every line was
// taxable, and the answer is the old one: the gross worked back through the rate. That
// fallback is not a guess; it is what those bills actually charged.
//
// NOTE (reported, not worked around): orders.taxable_base is the authoritative figure, but the
// waiter board's order columns (lib/liveBoard.ts ORDER_COLS) do not fetch it. The server's own
// clamp in app/api/tablet/[...path]/route.ts DOES read that column, so it is the ruling — this
// is the screen's honest estimate of the same number, used to cap the UI and to say NO out loud.
function orderTaxSplit(o) {
  const rate = effRate();
  const lines = Array.isArray(o && o.items) ? o.items : [];
  const typed = lines.filter((ln) => ln && ln.tax_mode);
  // No modes on the ticket = a pre-269 order = all of it was taxable. Returning the gross
  // worked back through the rate is byte-for-byte what this panel did before.
  if (!lines.length || !typed.length) return { base: Math.max(0, preTax(Number(o && o.total) || 0)), nontax: 0 };
  let base = 0, nontax = 0;
  for (const ln of lines) {
    const unit = parseFloat(String(ln.price == null ? "" : ln.price).replace(/[^0-9.]/g, "")) || 0;
    const qty = Math.max(1, parseInt(String(ln.qty == null ? "1" : ln.qty), 10) || 1);
    const amt = Math.round(unit * qty * 100) / 100;
    const mode = String(ln.tax_mode || "excl");
    if (mode === "exempt") nontax += amt;                              // final price — never taxable
    else if (mode === "incl") base += Math.round((amt / (1 + rate)) * 100) / 100;
    else base += amt;
  }
  // Counted from the lines themselves, never as (total − base×(1+rate)): that subtraction
  // picks up the server's own rounding and would report a phantom ₹0.01 "MRP" on an ordinary
  // bill, which then appears in the refusal wording as a reason nobody can act on.
  return { base: Math.round(base * 100) / 100, nontax: Math.round(nontax * 100) / 100 };
}
// (taxableBaseOf() WAS HERE — one line wrapping orderTaxSplit(o).base, and gone with it,
// owner's word 2026-08-28. Every caller reads `orderTaxSplit(o).base` directly, which is the same
// number by the same maths and says out loud which half of the split it is taking.)

function effRate() {
  const s = state.data.settings || {};
  const comps = Array.isArray(s.tax_components)
    ? s.tax_components.map((c) => ({ label: String((c && c.label) || "").trim(), rate: Number(c && c.rate) || 0 })).filter((c) => c.label && c.rate > 0)
    : [];
  if (comps.length) return comps.reduce((a, c) => a + c.rate, 0) / 100;
  return Number(s.tax_rate) || 0.05;
}

// banquetRate(): a banquet is taxed at its OWN rate (mig 239) — the sum of the restaurant's
// banquet_tax_components when it set any, else exactly what effRate() returns. Mirrors SQL
// lfh_banquet_tax_rate() so the quick-bill estimate on this screen and the bill the server
// actually creates can never quote two different taxes (18% banquet vs 5% dine-in is the
// normal pair, so the gap was a whole extra rupee in eight).
function banquetRate() {
  const s = state.data.settings || {};
  const comps = Array.isArray(s.banquet_tax_components)
    ? s.banquet_tax_components.map((c) => ({ label: String((c && c.label) || "").trim(), rate: Number(c && c.rate) || 0 })).filter((c) => c.label && c.rate > 0)
    : [];
  return comps.length ? comps.reduce((a, c) => a + c.rate, 0) / 100 : effRate();
}

// "Print" the first time, "Reprint" after that (owner, 2026-08-19: "after once print the button
// will just show reprint instead of print works same"). Same rule and same wording as the manager
// panel's billPrintLabel — the answer comes off the BILL (sessions.bill_printed_at, mig 333), so
// the manager printing at the till makes THIS screen say "Reprint" a minute later.
// WORKS THE SAME: same handler, same sheet, no question asked, nothing recorded.
// Same remembered set as the manager panel, for the same reason: a refresh landing between the
// print and the server's stamp must never turn "Reprint" back into "Print" on a bill whose paper
// the guest is already holding.
const _billPrintedHere = new Set();
function billPrintedBefore(sess, os) {
  if (sess && sess.bill_printed_at) return true;
  if ((os || []).some((o) => o && o.bill_printed_at)) return true;
  const sid = (sess && sess.id) || (os || []).map((o) => o && o.session_id).find(Boolean);
  return !!sid && _billPrintedHere.has(sid);
}
function billPrintLabel(sess, os, suffix) {
  return `<span data-bill-print-btn>🖨 ${billPrintedBefore(sess, os) ? "Reprint" : "Print"}${suffix ? " " + suffix : ""}</span>`;
}

// printTableBill(t): give the guest their bill FROM THE WAITER'S HANDHELD.
//
// This panel could do every step of issuing a tax invoice except produce it: take the money, split
// it, capture the customer, mint a numbered invoice — and then there was no way to print. A table
// settled entirely from here left the guest with nothing on paper unless a manager opened the
// manager panel. (T7 sweep, F9.)
//
// It builds NO document and decides NO figures of its own: the money and the whole assembly live in
// /panels/billdoc.js (billMoney → billData → billDocHtml), the same three the manager panel and the
// admin's preview use. Writing a second assembler here is precisely the fault this sweep removed
// from the split-payment path, so what this function actually does is small: name the table, and
// open the window.
function printTableBill(t) {
  if (typeof LFH_BILLDOC === "undefined" || !LFH_BILLDOC.billData) { toast("Can't print just now — reload the panel.", false); return; }
  const os = partyOrders(t).filter((o) => o.status !== "cancelled");
  if (!os.length) { toast("Nothing on this table to print yet.", false); return; }
  const sess = sessionOf(t) || {};
  // The restaurant's own name for the table, and every table of a joined party ("T6 + T7", mig 249).
  const tnum = String(t == null ? "" : t).trim();
  const tableDisp = mergeGroupLabel(tnum) || (/^\d+$/.test(tnum) ? (tname(tnum) || "T" + tnum) : (tnum || "—"));
  const html = LFH_BILLDOC.billDocHtml(LFH_BILLDOC.billData({
    settings: state.data.settings || {},
    restaurant: state.data.restaurant || {},
    orders: os,
    money: LFH_BILLDOC.billMoney(os, state.data.settings || {}),
    session: sess,
    tableDisp,
    // The logo only prints when the restaurant really uploaded one; an http(s) check because a bad
    // value would otherwise render a broken image on a guest's bill.
    logo: /^https?:\/\//i.test(String((state.data.restaurant || {}).logo_url || "")) ? String(state.data.restaurant.logo_url) : "",
    autoPrint: true,
    // REJECTED (owner, 2026-08-19): the bill sheet says NOTHING about being a second copy. A
    // `reprint` flag was passed here 2026-08-17 → 2026-08-19 and drew a "Reprint · Duplicate" band;
    // he removed it — a guest asking for their bill again is service, not an incident. billdoc.js
    // has no such flag any more, and scripts/verify-bill-reprint-is-silent.mjs keeps it that way.
  }));
  // Stamp the first print, so this bill's button reads "Reprint" on EVERY panel from now on —
  // that is the only thing the stamp does. Idempotent on the server; fire-and-forget, because a
  // failed stamp must never stand between a guest and their bill. Nothing is written to the Audit.
  // Remembered as printed the moment the window is written, not when the server answers.
  if (sess.id) _billPrintedHere.add(sess.id);
  if (sess.id && !sess.bill_printed_at) {
    try {
      api("POST", `/sessions/${sess.id}/bill-printed`)
        .then(() => {
          _billPrintedHere.add(sess.id);
          sess.bill_printed_at = new Date().toISOString();
          os.forEach((o) => { if (o && !o.bill_printed_at) o.bill_printed_at = sess.bill_printed_at; });
          // Relabel the button already under the waiter's finger, without a redraw of the panel.
          document.querySelectorAll("[data-bill-print-btn]").forEach((b) => {
            b.textContent = b.textContent.replace(/\bPrint\b/, "Reprint");
          });
        })
        .catch(() => {});
    } catch (e) { /* offline — the paper still came out */ }
  }
  // Does a COMPUTER own the bills? (mig 341) Filled from the answer to /print/send itself — the tablet
  // has no printing poll of its own and does not need one: it TRIES the basket, and the server says
  // `noRoute` when no computer owns this paper, which is the same fallback the manager panel uses.
  // One reusable named window, and nothing here ever closes it — Print and Cancel are the same
  // event to the page, so closing on afterprint threw the bill away when someone pressed Cancel.
  // Opened tall on purpose: the bill sizes itself to fit the window (billdoc.js zFit), so a taller
  // window means a bigger, easier-to-read bill rather than a scrollbar. A REUSED window keeps its
  // own size, so this is the first-open default only.
  // TRY THE BASKET FIRST. If a computer owns the bills, the paper comes out on ITS printer and this
  // tablet opens nothing at all — which is the whole point on a device that usually has no printer.
  // Any other answer (noRoute, an error, no signal) falls through to the window, exactly as before:
  // a waiter must never be left holding a guest's bill with nothing on screen.
  // sess.id, NOT `sid` — my first version reached for a variable that lives in a DIFFERENT function
  // (billPrintedBefore's local), which parses perfectly and throws the moment a waiter presses Print.
  // The session is `sess` here, named twenty lines above.
  if (!sess.id) { openBillWindow(html); return; }
  api("POST", "/print/send", { kind: "bill", sessionId: sess.id })
    .then((r) => {
      if (r && r.queued) { toast(r.note || ("Sent to " + r.printer), true); return; }
      openBillWindow(html);
    })
    .catch(() => openBillWindow(html));
}
function openBillWindow(html) {
  const w = window.open("", "lfh_bill_print", "width=440,height=" + Math.min(960, Math.max(620, (screen.availHeight || 900) - 80)));
  if (!w) { toast("Allow pop-ups to print the bill.", false); return; }
  try { w.document.open(); } catch (e) {}
  w.document.write(html);
  w.document.close();
  try { w.focus(); } catch (e) {}
}

// tableAgg(t): a tile's display data. For the SELECTED table we still compute from its full
// slice (state.data) so the detail + optimistic taps stay exact; for every OTHER tile we read
// the slim summary. Same shape either way so renderFloor doesn't care which tier it got.
//   { nw, ck, rd, sv, due, kots, guests, unpaid, paid, billNo, hasOrders }
function tableAgg(t) {
  // SELECTED table with its slice loaded → live-from-board (mirrors the editor's tableTileState).
  // (sessionOf(t) is OR'd OUTSIDE the .some() — it used to sit inside the callback, so a
  //  session-only table with zero cached orders anywhere never took this live branch.)
  if (String(state.table) === String(t)
      && ((state.data.orders || []).some((o) => String(o.table_number) === String(t)) || sessionOf(t))) {
    const os = partyOrders(t), s = sessionOf(t); // the whole party — one bill, one set of numbers
    let nw = 0, ck = 0, rd = 0, sv = 0, dueTot = 0, dueDisc = 0;
    const kots = [];
    os.forEach((o) => {
      if (o.kot_no != null) kots.push(o.kot_no);
      // Due counts only ACCEPTED unpaid bills (not brand-new 'received' orders). Accumulate
      // the bill's total & discount; the DUE is computed discount-BEFORE-tax below so it
      // matches the printed bill / server summary and the waiter never over-collects.
      if (o.status !== "cancelled" && o.status !== "received" && o.payment_status !== "paid") {
        dueTot += Number(o.total) || 0; dueDisc += Number(o.discount) || 0;
      }
      dishRowsOf(o).forEach((r) => {
        const q = r.qty || 1;
        if (r.status === "served") sv += q; else if (r.status === "ready") rd += q; else if (r.status === "preparing") ck += q; else nw += q;
      });
    });
    // discount-before-tax: (Σtotal − Σdiscount×(1+rate)), clamped ≥0 == billMath's rule.
    const due = Math.max(0, dueTot - dueDisc * (1 + effRate()));
    // Ring rule MUST match the summary/manager: it shows only for ACCEPTED orders — a brand-new
    // 'received' order rings NOTHING (no green, no red) until staff accept it. unpaid = any accepted
    // (not received/cancelled) order still owing; paid = any accepted order fully paid.
    const accepted = os.filter((o) => o.status !== "cancelled" && o.status !== "received");
    const unpaid = accepted.some((o) => o.payment_status !== "paid");
    const paid = !unpaid && accepted.some((o) => o.payment_status === "paid");
    return { nw, ck, rd, sv, due, kots, guests: membersOf(t).length, unpaid, paid, billNo: s && s.bill_no, hasOrders: os.length > 0 };
  }
  // Every other tile → the slim summary. The summary has no KOT numbers (it's a manager RPC;
  // the waiter sees the KOT once they tap the table) — the grid renders `meta` instead. The
  // summary's `pay` is red ONLY for an ACCEPTED unpaid bill (a brand-new 'received' order rings
  // nothing), matching the manager; this is a deliberate, documented change from the old tablet
  // which rang red for any unpaid order.
  const tile = summaryTile(t);
  const c = tile.counts || { nw: 0, ck: 0, rd: 0, sv: 0 };
  const unpaid = tile.pay === "red";
  return {
    nw: c.nw || 0, ck: c.ck || 0, rd: c.rd || 0, sv: c.sv || 0,
    due: Number(tile.due) || 0, kots: [], guests: tile.members || 0,
    unpaid, paid: tile.pay === "green",
    billNo: null, hasOrders: (c.nw + c.ck + c.rd + c.sv) > 0 || tile.state === "bill" || tile.state === "done",
    meta: tile.meta,
  };
}

// The tile's colour/label — straight from the summary's computed state for non-selected tables,
// or recomputed from the slice for the selected one (same precedence: new → ready → prep →
// served/bill → seated/waiting → req → free).
function tileState(t) {
  // A merged member wears its PARTY's state (the party lives on the parent's session), so the
  // grid, the filter chips and the count strips can never call a joined table "free".
  t = mergeParentOf(t) || t;
  if (String(state.table) === String(t)
      && ((state.data.orders || []).some((o) => String(o.table_number) === String(t)) || sessionOf(t))) {
    const a = tableAgg(t), s = sessionOf(t);
    if (a.nw > 0) return { cls: "new", label: "New order" };
    if (a.rd > 0) return { cls: "ready", label: "Ready to serve" };
    if (a.ck > 0) return { cls: "prep", label: "Preparing" };
    // Served but money still due → "Served"; served AND paid → "Cleared" — matching
    // the server summary (lfh_table_view_summary) + the manager tile. Previously this
    // always said "Served", so a paid table's tile FLIPPED "Cleared"→"Served" the moment
    // you selected it (the summary said "Cleared", this recompute said "Served").
    if (a.hasOrders && a.sv > 0) return { cls: a.unpaid ? "bill" : "done", label: a.unpaid ? "Served" : "Cleared" };
    // A party with nobody seated and nothing ordered reads as FREE — "Open" was the
    // open/close-era word for it and staff have no such step now (owner, 2026-07-31).
    if (s) return a.guests ? { cls: "seated", label: "Seated" } : { cls: "free", label: "Free" };
    if (reqsOf(t).length) return { cls: "req", label: "Wants in" };
    return { cls: "free", label: "Free" };
  }
  const tile = summaryTile(t);
  return { cls: tile.state, label: tile.label };
}

// A table "needs attention" if it has a waiter call, a pending request, a brand-new order to
// accept, or food sitting READY to carry out. Driven by the summary tile's badge flags (so it
// works for every tile, not just the loaded one).
function needsAttention(i) {
  // Calls and requests belong to the table they were made AT, so they read from its own tile —
  // a bell rung at T7 is T7's business, merged or not. The FOOD flags are the party's, because
  // that is what the tile renders: a joined table shows the party's ✓ Accept and its "ready"
  // pills, so leaving it out of "⚠ Needs" hid a tile that was visibly asking to be attended.
  const own = summaryTile(i);
  const party = summaryTile(mergeParentOf(i) || i);
  return !!(own.hasCall || own.hasReq || party.hasNew || (party.counts && party.counts.rd > 0));
}

function tableCount() { return Math.max(1, parseInt((state.data.settings || {}).table_count, 10) || 12); }

// floorDrawCount: how far the grid actually draws. Normally 1…table_count, but a table
// numbered ABOVE the current count can still be OCCUPIED — the count was lowered while it
// had a live order, so the summary RPC keeps returning it (generate_series ∪ open sessions
// ∪ live orders). Without this the waiter's floor simply stops at table_count and that
// table's bill is unreachable: found on the live backup 2026-07-30 with an UNPAID order
// sitting on table 48 of a 30-table floor, invisible to every waiter.
//
// The manager panel got exactly this fix on 2026-07-06 (floorDrawCount in editor/app.js);
// the waiter tablet was never given it. This is that same fix, kept deliberately identical.
// Destination pickers (shift / merge / move) still use tableCount() — you may take a party
// OFF an off-plan table, but never send one TO a table that isn't on the floor plan.
// Returns the LIST of table numbers to draw — the floor plan (1…table_count) plus any
// occupied table ABOVE it, and nothing else. Deliberately a list and not a bigger max:
// stretching the range to the highest number drew every gap in between as a phantom empty
// table (a 30-table floor with one order on T48 rendered 48 tiles, 17 of them fictional —
// and a stress restaurant that shrank from 300 would render hundreds). QA sweep 2026-07-30.
function floorTableList() {
  const n = tableCount();
  const out = [];
  for (let i = 1; i <= n; i++) out.push(i);
  const tiles = (state.summary && state.summary.tiles) || {};
  const extras = Object.keys(tiles)
    .map((k) => parseInt(k, 10))
    .filter((k) => Number.isFinite(k) && k > n)
    // …AND ONLY WHEN IT ACTUALLY HAS SOMETHING ON IT (T4 sweep, 2026-08-04). The whole reason to
    // draw a table above the floor plan is that its BILL would otherwise be unreachable — a FREE
    // one has no bill, so drawing it just puts a phantom table on a waiter's floor and inflates the
    // "Free" chip. Observed live: six tiles above a 30-table floor, every one reading "Free",
    // counted into "Free 26". The summary RPC returns a row for an off-plan table (generate_series ∪
    // open sessions ∪ live orders) and can keep returning it after its session closed or its orders
    // were archived. A merged member is kept whatever its own row says — its party's money is real
    // and lives on another tile. ("waiting" is re-presented as free by summaryTile, so both go.)
    .filter((k) => {
      const key = String(k);
      const st = (tiles[key] || {}).state;
      const occupied = !!st && st !== "free" && st !== "waiting";
      return occupied || !!mergeParentOf(key) || mergeChildrenOf(key).length > 0;
    })
    .sort((a, b) => a - b);
  return out.concat(extras);
}

// stepTables(): the order the ‹ › buttons in an open table's popup walk. Deliberately the
// tables the FLOOR is drawing right now, in the same order and through the same section rule
// (inMySection), so "next" can only ever mean the next table this waiter actually serves —
// and, when a filter is on, the next one they were looking at. Strings, to compare with
// state.table without surprises. (owner, 2026-08-03: "toggle the tables very fast".)
function stepTables() {
  const on = floorTableList().filter((i) => passesFilter(i));
  // ONLY tables that have something on them. Stepping into a FREE table used to open an empty
  // popup ("No orders yet") — while TAPPING that same tile jumps straight into the order
  // builder, so one table had two different destinations depending on how you reached it
  // (caught in review, 2026-08-04). ‹ › are for walking the work: the tables with a party, a
  // bill or a request on them. A free table is still one tap away on the floor behind.
  const busy = on.filter((i) => tileIsOpen(i) || !!mergeParentOf(i) || mergeChildrenOf(i).length > 0);
  return (busy.length ? busy : on).map(String);
}

// ── Waiter sections (mig 222) ────────────────────────────────────────────────
// `my_tables` comes down with the floor summary: an ARRAY = this waiter only serves
// those tables; NULL/absent = not restricted (the admin, a manager/owner looking in, or
// the module is off for this restaurant) and the whole floor renders exactly as before.
//
// The server already narrows what it SENDS, but the client still has to know the list:
// renderFloor draws 1…table_count and summaryTile() invents a "free" tile for any number
// the summary didn't mention — so without this, another waiter's tables would still sit
// on screen looking empty and tappable.
function mySection() {
  const my = (state.summary || {}).my_tables;
  return Array.isArray(my) ? my.map((n) => String(parseInt(n, 10))) : null;
}
const sectioned = () => mySection() !== null;
function inMySection(i) {
  const my = mySection();
  if (my === null) return true;
  if (my.includes(String(parseInt(i, 10)))) return true;
  // A table number ABOVE the floor plan is in nobody's section (the editor only offers
  // 1…table_count), so hiding it would strand an open bill nobody could reach. Found live:
  // tables 47-48 still carried orders on a 30-table floor. Mirrors allows() on the server.
  return Number(i) > tableCount();
}

// "1 2 3 4 5 6"  →  "1-6";  "1 2 4 9 10"  →  "1-2, 4, 9-10". A waiter reads their own
// section at a glance instead of counting a row of twenty chips.
function rangeText(nums) {
  const xs = nums.map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return "";
  const parts = [];
  let start = xs[0], prev = xs[0];
  for (let i = 1; i <= xs.length; i++) {
    const cur = xs[i];
    if (cur === prev + 1) { prev = cur; continue; }
    parts.push(start === prev ? String(start) : `${start}–${prev}`);
    start = cur; prev = cur;
  }
  return parts.join(", ");
}

// The "Your tables" strip above the floor. Hidden entirely (via an inline style, not the
// `hidden` attribute — an author display rule would beat that) for anyone not restricted.
// REJECTED (owner, 2026-08-07): the strip stays even when `my_tables` covers the whole floor plan
// (i.e. it reads "Your tables 1-30 · 30 tables"). Do not add a "hide it when it's everything" rule.
// See docs/REJECTED-IDEAS.md → R2.
function renderMySection() {
  const el = document.getElementById("mySection");
  if (!el) return;
  const my = mySection();
  // Nothing assigned → stay silent here: the big empty state where the tiles would be
  // already says it, in more words and more kindly. Two identical warnings stacked on a
  // 360px phone just eats the screen.
  if (my === null || !my.length) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "flex";
  el.innerHTML = `<span class="ms-key">Your tables</span><b>${esc(rangeText(my))}</b><span class="ms-n">${my.length} table${my.length === 1 ? "" : "s"}</span>`;
}
// tableLabel(t): the table's display name (mig 131) with the number kept alongside,
// else "Table t". Display-only — bills/KOTs/ids all keep the number.
const tname = (t) => (((state.data.settings || {}).table_names || {})[String(t)] || "").trim();
// T7, never "Table 7" (owner, 2026-08-05). A named table shows its name.
const tableLabel = (t) => { const n = tname(t); return n ? `${n} (T${t})` : `T${t}`; };
// Is table i OPEN (has a dining session / live orders)? Read from the summary tile state so it
// works for EVERY tile, not just the loaded one — "free" and "req" are the only not-open states.
function tileIsOpen(i) {
  // A MERGED TABLE IS NOT A FREE TABLE — the same rule the tiles already follow (mig 249). A
  // child's party and bill live on its parent, so its OWN summary row has no session and reads
  // "free". Reading that at face value made this function disagree with the tile beside it:
  // the Free filter listed a table drawn as "Preparing · ₹1,150 due", the Free/Active counts
  // were out by one per join, and KOT ▾ → Change table offered a joined table as a destination
  // the server then refused (mig 264). tileHtml() and the quick-order picker each worked around
  // it locally; the answer belongs here, once. (T4 sweep, 2026-08-04.)
  const s = summaryTile(mergeParentOf(i) || i).state;
  return s !== "free" && s !== "req";
}
// Can a party be moved ONTO table i? Open, and not itself joined to something else — a merged
// child can never be a destination (it has no bill of its own to join). Since tileIsOpen() now
// tells the truth about a joined table, the merge picker has to say this part explicitly.
const canHostAParty = (i) => tileIsOpen(i) && !mergeParentOf(i);
// ── "FREE" ON THE FLOOR IS NOT "FREE" AS A DESTINATION (sweep #8 T10, 2026-09-03) ─────────────
// A table with an OPEN session and nothing ordered on it is drawn as **Free**, and that is the
// owner's own decision (2026-07-31: a party with nothing ordered is an available table) —
// summaryTile() re-presents the RPC's `waiting` state as free at the source so the tiles, the
// Free/Active chips and tileIsOpen() cannot tell three different stories. Keep that.
//
// But it is the wrong answer for a DESTINATION. The session row is still there, so
// lfh_staff_shift_table's occupancy test (`status = 'open'`, mig 217) refuses it, and the waiter
// gets "That table is already taken — pick a free one" about a table the same screen just called
// free. Measured on the dev floor: five of the six on-plan tables were in that state, and every
// one of them was offered by the "Move this party" picker and refused by the server.
//
// The MANAGER panel has had the honest rule for a while and its helper's comment describes this
// exact fault — `tableHasAnyParty()` in public/panels/editor/app.js, which reads the RAW tile
// state rather than the re-presented one: *"the floor calls it free, but shifting another party
// onto it would land two sessions on one table. It is offered in neither list, which is the honest
// answer for a state the floor deliberately no longer shows."* This is that rule, on this panel.
//
// A "Wants in" table (`req`) is excluded for the manager's other reason: somebody has already
// asked to be seated there, so it is not ours to move a party onto.
function tableHasAnyParty(i) {
  const tile = (state.summary.tiles || {})[String(i)];      // RAW — never summaryTile()
  return !!tile && tile.state !== "free" && tile.state !== "req";
}
// Can this party be MOVED onto table i? Not itself, not a member of a merged party, no session row
// of any kind, and nobody waiting to be let in.
function canTakeAParty(i) {
  if (mergeParentOf(i) || mergeChildrenOf(i).length) return false;
  if (tableHasAnyParty(i)) return false;
  return !((state.summary.requests || []).some((r) => String(r.table_number) === String(i)))
      && !((state.summary.tiles || {})[String(i)] || {}).hasReq;
}
// Does this restaurant use dining sessions? OFF means there is no "Open table" step at all
// (Access → Menu → Dining sessions, owner 2026-07-31): the floor goes straight to taking an
// order, and the server attaches it without a session. The manager panel has always gated its
// Open button this way; the tablet did not, so a waiter could still open a table on a floor
// that has no session step — the two panels disagreed about the same restaurant.
const sessionsOn = () => !!(state.data.settings || {}).sessions_enabled;

// Tablet billing permission for an action (set by the manager in General settings):
// 'off' (hidden — default) | 'on' (waiter can do it) | 'pin' (needs a manager PIN).
const tperm = (k) => ((state.data.settings || {})[k] || "off");

// HIERARCHY X-RAY (Phase 3, 2026-07-06) — same rule as the manager panel: a billing
// capability that's OFF is HIDDEN from the real waiter, but the ADMIN act-as view
// sees the button TINTED amber and fully usable (the server's tabletPerm lets the
// admin through; higherView is admin-only for exactly that reason — an owner would
// get a button that 403s). tshow() replaces the raw !== "off" checks in the
// templates; txray() adds the tint class when it's off-for-waiters.
let TABLET_WHO = null;
const tHigher = () => !!(TABLET_WHO && TABLET_WHO.higherView);
// ACTUAL-VIEW mode (?view=real): whoami answered as the real waiter (higherView=false), so
// tshow/txray naturally hide what waiters don't have; simulated keeps the ribbon rendered.
const tSim = () => !!(TABLET_WHO && TABLET_WHO.simulated);
const tshow = (k) => tperm(k) !== "off" || tHigher();
const txray = (k) => (tperm(k) === "off" && tHigher() ? " xray-off" : "");
// Hover explanation for any greyed-out (off-for-waiters) control — set lazily so the
// templates don't need a title on every txray() usage (owner 2026-07-28).
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest && e.target.closest(".xray-off");
  // The invoice control is a DIFFERENT kind of "off": it is not a setting somebody switched, it is
  // the rule (owner, 2026-08-04 — a waiter never issues the invoice), so it says so rather than
  // implying there is a switch to find. Matched on the control's own id/data, not on its position.
  if (el && !el.title) {
    const isInvoice = !!(el.id && /invoice/i.test(el.id)) || !!(el.dataset && el.dataset.cap === "tablet_invoice") || /invoice/i.test(el.textContent || "");
    el.title = isInvoice
      ? "Only a manager issues the invoice — a waiter never can, on any restaurant. You can still use it from the admin view."
      : "Not available — this isn't enabled for this restaurant's waiters. You can still use it from the admin view.";
  }
});

// ── Special table types (VIP / Family / Owner's Guest) + khata — mig 166 ──────
// Mirrors the manager panel. The tile look is the APPROVED design
// (docs/superpowers/specs/2026-07-22-table-tags-mockup.html).
const TABLE_TAG_INFO = {
  vip:    { label: "VIP",           emoji: "👑", ribbon: "👑 VIP" },
  family: { label: "Family",        emoji: "🏠", ribbon: "FAMILY" },
  guest:  { label: "Owner's guest", emoji: "🤝", ribbon: "GUEST" },
};
// The feature ladder's application rung (settings, mig 166): admin's switch AND
// (the owner's toggle, only while the admin transferred control to them).
function tabletTagsOn() {
  // ADMIN X-RAY rule (owner 2026-07-22): the admin act-as view always sees module
  // buttons — txray() tints them when off for real waiters; the server lets the
  // admin through. Real waiters need the module effective.
  if (tHigher()) return true;
  const s = state.data.settings || {};
  return s.table_tags_allowed === true && (s.table_tags_owner_control !== true || s.table_tags_enabled !== false);
}
// Is PAY LATER (khata) switched on for this restaurant? Its OWN module ladder since the
// Access rebuild (mig 235) — it used to share table_tags_*, so the "📒 Pay Later" button
// kept appearing in the payment popup of a restaurant that has Pay later switched OFF, and
// the server (which reads the right column) refused the tap. Mirrors khataLadder() in
// lib/tableTags.ts. (owner, 2026-08-02)
function tabletKhataOn() {
  if (tHigher()) return true;
  const s = state.data.settings || {};
  return s.khata_allowed === true && (s.khata_owner_control !== true || s.khata_enabled !== false);
}
// This table's mark ('' when none) — the slim summary carries it for every tile.
function ttagOf(t) {
  // ADMIN X-RAY rule (owner 2026-07-23): the admin act-as view always shows the mark
  // regardless of the restaurant's feature toggle; real waiters see it only when on.
  if (!tHigher() && !tabletTagsOn()) return "";
  const tile = (state.summary.tiles || {})[String(t)];
  return (tile && tile.tag) || "";
}

// selectTable(t): open table t's DETAIL. The grid only had the slim summary, so we pull table t's
// FULL slice (orders/items/members/calls/…) before the detail can show real rows. Render once
// immediately for instant feedback (the panel shows what's cached — often a quick skeleton), then
// re-render after the slice lands. Mirrors the manager selecting a table. (owner 2026-06-27)
async function selectTable(t) {
  state.table = String(t);
  state.ordering = false; state.quick = false; state.cart = []; state.allergies = ""; state.dishSearch = "";
  // Also drop any ADD-TO-ORDER / view-order / per-order EDIT state — it belongs to the table we're
  // leaving. Without this, "＋ Add dish" then tapping another tile left addToOrderId pointing at the
  // OLD table's order, so dishes meant for the new table were appended to the old bill + kitchen
  // ticket (audit 2026-07-09). editOrders/viewOrder cleared for the same reason.
  if (voBackOff) { voBackOff(); voBackOff = null; }
  state.addToOrderId = null; state.viewOrder = false; state.editOrders.clear();
  renderFloor(); renderPanel();         // instant feedback (selected tile highlights; detail fills in next)
  // Stacked (phone/narrow) layout: the detail sits below the floor — jump to it.
  if (window.matchMedia("(max-width: 760px)").matches) {
    document.getElementById("panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  await ensurePartySlices(t);           // always a fresh pull — never trust up-to-60s-stale cached detail (M10);
                                        // a merged table needs its whole PARTY's slices, not just its own
  if (String(state.table) !== String(t)) return; // the waiter already moved on — don't clobber
  lastSig = boardSig(state);            // adopt as baseline so the next poll doesn't re-flicker the detail
  renderFloor();
  // …AND NOT WHILE A PICKER IS OPEN (#U1's rule, applied to the one place that was missing it —
  // T7 sweep #7, 2026-08-28). This repaint lands AFTER an awaited network read, and in that window
  // the waiter can already have opened 🧾 KOT ▾ and tapped a row: tap a table, tap KOT ▾, tap
  // "Change table" / "Merge" / "Move a KOT" / "Move a dish" / "Split the bill", and the screen you
  // just opened is wiped straight back to the table detail as the slice lands. On restaurant wifi
  // that read takes well over the time it takes to press two buttons, so it is not a narrow race.
  // Every other automatic repaint — load(), loadTables(), refreshWhoami(), the outbox event — has
  // carried `&& !state.pickerOpen` since #U1; selectTable was the one that never got it, because it
  // is the path a person triggers and nobody thought of it as automatic. The half of it that fires
  // BEFORE the await is deliberately left alone: at that moment no picker can be open yet, and it
  // is what gives the tap its instant feedback.
  if (!state.ordering && !state.pickerOpen) renderPanel();
}

// ── the floor ────────────────────────────────────────────────────────────────
// passesFilter(i): SHARED visibility predicate — does table i belong on the floor under the
// current filter? Used by BOTH the full render (renderFloor's loop) AND the incremental patch
// (patchTabletTiles), so the two paths agree on exactly which tiles exist. This is the tablet's
// one structural difference from the manager (the manager renders every table unconditionally):
// a breadcrumb can FLIP a table's filter membership (e.g. "needs" → attended), so the patch must
// detect that flip and full-render instead of redrawing a tile that should vanish. Under the
// default "all" filter this is always true, so patching collapses to the manager's behaviour.
function passesFilter(i) {
  // Waiter sections come FIRST: a table outside this waiter's section is never drawn,
  // whatever the chip filter says. Putting it in the SHARED predicate means the full
  // render and the incremental patch path can't disagree about it.
  if (!inMySection(i)) return false;
  const filt = state.floorFilter || "all";
  if (filt === "needs") return needsAttention(i);
  if (filt === "open") return tileIsOpen(i);
  if (filt === "free") return !tileIsOpen(i);
  return true; // "all"
}

// tileHtml(i): build the FULL outer HTML for ONE floor tile (table number i). This is the
// SINGLE source of truth for a tile's markup — BOTH the full-floor render (renderFloor's loop)
// AND the incremental patch (patchTabletTiles) call it, so a tile drawn either way is
// byte-identical (no path-divergent rendering). All the per-tile state/agg/badges/quick reads
// live here, exactly as they did inside the old renderFloor loop. Mirrors the manager's
// floorTileHtml. (owner perf 2026-06-27 — 300-table freeze fix)
// REJECTED (owner, 2026-08-07) — two things about this tile, both deliberate:
//  · R1 "I want free table to look empty only": a FREE tile is a number, a seat count and the word
//    Free in a big square, and the blank space is the design. Do not shorten it, do not fill it, do
//    not make free tiles denser than busy ones to fit more floor on screen.
//  · R4 "Don't do fix number four": the 💳 Mark-paid and ⏻ Close controls in the actions row measure
//    ~22-25px wide and that is ACCEPTED. The answer to a mis-tap is the confirm step each one already
//    has, not a bigger button. Do not widen them or re-balance the row for them.
// See docs/REJECTED-IDEAS.md → R1, R4.
function tileHtml(i) {
  // A MERGED TABLE IS NOT A FREE TABLE (mig 249; the manager floor got this on 2026-08-01,
  // the tablet never had it). A child's party lives on its parent, so its own summary tile
  // reads "free" — the lie this fixes. Every member of a party wears the PARTY's state and
  // numbers, plus a "⇄ with T…" chip naming the others; the server routes any action taken
  // at a child to the party's bill, so the tile must say that's what a tap will touch.
  const mergedTo = mergeParentOf(i);
  const partyMates = (mergedTo ? [mergedTo, ...mergeChildrenOf(mergedTo).filter((k) => String(k) !== String(i))] : mergeChildrenOf(i));
  const partyHead = mergedTo || i;
  const st = tileState(partyHead), a = tableAgg(partyHead), tile = summaryTile(partyHead);
  // The "⇄ with T…" mark rides in the TOP ROW, in the seat chip's place — it is NOT its own
  // row. A square tile at 12-per-row is ~87px tall and the extra row overflowed it: the
  // progress bar was sliced off flat on every merged tile (caught by the 2026-08-03
  // walkthrough's clipping measurement, which is why that check now runs on every tile).
  // The seat count moves into the title, where a merged table needs it least.
  // The ⇄ and the table list are separate spans on purpose: on a very dense floor the LIST
  // drops and the ⇄ stays, so a joined table can never read as a solo one (which is the
  // whole point of mig 249) — it just says less.
  const mergeChip = partyMates.length
    ? `<span class="tmerge" title="Served as one party with ${esc(partyMates.map((k) => "T" + k).join(" + "))} — one bill"><i class="tm-i">⇄</i><i class="tm-t">${esc(partyMates.map((k) => "T" + k).join(" "))}</i></span>`
    : "";
  // Badges/quick-action read the SUMMARY (works for every tile). The selected table's
  // tableAgg comes from its slice; the summary badge counts still match (same RPC mirror).
  // Badges stay THIS table's own (a waiter call at T7 belongs on T7's tile, merged or not).
  const ownTile = summaryTile(i);
  const calls = summaryCallsOf(i), joiners = ownTile.pending || 0, reqsN = ownTile.reqs || 0;
  // Three-way: red ring for an accepted-unpaid bill, green for accepted-paid, NOTHING for a
  // brand-new order (was a 2-way ternary that wrongly painted new orders green/"paid").
  const payCls = a.unpaid ? "pay-unpaid" : a.paid ? "pay-paid" : "";
  // ── MANAGER-STYLE SQUARE TILE (owner, 2026-08-03 — "redesign the tablet just like the
  // manager panel's table view"). Same rows as the manager's floorTileHtml:
  //   row 1  number + seats (or seated/seats when guests are in),
  //   row 2  badges (calls / requests / joiners — this table's own),
  //   row 3  a full-width progress LINE with "x/y served" above it (never a worded box),
  //   row 4  the actions: ＋ Take order (the biggest control), ✓ accept, 💳 pay.
  // Free tiles carry only the state word — and TAPPING a free tile goes straight into
  // taking an order for it (the manager rule; the send still confirms, so it stays 2-step).
  // Seats: this table's own number → the floor default → 4 (same order as the manager).
  const seatMap = (state.data.settings || {}).table_seats || {};
  const seats = Number(seatMap[String(i)]) > 0 ? Number(seatMap[String(i)])
    : Number(seatMap.default) > 0 ? Number(seatMap.default) : 4;
  const seatTxt = a.guests > 0 ? `${a.guests}/${seats}` : String(seats);
  const seatTip = a.guests > 0 ? `${a.guests} seated of ${seats} seats` : `${seats} seats`;
  const total = a.nw + a.ck + a.rd + a.sv;
  const strip = total > 0 ? `<div class="tstrip">${a.nw ? `<i style="width:${(a.nw / total) * 100}%;background:#f59e0b"></i>` : ""}${a.ck ? `<i style="width:${(a.ck / total) * 100}%;background:#4f9dff"></i>` : ""}${a.rd ? `<i style="width:${(a.rd / total) * 100}%;background:#ec4899"></i>` : ""}${a.sv ? `<i style="width:${(a.sv / total) * 100}%;background:#22c55e"></i>` : ""}</div>` : "";
  // The line's title keeps the words the tile no longer prints (state + KOT/meta), so a
  // long-press/hover still tells the whole story.
  const kotTip = a.kots.length ? `KOT #${a.kots[a.kots.length - 1]}${a.kots.length > 1 ? ` +${a.kots.length - 1}` : ""}` : (a.meta || "");
  const isFree = st.cls === "free" || st.cls === "req";
  const statusRow = total > 0
    ? `<div class="t-line" title="${esc(st.label)}${kotTip ? " · " + esc(kotTip) : ""}"><span class="t-linenum">${a.sv}/${total} served</span>${strip}</div>`
    : `<div class="t-line t-line-plain" title="${esc(st.label)}"><span class="t-linenum">${esc(st.label)}</span></div>`;
  // Actions: ＋ Take order on every occupied tile (a free tile IS the take-order button);
  // one-tap ✓ accept for a brand-new order; 💳 pay when the bill is served-unpaid. All
  // delegated on #tiles, so the patch path never re-binds anything.
  // A FINISHED table says so and WAITS: everything served AND the whole bill paid ("done").
  // Nothing ends a table by itself — a person decides when the guests have actually left.
  //
  // THE LOOK IS THE MANAGER'S, THE CONFIRM IS THE TABLET'S — and that is deliberate, not an
  // oversight (flagged in review, 2026-08-04). The manager's identical ⏻ is ONE TAP by the
  // owner's explicit word (2026-08-02: "close table should not have 2 step"), and its reasoning
  // is sound there: by the time the button exists nothing is at stake. The tablet asks anyway,
  // because his NEWER instruction (2026-08-03) named this panel and gave this reason: "if there
  // is a small click of close and all it could be a miss click… what we require is two step in
  // a important, like closing a table". On a 12-per-row waiter floor this control is ~22px in a
  // walking hand, which is exactly the mis-tap he described. Two of his rulings meet here; if he
  // wants one tap on the tablet too, change BOTH floors and the guard together.
  const finished = st.cls === "done" && !a.unpaid;
  const acts = isFree ? "" :
    (finished ? `<span class="tclose" role="button" data-quick="close" data-qt="${partyHead}" title="Everything served and the bill is paid — close ${esc(tableLabel(i))} and free it" aria-label="Close ${esc(tableLabel(i))}">⏻</span>` : "")
    + (tshow("tablet_take_orders") ? `<span class="t-take${txray("tablet_take_orders")}" role="button" data-quick="order" data-qt="${i}" title="Add another order for ${esc(tableLabel(i))}"><i class="t-take-x">＋</i><i class="t-take-t">Take order</i></span>` : "")
    + (a.nw > 0 ? `<span class="tacc" role="button" data-quick="accept" data-qt="${i}" title="Accept the new order">✓</span>` : "")
    + (st.cls === "bill" && tshow("tablet_mark_paid") ? `<span class="tpay${txray("tablet_mark_paid")}" role="button" data-quick="pay" data-qt="${partyHead}" title="Mark bill paid">💳</span>` : "");
  // Special table type (mig 166): a corner ribbon + pill badge layered OVER the state
  // look — strip/line/pay ring keep working, the tag is unmistakable on top.
  const ttag = ttagOf(i);
  const tinfo = TABLE_TAG_INFO[ttag];
  const numTxt = String(tname(i) || i);
  const numCls = numTxt.length >= 4 ? " tnum-xs" : numTxt.length >= 2 ? " tnum-sm" : "";
  return `<button class="tile t-${st.cls} ${payCls}${partyMates.length ? " t-merged" : ""}${tinfo ? ` t-tag tag-${ttag}` : ""} ${state.table === String(i) ? "sel" : ""}" data-t="${i}" title="${isFree ? "Tap to take an order" : "Tap to open this table"}">
      ${tinfo ? `<span class="t-ribbon" aria-hidden="true">${tinfo.ribbon}</span>` : ""}
      <span class="t-top"><span class="tnum${numCls}" ${tname(i) ? `title="T${i}"` : ""}>${esc(numTxt)}</span>${mergeChip || `<span class="tseats" title="${esc(seatTip)}">🪑${esc(seatTxt)}</span>`}</span>
      ${(calls.length || reqsN || joiners) ? `<span class="tbadges">${calls.length ? `<em class="b-call" title="${esc(calls.map((c) => c.note || "call").join(", "))}">${[...new Set(calls.map((c) => callIcon(c.note)))].join("")}</em>` : ""}${reqsN ? `<em class="b-req">📨${reqsN}</em>` : ""}${joiners ? `<em class="b-join">🙋${joiners}</em>` : ""}</span>` : ""}
      ${tinfo ? `<span class="t-tagbadge">${tinfo.emoji} ${esc(tinfo.label)}</span>` : ""}
      ${statusRow}
      ${acts ? `<span class="t-act">${acts}</span>` : ""}
    </button>`;
}

// floorNavHtml(): the ONE filter strip (All / Needs / Active / Free) above the floor, at
// every width — the old top-bar count chips were removed with the minimal top bar (owner,
// 2026-08-03: no live counters up there). Shared by the full render AND the patch so the
// counts refresh with byte-identical markup; buttons are delegated on the stable #floorNav.
function floorFilterCounts() {
  let cAll = 0, cNeeds = 0, cOpen = 0, cFree = 0;
  for (const i of floorTableList()) {    // what we DRAW, incl. occupied off-plan tables
    if (!inMySection(i)) continue;       // sections: count MY tables, not the restaurant's
    cAll++;
    if (needsAttention(i)) cNeeds++;
    if (tileIsOpen(i)) cOpen++; else cFree++;
  }
  return [["all", "All", cAll], ["needs", "⚠ Needs", cNeeds], ["open", "Active", cOpen], ["free", "Free", cFree]];
}
function floorNavHtml() {
  const filt = state.floorFilter || "all";
  return floorFilterCounts().map(([k, lbl, c]) =>
    `<button class="fnav ${filt === k ? "on" : ""}" data-filter="${k}">${lbl} <em>${c}</em></button>`).join("");
}

// floorPerRow(): how many tiles per row — the SAME admin-owned per-restaurant setting the
// manager floor reads (settings.floor_per_row, mig 226), so the two floors always match.
// The phone (<600px) ignores it via CSS and keeps readable auto-fill tiles instead.
// These MUST equal lib/floorLayout.ts, which the server, the admin picker and the manager floor
// all read — the whole point of the comment below is that the two floors agree. They didn't:
// this said MAX 30 / DEFAULT 6 against the canonical 12 / 12 (migration 265 spells out that 30
// is only the DB's outer bound and the screens offer 2..12), so a stored 18 would have drawn
// differently here than in the manager. A panel file can't import TS, so the values are
// restated — keep them in step, and prefer changing lib/floorLayout.ts first.
// REJECTED (owner, 2026-08-07): do NOT also restate lib/floorLayout.ts's TILE_MIN_PX (the 44px
// tappability floor) here. These three are the only numbers this panel mirrors. R6 in
// docs/REJECTED-IDEAS.md.
const FLOOR_PER_ROW_MIN = 2, FLOOR_PER_ROW_MAX = 12, FLOOR_PER_ROW_DEFAULT = 12;
// A FINGER NEEDS A BIGGER SQUARE THAN A MOUSE DOES (owner, 2026-08-05).
// The admin number is chosen for a desktop floor. Taken literally on a tablet it made the tiles
// SMALLER than the same panel gives a phone — measured 89px at 12-per-row on an iPad against 105px
// on a 360px phone, with 42% of the tablet screen left empty underneath. His instruction: "when it
// is horizontal at least four to five to six can be shown… if there is twelve, then six will be
// shown… it should look properly and able to click properly". (A tablet-specific number in the
// admin screen comes later; until then this cap is the rule.)
// So on a TOUCH device the count is capped at 6 — 12 becomes 6, 8 becomes 6 — and a restaurant that
// deliberately chose a small number keeps it (4 stays 4). A PC is untouched: a mouse reports
// `pointer: fine`, so `coarse` is what tells the two apart, exactly as the CSS does it.
//
// ⚠️ AND BELOW TABLET WIDTH THE SCREEN BANDS OVERRIDE ALL OF IT (owner, 2026-08-15): a phone draws
// 2 per row and a phone turned sideways draws 4, in CSS, whatever this function returns. The cap
// above is what decides a TABLET.
//
// THE MANAGER FLOOR NOW HAS THE SAME CAP (2026-08-16). It used to be this panel's alone, so the two
// floors showed different counts on the same iPad — 6 here, 12 there. That was never a decision,
// just an instruction applied to one panel; the manager's own copy quotes the same sentence of his
// and mirrors this function line for line.
const FLOOR_PER_ROW_TOUCH_MAX = 6;
function isTouchDevice() {
  try { return window.matchMedia("(pointer: coarse)").matches; } catch { return false; }
}
function floorPerRow() {
  const n = Math.round(Number((state.data.settings || {}).floor_per_row));
  const set = Number.isFinite(n) ? Math.min(Math.max(n, FLOOR_PER_ROW_MIN), FLOOR_PER_ROW_MAX) : FLOOR_PER_ROW_DEFAULT;
  return isTouchDevice() ? Math.min(set, FLOOR_PER_ROW_TOUCH_MAX) : set;
}

// Is a guest-facing feature on for this restaurant? Mirrors the manager's featureOn(): the
// settings row carries a `features` JSONB and anything unset is ON (lib/features.ts defaults
// every switch true except the backend-only four, none of which this panel asks about).
const tFeatureOn = (key) => {
  const f = (state.data.settings || {}).features || {};
  return typeof f[key] === "boolean" ? f[key] : true;
};

// The compact ONE-LINE legend (manager style, trimmed to the three words the owner kept:
// Free / Preparing / Served, plus the pay rings). Rendered by renderFloor so it tracks
// settings — a legend must only ever explain a colour this floor can actually show:
//   · PURPLE is listed only while something IS merged (same rule as the manager);
//   · 🔔 needs BOTH dining sessions AND the guest bell — with the bell switched off nobody
//     can ring, so explaining it would describe a colour that can never appear (the owner
//     had exactly this removed from the manager on 2026-08-01).
function floorLegendHtml() {
  // REJECTED (owner, said twice; recorded 2026-08-15 as docs/REJECTED-IDEAS.md R25): adding the
  // missing colours to this strip. A tile can turn AMBER (new order) or PINK (on the pass) with no
  // entry here, so the legend explains 3 of the 5 colours — that is deliberate, not an oversight.
  // The state word is still in every tile's tooltip and in the table's own detail popup. Do not
  // "complete" this array.
  const LEG = [["free", "Free"], ["prep", "Preparing"], ["bill", "Served"]];
  if (mergeList().length) LEG.push(["merged", "Merged"]);
  const bell = (sessionsOn() && tFeatureOn("waiter_calls")) ? `<span class="lgi"><i class="ldot ldot-call">🔔</i>called</span>` : "";
  return `<span class="lgcap">inside:</span>${LEG.map(([k, v]) => `<span class="lgi"><i class="ldot ldot-${k}"></i>${v}</span>`).join("")}${bell}<span class="lgcap">outline:</span><span class="lgi"><i class="lring lring-red"></i>unpaid</span><span class="lgi"><i class="lring lring-green"></i>paid</span>`;
}

// The persistent ⚡ Quick order button in the top bar — shown once settings confirm this
// waiter may take orders (admin x-ray view sees it tinted when it's off for real waiters).
function syncQuickOrderBtn() {
  const qb = document.getElementById("quickOrderBtn");
  if (!qb) return;
  const on = state.data.settings ? tshow("tablet_take_orders") : false;
  qb.hidden = !on;
  qb.style.display = on ? "" : "none";
  qb.classList.toggle("xray-off", on && tperm("tablet_take_orders") === "off" && tHigher());
}

// WHAT THE GUEST MENU IS WAITING FOR → the 🔔 in the top bar (owner, 2026-08-13).
//
// The waiter's half of the same readout the manager panel has; the sheet, the count and the
// hide-when-off rule are shared in public/panels/guestbell.js so the two can never drift.
// An ADAPTER, not a feature: every row is already in `state.summary`, which this panel polls and
// refreshes from the realtime breadcrumb — it makes no request of its own.
//
// ONE DIFFERENCE FROM THE MANAGER, AND IT IS DELIBERATE: a waiter with a SECTION sees only their
// own tables here. `floorTableList()` is the same list the floor draws, so the bell can never point
// at a table this person cannot open — which is exactly what tapping a row does.
function syncGuestBell() {
  if (!window.LFH_BELL) return;
  try {
    const s = state.data.settings || {};
    // Guest menu off for this restaurant → no bell at all. Not a zero, not a greyed button.
    if (s.menu_enabled === false) { window.LFH_BELL.sync({ menuOn: false, rows: [], onOpen: null }); return; }
    const at = (v) => { const t = v ? new Date(v).getTime() : 0; return Number.isFinite(t) ? t : 0; };
    const mine = new Set(floorTableList().map(String));
    const rows = [];
    for (const c of (state.summary.calls || [])) {
      if (!c || c.resolved) continue;
      const t = String(c.table_number || "").trim();
      if (!mine.has(t)) continue;
      rows.push({ kind: "call", table: t, text: c.note || "", at: at(c.created_at), id: c.id });
    }
    // Waiting-to-be-let-in and requests are COUNTS on this panel's tile, not rows (the waiter's
    // summary is the slim tier), so they are reported as a count rather than one line each.
    for (const t of mine) {
      const tile = summaryTile(t);
      if (!tile) continue;
      if (tile.hasNew) {
        const n = Number((tile.counts || {}).nw) || 1;
        rows.push({ kind: "order", table: t, text: n > 1 ? n + " waiting to be accepted" : "waiting to be accepted", at: 0, key: "order:" + t + ":" + n });
      }
      if (tile.pending) rows.push({ kind: "join", table: t, text: tile.pending === 1 ? "1 person" : tile.pending + " people", at: 0, key: "join:" + t + ":" + tile.pending });
      if (tile.reqs) rows.push({ kind: "request", table: t, text: tile.reqs === 1 ? "1 request" : tile.reqs + " requests", at: 0, key: "req:" + t + ":" + tile.reqs });
    }
    window.LFH_BELL.sync({ menuOn: true, rows, onOpen: (table) => { try { selectTable(table); } catch (e) {} } });
  } catch (e) {
    // The bell is a readout: it must never be able to stop the floor rendering. But a silent
    // catch is how a typo hides — this one swallowed a call to a function that does not exist
    // on this panel (`tableTileState`, which is the MANAGER's name for `summaryTile`), so the
    // bell simply never appeared and every check still reported 'no page errors'. Say it in
    // the console, once, so the next mistake is visible without being fatal.
    if (!syncGuestBell._warned) { syncGuestBell._warned = 1; console.warn('[guest bell] not shown:', e && e.message); }
  }
}

function renderFloor() {
  bindFloorDelegation(); // attach the ONE delegated tile/quick/chip handler (boolean-guarded)
  // DEFERRED ON PURPOSE. Both panels rebuild chunks of their own chrome during the render that
  // follows this call, and the waiter tablet's rebuild takes the top bar with it — so mounting
  // the bell first meant mounting it into markup that was about to be thrown away, and the
  // button simply never appeared (measured on the real tablet: the sheet worked, the button
  // did not exist). Running it after the current render settles costs one empty task and makes
  // the bell independent of what each panel happens to redraw.
  setTimeout(syncGuestBell, 0);
  const _t0 = performance.now();

  const navEl = document.getElementById("floorNav");
  if (navEl) navEl.innerHTML = floorNavHtml();
  const legEl = document.getElementById("floorLegend");
  if (legEl) legEl.innerHTML = floorLegendHtml();
  syncQuickOrderBtn();
  renderMySection();               // sections: "Your tables · 1-6" (no-op when unrestricted)

  const tilesGrid = document.getElementById("tiles");
  // --per-row-pc, not --per-row: the stylesheet's screen bands (phone 2 · sideways 4 · the set
  // number from 1024px, owner 2026-08-15) compute the effective --per-row from it. An inline
  // --per-row would beat those rules and the bands would silently do nothing.
  if (tilesGrid) tilesGrid.style.setProperty("--per-row-pc", String(floorPerRow()));

  let html = "";
  for (const i of floorTableList()) {       // floor plan + any occupied off-plan table
    if (!passesFilter(i)) continue;        // SHARED predicate — patch path agrees on visibility
    html += tileHtml(i);                   // SHARED tile builder — single source of truth
  }
  // Sections: an empty floor because NOTHING was assigned is a very different thing from
  // "your filter matched nothing" — say so plainly and point at the person who can fix it,
  // so a waiter who's handed a tablet at the start of a shift isn't staring at a blank grid
  // wondering if the app is broken.
  const emptyMsg = (sectioned() && !mySection().length)
    ? `<div class="sx-empty" style="padding:26px 16px;text-align:center;line-height:1.6">
         <div style="font-size:30px;margin-bottom:6px">🪑</div>
         <div style="font-weight:800;font-size:15px">No tables assigned to you yet</div>
         <div class="muted" style="font-size:13px;margin-top:4px">Ask your manager to give you a section — your tables will show up here straight away.</div>
       </div>`
    : `<div class="muted" style="padding:14px">No tables here right now.</div>`;
  $("#tiles").innerHTML = html || emptyMsg;
  window.__lfhPerf.fullRenders++;
  window.__lfhPerf.lastMs = performance.now() - _t0;
}

// patchTabletTiles(tables): the INCREMENTAL update path. Instead of rebuilding ALL ~300 tiles
// + re-binding ~300 listeners (the freeze at 300 tables), it replaces ONLY the named tiles'
// nodes via the shared tileHtml builder, then refreshes just the small filter-count strips in
// place. The #tiles grid is NEVER rebuilt wholesale, and the delegated click handler lives on
// the stable #tiles container, so replaced tile nodes need NO re-binding. Mirrors the manager's
// patchFloorTiles. Falls back to a full renderFloor() whenever a tile's FILTER membership flips
// (a tile that should appear/disappear can't be patched in place) or a named tile isn't on the
// grid — so we never leave a half-updated screen. (owner perf 2026-06-27)
function patchTabletTiles(tables) {
  const grid = $("#tiles");
  // No grid (panel not built yet) → safe full render.
  if (!grid) { renderFloor(); return; }
  const _t0 = performance.now();
  let patched = 0;
  for (const t of tables) {
    const el = grid.querySelector('.tile[data-t="' + String(t) + '"]');
    const visible = passesFilter(t);
    // Membership FLIP (was visible, now shouldn't be — or vice-versa): the grid's tile SET must
    // change, which a per-tile patch can't do. Full render is the only correct path. Under the
    // default "all" filter visible is always true, so this only ever trips with a filter active.
    if (visible !== !!el) { renderFloor(); return; }
    if (!visible) continue;                 // not on screen under this filter, and shouldn't be → skip
    el.outerHTML = tileHtml(t);             // SHARED builder → byte-identical to a full render's tile
    patched++;
  }
  // Filter-count strips can move on any change (e.g. a table flips to/from "needs") → refresh
  // their counts in place. Their buttons are delegated on #floorNav, so this is safe.
  const navEl = document.getElementById("floorNav");
  if (navEl) navEl.innerHTML = floorNavHtml();
  renderMySection();               // sections: "Your tables · 1-6" (no-op when unrestricted)
  window.__lfhPerf.patches++;
  window.__lfhPerf.tilesPatched += patched;
  window.__lfhPerf.lastMs = performance.now() - _t0;
}

// bindFloorDelegation: attach the floor's click handling ONCE on the stable containers
// (#tiles for tiles + quick buttons; #floorNav for the filter chips — both are
// static in index.html, only their innerHTML changes). Why delegation instead of per-tile
// onclick? At 300 tables the old renderFloor re-bound ~300 listeners on EVERY render; with one
// delegated handler, patched/replaced tile nodes need NO re-binding — the listener lives on the
// parent and finds the clicked target via .closest(). A boolean guard means repeated renders
// never stack duplicate listeners. Mirrors the manager's bindFloorDelegation.
let floorDelegationBound = false;
function bindFloorDelegation() {
  if (floorDelegationBound) return;
  floorDelegationBound = true;
  // Filter chips (the floor-nav row) — change the floor filter, then full render.
  const onChip = (e) => { const b = e.target.closest("[data-filter]"); if (b) { state.floorFilter = b.dataset.filter; renderFloor(); } };
  const navEl = document.getElementById("floorNav");
  if (navEl) navEl.addEventListener("click", onChip);
  // The tile grid — quick actions FIRST (nested inside the tile; matching one and returning
  // replicates the old stopPropagation so a quick button never ALSO selects the tile), then the
  // tile-select. Every data-attr handled here lives on a node the PATCH path may replace, which
  // is exactly why they MUST be delegated. The accept/pay branches inline their original
  // party-slice + filter logic verbatim (NOT flattened) so behaviour is unchanged.
  const tilesEl = $("#tiles");
  if (tilesEl) tilesEl.addEventListener("click", async (e) => {
    let q;
    // Quick "Accept" — load the table's orders first (grid has only the slim summary), then accept.
    if ((q = e.target.closest(".tacc[data-quick='accept']"))) {
      const qt = q.dataset.qt;
      await ensurePartySlices(qt);       // always fresh — the tile's summary can be fresh while the cached
                                         // slice is up to 60s stale, so a just-arrived order would be
                                         // missed and silently accept nothing (audit 2026-07-09).
                                         // Party-wide: a merged party accepts as ONE bill.
      optimisticAccept(partyOrders(qt).filter((o) => o.status === "received").map((o) => o.id));
      return;
    }
    // Quick "＋ Take order" — open this table's detail straight into the order builder,
    // exactly like the manager's on-tile ＋ Take order (the send still confirms — 2 steps).
    if ((q = e.target.closest(".t-take[data-quick='order']"))) {
      const t = q.dataset.qt;
      if (state.ordering && state.cart.length && String(t) !== String(state.table)) {
        if (!(await confirmDialog("Discard this unsent order and switch table?", "Yes, discard"))) return;
      }
      openOrderForTable(t);
      return;
    }
    // ⏻ on a FINISHED tile (everything served, bill paid) — closes it and frees the table,
    // through the one shared close path, whose confirm is the second step.
    if ((q = e.target.closest(".tclose[data-quick='close']"))) { await closeTableAndFree(q.dataset.qt); return; }
    // Quick "Mark paid" — same payment-method modal + whole-table pay as the detail panel,
    // without opening it.
    if ((q = e.target.closest(".tpay[data-quick='pay']"))) {
      const t = q.dataset.qt;
      await ensurePartySlices(t);       // always fresh rows, so billNo/due + optimisticPay reflect the
                                        // PARTY's real current bill, not an up-to-60s-stale slice.
      const a = tableAgg(t);
      await payBillWithMethod(t, a);
      return;
    }
    // TILE SELECT last — only reached when no quick button above matched.
    const tile = e.target.closest(".tile[data-t]");
    if (tile) {
      // On a wide tablet the floor stays clickable beside the order panel, so an accidental tile
      // tap while building a NEW order would silently wipe the whole cart. Confirm first (only when
      // there are unsent items and it's a DIFFERENT table). (audit 2026-07-09)
      if (state.ordering && state.cart.length && String(tile.dataset.t) !== String(state.table)) {
        if (!(await confirmDialog("Discard this unsent order and switch table?", "Yes, discard"))) return;
      }
      // A FREE tile goes STRAIGHT into taking an order (manager rule, owner 2026-07-31 /
      // 2026-08-03): there is no open/close step, so the detail of an empty table has
      // nothing to show — the order builder IS the action. A table with anything on it
      // (or a "wants in" request, or no take-orders permission) opens the detail popup.
      //
      // A MERGED TABLE IS NEVER "FREE", whatever its own summary row says. A child's party —
      // and its bill — live on the table it is joined to, so its own row has no session and
      // reads free: taking that at face value sent a tap on T7 into a brand-new order and
      // left the waiter no way to reach the party's bill, KOT ▾, ✕ Close or 💳 Mark paid.
      // That is the exact lie mig 249 exists to stop, so the state is read for the PARTY and
      // anything merged always opens the detail. (Found in review, 2026-08-03.)
      const t = tile.dataset.t;
      const inParty = !!mergeParentOf(t) || mergeChildrenOf(t).length > 0;
      const partyState = summaryTile(mergeParentOf(t) || t).state;
      if (!inParty && partyState === "free" && tshow("tablet_take_orders")) { openOrderForTable(t); return; }
      selectTable(t);
    }
  });
}

// openOrderForTable(t): select table t and land directly in the order builder — the
// one-tap path used by a FREE tile and the on-tile ＋ Take order button. selectTable
// resets ordering state, so re-enter order mode after it kicks off (it renders the
// detail first; this immediately replaces it with the builder — no visible flash,
// both happen in the same task before the browser paints).
function openOrderForTable(t) {
  selectTable(t); // async slice fetch continues in the background
  state.ordering = true; state.viewOrder = false; state.quick = false; state.cart = [];
  state.allergies = ""; state.cat = ""; state.dishSearch = ""; state._omTop = 0;
  renderPanel();
}

// openDishEditModal: ONE editor for a single placed dish — toggle which allergens
// to AVOID (the 6 standard ones PLUS any custom typed in the box) and write a
// kitchen note. IDENTICAL to the manager panel's modal, adapted to the tablet's
// state (state.data.items) + /api/tablet endpoints. Save persists in one go:
//   • adding an allergen → this dish's own list (order_items.removed)
//   • removing one → cleared from the dish AND the order-wide "avoid" list
//   • the note → order_items.note
function openDishEditModal(itemId) {
  document.querySelector(".dish-edit-overlay")?.remove();
  const item = (state.data.items || []).find((i) => i.id === itemId);
  if (!item) { toast("That dish is no longer on the order.", false); return; }
  const order = (state.data.orders || []).find((o) => o.id === item.order_id) || {};
  // Normalise: lowercase, trim, strip a leading "no " so "no water"/"water" both store "water".
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/^no[\s-]+/, "");
  const itemRemoved = (Array.isArray(item.removed) ? item.removed : []).map(norm).filter(Boolean);
  const orderAllergies = (Array.isArray(order.allergies) ? order.allergies : []).map(norm).filter(Boolean);
  const initial = new Set([...itemRemoved, ...orderAllergies]); // what the dish avoids now
  const working = new Set(initial);                             // live working copy until Save
  // #4: which of these are ORDER-WIDE avoids (apply to every dish), so we can tag them and
  // warn before one is turned off (removing it here clears it from the whole order, not just
  // this dish). Prevents a waiter silently stripping an allergy warning off the other dishes.
  const orderWide = new Set(orderAllergies);
  const STD = ALLERGENS.map((a) => a.slug);
  const labelFor = (slug) => { const a = ALLERGENS.find((x) => x.slug === slug); return a ? a.label : "🚫 " + slug; };
  const owTag = (slug) => orderWide.has(slug) ? ` <sup class="alg-ow" title="Set for the whole order — removing it affects every dish">all</sup>` : "";
  const chipsHtml = () => {
    const std = ALLERGENS.map((a) => `<span class="chip talg ${working.has(a.slug) ? "on" : ""}" data-slug="${esc(a.slug)}">${esc(a.label)}${owTag(a.slug)}</span>`).join("");
    // Custom allergens are their own chips — tap one to REMOVE it (same as a standard chip).
    const cust = [...working].filter((s) => !STD.includes(s)).map((s) => `<span class="chip talg on" data-slug="${esc(s)}">${esc(labelFor(s))}${owTag(s)}</span>`).join("");
    // ＋ Other instead of a text box always sitting there (owner, 2026-08-04: "I don't want
    // an allergy box, I want an Other option in the listed allergies").
    return std + cust + `<span class="chip talg alg-other" data-alg-other="1" title="Type an allergy that isn't listed">＋ Other</span>`;
  };
  const ov = document.createElement("div");
  ov.className = "dish-edit-overlay";
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "var(--scrim)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  ov.innerHTML = `<div class="dish-edit-box" style="width:min(94vw,460px);max-height:90vh;overflow:auto;background:var(--panel);color:var(--text);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
    <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line)"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">Edit dish · ${esc(item.title)}</h3><button class="dish-edit-close" aria-label="Close" style="background:var(--panel-2);border:0;color:var(--text);border-radius:8px;padding:6px 10px;cursor:pointer">✕</button></div>
    <div style="padding:16px 18px">
      ${item.status === "served" ? `<div class="muted" style="font-size:13px;line-height:1.5;margin:0 0 12px;padding:9px 11px;border:1px solid var(--line);border-radius:9px">This dish is already <b style="color:#4ade80">served</b> — allergens &amp; note are locked now. If it went out by mistake, use <b>↩ Send back to kitchen</b> below.</div>` : ""}
      <div style="font-size:13px;font-weight:700;margin:0 0 8px">⚠ Allergies to avoid <span class="muted small">— tap to add or remove</span></div>
      <div class="dish-alg-list" style="display:flex;flex-wrap:wrap;gap:8px"></div>
      <div style="font-size:13px;font-weight:700;margin:15px 0 6px">✎ Note for the kitchen</div>
      <textarea class="dish-edit-note" rows="2" maxlength="200" placeholder="e.g. less ice, extra chocolate" style="width:100%;box-sizing:border-box;padding:9px 11px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;resize:vertical"></textarea>
    </div>
    <div style="display:flex;gap:10px;align-items:center;padding:14px 18px;border-top:1px solid var(--line)">${(item.status === "served") ? `<button class="btn dish-edit-unserve" style="margin-right:auto;border-color:#7f5f1d;color:#f0b232" title="Mark this dish not-served so the kitchen can remake/re-serve it">↩ Send back to kitchen</button>` : ""}<button class="btn dish-edit-cancel"${(item.status === "served") ? "" : ' style="margin-left:auto"'}>Cancel</button>${(item.status === "served") ? `<button class="btn primary dish-edit-save" disabled title="Already served — allergens & note are locked; use Send back to kitchen">Save</button>` : `<button class="btn primary dish-edit-save">Save</button>`}</div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector(".dish-edit-note").value = item.note || "";
  const listEl = ov.querySelector(".dish-alg-list");
  const bindChips = () => {
    listEl.querySelectorAll("[data-slug]").forEach((c) => (c.onclick = async () => {
      const s = c.dataset.slug;
      if (working.has(s)) {
        // #4: turning OFF an order-wide avoid clears it from EVERY dish — confirm first.
        if (orderWide.has(s) && !(await confirmDialog(`"${s}" is set for the WHOLE order. Removing it here takes it off EVERY dish on this order, not just this one. Remove it from all?`, "Remove from all"))) return;
        working.delete(s);
      } else working.add(s);
      redraw();
    }));
    // ＋ Other → type an allergy the six don't cover; it joins the row as its own chip.
    const other = listEl.querySelector("[data-alg-other]");
    if (other) other.onclick = async () => { const v = await allergyPrompt(working); if (v) { working.add(v); redraw(); } };
  };
  const redraw = () => { listEl.innerHTML = chipsHtml(); bindChips(); };
  redraw();
  let backOff = window.LFH_BACK ? LFH_BACK.layer("tablet-dish-edit", () => close()) : null;
  const close = () => { if (backOff) { backOff(); backOff = null; } ov.remove(); };
  ov.querySelector(".dish-edit-close").onclick = close;
  ov.querySelector(".dish-edit-cancel").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  // #3: the intentional, discoverable way to un-serve a dish — sends it back to "preparing"
  // so the kitchen can remake / re-serve it. Replaces the old reverse-tap on the status pill.
  const unserveBtn = ov.querySelector(".dish-edit-unserve");
  if (unserveBtn) unserveBtn.onclick = async () => {
    if (!(await confirmDialog(`Send "${item.title}" back to the kitchen? It'll show as "preparing" again so the kitchen can remake or re-serve it.`, "Send back"))) return;
    close();
    advanceDish(itemId, "served", "preparing");
  };
  const same = (a, b) => JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());
  ov.querySelector(".dish-edit-save").onclick = async () => {
    const note = ov.querySelector(".dish-edit-note").value.trim();
    const removed = [...initial].filter((s) => !working.has(s));  // cleared → drop everywhere
    const added = [...working].filter((s) => !initial.has(s));    // new avoids → this dish only
    const newItemRemoved = [...new Set([...itemRemoved.filter((s) => !removed.includes(s)), ...added])];
    const newOrderAllergies = orderAllergies.filter((s) => !removed.includes(s));
    try {
      // Each save carries the value this modal OPENED with. If another device changed the
      // same thing while it was open, the server refuses and says what it holds now, instead
      // of one waiter's "more spicy" silently wiping another's "less spicy".
      if (note !== String(item.note || "").trim()) {
        await api("POST", `/items/${item.id}/note`, { note }, { expect: { table: "order_items", id: item.id, fields: { note: String(item.note || "") } } });
      }
      if (!same(newItemRemoved, itemRemoved)) {
        await api("POST", `/items/${item.id}/removed`, { removed: newItemRemoved }, { expect: { table: "order_items", id: item.id, fields: { removed: itemRemoved } } });
      }
      if (order.id && !same(newOrderAllergies, orderAllergies)) {
        await api("POST", `/orders/${order.id}/allergies`, { allergies: newOrderAllergies }, { expect: { table: "orders", id: order.id, fields: { allergies: orderAllergies } } });
      }
      close();
      await load(); if (!state.ordering) renderPanel();
      toast("Dish updated");
    } catch (e) {
      // SOMEONE ELSE GOT THERE FIRST. Not an error to shrug at: close the modal, show what it
      // says now, and refresh — so this person sees the truth rather than their lost edit.
      const clash = e && e.data && e.data.clash;
      if (clash) {
        close();
        await load(); if (!state.ordering) renderPanel();
        toast(clash.plain + " " + clash.todo, false, 9000);
        return;
      }
      toast("Couldn't save: " + errText(e), false);
    }
  };
}

// ── the table detail panel (view mode) ───────────────────────────────────────
let lastPanelTable = null;   // #U2: which table the current .detail-pop belongs to (for scroll restore)
function renderPanel() {
  const p = $("#panel");
  // #U1: if a Move picker is open and some path forced a full renderPanel, tear its back layer
  // down first so it can't orphan into a dead Back press. (Normal picker close already did this.)
  if (state.pickerOpen && activePickerDrop) activePickerDrop();
  // #U2: preserve the detail popup's scroll across a live-update rebuild — only when it's the
  // SAME table still open (switching tables should start at the top). Restored after innerHTML.
  const existingPop = p.querySelector(".detail-pop");
  const prevScrollTop = (existingPop && lastPanelTable != null && String(lastPanelTable) === String(state.table)) ? existingPop.scrollTop : 0;
  const restoreScroll = () => { if (prevScrollTop) { const np = p.querySelector(".detail-pop"); if (np) np.scrollTop = prevScrollTop; } lastPanelTable = state.table; };
  // #10: a picker (renderPickerShell) sets p.onclick to a "go back" handler; if we don't
  // clear it here, that handler LEAKS onto the rebuilt detail — so after using "Move an
  // order" a stray tap on the dim margin re-opened the picker. Reset it every rebuild; the
  // detail branches below re-assign a proper backdrop-close.
  p.onclick = null;
  p.classList.remove("has-detail");
  // Not ordering → make sure the order-mode takeover + its back-stack layer are gone,
  // whatever path ended the ordering (send, ← back, ✓ Done, hardware back, drawer close).
  if (!state.ordering) {
    document.body.classList.remove("om-mode");
    p.classList.remove("om-open");
    const off = omBackOff; omBackOff = null; if (off) off();
  }
  if (!state.table && !state.quick) { p.innerHTML = `<div class="empty">Tap a table to see it — or to take an order for it.</div>`; return; }
  if (state.ordering) { renderOrderMode(); return; }
  const t = state.table, s = sessionOf(t), a = tableAgg(t);

  // WAITING TO SEND: anything taken for this table on this device that hasn't reached
  // the kitchen yet (offline, or still syncing). It is shown as its OWN block, clearly
  // marked and deliberately NOT mixed into the order cards or the bill total — a bill
  // must only ever show what the kitchen really has. Without this a waiter who took an
  // order with no internet saw "No orders yet" and re-took it. (offline sync 2026-07-30)
  const unsentCount = (window.LFH_OUTBOX && window.LFH_OUTBOX.pendingForTable) ? window.LFH_OUTBOX.pendingForTable(t).length : 0;
  const unsentMeta = unsentCount ? ` · <span style="color:#d97706;font-weight:800">${unsentCount} waiting to send</span>` : "";
  const unsentBox = (() => {
    const pend = (window.LFH_OUTBOX && window.LFH_OUTBOX.pendingForTable) ? window.LFH_OUTBOX.pendingForTable(t) : [];
    if (!pend.length) return "";
    const dishTitle = (id) => {
      const d = (state.data.dishes || []).find((x) => String(x.id) === String(id));
      return d ? d.title : "Dish";
    };
    const rows = pend.map((it) => {
      const items = (it.body && Array.isArray(it.body.items)) ? it.body.items : null;
      const what = items && items.length
        ? items.map((l) => `${l.qty > 1 ? l.qty + "× " : ""}${esc(dishTitle(l.id))}`).join(", ")
        : esc(it.label || "Change");
      const why = it.status === "failed"
        ? `<span style="color:#b91c1c;font-weight:700">needs you — ${esc(it.plain || it.error || "couldn't be sent")}</span>`
        : (navigator.onLine === false ? "saved here · will send when you're back online" : "sending…");
      return `<div class="row" style="align-items:flex-start"><span style="flex:1"><b>${what}</b><br><span class="muted small">${why}</span></span></div>`;
    }).join("");
    const bad = pend.some((it) => it.status === "failed");
    return `<div class="sec" style="margin:0 0 10px;padding:10px 12px;border-radius:12px;border:1px dashed ${bad ? "#ef4444" : "#f59e0b"};background:${bad ? "rgba(239,68,68,.09)" : "rgba(245,158,11,.09)"}">
      <h3 style="margin:0 0 6px;font-size:13px">${bad ? "⚠️ Needs you" : "⏳ Waiting to send"} (${pend.length})</h3>${rows}
      <div class="muted small" style="margin-top:6px">Not on the bill until the kitchen has it.</div>
    </div>`;
  })();

  // ── INSTANT RENDER (stale-while-revalidate): before this table's full slice lands, paint an
  // accurate summary-driven detail (open state, guests, dish count, due — all from tableAgg,
  // which already reads the summary for a non-loaded tile) instead of the old "closed / no
  // orders" that showed for 3-4s. The dish rows + party + full actions stream in the instant the
  // slice arrives (selectTable re-renders). Only for an OCCUPIED table whose slice isn't in yet.
  if (!sliceLoaded(t) && tileIsOpen(t)) {
    const dishN = a.nw + a.ck + a.rd + a.sv;
    // The loading state should look like the REAL detail, not a bare spinner line (owner,
    // 2026-07-03 — "add a loading thing… it should look very great"). So: the summary's
    // status pills (same classes/wording as the grid tile — real counts on the first paint)
    // + an order-card skeleton whose shimmer rows match the dish-row layout, so the real
    // rows land in place with no jump. Falls back to the plain line when there are no dishes.
    const pills = dishN ? `<div class="tpills" style="margin:0 0 10px">${a.nw ? `<span class="tpill nw">${a.nw} new</span>` : ""}${a.ck ? `<span class="tpill ck">${a.ck} cooking</span>` : ""}${a.rd ? `<span class="tpill rd">${a.rd} ready</span>` : ""}${a.sv ? `<span class="tpill sv">${a.sv} served</span>` : ""}</div>` : "";
    const skelRow = (w) => `<div class="iline skelrow"><span class="skel skel-qty"></span><span class="skel skel-name" style="width:${w}%"></span><span class="skel skel-pill"></span></div>`;
    // NOT `load` — that is the name of this file's module-level refresh function, and a local
    // const was SHADOWING it inside this branch (T4 sweep, 2026-08-04). Nothing here called it, so
    // there was no bug; but the next person to add `await load()` to this branch would have awaited
    // a string (or hit a TDZ error above the declaration) and the failure would have been silent.
    const loadHtml = dishN
      ? `<div class="ord"><div class="ordh"><span class="left"><span class="skel skel-kot"></span><span class="when" style="display:flex;align-items:center;gap:7px"><span class="tsl-dot"></span> sending…</span></span></div>${[52, 38, 61, 45].slice(0, Math.min(4, dishN)).map(skelRow).join("")}</div>`
      : `<div class="muted" style="display:flex;align-items:center;gap:8px;padding:6px 0"><span class="tsl-dot"></span> Loading order details…</div>`;
    const payCls = a.unpaid ? "unpaid" : a.paid ? "paid" : "";
    const billBox = (a.due > 0 || dishN) ? `<div class="foot"><div class="billbox ${payCls}"><span class="bn">bill</span>${a.due > 0 ? `<span class="due">${inr(a.due)} due</span>` : ""}<span class="pay">${a.unpaid ? "● UNPAID" : a.paid ? "paid ✓" : "● new"}</span></div></div>` : "";
    p.classList.add("has-detail");
    // Wrap the LOADING state in the SAME .detail-pop popup as the real detail, so tapping
    // a table shows the centered popup from the first frame — no side-panel flash before it
    // (owner 2026-07-05: "no trace it was ever a side-edge panel").
    p.innerHTML = `
     <div class="detail-pop">
      <button class="detail-x" id="detailClose" type="button" aria-label="Close">✕</button>
      <div class="phead">
        <div style="flex:1"><h2 style="margin:0;font-size:19px">${esc(tableLabel(t))}</h2><div class="pmeta">${a.guests ? `${a.guests} guest${a.guests > 1 ? "s" : ""} · ` : ""}${dishN ? `${dishN} dish${dishN === 1 ? "" : "es"}` : "opening…"} · <span class="live">● open</span></div></div>
      </div>
      <div class="detail-body">
        <div class="sec"><h3>Orders</h3>${unsentBox}${pills}${loadHtml}</div>
      </div>
      <div class="dacts">
        ${tshow("tablet_take_orders") ? `<button class="btn primary big${txray("tablet_take_orders")}" id="takeOrder">＋ Take order</button>` : ""}
      </div>
      ${billBox}
     </div>`;
    { const dc = $("#detailClose"); if (dc) dc.onclick = () => { state.table = null; renderPanel(); renderFloor(); }; }
    // #10: tap the dimmed area around the card to close, like every other tablet popup.
    p.onclick = (e) => { if (e.target === p) { state.table = null; renderPanel(); renderFloor(); } };
    { const tob = $("#takeOrder"); if (tob) tob.onclick = () => { state.ordering = true; state.viewOrder = false; state.cart = []; state.allergies = ""; state.cat = ""; state.dishSearch = ""; state._omTop = 0; renderPanel(); }; }
    restoreScroll();   // #U2: keep the popup scroll across a live-update rebuild (same table)
    return;
  }

  // renderPanel only ever draws the SELECTED table, whose full slice is loaded — so read its
  // orders straight from the slice (tableAgg no longer carries `os`, which would be empty for an
  // unselected table anyway). calls/joiners/members/reqs likewise come from the loaded slice.
  // The WHOLE party's orders, whichever member table is open — one bill, one list (mig 249).
  const os = partyOrders(t), calls = callsOf(t), joiners = joinersOf(t), members = s ? membersOf(t) : [], reqs = reqsOf(t);
  // Invoice generation (tablet_invoice setting) is independent of Mark bill paid — a
  // waiter can invoice before or after payment. `s` comes straight from `select("*")`
  // on sessions, so invoice_no/invoice_voided are already on it, same as the manager reads.
  const invoiced = !!(s && s.invoice_no != null && !s.invoice_voided);

  const reqRows = reqs.map((r) => `<div class="row"><span>📨 ${r.type === "open" ? "Asked to open" : "Asked for access"}${r.name ? ` · ${esc(r.name)}` : ""}</span><span class="reqbtns"><button class="btn small primary" data-req-approve="${esc(r.id)}">Approve</button><button class="btn small" data-req-deny="${esc(r.id)}">Deny</button></span></div>`).join("");
  const joinRows = joiners.map((m) => `<div class="row"><span>🙋 ${esc(m.name || "Guest")} wants to join</span><button class="btn small primary" data-approve="${esc(m.id)}">Approve</button></div>`).join("");
  const partyRows = members.map((m) => `<div class="row"><span>${m.role === "owner" ? "👑" : "•"} ${esc(m.name || "Guest")}${m.approved ? "" : ` <span class="muted">(waiting to join)</span>`}</span>${m.role === "owner" ? `<span class="muted small">head</span>` : `<span class="reqbtns"><button class="btn small" data-makehead="${esc(m.id)}">Make head</button><button class="btn small" data-kick="${esc(m.id)}">Remove</button><button class="btn small danger" data-ban="${esc(m.id)}">Ban</button></span>`}</div>`).join("");
  // Each order is a card: KOT chip, time, "via app" badge for guest/phone orders,
  // every dish with a tappable status pill, and an Accept button when it's new.
  // One dish row: qty · name · price · status badge · Serve button, with per-item
  // allergens (the order-wide "avoid in all" distributed onto each item; no banner).
  // WHICH TABLE WAS THIS ORDERED AT? Only ever asked on a MERGED bill (owner, 2026-08-17: "keep a
  // track [of which] table has ordered which, but everything is merged … so at the time when we
  // split the KOT, the item all [goes back] when it is done by mistake").
  //
  // The number is not new and is not a guess: an order keeps the table it was rung at even while the
  // party is joined — that is precisely what makes a split exact (mig 249), and it is what the
  // unmerge confirm and the server both work from. It simply was not on screen, so a waiter looking
  // at "T26 + T27" saw one list of dishes with no way to tell whose was whose. On a table that is
  // NOT merged the chip never renders, so an ordinary bill is untouched.
  const partySpread = partyTablesOf(t).length > 1;
  const fromChip = (o) => (partySpread && o && o.table_number != null)
    ? `<span class="ifrom" title="Ordered at ${esc(tableLabel(o.table_number))} — it goes back there if the tables are split">${esc(tableLabel(o.table_number))}</span>`
    : "";
  const dishRowHtml = (r, o) => {
    const opt = (r.options && r.options.length) ? `<div class="iopt">${esc(r.options.map((x) => x.label || x).join(" · "))}</div>` : "";
    const orderAllergies = Array.isArray(o.allergies) ? o.allergies : [];
    const lineRem = [...new Set([...(Array.isArray(r.removed) ? r.removed : []), ...orderAllergies])];
    // A staff-ADDED allergen carries a green "＋"; a removed one flags "✎−" on the name.
    const addedSet = new Set((Array.isArray(r.added_allergens) ? r.added_allergens : []).map((x) => String(x).toLowerCase()));
    const rem = lineRem.length ? `<div class="irem">no ${lineRem.map((x) => `${esc(String(x))}${addedSet.has(String(x).toLowerCase()) ? `<sup class="alg-add" title="Added after the order was placed">＋</sup>` : ""}`).join(", ")}</div>` : "";
    const remMark = r.removed_flag ? ` <span class="alg-removed" title="An allergen was removed after the order was placed">✎−</span>` : "";
    const note = r.note ? `<div class="iopt">“${esc(r.note)}”</div>` : "";
    // "MRP" next to the price so the waiter can SEE the price is final BEFORE they try to
    // discount it — the refusal in the discount modal is the backstop, not the explanation.
    const mrpTag = r.is_mrp ? `<span class="mrp-tag" title="Maximum Retail Price — final, no tax added and no discount allowed">MRP</span>` : "";
    const priceTag = r.price > 0 ? `<span class="iprice">${mrpTag}${inr(r.price * r.qty)}</span>` : mrpTag;
    // The status pill is TAPPABLE for real saved dishes that are between 'received' and
    // 'served' — one FORWARD tap advances it (preparing→served / ready→served). A 'served'
    // dish is NOT tappable (#3): reverse-tapping used to silently un-serve on a mis-tap; the
    // intentional undo now lives as "↩ Send back to kitchen" in the dish edit modal.
    // 'received' dishes stay a plain badge so they go through the order-level Accept flow.
    const statusBadge = (r.fromDb && r.status !== "received" && r.status !== "served")
      ? `<span class="ist tap ${r.status}" data-item="${esc(r.id)}" data-cur="${esc(r.status)}" title="Tap to mark served">${STATUS_WORD[r.status] || r.status}</span>`
      : `<span class="ist ${r.status}">${STATUS_WORD[r.status] || r.status}</span>`;
    const serveBtn = (r.fromDb && (r.status === "preparing" || r.status === "ready"))
      ? `<button class="ist-serve" data-serve="${esc(r.id)}" data-cur="${esc(r.status)}">✓ Serve</button>` : "";
    // Per-dish delete (only for real saved dishes, not served): removes the dish and
    // re-prices the bill server-side. (owner, 2026-06-16)
    const delBtn = (r.fromDb && r.status !== "served")
      ? `<button class="idel" data-del-item="${esc(r.id)}" title="Remove this dish">🗑</button>` : "";
    // STAFF EDIT mode (gated by the kitchen-confirm): quantity steppers + a single
    // "✎ Edit" button that opens ONE modal (allergens + kitchen note) — IDENTICAL to
    // the manager panel. (owner, 2026-06-18)
    const editing = state.editOrders.has(o.id);
    // No editing once a dish is READY or SERVED — it's cooked/out, changing it is too
    // late (mirror the manager; place a new order instead). (owner, 2026-06-18)
    // Still cooking (received/preparing) → fully editable: qty steppers + the ✎ Edit modal.
    // SERVED → qty is locked, but it MUST still reach the ✎ Edit modal, because that's the
    // ONLY place with "↩ Send back to kitchen" — without this, a mis-served dish was stuck
    // served forever and the whole order had to be deleted to recover it (audit 2026-07-08).
    // 'ready' stays hands-off (serve it, or place a new order).
    const editCtl = !(editing && r.fromDb) ? ""
      : r.status === "served"
        ? `<span class="iedit"><button class="qbtn" data-edit-dish="${esc(r.id)}" title="Edit or send this dish back to the kitchen">✎ Edit</button></span>`
      : r.status !== "ready"
        ? `<span class="iedit"><button class="qbtn" data-qty-dec="${esc(r.id)}" title="Fewer">−</button><button class="qbtn" data-qty-inc="${esc(r.id)}" title="More">＋</button><button class="qbtn" data-edit-dish="${esc(r.id)}" title="Edit allergens & note for this dish">✎ Edit</button></span>`
      : "";
    // The trailing status/serve/edit/delete cluster is ONE .iacts container so narrow
    // phones can wrap it to its own right-aligned second row (the name + price keep the
    // first row) instead of crushing the dish name to a sliver (A36 audit 2026-07-20).
    return `<div class="iline${editing ? " editing" : ""}"><span class="iqty">${r.qty}×</span><span class="inm">${esc(r.title)}${remMark}${fromChip(o)}${opt}${rem}${note}</span>${priceTag}<span class="iacts">${statusBadge}${serveBtn}${editCtl}${delBtn}</span></div>`;
  };
  // Per-order staff controls. NOT editing: an "✎ Edit" button (opens the gated edit
  // mode) + Delete order. EDITING: allergen toggle chips ("avoid in all dishes"),
  // an "＋ Add dish" button, Delete order, and "✓ Done editing". The dish rows show
  // qty steppers + a note edit while editing. (owner, 2026-06-17)
  const orderControlsHtml = (o) => {
    if (!state.editOrders.has(o.id)) {
      return `<div class="ordctl">
        <button class="btn small" data-edit-order="${esc(o.id)}">✎ Edit</button>
        <button class="btn small danger" data-del-order="${esc(o.id)}">🗑 Delete order${o.kot_no != null ? ` #${esc(o.kot_no)}` : ""}</button>
      </div>`;
    }
    // Order-wide allergen chips: the 6 standard toggles, any TYPED ones already set, and
    // ＋ Other to add a new one right here — EXACTLY like the manager's per-order chips.
    // (A typed allergy used to be per-dish only, via the "✎ Edit" modal; owner 2026-08-04
    // asked for Other on every allergy list, so this row grew one too.)
    const aSet = new Set((Array.isArray(o.allergies) ? o.allergies : []).map((x) => String(x).toLowerCase()));
    const chips = ALLERGENS.map((a) => `<span class="chip talg ${aSet.has(a.slug) ? "on" : ""}" data-alg="${esc(o.id)}" data-slug="${a.slug}">${esc(a.label)}</span>`).join("")
      + [...aSet].filter((x) => !ALG_STD.includes(x)).map((x) => `<span class="chip talg on" data-alg="${esc(o.id)}" data-slug="${esc(x)}">${esc(algLabel(x))}</span>`).join("")
      + `<span class="chip talg alg-other" data-alg="${esc(o.id)}" data-alg-other="1" title="Type an allergy that isn't listed">＋ Other</span>`;
    return `<div class="ordctl ordctl-edit">
      <div class="ordctl-alg"><span class="muted small">⚠ Avoid (all dishes):</span>${chips}</div>
      <div class="ordctl-row">
        <button class="btn small" data-add-dish="${esc(o.id)}">＋ Add dish</button>
        ${tshow("tablet_discount") && !(Number(s && s.discount) > 0) ? `<button class="btn small${txray("tablet_discount")}" data-discount="${esc(o.id)}">− Discount${Number(o.discount) > 0 ? ` (${inr(o.discount)})` : ""}</button>` : ""}
        <button class="btn small danger" data-del-order="${esc(o.id)}">🗑 Delete order${o.kot_no != null ? ` #${esc(o.kot_no)}` : ""}</button>
        <button class="btn small primary" data-done-order="${esc(o.id)}">✓ Done editing</button>
      </div>
    </div>`;
  };
  // MERGED like the manager: un-accepted orders stay SEPARATE (each with its own
  // Accept); accepted orders fold into ONE combined list with a dashed separator
  // between each source order — the single bill lives in the footer (owner, 2026-06-14).
  const newOrdersT = os.filter((o) => o.status === "received");
  const liveOrdersT = os.filter((o) => o.status !== "received" && o.status !== "cancelled");
  const newCards = newOrdersT.map((o) => {
    const when = o.created_at ? new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    const viaApp = !!o.member_id;
    const rows = dishRowsOf(o).map((r) => dishRowHtml(r, o)).join("");
    return `<div class="ord"><div class="ordh"><span class="left"><span class="kot">#${esc(o.kot_no ?? "—")}</span><span class="when">New order${when ? ` · ${when}` : ""}</span>${viaApp ? `<span class="viaapp">via app 📱</span>` : ""}</span></div>${rows || `<div class="iline muted">No items.</div>`}${orderControlsHtml(o)}<button class="accept" data-accept="${esc(o.id)}">✓ Accept</button></div>`;
  }).join("");
  const mergedDishes = liveOrdersT.map((o, i) => (i > 0 ? `<div class="ord-sep" aria-hidden="true"></div>` : "") + dishRowsOf(o).map((r) => dishRowHtml(r, o)).join("") + orderControlsHtml(o)).join("");
  const mergedCard = liveOrdersT.length ? `<div class="ord">${mergedDishes}</div>` : "";
  const orderCards = newCards + mergedCard;
  // A whole-bill discount is shown with its PERCENTAGE (owner, 2026-08-03) — "− ₹200" alone
  // doesn't tell a waiter whether the party was given 5% or half the bill. Measured against the
  // party's pre-tax subtotal, the same base the discount modal and the printed bill use.
  // Since mig 270 that base is the TAXABLE part, not the whole pre-tax subtotal — the same
  // number the modal caps against — or a 100% discount would read as "83%" on a bill with an
  // MRP bottle in it. Identical to the old preTax() sum on any bill with nothing untaxed.
  const billDiscLbl = discPct(os.filter((o) => o.status !== "cancelled").reduce((a2, o) => a2 + orderTaxSplit(o).base, 0), s && s.discount);

  const callRows = calls.map((c) => `<div class="row"><span>🔔 ${esc(c.note || "Waiter call")}</span><button class="btn small primary" data-attend="${esc(c.id)}">Done</button></div>`).join("");

  // Bottom bar: bill + paid/unpaid on the left; a big ATTEND filling the rest when
  // there's a call (sized to whatever space is left, exactly as asked). The bill
  // number only exists once the table has ordered — until then we say so plainly.
  let foot = "";
  if (s) {
    const hasOrders = os.length > 0;
    const payCls = a.unpaid ? "unpaid" : a.paid ? "paid" : "";
    const billInner = hasOrders
      // An em dash where a number belongs reads as a missing value, not as "there isn't one yet"
      // — and it was printed TWICE on the same card (here and in the header line below), which
      // made a perfectly healthy open table look broken (T14 tablet sweep, 2026-08-05). Say it in
      // words instead; the amount due beside it is unaffected either way.
      ? `<span class="bn">${a.billNo ? `bill #${esc(a.billNo)}` : "bill not numbered yet"}</span>${invoiced ? `<span class="inv">🧾 #${esc(s.invoice_no)}</span>` : ""}${a.due > 0 ? `<span class="due">${inr(a.due)} due</span>` : ""}<span class="pay">${a.unpaid ? "● UNPAID" : a.paid ? "paid ✓" : "● new"}</span>`
      : `<span class="bn">no bill yet</span><span class="due">starts on first order</span>`;
    const attend = calls.length
      ? `<button class="attend ${calls.length > 1 ? "more" : ""}" data-attend="${esc(calls[0].id)}">🔔 ATTEND — ${esc(calls[0].note || "call")}${calls.length > 1 ? ` (+${calls.length - 1} more)` : ""}</button>`
      : "";
    foot = `<div class="foot"><div class="billbox ${payCls}">${billInner}</div>${attend}</div>`;
  }

  p.classList.add("has-detail");
  // The table detail opens as ONE centered POPUP over the floor at every width
  // (owner 2026-07-05: "keep popup only, not side view, for the tablet"). The floor
  // stays behind it; #panel:has(.detail-pop) dims + centers the card via CSS.
  // KOT & table operations live AT THE TOP of the popup (owner, 2026-08-03 — "KOT options
  // on the top, just like the manager, whenever the popup opens"). The money + close
  // actions stay pinned at the bottom where thumbs expect them.
  const headOps =
    (s && kotOpsOn() ? `<button class="btn small${txray("tablet_table_ops")}" id="kotMenuBtn">🧾 KOT ▾</button>` : "")
    + (s && !kotOpsOn() ? `<button class="btn small" id="shiftTable">⇄ Move table</button>` : "")
    + (s && os.length && !kotOpsOn() ? `<button class="btn small" id="moveOrderBtn">⇄ Move an order</button>` : "")
    + (tabletTagsOn() && tshow("tablet_table_tags") ? `<button class="btn small${txray("tablet_table_tags")}" id="tagTable">${TABLE_TAG_INFO[ttagOf(t)] ? TABLE_TAG_INFO[ttagOf(t)].emoji : "🏷"} Table type</button>` : "");
  // STEP BETWEEN TABLES WITHOUT CLOSING (owner, 2026-08-03: "they can able to toggle the
  // tables and all that very fast"). The popup covers the floor, so moving from T6 to T7 used
  // to cost two taps — close, then find and tap the next tile, on tiles that are deliberately
  // small. ‹ › walk the SAME list the floor draws, in the same order, honouring this waiter's
  // section, so "next" always means the next table they can actually serve.
  // ⇹ UNMERGE, AT THE VERY BOTTOM OF A JOINED TABLE'S DETAIL (owner, 2026-08-17: "if you go inside a
  // detail view, there will be option like unmerge this table when it is merged").
  //
  // Until now the tablet could JOIN two tables and never separate them — its own KOT menu said
  // "Change table — unmerge first" about a thing this device could not do, so a mis-tapped merge
  // meant walking to the manager panel. The undo bar after a merge (see renderMergePicker) catches
  // the immediate mistake; this is the way back at any time after that.
  //
  // THE BUTTONS ARE THE MANAGER'S, EXACTLY (editor/app.js, owner 2026-08-01: "at the very bottom
  // there will be a button to unmerge, and for that particular table it will unmerge that particular
  // table from it"): opening a CHILD offers one button for itself; opening the table that HOLDS the
  // bill offers one per child, because there is nothing to detach IT from. Same place, same words,
  // same gate (tablet_table_ops) — a waiter and a manager must not learn two different screens.
  const unmergeKids = mergeParentOf(t) ? [String(t)] : mergeChildrenOf(t);
  const unmergeRow = (s && unmergeKids.length && kotOpsOn() && tshow("tablet_table_ops"))
    ? `<div class="unmerge-row">${unmergeKids.map((k) => `<button class="btn danger unmerge-btn${txray("tablet_table_ops")}" data-unmerge="${esc(k)}">⇹ Unmerge ${esc(tableLabel(k))}</button>`).join("")}</div>`
    : "";
  const walk = stepTables();
  const wi = walk.indexOf(String(t));
  const prevT = wi > 0 ? walk[wi - 1] : (walk.length > 1 ? walk[walk.length - 1] : null);
  const nextT = wi >= 0 && wi < walk.length - 1 ? walk[wi + 1] : (walk.length > 1 ? walk[0] : null);
  const stepBtns = (walk.length > 1 && prevT != null && nextT != null)
    ? `<span class="phead-step"><button class="pstep" data-step-table="${esc(prevT)}" title="${esc(tableLabel(prevT))}" aria-label="Previous table">‹</button><button class="pstep" data-step-table="${esc(nextT)}" title="${esc(tableLabel(nextT))}" aria-label="Next table">›</button></span>`
    : "";
  p.innerHTML = `
   <div class="detail-pop">
    <button class="detail-x" id="detailClose" type="button" aria-label="Close">✕</button>
    <div class="phead">
      <div style="flex:1"><h2 style="margin:0;font-size:19px">${esc(tableLabel(t))}</h2><div class="pmeta">${mergeGroupLabel(t) ? `<span class="tmerge">⇄ one party · ${esc(mergeGroupLabel(t))}</span> · ` : ""}${s ? `${a.guests ? `${a.guests} guest${a.guests > 1 ? "s" : ""} · ` : ""}${os.length ? (a.billNo ? `bill #${esc(a.billNo)}` : "bill not numbered yet") : "no bill yet"} · <span class="live">● open</span>` : `<span class="off">closed</span>`}${unsentMeta}</div></div>
      ${stepBtns}
    </div>
    ${headOps ? `<div class="phead-ops">${headOps}</div>` : ""}
    <div class="detail-body">
      ${reqRows ? `<div class="sec"><h3>Requests</h3>${reqRows}</div>` : ""}
      ${joinRows ? `<div class="sec"><h3>Waiting to join</h3>${joinRows}</div>` : ""}
      ${callRows ? `<div class="sec"><h3>Calls</h3>${calls.length > 1 ? `<button class="btn small primary" data-attend-all-calls="${esc(t)}">Attend all (${calls.length})</button>` : ""}${callRows}</div>` : ""}
      ${(s && partyRows) ? `<div class="sec"><h3>Party</h3>${partyRows}</div>` : ""}
      <div class="sec"><h3>Orders</h3>${unsentBox}${(os.filter((o) => o.status === "received").length > 1) ? `<button class="accept accept-all" data-accept-all="${esc(t)}">✓ Accept all &amp; prepare (${os.filter((o) => o.status === "received").length})</button>` : ""}${(os.some((o) => o.status !== "received" && o.status !== "cancelled" && dishRowsOf(o).some((r) => r.fromDb && r.status !== "served"))) ? `<button class="serve-all-btn" data-serve-all="${esc(t)}">🍽️ Serve all</button>` : ""}${orderCards || `<div class="muted">No orders yet.</div>`}${Number(s && s.discount) > 0 ? `<div class="bill-disc-note" style="margin-top:8px;font-size:13px;font-weight:700;color:#f0b232">🏷️ Whole-bill discount − ${inr(s.discount)}${billDiscLbl ? ` (${billDiscLbl})` : ""}${s.discount_note ? ` · ${esc(s.discount_note)}` : ""}</div>` : ""}</div>
    </div>
    <div class="dacts">
      ${tshow("tablet_take_orders") ? `<button class="btn primary big${txray("tablet_take_orders")}" id="takeOrder">＋ Take order</button>` : ""}
      <!-- 🧾 KOT ▾ / ⇄ Move / 🏷 Table type moved to the TOP of this popup (phead-ops,
           owner 2026-08-03 — manager style). -->
      <!-- ↻ Restart REMOVED (owner, 2026-08-01). It was the last open/close-era action left in any
           panel, and it is what created the state he caught: it archived the round, released the
           guests and left the PARTY OPEN with nobody on it — a table the floor draws as Free while
           the database calls it open. "If it happens then it happens for all; if not, not for all."
           A finished table now simply frees itself when the bill is settled. -->
      ${s && os.length && tshow("tablet_discount") ? `<button class="btn${txray("tablet_discount")}" id="billDiscountBtn">${Number(s.discount) > 0 ? `− Edit bill discount (${inr(s.discount)})` : "− Discount whole bill"}</button>` : ""}
      ${s && os.length && !invoiced && tshow("tablet_invoice") ? `<button class="btn${txray("tablet_invoice")}" id="genInvoiceBtn">🧾 Generate invoice</button>` : ""}
      <!-- PRINT THE BILL. Deliberately not behind a new switch: it shows the guest exactly what this
           screen already shows the waiter, so there is nothing extra to permit — and a waiter who
           can settle a table but cannot hand over its bill is the gap this closes (T7 F9). -->
      ${s && os.length ? `<button class="btn" id="printBillBtn">${billPrintLabel(s, os, "bill")}</button>` : ""}
      <!-- A DISABLED BUTTON EATS THE TAP, AND THIS IS A TOUCH PANEL (T7 sweep, 2026-08-17). While an
           order on this table is still un-accepted the bill cannot be settled — true, and the button
           used to be rendered disabled with the reason in a title attribute. A title needs a HOVER,
           and a waiter carrying plates has no mouse: the tap simply vanished on the most repeated
           money control in a service. The split-payment button forty lines from here already answers
           this exact situation the right way ("Stays ENABLED and says WHY it won't go"), and two
           controls in one panel must not answer the same situation two different ways. So: dimmed,
           still tappable, and it refuses OUT LOUD (see the #payBill handler below).
           NOTE FOR WHOEVER EDITS THIS COMMENT: it lives INSIDE a JavaScript template literal, so a
           backtick here ends the string and breaks the whole panel. This comment had two, and the
           tablet was blank until the live walk caught it — no static check can see that. -->
      ${s && os.length && a.unpaid && tshow("tablet_mark_paid") ? `<button class="btn pay${txray("tablet_mark_paid")}" id="payBill"${os.some((o) => o.status === "received") ? ' data-needs-accept="1" style="opacity:.55" title="Accept the order first — the bill can only be paid once accepted."' : ""}>💳 Mark bill paid</button>` : ""}
      ${s && os.length && a.paid && tshow("tablet_mark_paid") ? `<button class="btn${txray("tablet_mark_paid")}" id="unpayBill" title="Reopen this paid bill (a refund/correction — asks for a reason)">↩ Mark unpaid</button>` : ""}
      ${s ? `<button class="btn danger" id="closeTable">✕ Close table</button>` : ""}
    </div>
    ${unmergeRow}
    ${foot}
   </div>`;
  { const dc = $("#detailClose"); if (dc) dc.onclick = () => { state.table = null; renderPanel(); renderFloor(); }; }
  // #10: backdrop tap closes the detail popup, consistent with every other tablet popup.
  p.onclick = (e) => { if (e.target === p) { state.table = null; renderPanel(); renderFloor(); } };
  // ‹ › step to the previous/next table WITHOUT closing the popup. selectTable() does the
  // rest (it fetches that table's slice and repaints), so this is the same one-tap open the
  // floor gives — just reachable from inside an open table.
  document.querySelectorAll("[data-step-table]").forEach((b) => (b.onclick = () => selectTable(b.dataset.stepTable)));
  // ⇹ Unmerge — SAY WHAT WILL HAPPEN BEFORE IT HAPPENS. The manager's identical confirm lists it,
  // and a waiter needs it more, not less: splitting a party moves money between two bills. Written
  // as plain lines because this panel's confirm box takes text, not markup (which is the safer of
  // the two anyway — nothing typed by a person can ever become markup here).
  document.querySelectorAll("[data-unmerge]").forEach((b) => (b.onclick = () => unmergeTable(b.dataset.unmerge)));

  // wire it up
  document.querySelectorAll("[data-req-approve]").forEach((b) => (b.onclick = () => act(() => api("POST", `/requests/${b.dataset.reqApprove}/resolve`, { status: "approved" }))));
  document.querySelectorAll("[data-req-deny]").forEach((b) => (b.onclick = () => act(() => api("POST", `/requests/${b.dataset.reqDeny}/resolve`, { status: "denied" }))));
  document.querySelectorAll("[data-attend]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.attend;
    const c = (state.data.calls || []).find((x) => x.id === id);
    try {
      const r = await api("POST", `/calls/${id}/attend`);
      if (isQueued(r)) { toast(savedMsg(r)); return; }
      await load();
      // A mis-tapped "Done" silently drops a real guest call — offer a takeback (2026-07-22).
      if (window.LFH_UNDO) LFH_UNDO.show({
        message: "Call attended",
        sub: c ? `T${c.table_number} · ${c.note || "call"} — tap undo` : "Tap undo to put the call back",
        icon: "🔔",
        onUndo: () => api("POST", `/calls/${id}/reopen`).then(() => load()).catch((e) => { toast("Undo failed: " + errText(e), false); load(); }),
      });
    } catch (e) { toast("Failed: " + errText(e), false); }
  }));
  document.querySelectorAll("[data-approve]").forEach((b) => (b.onclick = () => act(() => api("POST", `/members/${b.dataset.approve}/approve`))));
  document.querySelectorAll("[data-makehead]").forEach((b) => (b.onclick = () => act(() => api("POST", `/members/${b.dataset.makehead}/make-head`))));
  // Remove a guest from the table (the table stays open). Confirm first — it ends their access.
  // The button said "Kick" until 2026-08-14 (T15 P4): gaming slang for the one act that touches a
  // paying customer, and the audit log already called it "Removed guest". One word now.
  document.querySelectorAll("[data-kick]").forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Remove this guest from the table? Their access ends now — the table stays open.", "Remove"))
      act(() => api("POST", `/members/${b.dataset.kick}/remove`));
  }));
  // Ban a guest: kicked now AND blocklisted so they can't rejoin. Destructive — confirm.
  document.querySelectorAll("[data-ban]").forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Ban this guest? They're kicked now and blocked from rejoining this table.", "Ban"))
      actGated("POST", `/members/${b.dataset.ban}/ban`, null, { message: "Enter a manager PIN to ban this guest." });
  }));
  // Auto-approve toggle: future joiners are approved automatically (no staff review).
  // Attend every waiter call on the table in one tap.
  document.querySelectorAll("[data-attend-all-calls]").forEach((b) => (b.onclick = async () => {
    const tbl = b.dataset.attendAllCalls;
    const ids = callsOf(tbl).map((c) => c.id);
    // Same rule as optimisticAccept — the button is on screen because the slice HAD calls; if
    // another device attended them a second ago this list is empty, and a bell that is dropped
    // in silence is the worst of the three to lose.
    if (!ids.length) { toast("Those calls are already done — refreshing this table.", false); load().catch(() => {}); return; }
    try {
      for (const id of ids) await api("POST", `/calls/${id}/attend`);
      await load();
      if (window.LFH_UNDO) LFH_UNDO.show({
        message: `${ids.length} call${ids.length > 1 ? "s" : ""} attended`,
        sub: `T${tbl} · tap undo to put them back`,
        icon: "🔔",
        onUndo: () => Promise.all(ids.map((id) => api("POST", `/calls/${id}/reopen`))).then(() => load()).catch((e) => { toast("Undo failed: " + errText(e), false); load(); }),
      });
    } catch (e) { toast("Failed: " + errText(e), false); }
  }));
  // Discount: shown only when the manager enables it for the tablet (General settings
  // → tablet_discount = on/pin; default off = no button). tabletDiscount() applies
  // the on/pin rule; the server enforces it too.
  document.querySelectorAll("[data-discount]").forEach((b) => (b.onclick = () => tabletDiscount(b.dataset.discount)));
  // Accept ONE order — optimistic (flips received→preparing instantly, persists in bg).
  document.querySelectorAll("[data-accept]").forEach((b) => (b.onclick = () => optimisticAccept([b.dataset.accept])));
  // Accept ALL un-accepted orders on the table in one tap — optimistic + bulk.
  document.querySelectorAll("[data-accept-all]").forEach((b) => (b.onclick = () =>
    optimisticAccept(partyOrders(b.dataset.acceptAll).filter((o) => o.status === "received").map((o) => o.id))));
  // Serve ALL accepted-but-unserved dishes on the table in one tap — optimistic + bulk.
  // Flips every dish to served on screen INSTANTLY, then fires one /serve-all per order
  // in the background (mirrors the manager + advanceDish). No more waiting on the network.
  document.querySelectorAll("[data-serve-all]").forEach((b) => (b.onclick = () =>
    optimisticServeAll(partyOrders(b.dataset.serveAll).filter((o) => o.status !== "received" && o.status !== "cancelled" && dishRowsOf(o).some((r) => r.fromDb && r.status !== "served")).map((o) => o.id))));
  // Per-dish advance: optimistically flip the pill, then persist + reconcile.
  document.querySelectorAll(".ist.tap[data-item]").forEach((el) => (el.onclick = () => advanceDish(el.dataset.item, el.dataset.cur)));
  // Explicit "✓ Serve" button on each cooking/ready dish → serves it directly
  // (advanceDish takes preparing/ready straight to served).
  document.querySelectorAll("[data-serve]").forEach((b) => (b.onclick = () => advanceDish(b.dataset.serve, b.dataset.cur)));
  // Per-dish delete (confirm first; the server re-prices / cancels an emptied order).
  document.querySelectorAll("[data-del-item]").forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Remove this dish from the order? The bill updates automatically.", "Remove dish"))
      act(() => api("POST", `/items/${b.dataset.delItem}/delete`));
  }));
  // Delete a WHOLE order (confirm; refused server-side if the order is already paid).
  document.querySelectorAll("[data-del-order]").forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Delete this whole order? It leaves the floor and the reports, and stays in the records for 90 days.", "Delete order"))
      act(() => api("POST", `/orders/${b.dataset.delOrder}/delete`));
  }));
  // ── STAFF EDIT-AFTER-CONFIRM (owner, 2026-06-17) ──────────────────────────
  // Enter edit mode ONLY after the waiter confirms with the kitchen it's still
  // editable (the order may already be cooking). The 2-step confirm IS the guard.
  document.querySelectorAll("[data-edit-order]").forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Have you checked with the kitchen that this order is still editable? Only edit if they haven't started making it.", "Yes — it's editable")) {
      state.editOrders.add(b.dataset.editOrder); renderPanel();
    }
  }));
  document.querySelectorAll("[data-done-order]").forEach((b) => (b.onclick = () => { state.editOrders.delete(b.dataset.doneOrder); renderPanel(); }));
  // Quantity −/＋ on one dish (re-prices the bill server-side, clamped 1..99).
  document.querySelectorAll("[data-qty-inc]").forEach((b) => (b.onclick = () => bumpItemQty(b.dataset.qtyInc, +1)));
  document.querySelectorAll("[data-qty-dec]").forEach((b) => (b.onclick = () => bumpItemQty(b.dataset.qtyDec, -1)));
  // "✎ Edit" one dish → the unified modal (allergens incl. custom + kitchen note),
  // IDENTICAL to the manager panel's openDishEditModal.
  document.querySelectorAll("[data-edit-dish]").forEach((b) => (b.onclick = () => openDishEditModal(b.dataset.editDish)));
  // Add a dish to THIS already-placed order: reuse the dish browser in add mode.
  document.querySelectorAll("[data-add-dish]").forEach((b) => (b.onclick = () => { state.ordering = true; state.viewOrder = false; state.addToOrderId = b.dataset.addDish; state.cat = ""; state.dishSearch = ""; state._omTop = 0; state._addedThisVisit = 0; renderPanel(); }));
  // Per-order allergen chips: toggle an allergen on/off for the whole order.
  document.querySelectorAll(".talg[data-alg]").forEach((chip) => (chip.onclick = async () => {
    const id = chip.dataset.alg;
    const o = (state.data.orders || []).find((x) => x.id === id);
    // NEVER A SILENT RETURN ON A TAP (owner's standing rule; T4 sweep, 2026-08-11). A poll, a
    // realtime breadcrumb or a reconcile can land between the paint and the finger and replace
    // state.data.orders with fresh rows — so an order that has just been moved, voided or settled
    // leaves this chip pointing at an id that matches nothing. The tap then did nothing and SAID
    // nothing, which is indistinguishable from a broken button and leaves no trace to debug. The
    // KITCHEN's ✓ was fixed for exactly this on 2026-08-04 (kitchen/app.js markItemReady); the four
    // taps on this panel were the ones left behind, and an ALLERGY chip is the worst of them to
    // drop quietly. This is a defensive path: the chip only renders for an order in state.
    if (!o) { toast("That order just changed — refreshing this table.", false); load().catch(() => {}); return; }
    const wasAllergies = Array.isArray(o.allergies) ? [...o.allergies] : []; // what the screen showed
    const cur = new Set(wasAllergies.map((x) => String(x).toLowerCase()));
    // ＋ Other → ask for the word, then treat it exactly like tapping a standard chip on.
    let slug = chip.dataset.slug;
    if (chip.dataset.algOther) { slug = await allergyPrompt(cur); if (!slug) return; }
    if (cur.has(slug)) cur.delete(slug); else cur.add(slug);
    o.allergies = [...cur];        // OPTIMISTIC: update local state now so any re-render reflects it
    // A standard chip only flips on/off in place (no flicker); a TYPED one adds or removes a
    // whole chip, so the panel redraws to show it.
    if (ALG_STD.includes(slug)) chip.classList.toggle("on");  // INSTANT visual feedback — before this it only hit the server, so the tap felt dead ("allergy not clicking")
    else renderPanel();
    act(() => api("POST", `/orders/${id}/allergies`, { allergies: [...cur] }, { expect: { table: "orders", id, fields: { allergies: wasAllergies } } }));
  }));
  const shb = $("#shiftTable"); if (shb && s) shb.onclick = () => renderShiftPicker(t, s);
  const mob = $("#moveOrderBtn"); if (mob && s) mob.onclick = () => renderMoveOrderPicker(t);   // was dead: renderMoveOrderPicker/Target existed but nothing opened them (fixed 2026-07-06)
  const kmb = $("#kotMenuBtn"); if (kmb && s) kmb.onclick = () => renderKotMenu(t, s);
  // Restart: clear this round's orders off the floor (they stay served+archived in
  // records) but keep the table OPEN for a fresh round. Mirrors the manager.
  const pb = $("#payBill"); if (pb) pb.onclick = () => {
    // The refusal, said out loud — see the note on the button above. The words name the thing the
    // waiter must do next, not the rule that stopped them.
    if (pb.dataset.needsAccept) { toast("Accept the order first — a bill can only be paid once the kitchen has it.", false); return; }
    payBillWithMethod(t, a);
  };
  const ub = $("#unpayBill"); if (ub) ub.onclick = () => markBillUnpaid(t);
  const tgb = $("#tagTable"); if (tgb) tgb.onclick = () => openTagSheet(t);
  const gib = $("#genInvoiceBtn"); if (gib && s) gib.onclick = () => genInvoice(s.id);
  const pbb = $("#printBillBtn"); if (pbb) pbb.onclick = () => printTableBill(state.table);
  const bdb = $("#billDiscountBtn"); if (bdb && s) bdb.onclick = () => tabletBillDiscount(t);
  const clb = $("#closeTable"); if (clb && s) clb.onclick = () => closeTableAndFree(t);
  { const tob = $("#takeOrder"); if (tob) tob.onclick = () => { state.ordering = true; state.viewOrder = false; state.cart = []; state.allergies = ""; state.cat = ""; state.dishSearch = ""; state._omTop = 0; renderPanel(); }; }
  restoreScroll();   // #U2: keep the popup scroll across a live-update rebuild (same table)
}

// unmergeTable(child): separate ONE table back out of the party it was joined to (mig 249).
//
// THE ONE PATH, used by the detail's ⇹ Unmerge buttons AND by the undo bar the merge raises — a
// second copy would be a second place to forget the confirm, which is exactly how the close path
// got its own shared function. `opts.silent` skips the question for the undo bar, because the undo
// bar IS the question: the waiter is answering "did you mean that?" by tapping it.
//
// The confirm tells the truth BEFORE the tap, in the same three parts the manager's does, because
// splitting a party moves money between two bills:
//   · what goes BACK to this table — its own KOTs and their total. An order keeps the table number
//     it was rung at even while merged (that is what makes a split exact), so this is not a guess;
//   · what STAYS on the table holding the bill;
//   · what does NOT move at all — a whole-bill discount was given to the JOINT bill and cannot be
//     divided between two tables, and nobody recorded which guests sat where.
async function unmergeTable(child, opts = {}) {
  const parent = mergeParentOf(child);
  // NEVER A SILENT RETURN ON A TAP: the button renders from the merge list, and a poll or another
  // device can end the merge between the paint and the finger.
  if (!parent) { toast(`${tableLabel(child)} isn't merged with another table any more.`, false); load().catch(() => {}); return; }
  if (!opts.silent) {
    const readOk = await ensurePartySlices(child);         // both halves, so the sums below are real
    // COULDN'T ASK IS NOT THE SAME AS NOTHING THERE (the rule closeTableAndFree already follows). If
    // a slice did not land, the lines below would read the empty cache and announce "nothing was
    // ordered at it" about a table that may be holding food — a confirm that talks someone into a
    // split by understating it. Say which of the two it is instead.
    if (!readOk) {
      toast(`Couldn't check what is on ${tableLabel(child)} just now — try again in a moment.`, false);
      load().catch(() => {});
      return;
    }
    // ordersOf() already resolves a merged child through the PARTY's session and then keeps only the
    // rows rung AT that table number — which is exactly the split the server will perform.
    const live = (x) => ordersOf(x).filter((o) => o.status !== "cancelled" && !o.archived);
    const mine = live(child), theirs = live(parent);
    const sum = (list) => list.reduce((acc, o) => acc + (parseFloat(o.total) || 0), 0);
    const kots = (list) => list.map((o) => "#" + (o.kot_no ?? "—")).join(", ");
    const sess = sessionOf(child) || {};
    const disc = parseFloat(sess.discount) || 0;
    const lines = [
      `Split ${tableLabel(child)} back out of ${tableLabel(parent)}?`,
      "",
      mine.length
        ? `• Back to ${tableLabel(child)}: KOT ${kots(mine)} — ${inr(sum(mine))}`
        : `• ${tableLabel(child)} gets nothing back — nothing was ordered at it. It simply becomes free.`,
      theirs.length ? `• Stays on ${tableLabel(parent)}: KOT ${kots(theirs)} — ${inr(sum(theirs))}` : "",
      disc > 0 ? `• Does NOT move: the ${inr(disc)} whole-bill discount stays on ${tableLabel(parent)} — it was given to the joint bill, so it can't be split between two tables.` : "",
      membersOf(child).length ? `• Does NOT move: the guest count stays with ${tableLabel(parent)} — nobody recorded which guests sat where.` : "",
    ].filter((x) => x !== "");
    if (!(await confirmDialog(lines.join("\n"), "Unmerge"))) return;
  }
  try {
    const r = await api("POST", `/tables/${child}/unmerge`, {});
    if (isQueued(r)) { toast(savedMsg(r)); return; }
    const moved = r && r.moved ? ` · ${r.moved} ${r.moved === 1 ? "order" : "orders"} back` : "";
    toast(`${tableLabel(child)} split from ${tableLabel(parent)}${moved}`);
    // Both tiles change, and the open popup was showing a party that no longer exists — reload the
    // whole floor rather than patching, then repaint the table the waiter is actually looking at.
    lastSig = null;
    await load();
    renderFloor();
    if (!state.ordering && !state.pickerOpen) renderPanel();
  } catch (e) {
    toast("Couldn't split those tables: " + errText(e), false);
    lastSig = null; load().catch(() => {});
  }
}

// closeTableAndFree(t): THE one close path — the popup's "✕ Close table" and the finished
// tile's ⏻ both call this. It is a function rather than two copies on purpose: the flow
// carries an optimistic local drop AND the reason-code "close anyway" ladder, and a second
// copy of that would be a second place to forget the reason codes (which is exactly how a
// paid-but-unserved table once dead-ended with no "close anyway" at all).
//
// It resolves the session itself, because the FLOOR renders from the slim summary: a tile's
// ⏻ can be tapped for a table whose full slice was never fetched.
async function closeTableAndFree(t) {
  // Did the slice actually LAND? ensurePartySlices swallows a failed read, and without knowing
  // that, a missing session reads as "already free" — which is a lie when the truth is "we
  // couldn't ask". Two different problems deserve two different sentences (2026-08-04).
  // ensurePartySlices now ANSWERS this instead of throwing (it catches each read itself), so read
  // the answer — a try/catch around a function that never throws would have quietly made every
  // failed read look like a successful one, and "already free" is exactly the lie this guards.
  const readOk = await ensurePartySlices(t);
  const s = sessionOf(t);
  if (!s) {
    toast(readOk && sliceLoaded(t)
      ? `${tableLabel(t)} is already free.`
      : `Couldn't check ${tableLabel(t)} just now — try again in a moment.`, false);
    await load().catch(() => {}); renderFloor();
    return;
  }
  const a = tableAgg(t), os = partyOrders(t);
  const warn = a.unpaid && os.length ? ` The bill (${inr(a.due)}) is still UNPAID.` : "";
  if (!(await confirmDialog(`Close ${tableLabel(t)} and free it?${warn}`, "Close table"))) return;
  // OPTIMISTIC: drop the session AND this table's orders/members locally so the FLOOR TILE
  // (which renders from the slim summary, not the slice) goes free INSTANTLY, instead of
  // showing the old occupied colour for ~1s until the reconcile. patchTileFromSlice recomputes
  // the now-empty tile into state.summary; load() below reconciles (and reverts it if the
  // server refuses the close). (audit 2026-07-08 round2)
  state.data.sessions = (state.data.sessions || []).filter((x) => x.id !== s.id);
  state.data.orders = (state.data.orders || []).filter((o) => String(o.table_number) !== String(t));
  state.data.members = (state.data.members || []).filter((m) => m.session_id !== s.id);
  patchTileFromSlice(t);
  state.table = null; state.ordering = false;
  renderFloor(); renderPanel();
  try {
    await api("POST", `/sessions/${s.id}/close`);
    await load();
  } catch (e) {
    await load(); // server refused — refetch so the still-open table reappears
    // THE REASON CODE FIRST, the wording only as a fallback (2026-08-01). This used to test the
    // server's PROSE — the exact mistake the manager panel was fixed for: a paid-but-unserved
    // table is refused with different words, so the text match missed it and the waiter got a
    // dead-end error with no "close anyway" at all. lib/sessionClose.ts sends
    // reason: 'unpaid' | 'cooking' | 'both'; the text test stays only for a stale or queued
    // reply that predates it.
    const why = (e && e.data && e.data.reason) || null;
    if (why === "unpaid" || why === "cooking" || why === "both" || /close anyway/i.test(String(e && e.message))) {
      if (await confirmDialog(`${e.message}`, "Close anyway")) {
        await actGated("POST", `/sessions/${s.id}/close`, { force: true }, { message: "Enter a manager PIN to close this busy table.", toast: "Table closed" });
      }
      return;
    }
    toast("Failed: " + errText(e), false);
  }
}

// Advance one dish new→cooking→served (wrapping). Optimistic so it feels instant.
// After serving stops for a moment, do ONE real refetch to reconcile — instead of
// reloading the whole board after EVERY tap (that full reload was the ~1.5s
// "auto-refresh" between serves). The optimistic update already shows it instantly.
let serveReconcileTimer = null;
function scheduleServeReconcile() {
  if (serveReconcileTimer) clearTimeout(serveReconcileTimer);
  serveReconcileTimer = setTimeout(() => { serveReconcileTimer = null; load().catch(() => {}); }, 2500);
}
async function advanceDish(id, cur, forceNext) {
  // forceNext lets a caller set an explicit target (e.g. the "↩ Send back to kitchen" undo in
  // the edit modal passes "preparing" to un-serve a dish); otherwise follow the forward flow.
  const next = forceNext || NEXT_STATUS[cur] || "preparing";
  const it = (state.data.items || []).find((x) => x.id === id);
  const dishName = (it && (it.title || it.name)) || "Dish";
  if (it) it.status = next;            // optimistic — the pill flips instantly
  // #8: re-sync THIS table's slim summary tile from the slice so the floor counts + the tile's
  // "x/y served · ₹z due" meta update instantly too — before this, serving the last dish left
  // the "Needs/Active" chips and the tile text stale for ~2.5s until the reconcile.
  if (it) { const o = (state.data.orders || []).find((x) => x.id === it.order_id); if (o) patchTileFromSlice(o.table_number); }
  // Adopt this state as the baseline so a poll that arrives with the SAME
  // (server-confirmed) data won't repaint the panel under the waiter's finger.
  lastSig = boardSig(state);
  renderFloor();
  if (!state.ordering) renderPanel();
  // Fire-and-forget; reconcile once after the taps stop (not per tap).
  api("POST", `/items/${id}/status`, { status: next })
    .then(() => {
      scheduleServeReconcile();
      // Only when this tap actually SERVED a dish (not an accept-to-cooking, and not
      // the "send back to kitchen" un-serve which passes forceNext) offer a takeback.
      if (next === "served" && cur !== "served" && window.LFH_UNDO) {
        const ord = it ? (state.data.orders || []).find((x) => x.id === it.order_id) : null;
        LFH_UNDO.show({
          message: `${dishName} served`,
          sub: ord ? `T${ord.table_number} · tap undo to put it back` : "Tap undo to put it back",
          onUndo: () => undoServe([{ id, prev: cur }]),
        });
      }
    })
    .catch((e) => { toast("Failed: " + errText(e), false); load(); });
}

// Bulk order actions (accept / serve-all) the OPTIMISTIC way — flip the orders +
// their dishes in local state and repaint INSTANTLY, then persist in the background
// (one bulk call per order), then reconcile once after. Mirrors advanceDish above
// and the manager's serveAllOrders/acceptTableOrders so it feels instant instead of
// making the waiter wait on the network. (owner, 2026-06-18)
// patchTileFromSlice(t): after an optimistic action mutates a table's cached SLICE
// (state.data), recompute that table's TIER-1 summary tile from the slice and write it
// back into state.summary.tiles — because an UN-selected floor tile renders from the
// summary, not the slice (see tableAgg/tileState). Without this a floor quick-action
// (Accept / Serve all / Mark paid) on a table you haven't opened left the tile showing
// the OLD state until the ~2.5s reconcile/realtime round-trip (the "stale for ~1s then
// refresh" owner flags). Mirrors optimisticOpen's explicit tile patch. The counting +
// state precedence deliberately match tableAgg + tileState so the optimistic tile equals
// what load() will reconcile to. (2026-07-06)
function patchTileFromSlice(t) {
  // A merged member's tile renders from the table HOLDING the bill, so that is the tile to
  // patch — and its numbers are the whole party's, matching what the server will reconcile.
  const tk = mergeParentOf(String(t)) || String(t);
  const os = partyOrders(t), s = sessionOf(t);
  let nw = 0, ck = 0, rd = 0, sv = 0, dueTot = 0, dueDisc = 0;
  os.forEach((o) => {
    if (o.status !== "cancelled" && o.status !== "received" && o.payment_status !== "paid") {
      dueTot += Number(o.total) || 0; dueDisc += Number(o.discount) || 0;
    }
    dishRowsOf(o).forEach((r) => {
      const q = r.qty || 1;
      if (r.status === "served") sv += q; else if (r.status === "ready") rd += q; else if (r.status === "preparing") ck += q; else nw += q;
    });
  });
  const due = Math.max(0, dueTot - dueDisc * (1 + effRate()));
  const accepted = os.filter((o) => o.status !== "cancelled" && o.status !== "received");
  const unpaid = accepted.some((o) => o.payment_status !== "paid");
  const paid = !unpaid && accepted.some((o) => o.payment_status === "paid");
  const hasOrders = os.length > 0;
  const members = s ? membersOf(t).length : 0;
  const dishTot = nw + ck + rd + sv;
  // Mirror the server summary RPC (mig 136) EXACTLY — state precedence, label AND meta text —
  // so an optimistic tile equals what load() reconciles to (no flicker), and #8: the meta
  // sub-line ("x/y served · ₹z due") is now recomputed instead of left stale.
  let st, label, meta;
  if (hasOrders) {
    if (nw > 0) { st = "new"; label = "New order"; }
    else if (rd > 0) { st = "ready"; label = "Ready to serve"; }
    else if (ck > 0) { st = "prep"; label = "Preparing"; }
    else if (unpaid) { st = "bill"; label = "Served"; }
    else { st = "done"; label = "Cleared"; }
    meta = dishTot > 0
      ? `${sv}/${dishTot} served${due > 0 ? " · " + inr(due) + " due" : ""}`
      : `${os.length} order${os.length === 1 ? "" : "s"}`;
  } else if (s) {
    if (members > 0) { st = "seated"; label = "Seated · " + members; meta = "no orders yet"; }
    else { st = "waiting"; label = "Open"; meta = "waiting for guests"; }
  } else if (reqsOf(t).length) { st = "req"; label = "Wants in"; meta = "asked for access"; }
  else { st = "free"; label = "Free"; meta = "tap to open"; }
  const tiles = Object.assign({}, state.summary.tiles || {});
  tiles[tk] = Object.assign({}, tiles[tk] || {}, {
    state: st, label, meta,
    counts: { nw, ck, rd, sv }, due,
    pay: unpaid ? "red" : (paid ? "green" : ""),
    hasNew: nw > 0, members,
  });
  state.summary = Object.assign({}, state.summary, { tiles });
}

// Take back a serve (owner undo bar, 2026-07-22). snap = [{ id, prev }] captured
// BEFORE the dishes were flipped to "served". Restore each dish to its prior status
// locally + on the server, recompute the parent orders, and reconcile from the truth.
// Covers session order_items (the common path); legacy JSON-item rows have no per-dish
// id so they aren't reverted here (they're vanishingly rare now).
function undoServe(snap) {
  if (!snap || !snap.length) return Promise.resolve();
  const items = state.data.items || [];
  const orderIds = new Set();
  snap.forEach((s) => {
    const it = items.find((x) => x.id === s.id);
    if (it) { it.status = s.prev; orderIds.add(it.order_id); }
  });
  // Roll each touched order's coarse status back down, exactly like the server does.
  const tables = new Set();
  (state.data.orders || []).forEach((o) => {
    if (!orderIds.has(o.id)) return;
    const rows = items.filter((i) => i.order_id === o.id);
    if (rows.length) {
      const served = rows.filter((r) => r.status === "served").length;
      const anyActive = rows.some((r) => ["preparing", "ready", "served"].includes(r.status));
      o.status = served === rows.length ? "served" : anyActive ? "preparing" : "received";
    }
    tables.add(String(o.table_number));
  });
  tables.forEach((t) => patchTileFromSlice(t));
  lastSig = boardSig(state);
  renderFloor();
  if (!state.ordering) renderPanel();
  return Promise.all(snap.map((s) => api("POST", `/items/${s.id}/status`, { status: s.prev })))
    .then(() => scheduleServeReconcile())
    .catch((e) => { toast("Undo failed: " + errText(e), false); load(); });
}

function flipOrders(orderIds, { from, to, orderStatus }) {
  const items = state.data.items || [];
  const touched = new Set();
  orderIds.forEach((oid) => {
    const o = (state.data.orders || []).find((x) => x.id === oid);
    if (o) { o.status = orderStatus; touched.add(String(o.table_number)); }
    items.forEach((it) => { if (it.order_id === oid && (from ? it.status === from : it.status !== "served")) it.status = to; });
    if (o && Array.isArray(o.items)) o.items = o.items.map((i) => ((from ? i.status === from : i.status !== "served") ? { ...i, status: to } : i));
  });
  touched.forEach((t) => patchTileFromSlice(t));   // keep the UN-selected floor tile in sync
  lastSig = boardSig(state);           // adopt as baseline so a poll can't flicker it back
  renderFloor();
  if (!state.ordering) renderPanel();
}
// NEVER A SILENT RETURN ON A TAP (owner's standing rule; sweep #5 found this exact shape — the
// little green ✓ on a tile "doing nothing and saying nothing"). The three bulk actions below are
// each handed a list built a moment earlier from the table's cached slice, and that list can come
// back EMPTY for reasons the waiter cannot see:
//   · the forced `ensurePartySlices` read failed — it swallows a fetch blip on purpose (each
//     member's read is caught, and the action then no-ops rather than throwing), which is
//     precisely how the tap became invisible;
//   · someone else (the kitchen screen, the manager panel, another waiter's tablet) accepted or
//     served it in the seconds between the tile being painted and the finger landing.
// The tile still shows ✓ / 🍽️ in both cases, so the person taps a control that is visibly there
// and nothing happens at all — indistinguishable from a broken button, and invisible in the logs.
// Say what happened and refresh, exactly like bumpItemQty and the allergy chip already do.
function optimisticAccept(orderIds) {
  if (!orderIds.length) { toast("Nothing left to accept here — refreshing this table.", false); load().catch(() => {}); return; }
  // Snapshot the dishes that were still "received" (the ones this accept sends to the
  // kitchen) so an accidental Accept can be taken back to the new-order queue. Reuses the
  // serve-undo revert with prev:"received" (owner undo bar, 2026-07-22).
  const snap = (state.data.items || [])
    .filter((it) => orderIds.includes(it.order_id) && it.status === "received")
    .map((it) => ({ id: it.id, prev: "received" }));
  flipOrders(orderIds, { from: "received", to: "preparing", orderStatus: "preparing" });
  Promise.all(orderIds.map((oid) => api("POST", `/orders/${oid}/accept`)))
    .then(() => {
      scheduleServeReconcile();
      if (snap.length && window.LFH_UNDO) {
        const o = (state.data.orders || []).find((x) => x.id === orderIds[0]);
        LFH_UNDO.show({
          message: orderIds.length > 1 ? "Orders accepted" : "Order accepted",
          sub: o ? `T${o.table_number} · tap undo to unsend` : "Tap undo to unsend",
          icon: "✋",
          onUndo: () => undoServe(snap),
        });
      }
    })
    .catch((e) => { toast("Failed: " + errText(e), false); load(); });
}
function optimisticServeAll(orderIds) {
  // Same rule as optimisticAccept above — an empty list is never a reason to say nothing.
  if (!orderIds.length) { toast("Nothing left to serve here — refreshing this table.", false); load().catch(() => {}); return; }
  // Snapshot each not-yet-served dish's prior status BEFORE the flip, so "Serve all"
  // can be taken back to exactly where each dish was (owner undo bar, 2026-07-22).
  const snap = (state.data.items || [])
    .filter((it) => orderIds.includes(it.order_id) && it.status !== "served")
    .map((it) => ({ id: it.id, prev: it.status }));
  flipOrders(orderIds, { from: null, to: "served", orderStatus: "served" });
  Promise.all(orderIds.map((oid) => api("POST", `/orders/${oid}/serve-all`)))
    .then(() => {
      scheduleServeReconcile();
      if (snap.length && window.LFH_UNDO) {
        const o = (state.data.orders || []).find((x) => x.id === orderIds[0]);
        LFH_UNDO.show({
          message: "All dishes served",
          sub: o ? `T${o.table_number} · ${snap.length} dish${snap.length > 1 ? "es" : ""}` : `${snap.length} dishes`,
          onUndo: () => undoServe(snap),
        });
      }
    })
    .catch((e) => { toast("Failed: " + errText(e), false); load(); });
}

// Shift the WHOLE party to another free table. Optimistic: move the tiles/labels
// immediately, fire the RPC, then reconcile on the next load — no dead wait.
// A picker renders INSIDE the centered detail popup (keeps .has-detail + .detail-pop, so it
// never falls out below the floor on desktop — 2026-07-06) and registers its OWN back-stack
// layer so the hardware/browser Back button steps back to the table detail, not out to the
// floor. `onBack` is where ← / ✕ / Back / backdrop go.
let activePickerDrop = null;   // #U1: lets a forced renderPanel drop an open picker's back layer
function renderPickerShell(titleHtml, bodyHtml, layerId, onBack) {
  const p = $("#panel"); p.classList.add("has-detail");
  let backOff = window.LFH_BACK ? LFH_BACK.layer(layerId, () => go()) : null;
  // Full teardown: drop the back layer + clear the "picker open" flag so normal repaints resume.
  const drop = () => { if (backOff) { backOff(); backOff = null; } activePickerDrop = null; state.pickerOpen = false; };
  const go = () => { drop(); onBack(); };
  // #U1: the picker lives inside #panel, but a realtime breadcrumb / 60s poll calls renderPanel()
  // which would wipe the picker out mid-selection AND orphan its back layer (a dead Back press).
  // Flag it open so those auto-repaints skip renderPanel (see load/loadTables/poll), and record
  // its teardown so a FORCED renderPanel (user navigation) still cleans the layer instead of leaking.
  state.pickerOpen = true;
  activePickerDrop = drop;
  p.innerHTML = `
   <div class="detail-pop">
    <button class="detail-x picker-back" type="button" aria-label="Back">✕</button>
    <div class="phead"><div style="flex:1"><h2 style="margin:0;font-size:19px">${titleHtml}</h2></div></div>
    <div class="detail-body">${bodyHtml}</div>
   </div>`;
  p.querySelector(".picker-back").onclick = go;
  // Tap the dimmed area outside the card → back (consistent with every other tablet popup).
  p.onclick = (e) => { if (e.target === p) go(); };
  // Fire an action AND drop this picker's back layer + flag first (renderPanel replaces the DOM).
  return { dropLayer: drop };
}

// One-time styles for the KOT action sheet (matches the manager's; owner design
// feedback 2026-07-22 — proper rows, not bare buttons). Panel vars keep the theme.
(function injectKotMenuStyles() {
  const css = `
  .kotm-row { display:flex; align-items:center; gap:12px; width:100%; text-align:left;
    background: var(--panel-2); border:1px solid var(--line); border-radius:12px;
    padding:12px 14px; margin:0 0 8px; cursor:pointer; font:inherit; color:inherit; }
  .kotm-row:disabled { opacity:.45; cursor:default; }
  .kotm-ico { width:38px; height:38px; border-radius:10px; flex:none; display:flex; align-items:center;
    justify-content:center; font-size:18px; background: color-mix(in srgb, var(--gold) 14%, transparent);
    border:1px solid color-mix(in srgb, var(--gold) 30%, transparent); }
  .kotm-txt b { font-size:14.5px; display:block; }
  .kotm-txt small { color: var(--muted); font-size:11.5px; line-height:1.3; display:block; margin-top:1px; }
  .kotm-chev { margin-left:auto; color: var(--muted); flex:none; }
  .kotm-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(84px,1fr)); gap:8px; }
  .kotm-tile { border:1px solid var(--line); border-radius:12px; background:var(--panel-2);
    padding:10px 6px; text-align:center; cursor:pointer; font:inherit; color:inherit; }
  .kotm-tile b { display:block; font-size:15px; }
  .kotm-tile small { display:block; color:var(--muted); font-size:10.5px; margin-top:2px; }
  .kotm-tile.occ { border-color: color-mix(in srgb, var(--gold) 45%, transparent);
    background: color-mix(in srgb, var(--gold) 9%, var(--panel-2)); }`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
})();

// ── KOT ▾ — Table & KOT operations (PetPooja-style unified menu; owner 2026-07-22) ──
// The ladder's tablet rung (mig 172): the KOT button REPLACES the separate Move-table /
// Move-an-order buttons when the manager's Access grant (settings.tablet_table_ops,
// forced 'off' server-side below 'tablet' depth) says on. When off, the two classic
// buttons render exactly as before — zero regression. Ops arrive in phases.
function kotOpsOn() {
  // ADMIN X-RAY rule (owner, 2026-07-22): the admin act-as view always sees the KOT
  // button — txray() tints it amber when it's off for real waiters — and the server
  // lets the admin through (tabletPerm bypass + module-check bypass). Real waiters
  // need the module (server-resolved table_ops_tablet_allowed) AND the tri-state.
  if (tHigher()) return true;
  const set = state.data.settings || {};
  return !!set.table_ops_tablet_allowed && tperm("tablet_table_ops") !== "off";
}
// Is splitting a bill offered at all? A per-restaurant switch, OFF by default (owner, 2026-08-01,
// mig 248 — manager panel → Settings → Bill). Read it HERE, never re-derive it: splitting has TWO
// doors on this panel now (🧾 KOT ▾ → Split the bill, and the small line at the bottom of the
// payment sheet), and a switch that reaches only one of them is worse than no switch. That is
// exactly what happened: the KOT row was gated, the payment-sheet line added on 2026-08-28 was
// not, so a restaurant with splitting OFF still had a waiter one tap from the whole split screen —
// and there is no server-side check to catch it (T7 sweep #7 third pass, 2026-08-30). The manager
// panel learned the same lesson first and its splitBillOn() carries the same note.
function splitBillOn() {
  return !!(state.data.settings || {}).split_bill_enabled;
}
function renderKotMenu(t, s) {
  // `movable` is THIS TABLE'S OWN tickets — right for "move a KOT" / "move a dish", because a
  // ticket belongs to the table it was rung at.
  const movable = ordersOf(t).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled");
  // …but SPLITTING IS A WHOLE-BILL ACTION, so it must be gated on the whole PARTY's bill — the
  // exact rows renderSplitBill() actually works on (T4 sweep, 2026-08-04). Gating it on
  // ordersOf(t) greyed "Split the bill" out on a merged CHILD whose party bill was listed in the
  // popup right behind the menu, with its ₹ due on the tile. Same filter as renderSplitBill,
  // deliberately duplicated rather than approximated, so the row and the screen it opens agree.
  const splittable = partyOrders(t).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled" && o.status !== "received");
  // …and REPRINTING includes a paid one: a guest can ask for the kitchen ticket again after the
  // bill is settled, and nothing about a reprint touches money. Same filter as the picker.
  const reprintable = ordersOf(t).filter((o) => o.status !== "cancelled");
  const row = (id, icon, label, sub, on) => `<button class="kotm-row" data-kotop="${id}" ${on ? "" : "disabled"}>
    <span class="kotm-ico">${icon}</span><span class="kotm-txt"><b>${label}</b><small>${sub}</small></span><span class="kotm-chev">›</span></button>`;
  let occupiedOthers = 0;
  // Count what the merge picker will actually OFFER (a joined table can't host a party), so the
  // row is never enabled onto an empty picker.
  // …AND THROUGH THE SECTION RULE, which is the other half of that predicate (T7 sweep, 2026-08-17).
  // renderMergePicker offers `inMySection(i) && canHostAParty(i)`; this count asked only the second
  // half, so a waiter with a section whose OTHER open tables all belong to someone else got an
  // enabled "🪢 Merge tables" row that opened "No other open tables to merge with." — the exact
  // thing the line above says must not happen, and the same fault the split row was fixed for on
  // 2026-08-04. Same filter as the picker, deliberately duplicated rather than approximated.
  for (let i = 1, n = tableCount(); i <= n; i++) if (String(i) !== String(t) && inMySection(i) && canHostAParty(i)) occupiedOthers++;
  const body =
    // A merged party doesn't shift (mig 264): unmerge first — the row says so instead of
    // offering a move the server will refuse.
    row("shift", "⇄", mergeGroupLabel(t) ? "Change table — unmerge first" : "Change table", "Move this party — orders &amp; calls included — to a free table", !!s && !mergeGroupLabel(t)) +
    row("merge", "🪢", "Merge tables", "Join another table's party — one table, one bill", !!s && occupiedOthers > 0) +
    row("movekot", "🧾", "Move a KOT to another table", "Send ONE order (one KOT) to a different table's bill", movable.length > 0) +
    row("moveitem", "🍛", "Move a single dish", "Send one dish to another table — new KOT there", movable.some((o) => dishRowsOf(o).some((r) => r.fromDb))) +
    // Splitting is a per-restaurant switch and it starts OFF (owner, 2026-08-01, mig 248 —
    // Settings → Bill in the manager panel). It also sits LAST, matching the manager's list: the
    // waiter and the manager must not be offered a different set of operations for one table.
    (splitBillOn()
      ? row("split", "🍴", "Split the bill", "Equal, a custom amount, by dish or by kitchen ticket — each part pays its own way", tshow("tablet_mark_paid") && splittable.length > 0)
      : "") +
    // 🖨 LAST, matching the manager's own list — the waiter and the manager must not be offered a
    // different set of operations for one table (owner's item 15, 2026-09-03). Enabled only when
    // there is a ticket to print: `reprintable` is the same filter renderReprintKotPicker uses, so
    // the row can never be enabled onto an empty picker.
    row("reprint", "🖨", "Print / reprint a KOT", "In the kitchen, marked DUPLICATE — or here on this device", reprintable.length > 0);
  const { dropLayer } = renderPickerShell(`T${esc(t)} — KOT &amp; table operations`, `<div class="pactions">${body}</div>`, "tablet-kot-menu", renderPanel);
  document.querySelectorAll("[data-kotop]").forEach((b) => (b.onclick = () => {
    dropLayer(); // drop this step's back layer before advancing (same rule as move-order's step 1)
    if (b.dataset.kotop === "shift" && s) renderShiftPicker(t, s);
    if (b.dataset.kotop === "merge" && s) renderMergePicker(t, s);
    if (b.dataset.kotop === "movekot") renderMoveOrderPicker(t);
    if (b.dataset.kotop === "moveitem") renderMoveItemPicker(t);
    if (b.dataset.kotop === "split") renderSplitBill(t);
    if (b.dataset.kotop === "reprint") renderReprintKotPicker(t);
  }));
}

// ── THE ONE SPLIT SCREEN (owner, 2026-08-28) ─────────────────────────────────────────────────
//
// HIS WORDS: "make you can only split with the kot option or small written if you want split on
// billing at bottom and both have same interface as the kot one" — and, asked what that interface
// must hold: "it should have equally split custom amount by dish by Kitchen ticket by each part,
// pays its own way. One part on somebody's tab pay later like everything. It should contain
// everything."
//
// WHAT THIS REPLACED. Splitting a bill existed TWICE on this panel, and the two were not the same
// screen — they had different layouts, different abilities and different endpoints:
//
//   · 🧾 KOT ▾ → Split the bill  had Equal / Custom / By dish, ONE payment method for the whole
//     split, no pay-later, and posted to /tables/:t/pay.
//   · 💳 Mark bill paid → Split payment  had a people-count row and By order, each part with its
//     OWN method including Pay later, and posted to /tables/:t/pay-split.
//
// So a waiter learned one and then met the other, and the one they were most likely to find could
// not do the thing they most want — put one person's share on a tab. Now there is ONE screen with
// all four ways to divide and all of the per-part abilities, reached from both doors.
//
// IT POSTS TO /pay-split, never the older /pay+splits. That is the route that carries a pay-later
// part (mig 352 — it checks the khata module and tablet_khata on top of tablet_mark_paid, and parks
// the tab), and both go through the same lib/paySplit.ts, which recomputes the due server-side and
// refuses parts that do not add up. The screen's own refusals exist so the waiter hears it first.
//
// EVERY FIGURE A PERSON MUST MATCH USES inrExact. A 40-paise gap reported as "₹0" is a refusal that
// names nothing and repeats forever (T7 sweep #7, 2026-08-22 — that fault was fixed in both screens
// the week before this merged them, and the rule survives here).
function renderSplitBill(t, opts = {}) {
  // The switch is checked at every door AND here. A screen a restaurant turned off must not open
  // because some future third door forgot to ask — and nothing on the server refuses a /pay-split
  // for a restaurant with splitting off, so this is the last gate there is.
  if (!splitBillOn()) { toast("Splitting a bill is turned off for this restaurant.", false); return; }
  const payable = partyOrders(t).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled" && o.status !== "received"); // a merged party splits its WHOLE bill
  if (!payable.length) { toast("Nothing to split — accept the order first, or it's already paid.", false); return; }
  const round2 = (n) => Math.round(n * 100) / 100;
  const rate = effRate();
  const due = round2(payable.reduce((sum, o) => sum + (Number(o.total) || 0) - (Number(o.discount) || 0) * (1 + rate), 0));
  const PAY_LATER = "Pay later";
  // Pay later only appears when the restaurant HAS it and this waiter may use it — otherwise the
  // server would refuse a part the screen offered, which is a button that exists only to fail.
  const WAYS = ["UPI", "Cash", "Card", "Other"].concat(tabletKhataOn() && tshow("tablet_khata") ? [PAY_LATER] : []);
  const MAX_PARTS = 12;

  let mode = "equal", n = 2;
  const legs = [];                 // { amount:String, method, note, khata, label }
  // By dish: every dish on the party's bill, each handed to a person. Money is the LINE's own
  // money, then scaled to the real due so tax and any discount ride along proportionally.
  const dishes = [];
  payable.forEach((o) => dishRowsOf(o).forEach((r) => dishes.push({ title: r.title, amt: (Number(r.price) || 0) * (r.qty || 1), qty: r.qty || 1, person: 1 })));
  const dishSubtotal = dishes.reduce((sum, d) => sum + d.amt, 0) || 1;
  // By kitchen ticket: one part per KOT, at what that ticket cost. The LAST part absorbs the
  // remainder because a bill's tax rounds ONCE over the whole bill while a per-ticket figure
  // rounds per ticket.
  const ticketAmounts = () => {
    // billdoc.js is THE money assembler — the same one the printed bill and the manager use. If it
    // somehow has not loaded, a ticket's own figure is unknowable, so this way of dividing simply
    // seeds zeros and the waiter is told by the running total rather than shown a wrong number.
    const oneTicket = (o) => {
      if (typeof LFH_BILLDOC === "undefined" || !LFH_BILLDOC.billMoney) return 0;
      const m = LFH_BILLDOC.billMoney([o], state.data.settings || {}) || {};
      return round2(Number(m.total) || 0);
    };
    const raw = payable.map(oneTicket);
    const head = raw.slice(0, -1);
    return head.concat([round2(due - head.reduce((a, x) => a + x, 0))]);
  };

  const legSum = () => round2(legs.reduce((sum, l) => sum + (Number(l.amount) || 0), 0));
  const legLeft = () => round2(due - legSum());
  const keepWay = (i) => (legs[i] && legs[i].method) || (i === 0 ? "UPI" : "Cash");

  // Seed the parts for whichever way of dividing is chosen. A method already picked on a row is
  // KEPT — changing how the bill is divided must not silently reset how someone is paying.
  // A ONE-TICKET BILL CANNOT BE SPLIT BY TICKET (the old By-order button said so and the sentence
  // was lost when the two screens were merged — T7, 2026-08-29). Without this the tab produced a
  // SINGLE part, which is not a split: Take payment then refused "a split needs at least two parts"
  // with nothing on screen explaining why, and the one-ticket bill is the common case.
  const canTicket = () => payable.length >= 2;
  const seed = () => {
    if (mode === "ticket") {
      const amts = ticketAmounts();
      const kept = legs.slice();
      legs.length = 0;
      payable.forEach((o, i) => legs.push({
        amount: String(amts[i]), method: (kept[i] || {}).method || keepWay(i), note: (kept[i] || {}).note || "",
        khata: (kept[i] || {}).khata || null,
        label: o.kot_no != null ? `KOT #${o.kot_no}` : `Order ${String(o.id || "").slice(0, 6)}`,
      }));
      n = legs.length;
      return;
    }
    const amts = mode === "dish"
      ? (() => {
          const per = Array.from({ length: n }, () => 0);
          dishes.forEach((d) => { per[Math.min(d.person, n) - 1] += d.amt; });
          const scaled = per.map((a) => round2((a / dishSubtotal) * due));
          const drift = round2(due - scaled.reduce((sum, x) => sum + x, 0));
          scaled[scaled.length - 1] = round2(scaled[scaled.length - 1] + drift);
          return scaled;
        })()
      : (() => {                                   // equal, and the starting point for custom
          // A PAISA NUDGE BEFORE ROUNDING DOWN, or one person quietly pays the others' rounding
          // (split-bill 500, 2026-08-29). ₹555.55 ÷ 5 is ₹111.11 exactly in money, but in binary it is
          // 111.10999999999999, so (due/n)*100 lands on 11110.999999999998 and Math.floor takes it to
          // 11110 — a whole paisa short, five times over, and the LAST part absorbs all 5. On ₹9999.99
          // ÷ 9 the last person paid 9 paise more than everyone else, on a screen whose whole promise
          // is "same amount each". The nudge is far smaller than a paisa, so it can only rescue a
          // value that was already a hair under a whole paisa; a genuine 111.109 still floors to 111.10.
          const each = Math.floor((due / n) * 100 + 1e-6) / 100;
          const out = Array.from({ length: n }, () => each);
          out[n - 1] = round2(due - each * (n - 1));
          return out;
        })();
    const kept = legs.slice();
    legs.length = 0;
    for (let i = 0; i < n; i++) legs.push({
      amount: String(amts[i]), method: (kept[i] || {}).method || keepWay(i),
      note: (kept[i] || {}).note || "", khata: (kept[i] || {}).khata || null, label: "",
    });
  };
  // …and the count itself is clamped BEFORE any of them seed. `ticket` sets n from how many tickets
  // there are, which can be 1 — so leaving ticket for Equal/Custom/By dish once carried that 1 over
  // and drew a "split" with a single part.
  const seedFrom = (m) => {
    mode = m;
    if (mode !== "ticket") n = Math.max(2, Math.min(MAX_PARTS, n));
    seed();
  };

  const shell = `
    <div class="sb-tabs">
      <button class="btn small sb-tab" data-mode="equal">Equal</button>
      <button class="btn small sb-tab" data-mode="custom">Custom</button>
      <button class="btn small sb-tab" data-mode="dish">By dish</button>
      <button class="btn small sb-tab${payable.length >= 2 ? "" : " sb-tab-off"}" data-mode="ticket"${payable.length >= 2 ? "" : ` title="This bill is one kitchen ticket — there is nothing to divide by"`}>By kitchen ticket</button>
    </div>
    <div class="sb-body"></div>
    <div class="sb-sum"></div>
    <!-- THE TIP IS NOT ONE OF THE PARTS (owner, 2026-08-30). The parts must still add up to the
         bill EXACTLY — lib/paySplit.ts recomputes the due server-side and refuses anything else —
         so the tip sits below them, on top of the whole bill, the same way it sits below the TOTAL
         on paper. One tip for the table, not one per person: a tip on every part is how you
         double it. Same three linked boxes as the payment sheet, and the same class names, so the
         spinner-arrow rule and everything else already written for them applies here too. -->
    <div class="sb-tip" style="margin:10px 0 12px;padding:12px;border-radius:12px;border:1px dashed var(--line);background:var(--panel-2)">
      <div style="font-size:13px;font-weight:700;margin:0 0 3px">Add a tip? <span style="color:var(--muted);font-weight:400">— optional, extra for staff on top of the whole bill</span></div>
      <div style="font-size:11.5px;color:var(--muted);margin:0 0 8px">Change any one of the three — the other two follow. It is not divided between the parts.</div>
      <div style="display:flex;align-items:flex-end;gap:8px;margin:0 0 8px">
        <label style="flex:1;min-width:0"><span style="display:block;font-size:11.5px;color:var(--muted);font-weight:600;margin:0 0 4px">Tip %</span>
          <!-- step="0.01" here TOO. The split screen grew its own tip row on 2026-08-30 (PR #1187), with
               the same three class names and the same step="1" the payment sheet's copy had just been
               fixed for — the fault came back in a new place on the same day. verify:money-boxes now
               checks EVERY box carrying these names, not the first one it finds. -->
          <input type="number" inputmode="decimal" min="0" step="0.01" class="pay-tip-pct" placeholder="0" style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px;font-variant-numeric:tabular-nums"></label>
        <span style="font-weight:800;color:var(--muted);padding-bottom:11px">=</span>
        <label style="flex:1;min-width:0"><span style="display:block;font-size:11.5px;color:var(--muted);font-weight:600;margin:0 0 4px">Tip amount (₹)</span>
          <input type="number" inputmode="decimal" min="0" step="0.01" class="pay-tip-amt" placeholder="0" style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px;font-variant-numeric:tabular-nums"></label>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px">${[0, 5, 10, 15].map((k) => `<button type="button" class="btn pay-tip-pick" data-tip-pct="${k}" style="min-height:44px;padding:0 14px;font-weight:700">${k ? k + "%" : "None"}</button>`).join("")}</div>
      <label style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--bg);border:1px solid var(--line)">
        <b style="font-size:13.5px">They paid in all</b>
        <span style="display:inline-flex;align-items:center;gap:2px;color:var(--gold-strong);font-weight:800;font-size:15px">₹
          <input type="number" inputmode="decimal" min="0" step="0.01" class="pay-tip-paid" aria-label="Total the customer paid, tip included" style="width:8ch;border:0;background:transparent;padding:0;margin:0;text-align:right;color:var(--gold-strong);font-weight:800;font-size:15px;font-family:inherit;font-variant-numeric:tabular-nums;outline:none"></span>
      </label>
      <div class="pay-tip-msg" role="status" style="display:none;font-size:12px;font-weight:600;color:#f59e0b;margin:8px 0 0"></div>
    </div>
    <!-- inrExact, NOT inr, on BOTH the title and this button (T7 sweep #7 third pass, 2026-08-30).
         They are the figure the waiter reads while typing custom amounts, so they are figures a
         person must MATCH — the whole reason inrExact exists. On a ₹1,065.75 bill the title and
         the button said "₹1,066": type 500 + 566 to reach it and the screen refuses with "₹0.25
         more than the bill", and the true total appears nowhere on screen until the parts already
         balance. inrExact prints whole rupees when the bill has no paise, so a tidy bill looks
         exactly as it did. -->
    <button class="btn primary big sb-go" style="width:100%">💳 Collect ${inrExact(due)} in parts</button>`;
  const { dropLayer } = renderPickerShell(
    `Split ${esc(tableLabel(t))}'s bill · ${inrExact(due)}`, shell, "tablet-split-bill",
    typeof opts.onBack === "function" ? opts.onBack : renderPanel,
  );
  const p = $("#panel");
  const bodyEl = p.querySelector(".sb-body"), sumEl = p.querySelector(".sb-sum");

  // ── THE TIP (owner, 2026-08-30) ──────────────────────────────────────────────────────────────
  // Seeded from what is ALREADY on the bill, because there are two doors to this screen and one of
  // them (the payment sheet's "Split this bill →") records a tip before handing over. Showing it
  // means a waiter who typed 200 there does not think it was lost and type it again. The write is
  // an overwrite, not an increment, so re-recording the same figure is harmless either way — but a
  // box that silently forgets what you typed is not.
  let tip = Math.max(0, Math.round(((payable[0] && Number(payable[0].tip)) || 0) * 100) / 100);
  {
    const BD = window.LFH_BILLDOC || {};
    const TIP_MAX = Number(BD.TIP_MAX) || 100000;
    const pctIn = p.querySelector(".pay-tip-pct");
    const amtIn = p.querySelector(".pay-tip-amt");
    const paidIn = p.querySelector(".pay-tip-paid");
    const msgEl = p.querySelector(".pay-tip-msg");
    const goBtn = p.querySelector(".sb-go");
    if (pctIn && amtIn && paidIn) {
      const say = (m) => { msgEl.textContent = m || ""; msgEl.style.display = m ? "" : "none"; };
      const paintTip = (typing) => {
        const pct = due > 0 ? Math.round((tip / due) * 1000) / 10 : 0;
        if (typing !== "pct") pctIn.value = tip ? String(pct) : "";
        if (typing !== "amt") amtIn.value = tip ? String(round2(tip)) : "";
        if (typing !== "paid") paidIn.value = String(Math.round(due + tip));
        p.querySelectorAll(".pay-tip-pick").forEach((x) => x.classList.toggle("primary", Number(x.dataset.tipPct) === pct));
        // The button names what will actually be collected. The PARTS still add up to the bill —
        // the tip is on top — so saying only the bill here would under-state the money in hand.
        // "in parts" is dropped once there is a tip: the parts are listed directly above and the
        // longer label wrapped, leaving the word "tip" alone on a second line at 390px. Measured.
        if (goBtn) goBtn.textContent = tip > 0
          ? `💳 Collect ${inrExact(due)} + ${inrExact(tip)} tip`
          : `💳 Collect ${inrExact(due)} in parts`;
      };
      const setTip = (v, typing) => {
        const want = Math.max(0, Number(v) || 0);
        if (want > TIP_MAX) say(`The most a tip can be is ${inr(TIP_MAX)} — check that figure.`);
        else if (want > due && due > 0) say(`That is a tip bigger than the bill (${inrExact(due)}). Fine if they meant it.`);
        else say("");
        tip = Math.min(want, TIP_MAX);
        paintTip(typing);
      };
      p.querySelectorAll(".pay-tip-pick").forEach((b) => (b.onclick = () => setTip(round2(due * (Number(b.dataset.tipPct) || 0) / 100))));
      pctIn.oninput = () => setTip(round2(due * (parseFloat(pctIn.value) || 0) / 100), "pct");
      amtIn.oninput = () => setTip(parseFloat(amtIn.value), "amt");
      paidIn.oninput = () => {
        const raw = paidIn.value.trim(), q = parseFloat(raw);
        if (raw === "" || !(q >= 0)) return;           // blank is "about to type", never ₹0
        setTip(BD.tipFromPaid ? BD.tipFromPaid(due, q) : Math.max(0, round2(q - due)), "paid");
        if (q < due) say(`That is less than the bill (${inrExact(due)}) — this box is the TOTAL they handed over, tip included.`);
      };
      [pctIn, amtIn, paidIn].forEach((b) => { b.onblur = () => paintTip(); });
      paidIn.onfocus = () => { try { paidIn.select(); } catch (e) {} };
      paintTip();
    }
  }

  // THE LINE MUST AGREE WITH THE BUTTON UNDER IT (T7, 2026-08-29 — found by the fresh 500-phase
  // plan, and inherited from the payment sheet's old split panel rather than introduced here).
  // An EMPTY part contributes 0, so the arithmetic still balanced and the line went green — while
  // Take payment refused with "Every part needs an amount above zero". Reachable in one tap:
  // ＋ Add another part seeds the new box with the remainder, which is "" when the bill is already
  // fully covered. So the waiter saw a green tick, pressed the button, and was told no.
  // That is the same fault as the ₹0 shortfall fixed a week earlier — two halves of one screen
  // disagreeing about the same state — so the empty part is named FIRST, before the arithmetic.
  const refreshSum = () => {
    const blank = legs.filter((l) => !(Number(l.amount) > 0)).length;
    if (blank) {
      sumEl.textContent = blank === 1 ? "One part still needs an amount" : `${blank} parts still need an amount`;
      sumEl.style.color = "#e11d48";
      return;
    }
    const left = legLeft();
    sumEl.textContent = left === 0 ? `✓ The parts add up to ${inrExact(due)}`
      : left > 0 ? `${inrExact(left)} still to cover` : `${inrExact(-left)} more than the bill`;
    sumEl.style.color = left === 0 ? "#16a34a" : "#e11d48";
  };

  const partRows = () => legs.map((l, i) => `
    <div class="sb-row" data-i="${i}">
      <div class="sb-who">${l.label ? esc(l.label) : `Person ${i + 1}`}</div>
      <!-- step="0.01", NOT "1" (owner, 2026-08-29, on the manager's copy of this box; the tablet had
           it too). Every split amount is money with paise, and THIS SCREEN FILLS THEM IN ITSELF —
           an even split of ₹459.90 three ways writes 153.29 / 153.29 / 153.32 into these boxes. The
           box was refusing the numbers the app had just put in it, and a waiter correcting one by
           hand was forced to round to whole rupees. -->
      <input type="number" inputmode="decimal" min="0" step="0.01" class="sb-amt" value="${esc(l.amount)}"
        placeholder="₹ amount"${mode === "equal" ? " readonly" : ""}>
      <select class="sb-way">${WAYS.map((m) => `<option${m === l.method ? " selected" : ""}>${esc(m)}</option>`).join("")}</select>
      ${legs.length > 2 && mode !== "ticket" ? `<button type="button" class="sb-del" aria-label="Remove this part">✕</button>` : `<span></span>`}
      ${l.method === "Other" ? `<input type="text" class="sb-note" maxlength="60" value="${esc(l.note || "")}" placeholder="What kind? e.g. wallet, cheque">` : ""}
      ${l.method === PAY_LATER ? `<button type="button" class="btn small sb-who-btn">${l.khata ? "📒 " + esc(l.khata.label) + " — change" : "📒 Who owes this? — pick a person"}</button>` : ""}
    </div>`).join("");

  const render = () => {
    p.querySelectorAll(".sb-tab").forEach((b) => b.classList.toggle("primary", b.dataset.mode === mode));
    // THE SAME COUNT CONTROL AS THE MANAGER (owner, 2026-08-29: "for both the interface should be
    // similar"). It was a − 2 ＋ stepper here and a row of chips there; the chips win on both
    // because getting to five people is ONE tap instead of three, mid-service, one-handed. The
    // chips stop at 6 and ＋ Add another part carries on to the twelve the server allows.
    const stepper = mode === "ticket" ? "" : `
      <div class="muted small sb-nlbl">How many are paying?</div>
      <div class="sb-nrow">${[2, 3, 4, 5, 6].map((k) => `<button type="button" class="btn small sb-nb" data-n="${k}">${k}</button>`).join("")}</div>`;
    const dishList = mode !== "dish" ? "" : `
      <div class="muted small" style="margin:0 0 6px">Tap a dish to hand it to the next person:</div>
      ${dishes.map((d, i) => `<button type="button" class="btn small sb-dish" data-dish="${i}"><span>${d.qty > 1 ? d.qty + "× " : ""}${esc(d.title)}</span><span>P${d.person} · ${inr(d.amt)}</span></button>`).join("")}`;
    const ticketNote = mode !== "ticket" ? "" : `<div class="muted small" style="margin:0 0 6px">One part per kitchen ticket, at what that ticket cost. Change any amount if you need to.</div>`;
    bodyEl.innerHTML = stepper + dishList + ticketNote + partRows()
      + (mode === "ticket" ? "" : `<button type="button" class="btn small sb-add" style="width:100%;margin-top:2px">＋ Add another part</button>`);

    // The count shown is the number of parts ON SCREEN — the same rule the manager learned on
    // 2026-08-29, so ＋ Add another part and a row's ✕ both move it.
    bodyEl.querySelectorAll(".sb-nb").forEach((b) => {
      b.classList.toggle("primary", Number(b.dataset.n) === legs.length);
      b.onclick = () => {
        n = Math.max(2, Math.min(MAX_PARTS, Number(b.dataset.n)));
        dishes.forEach((d) => { if (d.person > n) d.person = 1; });
        seed(); render();
      };
    });
    bodyEl.querySelectorAll(".sb-dish").forEach((b) => (b.onclick = () => {
      const d = dishes[Number(b.dataset.dish)];
      d.person = d.person >= n ? 1 : d.person + 1;
      seed(); render();
    }));
    bodyEl.querySelectorAll(".sb-row").forEach((row) => {
      const i = Number(row.dataset.i);
      // Typing must not re-render — that would blur the box mid-keystroke.
      row.querySelector(".sb-amt").oninput = (e) => { legs[i].amount = e.target.value; refreshSum(); };
      row.querySelector(".sb-way").onchange = (e) => {
        legs[i].method = e.target.value;
        if (legs[i].method !== PAY_LATER) legs[i].khata = null;
        render();
      };
      const nEl = row.querySelector(".sb-note"); if (nEl) nEl.oninput = (e) => { legs[i].note = e.target.value; };
      const dEl = row.querySelector(".sb-del"); if (dEl) dEl.onclick = () => { legs.splice(i, 1); n = legs.length; render(); };
      // The SAME person sheet the whole-bill Pay Later button opens, so there is one picker.
      const wEl = row.querySelector(".sb-who-btn");
      if (wEl) wEl.onclick = async () => {
        const picked = await openKhataPersonSheet(Number(legs[i].amount) || 0, t);
        if (!picked) return;
        legs[i].khata = picked.customer_id
          ? { customer_id: picked.customer_id, label: picked.name || "that person" }
          : { name: picked.name, phone: picked.phone || "", label: picked.name };
        render();
      };
    });
    const addBtn = bodyEl.querySelector(".sb-add");
    if (addBtn) addBtn.onclick = () => {
      if (legs.length >= MAX_PARTS) { toast(`A bill can be split into at most ${MAX_PARTS} parts.`, false); return; }
      const left = legLeft();
      legs.push({ amount: left > 0 ? String(left) : "", method: "Cash", note: "", khata: null, label: "" });
      n = legs.length;
      if (mode === "equal") mode = "custom";     // an added part means the amounts are no longer even
      render();
    };
    refreshSum();
  };

  p.querySelectorAll(".sb-tab").forEach((b) => (b.onclick = () => {
    const want = b.dataset.mode;
    if (want === "ticket" && !canTicket()) {
      toast(`This bill is one kitchen ticket — split it equally, by a custom amount, or by dish.`, false);
      return;                                  // stay on the way of dividing that is already chosen
    }
    seedFrom(want); render();
  }));
  seedFrom(mode); render();

  // STAYS ENABLED AND SAYS WHY IT WON'T GO — a disabled button that swallows the tap is
  // indistinguishable from a broken one, and this is the most repeated money control in a service.
  p.querySelector(".sb-go").onclick = () => {
    const left = legLeft();
    if (legs.some((l) => !(Number(l.amount) > 0))) { toast("Every part needs an amount above zero — remove the empty one.", false); return; }
    if (legs.length < 2) { toast("A split needs at least two parts.", false); return; }
    if (left !== 0) { toast(left > 0 ? `${inrExact(left)} of the bill is still uncovered.` : `The parts are ${inrExact(-left)} more than the bill.`, false); return; }
    const later = legs.filter((l) => l.method === PAY_LATER);
    if (later.some((l) => !l.khata)) { toast("Tap “Who owes this?” on the pay-later part and pick a person.", false); return; }
    if (later.length > 1) { toast("Only one part can be pay-later — put the rest on cash, card or UPI.", false); return; }
    const splits = legs.map((l) => ({
      amount: round2(Number(l.amount)),
      method: l.method,
      note: (l.note || "").trim().slice(0, 200) || null,
      ...(l.method === PAY_LATER && l.khata
        ? { khataCustomerId: l.khata.customer_id || null, khataName: l.khata.name || null, khataPhone: l.khata.phone || null }
        : {}),
    }));
    const how = splits.map((l) => `${inr(l.amount)} ${l.method}`).join(" + ");
    dropLayer();
    actGated("POST", `/tables/${t}/pay-split`, { splits }, {
      message: "Enter a manager PIN to mark this bill paid.",
      // ASK THE QUEUE BEFORE CLAIMING THE MONEY ARRIVED (T28, 2026-08-30 — the manager panel had
      // the same gap, found the same day). actGated hands the server's own answer to onSuccess and
      // every other write on this screen reads it; this one threw it away, so offline the waiter
      // was told "Bill paid in 3 parts" and offered an UNDO for a payment the server had never
      // seen. savedMsg() is the sentence the rest of the panel already uses for exactly this.
      onSuccess: (r) => {
        // The tip goes with the bill, once, after the split is really through — and it is NOT one
        // of the parts, so it never has to balance against the due.
        void recordTip(t, tip);
        if (isQueued(r)) { toast(savedMsg(r)); return; }
        offerPayUndo(t, { message: `Bill paid in ${splits.length} parts — ${how}${tip > 0 ? ` · ${inrExact(tip)} tip` : ""}` });
      },
    });
  };
}

// Move ONE dish line to another table's bill — pick the dish (grouped by KOT), then
// the target table. The dish gets a fresh KOT there; both bills re-price server-side.
function renderMoveItemPicker(t) {
  const orders = ordersOf(t).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled");
  const groups = orders.map((o) => {
    const items = dishRowsOf(o).filter((r) => r.fromDb);
    if (!items.length) return "";
    return `<div class="muted small" style="margin:8px 2px 4px">KOT #${esc(o.kot_no ?? "—")}</div>` +
      items.map((r) => `<button class="btn" style="text-align:left;display:flex;justify-content:space-between;width:100%" data-mvitem="${esc(r.id)}"><span>${r.qty > 1 ? r.qty + "× " : ""}${esc(r.title)}</span><span>${inr(r.price * (r.qty || 1))}</span></button>`).join("");
  }).join("");
  const bodyHtml = `<div class="muted small" style="margin-bottom:10px">Pick the dish to move off T${esc(t)} (a multi-plate line moves whole):</div><div class="pactions">${groups || `<div class="muted">No movable dishes.</div>`}</div>`;
  const { dropLayer } = renderPickerShell("Move a dish", bodyHtml, "tablet-moveitem-picker", renderPanel);
  document.querySelectorAll("[data-mvitem]").forEach((b) => (b.onclick = () => { dropLayer(); renderMoveItemTarget(t, b.dataset.mvitem); }));
}
function renderMoveItemTarget(t, itemId) {
  const tiles = [];
  // NEVER OFFER A TABLE THIS DISH ALREADY SHARES A BILL WITH (T7 sweep, 2026-08-17). Its sibling
  // renderMoveOrderTarget has excluded party mates since 2026-08-11 for a reason that applies word
  // for word here: while T26+T27 are one party, T26 was listed on T27's dish picker, labelled with
  // the party's own state — and the server resolves a merged destination to the party head and then
  // refuses with reason 'same_table' ("That dish is already on that table."), which is exactly what
  // this was measured doing. The only possible outcome of that button was a confusing refusal.
  // partyTablesOf(t) includes t itself, so this also covers the old `String(i) === String(t)` test.
  const mates = new Set(partyTablesOf(t).map(String));
  for (let i = 1, n = tableCount(); i <= n; i++) {
    if (mates.has(String(i))) continue;
    // SAME TWO RULES AS EVERY OTHER DESTINATION PICKER (T4 sweep, 2026-08-04). This one offered
    // every table in the restaurant while its three siblings (renderMoveOrderTarget,
    // renderMergePicker, renderShiftPicker) all filter by section — so a sectioned waiter was
    // shown tables the server refuses (it checks BOTH ends of a move), i.e. a button that exists
    // only to fail. And a merged CHILD was offered even though it has no bill of its own to
    // receive the dish — the party's money lives on the parent, which is already in this list.
    if (!inMySection(i)) continue;
    if (mergeParentOf(i)) continue;
    const st2 = tileState(i);
    tiles.push(`<button class="kotm-tile${tileIsOpen(i) ? " occ" : ""}" data-mvto="${i}"><b>T${i}</b><small>${st2.label}</small></button>`);
  }
  const bodyHtml = `<div class="muted small" style="margin-bottom:10px">Send this dish to which table? (it gets its own new KOT there)</div><div class="kotm-grid">${tiles.length ? tiles.join("") : `<div class="muted">No other table you serve can take this dish right now.</div>`}</div>`;
  const { dropLayer } = renderPickerShell("Move dish →", bodyHtml, "tablet-moveitem-target", () => renderMoveItemPicker(t));
  document.querySelectorAll("[data-mvto]").forEach((b) => (b.onclick = () => {
    const to = b.dataset.mvto;
    dropLayer();
    actGated("POST", `/order-items/${itemId}/move`, { to }, {
      message: "Enter a manager PIN to move this dish.",
      toast: `Dish moved to table ${to} (new KOT)`,
    });
  }));
}

// MERGE picker — the opposite of the shift picker: only OCCUPIED tables show, and the
// party JOINS that table's bill (one bill; this table frees up). Confirms first.
// PIN mode rides the normal actGated round-trip (the server's tabletPerm challenges).
function renderMergePicker(t, s) {
  const occ = [];
  // inMySection: a waiter with a section can only merge into a table they also hold — the
  // server refuses the other direction anyway (both ends of a move are checked), so
  // offering it would just be a button that fails.
  for (let i = 1, n = tableCount(); i <= n; i++) { if (String(i) !== String(t) && inMySection(i) && canHostAParty(i)) occ.push(i); }
  const btns = occ.length
    ? `<div class="kotm-grid">` + occ.map((i) => `<button class="kotm-tile occ" data-mergeto="${i}"><b>T${i}</b><small>${tileState(i).label}</small></button>`).join("") + `</div>`
    : `<div class="muted">No other open tables to merge with.</div>`;
  const bodyHtml = `<div class="muted small" style="margin-bottom:10px">Everything — orders, guests &amp; bill — joins the other table as ONE bill. The LOWEST table number holds it:</div><div class="shiftgrid">${btns}</div>`;
  const { dropLayer } = renderPickerShell(`Merge T${esc(t)} into →`, bodyHtml, "tablet-merge-picker", renderPanel);
  document.querySelectorAll("[data-mergeto]").forEach((b) => (b.onclick = async () => {
    const to = b.dataset.mergeto;
    // NAME THE TABLE THAT WILL ACTUALLY HOLD THE BILL (T7, 2026-08-17). The server keeps the LOWEST
    // table number and moves the other party's rows onto it — a deliberate rule, written in
    // lfh_staff_merge_tables: "If the caller merged 6 into 7, we keep 6 … the floor always names the
    // same table as the one in charge." This screen did not know that: merging T24 into T25 promised
    // "ONE bill on T25" and the bill landed on T24, so the waiter went looking on the wrong table.
    // The MANAGER panel was fixed for exactly this on 2026-08-11 and words it the same way, with the
    // two amounts, so a waiter and a manager read one sentence about one rule.
    const keeps = (Number(t) <= Number(to)) ? String(t) : String(to);
    const mine = tableAgg(t).due || 0;
    const theirs = Number((summaryTile(to) || {}).due) || 0;
    const money = (mine > 0 || theirs > 0) ? ` ${inr(mine)} + ${inr(theirs)} → ${inr(mine + theirs)} on one bill.` : "";
    if (!(await confirmDialog(`Merge ${tableLabel(t)} into ${tableLabel(to)}? They become ONE party on ONE bill, held by ${tableLabel(keeps)} (the lowest table number).${money}`, "Merge"))) return;
    dropLayer();
    actGated("POST", `/sessions/${s.id}/merge`, { to }, {
      message: "Enter a manager PIN to merge these tables.",
      // TAKE IT BACK, FOR FIFTEEN SECONDS (owner, 2026-08-17: "the timer of undo should be of
      // fifteen second"). Longer than the panel's other undo bars (5s for serve / accept / settle)
      // and deliberately so: joining two bills is a bigger thing to notice than serving a dish, and
      // a waiter mid-room may only look down a few seconds later. Undo runs the SAME unmergeTable()
      // the detail's ⇹ button runs — with the question skipped, because tapping UNDO is the answer.
      // FOLLOW THE TABLE THE SERVER KEPT, never the one that was tapped. `r.parent_table` /
      // `r.child_table` are what really happened; guessing from `to` sent the waiter to the child
      // and pointed UNDO at a table that was never joined to anything, so tapping undo answered
      // "that table isn't merged" and the merge stayed. (Caught by the merge walk, 2026-08-17 —
      // the manager panel follows the server's answer for the same reason.)
      onSuccess: (r) => {
        const holder = String((r && r.parent_table) || ((Number(t) <= Number(to)) ? t : to));
        const joined = String((r && r.child_table) || ((Number(t) <= Number(to)) ? to : t));
        state.table = holder;
        renderFloor(); renderPanel();
        if (window.LFH_UNDO) {
          LFH_UNDO.show({
            message: `${tableLabel(joined)} joined ${tableLabel(holder)} — one bill`,
            sub: `tap undo to separate them again`,
            icon: "🪢",
            seconds: 15,
            onUndo: () => unmergeTable(joined, { silent: true }),
          });
        } else toast(`${tableLabel(joined)} joined ${tableLabel(holder)} — one bill`);
      },
    });
  }));
}

// WHY NOT THIS TABLE — one definition, used to decide the list AND to label the dimmed ones, so the
// two can never disagree. The four reasons and their exact words are the manager panel's
// (shiftBlocked in public/panels/editor/app.js): a party can't move onto itself, onto a table joined
// to another, onto a table that already has a party row (even the invisible empty one the floor draws
// as Free — see canTakeAParty), or onto one a guest has already asked to be seated at.
// `not yours` is this panel's fifth, and only this panel has it: the tablet is the one screen with
// waiter sections.
function shiftBlockedWhy(i, from) {
  if (String(i) === String(from)) return "this one";
  if (mergeParentOf(i) || mergeChildrenOf(i).length) return "joined";
  if (tableHasAnyParty(i)) return "taken";
  if ((state.summary.requests || []).some((r) => String(r.table_number) === String(i))
      || ((state.summary.tiles || {})[String(i)] || {}).hasReq) return "wants in";
  if (!inMySection(i)) return "not yours";
  return "";
}
function renderShiftPicker(t, s) {
  const n = tableCount();
  const free = [];
  // FREE = can really TAKE a party, read from the summary — works for every tile, not just the
  // selected one whose slice is cached. (Two-tier: the grid no longer holds every table's session.)
  // canTakeAParty(), NOT !tileIsOpen(): a table with an open-but-empty session is drawn Free by the
  // owner's own rule and is refused by the server as taken, so listing it here was a button whose
  // only possible outcome was "That table is already taken — pick a free one". See the long note by
  // canTakeAParty for the measurement and for the manager panel's identical rule.
  for (let i = 1; i <= n; i++) { if (String(i) !== String(t) && inMySection(i) && canTakeAParty(i)) free.push(i); }
  // ── THE WHOLE FLOOR, WITH THE ONES THAT CAN'T TAKE IT DIMMED AND LABELLED (owner picked it as
  // item 11, 2026-09-03) ──────────────────────────────────────────────────────────────────────────
  // Until now this grid listed only the tables that COULD take the party, so after the free-table
  // rule was made honest it got shorter and a waiter had no way to tell whether a table was missing
  // because someone was sitting at it, because it was joined to another, because a guest had asked
  // for it, or because it simply isn't in their section. The manager panel has shown the whole floor
  // with a one-word reason on each unavailable tile for a while; this is the same thing, in the same
  // four words, so the two doors read alike.
  //
  // ONE DELIBERATE DIFFERENCE FROM THE MANAGER, and it is this panel's own rule: the manager renders
  // its dimmed tiles `disabled`, and on a touch screen a disabled button SWALLOWS the tap — the exact
  // fault "💳 Mark bill paid" was fixed for here (T7 improvement I1) and the reason style.css says
  // "Never `disabled` — a disabled tab on a touch panel swallows the tap". So a dimmed tile here
  // stays tappable and SAYS its reason out loud. A waiter carrying plates has no hover.
  const cell = (i) => {
    const why = shiftBlockedWhy(i, t);
    const label = esc(tname(i) || "T" + i);
    return why
      ? `<button class="btn shiftpick shiftpick-off" data-shiftwhy="${esc(why)}" data-shiftlabel="${label}">${label}<small>${esc(why)}</small></button>`
      : `<button class="btn shiftpick" data-shiftto="${i}">${label}<small>free</small></button>`;
  };
  const all = [];
  for (let i = 1; i <= n; i++) all.push(cell(i));
  const btns = all.join("")
    + (free.length ? "" : `<div class="muted" style="grid-column:1/-1;padding:10px 2px;line-height:1.5">No free table to move this party to — every other table is taken, joined, waiting on a guest, or outside your section.</div>`);
  const body = `<div class="muted small" style="margin-bottom:10px">Move this party — orders &amp; calls included — to a free table. Dimmed tables can't take it:</div><div class="shiftgrid">${btns}</div>`;
  const { dropLayer } = renderPickerShell(`Move ${esc(tname(t) || "T" + t)} →`, body, "tablet-shift-picker", renderPanel);
  // A DIMMED TILE STILL ANSWERS. Never a silent return — the words are the same four the tile itself
  // carries, said as a sentence a waiter can act on.
  const WHY_SAYS = {
    "this one": "That's the table this party is already on.",
    joined: "That table is joined with another and shares its bill — unmerge it first.",
    taken: "There's already a party on that table. Move them off it first, or pick another.",
    "wants in": "A guest has asked to be seated there — answer their request first.",
    "not yours": "That table isn't in your section — ask your manager to add it.",
  };
  document.querySelectorAll("[data-shiftwhy]").forEach((b) => (b.onclick = () => {
    const why = b.dataset.shiftwhy;
    toast(`${b.dataset.shiftlabel}: ${WHY_SAYS[why] || "That table can't take this party."}`, false);
  }));
  document.querySelectorAll("[data-shiftto]").forEach((b) => (b.onclick = () => {
    const to = b.dataset.shiftto;
    dropLayer();
    runOptimistic(
      () => { if (s) s.table_number = to; state.data.orders.forEach((o) => { if (String(o.table_number) === String(t)) o.table_number = to; }); state.table = to; },
      () => api("POST", `/sessions/${s.id}/shift`, { to }),
    );
  }));
}

// ── 🖨 PRINT / REPRINT A KITCHEN TICKET, FROM THE WAITER'S HANDHELD (owner's item 15, 2026-09-03) ─
//
// The waiter tablet could do everything with a ticket except ask for it again. Reprinting a KOT
// lived only on the manager panel, so a waiter standing at the pass with a ticket the printer ate
// had to walk to the till — on the device that is always in the room where the problem is. Put to
// the owner with the two things I would NOT move (a credit note, and restoring a bill settled more
// than 30 minutes ago — both a manager's by his own rule) and he picked it.
//
// The SAME two destinations the manager offers, in the same words, because one action must not mean
// two things depending on which screen asked:
//   · "in the kitchen" — the real answer on a handheld. It becomes a durable job (mig 269) the
//     kitchen screen claims and prints with the big DUPLICATE banner, and if the kitchen never
//     picks it up the manager's floor strip says so. Nothing prints on the waiter's own device,
//     which usually has no printer at all.
//   · "here, on this device" — the fallback, for a tablet that IS plugged into something. Through
//     a hidden iframe rather than a pop-up window, exactly like the manager's, so there is no
//     pop-up to allow and nothing left on screen.
//
// The DOCUMENT is not written here. LFH_BILLDOC.kotDocHtml is the one kitchen ticket in this
// product ("One bill, one KOT, ONE file"), and it is handed `lines` rather than ready-made markup
// so it applies its own shared-note rule — the manager's call pre-renders and misses that. Its
// `reprint: true` flag is what brands the paper DUPLICATE; the wording lives in billdoc so every
// panel's reprint looks identical.
function printTicketHere(html) {
  // A hidden iframe, and it is removed only AFTER the browser says it finished — the manager's own
  // comment explains why a blind timer is wrong: it deletes the frame while the print preview is
  // still open and Chrome logs a dead-callback error.
  try {
    const ifr = document.createElement("iframe");
    ifr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(ifr);
    const d = ifr.contentWindow.document; d.open(); d.write(html); d.close();
    setTimeout(() => {
      const w = ifr.contentWindow;
      let done = false;
      const cleanup = () => { if (done) return; done = true; try { ifr.remove(); } catch (e) {} };
      try { w.onafterprint = cleanup; } catch (e) {}
      try { w.focus(); w.print(); } catch (e) { cleanup(); return; }
      setTimeout(cleanup, 60000);   // a preview somebody walked away from
    }, 60);
    return true;
  } catch (e) { return false; }
}
function kotTicketFor(o) {
  return LFH_BILLDOC.kotDocHtml({
    title: `KOT ${o.kot_no != null ? o.kot_no : "—"}`,
    rname: (state.data.restaurant || {}).name || "Kitchen",
    head: "KITCHEN TICKET",
    kot: o.kot_no != null ? o.kot_no : "—",
    tableLabel: tname(o.table_number) || ("T" + String(o.table_number ?? "?")),
    when: LFH_BILLDOC.kotWhen(o.created_at),
    lines: dishRowsOf(o),
    allergies: Array.isArray(o.allergies) ? o.allergies : [],
    // THE BIG DUPLICATE BANNER, not just a word in the header. This is a reprint whichever
    // destination was chosen, and "here" is the fallback used exactly when the kitchen printer may
    // already have produced it once.
    reprint: true,
  });
}
async function sendKotToKitchen(o) {
  try {
    const r = await api("POST", "/print-jobs", { order_id: o.id });
    if (isQueued(r)) { toast(savedMsg(r)); return; }
    toast(`KOT #${o.kot_no ?? "—"} sent to the kitchen printer — it comes out marked DUPLICATE.`);
  } catch (e) { toast("Couldn't send it to the kitchen: " + errText(e), false); }
}
function renderReprintKotPicker(t) {
  // The table's OWN tickets — a ticket belongs to the table it was rung at, the same rule the
  // move-a-KOT picker follows. A cancelled one is excluded: the server refuses it too, and a button
  // whose only outcome is a refusal is the thing this panel's guard exists to stop.
  const os = ordersOf(t).filter((o) => o.status !== "cancelled");
  const list = os.map((o, i) => {
    const nd = dishRowsOf(o).reduce((n, r) => n + (parseInt(r.qty, 10) || 1), 0);
    return `<button class="btn" style="text-align:left" data-pickprint="${esc(o.id)}">#${esc(o.kot_no ?? "—")} · Order ${i + 1} · ${nd} dish${nd === 1 ? "" : "es"}</button>`;
  }).join("");
  const body = `<div class="muted small" style="margin-bottom:10px">Which kitchen ticket?</div><div class="pactions">${list || `<div class="muted">No kitchen tickets on this table yet.</div>`}</div>`;
  const { dropLayer } = renderPickerShell("Print a KOT", body, "tablet-reprint-picker", renderPanel);
  document.querySelectorAll("[data-pickprint]").forEach((b) => (b.onclick = () => {
    const o = os.find((x) => x.id === b.dataset.pickprint);
    dropLayer();
    if (o) renderReprintWhere(t, o);
  }));
}
function renderReprintWhere(t, o) {
  const body = `<div class="muted small" style="margin-bottom:10px">KOT #${esc(o.kot_no ?? "—")} — print it where?</div><div class="pactions">
      <button class="btn" style="text-align:left" data-printkitchen>👨‍🍳 <b>Reprint in the kitchen</b><br><small class="muted">Comes out of the kitchen's printer, marked DUPLICATE</small></button>
      <button class="btn" style="text-align:left" data-printhere>🖨 <b>Print here</b><br><small class="muted">On this device, if it has a printer</small></button>
    </div>`;
  const { dropLayer } = renderPickerShell("Print it where?", body, "tablet-reprint-where", () => renderReprintKotPicker(t));
  document.querySelector("[data-printkitchen]").onclick = () => { dropLayer(); sendKotToKitchen(o); };
  document.querySelector("[data-printhere]").onclick = () => {
    dropLayer();
    // NEVER A SILENT TAP. billdoc missing after a bad deploy, or a blocked iframe, both end here —
    // and the kitchen is still one tap away, so the message says so instead of just failing.
    if (typeof LFH_BILLDOC === "undefined" || !LFH_BILLDOC.kotDocHtml) { toast("Can't print just now — reload the panel, or send it to the kitchen instead.", false); return; }
    // The result is read ONCE into a variable. Writing `printTicketHere ? …` for the second argument
    // asks whether the FUNCTION exists, which it always does — so a print that failed would have
    // been announced in green. Caught on review before this shipped.
    const started = printTicketHere(kotTicketFor(o));
    toast(started
      ? `KOT #${o.kot_no ?? "—"} sent to print`
      : "This device couldn't start a print — send it to the kitchen instead.", started);
  };
}

// Move a SINGLE order to another table's bill. Two taps: pick the order, pick the
// target table. PAID / cancelled orders are excluded — settled revenue can't be re-homed.
function renderMoveOrderPicker(t) {
  const os = ordersOf(t).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled");
  // Show each order's NET due (total − discount, discount before tax), not the gross total,
  // so it reads like every other money view on the panel. (audit 2026-07-08)
  const netDue = (o) => Math.max(0, (Number(o.total) || 0) - (Number(o.discount) || 0) * (1 + effRate()));
  const list = os.map((o, i) => `<button class="btn" style="text-align:left" data-pickorder="${esc(o.id)}">#${esc(o.kot_no ?? "—")} · Order ${i + 1} · ${inr(netDue(o))}</button>`).join("");
  const body = `<div class="muted small" style="margin-bottom:10px">Pick the order to move off T${esc(t)}:</div><div class="pactions">${list || `<div class="muted">No movable orders (paid bills can't be moved).</div>`}</div>`;
  const { dropLayer } = renderPickerShell("Move an order", body, "tablet-move-picker", renderPanel);
  // Drop THIS step's back-stack layer before advancing to the target step — otherwise the
  // step-1 layer leaks and the phone Back button needs one extra press afterwards. (audit 2026-07-08)
  document.querySelectorAll("[data-pickorder]").forEach((b) => (b.onclick = () => { dropLayer(); renderMoveOrderTarget(t, b.dataset.pickorder); }));
}
function renderMoveOrderTarget(t, orderId) {
  const n = tableCount();
  const tiles = [];
  // NEVER OFFER A TABLE THIS ORDER ALREADY SHARES A BILL WITH (T4 sweep, 2026-08-11). Two rules,
  // both of them the ones renderMoveItemTarget already applies and explains ("a button that exists
  // only to fail"):
  //   · a PARTY MATE — while T6+T7 are one party, T7 was listed on T6's picker, labelled with the
  //     party's own state ("Preparing"). The server resolves a merged destination to the party head
  //     (mig 264, lfh_merge_parent_table) and then refuses a move inside the same party with reason
  //     'same_table', which reaches the waiter as "That order is already on that table." The only
  //     possible outcome of that button was a confusing refusal.
  //   · ANOTHER party's merged CHILD — the move works, but it silently lands on the PARENT's bill
  //     while the button said the child's number. The parent is already in this list under its own
  //     number, so nothing is lost by dropping the child and the destination stops being a lie.
  // partyTablesOf(t) includes t itself, so this also covers the old `String(i) === String(t)` test.
  const mates = new Set(partyTablesOf(t).map(String));
  for (let i = 1; i <= n; i++) {
    if (mates.has(String(i)) || mergeParentOf(i) || !inMySection(i)) continue;  // own party; other parties' children; sections: only my own tables
    const st = tileState(i);
    tiles.push(`<button class="btn shiftpick" data-moveto="${i}">T${i}<br><span class="muted small">${st.label}</span></button>`);
  }
  const body = `<div class="muted small" style="margin-bottom:10px">Send this order to which table's bill?</div><div class="shiftgrid">${tiles.length ? tiles.join("") : `<div class="muted">No other table in your section to move this to.</div>`}</div>`;
  const { dropLayer } = renderPickerShell("Move order →", body, "tablet-move-target", () => renderMoveOrderPicker(t));
  document.querySelectorAll("[data-moveto]").forEach((b) => (b.onclick = () => {
    const to = b.dataset.moveto;
    dropLayer();
    runOptimistic(
      () => { const o = state.data.orders.find((x) => x.id === orderId); if (o) o.table_number = to; },
      () => api("POST", `/orders/${orderId}/move`, { to }),
      // SAY IT (T7 sweep #7 third pass, 2026-08-30). This was the ONE move on this panel that
      // succeeded in silence: moving a DISH ends with "Dish moved to table N (new KOT)" forty
      // lines above, and the manager panel's KOT move says "KOT moved to <table>". Here the
      // picker just closed and the waiter was left to notice a ticket missing from a bill that
      // may have four — the same "did that work?" the dish move was given a sentence for.
      // tableLabel(), so a renamed table is named the way the waiter knows it.
      () => toast(`KOT moved to ${tableLabel(to)}`),
    );
  }));
}

// Apply a local change, repaint instantly, then persist and reconcile from the
// server. On failure we toast and reload so the screen can't lie.
async function runOptimistic(mutate, fn, onSuccess) {
  // Remember which table we were viewing: a shift optimistically repoints state.table to the
  // TARGET, so if the move is refused (target just got taken) we must snap back to the source
  // table — otherwise the waiter is left staring at the wrong, empty table. (audit 2026-07-08 round2)
  const prevTable = state.table;
  let done = false;   // true only on a real ONLINE success (not queued, not failed)
  try {
    mutate(); renderFloor(); renderPanel();
    const r = await fn();
    if (isQueued(r)) { toast(savedMsg(r)); return; }  // #2: saved offline — not a failure, and load() would no-op
    done = true;
  }
  // On failure the optimistic mutate() must be REVERTED by the reconciling load() below. But if the
  // write never reached the server (e.g. a 409 refusal — target already invoiced), the server state
  // is unchanged, so load() would short-circuit on an unchanged signature and LEAVE the optimistic
  // change (e.g. an order shown moved away) on screen until the next poll. Clearing lastSig forces
  // load() to re-apply server truth and repaint immediately. (audit 2026-07-09)
  catch (e) { state.table = prevTable; lastSig = null; toast("Failed: " + errText(e), false); }
  await load();   // load() already repaints if anything changed — no second render (that was the extra flash)
  // Run the success hook AFTER reconcile, so it can read the freshly-loaded state
  // (e.g. the settle-undo bar checks whether the table auto-closed on pay).
  if (done && typeof onSuccess === "function") { try { onSuccess(); } catch (e) {} }
}

const act = async (fn) => {
  try {
    const r = await fn();
    if (isQueued(r)) { toast(savedMsg(r)); return; }  // #2: offline queue — friendly note, skip the offline GET
    await load();
  } catch (e) {
    // Someone else changed the same thing first: say so plainly and refresh, rather than
    // "Failed: clash_changed_elsewhere".
    // BOTH HALVES OF THE SENTENCE (T7 sweep #7, 2026-08-30). lib/clash.ts sends `plain` (what
    // happened) AND `todo` (what to do about it — "Your change was NOT saved. Look at what it says
    // now and redo yours if it's still right."). This showed only the first half, so a waiter was
    // told another device had changed the order and NOT told that their own change had been
    // dropped — the half that decides whether they redo it. errText() thirty lines up and the
    // allergy handler at 1746 have always shown both; these two were the odd ones out.
    const clash = e && e.data && e.data.clash;
    if (clash) { toast(clash.plain + (clash.todo ? " " + clash.todo : ""), false, 9000); load().catch(() => {}); return; }
    toast("Failed: " + errText(e), false);
  }
};

// Staff qty stepper on an ALREADY-PLACED dish. Reads the LIVE qty from state (never the
// button's data-qty attribute) and bumps OPTIMISTICALLY, so rapid taps accumulate correctly.
// The old handlers read the stale DOM attribute + did a full load() per tap, so two fast taps
// both saw the same old number and one increment was silently lost (2026-07-07). The server
// reconcile is DEBOUNCED — one refresh after the taps settle, not one per tap (fewer reloads,
// no per-tap flicker). The qty endpoint sets an ABSOLUTE quantity, so the last tap wins.
let qtyReconcileTimer = null;
function bumpItemQty(itemId, delta) {
  const it = (state.data.items || []).find((x) => x.id === itemId);
  // NEVER A SILENT RETURN ON A TAP — see the note on the allergy chip above. This one is the most
  // reachable of the four: the stepper's OWN 700ms reconcile calls load(), which replaces
  // state.data.items, so a waiter tapping ＋ four times quickly can have the row swapped under
  // them mid-run. Every other refusal in this function already speaks ("Use 🗑 to remove the
  // dish"); this was the one path that went quiet.
  if (!it) { toast("That dish just changed — refreshing this table.", false); load().catch(() => {}); return; }
  const cur = Number(it.qty) || 1;
  let next = cur + delta;
  if (next < 1) { toast("Use 🗑 to remove the dish", false); return; }
  if (next > 99) next = 99;
  if (next === cur) return;
  it.qty = next;                 // optimistic: local state + the re-rendered buttons now agree
  renderPanel();
  // `expect` = the count this screen was showing. If someone else changed it meanwhile the
  // server refuses and says what it is now, instead of one waiter's 3 quietly becoming 1.
  api("POST", `/items/${itemId}/qty`, { qty: next }, { expect: { table: "order_items", id: itemId, fields: { qty: cur } } })
    .catch((e) => {
      const clash = e && e.data && e.data.clash;
      // …and the same here: `todo` is the half that says the change was not saved.
      toast(clash ? clash.plain + (clash.todo ? " " + clash.todo : "") : "Failed: " + e.message, false, clash ? 9000 : undefined);
      load().catch(() => {});
    });
  clearTimeout(qtyReconcileTimer);
  qtyReconcileTimer = setTimeout(() => load().catch(() => {}), 700);
}

// (ensureTableSlice() WAS HERE, and it is gone — T7 sweep #7, 2026-08-28.)
//
// It fetched ONE table's slice with a cache short-circuit, and it was the right shape while a tile
// quick-action only ever touched one table. Then merged parties arrived (mig 249): every whole-party
// read has to have EVERY member's slice or partyOrders() silently sees half the bill, so
// ensurePartySlices() below took over — it fetches the party together, merges in a loop through
// mergeSelectedSlice(), and answers whether every member really landed. Nothing has called
// ensureTableSlice since, on this panel or anywhere else, so the ~35 lines were deleted rather than
// left to be found and reused: a caller that reached for it would refresh one table of a party and
// under-count the bill, which is exactly the fault ensurePartySlices exists to prevent.
//
// The MANAGER panel has its own ensureTableSlice and it is LIVE there (public/panels/editor/app.js).
// Do not read this note as permission to remove that one.
// A merged party spans SEVERAL tables' slices — any whole-party read or action must have them
// all cached, or partyOrders() silently sees half the bill. Forced on purpose, same reasoning
// as the manager's ensurePartySlices: a whole-party action can fire the instant a detail opens.
// Returns TRUE only when every member's slice really landed. A swallowed fetch blip is fine for an
// action that then no-ops, but NOT for a screen that is about to tell someone what will happen: the
// split confirm reads these rows to say what comes back, and with an unread slice it would announce
// "nothing was ordered at it" about a table that is holding food. Callers that don't care ignore it.
//
// FETCH TOGETHER, THEN MERGE IN ORDER (T7, 2026-08-18) — and what is actually known about why.
//
// THE SYMPTOM, measured and reproducible: on a party of THREE tables, opening the table that HOLDS
// the bill and pressing ⇹ Unmerge announced "T25 gets nothing back — nothing was ordered at it"
// about a table holding a ₹483 ticket. It happened on every run of the long walk and never in a
// two-table party opened from the child. With the shape below it has not happened once in repeated
// runs. The confirm reads the same rows partyOrders() reads, so the same moment would also
// under-count the BILL.
//
// WHAT I DID NOT PROVE: the mechanism. The obvious suspect — a lost update from running the members
// concurrently — does NOT hold up: mergeSelectedSlice captures `state.data` and re-assigns it in one
// synchronous block with no await between, so two concurrent calls cannot interleave there. I could
// not pin down the real cause before this change made the symptom go away, so this comment says what
// was observed rather than inventing a story. If you touch this, re-run a THREE-table party and open
// it from the table holding the bill — that is the case that showed it.
//
// The shape itself is not a guess: loadImpl and loadTables already read the members in parallel and
// merge them in a sequential loop, so this makes the panel do it one way in three places instead of
// two ways in three places.
// There is no non-forced mode, and there has not been one since ensureTableSlice() was deleted on
// 2026-08-28 — its cache short-circuit went with it. Four call sites went on passing a second
// `true` argument this function does not declare, and the comments beside them shouted FORCE, so a
// reader would reasonably believe there was an opt-out to reach for. There is not: every call
// re-reads the whole party. The argument is dropped rather than added, because adding a parameter
// nothing needs is how a cache short-circuit gets re-introduced by accident on a whole-party read
// that must never see half a bill. (sweep #8 T10, 2026-09-03)
async function ensurePartySlices(t) {
  const tables = partyTablesOf(t);
  const slices = await Promise.all(tables.map((x) => api("GET", "/state?table=" + encodeURIComponent(x)).catch(() => null)));
  let allGot = true;
  for (const [i, x] of tables.entries()) {
    if (slices[i]) mergeSelectedSlice(x, slices[i]);   // one at a time — each sees the last one's result
    else allGot = false;
  }
  return allGot;
}

// Open a table INSTANTLY (mirrors the manager): drop a pending "open" session into
// local state + repaint NOW, then create it on the server and reconcile. On failure
// runOptimistic's load() refetches and the pending session disappears. (owner, 2026-06-19)
// (optimisticOpen went with the "Open this table" button — opening a table is not a step
// any more. The first order starts the party, server-side; see migration 237.)

// Mark a table's whole bill paid INSTANTLY: flip every order's payment_status to
// "paid" locally so the tile/detail re-read as paid (no due) right away, then persist
// + reconcile. runOptimistic's load() reverts on failure. (owner, 2026-06-20)
function optimisticPay(t, method, note) {
  runOptimistic(
    () => {
      // Only flip orders the server will actually settle: a 'received' (not-yet-accepted) or
      // cancelled order is NOT paid by /tables/:t/pay, so optimistically showing it paid made
      // the tile briefly read "Cleared/₹0" before the server reverted it (2026-07-07). Match
      // the server's set exactly so the optimistic view is always truthful.
      // The server settles the PARTY's whole bill (a merged child resolves to its parent),
      // so the optimistic flip must cover every member table's orders too.
      const party = new Set(partyTablesOf(t));
      state.data.orders.forEach((o) => { if (party.has(String(o.table_number)) && o.status !== "received" && o.status !== "cancelled") o.payment_status = "paid"; });
      patchTileFromSlice(t);   // flip the UN-selected floor tile to paid/no-due now, not after reconcile
    },
    () => api("POST", `/tables/${t}/pay`, method ? { payment_method: method, payment_note: note || "" } : null),
    () => offerPayUndo(t, { message: method ? `Bill paid via ${method}` : "Bill paid" }),
  );
}
// Settle a table's bill respecting the manager's tablet_mark_paid setting: 'on' →
// instant optimistic pay; 'pin' → manager-PIN-gated (the server also enforces it).
// method/note come from openPaymentMethodModal (payBillWithMethod below) — optional
// so this still works if ever called without them.
// Mark an ALREADY-PAID bill back to unpaid — a refund/correction (owner, 2026-07-23).
// Confirm + a required reason (logged for accountability), then reverse through the same
// /unpay path the undo bar uses (un-pays the session's paid orders within the 30-min
// grace, strips split legs + any on-the-house comp). Gated by tablet_mark_paid (PIN in
// pin-mode) exactly like paying. Only offered on a paid bill in the detail view.
async function markBillUnpaid(t) {
  if (!(await confirmDialog("Reopen this bill as UNPAID? This reverses the recorded payment — a refund or correction.", "Mark unpaid"))) return;
  const reason = await reasonPrompt("Why are you reopening this paid bill?", "e.g. refund, wrong table, entered by mistake");
  if (!reason) { toast("Not reopened — a reason is required.", false); return; }
  actGated("POST", `/tables/${t}/unpay`, { reason }, { message: "Enter a manager PIN to mark this bill unpaid.", toast: "Bill reopened — marked unpaid" });
}
function payBill(t, method, note) {
  const body = method ? { payment_method: method, payment_note: note || "" } : null;
  if (tperm("tablet_mark_paid") === "pin") {
    actGated("POST", `/tables/${t}/pay`, body, { message: "Enter a manager PIN to mark this bill paid.", onSuccess: () => offerPayUndo(t, { message: method ? `Bill paid via ${method}` : "Bill paid" }) });
  } else {
    optimisticPay(t, method, note);
  }
}
// After a successful "Mark paid", give a few-second takeback (owner undo bar, 2026-07-22).
// Only while the table is STILL open. Paying no longer closes a table by itself (auto-settle
// was deleted 2026-08-02), but a table CAN have been closed by hand in between, and an in-place
// undo can't cleanly reopen a closed one — so we just confirm and leave the heavier "restore to
// floor" to the manager panel. The undo goes through
// actGated so a PIN-gated restaurant is asked for a PIN to reverse a payment too.
// o = { message, icon } — lets the different settle flows (plain pay, split, on-the-house)
// share ONE takeback. They all reverse through /tables/:t/unpay, which un-pays the open
// session's just-settled orders (and strips split legs + the on-the-house 100% discount).
function offerPayUndo(t, o) {
  o = o || {};
  const msg = o.message || "Bill paid";
  const stillOpen = !!sessionOf(t);
  if (stillOpen && window.LFH_UNDO) {
    LFH_UNDO.show({
      message: msg,
      sub: `T${t} · tap undo to reopen the bill`,
      icon: o.icon || "💳",
      seconds: 5,
      onUndo: () => actGated("POST", `/tables/${t}/unpay`, null, { message: "Enter a manager PIN to undo this settle.", toast: "Settle undone" }),
    });
  } else {
    toast(msg);
  }
}
// openPaymentMethodModal(due, label): "how did they pay?" — UPI/Cash/Card, or Other
// with a short typed note. Picking a method IS the confirmation (replaces the old
// plain confirmDialog — one tap instead of two). Resolves { method, note }, or null
// if cancelled. Mirrors the manager panel's version, styled inline like this file's
// other self-contained modals (openDishEditModal, openDiscountModal, pinPrompt).
// (owner, 2026-07-01)
let payModalOpen = false;
function openPaymentMethodModal(due, label, opts = {}) {
  // #18: a fast double-tap on "💳 Mark paid" used to build a SECOND modal — the first's DOM
  // was removed but its back-stack layer + promise leaked (one dead Back press). Re-entrancy
  // guard: while one is open, a second call resolves null (treated as "cancelled") instead.
  if (payModalOpen) return Promise.resolve(null);
  payModalOpen = true;
  return new Promise((resolve) => {
    document.querySelector(".pay-overlay")?.remove();
    const ov = document.createElement("div");
    ov.className = "pay-overlay";
    Object.assign(ov.style, { position: "fixed", inset: "0", background: "var(--scrim)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
    ov.innerHTML = `<div class="pay-box" style="width:min(94vw,420px);max-height:90vh;overflow:auto;background:var(--panel);color:var(--text);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
      <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line)"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">${esc(label)}</h3><button class="pay-close" aria-label="Close" style="background:var(--panel-2);border:0;color:var(--text);border-radius:8px;padding:6px 10px;cursor:pointer">✕</button></div>
      <div style="padding:16px 18px">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px;color:var(--muted);margin-bottom:12px"><span>Amount collected</span><b style="color:var(--text);font-size:15px">${inr(due)}</b></div>
        ${opts.methodOnly || opts.noTip ? "" : `
        <div class="pay-tip" style="margin:0 0 14px;padding-bottom:14px;border-bottom:1px dashed var(--line)">
          <div style="font-size:13px;font-weight:700;margin:0 0 3px">Add a tip? <span style="color:var(--muted);font-weight:400">— optional, extra for staff on top of the bill</span></div>
          <div style="font-size:11.5px;color:var(--muted);margin:0 0 8px">Change any one of the three — the other two follow.</div>
          <div style="display:flex;align-items:flex-end;gap:8px;margin:0 0 8px">
            <label style="flex:1;min-width:0"><span style="display:block;font-size:11.5px;color:var(--muted);font-weight:600;margin:0 0 4px">Tip %</span>
              <!-- step="0.01", NOT "1" — the SAME fault item 18 fixed in the discount sheet, three boxes further
                   down the same file, and item 18 missed it (T7 sweep #7, 2026-08-30; the new cross-panel
                   guard verify:money-boxes is what found them). paintTip() writes a percentage to one
                   decimal and an amount through r2t(), so these boxes were refusing their own contents. -->
              <input type="number" inputmode="decimal" min="0" step="0.01" class="pay-tip-pct" placeholder="0" style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px;font-variant-numeric:tabular-nums"></label>
            <span style="font-weight:800;color:var(--muted);padding-bottom:11px">=</span>
            <label style="flex:1;min-width:0"><span style="display:block;font-size:11.5px;color:var(--muted);font-weight:600;margin:0 0 4px">Tip amount (₹)</span>
              <input type="number" inputmode="decimal" min="0" step="0.01" class="pay-tip-amt" placeholder="0" style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px;font-variant-numeric:tabular-nums"></label>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px">${[0, 5, 10, 15].map((p) => `<button type="button" class="btn pay-tip-pick" data-tip-pct="${p}" style="min-height:44px;padding:0 14px;font-weight:700">${p ? p + "%" : "None"}</button>`).join("")}</div>
          <label style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--panel-2);border:1px solid var(--line)">
            <b style="font-size:13.5px">They paid</b>
            <span style="display:inline-flex;align-items:center;gap:2px;color:var(--gold-strong);font-weight:800;font-size:15px">₹
              <input type="number" inputmode="decimal" min="0" step="0.01" class="pay-tip-paid" aria-label="Total the customer paid" style="width:8ch;border:0;background:transparent;padding:0;margin:0;text-align:right;color:var(--gold-strong);font-weight:800;font-size:15px;font-family:inherit;font-variant-numeric:tabular-nums;outline:none"></span>
          </label>
          <div class="pay-tip-msg" role="status" style="display:none;font-size:12px;font-weight:600;color:#f59e0b;margin:8px 0 0"></div>
        </div>`}
        <div style="font-size:13px;font-weight:700;margin:0 0 8px">How did they pay? <span style="color:var(--muted);font-weight:400">— only pick one if the money's actually in hand</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <button type="button" class="pay-method-btn" data-method="UPI" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 10px;min-height:64px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;font-weight:600"><span style="font-size:22px">📱</span>UPI</button>
          <button type="button" class="pay-method-btn" data-method="Cash" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 10px;min-height:64px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;font-weight:600"><span style="font-size:22px">💵</span>Cash</button>
          <button type="button" class="pay-method-btn" data-method="Card" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 10px;min-height:64px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;font-weight:600"><span style="font-size:22px">💳</span>Card</button>
          <button type="button" class="pay-method-btn" data-method="Other" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 10px;min-height:64px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;font-weight:600"><span style="font-size:22px">⋯</span>Other</button>
          ${opts.onHouse ? `<button type="button" class="pay-method-btn" data-special="onhouse" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 10px;min-height:64px;border-radius:12px;border:1.5px solid #e11d48;background:var(--bg);color:var(--text);font-size:14px;font-weight:600"><span style="font-size:22px">🏠</span>On the house</button>` : ""}
          ${opts.khata ? `<button type="button" class="pay-method-btn" data-special="khata" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 10px;min-height:64px;border-radius:12px;border:1.5px solid #0ea5e9;background:var(--bg);color:var(--text);font-size:14px;font-weight:600"><span style="font-size:22px">📒</span>Pay Later</button>` : ""}
        </div>
        <div class="pay-other-field" style="display:none;margin-top:12px">
          <div class="pay-other-write" style="display:none">
            <div style="font-size:13px;font-weight:700;margin:0 0 8px">What kind?</div>
            <input type="text" class="pay-other-input" maxlength="60" placeholder="e.g. wallet, bank transfer" style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;margin-bottom:10px">
            <button type="button" class="btn primary pay-other-confirm" style="width:100%">Confirm</button>
          </div>
        </div>
        ${opts.crm === false ? "" : (opts.knownCust && opts.knownCust.phone ? `
        <!-- ALREADY ASKED, SO DO NOT ASK AGAIN (owner, 2026-08-29). The number was taken earlier in
             this same visit; asking a second time on the way out reads as though the first answer
             was thrown away, and an empty box invites a DIFFERENT number onto one bill. -->
        <div class="pay-cust pay-cust-known" style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--line)">
          <div style="font-size:13px;font-weight:700;margin:0 0 3px">📱 Customer <span style="color:var(--muted);font-weight:400">— already saved for this table</span></div>
          <div class="pay-cust-have" style="font-size:13px;font-weight:700;margin:0 0 8px">${esc(opts.knownCust.name ? `${opts.knownCust.name} · ${opts.knownCust.phone}` : opts.knownCust.phone)}</div>
          <button type="button" class="btn small pay-cust-change">Change</button>
        </div>` : `
        <div class="pay-cust" style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--line)">
          <div style="font-size:13px;font-weight:700;margin:0 0 3px">📱 Save customer <span style="color:var(--muted);font-weight:400">— optional, only if they agree</span></div>
          <div style="font-size:11.5px;color:var(--muted);margin:0 0 8px">Lets you spot regulars and greet them by name next time.</div>
          <input type="tel" inputmode="numeric" class="pay-cust-phone" maxlength="20" placeholder="Mobile number" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;margin-bottom:8px">
          <input type="text" class="pay-cust-name" maxlength="80" placeholder="Name (optional)" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;margin-bottom:8px">
          <div class="pay-cust-chip" style="display:none;font-size:12.5px;font-weight:700;color:#16a34a;margin:0 0 8px"></div>
          <label style="display:flex;align-items:flex-start;gap:9px;font-size:12.5px;color:var(--text);cursor:pointer">
            <input type="checkbox" class="pay-cust-consent" style="margin-top:2px;width:16px;height:16px;flex:none">
            <span>Customer agrees to save their name &amp; number to recognise their next visits. They can ask to remove it anytime.</span>
          </label>
        </div>`)}
        <!-- SPLITTING LIVES UNDER 🧾 KOT ▾, AND THIS IS ITS SECOND DOOR (owner, 2026-08-28):
             "you can only split with the kot option or small written if you want split on billing
             at bottom and both have same interface as the kot one". So it is a small written line,
             not one of the payment tiles — splitting is not a WAY to pay, it is how the bill is
             divided, and every tile above it answers "how did the money come in?".
             This replaces the ⇄ Split payment tile added on 2026-08-21. That change was about
             DISCOVERABILITY — split used to be two taps deep under "Other", "which is why nobody
             used it" — and this keeps it one tap from here, so the point of it survives.

             REJECTED (owner, 2026-08-30): making this a BUTTON or a tile again. I raised it myself,
             because a small grey line is less eye-catching than the gold tile it replaced and that
             tile existed for discoverability. Asked directly, with the trade-off named, he said
             "yes a small line is ok". It stays a line. See docs/REJECTED-IDEAS.md → R51. -->
        ${opts.split ? `<div class="pay-splitline"><button type="button" class="pay-split-open">Splitting between people? <b>Split this bill →</b></button></div>` : ""}
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding:14px 18px;border-top:1px solid var(--line)"><button class="btn pay-cancel-btn">Cancel</button></div>
    </div>`;
    document.body.appendChild(ov);
    let resolved = false;
    let backOff = window.LFH_BACK ? LFH_BACK.layer("tablet-pay", () => cancel()) : null;
    const close = () => { if (backOff) { backOff(); backOff = null; } ov.remove(); payModalOpen = false; };
    // Read the optional customer fields at finish time (DPDP: only sent if consented).
    const readCust = () => {
      const pe = ov.querySelector(".pay-cust-phone");
      if (!pe) return null;
      const ne = ov.querySelector(".pay-cust-name"), ce = ov.querySelector(".pay-cust-consent");
      const phone = (pe.value || "").trim();
      if (!phone || !(ce && ce.checked)) return null;
      return { phone, name: (ne?.value || "").trim(), consent: true };
    };
    // THE TIP — the same three linked boxes the manager panel has (owner, 2026-08-28). This panel
    // had NO tip control at all, so every tip a waiter collected was invisible to the tips report
    // while the manager's screen could record one. `tip` rides out on the resolved object exactly
    // as `cust` does, and payBillWithMethod posts it after the bill is marked paid.
    let tip = 0;
    const BD = window.LFH_BILLDOC || {};
    const TIP_MAX = Number(BD.TIP_MAX) || 100000;
    {
      const pctIn = ov.querySelector(".pay-tip-pct");
      const amtIn = ov.querySelector(".pay-tip-amt");
      const paidIn = ov.querySelector(".pay-tip-paid");
      const msgEl = ov.querySelector(".pay-tip-msg");
      const r2t = (n) => Math.round((Number(n) || 0) * 100) / 100;
      if (pctIn && amtIn && paidIn) {
        const say = (m) => { if (!msgEl) return; msgEl.textContent = m || ""; msgEl.style.display = m ? "" : "none"; };
        const paintTip = (typing) => {
          const pct = due > 0 ? Math.round((tip / due) * 1000) / 10 : 0;
          if (typing !== "pct") pctIn.value = tip ? String(pct) : "";
          if (typing !== "amt") amtIn.value = tip ? String(r2t(tip)) : "";
          if (typing !== "paid") paidIn.value = String(Math.round(due + tip));
          ov.querySelectorAll(".pay-tip-pick").forEach((x) => x.classList.toggle("primary", Number(x.dataset.tipPct) === pct));
        };
        const setTip = (v, typing) => {
          const want = Math.max(0, Number(v) || 0);
          if (want > TIP_MAX) say(`The most a tip can be is ${inr(TIP_MAX)} — check that figure.`);
          else if (want > due && due > 0) say(`That is a tip bigger than the bill (${inr(due)}). Fine if they meant it.`);
          else say("");
          tip = Math.min(want, TIP_MAX);
          paintTip(typing);
        };
        ov.querySelectorAll(".pay-tip-pick").forEach((b) => (b.onclick = () => setTip(r2t(due * (Number(b.dataset.tipPct) || 0) / 100))));
        pctIn.oninput = () => setTip(r2t(due * (parseFloat(pctIn.value) || 0) / 100), "pct");
        amtIn.oninput = () => setTip(parseFloat(amtIn.value), "amt");
        // A blank box is "I am about to type", never "they paid ₹0" — the guard the discount's
        // own pay box carries on this panel. The tip already entered stands until a real number.
        paidIn.oninput = () => {
          const raw = paidIn.value.trim(), p = parseFloat(raw);
          if (raw === "" || !(p >= 0)) return;
          setTip(BD.tipFromPaid ? BD.tipFromPaid(due, p) : Math.max(0, r2t(p - due)), "paid");
          // AFTER setTip, not before — setTip clears the message when the figure it lands on is
          // unremarkable, and a tip of 0 is unremarkable, so saying this first said it into a box
          // that was wiped a line later. Measured on the real sheet: nothing was shown at all.
          if (p < due) say(`That is less than the bill (${inr(due)}) — this box is the TOTAL they handed over, tip included.`);
        };
        // A refused figure must not be left on screen: the box being typed in is not rewritten
        // mid-keystroke, so a figure past the ceiling sat reading 9,999,999 while the tip actually
        // kept was 1,00,000. On blur every box snaps back to what was really kept.
        [pctIn, amtIn, paidIn].forEach((b) => { b.onblur = () => paintTip(); });
        paidIn.onfocus = () => { try { paidIn.select(); } catch (e) {} };
        paintTip();
      }
    }
    const finish = (method, note) => { resolved = true; const cust = readCust(); close(); resolve({ method, note, cust, tip }); };
    const cancel = () => { close(); if (!resolved) resolve(null); };
    ov.querySelector(".pay-close").onclick = cancel;
    ov.querySelector(".pay-cancel-btn").onclick = cancel;
    ov.onclick = (e) => { if (e.target === ov) cancel(); };
    ov.querySelectorAll(".pay-method-btn").forEach((b) => (b.onclick = () => {
      // The two special settles (mig 166): resolve with a marker — the CALLER runs the
      // dedicated flow (person picker / no-charge settle); no payment method involved.
      // "Split payment" opens the parts panel right here — it was two taps deep under "Other",
      // which is why nobody used it (owner, 2026-08-21).
      // The tip rides along here too. A bill settled on the house or put on a tab can still have
      // had cash handed over for the staff, and dropping it because the BILL was free would lose
      // real money belonging to a real person.
      if (b.dataset.special) { resolved = true; close(); resolve({ special: b.dataset.special, tip }); return; }
      const m = b.dataset.method;
      if (m === "Other") {
        // Straight to the box. This used to open a chooser of two — "type another way" or
        // "split the payment" — and Split is its own button now, so the chooser held one option.
        ov.querySelector(".pay-other-field").style.display = "";
        ov.querySelector(".pay-other-write").style.display = "";
        ov.querySelector(".pay-other-input").focus();
        return;
      }
      finish(m, null);
    }));
    // The old "Other → write or split" chooser is gone: Split payment is its own button on the
    // grid now (owner, 2026-08-21 — it was two taps deep, which is why nobody used it), and
    // "Other" goes straight to its text box above.
    // The small line at the bottom resolves the SAME marker the old tile did, so the caller's
    // handling is unchanged — it just opens the one split screen instead of a panel in here.
    { const so = ov.querySelector(".pay-split-open"); if (so) so.onclick = () => { resolved = true; close(); resolve({ special: "split" }); }; }
    const otherInput = ov.querySelector(".pay-other-input");
    const confirmOther = () => finish("Other", otherInput.value.trim());
    ov.querySelector(".pay-other-confirm").onclick = confirmOther;
    otherInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); confirmOther(); } };

    // (The split panel that used to live in here is gone — there is ONE split screen now,
    // renderSplitBill(), reached from 🧾 KOT ▾ and from the small line at the bottom of this sheet.
    // Owner, 2026-08-28: "both have same interface as the kot one". Keeping a second copy of a money
    // screen is how the two drifted apart in the first place.)
    // Repeat-customer recognition: as the waiter types a known number, show a chip and
    // pre-fill the name. Read-only lookup (stores nothing); debounced to one call.
    // "Change" — the one way out of the already-saved line, and it opens PRE-FILLED, because the
    // second half of his instruction was "if it is asked, it should be autofill because I have
    // already filled it previously". (owner, 2026-08-29.)
    {
      const chBtn = ov.querySelector(".pay-cust-change");
      if (chBtn) chBtn.onclick = () => {
        const box = ov.querySelector(".pay-cust-known");
        const k = opts.knownCust || {};
        const inp = "width:100%;box-sizing:border-box;padding:10px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;margin-bottom:8px";
        box.classList.remove("pay-cust-known");
        box.innerHTML = `
          <div style="font-size:13px;font-weight:700;margin:0 0 3px">📱 Save customer <span style="color:var(--muted);font-weight:400">— optional, only if they agree</span></div>
          <input type="tel" inputmode="numeric" class="pay-cust-phone" maxlength="20" placeholder="Mobile number" style="${inp}" value="${esc(k.phone || "")}">
          <input type="text" class="pay-cust-name" maxlength="80" placeholder="Name (optional)" style="${inp}" value="${esc(k.name || "")}">
          <div class="pay-cust-chip" style="display:none;font-size:12.5px;font-weight:700;color:#16a34a;margin:0 0 8px"></div>
          <label style="display:flex;align-items:flex-start;gap:9px;font-size:12.5px;color:var(--text);cursor:pointer">
            <input type="checkbox" class="pay-cust-consent" style="margin-top:2px;width:16px;height:16px;flex:none" checked>
            <span>Customer agrees to save their name &amp; number to recognise their next visits. They can ask to remove it anytime.</span>
          </label>`;
      };
    }

    const phoneEl = ov.querySelector(".pay-cust-phone");
    if (phoneEl) {
      const nameEl = ov.querySelector(".pay-cust-name");
      const chipEl = ov.querySelector(".pay-cust-chip");
      let recTimer = null;
      phoneEl.addEventListener("input", () => {
        if (recTimer) clearTimeout(recTimer);
        const digits = (phoneEl.value || "").replace(/[^0-9]/g, "");
        if (digits.length < 7) { chipEl.style.display = "none"; return; }
        recTimer = setTimeout(async () => {
          try {
            const r = await api("GET", `/customer-recognize?phone=${encodeURIComponent(digits)}`);
            if (r && r.known) {
              const v = Number(r.visits) || 0;
              chipEl.textContent = `✨ Repeat customer${v ? ` · ${v + 1}${v + 1 === 2 ? "nd" : v + 1 === 3 ? "rd" : "th"} visit` : ""}${r.name ? ` · ${r.name}` : ""}`;
              chipEl.style.display = "";
              if (r.name && !nameEl.value.trim()) nameEl.value = r.name;
            } else { chipEl.style.display = "none"; }
          } catch { chipEl.style.display = "none"; }
        }, 400);
      });
    }
  });
}
// payBillWithMethod: the ONE shared "close this bill" flow for the tablet — opens the
// payment-method modal, then settles the table with the picked method. Replaces the
// plain confirmDialog on BOTH entry points (the floor-tile quick pay + the table
// detail's Mark paid button) with one that also records HOW the money came in.
async function payBillWithMethod(t, a) {
  // The two special settles (mig 166) ride the same popup as extra buttons: "On the
  // house" only on a Family/Owner's-Guest table (the mark is the authorization; money
  // side still runs under tablet_mark_paid), "Collect later" under tablet_khata.
  const opts = {
    onHouse: ["family", "guest"].includes(ttagOf(t)),
    khata: tabletKhataOn() && tshow("tablet_khata"),
    // Splitting is offered as a small LINE at the bottom of that sheet, not a payment tile —
    // it is how the bill is divided, not a way the money came in (owner, 2026-08-28). Tapping it
    // closes the sheet and opens the ONE split screen. The tickets it needs it works out itself
    // from partyOrders(), so nothing has to be handed across. It obeys the SAME switch as the KOT
    // row — one splitBillOn(), both doors — so a restaurant that turned splitting off is not
    // offered it here (T7 sweep #7, 2026-08-30).
    split: splitBillOn(),
    // Which table, so a PAY-LATER part of the split can name the person owing it (mig 352).
    table: t,
    // WHO THIS TABLE'S CUSTOMER ALREADY IS, if anybody has been asked once (owner, 2026-08-29:
    // "you have asked for a mobile number and that already, then why are you asking right now
    // again?"). Read the way the bill-customer sheet reads it further down this file, so the two
    // can never disagree: this SESSION's own customer, scoped to its session id.
    knownCust: (() => {
      const sess = (state.data.sessions || []).find((x) => String(x.table_number) === String(t) && x.status !== "closed");
      if (sess && sess.cust_phone) return { phone: sess.cust_phone, name: sess.cust_name || "" };
      const row = partyOrders(t).find((o) => o.bill_cust_phone || o.bill_cust_name);
      return row ? { phone: row.bill_cust_phone || "", name: row.bill_cust_name || "" } : null;
    })(),
  };
  const picked = await openPaymentMethodModal(a.due, `Mark bill ${a.billNo ? `#${a.billNo} ` : ""}paid for table ${t}`, opts);
  if (!picked) return;
  // "Split this bill →" — the sheet's second door to the ONE split screen. Coming back from it
  // returns to the TABLE, not to a half-answered payment sheet: the sheet was closed by the tap,
  // and re-opening it behind the split screen would leave two money screens stacked.
  // The tip is recorded BEFORE we leave: it was typed on the sheet that is about to close, and a
  // split bill can be tipped like any other.
  if (picked.special === "split") { await recordTip(t, picked.tip); renderSplitBill(t, { onBack: renderPanel }); return; }
  // Whatever way the bill closed, the tip goes with it.
  if (picked.special === "onhouse") {
    await recordTip(t, picked.tip);
    // actGated handles BOTH modes: direct when 'on', and the PIN round-trip when the
    // server answers "manager pin" ('pin' mode) — same as every other gated action.
    actGated("POST", `/tables/${t}/on-the-house`, {}, { message: "Enter a manager PIN to settle this bill on the house.", onSuccess: () => offerPayUndo(t, { message: "On the house — settled free", icon: "🏠" }) });
    return;
  }
  if (picked.special === "khata") { await recordTip(t, picked.tip); await tabletKhataFlow(t, a.due); return; }
  payBill(t, picked.method, picked.note);
  await recordTip(t, picked.tip);
  if (picked.cust) captureCustomer(t, picked.cust);
}

// A TIP IS SOMEBODY'S MONEY — IT DOES NOT GET A SILENT catch{} (owner, 2026-08-28).
//
// The manager panel posts its tip with `catch { /* tip is non-critical */ }`. It is not
// non-critical: it is cash a customer handed over for the staff, and a write that fails with
// nobody told means it is simply gone from the tips report. So this SAYS so, and the write goes
// through the panel's own api(), which means it also survives a dead connection: the outbox keeps
// it and replays it, exactly like every other staff write.
//
// The whole tip goes on the FIRST non-cancelled order of the table — migration 154's own rule
// ("for a multi-order table bill the whole tip is stored on the FIRST paid order"), and the same
// order the manager panel picks. Tips are never split or clamped by a trigger, so one row is safe.
async function recordTip(t, tip) {
  const amt = Math.round((Number(tip) || 0) * 100) / 100;
  if (!(amt > 0)) return;
  const first = ordersOf(t).filter((o) => o.status !== "cancelled")[0];
  if (!first) { toast("The tip could not be recorded — this bill has no ticket to put it on.", false); return; }
  try {
    await api("POST", `/orders/${first.id}/tip`, { amount: amt });
  } catch (e) {
    // false = the error styling on this panel (toast(msg, ok)) — a failure dressed as a success is
    // the same fault in a different coat.
    toast(`Bill is paid, but the ${inr(amt)} tip was not recorded — ${(e && e.message) || "the system refused it"}. Add it from the manager panel.`, false);
  }
}

// Save the guest's consented name+number after the bill is settled (Customer CRM).
// Fire-and-forget: it never blocks or reverses the payment that already went through.
// The server stores nothing without consent and records one visit per session.
async function captureCustomer(t, cust) {
  try {
    const r = await api("POST", `/tables/${t}/customer-capture`, { phone: cust.phone, name: cust.name, consent: cust.consent === true });
    if (r && r.ok) toast(`📇 Saved ${cust.name ? cust.name : "customer"}${r.visits ? ` · ${r.visits} visit${r.visits === 1 ? "" : "s"}` : ""}`);
  } catch { /* best-effort; the bill is already paid */ }
}

// tabletKhataFlow(t, due): "Collect later" — pick (or add) the person, then park the
// bill: the table frees up and the bill lives in the manager's Bills → Khata book.
async function tabletKhataFlow(t, due) {
  const who = await openKhataPersonSheet(due, t);
  if (!who) return;
  await actGated("POST", `/tables/${t}/khata`, who, { message: "Enter a manager PIN to park this bill.", toast: "📒 Parked — collect later from the manager's Pay Later list" });
  state.table = null; renderFloor(); renderPanel(); // the table just closed
}

// openKhataPersonSheet(due, t): the person picker — search the khata book by name or
// mobile (scoped, LIMIT 8 server-side) or add a new person. Resolves
// { customer_id } | { name, phone, note } | null. Same inline-modal style as the pay sheet.
function openKhataPersonSheet(due, t) {
  return new Promise((resolve) => {
    document.querySelector(".khata-overlay")?.remove();
    const ov = document.createElement("div");
    ov.className = "khata-overlay";
    Object.assign(ov.style, { position: "fixed", inset: "0", background: "var(--scrim)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
    const inputCss = "width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px";
    ov.innerHTML = `<div style="width:min(94vw,420px);max-height:90vh;overflow:auto;background:var(--panel);color:var(--text);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
      <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line)"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">Pay Later — who's this bill on?</h3><button class="kp-close" aria-label="Close" style="background:var(--panel-2);border:0;color:var(--text);border-radius:8px;padding:6px 10px;cursor:pointer">✕</button></div>
      <div style="padding:16px 18px">
        <div style="display:flex;justify-content:space-between;font-size:13.5px;color:var(--muted);margin-bottom:10px"><span>T${esc(t)} bill</span><b style="color:var(--text)">${inr(due)}</b></div>
        <input type="text" class="kp-search" maxlength="60" placeholder="🔍 Search name or mobile…" autocomplete="off" style="${inputCss};margin-bottom:8px">
        <div class="kp-list" style="border:1px solid var(--line);border-radius:10px;max-height:180px;overflow-y:auto"><div style="padding:10px 12px;color:var(--muted);font-size:13px">Type to search, or add a new person below.</div></div>
        <div style="font-size:12.5px;color:var(--muted);margin:10px 0 6px">— or add a new person —</div>
        <input type="text" class="kp-name" maxlength="80" placeholder="Full name *" autocomplete="off" style="${inputCss};margin-bottom:6px">
        <input type="tel" class="kp-phone" maxlength="20" placeholder="Mobile number (optional)" autocomplete="off" style="${inputCss};margin-bottom:6px">
        <input type="text" class="kp-note" maxlength="200" placeholder="Note (optional)" autocomplete="off" style="${inputCss}">
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding:14px 18px;border-top:1px solid var(--line)"><button class="btn kp-cancel">Cancel</button><button class="btn primary kp-go">📒 Park bill</button></div>
    </div>`;
    document.body.appendChild(ov);
    let resolved = false, pickedId = null;
    let backOff = window.LFH_BACK ? LFH_BACK.layer("tablet-khata", () => cancel()) : null;
    const close = () => { if (backOff) { backOff(); backOff = null; } ov.remove(); };
    const cancel = () => { close(); if (!resolved) resolve(null); };
    ov.querySelector(".kp-close").onclick = cancel;
    ov.querySelector(".kp-cancel").onclick = cancel;
    ov.onclick = (e) => { if (e.target === ov) cancel(); };
    const list = ov.querySelector(".kp-list");
    const search = ov.querySelector(".kp-search");
    const rowCss = "display:block;width:100%;text-align:left;padding:10px 12px;background:transparent;border:0;border-bottom:1px solid var(--line);color:var(--text);font-size:13.5px;cursor:pointer";
    const renderList = (customers) => {
      list.innerHTML = customers.length
        ? customers.map((cst) => `<button type="button" class="kp-row" data-cid="${esc(cst.id)}" style="${rowCss}"><b>${esc(cst.name)}</b><br><small style="color:var(--muted)">${esc(cst.phone || "no mobile")}${cst.note ? " · " + esc(cst.note) : ""}</small></button>`).join("")
        : `<div style="padding:10px 12px;color:var(--muted);font-size:13px">No one found — add them below.</div>`;
      list.querySelectorAll(".kp-row").forEach((row) => (row.onclick = () => {
        pickedId = row.dataset.cid;
        list.querySelectorAll(".kp-row").forEach((x) => (x.style.background = x === row ? "rgba(14,165,233,.18)" : "transparent"));
      }));
    };
    let seq = 0, timer = null;
    const doSearch = async () => {
      const mySeq = ++seq;
      try {
        const r = await api("GET", "/khata/customers?q=" + encodeURIComponent(search.value.trim()));
        if (mySeq === seq) renderList(r.customers || []); // latest-wins
      } catch { /* best-effort — add-new still works */ }
    };
    search.oninput = () => { pickedId = null; clearTimeout(timer); timer = setTimeout(doSearch, 250); };
    doSearch();
    ov.querySelector(".kp-go").onclick = () => {
      // The NAME comes back with the id (2026-08-21): a split's pay-later row prints WHO owes it.
      if (pickedId) {
        const r0 = ov.querySelector(`[data-cid="${pickedId}"] b`);
        resolved = true; close(); resolve({ customer_id: pickedId, name: (r0 && r0.textContent) || "" });
        return;
      }
      const name = ov.querySelector(".kp-name").value.trim();
      if (!name) { toast("Pick a person from the list, or type a name to add them.", false); return; }
      resolved = true; close();
      resolve({ name, phone: ov.querySelector(".kp-phone").value.trim(), note: ov.querySelector(".kp-note").value.trim() });
    };
  });
}

// openTagSheet(t): mark / clear this table's special type (mig 166). One tap each;
// PIN mode (tablet_table_tags='pin') is enforced by actGated + the server.
function openTagSheet(t) {
  document.querySelector(".tag-overlay")?.remove();
  const cur = ttagOf(t);
  const colors = { vip: "#8b5cf6", family: "#e11d48", guest: "#aab4c4" };
  const subs = { vip: "Priority service · pays normally", family: `"On the house" offered at billing`, guest: `"On the house" offered at billing` };
  const ov = document.createElement("div");
  ov.className = "tag-overlay";
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "var(--scrim)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  const opt = (tag) => `<button type="button" class="tag-pick" data-tag="${tag}" style="display:flex;align-items:center;gap:12px;width:100%;padding:12px;margin-bottom:8px;border-radius:12px;border:1.5px solid ${colors[tag]};background:linear-gradient(120deg, color-mix(in srgb, ${colors[tag]} 18%, var(--panel)), var(--panel));color:var(--text);font-size:14px;font-weight:600;text-align:left;cursor:pointer${cur === tag ? ";outline:2px solid var(--gold, #d4a574)" : ""}"><span style="font-size:19px">${TABLE_TAG_INFO[tag].emoji}</span><span>${TABLE_TAG_INFO[tag].label}<small style="display:block;font-weight:400;font-size:11.5px;color:var(--muted)">${subs[tag]}</small></span></button>`;
  ov.innerHTML = `<div style="width:min(94vw,380px);background:var(--panel);color:var(--text);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
    <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line)"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">Mark table ${esc(t)}</h3><button class="tg-close" aria-label="Close" style="background:var(--panel-2);border:0;color:var(--text);border-radius:8px;padding:6px 10px;cursor:pointer">✕</button></div>
    <div style="padding:16px 18px">
      <p style="margin:0 0 10px;font-size:12.5px;color:var(--muted)">How should staff treat this table? The mark clears itself when the table closes.</p>
      ${opt("vip")}${opt("family")}${opt("guest")}
      ${cur ? `<button type="button" class="tag-pick" data-tag="" style="display:flex;justify-content:center;width:100%;padding:11px;border-radius:12px;border:1.5px solid var(--line);background:var(--panel-2);color:var(--muted);font-size:14px;cursor:pointer">✕ &nbsp;Remove mark</button>` : ""}
    </div>
  </div>`;
  document.body.appendChild(ov);
  let backOff = window.LFH_BACK ? LFH_BACK.layer("tablet-tag", () => close()) : null;
  const close = () => { if (backOff) { backOff(); backOff = null; } ov.remove(); };
  ov.querySelector(".tg-close").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  ov.querySelectorAll(".tag-pick").forEach((b) => (b.onclick = () => {
    const tag = b.dataset.tag || null;
    close();
    // Optimistic: paint the tile NOW; the breadcrumb-driven refetch confirms it.
    const tile = (state.summary.tiles || {})[String(t)];
    const prev = tile ? tile.tag : undefined;
    if (tile) { tile.tag = tag || ""; renderFloor(); renderPanel(); }
    const done = tag ? `Marked ${TABLE_TAG_INFO[tag].emoji} ${TABLE_TAG_INFO[tag].label}` : "Mark removed";
    const revert = () => { if (tile) { tile.tag = prev || ""; renderFloor(); renderPanel(); } };
    (async () => {
      try {
        try {
          await api("POST", `/tables/${t}/tag`, { tag });
        } catch (e) {
          // 'pin' mode: the server asks for a manager PIN — same round-trip as actGated.
          if (!wantsPin(e)) throw e;
          let pin = await pinPrompt("Enter a manager PIN to mark this table.");
          let okd = false;
          while (pin) {
            try { await api("POST", `/tables/${t}/tag`, { tag, managerPin: pin }); okd = true; break; }
            catch (e2) {
              if (wantsPin(e2)) { pin = await pinPrompt("Enter a manager PIN to mark this table.", "That PIN didn't match — try again."); continue; }
              throw e2;
            }
          }
          if (!okd) { revert(); return; } // PIN cancelled
        }
        toast(done);
      } catch (e) { revert(); toast("Failed: " + errText(e), false); }
    })();
  }));
}
// Generate this table's invoice number, respecting tablet_invoice: 'on' → direct;
// 'pin' → manager-PIN-gated (server enforces it too). Independent of Mark bill paid —
// the RPC is idempotent, so this is safe even if somehow clicked twice.
async function genInvoice(sid) {
  // Who is this bill for? Mobile first; a number that has been here before brings its
  // name back by itself. Required by the restaurant → no invoice without both
  // (owner, 2026-07-30). The server enforces the same rule.
  const s = state.data.settings || {};
  let body = null;
  // TWO STEPS, NEVER THREE (owner, 2026-08-03). Issuing an invoice is a bill action, so it
  // must not fire on a single tap — but it already has a second step whenever the customer
  // sheet asks who the bill is for, or when the waiter's invoice power is PIN-gated. The
  // plain confirm therefore appears ONLY when neither of those will run, which is exactly
  // the case that used to issue an invoice number off one stray tap.
  const willAskCustomer = s.bill_customer_required !== false && !!window.LFH_BILLCUST;
  const willAskPin = tperm("tablet_invoice") === "pin";
  if (!willAskCustomer && !willAskPin) {
    if (!(await confirmDialog("Generate the invoice for this table?", "Generate invoice"))) return;
  }
  if (willAskCustomer) {
    // Re-issuing a reopened bill opens the sheet pre-filled with THIS session's own
    // customer (owner, 2026-07-30) — scoped to this session id, never another table's.
    const sess = (state.data.sessions || []).find((x) => x.id === sid);
    const prefill = sess && sess.cust_phone ? { phone: sess.cust_phone, name: sess.cust_name } : null;
    const cust = await LFH_BILLCUST.ask({ api, required: true, print: s.bill_customer_print !== false, prefill });
    if (!cust) return;                                // backed out — nothing is issued
    body = { cust_phone: cust.phone, cust_name: cust.name };
  }
  if (tperm("tablet_invoice") === "pin") {
    actGated("POST", `/sessions/${sid}/invoice`, body, { message: "Enter a manager PIN to generate this invoice.", toast: "Invoice generated" });
  } else {
    act(() => api("POST", `/sessions/${sid}/invoice`, body || undefined));
  }
}
// openDiscountModal — ONE discount interface for the whole product (owner, 2026-08-03:
// "everywhere change the discount menu"). Three boxes, all live-linked to the same ₹ figure the
// server has always stored:
//   Discount %   — type a percentage, the ₹ off and the pay-figure follow.
//   Discount ₹   — type the money off, the % and the pay-figure follow.
//   They pay     — type what the customer will actually hand over ("make it 800") and the
//                  discount + the percentage are worked out backward from it.
// This used to be two chips you had to pick BETWEEN — a waiter who wanted "20% but no more than
// ₹200 off" had to switch modes and do the other sum in their head. It is now the same screen the
// manager panel shows, box for box, so a person who learns one has learned both. save() below is
// untouched: it still respects tablet_discount (off/on/pin) and sends the same {amount, note}.
// Styled inline like this file's other self-contained modals (openDishEditModal, pinPrompt).
function openDiscountModal(order, opts = {}) {
  document.querySelector(".disc-overlay")?.remove();
  const round2 = (n) => Math.round(n * 100) / 100;
  const clamp = (n, lo, hi) => Math.min(Math.max(Number.isFinite(n) ? n : 0, lo), hi);
  const total = Number(order.total) || 0;       // GROSS, tax-incl, BEFORE discount (orders.total)
  const current = Number(order.discount) || 0;  // stored discount is a PRE-TAX rupee amount
  const rate = effRate();
  // Pre-tax food base this modal discounts. The stored discount is pre-tax and the bill is
  // (total − discount×(1+rate)); computing "They pay" off the tax-INCLUSIVE total (the old bug,
  // 2026-07-06) overstated it by discount×rate and mis-scaled the %. Mirror the manager's fix so
  // the on-screen "They pay" == the floor-tile due == the printed bill.
  // …and, since migration 270, only the TAXABLE part of it. An MRP price is final: a discount
  // may never eat into it (selling below the printed maximum is fine, but our discount is a
  // pre-tax rupee amount spread over the bill, so letting it reach an untaxed line would break
  // the identity every tile here relies on — due = total − discount×(1+rate)). opts.base lets
  // the whole-bill caller hand in the party's taxable base; a single ticket works it out from
  // its own frozen lines. Either way it falls back to today's number when nothing is untaxed.
  const split = orderTaxSplit(order);
  const base = Math.max(0, round2(Number.isFinite(Number(opts.base)) ? Number(opts.base) : split.base));
  const maxDisc = base; // can't discount more than the food's TAXABLE pre-tax value
  // The untaxed, FINAL money inside this bill (MRP lines), counted from the lines themselves.
  // The guest pays it whatever the discount is, so it rides through every "they pay" sum
  // untouched. Exactly 0 on an ordinary bill, which is what makes every line below identical
  // to what this modal did before mig 270.
  const lockedAmt = Math.max(0, round2(Number.isFinite(Number(opts.nontax)) ? Number(opts.nontax) : split.nontax));
  const payFor = (d) => round2(Math.max(0, base - clamp(d, 0, base)) * (1 + rate) + lockedAmt);
  let payVal = payFor(current);
  let pctVal = base > 0 ? Math.round((clamp(current, 0, base) / base) * 1000) / 10 : 0;
  const fieldCss = "width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:17px;font-weight:700";
  const lblCss = "font-size:13px;font-weight:700;margin:0 0 8px";

  const ov = document.createElement("div");
  ov.className = "disc-overlay";
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "var(--scrim)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  ov.innerHTML = `<div class="disc-box" style="width:min(94vw,420px);max-height:90vh;overflow:auto;background:var(--panel);color:var(--text);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
    <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line)"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">${opts.bill ? "Discount whole bill" : "Apply discount"}</h3><button class="disc-close" aria-label="Close" style="background:var(--panel-2);border:0;color:var(--text);border-radius:8px;padding:6px 10px;cursor:pointer">✕</button></div>
    <div style="padding:16px 18px">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px;color:var(--muted);margin-bottom:12px"><span>Bill total</span><b style="color:var(--text);font-size:15px">${inr(total)}</b></div>
      <div style="display:flex;align-items:flex-end;gap:10px">
        <div style="flex:1">
          <div style="${lblCss}">Discount %</div>
          <!-- step="0.01" on all three boxes below, NOT "1" (T7 sweep #7 third pass, 2026-08-30).
               Same fault the owner ruled on for the split screen's amount box on 2026-08-29: THIS
               SCREEN FILLS THE BOXES IN ITSELF and was declaring they only hold whole numbers.
               paint() writes a percent to one decimal (₹300 off ₹2,400 is 12.5) and an amount to
               the paise (round2), so the box refused the number the app had just put in it — a
               hardware ↑/↓ snapped 12.5 to 13, and a waiter correcting a figure by hand was pushed
               to whole rupees on a bill that carries paise. Nothing else changes: the arrows are
               still hidden (item 8) and "They pay" is still WRITTEN in whole rupees. -->
          <input type="number" inputmode="decimal" min="0" max="100" step="0.01" class="disc-pct-input" placeholder="0" style="${fieldCss}">
        </div>
        <div style="padding-bottom:12px;color:var(--muted);font-weight:800;font-size:16px">=</div>
        <div style="flex:1">
          <div style="${lblCss}">Discount amount (₹)</div>
          <input type="number" inputmode="decimal" min="0" step="0.01" class="disc-amt-input" placeholder="0" style="${fieldCss}">
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">${[0, 5, 10, 15, 20, 25, 50].map((p) => `<span class="chip disc-pct-pick" data-pct="${p}">${p ? p + "%" : "None"}</span>`).join("")}</div>
      <div style="margin-top:16px;padding:12px 14px;border-radius:12px;background:var(--bg);border:1px solid var(--line);display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;font-size:13.5px;color:var(--muted)"><span>Discount</span><b class="disc-prev-amt" style="color:var(--text)">− ${inr(current)}</b></div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:14.5px;padding-top:6px;margin-top:2px;border-top:1px dashed var(--line)">
          <span style="color:var(--gold-strong);font-weight:800">They pay</span>
          <label style="display:inline-flex;align-items:center;gap:1px;cursor:text;border:1px solid var(--line);border-radius:9px;padding:3px 8px 3px 9px;background:var(--panel)" title="Type what the customer will actually pay — the discount works itself out">
            <span style="color:var(--gold-strong);font-weight:800;font-size:15px">₹</span>
            <input type="number" inputmode="decimal" min="0" step="0.01" class="disc-pay-input" aria-label="Amount they pay" style="width:7ch;border:0;background:transparent;padding:0;margin:0;text-align:right;color:var(--gold-strong);font-weight:800;font-size:15px;font-family:inherit;font-variant-numeric:tabular-nums;outline:none">
          </label>
        </div>
      </div>
      <div class="disc-cap-note" style="display:none;margin-top:10px;padding:9px 11px;border-radius:9px;font-size:12.5px;font-weight:600;line-height:1.45;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.45);color:#fca5a5"></div>
      <div style="margin-top:8px;text-align:center;font-size:12px;color:var(--muted)">Change any one of the three — the other two follow.</div>
      <div style="font-size:13px;font-weight:700;margin:15px 0 6px">Reason <span style="color:var(--muted);font-weight:400">(optional)</span></div>
      <input type="text" class="disc-note-input" maxlength="200" placeholder="e.g. loyalty, comp, manager approval" style="width:100%;box-sizing:border-box;padding:9px 11px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px">
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;padding:14px 18px;border-top:1px solid var(--line)">
      ${current > 0 ? `<button class="btn danger disc-remove-btn">Remove</button><span style="flex:1"></span>` : ""}
      <button class="btn disc-cancel-btn">Cancel</button>
      <button class="btn primary disc-apply-btn">Apply</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector(".disc-note-input").value = order.discount_note || "";
  const payInput = ov.querySelector(".disc-pay-input");
  const pctInput = ov.querySelector(".disc-pct-input");
  const amtInput = ov.querySelector(".disc-amt-input");
  const applyBtn = ov.querySelector(".disc-apply-btn");
  pctInput.value = pctVal ? String(pctVal) : "";
  amtInput.value = current ? String(round2(current)) : "";

  let discAmount = clamp(current, 0, maxDisc);
  // Repaint every box EXCEPT the one being typed in, so a caret and a half-typed number survive.
  // "They pay" is written in whole rupees — the figure inr() puts on the tile and the paper.
  const paint = (typing) => {
    payVal = payFor(discAmount);
    pctVal = base > 0 ? Math.round((discAmount / base) * 1000) / 10 : 0;
    if (typing !== "pct") pctInput.value = discAmount ? String(pctVal) : "";
    if (typing !== "amt") amtInput.value = discAmount ? String(round2(discAmount)) : "";
    if (typing !== "pay") payInput.value = String(Math.round(payVal));
    ov.querySelector(".disc-prev-amt").textContent = "− " + inr(discAmount);
  };
  // #14 + sweep C2, both kept: a BLANK box is "I'm about to type", NOT "they pay ₹0" (which
  // silently comped a whole order), and a NEGATIVE or non-numeric paste is treated the same way.
  // While a box is unreadable the discount stays exactly as it was and Apply waits. A real 100%
  // comp is still reachable — type 0 into "They pay", or 100 into the percent box.
  // The button stays ENABLED and dims instead of going dead. A disabled button eats the tap, and
  // a tap that leaves no trace is indistinguishable from a broken control — the split-payment
  // button forty lines from here already refuses out loud for exactly this reason, and two
  // controls in one panel should not answer the same situation two different ways. `blank` is
  // read at click time (below) and answered with a sentence.
  let blankNow = false;
  const setBlank = (blank) => { blankNow = blank; if (applyBtn) applyBtn.style.opacity = blank ? ".55" : ""; };
  // OVER THE CAP MUST BE SAID, NOT SWALLOWED. Asking for more than the bill can give used to be
  // trimmed on blur with nothing on screen — the waiter typed ₹500, watched it become ₹300 and
  // had no idea why. A capped figure now names the real maximum and, when an MRP line is the
  // reason, says so, because that is the part a waiter can neither change nor guess.
  const capNote = ov.querySelector(".disc-cap-note");
  let overCap = false;
  const flagCap = (requested) => {
    overCap = Number(requested) > maxDisc + 0.005;
    if (!overCap) { capNote.style.display = "none"; capNote.textContent = ""; return; }
    capNote.style.display = "";
    capNote.textContent = lockedAmt > 0
      ? `The most you can take off this bill is ${inr(maxDisc)}. ${inr(lockedAmt)} of it is at a fixed MRP price — that part can't be discounted.`
      : `The most you can take off this bill is ${inr(maxDisc)} — that's the food value before tax.`;
  };
  paint();

  ov.querySelectorAll(".disc-pct-pick").forEach((c) => (c.onclick = () => { discAmount = round2((base * Number(c.dataset.pct)) / 100); setBlank(false); flagCap(discAmount); paint(); }));
  pctInput.oninput = () => {
    const raw = pctInput.value.trim();
    const p = parseFloat(raw);
    if (raw === "" || !(p >= 0)) { setBlank(true); return; }
    // A percent is measured against the taxable base, so 100% is the cap by construction —
    // but a typed 150 still gets an answer rather than a silent snap to 100.
    setBlank(false); flagCap(round2((base * p) / 100)); discAmount = round2((base * clamp(p, 0, 100)) / 100); paint("pct");
  };
  amtInput.oninput = () => {
    const raw = amtInput.value.trim();
    const a = parseFloat(raw);
    if (raw === "" || !(a >= 0)) { setBlank(true); return; }
    setBlank(false); flagCap(a); discAmount = clamp(a, 0, maxDisc); paint("amt");
  };
  payInput.oninput = () => {
    const raw = payInput.value.trim();
    const p = parseFloat(raw);
    if (raw === "" || !(p >= 0)) { setBlank(true); return; }
    setBlank(false);
    // "They pay P" (tax-incl) → the MRP part is paid whatever happens, so it comes off first:
    // d = base − (P − lockedAmt)/(1+rate), clamped to the taxable food base.
    const wanted = round2(base - Math.max(0, clamp(p, 0, payFor(0)) - lockedAmt) / (1 + rate));
    flagCap(p < lockedAmt ? maxDisc + 1 : wanted); // "they pay less than the MRP total" is over the cap
    discAmount = clamp(wanted, 0, maxDisc);
    paint("pay");
  };
  // Leaving a box snaps it back to the truth — an over-limit or emptied figure must never sit
  // there disagreeing with the discount that would actually be applied.
  pctInput.onblur = () => { setBlank(false); paint(); };
  amtInput.onblur = () => { setBlank(false); paint(); };
  payInput.onblur = () => { setBlank(false); paint(); };

  let backOff = window.LFH_BACK ? LFH_BACK.layer("tablet-discount", () => close()) : null;
  const close = () => { if (backOff) { backOff(); backOff = null; } ov.remove(); };
  ov.querySelector(".disc-close").onclick = close;
  ov.querySelector(".disc-cancel-btn").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };

  const save = (amount) => {
    const note = ov.querySelector(".disc-note-input").value.trim();
    close();
    const body = { amount, note: amount > 0 ? note : "" };
    // Whole-bill discount: one call to the session endpoint; the server splits it across the
    // table's tickets, so there's no single order to update optimistically — just persist +
    // reconcile. actGated handles the on/pin rule. (mig 143)
    if (opts.bill) {
      actGated("POST", `/sessions/${order.id}/bill-discount`, body, { message: "Enter a manager PIN to apply this discount.", toast: amount > 0 ? `Bill discount ${inr(amount)} applied` : "Bill discount removed" });
      return;
    }
    if (tperm("tablet_discount") === "pin") {
      // PIN entry already masks the round-trip; skip the optimistic write so a cancelled PIN
      // can't leave a discount showing that never saved.
      actGated("POST", `/orders/${order.id}/discount`, body, { message: "Enter a manager PIN to apply this discount.", toast: amount > 0 ? `Discount ${inr(amount)} applied` : "Discount removed", expect: { table: "orders", id: order.id, fields: { discount: Number(order.discount || 0) } } });
    } else {
      // #13: reflect the discount locally NOW (label + due) so the tap feels instant instead of
      // lagging a ~1s server round-trip; act()'s load() reconciles to server truth right after.
      // Capture what the discount WAS before that optimistic flip — that's what the server
      // compares against, so two people discounting the same bill can't overwrite each other.
      const wasDiscount = Number(order.discount || 0);
      order.discount = amount; order.discount_note = amount > 0 ? note : null;
      patchTileFromSlice(order.table_number);
      if (!state.ordering) renderPanel();
      act(() => api("POST", `/orders/${order.id}/discount`, body, { expect: { table: "orders", id: order.id, fields: { discount: wasDiscount } } }));
    }
  };
  ov.querySelector(".disc-apply-btn").onclick = () => {
    if (blankNow) { toast("Type a discount in one of the three boxes first — or tap Cancel to leave the bill as it is.", false); return; }
    // Over the cap: REFUSE this tap out loud and snap every box to the real maximum, so the
    // waiter sees what would actually be applied before it is. The next tap applies it. The tap
    // is never swallowed and the figure is never quietly changed under an Apply.
    if (overCap) {
      toast(capNote.textContent, false);
      flagCap(discAmount);  // now within the cap → the red note clears
      paint();              // every box snaps to the maximum that WILL be applied
      return;
    }
    save(discAmount);
  };
  const removeBtn = ov.querySelector(".disc-remove-btn"); if (removeBtn) removeBtn.onclick = () => save(0);
  // The pay box already holds the full bill, so tapping it must SELECT that figure — otherwise
  // "make it 800" on a ₹817 bill types 817800 and the waiter has to clear it first.
  payInput.onfocus = () => payInput.select();
  setTimeout(() => { payInput.focus(); payInput.select(); }, 30);
}

// tabletDiscount: entry point wired from the "− Discount" button on each order card —
// opens the modal above scoped to that order (clamped to that order's own total).
function tabletDiscount(orderId) {
  const o = (state.data.orders || []).find((x) => x.id === orderId);
  if (!o) { toast("That order is no longer on the board.", false); return; }
  openDiscountModal(o);
}

// tabletBillDiscount: whole-bill discount for a table — opens the SAME modal but scoped to the
// session. Base = Σ of the table's UNPAID, non-cancelled order totals; the server splits the
// discount across those tickets (mig 143). Mutually exclusive with per-ticket discount.
function tabletBillDiscount(t) {
  const s = sessionOf(t);
  if (!s || String(s.id).startsWith("pending-")) { toast("Open the table first.", false); return; }
  const unpaid = partyOrders(t).filter((o) => o.status !== "cancelled" && o.payment_status !== "paid"); // whole-bill = the PARTY's bill
  if (!unpaid.length) { toast("No unpaid orders to discount yet.", false); return; }
  // sessions.discount is the WHOLE-BILL discount total; the server (lfh_split_bill_discount) then
  // spreads (that − discount already on PAID orders) across the still-unpaid orders. So this modal
  // MUST speak WHOLE-BILL too: base = every non-cancelled order (paid + unpaid), current value =
  // sessions.discount. If it worked on only the unpaid remainder, the amount it SENDS would be
  // remainder-scoped while the server reads it as the whole-bill total and subtracts the paid part a
  // SECOND time — quietly over-charging the remaining guests after a partial payment. (audit 2026-07-09)
  const billable = partyOrders(t).filter((o) => o.status !== "cancelled");
  const billTotal = billable.reduce((sum, o) => sum + (Number(o.total) || 0), 0); // whole bill, gross — the whole PARTY's
  // The party's TAXABLE base — the same rows, same rule, one ticket at a time (mig 270). With
  // nothing untaxed on the table this is exactly billTotal/(1+rate), i.e. the old cap.
  const billBase = Math.round(billable.reduce((sum, o) => sum + orderTaxSplit(o).base, 0) * 100) / 100;
  const billNontax = Math.round(billable.reduce((sum, o) => sum + orderTaxSplit(o).nontax, 0) * 100) / 100;
  openDiscountModal({ id: s.id, table_number: t, total: billTotal, discount: Number(s.discount) || 0, discount_note: s.discount_note || "" }, { bill: true, base: billBase, nontax: billNontax });
}

// ── order-taking mode ────────────────────────────────────────────────────────
const dishPrice = (d) => Number(String(d.price).replace(/[^0-9.]/g, "")) || 0;

// Add ONE dish to an already-placed order (staff edit). Server prices + re-prices.
// Stays in add mode so the waiter can add several, then taps "✓ Done".
const addingDishKeys = new Set();
const pendingAddQty = new Map(); // key -> extra qty tapped while an add was in flight (coalesced, never dropped)
async function addDishToOrder(orderId, payload) {
  // The key includes the typed PRICE for open-price dishes. Coalescing replays the FIRST
  // tap's payload with the summed qty, so two cans added at ₹20 then ₹50 inside one
  // round-trip both rang up at ₹20 — the exact case ("prices can differ between two cans")
  // the feature exists for. A different amount ⇒ a different key ⇒ its own add.
  const key = orderId + "|" + (payload && (payload.dishId || payload.id))
    + (payload && payload.price != null ? "|@" + payload.price : "");
  const tapQty = Math.max(1, Math.round(Number(payload && payload.qty) || 1));
  // While an add for THIS dish is in flight, don't DROP repeat taps (add mode has no visible
  // cart, so fast-tapping the same dish 3× used to land only 1 — audit 2026-07-08 round2).
  // Accumulate the extra qty and flush it as ONE add when the in-flight call returns; the
  // server's add-item respects a qty>1 (the options modal already relies on that).
  if (addingDishKeys.has(key)) { pendingAddQty.set(key, (pendingAddQty.get(key) || 0) + tapQty); return; }
  addingDishKeys.add(key);
  try {
    const r = await api("POST", `/orders/${orderId}/add-item`, payload);
    if (r && r.ok === false) { toast("Couldn't add: " + (r.reason || "rejected"), false); return; }
    // #16: keep a running "added this visit" tally so the waiter can see what they've piled on
    // (the cart badges aren't used in add mode). Rendered on the "✓ Done" button.
    state._addedThisVisit = (state._addedThisVisit || 0) + tapQty;
    // #2: offline → the add is queued; say so honestly instead of "Dish added ✓".
    toast(isQueued(r) ? "Dish saved ✓ — adds when you're back online" : "Dish added ✓");
    await load();  // offline → no-ops; the tally + toast are the feedback until reconnect
    if (state.addToOrderId) renderOrderMode(); else if (!state.ordering) renderPanel();
  } catch (e) { toast("Failed: " + errText(e), false); }
  finally {
    addingDishKeys.delete(key);
    // Flush any taps that arrived mid-flight, as ONE accumulated add (keeps the same dish
    // options/removed), so no fast tap is ever silently lost.
    const extra = pendingAddQty.get(key);
    if (extra > 0) { pendingAddQty.delete(key); addDishToOrder(orderId, Object.assign({}, payload, { qty: extra })); }
  }
}

// Menu-style browse (owner, 2026-07-03): ALL categories are laid out as sections in ONE
// scrollable browser — the category rail/chips JUMP to a section on tap and FOLLOW the
// scroll (scroll-spy, same trick as the guest menu's computeSpy). Searching collapses the
// sections into a single flat result list, exactly like before.
function orderSections() {
  // #11: fold accents on BOTH sides so "caffe latte" finds "Caffè Latte" (waiter search
  // used to be plain toLowerCase, so accented dishes looked missing from the menu).
  const q = foldAccents(state.dishSearch.trim());
  if (q) {
    const dishes = state.data.dishes.filter((d) => foldAccents(d.title || "").includes(q));
    return dishes.length ? [{ slug: "__search", label: "Search results", dishes }] : [];
  }
  const cats = (state.data.categories || []).filter((c) => c.active !== false);
  const bySlug = new Map(cats.map((c) => [c.slug, { slug: c.slug, label: (c.name && c.name.en) || c.slug, dishes: [] }]));
  const other = { slug: "__other", label: "Other", dishes: [] };
  for (const d of state.data.dishes) (bySlug.get(d.category) || other).dishes.push(d);
  const secs = [...bySlug.values()].filter((s) => s.dishes.length);
  if (other.dishes.length) secs.push(other);
  return secs;
}
// The badge in a dish tile's bottom-right. Empty = a plain ＋ hint (tap the tile to add);
// once in the cart it's a real − button (tap to remove one — the rest of the tile still
// adds one) next to the ×N count. Shared by the first render + the two in-place updaters
// so all three stay identical. (owner 2026-07-08)
function dishBadgeInner(id, qty) {
  return qty
    ? `<span class="dminus" data-dishminus="${esc(id)}" role="button" aria-label="Remove one">−</span><span class="dqty">×${qty}</span>`
    : `<span class="dadd" aria-hidden="true">＋</span>`;
}
function dishBtnHtml(d) {
  const out = (d.tags || []).includes("sold-out");
  // Total this dish across ALL its cart lines (a dish can now appear on several
  // lines — e.g. plain + "no nuts"), so the badge shows the true count.
  const inCartQty = state.cart.filter((l) => l.id === d.id).reduce((s, l) => s + l.qty, 0);
  // OFF THE GUEST MENU, still orderable here (mig 306, owner 2026-08-06). A hidden dish is an
  // off-menu special / staff meal / something served on request: the diner never sees it, the
  // waiter still can. It must be LABELLED, or a waiter reads the tile as a normal dish and can't
  // tell why the table's own phone doesn't list it.
  const offMenu = (d.tags || []).includes("hidden");
  return `<button class="dish ${out ? "out" : ""} ${offMenu ? "offmenu" : ""} ${inCartQty ? "in" : ""}" data-dish="${esc(d.id)}" ${out ? "disabled" : ""}>
    ${offMenu ? `<span class="doffmenu" title="Not on the guest menu — you can still add it">OFF MENU</span>` : ""}
    ${out ? "" : `<span class="dedit" data-dishedit="${esc(d.id)}" role="button" aria-label="Quantity / allergy" title="Set quantity or allergy">✎</span>`}
    <span class="dname">${esc(d.title)}</span>
    <span class="drow">
      <span class="dprice">${out ? "SOLD OUT" : (d.open_price ? "Set price" : inr(dishPrice(d)))}</span>
      ${dishIsMrp(d) ? `<span class="mrp-tag" title="Maximum Retail Price — final, no tax added and no discount allowed">MRP</span>` : ""}
      <span class="dbadge">${out ? "" : dishBadgeInner(d.id, inCartQty)}</span>
    </span>
  </button>`;
}
let menuReloadInFlight = false;
function orderSectionsHtml() {
  const secs = orderSections();
  if (!secs.length) {
    // Empty because the MENU hasn't loaded yet (two-tier: the dishes ride the /summary full load,
    // so opening Take-order mid-load found an empty list and wrongly showed "No dishes match") vs
    // a search that truly matched nothing. If it's NOT a search and no dishes are cached, show a
    // loading line + kick ONE fresh load, then re-render the moment it lands. (audit 2026-07-09)
    if (!state.dishSearch.trim() && !(state.data.dishes || []).length) {
      if (!menuReloadInFlight) {
        menuReloadInFlight = true;
        load().finally(() => { menuReloadInFlight = false; state._menuLoadedOnce = true; if (state.ordering && !state.viewOrder) renderOrderMode(); });
      }
      return state._menuLoadedOnce
        ? `<div class="muted" style="padding:14px">No dishes on the menu yet.</div>`
        : `<div class="muted" style="padding:14px;display:flex;align-items:center;gap:8px"><span class="tsl-dot"></span> Loading the menu…</div>`;
    }
    return `<div class="muted" style="padding:14px">No dishes match.</div>`;
  }
  return secs.map((s) => `<section class="om-sec" data-cat="${esc(s.slug)}">
    <h3 class="om-sec-h">${esc(s.label)} <span class="om-sec-n">· ${s.dishes.length}</span></h3>
    <div class="dishgrid">${s.dishes.map(dishBtnHtml).join("")}</div>
  </section>`).join("");
}
function orderNavHtml() {
  if (state.dishSearch.trim()) return "";
  return orderSections().map((s, i) =>
    `<button class="om-cat ${i === 0 ? "on" : ""}" data-cat="${esc(s.slug)}">${esc(s.label)}</button>`).join("");
}
// Tap a category → INSTANT jump to its section (owner: "fastly shift"; instant also can't
// be cancelled mid-flight by a finger touching the list, which left the scroll stranded
// halfway). Scrolling highlights the section under the header line (spy). An end spacer
// guarantees even the LAST category can reach the top — without it the scroll hits its
// limit and "stops in the middle" for the bottom categories.
function wireOrderNav() {
  const sc = $("#omScroll");
  if (!sc) return;
  // End spacer: tall enough that the last section's top can align with the scroller's top.
  const secs = sc.querySelectorAll(".om-sec");
  if (secs.length) {
    let pad = sc.querySelector(".om-endpad");
    if (!pad) { pad = document.createElement("div"); pad.className = "om-endpad"; pad.setAttribute("aria-hidden", "true"); sc.appendChild(pad); }
    const last = secs[secs.length - 1];
    pad.style.height = Math.max(0, sc.clientHeight - last.offsetHeight - 24) + "px";
  }
  const btns = [...document.querySelectorAll(".om-nav .om-cat")];
  const setOn = (slug) => btns.forEach((b) => {
    const on = b.dataset.cat === slug;
    b.classList.toggle("on", on);
    if (on) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  btns.forEach((b) => (b.onclick = () => {
    const s = sc.querySelector(`.om-sec[data-cat="${(window.CSS && CSS.escape) ? CSS.escape(b.dataset.cat) : b.dataset.cat}"]`);
    // A category chip whose section isn't on screen — it should be impossible (the chips are built
    // from the same sections), but "should be impossible" is what a silent return always says. If it
    // ever fires we hear about it instead of the waiter tapping a dead chip. T4 sweep, 2026-08-11.
    if (!s) { toast("Nothing in that group right now.", false); return; }
    state._omMute = Date.now() + 200;
    setOn(b.dataset.cat);
    // Instant, not smooth: overrides the CSS scroll-behavior so the jump lands in one frame.
    sc.style.scrollBehavior = "auto";
    sc.scrollTop = Math.max(0, s.offsetTop - 6);
    sc.style.scrollBehavior = "";
  }));
  let raf = 0;
  sc.onscroll = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      // Remember the BROWSE spot only (not search-result scrolling), so clearing a
      // search / returning from the options screen lands back where the waiter was.
      if (!state.dishSearch.trim()) state._omTop = sc.scrollTop;
      if (Date.now() < (state._omMute || 0)) return;
      const secs = [...sc.querySelectorAll(".om-sec")];
      if (!secs.length || !btns.length) return;
      const line = sc.scrollTop + 56;              // just under the sticky section header
      let active = secs[0];
      for (const s of secs) if (s.offsetTop <= line) active = s;
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 24) active = secs[secs.length - 1];
      setOn(active.dataset.cat);
    });
  };
}
// Refresh every dish button's ×N badge + highlight IN PLACE (no grid rebuild → the
// browse scroll position survives adding dishes).
function updateDishBadges() {
  document.querySelectorAll("#omScroll .dish[data-dish]").forEach((btn) => {
    const qty = state.cart.filter((l) => l.id === btn.dataset.dish).reduce((s, l) => s + l.qty, 0);
    btn.classList.toggle("in", qty > 0);
    const slot = btn.querySelector(".dbadge");
    if (slot && !btn.disabled) slot.innerHTML = dishBadgeInner(btn.dataset.dish, qty);
  });
}
// #17: patch each visible dish button's SOLD-OUT state in place — called when a menu realtime
// event lands while the waiter is mid-order (the grid isn't rebuilt then, so a dish that just
// sold out would otherwise stay tappable until the waiter learns on send). No full re-render,
// so the browse scroll + cart are untouched.
function updateDishAvailability() {
  document.querySelectorAll("#omScroll .dish[data-dish]").forEach((btn) => {
    const d = state.data.dishes.find((x) => x.id === btn.dataset.dish);
    // tap-guard: silent-ok — this is a REPAINT loop over every tile, not a person's tap. A dish that
    // has left the menu entirely has no availability to restate, and the tile it leaves behind is
    // already handled where it matters: tapping it hits the [data-dish] handler below, which says
    // "That dish just changed — refreshing the menu" and rebuilds. Nothing is owed to anyone here.
    if (!d) return;
    const out = (d.tags || []).includes("sold-out");
    btn.classList.toggle("out", out);
    btn.disabled = out;
    // …and the off-menu mark, for the same reason the price is mirrored here: a menu change
    // landing mid-order must not leave the tile telling the waiter something that is no longer true.
    btn.classList.toggle("offmenu", (d.tags || []).includes("hidden"));
    const priceEl = btn.querySelector(".dprice");
    // MIRROR dishBtnHtml() EXACTLY, including the open-price case (T4 sweep, 2026-08-04). This
    // patcher wrote inr(dishPrice(d)) unconditionally, so when a menu change landed while the
    // waiter was mid-order an as-per-MRP dish's tile stopped saying "Set price" and started
    // advertising "₹0" — a price the restaurant does not charge. Tapping it still asked for the
    // price (that reads d.open_price), so only the label lied, which is the worst combination.
    if (priceEl) priceEl.textContent = out ? "SOLD OUT" : (d.open_price ? "Set price" : inr(dishPrice(d)));
    const editEl = btn.querySelector(".dedit");
    if (editEl) editEl.style.display = out ? "none" : "";
    const slot = btn.querySelector(".dbadge");
    if (slot) {
      if (out) slot.innerHTML = "";
      else {
        const qty = state.cart.filter((l) => l.id === d.id).reduce((s, l) => s + l.qty, 0);
        slot.innerHTML = dishBadgeInner(d.id, qty);
      }
    }
  });
}
// Mirror of the quick-add: take ONE off the cart for this dish. Prefer the PLAIN line
// (the one quick-add stacks onto); if there's only a customised/sized line, peel one off
// that. Removing the last of a line drops the line entirely. (owner 2026-07-08)
function removeOneDish(id) {
  let idx = state.cart.findIndex((l) => l.id === id && !l.options && !(l.avoid && l.avoid.length) && !l.note);
  if (idx < 0) idx = state.cart.findIndex((l) => l.id === id);
  if (idx < 0) return;
  const line = state.cart[idx];
  line.qty -= 1;
  if (line.qty <= 0) state.cart.splice(idx, 1);
}
// OPEN-PRICE dish (as-per-MRP / market price): ask the waiter for the price first, then carry
// it on the line. Each tap is its own line (prices can differ between two cans), and the
// open_price flag is what makes the server trust this typed price for this dish only.
// ONE place, because EVERY way of adding the dish has to come through here — the tile's ✎
// went straight to the options popup instead, which has no groups to pick for these dishes and
// pushed a ₹0 line with no open_price marker, so the server refused the whole order.
async function addOpenPriceDish(d) {
  const p = await pricePrompt(d.title);
  if (p == null) return;                       // cancelled — add nothing
  if (state.addToOrderId) { addDishToOrder(state.addToOrderId, { dishId: d.id, qty: 1, price: p }); return; }
  state.cart.push({ id: d.id, title: d.title, price: p, qty: 1, open_price: true });
  updateDishBadges(); updateOrderCart(); updateViewPill();
}

function bindDishButtons() {
  // The small ✎ on each tile → the quantity/allergy popup (owner 2026-07-05). Its own
  // handler, and it stops the tile's quick-add from also firing.
  document.querySelectorAll("[data-dishedit]").forEach((el) => (el.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    const d = state.data.dishes.find((x) => x.id === el.dataset.dishedit);
    // The SAME sentence the tile's own tap already used, two handlers below — the ✎ on a tile was
    // silent while the tile itself spoke, for the identical cause (a `menu` breadcrumb refetches the
    // dish list mid-order; updateDishAvailability() runs on that very event). T4 sweep, 2026-08-11.
    if (!d) { toast("That dish just changed — refreshing the menu", false); renderOrderMode(); return; }
    if (d.open_price) { await addOpenPriceDish(d); return; } // ask the price, same as a tap
    renderDishOptions(d, null);
  }));
  document.querySelectorAll("[data-dish]").forEach((b) => (b.onclick = async (e) => {
    if (e.target.closest && e.target.closest("[data-dishedit]")) return; // ✎ handled above
    const d = state.data.dishes.find((x) => x.id === b.dataset.dish);
    if (!d) { toast("That dish just changed — refreshing the menu", false); renderOrderMode(); return; }
    // The − button (only shown once the dish is in the cart) removes ONE. Checked before
    // everything else so it works even for a sized/options dish. The rest of the tile still
    // adds. (owner 2026-07-08)
    if (e.target.closest && e.target.closest("[data-dishminus]")) {
      removeOneDish(d.id);
      updateDishBadges(); updateOrderCart(); updateViewPill();
      return;
    }
    // OPEN-PRICE dish (as-per-MRP / market price) — ask for the price, then add.
    if (d.open_price) { await addOpenPriceDish(d); return; }
    // A sized/extra dish can't be quick-added blindly — open the popup to choose.
    if (Array.isArray(d.options) && d.options.length) { renderDishOptions(d, null); return; }
    // ADD-TO-EXISTING-ORDER mode: a plain dish is added straight away (no cart).
    if (state.addToOrderId) { addDishToOrder(state.addToOrderId, { dishId: d.id, qty: 1 }); return; }
    // A quick tap only stacks onto a PLAIN line of this dish — one with no options,
    // no per-item allergy and no note. An edited line (e.g. "no nuts") is left alone,
    // so tapping the dish again starts a fresh plain line instead of bumping the
    // customised one — letting a waiter order "1 no-nuts" AND "1 normal" of the same
    // dish side by side. (owner, 2026-06-16)
    const line = state.cart.find((l) => l.id === d.id && !l.options && !(l.avoid && l.avoid.length) && !l.note);
    if (line) line.qty = Math.min(99, line.qty + 1);
    else state.cart.push({ id: d.id, title: d.title, price: dishPrice(d), qty: 1 });
    // Patch the badge + cart pane in place — a full re-render would reset the browse scroll.
    updateDishBadges(); updateOrderCart(); updateViewPill();
  }));
}
// The floating "View order" pill (phone browse screen) — keep its count + total live.
function updateViewPill() {
  const pill = document.getElementById("omViewBtn");
  if (!pill) return;
  const n = state.cart.reduce((s, l) => s + l.qty, 0);
  const total = state.cart.reduce((s, l) => s + l.price * l.qty, 0);
  pill.classList.toggle("vp-empty", n === 0);
  pill.innerHTML = `<span class="vp-n">${n}</span><span class="vp-lbl">View order</span><span class="vp-total">${inr(total)}</span><i class="vp-arrow">→</i>`;
}

// The per-dish POPUP (owner 2026-07-05): opened by the ✎ on a tile (or on a cart line).
// A modal OVER the menu — quantity stepper + a per-item allergy/avoid field (+ any
// size/extras) — so the menu behind is untouched (browse scroll survives). The plain
// tap on a tile still quick-adds without opening this.
let optBackOff = null;
function renderDishOptions(d, editIndex) {
  const sel = {};
  const line = editIndex != null ? state.cart[editIndex] : null;
  if (line && line.options) for (const o of line.options) (sel[o.group] = sel[o.group] || []).push(o.label);
  // `avoid` is this dish's allergy list (standard slugs + any typed ones) and `note` is free
  // text for the kitchen. They used to be ONE box, which meant "less ice" and "no nuts" were
  // indistinguishable; chips + Other keep the allergies structured (owner, 2026-08-04).
  state._opt = { d, sel, editIndex, avoid: new Set((line && line.avoid) || []), note: (line && line.note) || "", qty: (line && line.qty) || 1 };
  if (window.LFH_BACK && !optBackOff) optBackOff = LFH_BACK.layer("tablet-optpopup", closeDishOptions);
  drawDishOptions();
}
function closeDishOptions() {
  const ov = document.getElementById("optOverlay"); if (ov) ov.remove();
  state._opt = null;
  if (optBackOff) { optBackOff(); optBackOff = null; }
}
// The per-dish allergy row inside the popup: the six standard chips, then any TYPED ones
// already on this dish (always "on" — tap to take one off), then ＋ Other to add a new one.
// Same shape as the manager's take-order row, so the two panels teach one habit.
function optAlgChips() {
  const av = (state._opt && state._opt.avoid) || new Set();
  return ALLERGENS.map((a) => `<button class="optchoice ${av.has(a.slug) ? "on" : ""}" data-alg="${esc(a.slug)}">${esc(a.label)}</button>`).join("")
    + [...av].filter((s) => !ALG_STD.includes(s)).map((s) => `<button class="optchoice on" data-alg="${esc(s)}">${esc(algLabel(s))}</button>`).join("")
    + `<button class="optchoice alg-other" data-alg="" data-alg-other="1" title="Type an allergy that isn't listed">＋ Other</button>`;
}
function drawDishOptions() {
  if (!state._opt) return;
  const { d, sel, editIndex } = state._opt;
  const base = dishPrice(d);
  let addons = 0;
  const groups = (d.options || []).map((g) => {
    const multi = g.type === "multi";
    const choices = (g.choices || []).map((c) => {
      const on = (sel[g.name] || []).includes(c.label);
      if (on) addons += Number(c.price) || 0;
      const plus = Number(c.price) > 0 ? ` <em>+${inr(c.price)}</em>` : "";
      return `<button class="optchoice ${on ? "on" : ""}" data-optg="${esc(g.name)}" data-optl="${esc(c.label)}" data-multi="${multi}">${esc(c.label)}${plus}</button>`;
    }).join("");
    return `<div class="optgroup"><h4>${esc(g.name)}${multi ? ` <span class="muted small">· choose any</span>` : ""}</h4><div class="optchoices">${choices}</div></div>`;
  }).join("");
  const unit = base + addons;
  const qty = Math.max(1, state._opt.qty || 1);
  let ov = document.getElementById("optOverlay");
  if (!ov) { ov = document.createElement("div"); ov.id = "optOverlay"; ov.className = "opt-overlay"; document.body.appendChild(ov); }
  ov.innerHTML = `
    <div class="opt-pop" role="dialog" aria-modal="true">
      <div class="opt-head"><h3>${esc(d.title)}</h3><button class="opt-x" id="optClose" aria-label="Close">✕</button></div>
      <div class="opt-scroll">
        <div class="muted small">Base ${inr(base)}</div>
        ${groups || ""}
        <div class="optgroup"><h4>⚠ Avoid in this dish <span class="muted small">· tap to add or remove</span></h4>
          <div class="optchoices opt-alg">${optAlgChips()}</div></div>
        <div class="optgroup"><h4>✎ Note for this dish <span class="muted small">· kitchen sees exactly what you type</span></h4>
          <input type="text" id="optNote" class="note allergy" placeholder="e.g. less ice, extra spicy" value="${esc(state._opt.note || "")}"></div>
        <div class="optgroup"><h4>Quantity</h4>
          <div class="opt-qty"><button class="qbtn" id="optMinus" aria-label="Less">−</button><b id="optQ">${qty}</b><button class="qbtn" id="optPlus" aria-label="More">+</button></div></div>
      </div>
      <div class="opt-foot">
        <div class="ctotal"><span>${qty} × ${inr(unit)}</span><b>${inr(unit * qty)}</b></div>
        <button class="btn primary big" id="optAdd">${editIndex != null ? "Update item" : "Add to order"}</button>
      </div>
    </div>`;
  ov.onclick = (e) => { if (e.target === ov) closeDishOptions(); };   // tap the dim backdrop to close
  ov.querySelectorAll("[data-optg]").forEach((b) => (b.onclick = () => {
    const g = b.dataset.optg, l = b.dataset.optl, multi = b.dataset.multi === "true";
    const cur = sel[g] || [];
    sel[g] = multi ? (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]) : (cur.includes(l) ? [] : [l]);
    drawDishOptions();
  }));
  const nt = ov.querySelector("#optNote"); if (nt) nt.oninput = (e) => (state._opt.note = e.target.value);
  // The allergy row: standard chips toggle, ＋ Other asks for a word first. Both redraw the
  // popup, which is safe — the note's typed value is read into state on every keystroke above.
  ov.querySelectorAll("[data-alg]").forEach((b) => (b.onclick = async () => {
    const av = state._opt.avoid;
    if (b.dataset.algOther) { const v = await allergyPrompt(av); if (v) { av.add(v); drawDishOptions(); } return; }
    const s = b.dataset.alg; av.has(s) ? av.delete(s) : av.add(s); drawDishOptions();
  }));
  ov.querySelector("#optMinus").onclick = () => { state._opt.qty = Math.max(1, qty - 1); drawDishOptions(); };
  ov.querySelector("#optPlus").onclick = () => { state._opt.qty = Math.min(99, qty + 1); drawDishOptions(); };
  ov.querySelector("#optClose").onclick = closeDishOptions;
  ov.querySelector("#optAdd").onclick = () => {
    const opts = [];
    for (const g of (d.options || [])) for (const c of (g.choices || [])) {
      if ((sel[g.name] || []).includes(c.label)) opts.push({ group: g.name, label: c.label, price: Number(c.price) || 0 });
    }
    const unitPrice = base + opts.reduce((s, o) => s + o.price, 0);
    const avoid = [...state._opt.avoid];
    const noteTxt = (state._opt.note || "").trim();
    const useQty = Math.max(1, state._opt.qty || 1);
    // ADD-TO-EXISTING-ORDER mode: send straight to the order's add-item endpoint. The
    // allergies are worded "no X" (they ARE avoids); the note travels VERBATIM, because the
    // kitchen must see exactly what was typed — "less ice" once printed as "NO LESS ICE"
    // when the two shared one box.
    if (state.addToOrderId) {
      const note = [avoid.length ? `⚠ no ${avoid.join(", ")}` : "", noteTxt].filter(Boolean).join(" · ");
      addDishToOrder(state.addToOrderId, { dishId: d.id, qty: useQty, options: opts.length ? opts.map((o) => ({ group: o.group, label: o.label })) : undefined, note: note || undefined });
      closeDishOptions();
      return;
    }
    const line = { id: d.id, title: d.title, price: unitPrice, qty: useQty, options: opts.length ? opts : undefined,
      avoid: avoid.length ? avoid : undefined, note: noteTxt || undefined };
    if (editIndex != null && state.cart[editIndex]) state.cart[editIndex] = line;
    else state.cart.push(line);
    closeDishOptions();
    // Patch in place — no full re-render, so the browse scroll + the view-order stay put.
    updateDishBadges(); updateOrderCart(); updateViewPill();
  };
}

// The whole-order avoid list. It is STORED as one comma-separated string (`state.allergies`)
// because that is what both send paths already split and send — the chips are a new face on
// the same value, not a new shape. Read it as a set, write it back joined.
const orderAlgSet = () => new Set(String(state.allergies || "").split(",").map((x) => normAlg(x)).filter(Boolean));
const setOrderAlg = (set) => { state.allergies = [...set].join(", "); };
function orderAlgChips() {
  const av = orderAlgSet();
  return ALLERGENS.map((a) => `<button class="optchoice ${av.has(a.slug) ? "on" : ""}" data-oalg="${esc(a.slug)}">${esc(a.label)}</button>`).join("")
    + [...av].filter((s) => !ALG_STD.includes(s)).map((s) => `<button class="optchoice on" data-oalg="${esc(s)}">${esc(algLabel(s))}</button>`).join("")
    + `<button class="optchoice alg-other" data-oalg="" data-alg-other="1" title="Type an allergy that isn't listed">＋ Other</button>`;
}
// The "This order" pane — kept EXACTLY as before (owner 2026-07-03: "this order thing is
// perfect right now"), it just lives in its own scroll region now instead of under the grid.
function orderCartHtml() {
  const lines = state.cart.map((l, i) => `<div class="cline">
      <span class="cname">${esc(l.title)}${l.options && l.options.length ? `<small class="copts">${esc(l.options.map((o) => o.label).join(", "))}</small>` : ""}${l.avoid && l.avoid.length ? `<small class="callergy">⚠ no ${esc(l.avoid.join(", "))}</small>` : ""}${l.note ? `<small class="copts">✎ ${esc(l.note)}</small>` : ""}</span>
      <span class="cqty"><button class="qbtn" data-minus="${i}">−</button><b>${l.qty}</b><button class="qbtn" data-plus="${i}">+</button><button class="qbtn edit" data-edit="${i}" title="Size / extras / allergy">✎</button></span>
      <span class="cprice">${inr(l.price * l.qty)}</span>
    </div>`).join("");
  const total = state.cart.reduce((s, l) => s + l.price * l.qty, 0);
  // ⚡ Quick order: the table is chosen at the END, so the big button asks for it — tapping
  // it opens the table picker, and PICKING the table is what sends (the picker is the
  // deliberate second step; a third "are you sure" would be the over-asking the owner banned).
  const sendLbl = state.quick ? "CHOOSE TABLE &amp; SEND →" : "SEND TO KITCHEN";
  const foot = `<div class="ctotal"><span>Items total</span><b>${inr(total)}</b></div>
       <div class="muted small">Final bill (incl. tax) is computed by the system when you send it.</div>
       <button class="btn primary big" id="sendOrder" ${state.cart.length ? "" : "disabled"}>${sendLbl}</button>`;
  return `<div class="cart">
      <h3>This order</h3>
      <div class="cart-lines">${lines || `<div class="muted">Tap dishes to add them.</div>`}</div>
      <div class="cart-alg"><span class="muted small">⚠ Avoid in ALL dishes</span><div class="optchoices opt-alg" id="orderAlg">${orderAlgChips()}</div></div>
      ${foot}
    </div>`;
}
// Re-render ONLY the cart pane (its own scroll region) — the dish browser is untouched,
// so its scroll position and the search focus survive every qty change.
function updateOrderCart() {
  const c = $("#omCart");
  if (!c) return;
  c.innerHTML = orderCartHtml();
  c.querySelectorAll("[data-plus]").forEach((b) => (b.onclick = () => { state.cart[+b.dataset.plus].qty = Math.min(99, state.cart[+b.dataset.plus].qty + 1); updateOrderCart(); updateDishBadges(); }));
  c.querySelectorAll("[data-minus]").forEach((b) => (b.onclick = () => {
    const i = +b.dataset.minus;
    state.cart[i].qty -= 1;
    if (state.cart[i].qty <= 0) state.cart.splice(i, 1);
    updateOrderCart(); updateDishBadges();
  }));
  c.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = async () => {
    const l = state.cart[+b.dataset.edit];
    const d = l && state.data.dishes.find((x) => x.id === l.id);
    // A cart LINE whose dish has left the menu (hidden or deleted while this order was being built —
    // a `menu` breadcrumb refetches the list mid-order). There is nothing to open, but the waiter
    // must be told, because sending it will be refused server-side ('unknown_item') and they'd have
    // no idea why. The line is deliberately LEFT in the cart: taking it out from under them is a
    // second surprise, and removing it is their decision. T4 sweep, 2026-08-11.
    if (!d) { toast("That dish has left the menu — remove this line and pick another.", false); return; }
    // Open-price line: ✎ re-asks the price (there are no size/extras to pick), instead of the
    // options popup — which would have no groups and reset this line's price to 0.
    if (l.open_price || d.open_price) {
      const p = await pricePrompt(d.title, l.price);
      if (p != null) { l.price = p; updateOrderCart(); updateViewPill(); }
      return;
    }
    renderDishOptions(d, +b.dataset.edit);
  }));
  // The whole-order avoid list — CHIPS, not a text box (owner, 2026-08-04). It applies to
  // every dish ("no X" on each line + "⚠ AVOID" on the KOT), which is exactly why it can't
  // be free text: "birthday cake" typed here used to read as "no birthday cake". Chips can
  // only ever hold allergies; a real note goes on the dish through its ✎ popup.
  c.querySelectorAll("[data-oalg]").forEach((b) => (b.onclick = async () => {
    const av = orderAlgSet();
    if (b.dataset.algOther) { const v = await allergyPrompt(av); if (!v) return; av.add(v); }
    else { const s = b.dataset.oalg; av.has(s) ? av.delete(s) : av.add(s); }
    setOrderAlg(av);
    // Redraw the cart pane so the chip's new state (and, for a typed one, the chip itself)
    // shows. Only the cart pane — the dish browser and its scroll are untouched.
    updateOrderCart();
  }));
  // () => sendOrder() — NOT `= sendOrder`: onclick passes the click event, and sendOrder's
  // first argument is the destination table (the quick-order picker calls sendOrder(t)).
  const send = c.querySelector("#sendOrder"); if (send) send.onclick = () => sendOrder();
}
// Leave order mode by ANY exit (← back, ✓ Done, hardware back) — one place drops the
// takeover class + the back-stack layer so none of them can leak.
let omBackOff = null;
let voBackOff = null;   // the view-order screen's own back step (peels to the dish list)
function exitOrderMode() {
  if (voBackOff) { voBackOff(); voBackOff = null; }   // drop the view-order back step if it's up
  state.ordering = false; state.addToOrderId = null; state._omTop = 0; state.viewOrder = false;
  state.cart = []; state.allergies = "";   // abandoning an order clears its cart + allergy list (no leak to the next table)
  state.quick = false;                     // and any in-progress ⚡ quick order
  // Backing out of an order for a STILL-FREE table returns to the FLOOR, not to an
  // empty-table popup — the free tile jumped straight into ordering, so there is no
  // detail to go "back" to (found by the 2026-08-03 walkthrough: the leftover popup
  // sat over the whole screen and blocked the top bar).
  if (state.table != null && !sessionOf(state.table) && !ordersOf(state.table).length) {
    state.table = null;
    renderFloor();
  }
  renderPanel();
}
// Back / ← Menu from the view-order screen → the dish LIST (one step), not out of the order.
function closeViewOrder() {
  if (voBackOff) { voBackOff(); voBackOff = null; }
  state.viewOrder = false;
  renderOrderMode();
}

// ── ⚡ Quick order (owner, 2026-08-03) ────────────────────────────────────────
// The tablet's ONE general order door, always on the top bar: build the order FIRST,
// pick the table LAST. (It replaced the tablet's 🥡 Parcel entry — the owner removed
// parcel from the waiter tablet the day after making it permanent; parcels stay a
// manager feature. The /parcel endpoint + tablet_parcel cap are untouched server-side.)
function openQuickOrder() {
  // Already building an order with something in the cart? Refuse — but SAY SO. A bare return
  // here would be a tap that vanishes, which is indistinguishable from a dead button (the
  // rule is absolute even where the button is currently covered by the order screen).
  if (state.ordering && state.cart.length) {
    const n = state.cart.reduce((s, l) => s + l.qty, 0);
    toast(`You're already building an order (${n} item${n > 1 ? "s" : ""}) — send it or go back first.`, false);
    return;
  }
  state.quick = true; state.ordering = true; state.viewOrder = false;
  state.table = null; state.addToOrderId = null;
  state.cart = []; state.allergies = "";
  state.cat = ""; state.dishSearch = ""; state._omTop = 0; state._addedThisVisit = 0;
  renderFloor(); renderPanel();
}
// Step 2 of a quick order: WHERE does it go? Picking the table IS the send — the picker
// is the deliberate second step (tap SEND → tap the table), so nothing asks a third time.
let qdestClose = null;   // teardown of the picker currently on screen (DOM + its back layer)
function openQuickDest() {
  if (!state.cart.length) { toast("Add at least one dish first", false); return; }
  // Close a previous picker THROUGH ITS OWN TEARDOWN. This used to be a bare `.remove()`, which
  // dropped the DOM but left its LFH_BACK layer — and the history entry behind it — registered,
  // so the next hardware Back was spent closing an overlay that no longer existed. Same
  // re-entrancy trap the confirm box and the payment sheet each already guard against.
  if (qdestClose) qdestClose();
  const tiles = [];
  // THE FLOOR PLAN ONLY — 1..table_count, never floorTableList(). That list deliberately also
  // carries tables numbered ABOVE the count when they still hold a live order, so their money
  // stays reachable; but as a DESTINATION such a table is refused by the server ("Table 9234792
  // isn't on the floor plan"), and the rule is already written down beside floorTableList: you
  // may take a party OFF an off-plan table, never send one TO one. Stray test rows made this
  // real — the picker offered a junk number and the send failed (found 2026-08-04).
  for (let i = 1, n = tableCount(); i <= n; i++) {
    if (!inMySection(i)) continue;          // a sectioned waiter only serves their own tables
    // A MERGED table is not a free one, whatever its own summary tile says: its party — and
    // its bill — live on the table it is joined to, and that is where this order would land.
    // Saying "free" here would be the same lie the floor tiles were fixed for (mig 249).
    const parent = mergeParentOf(i);
    // ONE MEANING OF "FREE", ON BOTH PICKERS (owner picked it as item 14, 2026-09-03).
    // tileIsOpen() goes through summaryTile(), which turns a seated-but-empty table ("waiting") into
    // "free" — the owner's own rule, and right for a tile. This label then called such a table free
    // while the order placed on it joins that seating's own bill, and after the move picker was made
    // honest the two pickers were one screen apart using two meanings of the same word.
    // Nothing goes wrong either way here — the bill is empty — so this is a WORD, not a gate: every
    // table stays tappable, because taking an order for a seated-but-empty table is perfectly
    // normal and is not the same question as moving a whole party onto it.
    const busy = !!parent || tableHasAnyParty(i);
    const what = parent ? `joins ${esc(tname(parent) || "T" + parent)}'s bill` : busy ? "joins its bill" : "free";
    tiles.push(`<button class="qdest-t${busy ? " busy" : ""}" data-qdest="${i}"><b>${esc(tname(i) || "T" + i)}</b><small>${what}</small></button>`);
  }
  const ov = document.createElement("div");
  ov.className = "qdest-overlay";
  // AN EMPTY GRID IS A DEAD END WITH NO WORDS (T7 sweep, 2026-08-17). A waiter who holds no section
  // can still reach ⚡ Quick order — the button is on the top bar at all times — build a whole order,
  // tap SEND, and land on a picker with nothing in it and nothing said. The floor behind already
  // explains this state kindly ("No tables assigned to you yet"), and every other picker in this file
  // has an empty state; this was the last one without. Same sentence, same person to ask.
  const emptyPick = `<div class="muted" style="grid-column:1/-1;padding:18px 4px;text-align:center;line-height:1.6">
      <div style="font-size:26px;margin-bottom:4px">🪑</div>
      <div style="font-weight:800;font-size:14px;color:var(--text)">No tables assigned to you yet</div>
      <div style="font-size:12.5px;margin-top:3px">Ask your manager to give you a section — your order stays here until then.</div>
    </div>`;
  ov.innerHTML = `<div class="qdest-box">
    <div class="qdest-head"><h3>Which table gets this order?</h3><button class="qdest-x" aria-label="Close">✕</button></div>
    <div class="muted small" style="margin:2px 0 12px">${tiles.length ? "Tap a table to send it to the kitchen — a busy table adds it to that table's bill." : "This order is safe — nothing has been sent yet."}</div>
    <div class="qdest-grid">${tiles.length ? tiles.join("") : emptyPick}</div>
  </div>`;
  document.body.appendChild(ov);
  let backOff = window.LFH_BACK ? LFH_BACK.layer("tablet-qdest", () => closeDest()) : null;
  const closeDest = () => { if (backOff) { backOff(); backOff = null; } ov.remove(); if (qdestClose === closeDest) qdestClose = null; };
  qdestClose = closeDest;
  ov.querySelector(".qdest-x").onclick = closeDest;
  ov.onclick = (e) => { if (e.target === ov) closeDest(); };
  ov.querySelectorAll("[data-qdest]").forEach((b) => (b.onclick = () => { const t = b.dataset.qdest; closeDest(); sendOrder(t); }));
}

// The phone VIEW-ORDER screen (owner 2026-07-05): a separate screen (like the guest
// menu) with the added items, the whole-order ALLERGY CHIPS and SEND — reached
// from the browse screen's floating "View order" pill. Desktop never sets viewOrder.
function renderViewOrder() {
  const p = $("#panel");
  p.classList.remove("has-detail");
  p.classList.add("om-open");
  if (window.LFH_BACK && !omBackOff) omBackOff = LFH_BACK.layer("tablet-order", exitOrderMode);
  // The view-order screen is its OWN back step ON TOP of the order layer, so hardware
  // back peels view-order → dish list (not straight out of the order). (owner 2026-07-05)
  if (window.LFH_BACK && !voBackOff) voBackOff = LFH_BACK.layer("tablet-vieworder", closeViewOrder);
  p.innerHTML = `
    <div class="om lite vieworder">
      <div class="om-head">
        <button class="btn small" id="voBack">← Menu</button>
        <h2>${state.quick ? "⚡ Quick order" : `Your order · ${esc(tableLabel(state.table))}`}</h2>
      </div>
      <div class="om-voscroll">
        <aside class="om-cart" id="omCart"></aside>
      </div>
    </div>`;
  updateOrderCart();               // fills #omCart: items + one note + total + SEND, wires handlers
  const back = $("#voBack");
  if (back) back.onclick = closeViewOrder;
}
// quickSideBySide(): is ⚡ Quick order currently showing the menu and the order together?
// Must stay in step with the matching @media block in style.css (landscape + coarse pointer).
// `pointer: coarse` is what keeps a PC out of it — a mouse reports `fine` at any window size.
function quickSideBySide() {
  try { return window.matchMedia("(orientation: landscape) and (pointer: coarse)").matches; }
  catch { return false; }
}
function renderOrderMode() {
  // Phone: the added-items review lives on its OWN screen (like the guest menu), reached
  // by the floating "View order" pill. Desktop keeps the side pane, so it never sets
  // viewOrder. (owner 2026-07-05)
  // Never strand the waiter on an empty "Your order" review: if the cart is empty, show the
  // dish MENU (what they actually need) instead of the "no dishes" screen. Only open the review
  // when there's actually something in the cart. This kills the intermittent "no dishes added"
  // screen when the order opens. (audit 2026-07-09)
  // ⚡ QUICK ORDER HELD SIDEWAYS shows the order down the right-hand side instead (owner
  // 2026-08-05 — "remove the list thing… on the right side they will see the whole order thing").
  // There is nothing to go and open, so the separate review screen is skipped entirely. The same
  // three limits as the CSS: quick order only, sideways only, and touch devices only (never a PC).
  if (state.quick && quickSideBySide()) state.viewOrder = false;
  if (state.viewOrder && state.cart.length) { renderViewOrder(); return; }
  state.viewOrder = false;
  const p = $("#panel");
  p.classList.remove("has-detail");
  p.classList.add("om-open");
  // LITE layout (owner 2026-07-03 v2): NO full-screen takeover — the order screen stays
  // inside the right-hand panel exactly like the old one (floor stays visible beside it).
  // Only the browsing changed: all categories as sections + the auto-shift category bar.
  // body.om-mode is never set, so all the takeover CSS stays dormant.
  if (window.LFH_BACK && !omBackOff) omBackOff = LFH_BACK.layer("tablet-order", exitOrderMode);
  const addMode = !!state.addToOrderId;
  p.innerHTML = `
    <div class="om lite${state.quick ? " om-quick" : ""}">
      <div class="om-head">
        <h2>${state.quick ? "⚡ Quick order" : `${addMode ? "Add · " : ""}${esc(tableLabel(state.table))}`}</h2>
        <input type="search" id="dishSearch" class="order-search om-search" placeholder="🔎 Search dishes…" value="${esc(state.dishSearch)}">
        <button class="btn small ${addMode ? "primary" : ""}" id="omExit">${addMode ? `✓ Done${state._addedThisVisit ? ` (${state._addedThisVisit} added)` : ""}` : "← back"}</button>
      </div>
      <div class="om-body ${addMode ? "no-cart" : ""}">
        <!-- The category rail. On a phone this scrolls sideways, so it gets the fade AND the
             count chip — the same pair the manager's take-order rail carries, because it is the
             same question ("how many categories am I not seeing?"). -->
        <nav class="om-nav" id="omNav" data-swipe-hint data-swipe-count>${orderNavHtml()}</nav>
        <div class="om-scroll" id="omScroll">${addMode ? `<div class="muted small om-hint">Tap a dish to add it to this order — the bill updates automatically.</div>` : ""}${orderSectionsHtml()}</div>
        ${addMode ? "" : `<aside class="om-cart" id="omCart"></aside>`}
      </div>
      ${addMode ? "" : `<button class="om-viewpill vp-empty" id="omViewBtn" type="button"></button>`}
    </div>`;
  bindDishButtons();
  wireOrderNav();
  updateOrderCart();
  updateViewPill();
  const vb = $("#omViewBtn");
  if (vb) vb.onclick = () => { state.viewOrder = true; renderOrderMode(); };
  const search = $("#dishSearch");
  if (search) search.oninput = (e) => {
    state.dishSearch = e.target.value;
    $("#omNav").innerHTML = orderNavHtml();
    const scroller = $("#omScroll");
    scroller.innerHTML = orderSectionsHtml();
    bindDishButtons(); wireOrderNav();
    // Search cleared → put the waiter back at the section they were browsing.
    if (!state.dishSearch.trim() && state._omTop) {
      scroller.style.scrollBehavior = "auto"; scroller.scrollTop = state._omTop; scroller.style.scrollBehavior = "";
    }
  };
  $("#omExit").onclick = exitOrderMode;
  // Restore the browse spot after a rebuild (options round-trip / add-to-order reload) —
  // instantly, so the smooth scroll-behavior doesn't animate the restore.
  const sc = $("#omScroll");
  if (sc && state._omTop) { sc.style.scrollBehavior = "auto"; sc.scrollTop = state._omTop; sc.style.scrollBehavior = ""; }
}

let sendingOrder = false;
async function sendOrder(dest) {
  if (sendingOrder) return;
  // ⚡ QUICK ORDER, step 2: no table yet → the SEND tap opens the table picker, and the
  // picker calls back sendOrder(table). The pick is the deliberate second step (owner,
  // 2026-08-03: every important action is exactly TWO steps — never a third).
  if (state.quick && dest == null) { openQuickDest(); return; }
  // Claim the guard BEFORE the confirm dialog — otherwise a rapid double/triple-tap on SEND
  // opens the confirm (and reaches the success toast) more than once, showing two "Sent!"
  // toasts even though only one order is placed. Release it if the waiter cancels. (sweep C2)
  sendingOrder = true;
  const tbl = dest != null ? String(dest) : state.table;
  const sendLblIdle = state.quick ? "CHOOSE TABLE & SEND →" : "SEND TO KITCHEN";
  const count = state.cart.reduce((s, l) => s + l.qty, 0);
  // The per-table flow confirms here (step 2). A quick order already answered its second
  // step in the picker — asking again would be the third step the owner banned.
  if (dest == null && !(await confirmDialog(`Send ${count} item${count > 1 ? "s" : ""} to the kitchen for table ${tbl}?`))) { sendingOrder = false; return; }
  const sendBtn = document.getElementById("sendOrder");
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "Sending…"; }
  try {
    // A per-item allergy belongs to THAT dish only, so it travels as that line's
    // own `removed` list — the kitchen then shows "NO NUTS" on that one dish.
    // The order-level `allergies` is ONLY the whole-order avoid box (under the
    // cart): anything there applies to EVERY dish. We used to fold per-item
    // allergies into that order-level list too, which made them leak onto every
    // dish on the ticket — that's the bug this fixes (2026-06-17).
    const splitCsv = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
    const orderAllergies = splitCsv(state.allergies);
    const buildBody = (extra) => Object.assign({
      table: tbl,
      items: state.cart.map((l) => {
        // Two different things, kept apart: this dish's ALLERGY chips are worded "no X"
        // (they are avoids), while the ✎ note travels VERBATIM — the kitchen sees exactly
        // what the waiter typed ("less ice", "extra spicy"). They shared one box until
        // 2026-08-04, which is how "less ice" once printed as "NO LESS ICE".
        const avoidTxt = (l.avoid && l.avoid.length) ? `⚠ no ${l.avoid.join(", ")}` : "";
        const note = [avoidTxt, (l.note || "").trim()].filter(Boolean).join(" · ");
        return {
          id: l.id, qty: l.qty,
          // Open-price lines carry the staff-typed price; the server honours it only for a
          // dish flagged open_price (every normal line is still priced from the DB).
          price: l.open_price ? l.price : undefined,
          options: l.options ? l.options.map((o) => ({ group: o.group, label: o.label })) : undefined,
          note: note || undefined,
        };
      }),
      allergies: [...new Set(orderAllergies)],
      // NO order-level `note` (removed 2026-08-06, T4 sweep). There was a `state.note` here that
      // nothing ever wrote — the whole-order free-text box was replaced by allergy chips on
      // 2026-08-04, deliberately, because "birthday cake" typed into it printed as "no birthday
      // cake" on the ticket. So this always sent null, while the comment on the view-order screen
      // still promised a note field, sending the next reader looking for a control that isn't
      // there — and leaving live plumbing for someone to reconnect free text to the wrong place.
      // A real note belongs to a DISH and travels on its line (see buildBody's per-item `note`).
    }, extra || {});
    const place = (extra) => api("POST", "/order", buildBody(extra));
    // A finished send (real ticket OR safely queued offline): drop the back steps + reset.
    const finishSent = () => {
      if (voBackOff) { voBackOff(); voBackOff = null; }
      if (omBackOff) { omBackOff(); omBackOff = null; }
      state.ordering = false; state.cart = []; state.viewOrder = false; state.allergies = ""; state._omTop = 0;
      state.quick = false;
    };
    const wasQuick = state.quick;
    let r;
    try {
      r = await place();
    } catch (e) {
      // #15: the server flagged this as looking identical to one just sent — don't hard-refuse,
      // let the waiter decide (two guests can genuinely order the same drink seconds apart).
      if (e && e.data && e.data.duplicateWarning) {
        if (!(await confirmDialog("This looks just like an order you sent seconds ago for this table. Send it AGAIN anyway?", "Send anyway"))) return;
        r = await place({ confirmDuplicate: true });
      } else { throw e; }
    }
    // #2: offline → the order is saved on this device (at-most-once) and will send on reconnect.
    // Treat it as a clean success with an honest "saved" note, NOT the old "#undefined" + "Failed".
    if (isQueued(r)) { toast("Order saved ✓ — it'll go to the kitchen the moment you're back online."); finishSent(); renderPanel(); return; }
    if (!r || r.ok !== true) {
      // Friendly, actionable message instead of the raw server reason. The cart is KEPT (we
      // return without clearing) so the waiter can fix the flagged dish and resend. (audit 2026-07-08)
      const reason = r && r.reason, item = r && r.item;
      const msg = reason === "sold_out" ? `😕 ${item || "A dish"} just sold out — remove it from the order and send again.`
        : reason === "unknown_item" ? `😕 ${item || "A dish"} is no longer on the menu — remove it and send again.`
        : "Couldn't send the order: " + (reason || "unknown") + (item ? ` (${item})` : "") + ". Please try again.";
      toast(msg, false); return;
    }
    toast(wasQuick ? `Sent to ${tableLabel(tbl)}! Kitchen ticket #${r.kot_no}` : `Sent! Kitchen ticket #${r.kot_no}`);
    finishSent();
    await load(); renderPanel();
  } catch (e) { toast("Failed: " + errText(e), false); }
  finally {
    sendingOrder = false;
    const b = document.getElementById("sendOrder");
    if (b) { b.disabled = false; b.textContent = sendLblIdle; }
  }
}

// ── the poll ─────────────────────────────────────────────────────────────────
// A compact fingerprint of everything the floor + panel draw (now including each
// dish's status, so advancing a dish anywhere repaints the tiles + detail).
// BULLETPROOF redraw fingerprint. We serialize the FULL drawn rows (minus a few
// heartbeat-only columns) so ANY field that affects the floor or the detail panel —
// including columns added in the FUTURE (a new per-dish flag, a new session field,
// etc.) — flips the signature and forces a repaint. Do NOT shrink this back to a
// hand-picked field list: that list silently missed allergy/note/discount/auto-
// approve edits, so they only appeared after a MANUAL refresh (bug fixed 2026-06-17).
// See CLAUDE.md "Live-update redraw guard". RT_VOLATILE = columns that change with
// NO visible effect (heartbeats / derived timestamps) — excluded so idle polls don't
// churn (last_activity_at ticks constantly; excluding it is what keeps this cheap).
const RT_VOLATILE = new Set(["last_activity_at", "updated_at", "cart_updated_at", "served_at"]);
const stableRow = (row) => { const o = {}; for (const k in (row || {})) if (!RT_VOLATILE.has(k)) o[k] = row[k]; return o; };
// TWO-TIER fingerprint (mirrors the editor's loadSessions sig): the GRID draws from the slim
// `state.summary`, and the DETAIL draws from the selected table's full slice rows. So we hash
// BOTH — the whole summary (tiles + side aggregates) PLUS the selected table's sessions/orders/
// items/members/calls/requests. CRITICAL: after the two-tier switch the unselected tables have
// no rows in state.data, so hashing only state.data (the old code) would NEVER repaint the grid
// on a summary change. The summary is server-computed and already minimal, so we hash it whole;
// the per-table detail rows still go through stableRow to drop heartbeat churn. (owner 2026-06-27)
function boardSig(d) {
  const t = d.table != null ? String(d.table) : null;
  const data = d.data || {};
  // The selected table's slice: sessions/orders/calls/requests by table_number; members/items
  // ride along (small once only one table's slice is loaded) so a detail edit (note/qty/allergen)
  // still flips the sig and repaints the open detail panel.
  const selRows = t == null ? [] : [
    (data.sessions || []).filter((s) => String(s.table_number) === t).map(stableRow),
    (data.orders || []).filter((o) => String(o.table_number) === t).map(stableRow),
    (data.calls || []).filter((c) => String(c.table_number) === t).map(stableRow),
    (data.requests || []).filter((r) => String(r.table_number) === t).map(stableRow),
    (data.members || []).map(stableRow),
    (data.items || []).map(stableRow),
  ];
  return JSON.stringify([d.summary || {}, t, selRows, stableRow(data.settings || {})]);
}
let lastSig = null;
// Every load() gets a rising ticket; only the most-recently-STARTED fetch is
// allowed to apply. Without this, two overlapping refetches (your tap + the
// realtime event for that same change + the backup timer) race, and whichever
// GET *finishes* last wins — even when it's the OLDER snapshot. That stale
// snapshot is what made the panel flash the pre-open "Attend/request" view,
// drop an order that's actually there, then pop it back a moment later.
let loadSeq = 0;
// ── TWO TARGETED REFETCHES MUST NOT CANCEL EACH OTHER (T13 sweep, 2026-08-05) ────────────────
// loadTables() used to take a ticket from `loadSeq` too, and bail the moment a newer refresh had
// started — BEFORE patching a single tile. That is right when the newer refresh is a whole-floor
// load() (its board is fresher), and WRONG when it is another targeted loadTables() for DIFFERENT
// tables: that call knows nothing about this table, so this tile's update was simply thrown away
// and the table sat stale until another breadcrumb named it or the 60s backstop landed. A waiter
// walked past a table whose food was ready with nothing on screen saying so.
//
// Reachable exactly when it hurts: realtime.js debounces at 200ms and its debounce() has no
// re-entry guard, so a second burst fires while the first loadTables is still awaiting its
// /summary?table=N reads — and on restaurant wifi those take well over 200ms. During a rush,
// breadcrumbs for different tables arrive continuously.
//
// So, the same split the MANAGER panel already uses (editor/app.js pollTables, fixed 2026-07-06):
//   · fullSeq  — bumped ONLY by a whole-floor load(). A targeted patch is dropped when this moves,
//                because the full board that replaced it is genuinely fresher.
//   · tileSeq  — a ticket PER TABLE, so same-table overlap still resolves latest-wins while two
//                different tables never touch each other's ticket.
let fullSeq = 0;
const tileSeq = {};
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
  // Strip the *accent* wordmark markers (lib/brandText stripBrandMarkers) so a
  // literal '*' never shows in the header — logo_text like "Aangan *Garden*"
  // marks the accent word for the guest hero; a plain header shows it clean.
  if (el) el.textContent = restDisplayName(r).replace(/\*/g, "");
}

// loadTables(tables): TARGETED refetch — fetch ONLY the named tables' slice
// (/state?table=N → sessions/members/calls/orders/items/requests for that table) and merge
// each into the cached floor, instead of re-reading the WHOLE floor on every breadcrumb.
// settings/dishes/categories/restaurant are table-agnostic (a menu event always arrives as
// `full`), so a targeted pass leaves them untouched. The merge drops the changed tables' old
// rows and adds the fresh ones (orders/calls/requests by table_number; members/items by their
// session/order, all dedup'd by id), then runs the SAME boardSig/render path as load(). ANY
// surprise → full load() (safe fallback). The tablet has NO chime, so there's no baseline to
// preserve here. (owner 2026-06-26 — egress cut; mirrors the manager's pollTables.)
// mergeSelectedSlice(t, slice): merge ONE table's FULL detail slice (sessions/members/orders/
// items/calls/requests) into state.data, so the helpers the DETAIL panel reads (ordersOf /
// dishRowsOf / membersOf / callsOf …) return real rows for table t. The grid never needs this —
// it renders from the slim summary; only the selected table (and a quick-action target via
// a quick-action target via ensurePartySlices) pulls full rows. Drops the table's old rows + adds
// the fresh, dedup'd by id.
function mergeSelectedSlice(t, slice) {
  const tset = String(t);
  const d = state.data || {};
  const dedupeById = (arr) => { const m = new Map(); for (const x of arr) if (x && x.id != null) m.set(x.id, x); return [...m.values()]; };
  const freshSessions = (slice && slice.sessions) || [];
  const purgeSids = new Set();
  for (const s of (d.sessions || [])) if (String(s.table_number) === tset) purgeSids.add(s.id);
  for (const s of freshSessions) purgeSids.add(s.id);
  const freshOrders = (slice && slice.orders) || [];
  const purgeOids = new Set();
  for (const o of (d.orders || [])) if (String(o.table_number) === tset) purgeOids.add(o.id);
  for (const o of freshOrders) purgeOids.add(o.id);
  state.data = Object.assign({}, d, {
    sessions: dedupeById((d.sessions || []).filter((s) => String(s.table_number) !== tset).concat(freshSessions)),
    orders: dedupeById((d.orders || []).filter((o) => String(o.table_number) !== tset).concat(freshOrders)),
    members: dedupeById((d.members || []).filter((m) => !purgeSids.has(m.session_id)).concat((slice && slice.members) || [])),
    items: dedupeById((d.items || []).filter((it) => !purgeOids.has(it.order_id)).concat((slice && slice.items) || [])),
    calls: dedupeById((d.calls || []).filter((c) => String(c.table_number) !== tset).concat((slice && slice.calls) || [])),
    requests: dedupeById((d.requests || []).filter((r) => String(r.table_number) !== tset).concat((slice && slice.requests) || [])),
  });
}

// loadTables(tables): TARGETED refetch — patch ONLY the named tables' SLIM tiles (/summary?table=N,
// ~5 kB each) into state.summary.tiles, plus refresh the tiny restaurant-wide aggregates (calls/
// requests/joiners/blocklist) the side panel + badges need. If the SELECTED table is among the
// changed ones, ALSO re-pull its FULL detail slice (/state?table=N) so the open detail stays
// correct. This replaces the old "re-read the whole floor on every breadcrumb" — mirrors the
// manager's pollTables. ANY surprise → full load() (safe fallback). (owner 2026-06-27 — two-tier)
async function loadTables(tables) {
  // #2/#19: offline with NO saved copy on this device → skip the GET entirely. There'd be
  // nothing to fetch, and NOT throwing here is what stops a queued action from being
  // reported as "Failed". Once the offline layer (public/sw.js) is installed the GET IS
  // worth making: it comes back from the device's own cache, so the board still paints.
  if (navigator.onLine === false && !(window.LFH_OFF && window.LFH_OFF.canReadOffline())) return;
  if (!tables || !tables.length) return load();
  // A MERGED PARTY'S TILES MOVE TOGETHER: every member renders from the PARENT's tile, and an
  // order keeps the table it was ORDERED at (mig 249) — so a breadcrumb naming one member must
  // refresh the whole party or the other tiles sit stale until the 60s backstop. Same fix as
  // the manager's pollTables (owner, 2026-08-03).
  tables = [...new Set(tables.map(String).flatMap((t) => partyTablesOf(t)))];
  // A ticket per TABLE (not one shared counter) — see the note by tileSeq. `born` is the
  // whole-floor generation: only a full load() moves it, and only that justifies dropping this
  // patch. Two targeted polls for different tables no longer cancel each other.
  const born = fullSeq;
  const mySeq = {};
  for (const t of tables) mySeq[t] = (tileSeq[t] = (tileSeq[t] || 0) + 1);
  const sel = state.table != null ? String(state.table) : null;
  let tileResps, selSlice;
  try {
    [tileResps, selSlice] = await Promise.all([
      Promise.all(tables.map((t) => api("GET", "/summary?table=" + encodeURIComponent(t)))),
      (sel != null && tables.map(String).includes(sel)) ? api("GET", "/state?table=" + encodeURIComponent(sel)) : Promise.resolve(null),
    ]);
  } catch (e) { return load(); }        // network/parse blip → safe full reload
  if (fullSeq !== born) return;         // a whole-floor load() started — its fresher board wins

  // Patch each changed table's tile into the cached summary; a table that's now gone from the
  // server's tile set (e.g. dropped below table_count) is set to nothing so it renders "free".
  // A table whose OWN newer poll has already landed is skipped — just that tile, never the others.
  const tiles = Object.assign({}, state.summary.tiles || {});
  const applied = [];
  tileResps.forEach((resp, i) => {
    const t = String(tables[i]);
    if (mySeq[t] !== tileSeq[t]) return;   // a newer targeted poll for THIS table won
    applied.push(t);
    const tile = resp && resp.tiles ? resp.tiles[t] : null;
    if (tile) tiles[t] = tile; else delete tiles[t];
  });
  // The restaurant-wide aggregates are returned fresh on EVERY targeted call (the RPC always
  // ships them); take the last response's so the side panel + badges stay current.
  const agg = tileResps[tileResps.length - 1] || {};
  state.summary = Object.assign({}, state.summary, { tiles }, {
    order_count: agg.order_count ?? state.summary.order_count,
    latest_order_table: agg.latest_order_table ?? state.summary.latest_order_table,
    calls: agg.calls || [], requests: agg.requests || [], joiners: agg.joiners || [], blocklist: agg.blocklist || [],
    // The live merges list rides on every summary response — keep it fresh on the targeted
    // path too, or a just-made/just-ended merge shows on one device and not another.
    merges: Array.isArray(agg.merges) ? agg.merges : (state.summary.merges || []),
  });
  // Refresh the selected table's full detail slice if it changed.
  if (sel != null && selSlice) mergeSelectedSlice(sel, selSlice);
  // …and, while a merge is live, its party mates' slices too — the open detail renders the
  // WHOLE party, so refreshing one member's rows while another's just changed shows a bill
  // that is half fresh, half stale.
  if (sel != null && selSlice) {
    const mates = partyTablesOf(sel).filter((x) => String(x) !== String(sel) && tables.includes(String(x)));
    if (mates.length) {
      const mateSlices = await Promise.all(mates.map((x) => api("GET", "/state?table=" + encodeURIComponent(x)).catch(() => null)));
      if (fullSeq !== born) return;
      mates.forEach((x, i) => { if (mateSlices[i]) mergeSelectedSlice(x, mateSlices[i]); });
    }
  }

  const sig = boardSig(state);
  if (sig === lastSig) return;          // nothing visible changed — don't repaint
  lastSig = sig;
  // TARGETED path → patch JUST the named tiles + the filter counts, NOT the whole grid (the
  // 300-table freeze fix). patchTabletTiles self-falls-back to a full renderFloor() if a tile's
  // filter membership flipped or the grid isn't present. The detail panel (#panel) is a separate
  // container, so patching tiles never disturbs an open detail — keep its same guard below.
  // Repaint only the tiles this pass actually applied (a tile skipped above is already being
  // painted by the newer poll that beat us to it).
  patchTabletTiles(applied.length ? applied : tables);
  if (!state.ordering && !state.pickerOpen) renderPanel();   // never repaint under a mid-order waiter OR an open Move picker (#U1)
}

// Coalesce concurrent load() calls onto ONE in-flight fetch. On boot ~5 triggers fire (the
// explicit boot load + LFH_RT.start's per-topic once-on-start handlers + subscribe/reconnect);
// without this each did its OWN /summary, contending on the DB pool and stacking to ~4.5s before
// the floor painted. Now they share one fetch, plus at most one trailing refresh so a change that
// landed mid-flight isn't missed. Post-write reconcile callers stay correct: if nothing is in
// flight they start a fresh fetch that includes their write; if one is running, the trailing
// refresh repaints server truth right after (loadSeq still guarantees latest-wins). (audit 2026-07-09)
let loadInFlight = null, loadQueued = false;
function load() {
  // Offline: still worth loading when the device has a saved copy to answer with (the
  // offline layer serves it) — that's what paints the floor after an offline reload.
  if (navigator.onLine === false && !(window.LFH_OFF && window.LFH_OFF.canReadOffline())) return Promise.resolve();
  if (loadInFlight) { loadQueued = true; return loadInFlight; }
  const p = loadImpl();
  loadInFlight = p;
  p.then(() => {}, () => {}).then(() => { loadInFlight = null; if (loadQueued) { loadQueued = false; load(); } });
  return p;
}
async function loadImpl() {
  // #2/#19: offline and nothing saved on this device → don't fire the GET (it would reject
  // and surface as "Failed: Failed to fetch" from every caller that awaits load() after a
  // queued write). The reconnect flush (lfh:outbox-flushed) + the 'online' event both
  // trigger a fresh load() once we're back. WITH the offline layer installed we do load:
  // the reply is this device's last known floor, which is exactly what should be on screen.
  if (navigator.onLine === false && !(window.LFH_OFF && window.LFH_OFF.canReadOffline())) return;
  const seq = ++loadSeq;
  // A WHOLE-FLOOR read is the only thing that may cancel a targeted tile patch (see tileSeq):
  // this board replaces every tile, so anything in flight for one table is genuinely superseded.
  fullSeq++;
  const sel = state.table != null ? String(state.table) : null;
  // TIER 1: the slim summary drives the GRID + side aggregates + the table-agnostic bundle
  // (settings/dishes/categories/restaurant). TIER 2: if a table's detail is open, ALSO fetch its
  // full slice so the detail renders complete order/member rows. The grid never needs the slice.
  // The recurring floor refresh doesn't need the big dish list — the menu is cached on-device and
  // only refetched when it's flagged stale (realtime `menu` topic, first load / empty cache, wake,
  // or the ~10min safety-net). Slim refreshes drop ~50KB of the ~77KB. (perf 2026-07-20)
  const needMenu = state._menuStale || !(state.data.dishes || []).length;
  const [summary, selSlice] = await Promise.all([
    api("GET", needMenu ? "/summary" : "/summary?nomenu=1"),
    sel != null ? api("GET", "/state?table=" + encodeURIComponent(sel)) : Promise.resolve(null),
  ]);
  if (seq !== loadSeq) return;          // a newer refresh started — this one is stale, drop it
  // Split the full-summary response into the per-tile summary (+ aggregates) and the agnostic bundle.
  const { settings, dishes, categories, restaurant, ...summaryOnly } = summary || {};
  state.summary = summaryOnly;
  // Sections (mig 222): if a manager just took this table off the waiter mid-shift, the
  // open detail is no longer theirs to look at — drop back to the floor rather than leave
  // a panel on screen whose every button would now be refused by the server.
  if (state.table != null && !inMySection(state.table)) {
    state.table = null; state.ordering = false; state.cart = [];
  }
  const patch = {
    settings: settings ?? null,
    categories: categories || state.data.categories || [],   // categories are always returned; keep last if absent
    restaurant: restaurant ?? null,
    // Stale per-table detail rows from a previously-selected table are harmless (the grid ignores
    // state.data; the detail re-pulls below), but we clear them so a closed table can't linger.
    sessions: [], members: [], orders: [], items: [], calls: [], requests: [],
  };
  // `dishes` is present ONLY on a full load (ABSENT — not [] — on a slim ?nomenu=1 response). On a
  // slim refresh KEEP the cached menu; on a full one refresh it, rewrite the on-device cache, and
  // clear the stale flag. This is what lets a slim refresh never wipe the dish list.
  if (Array.isArray(dishes)) {
    patch.dishes = dishes;
    state._menuStale = false;
    try { if (dishes.length) localStorage.setItem("lfh_tablet_menu", JSON.stringify({ dishes, categories: categories || [] })); } catch (_e) {}
  } else {
    patch.dishes = state.data.dishes || [];
  }
  state.data = Object.assign({}, state.data, patch);
  if (sel != null && selSlice) mergeSelectedSlice(sel, selSlice);
  // A MERGED PARTY SPANS SEVERAL TABLES' SLICES (mig 249) — and the wipe above dropped all of
  // them. Re-pulling only the selected table put HALF the party back: a merged child's open
  // detail then said "closed · no orders" about a bill that was right there (its session and
  // its partner's orders live on the OTHER tables' slices). Pull every party mate too — this
  // costs extra reads only while a merge is live AND a member's detail is open.
  if (sel != null) {
    const mates = partyTablesOf(sel).filter((x) => String(x) !== sel);
    if (mates.length) {
      const mateSlices = await Promise.all(mates.map((x) => api("GET", "/state?table=" + encodeURIComponent(x)).catch(() => null)));
      if (seq !== loadSeq) return;
      mates.forEach((x, i) => { if (mateSlices[i]) mergeSelectedSlice(x, mateSlices[i]); });
    }
  }
  // Show WHICH restaurant this panel is scoped to (multi-tenant). Set here in load()
  // — NOT in renderFloor()/renderPanel() — because they're skipped when the board
  // signature is unchanged, and the name must still appear on the very first load.
  setRestName(restaurant);
  renderXrayRibbon(); // admin view marker — self-skips when nothing changed (or not admin)
  const sig = boardSig(state);
  if (sig === lastSig) return;
  lastSig = sig;
  renderFloor();
  if (!state.ordering && !state.pickerOpen) renderPanel();   // #U1: don't wipe an open Move picker on a live update
}
// The clock lives ONLY in the ☰ menu now (#dwClock) — the minimal top bar has no room for it
// and a waiter's device shows the time anyway (owner, 2026-08-03).
// Only while the drawer that holds it is actually OPEN (owner-picked improvement, 2026-08-07). #dwClock
// lives inside the ☰ drawer, which is shut almost all the time, so this wrote into a hidden element
// once a second for the whole life of the page. The drawer sets .open when it is showing, and
// openDrawer() calls tickClock() itself, so the time is already correct the moment it is seen.
const tickClock = () => {
  if (document.hidden) return;
  const dc = document.getElementById("dwClock");
  if (!dc) return;
  const drawer = dc.closest(".tbl-drawer");
  if (drawer && !drawer.classList.contains("open")) return;
  dc.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
tickClock(); setInterval(tickClock, 1000);

// NOTE: the phone's bottom-nav clearance (var(--safe-b)/--safe-t) is set by the OUTER page
// (app/tablet/TabletFrame.tsx), which pushes the measured inset into this iframe. It's the
// single source of truth — do NOT also set --safe-b here or the two writers fight. (audit 2026-07-09)

// ── Instant menu: hydrate the last dish list from on-device cache so Take-order NEVER waits on
// the network (the load() below refreshes it + rewrites the cache). Fixes the ~5s menu wait. (audit 2026-07-09)
try {
  const _mc = JSON.parse(localStorage.getItem("lfh_tablet_menu") || "null");
  if (_mc && Array.isArray(_mc.dishes) && _mc.dishes.length) {
    state.data.dishes = _mc.dishes;
    if (Array.isArray(_mc.categories) && _mc.categories.length) state.data.categories = _mc.categories;
  }
} catch (_e) {}
// Force the FIRST network load to be a FULL one (fresh dishes) even when the cache hydrated the
// menu above — the menu may have changed while this tablet was closed. After that first refresh,
// recurring floor refreshes go slim. (perf 2026-07-20)
state._menuStale = true;
// "No internet" is explained by the offline bar — don't also alarm the waiter with a
// database error. Anything else still toasts.
//
// A BUSY DATABASE IS THE THIRD CASE, and it used to fall through to the second (T15 finding P1,
// 2026-08-14). The guard only knew "no internet", so a saturated shared instance showed a waiter
// "Can't reach the database: TimeoutError: The operation was aborted due to timeout" — the raw
// sentence lib/dbRefusal.ts's BUSY_MESSAGE exists to replace, and the word "database" in front of
// someone carrying plates. `isBusyErr` was already sitting next to `isOfflineErr` in
// public/panels/offline.js, unused here. Wording matches the manager panel's errText(), so all
// three panels say the same thing about the same state.
load().catch((e) => {
  if (window.LFH_OFF && window.LFH_OFF.isOfflineErr(e)) return;                  // the offline bar says it
  if (window.LFH_OFF && window.LFH_OFF.isBusyErr && window.LFH_OFF.isBusyErr(e)) // up, but not answering
    return toast("The system is very busy right now — this will come back by itself in a moment.", false);
  toast("Couldn't load the floor — try again. " + errText(e), false);
});

// ── HIERARCHY X-RAY ribbon (Phase 3) ─────────────────────────────────────────
// Marks the admin act-as view and counts the billing controls that are off for
// waiters (the tinted ones). body is a flex column, so the ribbon simply takes the
// top row — no viewport math needed. Server still enforces everything (tabletPerm).
// EVERY KEY HERE MUST HAVE A ROW ON /aevinite → Access → Waiter, because each row in the ribbon's
// popover offers "⚙ change in Access" and deep-links to it (?focus=<key>). `tablet_invoice` was
// listed and has no row — deliberately, since 2026-08-04 a waiter can NEVER issue an invoice
// (owner's rule) — so that row sent the admin to a page with no such switch and nothing
// highlighted. It is gone from this list; the greyed invoice control explains itself by hover.
// Adding a waiter capability? Add its Access row first, then a line here.
const XRAY_CAPS = [
  { key: "tablet_take_orders", label: "Take orders" },
  { key: "tablet_discount", label: "Apply discount" },
  { key: "tablet_mark_paid", label: "Mark bill paid" },
  { key: "tablet_banquet", label: "Banquet billing" },
  { key: "tablet_table_ops", label: "Table & KOT operations" },
  { key: "tablet_table_tags", label: "Mark a table's type" },
  { key: "tablet_khata", label: "Pay later (khata)" },
]; // …and NOT tablet_parcel. 🥡 Parcel left this panel on 2026-08-03 ("the tablet will not have
// the parcel option, only quick order"), so there is no control here for that switch to take away:
// the ribbon counts "controls off for waiters" and every one of them is a thing the admin can see
// tinted on the screen in front of them. Listing it added an invisible item to the count and sent
// the admin to a switch that changes nothing on this panel — the same fault tablet_invoice was
// removed from this list for, one rule up. (T7 sweep #7 third pass, 2026-08-30. The PERMISSION is
// untouched: /parcel and its cap are the manager's, and the Access row stays.)
(function injectXrayStyles() {
  const css = `
  /* MARKED CYAN (off for whoever this view measures against — the waiter role's default, or
     ONE named waiter when the tab carries ?as=). Owner, 2026-08-02, replacing the earlier
     grey: dimmed grey read as "disabled/broken" rather than "absent for them", and on a
     tablet in daylight it was barely there. Cyan is used nowhere else in this panel, so it
     can only mean this. The control stays fully usable — the admin isn't restricted, they
     are being shown what someone else lacks. Both skins get a value; the DEFAULT is dark
     (style.css overrides via html[data-theme="light"]). */
  :root { --xray-c: #22d3ee; --xray-c-dot: #67e8f9; }
  html[data-theme="light"] { --xray-c: #0e7490; --xray-c-dot: #0891b2; }
  .xray-off { color: var(--xray-c) !important; border-color: color-mix(in srgb, var(--xray-c-dot) 60%, transparent) !important;
    opacity: 1; filter: none; }
  /* A FILLED control keeps its own label colour and takes a cyan RING instead — the same
     carve-out the manager panel has. Cyan on the gold fill of ⚡ Quick order / ＋ Take order
     measures about 1.15:1, which is not "annotated", it is unreadable (found in review,
     2026-08-03 — and it is the 2026-07-23 "take-order invisible" lesson repeated). The mark
     still lands: a cyan outline plus the dot the base rule already adds. */
  .qo-top.xray-off, .t-take.xray-off, .tacc.xray-off, .btn.primary.xray-off, .btn.pay.xray-off {
    color: inherit !important;
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--xray-c-dot) 80%, transparent); }
  #xrayRibbon { display: flex; align-items: center; gap: 12px; padding: 6px 14px; flex: none;
    background: color-mix(in srgb, #d97706 14%, var(--panel, #101826)); border-bottom: 1px solid color-mix(in srgb, #d97706 40%, transparent);
    font-size: 12px; color: var(--text, #e8eefc); position: relative; z-index: 40;
    /* WRAP so the admin's own bar can never push the panel sideways at 360px — the kitchen's
       identical ribbon put "Exit view" at x364 in a 360px screen (T12 phone sweep, 2026-08-05).
       No effect on a desktop, where the row never needs to wrap. */
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
  #xrayRibbon button { font: inherit; cursor: pointer; border-radius: 999px; border: 1px solid color-mix(in srgb, #d97706 45%, transparent);
    background: transparent; color: #f59e0b; font-weight: 700; padding: 4px 12px; }
  #xrayRibbon button.rb-exit { border-color: var(--line, #26324a); color: var(--muted, #9fb0cc); }
  #xrayZones { position: absolute; top: calc(100% + 4px); right: 12px; z-index: 60; min-width: 250px;
    background: var(--panel, #101826); border: 1px solid var(--line, #26324a); border-radius: 12px; padding: 6px;
    box-shadow: 0 12px 32px rgba(0,0,0,.4); }
  #xrayZones .zh { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted,#9fb0cc); padding: 6px 8px 4px; }
  #xrayZones .zrow { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: transparent;
    border: 0; border-radius: 8px; padding: 8px; font: inherit; font-size: 12.5px; color: inherit; cursor: pointer; }
  #xrayZones .zrow:hover { background: color-mix(in srgb, #d97706 14%, transparent); }
  #xrayZones .zrow .dot { width: 7px; height: 7px; border-radius: 50%; background: #d97706; flex-shrink: 0; }
  #xrayZones .zrow small { color: var(--muted,#9fb0cc); margin-left: auto; }
  #xrayZones .zsep { height: 1px; margin: 6px 4px; background: var(--line, #26324a); }
  #xrayZones .zrow.zsim { font-weight: 700; }
  #xrayZones .zrow.zsim:hover { background: color-mix(in srgb, #6b7280 16%, transparent); }`;
  const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
})();

let xrayZonesBackOff = null;
function closeXrayZones() {
  const zp = document.getElementById("xrayZones");
  if (zp) zp.remove();
  if (xrayZonesBackOff) { xrayZonesBackOff(); xrayZonesBackOff = null; }
}
// Flip this admin-view TAB between the full admin view and the "actual tablet" view
// (?view=real). Pure URL state — reloading with/without the param is the whole toggle.
// Leaving the real view also drops the person pin (?as=) — going back to the full admin
// view means the tab is nobody's tablet again, and must stop saying a name.
function xraySetViewReal(on) {
  const u = new URL(location.href);
  if (on) u.searchParams.set("view", "real"); else { u.searchParams.delete("view"); u.searchParams.delete("as"); }
  location.replace(u.toString());
}
function renderXrayRibbon() {
  let rb = document.getElementById("xrayRibbon");
  if (!tHigher() && !tSim()) { if (rb) rb.remove(); return; }
  // ACTUAL-VIEW mode: everything renders as the real waiter tablet; the ribbon stays as
  // the only admin trace — and the way back to the full admin view.
  if (tSim()) {
    const restS = (state.data.restaurant && state.data.restaurant.name) || "";
    // WHOSE tablet — set only when the server confirmed the ?as= pin, so the ribbon can
    // never name someone whose view we aren't actually showing.
    const asName = (TABLET_WHO && TABLET_WHO.asName) || "";
    const simSig = `sim|${asName}|${restS}`;
    if (rb && rb.dataset.sig === simSig) return;
    if (!rb) { rb = document.createElement("div"); rb.id = "xrayRibbon"; document.body.insertBefore(rb, document.body.firstChild); }
    rb.dataset.sig = simSig;
    rb.innerHTML =
      `<span class="rb-tag">Admin view · ${asName ? `as ${esc(asName)}` : "as real tablet"}</span>` +
      `<nav class="rb-crumbs" aria-label="Breadcrumb"><a id="xrayHome">Dashboard</a>` +
      `<span class="rb-sep">›</span><a id="xrayRestLink">${restS ? esc(restS) : "…"}</a>` +
      `<span class="rb-sep">›</span><span>Tablet panel</span></nav>` +
      `<span class="rb-spacer"></span>` +
      `<button id="xrayFullBtn" title="Back to the full admin view (everything visible)">See full admin view</button>` +
      `<button class="rb-exit" id="xrayExit">Exit view</button>`;
    document.getElementById("xrayFullBtn").onclick = () => xraySetViewReal(false);
    // GO BACK TO THE ADMIN CONSOLE, AND STOP ACTING AS THIS RESTAURANT ON THE WAY OUT.
    // The crumb used to be a plain jump: the admin left the panel but the act-as cookie stayed
    // set for six hours, so re-opening a panel silently re-entered this restaurant. The owner
    // panel's bar was fixed for exactly that on 2026-07-06 and these three were not.
    const goConsole = async (href) => {
      try { await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) }); } catch {}
      try { window.top.location.href = href; } catch { window.location.href = href; }
    };
    document.getElementById("xrayHome").onclick = () => goConsole("/aevinite");
    const rl1 = document.getElementById("xrayRestLink");
    if (rl1) rl1.onclick = () => goConsole("/aevinite/restaurants");
    document.getElementById("xrayExit").onclick = async () => {
      try { await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) }); } catch {}
      try { window.top.location.href = "/aevinite/restaurants"; } catch { window.location.href = "/aevinite/restaurants"; }
    };
    return;
  }
  const zones = XRAY_CAPS.filter((c) => {
    // Module caps only count as "zones" when the module exists for this restaurant at
    // all (banquet full ladder / KOT-menu depth) — otherwise it's not a grantable thing.
    const s2 = state.data.settings || {};
    if (c.key === "tablet_banquet" && !(s2.banquet_allowed === true && (s2.banquet_owner_control !== true || s2.banquet_enabled !== false))) return false;
    if (c.key === "tablet_table_ops" && !s2.table_ops_tablet_allowed) return false;
    return tperm(c.key) === "off";
  });
  const rest = (state.data.restaurant && state.data.restaurant.name) || "";
  // WHOSE tablet the cyan marks describe. A person pin no longer forces the stripped view,
  // so this ribbon (the MARKED one) can now be showing an individual's gaps — say so, or the
  // admin can't tell them from the waiter role's default (owner, 2026-08-02).
  const whoName = (TABLET_WHO && TABLET_WHO.asName) || "";
  const sig = `${rest}|${whoName}|${zones.map((z) => z.key).join(",")}`; // skip identical rebuilds
  if (rb && rb.dataset.sig === sig) return;
  if (!rb) { rb = document.createElement("div"); rb.id = "xrayRibbon"; document.body.insertBefore(rb, document.body.firstChild); }
  rb.dataset.sig = sig;
  const n = zones.length;
  rb.innerHTML =
    `<span class="rb-tag">Admin view${whoName ? ` · ${esc(whoName)}'s access` : ""}</span>` +
    // The PATH the admin walked in through — Dashboard › name › Tablet panel — the owner panel's
    // breadcrumb language. This ribbon is admin-only (tHigher), so the console crumb is always
    // right here. It starts at the DASHBOARD because that is where the admin came from (owner,
    // 2026-08-26); "Restaurants" was a step he never took.
    `<nav class="rb-crumbs" aria-label="Breadcrumb"><a id="xrayHome">Dashboard</a>` +
    `<span class="rb-sep">›</span><a id="xrayRestLink">${rest ? esc(rest) : "…"}</a>` +
    `<span class="rb-sep">›</span><span>Tablet panel</span></nav>` +
    `<span class="rb-spacer"></span>` +
    `<button id="xrayZonesBtn">${whoName ? `${n} thing${n === 1 ? "" : "s"} ${esc(whoName)} doesn't have` : `${n} control${n === 1 ? "" : "s"} off for waiters`} ▾</button>` +
    `<button class="rb-exit" id="xrayExit">Exit view</button>`;
  // GO BACK TO THE ADMIN CONSOLE, AND STOP ACTING AS THIS RESTAURANT ON THE WAY OUT.
  // The crumb used to be a plain jump: the admin left the panel but the act-as cookie stayed
  // set for six hours, so re-opening a panel silently re-entered this restaurant. The owner
  // panel's bar was fixed for exactly that on 2026-07-06 and these three were not.
  const goConsole = async (href) => {
    try { await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) }); } catch {}
    try { window.top.location.href = href; } catch { window.location.href = href; }
  };
  document.getElementById("xrayHome").onclick = () => goConsole("/aevinite");
  const rl2 = document.getElementById("xrayRestLink");
  if (rl2) rl2.onclick = () => goConsole("/aevinite/restaurants");
  document.getElementById("xrayExit").onclick = async () => {
    try { await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) }); } catch {}
    try { window.top.location.href = "/aevinite/restaurants"; } catch { window.location.href = "/aevinite/restaurants"; }
  };
  document.getElementById("xrayZonesBtn").onclick = () => {
    if (document.getElementById("xrayZones")) { closeXrayZones(); return; }
    const zp = document.createElement("div"); zp.id = "xrayZones";
    // Bottom row (owner 2026-07-28): flip THIS TAB to the ACTUAL waiter tablet — exactly
    // what a real waiter sees, with their real limited access. Admin-view tabs only.
    const simRow = PANEL_RID
      ? `<div class="zsep"></div><button class="zrow zsim" id="xraySimRow" title="Reload this tab showing exactly what a real waiter sees — same limited access, fully working">` +
        `<span class="dot" style="background:#6b7280"></span>👁 See the actual tablet panel</button>`
      : "";
    zp.innerHTML = `<div class="zh">Off for waiters here</div>` + (zones.length
      ? zones.map((z) => `<button class="zrow" data-zk="${z.key}"><span class="dot"></span>${z.label}<small>⚙ change in Access</small></button>`).join("")
      : `<div class="zrow" style="cursor:default">Nothing is off — waiters see everything you see.</div>`) + simRow;
    rb.appendChild(zp);
    // Hardware BACK closes the popout (not the panel) — panels' backstack manager.
    xrayZonesBackOff = window.LFH_BACK ? LFH_BACK.layer("xray-zones", () => { const z = document.getElementById("xrayZones"); if (z) z.remove(); xrayZonesBackOff = null; }) : null;
    // A zone row jumps to the admin Access hub, deep-linked to the EXACT control
    // (the Access page scrolls to it and flashes it — owner 2026-07-28).
    zp.querySelectorAll(".zrow[data-zk]").forEach((row) => {
      row.onclick = () => {
        closeXrayZones();
        const url = `/aevinite/access${PANEL_RID ? `?rid=${encodeURIComponent(PANEL_RID)}&` : "?"}focus=${encodeURIComponent(row.dataset.zk)}`;
        try { window.top.location.href = url; } catch { window.location.href = url; }
      };
    });
    const simBtn = zp.querySelector("#xraySimRow");
    if (simBtn) simBtn.onclick = () => xraySetViewReal(true);
  };
}
document.addEventListener("click", (e) => {
  if (document.getElementById("xrayZones") && !e.target.closest("#xrayZones") && !e.target.closest("#xrayZonesBtn")) closeXrayZones();
});
// Learn WHO is viewing (and what this restaurant currently lets them do), then repaint so the
// templates' tshow()/txray() see it.
//
// RE-READ IT WHEN THE POWERS CHANGE (T13 sweep, 2026-08-05). This was a one-shot at boot and
// nothing asked again, so an Access change made in /aevinite never reached a waiter tablet that was
// already open — it kept offering a control the server would refuse, until someone reloaded. Every
// gated endpoint still refused it, so nothing was exposed; the fault is that the SCREEN disagreed
// with the truth and the waiter's tap died with an error. Hooked to the `menu` topic below, which
// carries the `settings` half of an Access write and — since mig 299 — the `restaurants` half too,
// and which also fires on wake, so a tablet picked up after an hour is correct before its first tap.
// One in-flight read at a time, and it only repaints when the answer actually DIFFERS, so the dish
// edits that also ride `menu` cost one small GET and nothing else.
// THROTTLED for the reason spelled out beside the manager panel's copy: `menu` also carries every
// dish/category/settings edit, so without this an ordinary run of menu churn would refetch /whoami
// again and again. A permission change is rare and deliberate; noticing it up to 5s later is free.
let whoamiJson = null, whoamiBusy = false, whoamiAt = 0;
const WHOAMI_MIN_GAP_MS = 5000;
function refreshWhoami(force) {
  if (whoamiBusy) return;
  if (!force && Date.now() - whoamiAt < WHOAMI_MIN_GAP_MS) return;
  whoamiBusy = true; whoamiAt = Date.now();
  api("GET", "/whoami").then((w) => {
    const j = JSON.stringify(w || null);
    if (j === whoamiJson) return;      // powers unchanged — nothing to repaint
    whoamiJson = j;
    TABLET_WHO = w;
    if (!tHigher() && !tSim()) return;
    renderXrayRibbon();
    lastSig = ""; // force one repaint — buttons may need to appear tinted
    renderFloor(); if (!state.ordering && !state.pickerOpen) renderPanel();   // #U1: don't clobber an open Move picker
  }).catch(() => {}).then(() => { whoamiBusy = false; });
}
refreshWhoami(true);
// Realtime: refetch only when something on the floor actually changes (instant),
// instead of polling every second. A slow 60s timer is the backup if the
// WebSocket drops; if realtime didn't load, fall back to a gentle 2s poll.
if (window.LFH_RT) {
  // DECLARED BEFORE LFH_RT.start, which references rebaseMenuSig() from its `menu` handler.
  // It worked below too (handlers only run after this module finishes evaluating), but a const
  // used above its own declaration is a trap for whoever edits next — so it lives up here.
  // THE 10-MINUTE SELF-HEAL ASKS "did the menu change?" INSTEAD OF DOWNLOADING IT (T4 improvement
  // 7, 2026-08-11). It used to set _menuStale blind, so every tenth tick re-downloaded the whole
  // dish list — about 50KB of the 77KB payload — whether anything had changed or not, and a menu
  // changes a few times a WEEK. Ten tablets were paying ~1,440 needless dish-list downloads a day
  // between them. /menu-sig answers in ~40 bytes (a digest of the slim identifying columns, built
  // inside the database — see the long note on that endpoint), and only a DIFFERENT answer flags
  // the menu stale so the next load pulls it for real.
  //
  // This is still only the BACKSTOP: the realtime `menu` topic is the primary signal and is
  // untouched. If /menu-sig itself fails we fall back to the old blind flag — a wasted 50KB is
  // always better than a waiter selling a dish that sold out an hour ago.
  let _menuSig = null;
  const readMenuSig = async () => {
    const r = await api("GET", "/menu-sig");
    return r && typeof r.sig === "string" ? r.sig : null;
  };
  // RE-BASELINE, never flag. Called at boot and after any load that really did pull the dish list
  // (the realtime `menu` handler). Without this the next heal tick would see the digest move — it
  // moved because the breadcrumb already refreshed us — and order a SECOND full download for a
  // change we have in hand.
  const rebaseMenuSig = () => { readMenuSig().then((s) => { if (s) _menuSig = s; }).catch(() => {}); };
  // COMPARE and flag. Only a digest that differs from the one recorded at our last real menu read
  // means the backstop has work to do.
  const healMenu = async () => {
    try {
      const sig = await readMenuSig();
      if (!sig) { state._menuStale = true; return; }          // no answer we can trust → refetch for real
      if (_menuSig === null) { _menuSig = sig; return; }       // nothing to compare against yet
      if (sig !== _menuSig) { _menuSig = sig; state._menuStale = true; }
    } catch { state._menuStale = true; }                       // couldn't ask → do the old thing
  };

  // Split by topic: ops churn → TARGETED loadTables() when the breadcrumb names specific
  // tables, else full load() (wake, reconnect, initial, or any unscopable event). menu edits
  // (dish/price/category changes) always do a full load() so the dish browser refreshes.
  LFH_RT.start({ handlers: {
    ops: (detail) => (detail && !detail.full && detail.tables && detail.tables.length) ? loadTables(detail.tables) : load(),
    // #17: after a menu change lands, if the waiter is mid-order patch the open dish grid in
    // place so a just-sold-out dish becomes untappable immediately (load() skips renderPanel
    // while ordering, so without this the grid stayed stale). Flag the menu stale so this load()
    // is a FULL one that actually refetches the dishes (normal refreshes are slim). (perf 2026-07-20)
    menu: () => { refreshWhoami(); state._menuStale = true; return load().then(() => { if (state.ordering) updateDishAvailability(); rebaseMenuSig(); }).catch(() => {}); },
  }});
  // Backup floor sync every 60s (slim). Every ~10th minute also flag the menu stale so the next
  // load refetches dishes — a safety-net that self-heals a missed realtime `menu` event. (perf 2026-07-20)
  // …but NOT WHILE THE TAB IS HIDDEN (T4 sweep, 2026-08-11). A waiter's tablet spends much of a
  // shift asleep, locked, or behind another app, and this fired a WHOLE-FLOOR read every 60 seconds
  // for as long as the page was open — with every tenth one a FULL read that re-downloads the dish
  // list (~50KB of the ~77KB, per the perf note in loadImpl). One forgotten tablet is ~1,440 floor
  // reads and ~144 menu downloads a day, all of them at moments nobody is looking at the screen.
  // Nothing is missed by stopping: realtime.js fires a full refetch on visibilitychange/focus/
  // pageshow, and it tears the socket down after 2 minutes hidden — so a hidden tab has no live
  // connection AND was polling into the void. The KITCHEN's identical backstop has had this guard
  // all along ("a backgrounded wall display kept firing a full-board read every 60s forever");
  // only the tablet was left out. The 10-minute menu self-heal counts VISIBLE ticks, which is
  // right: it exists to repair a `menu` breadcrumb missed while someone was watching.
  let _menuHealN = 0;
  setInterval(() => {
    if (document.hidden) return;
    // Ask, don't download. healMenu() sets _menuStale only when the digest actually moved, so the
    // load() below is a slim refresh on every tick where the menu really is unchanged.
    if ((++_menuHealN % 10) === 0) healMenu().finally(() => load().catch(() => {}));
    else load().catch(() => {});
  }, 60000);
  // Record the baseline digest once at boot, so the FIRST heal tick has something to compare
  // against instead of treating its own first reading as a change.
  rebaseMenuSig();
  // THE CATCH-UP POLL — the tablet was the ONLY live panel without it (T4 sweep, 2026-08-04).
  // When the WebSocket never comes up or dies (a restaurant's wifi blocking WebSockets, a hotel
  // or office network, a database that dropped its realtime connection), the 60s backstop above
  // was this panel's only refresh: a guest's order or a dish the kitchen just marked ready could
  // sit on the waiter's floor unseen for a FULL MINUTE, while the kitchen screen beside it — which
  // has had this since bug M9, 2026-07-05 — updated in five seconds. The manager panel has it too;
  // only the tablet was left behind, and nothing on screen said anything was wrong.
  //
  // catchUp() is the sanctioned shape and it is the part that matters under load: 5s while the
  // socket is down AND the reads are getting through (the legitimate blocked-socket case, which
  // must stay live), doubling to a minute for as long as they FAIL, straight back to quick on the
  // first success, jittered so twenty tablets never share a beat — never a fixed fast beat aimed at
  // a database that is already struggling (CLAUDE.md's rush rule 4). It is a complete no-op
  // whenever realtime is working. load() rejects when its read fails, which is what it backs off on.
  if (window.LFH_RT.catchUp) window.LFH_RT.catchUp(() => load());
} else {
  // NO REALTIME AT ALL (the script failed to load / is blocked). This used to be a flat
  // `setInterval(load, 2000)` — a fixed two-second beat, from every waiter tablet on the floor,
  // for as long as the page was open. That is the exact shape CLAUDE.md's rush rule forbids and
  // that the KITCHEN was already fixed for at 5s: a saturated database is what drops realtime in
  // the first place, so the moment things get bad every device switches to hammering it in
  // lockstep and keeps it down. It never backed off, never jittered, and kept polling while the
  // tab was hidden.
  //
  // LFH_RT.catchUp() does exactly this, but we cannot use it: reaching this branch AT ALL means
  // window.LFH_RT is absent. So the same behaviour, self-contained and small — 2s while reads
  // succeed, doubling to a minute while they fail, back to quick on the first success, ±20%
  // jitter so tablets don't share a beat, and nothing at all while the tab is hidden.
  let _fbStep = 0;
  const _fbSpread = (ms) => Math.round(ms * (0.8 + Math.random() * 0.4));
  const _fbTick = async () => {
    if (document.hidden || navigator.onLine === false) { _fbStep = 0; }      // nothing to catch up on
    else {
      try { await load(); _fbStep = 0; }
      catch (e) { _fbStep = Math.min(_fbStep + 1, 5); }                       // 2s → 4 → 8 … → 60s
    }
    setTimeout(_fbTick, _fbSpread(Math.min(2000 * Math.pow(2, _fbStep), 60000)));
  };
  setTimeout(_fbTick, 2000);
}
// #2: once the offline queue drains (or the connection returns), pull true server state so
// the optimistic screen reconciles with what actually synced. load() self-guards (seq +
// offline), so these are safe no-ops when nothing changed / we're still offline.
window.addEventListener("lfh:outbox-flushed", () => load().catch(() => {}));
// A read came from this device rather than the server: refetch once, quietly, so a single
// slow reply can't leave the panel showing older data than it needs to.
window.addEventListener("lfh:stale-refresh", () => load().catch(() => {}));
// The moment something is saved on-device (or finally sent, or comes back needing a
// person), repaint the open table so its "⏳ Waiting to send" block is always current —
// this is what makes an order taken with no internet visible immediately.
// …but NOT while a picker is open (#U1). renderPanel() replaces the whole panel and tears
// the picker's back layer down with it, so a queue event landing while a waiter is halfway
// through "Change table" / "Move a KOT" would wipe the choice they were making — the exact
// thing the three other repaint sites already guard against. This one was missed (found while
// chasing an intermittent test failure, 2026-08-03).
window.addEventListener("lfh:outbox-changed", () => { if (state.table != null && !state.ordering && !state.pickerOpen) { try { renderPanel(); } catch (e) {} } });
window.addEventListener("online", () => load().catch(() => {}));

/* ════════════════════════════════════════════════════════════════════════════
   PHONE RESPONSIVE (2026-06-30): a hamburger drawer (profile + settings + logout)
   and a full-screen work panel with a top-right ✕ close. Pure UI add-on — it reads
   the existing global 'state' / 'renderPanel' / 'renderFloor', so the ordering logic
   is untouched. All behaviour is gated to phone widths by CSS; desktop is unchanged.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  // ── Full-screen panel close (✕) ──────────────────────────────────────────
  const closeBtn = document.createElement("button");
  closeBtn.id = "tabletClose"; closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close"); closeBtn.textContent = "✕";
  document.body.appendChild(closeBtn);
  // Smart ONE-STEP back — never dump the waiter all the way out from deep inside
  // (owner 2026-07-05: the ✕ used to exit the whole flow mid-order/mid-edit). It peels
  // one layer: item options → order screen → table detail → floor.
  closeBtn.onclick = () => {
    if (state._opt) { closeDishOptions(); return; }                     // item popup → close it
    if (state.viewOrder) { state.viewOrder = false; renderOrderMode(); return; }  // view order → back to menu
    if (state.ordering) { exitOrderMode(); return; }                    // taking an order → back to the table
    state.table = null; renderPanel(); renderFloor();                   // table detail → back to the floor
  };

  // Toggle body.tbl-open whenever the panel shows a table (vs the "tap a table" empty state),
  // so the CSS can make it a full-screen overlay on phones. Decoupled from the render code.
  const panelEl = document.getElementById("panel");
  let backOff = null;
  const sync = () => {
    const open = !!panelEl && !panelEl.querySelector(".empty");
    document.body.classList.toggle("tbl-open", open);
    if (open && !backOff && window.LFH_BACK) backOff = LFH_BACK.layer("tablet-panel", () => closeBtn.click());
    else if (!open && backOff) { backOff(); backOff = null; }
  };
  if (panelEl) { new MutationObserver(sync).observe(panelEl, { childList: true, subtree: true }); sync(); }

  // ── Hamburger drawer: profile + settings + logout ────────────────────────
  const backdrop = document.createElement("div"); backdrop.className = "tbl-drawer-backdrop";
  const drawer = document.createElement("aside"); drawer.className = "tbl-drawer"; drawer.setAttribute("aria-label", "Menu and settings");
  drawer.innerHTML =
    '<button class="dw-close" type="button" aria-label="Close menu">✕</button>' +
    '<div><div class="dw-prof">Signed in as</div><div class="dw-name" id="dwName">…</div><div class="dw-prof" id="dwRole"></div></div>' +
    '<div class="dw-row"><span>Restaurant</span><span class="dw-prof" id="dwRest"></span></div>' +
    // My profile & pay (mig 220) — hidden until the server confirms this restaurant has the
    // feature and this person has a profile (no dead button for restaurants without it).
    // display:none INLINE, not just [hidden]: .dw-row sets display:flex, and an author display
    // rule beats the hidden attribute — with only [hidden] this row showed on restaurants that
    // don't have the feature at all (found in the 2026-07-30 sweep).
    '<div class="dw-row" id="dwMeRow" hidden style="display:none"><span>My profile &amp; pay</span><button class="btn small" id="dwMe" type="button">Open</button></div>' +
    '<div class="dw-row"><span>Theme</span><button class="btn small" id="dwTheme" type="button">Light / Dark</button></div>' +
    // 🚩 REPORT AN ISSUE — and it has to be HERE, not only on the top bar (T4 sweep, 2026-08-06).
    // The top bar's 🚩 is display:none below 600px, and this drawer had no equivalent row, so a
    // waiter working the floor from a PHONE — a layout this panel builds on purpose — had no way at
    // all to flag a spill or a broken card machine. The theme toggle is hidden at the same width and
    // has always had a row here; that is the pattern, and 🚩 was the one thing missing from it.
    '<div class="dw-row"><span>Report an issue</span><button class="btn small" id="dwIssue" type="button">🚩 Open</button></div>' +
    // 🔔 FROM THE GUEST MENU — and it belongs HERE for the same reason 🚩 does (owner, 2026-08-28).
    // This drawer's own pattern, written into the comment above: anything the top bar hides on a
    // phone gets a row here. The theme toggle has always had one; 🚩 was given one on 2026-08-06
    // when the same fault was found. The bell arrived a week after that and nobody joined the two
    // up, so on a phone it was the one control with no second way in. It is back on the bar now
    // (the bell re-states its own display), and this is the belt to that pair of braces — a
    // notification is the last thing that should have exactly one route to it.
    '<div class="dw-row"><span>From the guest menu</span><button class="btn small" id="dwBell" type="button">🔔 Open</button></div>' +
    // #5: clock lives here on phones (moved off the cramped top bar; desktop keeps it on the bar).
    '<div class="dw-row"><span>Time</span><span class="dw-prof" id="dwClock">…</span></div>' +
    // Build tag: lets the owner confirm at a glance he's on the latest code (rules out a stale cache). (audit 2026-07-09)
    '<div class="dw-row"><span>Build</span><span class="dw-prof" id="dwBuild">…</span></div>' +
    // Spacer pins the buttons below to the drawer's bottom whichever of them are visible.
    '<div style="flex:1"></div>' +
    // Banquet module (mig 130): shown only when the admin entitlement AND the
    // waiter's tablet_banquet capability allow it (openDrawer re-checks each open).
    '<button class="dw-btn" id="dwBanquet" type="button" hidden style="margin-top:0;margin-bottom:10px">🎪 Banquet billing</button>' +
    // 🥡 Parcel LEFT the tablet (owner, 2026-08-03 — "the tablet will not have the parcel
    // option, only quick order"; this reverses his 2026-08-03-morning "permanently there").
    // Parcels remain a manager feature; the server's /parcel endpoint + cap are untouched.
    // ⚙️ Settings (owner, 2026-08-03): the drawer's Settings door — holds Log out for now,
    // more will move in here later.
    '<button class="dw-btn" id="dwSettings" type="button" style="margin-top:0">⚙️ Settings</button>';
  document.body.appendChild(backdrop); document.body.appendChild(drawer);

  let drawerOff = null;
  const openDrawer = () => {
    backdrop.classList.add("open"); drawer.classList.add("open");
    drawer.querySelector("#dwRest").textContent = (document.getElementById("restName")?.textContent || "").trim() || "—";
    const bqBtn = drawer.querySelector("#dwBanquet");
    if (bqBtn) {
      // Ladder rule for the banquet entry too: hidden from the real waiter when the
      // module or its tri-state is off. ADMIN X-RAY rule (owner 2026-07-22): the admin
      // act-as view ALWAYS sees it — tinted when it's off for real waiters (module OR
      // tri-state) — and the server lets the admin through.
      const sset = state.data.settings || {};
      const allowed = sset.banquet_allowed === true && (sset.banquet_owner_control !== true || sset.banquet_enabled !== false);
      const offForWaiters = !allowed || tperm("tablet_banquet") === "off";
      bqBtn.hidden = tHigher() ? false : offForWaiters;
      bqBtn.classList.toggle("xray-off", tHigher() && offForWaiters);
    }
    tickClock();   // the drawer is now open, so show the right time at once (see tickClock)
    loadProfile();
    if (window.LFH_BACK && !drawerOff) drawerOff = LFH_BACK.layer("tablet-drawer", closeDrawer);
  };
  function closeDrawer() {
    backdrop.classList.remove("open"); drawer.classList.remove("open");
    if (drawerOff) { drawerOff(); drawerOff = null; }
  }
  backdrop.onclick = closeDrawer;
  drawer.querySelector(".dw-close").onclick = closeDrawer;
  drawer.querySelector("#dwTheme").onclick = () => document.getElementById("themeToggle")?.click();
  // Close the drawer first, then open the issue sheet — it registers its own back layer, and
  // leaving the drawer open underneath would stack two layers for one hardware Back press.
  { const isb = drawer.querySelector("#dwIssue"); if (isb) isb.onclick = () => { closeDrawer(); if (window.LFH_ISSUE) LFH_ISSUE.open({ api, rid: PANEL_RID, notify: (m) => toast(m, true) }); }; }
  // The bell's own sheet. If the guest menu is switched off the module has unmounted itself and
  // there is nothing to open — say so rather than letting the tap land on nothing, which is the
  // one thing this codebase does not allow a tap to do.
  { const blb = drawer.querySelector("#dwBell");
    if (blb) blb.onclick = () => {
      closeDrawer();
      if (window.LFH_BELL && typeof LFH_BELL.open === "function") LFH_BELL.open();
      else toast("The guest menu is switched off, so there is nothing waiting.", false);
    }; }
  { const meBtn = drawer.querySelector("#dwMe"); if (meBtn) meBtn.onclick = () => { closeDrawer(); if (window.LFH_ME) window.LFH_ME.open(); }; }
  const bqDrawerBtn = drawer.querySelector("#dwBanquet");
  if (bqDrawerBtn) bqDrawerBtn.onclick = () => { closeDrawer(); openBanquet(); };
  // ⚙️ Settings sheet — Log out lives INSIDE Settings now (owner, 2026-08-03: "in the
  // settings only keep logout right now, we will add others later").
  const setBtn = drawer.querySelector("#dwSettings");
  if (setBtn) setBtn.onclick = () => { closeDrawer(); openSettingsSheet(); };
  function openSettingsSheet() {
    document.querySelector(".set-overlay")?.remove();
    const ov = document.createElement("div");
    ov.className = "set-overlay";
    Object.assign(ov.style, { position: "fixed", inset: "0", background: "var(--scrim)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
    ov.innerHTML = `<div style="width:min(92vw,360px);background:var(--panel);color:var(--text);border-radius:16px;padding:18px 18px calc(18px + var(--sab));box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
      <div style="display:flex;align-items:center;gap:10px;margin:0 0 14px"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">⚙️ Settings</h3><button class="set-close" aria-label="Close" style="background:var(--panel-2);border:0;color:var(--text);border-radius:8px;width:40px;height:40px;font-size:16px;cursor:pointer">✕</button></div>
      <!-- A FORM, not a link (T9 improvement 13, 2026-08-06): /api/panel-logout is POST-only now,
           because a GET that ends a session fires from anything that merely POINTS at the URL — a
           waiter could be signed out mid-service. Same change AdminShell made for /api/staff-logout.
           The route answers 303 → /login, so this still works with no JavaScript. -->
      <!-- target="_top": this panel is in an IFRAME, so a plain submit signs out only the frame and
           leaves the page around it (and its URL) untouched — the waiter looks signed out and is not.
           Found while giving the KITCHEN screen its first sign-out, 2026-08-19; same one-line fix. -->
      <form method="post" action="/api/panel-logout" target="_top" style="margin:0">
        <button type="submit" class="dw-btn danger" style="margin-top:0;width:100%">Sign out</button>
      </form>
      <div class="muted" style="font-size:12px;margin-top:10px">More settings will live here soon.</div>
    </div>`;
    document.body.appendChild(ov);
    let backOff = window.LFH_BACK ? LFH_BACK.layer("tablet-settings", () => closeSheet()) : null;
    const closeSheet = () => { if (backOff) { backOff(); backOff = null; } ov.remove(); };
    ov.querySelector(".set-close").onclick = closeSheet;
    ov.onclick = (e) => { if (e.target === ov) closeSheet(); };
  }
  // THE BUILD TAG READS THE CODE, IT IS NOT TYPED (fixed 2026-08-06, T4 sweep). It used to be the
  // literal 'tablet-20260722kot1', frozen since 22 July while this panel changed many times — so the
  // one field whose whole job is "am I on the latest code, or a stale cache?" gave the same answer
  // either way, which is worse than having no field. app.js is loaded as `app.js?v=<content hash>`
  // (verify:panel-cache keeps that hash honest), so the hash IS the answer: it changes exactly when
  // the file does. Falls back to "unknown" rather than inventing a version.
  (function setBuildTag() {
    const out = drawer.querySelector("#dwBuild");
    if (!out) return;
    let v = "";
    try {
      const me = [...document.querySelectorAll('script[src*="app.js"]')].pop();
      v = me ? (new URL(me.src, location.href).searchParams.get("v") || "") : "";
    } catch (e) { v = ""; }
    out.textContent = v ? "tablet " + v : "tablet (unknown)";
  })();
  const ham = document.getElementById("hamburger"); if (ham) ham.onclick = openDrawer;
  // ⚡ Quick order — the persistent top-bar door (build first, pick the table last).
  const qob = document.getElementById("quickOrderBtn"); if (qob) qob.onclick = openQuickOrder;
  // 🚩 Report an issue (subject + optional photo + live voice note) — shared widget.
  { const rib = document.getElementById("reportIssueBtn"); if (rib) rib.onclick = () => { if (window.LFH_ISSUE) LFH_ISSUE.open({ api, rid: PANEL_RID, notify: (m) => toast(m, true) }); }; }

  let profileLoaded = false;
  async function loadProfile() {
    if (profileLoaded) return; // name/role don't change within a session
    try {
      const r = await fetch("/api/panel-profile", { cache: "no-store" });
      const j = await r.json();
      if (!j.error) {
        drawer.querySelector("#dwName").textContent = j.name || j.username || "Staff";
        drawer.querySelector("#dwRole").textContent = [j.role, j.username].filter(Boolean).join(" · ");
        // Reveal "My profile & pay" only when this restaurant actually has the feature.
        // .hidden alone loses to a display rule, so clear the display too (a bug this
        // codebase has already been bitten by).
        const meRow = drawer.querySelector("#dwMeRow");
        if (meRow) {
          if (j.profileModule) { meRow.hidden = false; meRow.style.display = ""; }
          else { meRow.hidden = true; meRow.style.display = "none"; }
        }
        profileLoaded = true;
      }
    } catch { /* offline — leave the placeholder */ }
  }
})();

/* ══════════════════════════════════════════════════════════════════════════════
   BANQUET BILLING (mig 130) — opened from the drawer, shown only when the admin
   entitlement + the waiter's tablet_banquet capability allow it. A full-screen
   overlay: plate-count steppers over the restaurant's banquet menu, a table pick,
   one tap lands the bill on that table as a normal 'served' order (no kitchen
   ticket) — then the usual invoice / mark-paid flow settles it. 'pin' mode rides
   the same manager-PIN prompt as discounts (the server asks, we prompt and retry).
   ══════════════════════════════════════════════════════════════════════════════ */
let bqOff = null, bqEl = null, bqItems = [];
function closeBanquet() {
  if (bqEl) { bqEl.remove(); bqEl = null; }
  if (bqOff) { bqOff(); bqOff = null; }
}
async function openBanquet() {
  closeBanquet();
  bqEl = document.createElement("div");
  bqEl.style.cssText = "position:fixed;inset:0;z-index:120;background:var(--bg);display:flex;flex-direction:column";
  bqEl.innerHTML =
    '<div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line);background:var(--panel)">' +
      '<button class="btn small" id="bqBack" type="button">← Back</button>' +
      '<b style="font-size:16px">🎪 Banquet billing</b></div>' +
    '<div id="bqBody" style="flex:1;overflow-y:auto;padding:16px;max-width:640px;width:100%;margin:0 auto;box-sizing:border-box">' +
      '<div class="muted" style="padding:20px;text-align:center">Loading the banquet menu…</div></div>';
  document.body.appendChild(bqEl);
  bqEl.querySelector("#bqBack").onclick = closeBanquet;
  if (window.LFH_BACK) bqOff = LFH_BACK.layer("tablet-banquet", closeBanquet);
  try {
    const r = await api("GET", "/banquet-items");
    bqItems = r.items || [];
  } catch (e) {
    toast("Couldn't open banquet billing: " + e.message, false);
    closeBanquet();
    return;
  }
  renderBanquetBody();
}
function renderBanquetBody() {
  const body = bqEl && bqEl.querySelector("#bqBody");
  if (!body) return;
  if (!bqItems.length) {
    body.innerHTML = '<div class="muted" style="padding:20px;text-align:center">No banquet items yet — the manager adds them in the manager panel’s Banquet tab.</div>';
    return;
  }
  const row = (it) =>
    `<div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);margin-bottom:10px">
      <div><b style="font-size:14.5px">${esc(it.title)}</b>
        <small style="display:block;color:var(--muted)">${inr(it.price)} ${esc(it.unit || "per plate")}</small></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn small" data-bq-step="-1" data-bq-id="${it.id}" type="button">−</button>
        <input data-bq-qty="${it.id}" type="number" min="0" max="5000" value="0" inputmode="numeric"
          style="width:70px;text-align:center;padding:9px 6px;border-radius:9px;border:1px solid var(--line);background:var(--panel-2);color:var(--text);font-weight:700" />
        <button class="btn small" data-bq-step="1" data-bq-id="${it.id}" type="button">+</button>
      </div>
    </div>`;
  body.innerHTML =
    bqItems.map(row).join("") +
    `<div style="display:flex;gap:12px;align-items:flex-end;justify-content:space-between;border-top:1px solid var(--line);padding-top:14px;margin-top:4px">
      <label style="font-size:12px;color:var(--muted)">Table (optional)<br/>
        <input id="bqTable" type="number" min="1" max="${tableCount()}" inputmode="numeric" placeholder="none"
          style="width:84px;margin-top:4px;text-align:center;padding:9px 6px;border-radius:9px;border:1px solid var(--line);background:var(--panel-2);color:var(--text);font-weight:700" /></label>
      <div style="text-align:right;font-size:13px">
        <div>Subtotal <b id="bqSub">₹0</b></div>
        <div style="color:var(--muted)">+ tax <span id="bqTax">₹0</span></div>
        <div style="font-size:15px;margin-top:2px">Total <b id="bqTotal">₹0</b></div>
      </div>
    </div>
    <button class="btn primary" id="bqCreate" type="button" disabled style="width:100%;margin-top:14px;padding:13px">🧾 Create the bill</button>`;
  const totals = () => {
    let sub = 0;
    for (const it of bqItems) {
      const inp = body.querySelector(`[data-bq-qty="${it.id}"]`);
      sub += Math.max(0, Math.round(Number(inp && inp.value) || 0)) * (Number(it.price) || 0);
    }
    // A banquet is taxed at its OWN rate (mig 239) — this estimate used the restaurant's dine-in
    // rate, so a place with banquet components set (18% vs 5% is the normal pair) quoted one
    // number here and printed another the moment the bill was created. Mirrors
    // lfh_banquet_tax_rate: the banquet components when the restaurant set any, else exactly
    // what effRate() already returns.
    const tax = Math.round(sub * banquetRate() * 100) / 100;
    body.querySelector("#bqSub").textContent = inr(sub);
    body.querySelector("#bqTax").textContent = inr(tax);
    body.querySelector("#bqTotal").textContent = inr(sub + tax);
    body.querySelector("#bqCreate").disabled = sub <= 0;
  };
  body.querySelectorAll("[data-bq-step]").forEach((b) => {
    b.onclick = () => {
      const inp = body.querySelector(`[data-bq-qty="${b.dataset.bqId}"]`);
      inp.value = Math.max(0, Math.min(5000, (Math.round(Number(inp.value) || 0)) + Number(b.dataset.bqStep)));
      totals();
    };
  });
  body.querySelectorAll("[data-bq-qty]").forEach((inp) => { inp.oninput = totals; });
  body.querySelector("#bqCreate").onclick = async () => {
    const lines = bqItems
      .map((it) => ({ id: it.id, qty: Math.max(0, Math.round(Number(body.querySelector(`[data-bq-qty="${it.id}"]`).value) || 0)) }))
      .filter((l) => l.qty > 0);
    const t = String(body.querySelector("#bqTable").value || "").trim();
    if (!lines.length) { toast("Set a plate count first.", false); return; }
    // Table is optional (mig 132): blank → a standalone bill the manager settles
    // from the Bills tab; only validate when the waiter actually typed one.
    if (t && !/^\d+$/.test(t)) { toast("That table number doesn't look right — or leave it blank.", false); return; }
    const btn = body.querySelector("#bqCreate");
    btn.disabled = true;
    try {
      let r;
      try {
        r = await api("POST", "/banquet/place", { table: t, lines });
      } catch (e) {
        if (!wantsPin(e)) throw e;
        let pin = await pinPrompt("Enter a manager PIN to open banquet billing.");
        while (pin) {
          try { r = await api("POST", "/banquet/place", { table: t, lines, managerPin: pin }); break; }
          catch (e2) {
            if (wantsPin(e2)) { pin = await pinPrompt("Enter a manager PIN to open banquet billing.", "That PIN didn't match — try again."); continue; }
            throw e2;
          }
        }
        if (!pin && !r) { btn.disabled = false; return; } // cancelled
      }
      toast(t ? `Banquet bill created on table ${t} — total ${inr(r.total)}.`
             : `Banquet bill created — total ${inr(r.total)}. The manager settles it under Bills.`);
      closeBanquet();
      await load(); // with a table, its tile now shows the due like any other bill
    } catch (e) {
      toast("Couldn't create the bill: " + e.message, false);
      btn.disabled = false;
    }
  };
}
