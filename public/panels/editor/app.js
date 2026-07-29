// Menu editor — talks only to the local server (which holds the service-role key).
//
// This is the WHOLE browser side of the editor. It builds every screen by
// generating HTML text and dropping it into the page, listens for clicks, and
// calls the local server (server.js) to read/write the database. There is no
// framework here — just plain JavaScript, so a beginner can follow it top to bottom.

// The six languages every dish/category/filter name can be translated into.
// Each entry is [code, human-readable label].
const LANGS = [
  ["en", "English"], ["de", "German"], ["fr", "French"],
  ["ar", "Arabic"], ["hi", "Hindi"], ["ko", "Korean"],
];
// keep in sync with lib/allergens.ts
const ALLERGENS = [
  { slug: "gluten", label: "🌾 Gluten" },
  { slug: "dairy", label: "🥛 Dairy" },
  { slug: "eggs", label: "🥚 Eggs" },
  { slug: "nuts", label: "🥜 Nuts" },
  { slug: "soy", label: "🫘 Soy" },
  { slug: "fish", label: "🐟 Fish" },
];
// Friendly singular names for each tab, used in headings like "New Dish".
const TAB_LABEL = { items: "Dish", categories: "Category", filters: "Tag", general: "Settings" };

// The tabs across the top of the editor. Anything not in this list is ignored.
// NOTE: "features" is intentionally OMITTED — that tab was moved to the admin panel
// (/aevinite). Leaving it here let a browser whose last-used tab was "features" boot
// straight into the removed guest-feature toggle grid (owner could flip admin-controlled
// flags from the manager panel). A stale saved "features" now falls back to "items".
const VALID_TABS = ["items", "categories", "filters", "orders", "tables", "platform", "dash", "log", "general", "banquet", "ratings", "inventory"];
// Remember which tab you were on so a refresh keeps you there (e.g. stay on
// Orders during a busy service instead of snapping back to Dishes).
const savedTab = (() => { try { return localStorage.getItem("lfh_editor_tab"); } catch { return null; } })();
// MENU-ONLY embed (owner panel → Menu, 2026-07-25): when the panel is opened with
// ?menuonly=1 it shows ONLY the menu editor (Dishes / Categories / Tags) — every other
// top tab and the admin ribbon are hidden. Used to host the same editor inside the owner
// panel's Menu page without the Bills/Tables/etc. that already live elsewhere there.
const MENU_ONLY = new URLSearchParams(location.search).get("menuonly") === "1";
const MENU_TABS = ["items", "categories", "filters"];
// When embedded in the owner panel, adopt the OWNER panel's skin (light violet / dark cyan)
// so the editor looks native, not the manager panel's gold. ?skin=light|dark comes from the
// owner Menu page. Match the editor's base data-theme too so hardcoded per-theme rules align.
const MENU_SKIN = new URLSearchParams(location.search).get("skin") === "dark" ? "dark" : "light";
// ?invonly=1 (mig 221): same embed idea for the owner panel's Inventory page — ONLY the
// 📦 Inventory tab, chrome hidden via the same body.menu-only rules.
const INV_ONLY = new URLSearchParams(location.search).get("invonly") === "1";
if (MENU_ONLY || INV_ONLY) { try { document.documentElement.setAttribute("data-theme", MENU_SKIN); } catch (e) {} }
// Tiny localStorage helpers so a refresh keeps you exactly where you were —
// not just the tab, but the SUB-VIEW too (Orders: live/previous/calls; Log:
// customer/operation). Wrapped so a blocked localStorage never throws.
const lsGet = (k, def) => { try { return localStorage.getItem(k) || def; } catch { return def; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
// "state" is the editor's single source of truth — one object holding everything
// the screen needs: which tab is open, the data loaded from the server, the record
// currently being edited, the search text, and the live tables board. Whenever
// state changes we re-draw the affected part of the screen from it.
const state = {
  tab: INV_ONLY ? "inventory" // inventory-only embed: the 📦 tab is the whole panel
    : MENU_ONLY ? (MENU_TABS.includes(savedTab) ? savedTab : "items") // menu-only: never open a non-menu tab
    : savedTab === "sessions" ? "tables" : (VALID_TABS.includes(savedTab) ? savedTab : "items"), // "sessions" merged into "tables"
  data: { items: [], categories: [], filters: [], orders: [], calls: [], settings: { id: "site", bubbles_enabled: true, service_mode: false } },
  sel: null,      // working copy of the record being edited
  isNew: false,
  search: "",
  catFilter: "", // Dishes tab: selected category slug to filter by ("" = All)
  bulkMode: false,          // Dishes tab: multi-select mode (mark sold-out / available / delete)
  bulkSel: new Set(),       // ids of the dishes ticked in bulk mode
  board: { sessions: [], members: [], items: [], requests: [], blocklist: [] }, // v2 sessions live board (TIER 2: only the SELECTED table's full slice now)
  // Banquet module (mig 130): its items load on first tab open only. qty maps
  // item id → plate count in the "generate bill" builder; table = the target table.
  banquet: { loaded: false, items: [], qty: {}, table: "" },
  // TIER 1 of the two-tier Table view: the slim, server-computed per-tile summary the GRID
  // renders from (mig 101, lfh_table_view_summary). tiles is keyed by table number → the
  // computed { state,label,meta,counts,due,pay,members,pending,hasNew/Call/Req/Join,reqs,calls }.
  // The aggregates (calls/requests/joiners/blocklist + order_count) feed the side panel + chimes.
  summary: { tiles: {}, order_count: 0, latest_order_table: null, calls: [], requests: [], joiners: [], blocklist: [] },
  boardLoaded: false, // false until the live board arrives once → drives the floor skeleton (no "all Free" flash on load)
  openSess: null, // table number whose session modal is open
  selectedTable: null, // table number whose DETAIL is shown IN the right side panel (Tables tab master-detail). null = show the floor controls instead.
  floorSideCollapsed: lsGet("lfh_floor_side_collapsed", "0") === "1", // F1: right floor panel collapsed → clicking a table opens a FULL-SCREEN popup instead of the in-side detail.
  // Floating popups (owner request, 2026-07-02 — "I want many popups at the same time"):
  // an ORDERED array (oldest→newest) of { table, pinned, x, y, w } — one entry per table
  // whose detail is floating right now. Non-pinned ones auto-arrange in a single row
  // (newest-center, shrinking together to keep fitting — see layoutFloatingRow); dragging
  // one sets pinned + its own x/y/w and excludes it from that auto-arrange. Independent of
  // the DOCKED side-panel detail (selectedTable) — floating is purely additive, the docked
  // single-table flow is untouched. Not persisted across reload (matches floorSideW/
  // floorFloatX's existing convention — positions are session-only, not saved state).
  floatingTables: [],
  // How many columns the floating-popup row currently has (0 = no grid yet). GROWS as popups
  // are added (1 popup = one BIG centered card, 2 = halves, 3 = thirds … capped at 5) and
  // resets when no slotted popup remains — so a fresh popup always starts big in the middle
  // (owner, 2026-07-02: "if only 1, size should be big; as I add, it should become small").
  floatCols: 0,
  floorTileDensity: lsGet("lfh_floor_tile_density", "m"), // s | m | l — how many tiles fit per row in the floor grid
  ordersView: lsGet("lfh_editor_ordersview", "live"), // Orders left-bar: live | previous | bills | calls — remembered across refresh
  billSearch: "", billSearchType: "date", billSort: "new", // Bills → Today/Previous search + sort (default to Date picker)
  billHistRows: [], // server-side bills-history search results (bills older than the local 200-row window)
  logView: lsGet("lfh_editor_logview", "customers"),  // Log left-bar: customers | operations — remembered across refresh
  users: { members: [], customers: [], blocklist: [] }, // Log tab data
  // "User setting" card (Settings tab): the manager's own team (tablet/kitchen/manager
  // logins), reusing the SAME /api/owner/staff the owner's "Staff & powers" page uses —
  // gated server-side by manager_permissions.manage_staff, so a manager without it just
  // gets a 403 we show as a friendly message (staffDenied). Loaded lazily, once, on first
  // visit to Settings (see loadStaffTeam), not on every keystroke/render.
  staffLoaded: false, staffTeam: [], staffDenied: null, staffReveal: null, staffBusy: false, staffRestaurantId: null,
  staffActor: null, // "admin" | "owner" | "manager" — who the staff API says WE are (drives which roles the dropdowns offer)
  // Settings tab: which SECTION the left sidebar has selected (owner, 2026-07-03 —
  // "settings should be organized": General / Tables / Users / Access / Billing /
  // Dining sessions instead of one long scroll). See SETTINGS_SECTIONS.
  settingsSection: "general",
};

// ---------- tiny helpers ----------
// $  : shorthand for "find the first element matching this CSS selector".
const $ = (s, r = document) => r.querySelector(s);

// __lfhPerf: cheap, always-on perf counters so the floor's render cost can be measured at
// scale (300 tables). fullRenders = full floor rebuilds (renderEditor on the Tables tab);
// patches = incremental tile patches (patchFloorTiles); tilesPatched = how many tiles those
// patches touched in total; lastMs = how long the most recent render/patch took; longTasks =
// main-thread tasks >50ms (the freeze symptom). The PerformanceObserver no-ops where the API
// is unavailable. Read it from the console to confirm a single-table breadcrumb PATCHES (not
// full-renders) and that long tasks stay near zero under churn.
window.__lfhPerf = window.__lfhPerf || { fullRenders: 0, patches: 0, tilesPatched: 0, lastMs: 0, longTasks: 0 };
try {
  if (typeof PerformanceObserver === "function") {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.duration > 50) window.__lfhPerf.longTasks++; })
      .observe({ entryTypes: ["longtask"] });
  }
} catch {}
// clone: make a deep, independent copy of an object (so editing the copy never
// changes the original until we deliberately save). structuredClone is the
// browser's native deep copy — much faster than the old JSON round-trip,
// which added real lag when opening big dishes.
const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
// esc: make text safe to drop into HTML. It turns characters like < > & " into
// their harmless codes so a dish name with a "<" can't break or hijack the page.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// fold: strip accents/diacritics + lowercase so search is accent-insensitive
// ("creme brulee" finds "Crème Brûlée") — matches the guest menu's search (#190).
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// inr: show a stored USD amount as Indian rupees, rounded to whole ₹.
// Orders store totals in USD (the menu's source-of-truth currency); the owner
// wants the editor to read in ₹ (2026-06-10). The rate mirrors CURRENCIES in
// the menu app's lib/format.ts — update both together when rates move.
const INR_RATE = 1; // prices are stored in rupees now (migration 043) — no conversion
const inr = (usd) => "₹" + Math.round((parseFloat(usd) || 0) * INR_RATE).toLocaleString("en-IN");
// el: turn a string of HTML into a real, clickable page element we can insert.
const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

// setPath: store a value deep inside an object using a dotted "address" like
// "nutrition.calories" or "options.0.choices.1.label". It walks down each step,
// creating empty objects/arrays as needed, then sets the final piece. This is how
// a single input box can edit a deeply-nested field by just naming its path.
function setPath(obj, path, val) {
  const ks = path.split(".");
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    const k = ks[i];
    if (o[k] == null) o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    o = o[k];
  }
  o[ks[ks.length - 1]] = val;
}

// toast: pop a small message at the corner of the screen (green for success,
// red for an error) and hide it again after a couple of seconds. toastTimer
// remembers the pending "hide it" timer so a new toast resets the clock.
// Optionally takes an action button (e.g. { label: "UNDO", fn: ... }) and a
// custom lifetime in ms — the Gmail-style pattern for bulk actions: do the
// thing instantly, but give the owner a few seconds to take it back.
let toastTimer;
function toast(msg, type = "ok", action, ms) {
  const t = $("#toast");
  t.innerHTML = "";                       // rebuild fresh each time (message + optional action + close ✕)
  const span = document.createElement("span");
  span.className = "toast-msg";
  span.textContent = msg;
  t.appendChild(span);
  if (action) {
    const b = document.createElement("button");
    b.className = "toast-act";
    b.textContent = action.label;
    // Clicking the action hides the toast first so it can't be clicked twice.
    b.onclick = () => { t.hidden = true; clearTimeout(toastTimer); action.fn(); };
    t.appendChild(b);
  }
  // Manual dismiss — staff can clear a notification the moment they've seen it,
  // instead of waiting for it to time out (owner, 2026-06-21).
  const x = document.createElement("button");
  x.className = "toast-x";
  x.setAttribute("aria-label", "Dismiss");
  x.textContent = "✕";
  x.onclick = () => { t.hidden = true; clearTimeout(toastTimer); };
  t.appendChild(x);
  t.className = "toast " + type;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms || 1800);
}

// Pretty in-app confirm (replaces the ugly native window.confirm).
// It builds a little "Are you sure?" pop-up and returns a Promise that resolves
// to true (user clicked the confirm button) or false (cancel / Escape / click
// outside). Calling code does: if (await confirmDialog(...)) { ...do it... }.
function confirmDialog(message, confirmLabel = "Confirm", opts = {}) {
  return new Promise((resolve) => {
    // Singleton guard: a confirm is modal, so there is never a legitimate reason to stack
    // two. A fast double-click on an action (e.g. "Send to kitchen") fired this twice before
    // the trigger button disabled, stacking two identical dialogs — confirming both could
    // place a duplicate. If one is already open, suppress this second call (resolve "no").
    if (document.querySelector(".confirm-overlay")) { resolve(false); return; }
    const wrap = document.createElement("div");
    // opts.floorwide marks confirms that hit EVERY table at once (Close all).
    // They get a deliberately different, scarier look so muscle-memory built on
    // the routine one-table popups doesn't click through this one blindly.
    wrap.className = "confirm-overlay" + (opts.floorwide ? " floorwide" : "");
    wrap.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-icon"><i class="fas fa-triangle-exclamation"></i></div>
        <div class="confirm-msg">${esc(message)}</div>
        <div class="confirm-actions">
          <button class="btn confirm-cancel">Cancel</button>
          <button class="btn danger confirm-ok">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add("show")); // next frame: trigger the fade-in animation
    // "close" hides the dialog, removes it after the fade-out, and reports the
    // answer (true/false) back to whoever is awaiting this Promise.
    // esc2 must be a hoisted declaration (NOT a named function expression) so both close()
    // and the listener below can reference it in this scope — a named expression's name is
    // only visible INSIDE itself, which threw "esc2 is not defined" from close().
    function esc2(e) { if (e.key === "Escape") close(false); }
    const close = (val) => {
      wrap.classList.remove("show");
      setTimeout(() => wrap.remove(), 200);
      document.removeEventListener("keydown", esc2); // don't leak the Escape listener
      resolve(val);
    };
    // Let the hardware-BACK adapter cancel THIS dialog via its own close (resolves the
    // promise false + cleans up), instead of a bare remove() that would leave it hanging.
    wrap.__lfhClose = () => close(false);
    // Speed-click guard: the dialog pops up right under the pointer, so the
    // tail of a fast double-click lands ~100ms later on the backdrop (or even
    // on the Cancel/Confirm buttons). That used to silently cancel the dialog
    // — making it feel like the app asked "are you sure?" again and again —
    // or could instantly confirm something the owner never read. So every
    // click is ignored until the dialog has been on screen for 350ms (humans
    // need longer than that to read it anyway). Escape stays instant.
    const openedAt = Date.now();
    const settled = () => Date.now() - openedAt > 350;
    wrap.querySelector(".confirm-cancel").onclick = () => { if (settled()) close(false); };
    wrap.querySelector(".confirm-ok").onclick = () => { if (settled()) close(true); };
    wrap.onclick = (e) => { if (e.target === wrap && settled()) close(false); };
    document.addEventListener("keydown", esc2);
  });
}

// promptDialog: a styled text-input dialog — the themed replacement for the raw window.prompt()
// that was used for revert/void reasons (a native prompt ignores the theme, looks out of place,
// and on some phones is dismissed by an accidental tap). Resolves the trimmed string, or null on
// cancel/Escape/backdrop. required:true keeps the OK button from submitting an empty value. Mirrors
// confirmDialog (fade-in, Escape, hardware-BACK __lfhClose, backdrop dismiss) + focuses the input.
function promptDialog(message, opts = {}) {
  const { confirmLabel = "OK", placeholder = "", defaultValue = "", required = false, danger = true, presets = [] } = opts;
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "confirm-overlay";
    // Quick-pick chips: one tap fills the reason so staff rarely have to type (owner
    // 2026-07-23: "there could be a quick option — Misclick, mistake"). Tapping a chip
    // fills the box; they can still edit or add detail before confirming.
    const chips = (presets || []).length
      ? `<div class="confirm-presets" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${presets.map((p) => `<button type="button" class="btn confirm-chip" style="padding:6px 11px;font-size:13px;border-radius:999px" data-v="${esc(p)}">${esc(p)}</button>`).join("")}</div>`
      : "";
    wrap.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-msg" style="margin-bottom:12px">${esc(message)}</div>
        ${chips}
        <input class="confirm-input" type="text" placeholder="${esc(placeholder)}" value="${esc(defaultValue)}"
          style="width:100%;padding:10px 12px;border:1px solid var(--line,#ccc);border-radius:8px;font-size:15px;box-sizing:border-box;background:var(--panel,#fff);color:inherit" />
        <div class="confirm-actions" style="margin-top:14px">
          <button class="btn confirm-cancel">Cancel</button>
          <button class="btn ${danger ? "danger" : "primary"} confirm-ok">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector(".confirm-input");
    wrap.querySelectorAll(".confirm-chip").forEach((c) => { c.onclick = () => { input.value = c.dataset.v; try { input.focus(); } catch {} }; });
    requestAnimationFrame(() => { wrap.classList.add("show"); try { input.focus(); } catch {} });
    function esc2(e) { if (e.key === "Escape") close(null); else if (e.key === "Enter") submit(); }
    const close = (val) => {
      wrap.classList.remove("show");
      setTimeout(() => wrap.remove(), 200);
      document.removeEventListener("keydown", esc2);
      resolve(val);
    };
    const submit = () => { const v = input.value.trim(); if (required && !v) { input.focus(); return; } close(v); };
    wrap.__lfhClose = () => close(null); // hardware BACK cancels cleanly
    const openedAt = Date.now();
    const settled = () => Date.now() - openedAt > 350; // same speed-click guard as confirmDialog
    wrap.querySelector(".confirm-cancel").onclick = () => { if (settled()) close(null); };
    wrap.querySelector(".confirm-ok").onclick = () => { if (settled()) submit(); };
    wrap.onclick = (e) => { if (e.target === wrap && settled()) close(null); };
    document.addEventListener("keydown", esc2);
  });
}

// Quick-pick reason chips for bill-affecting actions (owner 2026-07-23). Free text still
// allowed; these just save typing for the common cases. Kept short so they fit on a phone.
const REASONS_REVERT = ["Mis-tap / misclick", "Wrong amount", "Refund to customer", "Paid by mistake", "Redo the bill"];
const REASONS_DELETE = ["Mis-tap / misclick", "Duplicate bill", "Test order", "Order cancelled", "Wrong table"];
const REASONS_CLOSE = ["Customer left unpaid", "Mis-tap / misclick", "On the house", "Staff meal", "Moved to another bill"];

// Manager (or any staff) raises an operational issue → the owner sees it on their
// Issues page and the admin sees it as a platform complaint. The modal (subject +
// details + optional PHOTO and live VOICE NOTE) is the shared widget in
// /panels/issue-raise.js, so all three staff panels raise tickets identically.
function openIssueModal() {
  if (window.LFH_ISSUE) LFH_ISSUE.open({ api, rid: PANEL_RID, notify: (m) => toast(m, "ok") });
}

// PER-TAB restaurant pin (ADMIN "view as" only): the wrapper page forwards ?rid=
// into this iframe; echoing it on EVERY API call pins this tab to that restaurant
// even if the admin opens another restaurant's panel later (the act-as cookie is
// browser-wide and used to shift this tab's data — owner bug, 2026-07-03). Empty
// for real staff logins; the server ignores it for them anyway.
const PANEL_RID = new URLSearchParams(location.search).get("rid") || "";
// ACTUAL-VIEW toggle (owner, 2026-07-28): ?view=real on an admin-view tab asks the server
// to answer whoami exactly as the REAL manager gets it (real limited access), so the admin
// can see the panel as their staff do. Per-tab like ?rid, echoed on every call; ignored
// server-side for real staff and for non-admin sessions.
const PANEL_VIEW_REAL = PANEL_RID && new URLSearchParams(location.search).get("view") === "real";
const ridQ = (path) => {
  if (!PANEL_RID) return path;
  const sep = () => (path.includes("?") ? "&" : "?");
  path += sep() + "rid=" + encodeURIComponent(PANEL_RID);
  if (PANEL_VIEW_REAL) path += "&view=real";
  return path;
};

// The restaurant THIS panel is currently showing: the admin "view as" URL pin if
// present, else the restaurant the board loaded (state.data.restaurant.id) once
// /all returns. Used to SCOPE per-restaurant device caches so one restaurant's
// floor can never first-paint with another restaurant's data on a shared device
// (cross-tenant leak fixed 2026-07-04 — the table-count skeleton hint below).
const panelRid = () => PANEL_RID || (state && state.data && state.data.restaurant && state.data.restaurant.id) || "";
// The device cache key for THIS restaurant's table count. Empty until we know the
// restaurant — callers then fall back to the neutral default skeleton (no leak).
const tableCountKey = () => { const r = panelRid(); return r ? "lfh_editor_table_count:" + r : ""; };

// api: the one helper every server call goes through. Give it the HTTP method
// ("GET"/"POST"/"PATCH"/"DELETE"), the path (e.g. "/orders"), and optionally a
// body object. It sends the request to our local server, reads back the JSON,
// and throws a clear error if the server reported a problem.
const _inflightGET = new Map(); // coalesce concurrent identical GETs into ONE network hit
async function api(method, path, body) {
  // Writes go through the offline outbox (sent now if online, else saved + replayed
  // on reconnect, at-most-once). GETs keep the in-flight-dedup fetch below.
  if (method !== "GET" && window.LFH_OUTBOX) {
    return window.LFH_OUTBOX.send({ base: "/api/editor", method, path: ridQ(path), body, panel: "editor" });
  }
  const url = "/api/editor" + ridQ(path);
  // On boot the page's initial load AND the realtime connect BOTH kick off the same reads
  // (/summary, /all, /platform), so a single load fired each 3–4× — ~470 KB of duplicate
  // JSON. Share one in-flight promise per identical GET url; it's cleared the instant it
  // settles, so every real poll tick afterwards still fetches fresh. (dedupe 2026-07-06)
  if (method === "GET" && _inflightGET.has(url)) return _inflightGET.get(url);
  const run = (async () => {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, // turn the body object into JSON text to send
    });
    const json = await res.json().catch(() => ({})); // read the reply; if it isn't JSON, fall back to {}
    if (!res.ok) throw new Error(json.error || res.statusText); // not OK? surface the server's error message
    return json;
  })();
  if (method === "GET") {
    _inflightGET.set(url, run);
    const cleanup = () => { if (_inflightGET.get(url) === run) _inflightGET.delete(url); };
    run.then(cleanup, cleanup); // drop the entry once settled (both fulfil + reject), no unhandled rejection
  }
  return run;
}

// ---------- data + list ----------
// loadAll: fetch everything from the server in one go (the /all endpoint), store
// it in state.data, flip the little "connected" indicator green, then redraw the
// left-hand list. Called on startup and after every save.
// Two rising-ticket guards stop an OLDER fetch from overwriting a NEWER one when
// several callers fire refreshes at once (a click, the realtime onEvent, a timer).
// loadAll() pulls the FULL state (menu + dishes + the whole live board), so it owns
// its OWN ticket — a 1-second order poll must never cancel a menu save's reload,
// which would leave the owner's just-saved dish looking stale. The live-board
// loaders (loadOrders / loadSessions / pollOrders) all rewrite the SAME
// orders/calls/board, so they share one ticket and the newest of THEM wins.
let allSeq = 0;
let dataSeq = 0;
let rtBootGraceUntil = 0; // window after boot during which the realtime CONNECT full-reconcile is skipped (boot already loaded everything) — see startOrderWatch
async function loadAll() {
  const seq = ++allSeq;
  const data = await api("GET", "/all");
  if (seq !== allSeq) return; // a newer loadAll started — drop this stale response
  // /all carries menu CONTENT only (items/categories/filters/settings) — it does
  // NOT include the live board. PRESERVE the orders/calls that the board loaders
  // (loadSessions/loadOrders/pollOrders) maintain on state.data; otherwise a loadAll
  // that lands AFTER them wipes the floor's orders. That happens on tab-wake (the
  // realtime wake fires BOTH the menu handler → loadAll AND the ops board poll): the
  // slow /all lands last, blanks state.data.orders, and a table with an order shows
  // "seated · no orders" until the next board poll repopulates it (~5-7s). (2026-06-18)
  const prev = state.data || {};
  state.data = { ...data, orders: prev.orders || [], calls: prev.calls || [] };
  // Name THIS restaurant in the top bar so staff (and the admin viewing as a tenant)
  // always know which restaurant they're managing. (owner 2026-06-26)
  const rr = data.restaurant || {};
  const restName = (rr.logo_text || (rr.name && rr.name.en) || rr.name_en || (state.data.settings || {}).restaurant_name || "").replace(/\*/g, "");
  const brandEl = document.getElementById("brandRest");
  if (brandEl) brandEl.textContent = restName ? "· " + restName : "";
  syncBanquetTab(); // Banquet tab follows the admin entitlement (mig 130)
  syncPlatformTab(); // Platform tab follows the platform/parcel modules (mig 209)
  syncInventoryTab(); // Inventory tab follows the inventory module (mig 221)
  $("#conn").textContent = "connected";
  $("#conn").className = "conn ok";
  renderList();
}

// records: the list of rows for whichever tab is currently open.
const records = () => state.data[state.tab] || [];
// recKey: the unique id of a row. Dishes/settings use "id"; everything else "slug".
const recKey = (r) => ((state.tab === "items" || state.tab === "general") ? r.id : r.slug);
// recLabel: the human-readable name to show for a row in the list.
const recLabel = (r) =>
  state.tab === "items"
    ? (r.title || r.slug || "(untitled)")
    : ((r.name && r.name.en) || r.slug || "(untitled)");

// nextSort: pick a sort_order for a brand-new row — one higher than the current
// highest, so new items land at the bottom of the list by default.
function nextSort() {
  const xs = records().map((r) => r.sort_order || 0);
  return (xs.length ? Math.max(...xs) : 0) + 1;
}

// renderList: draw the left-hand list of rows for the current tab. The special
// tabs (general/orders/tables) show a single fixed entry instead of a real list.
// renderCatFilter: the Dishes-tab category chips. Tap one to show only that
// category's dishes; "All" clears the filter. Hidden on every other tab.
function renderCatFilter() {
  const bar = $("#catFilter");
  if (!bar) return;
  if (state.tab !== "items") { bar.hidden = true; bar.innerHTML = ""; return; }
  bar.hidden = false;
  const cats = state.data.categories || [];
  const chip = (slug, label, icon, active) =>
    `<button type="button" class="cat-chip ${active ? "active" : ""}" data-cat="${esc(slug)}">${icon ? `<i class="fas ${esc(icon)}"></i> ` : ""}<span>${esc(label)}</span></button>`;
  let html = chip("", "All", "fa-layer-group", !state.catFilter);
  html += cats.map((c) => chip(c.slug, (c.name && c.name.en) || c.slug, c.icon, state.catFilter === c.slug)).join("");
  bar.innerHTML = html;
  bar.querySelectorAll(".cat-chip").forEach((b) => (b.onclick = () => {
    state.catFilter = b.dataset.cat; // "" for All
    renderCatFilter(); // restyle the active chip
    renderList();      // re-filter the dish list
  }));
}

// ── Search suggestions dropdown (2026-07-26) ──────────────────────────────────
// Mirrors the guest menu's search: as you type, a small dropdown of the top matching
// rows appears under the search box. Click one (or ↑/↓ + Enter) to open it in the
// editor. Name-starts-with ranks first, then any substring match (name/slug/id/
// category/tags); capped at 8. The left-hand list still filters underneath, unchanged.
// Only the record tabs (Dishes / Categories / Tags) have a searchable list, so it stays
// closed everywhere else. Works identically in the manager panel and the owner embed
// (same file, theme-var styling).
const SUGGEST_TABS = ["items", "categories", "filters"];
let _suggestMatches = []; // the rows currently shown (index-aligned with the DOM rows)
let _suggestIdx = -1;     // keyboard-highlighted row (-1 = none)
function suggestMatches(q) {
  const f = fold(q);
  if (!f) return [];
  return records()
    .map((r) => {
      const label = recLabel(r);
      const hay = fold([label, r.slug, r.id, r.category, Array.isArray(r.tags) ? r.tags.join(" ") : ""].filter(Boolean).join(" "));
      if (!hay.includes(f)) return null;
      return { r, label, starts: fold(label).startsWith(f) ? 0 : 1 };
    })
    .filter(Boolean)
    .sort((a, b) => a.starts - b.starts || a.label.localeCompare(b.label))
    .slice(0, 8);
}
function closeSuggest() {
  const box = document.getElementById("searchSuggest");
  if (box) { box.hidden = true; box.innerHTML = ""; }
  _suggestMatches = [];
  _suggestIdx = -1;
}
// openSuggestion: guard unsaved edits, then open the chosen row in the editor.
async function openSuggestion(m) {
  if (!m) return;
  if (!(await confirmDiscardIfDirty())) return;
  closeSuggest();
  selectRecord(m.r);
  renderList(); // move the row highlight in the list to match
}
function renderSearchSuggest() {
  const box = document.getElementById("searchSuggest");
  if (!box) return;
  const q = (state.search || "").trim();
  // No dropdown on non-record tabs, in multi-select mode, or with an empty box.
  if (!q || !SUGGEST_TABS.includes(state.tab) || state.bulkMode) { closeSuggest(); return; }
  _suggestMatches = suggestMatches(q);
  if (!_suggestMatches.length) {
    box.hidden = false;
    box.innerHTML = `<div class="ss-empty">No matches for “${esc(q)}”.</div>`;
    _suggestIdx = -1;
    return;
  }
  if (_suggestIdx >= _suggestMatches.length) _suggestIdx = -1;
  box.hidden = false;
  box.innerHTML = _suggestMatches.map((m, i) => {
    const r = m.r;
    let thumb;
    if (state.tab === "items") {
      thumb = r.image
        ? `<span class="ss-thumb" style="background-image:url('${esc(r.image)}')"></span>`
        : `<span class="ss-thumb"><i class="fas fa-utensils"></i></span>`;
    } else if (state.tab === "categories") {
      thumb = `<span class="ss-thumb" style="color:${esc(r.color || "#d4a574")}"><i class="fas ${esc(r.icon || "fa-tag")}"></i></span>`;
    } else {
      thumb = `<span class="ss-thumb">${esc(r.icon || "🏷️")}</span>`;
    }
    const no = state.tab === "items" && r.dish_no != null ? `<span class="ss-no">#${esc(String(r.dish_no))}</span>` : "";
    return `<div class="ss-row ${i === _suggestIdx ? "active" : ""}" role="option" data-idx="${i}">${thumb}<span class="ss-label">${esc(m.label)}</span>${no}</div>`;
  }).join("");
  // mousedown (not click) fires BEFORE the input's blur, so the pick lands before the
  // dropdown closes; preventDefault keeps focus off the row.
  box.querySelectorAll(".ss-row").forEach((row) => {
    row.onmousedown = (e) => { e.preventDefault(); openSuggestion(_suggestMatches[+row.dataset.idx]); };
  });
}
// paintSuggestActive: restyle the keyboard-highlighted row + keep it in view.
function paintSuggestActive() {
  const box = document.getElementById("searchSuggest");
  if (!box) return;
  box.querySelectorAll(".ss-row").forEach((row, i) => {
    const on = i === _suggestIdx;
    row.classList.toggle("active", on);
    if (on) row.scrollIntoView({ block: "nearest" });
  });
}

function renderList() {
  const ul = $("#list");
  ul.innerHTML = ""; // wipe the old list before drawing the new one
  // In Dishes multi-select, mark the list so mobile CSS makes it a normal vertical list
  // (its default phone layout is a horizontal swipe strip, which is awkward for ticking rows).
  ul.classList.toggle("list--bulk", state.bulkMode && state.tab === "items");
  if (state.tab === "general") {
    // Settings SECTIONS (owner, 2026-07-03): the sidebar lists the setting groups —
    // clicking one shows only that group's cards on the right (see formGeneral's
    // dispatcher). Same master-detail .list-item pattern as every other tab.
    for (const sec of SETTINGS_SECTIONS) {
      const li = el(`<li class="list-item${state.settingsSection === sec.id ? " active" : ""}" data-settings-section="${sec.id}">
        <div class="thumb"><i class="fas ${sec.icon}"></i></div>
        <div class="meta"><b>${sec.label}</b><small>${sec.sub}</small></div></li>`);
      li.onclick = () => {
        if (state.settingsSection === sec.id) return;
        state.settingsSection = sec.id;
        renderList();   // restyle the active row
        renderEditor(); // swap the cards on the right
      };
      ul.appendChild(li);
    }
    return;
  }
  if (state.tab === "orders") {
    // The left column IS the order navigation now — Today / Previous / Calls —
    // instead of a single redundant "Orders / incoming" card. Clicking a row
    // switches which set of order cards shows in the main area on the right.
    const { live, today, previous, callCount } = ordersBuckets();
    const view = ordersViewKey();
    const mk = (key, icon, label, count) => {
      const li = el(`<li class="list-item${view === key ? " active" : ""}" data-orders-view="${key}">
        <div class="thumb">${icon}</div>
        <div class="meta"><b>${label}</b></div>
        ${count ? `<span class="ord-nav-count">${count}</span>` : ""}
      </li>`);
      li.onclick = () => {
        state.ordersView = key;
        lsSet("lfh_editor_ordersview", key); // remember across refresh
        renderList();   // re-highlight the chosen row
        renderEditor(); // redraw the cards on the right
      };
      return li;
    };
    ul.appendChild(mk("live", '<i class="fas fa-circle" style="color:#7ec88a"></i>', "Live", live.length));
    ul.appendChild(mk("daybills", '<i class="fas fa-calendar-day"></i>', "Today", today.length));
    ul.appendChild(mk("previous", '<i class="fas fa-receipt"></i>', "Previous", previous.length));
    // Pay later (mig 166): the parked-bills book, grouped by person. Count = people
    // with something outstanding (from the last book fetch; refreshed on open).
    if (tagActionAllowed("khata")) ul.appendChild(mk("khata", "📒", "Pay Later", (state.khataBook && state.khataBook.customers || []).length));
    ul.appendChild(mk("calls", "🔔", "Calls", callCount));
    return;
  }
  if (state.tab === "tables" || state.tab === "banquet") {
    // Nothing in the sidebar for Tables/Banquet — it's hidden (see setTab's
    // .no-sidebar); the content uses the full width.
    return;
  }
  if (state.tab === "features") {
    ul.appendChild(el(`<li class="list-item active"><div class="thumb"><i class="fas fa-toggle-on"></i></div><div class="meta"><b>Feature switches</b><small>turn things on/off</small></div></li>`));
    return;
  }
  if (state.tab === "dash") {
    // The left column IS the dashboard's range sub-nav (Today / 30 days / Year) —
    // same pattern as Orders — instead of a second menu inside the content.
    const mk = (key, icon, label, sub) => {
      const li = el(`<li class="list-item${dashRange === key ? " active" : ""}" data-dash-range="${key}">
        <div class="thumb">${icon}</div>
        <div class="meta"><b>${label}</b><small>${sub}</small></div>
      </li>`);
      li.onclick = () => { dashRange = key; try { localStorage.setItem("lfh_dash_range", key); } catch {} renderList(); loadDashboard(); };
      return li;
    };
    ul.appendChild(mk("today", '<i class="fas fa-bolt"></i>', "Today", "live snapshot"));
    ul.appendChild(mk("30d", '<i class="fas fa-calendar-days"></i>', "30 days", "trends"));
    ul.appendChild(mk("year", '<i class="fas fa-chart-line"></i>', "Year", "12 months"));
    return;
  }
  if (state.tab === "log") {
    // The Log tab's two views live in the LEFT SIDEBAR (like Orders) — not a top
    // toggle. Clicking a row switches the main panel between the guest log and
    // the staff operation log.
    const v = state.logView || "customers";
    const mk = (key, icon, label, sub) => {
      const li = el(`<li class="list-item${v === key ? " active" : ""}" data-logview-side="${key}">
        <div class="thumb">${icon}</div>
        <div class="meta"><b>${label}</b><small>${sub}</small></div>
      </li>`);
      li.onclick = () => {
        state.logView = key;
        lsSet("lfh_editor_logview", key); // remember across refresh
        if (key === "operations") loadOplog(); // fetch (it re-renders when ready)
        renderList();   // re-highlight the chosen row
        renderEditor(); // redraw the main panel on the right
      };
      return li;
    };
    ul.appendChild(mk("customers", '<i class="fas fa-users"></i>', "Customer log", "guests & visits"));
    ul.appendChild(mk("operations", '<i class="fas fa-list-check"></i>', "Operation log", "staff actions"));
    return;
  }
  const q = fold(state.search); // accent-insensitive
  // On the Dishes tab, also narrow to the chosen category (if any).
  const catF = state.tab === "items" ? state.catFilter : "";
  records()
    // keep only dishes in the chosen category (Dishes tab; "" = All)
    .filter((r) => !catF || r.category === catF)
    // keep only rows that match the search box — search the VISIBLE fields (name, slug, id,
    // category, tags), NOT the raw JSON (which matched hidden image/GLB URLs and surfaced
    // unrelated rows — fixed 2026-07-06).
    .filter((r) => {
      if (!q) return true;
      const hay = fold([recLabel(r), r.slug, r.id, r.category, Array.isArray(r.tags) ? r.tags.join(" ") : ""].filter(Boolean).join(" "));
      return hay.includes(q);
    })
    .forEach((r) => {
      const isItems = state.tab === "items";
      const bulk = state.bulkMode && isItems;            // multi-select mode (Dishes only)
      const checked = bulk && state.bulkSel.has(r.id);
      const active = !bulk && state.sel && !state.isNew && recKey(r) === recKey(state.sel); // row being edited
      const hidden = state.tab !== "items" && r.active === false; // greyed-out "hidden from menu" rows
      const soldOut = isItems && Array.isArray(r.tags) && r.tags.includes("sold-out"); // 86'd dish
      // Build the little thumbnail on the left of each list row: a photo for
      // dishes, a coloured icon for categories, an emoji for filters.
      let thumb;
      if (state.tab === "items") {
        thumb = r.image
          ? `<div class="thumb" style="background-image:url('${esc(r.image)}')"></div>`
          : `<div class="thumb"><i class="fas fa-utensils"></i></div>`;
      } else if (state.tab === "categories") {
        thumb = `<div class="thumb" style="color:${esc(r.color || "#d4a574")}"><i class="fas ${esc(r.icon || "fa-tag")}"></i></div>`;
      } else {
        thumb = `<div class="thumb">${esc(r.icon || "🏷️")}</div>`;
      }
      const li = el(
        `<li class="list-item ${active ? "active" : ""} ${checked ? "bulk-on" : ""} ${hidden ? "hidden-row" : ""} ${soldOut ? "row-soldout" : ""}">
          ${bulk ? `<span class="bulk-cb ${checked ? "on" : ""}" aria-hidden="true">${checked ? "✓" : ""}</span>` : ""}
          ${thumb}
          <div class="meta">
            <b>${esc(recLabel(r))}${state.tab === "items" && r.dish_no != null ? ` <span class="dish-no">#${esc(String(r.dish_no))}</span>` : ""}${soldOut ? '<span class="badge-off">sold out</span>' : ""}${hidden ? '<span class="badge-off">hidden</span>' : ""}</b>
            <small>${esc(recKey(r) || "")}</small>
          </div>
        </li>`
      );
      li.onclick = async () => {
        if (bulk) { // toggle this dish's selection instead of opening it
          if (state.bulkSel.has(r.id)) state.bulkSel.delete(r.id); else state.bulkSel.add(r.id);
          renderList();
          return;
        }
        // Guard unsaved edits before switching rows (see confirmDiscardIfDirty).
        if (!(await confirmDiscardIfDirty())) return;
        // INSTANT feedback: highlight this row right now, before any heavy
        // work, so the click never feels ignored (it used to take ~1s).
        ul.querySelectorAll(".list-item.active").forEach((x) => x.classList.remove("active"));
        li.classList.add("active");
        selectRecord(r); // then open it in the editor on the right
      };
      ul.appendChild(li);
    });
  // Dishes multi-select: a sticky action bar at the top of the list.
  if (state.bulkMode && state.tab === "items") {
    const n = state.bulkSel.size;
    ul.insertAdjacentHTML("afterbegin", `<li class="bulk-bar">
      <span class="bulk-count">${n} selected</span>
      <span class="bulk-acts">
        <button class="btn small" type="button" data-bulk="soldout" ${n ? "" : "disabled"}>🚫 Sold out</button>
        <button class="btn small" type="button" data-bulk="avail" ${n ? "" : "disabled"}>✅ Available</button>
        <button class="btn small danger" type="button" data-bulk="delete" ${n ? "" : "disabled"}>🗑 Delete</button>
        <button class="btn small" type="button" data-bulk="cancel">Done</button>
      </span></li>`);
    const on = (act, fn) => { const b = ul.querySelector(`[data-bulk="${act}"]`); if (b) b.onclick = fn; };
    on("soldout", () => bulkSoldOut(true));
    on("avail", () => bulkSoldOut(false));
    on("delete", bulkDeleteDishes);
    on("cancel", () => { state.bulkMode = false; state.bulkSel.clear(); syncBulkBtn(); renderList(); });
  }
}
// syncBulkBtn: keep the sidebar "Select" button in step with bulk mode (shown on Dishes only).
function syncBulkBtn() {
  const b = document.getElementById("bulkBtn");
  if (!b) return;
  b.hidden = state.tab !== "items";
  b.classList.toggle("primary", state.bulkMode);
  b.textContent = state.bulkMode ? "✓ Done" : "☑︎ Select";
}
// bulkSoldOut: add/remove the "sold-out" tag on every selected dish (partial {id,tags} write).
async function bulkSoldOut(makeSoldOut) {
  const ids = [...state.bulkSel];
  if (!ids.length) return;
  let done = 0;
  for (const id of ids) {
    const dish = (state.data.items || []).find((d) => d.id === id);
    if (!dish) continue;
    const tags = Array.isArray(dish.tags) ? dish.tags.slice() : [];
    const has = tags.includes("sold-out");
    if (makeSoldOut === has) continue; // already in the wanted state
    if (makeSoldOut) tags.push("sold-out"); else tags.splice(tags.indexOf("sold-out"), 1);
    try { await api("POST", "/items", { id, tags }); dish.tags = tags; done++; } catch (e) { /* skip one, keep going */ }
  }
  toast(`${done} dish${done === 1 ? "" : "es"} marked ${makeSoldOut ? "sold-out" : "available"}`, "ok");
  renderList();
}
// bulkDeleteDishes: delete every selected dish, with a single confirm + a bulk Undo.
async function bulkDeleteDishes() {
  const ids = [...state.bulkSel];
  if (!ids.length) return;
  if (!(await confirmDialog(`Delete ${ids.length} dish${ids.length === 1 ? "" : "es"}?`, "Delete"))) return;
  const snaps = (state.data.items || []).filter((d) => ids.includes(d.id)).map((d) => ({ ...d }));
  let done = 0;
  for (const id of ids) { try { await api("DELETE", "/items/" + encodeURIComponent(id)); done++; } catch (e) { /* keep going */ } }
  state.bulkMode = false; state.bulkSel.clear(); syncBulkBtn();
  await loadAll(); renderList(); renderEditor();
  const undoDelete = async () => {
    let r = 0;
    for (const s of snaps) { try { const p = { ...s }; delete p.created_at; delete p.updated_at; p.__create = true; await api("POST", "/items", p); r++; } catch (e) {} }
    toast(`Restored ${r}`, "ok");
    await loadAll(); renderList(); renderEditor();
  };
  if (window.LFH_UNDO) LFH_UNDO.show({ message: `Deleted ${done} dish${done === 1 ? "" : "es"}`, sub: "Tap undo to bring them back", icon: "🗑️", seconds: 6, onUndo: undoDelete });
  else toast(`Deleted ${done} dish${done === 1 ? "" : "es"}`, "ok", { label: "Undo", fn: undoDelete }, 8000);
}

// ---------- select / new ----------
// blankName: an empty translations object, one empty string per language.
function blankName() {
  const o = {};
  LANGS.forEach(([c]) => (o[c] = ""));
  return o;
}
// blank: a fresh, empty record with sensible defaults for the given tab — what
// "+ New" starts you off with before you fill anything in.
function blank(tab) {
  if (tab === "items")
    return {
      id: "", slug: "", title: "", price: "", image: "",
      category: (state.data.categories[0] || {}).slug || "",
      veg: false, is4d: false, open_price: false, model_folder: "",
      model_small_url: "", model_optimized_url: "",
      description: "", long_description: "", rating: "", time: "", search_alias: "",
      nutrition: { calories: "", protein: "", carbs: "", sugar: "" },
      ingredients: [], reviews: [], tags: [], allergens: [], options: [],
      sort_order: nextSort(),
    };
  if (tab === "categories")
    return { slug: "", name: blankName(), icon: "fa-utensils", color: "#d4a574", sort_order: nextSort(), active: true };
  return { slug: "", name: blankName(), icon: "", sort_order: nextSort(), active: true };
}

// selectRecord: open an existing row for editing. We edit a CLONE so changes
// aren't saved to the real data until the user hits Save.
function selectRecord(r) {
  state.sel = clone(r);
  state.isNew = false;
  state._snapPending = true; // re-baseline the unsaved-changes guard for this record
  // No renderList() here: rebuilding the whole sidebar on every click was a
  // big part of the lag, and the click handler already moved the highlight.
  renderEditor();
}
// newRecord: start a fresh, blank row for the current tab.
function newRecord() {
  state.sel = blank(state.tab);
  state.isNew = true;
  state._snapPending = true;
  renderList();
  renderEditor();
}

// ---- Unsaved-changes guard (Editor / Settings) ----
// state.sel is a throwaway CLONE the form mutates in place; nothing is saved until you
// hit Save. Previously, clicking another row / + New / a tab (or refreshing/closing the
// tab) silently threw the clone away with NO warning — hours of edits could vanish.
// We snapshot the pristine record right AFTER each fresh render (so render-time autofill
// is part of the baseline, not mistaken for a user edit), then compare before any
// user-initiated navigation. In-form rebuilds (add/remove option rows via handleAction)
// re-render WITHOUT setting _snapPending, so those edits correctly stay "dirty".
function snapshotEditor() { state.selPristine = state.sel ? JSON.stringify(state.sel) : null; }
function editorDirty() {
  if (!state.sel || state.selPristine == null) return false;
  try { return JSON.stringify(state.sel) !== state.selPristine; } catch { return false; }
}
async function confirmDiscardIfDirty() {
  if (!editorDirty()) return true;
  return await confirmDialog("You have unsaved changes here. Leave without saving them?", "Leave without saving");
}

// ---------- field builders ----------
// These little helpers each return a chunk of HTML for one form control, so the
// big forms below can stay readable. The "path" they're given (e.g. "title" or
// "nutrition.calories") is stored on the input as data-path; when the user types,
// bindEditor() reads that path and uses setPath() to update state.sel.

// tf: a single-line text (or number) input field with a label.
function tf(label, path, val, opts = {}) {
  return `<div class="field ${opts.span ? "span-2" : ""}">
    <label>${esc(label)}</label>
    <input type="${opts.type || "text"}" data-path="${path}" value="${esc(val ?? "")}"
      ${opts.min != null ? `min="${opts.min}"` : ""} ${opts.max != null ? `max="${opts.max}"` : ""} ${opts.step != null ? `step="${opts.step}"` : ""}
      ${opts.disabled ? "disabled" : ""} placeholder="${esc(opts.ph || "")}" />
    ${opts.hint ? `<span class="hint">${esc(opts.hint)}</span>` : ""}
  </div>`;
}
// ta: a multi-line text area (for longer descriptions, review text, etc).
function ta(label, path, val, opts = {}) {
  return `<div class="field ${opts.span ? "span-2" : ""}">
    <label>${esc(label)}</label>
    <textarea data-path="${path}" placeholder="${esc(opts.ph || "")}">${esc(val ?? "")}</textarea>
  </div>`;
}
// toggle: an on/off switch (a styled checkbox), e.g. "Vegetarian" or "4D mode".
function toggle(label, path, val) {
  return `<label class="toggle"><input type="checkbox" data-path="${path}" ${val ? "checked" : ""}/>
    <span class="track"></span><span>${esc(label)}</span></label>`;
}
// lbl: a small standalone caption above a group of controls.
function lbl(text) {
  return `<label style="font-size:12px;color:var(--muted);font-weight:600;display:block;margin-bottom:8px">${esc(text)}</label>`;
}
// triSel: a tri-state permission select (Off / On / On-with-manager-PIN). Saves via
// data-path like every other settings field. Used for the tablet billing controls.
function triSel(label, path, val) {
  const v = val || "off";
  return `<div class="field"><label>${esc(label)}</label>
    <select data-path="${path}">
      <option value="off" ${v === "off" ? "selected" : ""}>Off — hidden from waiter</option>
      <option value="on"  ${v === "on" ? "selected" : ""}>On — waiter can do it</option>
      <option value="pin" ${v === "pin" ? "selected" : ""}>On · needs manager PIN</option>
    </select></div>`;
}

// catSelect: a drop-down listing every category, used to pick a dish's category.
function catSelect(val) {
  const opts = state.data.categories
    .map((c) => `<option value="${esc(c.slug)}" ${c.slug === val ? "selected" : ""}>${esc((c.name && c.name.en) || c.slug)}</option>`)
    .join("");
  return `<div class="field"><label>Category</label>
    <select data-path="category"><option value="">—</option>${opts}</select></div>`;
}
// tagChips: a row of clickable "chips", one per filter tag. Chips the dish
// already has are highlighted ("on"); tapping one toggles it.
function tagChips(tags) {
  tags = tags || [];
  const chips = state.data.filters
    .map((f) => `<span class="chip ${tags.includes(f.slug) ? "on" : ""}" data-action="toggleTag" data-arg="${esc(f.slug)}">${esc(f.icon || "")} ${esc((f.name && f.name.en) || f.slug)}</span>`)
    .join("");
  return `<div class="chips">${chips || '<span class="hint">No filters yet — make some in the Filters tab.</span>'}</div>`;
}
// ingredientRows: one editable row per ingredient (emoji + name + delete), plus
// an "+ Ingredient" button to add another.
function ingredientRows(it) {
  const rows = (it.ingredients || [])
    .map((ing, i) => `<div class="row-item">
      <input class="narrow" data-path="ingredients.${i}.emoji" value="${esc(ing.emoji || "")}" placeholder="🍞"/>
      <input data-path="ingredients.${i}.name" value="${esc(ing.name || "")}" placeholder="Ingredient name"/>
      <button class="icon-btn" data-action="rmIngredient" data-arg="${i}"><i class="fas fa-trash"></i></button>
    </div>`).join("");
  return `<div class="rows">${rows}</div><button class="btn small" data-action="addIngredient" style="margin-top:10px">+ Ingredient</button>`;
}
// reviewRows: one editable row per customer review (name + star rating + text).
function reviewRows(it) {
  const rows = (it.reviews || [])
    .map((rv, i) => `<div class="row-item">
      <input data-path="reviews.${i}.name" value="${esc(rv.name || "")}" placeholder="Name" style="max-width:150px"/>
      <input class="narrow" type="number" min="1" max="5" data-path="reviews.${i}.rating" value="${esc(rv.rating ?? 5)}"/>
      <textarea data-path="reviews.${i}.text" placeholder="Review text">${esc(rv.text || "")}</textarea>
      <button class="icon-btn" data-action="rmReview" data-arg="${i}"><i class="fas fa-trash"></i></button>
    </div>`).join("");
  return `<div class="rows">${rows}</div><button class="btn small" data-action="addReview" style="margin-top:10px">+ Review</button>`;
}

// ---------- forms ----------
// Customization options editor (Size, Milk, Extras… — each choice can add to price).
function optionsHtml(it) {
  const groups = it.options || [];
  const groupsHtml = groups.map((g, i) => `
    <div class="opt-group">
      <div class="grid cols-2">
        ${tf("Group name", `options.${i}.name`, g.name, { ph: "Size" })}
        <div class="field"><label>Guest can…</label>
          <select data-path="options.${i}.type">
            <option value="single" ${g.type !== "multi" ? "selected" : ""}>Pick one</option>
            <option value="multi" ${g.type === "multi" ? "selected" : ""}>Pick any</option>
          </select>
        </div>
      </div>
      <div class="opt-choices">
        ${(g.choices || []).map((c, j) => `
          <div class="opt-choice">
            ${tf("Choice", `options.${i}.choices.${j}.label`, c.label, { ph: "Large" })}
            ${tf("Price +", `options.${i}.choices.${j}.price`, c.price, { type: "number", ph: "0" })}
            <button class="btn small danger" data-action="rmOptChoice" data-arg="${i}.${j}">✕</button>
          </div>`).join("")}
        <button class="btn small" data-action="addOptChoice" data-arg="${i}">+ Choice</button>
      </div>
      <button class="btn small danger" data-action="rmOptGroup" data-arg="${i}" style="margin-top:10px">Remove group</button>
    </div>`).join("");
  return `<div class="card"><h3>Customization options</h3>
    <span class="hint">Let guests customise this dish (Size, Milk, Extras…). Each choice's price adds to the base. Leave empty for none.</span>
    <div class="opt-groups">${groupsHtml}</div>
    <button class="btn small primary" data-action="addOptGroup" style="margin-top:12px">+ Add option group</button>
  </div>`;
}

// formItems: builds the entire right-hand edit form for ONE dish — basics,
// image, 3D models, diet/filters, allergens, options, details, nutrition,
// ingredients and reviews. It's just one big HTML string assembled from the
// small field helpers above.
function formItems(it) {
  return `
  <div class="card"><h3>Basics</h3>
    <div class="grid cols-2">
      ${tf("Title", "title", it.title, { span: true })}
      ${tf("ID (permanent)", "id", it.id, { disabled: !state.isNew, ph: state.isNew ? "auto from title" : "", hint: state.isNew ? "Leave blank — we'll make it from the title." : "Unique. Can't change later." })}
      ${tf("Slug (URL)", "slug", it.slug, { ph: state.isNew ? "auto from title" : "gourmet-burger", hint: state.isNew ? "Leave blank to auto-fill from the title." : "" })}
      ${tf("Price", "price", it.price, { ph: "12.99" })}
      ${catSelect(it.category)}
      ${tf("Sort order", "sort_order", it.sort_order, { type: "number" })}
    </div>
    <button type="button" class="avail-toggle ${(it.tags || []).includes("sold-out") ? "off" : "on"}" data-action="toggleSoldOut">
      ${(it.tags || []).includes("sold-out")
        ? "🚫 Not available right now — tap to make available"
        : "✅ Available — tap to mark not available"}
    </button>
    <div style="margin-top:14px">${toggle("💰 Open price — staff type the price at order time", "open_price", it.open_price)}</div>
    <span class="hint">For as-per-MRP / market-price items (a soft-drink can, mineral water…). When on, the tablet shows “Set price” and the waiter enters the amount each time — the Price field above is ignored, and the dish is hidden from the guest menu.</span>
  </div>

  <div class="card"><h3>Image</h3>
    <div class="grid cols-2" style="align-items:start">
      ${tf("Image URL", "image", it.image, { ph: "https://…" })}
      <img id="imgPreview" class="preview-img" src="${esc(it.image || "")}" alt="" style="opacity:${it.image ? 1 : 0.2}"/>
    </div>
  </div>

  ${(XRAY_WHO && XRAY_WHO.actor === "admin") ? `<div class="card"><h3>3D · 4D</h3>
    <div style="margin-bottom:14px">${toggle("4D mode — cyan glow outline + 3D preview", "is4d", it.is4d)}</div>
    <div class="grid cols-2">
      ${tf("Model folder", "model_folder", it.model_folder)}
      <div></div>
      ${tf("GLB — small (fast load)", "model_small_url", it.model_small_url, { span: true, ph: "https://…/model_small.glb" })}
      ${tf("GLB — optimized (full quality)", "model_optimized_url", it.model_optimized_url, { span: true, ph: "https://…/model-optimized.glb" })}
    </div>
    <span class="hint">4D only appears on the menu when both GLB URLs are filled.</span>
  </div>` : ""}

  <div class="card"><h3>Diet & filters</h3>
    <div style="margin-bottom:16px">${toggle("Vegetarian (green leaf icon)", "veg", it.veg)}</div>
    ${lbl("Filter tags")}
    ${tagChips(it.tags)}
  </div>

  <div class="card"><h3>Allergens</h3>
    ${lbl("Tap the allergens this dish contains (shown on the dish page + checkout)")}
    <div class="chips">
      ${ALLERGENS.map((a) => `<span class="chip ${(it.allergens || []).includes(a.slug) ? "on" : ""}" data-action="toggleAllergen" data-arg="${a.slug}">${esc(a.label)}</span>`).join("")}
    </div>
  </div>

  ${optionsHtml(it)}

  <div class="card"><h3>Details</h3>
    <div class="grid cols-2">
      ${tf("Rating", "rating", it.rating, { ph: "4.8" })}
      ${tf("Prep time", "time", it.time, { ph: "25-30 min" })}
      ${ta("Short description", "description", it.description, { span: true })}
      ${ta("Long description", "long_description", it.long_description, { span: true })}
      ${tf("Search keywords", "search_alias", it.search_alias, { span: true, hint: "Hidden words guests can search by, comma-separated (e.g. caesar, healthy, bowl)." })}
    </div>
  </div>

  <div class="card"><h3>Nutrition</h3>
    <div class="grid cols-2">
      ${tf("Calories", "nutrition.calories", (it.nutrition || {}).calories)}
      ${tf("Protein", "nutrition.protein", (it.nutrition || {}).protein)}
      ${tf("Carbs", "nutrition.carbs", (it.nutrition || {}).carbs)}
      ${tf("Sugar (shown on dish page)", "nutrition.sugar", (it.nutrition || {}).sugar)}
    </div>
  </div>

  <div class="card"><h3>Ingredients</h3>${ingredientRows(it)}</div>
  <div class="card"><h3>Reviews</h3>${reviewRows(it)}</div>`;
}

// formCategories: the edit form for one category (icon, colour, sort order,
// show/hide, and a name box per language).
function formCategories(c) {
  return `
  <div class="card"><h3>Category</h3>
    <div class="grid cols-2">
      ${tf("Slug (permanent)", "slug", c.slug, { disabled: !state.isNew, hint: "Used on dishes. Can't change later." })}
      ${tf("Sort order", "sort_order", c.sort_order, { type: "number" })}
      ${tf("Icon (FontAwesome class)", "icon", c.icon, { ph: "fa-burger" })}
      <div class="field"><label>Colour</label>
        <input type="color" data-path="color" value="${esc(c.color || "#d4a574")}" style="height:40px;padding:4px"/></div>
    </div>
    <div style="display:flex;gap:18px;align-items:center;margin-top:16px">
      <div id="iconPreview" class="icon-preview" style="color:${esc(c.color || "#d4a574")}"><i class="fas ${esc(c.icon || "fa-tag")}"></i></div>
      ${toggle("Show on menu", "active", c.active !== false)}
    </div>
    <span class="hint">Icon names: fontawesome.com (free solid). Type just the class, e.g. fa-pizza-slice.</span>
  </div>
  <div class="card"><h3>Name — one box per language</h3>
    <div class="grid cols-2">
      ${LANGS.map(([code, label]) => tf(label, `name.${code}`, (c.name || {})[code])).join("")}
    </div>
    <span class="hint">English is the fallback if a language is left empty.</span>
  </div>`;
}

// formFilters: the edit form for one filter/tag (emoji, sort order, names),
// plus the "which dishes carry this tag" picker below it.
function formFilters(f) {
  return `
  <div class="card"><h3>Filter</h3>
    <div class="grid cols-2">
      ${tf("Slug (permanent)", "slug", f.slug, { disabled: !state.isNew, hint: "Used in dish tags, e.g. vegan, spicy." })}
      ${tf("Sort order", "sort_order", f.sort_order, { type: "number" })}
      ${tf("Icon / emoji", "icon", f.icon, { ph: "🌿" })}
      <div class="field"><label>Preview</label>
        <div style="display:flex;gap:18px;align-items:center">
          <div id="iconPreview" class="icon-preview">${esc(f.icon || "🏷️")}</div>
          ${toggle("Show on menu", "active", f.active !== false)}
        </div></div>
    </div>
  </div>
  <div class="card"><h3>Name — one box per language</h3>
    <div class="grid cols-2">
      ${LANGS.map(([code, label]) => tf(label, `name.${code}`, (f.name || {})[code])).join("")}
    </div>
  </div>
  ${filterMembersHtml(f)}`;
}

// Manage which existing dishes carry this tag. This is how you add already-listed
// dishes to "Chef's Special" (or any tag) without recreating them — a dish can be
// in its normal category AND tagged here at the same time.
function filterMembersHtml(f) {
  if (state.isNew || !f.slug) return "";
  const label = (f.name && f.name.en) || f.slug;
  const items = state.data.items || [];
  const selected = items.filter((it) => (it.tags || []).includes(f.slug)).length;
  const rows = items
    .map((it) => {
      const on = (it.tags || []).includes(f.slug);
      const hay = `${(it.title || "").toLowerCase()} ${it.category || ""}`;
      return `<label class="memb-row${on ? " on" : ""}" data-memb="${esc(hay)}">
        <input type="checkbox" data-action="toggleMember" data-arg="${esc(it.id)}"${on ? " checked" : ""}>
        <span class="memb-title">${esc(it.title || it.slug)}</span>
        <span class="memb-cat">${esc(it.category || "")}</span>
      </label>`;
    })
    .join("");
  return `<div class="card"><h3>Dishes in "${esc(label)}"
      <span class="sub">· <b id="membCount">${selected}</b> selected · tick to add an existing dish, untick to remove</span></h3>
    <input class="memb-search" id="membSearch" placeholder="Search dishes…" />
    <div class="memb-list">${rows}</div>
  </div>`;
}

// loadStaffTeam: fetch this manager's own team ONCE (cookies carry the session —
// same-origin fetch, no auth wiring needed). A 403 (owner hasn't granted manage_staff)
// is a NORMAL outcome here, not an error — shown as a quiet inline message instead of
// a toast. Re-renders Settings when the real data lands (mirrors the floor's
// skeleton-then-real pattern, just without a shimmer since this is a short list).
async function loadStaffTeam() {
  try {
    const r = await fetch(ridQ("/api/owner/staff"), { cache: "no-store" }); // ridQ: keep the admin's per-tab restaurant pin
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { state.staffDenied = d.error || "Couldn't load your team."; state.staffTeam = []; state.staffRestaurantId = null; }
    else {
      state.staffDenied = null; state.staffTeam = d.staff || [];
      // Default the "Add" target to the restaurant THIS panel is pinned to (admin view-as
      // or a pinned owner), not just the alphabetically-first one the server returned —
      // otherwise "+ Add" could create a login on the wrong restaurant. Falls back to the
      // first (a plain manager only ever has their own restaurant anyway).
      const rlist = d.restaurants || [];
      state.staffRestaurantId = ((PANEL_RID && rlist.some((x) => x.id === PANEL_RID)) ? PANEL_RID : rlist[0]?.id) || null;
      state.staffActor = d.actor || "manager";
    }
  } catch (e) { state.staffDenied = "Couldn't reach the server."; }
  state.staffLoaded = true;
  if (state.tab === "general") renderEditor();
}

// staffCall: POST/PATCH/DELETE to /api/owner/staff, then always reload the team so the
// list reflects the server's truth (never trust the optimistic local edit alone — a
// staff list is small, so a full reload after each action is cheap and simplest).
async function staffCall(init) {
  state.staffBusy = true;
  try {
    const r = await fetch(ridQ("/api/owner/staff"), { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
    return d;
  } finally { state.staffBusy = false; }
}

// userSettingCardHtml: the "User setting" card — lets a manager (only if their owner
// has granted manage_staff) add/manage their tablet · kitchen · manager logins right
// from Settings, instead of needing the separate Owner panel. Reuses /api/owner/staff
// exactly like the owner's own "Staff & powers" page — the server enforces
// manage_staff, this card just renders whatever it says.
function userSettingCardHtml() {
  if (!state.staffLoaded) {
    return `<div class="card"><h3>User setting</h3><p class="muted" style="font-size:13px;margin:0">Loading…</p></div>`;
  }
  if (state.staffDenied) {
    return `<div class="card"><h3>User setting</h3><p style="color:var(--muted);font-size:13px;margin:0;line-height:1.5">${esc(state.staffDenied)}</p></div>`;
  }
  // Hierarchy (owner, 2026-07-03): a MANAGER manages only kitchen + tablet — the
  // server already filters the list and refuses anything else; this just keeps the
  // dropdowns honest. Owner/admin actors still get the full set.
  const ROLES = state.staffActor === "manager" ? ["kitchen", "tablet"] : ["manager", "kitchen", "tablet"];
  const reveal = state.staffReveal
    ? `<div class="fc-card" style="border-color:var(--green);display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div><b>New password for ${esc(state.staffReveal.name)}</b><div class="muted small">Copy it now — it can't be shown again.</div></div>
        <code style="font-family:ui-monospace,monospace;font-weight:700;padding:5px 10px;border-radius:8px;background:color-mix(in srgb, var(--gold) 14%, transparent);letter-spacing:.03em">${esc(state.staffReveal.password)}</code>
        <button class="btn small" id="usrRevealDone" style="margin-left:auto">Done</button>
      </div>` : "";
  const rows = state.staffTeam.length
    ? state.staffTeam.map((u) => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:9px 10px;border-radius:9px;background:var(--panel-2)${u.active ? "" : ";opacity:.6"}">
        <div style="display:flex;align-items:center;gap:9px;min-width:0">
          <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.03em;padding:3px 8px;border-radius:999px;background:color-mix(in srgb, var(--text) 8%, transparent);color:var(--text)">${esc(u.role)}</span>
          <span style="font-weight:700;font-size:13.5px">${esc(u.name || u.username)}</span>
          ${u.active ? "" : `<span style="font-size:10.5px;color:var(--red);font-weight:700">disabled</span>`}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          <select data-staff-role="${esc(u.id)}" style="font-size:11.5px;font-weight:700;padding:5px 9px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--text)">
            ${ROLES.map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}
          </select>
          <button class="btn small" data-staff-resetpw="${esc(u.id)}">Reset password</button>
          <button class="btn small" data-staff-toggle="${esc(u.id)}" data-active="${u.active ? "1" : "0"}">${u.active ? "Disable" : "Enable"}</button>
          <button class="btn small danger" data-staff-del="${esc(u.id)}">Remove</button>
        </div>
      </div>`).join("")
    : `<div class="sx-empty">No staff yet — add the first below.</div>`;
  return `<div class="card"><h3>User setting</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      ${state.staffActor === "manager"
        ? "Add and manage <b>tablet</b> and <b>kitchen</b> logins for this restaurant. Manager accounts are managed by the owner."
        : "Add and manage tablet, kitchen, and manager logins for this restaurant — the same team the owner sees in Staff &amp; powers."}
    </p>
    ${reveal}
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">${rows}</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;padding-top:12px;border-top:1px solid var(--line)">
      <input class="sx-input" id="usrNewName" placeholder="Username (their login)" style="flex:1 1 150px"/>
      <select id="usrNewRole" style="flex:0 0 auto;padding:9px 12px;border-radius:8px;border:1px solid var(--line);background:var(--panel-2);color:var(--text)">${ROLES.map((r) => `<option value="${r}">${r}</option>`).join("")}</select>
      <input class="sx-input" id="usrNewPassword" placeholder="Password (blank = auto)" style="flex:1 1 150px"/>
      <button class="btn primary" id="usrAddStaff">+ Add</button>
    </div>
  </div>`;
}

// tableLabel(t): what staff panels CALL table t — its display name (mig 131) with
// the number kept alongside, else the plain "Table t". Display-only; every id/bill
// still uses the number.
function tableLabel(t) {
  const nm = (((state.data.settings || {}).table_names || {})[String(t)] || "").trim();
  return nm ? `${nm} (T${t})` : `Table ${t}`;
}

// tableSeatingCardHtml: the "Table setting" card — how many people can sit at EACH
// table (owner request, 2026-07-01). One small number input per table, backed by the
// table_seats JSONB column (migration 111) keyed by table number. Falls back to 4 when
// a table has no entry yet — matches the app-wide default read in floorTileHtml/tileHtml.
// Deliberately reuses the generic data-path input wiring (bindEditor already listens for
// [data-path] changes and writes into state.sel) — no custom JS needed for this card.
function tableSeatingCardHtml(s) {
  const n = Math.max(1, parseInt(s.table_count, 10) || 12);
  const seats = s.table_seats && typeof s.table_seats === "object" ? s.table_seats : {};
  const names = s.table_names && typeof s.table_names === "object" ? s.table_names : {};
  let cells = "";
  for (let i = 1; i <= n; i++) {
    // Name (mig 131, display-only) + seat count (mig 111) per table — one cell each.
    cells += `<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:8px;background:var(--panel-2)">
      <span style="font-weight:700;font-size:13px;min-width:26px">T${i}</span>
      <input type="text" maxlength="24" data-path="table_names.${i}" value="${esc(names[String(i)] ?? "")}" placeholder="Name"
        title='A display name for this table (e.g. "Banquet") — bills and QR codes keep the number'
        style="flex:1;min-width:0;padding:5px 6px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--text)"/>
      <input type="number" min="1" max="30" data-path="table_seats.${i}" value="${esc(seats[String(i)] ?? 4)}" title="Seats"
        style="width:56px;padding:5px 6px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--text)"/>
    </div>`;
  }
  return `<div class="card"><h3>Table setting</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      Each table's <b>name</b> (optional — e.g. the last table as "Banquet"; tiles and
      table views show it, while bills &amp; QR codes keep the number) and how many
      people can sit there (shows next to the chair icon; nothing set = 4).
    </p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;max-height:340px;overflow-y:auto;padding-right:4px">${cells}</div>
  </div>`;
}

// Guest QR links: one PERMANENT, table-scoped link per table (…/r/<slug>/menu?table=N). Each link is
// hard-wired to its own table number — the QR you print on table 3 always opens table 3's menu, it
// never expires, and it can't reach another table. Shown half (the meaningful tail) + a Copy button
// that grabs the FULL url, so you can paste it into any QR-code maker.
//
// ADMIN/OWNER-ONLY (owner 2026-07-29): printing/renewing a table's guest QR is an admin job —
// the real manager panel doesn't show this card at all. It carries data-mgr-hide so XRAY_CONTROLS
// hides it for a real manager and tints it (still usable) for a higher role looking in. The admin's
// own copy — with permanent /q/<code> codes, a QR download and a print sheet — lives in the
// restaurant detail's ⚙ Settings tab (components/admin/RestaurantSettings.tsx).
function tableQrLinksCardHtml(s) {
  const n = Math.max(1, parseInt(s.table_count, 10) || 12);
  const names = s.table_names && typeof s.table_names === "object" ? s.table_names : {};
  const seats = s.table_seats && typeof s.table_seats === "object" ? s.table_seats : {};
  const slug = (state.data.restaurant || {}).slug || "";
  const origin = location.origin;
  if (!slug) return `<div class="card" data-mgr-hide="table_qr"><h3>Guest QR links</h3><p style="color:var(--muted);font-size:13px">Couldn't read this restaurant's web address yet — reload the panel and try again.</p></div>`;
  let rows = "";
  for (let i = 1; i <= n; i++) {
    const nm = (names[String(i)] || "").trim();
    const label = nm ? `${esc(nm)} <span class="muted" style="font-weight:400">(T${i})</span>` : `T${i}`;
    const st = seats[String(i)] ?? 4;
    const full = `${origin}/r/${slug}/menu?table=${i}`;
    rows += `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:var(--panel-2);flex-wrap:wrap">
      <span style="font-weight:700;font-size:13px;min-width:78px">${label}</span>
      <span class="muted" style="font-size:12px;min-width:50px">${esc(st)} seats</span>
      <code style="flex:1;min-width:130px;font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">…/r/${esc(slug)}/menu?table=${i}</code>
      <button class="btn small" type="button" data-copy-link="${esc(full)}" title="Copy this table's full link">⧉ Copy</button>
    </div>`;
  }
  return `<div class="card" data-mgr-hide="table_qr"><h3>Guest QR links · one per table</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 14px;line-height:1.5">
      A <b>permanent</b> link for each table — it always opens the guest menu for <b>that table only</b>
      (table 3's link can never reach table 6), and it never expires. Tap <b>Copy</b> and paste it into
      any QR-code maker to print that table's code. Links use this site's address (<code>${esc(origin)}</code>).
    </p>
    <div style="display:grid;gap:6px;max-height:360px;overflow-y:auto;padding-right:4px">${rows}</div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// WAITER SECTIONS — "Who serves which table" (mig 222, owner 2026-07-29)
// ══════════════════════════════════════════════════════════════════════════════
// Splits the floor into sections: a waiter's tablet then shows ONLY the tables they
// were given. A table can be given to two waiters (they share it) or to one.
//
// Its own small endpoint (/api/editor/table-sections) rather than the full staff roster:
// a manager who may hand out sections shouldn't thereby gain everyone's phone number and
// permission map. The payload is just id + name + assigned_tables per waiter.
//
// The DANGEROUS state this card exists to prevent: a table given to NOBODY is invisible
// on every tablet — guests sit there and no waiter ever sees the call. So the gap warning
// is the first thing in the card, not a footnote.
async function loadTableSections() {
  state.sectionsLoading = true;
  try {
    const r = await fetch(ridQ("/api/editor/table-sections"), { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { state.sectionsDenied = d.error || "Couldn't load waiter sections."; state.sections = null; }
    else { state.sectionsDenied = null; state.sections = d; }
  } catch (e) { state.sectionsDenied = "Couldn't reach the server."; }
  state.sectionsLoaded = true; state.sectionsLoading = false;
  if (state.tab === "general") renderEditor();
}

// Replace ONE waiter's whole list. The server re-sanitises and clamps to the real table
// count, so a stale panel can never write a table that doesn't exist.
async function saveWaiterTables(userId, tables) {
  const w = (state.sections?.waiters || []).find((x) => x.id === userId);
  const before = w ? (w.assigned_tables || []).slice() : null;
  if (w) w.assigned_tables = tables.slice();           // optimistic — the grid feels instant
  renderEditor(); repaintSectionPicker(); repaintSectionsModal();
  try {
    const r = await fetch(ridQ("/api/editor/table-sections"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, tables }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Save failed (${r.status})`);
    if (w && d.user) w.assigned_tables = d.user.assigned_tables || [];
  } catch (e) {
    if (w && before) w.assigned_tables = before;       // put it back — never lie about what's saved
    toast(e.message || "Couldn't save that change.", "err");
  }
  renderEditor(); repaintSectionPicker(); repaintSectionsModal();
}

const secTables = (w) => (w.assigned_tables || []).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
const secName = (w) => (w.name || w.username || "Waiter").trim();
// Which waiters hold table i (used by the by-table view and the gap warning).
function secHolders(i) {
  return (state.sections?.waiters || []).filter((w) => secTables(w).includes(Number(i)));
}
// Tables nobody serves — the state that silently loses orders.
function secGaps() {
  const n = state.sections?.tableCount || 0;
  const out = [];
  for (let i = 1; i <= n; i++) if (!secHolders(i).length) out.push(i);
  return out;
}
// "1 2 3 4 6" → "1–4, 6". Same compaction the waiter sees on their own tablet.
function secRangeText(nums) {
  const xs = nums.slice().sort((a, b) => a - b);
  if (!xs.length) return "";
  const parts = []; let start = xs[0], prev = xs[0];
  for (let i = 1; i <= xs.length; i++) {
    const cur = xs[i];
    if (cur === prev + 1) { prev = cur; continue; }
    parts.push(start === prev ? `T${start}` : `T${start}–T${prev}`);
    start = cur; prev = cur;
  }
  return parts.join(", ");
}

function tableSectionsCardHtml() {
  const wrap = (inner) => `<div class="card" data-mgr-hide="table_sections"><h3>Who serves which table</h3>${inner}</div>`;
  if (state.sectionsDenied) return wrap(`<p style="color:var(--muted);font-size:13px;margin:0;line-height:1.5">${esc(state.sectionsDenied)}</p>`);
  if (!state.sectionsLoaded || !state.sections) return wrap(`<p class="muted" style="font-size:13px;margin:0">Loading…</p>`);

  const s = state.sections;
  const waiters = s.waiters || [];
  const view = state.sectionsView === "table" ? "table" : "waiter";
  const gaps = secGaps();
  const empties = waiters.filter((w) => w.active !== false && !secTables(w).length);

  const intro = `<p style="color:var(--muted);font-size:13px;margin:0 0 14px;line-height:1.5">
      Give each waiter their own part of the floor. Their tablet then shows <b>only</b> those
      tables — everything else is hidden, and the server turns down anything they try on a
      table that isn't theirs. The same table can be given to <b>two</b> waiters if they share it.
    </p>`;

  // The two warnings, most dangerous first. A gap loses orders; an empty waiter just
  // stares at a blank tablet — bad, but recoverable.
  let warn = "";
  if (gaps.length) {
    warn += `<div class="sec-warn sec-warn-bad">
      <b>⚠ ${gaps.length} table${gaps.length === 1 ? "" : "s"} nobody serves</b>
      <span>${esc(secRangeText(gaps))} won't appear on any waiter's tablet, so a guest sitting there is never seen.</span>
      <button class="btn small" type="button" data-sec-fixgaps>Give them to everyone</button>
    </div>`;
  }
  if (empties.length) {
    warn += `<div class="sec-warn">
      <b>${empties.length} waiter${empties.length === 1 ? " has" : "s have"} no tables</b>
      <span>${esc(empties.map(secName).join(", "))} — their tablet will be empty until you give them a section.</span>
    </div>`;
  }
  if (!s.moduleOn) {
    warn = `<div class="sec-warn">
      <b>Sections aren't switched on for this restaurant</b>
      <span>Every waiter still sees the whole floor. What you set here is saved and starts working the moment Aevidine turns the feature on.</span>
    </div>` + warn;
  }

  const toggle = `<div class="sec-views">
      <button class="btn small ${view === "waiter" ? "primary" : ""}" type="button" data-sec-view="waiter">By waiter</button>
      <button class="btn small ${view === "table" ? "primary" : ""}" type="button" data-sec-view="table">By table</button>
    </div>`;

  let list = "";
  if (view === "waiter") {
    list = waiters.length ? waiters.map((w) => {
      const ts = secTables(w);
      const chips = ts.length
        ? ts.map((i) => `<span class="sec-chip">T${i}</span>`).join("")
        : `<span class="sec-chip sec-chip-none">no tables — empty tablet</span>`;
      return `<div class="sec-row${w.active === false ? " sec-off" : ""}">
        <div class="sec-who">
          <b>${esc(secName(w))}</b>
          ${w.active === false ? `<span class="sec-dis">disabled</span>` : ""}
          <span class="muted">${ts.length} table${ts.length === 1 ? "" : "s"}</span>
        </div>
        <div class="sec-chips">${chips}</div>
        <button class="btn small" type="button" data-sec-edit="${esc(w.id)}">Edit ▸</button>
      </div>`;
    }).join("") : `<div class="sx-empty">No waiter logins yet — add one in <b>Users</b>, then give them tables here.</div>`;
  } else {
    const n = s.tableCount || 0;
    let cells = "";
    for (let i = 1; i <= n; i++) {
      const hold = secHolders(i);
      cells += `<button class="sec-tcell${hold.length ? "" : " sec-tcell-gap"}" type="button" data-sec-table="${i}">
        <b>T${i}</b>
        <span>${hold.length ? esc(hold.map(secName).join(", ")) : "nobody"}</span>
      </button>`;
    }
    list = `<div class="sec-tgrid">${cells}</div>`;
  }

  const bulk = waiters.length ? `<div class="sec-bulk">
      <button class="btn small" type="button" data-sec-all>Give every table to everyone</button>
      <button class="btn small" type="button" data-sec-clear>Clear all</button>
      <span class="muted" style="font-size:12px">Changes save straight away and reach the tablets without a re-login.</span>
    </div>` : "";

  return wrap(intro + warn + toggle + list + bulk);
}

// Escape-to-close for the three section overlays. The panel's overlay watcher already wires
// the phone's hardware BACK button to any .sx-modal-overlay; this is the desktop half.
// Registered per overlay and removed by that overlay's own close(), so no listener outlives
// the popup it belongs to however it was dismissed (✕, backdrop, Escape or Back).
const secEscMap = new WeakMap();
function secEscOn(ov, close) {
  const fn = (e) => {
    if (e.key !== "Escape") return;
    // Close ONLY the top layer. The single-waiter picker opens ON TOP of the sections
    // modal, and both hold a listener — without this, one Escape closed the picker AND
    // the card behind it, which is not what "back one step" means (and is exactly what
    // LFH_BACK gets right for the phone button).
    const all = document.querySelectorAll(".sx-modal-overlay");
    if (all.length && all[all.length - 1] !== ov) return;
    close();
  };
  secEscMap.set(ov, fn);
  document.addEventListener("keydown", fn);
}
function secEscOff(ov) {
  const fn = secEscMap.get(ov);
  if (fn) { document.removeEventListener("keydown", fn); secEscMap.delete(ov); }
}

// The SAME card, opened as a modal from the live Table view — because the Settings tab it
// otherwise lives in is gated by `edit_settings`, a power a section-granting manager may
// not have. One builder, two doors: no chance of the two drifting apart.
function openSectionsModal() {
  const ov = document.createElement("div");
  ov.className = "sx-modal-overlay";
  ov.innerHTML = `<div class="sx-modal sec-modal sec-modal-wide">
      <div class="sx-modal-head"><h3>Who serves which table</h3><button class="sx-x" type="button" data-sec-close>✕</button></div>
      <div class="sx-modal-body" data-sec-card>${tableSectionsCardHtml()}</div>
    </div>`;
  const close = () => { sectionsModalOpen = false; secEscOff(ov); ov.remove(); };
  ov.__lfhClose = close;
  secEscOn(ov, close);
  sectionsModalOpen = true;
  ov.addEventListener("click", (e) => {
    if (e.target === ov || e.target.closest("[data-sec-close]")) return close();
    const v = e.target.closest("[data-sec-view]");
    if (v) { state.sectionsView = v.dataset.secView; return repaintSectionsModal(); }
    const ed2 = e.target.closest("[data-sec-edit]");
    if (ed2) return openSectionPicker(ed2.dataset.secEdit);
    const tc = e.target.closest("[data-sec-table]");
    if (tc) return openTableHolderPicker(Number(tc.dataset.secTable));
    const fx = e.target.closest("[data-sec-fixgaps]");
    if (fx) return (async () => {
      const gaps = secGaps(); if (!gaps.length) return;
      for (const w of (state.sections?.waiters || [])) {
        await saveWaiterTables(w.id, Array.from(new Set(secTables(w).concat(gaps))).sort((a, b) => a - b));
      }
      toast(`${gaps.length} table${gaps.length === 1 ? "" : "s"} now covered.`);
    })();
    const al = e.target.closest("[data-sec-all]");
    if (al) return (async () => {
      if (!(await confirmDialog("Give every table to every waiter? They'll each see the whole floor again — you can then take tables away one by one.", "Give all"))) return;
      const all = Array.from({ length: state.sections?.tableCount || 0 }, (_, k) => k + 1);
      for (const w of (state.sections?.waiters || [])) await saveWaiterTables(w.id, all);
    })();
    const cl = e.target.closest("[data-sec-clear]");
    if (cl) return (async () => {
      if (!(await confirmDialog("Clear every section? Every waiter will be left with NO tables — while sections are switched on, their tablets will be empty until you give them tables again.", "Clear all", { floorwide: true }))) return;
      for (const w of (state.sections?.waiters || [])) await saveWaiterTables(w.id, []);
    })();
  });
  document.body.appendChild(ov);
  if (!state.sectionsLoaded && !state.sectionsLoading) loadTableSections().then(repaintSectionsModal);
}
let sectionsModalOpen = false;
function repaintSectionsModal() {
  const host = document.querySelector("[data-sec-card]");
  if (host && sectionsModalOpen) host.innerHTML = tableSectionsCardHtml();
}

// ── The picker: tap tables on/off for ONE waiter ─────────────────────────────
// Uses the .sx-modal-overlay class, which the panel's overlay watcher (wireOverlayBack)
// already registers with LFH_BACK — so the phone's hardware Back closes the picker
// instead of leaving the panel, with no hand-rolled history here.
let sectionPickerId = null;
function repaintSectionPicker() {
  const host = document.querySelector("[data-sec-picker-body]");
  if (host && sectionPickerId) host.innerHTML = sectionPickerBodyHtml(sectionPickerId);
}
function sectionPickerBodyHtml(userId) {
  const s = state.sections || {};
  const w = (s.waiters || []).find((x) => x.id === userId);
  if (!w) return `<div class="sx-empty">That waiter is no longer on the team.</div>`;
  const mine = secTables(w);
  const n = s.tableCount || 0;
  const names = s.tableNames || {};
  let cells = "";
  for (let i = 1; i <= n; i++) {
    const on = mine.includes(i);
    // Who ELSE holds this table: shown so sharing is a deliberate choice, not a surprise.
    const others = secHolders(i).filter((x) => x.id !== userId).map(secName);
    const nm = (names[String(i)] || "").trim();
    cells += `<button class="sec-pick${on ? " on" : ""}" type="button" data-sec-toggle="${i}"
      title="${on ? "Tap to take this table away" : "Tap to give this table"}">
      <b>${on ? "✓ " : ""}T${i}</b>
      ${nm ? `<span class="sec-pick-nm">${esc(nm)}</span>` : ""}
      ${others.length ? `<span class="sec-pick-oth">${esc(others.join(", "))}</span>` : ""}
    </button>`;
  }
  return `<div class="sec-pickbar">
      <button class="btn small" type="button" data-sec-pickall>All tables</button>
      <button class="btn small" type="button" data-sec-picknone>None</button>
      <span class="sec-pickrange">
        <input type="number" min="1" max="${n}" placeholder="from" data-sec-from style="width:74px" />
        <input type="number" min="1" max="${n}" placeholder="to" data-sec-to style="width:74px" />
        <button class="btn small" type="button" data-sec-pickrange>Add range</button>
      </span>
      <span class="muted" style="margin-left:auto;font-size:12px">${mine.length} of ${n} · ${esc(secRangeText(mine)) || "none"}</span>
    </div>
    <div class="sec-pickgrid">${cells}</div>`;
}
function openSectionPicker(userId) {
  const w = (state.sections?.waiters || []).find((x) => x.id === userId);
  if (!w) return;
  sectionPickerId = userId;
  const ov = document.createElement("div");
  ov.className = "sx-modal-overlay";
  ov.innerHTML = `<div class="sx-modal sec-modal">
      <div class="sx-modal-head"><h3>${esc(secName(w))} · tables</h3><button class="sx-x" type="button" data-sec-close>✕</button></div>
      <div class="sx-modal-body" data-sec-picker-body>${sectionPickerBodyHtml(userId)}</div>
    </div>`;
  const close = () => { sectionPickerId = null; secEscOff(ov); ov.remove(); };
  ov.__lfhClose = close;
  secEscOn(ov, close);
  ov.addEventListener("click", async (e) => {
    if (e.target === ov || e.target.closest("[data-sec-close]")) return close();
    const cell = e.target.closest("[data-sec-toggle]");
    if (cell) {
      const i = Number(cell.dataset.secToggle);
      const cur = secTables(w);
      return saveWaiterTables(userId, cur.includes(i) ? cur.filter((x) => x !== i) : cur.concat(i));
    }
    if (e.target.closest("[data-sec-pickall]")) {
      return saveWaiterTables(userId, Array.from({ length: state.sections.tableCount || 0 }, (_, k) => k + 1));
    }
    if (e.target.closest("[data-sec-picknone]")) return saveWaiterTables(userId, []);
    if (e.target.closest("[data-sec-pickrange]")) {
      const from = parseInt(ov.querySelector("[data-sec-from]")?.value, 10);
      const to = parseInt(ov.querySelector("[data-sec-to]")?.value, 10);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return toast("Type a first and last table number.", "err");
      const lo = Math.min(from, to), hi = Math.max(from, to);
      const add = []; for (let i = lo; i <= hi; i++) add.push(i);
      const merged = Array.from(new Set(secTables(w).concat(add))).sort((a, b) => a - b);
      return saveWaiterTables(userId, merged);
    }
  });
  document.body.appendChild(ov);
}

// Tapping a table in the "By table" view: choose which waiters hold THAT table — the
// same data from the other side, for when you're thinking "who's on table 7?".
function openTableHolderPicker(i) {
  const s = state.sections || {};
  const ov = document.createElement("div");
  ov.className = "sx-modal-overlay";
  const rows = () => (s.waiters || []).map((w) => {
    const on = secTables(w).includes(Number(i));
    return `<button class="sec-hold${on ? " on" : ""}" type="button" data-sec-hold="${esc(w.id)}">
      <span>${on ? "✓" : "○"}</span><b>${esc(secName(w))}</b>
      <span class="muted">${secTables(w).length} table${secTables(w).length === 1 ? "" : "s"}</span>
    </button>`;
  }).join("") || `<div class="sx-empty">No waiter logins yet.</div>`;
  const nm = ((s.tableNames || {})[String(i)] || "").trim();
  ov.innerHTML = `<div class="sx-modal sec-modal">
      <div class="sx-modal-head"><h3>Table ${i}${nm ? ` · ${esc(nm)}` : ""}</h3><button class="sx-x" type="button" data-sec-close>✕</button></div>
      <div class="sx-modal-body"><p class="muted" style="font-size:13px;margin:0 0 12px">Who serves this table? Tick more than one if they share it.</p><div class="sec-holds">${rows()}</div></div>
    </div>`;
  const close = () => { secEscOff(ov); ov.remove(); };
  ov.__lfhClose = close;
  secEscOn(ov, close);
  ov.addEventListener("click", async (e) => {
    if (e.target === ov || e.target.closest("[data-sec-close]")) return close();
    const b = e.target.closest("[data-sec-hold]");
    if (!b) return;
    const w = (s.waiters || []).find((x) => x.id === b.dataset.secHold);
    if (!w) return;
    const cur = secTables(w);
    await saveWaiterTables(w.id, cur.includes(Number(i)) ? cur.filter((x) => x !== Number(i)) : cur.concat(Number(i)));
    const host = ov.querySelector(".sec-holds");
    if (host) host.innerHTML = rows();
  });
  document.body.appendChild(ov);
}

// ---------- Settings SECTIONS (owner, 2026-07-03) ----------
// The Settings tab is organized into sidebar sections instead of one long scroll.
// Each section groups related cards; renderList() draws the sidebar from this same
// array, and formGeneral() below dispatches on state.settingsSection.
const SETTINGS_SECTIONS = [
  { id: "general", label: "General", sub: "site basics", icon: "fa-gear", title: "General settings" },
  { id: "tables", label: "Tables", sub: "floor & seats", icon: "fa-chair", title: "Table settings" },
  { id: "users", label: "Users", sub: "staff logins", icon: "fa-users", title: "User settings" },
  { id: "access", label: "Access", sub: "user permissions", icon: "fa-key", title: "Access settings" },
  { id: "billing", label: "Billing", sub: "invoice & tax", icon: "fa-file-invoice", title: "Billing settings" },
  { id: "kitchen", label: "Kitchen", sub: "KOT printing", icon: "fa-fire-burner", title: "Kitchen settings" },
  { id: "sessions", label: "Dining sessions", sub: "QR & location", icon: "fa-qrcode", title: "Dining sessions" },
];

// The three tablet capabilities that can be granted per person (Access section).
// Key = the settings column AND the staff_users.permissions key (same name, so the
// server's fallback rule is a plain lookup). Label = the human words.
const ACCESS_CAPS = [
  { key: "tablet_discount", label: "Apply discount" },
  { key: "tablet_mark_paid", label: "Mark bill paid" },
  { key: "tablet_invoice", label: "Generate invoice" },
  // Banquet module (mig 130) — only meaningful when the admin entitlement is on;
  // accessCapsFor() drops it from both Access cards otherwise (no dead UI).
  { key: "tablet_banquet", label: "Banquet billing" },
  // Table types + khata (mig 166) — the manager→tablet rung of the ladder; dropped
  // from both Access cards when the feature itself is off (no dead UI).
  { key: "tablet_table_tags", label: "Mark table types (VIP/Family/Guest)" },
  { key: "tablet_khata", label: "Park pay-later (khata) bills" },
  // KOT ▾ menu, the ladder's manager→tablet rung (mig 172) — only shown when the
  // module itself is effective (canonical ladder, migs 172-177; no dead UI otherwise).
  { key: "tablet_table_ops", label: "Table & KOT operations" },
  // Order-taking (mig 178) — the manager→tablet rung for taking orders. Always shown
  // (not module-gated); defaults 'on' so the tablet keeps taking orders out of the box.
  { key: "tablet_take_orders", label: "Take orders" },
  // Parcel / takeaway (mig 197) — the manager→tablet rung for the 🥡 New Parcel button.
  // Was MISSING here (2026-07-26): the waiter cap is server-enforced (tabletPerm) and both
  // the admin + owner screens expose it, but the MANAGER's own Access card couldn't set it
  // or a per-waiter override. Module-gated like table_ops below (no dead UI when off).
  { key: "tablet_parcel", label: "Parcel / takeaway orders" },
];
// The Access cards' cap list, minus modules this restaurant doesn't have.
function accessCapsFor() {
  const s = state.data.settings || {};
  const tagsOn = s.table_tags_allowed === true && (s.table_tags_owner_control !== true || s.table_tags_enabled !== false);
  return ACCESS_CAPS.filter((c) => {
    if (c.key === "tablet_banquet") return s.banquet_allowed === true && (s.banquet_owner_control !== true || s.banquet_enabled !== false);
    if (c.key === "tablet_table_tags" || c.key === "tablet_khata") return tagsOn;
    if (c.key === "tablet_table_ops") return s.table_ops_allowed === true && (s.table_ops_owner_control !== true || s.table_ops_enabled !== false);
    if (c.key === "tablet_take_orders") return s.take_orders_allowed === true && (s.take_orders_owner_control !== true || s.take_orders_enabled !== false);
    if (c.key === "tablet_parcel") return s.parcel_allowed === true && (s.parcel_owner_control !== true || s.parcel_enabled !== false);
    return true;
  });
}
const ACCESS_MODE_LABEL = { on: "On", pin: "On — needs PIN", off: "Off" };

// accessDefaultsCardHtml: the restaurant-wide defaults — the same three tri-states
// that used to live in "Tablet panel access", now framed as what EVERYONE inherits
// unless a per-user override (card below) says otherwise.
function accessDefaultsCardHtml(s) {
  return `<div class="card"><h3>Defaults for everyone</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      What a waiter can do with a bill on the tablet, unless a person below has their own
      setting. Each starts <b>Off</b> (hidden). <b>On</b> = allowed directly;
      <b>On · needs manager PIN</b> = allowed but a manager PIN is asked each time.
    </p>
    <div class="grid cols-3">
      ${accessCapsFor().map((c) => triSel(c.label, c.key, s[c.key])).join("")}
    </div>
  </div>`;
}

// accessUsersCardHtml: PER-USER overrides (owner, 2026-07-03 — "what access is granted
// to a particular user, like he can mark as paid"). One row per TABLET login; each
// capability is Default (inherit the card above) / On / On·PIN / Off. Saved instantly
// per change via /api/owner/staff set_permissions; the server's tabletPerm enforces it.
function accessUsersCardHtml(s) {
  if (!state.staffLoaded) {
    return `<div class="card"><h3>Per-user access</h3><p class="muted" style="font-size:13px;margin:0">Loading…</p></div>`;
  }
  if (state.staffDenied) {
    return `<div class="card"><h3>Per-user access</h3><p style="color:var(--muted);font-size:13px;margin:0;line-height:1.5">${esc(state.staffDenied)}</p></div>`;
  }
  const waiters = state.staffTeam.filter((u) => u.role === "tablet");
  const selFor = (u, cap) => {
    const cur = (u.permissions || {})[cap.key] || "";
    const defNow = ACCESS_MODE_LABEL[s[cap.key]] || "Off"; // what Default resolves to right now
    return `<div class="field" style="margin:0">
      <label style="font-size:11px">${cap.label}</label>
      <select data-perm-user="${esc(u.id)}" data-perm-key="${cap.key}" style="font-size:12px;font-weight:600;padding:6px 8px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--text)">
        <option value="" ${cur === "" ? "selected" : ""}>Default (${defNow})</option>
        <option value="on" ${cur === "on" ? "selected" : ""}>On</option>
        <option value="pin" ${cur === "pin" ? "selected" : ""}>On — needs PIN</option>
        <option value="off" ${cur === "off" ? "selected" : ""}>Off</option>
      </select>
    </div>`;
  };
  const rows = waiters.length
    ? waiters.map((u) => `
      <div style="padding:10px 12px;border-radius:9px;background:var(--panel-2)${u.active ? "" : ";opacity:.6"}">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">
          <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.03em;padding:3px 8px;border-radius:999px;background:color-mix(in srgb, var(--text) 8%, transparent);color:var(--text)">${esc(u.role)}</span>
          <span style="font-weight:700;font-size:13.5px">${esc(u.name || u.username)}</span>
          ${u.active ? "" : `<span style="font-size:10.5px;color:var(--red);font-weight:700">disabled</span>`}
          ${Object.keys(u.permissions || {}).length ? `<span style="font-size:10.5px;color:var(--text);font-weight:700" title="This person has their own settings">· custom</span>` : ""}
        </div>
        <div class="grid cols-3" style="gap:8px">${accessCapsFor().map((c) => selFor(u, c)).join("")}</div>
      </div>`).join("")
    : `<div class="sx-empty">No tablet logins yet — add one in <b>Users</b>.</div>`;
  return `<div class="card"><h3>Per-user access</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 14px;line-height:1.5">
      Give a specific waiter more (or less) than the defaults above. <b>Default</b> follows
      the defaults card; a person's own <b>On / On·PIN / Off</b> wins over it. Changes save
      instantly and apply on their very next tap — no re-login needed.
    </p>
    <div style="display:flex;flex-direction:column;gap:8px">${rows}</div>
  </div>`;
}

// formGeneral: the site-wide Settings form, now split into SECTIONS (see
// SETTINGS_SECTIONS). Every card is unchanged in behaviour — the split is purely
// organizational; data-path bindings and Save work exactly as before.
function formGeneral(s) {
  const sec = state.settingsSection;
  if (sec === "tables") {
    // "Number of tables" is ADMIN/OWNER-only (owner 2026-07-28): a real manager may set each
    // table's NAME + seats + see its QR link, but NOT change how many tables exist. The card
    // carries data-mgr-hide so XRAY_CONTROLS hides it for the real manager and tints it for a
    // higher role (admin/owner). The floor count itself lives in the admin RestaurantSettings.
    return `
  <div class="card" data-mgr-hide="table_count"><h3>Tables / seating</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      How many tables the restaurant has. Drives the live floor map in the
      <b>Tables</b> tab — Save, then open Tables.
    </p>
    <div style="max-width:200px">${tf("Number of tables", "table_count", s.table_count ?? 12, { type: "number", min: 1, max: 500, step: 1 })}</div>
  </div>
  ${tableSeatingCardHtml(s)}
  ${tableSectionsCardHtml()}
  ${tableQrLinksCardHtml(s)}
  <div class="card"><h3>Auto close / restart tables</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      When a table's bill is fully <b>paid</b> and every dish is <b>served</b>, free it
      automatically. <b>Off</b> = today's behaviour (you close/restart by hand).
      <b>Auto-close</b> ends the dining session; <b>Auto-restart</b> clears the round but
      keeps the table open for the next guests.
    </p>
    <div style="max-width:280px"><div class="field"><label>When a table is paid &amp; fully served</label>
      <select data-path="auto_table_action">
        <option value="off" ${(s.auto_table_action || "off") === "off" ? "selected" : ""}>Off — do nothing</option>
        <option value="close" ${s.auto_table_action === "close" ? "selected" : ""}>Auto-close the table</option>
        <option value="restart" ${s.auto_table_action === "restart" ? "selected" : ""}>Auto-restart the table</option>
      </select>
    </div></div>
  </div>`;
  }
  if (sec === "users") {
    return userSettingCardHtml();
  }
  if (sec === "access") {
    return accessDefaultsCardHtml(s) + accessUsersCardHtml(s);
  }
  if (sec === "billing") {
    // TWO stacked sections (owner, 2026-07-05 — "manager bill and printable bill, up/down,
    // no separate menu"): ① the ON-SCREEN manager bill (one merged tax line, renameable
    // word), ② the PRINTED customer bill (identity + footer + the named tax split).
    //
    // AUTOFILL (owner, 2026-07-05): the form opens PRE-FILLED with the exact values the
    // bill uses RIGHT NOW (same resolver as printBill — billIdentity()), never blank boxes
    // that hide what actually prints. We fill the WORKING COPY (s = state.sel), so what you
    // see is what Save persists; edit anything before saving to change it.
    const bi = billIdentity(s);
    // Prefill only BRAND-SAFE defaults (name/prefix/footer/tax word). We deliberately DON'T
    // materialise address / phone / GSTIN: for a not-yet-configured restaurant those fall back
    // to shared PLACEHOLDERS (incl. a fake GSTIN), and writing them into the working copy meant
    // any Save persisted the fakes — turning "not configured" into "looks configured", with a
    // bogus tax id on invoices. They're shown as input HINTS instead (see the fields below), so
    // the owner still sees what prints but nothing fake is saved unless they type a real value.
    if (!s.restaurant_name) s.restaurant_name = bi.name;
    if (!s.invoice_prefix) s.invoice_prefix = bi.prefix;
    if (!s.bill_footer) s.bill_footer = bi.footer;
    if (!s.tax_label) s.tax_label = bi.taxLabel;
    // Tax rows prefill: no named taxes yet → materialise the 50/50 split the print has
    // always used (e.g. 5% → CGST 2.5 + SGST 2.5) so the owner can rename/re-split it.
    if (!Array.isArray(s.tax_components) || !s.tax_components.length) {
      const half = Math.round((taxModel(s).pct / 2) * 100) / 100;
      s.tax_components = [{ label: "CGST", rate: half }, { label: "SGST", rate: half }];
    }
    const comps = s.tax_components;
    const compTotal = Math.round(comps.reduce((a, c) => a + (Number(c && c.rate) || 0), 0) * 100) / 100;
    const taxRows = comps.map((c, i) => `
      <div class="tax-row">
        <input type="text" data-path="tax_components.${i}.label" value="${esc(c.label ?? "")}" placeholder="e.g. CGST" maxlength="24" />
        <input type="number" step="any" min="0" max="100" data-path="tax_components.${i}.rate" value="${esc(c.rate ?? "")}" placeholder="%" class="tax-rate-in" />
        <span class="tax-pct">%</span>
        <button type="button" class="icon-btn" data-action="rmTax" data-arg="${i}" title="Remove this tax"><i class="fas fa-trash"></i></button>
      </div>`).join("");
    return `
  <div class="card"><h3>① Manager bill — on screen</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      Bills you SEE in the manager (Live/Today/Previous cards, the bill popup, table
      details) show ONE merged tax line. Rename its word here — the amount and % always
      come from the tax rows in the printed-bill section below (their total: <b>${compTotal}%</b>).
    </p>
    <div style="max-width:260px">${tf("Tax word on screen", "tax_label", s.tax_label ?? "Tax", { hint: `Shows as “${(s.tax_label || "Tax").trim() || "Tax"} ${compTotal}%”. E.g. Tax, GST, VAT.` })}</div>
  </div>
  <div class="card"><h3>② Printed bill — what the customer gets</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      Everything below prints on the customer's bill exactly as typed, and the form is
      pre-filled with what the bill prints <b>right now</b> — change anything and Save.
      <b>Invoice prefix</b> + financial year build the number (e.g. <code>LFH/2025-26/000042</code>).
    </p>
    ${tf("Restaurant name", "restaurant_name", s.restaurant_name ?? "")}
    ${tf("Address", "restaurant_address", s.restaurant_address ?? "", { ph: bi.address, hint: !s.restaurant_address && bi.address ? "Currently prints the placeholder shown — type your real address." : "" })}
    <div class="grid cols-3">
      ${tf("Phone", "restaurant_phone", s.restaurant_phone ?? "", { ph: bi.phone })}
      ${tf("GSTIN", "gstin", s.gstin ?? "", { ph: "e.g. 24ABCDE1234F1Z5", hint: !s.gstin ? "No GSTIN set — bills print WITHOUT a GSTIN until you enter your real one (a fake number on a real bill is illegal)." : "" })}
      ${tf("Invoice prefix", "invoice_prefix", s.invoice_prefix ?? "")}
    </div>
    ${tf("Bill footer message", "bill_footer", s.bill_footer ?? "", { hint: "Printed at the very bottom of the customer's bill, e.g. “Thank you — visit again!”." })}
    <h4 style="margin:18px 0 6px">Tax lines on the print</h4>
    <p style="color:var(--muted);font-size:13px;margin:0 0 14px;line-height:1.5">
      The taxes that make up your total (e.g. <b>CGST 2.5%</b> + <b>SGST 2.5%</b>). Each prints
      as its own line; on screen they show merged as one “${esc((s.tax_label || "Tax").trim() || "Tax")} <b>${compTotal}%</b>” line —
      the split and the total can never disagree.
    </p>
    <div class="tax-rows">${taxRows}</div>
    <div class="tax-total">Total tax: <b>${compTotal}%</b></div>
    <button type="button" class="btn small" data-action="addTax" style="margin-top:10px">+ Add tax</button>
    <div style="max-width:220px;margin-top:16px">${tf("Fallback tax rate (0.05 = 5%)", "tax_rate", s.tax_rate ?? "", { type: "number", step: "any", min: 0, hint: "Used only if you remove every named tax above." })}</div>
  </div>`;
  }
  if (sec === "kitchen") {
    return `
  <div class="card"><h3>Kitchen printing</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      This is for the <b>kitchen</b>, not the bill. When ON, the kitchen screen auto-prints a
      <b>KOT (kitchen order ticket)</b> — the dishes to make, no prices — the moment a new order
      arrives, so cooks never have to click. Set up the kitchen device's printer first and launch
      its Chrome in "kiosk printing" mode for silent prints. Leave OFF until the printer is ready.
    </p>
    ${s.auto_print_kot_allowed
      ? toggle("Auto-print the KOT when a new order arrives", "auto_print_kot", s.auto_print_kot === true)
      : `<div class="hint">Auto-print isn't enabled for this restaurant yet — ask your admin to turn it on.</div>`}
    <button type="button" class="btn" id="kotPreviewBtn" style="margin-top:14px">🖨 Preview a sample KOT</button>
    <p style="color:var(--muted);font-size:12px;margin:8px 0 0">Opens a test ticket and the print dialog — use it to check the printer &amp; the ticket layout.</p>
  </div>`;
  }
  if (sec === "sessions") {
    return `
  <div class="card"><h3>Dining sessions — NEW</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      The QR/session system. <b>When OFF, the menu works exactly like today.</b> Turn it
      ON only when you're ready: guests must be at the café (location) to order or call a
      waiter, and the first order asks for a one-time phone code.
    </p>
    ${toggle("Turn the dining-session system ON", "sessions_enabled", s.sessions_enabled === true)}
    ${toggle("Require location (guest must be near the café)", "require_location", s.require_location !== false)}
    ${toggle("Require a phone code (OTP) to place an order", "require_otp", s.require_otp !== false)}
    <p style="color:var(--muted);font-size:13px;margin:16px 0 10px;line-height:1.5">
      Café location — used only to confirm guests are physically here. In Google Maps,
      right-click your café and click the latitude, longitude numbers at the top to copy them.
      Leave blank to skip the location check.
    </p>
    <div class="grid cols-3">
      ${tf("Latitude", "geo_lat", s.geo_lat ?? "", { type: "number", step: "any" })}
      ${tf("Longitude", "geo_lng", s.geo_lng ?? "", { type: "number", step: "any" })}
      ${tf("Radius (metres)", "geo_radius_m", s.geo_radius_m ?? 250, { type: "number", min: 20, max: 5000, step: 10 })}
    </div>
  </div>`;
  }
  // default: the "general" section — site basics.
  return `
  <div class="card"><h3>Service mode</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      When ON, the public menu is replaced by a full-screen <b>"We'll be right back"</b>
      maintenance screen — customers can't view or order anything until you switch it
      back off. Use it while updating the menu or during a break.
    </p>
    ${toggle("Put the menu under maintenance", "service_mode", s.service_mode === true)}
  </div>
  <div class="card"><h3>Bubble effect</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      The rising bubble particles in the menu background (the "furnace" look).
      Turn this off for a flat, calm background.
    </p>
    ${toggle("Show rising bubbles on the menu", "bubbles_enabled", s.bubbles_enabled !== false)}
  </div>`;
}

// STATUS_META: how each order status looks on screen — its badge label and the
// CSS class that colours it.
const STATUS_META = {
  received: { label: "🔔 New", cls: "received" },
  preparing: { label: "👨‍🍳 Preparing", cls: "preparing" },
  served: { label: "✓ Served", cls: "served" },
  cancelled: { label: "✕ Cancelled", cls: "cancelled" },
};
// STATUS_RANK: a sort order so the Orders list shows New first, then Preparing, etc.
const STATUS_RANK = { received: 0, preparing: 1, served: 2, cancelled: 3 };

// itemDetailLine: the small sub-line under a dish showing EVERYTHING the guest
// chose — picked options ("Large · Oat milk · Extra shot"), removed/allergen
// ingredients ("NO DAIRY"), and any note ("'less ice'"). Shared by the order
// cards, the per-table bill, AND the table detail popup so the kitchen always
// sees exactly what to make. Returns "" when a dish is plain (nothing to show).
function itemDetailLine(it, skipRemoved = false) {
  const parts = [];
  if (Array.isArray(it.options) && it.options.length) parts.push(it.options.map((o) => esc(o.label)).join(" · "));
  // In staff EDIT mode the allergens render as their own removable chips (see
  // dishAllergenEditHtml), so we skip the read-only "NO X" here to avoid showing both.
  if (!skipRemoved && Array.isArray(it.removed) && it.removed.length) {
    // Each allergen renders on its own so a staff-ADDED one can carry a "＋" marker.
    const added = new Set((Array.isArray(it.added) ? it.added : []).map((x) => String(x).toLowerCase()));
    const chips = it.removed.map((r) => `NO ${esc(String(r).toUpperCase())}${added.has(String(r).toLowerCase()) ? `<sup class="alg-add" title="Added after the order was placed">＋</sup>` : ""}`).join(", ");
    parts.push(`<span class="ol-no">${chips}</span>`);
  }
  if (it.note) parts.push("“" + esc(it.note) + "”");
  return parts.length ? `<div class="ord-line-opts">${parts.join(" · ")}</div>` : "";
}

// dishNoTag: the editor-only "#N" dish code shown next to an ordered dish. Order
// rows store only the title, so we look the dish up by title to find its dish_no.
// Customer-facing screens never call this — it's editor staff reference only.
function dishNoTag(title) {
  const d = (state.data.items || []).find((m) => (m.title || "") === title);
  return d && d.dish_no != null ? ` <span class="dish-no">#${esc(String(d.dish_no))}</span>` : "";
}

// (Removed 2026-07-06: the old single-order `orderCardHtml` was DEAD — nothing called it,
// the live Bills list renders exclusively through `mergedOrderCardHtml` (discount-BEFORE-tax
// via billMath). The dead copy still computed the total as `o.total − o.discount`, i.e.
// discount applied AFTER tax — the exact overcharge fixed elsewhere. Deleted so it can't be
// revived by accident and reintroduce that bug.)

// mergedOrderCardHtml: build ONE card for a whole group of orders that belong
// together (same session / same table visit) — every dish from every order in one
// combined list with a SINGLE bill (owner: merge the orders, one bill). The
// separate order rows still exist underneath as the record. Per-order accept/serve/
// pay become session-level (they reuse the table-wide helpers).
// Financial-year string for invoice numbers, e.g. "2025-26" (FY starts April).
function financialYear(when) {
  // FY of the INVOICE's OWN date, not "today" — reprinting a March invoice after 1 April must
  // keep its issued year. Falls back to now when no/invalid date is passed (legacy callers).
  const d = when ? new Date(when) : new Date();
  const base = isNaN(d.getTime()) ? new Date() : d;
  const y = base.getFullYear();
  const start = base.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}
// Display an invoice number: <prefix>/<FY>/<6-digit>, e.g. LFH/2025-26/000042.
// `when` = the invoice's issue date (invoice_at) so the FY segment is fixed to issue time.
function invFmt(no, when) {
  if (no == null) return "";
  const pfx = (state.data.settings || {}).invoice_prefix || "INV";
  return `${pfx}/${financialYear(when)}/${String(no).padStart(6, "0")}`;
}
// Single source of truth for a bill's money — discount comes off BEFORE tax (GST is
// charged on the taxable amount). All inputs are DB values (server-priced items,
// server-clamped discount, configured rate); the frontend never sets a price.
// taxModel(settings): the ONE source of truth for the tax rate + its named breakdown.
// If the restaurant configured tax_components (owner, 2026-07-03), the TOTAL rate is the
// SUM of the components' percents (so the manager total and the printed per-tax split can
// never disagree). Empty/absent → fall back to tax_rate, then 5% — i.e. existing behaviour.
// Returns { rate (decimal, e.g. 0.05), pct (5), components:[{label,rate%}] }.
function taxModel(settings) {
  const s = settings || {};
  const comps = Array.isArray(s.tax_components) ? s.tax_components
    .map((c) => ({ label: String(c && c.label || "").trim(), rate: Number(c && c.rate) || 0 }))
    .filter((c) => c.label && c.rate > 0) : [];
  if (comps.length) {
    const pct = comps.reduce((a, c) => a + c.rate, 0);
    return { rate: pct / 100, pct: Math.round(pct * 100) / 100, components: comps };
  }
  const rate = Number(s.tax_rate) || 0.05;
  return { rate, pct: Math.round(rate * 10000) / 100, components: [] };
}
// taxLabel(): the word the ON-SCREEN merged tax line uses ("Tax 5%"). Owner-editable per
// restaurant (settings.tax_label, mig 125); the PRINTED bill instead itemises the named
// components from tax_components — this label never appears on paper.
function taxLabel(settings) {
  return (((settings || state.data.settings || {}).tax_label || "Tax") + "").trim() || "Tax";
}
// billIdentity(settings?): the EFFECTIVE identity + wording the customer bill uses RIGHT
// NOW — the restaurant's own Settings › Billing values, falling back to the same defaults
// printBill has always used (flagship #1 keeps its LFH identity; everyone else gets the
// TEMPORARY Aevidine placeholders / per-cuisine sign-offs until they fill their own).
// ONE resolver shared by printBill AND the Billing settings form, which AUTOFILLS these
// exact values — so "what you see in the form" can never drift from "what the bill
// prints". Returns RAW (unescaped) strings; callers escape at render.
function billIdentity(settings) {
  const s = settings || state.data.settings || {};
  const r = state.data.restaurant || {};
  const isDefault = r.slug === "french-house" || r.id === "00000000-0000-0000-0000-000000000001";
  const DEFAULT_BILL = { address: "Aevidine, Ahmedabad, Gujarat 380015, India", phone: "+91 90000 00000", gstin: "24AAAAA0000A1Z5" };
  const FOOTERS = {
    "pizza-palace": "Grazie — a presto! 🍕",
    "sakura-sushi": "Arigato — mata kite ne 🍣",
    "taco-fiesta": "¡Gracias — vuelve pronto! 🌮",
    "burger-barn": "Y'all come back now! 🍔",
    "spice-route": "Dhanyavaad — padharo! 🍛",
    "green-bowl": "Stay fresh — see you soon! 🥗",
  };
  return {
    isDefault,
    name: s.restaurant_name || (isDefault ? "Little French House" : (r.logo_text || (r.name && r.name.en) || "Restaurant")),
    address: s.restaurant_address || (isDefault ? "" : DEFAULT_BILL.address),
    phone: s.restaurant_phone || (isDefault ? "+91 90999 14418" : DEFAULT_BILL.phone),
    gstin: s.gstin || "", // NEVER fall back to a placeholder GSTIN — a fake tax number on a real bill is illegal. Empty prints no GSTIN line (templates handle it).
    prefix: s.invoice_prefix || "INV",
    footer: s.bill_footer || FOOTERS[r.slug] || (isDefault ? "Merci — see you again soon 🥐" : "Thank you — please visit again"),
    taxLabel: taxLabel(s),
  };
}
function billMath(orders) {
  const live = (orders || []).filter((o) => o.status !== "cancelled");
  const subtotal = live.reduce((a, o) => a + (parseFloat(o.subtotal) || 0), 0);
  const disc = live.reduce((a, o) => a + (parseFloat(o.discount) || 0), 0);
  const taxable = Math.max(0, subtotal - disc);
  const tm = taxModel(state.data.settings);
  const rate = tm.rate;
  const tax = Math.round(taxable * rate * 100) / 100;
  const total = Math.round((taxable + tax) * 100) / 100;
  // components carried through so the printed bill can itemise each named tax.
  return { subtotal, disc, taxable, rate, tax, total, taxComponents: tm.components };
}
function mergedOrderCardHtml(g) {
  const o0 = g[0];
  const tnum = (o0.table_number || "").trim();
  // Group key for pay/accept/serve/print/delete. MUST carry the "solo:" prefix for a
  // no-session order (e.g. a no-table banquet bill), because ordersInGroup() only treats
  // "solo:"-prefixed keys as a single order — a bare id fell into the session_id branch,
  // matched nothing, and the bill could never be settled (falsely said "already paid").
  const sessKey = o0.session_id || ("solo:" + o0.id);
  const live = g.filter((o) => o.status !== "cancelled");
  // Items grouped per source order with a separator between orders, so the merged
  // bill still reads as "order 1 / order 2" with some distance between them.
  // Allergens show PER ITEM: the order-wide "avoid X in all my dishes" is distributed
  // onto every item as "NO X" — there is NO shared/common allergy banner
  // (owner, 2026-06-14). Different orders keep their own per-item allergens.
  const items = g.map((o, gi) => {
    const oAll = Array.isArray(o.allergies) ? o.allergies : [];
    const rows = (o.items || []).map((i) => {
      const allerg = [...new Set([...(Array.isArray(i.removed) ? i.removed : []), ...oAll])];
      const parts = [];
      if (Array.isArray(i.options) && i.options.length) parts.push(i.options.map((x) => esc(x.label)).join(" · "));
      if (allerg.length) parts.push(`<span class="ol-no">NO ${allerg.map((r) => esc(r)).join(", NO ").toUpperCase()}</span>`);
      if (i.note) parts.push("“" + esc(i.note) + "”");
      const opts = parts.length ? `<div class="ord-line-opts">${parts.join(" · ")}</div>` : "";
      return `<div class="ord-line"><span class="ol-name">${esc(i.title)}${dishNoTag(i.title)}</span><span class="ol-qty">×${esc(i.qty)}</span><span class="ol-price">${inr(parseFloat(i.price) || 0)}</span>${opts}</div>`;
    }).join("");
    // No always-on allergen toggle chips here any more (owner, 2026-06-17) — each
    // dish line already shows its "NO X" removals, and adding/removing an allergen
    // now lives in the gated staff EDIT flow.
    return (gi > 0 ? `<div class="ord-grp-sep" aria-hidden="true"></div>` : "") + rows;
  }).join("");
  const _m = billMath(g); const total = _m.total; const disc = _m.disc;
  const anyReceived = g.some((o) => o.status === "received");
  const anyPreparing = g.some((o) => o.status === "preparing");
  const paid = live.length > 0 && live.every((o) => o.payment_status === "paid");
  const anyUnpaid = live.some((o) => o.payment_status !== "paid");
  const cls = anyReceived ? "received" : anyPreparing ? "preparing" : "served";
  const label = anyReceived ? "New order" : anyPreparing ? "Preparing" : "Served";
  const when = o0.created_at ? new Date(o0.created_at).toLocaleString() : "";
  const kots = g.map((o) => o.kot_no).filter((x) => x != null);
  // Stage action: accept the whole table, or serve the whole table.
  let stage = "";
  if (anyReceived) stage = `<button class="ord-btn accept" data-sess-accept="${esc(sessKey)}">✓ Accept &amp; Prepare</button>`;
  else if (anyPreparing) stage = `<button class="ord-btn serve" data-sess-serve="${esc(sessKey)}">🍽️ Mark Served</button>`;
  // Invoice-first flow: a running tab shows "Generate invoice"; once invoiced (locked)
  // it shows Mark paid + Print + Reopen(void). Invoice lives on the session.
  const sid = o0.session_id || null;
  const invNo = o0.invoice_no, invVoided = !!o0.invoice_voided;
  const invoiced = !!sid && invNo != null && !invVoided;
  let billBtns;
  if (sid && !invoiced) {
    // Running tab: Generate-invoice ONLY — no direct Print until an invoice exists
    // (owner 2026-07-24: print must not be available before the invoice is generated).
    billBtns = anyUnpaid ? `<button class="ord-btn invoice" data-gen-invoice="${esc(sid)}">🧾 Generate invoice</button>` : "";
  } else if (sid && invoiced) {
    const pay = anyUnpaid ? `<button class="ord-btn pay" data-sess-pay="${esc(sessKey)}"${anyReceived ? ' disabled title="Accept the order first — the bill can only be paid once accepted."' : ""}>💳 Mark paid</button>` : "";
    billBtns = pay + `<button class="ord-btn" data-print-group="${esc(sessKey)}">🖨 Print</button><button class="ord-btn ghost" data-void-invoice="${esc(sid)}">↩ Reopen</button><button class="ord-btn ghost" data-credit-note="${esc(sid)}" title="Refund/correct without changing the bill (issues a credit note)">🧾− Credit note</button>`;
  } else {
    // Legacy non-session order (no session to invoice): still honour invoice-first —
    // Print only once the bill is SETTLED (paid = finalised). Before that, Mark paid only,
    // so no naked Print appears next to a running tab (owner 2026-07-24).
    billBtns = anyUnpaid
      ? `<button class="ord-btn pay" data-sess-pay="${esc(sessKey)}"${anyReceived ? ' disabled title="Accept the order first — the bill can only be paid once accepted."' : ""}>💳 Mark paid</button>`
      : `<button class="ord-btn ghost" data-print-group="${esc("solo:" + o0.id)}">🖨 Print</button>`;
  }
  const tableDue = billMath(live.filter((o) => o.status !== "cancelled" && o.payment_status !== "paid")).total;
  const freeBtn = (tnum && paid)
    ? (tableDue === 0 ? `<button class="ord-btn free-table" data-free-table="${esc(tnum)}">🪑 Free table ${esc(tnum)}</button>` : "")
    : "";
  return `<div class="card ord-card ord-${cls} ${paid ? "is-paid" : ""}">
    <div class="ord-top">
      ${kots.length ? `<span class="kot-chip" title="Kitchen tickets">#${esc(kots[0])}${kots.length > 1 ? ` +${kots.length - 1}` : ""}</span>` : ""}
      <b>${tnum ? "Table " + esc(tnum) : "Walk-in / no table"}</b>
      <span class="ord-pill ${cls}">${label}</span>
      <span class="pay-pill ${paid ? "paid" : "pending"}">${paid ? "💳 Paid" : "⏳ Unpaid"}</span>
      ${invoiced ? `<span class="inv-chip" title="Tax invoice">${esc(invFmt(invNo, o0.invoice_at))}</span>` : (sid && invVoided ? `<span class="inv-chip voided">invoice voided</span>` : "")}
    </div>
    <small class="ord-when">${esc(when)}${g.length > 1 ? ` · ${g.length} orders merged` : ""}</small>
    <div class="ord-items">${items}</div>
    <div class="ord-sub"><span>Subtotal</span><span>${inr(_m.subtotal)}</span></div>
    ${disc > 0 ? `<div class="ord-disc">Discount<span>− ${inr(disc)}</span></div>` : ""}
    ${_m.tax > 0 ? `<div class="ord-sub"><span>${esc(taxLabel())} ${Math.round(_m.rate * 10000) / 100}%</span><span>${inr(_m.tax)}</span></div>` : ""}
    <div class="ord-total"><span>Total</span><span>${inr(total)}</span></div>
    <div class="ord-actions">${billBtns}${stage}${freeBtn}</div>
  </div>`;
}

// Group orders that belong together: same session_id → one bill. An order with no
// session_id stands alone (its own id is the key). Returns an array of groups.
function groupOrdersBySession(orders) {
  const map = new Map();
  orders.forEach((o) => {
    const key = o.session_id || ("solo:" + o.id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(o);
  });
  return [...map.values()];
}

// Pending waiter calls shown at the top of the Orders tab.
function callsHtml() {
  const calls = (state.data.calls || []).filter((c) => !c.resolved);
  if (!calls.length) return "";
  const rows = calls.map((c) => {
    const when = c.created_at ? new Date(c.created_at).toLocaleTimeString() : "";
    const REASON_EMOJI = {
      "Call waiter": "🙋", "Water": "💧", "Cutlery": "🍴",
      "Napkins": "🧻", "Clean table": "🧹", "Bring the bill": "🧾",
    };
    const reason = c.note ? esc(c.note) : "needs a waiter";
    const emoji = REASON_EMOJI[c.note] || "🔔";
    return `<div class="call-row">
      <span class="call-bell">${emoji}</span>
      <b>${c.table_number ? "Table " + esc(c.table_number) : "A guest"}</b>
      <span class="call-when">${reason} · ${esc(when)}</span>
      <button class="ord-btn serve" data-resolve="${esc(c.id)}">✓ Attended</button>
    </div>`;
  }).join("");
  return `<div class="calls-panel"><h3>🔔 Waiter calls (${calls.length})</h3>${rows}</div>`;
}

// ordersHtml: the Orders tab. A LEFT BAR switches the main panel between Live
// orders, Previous orders (which ARE the bills — past + cancelled), and waiter
// Calls. The header shows the live counts.
// Normalize the selected Orders view, mapping the old "live"/"bills" keys to the
// current "today"/"previous". Shared by the sidebar nav and the main view so they
// always agree on what's selected.
function ordersViewKey() {
  const v = state.ordersView;
  if (v === "today") return "live";      // legacy: the old Live row stored the key "today"
  if (v === "bills") return "previous";  // legacy alias
  if (v === "khata" && !tagActionAllowed("khata")) return "live"; // feature/power got switched off
  return ["live", "daybills", "previous", "calls", "khata"].includes(v) ? v : "live";
}
// A bill parked "collect later" (mig 166): unpaid + khata-marked. These live ONLY in
// the Khata view (the owner's "other section, other than live") — never in Live (they
// are archived) and not in Today/Previous either, so nobody double-collects from a
// normal list. Once collected they're paid and show as normal bill records again.
function isParkedKhata(o) { return !!o.khata_at && o.payment_status !== "paid" && o.status !== "cancelled"; }

// Split orders by DAY: TODAY's (live AND already-served, shown together) vs
// PREVIOUS (anything archived, cancelled, or older than today — the bill records),
// plus the count of unresolved waiter calls. ONE source of truth for both the
// sidebar nav counts and the main view, so they can never disagree.
// Start of TODAY's business day (05:00 IST) in ms — a faithful port of the server's
// lib/businessDay.ts so "Today" vs "Previous" lines up with the Z-report REGARDLESS of
// the device's timezone. The old version used setHours() (the browser's LOCAL 05:00), so
// a manager on a laptop/phone not set to IST mis-bucketed bills vs the server (owner-
// facing Today-total mismatch). Fixed to 05:00 Asia/Kolkata (UTC+05:30, no DST). (2026-07-03)
function businessDayStartMs() {
  const IST_OFFSET_MIN = 5 * 60 + 30;
  const ist = new Date(Date.now() + IST_OFFSET_MIN * 60000); // UTC fields now hold IST wall-clock
  const boundary = new Date(ist);
  boundary.setUTCHours(5, 0, 0, 0);                          // today's 05:00 in IST wall-clock
  if (ist.getTime() < boundary.getTime()) boundary.setUTCDate(boundary.getUTCDate() - 1); // before 05:00 → yesterday
  return boundary.getTime() - IST_OFFSET_MIN * 60000;        // back to real UTC ms
}
// A bill's whole session is DONE the moment every non-cancelled order on it is
// paid — that's the same "fully settled" check mergedOrderCardHtml already uses
// to show the Free-table button. Owner (2026-07-02): a bill shouldn't need the
// EXTRA manual "Free table" tap to count as finished — once it's fully paid it's
// done and belongs in Today, whether or not the table's been physically freed yet.
function fullyPaidSessionKeys(orders) {
  const keys = new Set();
  for (const g of groupOrdersBySession(orders.filter((o) => !o.archived))) {
    const live = g.filter((o) => o.status !== "cancelled");
    if (live.length && live.every((o) => o.payment_status === "paid")) keys.add(live[0].session_id || ("solo:" + live[0].id));
  }
  return keys;
}
function ordersBuckets() {
  const all = state.data.orders || [];
  const sessKey = (o) => o.session_id || ("solo:" + o.id);
  const paidKeys = fullyPaidSessionKeys(all);
  // LIVE = the active working set: not archived, not cancelled, and NOT a bill whose
  // whole table is already fully paid (that now counts as done — see above).
  // RECORDS = archived (freed) OR cancelled OR fully-paid — split by day into
  // TODAY (this business day) and PREVIOUS (older). "Restore to floor" (within its
  // 30-min window — migration 112) returns a bill from here back to Live.
  const live = all.filter((o) => !o.archived && o.status !== "cancelled" && !paidKeys.has(sessKey(o)) && !isParkedKhata(o));
  // "Show on-the-house bills in the normal lists" toggle (mig 166; default ON). When off,
  // comp bills live only in the On-the-house report — never counted or listed here.
  const hideOnHouse = lsGet("lfh_show_onhouse", "1") === "0";
  const records = all.filter((o) => (o.archived || o.status === "cancelled" || paidKeys.has(sessKey(o)))
    && !isParkedKhata(o)
    && !(hideOnHouse && o.payment_method === "On the house"));
  const dayStart = businessDayStartMs();
  const today = records.filter((o) => new Date(o.created_at || 0).getTime() >= dayStart);
  const previous = records.filter((o) => new Date(o.created_at || 0).getTime() < dayStart);
  const callCount = (state.data.calls || []).filter((c) => !c.resolved).length;
  return { live, today, previous, callCount };
}

function ordersHtml() {
  // The Today / Previous / Calls nav lives in the LEFT SIDEBAR now (see renderList).
  // Here we only build the heading + the selected view's cards in the main area.
  const { live, today, previous } = ordersBuckets();
  const active = live.filter((o) => o.status === "received" || o.status === "preparing").length;
  const view = ordersViewKey();

  let main;
  if (view === "previous") main = ordersPreviousHtml(previous, "previous");
  else if (view === "daybills") main = ordersPreviousHtml(today, "today");
  else if (view === "calls") main = ordersCallsHtml();
  else if (view === "khata") main = ordersKhataHtml();
  else main = ordersLiveHtml(live);

  const head = `<div class="ed-head">
      <h2>Bills <span class="sub">· ${active} cooking / ${live.length} live</span></h2>
      <button class="btn" id="refreshOrders">↻ Refresh</button>
    </div>`;
  return head + `<div class="ord-wrap"><div class="ord-main">${main}</div></div>`;
}

// LIVE view: current orders (newest stage first), grouped by table number, each
// an order card with its full item detail + accept/serve/pay actions. Keeps the
// bulk-select + "money owed" banner that staff rely on.
function ordersLiveHtml(live) {
  if (!live.length) return `<div class="empty">No active orders right now. Orders placed from the menu show up here.</div>`;
  // MERGE: a table's orders (same session) show as ONE card with one bill. New
  // session = new card. Groups are sorted by table number, newest order first.
  const groups = groupOrdersBySession(live).sort((a, b) =>
    String(a[0].table_number || "").localeCompare(String(b[0].table_number || ""), undefined, { numeric: true }));
  // "Pending bills" banner counts SESSIONS (merged bills) still unpaid, not orders.
  const unpaidGroups = groups.filter((g) => g.some((o) => o.status !== "cancelled" && o.payment_status !== "paid"));
  // Count ONLY the still-unpaid orders in each group — a session that's part-settled
  // (one order paid, another not) must not add its already-paid order to the total.
  const pendingTotal = unpaidGroups.reduce((s, g) => s + billMath(g.filter((o) => o.status !== "cancelled" && o.payment_status !== "paid")).total, 0);
  const note = unpaidGroups.length
    ? `<div class="ord-note">⏳ <b>Pending bills:</b> ${unpaidGroups.length} bill${unpaidGroups.length !== 1 ? "s" : ""} · ${inr(pendingTotal)} unpaid — mark each "Paid" once the guest settles up.</div>`
    : "";
  return note + `<div class="ord-grid">${groups.map((g) => mergedOrderCardHtml(g)).join("")}</div>`;
}

// PREVIOUS view: the bill records — freed/cleared orders AND cancelled orders,
// newest first. Each archived order gets an un-archive "restore"; each cancelled
// order gets a status-restore (back to received). This is where bills live now.
// TODAY / PREVIOUS: settled bill RECORDS as small cards (one per visit/session) —
// click a card to expand the full bill in a modal (Print / Restore). A search bar
// (by invoice/bill/table/customer/date, starts-with ranked first) + sort dropdown.
// loadBillHistory(q, type): server-side bills search for the Previous view — finds bills
// OLDER than the locally-cached 200 orders (owner, 2026-07-03). Debounced (300ms) so typing
// doesn't spray requests; each fetch takes a ticket so a slow older response can't overwrite
// a newer one. Results land in state.billHistRows and merge into the list (ordersPreviousHtml).
let _billHistSeq = 0, _billHistTimer = null;
function loadBillHistory(q, type) {
  clearTimeout(_billHistTimer);
  if (!q) { state.billHistRows = []; return; } // cleared search → drop server results, fall back to local
  _billHistTimer = setTimeout(async () => {
    const seq = ++_billHistSeq;
    try {
      const rows = await api("GET", `/orders?history=1&q=${encodeURIComponent(q)}&type=${encodeURIComponent(type || "inv")}`);
      if (seq !== _billHistSeq) return; // a newer search superseded this one
      state.billHistRows = Array.isArray(rows) ? rows : [];
      if (state.tab === "orders") renderEditor();
    } catch { /* leave prior results; the local-200 filter still works */ }
  }, 300);
}
function ordersPreviousHtml(previous, kind = "previous") {
  const isToday = kind === "today";
  // When searching the PREVIOUS view, union the locally-cached 200 orders with the
  // server-side history search results (state.billHistRows) so bills OLDER than the
  // 200-row window are findable too (owner, 2026-07-03 — old bills were unsearchable).
  // Dedup by order id; the existing filter/rank/sort below then applies to the union.
  let src = previous;
  if (kind === "previous" && (state.billSearch || "").trim() && Array.isArray(state.billHistRows) && state.billHistRows.length) {
    const byId = new Map((previous || []).map((o) => [o.id, o]));
    for (const o of state.billHistRows) if (!byId.has(o.id)) byId.set(o.id, o);
    src = [...byId.values()];
  }
  const groups = groupOrdersBySession(src);
  const bills = groups.map((g) => {
    const o0 = g[0];
    const total = billMath(g).total;
    // "paid" = every non-cancelled order on the bill is paid — the SAME rule the
    // Dashboard revenue (/stats) uses (payment_status='paid', cancelled excluded).
    // Only paid bills count toward the revenue total below, so a table freed WITHOUT
    // collecting payment no longer inflates the Bills total above the Dashboard.
    const liveOrders = g.filter((o) => o.status !== "cancelled");
    const paid = liveOrders.length > 0 && liveOrders.every((o) => o.payment_status === "paid");
    return {
      key: o0.session_id || ("solo:" + o0.id), table: (o0.table_number || "").trim(),
      billNo: o0.bill_no, invNo: o0.invoice_no, invoiceAt: o0.invoice_at, voided: !!o0.invoice_voided,
      customer: o0.customer_name || "", total, paid, ts: new Date(o0.created_at || 0).getTime(),
      when: o0.created_at ? new Date(o0.created_at).toLocaleString() : "",
      cancelled: g.every((o) => o.status === "cancelled"),
    };
  });
  const q = (state.billSearch || "").toLowerCase().trim();
  const stype = state.billSearchType || "date", sort = state.billSort || "new";
  const fieldOf = (b) => stype === "inv" ? String(invFmt(b.invNo, b.invoiceAt)).toLowerCase()
    : stype === "bill" ? String(b.billNo ?? "")
    : stype === "table" ? String(b.table)
    : stype === "cust" ? b.customer.toLowerCase()
    : stype === "amount" ? String(Math.round(Number(b.total) || 0)) // ₹ total, whole rupees
    : new Date(b.ts).toISOString().slice(0, 10);
  const matchB = (b) => !q || (stype === "date" ? fieldOf(b) === q : fieldOf(b).includes(q));
  const rankB = (b) => (!q ? 0 : fieldOf(b).startsWith(stype === "bill" ? q.replace(/[^0-9]/g, "") : q) ? 0 : 1);
  const list = bills.filter(matchB).sort((x, y) => (rankB(x) - rankB(y))
    || (sort === "new" ? y.ts - x.ts : sort === "old" ? x.ts - y.ts : sort === "hi" ? y.total - x.total : x.total - y.total));
  const bar = `<div class="bill-bar">
      <div class="bill-search">
        <select class="stype" data-bill-stype>
          <option value="inv"${stype === "inv" ? " selected" : ""}>Invoice no.</option>
          <option value="bill"${stype === "bill" ? " selected" : ""}>Bill no.</option>
          <option value="table"${stype === "table" ? " selected" : ""}>Table</option>
          <option value="amount"${stype === "amount" ? " selected" : ""}>Amount ₹</option>
          <option value="cust"${stype === "cust" ? " selected" : ""}>Customer</option>
          <option value="date"${stype === "date" ? " selected" : ""}>Date</option>
        </select>
        <span class="vline"></span><i class="fas fa-magnifying-glass"></i>
        <input type="${stype === "date" ? "date" : "text"}" data-bill-q value="${esc(state.billSearch || "")}" placeholder="Search bills…" autocomplete="off"/>
      </div>
      <select class="bill-sort" data-bill-sort>
        <option value="new"${sort === "new" ? " selected" : ""}>Newest</option>
        <option value="old"${sort === "old" ? " selected" : ""}>Oldest</option>
        <option value="hi"${sort === "hi" ? " selected" : ""}>Highest ₹</option>
        <option value="lo"${sort === "lo" ? " selected" : ""}>Lowest ₹</option>
      </select>
      <span class="bill-count">${list.length} bill${list.length === 1 ? "" : "s"} · ${inr(list.reduce((s, b) => s + (b.paid ? b.total : 0), 0))} collected</span>
    </div>`;
  const grid = list.length
    ? `<div class="bill-grid">${list.map(billCardHtml).join("")}</div>`
    : `<div class="empty">${q ? "No bills match that search." : (isToday ? "No bills settled today yet." : "No previous bills yet.")}</div>`;
  const headRow = `<div class="ord-section-divider"><h3>${isToday ? "📅 Today's bills" : "✓ Previous bills"}</h3>${isToday ? "" : `<button class="btn danger" id="clearFreed" title="Removes freed table records only; paid & cancelled bills are kept as records">🗑 Clear freed</button>`}</div>`;
  return headRow + bar + grid;
}
function billCardHtml(b) {
  const dot = b.cancelled ? "cancelled" : (b.voided ? "voided" : "paid");
  // 🖨 Print straight from the card (Today's + Previous bills) without opening it first —
  // owner ask 2026-07-06. Bottom-right so it clears the status dot (top-right); its own
  // click stops propagation so it prints WITHOUT also opening the bill modal.
  return `<div class="bill-card" data-bill-open="${esc(b.key)}">
    <span class="bill-dot ${dot}"></span>
    <div class="bill-bn">${b.table ? "Table " + esc(b.table) + " · " : ""}#${esc(b.billNo ?? "—")}</div>
    <div class="bill-cust">${esc(b.customer || "—")}</div>
    <div class="bill-amt">${inr(b.total)}</div>
    <div class="bill-when">${esc(b.when)}</div>
    ${b.invNo != null ? `<div class="bill-inv">${esc(invFmt(b.invNo, b.invoiceAt))}${b.voided ? " · voided" : ""}</div>` : ""}
    <button type="button" class="bill-print" data-bill-print="${esc(b.key)}" title="Print this bill" aria-label="Print bill" style="position:absolute;bottom:9px;right:11px;background:none;border:0;cursor:pointer;font-size:16px;opacity:.5;padding:3px;line-height:1">🖨</button>
  </div>`;
}
// The orders a bill modal can open from = the locally-cached board PLUS any server-side
// history search results (bills OLDER than the local 200-row window), deduped by id.
// Without the union, tapping a bill you FOUND by searching did nothing — openBillModal
// only looked in the local 200 (fixed 2026-07-06). The search rows carry the same columns
// (server selects orders.*), so the modal renders them identically.
function billOrdersPool() {
  const pool = (state.data.orders || []).slice();
  if (Array.isArray(state.billHistRows) && state.billHistRows.length) {
    const seen = new Set(pool.map((o) => o.id));
    for (const o of state.billHistRows) if (!seen.has(o.id)) pool.push(o);
  }
  return pool;
}
// Print a bill straight from its Today's/Previous card, without opening the modal first.
// Resolves the bill's orders exactly like openBillModal (cached board ∪ history search),
// so it works for searched OLDER bills too. (owner ask 2026-07-06)
function printBillFromKey(key) {
  const pool = billOrdersPool();
  const g = (key || "").startsWith("solo:")
    ? pool.filter((o) => o.id === key.slice(5))
    : pool.filter((o) => o.session_id === key);
  if (!g.length) { toast("Couldn't load that bill to print", "err"); return; }
  const o0 = g[0];
  printBill(o0.table_number, { invoice_no: o0.invoice_no, bill_no: o0.bill_no }, g);
}
// Expand one bill into a modal: full item list + totals + Print / Restore / Close.
// May the current viewer DELETE a bill? Admin + owner always (higherView); a real manager
// only when the owner ticked "Delete a bill" (server resolves it into whoami.canDeleteBill).
// Deleting a bill is the most destructive money action, so it defaults OFF (owner, 2026-07-24).
function canDeleteBillNow() {
  if (!XRAY_WHO) return false;
  if (XRAY_WHO.higherView) return true;
  return XRAY_WHO.canDeleteBill === true;
}

function openBillModal(key) {
  const pool = billOrdersPool();
  const g = (key || "").startsWith("solo:")
    ? pool.filter((o) => o.id === key.slice(5))
    : pool.filter((o) => o.session_id === key);
  if (!g.length) return;
  const o0 = g[0];
  const m = billMath(g);
  const pct = Math.round(m.rate * 10000) / 100; // e.g. 5
  // Receipt-style item rows: dish name · ×qty · add-ons/notes underneath · price right.
  // (owner 2026-06-26: the bill should read like a clean printable receipt — no invoice
  // number on screen; subtotal → discount in the middle → total at the bottom.)
  // Every dish gets a ✎ Edit (allergies/note) — regardless of status, a settled bill
  // included: allergen info is metadata, not money, so there's no reason to lock it
  // once a dish is served/paid (owner, 2026-07-03 — "allergy can be added to all items").
  // Render item lines from the SAME non-cancelled orders billMath uses for the total —
  // otherwise a cancelled order showed its priced items while the total (correctly)
  // excluded them, so the bill read "Litchi Cooler ₹229 … Total ₹0" (owner screenshot,
  // 2026-07-03). A fully-cancelled bill now shows a clear "cancelled" note instead.
  const liveOrders = g.filter((o) => o.status !== "cancelled");
  const lines = liveOrders.length
    ? liveOrders.map((o) => (o.items || []).map((i) => {
        const det = itemDetailLine(i);
        return `<div class="bm-line"><span class="bm-nm">${esc(i.title)} <span class="bm-q">×${esc(i.qty)}</span>${det}</span><span class="bm-line-right"><span class="bm-pr">${inr(parseFloat(i.price) || 0)}</span>${i.id ? `<button type="button" class="bm-edit-item" data-bm-edit-item="${esc(i.id)}" title="Edit allergies &amp; note">✎</button>` : ""}</span></div>`;
      }).join("")).join("")
    : `<div class="bm-line bm-cancelled"><span class="bm-nm">This bill was cancelled — no charge.</span></div>`;
  // Restore is only offered while EVERY order in this bill is still inside its
  // 30-min grace window (migration 112) — so this takes the MIN remaining time
  // across the group, not the max (code review before merge: showing the most
  // optimistic order's countdown could tell staff "5m left" on a bill restoreBill()
  // would immediately refuse because a different order in it had already expired).
  const restoreLeftMs = Math.min(...g.map((o) => restoreDeadline(o) - Date.now()));
  const canRestore = restoreLeftMs > 0;
  const restoreMins = Math.max(1, Math.ceil(restoreLeftMs / 60000));
  // A bill that landed here purely because it's fully paid (never actually freed)
  // still has an occupied table sitting on the floor — offer "Free table" right
  // here so staff don't have to hunt for it elsewhere (code review before merge).
  const stillOnFloor = g.some((o) => !o.archived) && !!(o0.table_number || "").trim();
  const wrap = document.createElement("div");
  wrap.className = "bill-overlay";
  wrap.innerHTML = `<div class="bill-modal">
      <div class="bm-head"><b>${o0.table_number ? "Table " + esc(o0.table_number) : "Walk-in"}${o0.bill_no != null ? ` · Bill #${esc(o0.bill_no)}` : ""}</b>${o0.invoice_voided ? `<span class="inv-chip voided">voided</span>` : ""}</div>
      <div class="bm-sub">${esc(o0.customer_name || "")}${o0.created_at ? " · " + esc(new Date(o0.created_at).toLocaleString()) : ""}</div>
      <div class="bm-items">${lines}</div>
      <div class="bm-totals">
        <div class="bm-trow"><span>Subtotal</span><span>${inr(m.subtotal)}</span></div>
        ${m.disc > 0 ? `<div class="bm-trow disc"><span>Discount</span><span>− ${inr(m.disc)}</span></div>` : ""}
        ${m.tax > 0 ? `<div class="bm-trow"><span>${esc(taxLabel())} ${pct}%</span><span>${inr(m.tax)}</span></div>` : ""}
        <div class="bm-trow grand"><span>Total</span><span>${inr(m.total)}</span></div>
      </div>
      <div class="bm-actions">
        <button class="btn primary" data-bm-print>🖨 Print</button>
        ${stillOnFloor ? `<button class="btn free-table" data-bm-free="${esc(o0.table_number)}">🪑 Free table ${esc(o0.table_number)}</button>` : ""}
        ${canRestore
          ? `<button class="btn" data-bm-restore title="Undo within the next ${restoreMins} min">↩ Restore to floor (${restoreMins}m left)</button>`
          : `<button class="btn" disabled title="More than 30 minutes have passed since this bill was settled">↩ Restore window expired</button>`}
        ${liveOrders.length === 0 && canDeleteBillNow() ? `<button class="btn danger" data-bm-delete title="Permanently delete this cancelled bill — cannot be undone">🗑 Delete bill</button>` : ""}
        <button class="btn confirm-cancel" data-bm-close>Close</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  const onEsc = (e) => { if (e.key === "Escape") close(); };
  const close = () => { wrap.classList.remove("show"); document.removeEventListener("keydown", onEsc); setTimeout(() => wrap.remove(), 180); };
  wrap.__lfhClose = close; // hardware Back → our close() (also removes the Esc listener), not a bare remove() that leaks it
  document.addEventListener("keydown", onEsc);
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  wrap.querySelector("[data-bm-close]").onclick = close;
  wrap.querySelector("[data-bm-print]").onclick = () => printBill(o0.table_number, { invoice_no: o0.invoice_no, bill_no: o0.bill_no }, g);
  const freeBtn = wrap.querySelector("[data-bm-free]");
  if (freeBtn) freeBtn.onclick = async () => { close(); await freeTable(freeBtn.dataset.bmFree); };
  const restoreBtn = wrap.querySelector("[data-bm-restore]");
  if (restoreBtn) restoreBtn.onclick = async () => { close(); await restoreBill(g); };
  // Delete a CANCELLED bill permanently (owner 2026-07-24). deleteOrders() itself REQUIRES a
  // typed reason (its prompt is the confirmation) and the server re-checks the delete_bill
  // grant, so a stale UI can never delete without permission.
  const delBtn = wrap.querySelector("[data-bm-delete]");
  if (delBtn) delBtn.onclick = async () => { close(); await deleteOrders(g.map((o) => o.id)); };
  // Re-open this SAME bill fresh after a dish edit, so the updated note/allergy chip
  // shows immediately. openDishEditModal's own save already calls loadSessions(), but
  // that's LIVE-floor-scoped — an ARCHIVED bill's order needs the full loadOrders()
  // too, or state.data.orders would still show the pre-edit removed/note here.
  wrap.querySelectorAll("[data-bm-edit-item]").forEach((b) => (b.onclick = () => openDishEditModal(b.dataset.bmEditItem, async () => { await loadOrders(); close(); openBillModal(key); })));
}

// CALLS view: the live waiter-call list (water/cutlery/bill…), or an empty note.
function ordersCallsHtml() {
  const calls = (state.data.calls || []).filter((c) => !c.resolved);
  if (!calls.length) return `<div class="empty">No waiter calls right now.</div>`;
  return callsHtml();
}

// ── Bills → Khata (pay later) + the On-the-house report — mig 166 ─────────────
// loadKhataBook(): fetch the person-grouped outstanding book + the comp-bill report
// in parallel. Cached on state; refreshed every time the view is opened (rare path,
// two scoped+limited reads — no polling).
const fmtDate = (ts) => ts ? new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
let _khataLoading = false;
async function loadKhataBook() {
  if (_khataLoading) return;
  _khataLoading = true;
  try {
    const [book, oh] = await Promise.all([
      api("GET", "/khata"),
      api("GET", "/onhouse?days=30").catch(() => null), // report is view_dashboard-gated; book may still be allowed
    ]);
    state.khataBook = book;
    state.onhouseReport = oh;
    state.khataLoadedAt = Date.now();
  } catch (e) {
    state.khataBook = { error: e.message, customers: [] };
  } finally {
    _khataLoading = false;
    if (state.tab === "orders" && ordersViewKey() === "khata") { renderList(); renderEditor(); }
  }
}

function ordersKhataHtml() {
  // (Re)load on open — stale after 30s or never loaded. The render below uses
  // whatever's cached meanwhile, so opening the tab never blanks the screen.
  if (!state.khataLoadedAt || Date.now() - state.khataLoadedAt > 30000) loadKhataBook();
  const book = state.khataBook;
  if (!book) return `<div class="empty">Loading Pay Later…</div>`;
  if (book.error) return `<div class="empty">Couldn't load Pay Later: ${esc(book.error)}</div>`;
  const allCust = book.customers || [];
  const q = (state.khataSearch || "").trim().toLowerCase();
  const customers = q
    ? allCust.filter((c) => (c.name || "").toLowerCase().includes(q) || (c.phone || "").toLowerCase().includes(q))
    : allCust;
  const peopleCount = allCust.length;

  // Summary bar — outstanding (liability), how many people owe, and what actually
  // came in today (by collection day). Tabular money so the digits line up.
  const summary = `<div class="khata-summary">
    <div class="khata-stat"><span class="ks-label">Outstanding</span><span class="ks-val">${inr(book.total || 0)}</span></div>
    <div class="khata-stat"><span class="ks-label">${peopleCount === 1 ? "Person owes" : "People owe"}</span><span class="ks-val">${peopleCount}</span></div>
    <div class="khata-stat"><span class="ks-label">Collected today</span><span class="ks-val ks-good">${inr(book.collectedToday || 0)}</span></div>
  </div>`;
  const searchBar = peopleCount
    ? `<input type="text" class="khata-search" id="khataViewSearch" placeholder="🔍 Search name or mobile…" maxlength="60" autocomplete="off" value="${esc(state.khataSearch || "")}">`
    : "";

  const bookHtml = customers.length ? customers.map((cst) => `
    <div class="card khata-group">
      <div class="khata-ghead">
        <div class="khata-gwho"><b>${esc(cst.name)}</b><small>${esc(cst.phone || "no mobile")}${cst.note ? " · " + esc(cst.note) : ""}</small></div>
        <div class="khata-gright"><span class="khata-due">${inr(cst.outstanding)}</span>${cst.bills.length > 1 ? `<button class="btn small ghost" data-khata-collectall="${esc(cst.id)}" data-khata-name="${esc(cst.name)}" data-khata-amount="${cst.outstanding}">Collect all</button>` : ""}</div>
      </div>
      ${cst.bills.map((bl) => `<div class="khata-bill">
        <span class="khata-bmeta">${bl.bill_no != null ? `<b>#${esc(String(bl.bill_no))}</b> · ` : ""}${esc(fmtDate(bl.khata_at))} · T${esc(String(bl.table_number || "?"))}</span>
        <b class="khata-bamt">${inr(bl.amount)}</b>
        <button class="btn small primary" data-khata-collect="${esc(bl.key)}" data-khata-session="${esc(bl.session_id || "")}" data-khata-order="${esc(bl.session_id ? "" : bl.key)}" data-khata-amount="${bl.amount}" data-khata-name="${esc(cst.name)}">Collect</button>
      </div>`).join("")}
    </div>`).join("")
    : (q
      ? `<div class="empty">No one matches “${esc(state.khataSearch)}”.</div>`
      : `<div class="empty">No pay-later bills right now. Settle a table with 📒 <b>Pay Later</b> and it lands here.</div>`);
  const head = summary + searchBar;
  // On-the-house report (last 30 days) + the "show in main lists" toggle. Report data
  // needs the dashboard power; the card explains itself when that's off.
  const oh = state.onhouseReport;
  const showOnHouse = lsGet("lfh_show_onhouse", "1") !== "0";
  const ohRows = oh && oh.bills && oh.bills.length
    ? `<table class="khata-oh-table"><tr><th>When</th><th>Table</th><th>Items</th><th>Would-be amount</th></tr>
       ${oh.bills.map((bl) => `<tr><td>${esc(fmtDate(bl.paid_at))}</td><td>T${esc(String(bl.table_number || "?"))}</td><td>${bl.items || "—"}</td><td class="khata-strike">${inr(bl.would_be)}</td></tr>`).join("")}</table>
       <div class="muted small" style="margin-top:8px">Last 30 days: <b>${oh.count} bill${oh.count === 1 ? "" : "s"} · ${inr(oh.total)}</b> given on the house.</div>`
    : `<div class="muted small">${oh ? "No on-the-house bills in the last 30 days." : "The on-the-house report needs the dashboard permission."}</div>`;
  const ohCard = `<div class="card khata-oh">
    <h3>🏠 On the house <span class="sub">· no-charge bills</span></h3>
    ${ohRows}
    <label class="khata-oh-toggle"><input type="checkbox" id="khataOhToggle" ${showOnHouse ? "checked" : ""}> Also show these bills inside Today / Previous lists</label>
  </div>`;
  return head + bookHtml + ohCard;
}

// freeTable: clear a settled table off the floor by archiving all its orders
// (they stay in the records, just hidden from the live view). Asks first.
async function freeTable(t) {
  const ids = (state.data.orders || []).filter((o) => !o.archived && (o.table_number || "").trim() === String(t)).map((o) => o.id);
  if (!ids.length) return;
  if (!(await confirmDialog(`Free Table ${t}? Its ${ids.length} settled order(s) leave the floor (kept in records).`, "Free table"))) return;
  try {
    for (const id of ids) await api("PATCH", "/orders/" + id, { archived: true });
    (state.data.orders || []).forEach((o) => { if (ids.includes(o.id)) o.archived = true; });
    renderEditor();
    toast(`Table ${t} freed`, "ok");
  } catch (e) { toast("Could not free: " + e.message, "err"); }
}

// The 30-minute grace window for undoing a settled bill (migration 112) — must
// match the server's RESTORE_WINDOW_MS in app/api/editor/[...path]/route.ts.
const RESTORE_WINDOW_MS = 30 * 60 * 1000;
function restoreDeadline(o) {
  // The server checks archived_at and cancelled_at as INDEPENDENT gates (an order
  // can be cancelled at one moment and freed at a later one), so the client must
  // take the EARLIEST of every gate that actually applies — not just one — or the
  // UI can show "N min left" for a leg the server will still 409 on (code review
  // before merge: this used to pick only ONE of archived_at/cancelled_at/paid_at).
  const deadlines = [];
  if (o.archived) deadlines.push(o.archived_at ? new Date(o.archived_at).getTime() + RESTORE_WINDOW_MS : 0);
  if (o.status === "cancelled") deadlines.push(o.cancelled_at ? new Date(o.cancelled_at).getTime() + RESTORE_WINDOW_MS : 0);
  if (!o.archived && o.status !== "cancelled" && o.payment_status === "paid") {
    deadlines.push(o.paid_at ? new Date(o.paid_at).getTime() + RESTORE_WINDOW_MS : 0);
  }
  return deadlines.length ? Math.min(...deadlines) : 0; // nothing settled → nothing to restore
}
function canStillRestore(o) { return Date.now() < restoreDeadline(o); }

// Bring a previous-order record back onto the live floor — un-archive it, revive
// a cancelled order to "received", or (owner, 2026-07-02) un-pay a bill that's in
// Today purely because it was fully paid (not yet freed) — whichever got it here.
// Only allowed within the 30-min window; the server enforces this too (belt +
// suspenders — panels have no auth today, so the real gate lives server-side).
async function restoreTable(id) {
  const o = (state.data.orders || []).find((x) => x.id === id);
  if (!o) return;
  if (!canStillRestore(o)) { toast("This bill was settled more than 30 minutes ago — it can no longer be restored.", "err"); return; }
  if (o.archived || o.status === "cancelled") {
    const patch = { archived: false };
    if (o.status === "cancelled") patch.status = "received";
    try {
      await api("PATCH", "/orders/" + id, patch);
      o.archived = false; if (patch.status) o.status = patch.status;
      renderEditor();
      toast("Restored to the live floor", "ok");
    } catch (e) {
      toast("Restore failed: " + e.message, "err");
    }
  } else if (o.payment_status === "paid") {
    // Fully-paid-only bill (never freed) — undo via the existing revert-paid flow,
    // which asks for a reason and logs it (theft control), same as "Mark unpaid".
    await setOrderPayment(id, false);
  }
}

// restoreBill: restore a WHOLE bill (every order in a session) as ONE atomic
// step, instead of looping restoreTable per order. That loop used to be able to
// pop one blocking window.prompt() PER paid order and leave the bill half
// reverted if one order's window had already expired while a sibling's hadn't,
// or if staff dismissed one of several prompts (code review before merge —
// a multi-round table could end up with money silently still marked "collected"
// on the un-reverted orders, with no further UI path back to it). Now: check
// EVERY order can still be restored before touching anything, ask for a revert
// reason ONCE for the whole bill, then apply every PATCH with that same reason.
async function restoreBill(orders) {
  if (!orders.length) return;
  if (!orders.every(canStillRestore)) {
    toast("Part of this bill was settled more than 30 minutes ago — it can no longer be restored.", "err");
    return;
  }
  const needsPaymentRevert = orders.some((o) => !o.archived && o.status !== "cancelled" && o.payment_status === "paid");
  let revertReason = null;
  if (needsPaymentRevert) {
    revertReason = ((await promptDialog("This bill is PAID — reverting it to unpaid is a refund/correction. Reason?", { confirmLabel: "Revert to unpaid", placeholder: "e.g. refund, wrong entry", required: true, presets: REASONS_REVERT })) || "").trim();
    if (!revertReason) { toast("Restore cancelled — a reason is required.", "err"); return; }
  }
  let okCount = 0, failCount = 0;
  for (const o of orders) {
    const patch = {};
    if (o.archived) patch.archived = false;
    if (o.status === "cancelled") patch.status = "received";
    if (!o.archived && o.status !== "cancelled" && o.payment_status === "paid") {
      patch.payment_status = "pending";
      patch.revert_reason = revertReason;
    }
    if (!Object.keys(patch).length) continue;
    try {
      await api("PATCH", "/orders/" + o.id, patch);
      if (patch.archived === false) o.archived = false;
      if (patch.status) o.status = patch.status;
      if (patch.payment_status) o.payment_status = patch.payment_status;
      okCount++;
    } catch (e) {
      failCount++;
    }
  }
  renderEditor();
  if (failCount) toast(`Restored ${okCount} of ${okCount + failCount} orders — ${failCount} failed, please retry`, "err");
  else toast("Bill restored to the live floor", "ok");
}

// setOrderStatus: move one order to a new status (e.g. Accept → preparing).
// OPTIMISTIC: the screen flips INSTANTLY and the server is told in the
// background; if the server refuses, we roll back and explain. This is what
// makes 20 clicks in a row feel real-time instead of 20 waits.
async function setOrderStatus(id, status) {
  const o = (state.data.orders || []).find((x) => x.id === id);
  const prev = o ? o.status : null;
  if (o) o.status = status;        // flip the screen NOW
  opBegin(id);                     // shield this order from the poll meanwhile
  renderEditor();
  renderTablePanel();
  try {
    await api("PATCH", "/orders/" + id, { status }); // sync in the background
    toast("Order updated → " + status, "ok");
  } catch (e) {
    if (o && prev !== null) o.status = prev;         // server said no -> undo
    renderEditor();
    renderTablePanel();
    toast("Could not update order: " + e.message, "err");
  } finally {
    opEnd(id);
  }
}

// cancelOrder: void one order (after confirming). If cancelling it leaves the
// table with NO active orders, offer to free the table in the same flow — so a
// cancelled, empty table doesn't sit open by mistake.
async function cancelOrder(id) {
  if (!(await confirmDialog("Cancel this order? It will be voided — no charge to the guest.", "Cancel order"))) return;
  await setOrderStatus(id, "cancelled");
  const o = (state.data.orders || []).find((x) => x.id === id);
  const t = (o && o.table_number ? o.table_number : "").trim();
  if (!t) return;
  // Any non-cancelled, non-archived order still live at this table?
  const stillActive = (state.data.orders || []).some((x) => !x.archived && (x.table_number || "").trim() === t && x.status !== "cancelled");
  if (!stillActive && (await confirmDialog(`Table ${t} has no active orders left. Free the table?`, "Free table"))) freeTable(t);
}

// deleteOrders: permanently delete orders — a single one, a selected batch, or
// every order (all=true). OPTIMISTIC: the cards vanish instantly; the server
// catches up in the background (and the rows return + an error shows if it
// fails). No more re-downloading all 200 orders just to delete one.
async function deleteOrders(ids, all = false, opts = {}) {
  const before = state.data.orders || [];
  // The server KEEPS settled (paid, not voided) bills — they're financial
  // records. Mirror that rule here so the optimistic view matches what actually
  // happens (otherwise a paid bill would vanish then reappear on the next poll).
  const isRecord = (o) => o.payment_status === "paid" && o.status !== "cancelled";
  const targetIds = all ? before.map((o) => o.id) : (ids || []);
  const gone = before.filter((o) => targetIds.includes(o.id) && !isRecord(o)).map((o) => o.id);
  if (!gone.length) { toast("Nothing to delete here (paid bills are kept as records).", "err"); return; }
  // Deleting a bill is permanent — REQUIRE a reason (owner 2026-07-23), with quick chips.
  // This prompt IS the confirmation (the callers no longer show a separate confirm dialog).
  // A programmatic caller can pass opts.reason to skip the prompt.
  const reason = (opts.reason
    || (await promptDialog(`Delete ${gone.length > 1 ? gone.length + " orders" : "this order"} permanently? Reason?`,
        { confirmLabel: "Delete", placeholder: "e.g. duplicate, mis-tap", required: true, danger: true, presets: REASONS_DELETE })) || "").trim();
  if (!reason) { toast("Delete cancelled — a reason is required.", "err"); return; }
  const goneSet = new Set(gone);
  state.data.orders = before.filter((o) => !goneSet.has(o.id));
  // (lastOrderCount is owned solely by reconcileBoard now, derived from the summary's
  //  live order_count — don't set it here from the full-list length or the two baselines
  //  would disagree and the next poll could fire a spurious "new order" chime.)
  gone.forEach((id) => pendingDeletes.add(id)); // poll must not resurrect them
  renderEditor();
  try {
    let r;
    if (all) r = await api("POST", "/orders/delete", { all: true, reason });
    else if (ids && ids.length === 1) r = await api("DELETE", "/orders/" + ids[0] + "?reason=" + encodeURIComponent(reason));
    else r = await api("POST", "/orders/delete", { ids, reason });
    const kept = r && r.kept ? r.kept : 0;
    toast(kept
      ? `Cleared ${gone.length} · kept ${kept} paid bill${kept > 1 ? "s" : ""} as records`
      : (all ? "All cleared" : "Order(s) deleted"), "ok");
  } catch (e) {
    state.data.orders = before;   // bring the rows back — the delete failed (e.g. a single paid bill: 409)
    renderEditor();
    toast(e.message, "err");
  } finally {
    gone.forEach((id) => pendingDeletes.delete(id));
  }
}

// setOrderPayment: flip one order between paid and unpaid.
// OPTIMISTIC like setOrderStatus: screen first, server second, undo on error.
// Marking PAID asks first ("has the money actually been collected?") so a stray
// tap can't record a payment that never happened. The bulk "settle whole table"
// path passes skipConfirm so it asks once, not per order.
// Returns true when the payment state was actually saved, false on cancel/failure — so a
// bulk caller (payOrdersWithMethod) can report an HONEST result instead of always toasting
// success even when the server refused an order (over-collection bug, 2026-07-06).
async function setOrderPayment(id, paid, opts = {}) {
  if (paid && !opts.skipConfirm) {
    if (!(await confirmDialog("Mark this order PAID? Only confirm if the payment has actually been collected.", "Yes, payment done"))) return false;
  }
  const o = (state.data.orders || []).find((x) => x.id === id);
  const prev = o ? o.payment_status : null;
  // Reverting an ALREADY-PAID bill is a refund/correction — require a reason
  // (the server logs it). Routine "mark unpaid" on a never-paid order is free.
  let revertReason = null;
  if (!paid && prev === "paid") {
    // The undo bar passes a canned reason so a mis-tap can be taken back in one tap
    // without a prompt; it's still logged as a payment_revert for the audit trail.
    revertReason = (opts.revertReason || "").trim()
      || ((await promptDialog("This bill is PAID — reverting it to unpaid is a refund/correction. Reason?", { confirmLabel: "Revert to unpaid", placeholder: "e.g. refund, wrong entry", required: true, presets: REASONS_REVERT })) || "").trim();
    if (!revertReason) { toast("Revert cancelled — a reason is required.", "err"); return false; }
  }
  if (o) o.payment_status = paid ? "paid" : "pending"; // flip the screen NOW
  opBegin(id);                     // shield this order from the poll meanwhile
  renderEditor();
  renderTablePanel();
  try {
    await api("PATCH", "/orders/" + id, {
      payment_status: paid ? "paid" : "pending",
      ...(revertReason ? { revert_reason: revertReason } : {}),
      ...(paid && opts.method ? { payment_method: opts.method, payment_note: opts.note || "" } : {}),
    });
    // The bulk "settle whole table" path passes quiet:true so we toast/undo once at the
    // end instead of once per order. For a single-order pay, the undo bar is the
    // confirmation + a few-second takeback (owner, 2026-07-22).
    if (!opts.quiet) {
      if (paid && window.LFH_UNDO) LFH_UNDO.show({ message: "Marked paid", sub: "Tap undo to reopen this bill", icon: "💳", seconds: 5, onUndo: () => editorUndoPay([id]) });
      else toast(paid ? "Marked paid 💳" : "Marked unpaid", "ok");
    }
    return true;
  } catch (e) {
    if (o && prev !== null) o.payment_status = prev;   // undo on failure
    renderEditor();
    renderTablePanel();
    if (!opts.quiet) toast("Could not update payment: " + e.message, "err");
    return false;
  } finally {
    opEnd(id);
  }
}

// openPaymentMethodModal(due, label): "how did they pay?" — UPI/Cash/Card, or Other
// with a short typed note. Picking a method IS the confirmation (no separate "are you
// sure?" step — the old confirmDialog is folded into this one tap). Resolves
// { method, note } once staff pick one, or null if they cancel; talks to nothing
// itself — payOrdersWithMethod below does the actual save. (owner, 2026-07-01)
function openPaymentMethodModal(due, label, opts = {}) {
  return new Promise((resolve) => {
    const r2 = (n) => Math.round(n * 100) / 100; let tip = 0;
    document.querySelector(".pay-overlay")?.remove();
    const wrap = el(`<div class="sx-modal-overlay pay-overlay"><div class="sx-modal pay-modal">
      <div class="tbl-modal-head"><div class="tp-detail-top"><h3>${esc(label)}</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div>
      <div class="dish-edit-body">
        <div class="disc-bill-row"><span>Bill</span><b>${inr(due)}</b></div>
        <div class="dish-edit-lbl" style="margin-top:6px">Add a tip? <span class="muted small">(optional — extra for staff, on top of the bill)</span></div>
        <div class="chips pay-tip-chips" style="margin:4px 0 6px">
          <span class="chip pay-tip-pick" data-tip-amt="0">None</span>
          <span class="chip pay-tip-pick" data-tip-amt="${r2(due * 0.05)}">5%</span>
          <span class="chip pay-tip-pick" data-tip-amt="${r2(due * 0.10)}">10%</span>
          <span class="chip pay-tip-pick" data-tip-amt="${r2(due * 0.15)}">15%</span>
        </div>
        <input type="number" inputmode="decimal" min="0" step="1" class="dish-edit-custominput" id="payTipInput" placeholder="Custom tip ₹" style="margin-bottom:8px">
        <div class="disc-bill-row"><span><b>Total collected</b></span><b id="payTotal">${inr(due)}</b></div>
        <div class="dish-edit-lbl">How did they pay? <span class="muted small">— only pick one if the money's actually in hand</span></div>
        <div class="pay-method-grid">
          <button type="button" class="pay-method-btn" data-method="UPI"><span class="pmi">📱</span>UPI</button>
          <button type="button" class="pay-method-btn" data-method="Cash"><span class="pmi">💵</span>Cash</button>
          <button type="button" class="pay-method-btn" data-method="Card"><span class="pmi">💳</span>Card</button>
          <button type="button" class="pay-method-btn" data-method="Other"><span class="pmi">⋯</span>Other</button>
          ${opts.onHouse ? `<button type="button" class="pay-method-btn pay-special-onhouse" data-special="onhouse"><span class="pmi">🏠</span>On the house</button>` : ""}
          ${opts.khata ? `<button type="button" class="pay-method-btn pay-special-khata" data-special="khata"><span class="pmi">📒</span>Pay Later</button>` : ""}
        </div>
        <div class="pay-other-field" style="display:none">
          <label class="dish-edit-lbl">What kind?</label>
          <input type="text" class="dish-edit-custominput" id="payOtherInput" maxlength="60" placeholder="e.g. wallet, bank transfer">
          <button type="button" class="btn primary pay-other-confirm">Confirm</button>
        </div>
        ${opts.crm === false ? "" : `
        <div class="pay-cust" style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)">
          <label class="dish-edit-lbl">📱 Save customer <span class="muted small">— optional, only if they agree</span></label>
          <div class="muted small" style="margin:-2px 0 6px">Lets you spot regulars and greet them by name next time.</div>
          <input type="tel" inputmode="numeric" class="dish-edit-custominput pay-cust-phone" maxlength="20" placeholder="Mobile number" style="margin-bottom:6px">
          <input type="text" class="dish-edit-custominput pay-cust-name" maxlength="80" placeholder="Name (optional)" style="margin-bottom:6px">
          <div class="pay-cust-chip" style="display:none;font-size:12.5px;font-weight:700;color:#16a34a;margin:0 0 6px"></div>
          <label style="display:flex;align-items:flex-start;gap:9px;font-size:12.5px;cursor:pointer">
            <input type="checkbox" class="pay-cust-consent" style="margin-top:2px;width:16px;height:16px;flex:none">
            <span>Customer agrees to save their name &amp; number to recognise their next visits. They can ask to remove it anytime.</span>
          </label>
        </div>`}
      </div>
      <div class="dish-edit-foot"><button type="button" class="btn dish-edit-cancel">Cancel</button></div>
    </div></div>`);
    document.body.appendChild(wrap);
    let resolved = false;
    const close = () => wrap.remove();
    // Read the optional customer fields at finish time (DPDP: only sent if consented).
    const readCust = () => {
      const pe = wrap.querySelector(".pay-cust-phone");
      if (!pe) return null;
      const ne = wrap.querySelector(".pay-cust-name"), ce = wrap.querySelector(".pay-cust-consent");
      const phone = (pe.value || "").trim();
      if (!phone || !(ce && ce.checked)) return null;
      return { phone, name: (ne?.value || "").trim(), consent: true };
    };
    const finish = (method, note) => { resolved = true; const cust = readCust(); close(); resolve({ method, note, tip, cust }); };
    const cancel = () => { close(); if (!resolved) resolve(null); };
    // Hardware BACK must cancel THIS sheet via cancel() (resolves the awaited promise as null),
    // not the adapter's bare remove() — else payOrdersWithMethod awaits forever and the bill is
    // silently never settled with no feedback.
    wrap.__lfhClose = cancel;
    wrap.querySelector(".tbl-modal-close").onclick = cancel;
    wrap.querySelector(".dish-edit-cancel").onclick = cancel;
    wrap.onclick = (e) => { if (e.target === wrap) cancel(); };
    wrap.querySelectorAll(".pay-method-btn").forEach((b) => (b.onclick = () => {
      // The two special settles (mig 166): resolve with a marker — the CALLER runs the
      // dedicated flow (person picker / no-charge settle); no payment method involved.
      if (b.dataset.special) { resolved = true; close(); resolve({ special: b.dataset.special }); return; }
      const m = b.dataset.method;
      if (m === "Other") {
        wrap.querySelector(".pay-method-grid").style.display = "none";
        wrap.querySelector(".pay-other-field").style.display = "";
        wrap.querySelector("#payOtherInput").focus();
        return;
      }
      finish(m, null);
    }));
    // Optional tip (additive — never touches the bill/tax/discount). Chips or a custom amount; the
    // "Total collected" figure updates live so staff know how much cash to take.
    const tipInput = wrap.querySelector("#payTipInput");
    const updTotal = () => { const el2 = wrap.querySelector("#payTotal"); if (el2) el2.textContent = inr(due + (Number(tip) || 0)); };
    wrap.querySelectorAll(".pay-tip-pick").forEach((c) => (c.onclick = () => { tip = Number(c.dataset.tipAmt) || 0; tipInput.value = tip ? String(tip) : ""; wrap.querySelectorAll(".pay-tip-pick").forEach((x) => x.classList.toggle("active", x === c)); updTotal(); }));
    tipInput.oninput = () => { tip = Math.max(0, Number(tipInput.value) || 0); wrap.querySelectorAll(".pay-tip-pick").forEach((x) => x.classList.remove("active")); updTotal(); };
    const otherInput = wrap.querySelector("#payOtherInput");
    const confirmOther = () => finish("Other", otherInput.value.trim());
    wrap.querySelector(".pay-other-confirm").onclick = confirmOther;
    otherInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); confirmOther(); } };

    // Repeat-customer recognition: known number → chip + pre-fill name. Read-only, debounced.
    const phoneEl = wrap.querySelector(".pay-cust-phone");
    if (phoneEl) {
      const nameEl = wrap.querySelector(".pay-cust-name");
      const chipEl = wrap.querySelector(".pay-cust-chip");
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
              chipEl.textContent = `✨ Repeat customer${v ? ` · visit #${v + 1}` : ""}${r.name ? ` · ${r.name}` : ""}`;
              chipEl.style.display = "";
              if (r.name && !nameEl.value.trim()) nameEl.value = r.name;
            } else { chipEl.style.display = "none"; }
          } catch { chipEl.style.display = "none"; }
        }, 400);
      });
    }
  });
}

// payOrdersWithMethod: the ONE shared "close this bill" flow — opens the payment-
// method modal, then marks every given order paid with the picked method. Used by
// all three real "mark a whole bill paid" entry points (table detail, Bills tab,
// session card), so a bill is never settled without a method recorded. The smaller
// PER-ORDER correction toggle (data-pay) stays a plain flip via setOrderPayment's
// own confirm — that's a fix-a-mistake action, not a new payment being collected.
async function payOrdersWithMethod(orders, label, opts = {}) {
  if (!orders.length) { toast("Nothing to settle — already paid", "ok"); return false; }
  // NEVER try to settle an order that hasn't been ACCEPTED yet: the server refuses to pay a
  // 'received' order (accept-before-pay), so including it inflated the "amount collected"
  // shown to staff AND left it unpaid while a blanket success toast still fired — the till
  // then read higher than the system recorded as paid (over-collection bug, 2026-07-06).
  // Drop un-accepted orders from BOTH the collected amount and the settle loop.
  const payable = orders.filter((o) => o.status !== "received");
  const skipped = orders.length - payable.length;
  if (!payable.length) {
    toast(skipped ? "Accept the new order first, then collect payment." : "Nothing to settle — already paid", skipped ? "err" : "ok");
    return false;
  }
  // "Amount collected" MUST equal the printed bill: billMath applies the discount
  // BEFORE tax. The old Σ(total − discount) taxed the pre-discount amount and told
  // staff to collect discount×rate too much on any discounted bill (2026-07-05 fix).
  const due = billMath(payable).total;
  const picked = await openPaymentMethodModal(due, label, opts);
  if (!picked) return false; // cancelled
  // A special settle (khata / on-the-house, mig 166): hand the marker back — the caller
  // runs the dedicated table-level flow; nothing gets marked paid here.
  if (picked.special) return picked;
  let okCount = 0, failCount = 0;
  const paidIds = [];
  for (const o of payable) {
    const done = await setOrderPayment(o.id, true, { skipConfirm: true, quiet: true, method: picked.method, note: picked.note });
    if (done) { okCount++; paidIds.push(o.id); } else failCount++;
  }
  // Store the optional tip on the first order that ACTUALLY settled (a bill's tip lives on one
  // order; it's separate from the bill total, so this never affects the money math). Before this
  // it went to payable[0] unconditionally — if that specific order failed to settle, the tip was
  // written to an unpaid order and the Z-report (which sums tips over PAID orders only) dropped it.
  // Best-effort — a tip failing to save must not undo a completed payment.
  if (paidIds.length && Number(picked.tip) > 0) { try { await api("POST", "/orders/" + paidIds[0] + "/tip", { amount: Number(picked.tip) }); } catch { /* tip is non-critical */ } }
  // Save the guest's consented name+number after the bill settles (Customer CRM). The
  // server stores nothing without consent + records one visit per session; fire-and-forget
  // so it never undoes a completed payment. Table comes from the orders we just settled.
  if (paidIds.length && picked.cust) {
    try {
      const t = payable[0] && payable[0].table_number;
      if (t != null) { const rc = await api("POST", "/customer-capture", { table: String(t), phone: picked.cust.phone, name: picked.cust.name, consent: picked.cust.consent === true }); if (rc && rc.ok) toast(`📇 Saved ${picked.cust.name || "customer"}`, "ok"); }
    } catch { /* best-effort; bill already paid */ }
  }
  // Report what ACTUALLY happened — never a blanket "paid" when the server refused some.
  if (okCount && !failCount) {
    const msg = skipped ? `Paid via ${picked.method} — ${skipped} new order still to accept` : `Marked paid via ${picked.method}`;
    // The undo bar is the confirmation + a few-second takeback (owner, 2026-07-22). The
    // revert goes through the SAME 30-min grace + audit-logged path as "restore to floor".
    if (paidIds.length && window.LFH_UNDO) LFH_UNDO.show({
      message: `Marked paid via ${picked.method}`,
      sub: skipped ? `${skipped} new order still to accept` : "Tap undo to reopen this bill",
      icon: "💳",
      seconds: 5,
      onUndo: () => editorUndoPay(paidIds),
    });
    else toast(msg + " 💳", "ok");
  }
  else if (okCount) toast(`Paid ${okCount}, but ${failCount} couldn't be settled — check the order.`, "err");
  else toast("Couldn't settle the payment — check the order.", "err");
  return okCount > 0;
}
// Take back a just-made payment: revert each order we settled back to unpaid, within the
// same 30-minute grace window the manual "restore to floor" uses, with a canned (still
// logged) reason so no prompt interrupts the one-tap undo (owner undo bar, 2026-07-22).
// Note: if paying auto-closed/archived the table (auto_table_action), this reverts payment
// but the fuller un-archive stays the manual "Restore to floor" tool's job.
async function editorUndoPay(paidIds) {
  let n = 0;
  for (const id of paidIds) {
    if (await setOrderPayment(id, false, { skipConfirm: true, quiet: true, revertReason: "Undo — mis-tap (within grace)" })) n++;
  }
  await loadSessions();
  toast(n ? "Payment undone" : "Couldn't undo — the 30-minute window may have passed.", n ? "ok" : "err");
}

// markTablePaid: settle the WHOLE table in one go — mark every unpaid (non-
// cancelled) order paid via payOrdersWithMethod. Used by the on-tile quick button
// AND the "Mark all paid" button in the table popup, so staff don't have to settle
// three orders separately.
async function markTablePaid(t) {
  await ensureTableSlice(t); // a non-selected table's orders aren't cached otherwise
  const os = ordersForTable(t).filter((o) => o.status !== "cancelled" && o.payment_status !== "paid");
  // The two special settles (mig 166) ride the SAME payment popup as extra buttons:
  // "On the house" only on a Family/Owner's-Guest table, "Collect later" whenever khata
  // is on for this viewer. Server re-checks both regardless of what the UI offered.
  const opts = {
    onHouse: ["family", "guest"].includes(tagForTable(t)) && tagActionAllowed("table_tags"),
    khata: tagActionAllowed("khata"),
  };
  const r = await payOrdersWithMethod(os, `Mark table ${t} paid`, opts);
  if (r && r.special === "khata") { await khataParkFlow(t, os); return; }
  if (r && r.special === "onhouse") { await onHouseSettle(t); return; }
  if (!r) return;
  // Every settled bill gets an invoice (owner 2026-07-24): auto-generate on settle if the
  // session isn't invoiced yet, so a paid bill always shows Print (never "Generate invoice").
  // Best-effort — a failed invoice must not undo the payment the staff just took.
  const sid = os[0] && os[0].session_id;
  if (sid) { try { const ss = (state.board.sessions || []).find((s) => s.id === sid); if (!ss || ss.invoice_no == null) await api("POST", `/sessions/${sid}/invoice`); } catch (e) { /* invoice stays generable from the bill */ } }
  await pollTables([String(t)]); // refresh this tile's summary → green pay ring / "Cleared"
}

// onHouseSettle(t): no-charge settle for a Family / Owner's-Guest table (mig 166).
// The server stores it as a 100% pre-tax discount + the reserved "On the house"
// method, so every money view reads ₹0 for it automatically.
async function onHouseSettle(t) {
  // Snapshot the orders being comped so a mis-tapped "on the house" can be taken back
  // (parity with the tablet, owner undo bar 2026-07-22).
  const ids = ordersForTable(t).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled").map((o) => o.id);
  try {
    const r = await api("POST", `/tables/${t}/on-the-house`, {});
    await pollTables([String(t)]);
    if (ids.length && window.LFH_UNDO) LFH_UNDO.show({
      message: "On the house — settled free",
      sub: `Table ${t} · tap undo to reopen the bill`,
      icon: "🏠",
      seconds: 5,
      onUndo: () => editorUndoOnHouse(ids),
    });
    else toast(`On the house 🏠 — ${r.count} order${r.count === 1 ? "" : "s"} settled at no charge`, "ok");
  } catch (e) { toast("Couldn't settle on the house: " + e.message, "err"); }
}
// Take back an "on the house": un-pay each comped order AND strip its 100% comp discount
// (discount was set to the subtotal), so the bill returns to a normal unpaid bill — not a
// ₹0-yet-unpaid one. Uses the same 30-min audited revert as mark-unpaid, plus the discount
// endpoint to clear the comp. (owner undo bar, 2026-07-22)
async function editorUndoOnHouse(ids) {
  let n = 0;
  for (const id of ids) {
    try {
      const ok = await setOrderPayment(id, false, { skipConfirm: true, quiet: true, revertReason: "Undo on-the-house (within grace)" });
      if (ok) { await api("POST", "/orders/" + id + "/discount", { amount: 0, note: "" }); n++; }
    } catch (e) { /* keep going; the reconcile shows truth */ }
  }
  await loadSessions();
  toast(n ? "On-the-house undone — bill reopened" : "Couldn't undo — the 30-minute window may have passed.", n ? "ok" : "err");
}

// khataParkFlow(t, orders): "Collect later" — pick (or add) the PERSON this bill is
// on, then park it: the table frees up and the bill lives in Bills → Khata until
// collected. The picker searches the restaurant's khata book by name or mobile.
async function khataParkFlow(t, orders) {
  const due = billMath((orders || []).filter((o) => o.status !== "received")).total;
  const who = await openKhataPersonPicker(due, t);
  if (!who) return; // cancelled
  try {
    const r = await api("POST", `/tables/${t}/khata`, who);
    toast(`📒 Parked on ${r.customer && r.customer.name ? r.customer.name : "their khata"} — collect later from Bills → Khata`, "ok");
    state.selectedTable = null; // the table just closed
    await loadSessions();
  } catch (e) { toast("Couldn't park the bill: " + e.message, "err"); }
}

// openKhataPersonPicker(due, t): search existing people (name/mobile, scoped + LIMIT 8
// server-side) or add a new one. Resolves { customer_id } | { name, phone, note } | null.
function openKhataPersonPicker(due, t) {
  return new Promise((resolve) => {
    document.querySelector(".khata-overlay")?.remove();
    const wrap = el(`<div class="sx-modal-overlay khata-overlay"><div class="sx-modal pay-modal">
      <div class="tbl-modal-head"><div class="tp-detail-top"><h3>Pay Later — who's this bill on?</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div>
      <div class="dish-edit-body">
        <div class="disc-bill-row"><span>Park Table ${esc(t)} bill</span><b>${inr(due)}</b></div>
        <input type="text" class="dish-edit-custominput" id="khataSearch" maxlength="60" placeholder="🔍 Search name or mobile…" autocomplete="off" style="margin:8px 0 6px">
        <div class="khata-pick-list" id="khataPickList"><div class="sx-empty">Type to search, or add a new person below.</div></div>
        <div class="dish-edit-lbl" style="margin-top:10px">— or add a new person —</div>
        <input type="text" class="dish-edit-custominput" id="khataName" maxlength="80" placeholder="Full name *" autocomplete="off" style="margin:4px 0 6px">
        <input type="tel" class="dish-edit-custominput" id="khataPhone" maxlength="20" placeholder="Mobile number (optional)" autocomplete="off" style="margin-bottom:6px">
        <input type="text" class="dish-edit-custominput" id="khataNote" maxlength="200" placeholder="Note (optional — e.g. neighbour, supplier)" autocomplete="off">
      </div>
      <div class="dish-edit-foot">
        <button type="button" class="btn dish-edit-cancel">Cancel</button>
        <button type="button" class="btn primary" id="khataParkBtn">📒 Pay Later — park on this person</button>
      </div>
    </div></div>`);
    document.body.appendChild(wrap);
    let resolved = false;
    let pickedId = null;
    const close = () => wrap.remove();
    const cancel = () => { close(); if (!resolved) resolve(null); };
    wrap.__lfhClose = cancel; // hardware back closes THIS sheet and resolves null
    wrap.querySelector(".tbl-modal-close").onclick = cancel;
    wrap.querySelector(".dish-edit-cancel").onclick = cancel;
    wrap.onclick = (e) => { if (e.target === wrap) cancel(); };
    const list = wrap.querySelector("#khataPickList");
    const search = wrap.querySelector("#khataSearch");
    const renderList = (customers) => {
      list.innerHTML = customers.length
        ? customers.map((cst) => `<button type="button" class="khata-pick-row${pickedId === cst.id ? " sel" : ""}" data-cid="${esc(cst.id)}"><b>${esc(cst.name)}</b><small>${esc(cst.phone || "no mobile")}${cst.note ? " · " + esc(cst.note) : ""}</small>${cst.outstanding > 0 ? `<span class="khata-pick-owes" title="Already owes">owes ${inr(cst.outstanding)}</span>` : ""}</button>`).join("")
        : `<div class="sx-empty">No one found — add them below.</div>`;
      list.querySelectorAll(".khata-pick-row").forEach((row) => (row.onclick = () => {
        pickedId = row.dataset.cid;
        list.querySelectorAll(".khata-pick-row").forEach((x) => x.classList.toggle("sel", x === row));
      }));
    };
    let seq = 0, timer = null;
    const doSearch = async () => {
      const mySeq = ++seq;
      try {
        const r = await api("GET", "/khata/customers?q=" + encodeURIComponent(search.value.trim()));
        if (mySeq === seq) renderList(r.customers || []); // latest-wins — a slow older reply never overwrites
      } catch { /* search is best-effort; the add-new fields still work */ }
    };
    search.oninput = () => { pickedId = null; clearTimeout(timer); timer = setTimeout(doSearch, 250); };
    doSearch(); // show the most recent people immediately
    wrap.querySelector("#khataParkBtn").onclick = () => {
      if (pickedId) { resolved = true; close(); resolve({ customer_id: pickedId }); return; }
      const name = wrap.querySelector("#khataName").value.trim();
      if (!name) { toast("Pick a person from the list, or type a name to add them.", "err"); return; }
      resolved = true; close();
      resolve({ name, phone: wrap.querySelector("#khataPhone").value.trim(), note: wrap.querySelector("#khataNote").value.trim() });
    };
  });
}

// openTagModal(t): mark / clear this table's special type (mig 166). One tap each.
function openTagModal(t) {
  document.querySelector(".tag-overlay")?.remove();
  const cur = tagForTable(t);
  const opt = (tag) => {
    const info = TABLE_TAG_INFO[tag];
    const subs = { vip: "Priority service · pays normally", family: `"On the house" offered at billing`, guest: `"On the house" offered at billing` };
    return `<button type="button" class="tag-opt tag-opt-${tag}${cur === tag ? " sel" : ""}" data-tag="${tag}"><span class="tago-ico">${info.emoji}</span><span>${esc(info.label)}<small>${esc(subs[tag])}</small></span></button>`;
  };
  const wrap = el(`<div class="sx-modal-overlay tag-overlay"><div class="sx-modal pay-modal">
    <div class="tbl-modal-head"><div class="tp-detail-top"><h3>Mark table ${esc(t)}</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div>
    <div class="dish-edit-body">
      <p class="muted small" style="margin:0 0 10px">How should staff treat this table? The mark clears itself when the table closes.</p>
      ${opt("vip")}${opt("family")}${opt("guest")}
      ${cur ? `<button type="button" class="tag-opt tag-opt-clear" data-tag=""><span class="tago-ico">✕</span><span>Remove mark</span></button>` : ""}
    </div>
  </div></div>`);
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.__lfhClose = close;
  wrap.querySelector(".tbl-modal-close").onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  wrap.querySelectorAll(".tag-opt").forEach((b) => (b.onclick = async () => {
    const tag = b.dataset.tag || null;
    close();
    // Optimistic: paint the tile NOW; the breadcrumb-driven refetch confirms it.
    const tile = (state.summary.tiles || {})[String(t)];
    const prev = tile ? tile.tag : undefined;
    if (tile) { tile.tag = tag || ""; renderEditor(); }
    try {
      await api("POST", `/tables/${t}/tag`, { tag });
      toast(tag ? `Marked ${TABLE_TAG_INFO[tag].emoji} ${TABLE_TAG_INFO[tag].label}` : "Mark removed", "ok");
      await pollTables([String(t)]);
    } catch (e) {
      if (tile) { tile.tag = prev || ""; renderEditor(); }
      toast("Couldn't mark the table: " + e.message, "err");
    }
  }));
}

// resolveCall: mark a waiter call as attended and drop it from the list.
// OPTIMISTIC: the call disappears instantly; restored if the server fails.
async function resolveCall(id) {
  const before = state.data.calls || [];
  state.data.calls = before.filter((c) => c.id !== id); // vanish NOW
  renderEditor();
  try {
    await api("PATCH", "/calls/" + id, { resolved: true });
    toast("Marked attended", "ok");
  } catch (e) {
    state.data.calls = before; // bring it back — the server didn't get it
    renderEditor();
    toast("Could not update call: " + e.message, "err");
  }
}

// ---------- render + bind ----------
// renderEditor: the heart of the screen. It looks at which tab is open and draws
// the matching panel into the #editor area, then wires up that panel's buttons.
// Think of it as a switchboard: tables → floor, log → log, orders → orders,
// otherwise → the edit form for the selected dish/category/filter/settings.
// ---------- Dashboard tab: the restaurant's numbers as graphs ----------
let dashCharts = []; // live Chart.js instances (destroyed before each redraw)

let dashRange = (() => { try { const v = localStorage.getItem("lfh_dash_range"); return ["today", "30d", "year"].includes(v) ? v : "today"; } catch { return "today"; } })(); // today | 30d | year — remembered across reloads
// The Today summary box: a live snapshot across every channel (dine-in tables +
// Zomato/Swiggy/takeaway live orders) and today's combined totals. Built from the
// `live` + `platformToday` fields the /stats endpoint adds.
function dashTodayBox(s) {
  const live = s.live || {}; const pt = s.platformToday || { count: 0, revenue: 0 };
  // Which platform channels are actually live for this restaurant (mig 209) — a restaurant not
  // on the delivery apps shouldn't show empty Zomato/Swiggy cards. Default all ON if the server
  // didn't say (older cache), so nothing vanishes unexpectedly.
  const ch = s.channelsOn || { zomato: true, swiggy: true, website: true, parcel: true };
  // The "Today" money card shows PAID-only revenue, so its order count must be the PAID
  // activity too (paid dine-in orders + accepted platform orders) — pairing paid-only ₹ with
  // an all-orders (incl. unpaid) count read inconsistently.
  const totalOrders = (s.paid || 0) + (pt.count || 0);
  const totalRev = (s.revenue || 0) + (pt.revenue || 0);
  const card = (cls, ico, lbl, n, meta) =>
    `<div class="tbox ${cls}"><span class="tbox-bar"></span><div class="tbox-top"><span class="tbox-ico"><i class="fas ${ico}"></i></span><span class="tbox-lbl">${lbl}</span></div><div class="tbox-n">${n}</div><div class="tbox-meta">${esc(meta)}</div></div>`;
  return `<div class="dash-today">
    <div class="dash-today-h">Right now <span class="sub">· live across every channel</span></div>
    <div class="dash-today-strip">
      ${card("dine", "fa-chair", "Dine-in", live.dineIn || 0, "tables running")}
      ${ch.zomato ? card("z", "fa-bolt", "Zomato", live.zomato || 0, "live orders") : ""}
      ${ch.swiggy ? card("s", "fa-bowl-food", "Swiggy", live.swiggy || 0, "live orders") : ""}
      ${ch.website ? card("t", "fa-globe", "Website", live.takeaway || 0, "live orders") : ""}
      ${ch.parcel ? card("p", "fa-bag-shopping", "Parcel", live.parcel || 0, "at the counter") : ""}
      ${card("tot", "fa-indian-rupee-sign", "Today", inr(totalRev), totalOrders + " paid orders")}
    </div>
  </div>`;
}
// ── Guest ratings (mig 140): the manager's view of diner star-ratings, gated by
// the view_ratings power. Fetch + acknowledge/note; scoped to this restaurant server-side.
const RCHIP = "display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:rgba(127,127,127,.12)";
function ratingStars(n) {
  return `<span style="color:#f5a623;letter-spacing:1px">${"★".repeat(n)}<span style="color:var(--line)">${"★".repeat(5 - n)}</span></span>`;
}
async function loadRatings() {
  const body = document.getElementById("ratingsBody");
  if (!body) return;
  if (!state.ratingsFilter) state.ratingsFilter = "all";
  try {
    const only = state.ratingsFilter === "unhandled" ? "?filter=unhandled" : "";
    renderRatings(await api("GET", "/ratings" + only));
  } catch (e) {
    body.innerHTML = `<div class="empty">Couldn't load ratings. ${esc(e.message || "")}</div>`;
  }
}
function renderRatings(d) {
  const body = document.getElementById("ratingsBody");
  if (!body) return;
  const s = d.summary || { total: 0, avg: 0, dist: [0, 0, 0, 0, 0], unhandled: 0 };
  const rows = d.ratings || [];
  const bars = [5, 4, 3, 2, 1].map((star) => {
    const c = s.dist[star - 1] || 0, pct = s.total ? Math.round((c / s.total) * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:12.5px"><span style="width:12px;text-align:right">${star}</span><span style="color:#f5a623">★</span><span style="flex:1;height:8px;background:var(--line);border-radius:5px;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:#f5a623"></span></span><span style="width:34px;text-align:right;color:var(--muted)">${c}</span></div>`;
  }).join("");
  const summaryHtml = s.total
    ? `<div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center;margin-bottom:16px"><div style="text-align:center;min-width:110px"><div style="font-size:40px;font-weight:800;line-height:1">${(s.avg || 0).toFixed(1)}</div><div style="font-size:18px">${ratingStars(Math.round(s.avg))}</div><div style="font-size:12.5px;color:#888;margin-top:2px">${s.total} rating${s.total === 1 ? "" : "s"}</div></div><div style="flex:1;min-width:200px">${bars}</div></div>`
    : "";
  const filterHtml = `<div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn ${state.ratingsFilter === "all" ? "primary" : ""}" data-rfilter="all">All</button><button class="btn ${state.ratingsFilter === "unhandled" ? "primary" : ""}" data-rfilter="unhandled">To handle · ${s.unhandled || 0}</button></div>`;
  const cards = rows.length ? rows.map((r) => {
    const col = r.rating <= 2 ? "#e5484d" : r.rating === 3 ? "#f59e0b" : "#16a34a";
    const when = new Date(r.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return `<div style="border-left:4px solid ${col};background:var(--panel,#fff);border:1px solid var(--line,#e5e7eb);border-radius:12px;padding:12px;margin-bottom:10px;opacity:${r.acknowledged ? 0.72 : 1}">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:15px">${ratingStars(r.rating)}</span>
        ${r.table_number ? `<span style="${RCHIP}">Table ${esc(String(r.table_number))}</span>` : ""}
        ${r.acknowledged ? `<span style="${RCHIP};color:#16a34a">handled</span>` : ""}
        <span style="margin-left:auto;display:flex;gap:6px">
          <button class="btn" data-rnote="${r.id}">✎ Note</button>
          ${r.acknowledged ? `<button class="btn" data-rack="${r.id}" data-val="0">↺ Reopen</button>` : `<button class="btn primary" data-rack="${r.id}" data-val="1">✓ Mark handled</button>`}
        </span>
      </div>
      ${r.comment ? `<p style="margin:8px 0 0;font-size:13px;line-height:1.5;overflow-wrap:anywhere;word-break:break-word">“${esc(r.comment)}”</p>` : ""}
      <div style="margin-top:8px;font-size:12px;color:#888;overflow-wrap:anywhere">${r.name ? `<b>${esc(r.name)}</b>` : "Guest"} · ${esc(when)}${r.acknowledged && r.acknowledged_by ? ` · handled by ${esc(r.acknowledged_by)}` : ""}</div>
      ${r.staff_note ? `<div style="margin-top:8px;font-size:12.5px;background:rgba(127,127,127,.08);border-radius:8px;padding:6px 9px;overflow-wrap:anywhere">📝 ${esc(r.staff_note)}</div>` : ""}
      <div data-rnoterow="${r.id}" hidden style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><input class="search" style="flex:1;min-width:180px" maxlength="500" placeholder="Internal note" value="${esc(r.staff_note || "")}"/><button class="btn primary" data-rnotesave="${r.id}">Save</button></div>
    </div>`;
  }).join("") : `<div class="empty">${state.ratingsFilter === "unhandled" ? "Nothing left to handle 🎉" : "No guest ratings yet."}</div>`;
  body.innerHTML = summaryHtml + filterHtml + cards;
  body.querySelectorAll("[data-rfilter]").forEach((b) => (b.onclick = () => { state.ratingsFilter = b.dataset.rfilter; loadRatings(); }));
  body.querySelectorAll("[data-rack]").forEach((b) => (b.onclick = async () => {
    // Carry any note the user typed into the SAME request so pressing "Mark handled"
    // (instead of the note's own Save) no longer discards it. The note input is always
    // rendered pre-filled with the saved note, so sending it when untouched is a no-op.
    const noteRow = body.querySelector(`[data-rnoterow="${b.dataset.rack}"]`);
    const noteInput = noteRow ? noteRow.querySelector("input") : null;
    const payload = { id: b.dataset.rack, acknowledged: b.dataset.val === "1" };
    if (noteInput) payload.note = noteInput.value;
    try { await api("POST", "/ratings/ack", payload); loadRatings(); } catch (e) { toast("Failed: " + e.message, "err"); }
  }));
  body.querySelectorAll("[data-rnote]").forEach((b) => (b.onclick = () => { const row = body.querySelector(`[data-rnoterow="${b.dataset.rnote}"]`); if (row) row.hidden = !row.hidden; }));
  body.querySelectorAll("[data-rnotesave]").forEach((b) => (b.onclick = async () => { const row = body.querySelector(`[data-rnoterow="${b.dataset.rnotesave}"]`); const val = row ? row.querySelector("input").value : ""; try { await api("POST", "/ratings/ack", { id: b.dataset.rnotesave, note: val }); loadRatings(); } catch (e) { toast("Failed: " + e.message, "err"); } }));
}
async function loadDashboard(useCache) {
  const body = document.getElementById("dashBody");
  if (!body) return;
  // Latest-wins guard (the app's standard stale-refresh fix): a fast tab+range
  // double-click used to interleave two runs — the older one rebuilt the DOM
  // mid-flight and Chart.js threw "can't acquire context".
  const seq = (loadDashboard._seq = (loadDashboard._seq || 0) + 1);
  let s;
  // useCache: a pure REDRAW (e.g. light/dark theme flip) — re-render the SAME data with the
  // new colours instead of re-running the heavy /stats scan. Only when we have data for the
  // current range cached; otherwise fall through to a real fetch.
  if (useCache && loadDashboard._last && loadDashboard._lastRange === dashRange) {
    s = loadDashboard._last;
  } else {
    try { s = await api("GET", "/stats?range=" + dashRange); }
    catch (e) { if (seq === loadDashboard._seq) body.innerHTML = `<div class="empty">Couldn't load stats: ${esc(e.message)}</div>`; return; }
    if (seq !== loadDashboard._seq) return;
    loadDashboard._last = s; loadDashboard._lastRange = dashRange;
  }
  // If the owner switched tabs during the async /stats fetch, #dashBody is detached — bail before
  // rendering + drawing Chart.js onto a null canvas (rapid tab-switching threw getContext-of-null).
  if (state.tab !== "dash") return;
  const RL = { today: "today", "30d": "last 30 days", year: "last 12 months" };
  const rangeLabel = RL[dashRange] || dashRange;
  // The range sub-nav lives in the LEFT SIDEBAR (renderList), so the content is
  // full-width: the Today view leads with the live per-channel summary box.
  const summary = dashRange === "today" ? dashTodayBox(s) : "";
  // KPI cards (redesign 2026-07-05): icon chip + big number + a helping sub-line,
  // derived ONLY from fields /stats already returns — no new reads. Every card is
  // a BUTTON that opens its detail (owner's rule: no dead stat tiles), and no card
  // repeats a number another card's sub-line already states.
  const kpi = (id, icon, tint, label, value, sub, opts = {}) => `
    <button class="dash-card${opts.alert ? " kalert" : ""}" data-kpi="${id}" type="button" title="Open detail">
      <span class="kic" style="background:${tint}22;color:${tint}"><i class="fa-solid ${icon}"></i></span>
      <span class="kbody"><small>${label}</small><b>${value}</b></span>
      <span class="ksub">${sub}</span>
      <i class="fa-solid fa-chevron-right kgo" aria-hidden="true"></i>
    </button>`;
  // Crazy-dashboard v2 (owner, 2026-07-05): honest deltas, sparkline, narration,
  // day-parts, channel split, weekday×hour heatmap — every number the server
  // already sends, spelled out with context so nothing reads "blunt".
  const pctOf = (n, total) => { const p = (n / total) * 100; return p > 0 && p < 1 ? "<1" : String(Math.round(p)); };
  const CMP_LABEL = { today: "vs yesterday till this time", "30d": "vs the 30 days before (same point)", year: "vs last year (same point)" };
  const cmpLabel = CMP_LABEL[dashRange] || "vs the period before";
  // lowerIsBetter: for a "bad" metric (e.g. cancellations) a RISE should read as bad (red),
  // not green — so the COLOUR reflects good/bad while the ARROW still shows the real
  // direction. (Was direction-agnostic: more cancellations showed a green up chip — 2026-07-06.)
  const deltaChip = (nowV, prevV, lowerIsBetter) => {
    if (prevV == null || (!nowV && !prevV)) return "";
    if (!prevV) return `<span class="kchip ${lowerIsBetter ? "dn" : "up"}" title="${cmpLabel}"><i class="fa-solid fa-arrow-up"></i>new</span>`;
    const p = Math.round(((nowV - prevV) / prevV) * 100);
    if (Math.abs(p) < 1) return `<span class="kchip flat" title="${cmpLabel}">±0%</span>`;
    const rising = p > 0, good = lowerIsBetter ? !rising : rising, label = p >= 300 ? `${Math.round(nowV / prevV)}×` : `${Math.abs(p)}%`;
    return `<span class="kchip ${good ? "up" : "dn"}" title="${cmpLabel}"><i class="fa-solid fa-arrow-${rising ? "up" : "down"}"></i>${label}</span>`;
  };
  const sparkSvg = (pts, color) => {
    if (!Array.isArray(pts) || pts.length < 2 || !pts.some((v) => v > 0)) return "";
    const w = 64, h = 22, lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1, step = w / (pts.length - 1);
    const d = pts.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - ((v - lo) / span) * (h - 3) - 1.5).toFixed(1)}`).join(" ");
    return `<svg class="kspark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/></svg>`;
  };
  const peakHour = (s.hours || []).some((v) => v > 0) ? (s.hours || []).indexOf(Math.max(...s.hours)) : -1;
  const topDish = (s.topDishes || [])[0];
  const prev = s.prev || {};
  const disc = s.discounts || { total: 0, count: 0, max: null };
  const chan = s.channels || {};
  // "Online / off-premise" = every non-dine-in channel: the delivery apps + website + counter parcels.
  const onlineRev = (chan.zomato?.rev || 0) + (chan.swiggy?.rev || 0) + (chan.takeaway?.rev || 0) + (chan.parcel?.rev || 0);
  const onlineCnt = (chan.zomato?.count || 0) + (chan.swiggy?.count || 0) + (chan.takeaway?.count || 0) + (chan.parcel?.count || 0);
  const revSub = [
    s.paid ? `avg <b>${inr(s.avgOrder)}</b>/bill` : "no paid bills yet",
    s.taxCollected > 0 ? `tax <b>${inr(s.taxCollected)}</b>` : "",
    s.biggestBill ? `biggest <b>${inr(s.biggestBill.amt)}</b>${s.biggestBill.table ? ` (T${esc(s.biggestBill.table)})` : ""}` : "",
  ].filter(Boolean).join(" · ");
  const ordSub = [
    `<b>${s.paid}</b> paid · <b>${s.unpaid}</b> unpaid`,
    onlineCnt > 0 ? `avg ticket: dine-in <b>${inr(s.avgOrder)}</b> · online <b>${inr(onlineRev / onlineCnt)}</b>` : "",
  ].filter(Boolean).join("<br>");
  const heatRows = (s.heatmap || []);
  const hasHeat = heatRows.some((r) => r.some((v) => v > 0));
  const freshT = new Date(s.updatedAt || Date.now()).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  // Plain-English narration (the Square trick): say what happened in one sentence.
  let narrate = "";
  if (s.revenue > 0) {
    const when = dashRange === "today" ? `Today till ${freshT}` : dashRange === "30d" ? "The last 30 days" : "The last 12 months";
    let cmp = "";
    if (prev.revenue > 0) {
      const p = Math.round(((s.revenue - prev.revenue) / prev.revenue) * 100);
      cmp = p >= 300 ? ` — <b>${Math.round(s.revenue / prev.revenue)}×</b> ${cmpLabel}`
        : Math.abs(p) >= 1 ? ` — <b>${Math.abs(p)}% ${p > 0 ? "more" : "less"}</b> ${cmpLabel}` : ` — level ${cmpLabel}`;
    }
    const dpTop = (s.dayParts || []).filter((d) => d.revenue > 0).sort((a, b) => b.revenue - a.revenue)[0];
    narrate = `<div class="narrate"><i class="fa-solid fa-wand-magic-sparkles"></i>${when} you've made <b>${inr(s.revenue)}</b>${cmp}.${dpTop ? ` ${esc(dpTop.label.split(" ")[0])} brought ${pctOf(dpTop.revenue, s.revenue)}% of it.` : ""}</div>`;
  }
  body.innerHTML = `
    ${summary}
    <div class="dash-fresh"><i class="fa-solid fa-clock-rotate-left"></i> Updated ${freshT} · deltas ${cmpLabel}</div>
    ${s.truncated ? `<div class="dash-fresh" style="background:color-mix(in srgb,var(--gold) 13%,transparent);color:var(--gold-strong);border:1px solid color-mix(in srgb,var(--gold) 33%,transparent)" role="note"><i class="fa-solid fa-circle-info"></i> Showing the most recent ${Number(s.statsCap || 5000).toLocaleString()} orders — this range has more, so these totals (and the menu winners) read a little low for now. Penny-exact full-range totals are coming.</div>` : ""}
    <div class="dash-cards">
      ${kpi("revenue", "fa-indian-rupee-sign", "#b97f35", `Revenue · ${rangeLabel}`, `<span data-cu="${s.revenue}" data-cu-fmt="inr">${inr(s.revenue)}</span>${deltaChip(s.revenue, prev.revenue)}${sparkSvg((s.series || []).map((p) => p.revenue), "#b97f35")}`, revSub)}
      ${kpi("orders", "fa-utensils", "#2a78d6", "Orders", `<span data-cu="${s.orderCount}">${s.orderCount}</span>${deltaChip(s.orderCount, prev.orders)}`, ordSub)}
      ${kpi("peak", "fa-clock", "#168e5d", `Busiest hour${dashRange === "today" ? " so far" : ""}`, peakHour < 0 ? "—" : `${peakHour}:00`, peakHour < 0 ? "no orders yet" : `<b>${s.hours[peakHour]}</b> order${s.hours[peakHour] === 1 ? "" : "s"} in that hour`)}
      ${kpi("given", "fa-tag", "#a86e00", "Given away", `<span data-cu="${disc.total}" data-cu-fmt="inr">${inr(disc.total)}</span>`, disc.count ? `discounts on <b>${disc.count}</b> bill${disc.count === 1 ? "" : "s"}${s.revenue > 0 ? ` (${pctOf(disc.total, s.revenue + disc.total)}% given up)` : ""}${disc.max ? `<br>largest <b>${inr(disc.max.amt)}</b>${disc.max.table ? ` on T${esc(disc.max.table)}` : ""}` : ""}` : "no discounts — full price all round")}
      ${kpi("cancelled", "fa-ban", "#b34a4a", "Lost to cancellations", `<span data-cu="${s.cancelledValue || 0}" data-cu-fmt="inr">${inr(s.cancelledValue || 0)}</span>${deltaChip(s.cancelled, prev.cancelled, true)}`, s.cancelled ? `<b>${s.cancelled}</b> cancelled order${s.cancelled === 1 ? "" : "s"} — tap to inspect` : "none — clean sheet", { alert: s.cancelled > 0 })}
    </div>
    <div class="dash-grid">
      <div class="dash-chart wide"><h4>Sales <span>· ${rangeLabel} — click a point to open those bills</span></h4><div class="chart-wrap tall"><canvas id="chSales"></canvas></div>${narrate}</div>
      <div class="dash-chart"><h4>Day parts <span>· where the money comes in</span></h4><div class="chart-wrap"><canvas id="chDay"></canvas></div></div>
      <div class="dash-chart"><h4>Channels <span>· dine-in vs delivery apps — tap a row to hide it</span></h4>
        <div class="pay-split">
          <div class="pay-donut"><canvas id="chChan"></canvas><div class="pay-center" id="chanCenter"></div></div>
          <div class="pay-legend" id="chanLegend"></div>
        </div>
      </div>
      ${hasHeat ? `<div class="dash-chart wide"><h4>When is this place actually busy? <span>· ${rangeLabel}, weekday × hour — plan shifts with this</span></h4><div class="hm" id="hmGrid"></div></div>` : ""}
      <div class="dash-chart"><h4>Top dishes <span>· plates sold</span></h4><div class="chart-wrap"><canvas id="chTop"></canvas></div></div>
      <div class="dash-chart"><h4>Busy hours <span>· orders by hour</span></h4><div class="chart-wrap"><canvas id="chHours"></canvas></div></div>
      <div class="dash-chart"><h4>Category share <span>· by plates</span></h4>
        <div class="pay-split">
          <div class="pay-donut"><canvas id="chCats"></canvas><div class="pay-center" id="catCenter"></div></div>
          <div class="pay-legend" id="catLegend"></div>
        </div>
      </div>
      <div class="dash-chart"><h4>Payment methods <span>· ${rangeLabel}</span></h4>
        <div class="pay-split">
          <div class="pay-donut"><canvas id="chPay"></canvas><div class="pay-center" id="payCenter"></div></div>
          <div class="pay-legend" id="payLegend"></div>
        </div>
      </div>
    </div>`;
  // KPI click-through: each card jumps to where that number lives in full detail.
  const goBills = (view) => { state.ordersView = view; lsSet("lfh_editor_ordersview", view); setTab("orders"); };
  const KPI_GO = {
    revenue: () => goBills(dashRange === "today" ? "daybills" : "previous"),
    orders: () => goBills("live"),
    given: () => goBills(dashRange === "today" ? "daybills" : "previous"),
    cancelled: () => goBills("previous"),
    peak: () => document.getElementById("chHours")?.closest(".dash-chart")?.scrollIntoView({ behavior: "smooth", block: "center" }),
  };
  body.querySelectorAll("[data-kpi]").forEach((b) => (b.onclick = () => KPI_GO[b.dataset.kpi]?.()));
  // Count-up: the big numbers roll from 0 to their value in ~½s (respects reduced motion).
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    body.querySelectorAll("[data-cu]").forEach((el2) => {
      const end = Number(el2.dataset.cu) || 0;
      if (!end) return;
      const fmt = el2.dataset.cuFmt === "inr" ? inr : (v) => Math.round(v).toLocaleString("en-IN");
      const t0 = performance.now(), dur = 550;
      const tick = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el2.textContent = fmt(end * e);
        if (k < 1 && seq === loadDashboard._seq) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  dashCharts.forEach((c) => { try { c.destroy(); } catch {} });
  dashCharts = [];
  if (typeof Chart === "undefined") { body.insertAdjacentHTML("beforeend", `<div class="empty">Charts library didn't load (offline?) — the numbers above still work.</div>`); return; }
  // PERMANENT AXIS RULE (owner 2026-07-05): a time axis picks how many labels it
  // shows from the range AND the width — roughly one label per ~80px of chart, so
  // an hour of data splits into ~10-minute steps, a day into ~2-hour steps, a
  // month into ~2-3-day steps. Never a fixed tick count on any panel's chart.
  const tickLimit = (canvasId, min = 4, max = 16) => {
    const el2 = document.getElementById(canvasId);
    const w = (el2 && el2.parentElement && el2.parentElement.clientWidth) || 600;
    return Math.max(min, Math.min(max, Math.round(w / 80)));
  };
  const surface = (getComputedStyle(document.body).getPropertyValue("--panel") || "#1d1812").trim();
  const mutedInk = (getComputedStyle(document.body).getPropertyValue("--muted") || "#a8997f").trim();
  Chart.defaults.color = mutedInk;
  Chart.defaults.borderColor = "rgba(150,140,125,0.15)";
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const gold = "#b97f35", goldBar = "rgba(185,127,53,0.78)", goldSoft = "rgba(185,127,53,0.28)";
  const emptyCard = (id, title, msg) =>
    (document.getElementById(id).closest(".dash-chart").innerHTML = `<h4>${title}</h4><div class="empty">${msg}</div>`);
  // Sales — gradient area + the previous period as a dashed ghost line (cut at the
  // same elapsed time). Clicking a point opens that day's / that period's bills.
  const salesPts = s.series.map((p) => Math.round((p.revenue || 0) * INR_RATE));
  const prevPts = (prev.series || []).map((v) => Math.round((v || 0) * INR_RATE));
  const GHOST = { today: "Yesterday", "30d": "30 days before", year: "Last year" }[dashRange] || "Before";
  if (salesPts.some((v) => v > 0)) {
    const sctx = document.getElementById("chSales").getContext("2d");
    const grad = sctx.createLinearGradient(0, 0, 0, 260);
    grad.addColorStop(0, "rgba(185,127,53,.28)"); grad.addColorStop(1, "rgba(185,127,53,.02)");
    const datasets = [{ label: dashRange === "today" ? "Today" : "This period", data: salesPts, borderColor: gold, backgroundColor: grad, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.25 }];
    if (prevPts.some((v) => v > 0))
      datasets.push({ label: GHOST, data: prevPts, borderColor: "rgba(150,140,125,.55)", borderDash: [5, 4], fill: false, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 1.5 });
    dashCharts.push(new Chart(sctx, {
      type: "line",
      data: { labels: s.series.map((p) => p.label), datasets },
      options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        onClick: (_e, els) => {
          if (!els.length) return;
          if (dashRange === "today") return goBills("daybills");
          if (dashRange === "30d") {
            // Jump to that DAY's bill records: prefill the Previous view's date search.
            const d = new Date(Date.now() - (29 - els[0].index) * 864e5);
            state.billSearchType = "date"; state.billSearch = d.toISOString().slice(0, 10); state.billHistRows = [];
            loadBillHistory(state.billSearch, "date");
          }
          goBills("previous");
        },
        plugins: { legend: { display: datasets.length > 1, labels: { boxWidth: 18, font: { size: 10 } } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${inr(c.parsed.y)}` } } },
        scales: { x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: tickLimit("chSales") } },
                  y: { beginAtZero: true, border: { display: false }, ticks: { maxTicksLimit: 5, callback: (v) => v >= 1000 ? "₹" + Math.round(v / 1000) + "k" : "₹" + v } } } },
    }));
  } else {
    emptyCard("chSales", `Sales <span>· ${rangeLabel}</span>`, "No sales in this range yet.");
  }
  // Day parts (PetPooja pattern): the biggest slot is solid gold; tooltip carries orders.
  const dpData = (s.dayParts || []).filter((d, i) => i < 4 || d.orders > 0 || d.revenue > 0);
  if (dpData.some((d) => d.revenue > 0 || d.orders > 0)) {
    const dpMax = Math.max(...dpData.map((d) => d.revenue));
    dashCharts.push(new Chart(document.getElementById("chDay"), {
      type: "bar",
      data: { labels: dpData.map((d) => d.label), datasets: [{ data: dpData.map((d) => Math.round(d.revenue * INR_RATE)), backgroundColor: dpData.map((d) => (d.revenue === dpMax && dpMax > 0 ? gold : goldSoft)), borderRadius: 6, borderSkipped: false }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${inr(c.parsed.y)} · ${dpData[c.dataIndex].orders} order${dpData[c.dataIndex].orders === 1 ? "" : "s"}` } } },
        scales: { x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10 } } }, y: { beginAtZero: true, border: { display: false }, ticks: { maxTicksLimit: 4, callback: (v) => v >= 1000 ? "₹" + Math.round(v / 1000) + "k" : "₹" + v } } } },
    }));
  } else {
    emptyCard("chDay", "Day parts", "No orders in this range yet.");
  }
  // Channels — dine-in vs the delivery apps, with click-to-hide legend rows.
  const CH_META = { dinein: ["Dine-in", "#b97f35"], zomato: ["Zomato", "#e23744"], swiggy: ["Swiggy", "#fc8019"], takeaway: ["Website", "#0ea5e9"], parcel: ["Parcel", "#6b7280"] };
  const chRows = Object.entries(chan)
    .map(([k, v]) => ({ k, name: (CH_META[k] || [k])[0], color: (CH_META[k] || [, "#6b7280"])[1], rev: v.rev || 0, count: v.count || 0 }))
    .filter((c) => c.rev > 0).sort((a, b) => b.rev - a.rev);
  if (chRows.length) {
    const chTotal = chRows.reduce((a, c) => a + c.rev, 0);
    document.getElementById("chanCenter").innerHTML = `<b>${inr(chTotal)}</b><small>${esc(rangeLabel)}</small>`;
    document.getElementById("chanLegend").innerHTML = chRows.map((c) => `
      <div class="pay-row togglable" data-ch="${c.k}">
        <span class="dot" style="background:${c.color}"></span>
        <span class="m">${esc(c.name)}</span><span class="amt">${inr(c.rev)}</span>
        <span class="meta">${pctOf(c.rev, chTotal)}% · ${c.count} order${c.count === 1 ? "" : "s"}${c.count ? ` · avg ${inr(c.rev / c.count)}` : ""}</span>
      </div>`).join("");
    const chanChart = new Chart(document.getElementById("chChan"), {
      type: "doughnut",
      data: { labels: chRows.map((c) => c.name), datasets: [{ data: chRows.map((c) => Math.round(c.rev * INR_RATE)), backgroundColor: chRows.map((c) => c.color), borderColor: surface, borderWidth: 2, hoverOffset: 6 }] },
      options: { cutout: "68%", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${inr(c.parsed)}` } } } },
    });
    dashCharts.push(chanChart);
    document.querySelectorAll("#chanLegend .pay-row").forEach((row, i) => (row.onclick = () => {
      chanChart.toggleDataVisibility(i); chanChart.update();
      row.classList.toggle("off");
    }));
  } else {
    emptyCard("chChan", "Channels", "No orders in this range yet.");
  }
  // Weekday × hour heatmap (30d/year): darker = busier; the ring marks the single
  // hottest slot. Pure CSS grid — no chart lib, so it's crisp in both themes.
  if (hasHeat) {
    const hmDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let hmMax = 0, pkD = 0, pkH = 0;
    heatRows.forEach((row, d) => row.forEach((v, h) => { if (v > hmMax) { hmMax = v; pkD = d; pkH = h; } }));
    document.getElementById("hmGrid").innerHTML =
      `<span></span>` + Array.from({ length: 24 }, (_, h) => `<span class="hx">${h % 3 === 0 ? h : ""}</span>`).join("") +
      heatRows.map((row, d) => `<span class="lab">${hmDays[d]}</span>` + row.map((v, h) => {
        const a = hmMax ? v / hmMax : 0;
        const bgc = a === 0 ? "rgba(150,140,125,.10)" : `rgba(185,127,53,${(0.10 + a * 0.85).toFixed(2)})`;
        return `<span class="c${d === pkD && h === pkH ? " peak" : ""}" style="background:${bgc}" title="${hmDays[d]} ${h}:00 — ${v} order${v === 1 ? "" : "s"}"></span>`;
      }).join("")).join("");
  }
  // Top dishes — rounded bars.
  if ((s.topDishes || []).length) {
    dashCharts.push(new Chart(document.getElementById("chTop"), {
      type: "bar",
      data: { labels: s.topDishes.map(([t]) => t), datasets: [{ label: "plates", data: s.topDishes.map(([, n]) => n), backgroundColor: goldBar, hoverBackgroundColor: gold, borderRadius: 6, borderSkipped: false }] },
      options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.parsed.x} plates` } } },
        scales: { x: { beginAtZero: true, border: { display: false }, ticks: { precision: 0, maxTicksLimit: 5 } }, y: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10.5 } } } } },
    }));
  } else {
    emptyCard("chTop", "Top dishes", "No dishes sold in this range yet.");
  }
  // Busy hours — the peak hour is solid gold, the rest stay soft.
  const hoursData = s.hours || [];
  if (hoursData.some((v) => v > 0)) {
    const peakH = hoursData.indexOf(Math.max(...hoursData));
    dashCharts.push(new Chart(document.getElementById("chHours"), {
      type: "bar",
      data: { labels: Array.from({ length: 24 }, (_, h) => h + ":00"), datasets: [{ label: "orders", data: hoursData, backgroundColor: hoursData.map((_, i) => (i === peakH ? gold : goldSoft)), borderRadius: 4, borderSkipped: false }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.parsed.y} order${c.parsed.y === 1 ? "" : "s"}` } } },
        scales: { x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: tickLimit("chHours") } }, y: { beginAtZero: true, border: { display: false }, ticks: { precision: 0, maxTicksLimit: 5 } } } },
    }));
  } else {
    emptyCard("chHours", "Busy hours <span>· orders by hour</span>", "No orders in this range yet.");
  }
  // Category share — same donut + written-legend pattern as Payment methods.
  // Top 6 categories keep the fixed palette; everything after folds into "Other"
  // (never invent an extra hue — dataviz rule).
  const CAT_COLORS = ["#3987e5", "#199e70", "#c98500", "#9085e9", "#d55181", "#d95926"];
  const OTHER_GRAY = "#6b7280";
  let catEntries = Object.entries(s.cats).sort((a, b) => b[1] - a[1]);
  if (catEntries.length > CAT_COLORS.length + 1) {
    const rest = catEntries.slice(CAT_COLORS.length).reduce((a, [, n]) => a + n, 0);
    catEntries = [...catEntries.slice(0, CAT_COLORS.length), ["other categories", rest]];
  }
  if (catEntries.length) {
    const catTotal = catEntries.reduce((a, [, n]) => a + n, 0);
    const catColor = (i) => CAT_COLORS[i] || OTHER_GRAY;
    document.getElementById("catCenter").innerHTML = `<b>${catTotal.toLocaleString("en-IN")}</b><small>plates</small>`;
    document.getElementById("catLegend").innerHTML = catEntries.map(([c, n], i) => `
      <div class="pay-row togglable">
        <span class="dot" style="background:${catColor(i)}"></span>
        <span class="m">${esc(c)}</span><span class="amt">${n.toLocaleString("en-IN")}</span>
        <span class="meta">${pctOf(n, catTotal)}% of plates</span>
      </div>`).join("");
    const catChart = new Chart(document.getElementById("chCats"), {
      type: "doughnut",
      data: { labels: catEntries.map(([c]) => c), datasets: [{ data: catEntries.map(([, n]) => n), backgroundColor: catEntries.map((_, i) => catColor(i)), borderColor: surface, borderWidth: 2, hoverOffset: 6 }] },
      options: { cutout: "68%", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.parsed} plates` } } } },
    });
    dashCharts.push(catChart);
    document.querySelectorAll("#catLegend .pay-row").forEach((row, i) => (row.onclick = () => { catChart.toggleDataVisibility(i); catChart.update(); row.classList.toggle("off"); }));
  } else {
    emptyCard("chCats", "Category share", "No sales in this range yet.");
  }
  // Payment methods (redesigned 2026-07-05): revenue split by how bills got paid —
  // UPI/Cash/Card/Other, plus "Not recorded" for older bills. One FIXED colour per
  // method (same validated colorblind-safe set as the owner panel), the ₹ total in
  // the donut hole, and an HTML legend with ₹ + % + bill count (the server sends
  // [method, revenue, bills] triples; % lives in the legend, never angle-only).
  const PAY_COLORS = { UPI: "#9085e9", Cash: "#199e70", Card: "#3987e5", Other: "#c98500", "Not recorded": "#6b7280" };
  const payColor = (m) => PAY_COLORS[m] || PAY_COLORS["Not recorded"];
  const payEntries = (s.paymentMethods || []).filter(([, rev]) => rev > 0);
  const payChart = document.getElementById("chPay");
  if (payEntries.length) {
    const payTotal = payEntries.reduce((a, [, rev]) => a + rev, 0);
    document.getElementById("payCenter").innerHTML = `<b>${inr(payTotal)}</b><small>collected</small>`;
    document.getElementById("payLegend").innerHTML = payEntries.map(([m, rev, bills]) => `
      <div class="pay-row togglable">
        <span class="dot" style="background:${payColor(m)}"></span>
        <span class="m">${esc(m)}</span><span class="amt">${inr(rev)}</span>
        <span class="meta">${pctOf(rev, payTotal)}%${bills ? ` · ${bills} bill${bills === 1 ? "" : "s"}` : ""}</span>
      </div>`).join("");
    const payChartInst = new Chart(payChart, {
      type: "doughnut",
      data: { labels: payEntries.map(([m]) => m), datasets: [{
        data: payEntries.map(([, rev]) => rev),
        backgroundColor: payEntries.map(([m]) => payColor(m)),
        borderColor: surface, borderWidth: 2, hoverOffset: 6,
      }] },
      options: { cutout: "68%", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${inr(ctx.parsed)}` } } } },
    });
    dashCharts.push(payChartInst);
    document.querySelectorAll("#payLegend .pay-row").forEach((row, i) => (row.onclick = () => { payChartInst.toggleDataVisibility(i); payChartInst.update(); row.classList.toggle("off"); }));
  } else if (payChart) {
    emptyCard("chPay", `Payment methods <span>· ${rangeLabel}</span>`, "No paid bills in this range yet.");
  }
}
// Chart ink (axis labels, donut slice-gaps) is baked into the canvas at draw
// time, so a light↔dark flip while the Dashboard is open must redraw it once.
new MutationObserver(() => {
  // Theme flip = pure redraw: recolour the charts from cached data, DON'T re-run the /stats scan.
  if (document.querySelector('.tab[data-tab="dash"].active')) loadDashboard(true);
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });


// ---------- printable bill ----------
// Opens a clean print window for one table's bill: every order with its KOT
// number, items, discounts, and the grand total. Tax always prints as a
// CGST + SGST split (half the rate each); GSTIN, address, customer name and a
// T-prefixed table number print when their data is present.
// The printable TAX INVOICE — "Classic" B&W design (thermal/mono printer). All
// money via billMath (discount BEFORE tax). Restaurant identity from settings.
function printBill(t, sess, os) {
  const s = state.data.settings || {};
  const m = billMath(os);
  const live = os.filter((o) => o.status !== "cancelled");
  // Item rows: base + each priced add-on as an italic sub-line (the unit price
  // already includes add-ons, so base = unit − add-ons → the lines sum to subtotal).
  const rows = live.map((o) => (Array.isArray(o.items) ? o.items : []).map((i) => {
    const q = Number(i.qty) || 1;
    const opts = Array.isArray(i.options) ? i.options.filter((x) => Number(x.price)) : [];
    const addUnit = opts.reduce((a, x) => a + (Number(x.price) || 0), 0);
    const baseUnit = (parseFloat(i.price) || 0) - addUnit;
    let r = `<tr><td>${esc(i.title)}</td><td class="c">${q}</td><td class="r">${Math.round(baseUnit)}</td><td class="r">${Math.round(baseUnit * q)}</td></tr>`;
    for (const x of opts) r += `<tr class="ex"><td colspan="2">+ ${esc(x.label)}</td><td class="r">${Math.round(Number(x.price))}</td><td class="r">${Math.round(Number(x.price) * q)}</td></tr>`;
    return r;
  }).join("")).join("");
  // White-label identity: ALL the fallback logic lives in billIdentity() (shared with
  // the Billing settings form, which autofills the same values). The French House
  // logo applies ONLY to the flagship (#1).
  const bi = billIdentity(s);
  const isDefault = bi.isDefault;
  const name = esc(bi.name);
  const addr = esc(bi.address);
  const phone = esc(bi.phone);
  const gstin = esc(bi.gstin);
  const footer = esc(bi.footer);
  // Customer name: orders carry a customer_name (dine-in head / aggregator buyer);
  // use the first order that has one. Blank → the line is hidden, never empty.
  const cust = esc((os.find((o) => (o.customer_name || "").toString().trim()) || {}).customer_name || "");
  // Table shown as "T5": prefix a plain numeric table with "T". Non-numeric
  // values (e.g. "Takeaway", "T5") are left exactly as entered.
  const tnum = (t || "").toString().trim();
  const tableDisp = /^\d+$/.test(tnum) ? "T" + tnum : esc(tnum || "—");
  const invNo = sess && sess.invoice_no != null ? esc(invFmt(sess.invoice_no, sess.invoice_at)) : "";
  const billNo = sess && sess.bill_no != null ? esc(sess.bill_no) : "";
  const now = new Date();
  const pct = Math.round(m.rate * 10000) / 100; // e.g. 5
  // Tax rows on the printed bill: if the restaurant configured named components
  // (tax_components → m.taxComponents), itemise EACH (label · its % · its amount, amounts
  // computed from the taxable value so they sum to m.tax). Otherwise keep the historical
  // 50/50 CGST+SGST split. (owner, 2026-07-03 — customisable multi-tax on the customer bill.)
  // The printed tax lines MUST sum EXACTLY to the tax on the total (and match the on-screen
  // bill). inr() rounds every line to whole rupees, so rounding each component independently
  // drifts — e.g. ₹380 @ 5% = ₹19 tax, but CGST 2.5% + SGST 2.5% each round(9.5)=₹10 → ₹20 ≠ ₹19,
  // and the invoice then foots to ₹400 not ₹399. Fix: split the whole-rupee tax across the
  // components, rounding every line except the LAST and giving the last the remainder — the
  // same rule the owner GST report already uses. (audit fix 2026-07-09)
  const taxComps = (m.taxComponents && m.taxComponents.length)
    ? m.taxComponents
    : [{ label: "CGST", rate: pct / 2 }, { label: "SGST", rate: pct / 2 }];
  const taxWhole = Math.round(m.tax); // whole-rupee tax shown on the total line (INR_RATE = 1)
  const taxRateSum = taxComps.reduce((a, c) => a + (Number(c.rate) || 0), 0) || 1;
  let taxRun = 0;
  const taxRows = taxComps.map((c, i) => {
    const amt = i === taxComps.length - 1 ? (taxWhole - taxRun) : Math.round(taxWhole * ((Number(c.rate) || 0) / taxRateSum));
    taxRun += amt;
    return `<div class="t"><span>${esc(c.label)} ${c.rate}%</span><span>${inr(amt)}</span></div>`;
  }).join("");
  const w = window.open("", "_blank", "width=380,height=680");
  if (!w) { toast("Allow popups for this site to print the bill", "err"); return; }
  w.document.write(`<!doctype html><title>Tax Invoice — ${name}</title>
<style>
  /* Thermal-roll print recipe — VALIDATED offline through the real CUPS+ESC/POS driver
     chain (2026-07-21, see aangan-thermal-printer-setup memory). Three rules:
     · @page margin:0 kills the browser's own header/footer ("about:blank", page numbers).
     · NO @page size override — a forced size smaller/squarer than the paper gets rotated
       or bottom-anchored by CUPS (sideways prints + 20cm blank lead-ins). The queue's
       own short receipt paper does the pagination; Chrome never slices a text line.
     · Content ≤66mm CENTERED: the 80mm head only prints ~70mm, offset ~5mm from the
       left paper edge — a full-width 80mm body loses ~8mm of every line on the right. */
  @page{margin:0}
  @media print{body{margin:0 !important;padding:2mm 5mm !important}
    /* a bill spanning several 65mm printer pages: print the ITEM header ONCE (browsers
       otherwise repeat <thead> on every page — it showed up mid-bill), and never split
       a row across a page boundary (a fragmented flex row shifted every amount one
       line down — owner's 18:04 invoice). Validated in the offline print simulator. */
    thead{display:table-row-group}
    tr,.t,.g,.kv{break-inside:avoid;page-break-inside:avoid}}
  body{font-family:ui-monospace,'IBM Plex Mono',Consolas,monospace;font-size:12px;margin:22px 34px;color:#111}
  .logo{display:block;height:46px;margin:0 auto 8px;filter:grayscale(1) contrast(1.1)}
  h2{font-family:Georgia,'Times New Roman',serif;font-size:19px;margin:0;text-align:center}
  .sub{text-align:center;color:#444;font-size:10px;margin-top:3px;line-height:1.5}
  .dash{border-top:1px dashed #999;margin:11px 0}
  .kv{display:flex;justify-content:space-between;font-size:10.5px;padding:2px 0}.kv span:first-child{color:#777}
  table{width:100%;border-collapse:collapse;margin-top:4px}
  th{font-size:8.5px;text-transform:uppercase;letter-spacing:.05em;color:#777;text-align:left;border-bottom:1px solid #111;padding-bottom:5px}
  th.c,td.c{text-align:center}th.r,td.r{text-align:right}
  td{font-size:12px;padding:5px 0;border-bottom:1px dotted #e2e2e2;font-variant-numeric:tabular-nums}
  tr.ex td{font-size:10px;font-style:italic;color:#777;padding:1px 0 5px 10px;border-bottom:1px dotted #eee}
  .t{display:flex;justify-content:space-between;font-size:11.5px;padding:3px 0;color:#333}
  .t.tx{border-top:1px dashed #aaa;margin-top:4px;padding-top:6px;color:#111;font-weight:700}
  /* Totals section: a solid medium-dark rule separates items from the money summary (#555 prints on thermal; light dotted lines fade out). */
  .totals{margin-top:8px;border-top:1px solid #555;padding-top:8px}
  .g{display:flex;justify-content:space-between;border-top:2px solid #111;margin-top:8px;padding-top:8px;font-weight:700;font-size:14px}
  .foot{text-align:center;color:#555;font-size:10px;margin-top:13px}
</style>
${isDefault ? '<img class="logo" src="https://littlefrenchhouse.in/restaurant/wp-content/uploads/2021/01/LFH-Logo_200x200-e1612862168838.png" onerror="this.style.display=\'none\'"/>' : ""}
<h2>${name}</h2>
<div class="sub">${addr ? addr + "<br/>" : ""}${phone ? "Phone " + phone : ""}${phone && gstin ? " · " : ""}${gstin ? "GSTIN " + gstin : ""}</div>
<div class="dash"></div>
${invNo ? `<div class="kv"><span>Invoice</span><b>${invNo}</b></div>` : ""}
<div class="kv"><span>${billNo !== "" ? "Bill · Table" : "Table"}</span><b>${billNo !== "" ? "#" + billNo + " · " : ""}${tableDisp}</b></div>
${cust ? `<div class="kv"><span>Customer</span><b>${cust}</b></div>` : ""}
<div class="kv"><span>Date · Time</span><b>${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</b></div>
<div class="dash"></div>
<table><thead><tr><th>Item</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div class="totals">
  <div class="t"><span>Subtotal</span><span>${inr(m.subtotal)}</span></div>
  ${m.disc > 0 ? `<div class="t"><span>Discount</span><span>− ${inr(m.disc)}</span></div><div class="t tx"><span>Taxable value</span><span>${inr(m.taxable)}</span></div>` : ""}
  ${taxRows}
  <div class="g"><span>TOTAL</span><span>${inr(m.total)}</span></div>
</div>
<div class="foot">${footer}</div>
<script>setTimeout(()=>print(),300)<\/script>`);
  w.document.close();
}

// Manager PERFORMANCE REPORT — a designed, downloadable (print / Save-as-PDF)
// analysis for THIS restaurant over the selected range: revenue, orders, top
// dishes, category mix, busiest hours. Branded in the restaurant's own accent
// colour. Reuses the same /stats the Dashboard already shows.
async function printManagerReport() {
  let s;
  try { s = await api("GET", "/stats?range=" + dashRange); }
  catch (e) { toast("Couldn't build the report: " + e.message, "err"); return; }
  const r = state.data.restaurant || {};
  const set = state.data.settings || {};
  const isDefault = r.slug === "french-house" || r.id === "00000000-0000-0000-0000-000000000001";
  const name = esc(set.restaurant_name || (isDefault ? "Little French House" : (r.logo_text || (r.name && r.name.en) || "Restaurant")));
  const accent = (r.accent_color && /^#[0-9a-fA-F]{3,6}$/.test(r.accent_color)) ? r.accent_color : "#d4a574";
  const RL = { today: "Today", "30d": "Last 30 days", year: "Last 12 months" };
  const rangeLabel = RL[dashRange] || dashRange;
  const now = new Date();
  const top = (s.topDishes || []).slice(0, 8);
  const topMax = Math.max(1, ...top.map(([, n]) => n));
  const hours = (s.hours || []).map((n, h) => [h, n]).sort((a, b) => b[1] - a[1]).filter(([, n]) => n > 0).slice(0, 3);
  const cats = Object.entries(s.cats || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const catMax = Math.max(1, ...cats.map(([, n]) => n));
  const w = window.open("", "_blank", "width=760,height=920");
  if (!w) { toast("Allow popups to download the report", "err"); return; }
  const kpi = (l, v, sub) => `<div class="kpi"><div class="kl">${l}</div><div class="kv">${v}</div>${sub ? `<div class="ks">${sub}</div>` : ""}</div>`;
  const barRow = (label, n, max) => `<div class="row"><span class="n">${esc(label)}</span><span class="bar"><i style="width:${Math.round((n / max) * 100)}%"></i></span><span class="c">${n}</span></div>`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${name} — Performance report</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1c1e;margin:0;padding:38px 44px;font-size:13px}
  .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid ${accent};padding-bottom:14px}
  .rname{font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;margin:0}
  .rtag{color:#666;font-size:12px;margin-top:3px}
  .doc{text-align:right} .doc .t{font-size:14px;font-weight:800;letter-spacing:.03em} .doc .m{color:#888;font-size:11px;margin-top:3px}
  .brand{display:inline-flex;align-items:center;gap:5px;color:${accent};font-weight:800;font-size:12px}
  .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:22px 0}
  .kpi{border:1px solid #ececec;border-radius:12px;padding:13px 15px}
  .kl{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#999} .kv{font-size:23px;font-weight:800;margin-top:3px;font-variant-numeric:tabular-nums} .ks{font-size:11px;color:#888;margin-top:1px}
  h3{font-size:12.5px;font-weight:800;margin:22px 0 10px;text-transform:uppercase;letter-spacing:.04em;color:#444}
  .row{display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13px}
  .row .n{width:165px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .row .c{width:42px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
  .bar{flex:1;height:9px;background:#f1f1f1;border-radius:6px;overflow:hidden} .bar i{display:block;height:100%;background:${accent};border-radius:6px}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:30px}
  .foot{margin-top:30px;padding-top:13px;border-top:1px solid #eee;color:#999;font-size:10.5px;text-align:center}
  @media print{body{padding:0}}
</style></head><body>
  <div class="head">
    <div><h1 class="rname">${name}</h1><div class="rtag">Performance report · ${rangeLabel}</div></div>
    <div class="doc"><div class="t">PERFORMANCE REPORT</div><div class="m">Generated ${now.toLocaleString("en-IN")}</div><div class="m brand">✦ Aevidine</div></div>
  </div>
  <div class="kpis">
    ${kpi("Revenue", inr(s.revenue), rangeLabel)}${kpi("Orders", (s.orderCount || 0).toLocaleString("en-IN"))}${kpi("Avg order", inr(s.avgOrder))}
    ${kpi("Paid", s.paid || 0)}${kpi("Unpaid", s.unpaid || 0)}${kpi("Cancelled", s.cancelled || 0)}
  </div>
  <div class="two">
    <div><h3>Top dishes</h3>${top.length ? top.map(([t, n]) => barRow(t, n, topMax)).join("") : '<div style="color:#999">No sales in this range.</div>'}</div>
    <div>
      <h3>Category mix</h3>${cats.length ? cats.map(([c, n]) => barRow(c, n, catMax)).join("") : '<div style="color:#999">—</div>'}
      <h3 style="margin-top:20px">Busiest hours</h3>${hours.length ? hours.map(([h, n]) => `<div class="row"><span class="n">${String(h).padStart(2, "0")}:00 – ${String((h + 1) % 24).padStart(2, "0")}:00</span><span class="c">${n}</span></div>`).join("") : '<div style="color:#999">—</div>'}
    </div>
  </div>
  <div class="foot">Aevidine · Restaurant OS — figures are net of discounts and exclude cancelled orders. Revenue in ₹.</div>
  <script>setTimeout(()=>print(),350)<\/script>
</body></html>`);
  w.document.close();
}

// Staff watch — who is discounting / voiding / deleting / reverting bills, from the recent activity
// log. A high count isn't proof of anything (a busy manager legitimately discounts a lot); it's a
// heads-up to glance at — the "anti-theft" pattern the bigger POS systems use.
async function openStaffRisk() {
  document.querySelector(".sr-overlay")?.remove();
  const rangeLbl = { today: "today", "30d": "the last 30 days", year: "the last 12 months" }[dashRange] || dashRange;
  const wrap = el(`<div class="sx-modal-overlay sr-overlay"><div class="sx-modal" style="max-width:620px">
    <div class="tbl-modal-head"><div class="tp-detail-top"><h3>🔍 Staff watch</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div>
    <div class="dish-edit-body"><div class="muted small" style="margin-bottom:10px">Discounts, voids, deletes &amp; paid-reverts by staff over ${esc(rangeLbl)} (follows the Dashboard range). A high count is just worth a glance — not proof of anything.</div><div id="srBody"><div class="empty">Loading…</div></div></div>
  </div></div>`);
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector(".tbl-modal-close").onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  try {
    // The server aggregates by staff over the whole selected range (was: the newest 200 log rows
    // with no date window, which undercounted — and could miss a staff member — on a busy day,
    // review #4). It returns a small { rows:[{who,disc,void,del,rev,total}], truncated } summary,
    // with the void action name handled correctly server-side (review #1).
    const res = await api("GET", "/staff-risk?range=" + dashRange);
    const list = (res && res.rows) || [];
    const maxT = list.length ? list[0].total : 0;
    const flag = (t) => t >= Math.max(8, maxT * 0.8) ? ` <span class="inv-chip voided">watch</span>` : "";
    const trunc = res && res.truncated ? `<div class="muted small" style="margin-bottom:8px;color:var(--gold-strong)"><i class="fa-solid fa-circle-info"></i> Very busy range — counts cover the most recent activity.</div>` : "";
    wrap.querySelector("#srBody").innerHTML = list.length
      ? trunc + `<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left;padding:4px">Staff</th><th style="text-align:right;padding:4px">Discounts</th><th style="text-align:right;padding:4px">Voids/Deletes</th><th style="text-align:right;padding:4px">Reverts</th><th style="text-align:right;padding:4px">Total</th></tr></thead><tbody>`
        + list.map((v) => `<tr style="border-top:1px solid var(--line)"><td style="padding:5px 4px"><b>${esc(v.who)}</b>${flag(v.total)}</td><td style="text-align:right">${v.disc}</td><td style="text-align:right">${v.void + v.del}</td><td style="text-align:right">${v.rev}</td><td style="text-align:right"><b>${v.total}</b></td></tr>`).join("")
        + `</tbody></table>`
      : `<div class="empty">No discounts, voids, deletes or reverts over ${esc(rangeLbl)} — nothing to flag. 👍</div>`;
  } catch (e) { wrap.querySelector("#srBody").innerHTML = `<div class="empty">Couldn't load: ${esc(e.message)}</div>`; }
}

// Menu star/dog matrix — which dishes are winners vs losers, by popularity (units sold) × the
// revenue they bring. Reuses the Dashboard's /stats data (menuMatrix field). Revenue, NOT profit —
// dish cost isn't tracked yet (that's the future inventory module), so it's labelled honestly.
async function openMenuMatrix() {
  document.querySelector(".mm-overlay")?.remove();
  const rangeLbl = { today: "today", "30d": "the last 30 days", year: "the last 12 months" }[dashRange] || dashRange;
  const wrap = el(`<div class="sx-modal-overlay mm-overlay"><div class="sx-modal" style="max-width:820px">
    <div class="tbl-modal-head"><div class="tp-detail-top"><h3>📊 Menu winners &amp; losers</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div>
    <div class="dish-edit-body"><div class="muted small" style="margin-bottom:10px">By how often each dish sells × the revenue it brings, over ${esc(rangeLbl)}. (Revenue, not profit — cost tracking comes with the inventory module.)</div><div id="mmBody"><div class="empty">Loading…</div></div></div>
  </div></div>`);
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector(".tbl-modal-close").onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  const render = (mm) => {
    if (!mm || !mm.length) return `<div class="empty">No paid dishes in this range yet.</div>`;
    const QUAD = [
      { k: "star", icon: "⭐", name: "Stars", tip: "Popular + high revenue — feature & protect these." },
      { k: "puzzle", icon: "🧩", name: "Puzzles", tip: "High revenue, fewer orders — promote or reposition." },
      { k: "workhorse", icon: "🐎", name: "Workhorses", tip: "Popular but lower revenue — a small price bump?" },
      { k: "dog", icon: "🐟", name: "Dogs", tip: "Low on both — rework or drop." },
    ];
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">` + QUAD.map((Q) => {
      const all = mm.filter((d) => d.q === Q.k);
      const rows = all.slice(0, 12);
      return `<div class="tp-bill" style="padding:12px"><div style="font-weight:800;margin-bottom:2px">${Q.icon} ${Q.name} <span class="muted">· ${all.length}</span></div><div class="muted small" style="margin-bottom:8px">${Q.tip}</div>${rows.length ? rows.map((d) => `<div class="tp-bl"><span>${esc(d.title)} <span class="muted">×${d.units}</span></span><b>${inr(d.rev)}</b></div>`).join("") + (all.length > rows.length ? `<div class="muted small">+${all.length - rows.length} more</div>` : "") : `<div class="muted small">—</div>`}</div>`;
    }).join("") + `</div>`;
  };
  const paint = (s) => {
    const b = wrap.querySelector("#mmBody"); if (!b) return;
    // Same honesty note as the dashboard: if the range exceeded the row cap, the winners/losers
    // split is from the most recent orders only and can shift once full-range totals arrive. (review #2)
    const note = s && s.truncated ? `<div class="muted small" style="margin-bottom:10px;color:var(--gold-strong)"><i class="fa-solid fa-circle-info"></i> Based on the most recent ${Number(s.statsCap || 5000).toLocaleString()} orders — a longer range has more, so this split may shift once full-range totals arrive.</div>` : "";
    b.innerHTML = note + render(s && s.menuMatrix);
  };
  // Reuse the Dashboard's already-loaded stats for the current range if present (no extra fetch).
  if (loadDashboard._last && loadDashboard._lastRange === dashRange) paint(loadDashboard._last);
  else { try { paint(await api("GET", "/stats?range=" + dashRange)); } catch (e) { const b = wrap.querySelector("#mmBody"); if (b) b.innerHTML = `<div class="empty">Couldn't load: ${esc(e.message)}</div>`; } }
}

// Monthly GST report for THIS restaurant's own dine-in sales (paid bills, discount-before-tax —
// the same server math as the Z-report). A month picker, the GST breakdown (CGST/SGST lines when the
// restaurant uses named components, else one GST line), a per-day table, and a CSV for the accountant.
async function openGstReport() {
  document.querySelector(".gst-overlay")?.remove();
  const defMonth = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7); // current month (IST)
  const wrap = el(`<div class="sx-modal-overlay gst-overlay"><div class="sx-modal" style="max-width:640px">
    <div class="tbl-modal-head"><div class="tp-detail-top"><h3>🧾 GST report</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div>
    <div class="dish-edit-body">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <label class="dish-edit-lbl" style="margin:0">Month</label>
        <input type="month" id="gstMonth" value="${defMonth}" max="${defMonth}" class="dish-edit-custominput" style="width:auto"/>
        <button class="btn" id="gstCsv" title="Download as a spreadsheet">⬇ CSV</button>
      </div>
      <div id="gstBody"><div class="empty">Loading…</div></div>
    </div>
  </div></div>`);
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector(".tbl-modal-close").onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  let last = null;
  const load = async () => {
    const month = wrap.querySelector("#gstMonth").value || defMonth;
    wrap.querySelector("#gstBody").innerHTML = `<div class="empty">Loading…</div>`;
    try {
      const d = await api("GET", `/gst-report?month=${encodeURIComponent(month)}`);
      last = d;
      const t = d.totals || {};
      const compRows = (d.components && d.components.length)
        ? d.components.map((c) => `<div class="tp-bl"><span>${esc(c.label)} (${c.rate}%)</span><b>${inr(c.amount)}</b></div>`).join("")
        : `<div class="tp-bl"><span>GST (${d.ratePct}%)</span><b>${inr(t.tax)}</b></div>`;
      const dayRows = (d.days || []).map((r) => `<tr><td>${esc(r.date)}</td><td style="text-align:right">${r.bills}</td><td style="text-align:right">${inr(r.taxable)}</td><td style="text-align:right">${inr(r.tax)}</td><td style="text-align:right">${inr(r.gross)}</td></tr>`).join("");
      wrap.querySelector("#gstBody").innerHTML = `
        <div class="tp-bill" style="margin-bottom:12px">
          ${d.restaurant && d.restaurant.gstin ? `<div class="tp-bl"><span>GSTIN</span><b>${esc(d.restaurant.gstin)}</b></div>` : `<div class="tp-bl" style="color:var(--muted)"><span>GSTIN</span><b>not set — add it in Settings</b></div>`}
          <div class="tp-bl"><span>Bills (paid)</span><b>${t.bills || 0}</b></div>
          <div class="tp-bl"><span>Taxable sales</span><b>${inr(t.taxable)}</b></div>
          ${compRows}
          <div class="tp-bl grand"><span>Total (incl. GST)</span><span class="tp-bl-amt">${inr(t.gross)}</span></div>
        </div>
        <div class="muted small" style="margin-bottom:8px">${esc(d.note || "")}</div>
        ${dayRows ? `<table class="gst-table" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left">Day</th><th style="text-align:right">Bills</th><th style="text-align:right">Taxable</th><th style="text-align:right">GST</th><th style="text-align:right">Total</th></tr></thead><tbody>${dayRows}</tbody></table>` : `<div class="empty">No paid bills in this month.</div>`}`;
    } catch (e) { wrap.querySelector("#gstBody").innerHTML = `<div class="empty">Couldn't load: ${esc(e.message)}</div>`; }
  };
  wrap.querySelector("#gstMonth").onchange = load;
  wrap.querySelector("#gstCsv").onclick = () => {
    if (!last) return;
    const t = last.totals || {};
    const rows = [
      ["GST report", last.restaurant && last.restaurant.name || "", last.month],
      ["GSTIN", last.restaurant && last.restaurant.gstin || "(not set)"],
      [],
      ["Day", "Bills", "Taxable", "GST", "Total"],
      ...(last.days || []).map((r) => [r.date, r.bills, r.taxable, r.tax, r.gross]),
      [],
      ["TOTAL", t.bills || 0, t.taxable || 0, t.tax || 0, t.gross || 0],
      ...(last.components || []).map((c) => [`${c.label} (${c.rate}%)`, "", "", c.amount, ""]),
    ];
    // CSV formula-injection guard: a cell starting with = + - @ is prefixed with ' so a spreadsheet
    // can't execute it as a formula (same guard the owner exports use).
    const cell = (v) => { let s = String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
    const csv = rows.map((row) => row.map(cell).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `gst-${last.month}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  load();
}

// Day-close "Z report" — one tap prints the business-day totals (server-computed).
async function printZReport() {
  let z;
  try { z = await api("GET", "/zreport"); } catch (e) { toast("Couldn't build the report: " + e.message, "err"); return; }
  const di = z.dineIn;
  const row = (l, v, b) => `<div class="zr${b ? " b" : ""}"><span>${esc(l)}</span><span>${v}</span></div>`;
  const w = window.open("", "_blank", "width=380,height=720");
  if (!w) { toast("Allow popups to print the report", "err"); return; }
  w.document.write(`<!doctype html><title>Day-close Z report — ${esc(z.date)}</title>
<style>
  /* Same thermal recipe as printBill: margin:0 (no browser header/footer), no @page
     size, content ≤66mm centered so the 70mm printable head never clips it. */
  @page{margin:0}
  @media print{body{margin:0 !important;padding:2mm 5mm !important}
    .zr,.grand,.sec{break-inside:avoid;page-break-inside:avoid}}
  body{font-family:ui-monospace,'IBM Plex Mono',Consolas,monospace;font-size:12px;margin:20px;color:#111}
  h2{font-family:Georgia,serif;font-size:18px;margin:0;text-align:center}
  .sub{text-align:center;color:#444;font-size:10.5px;margin:3px 0 12px}
  .sec{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#777;border-bottom:1px solid #111;padding-bottom:4px;margin:14px 0 6px}
  .zr{display:flex;justify-content:space-between;padding:3px 0;font-variant-numeric:tabular-nums}
  .zr.b{font-weight:700;border-top:1px dashed #aaa;margin-top:4px;padding-top:6px}
  .grand{display:flex;justify-content:space-between;border-top:2px solid #111;border-bottom:2px solid #111;margin-top:10px;padding:9px 0;font-weight:700;font-size:15px}
  .foot{text-align:center;color:#777;font-size:9px;margin-top:14px}
</style>
<h2>${esc(z.restaurant.name)}</h2>
<div class="sub">DAY-CLOSE · Z REPORT${z.restaurant.gstin ? "<br/>GSTIN " + esc(z.restaurant.gstin) : ""}<br/>${esc(z.date)} · printed ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
<div class="sec">Dine-in</div>
${row("Bills", di.bills)}
${row("Orders (KOTs)", di.orderCount)}
${row("Gross (subtotal)", inr(di.gross))}
${row("Discounts", "− " + inr(di.discount))}
${row("Taxable value", inr(di.taxable))}
${row("Tax (CGST + SGST)", inr(di.tax))}
${row("Net sales", inr(di.net), true)}
${row("Paid bills", di.paidCount + " · " + inr(di.paidNet))}
${row("Unpaid bills", di.unpaidCount + " · " + inr(di.unpaidNet))}
${row("Cancelled orders", di.cancelled)}
${di.tips > 0 ? row("Tips collected (staff)", inr(di.tips), true) : ""}
<div class="sec">Platform (Zomato / Swiggy / Website / Parcel)</div>
${row("Orders", z.platform.count)}
${row("Revenue", inr(z.platform.revenue), true)}
<div class="sec">Invoices</div>
${row("Generated today", z.invoicesGenerated)}
${row("Voided today", z.invoicesVoided)}
<div class="grand"><span>GRAND TOTAL</span><span>${inr(z.grandTotal)}</span></div>
<div class="foot">Computer-generated day-close report</div>
<script>setTimeout(()=>print(),300)<\/script>`);
  w.document.close();
}

// A small CUSTOMER receipt for a parcel — same thermal recipe as the Z-report/bill
// (≤66mm centred, no browser header/footer). Printed on "Pay now & print".
// o = { kot, items:[{title,qty,price}], total, customer, method, paid }.
function printParcelReceipt(o) {
  const set = state.data.settings || {};
  const name = set.restaurant_name || "Restaurant";
  const w = window.open("", "_blank", "width=380,height=680");
  if (!w) { toast("Allow popups to print the receipt", "err"); return; }
  const lines = (o.items || []).map((it) =>
    `<div class="ln"><span>${esc(it.qty)}× ${esc(it.title)}</span><span>${inr((Number(it.price) || 0) * it.qty)}</span></div>`).join("");
  w.document.write(`<!doctype html><title>Parcel receipt${o.kot != null ? " #" + esc(o.kot) : ""}</title>
<style>
  @page{margin:0}
  @media print{body{margin:0 !important;padding:2mm 5mm !important}.ln,.grand{break-inside:avoid}}
  body{font-family:ui-monospace,'IBM Plex Mono',Consolas,monospace;font-size:12px;margin:20px;color:#111}
  h2{font-family:Georgia,serif;font-size:18px;margin:0;text-align:center}
  .sub{text-align:center;color:#444;font-size:10.5px;margin:3px 0 10px}
  .tag{text-align:center;font-weight:700;letter-spacing:.1em;border-top:1px solid #111;border-bottom:1px solid #111;padding:4px 0;margin:8px 0}
  .ln{display:flex;justify-content:space-between;padding:3px 0;font-variant-numeric:tabular-nums}
  .grand{display:flex;justify-content:space-between;border-top:2px solid #111;margin-top:8px;padding-top:8px;font-weight:700;font-size:15px}
  .paid{text-align:center;margin-top:8px;font-weight:700}
  .foot{text-align:center;color:#777;font-size:9px;margin-top:12px}
</style>
<h2>${esc(name)}</h2>
<div class="sub">${set.gstin ? "GSTIN " + esc(set.gstin) + "<br/>" : ""}${esc(new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</div>
<div class="tag">🥡 PARCEL / TAKEAWAY${o.kot != null ? " · #" + esc(o.kot) : ""}</div>
${o.customer ? `<div class="sub" style="margin:6px 0">${esc(o.customer)}</div>` : ""}
${lines}
<div class="grand"><span>TOTAL</span><span>${inr(o.total || 0)}</span></div>
<div class="paid">${o.paid ? "PAID · " + esc(String(o.method || "cash").toUpperCase()) : "PAY ON PICKUP"}</div>
<div class="foot">Thank you!</div>
<script>setTimeout(()=>print(),300)<\/script>`);
  w.document.close();
}

// ---------- Features tab: per-restaurant on/off switches ----------
// The catalogue of GUEST-FACING switches. Each key matches lib/features.ts in
// the menu app (absent in the DB = the default below). The four backend-only
// switches (verification / payments / aggregators / gst_invoice) are
// DELIBERATELY not listed here — the owner wants them invisible in every UI.
const FEATURE_CATALOG = [
  { key: "ratings",      def: true, icon: "⭐", label: "Star ratings",     desc: "The star scores on dish cards and dish pages. Off = no stars anywhere." },
  { key: "reviews",      def: true, icon: "💬", label: "Guest reviews",    desc: "Guests can write and read reviews on a dish. Off = the whole review area disappears." },
  { key: "model3d",      def: true, icon: "🧊", label: "3D dish viewer",   desc: "The rotating 3D models. Off = no 3D buttons, no model downloads at all." },
  { key: "allergies",    def: true, icon: "🛡️", label: "Allergy system",   desc: "Allergen lists on dishes + the tap-what-you-avoid section in the cart." },
  { key: "favorites",    def: true, icon: "❤️", label: "Favorites",        desc: "The heart button and the Favorites tab." },
  { key: "waiter_calls", def: true, icon: "🔔", label: "Waiter calls",     desc: "The bell button guests use to ask for water / cutlery / the bill." },
  { key: "search",       def: true, icon: "🔎", label: "Dish search",      desc: "The search box at the top of the menu." },
  { key: "languages",    def: true, icon: "🌐", label: "Languages",        desc: "The language picker (6 languages). Off = English only." },
  { key: "currency",     def: true, icon: "💱", label: "Currency picker",  desc: "Guests can view prices in other currencies. Off = ₹ only." },
  { key: "scrollspy",    def: true, icon: "📜", label: "Auto category bar", desc: "The category strip that follows the guest as they scroll the All view." },
];

// The current value of one switch: the DB override if present, else its default.
const featureOn = (key) => {
  const f = (state.data.settings || {}).features || {};
  const def = (FEATURE_CATALOG.find((x) => x.key === key) || {}).def !== false;
  return typeof f[key] === "boolean" ? f[key] : def;
};

// One card per switch — big friendly toggle, name, plain-language description.
function featuresHtml() {
  const rows = FEATURE_CATALOG.map((f) => `
    <div class="feat-card">
      <div class="feat-icon">${f.icon}</div>
      <div class="feat-info"><b>${esc(f.label)}</b><small>${esc(f.desc)}</small></div>
      <label class="fc-toggle feat-toggle"><input type="checkbox" data-feature="${esc(f.key)}" ${featureOn(f.key) ? "checked" : ""}/><span class="fc-sw"></span></label>
    </div>`).join("");
  return `<div class="ed-head"><h2>Features <span class="sub">· what guests can see and use</span></h2></div>
    <p class="feat-note">Turning a feature off removes it COMPLETELY from the guest menu — buttons, screens, everything — the moment guests reload. Turning it back on restores it instantly.</p>
    <div class="feat-grid">${rows}</div>`;
}

function bindFeatures() {
  const ed = $("#editor");
  ed.querySelectorAll("[data-feature]").forEach((c) => (c.onchange = async () => {
    const key = c.dataset.feature;
    const f = FEATURE_CATALOG.find((x) => x.key === key);
    // Two-step confirm when switching something OFF — it vanishes for every
    // guest immediately, so a misclick mid-service would be very visible.
    if (!c.checked && !(await confirmDialog(`Turn OFF ${f ? f.label : key}? It disappears from the guest menu for everyone until you turn it back on.`, "Turn off"))) {
      c.checked = true; // they said no — restore the toggle
      return;
    }
    await saveFeature(key, c.checked);
  }));
}

// Save ONE switch: optimistically merge it locally, then send ONLY the changed key to the server,
// which merges it into the current bag — so two people toggling different switches don't clobber
// each other (last-writer-wins used to revert the other's change). (B17)
async function saveFeature(key, value) {
  const prev = (state.data.settings || {}).features || {};
  const next = { ...prev, [key]: value };
  state.data.settings = { ...(state.data.settings || {}), features: next }; // optimistic (full local view)
  // When offline, api() returns the outbox STUB ({ok,queued,action_id}), not the settings row —
  // overwriting state.data.settings with it would wipe table_count/features/tax etc. Keep the
  // optimistic value in that case (the queued write replays on reconnect).
  try { const r = await api("POST", "/settings", { features: { [key]: value } }); if (!(r && r.queued)) state.data.settings = r; toast(r && r.queued ? "Saved (will sync)" : "Saved", "ok"); }
  catch (e) {
    state.data.settings = { ...(state.data.settings || {}), features: prev }; // undo
    renderEditor();
    toast("Failed: " + e.message, "err");
  }
}

function renderEditor() {
  const ed = $("#editor");
  if (state.tab === "tables") {
    const _t0 = performance.now();
    ed.innerHTML = floorHtml();
    bindFloor();
    syncTableBackLayers(); // phone hardware BACK peels an open table detail instead of leaving
    window.__lfhPerf.fullRenders++;
    window.__lfhPerf.lastMs = performance.now() - _t0;
    return;
  }
  if (state.tab === "log") {
    ed.innerHTML = logHtml();
    bindLog();
    return;
  }
  if (state.tab === "features") {
    ed.innerHTML = featuresHtml();
    bindFeatures();
    return;
  }
  if (state.tab === "dash") {
    ed.innerHTML = `<div class="ed-head"><h2>Dashboard</h2><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="mgrReport">📄 Download report</button><button class="btn" id="zReport">📋 Day-close (Z)</button><button class="btn" id="gstReport">🧾 GST report</button><button class="btn" id="menuMatrix">📊 Menu winners</button><button class="btn" id="dashRefresh">↻ Refresh</button></div></div><div id="dashBody" class="dash-body"><div class="empty">Crunching the numbers…</div></div>`;
    document.getElementById("dashRefresh").onclick = () => renderEditor();
    document.getElementById("zReport").onclick = () => printZReport();
    document.getElementById("mgrReport").onclick = () => printManagerReport();
    document.getElementById("gstReport").onclick = () => openGstReport();
    document.getElementById("menuMatrix").onclick = () => openMenuMatrix();
    loadDashboard();
    return;
  }
  if (state.tab === "ratings") {
    ed.innerHTML = `<div class="ed-head"><h2>Guest ratings</h2><div style="display:flex;gap:8px"><button class="btn" id="ratingsRefresh">↻ Refresh</button></div></div><div id="ratingsBody" class="dash-body"><div class="empty">Loading ratings…</div></div>`;
    document.getElementById("ratingsRefresh").onclick = () => loadRatings();
    loadRatings();
    return;
  }
  if (state.tab === "platform") {
    ed.innerHTML = platformHtml();
    bindPlatform();
    return;
  }
  if (state.tab === "banquet") {
    ed.innerHTML = banquetHtml();
    bindBanquet();
    if (!state.banquet.loaded) loadBanquet(); // re-renders when the items land
    return;
  }
  if (state.tab === "inventory") {
    // The Inventory tab is fully owned by inventory.js (LFH_INV) — app.js only hands
    // it the container. Guard: if the script failed to load, say so instead of a blank.
    if (window.LFH_INV) window.LFH_INV.render(ed);
    else ed.innerHTML = `<div class="empty">Inventory module failed to load — refresh the page.</div>`;
    return;
  }
  if (state.tab === "orders") {
    ed.innerHTML = ordersHtml(); // draw the orders screen
    const rb = document.getElementById("refreshOrders");
    if (rb) rb.onclick = loadOrders;
    // Each block below finds a set of buttons by their data-* marker and attaches
    // the click behaviour. (We re-draw the HTML each time, so we re-bind each time.)
    ed.querySelectorAll(".ord-btn[data-act]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.id, act = btn.dataset.act;
        const o = (state.data.orders || []).find((x) => x.id === id);
        if (act === "cancelled") return cancelOrder(id);
        // Accept (received → preparing) and Serve-all must flip the per-dish
        // order_items too, not just orders.status — otherwise the dishes stay
        // "received" and the table panel can't serve them (the glitch). Route
        // these through the /accept and /serve-all endpoints that do both.
        if (act === "preparing" && o && o.status === "received") return acceptOrder(id);
        if (act === "served") return serveAllOrder(id);
        setOrderStatus(id, act); // reopen / restore (no per-dish change needed)
      };
    });
    ed.querySelectorAll(".ord-del[data-del]").forEach((btn) => {
      btn.onclick = async () => {
        deleteOrders([btn.dataset.del]); // reason prompt inside deleteOrders is the confirmation
      };
    });
    // Per-order allergen chips: optimistic toggle, then persist; the poll reconciles.
    ed.querySelectorAll(".oae-chip[data-alg]").forEach((chip) => {
      chip.onclick = async () => {
        const id = chip.dataset.alg, slug = chip.dataset.slug;
        const o = (state.data.orders || []).find((x) => x.id === id);
        if (!o) return;
        const cur = new Set((o.allergies || []).map((x) => String(x).toLowerCase()));
        if (cur.has(slug)) cur.delete(slug); else cur.add(slug);
        o.allergies = [...cur];          // flip the screen now
        opBegin(id); renderEditor();
        try { await api("POST", `/orders/${id}/allergies`, { allergies: o.allergies }); }
        catch (e) { toast("Couldn't update allergens: " + e.message, "err"); }
        finally { opEnd(id); }
      };
    });
    // Merged session-card actions act on EVERY order in the group (one bill).
    // The group is the orders sharing a session_id (or a single "solo:" order).
    const ordersInGroup = (key) => (key || "").startsWith("solo:")
      ? (state.data.orders || []).filter((o) => o.id === key.slice(5))
      : (state.data.orders || []).filter((o) => o.session_id === key);
    ed.querySelectorAll("[data-sess-accept]").forEach((btn) => {
      btn.onclick = async () => { for (const o of ordersInGroup(btn.dataset.sessAccept).filter((x) => x.status === "received")) await acceptOrder(o.id); };
    });
    ed.querySelectorAll("[data-sess-serve]").forEach((btn) => {
      btn.onclick = async () => { for (const o of ordersInGroup(btn.dataset.sessServe).filter((x) => x.status === "preparing")) await serveAllOrder(o.id); };
    });
    ed.querySelectorAll("[data-sess-pay]").forEach((btn) => {
      btn.onclick = async () => {
        const grp = ordersInGroup(btn.dataset.sessPay).filter((x) => x.status !== "cancelled" && x.payment_status !== "paid");
        await payOrdersWithMethod(grp, "Mark this bill paid");
      };
    });
    // Today/Previous: bill cards open a modal; search + sort drive the grid.
    ed.querySelectorAll("[data-bill-open]").forEach((c) => { c.onclick = () => openBillModal(c.dataset.billOpen); });
    // Per-card 🖨: print without opening the bill. stopPropagation so the card's own
    // open-modal click doesn't also fire.
    ed.querySelectorAll("[data-bill-print]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); printBillFromKey(b.dataset.billPrint); }));
    const _bst = ed.querySelector("[data-bill-stype]");
    if (_bst) _bst.onchange = () => { state.billSearchType = _bst.value; state.billSearch = ""; state.billHistRows = []; renderEditor(); };
    const _bso = ed.querySelector("[data-bill-sort]");
    if (_bso) _bso.onchange = () => { state.billSort = _bso.value; renderEditor(); };
    const _bq = ed.querySelector("[data-bill-q]");
    if (_bq) _bq.oninput = () => {
      state.billSearch = _bq.value;
      // In the PREVIOUS view, also search the server so bills older than the local 200-row
      // window are found (debounced; results merge into the list — see ordersPreviousHtml).
      if (ordersViewKey() === "previous") loadBillHistory(_bq.value.trim(), state.billSearchType);
      renderEditor();
      const ne = $("#editor [data-bill-q]"); if (ne) { ne.focus(); const v = ne.value; try { ne.setSelectionRange(v.length, v.length); } catch {} }
    };
    // Invoice pipeline buttons on the bill card.
    ed.querySelectorAll("[data-gen-invoice]").forEach((btn) => { btn.onclick = () => generateInvoice(btn.dataset.genInvoice); });
    ed.querySelectorAll("[data-void-invoice]").forEach((btn) => { btn.onclick = () => voidInvoice(btn.dataset.voidInvoice); });
    ed.querySelectorAll("[data-credit-note]").forEach((btn) => { btn.onclick = () => creditNote(btn.dataset.creditNote); });
    ed.querySelectorAll("[data-print-group]").forEach((btn) => {
      btn.onclick = () => {
        const os = ordersInGroup(btn.dataset.printGroup);
        if (!os.length) return;
        const o0 = os[0];
        printBill(o0.table_number, { invoice_no: o0.invoice_no, bill_no: o0.bill_no }, os);
      };
    });
    ed.querySelectorAll("[data-sess-del]").forEach((btn) => {
      btn.onclick = async () => {
        const ids = ordersInGroup(btn.dataset.sessDel).map((o) => o.id);
        if (ids.length) deleteOrders(ids); // reason prompt inside deleteOrders is the confirmation
      };
    });
    ed.querySelectorAll("[data-resolve]").forEach((btn) => {
      btn.onclick = () => resolveCall(btn.dataset.resolve);
    });
    ed.querySelectorAll("[data-pay]").forEach((btn) => {
      btn.onclick = () => setOrderPayment(btn.dataset.pay, btn.dataset.paid !== "1");
    });
    ed.querySelectorAll("[data-free-table]").forEach((btn) => {
      btn.onclick = () => freeTable(btn.dataset.freeTable);
    });
    ed.querySelectorAll("[data-restore]").forEach((btn) => {
      btn.onclick = () => restoreTable(btn.dataset.restore);
    });
    // Left-bar: switch which Orders view is showing (live / previous / bills / calls).
    ed.querySelectorAll("[data-orders-view]").forEach((btn) => {
      btn.onclick = () => { state.ordersView = btn.dataset.ordersView; lsSet("lfh_editor_ordersview", state.ordersView); renderEditor(); };
    });
    // Bills view: settle a table's WHOLE bill at once (mark every unpaid order paid).
    ed.querySelectorAll("[data-pay-table]").forEach((btn) => {
      btn.onclick = async () => {
        const ids = btn.dataset.payTable.split(",").filter(Boolean);
        const orders = ids.map((id) => (state.data.orders || []).find((o) => o.id === id)).filter(Boolean);
        await payOrdersWithMethod(orders, "Mark this bill paid");
      };
    });
    // Khata view (mig 166): collect a parked bill — normal payment popup, then the
    // khata endpoint marks that bill's orders paid and it leaves the book.
    ed.querySelectorAll("[data-khata-collect]").forEach((btn) => {
      btn.onclick = async () => {
        const amount = Number(btn.dataset.khataAmount) || 0;
        const picked = await openPaymentMethodModal(amount, `Collect from ${btn.dataset.khataName}`);
        if (!picked) return;
        try {
          const payload = { method: picked.method, note: picked.note };
          if (btn.dataset.khataSession) payload.session_id = btn.dataset.khataSession;
          else payload.order_id = btn.dataset.khataOrder;
          await api("POST", "/khata/pay", payload);
          toast(`Collected ${inr(amount)} from ${btn.dataset.khataName} 📒→💳`, "ok");
          state.khataLoadedAt = 0; // force a fresh book
          await loadKhataBook();
          loadSessions(); // the paid orders re-enter the normal records
        } catch (e) { toast("Couldn't collect: " + e.message, "err"); }
      };
    });
    // Collect ALL of one person's parked bills at once — one payment method, then settle
    // each bill on it (sequential so each leaves the book cleanly and logs its own collect).
    ed.querySelectorAll("[data-khata-collectall]").forEach((btn) => {
      btn.onclick = async () => {
        const cid = btn.dataset.khataCollectall;
        const cst = ((state.khataBook && state.khataBook.customers) || []).find((c) => c.id === cid);
        if (!cst || !cst.bills.length) return;
        const amount = Number(btn.dataset.khataAmount) || 0;
        const picked = await openPaymentMethodModal(amount, `Collect all from ${btn.dataset.khataName}`);
        if (!picked) return;
        try {
          for (const bl of cst.bills) {
            const payload = { method: picked.method, note: picked.note };
            if (bl.session_id) payload.session_id = bl.session_id; else payload.order_id = bl.key;
            await api("POST", "/khata/pay", payload);
          }
          toast(`Collected ${inr(amount)} from ${btn.dataset.khataName} 📒→💳`, "ok");
          state.khataLoadedAt = 0;
          await loadKhataBook();
          loadSessions();
        } catch (e) { toast("Couldn't collect: " + e.message, "err"); }
      };
    });
    // Pay Later search — filter the people list client-side (small list; no refetch). Keep
    // caret position so typing feels natural through the re-render.
    const kSearch = document.getElementById("khataViewSearch");
    if (kSearch) kSearch.oninput = () => {
      state.khataSearch = kSearch.value;
      const pos = kSearch.selectionStart;
      renderEditor();
      const again = document.getElementById("khataViewSearch");
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch {} }
    };
    // On-the-house display toggle (mig 166): purely client-side list preference.
    const ohT = document.getElementById("khataOhToggle");
    if (ohT) ohT.onchange = () => { lsSet("lfh_show_onhouse", ohT.checked ? "1" : "0"); renderList(); renderEditor(); };
    const updateSel = () => {
      const ids = [...ed.querySelectorAll(".ord-select:checked")].map((c) => c.dataset.sel);
      const cnt = document.getElementById("ordSelCount");
      if (cnt) cnt.textContent = ids.length ? `${ids.length} selected` : "";
      const del = document.getElementById("ordDeleteSelected");
      if (del) del.disabled = ids.length === 0;
      return ids;
    };
    ed.querySelectorAll(".ord-select").forEach((c) => (c.onchange = updateSel));
    const all = document.getElementById("ordSelectAll");
    if (all) all.onchange = () => {
      ed.querySelectorAll(".ord-select").forEach((c) => (c.checked = all.checked));
      updateSel();
    };
    const delSel = document.getElementById("ordDeleteSelected");
    if (delSel) delSel.onclick = async () => {
      const ids = [...ed.querySelectorAll(".ord-select:checked")].map((c) => c.dataset.sel);
      if (!ids.length) return;
      deleteOrders(ids); // reason prompt inside deleteOrders is the confirmation
    };
    // Clear every freed/archived record in one go (the records you can't otherwise
    // reach with the active-orders bulk bar).
    const clearFreed = document.getElementById("clearFreed");
    if (clearFreed) clearFreed.onclick = async () => {
      const ids = (state.data.orders || []).filter((o) => o.archived).map((o) => o.id);
      if (!ids.length) return;
      deleteOrders(ids); // reason prompt inside deleteOrders is the confirmation
    };
    return;
  }
  // From here down we're on an editable tab (dishes/categories/filters/settings).
  // If nothing is selected yet, show a gentle prompt.
  if (!state.sel) {
    ed.innerHTML = `<div class="empty">Pick something from the list, or hit <b>+ New</b>.</div>`;
    return;
  }
  const isGeneral = state.tab === "general";
  // Pick the right form builder for the current tab.
  const body =
    state.tab === "items" ? formItems(state.sel)
    : state.tab === "categories" ? formCategories(state.sel)
    : state.tab === "filters" ? formFilters(state.sel)
    : formGeneral(state.sel);
  // Settings tab: the heading follows the selected SECTION ("Table settings",
  // "Access settings", …) so you always know which group you're editing.
  const secTitle = (SETTINGS_SECTIONS.find((x) => x.id === state.settingsSection) || SETTINGS_SECTIONS[0]).title;
  const title = isGeneral ? secTitle : (state.isNew ? `New ${TAB_LABEL[state.tab]}` : recLabel(state.sel));
  ed.innerHTML = `
    <div class="ed-head">
      <h2>${esc(title)} ${(!isGeneral && !state.isNew) ? `<span class="sub">· ${esc(recKey(state.sel) || "")}</span>` : ""}</h2>
      ${(isGeneral || state.isNew) ? "" : '<button class="btn danger" id="delBtn">Delete</button>'}
      <button class="btn primary" id="saveBtn">Save</button>
    </div>
    ${body}`;
  bindEditor();
  // Re-baseline the unsaved-changes guard ONLY on a fresh entry (select/new/tab/save),
  // never on an in-form rebuild — so add/remove-row edits stay dirty. See newRecord().
  if (state._snapPending) { snapshotEditor(); state._snapPending = false; }
}

// updatePreviews: as you type an image URL, icon, or colour, refresh the little
// live preview without redrawing the whole form (which would lose your cursor).
function updatePreviews() {
  const it = state.sel;
  const img = document.getElementById("imgPreview");
  if (img) { img.src = it.image || ""; img.style.opacity = it.image ? 1 : 0.2; }
  const ip = document.getElementById("iconPreview");
  if (ip) {
    if (state.tab === "categories") { ip.style.color = it.color || "#d4a574"; ip.innerHTML = `<i class="fas ${esc(it.icon || "fa-tag")}"></i>`; }
    else if (state.tab === "filters") { ip.textContent = it.icon || "🏷️"; }
  }
}

// bindEditor: make the edit form interactive. It connects Save/Delete, and — the
// clever bit — auto-wires every input: when you change a field, it reads that
// field's data-path and writes the new value into state.sel at that location.
function bindEditor() {
  const ed = $("#editor");
  $("#saveBtn").onclick = save;
  const del = $("#delBtn");
  if (del) del.onclick = removeRecord;

  // For every labelled input/select/textarea, listen for changes and store the value.
  ed.querySelectorAll("[data-path]").forEach((node) => {
    const path = node.dataset.path;
    // Checkboxes/dropdowns fire "change"; text boxes fire "input" (as you type).
    const evt = node.tagName === "SELECT" || node.type === "checkbox" ? "change" : "input";
    node.addEventListener(evt, () => {
      // Read the value in the right shape: true/false for a checkbox, a number for
      // number fields (blank → null), otherwise the plain text.
      let v;
      if (node.type === "checkbox") v = node.checked;
      else if (node.type === "number") v = node.value === "" ? null : Number(node.value);
      else v = node.value;
      setPath(state.sel, path, v); // save it into the working copy at its dotted path
      if (path === "image" || path === "icon" || path === "color") updatePreviews(); // refresh the live preview
    });
  });

  // Buttons marked with data-action (add/remove rows, toggle chips, etc) all route
  // through one handler, handleAction, which figures out what to do from the name.
  ed.querySelectorAll("[data-action]").forEach((node) => {
    node.addEventListener("click", () => handleAction(node.dataset.action, node.dataset.arg, node));
  });

  // Live filter for the "dishes in this tag" list (keeps focus, no re-render).
  const ms = $("#membSearch");
  if (ms) ms.oninput = () => {
    const q = ms.value.toLowerCase();
    ed.querySelectorAll(".memb-row").forEach((row) => {
      row.style.display = !q || row.dataset.memb.includes(q) ? "" : "none";
    });
  };

  // Kitchen settings: "Preview a sample KOT" test-print button.
  { const kb = document.getElementById("kotPreviewBtn"); if (kb) kb.onclick = previewSampleKOT; }

  // ---- "User setting" card (Settings tab): the manager's own team ----
  if (state.tab === "general" && !state.staffLoaded) loadStaffTeam();

  // ---- "Who serves which table" card (Settings → Tables): waiter sections, mig 222 ----
  // Loaded lazily, and ONLY when its own section is open, so a manager who never opens
  // Tables never pays for the roster fetch.
  if (state.tab === "general" && state.settingsSection === "tables" && !state.sectionsLoaded && !state.sectionsLoading) loadTableSections();
  ed.querySelectorAll("[data-sec-view]").forEach((b) => (b.onclick = () => { state.sectionsView = b.dataset.secView; renderEditor(); }));
  ed.querySelectorAll("[data-sec-edit]").forEach((b) => (b.onclick = () => openSectionPicker(b.dataset.secEdit)));
  ed.querySelectorAll("[data-sec-table]").forEach((b) => (b.onclick = () => openTableHolderPicker(Number(b.dataset.secTable))));
  // "Give them to everyone" on the gap warning: the fastest way out of the one state that
  // silently loses orders. Only the UNSERVED tables are added — it never disturbs a section
  // someone has already set up deliberately.
  { const gb = ed.querySelector("[data-sec-fixgaps]"); if (gb) gb.onclick = async () => {
      const gaps = secGaps(); if (!gaps.length) return;
      for (const w of (state.sections?.waiters || [])) {
        await saveWaiterTables(w.id, Array.from(new Set(secTables(w).concat(gaps))).sort((a, b) => a - b));
      }
      toast(`${gaps.length} table${gaps.length === 1 ? "" : "s"} now covered.`);
    }; }
  { const ab = ed.querySelector("[data-sec-all]"); if (ab) ab.onclick = async () => {
      if (!(await confirmDialog("Give every table to every waiter? They'll each see the whole floor again — you can then take tables away one by one.", "Give all"))) return;
      const all = Array.from({ length: state.sections?.tableCount || 0 }, (_, k) => k + 1);
      for (const w of (state.sections?.waiters || [])) await saveWaiterTables(w.id, all);
    }; }
  { const cb2 = ed.querySelector("[data-sec-clear]"); if (cb2) cb2.onclick = async () => {
      // floorwide: this is the scarier look, and it earns it — while sections are on, every
      // waiter's tablet goes blank the moment this lands.
      if (!(await confirmDialog("Clear every section? Every waiter will be left with NO tables — while sections are switched on, their tablets will be empty until you give them tables again.", "Clear all", { floorwide: true }))) return;
      for (const w of (state.sections?.waiters || [])) await saveWaiterTables(w.id, []);
    }; }

  // ---- Access section: per-user permission selects (owner, 2026-07-03) ----
  // Each change saves IMMEDIATELY via /api/owner/staff set_permissions ("" = back to
  // Default → the server deletes the key). staffCall reloads nothing itself, so we
  // patch the local row and re-render for instant feedback.
  ed.querySelectorAll("[data-perm-user]").forEach((sel) => (sel.onchange = async () => {
    const id = sel.dataset.permUser, key = sel.dataset.permKey;
    const value = sel.value === "" ? null : sel.value;
    try {
      const d = await staffCall({ method: "PATCH", body: JSON.stringify({ id, action: "set_permissions", permissions: { [key]: value } }) });
      const u = state.staffTeam.find((x) => x.id === id);
      if (u) u.permissions = d.permissions || {};
      const cap = ACCESS_CAPS.find((c) => c.key === key);
      toast(`${u ? (u.name || u.username) : "User"} — ${cap ? cap.label : key}: ${value ? ACCESS_MODE_LABEL[value] : "Default"}`, "ok");
      renderEditor(); // refresh the "· custom" marker + Default(...) labels
    } catch (e) { toast("Failed: " + e.message, "err"); renderEditor(); }
  }));
  const usrAdd = $("#usrAddStaff");
  if (usrAdd) usrAdd.onclick = async () => {
    const name = ($("#usrNewName")?.value || "").trim();
    const role = $("#usrNewRole")?.value || "manager";
    const password = ($("#usrNewPassword")?.value || "").trim();
    if (name.length < 2) { toast("Name must be at least 2 characters.", "err"); return; }
    if (!state.staffRestaurantId) { toast("Couldn't tell which restaurant to add to — reload and try again.", "err"); return; }
    try {
      const d = await staffCall({ method: "POST", body: JSON.stringify({ name, role, password: password || undefined, restaurant_id: state.staffRestaurantId }) });
      state.staffReveal = { name: d.name, password: d.password };
      await loadStaffTeam();
    } catch (e) { toast("Failed: " + e.message, "err"); }
  };
  ed.querySelectorAll("[data-staff-resetpw]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.staffResetpw;
    const u = state.staffTeam.find((x) => x.id === id);
    if (!(await confirmDialog(`Reset ${u ? (u.name || u.username) : "this person"}'s password? Their current login stops working.`, "Reset"))) return;
    try {
      const d = await staffCall({ method: "PATCH", body: JSON.stringify({ id, action: "reset_password" }) });
      state.staffReveal = { name: u ? (u.name || u.username) : "", password: d.password };
      await loadStaffTeam();
    } catch (e) { toast("Failed: " + e.message, "err"); }
  }));
  ed.querySelectorAll("[data-staff-toggle]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.staffToggle, active = b.dataset.active !== "1";
    try { await staffCall({ method: "PATCH", body: JSON.stringify({ id, action: "set_active", active }) }); await loadStaffTeam(); }
    catch (e) { toast("Failed: " + e.message, "err"); }
  }));
  ed.querySelectorAll("[data-staff-role]").forEach((sel) => (sel.onchange = async () => {
    const id = sel.dataset.staffRole;
    try { await staffCall({ method: "PATCH", body: JSON.stringify({ id, action: "set_role", role: sel.value }) }); await loadStaffTeam(); }
    catch (e) { toast("Failed: " + e.message, "err"); }
  }));
  ed.querySelectorAll("[data-staff-del]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.staffDel;
    const u = state.staffTeam.find((x) => x.id === id);
    if (!(await confirmDialog(`Remove ${u ? (u.name || u.username) : "this person"} for good? This can't be undone.`, "Remove"))) return;
    try {
      const r = await fetch(ridQ(`/api/owner/staff?id=${encodeURIComponent(id)}`), { method: "DELETE" }); // ridQ: keep the admin's per-tab restaurant pin (appends &rid=)
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Request failed");
      await loadStaffTeam();
    } catch (e) { toast("Failed: " + e.message, "err"); }
  }));
  const usrRevealDone = $("#usrRevealDone");
  if (usrRevealDone) usrRevealDone.onclick = () => { state.staffReveal = null; renderEditor(); };
}

// handleAction: the one place that handles all the small "edit the form" buttons.
// The `action` name (set as data-action in the HTML) decides what happens — adding
// or removing ingredients, reviews, option groups/choices, toggling tags/allergens,
// etc. After changing state.sel it re-renders the form (keeping the scroll position).
function handleAction(action, arg, node) {
  const it = state.sel;
  if (action === "toggleMember") { toggleTagMembership(it.slug, arg, node); return; }
  if (action === "toggleSoldOut") {
    it.tags = it.tags || [];
    const i = it.tags.indexOf("sold-out");
    if (i >= 0) it.tags.splice(i, 1); else it.tags.push("sold-out");
  } else
  if (action === "addIngredient") (it.ingredients = it.ingredients || []).push({ emoji: "", name: "" });
  else if (action === "rmIngredient") it.ingredients.splice(Number(arg), 1);
  else if (action === "addReview") (it.reviews = it.reviews || []).push({ name: "", rating: 5, text: "" });
  else if (action === "rmReview") it.reviews.splice(Number(arg), 1);
  else if (action === "toggleTag") {
    it.tags = it.tags || [];
    const i = it.tags.indexOf(arg);
    if (i >= 0) it.tags.splice(i, 1); else it.tags.push(arg);
  } else if (action === "toggleAllergen") {
    it.allergens = it.allergens || [];
    const i = it.allergens.indexOf(arg);
    if (i >= 0) it.allergens.splice(i, 1); else it.allergens.push(arg);
  } else if (action === "addOptGroup") {
    (it.options = it.options || []).push({ name: "", type: "single", choices: [{ label: "", price: 0 }] });
  } else if (action === "rmOptGroup") {
    it.options.splice(Number(arg), 1);
  } else if (action === "addOptChoice") {
    const g = it.options[Number(arg)];
    (g.choices = g.choices || []).push({ label: "", price: 0 });
  } else if (action === "rmOptChoice") {
    const [gi, ci] = arg.split(".").map(Number);
    it.options[gi].choices.splice(ci, 1);
  } else if (action === "addTax") {
    // Named tax component for the printed bill (Billing settings). state.sel is the
    // settings row here; the data-path inputs write label/rate into this array.
    (it.tax_components = Array.isArray(it.tax_components) ? it.tax_components : []).push({ label: "", rate: 0 });
  } else if (action === "rmTax") {
    if (Array.isArray(it.tax_components)) it.tax_components.splice(Number(arg), 1);
  }
  // Re-draw the form to show the change, but remember and restore the scroll
  // position so the page doesn't jump to the top after every little edit.
  const ed = $("#editor");
  const sc = ed.scrollTop;
  renderEditor();
  ed.scrollTop = sc;
}

// Add/remove a tag on an existing dish from the Filters tab, then save that dish.
// Updates the UI in place (no full re-render) so the search box keeps focus.
async function toggleTagMembership(filterSlug, dishId, inputEl) {
  const dish = (state.data.items || []).find((d) => d.id === dishId);
  if (!dish || !filterSlug) return;
  dish.tags = dish.tags || [];
  const i = dish.tags.indexOf(filterSlug);
  const adding = i < 0;
  if (adding) dish.tags.push(filterSlug);
  else dish.tags.splice(i, 1);
  const row = inputEl && inputEl.closest(".memb-row");
  if (row) row.classList.toggle("on", adding);
  updateMembCount(filterSlug);
  try {
    // Send ONLY id + tags, not the whole dish snapshot — posting the full (possibly stale)
    // row here reverted a price/name someone else had just edited on this dish. The server
    // upsert updates only the columns we send (onConflict=id), so this touches tags alone.
    await api("POST", "/items", { id: dish.id, tags: dish.tags });
    toast(`${dish.title}: ${adding ? "added to" : "removed from"} "${filterSlug}"`, "ok");
  } catch (e) {
    // revert on failure
    if (adding) dish.tags.splice(dish.tags.indexOf(filterSlug), 1);
    else dish.tags.push(filterSlug);
    if (inputEl) inputEl.checked = !adding;
    if (row) row.classList.toggle("on", !adding);
    updateMembCount(filterSlug);
    toast("Save failed: " + e.message, "err");
  }
}
// updateMembCount: refresh the "· N selected" counter next to a tag's dish list.
function updateMembCount(filterSlug) {
  const el2 = document.getElementById("membCount");
  if (el2) el2.textContent = (state.data.items || []).filter((d) => (d.tags || []).includes(filterSlug)).length;
}

// ---------- save / delete ----------
// save: send the currently-edited record to the server (create or update), show a
// toast, reload everything, then re-select the freshly-saved row. Refuses to save
// if the required key (id or slug) is missing.
async function save() {
  // Guard against a double-click / double-submit: a second Save while the first is still
  // in flight would POST again and, for a brand-new dish, mint a SECOND dish (the server
  // auto-suffixes the slug). Ignore re-entry and disable the button until we're done.
  if (state.saving) return;
  const it = state.sel;
  const kind = state.tab === "general" ? "settings" : state.tab; // which table to write to
  const keyField = (state.tab === "items" || state.tab === "general") ? "id" : "slug"; // its unique-key column
  // New dish: derive the slug from the title so adding never fails for a missing key —
  // you only have to type a name. We deliberately do NOT assign the `id` here:
  // menu_items.id is a GLOBAL primary key, so a bare slug-as-id would silently OVERWRITE
  // another restaurant's (or this restaurant's own) dish with the same name. The SERVER
  // mints a tenant-namespaced, globally-unique id for new dishes instead. (Editing keeps
  // the existing id/slug untouched.)
  const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (state.tab === "items" && state.isNew) {
    if (!it.slug && it.title) it.slug = slugify(it.title);
  }
  // Categories/tags: a slug is a permanent key dishes reference and the guest menu keys
  // off. Normalize a NEW one (lowercase, dashes) so a typed "Main Courses" can't become a
  // broken key with spaces/capitals, or a case-dupe the server's exact-match check misses.
  if ((state.tab === "categories" || state.tab === "filters") && state.isNew && it.slug) {
    it.slug = slugify(it.slug);
  }
  if (state.tab === "items" && !it.title) { toast("Give the dish a name first", "err"); return; }
  // For a brand-new dish the id is server-generated, so only require it when editing.
  if (!(state.tab === "items" && state.isNew) && !it[keyField]) { toast(`${keyField === "id" ? "ID" : "Slug"} is required`, "err"); return; }
  if (state.tab === "items" && !it.slug) { toast("Slug is required", "err"); return; }

  // Copy the record but drop the timestamps — the database manages those itself.
  let payload = { ...it };
  delete payload.created_at;
  delete payload.updated_at;
  // Tell the server whether this is a brand-new row (mint a fresh unique id / refuse to
  // clobber an existing category/filter with the same slug) or an edit (update in place).
  if (state.tab === "items" || state.tab === "categories" || state.tab === "filters") payload.__create = !!state.isNew;
  const wasNew = state.tab === "items" && state.isNew;
  // EDIT → send only the CHANGED top-level fields (plus the identity keys the server matches
  // the row on: id + slug, and __create). A full-row write from a stale snapshot could revert
  // a field someone else just changed on another device — and the settings floor-toggles /
  // retention already save partial, so a full form-save would undo them. The server upsert
  // updates ONLY the columns we send (settings is if(k in body)-guarded; entities key on
  // id / restaurant_id,slug), so a partial write is safe. Falls back to the full payload if
  // we somehow have no clean baseline to diff against.
  if (!state.isNew && state.selPristine) {
    try {
      const before = JSON.parse(state.selPristine);
      const slim = {};
      for (const k of Object.keys(payload)) {
        if (JSON.stringify(payload[k]) !== JSON.stringify(before[k])) slim[k] = payload[k];
      }
      if (payload.id != null) slim.id = payload.id;       // items / settings match on id
      if (payload.slug != null) slim.slug = payload.slug; // categories / filters conflict on slug
      if ("__create" in payload) slim.__create = payload.__create;
      payload = slim;
    } catch (e) { /* keep the full payload on any diff error */ }
  }
  state.saving = true;
  const _saveBtn = document.getElementById("saveBtn");
  if (_saveBtn) { _saveBtn.disabled = true; _saveBtn.textContent = "Saving…"; }
  try {
    const key = recKey(it);
    const saved = await api("POST", "/" + kind, payload);
    toast("Saved ✓", "ok");
    await loadAll();
    if (state.tab === "general") {
      state.sel = clone(state.data.settings || it);
    } else if (wasNew) {
      // id was minted by the server — re-select the freshly created dish by the id it
      // returned (fall back to a slug match if the response shape ever changes).
      const newId = saved && saved.id;
      const fresh = records().find((r) => r.id === newId) || records().find((r) => r.slug === it.slug);
      state.sel = fresh ? clone(fresh) : null;
    } else {
      const fresh = records().find((r) => recKey(r) === key);
      state.sel = fresh ? clone(fresh) : null;
    }
    state.isNew = false;
    state._snapPending = true; // saved → the current form is now the clean baseline
    renderList();
    renderEditor();
  } catch (e) {
    toast("Save failed: " + e.message, "err");
  } finally {
    // renderEditor() rebuilds the Save button on success; re-query so we re-enable
    // whatever button now exists (important on the failure path, where nothing re-rendered).
    state.saving = false;
    const b = document.getElementById("saveBtn");
    if (b) { b.disabled = false; b.textContent = "Save"; }
  }
}

// removeRecord: permanently delete the currently-selected dish/category/filter.
async function removeRecord() {
  const it = state.sel;
  // Use the app's own styled confirm dialog (every other delete does), not the
  // browser's plain native popup — keeps the look consistent.
  if (!(await confirmDialog(`Delete "${recLabel(it)}"?`, "Delete"))) return;
  const kind = state.tab; // the deleted record's kind (items/categories/filters)
  const restored = { ...it }; // snapshot for Undo
  try {
    await api("DELETE", "/" + state.tab + "/" + encodeURIComponent(recKey(it)));
    // If we just deleted the category the Dishes list is filtered by, clear the filter —
    // otherwise the Dishes tab filters to a category that no longer exists (looks empty).
    if (state.tab === "categories" && state.catFilter === recKey(it)) state.catFilter = "";
    state.sel = null;
    state.isNew = false;
    await loadAll();
    renderEditor();
    // Undo — re-creates the record from the snapshot (safety net for a misclick).
    const undoRec = async () => {
      try {
        const payload = { ...restored }; delete payload.created_at; delete payload.updated_at; payload.__create = true;
        await api("POST", "/" + kind, payload);
        toast("Restored ✓", "ok");
        if (state.tab === kind) { await loadAll(); renderList(); renderEditor(); }
      } catch (e) { toast("Couldn't undo: " + e.message, "err"); }
    };
    if (window.LFH_UNDO) LFH_UNDO.show({ message: `Deleted "${recLabel(restored)}"`, sub: "Tap undo to restore it", icon: "🗑️", seconds: 6, onUndo: undoRec });
    else toast(`Deleted "${recLabel(restored)}"`, "ok", { label: "Undo", fn: undoRec }, 6000);
  } catch (e) {
    toast("Delete failed: " + e.message, "err");
  }
}

// previewSampleKOT: open a sample kitchen ticket + the print dialog, so the owner can test
// the printer and see the KOT layout from any device. Uses this restaurant's name (not #1's).
function previewSampleKOT() {
  const now = new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const rest = (billIdentity(state.data.settings).name) || "Restaurant";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Sample KOT</title>
    <style>body{font-family:ui-monospace,monospace;max-width:280px;margin:0 auto;padding:12px;color:#000}
    h2{text-align:center;margin:2px 0 6px;font-size:16px} .r{display:flex;justify-content:space-between;font-size:13px;margin:3px 0}
    hr{border:0;border-top:1px dashed #000;margin:8px 0} .foot{text-align:center;font-size:12px;margin-top:10px}</style></head>
    <body onload="setTimeout(function(){window.print()},80)">
      <h2>KITCHEN TICKET</h2>
      <div class="r"><span>${esc(rest)}</span><span>#SAMPLE</span></div>
      <div class="r"><span>Table 5</span><span>${esc(now)}</span></div>
      <hr>
      <div class="r"><b>2×</b><span>Margherita Pizza</span></div>
      <div class="r"><b>1×</b><span>Garlic Bread</span></div>
      <div class="r"><b>1×</b><span>Coke — no ice</span></div>
      <hr>
      <div class="foot">— sample test print —</div>
    </body></html>`;
  const w = window.open("", "_blank", "width=340,height=560");
  if (!w) { toast("Allow pop-ups to preview the KOT", "err"); return; }
  w.document.write(html); w.document.close();
}

// ---------- v2 dining sessions: live board ----------
// membersOf / itemsOf: pull just the members (or ordered items) that belong to a
// given session id, out of the whole board we loaded.
const membersOf = (sid) => (state.board.members || []).filter((m) => m.session_id === sid);
const itemsOf = (sid) => (state.board.items || []).filter((i) => i.session_id === sid);
// timeAgo: turn a timestamp into friendly text like "just now" / "5m ago" / "2h ago".
function timeAgo(ts) {
  if (!ts) return "";
  const d = (Date.now() - new Date(ts).getTime()) / 1000; // seconds since then
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  return Math.floor(d / 86400) + "d ago";
}

// whenLabel: the LOG timestamp rule the owner asked for. For the first 3 days it
// reads relative ("just now", "2h ago", "yesterday", "2 days ago"); once a row
// is 3+ days old it switches to the actual calendar date (e.g. "12 Jun 2026"),
// so older entries are pinned to a real day, not a vague "47 days ago".
function whenLabel(ts) {
  if (!ts) return "";
  const secs = (Date.now() - new Date(ts).getTime()) / 1000;
  if (secs < 60) return "just now";
  if (secs < 3600) return Math.floor(secs / 60) + "m ago";
  if (secs < 86400) return Math.floor(secs / 3600) + "h ago";
  const days = Math.floor(secs / 86400);
  if (days < 3) return days === 1 ? "yesterday" : days + " days ago";
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// fullWhen: the exact date + time for the click-to-open detail card, e.g.
// "Sat, 14 Jun 2026, 14:32". Shown in the log detail dialog.
function fullWhen(ts) {
  if (!ts) return "—";
  // Pin to India time (Asia/Kolkata) so log times read the SAME for everyone — a manager or
  // admin viewing from another timezone otherwise saw shifted times that disagreed with the
  // IST business-day logic used everywhere else (one-time-zone rule, owner 2026-07-06).
  return new Date(ts).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
}

// ── Log retention control (the "Keep logs for …" dropdown) ───────────────────
// The owner picks how long each log is kept; a once-a-day database job
// (migration 053 — lfh_prune_logs) deletes anything older. It runs server-side
// on its own, NEVER on page load, so opening the logs stays instant. Max 90 days
// (3 months) and that's also the default. Bills are never affected.
const RETENTION_OPTS = [
  { d: 1, label: "1 day" },
  { d: 2, label: "2 days" },
  { d: 5, label: "5 days" },
  { d: 7, label: "7 days" },
  { d: 30, label: "1 month" },
  { d: 90, label: "3 months" },
];
// Human labels for the operation-log action codes (shared by the table row and
// the click-to-open detail card).
// Internal panel keys → friendly labels for the operation log (the manager panel's internal name
// is still "editor"; show it as "Manager"). (polish)
const PANEL_LABEL = { editor: "Manager", manager: "Manager", kitchen: "Kitchen", tablet: "Tablet", owner: "Owner", admin: "Admin", guest: "Guest" };
const OP_ACTION_LABELS = {
  order_accept: "Accepted order", order_serve: "Served order", order_ready: "Marked ready",
  order_discount: "Applied discount", table_open: "Opened table", table_close: "Closed table",
  table_shift: "Shifted table", transfer_head: "Transferred head", order_place: "Placed order",
  call_attend: "Attended call", member_approve: "Approved guest", sold_out_on: "Marked sold-out", sold_out_off: "Back in stock",
  login: "Signed in", logout: "Signed out",
  profile_setup: "Completed profile", profile_update: "Updated profile", pin_set: "Set PIN", password_change: "Changed password",
};
// which: "oplog_retention_days" (operation log) or "custlog_retention_days" (customer log).
function retentionControl(which) {
  const cur = Number((state.data.settings || {})[which]) || 90;
  const opts = RETENTION_OPTS
    .map((o) => `<option value="${o.d}"${o.d === cur ? " selected" : ""}>${o.label}</option>`)
    .join("");
  return `<label class="ret-ctl" title="Logs older than this are deleted automatically by a once-a-day cleanup. Your bills are never touched.">
      <i class="fas fa-clock-rotate-left"></i> Keep logs for
      <select class="ret-select" data-ret="${esc(which)}">${opts}</select>
    </label>`;
}
// Save a new retention choice. Sends ONLY this one field (a partial settings
// upsert leaves every other setting untouched), then updates local state so the
// dropdown stays put on the next redraw.
async function saveRetention(which, val) {
  const days = Math.min(Math.max(parseInt(val, 10) || 90, 1), 90);
  try {
    // No id here — the server keys settings by restaurant_id and fills the row's real id
    // itself. (Sending the legacy id:"site" used to collide with #1's PK on other tenants.)
    await api("POST", "/settings", { [which]: days });
    state.data.settings = { ...(state.data.settings || {}), [which]: days };
    const lbl = (RETENTION_OPTS.find((o) => o.d === days) || {}).label || days + " days";
    toast("Saved — old logs auto-delete after " + lbl, "ok");
  } catch (e) {
    toast("Couldn't save retention: " + e.message, "err");
  }
}

// logDetailDialog: the click-to-open card showing a single log row's FULL info —
// exact date + time, who/what/where. `rows` is [{ label, value }]. Reuses the
// confirm-overlay look so it matches every other dialog in the editor.
function logDetailDialog(title, rows) {
  const wrap = document.createElement("div");
  wrap.className = "confirm-overlay";
  // A row can be a SECTION heading ({ section:"When" }) or a value line
  // ({ label, value }). Section headings render even with no value; value lines
  // are dropped when empty so a row is tidy but never shows a blank field. A
  // section whose every value line is empty is skipped so we don't leave a lone heading.
  const isVal = (r) => r && r.value != null && r.value !== "";
  const kept = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r && r.section) {
      // Look ahead: keep this heading only if a value line follows before the next heading.
      let hasVal = false;
      for (let j = i + 1; j < rows.length && !rows[j].section; j++) { if (isVal(rows[j])) { hasVal = true; break; } }
      if (hasVal) kept.push(r);
    } else if (isVal(r)) {
      kept.push(r);
    }
  }
  const body = kept
    .map((r) => r.section
      ? `<div class="ld-sec"${r.accent ? ` style="color:${esc(r.accent)}"` : ""}>${esc(r.section)}</div>`
      : `<div class="ld-row"><span class="ld-k">${esc(r.label)}</span><span class="ld-v"${r.strong ? ` style="font-weight:800${r.color ? `;color:${esc(r.color)}` : ""}"` : ""}>${esc(r.value)}</span></div>`)
    .join("");
  wrap.innerHTML = `
    <div class="confirm-box logdetail">
      <div class="confirm-msg"><b>${esc(title)}</b></div>
      <div class="ld-list">${body}</div>
      <div class="confirm-actions"><button class="btn confirm-ok">Close</button></div>
    </div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { wrap.classList.remove("show"); document.removeEventListener("keydown", onKey); setTimeout(() => wrap.remove(), 200); };
  wrap.__lfhClose = close; // hardware Back closes via our close() (removes the keydown listener) — no leaked listener
  wrap.querySelector(".confirm-ok").onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  document.addEventListener("keydown", onKey);
}

// Fetch the whole board in one call. `fromPoll` = silent (no error toast, and don't
// stomp the editor while the owner is typing in an input).
let lastBoardSig = ""; // last rendered board fingerprint — skip needless re-renders on poll
// When the TARGETED realtime path (pollTables) runs, it sets this to the changed table
// numbers so reconcileBoard's render step does an INCREMENTAL patchFloorTiles(those) instead
// of a full renderEditor() — that's the fix for the 300-table freeze (one breadcrumb must not
// rebuild the whole grid). Null = render full (initial load, full poll, tab switch, etc.).
let targetedPatchTables = null;

// ── Serve debounce ───────────────────────────────────────────────────────────
// Marking dishes served one-by-one USED to refetch the whole board (3 network
// GETs) and redraw on EVERY click — so serving 1,2,3,4,5… felt laggy and the
// 1-second poll redrew on top of it. Now each serve click updates the board
// LOCALLY and redraws instantly (no network), and we do ONE real server
// reconcile only after you've STOPPED clicking for 5 seconds. While that flush
// is pending, the background poll leaves the open panel alone so it can't redraw
// under your fingers. (The click still saves to the server immediately — it's
// only the refetch/redraw that waits.)
let serveFlushTimer = null;
const SERVE_FLUSH_MS = 5000;
function scheduleServeFlush() {
  if (serveFlushTimer) clearTimeout(serveFlushTimer);
  serveFlushTimer = setTimeout(() => { serveFlushTimer = null; loadSessions(); }, SERVE_FLUSH_MS);
}
function serveFlushPending() { return serveFlushTimer != null; }

// mergeTableSlice: drop ONE table's rows from the board/data caches and add the freshly
// fetched rows for it, leaving every other table untouched. Used wherever we load a single
// table's FULL slice (the selected-table detail in loadSessions/pollOrders/pollTables, and
// the ensure-load before a tile quick-action). Last-wins by design — safe to call without a
// stale-ticket guard; the next poll reconciles. (Factored out so the four call sites can't drift.)
function mergeTableSlice(t, selBoard, selOrders, selCalls) {
  t = String(t);
  const dedupeById = (arr) => { const m = new Map(); for (const x of arr) if (x && x.id != null) m.set(x.id, x); return [...m.values()]; };
  const b = state.board || {};
  const freshSessions = (selBoard && selBoard.sessions) || [];
  const freshOrders = selOrders || [];
  // Purge set = anything CURRENTLY cached under table t UNION anything in the FRESH payload —
  // not table t alone. A SHIFT moves a session/its orders to a new table_number server-side; if
  // an earlier cleanup call for the party's OLD table got dropped (e.g. superseded by a
  // realtime-triggered pollTables bumping the dataSeq stale-ticket while it was still in
  // flight — a real race, not hypothetical), the party's rows stay cached under the OLD
  // table_number forever. Purging by table-tag ALONE then never catches them, so the next merge
  // for the NEW table adds a second copy on top → doubled guest names / doubled dishes (each
  // still keyed by the same session/order id). Matching by id too — not just by the current
  // table_number tag — plus a final dedupeById() safety net, is what tablet's mergeSelectedSlice
  // already does; this brings the editor's merge in line with it.
  const oldSids = new Set((b.sessions || []).filter((s) => String(s.table_number) === t).map((s) => s.id));
  for (const s of freshSessions) oldSids.add(s.id);
  const oldOids = new Set((state.data.orders || []).filter((o) => String(o.table_number) === t).map((o) => o.id));
  for (const o of freshOrders) oldOids.add(o.id);

  let orders = dedupeById((state.data.orders || []).filter((o) => !oldOids.has(o.id)).concat(freshOrders));
  orders = orders
    .filter((o) => !pendingDeletes.has(o.id))
    .map((o) => (pendingOrderOps.has(o.id) ? ((state.data.orders || []).find((x) => x.id === o.id) || o) : o));
  state.data.orders = orders;
  state.data.calls = dedupeById((state.data.calls || []).filter((c) => String(c.table_number) !== t).concat(selCalls || []));
  state.board = {
    sessions: dedupeById((b.sessions || []).filter((s) => !oldSids.has(s.id)).concat(freshSessions)),
    members: dedupeById((b.members || []).filter((m) => !oldSids.has(m.session_id)).concat((selBoard && selBoard.members) || [])),
    items: dedupeById((b.items || []).filter((i) => !oldSids.has(i.session_id)).concat((selBoard && selBoard.items) || [])),
    requests: (selBoard && selBoard.requests) || b.requests || [],
    blocklist: (selBoard && selBoard.blocklist) || b.blocklist || [],
  };
}

// Per-TABLE latest-wins guard: two overlapping loadTableSlice(t) calls (e.g. a slow one and
// a fast one during a table shift) could resolve out of order, letting the OLDER response
// clobber the newer cache for that table (the "real race, not hypothetical" the old comment
// flagged). Each fetch takes a ticket; a stale response whose ticket was superseded is dropped.
const tableSliceSeq = {};
// loadTableSlice(t): fetch ONE table's FULL slice (sessions/orders/calls ?table=N) and merge it
// into the board/data caches, so the helpers that read those caches (ordersForTable /
// callsForTable / openSessionForTable / itemsForOrder) return real rows for table t. The GRID
// renders from the slim summary and never needs this; it's for (1) the selected table's detail
// and (2) ENSURING a tile quick-action on a NON-selected table has the table's order ids to act
// on — without it those handlers would see an empty cache and do nothing.
async function loadTableSlice(t) {
  const key = String(t);
  const seq = (tableSliceSeq[key] = (tableSliceSeq[key] || 0) + 1);
  const q = "?table=" + encodeURIComponent(t);
  const [selBoard, selOrders, selCalls] = await Promise.all([api("GET", "/sessions" + q), api("GET", "/orders" + q), api("GET", "/calls" + q)]);
  if (seq !== tableSliceSeq[key]) return; // a newer slice for THIS table started — drop this stale one
  mergeTableSlice(t, selBoard, selOrders, selCalls);
}

// ensureTableSlice(t): load table t's full slice unless it's already the SELECTED table (whose
// slice is kept fresh by the pollers). Called at the top of every tile quick-action so the
// handler has table t's real order/call rows to act on, even when t isn't selected. Best-effort:
// a fetch failure leaves the caches as-is (the handler then no-ops rather than throwing).
async function ensureTableSlice(t) {
  if (detailTables().includes(String(t))) return; // the open-detail table's slice is already kept fresh
  try { await loadTableSlice(t); } catch {}
}

// detailTable(): which ONE table has its full DETAIL open right now — the in-panel master-
// detail (state.selectedTable, Tables tab) OR the collapsed-mode pop-up modal (state.openSess).
// Either way that table needs its FULL slice loaded (the grid renders from the slim summary, so
// only the open detail's table pulls full order/member rows). Returns null when no detail is open.
function detailTable() {
  return state.selectedTable != null ? String(state.selectedTable)
       : state.openSess != null ? String(state.openSess)
       : null;
}
// detailTables(): EVERY table whose full detail needs to stay loaded right now — everything
// detailTable() covers, PLUS every floating popup (owner request, 2026-07-02 — multiple
// tables' details open at once, each a separate draggable card). Used wherever fetching/
// merging/redraw-gating must account for ALL open details, not just the docked one.
function detailTables() {
  const set = new Set();
  const dt = detailTable();
  if (dt != null) set.add(dt);
  for (const f of state.floatingTables) set.add(String(f.table));
  return [...set];
}

// loadSessions: fetch (or reuse) the live tables board and redraw the floor. The
// `fromPoll` flag means "this was the automatic 1-second refresh", so we stay quiet
// (no error toast) and avoid redrawing while the owner is typing or clicking.
async function loadSessions(fromPoll) {
  // On a manual/action refresh we fetch fresh data; on a poll tick pollOrders has
  // already refreshed state.board/orders/calls, so we just render from it (no
  // double round-trip).
  if (!fromPoll) {
    const seq = ++dataSeq;
    try {
      // TIER 1: the slim per-tile SUMMARY drives the GRID + side-panel queues + chimes (mig 101).
      // TIER 2: every table with a DETAIL open (docked, collapsed-mode modal, OR floating —
      // detailTables(), owner 2026-07-02: multiple floating popups at once) ALSO gets its FULL
      // slice fetched (sessions/orders/calls ?table=N) in parallel, one 3-request group per
      // table, so each detail renders complete order rows + members. The grid never needs them.
      const sels = detailTables();
      const summaryReq = api("GET", "/summary");
      const sliceReqs = sels.map((t) => {
        const q = "?table=" + encodeURIComponent(t);
        return Promise.all([api("GET", "/sessions" + q), api("GET", "/orders" + q), api("GET", "/calls" + q)]);
      });
      const [summary, ...slices] = await Promise.all([summaryReq, ...sliceReqs]);
      if (seq !== dataSeq) return; // a newer refresh started — drop this stale snapshot
      // Take the summary unless a floor action's save is still travelling (same shield the
      // board used) — or a refresh landing mid-action would flicker an optimistic tile back.
      if (!floorOpsInFlight) state.summary = summary;
      // Merge EVERY open-detail table's full slice into the board/data caches (the rest of the
      // board is no longer fetched whole). The detail's ordersForTable/itemsForOrder read these.
      if (!floorOpsInFlight) sels.forEach((t, i) => mergeTableSlice(t, slices[i][0], slices[i][1], slices[i][2]));
      state.boardLoaded = true; // the live floor has arrived at least once → real tiles, not the skeleton
    } catch (e) {
      toast("Could not load tables: " + e.message, "err");
      return;
    }
  }
  if (state.tab !== "tables") return;
  // "sig" is a fingerprint of everything the GRID + the open-detail panel draw (the slim
  // summary, the open-detail table's order rows, AND its SESSION row). If a poll arrives
  // and the fingerprint hasn't changed, there's literally nothing new — so skip the redraw.
  //
  // The session row matters: the detail panel's "is this table open" state comes from
  // openSessionForTable() reading state.board.sessions, NOT from summary/orders. Opening a
  // table optimistically pre-sets its summary tile to "Open/waiting" BEFORE the real POST
  // lands (openTableSession) — so once the real session actually arrives, the tile's label
  // is already the same and there's still no order, meaning summary+orders alone produce the
  // IDENTICAL sig as the pre-open optimistic render. The dedup guard then thinks nothing
  // changed and skips the redraw that would show the table as open — the detail panel is
  // left stuck showing "this table isn't open yet" until some UNRELATED event happens to
  // change the sig (owner report, 2026-07-02: stuck 5+ seconds after tapping the tile's
  // quick Open button while that table's detail was already showing).
  // Folds in EVERY open detail (docked + every floating popup), not just one — a change to
  // ANY of them (including a floating popup you're not currently looking at the side panel
  // for) must still invalidate the dedup guard and redraw.
  const _dts = detailTables();
  const selOrdersSig = _dts.length
    ? (state.data.orders || []).filter((o) => _dts.includes(String(o.table_number)))
    : [];
  const selSessSig = _dts.length
    ? (state.board.sessions || []).filter((s) => _dts.includes(String(s.table_number)))
    : [];
  const sig = JSON.stringify(state.summary) + "|" + JSON.stringify(selOrdersSig) + "|" + JSON.stringify(selSessSig) + "|" + JSON.stringify(state.floatingTables.map((f) => [f.table, f.pinned]));
  if (fromPoll && sig === lastBoardSig) return;
  // DON'T rebuild the floor mid-drag/resize of a floating popup: renderEditor() replaces
  // #editor.innerHTML, tearing the dragged card out from under the pointer so the drop is
  // lost (owner-facing glitch — a live poll landing mid-drag snapped the popup back). Defer
  // the redraw and flush it on pointerup. We intentionally DON'T update lastBoardSig here, so
  // the flushed loadSessions(true) still sees sig !== lastBoardSig and actually redraws.
  if (fromPoll && floatInteracting) { floatRenderPending = true; return; }
  const ed = $("#editor");
  // Don't yank the floor out from under the owner mid-edit: if they're typing in a field
  // during a background poll, hold off on the full redraw. CRUCIALLY, also DON'T advance
  // lastBoardSig while we skip — otherwise the update that landed while they typed is
  // swallowed forever (the next poll sees the same sig and dedups it away). Leaving the sig
  // stale makes the very next poll redraw; a one-shot blur listener flushes it the instant
  // they leave the field, so they never wait for the 60s backstop. (B19)
  const typing = document.activeElement && ed.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (fromPoll && typing) {
    if (!state._boardFlushArmed) {
      state._boardFlushArmed = true;
      document.activeElement.addEventListener("blur", () => { state._boardFlushArmed = false; loadSessions(true); }, { once: true });
    }
    renderTablePanel(); // the legacy pop-up is a separate overlay — safe to refresh
    return;
  }
  state._boardFlushArmed = false;
  lastBoardSig = sig;
  // Keep the in-panel table detail's scroll across a background re-render so a
  // live poll never flings a half-read order list back to the top.
  const prevBody = ed.querySelector(".tp-detail-body");
  const detailTop = prevBody ? prevBody.scrollTop : 0;
  renderEditor();
  const newBody = ed.querySelector(".tp-detail-body");
  if (newBody) newBody.scrollTop = detailTop;
  renderTablePanel(); // refresh the legacy pop-up panel too, if one is open
}

// ---- session staff actions ----
// Each of these calls the server, then reloads the board and shows a toast. They
// all follow the same shape: do the action, refresh, confirm (or report a failure).

// flipOrderItems: locally mark every dish row of an order — the optimistic
// half of the quick actions; the server is told right after in the background.
function flipOrderItems(o, from, to) {
  (state.board.items || []).forEach((it) => { if (it.order_id === o.id && (!from || it.status === from)) it.status = to; });
  (o.items || []).forEach((it) => { if (!from || (it.status || "received") === from) it.status = to; });
}

// openTableSession: open (seat) a table so its guests can order.
// OPTIMISTIC: the tile flips to "Open" instantly via a temporary local
// session; the follow-up refresh swaps in the server's real one.
async function openTableSession(table) {
  const t = String(table);
  // TWO-TIER: the grid tile reads the SUMMARY, so flip THIS tile to "Open / waiting" in the
  // summary optimistically (and drop its pending requests — opening also approves them
  // server-side). The targeted refetch on success swaps in the server's real tile.
  const beforeTiles = Object.assign({}, (state.summary.tiles || {}));
  const beforeReqs = state.summary.requests || [];
  const tiles = Object.assign({}, beforeTiles);
  tiles[t] = Object.assign({}, tiles[t] || {}, { state: "waiting", label: "Open", meta: "waiting for guests", hasReq: false, reqs: 0 });
  state.summary = Object.assign({}, state.summary, {
    tiles,
    requests: beforeReqs.filter((r) => String(r.table_number) !== t),
  });
  floorOpsInFlight++;
  loadSessions(true); // render-only, no network
  try {
    const opened = await api("POST", "/sessions/open", { table: t });
    floorOpsInFlight--;
    // The POST response IS the real session row — merge it in and redraw right away instead
    // of waiting for pollTables' extra round-trip to fetch the exact same thing a moment
    // later. This is what made the detail panel feel laggy when it was already open for this
    // table (owner report, 2026-07-02): it sat on "not open yet" until that second fetch
    // landed. pollTables still runs after, as the usual reconcile/safety net.
    if (opened && opened.id) {
      state.board = Object.assign({}, state.board, {
        sessions: (state.board.sessions || []).filter((s) => s.id !== opened.id).concat(opened),
      });
      loadSessions(true);
    }
    await pollTables([t]);
    toast("Table opened", "ok");
  }
  catch (e) {
    floorOpsInFlight--;
    state.summary = Object.assign({}, state.summary, { tiles: beforeTiles, requests: beforeReqs }); // undo
    loadSessions(true);
    toast("Could not open: " + e.message, "err");
  }
}
// summaryTableOpen(t): is table t currently OPEN, per the slim summary? A tile is open
// when it has a summary entry whose state is anything but 'free' or 'req' (those two mean
// no open session). The board is no longer fetched whole, so the bulk actions read this.
function summaryTableOpen(t) {
  const tile = (state.summary.tiles || {})[String(t)];
  return !!tile && tile.state !== "free" && tile.state !== "req";
}
// openAllTables: seat every table that isn't open yet, in one go (asks first).
async function openAllTables() {
  const n = Math.max(1, parseInt((state.data.settings || {}).table_count, 10) || 12);
  const targets = [];
  for (let i = 1; i <= n; i++) if (!summaryTableOpen(String(i))) targets.push(String(i));
  if (!targets.length) return toast("Every table is already open", "ok");
  if (!(await confirmDialog(`Open all ${targets.length} remaining table${targets.length > 1 ? "s" : ""}?`, "Open all"))) return;
  // INSTANT: flip every target tile to "Open" (waiting, no guests yet) in the local summary NOW,
  // so the whole floor looks open immediately — then ONE bulk call (mig 102) opens them all in a
  // single round-trip server-side, then reconcile to the truth. floorOpsInFlight shields the
  // optimistic tiles from a background poll clobbering them mid-flight.
  floorOpsInFlight++;
  const tiles = Object.assign({}, state.summary.tiles || {});
  for (const t of targets) tiles[t] = Object.assign({}, tiles[t], {
    state: "waiting", label: "Open", meta: "waiting for guests",
    counts: { nw: 0, ck: 0, rd: 0, sv: 0 }, due: 0, pay: "",
    members: 0, pending: 0, hasNew: false, hasCall: false, hasReq: false, hasJoin: false, reqs: 0, calls: 0,
  });
  state.summary = Object.assign({}, state.summary, { tiles });
  loadSessions(true); // re-render the optimistic tiles immediately (no fetch)
  try {
    const res = await api("POST", "/sessions/open-all", {});
    floorOpsInFlight--;
    await loadSessions(); // one full summary refresh → reconcile to server truth
    toast(`Opened ${(res && res.opened) || targets.length} table${(((res && res.opened) || targets.length) > 1) ? "s" : ""}`, "ok");
  } catch (e) {
    floorOpsInFlight--;
    await loadSessions(); // reconcile back to truth on failure
    toast("Could not open all: " + e.message, "err");
  }
}
// closeAllTables: end EVERY open session at once (asks first — guests at those
// tables can no longer order until reopened).
async function closeAllTables() {
  // Open tables come from the SLIM summary (state.summary.tiles) — no whole-board fetch needed.
  // A tile is "open" when it has a session: any state except free/req.
  const tiles = state.summary.tiles || {};
  const openTables = Object.keys(tiles).filter((t) => { const st = tiles[t].state; return st && st !== "free" && st !== "req"; });
  if (!openTables.length) return toast("No open tables", "ok");
  // Floor-wide = the scary red confirm so it can't be mistaken for the one-table popup.
  if (!(await confirmDialog(`Close ALL ${openTables.length} open table${openTables.length > 1 ? "s" : ""}? Guests at them can't order until reopened.`, `Close all ${openTables.length}`, { floorwide: true }))) return;
  // INSTANT: free every CLOSEABLE tile now (same guard the server uses — a table that owes money
  // [pay red] or is still cooking [received/preparing counts] is NOT closeable, so leave it). One
  // bulk call (mig 103) closes them server-side, then reconcile. floorOpsInFlight shields optimism.
  const isBlocked = (t) => { const x = tiles[t] || {}; const c = x.counts || {}; return x.pay === "red" || (c.nw || 0) > 0 || (c.ck || 0) > 0; };
  floorOpsInFlight++;
  const nt = Object.assign({}, tiles);
  for (const t of openTables) if (!isBlocked(t)) delete nt[t]; // dropped tile → renders as Free
  state.summary = Object.assign({}, state.summary, { tiles: nt });
  loadSessions(true); // render the optimistic frees immediately (no fetch)
  try {
    const res = await api("POST", "/sessions/close-all", {});
    floorOpsInFlight--;
    await loadSessions(); // reconcile to server truth
    const closed = (res && res.closed) || 0, skipped = (res && res.skipped) || 0;
    const closedTables = (res && res.closed_tables) || [];
    if (!closed && skipped) return toast(`Couldn't close ${skipped} table${skipped > 1 ? "s" : ""} — they owe money or still have food cooking.`, "err");
    // Gmail-style 8s action: REOPEN the tables we just closed (as fresh, empty tables). Close-all only
    // ever closes fully-SETTLED tables, so there's no party or unpaid bill left to restore — hence
    // "Reopen", not "Undo" (which wrongly implied the old party/orders would come back). (B26)
    const reopenClosed = async () => {
      await Promise.allSettled(closedTables.map((tb) => api("POST", "/sessions/open", { table: tb })));
      await loadSessions();
      toast(`Reopened ${closedTables.length} table${closedTables.length > 1 ? "s" : ""}`, "ok");
    };
    const closedMsg = skipped ? `Closed ${closed}, left ${skipped} (unpaid/cooking)` : `Closed ${closed} table${closed > 1 ? "s" : ""}`;
    if (closedTables.length && window.LFH_UNDO) LFH_UNDO.show({ message: closedMsg, sub: `Tap undo to reopen ${closedTables.length} table${closedTables.length > 1 ? "s" : ""}`, icon: "🔓", undoLabel: "Reopen", seconds: 6, onUndo: reopenClosed });
    else toast(closedMsg, skipped ? "err" : "ok", closedTables.length ? { label: "Reopen", fn: reopenClosed } : undefined, 8000);
  } catch (e) {
    floorOpsInFlight--;
    await loadSessions(); // reconcile back to truth on failure
    toast("Could not close all: " + e.message, "err");
  }
}
// closeSession: end a table's session. The SERVER now scopes the order cleanup to
// this session and archives them (no client-side loop needed), and it BLOCKS the
// close while money is owed — so we offer an explicit "close anyway" override.
async function closeSession(id, force) {
  if (!force && !(await confirmDialog("Close this session? Guests at this table can no longer order or call until it's reopened.", "Close session"))) return;
  // Grab the table number BEFORE we close (the session row disappears after loadSessions),
  // so we can also drop any FLOATING popup showing it — otherwise a popup lingered on the
  // now-freed table (close from popup mode left the wrong table on screen).
  const closedTnum = (state.board.sessions || []).find((s) => s.id === id)?.table_number;
  try {
    await api("POST", "/sessions/" + id + "/close", force ? { force: true } : undefined);
    state.openSess = null; state.selectedTable = null; document.querySelector(".tbl-modal-overlay")?.remove(); // close modal AND the in-panel detail
    if (closedTnum != null) state.floatingTables = state.floatingTables.filter((f) => String(f.table) !== String(closedTnum));
    await loadSessions();
    toast("Table closed — bill moved to Previous", "ok");
  } catch (e) {
    // Server refuses to close a table that still owes money — offer the override.
    if (/owes money/i.test(String(e && e.message))) {
      if (await confirmDialog("This table still OWES money. Close anyway? The unpaid bill is recorded in the log.", "Close anyway")) return closeSession(id, true);
      return;
    }
    toast("Could not close: " + e.message, "err");
  }
}
// setSessAutoApprove: turn on/off "let new joiners in automatically" for a table.
async function setSessAutoApprove(id, value) {
  try { await api("POST", "/sessions/" + id + "/auto-approve", { value: !!value }); await loadSessions(); toast(value ? "Auto-approve on" : "Auto-approve off", "ok"); }
  catch (e) { toast("Failed: " + e.message, "err"); }
}
// memberAction: approve a waiting guest, or remove one from the table.
// OPTIMISTIC: flip the local member NOW + redraw instantly, so a click feels immediate
// even with a big party — instead of waiting ~3s for the server round-trip + refetch
// (owner 2026-06-26: "whenever I click it, instantly it should update"). The awaited
// server call + loadSessions then confirm; on failure we revert the optimistic change.
async function memberAction(id, kind) {
  const m = (state.board.members || []).find((x) => x.id === id);
  const prev = m ? { approved: m.approved, removed: m.removed } : null;
  if (m) { if (kind === "approve") m.approved = true; else m.removed = true; refreshTableDetail(); }
  try {
    await api("POST", "/members/" + id + "/" + (kind === "approve" ? "approve" : "remove"));
    await loadSessions();
    toast(kind === "approve" ? "Approved" : "Removed", "ok");
  } catch (e) {
    if (m && prev) { m.approved = prev.approved; m.removed = prev.removed; refreshTableDetail(); } // revert on failure
    toast("Failed: " + e.message, "err");
  }
}
// Kick = remove now (works for the head too; the table stays open). Ban = kick +
// add to the blocklist (by member id, and phone if we have one).
async function kickMember(id) {
  if (!(await confirmDialog("Kick this guest from the table? Their access ends now — the table stays open.", "Kick"))) return;
  try { await api("POST", "/members/" + id + "/remove"); await loadSessions(); toast("Kicked", "ok"); }
  catch (e) { toast("Failed: " + e.message, "err"); }
}
// Transfer the table: this guest becomes the HEAD (owns the tab, approves
// joiners) and the current head is kicked out — for when the original head left
// the café or never answers join requests. Confirmed first: it's a hand-over.
async function makeHead(id) {
  if (!(await confirmDialog("Make this guest the table's head? The current head is kicked out and this guest takes over approvals.", "Transfer"))) return;
  try { await api("POST", "/members/" + id + "/make-head"); await loadSessions(); toast("Head transferred", "ok"); }
  catch (e) { toast("Failed: " + e.message, "err"); }
}
async function banMember(id, phone) {
  if (!(await confirmDialog("Ban this guest? They're kicked now and added to the blocklist.", "Ban"))) return;
  try {
    await api("POST", "/blocklist", { member_id: id, phone: phone || undefined }); // server also kicks them from their seat in the same call now (B23)
    await loadSessions(); toast("Banned", "ok");
  } catch (e) { toast("Failed: " + e.message, "err"); }
}
// itemStatus: move one session item forward (received → preparing → served).
// Saves to the server right away, then updates the board LOCALLY and redraws
// instantly (no refetch). The real reconcile happens 5s after the last click —
// see scheduleServeFlush — so serving several dishes in a row stays smooth.
async function itemStatus(id, status) {
  const it = (state.board.items || []).find((i) => i.id === id);
  const prev = it ? it.status : null;
  if (it) it.status = status;   // optimistic FIRST → the pill flips instantly (no waiting on the network)
  refreshTableDetail();         // instant redraw from local state (modal OR in-panel detail)
  scheduleServeFlush();         // sets the guard so the poll won't repaint under the finger; reconciles after the last click
  try {
    await api("POST", "/items/" + id + "/status", { status });   // persist in the background
    // Serving a dish is easy to mis-tap — offer a few-second takeback (owner, 2026-07-22).
    if (status === "served" && prev && prev !== "served" && window.LFH_UNDO) {
      const ord = it ? (state.data.orders || []).find((x) => x.id === it.order_id) : null;
      LFH_UNDO.show({
        message: `${(it && it.title) || "Dish"} served`,
        sub: ord ? `Table ${ord.table_number} · tap undo to put it back` : "Tap undo to put it back",
        onUndo: () => editorUndoServe([{ kind: "session", id, prev }]),
      });
    }
  } catch (e) {
    if (it && prev != null) { it.status = prev; refreshTableDetail(); } // revert the optimistic change on failure
    toast("Failed: " + e.message, "err");
  }
}
// resolveRequest: approve or dismiss a queued "let me in / open this table" request.
// OPTIMISTIC: the request row leaves the queue instantly; the real refresh
// afterwards brings in whatever the approval created (e.g. the new session).
async function resolveRequest(id, status) {
  // The side panel + tile badges read the SUMMARY's requests now, so the optimistic removal
  // mutates state.summary.requests (the row leaves the queue instantly); the refresh afterwards
  // brings in whatever the approval created (e.g. the new session) via a fresh summary.
  const before = (state.summary.requests || []);
  state.summary = Object.assign({}, state.summary, { requests: before.filter((r) => r.id !== id) });
  floorOpsInFlight++;
  loadSessions(true);
  try { await api("POST", "/requests/" + id + "/resolve", { status }); floorOpsInFlight--; await loadSessions(); toast(status === "approved" ? "Approved" : "Dismissed", "ok"); }
  catch (e) { floorOpsInFlight--; state.summary = Object.assign({}, state.summary, { requests: before }); loadSessions(true); toast("Failed: " + e.message, "err"); }
}
// block: add a phone/table to the blocklist (opts says which).
async function block(opts) {
  try { await api("POST", "/blocklist", opts); await loadSessions(); toast("Blocked", "ok"); }
  catch (e) { toast("Could not block: " + e.message, "err"); }
}
// unblock: remove an entry from the blocklist.
async function unblock(id) {
  try { await api("DELETE", "/blocklist/" + id); await loadSessions(); toast("Unblocked", "ok"); }
  catch (e) { toast("Could not unblock: " + e.message, "err"); }
}
// attendCall: mark a waiter call as handled.
// OPTIMISTIC: the row leaves the "Needs" list (and the tile emoji) instantly. The "Needs"
// card + tile emojis read the SUMMARY's calls now, so we mutate state.summary.calls; the
// refresh on success reconciles (the tile's hasCall flag comes from the server tile).
async function attendCall(id) {
  const before = state.summary.calls || [];
  const target = before.find((c) => c.id === id);
  state.summary = Object.assign({}, state.summary, { calls: before.filter((c) => c.id !== id) });
  floorOpsInFlight++;
  loadSessions(true);
  try {
    await api("PATCH", "/calls/" + id, { resolved: true });
    floorOpsInFlight--;
    if (target && target.table_number) await pollTables([String(target.table_number)]); else await loadSessions();
    // A mis-tapped "Done" silently drops a real guest call — offer a takeback (2026-07-22).
    if (window.LFH_UNDO) LFH_UNDO.show({
      message: "Call attended",
      sub: target ? `Table ${target.table_number} · ${target.note || "call"} — tap undo` : "Tap undo to put the call back",
      icon: "🔔",
      onUndo: async () => { try { await api("PATCH", "/calls/" + id, { resolved: false }); await loadSessions(); } catch (e) { toast("Undo failed: " + e.message, "err"); await loadSessions(); } },
    });
    else toast("Marked attended", "ok");
  }
  catch (e) { floorOpsInFlight--; state.summary = Object.assign({}, state.summary, { calls: before }); loadSessions(true); toast("Failed: " + e.message, "err"); }
}

// ===================== UNIFIED FLOOR — one control center for every table =====================
// One map; tap a table to open ONE panel that does it all: open the table, take & advance
// orders (per-item when it's a session, order-level otherwise), manage guests, attend calls,
// see the bill, mark paid, and free the table. Works whether dining sessions are on or off.

// Five quick lookups used all over the unified floor — each filters the loaded
// data down to one table (or one order):
const ordersForTable = (t) => {
  const list = (state.data.orders || []).filter((o) => !o.archived && (o.table_number || "").trim() === String(t)); // live orders at table t
  const sessionsOn = !!(state.data.settings || {}).sessions_enabled;
  // If sessions are ON and this table has NO open session, any leftover non-archived
  // orders belong to a CLOSED session (stale) — the meal's over, nobody's there. Don't
  // paint the tile with them; the table is Free. (Same guard callsForTable uses, so a
  // closed table can never keep showing "Preparing"/"Served" from an old order.)
  if (sessionsOn && !openSessionForTable(t)) return [];
  return list;
};
const openSessionForTable = (t) => (state.board.sessions || []).find((s) => String(s.table_number) === String(t) && s.status === "open"); // t's open session
// sliceLoaded(t): has table t's FULL slice (its session row OR any live order) landed in
// memory yet? The two-tier design (mig 101) only fetches a table's full slice when its
// detail opens — so before that first fetch, ordersForTable/openSessionForTable are empty
// even for an occupied table. This tells the detail builder whether to render the real
// dish rows (loaded) or an instant "loading details…" placeholder driven by the always-
// fresh summary tile (streaming) — the stale-while-revalidate pattern that removes the
// 1-2s blank-panel wait without any extra fetch. (owner report, 2026-07-02)
function sliceLoaded(t) {
  const s = String(t);
  return (state.board.sessions || []).some((x) => String(x.table_number) === s)
      || (state.data.orders || []).some((o) => !o.archived && String(o.table_number) === s);
}
// Open (unresolved) waiter calls at table t. Safety net: when dining sessions are
// ON, a call only counts while the table is actually OPEN — so a free/closed table
// can never show a lingering "call" badge even if a stale row slipped through.
const callsForTable = (t) => {
  const list = (state.data.calls || []).filter((c) => !c.resolved && (c.table_number || "").trim() === String(t));
  const sessionsOn = !!(state.data.settings || {}).sessions_enabled;
  if (sessionsOn && !openSessionForTable(t)) return [];
  return list;
};
// An "open" request is MOOT once the table is open (already fulfilled) — never show it
// on an open table. join/access requests stay valid on an open table. (owner, 2026-06-18)
const reqsForTable = (t) => (state.board.requests || []).filter((r) => String(r.table_number) === String(t) && !(r.type === "open" && openSessionForTable(t)));
const itemsForOrder = (oid) => (state.board.items || []).filter((i) => i.order_id === oid); // the session items belonging to one order

// Per-item rows for an order, unified: session order_items if present, else the items JSON.
function orderItemRows(o) {
  const rows = itemsForOrder(o.id);
  // Carry options/removed/note through so the table panel can show the full
  // customization (what the guest chose, what to leave out) — not just the name.
  if (rows.length) return rows.map((it) => ({ kind: "session", id: it.id, title: it.title, qty: it.qty, status: it.status, options: it.options, removed: it.removed, note: it.note, price: Number(it.unit_price) || 0, added: it.added_allergens, removedFlag: it.removed_flag }));
  return (o.items || []).map((it, idx) => ({ kind: "legacy", orderId: o.id, idx, title: it.title, qty: it.qty, status: it.status || "received", options: it.options, removed: it.removed, note: it.note, price: Number(it.price) || 0 }));
}

// What the guest tapped, as an emoji for the tile / call list.
function callEmoji(note) {
  const n = (note || "").toLowerCase();
  if (n.includes("water")) return "💧";
  if (n.includes("cutlery") || n.includes("fork") || n.includes("spoon")) return "🍴";
  if (n.includes("napkin")) return "🧻";
  if (n.includes("clean")) return "🧹";
  if (n.includes("bill") || n.includes("check") || n.includes("cheque")) return "🧾";
  return "🙋";
}

// One tile's state — every situation gets its OWN colour (free/seated/new/prep/bill/done).
// Given a table number, this works out everything the tile needs: its colour (st),
// its label/sub-label, the little corner badges (requests, joiners, cart, calls),
// whether the outline should be red (unpaid) or green (paid), and a few flags the
// floor uses to decide which quick-action button to show.
//
// TWO-TIER (2026-06-27): the GRID renders 300 tiles from the slim server SUMMARY
// (state.summary.tiles) — NOT the full board, which is no longer fetched whole. So
// tableTileState DISPATCHES: the SELECTED table (whose full slice we DO fetch on tap,
// into state.board/state.data) is computed live from the board so its detail head-pill
// and optimistic flips stay pixel-identical; every OTHER tile reads the pre-computed
// summary tile. The summary is produced by lfh_table_view_summary, which mirrors
// tableTileStateFromBoard's rules EXACTLY (parity verified DB-side, mig 101).
// ── Special table types (VIP / Family / Owner's Guest) + khata — mig 166 ──────
// The tile look for each mark. APPROVED design (docs/superpowers/specs/
// 2026-07-22-table-tags-mockup.html) — VIP + Family ship exactly as the mockup.
const TABLE_TAG_INFO = {
  vip:    { label: "VIP",           emoji: "👑", ribbon: "👑 VIP" },
  family: { label: "Family",        emoji: "🏠", ribbon: "FAMILY" },
  guest:  { label: "Owner's guest", emoji: "🤝", ribbon: "GUEST" },
};
// The feature ladder's application rung, resolved from settings (mig 166):
// admin's switch AND (owner's toggle, only while the admin transferred control).
function tableTagsOn() {
  const s = state.data.settings || {};
  return s.table_tags_allowed === true && (s.table_tags_owner_control !== true || s.table_tags_enabled !== false);
}
// May the CURRENT viewer use a tag/khata action? Admin + owner always (higherView);
// a real manager needs the owner-granted power (whoami.effectivePowers).
function tagActionAllowed(flag) {
  // ADMIN X-RAY rule (owner 2026-07-22): the admin view always sees module buttons,
  // tinted (XRAY_CONTROLS) when off for real staff; the server lets the admin through.
  if (XRAY_WHO && XRAY_WHO.actor === "admin") return true;
  if (!tableTagsOn()) return false;
  if (XRAY_WHO && XRAY_WHO.higherView) return true;
  return xrayGrantedForManager(flag);
}
// This table's mark ('' when none) — the slim summary carries it for every tile.
// ADMIN X-RAY rule (owner 2026-07-23): the admin console sees/uses EVERY feature, so a
// mark ALWAYS renders in the admin view regardless of the restaurant's feature toggle.
// A real manager/waiter sees it only when the feature is actually on for them.
function tagForTable(t) {
  const adminView = XRAY_WHO && XRAY_WHO.actor === "admin";
  if (!adminView && !tableTagsOn()) return "";
  const tile = (state.summary.tiles || {})[String(t)];
  return (tile && tile.tag) || "";
}

function tableTileState(t) {
  // SELECTED table → live-from-board (we have its full slice; keeps detail + optimism exact).
  if (state.selectedTable != null && String(state.selectedTable) === String(t) && state.board && (state.board.sessions || []).length >= 0) {
    // Only use the board path when we actually have this table's slice loaded; otherwise
    // fall through to the summary so we never render a selected table as blank "Free".
    const hasSlice = (state.board.sessions || []).some((s) => String(s.table_number) === String(t))
      || (state.data.orders || []).some((o) => String(o.table_number) === String(t));
    if (hasSlice) return tableTileStateFromBoard(t);
  }
  return tableTileStateFromSummary(t);
}

// Build a tile from the slim server summary (state.summary.tiles[t]). The summary already
// carries the computed state/label/meta/counts/due/pay + the badge COUNTS; we only rebuild
// the small derived bits the renderer wants: the badges HTML (call emojis come from the
// summary's tiny per-restaurant calls[] list, filtered to this table) and the `done` flag.
function tableTileStateFromSummary(t) {
  const tile = (state.summary.tiles || {})[String(t)];
  if (!tile) return { st: "free", label: "Free", meta: "tap to open", badges: "", counts: { nw: 0, ck: 0, rd: 0, sv: 0 }, pay: "", done: false, hasNew: false, hasCall: false, hasReq: false, hasJoin: false };
  const calls = (state.summary.calls || []).filter((c) => !c.resolved && (c.table_number || "").trim() === String(t));
  let badges = "";
  if (tile.reqs) badges += `<span class="ftb req">📨${tile.reqs}</span>`;
  if (tile.pending) badges += `<span class="ftb join">🙋${tile.pending}</span>`;
  calls.slice(0, 3).forEach((c) => { badges += `<span class="ftb call">${callEmoji(c.note)}</span>`; });
  if (calls.length > 3) badges += `<span class="ftb call ftb-more">+${calls.length - 3}</span>`;
  return {
    st: tile.state, label: tile.label, meta: tile.meta, badges,
    counts: tile.counts || { nw: 0, ck: 0, rd: 0, sv: 0 },
    pay: tile.pay || "",
    done: tile.state === "done" && tile.pay !== "red", // served AND paid → offer RST/CLS
    hasNew: !!tile.hasNew, hasCall: !!tile.hasCall, hasReq: !!tile.hasReq, hasJoin: !!tile.hasJoin,
  };
}

// The ORIGINAL full-board computation — now used ONLY for the selected table's detail (and
// as the parity reference the SQL summary mirrors). Unchanged logic.
function tableTileStateFromBoard(t) {
  const os = ordersForTable(t);
  const sess = openSessionForTable(t);
  const mem = sess ? membersOf(sess.id) : [];
  const pending = mem.filter((m) => !m.approved).length;
  const cart = sess && Array.isArray(sess.cart) ? sess.cart : []; // shared cart being built, not yet ordered
  const cartCount = cart.reduce((a, it) => a + (parseInt(it.qty, 10) || 1), 0);
  const calls = callsForTable(t);
  const reqs = reqsForTable(t); // pending open/join/access requests (guest asked staff to let them in)
  // EXCLUDE cancelled orders from the dish tally — a cancelled order's item rows keep their last
  // status (ready/cooking/served), so counting them made the SELECTED tile disagree with (a) the
  // detail head (which filters cancelled via liveRowsAll), (b) the SQL summary every OTHER tile
  // uses (mig 105: WHERE status <> 'cancelled'), and (c) the tablet (ordersOf). That mismatch was
  // the "click a table → its served/total jumps + state flips wrong" bug (owner 2026-07-06). PARITY
  // IS LAW: this now matches all three. (Money/`due`/`pay` already exclude cancelled via isUnpaidBill.)
  const liveOs = os.filter((o) => o.status !== "cancelled"); // the orders that actually count (summary uses this too)
  const items = liveOs.flatMap((o) => orderItemRows(o));
  // Counts are by QUANTITY (plates), not row count — a "2× Cappuccino" line is 2 cooking, not 1.
  // Mirrors the summary RPC (mig 105) and the tablet detail so every tile agrees. (owner 2026-06-29)
  const qtyOf = (i) => Math.max(0, parseInt(i.qty, 10) || 1);
  const anyReceived = items.some((i) => i.status === "received");
  const anyPreparing = items.some((i) => i.status === "preparing");
  const anyReady = items.some((i) => i.status === "ready"); // cooked, waiting for the waiter
  // An order only becomes an "unpaid bill" (red outline) once it's ACCEPTED. A
  // brand-new order still sitting at "received" hasn't been confirmed by staff
  // yet, so it shouldn't flag the table red — that starts when you accept it.
  const isUnpaidBill = (o) => o.status !== "cancelled" && o.status !== "received" && o.payment_status !== "paid";
  const unpaid = os.some(isUnpaidBill);
  // discount-before-tax (billMath) so the tile "due" matches the bill / server summary
  const due = billMath(os.filter(isUnpaidBill)).total;

  let st = "free", label = "Free", meta = "tap to open";
  if (liveOs.length) { // gate on NON-cancelled orders — matches the summary's v_has_orders (mig 105 excludes cancelled)
    if (anyReceived) { st = "new"; label = "New order"; }
    // ANY cooked-but-unserved dish turns the tile pink ("Ready to serve") — even if
    // OTHER dishes are still cooking — so staff see at a glance there's something to
    // carry out. (Was: only when EVERY dish was ready, because anyPreparing was checked
    // first.) Now matches the tablet's tile precedence (new → ready → prep). (2026-06-18)
    else if (anyReady) { st = "ready"; label = "Ready to serve"; } // food cooked, not yet carried out
    else if (anyPreparing) { st = "prep"; label = "Preparing"; }

    // No separate "Bill due" fill anymore (owner, 2026-06-10): payment is
    // already told by the OUTLINE (red = unpaid, green = paid), so a fully
    // served table just says "Served" until it's paid, then "Cleared".
    else if (unpaid) { st = "bill"; label = "Served"; } // served but money still due → yellow "to pay" tile
    else { st = "done"; label = "Cleared"; }
    const served = items.filter((i) => i.status === "served").reduce((a, i) => a + qtyOf(i), 0);
    const totalQ = items.reduce((a, i) => a + qtyOf(i), 0);
    meta = items.length ? `${served}/${totalQ} served${due > 0 ? ` · ${inr(due)} due` : ""}` : `${liveOs.length} order${liveOs.length > 1 ? "s" : ""}`;
  } else if (sess) {
    // Someone actually seated → teal "Seated". Open but nobody seated yet → a
    // bright YELLOW "waiting" tile (owner: an open-but-empty table should light up
    // yellow, not look dark/off). The building cart isn't shown on the tile.
    if (mem.length) { st = "seated"; label = `Seated · ${mem.length}`; meta = "no orders yet"; }
    else { st = "waiting"; label = "Open"; meta = "waiting for guests"; }
  } else if (reqs.length) {
    // free table, but a guest is asking to be let in -> make it shout for attention
    st = "req"; label = "Wants in";
    meta = reqs[reqs.length - 1].type === "open" ? "asked to open" : "asked for access";
  }
  let badges = "";
  if (reqs.length) badges += `<span class="ftb req">📨${reqs.length}</span>`;
  if (pending) badges += `<span class="ftb join">🙋${pending}</span>`;
  // One emoji per ACTIVE waiter call (water 💧, napkins 🧻, clean 🧹…), up to 3,
  // then a "+N" pill if there are more. The cart is deliberately NOT badged here.
  calls.slice(0, 3).forEach((c) => { badges += `<span class="ftb call">${callEmoji(c.note)}</span>`; });
  if (calls.length > 3) badges += `<span class="ftb call ftb-more">+${calls.length - 3}</span>`;
  return {
    st, label, meta, badges,
    // Per-status dish counts → the tile progress bar (matches the tablet's .tstrip).
    counts: {
      nw: items.filter((i) => i.status === "received").reduce((a, i) => a + qtyOf(i), 0),
      ck: items.filter((i) => i.status === "preparing").reduce((a, i) => a + qtyOf(i), 0),
      rd: items.filter((i) => i.status === "ready").reduce((a, i) => a + qtyOf(i), 0),
      sv: items.filter((i) => i.status === "served").reduce((a, i) => a + qtyOf(i), 0),
    },
    // Outline = payment, but ONLY once an order is accepted: red = an accepted
    // unpaid bill, green = accepted & fully paid, none = nothing accepted yet (a
    // brand-new "received" order shows no pay ring until staff accepts it).
    pay: unpaid ? "red" : (os.some((o) => o.status !== "cancelled" && o.status !== "received" && o.payment_status === "paid") ? "green" : ""),
    done: st === "done" && !unpaid, // served AND paid → offer RST/CLS (never free an unpaid table)
    hasNew: anyReceived,        // a new order waiting to be accepted
    hasCall: calls.length > 0,
    hasReq: reqs.length > 0,    // a guest is waiting to be let in
    hasJoin: pending > 0,       // a partner asked to join and awaits approval
  };
}

// floorTileHtml(i): build the FULL outer HTML for ONE floor tile (table number i).
// This is the SINGLE source of truth for a tile's markup — BOTH the full-floor render
// (floorHtml's loop) AND the incremental patch (patchFloorTiles) call this, so a tile
// drawn either way is byte-identical (no path-divergent rendering). The state/label/
// meta/badges/quick all come from tableTileState(i) exactly as before.
function floorTileHtml(i) {
  const s = state.data.settings || {};
  const sessionsOn = !!s.sessions_enabled;
  const { st, label, meta, badges, counts, pay, done, hasNew, hasCall, hasReq, hasJoin } = tableTileState(i); // everything this tile needs
  // Status progress bar (new→cooking→ready→served), same colours as the tablet's .tstrip.
  const cTot = counts.nw + counts.ck + counts.rd + counts.sv;
  const strip = cTot > 0 ? `<div class="ft-strip">${counts.nw ? `<i style="width:${(counts.nw / cTot) * 100}%;background:#f59e0b"></i>` : ""}${counts.ck ? `<i style="width:${(counts.ck / cTot) * 100}%;background:#4f9dff"></i>` : ""}${counts.rd ? `<i style="width:${(counts.rd / cTot) * 100}%;background:#ec4899"></i>` : ""}${counts.sv ? `<i style="width:${(counts.sv / cTot) * 100}%;background:#22c55e"></i>` : ""}</div>` : "";
  // quick action(s) on the tile itself — no need to open the detail view.
  // Show the ONE button that matches the table's situation right now.
  let quick = "";
  if ((st === "free" || st === "req") && sessionsOn) quick = `<button class="btn small primary ftq" data-quick-open="${i}">Open</button>`;
  else if (hasNew) quick = `<button class="btn small primary ftq" data-quick-accept="${i}">Accept</button>`;
  // Someone is ASKING at this table (a partner waiting to join, or a request on
  // an occupied table) → an Attend button right on the tile (owner, 2026-06-12).
  // It opens the table's panel, where the decision lives (OK/Transfer/✕/Ban) —
  // a request needs a choice, so unlike a water call it can't be blind-resolved.
  else if (hasJoin || hasReq) quick = `<button class="btn small primary ftq" data-quick-requests="${i}">Attend</button>`;
  else if (done) quick = `<div class="ft-quick2"><button class="btn small ftq2" data-quick-restart="${i}" title="Restart — clear orders, keep table open">RST</button><button class="btn small primary ftq2" data-quick-close="${i}" title="Close & free the table">CLS</button></div>`;
  // Served but unpaid → a one-tap "Mark paid" right on the tile (it confirms first).
  else if (st === "bill") quick = `<button class="btn small primary ftq" data-quick-pay="${i}">💳 Mark paid</button>`;
  else if (hasCall) quick = `<button class="btn small ftq" data-quick-attend="${i}">Attend</button>`;
  // A faint chair watermark marks an OFF/free table (an empty seat) — a quiet,
  // premium cue that the table is available.
  // Seat count rides along the SAME watermark (owner request, 2026-07-01 — "how much
  // person can sit"), from the table_seats setting (migration 111); no entry → 4.
  const seats = (s.table_seats || {})[String(i)] || 4;
  const offIcon = st === "free" ? `<div class="ft-officon" aria-hidden="true"><i class="fas fa-chair"></i><span>${seats}</span></div>` : "";
  // Display name (mig 131): the tile badge shows the name when one is set — the
  // number stays in the tooltip (and everywhere data lives).
  const tnm = ((s.table_names || {})[String(i)] || "").trim();
  // Special table type (mig 166): a corner ribbon + pill badge layered OVER the state
  // look — the strip/label/pay ring keep working, the tag is unmistakable on top.
  const tag = tagForTable(i);
  const tinfo = TABLE_TAG_INFO[tag];
  return `<div class="ftile ft-${st}${pay ? " pay-" + pay : ""}${tinfo ? ` ft-tag tag-${tag}` : ""}${String(state.selectedTable) === String(i) ? " ft-sel" : ""}" data-floor-table="${i}" role="button" tabindex="0">
        ${offIcon}${tinfo ? `<div class="ft-ribbon" aria-hidden="true">${tinfo.ribbon}</div>` : ""}
        <div class="ft-top"><span class="ft-num" ${tnm ? `title="T${i}"` : ""}>${esc(tnm || i)}</span>${badges ? `<span class="ft-badges">${badges}</span>` : ""}</div>
        ${tinfo ? `<span class="ft-tagbadge">${tinfo.emoji} ${esc(tinfo.label)}</span>` : ""}
        <div class="ft-label">${esc(label)}</div><div class="ft-meta">${esc(meta)}</div>${strip}
        ${quick ? `<div class="ft-quick">${quick}</div>` : ""}</div>`;
}

// floorReqCardHtml(): the "Requests" side-panel card (pending joiners + open/join/access
// requests). Extracted so BOTH the full render (floorHtml) AND the incremental patch
// (patchFloorTiles) build it from the SAME markup. It carries a stable id (#fcReq) so the
// patch can swap just this node in place. Its buttons are handled by the ONE delegated
// click handler (see bindFloorDelegation), so replacing the node never breaks them.
function floorReqCardHtml() {
  const s = state.data.settings || {};
  if (!s.sessions_enabled) return "";
  const reqs = state.summary.requests || [];
  const joiners = state.summary.joiners || [];
  const joinerRows = joiners.map((m) =>
    `<div class="sx-req"><div class="sx-req-info"><span class="sx-tag sx-tag-join">join</span> ${esc(m.name || "Guest")} · join T${esc(m.table_number)}<small>${esc(timeAgo(m.joined_at))}</small></div><div class="sx-req-actions"><button class="btn small" data-mem-deny="${esc(m.id)}" title="Decline this join request">✕</button><button class="btn small danger" data-mem-ban="${esc(m.id)}" data-ban-phone="${esc(m.phone || "")}" title="Decline AND add to the blocklist">Ban</button><button class="btn small" data-mem-head="${esc(m.id)}" title="Make them the table's head — the current head is kicked">Transfer</button><button class="btn small primary" data-mem-approve="${esc(m.id)}">OK</button></div></div>`
  ).join("");
  const reqCount = reqs.length + joiners.length;
  return `<div class="fc-card" id="fcReq"><h3>Requests <span class="sub">· ${reqCount}</span></h3>${reqCount ? joinerRows + reqs.map((r) => {
    const who = esc(r.name || r.phone || "Someone");
    const what = r.type === "open" ? `open T${esc(r.table_number)}` : r.type === "join" ? `join T${esc(r.table_number)}` : `access T${esc(r.table_number)}`;
    // "access" = a guest asked for a WAITER to come over (e.g. their join was
    // declined, or location failed) — so the quick action reads "✓ Attend",
    // exactly like a water call, instead of an ambiguous "OK".
    const okLabel = r.type === "open" ? "Open" : r.type === "access" ? "✓ Attend" : "OK";
    return `<div class="sx-req"><div class="sx-req-info"><span class="sx-tag sx-tag-${esc(r.type)}">${esc(r.type)}</span> ${who} · ${what}<small>${esc(timeAgo(r.created_at))}</small></div><div class="sx-req-actions"><button class="btn small" data-req-deny="${esc(r.id)}">✕</button><button class="btn small primary" data-req-approve="${esc(r.id)}">${okLabel}</button></div></div>`;
  }).join("") : `<div class="sx-empty">No pending requests.</div>`}</div>`;
}

// floorNeedsCardHtml(): the "Needs" side-panel card (active waiter calls). Same shared-builder
// pattern as floorReqCardHtml — id #fcNeeds, buttons via the delegated handler.
function floorNeedsCardHtml() {
  const s = state.data.settings || {};
  if (!s.sessions_enabled) return "";
  const liveCalls = (state.summary.calls || []).filter((c) => !c.resolved);
  return `<div class="fc-card" id="fcNeeds"><h3>Needs <span class="sub">· ${liveCalls.length}</span></h3>${liveCalls.length ? liveCalls.map((c) =>
    `<div class="sx-req"><div class="sx-req-info">${callEmoji(c.note)} T${esc(c.table_number)} · ${esc(c.note || "Waiter")}<small>${esc(timeAgo(c.created_at))}</small></div><div class="sx-req-actions"><button class="btn small primary" data-call-attend="${esc(c.id)}">Done</button></div></div>`
  ).join("") : `<div class="sx-empty">No active calls.</div>`}</div>`;
}

// floorAcceptCardHtml(): the "To accept" side-panel card — every table with a NEW order
// still waiting for staff to accept it, each with a one-tap Accept. Before this, new orders
// showed ONLY on the floor tiles, so the side panel looked empty while "Needs you" counted
// them (owner asked for them to show + sync here, 2026-07-05). Uses the SAME tableTileState
// .hasNew that drives the tiles and the "Needs you" count, so all three always agree. Same
// shared-builder + delegated-button pattern as floorReqCardHtml (id #fcAccept); the Accept
// button reuses data-quick-accept → acceptTableOrders, wired by the ONE floor delegated
// handler, so the incremental patch can swap this node without orphaning a listener.
// The floor normally draws tables 1..table_count, but a table numbered ABOVE the current
// count can still be OCCUPIED (e.g. the count was lowered while it had a live order). Extend
// the drawn range to cover any such table so it never vanishes from the grid / "to accept" /
// stats (and its bill stays reachable/payable). (fixed 2026-07-06)
function floorDrawCount(baseN) {
  let hi = baseN;
  const tiles = (state.summary && state.summary.tiles) || {};
  for (const k in tiles) { const num = parseInt(k, 10); if (Number.isFinite(num) && num > hi) hi = num; }
  return hi;
}
function floorAcceptCardHtml() {
  const s = state.data.settings || {};
  if (!s.sessions_enabled) return "";
  const _tcKey = tableCountKey();
  let cachedN = _tcKey ? parseInt(localStorage.getItem(_tcKey), 10) : NaN;
  if (!Number.isFinite(cachedN) || cachedN < 1) cachedN = 12;
  const n = Math.max(1, parseInt(s.table_count, 10) || cachedN);
  const rows = [];
  for (let i = 1; i <= floorDrawCount(n); i++) {
    const ts = tableTileState(i);
    if (ts.hasNew) rows.push({ t: i, meta: ts.meta || "" });
  }
  return `<div class="fc-card" id="fcAccept"><h3>To accept <span class="sub">· ${rows.length}</span></h3>${rows.length ? rows.map((r) =>
    `<div class="sx-req"><div class="sx-req-info"><span class="sx-tag sx-tag-new">new</span> T${esc(r.t)}${r.meta ? `<small>${esc(r.meta)}</small>` : ""}</div><div class="sx-req-actions"><button class="btn small primary" data-quick-accept="${esc(r.t)}">✓ Accept</button></div></div>`
  ).join("") : `<div class="sx-empty">No orders waiting.</div>`}</div>`;
}

// floorStatsHtml(): the floor-wide stats strip (Occupied / To pay / Needs you). Computed by
// looping tableTileState over EVERY table (cheap — no DOM) so the patch can refresh it without
// rebuilding the grid. Shared by floorHtml and patchFloorTiles.
function floorStatsHtml() {
  const s = state.data.settings || {};
  if (!s.sessions_enabled) return "";
  const _tcKey = tableCountKey();
  let cachedN = _tcKey ? parseInt(localStorage.getItem(_tcKey), 10) : NaN;
  if (!Number.isFinite(cachedN) || cachedN < 1) cachedN = 12;
  const n = Math.max(1, parseInt(s.table_count, 10) || cachedN);
  let cOcc = 0, cPay = 0, cNew = 0, cCall = 0;
  for (let i = 1; i <= floorDrawCount(n); i++) {
    const { st, pay, hasNew, hasCall } = tableTileState(i);
    if (st !== "free" && st !== "req") cOcc++;
    if (pay === "red" || st === "bill") cPay++;
    if (hasNew) cNew++;
    if (hasCall) cCall++;
  }
  const pendingJoinersN = (state.summary.joiners || []).length;
  const needsYou = cNew + cCall + (state.summary.requests || []).length + pendingJoinersN;
  return `<div class="floor-stats"><div class="fstat"><div class="fstat-n">${cOcc}/${n}</div><div class="fstat-l">Occupied</div></div><div class="fstat warn"><div class="fstat-n">${cPay}</div><div class="fstat-l">To pay</div></div><div class="fstat alert"><div class="fstat-n">${needsYou}</div><div class="fstat-l">Needs you</div></div></div>`;
}

// floorHtml: build the whole unified floor — the grid of table tiles on the left
// (with a legend and on-tile quick buttons) and a side panel on the right holding
// the session toggles, café location, requests queue and blocklist.

// densityBtnsHtml: the S/M/L tile-size control shown beside "Table view". Changes
// how many tiles fit per row (bigger tiles = fewer per row) via a data-density
// attribute the CSS keys off of (see .ftile-grid rules). Choice is remembered
// across reloads (lsSet), same convention as floorSideCollapsed.
function densityBtnsHtml() {
  const cur = state.floorTileDensity || "m";
  const opt = (k, label, title) => `<button class="density-btn${cur === k ? " active" : ""}" data-density-btn="${k}" title="${title}">${label}</button>`;
  return `<div class="density-btns" role="group" aria-label="Tile size">${opt("s", "S", "Smaller tiles, more per row")}${opt("m", "M", "Normal tile size")}${opt("l", "L", "Larger tiles, fewer per row")}</div>`;
}

function floorHtml() {
  const s = state.data.settings || {};
  const sessionsOn = !!s.sessions_enabled;
  // Number of tables to draw. On the very FIRST paint the settings haven't
  // loaded yet, so without help we'd default to 12 and then jump to the real 13
  // a moment later — a visible "one tile forms, then another" flicker in the
  // skeleton. Fix: remember the real count in localStorage and use it as the
  // default, so the skeleton starts at the right size. (Falls back to 12 only
  // on a browser that has never loaded this editor.)
  const _tcKey = tableCountKey();
  let cachedN = _tcKey ? parseInt(localStorage.getItem(_tcKey), 10) : NaN;
  if (!Number.isFinite(cachedN) || cachedN < 1) cachedN = 12;
  const n = Math.max(1, parseInt(s.table_count, 10) || cachedN);
  if (s.table_count && _tcKey) { try { localStorage.setItem(_tcKey, String(parseInt(s.table_count, 10))); } catch {} }
  // Side-panel queues now come from the slim SUMMARY aggregates (tiny — only pending rows),
  // not the full board (which is no longer fetched whole). Same shapes the cards expect.
  // (Requests/joiners/calls live in the shared floorReqCardHtml/floorNeedsCardHtml builders.)
  const blocks = state.summary.blocklist || [];

  // legend — every state + its colour. ("Bill due" was removed: payment is
  // already shown by the red/green outline, so a fill colour for it was noise.)
  const LEG = [["free", "Free"], ["req", "Wants in"], ["seated", "Seated"], ["new", "New order"], ["prep", "Preparing"], ["ready", "Ready to serve"]];
  const legend = `<div class="floor-legend"><span class="lgcap">inside:</span>${LEG.map(([k, v]) => `<span class="lgi"><i class="ldot ldot-${k}"></i>${v}</span>`).join("")}<span class="lgi"><i class="ldot ldot-call">🔔</i>called</span><span class="lgcap">outline:</span><span class="lgi"><i class="lring lring-red"></i>unpaid</span><span class="lgi"><i class="lring lring-green"></i>paid</span></div>`;

  // FIRST PAINT before the live board has arrived: show a shimmer skeleton sized
  // to the real table count, instead of briefly drawing every table as "Free"
  // (that looked like the whole floor had reset on every refresh). The board
  // loads a moment later — boardLoaded flips true — and the real tiles replace
  // this. Mirrors the menu's loading skeleton so the two screens feel the same.
  if (!state.boardLoaded) {
    // left: a shimmer tile per table, sized to the (cached) real count.
    let skel = "";
    for (let i = 1; i <= n; i++) {
      skel += `<div class="ftile ftile-skel" aria-hidden="true"><div class="sk-num"></div><div class="sk-lbl"></div><div class="sk-meta"></div></div>`;
    }
    const skelMain = `<div class="floor-main"><div class="ed-head"><h2>Table view <span class="sub">· live</span></h2>${densityBtnsHtml()}</div>${legend}<div class="ftile-grid" data-density="${state.floorTileDensity || "m"}">${skel}</div></div>`;
    // right: skeleton versions of the side-panel cards so the whole layout is
    // present from the first frame (no empty gutter that fills in late). A card
    // = a title bar + a few placeholder rows of shimmer.
    const skRow = `<div class="sk-row"></div>`;
    const skCard = (titleW, rows) => `<div class="fc-card fc-card-skel"><div class="sk-cardtitle" style="width:${titleW}"></div>${skRow.repeat(rows)}</div>`;
    const sideW = state.floorSideW || 300;
    const skelSide = `<aside class="floor-side" style="width:${sideW}px;flex:0 0 ${sideW}px">${skCard("46%", 4)}${skCard("38%", 2)}${skCard("34%", 2)}</aside>`;
    return `<div class="floor-wrap">${skelMain}<div class="floor-resizer"></div>${skelSide}</div>`;
  }

  let tiles = "";
  for (let i = 1; i <= floorDrawCount(n); i++) {
    tiles += floorTileHtml(i); // SHARED tile builder — single source of truth (full render + patch)
  }
  // The header keeps ONLY the safe Refresh button. Open all / Close all used to
  // sit right beside it, styled the same — one fast click aimed at Refresh once
  // closed the entire floor (owner hit this 2026-06-11). They now live in the
  // side panel's "Dining sessions" card, well away from the speed-click zone.
  // Stats strip — the whole floor's health at a glance (Occupied / To pay / Needs you).
  // Built by the shared floorStatsHtml() so the patch path can refresh it identically.
  const statsStrip = floorStatsHtml();
  // Density buttons live at the far right of .ed-head (its h2 has flex:1, which pushes
  // anything after it there — a shared rule, not something to special-case here). That's
  // the SAME corner the collapsed-floor's Open all/Close all bar + the ‹ chevron use
  // (both position:absolute), so the two overlapped when collapsed (owner screenshot,
  // 2026-06-30). Simplest correct fix: don't show density controls while collapsed —
  // that corner is already spoken for there, and re-expanding is one click away.
  const collapsedNow = isPhoneLayout() || state.floatingTables.length > 0 || (state.floorSideCollapsed && state.selectedTable == null);
  // General "New Parcel" (takeaway) button — sits at the top of the floor, not tied to
  // any table. Opens the take-order picker in parcel mode → a takeaway Platform order
  // (owner, 2026-07-25). Gated by the take_orders x-ray + server (hidden for staff without it).
  const parcelBtn = `<button class="btn primary ed-parcel-btn" data-new-parcel="1" title="Start a takeaway / parcel order — no table needed">🥡 New&nbsp;Parcel</button>`;
  // Waiter sections (mig 222) — the entry point that ACTUALLY works for a manager.
  // The full editor also sits in Settings → Tables, but that whole tab is gated by the
  // SEPARATE `edit_settings` power, so a manager granted only `table_assign` could never
  // reach it (caught in live testing 2026-07-29). Sections belong to the floor anyway, so
  // the live Table view is the natural home. Same builder → one source of truth.
  const sectionsBtn = `<button class="btn" id="floorSections" data-mgr-hide="table_sections" title="Give each waiter their own tables">👥 Who serves what</button>`;
  const main = `<div class="floor-main"><div class="ed-head"><h2>Table view <span class="sub">· live</span></h2>${sectionsBtn}${parcelBtn}${collapsedNow ? "" : densityBtnsHtml()}</div>${statsStrip}${legend}<div class="ftile-grid" data-density="${state.floorTileDensity || "m"}">${tiles}</div></div>`;

  // side panel — everyday floor work only (whole-floor open/close, requests, needs,
  // blocked). The old "Features · rarely changed" card that used to sit at the bottom
  // (system ON / require location / require code + café latitude-longitude-radius) was
  // REMOVED 2026-07-29 (owner): those are restaurant-wide SETUP settings, not floor
  // controls, and a mis-tap here could switch the whole dining-session system off
  // mid-service. They live in exactly ONE place now — Settings → "Dining sessions"
  // (admin-only) and the admin panel's restaurant settings. Do not re-add them here.
  // Whole-floor bulk actions — used every open/close of the day, so they live on
  // top. (Deliberately STILL not next to the header's Refresh button: a misfired
  // speed-click there once closed the whole floor. Both confirm before acting.)
  const bulkCard = sessionsOn ? `<div class="fc-card"><h3>Whole floor</h3><div class="fc-bulk"><button class="btn small" id="floorOpenAll">⬆ Open all</button><button class="btn small danger" id="floorCloseAll">⬇ Close all</button></div></div>` : "";

  // Pending JOINERS + open/join/access requests → the "Requests" card; active waiter
  // calls → the "Needs" card. Both are now built by SHARED module-level functions
  // (floorReqCardHtml / floorNeedsCardHtml) so the incremental patch path can refresh
  // just these two cards in place with byte-identical markup. They carry stable ids
  // (#fcReq / #fcNeeds) and their buttons are wired by the ONE delegated click handler.
  const acceptCard = floorAcceptCardHtml();
  const reqCard = floorReqCardHtml();
  const needsCard = floorNeedsCardHtml();

  // Blocked list: device/phone/table bans, each with its reason; rows where the
  // banned guest left a number asking to be unblocked float to the TOP and are
  // highlighted so staff can act on them. (owner, 2026-06-22 — ban system)
  const blkRow = (b) => {
    const who = b.phone ? "📵 " + esc(b.phone) : b.device_id ? "🚫 Device" : b.table_number ? "🚫 T" + esc(b.table_number) : "🚫 Blocked";
    const reason = b.reason ? ` <small>${esc(b.reason)}</small>` : "";
    const unban = b.unban_phone ? `<div class="sx-blk-unban">🙋 Wants unblock · <b>${esc(b.unban_phone)}</b></div>` : "";
    return `<div class="sx-blk${b.unban_phone ? " has-req" : ""}"><div class="sx-blk-top"><span>${who}${reason}</span><button class="btn small" data-unblock="${esc(b.id)}">Unblock</button></div>${unban}</div>`;
  };
  const blkSorted = [...blocks].sort((a, c) => (c.unban_phone ? 1 : 0) - (a.unban_phone ? 1 : 0));
  const blkCard = sessionsOn ? `<div class="fc-card"><h3>Blocked <span class="sub">· ${blocks.length}</span></h3>${blocks.length ? blkSorted.map(blkRow).join("") : `<div class="sx-empty">Nobody blocked.</div>`}<div class="sx-blk-add"><input class="sx-input" id="blkPhone" placeholder="Phone/email"/><input class="sx-input sx-input-sm" id="blkTable" placeholder="T#"/><button class="btn small" id="blkAdd">Block</button></div></div>` : "";

  // The detail pane wants more room than the compact controls — so when a table is
  // selected we use a wider default (and its own remembered width, floorDetailW).
  const sideW = state.selectedTable != null ? (state.floorDetailW || 460) : (state.floorSideW || 300);
  // RIGHT SIDE PANEL — master-detail. By default it's the whole-floor CONTROLS
  // (bulk open/close, requests, needs, blocked, features/location). When a table is
  // SELECTED, the SAME panel instead shows that table's full detail IN PLACE (not a
  // pop-up), with a ✕ at the top-right that deselects and returns to these controls.
  let sideInner;
  if (state.selectedTable != null) {
    const t = state.selectedTable;
    const parts = tablePanelParts(t);
    const { headPill, headMeta, requestsSec, sessionSec, ordersSec, callsSec, billSec, foot } = parts;
    // Pop this table out into the FLOATING layer (owner request, 2026-07-02 — "movable",
    // "many popups at the same time"). Docking back happens from the floating card's own
    // "⇱ Dock" button (bindFloor), not here — this button only ever pops OUT.
    const alreadyFloating = state.floatingTables.some((f) => String(f.table) === String(t));
    const floatBtn = alreadyFloating ? "" : `<button class="tp-detail-float" data-float-open="${esc(t)}" title="Pop out as a movable floating window">⤢ Float</button>`;
    sideInner = `<div class="tp-detail" data-table-detail="${esc(t)}">
        <div class="tp-detail-head">
          <div class="tp-detail-top"><h3>${esc(tableLabel(t))}</h3>${headPill}${parts.kotHeadBtn || ""}${floatBtn}<button class="tp-detail-close" id="tpDetailClose" aria-label="Back to floor controls" title="Back to floor controls">✕</button></div>
          ${headMeta}
        </div>
        <div class="tp-detail-body">${requestsSec}${sessionSec}${ordersSec}${callsSec}${billSec}</div>
        <div class="tp-detail-foot">${foot}</div>
      </div>`;
  } else {
    sideInner = `${acceptCard}${bulkCard}${reqCard}${needsCard}${blkCard}`;
  }
  // FLOATING LAYER: every table in state.floatingTables gets its own draggable card,
  // rendered ALONGSIDE whatever the side panel is doing above — fully independent (owner,
  // 2026-07-02: "this only happens in popup mode, not the side thing — when the side thing
  // is closed [docked] that still happens [normally]"). Non-pinned cards get their
  // left/top/width from layoutFloatingRow() right after this markup lands (bindFloor);
  // pinned ones (dragged) keep the exact x/y/w they were dropped at.
  const floatingLayerHtml = state.floatingTables.map((f) => {
    const parts = tablePanelParts(f.table);
    const { headPill, headMeta, requestsSec, sessionSec, ordersSec, callsSec, billSec, foot } = parts;
    const dockBtn = isPhoneLayout() ? "" : `<button class="tp-detail-float" data-float-dock="${esc(f.table)}" title="Dock back to the side panel">⇱ Dock</button>`; // no side panel on a phone → nothing to dock into
    // A PINNED card keeps its dragged/resized geometry (x/y/w/h); a free one gets only its
    // auto-arrange width here and its left/top/width from layoutFloatingRow after render.
    const styleParts = [`width:${f.w || 400}px`];
    if (f.pinned && f.x != null) { styleParts.push(`left:${f.x}px`, `top:${f.y}px`, "right:auto"); if (f.h) styleParts.push(`height:${f.h}px`); }
    return `<div class="tp-detail-floating${f.pinned ? " tp-pinned" : ""}" data-floating-table="${esc(f.table)}" style="${styleParts.join(";")}">
      <div class="tp-detail" data-table-detail="${esc(f.table)}">
        <div class="tp-detail-head">
          <div class="tp-detail-top"><h3>${esc(tableLabel(f.table))}</h3>${headPill}${parts.kotHeadBtn || ""}${dockBtn}<button class="tp-detail-close" data-float-close="${esc(f.table)}" aria-label="Close" title="Close">✕</button></div>
          ${headMeta}
        </div>
        <div class="tp-detail-body">${requestsSec}${sessionSec}${ordersSec}${callsSec}${billSec}</div>
        <div class="tp-detail-foot">${foot}</div>
      </div>
      <div class="tp-resize-handle" data-float-resize="${esc(f.table)}" title="Drag to resize"></div>
    </div>`;
  }).join("");
  // POPUP MODE — hide the side panel entirely (owner, 2026-07-02: float and the side panel
  // must NEVER be on screen together). We're in popup mode when EITHER the owner manually
  // collapsed the panel, OR any floating popup is open (floating one auto-hides the panel).
  // The floor goes full-width with a chevron that EXITS popup mode (closes popups + shows the
  // panel — see the floorSideToggle handler). Tapping a tile here opens a floating popup.
  // On a PHONE the floor is ALWAYS popup-mode (there's no room for the side panel — owner,
  // 2026-07-03: "on phone, click table = only popup"); the desktop rule is unchanged.
  if (isPhoneLayout() || state.floatingTables.length > 0 || (state.floorSideCollapsed && state.selectedTable == null)) {
    // NO floating Open-all/Close-all bar here any more (owner, 2026-07-28): it hovered
    // over the header and overlapped the New Parcel button. These rarely-used bulk
    // actions live ONLY in the side panel's "Whole floor" card now — expanding the
    // panel (the ‹ chevron) is one click away, and a whole-floor action is deliberate
    // enough to deserve that click.
    return `<div class="floor-wrap floor-collapsed">${main}<button class="floor-side-toggle is-collapsed" id="floorSideToggle" title="Show floor controls" aria-label="Show floor controls">‹</button></div>${floatingLayerHtml}`;
  }
  const collapseBtn = state.selectedTable == null
    ? `<button class="floor-side-toggle" id="floorSideToggle" title="Hide this panel" aria-label="Hide this panel">›</button>` : "";
  return `<div class="floor-wrap">${main}<div class="floor-resizer" id="floorResizer" title="Drag to resize"></div><aside class="floor-side" style="width:${sideW}px;flex:0 0 ${sideW}px">${collapseBtn}${sideInner}</aside></div>${floatingLayerHtml}`;
}

// patchFloorTiles(tables): the INCREMENTAL update path. Instead of rebuilding all ~300 tiles
// + re-binding ~300 listeners (the freeze at 300 tables), it replaces ONLY the named tiles'
// nodes via the shared floorTileHtml builder, then refreshes just the small floor-wide bits
// (the stats strip + the Requests/Needs queue cards) in place. The grid's .ftile-grid is
// NOT rebuilt, and the delegated click handler lives on #editor (an ancestor that survives),
// so replaced tile/card nodes need NO re-binding. If the grid/tile isn't present (different
// tab, skeleton, or detail open), it falls back to a full renderEditor() so we never leave a
// half-updated screen. Returns true if it patched, false if it fell back.
function patchFloorTiles(tables) {
  // The fallbacks below use loadSessions(true) — NOT a bare renderEditor() — because that's
  // the exact render step this path replaces in reconcileBoard. loadSessions(true) does three
  // things a bare renderEditor() drops: it preserves the in-panel detail's scroll, and it calls
  // renderTablePanel() to refresh the COLLAPSED-MODE MODAL (which lives on document.body, outside
  // #editor, so renderEditor alone never updates it → a stale modal until the 60s backup poll).
  // It's fromPoll=true → no fetch, no recursion (the slice was already awaited before reconcile).
  // Only valid on the Tables tab with the real grid drawn. Skeleton (pre-boardLoaded) or a
  // missing grid → full render is the safe path.
  const ed = $("#editor");
  const grid = ed && ed.querySelector(".ftile-grid");
  if (state.tab !== "tables" || !state.boardLoaded || !grid) { loadSessions(true); return false; }
  // A DETAIL node (docked / collapsed-mode modal / floating popup) + its slice rows only need
  // the full render path when the CHANGED table is the one being viewed. Previously we fell back
  // whenever ANY detail was open — but a detail is open during almost all normal work, so every
  // event (even on an unrelated table) rebuilt all ~300 tiles and the floor froze (the exact
  // 300-table freeze this patch path exists to prevent). Now: if a changed table's own detail is
  // open, full-render so that detail refreshes; otherwise patch just the changed tiles and leave
  // the open (unrelated) detail untouched — its data didn't change, so it's already correct.
  const openDetails = detailTables();
  if (openDetails.length && tables.some((t) => openDetails.includes(String(t)))) { loadSessions(true); return false; }
  const _t0 = performance.now();
  let patched = 0;
  for (const t of tables) {
    const el = ed.querySelector('[data-floor-table="' + String(t) + '"]');
    if (!el) { loadSessions(true); return false; } // a named tile isn't on the grid → safe full render
    el.outerHTML = floorTileHtml(t); // SHARED builder → byte-identical to a full render's tile
    patched++;
  }
  // Floor-wide bits that a single-table change can still move (occupancy counts, the queues):
  // refresh ONLY those nodes in place — never the grid. Their buttons are delegated, so swapping
  // the nodes can't orphan a listener.
  const statsEl = ed.querySelector(".floor-stats");
  if (statsEl) statsEl.outerHTML = floorStatsHtml();
  const reqEl = ed.querySelector("#fcReq");
  if (reqEl) reqEl.outerHTML = floorReqCardHtml();
  const needsEl = ed.querySelector("#fcNeeds");
  if (needsEl) needsEl.outerHTML = floorNeedsCardHtml();
  const acceptEl = ed.querySelector("#fcAccept");
  if (acceptEl) acceptEl.outerHTML = floorAcceptCardHtml();
  // A patch draws the new summary WITHOUT updating loadSessions' lastBoardSig fingerprint.
  // If a later FULL poll lands carrying the PREVIOUS summary (a wake/reconnect/platform event
  // whose summary happens to match the pre-patch one), loadSessions(true) would see an unchanged
  // sig and skip the redraw — leaving the screen on the patched state. Invalidate the sig so the
  // next full poll always redraws once (cheaper than re-stringifying the summary here).
  lastBoardSig = "";
  window.__lfhPerf.patches++;
  window.__lfhPerf.tilesPatched += patched;
  window.__lfhPerf.lastMs = performance.now() - _t0;
  return true;
}

// bindFloorDelegation: attach the floor's click handling ONCE on the stable #editor
// container (it never gets replaced — renderEditor only ever rewrites its innerHTML).
// Why delegation instead of per-tile onclick? At 300 tables the old bindFloor re-bound
// ~300 listeners on EVERY render; with one delegated handler, patched/replaced tile nodes
// (and the in-place-refreshed Requests/Needs cards) need NO re-binding — the listener lives
// on the parent and finds the clicked target via .closest(). A boolean guard means repeated
// renders never stack duplicate listeners.
//
// IMPORTANT: every data-attr handled here lives on a node that the PATCH path may replace
// (the tiles, and the #fcReq / #fcNeeds cards). That's exactly why they MUST be delegated —
// id-based handlers on those nodes would die the moment patchFloorTiles swaps them. The
// id-based controls that the patch NEVER touches (Open all/Close all, the side toggle,
// the Block input, the Blocked card's Unblock, the resizer, and the selected-table
// detail panel) stay in bindFloor and are re-wired on full renders.
let floorDelegationBound = false;
function bindFloorDelegation() {
  if (floorDelegationBound) return;
  floorDelegationBound = true;
  const ed = $("#editor");
  ed.addEventListener("click", (e) => {
    // Only act while the floor (Tables tab) is showing — #editor is shared by every tab.
    if (state.tab !== "tables") return;
    // The SELECTED-table detail panel lives INSIDE #editor too and reuses the same
    // data-mem-*/data-req-*/data-call-attend attrs — but it's wired by bindTablePanel's
    // own handlers (it has extra actions like Kick/Attend-all the floor cards don't). So if
    // the click landed inside the detail panel, let those handlers own it — don't double-fire.
    // (The collapsed-mode modal renders on document.body, outside #editor, so it never reaches
    // here at all.)
    if (e.target.closest("[data-table-detail]")) return;
    // QUICK ACTIONS + queue-card buttons FIRST (they're nested inside the tile / cards);
    // matching one and returning replicates the old stopPropagation so a quick button
    // never ALSO triggers the tile-select below. Check most-specific targets, then the tile.
    let b;
    if ((b = e.target.closest("[data-quick-open]")))     { openTableSession(b.dataset.quickOpen); return; }
    if ((b = e.target.closest("[data-quick-accept]")))   { acceptTableOrders(b.dataset.quickAccept); return; }
    if ((b = e.target.closest("[data-quick-attend]")))   { attendTableCalls(b.dataset.quickAttend); return; }
    if ((b = e.target.closest("[data-quick-requests]"))) { selectTable(b.dataset.quickRequests); return; }
    if ((b = e.target.closest("[data-quick-restart]")))  { restartTable(b.dataset.quickRestart); return; }
    if ((b = e.target.closest("[data-quick-close]")))    { closeTableQuick(b.dataset.quickClose); return; }
    if ((b = e.target.closest("[data-quick-pay]")))      { markTablePaid(b.dataset.quickPay); return; }
    // Requests card — joiner rows (member actions) + open/join/access requests.
    if ((b = e.target.closest("[data-mem-approve]")))    { memberAction(b.dataset.memApprove, "approve"); return; }
    if ((b = e.target.closest("[data-mem-deny]")))       { memberAction(b.dataset.memDeny, "remove"); return; }
    if ((b = e.target.closest("[data-mem-head]")))       { makeHead(b.dataset.memHead); return; }
    if ((b = e.target.closest("[data-mem-ban]")))        { banMember(b.dataset.memBan, b.dataset.banPhone); return; }
    if ((b = e.target.closest("[data-req-approve]")))    { resolveRequest(b.dataset.reqApprove, "approved"); return; }
    if ((b = e.target.closest("[data-req-deny]")))       { resolveRequest(b.dataset.reqDeny, "denied"); return; }
    // Needs card — Done resolves a single waiter call.
    if ((b = e.target.closest("[data-call-attend]")))    { attendCall(b.dataset.callAttend); return; }
    // TILE SELECT last — only reached when no button above matched.
    const tile = e.target.closest("[data-floor-table]");
    if (tile) {
      // POPUP MODE (side panel collapsed OR a popup already open) → open another FLOATING
      // popup. DOCKED MODE (side panel visible, no popups) → dock the detail in the panel.
      // The two modes are mutually exclusive (owner, 2026-07-02), so a tile tap can only ever
      // ADD to whichever mode is active — never mix a docked detail with floating popups.
      const popupMode = isPhoneLayout() || state.floatingTables.length > 0 || state.floorSideCollapsed;
      if (popupMode) openFloatingTable(tile.dataset.floorTable);
      else selectTable(tile.dataset.floorTable);
    }
  });
}

// FLOATING POPUP SLOT MODEL (owner, 2026-07-02/03). The row is a grid of state.floatCols
// columns that GROWS as popups are added: 1 popup = one BIG centered card, 2 = halves,
// 3 = thirds … capped at MAX_FLOATING (owner: "if only 1, size should be big; as I add,
// it should become small"). Each non-pinned popup owns a stable slot INDEX inside that
// grid — dragging one out (→ PINNED, releases its slot) or closing one leaves a GAP and
// NEVER moves the rest ("everything should stay as it is"); the gap is re-used by the next
// table opened. Only ADDING a popup when no gap is free grows the grid (everyone reflows
// slightly smaller — the one movement the owner explicitly asked for). When no slotted
// popup remains (all dragged away / closed), the grid resets so the next popup starts
// big from the middle again. On a PHONE (isPhoneLayout) it's ONE full-width popup at a
// time — no drag, no resize, no side-by-side (owner, 2026-07-03).
const MAX_FLOATING = 5;
const FLOAT_MAX_W = 640; // don't let 1–2 popups stretch absurdly wide on a big monitor
// True WHILE a floating popup is being dragged or resized: a background poll's
// renderEditor() would rebuild #editor and drop the drag, so loadSessions() defers
// its redraw until pointerup (see the guard in loadSessions + the flush in the up handlers).
let floatInteracting = false;
let floatRenderPending = false;
// flushFloatRender(): call on drag/resize end — replays the redraw we deferred, if any.
function flushFloatRender() { floatInteracting = false; if (floatRenderPending) { floatRenderPending = false; loadSessions(true); } }
const isPhoneLayout = () => window.matchMedia("(max-width: 760px)").matches;
// addFloating(t): open table t as a floating popup. Fills the left-most empty gap in the
// current grid first; grows the grid by one column when there's no gap. Returns true if open.
function addFloating(t) {
  t = String(t);
  if (isPhoneLayout()) {
    // Phone = single-popup mode: the new table REPLACES whatever was floating.
    if (state.floatingTables.length === 1 && state.floatingTables[0].table === t) return true;
    state.floatingTables = [{ table: t, pinned: false, slot: 0, x: null, y: null, w: null, h: null }];
    state.floatCols = 1;
    return true;
  }
  if (state.floatingTables.some((f) => f.table === t)) return true;         // already open
  if (state.floatingTables.length >= MAX_FLOATING) { toast(`Up to ${MAX_FLOATING} popups at once.`, "err"); return false; }
  const slotted = state.floatingTables.filter((f) => !f.pinned && f.slot != null);
  if (!slotted.length) state.floatCols = 0; // fresh grid → this popup starts big in the middle
  const used = new Set(slotted.map((f) => f.slot));
  let slot = null;
  for (let s = 0; s < state.floatCols; s++) if (!used.has(s)) { slot = s; break; } // re-use a vacated gap first
  if (slot == null) {
    if (state.floatCols >= MAX_FLOATING) { toast(`Up to ${MAX_FLOATING} popups at once.`, "err"); return false; }
    slot = state.floatCols; state.floatCols += 1; // no gap → grow the grid (existing cards shrink to fit)
  }
  state.floatingTables.push({ table: t, pinned: false, slot, x: null, y: null, w: null, h: null });
  return true;
}

// layoutFloatingRow(): position every NON-pinned popup at its slot inside the CURRENT grid
// (state.floatCols columns, centered as a row, each column capped at FLOAT_MAX_W). Slot
// indexes are stable, so drag-outs/closes never move the rest; only a grid GROWTH (add with
// no free gap) re-computes everyone's width. Pinned cards keep their dropped/resized geometry.
function layoutFloatingRow() {
  // TOP adds the admin/owner ribbon's height (0 for real staff) — the inline top set
  // below overrides the CSS default, so it must do the same --ribbon-h subtraction or
  // popups tuck under the topbar in admin view.
  const ribbonH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--ribbon-h")) || 0;
  const GAP = 14, MARGIN = 20, TOP = 70 + ribbonH;
  const phone = isPhoneLayout();
  const cols = Math.max(1, Math.min(MAX_FLOATING, state.floatCols || 1));
  const avail = window.innerWidth - (phone ? 16 : MARGIN * 2);
  const slotW = phone ? avail : Math.min((avail - (cols - 1) * GAP) / cols, FLOAT_MAX_W);
  const rowW = cols * slotW + (cols - 1) * GAP;
  const startX = Math.max(phone ? 8 : MARGIN, (window.innerWidth - rowW) / 2);
  state.floatingTables.forEach((f) => {
    if (f.pinned || f.slot == null) return; // pinned = free-floating; keep its own position
    const el = document.querySelector(`[data-floating-table="${CSS.escape(String(f.table))}"]`);
    if (el) { el.style.left = (startX + f.slot * (slotW + GAP)) + "px"; el.style.top = (phone ? 62 + ribbonH : TOP) + "px"; el.style.width = slotW + "px"; el.style.height = ""; el.style.right = "auto"; }
  });
}

// bindFloor: wire up the unified floor after a FULL render — the once-attached delegated
// click handler covers tiles + quick buttons + the Requests/Needs queue cards (so the
// patch path never has to re-bind them); here we wire only the controls the patch never
// touches (bulk open/close, the side toggle, settings, location, block, unblock, resizer,
// and the selected-table detail panel).
function bindFloor() {
  bindFloorDelegation(); // attach the delegated tile/quick/queue handler ONCE
  const ed = $("#editor");
  // (The ↻ Refresh button was removed — the floor is live via realtime + the 60s backup poll,
  //  so a manual refresh was redundant and looked broken. Coordinator-relayed owner request.)
  // Bulk open/close for the whole floor (both confirm before acting).
  // New Parcel → the take-order dish picker in PARCEL mode (no table → a takeaway
  // order in the Platform system). Gated by the take_orders x-ray (below) + server.
  ed.querySelectorAll("[data-new-parcel]").forEach((b) => (b.onclick = () => openTakeOrder(null, null, { parcel: true })));
  // Waiter sections (mig 222) — same editor as Settings → Tables, reachable from the floor.
  { const sb = ed.querySelector("#floorSections"); if (sb) sb.onclick = () => openSectionsModal(); }
  const oa = document.getElementById("floorOpenAll");
  if (oa) oa.onclick = () => openAllTables();
  const ca = document.getElementById("floorCloseAll");
  if (ca) ca.onclick = () => closeAllTables();
  // Collapse / expand the right floor panel. The '‹' chevron shows in POPUP MODE and EXITS it
  // — closing every floating popup AND showing the side panel (float and panel are mutually
  // exclusive, so leaving popup mode must clear the popups). The '›' chevron (docked mode)
  // just collapses into the empty popup-ready floor. (state persisted across reloads.)
  const sideToggle = ed.querySelector("#floorSideToggle");
  if (sideToggle) sideToggle.onclick = () => {
    const inPopupMode = state.floatingTables.length > 0 || state.floorSideCollapsed;
    if (inPopupMode) { state.floatingTables = []; state.floorSideCollapsed = false; }
    else { state.floorSideCollapsed = true; }
    lsSet("lfh_floor_side_collapsed", state.floorSideCollapsed ? "1" : "0");
    renderEditor();
  };
  // The Blocked card's Unblock buttons — that card is NEVER touched by the patch path
  // (unblock() routes through a full loadSessions()), so id-based binding is safe here.
  ed.querySelectorAll("[data-unblock]").forEach((b) => (b.onclick = () => unblock(b.dataset.unblock)));
  const add = document.getElementById("blkAdd");
  if (add) add.onclick = () => {
    const phone = (document.getElementById("blkPhone").value || "").trim();
    const table = (document.getElementById("blkTable").value || "").trim();
    if (!phone && !table) { toast("Enter a phone/email or table to block", "err"); return; }
    block({ phone: phone || undefined, table: table || undefined });
  };
  // Master-detail: if a table is SELECTED, its detail is showing in the right panel
  // — wire its ✕ (back to controls) and all its action buttons. We reuse the SAME
  // bindTablePanel as the modal, pointed at the side-panel container, with a rerender
  // that redraws the floor (the detail lives inside it) while keeping the body's scroll.
  if (state.selectedTable != null) {
    const detail = ed.querySelector("[data-table-detail]");
    if (detail) {
      const closeBtn = detail.querySelector("#tpDetailClose");
      if (closeBtn) closeBtn.onclick = () => deselectTable();
      const parts = tablePanelParts(state.selectedTable);
      // rerender keeps the detail body's scroll position so serving/deleting a dish
      // doesn't fling the panel back to the top.
      const rerender = () => {
        const body = ed.querySelector(".tp-detail-body");
        const top = body ? body.scrollTop : 0;
        renderEditor();
        const b2 = $("#editor").querySelector(".tp-detail-body");
        if (b2) b2.scrollTop = top;
      };
      bindTablePanel(detail, state.selectedTable, parts, { rerender, close: deselectTable });
    }
  }
  // drag the divider to resize the side panel (like a real app); width persists across re-renders
  const rz = document.getElementById("floorResizer");
  if (rz) rz.onpointerdown = (e) => {
    e.preventDefault();
    const aside = ed.querySelector(".floor-side");
    const startX = e.clientX, startW = aside.offsetWidth; // remember where the drag began and the starting width
    try { rz.setPointerCapture(e.pointerId); } catch {}
    // While the mouse moves: new width = start width minus how far we've dragged
    // left/right, clamped between 240 and 560px. Store it so re-renders keep it.
    // The detail needs more room than the compact controls, so each remembers its
    // OWN width (floorDetailW vs floorSideW) and the detail allows a wider max.
    const showingDetail = state.selectedTable != null;
    const maxW = showingDetail ? 820 : 560;
    const move = (ev) => { const w = Math.min(maxW, Math.max(280, startW - (ev.clientX - startX))); if (showingDetail) state.floorDetailW = w; else state.floorSideW = w; aside.style.width = w + "px"; aside.style.flexBasis = w + "px"; };
    const up = () => { rz.removeEventListener("pointermove", move); rz.removeEventListener("pointerup", up); }; // let go → stop tracking
    rz.addEventListener("pointermove", move);
    rz.addEventListener("pointerup", up);
  };
  // Tile density (S/M/L) — how many tiles fit per row. Persists across reloads.
  ed.querySelectorAll("[data-density-btn]").forEach((b) => {
    b.onclick = () => {
      const d = b.dataset.densityBtn;
      if (d === state.floorTileDensity) return;
      state.floorTileDensity = d;
      lsSet("lfh_floor_tile_density", d);
      renderEditor();
    };
  });
  // Pop the DOCKED detail out into the floating layer (adds it to floatingTables, clears
  // the docked selection — the side panel goes back to controls). Multiple tables can be
  // floating at once; this just adds one more.
  const openBtn = ed.querySelector("[data-float-open]");
  if (openBtn) openBtn.onclick = () => {
    const t = String(openBtn.dataset.floatOpen);
    if (!addFloating(t)) return; // at the cap → keep it docked
    state.selectedTable = null;
    renderEditor();
  };
  // Every floating card: wire its own detail actions (via the SAME bindTablePanel the
  // docked/collapsed views use), its Dock/Close buttons, and drag-to-pin on its header.
  ed.querySelectorAll("[data-floating-table]").forEach((card) => {
    const t = String(card.dataset.floatingTable);
    const detail = card.querySelector("[data-table-detail]");
    if (detail) {
      const parts = tablePanelParts(t);
      const rerender = () => {
        const body = card.querySelector(".tp-detail-body");
        const top = body ? body.scrollTop : 0;
        renderEditor();
        const c2 = $("#editor").querySelector(`[data-floating-table="${CSS.escape(t)}"] .tp-detail-body`);
        if (c2) c2.scrollTop = top;
      };
      const closeThis = () => { state.floatingTables = state.floatingTables.filter((f) => f.table !== t); renderEditor(); };
      bindTablePanel(detail, t, parts, { rerender, close: closeThis });
    }
    const dockBtn = card.querySelector("[data-float-dock]");
    if (dockBtn) dockBtn.onclick = () => {
      // "Dock" = leave popup mode and show THIS table in the side panel. Float and the side
      // panel are mutually exclusive (owner, 2026-07-02: "if we shift to side panel then float
      // should not be there"), so docking CLOSES every floating popup — not just this one —
      // and re-shows the (expanded) side panel with this table docked.
      state.floatingTables = [];
      state.selectedTable = t;
      if (state.floorSideCollapsed) { state.floorSideCollapsed = false; lsSet("lfh_floor_side_collapsed", "0"); }
      renderEditor();
    };
    const closeBtn = card.querySelector("[data-float-close]");
    if (closeBtn) closeBtn.onclick = () => { state.floatingTables = state.floatingTables.filter((f) => f.table !== t); renderEditor(); };
    // Drag-to-pin: once dragged, this card is EXCLUDED from auto-arrange (owner, 2026-07-02
    // — "if you once move it, it will not be a part of auto") and the rest re-share the
    // space among themselves. Clamped so it can't be dragged fully off-screen.
    const head = card.querySelector(".tp-detail-head");
    if (head) head.onpointerdown = (e) => {
      if (isPhoneLayout()) return; // phone = one fixed full-width popup — no drag/pin
      if (e.target.closest("button")) return; // don't start a drag from Dock/✕
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const rect = card.getBoundingClientRect();
      const startLeft = rect.left, startTop = rect.top;
      try { head.setPointerCapture(e.pointerId); } catch {}
      // Suspend the auto-arrange left/top/width transition WHILE dragging — otherwise each
      // pointermove's style change animates instead of jumping instantly, and worse,
      // getBoundingClientRect() on drop can read a still-mid-animation position instead of
      // where the pointer actually let go.
      card.classList.add("dragging");
      floatInteracting = true; // pause poll-driven redraws so the drag can't be torn out
      let moved = false;
      const move = (ev) => {
        moved = true;
        const maxLeft = window.innerWidth - card.offsetWidth - 8;
        const maxTop = window.innerHeight - 60; // leave enough of the header on-screen to grab again
        const x = Math.min(Math.max(8, startLeft + (ev.clientX - startX)), Math.max(8, maxLeft));
        const y = Math.min(Math.max(8, startTop + (ev.clientY - startY)), Math.max(8, maxTop));
        card.style.left = x + "px"; card.style.top = y + "px"; card.style.right = "auto";
      };
      const up = () => {
        head.removeEventListener("pointermove", move);
        head.removeEventListener("pointerup", up);
        card.classList.remove("dragging");
        if (!moved) { flushFloatRender(); return; } // a plain click on the header — not a drag, nothing to pin
        const f = state.floatingTables.find((x) => x.table === t);
        if (f) {
          const rect2 = card.getBoundingClientRect();
          // Pin it AND release its slot → leaves a gap the next new popup will fill; the other
          // slotted cards keep their fixed positions (they never move because one was dragged).
          f.pinned = true; f.slot = null; f.x = rect2.left; f.y = rect2.top; f.w = rect2.width;
        }
        card.classList.add("tp-pinned"); // instant visual feedback — the class also lands from the data on the next render anyway
        layoutFloatingRow(); // no-op for the others (fixed slots); just keeps things consistent
        flushFloatRender(); // resume redraws + replay any poll we deferred mid-drag (now that f.x/y/w are set)
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up);
    };
    // Resize by dragging the bottom-right corner (owner, 2026-07-02: "you should be able to
    // make it small"). Like a drag, resizing PINS the card — it keeps its size+position and
    // drops out of the auto-arrange; the others re-share the row. Stores h so a re-render
    // (e.g. a live poll) keeps the size the owner set.
    const rez = card.querySelector("[data-float-resize]");
    if (rez) rez.onpointerdown = (e) => {
      if (isPhoneLayout()) return; // phone: no resize (the handle is also display:none in CSS)
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const rect = card.getBoundingClientRect();
      const startW = rect.width, startH = rect.height, left = rect.left, top = rect.top;
      try { rez.setPointerCapture(e.pointerId); } catch {}
      card.classList.add("dragging");
      floatInteracting = true; // pause poll-driven redraws so the resize can't be torn out
      const move = (ev) => {
        const w = Math.min(Math.max(280, startW + (ev.clientX - startX)), window.innerWidth - left - 12);
        const h = Math.min(Math.max(180, startH + (ev.clientY - startY)), window.innerHeight - top - 12);
        card.style.width = w + "px"; card.style.height = h + "px";
      };
      const up = () => {
        rez.removeEventListener("pointermove", move); rez.removeEventListener("pointerup", up);
        card.classList.remove("dragging");
        const f = state.floatingTables.find((x) => x.table === t);
        if (f) { const r = card.getBoundingClientRect(); f.pinned = true; f.slot = null; f.x = r.left; f.y = r.top; f.w = r.width; f.h = r.height; }
        card.classList.add("tp-pinned");
        layoutFloatingRow();
        flushFloatRender(); // resume redraws + replay any poll we deferred mid-resize
      };
      rez.addEventListener("pointermove", move);
      rez.addEventListener("pointerup", up);
    };
  });
  layoutFloatingRow();
}

// (The floor's saveSetting()/saveGeo() helpers were deleted with the side panel's
// "Features · rarely changed" card on 2026-07-29 — dining-session switches and the café
// location are edited only in Settings → "Dining sessions" / the admin panel now.)

// ---- the ONE panel that handles a table end to end ----
// open/closeTablePanel: remember which table's big control panel is open. Opening kicks
// off a fresh load so the panel is never showing stale data — that SAME load's own
// renderTablePanel() call (see loadSessions) is what actually draws the modal; we don't
// also render synchronously here (owner report, 2026-07-02: "why 2 time load" — rendering
// instantly with whatever was cached, THEN again a moment later once the real fetch
// landed, was a guaranteed double-render/flicker on every open, not just an occasional
// race). A modal appearing a beat after the tap (one real network round-trip) reads as
// normal; two back-to-back redraws reads as broken.
// Render the modal INSTANTLY (from the summary-driven streaming view — see tablePanelParts),
// THEN loadSessions() fetches the slice and re-renders with real dish rows. Instant because
// the first paint is summary-accurate (not stale/empty), so there's no wrong-then-corrected
// flicker — just the dish list filling in. (owner report, 2026-07-02: the modal took 1-2s
// to appear at all; this is the stale-while-revalidate fix.)
function openTablePanel(table) { state.openSess = String(table); renderTablePanel(); loadSessions(); }
function closeTablePanel() { state.openSess = null; document.querySelector(".tbl-modal-overlay")?.remove(); }

// selectTable / deselectTable — the NEW master-detail (Tables tab). Selecting a
// table shows its full detail IN the right side panel (not a pop-up); deselecting
// returns the panel to the whole-floor controls.
// Renders INSTANTLY (renderEditor) using the summary-driven streaming view, THEN
// loadSessions() re-renders with the full dish list once the slice lands. This is the
// stale-while-revalidate fix: the first paint is ACCURATE (summary guests/dishes/due),
// not stale/empty, so bringing back the instant render (removed in an earlier over-
// correction) no longer flickers — the detail appears immediately and the dishes stream in.
function selectTable(table) {
  const t = String(table);
  state.selectedTable = t;
  renderEditor();  // instant, summary-accurate
  loadSessions();  // fetch slice → re-render with full dish rows
}
function deselectTable() { state.selectedTable = null; renderEditor(); }

// Sync hardware-BACK layers to the open table details. On a phone the table detail is a
// floating popup (or the docked detail on desktop); neither registered with LFH_BACK, so
// pressing Android BACK on an open table popup left the panel instead of closing the popup.
// Each open detail gets exactly one back layer; Back (or a UI close) peels one at a time.
const _tableBackLayers = new Map(); // key -> unregister()
function syncTableBackLayers() {
  if (!window.LFH_BACK) return;
  const openKeys = new Set();
  state.floatingTables.forEach((f) => openKeys.add("float:" + f.table));
  if (!state.floatingTables.length && state.selectedTable != null) openKeys.add("dock:" + state.selectedTable);
  // Register a layer for any newly-open detail.
  openKeys.forEach((k) => {
    if (_tableBackLayers.has(k)) return;
    const off = LFH_BACK.layer("table-detail", () => {
      _tableBackLayers.delete(k); // Back already popped this layer — don't rewind it again
      if (k.slice(0, 6) === "float:") {
        const t = k.slice(6);
        state.floatingTables = state.floatingTables.filter((f) => String(f.table) !== String(t));
      } else {
        state.selectedTable = null;
      }
      renderEditor();
    });
    _tableBackLayers.set(k, off);
  });
  // Drop layers for details closed by other means (✕, shift, close, free).
  [..._tableBackLayers.keys()].forEach((k) => {
    if (!openKeys.has(k)) { const off = _tableBackLayers.get(k); _tableBackLayers.delete(k); try { off(); } catch (e) {} }
  });
}

// followShiftedTable(from, to): after a party is shifted, move whatever detail was showing
// the SOURCE table onto the DESTINATION — in BOTH view modes. selectTable(to) alone only
// moved the DOCKED detail; in popup/phone mode the OLD table stayed floating and the moved
// party looked like it vanished (no popup for its new home). This handles the floating popup,
// the docked detail, and the legacy modal, then refetches the new table's slice.
function followShiftedTable(from, to) {
  from = String(from); to = String(to);
  const fi = state.floatingTables.findIndex((f) => String(f.table) === from);
  if (fi >= 0) {
    if (state.floatingTables.some((f) => String(f.table) === to)) state.floatingTables.splice(fi, 1); // dest already floats → just drop the old
    else state.floatingTables[fi].table = to;
  }
  if (String(state.selectedTable) === from) state.selectedTable = to;
  if (String(state.openSess) === from) state.openSess = to;
  renderEditor();  // instant repaint at the new table
  loadSessions();  // fetch the destination's full slice
}

// openFloatingTable(t): open (or re-focus) table t as a FLOATING popup — the tile-tap
// entry point when the side panel is collapsed (owner, 2026-07-02: collapsed → popup mode).
// Renders instantly (summary-accurate streaming), then loadSessions fills in the dishes —
// same stale-while-revalidate flow as selectTable, just into a floating card instead of the
// dock. Guards against duplicating a table that's already floating (a second tap is a no-op).
function openFloatingTable(table) {
  if (!addFloating(table)) return; // at the cap
  renderEditor();  // instant, summary-accurate
  loadSessions();  // fetch slice → re-render with full dish rows
}

// refreshTableDetail: redraw whichever table-detail view is currently open after a
// local (optimistic) change, so the instant feedback works in BOTH places. There
// are two: the legacy pop-up modal (state.openSess) and the new in-panel master-
// detail (state.selectedTable). renderTablePanel() only redraws the modal — it bails
// when no modal is open — so on its own it leaves the in-panel detail stale. This
// covers both, and preserves the in-panel body's scroll so serving a dish doesn't
// fling the list back to the top.
function refreshTableDetail() {
  if (state.openSess != null) { renderTablePanel(); return; }
  // FLOATING POPUPS (popup mode — the default detail view now): the detail lives in the
  // floating layer, which ONLY renderEditor() rebuilds. Optimistic actions (serve a dish,
  // approve/deny a member) call refreshTableDetail expecting an INSTANT repaint — without
  // this branch the local change didn't paint until the next poll, so serving a dish in a
  // popup looked like it took ~2s (owner report, 2026-07-03). The per-order accept/serve-all
  // already repaint via loadSessions(true)→renderEditor; this covers the per-DISH path too.
  // Preserve every open popup's scroll so serving a dish doesn't fling the list to the top.
  if (state.floatingTables.length) {
    const ed = $("#editor");
    const scrolls = {};
    ed.querySelectorAll("[data-floating-table]").forEach((c) => { const b = c.querySelector(".tp-detail-body"); if (b) scrolls[c.dataset.floatingTable] = b.scrollTop; });
    renderEditor();
    const ed2 = $("#editor");
    Object.keys(scrolls).forEach((t) => { const b = ed2.querySelector(`[data-floating-table="${CSS.escape(t)}"] .tp-detail-body`); if (b) b.scrollTop = scrolls[t]; });
    return;
  }
  if (state.selectedTable != null) {
    const ed = $("#editor");
    const body = ed.querySelector(".tp-detail-body");
    const top = body ? body.scrollTop : 0;
    renderEditor();
    const b2 = ed.querySelector(".tp-detail-body");
    if (b2) b2.scrollTop = top;
  }
}

// Tables currently in STAFF EDIT mode (after the kitchen-confirm). Module-level so
// it survives the panel's poll-driven re-renders. (owner, 2026-06-17)
const editTables = new Set();

// One dish row: its own status pill + next-step tap. Works for session items (order_items)
// AND legacy items (orders.items JSON) — so dishes are served one at a time either way.
// `editing` (staff edit mode) adds qty steppers + a note edit on each real dish row.
function itemRowHtml(row, editing = false) {
  // Redesigned row layout (master-detail): qty · name+detail · price · [chip + serve + 🗑].
  // The status now reads as a CHIP on the right next to its actions (was a pill on the
  // left), so the eye runs name → price → status → action in one line.
  let serveBtn = "";
  // A dish that's cooking OR ready (kitchen finished it) can be served from here.
  if (row.status === "preparing" || row.status === "ready") {
    const attr = row.kind === "session"
      ? `data-item-next="${esc(row.id)}" data-item-status="served"`
      : `data-legacy-order="${esc(row.orderId)}" data-legacy-idx="${row.idx}" data-legacy-status="served"`;
    serveBtn = `<button class="icon-serve" title="Serve this dish" ${attr}>🍽️</button>`;
  }
  const priceTag = `<span class="sx-item-price">${row.price > 0 ? inr(row.price * row.qty) : ""}</span>`;
  // 🗑 Delete this single dish from the order. ONLY for session items (they have a
  // real order_item id the server can delete + reconcile); legacy JSON-only orders
  // have no per-item row, so we don't offer it there. Deleting recomputes the bill
  // total server-side (see lfh_delete_order_item) so no stale money is left behind.
  // …but NOT once it's SERVED — a delivered dish is a financial record; you don't
  // silently delete it (mirror the tablet, which also blocks delete on served).
  const delBtn = (row.kind === "session" && row.status !== "served") ? `<button class="icon-del sx-item-del" data-item-del="${esc(row.id)}" data-item-name="${esc(row.title)}" title="Remove this dish from the order">🗑</button>` : "";
  // status label: friendlier words for the chip (class stays the raw status for colour).
  const STLABEL = { received: "new", preparing: "cooking", ready: "ready", served: "served", cancelled: "cancelled" };
  // STAFF EDIT (a real dish): qty −/＋ steppers + a "✎ Edit" button (allergens +
  // kitchen note) on a FULL-WIDTH row below the dish. Split into two separate gates:
  //   qty steppers  — blocked once READY/SERVED (re-prices the bill; you can't
  //                   un-serve part of a dish once it's out).
  //   ✎ Edit        — allowed at ANY status (owner, 2026-07-03 — "allergy can be
  //                   added to all items"). Allergens/notes are metadata, never
  //                   money, so there's no integrity reason to lock them once served.
  const canEditQty = editing && row.kind === "session" && row.status !== "served" && row.status !== "ready";
  const canEditDish = editing && row.kind === "session";
  const editRow = canEditDish
    ? `<div class="sx-dish-edit-row">${canEditQty ? `<span class="sx-item-edit"><button class="sx-qty" data-qty-dec="${esc(row.id)}" data-qty="${esc(row.qty)}" title="Fewer">−</button><button class="sx-qty" data-qty-inc="${esc(row.id)}" data-qty="${esc(row.qty)}" title="More">＋</button></span>` : ""}<button class="sx-dish-edit-btn" data-edit-dish="${esc(row.id)}" title="Edit allergens & note for this dish">✎ Edit</button></div>`
    : "";
  // ✎− on the dish NAME when an allergen was REMOVED after the order was placed
  // (we flag that something was removed without naming the gone item).
  const remMark = row.removedFlag ? ` <span class="alg-removed" title="An allergen was removed after the order was placed">✎−</span>` : "";
  return `<div class="sx-item${editing ? " editing" : ""}"><span class="sx-item-qty">×${esc(row.qty)}</span><div class="sx-item-info"><span class="sx-item-name">${esc(row.title)}${dishNoTag(row.title)}${remMark}</span>${itemDetailLine(row)}</div>${priceTag}<div class="sx-item-acts"><span class="ord-pill ${esc(row.status)}">${esc(STLABEL[row.status] || row.status)}</span>${serveBtn}${delBtn}</div>${editRow}</div>`;
}

// openDishEditModal: ONE editor for a single placed dish — toggle which allergens to
// AVOID (the 6 standard ones PLUS any custom like "water"), type a NEW custom allergen,
// and write a kitchen note. Replaces the old browser prompt() + scattered inline chips
// with one clean, dynamic modal (owner, 2026-06-17). Save persists in a single go:
//   • adding an allergen → written to THIS dish's own list (order_items.removed)
//   • removing one → cleared from the dish AND the order-wide "avoid" list so it's gone
//   • the note → order_items.note
function openDishEditModal(itemId, rerender) {
  document.querySelector(".dish-edit-overlay")?.remove();
  // The live floor's cache (state.board.items) only holds OPEN tables' dishes. A
  // settled/archived bill (opened from the Bills view) isn't there — fall back to
  // each order's own embedded items JSONB, which carries the same id/removed/note
  // fields (kept in sync by lfh_sync_order_items_json), so the SAME modal works for
  // both a live table's dish and a past bill's dish. (owner, 2026-07-03 — "allergy
  // can be added to all items")
  let item = (state.board.items || []).find((i) => i.id === itemId);
  let order = item ? ((state.data.orders || []).find((o) => o.id === item.order_id) || {}) : null;
  if (!item) {
    for (const o of (state.data.orders || [])) {
      const found = (Array.isArray(o.items) ? o.items : []).find((i) => i.id === itemId);
      if (found) { item = { ...found, order_id: o.id }; order = o; break; }
    }
  }
  order = order || {};
  // Normalise an allergen: lowercase, trim, strip a leading "no " so typing "no water"
  // or "water" both store "water" (the UI prepends "NO" when it shows it).
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/^no[\s-]+/, "");
  const itemRemoved = (Array.isArray(item.removed) ? item.removed : []).map(norm).filter(Boolean);
  const orderAllergies = (Array.isArray(order.allergies) ? order.allergies : []).map(norm).filter(Boolean);
  const initial = new Set([...itemRemoved, ...orderAllergies]); // what the dish avoids now
  const working = new Set(initial);                             // live working copy until Save
  const STD = ALLERGENS.map((a) => a.slug);
  const labelFor = (slug) => { const a = ALLERGENS.find((x) => x.slug === slug); return a ? a.label : "🚫 " + slug; };
  const chipsHtml = () => {
    const std = ALLERGENS.map((a) => `<span class="chip dish-alg-chip ${working.has(a.slug) ? "on" : ""}" data-slug="${esc(a.slug)}">${esc(a.label)}</span>`).join("");
    // Custom allergens are their own chips — tap one to REMOVE it (same as a standard chip).
    const cust = [...working].filter((s) => !STD.includes(s)).map((s) => `<span class="chip dish-alg-chip on" data-slug="${esc(s)}">${esc(labelFor(s))}</span>`).join("");
    return std + cust;
  };
  const wrap = el(`<div class="sx-modal-overlay dish-edit-overlay"><div class="sx-modal dish-edit-modal">
    <div class="tbl-modal-head"><div class="tp-detail-top"><h3>Edit dish · ${esc(item.title)}</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div>
    <div class="dish-edit-body">
      <div class="dish-edit-lbl">⚠ Allergies to avoid <span class="muted small">— tap to add or remove</span></div>
      <div class="dish-alg-list"></div>
      <div class="dish-edit-custom"><input type="text" class="dish-edit-custominput" placeholder="Type a custom allergen — e.g. water" maxlength="24"><button type="button" class="btn small dish-edit-customadd">Add</button></div>
      <div class="dish-edit-lbl" style="margin-top:15px">✎ Note for the kitchen</div>
      <textarea class="dish-edit-note" rows="2" maxlength="200" placeholder="e.g. less ice, extra chocolate"></textarea>
    </div>
    <div class="dish-edit-foot"><button type="button" class="btn dish-edit-cancel">Cancel</button><button type="button" class="btn primary dish-edit-save">Save</button></div>
  </div></div>`);
  document.body.appendChild(wrap);
  wrap.querySelector(".dish-edit-note").value = item.note || "";
  const listEl = wrap.querySelector(".dish-alg-list");
  const input = wrap.querySelector(".dish-edit-custominput");
  const bindChips = () => listEl.querySelectorAll("[data-slug]").forEach((c) => (c.onclick = () => {
    const s = c.dataset.slug; working.has(s) ? working.delete(s) : working.add(s); redraw();
  }));
  const redraw = () => { listEl.innerHTML = chipsHtml(); bindChips(); };
  redraw();
  const addCustom = () => { const v = norm(input.value); if (v) working.add(v); input.value = ""; redraw(); input.focus(); };
  wrap.querySelector(".dish-edit-customadd").onclick = addCustom;
  input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } };
  const close = () => wrap.remove();
  wrap.querySelector(".tbl-modal-close").onclick = close;
  wrap.querySelector(".dish-edit-cancel").onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  const same = (a, b) => JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());
  wrap.querySelector(".dish-edit-save").onclick = async () => {
    const note = wrap.querySelector(".dish-edit-note").value.trim();
    const removed = [...initial].filter((s) => !working.has(s));  // cleared → drop everywhere
    const added = [...working].filter((s) => !initial.has(s));    // new avoids → this dish only
    const newItemRemoved = [...new Set([...itemRemoved.filter((s) => !removed.includes(s)), ...added])];
    const newOrderAllergies = orderAllergies.filter((s) => !removed.includes(s));
    try {
      if (note !== String(item.note || "").trim()) await api("POST", `/items/${item.id}/note`, { note });
      if (!same(newItemRemoved, itemRemoved)) await api("POST", `/items/${item.id}/removed`, { removed: newItemRemoved });
      if (order.id && !same(newOrderAllergies, orderAllergies)) await api("POST", `/orders/${order.id}/allergies`, { allergies: newOrderAllergies });
      close();
      await loadSessions(); if (rerender) rerender();
      toast("Dish updated", "ok");
    } catch (e) { toast("Couldn't save: " + e.message, "err"); }
  };
  setTimeout(() => input.focus(), 30);
}

// tablePanelParts: build ALL the inner HTML sections for ONE table's full detail
// (guests, the live building cart, the merged orders, waiter calls, the bill, and
// the footer action buttons). This is the SHARED brain behind both views:
//   • renderTablePanel() — the old pop-up modal (kept for any caller that still uses it)
//   • the Tables-tab right side panel — the new master-detail (renders this IN PLACE)
// Pulling it out means the two views can never drift apart again.
// Returns the pieces + the computed { sess, os, canFree } so the caller can wire up.
function tablePanelParts(t) {
  const sessionsOn = !!(state.data.settings || {}).sessions_enabled;
  const os = ordersForTable(t);
  const sess = openSessionForTable(t);
  const calls = callsForTable(t);

  // ── PENDING REQUESTS for THIS table (a guest tapped "open this table" / "join" /
  // asked for a waiter on their phone). These used to live ONLY in the floor's side
  // "Requests" card + the tile's 📨 badge — the table DETAIL (docked, floating popup
  // AND the legacy modal) never showed them, so staff opening a "Wants in" table saw
  // just "This table isn't open yet" with no way to accept the person (owner,
  // 2026-07-28). Built from the ALWAYS-fresh summary (not the per-table slice) so the
  // card shows even while the slice is still streaming in; an "open" request hides
  // once the table is actually open (same rule as reqsForTable). The buttons reuse
  // data-req-approve/deny → resolveRequest and are wired by bindTablePanel, which all
  // three detail hosts share.
  const tReqs = (state.summary.requests || []).filter((r) => String(r.table_number) === String(t) && !(r.type === "open" && (sess || summaryTableOpen(t))));
  const REQ_WORDS = { open: "is asking to open this table", join: "is asking to join this table", access: "asked for a waiter" };
  const reqOkLabel = (r) => (r.type === "open" ? "✓ Open for them" : r.type === "access" ? "✓ Attend" : "✓ Let them in");
  const requestsSec = tReqs.length ? `<div class="sx-sec tp-req-sec"><div class="sx-sec-h">📨 Someone's waiting <span class="sub">· ${tReqs.length}</span></div>${tReqs.map((r) =>
    `<div class="sx-req"><div class="sx-req-info"><b>${esc(r.name || r.phone || "A guest")}</b> ${esc(REQ_WORDS[r.type] || "sent a request")}<small>${esc(timeAgo(r.created_at))}</small></div><div class="sx-req-actions"><button class="btn small" data-req-deny="${esc(r.id)}" title="Dismiss this request">✕</button><button class="btn small primary" data-req-approve="${esc(r.id)}">${reqOkLabel(r)}</button></div></div>`
  ).join("")}</div>` : "";

  // ── INSTANT RENDER (stale-while-revalidate): before this table's full slice has loaded,
  // render the head + a light "loading details…" body from the ALWAYS-fresh summary tile
  // (guests/dishes/due/status — everything but the individual dish rows), so the popup
  // opens instantly with accurate numbers instead of a 1-2s blank "isn't open yet". The
  // dish rows + guest rows + action buttons stream in the moment the slice lands (~sub-
  // second) and the detail re-renders. Only kicks in for an OCCUPIED table whose slice
  // isn't in yet — a genuinely free table renders its real "Open this table" state.
  const sumTile = (state.summary.tiles || {})[String(t)] || {};
  const streaming = !sliceLoaded(t) && summaryTableOpen(t);

  // Both totals are net of any discounts staff have given. While streaming, the summary
  // tile's precomputed `due` stands in (it's server-computed net of discounts too).
  // Money is computed via billMath (per-bill, discount BEFORE tax, this restaurant's tax
  // rate) — the SAME helper the printed bill uses — so the pay screen, the receipt and
  // the Z-report always agree. (Was summing the STORED per-order total, which carried a
  // flat 5% on the pre-discount subtotal → the staff collected a different amount than
  // the bill said.) A table settles all-or-nothing, so `due` is the unpaid slice's total.
  // EXCLUDE 'received' (not-yet-accepted) orders from the due — a brand-new order isn't a
  // confirmed bill yet, so it doesn't count toward "Due". This matches the floor tile
  // (isUnpaidBill excludes received) AND the summary RPC (status NOT IN ('received','cancelled')).
  // Without this, the detail head showed a HIGHER due than the tile the moment a guest added a
  // new order staff hadn't accepted, and the streaming due (from the RPC) blipped up when the
  // slice landed. (owner 2026-07-06)
  const unpaidOs = os.filter((o) => o.status !== "cancelled" && o.status !== "received" && o.payment_status !== "paid");
  const mBill = billMath(os);
  const mDue = billMath(unpaidOs);
  const due = streaming ? (Number(sumTile.due) || 0) : mDue.total;
  const billTotal = streaming ? (Number(sumTile.due) || 0) : mBill.total;
  const canFree = os.length > 0 && os.every((o) => o.payment_status === "paid" || o.status === "cancelled");

  // ── HEAD: a status pill, a one-line summary (bill #, guests, dishes, due) and a
  // dish-status PROGRESS BAR (how much of this table is served vs cooking vs new).
  // Both detail views (in-panel + legacy modal) render these so they stay identical.
  const tile = tableTileState(t);
  // VIP / Family / Owner's-guest mark (mig 166) shown right in the detail HEADER so a
  // marked table is unmistakable when opened — not only on the floor tile (owner
  // 2026-07-23: "the mark is not showing in that table thing"). tagForTable already
  // gates on the feature being on.
  const hdrTag = TABLE_TAG_INFO[tagForTable(t)];
  const headTagPill = hdrTag ? `<span class="tp-tagpill tag-${tagForTable(t)}">${hdrTag.emoji} ${esc(hdrTag.label)}</span>` : "";
  const headPill = `<span class="tp-pill tp-pill-${esc(tile.st)}">● ${esc(tile.label)}</span>${headTagPill}`;
  const liveRowsAll = os.filter((o) => o.status !== "cancelled").flatMap((o) => orderItemRows(o));
  // Count dishes by QUANTITY (a "2× Cappuccino" row is 2 dishes), matching both the summary
  // tile and the floor tile's "0/3 served" — so the head's numbers stay identical whether
  // they come from the summary (streaming) or the loaded rows, with no 3→2 blip when the
  // slice lands.
  const sc = sumTile.counts || { nw: 0, ck: 0, rd: 0, sv: 0 }; // summary per-status dish counts (already by qty)
  const qsum = (pred) => liveRowsAll.filter(pred).reduce((s, r) => s + Math.max(1, parseInt(r.qty, 10) || 1), 0);
  const cServed = streaming ? (sc.sv || 0) : qsum((r) => r.status === "served");
  const cCook = streaming ? ((sc.ck || 0) + (sc.rd || 0)) : qsum((r) => r.status === "preparing" || r.status === "ready");
  const cRecv = streaming ? (sc.nw || 0) : qsum((r) => r.status === "received");
  const dishN = streaming ? (cServed + cCook + cRecv) : qsum(() => true);
  const nItems = dishN || 1;
  const guestsN = streaming ? (Number(sumTile.members) || 0) : (sess ? membersOf(sess.id).length : 0);
  const subLine = `<div class="tp-det-sub">${sess && sess.bill_no != null ? `<span>Bill <b>#${esc(sess.bill_no)}</b></span>` : ""}<span><b>${guestsN}</b> guest${guestsN === 1 ? "" : "s"}</span><span><b>${dishN}</b> dish${dishN === 1 ? "" : "es"}</span>${due > 0 ? `<span>Due <b>${inr(due)}</b></span>` : billTotal > 0 ? `<span>Total <b>${inr(billTotal)}</b></span>` : ""}</div>`;
  const progress = dishN ? `<div class="tp-prog"><div class="tp-prog-bar"><span class="pp-served" style="width:${(cServed / nItems) * 100}%"></span><span class="pp-cook" style="width:${(cCook / nItems) * 100}%"></span><span class="pp-recv" style="width:${(cRecv / nItems) * 100}%"></span></div><div class="tp-prog-leg"><span><i class="pl-served"></i>${cServed} served</span><span><i class="pl-cook"></i>${cCook} cooking</span><span><i class="pl-recv"></i>${cRecv} new</span></div></div>` : "";
  const headMeta = subLine + progress;

  // STREAMING: head is accurate from summary; the actionable body (guest rows, dish rows,
  // bill breakdown, action buttons) needs the slice, so show a light shimmer line for each
  // until it lands. Return here so the heavy per-order builders below never run on empty data.
  if (streaming) {
    const loadRow = `<div class="sx-loading"><span class="sx-load-dot"></span> Loading details…</div>`;
    const sessionSec = sessionsOn ? `<div class="sx-sec"><div class="sx-sec-h">Guests <span class="sub">· ${guestsN}</span></div>${loadRow}</div>` : "";
    const ordersSec = `<div class="sx-sec"><div class="sx-sec-h">Orders <span class="sub">· ${dishN}</span></div>${loadRow}</div>`;
    return { sess: null, os: [], canFree: false, headPill, headMeta, requestsSec, sessionSec, ordersSec, callsSec: "", billSec: "", foot: "" };
  }

  let sessionSec = "";
  if (sessionsOn) {
    if (sess) {
      const mem = membersOf(sess.id);
      const memRows = mem.length ? mem.map((m) => {
        const owner = m.role === "owner";
        const status = m.approved ? `<span class="sx-ok">approved</span>` : `<span class="sx-wait">waiting</span>`;
        // Kick (remove now) and Ban (kick + blocklist) are available for EVERYONE,
        // including the head — staff have full control from the table view.
        let acts = "";
        if (!m.approved) acts += `<button class="btn small primary" data-mem-approve="${esc(m.id)}">Approve</button><button class="btn small" data-mem-deny="${esc(m.id)}">Deny</button>`;
        else acts += `<button class="btn small" data-mem-kick="${esc(m.id)}">Kick</button>`;
        // Any guest who isn't the head can be handed the table (owner's "transfer"):
        // they become head + approved; the old head is kicked by the server.
        if (!owner) acts += `<button class="btn small" data-mem-head="${esc(m.id)}" title="Make them the table's head — the current head is kicked">Transfer</button>`;
        acts += `<button class="btn small danger" data-mem-ban="${esc(m.id)}" data-ban-phone="${esc(m.phone || "")}">Ban</button>`;
        return `<div class="sx-mem"><div class="sx-mem-info">${owner ? "👑 " : "🤝 "}<b>${esc(m.name || (owner ? "Head" : "Guest"))}</b> ${status}${m.phone_verified ? ` <span class="sx-ok">✓</span>` : ""}</div><div class="sx-mem-acts">${acts}</div></div>`;
      }).join("") : `<div class="sx-empty">No one has joined yet.</div>`;
      sessionSec = `<div class="sx-sec"><div class="sx-sec-h">Guests <span class="sub">· ${mem.length}</span><label class="sx-auto"><input type="checkbox" id="sxAuto" ${sess.auto_approve ? "checked" : ""}> auto-approve</label></div>${memRows}</div>`;
    } else {
      sessionSec = `<div class="sx-sec"><div class="sx-sec-h">Session</div><div class="sx-empty">This table isn't open yet.</div><button class="btn primary" id="sxOpen">Open this table</button></div>`;
    }
  }

  let ordersSec;
  if (!os.length) {
    ordersSec = `<div class="sx-sec"><div class="sx-sec-h">Orders</div><div class="sx-empty">No orders yet.</div></div>`;
  } else {
    // Un-accepted (new) orders stay SEPARATE so each can be accepted — separation
    // only while accepting. Once accepted, every dish MERGES into one combined list
    // with a SINGLE bill; no per-order split, no per-order total/pay (owner, 2026-06-14).
    // The separate order rows still live in the DB as the log of which came first.
    const newOrders = os.filter((o) => o.status === "received");
    const liveOrders = os.filter((o) => o.status !== "received" && o.status !== "cancelled");
    // The order's items (from order_items, same source the tablet uses) WITH the
    // order-wide allergens distributed onto each item's "removed" — so every dish
    // shows "no dairy", identical to the tablet. This is what made the two detail
    // views disagree before (the popup showed only each item's own removals).
    const withAllergens = (o) => { const a = Array.isArray(o.allergies) ? o.allergies : []; return orderItemRows(o).map((r) => ({ ...r, removed: [...new Set([...(Array.isArray(r.removed) ? r.removed : []), ...a])] })); };
    const when = (o) => o.created_at ? new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    const editing = editTables.has(String(t)); // staff EDIT mode for this table?
    // While editing, each KOT card gets allergen toggle chips ("avoid in all dishes")
    // + an "＋ Add dish" button. Allergy/add are PER-ORDER (per KOT). (owner, 2026-06-17)
    const orderEditExtras = (o) => {
      if (!editing) return "";
      const aSet = new Set((Array.isArray(o.allergies) ? o.allergies : []).map((x) => String(x).toLowerCase()));
      const chips = ALLERGENS.map((a) => `<span class="chip oae-chip ${aSet.has(a.slug) ? "on" : ""}" data-alg="${esc(o.id)}" data-slug="${a.slug}">${esc(a.label)}</span>`).join("");
      return `<div class="tp-edit-extras"><div class="tp-edit-alg"><span class="muted small">⚠ Avoid (all dishes):</span>${chips}</div><button class="btn small" data-add-dish-order="${esc(o.id)}">＋ Add dish</button></div>`;
    };
    // Each un-accepted (NEW) order is its own highlighted card with its own Accept —
    // dishes share the same row layout as the rest (via itemRowHtml).
    const newBlocks = newOrders.map((o) => {
      const rows = withAllergens(o).map((r) => itemRowHtml(r, editing)).join("");
      return `<div class="tp-order tp-order-new"><div class="tp-order-head"><span class="kot-chip">${o.kot_no != null ? "KOT #" + esc(o.kot_no) : "New order"}</span>${when(o) ? `<span class="tp-when">${when(o)}</span>` : ""}<span class="tp-newtag">new</span></div>${rows}${orderEditExtras(o)}<div class="tp-order-foot"><button class="btn small primary tp-accept" data-accept="${esc(o.id)}">✓ Accept order</button></div></div>`;
    }).join("");
    // ACCEPTED orders are GROUPED into per-KOT cards (so you can see which ticket each
    // dish came from) but they still settle as ONE bill — no per-order total/pay/discount
    // (owner, 2026-06-14: one merged bill). Per-dish serve/delete live on each row.
    const mergedBlock = liveOrders.map((o) => {
      const rows = withAllergens(o).map((r) => itemRowHtml(r, editing)).join("");
      return `<div class="tp-order"><div class="tp-order-head"><span class="kot-chip">${o.kot_no != null ? "KOT #" + esc(o.kot_no) : "Order"}</span>${when(o) ? `<span class="tp-when">${when(o)}</span>` : ""}</div>${rows}${orderEditExtras(o)}</div>`;
    }).join("");
    const mergedBadge = liveOrders.length > 1 ? `<span class="sx-badge2">${liveOrders.length} merged · one bill</span>` : "";
    // Edit/Done toggle: the gated entry to staff editing. The confirm fires on Edit.
    const editToggle = editing
      ? `<button class="btn small primary tp-edit-toggle" data-done-table="${esc(t)}">✓ Done editing</button>`
      : `<button class="btn small tp-edit-toggle" data-edit-table="${esc(t)}">✎ Edit</button>`;
    ordersSec = `<div class="sx-sec"><div class="sx-sec-h">Orders <span class="sub">· ${os.length}</span>${mergedBadge}${editToggle}</div>${newBlocks}${mergedBlock}</div>`;
  }

  // Each active call (water, napkins, clean…) gets its own "Done" button so staff
  // can clear them one at a time; if there are several, an "Attend all" clears them together.
  const callsSec = calls.length ? `<div class="sx-sec"><div class="sx-sec-h">Calls <span class="sub">· ${calls.length}</span></div>${calls.map((c) => `<div class="sx-call">${callEmoji(c.note)} ${esc(c.note || "Waiter call")} <button class="btn small primary" data-call-attend="${esc(c.id)}">Done</button></div>`).join("")}${calls.length > 1 ? `<button class="btn small" data-attend-all="${esc(t)}">✓ Attend all (${calls.length})</button>` : ""}</div>` : "";
  // When several orders are still unpaid, offer a single "Mark all paid" so staff
  // settle the whole table at once instead of paying each order separately.
  // Payment + discount now live on the single MERGED bill (per-order pay/disc were
  // removed when the orders merged). Mark-paid settles the whole table at once.
  const anyUnpaidBill = os.some((o) => o.status !== "cancelled" && o.payment_status !== "paid");
  const payAllBtn = anyUnpaidBill ? `<button class="btn primary" id="sxPayAll">💳 Mark ${os.length > 1 ? "all " : ""}paid</button>` : "";
  // The bill discount writes to the first non-cancelled order's record; the bill
  // total already nets every order's discount, so it shows correctly on the merged bill.
  const discTarget = os.find((o) => o.status !== "cancelled");
  const discBtn = discTarget ? `<button class="btn" data-disc="${esc(discTarget.id)}" data-disc-cur="${esc(Number(discTarget.discount) || 0)}" data-disc-max="${esc(discTarget.total)}" title="Give a discount on the bill">− Discount</button>` : "";
  // Split-bill helper: tells staff each guest's even share of the bill total. Doesn't change the bill
  // or payment — the manager still marks the whole bill paid once collected.
  // Split among guests = what's still DUE (exclude any order already paid), not the
  // whole historical total — matches the KOT-on split-settle path.
  const splitDue = billMath(os.filter((o) => o.status !== "cancelled" && o.payment_status !== "paid")).total || mBill.total;
  const splitBtn = os.length ? `<button class="btn" data-split="${esc(splitDue)}" title="Split the bill evenly between guests">🍴 Split</button>` : "";
  // Invoice-first billing (owner 2026-07-24): NO direct Print on a running tab — show
  // "Generate invoice" first; Print (+ Reopen) appears only once an invoice exists. A
  // settled bill is always invoiced (markTablePaid auto-generates it), so it shows Print.
  const invoicedNow = !!sess && sess.invoice_no != null && !sess.invoice_voided;
  const printBtn = !os.length ? "" : (invoicedNow
    ? `<button class="btn" id="sxPrint">🖨 Print</button><button class="btn" id="sxReopen" title="Void the invoice to change the bill again">↩ Reopen</button>`
    : `<button class="btn" id="sxGenInv">🧾 Generate invoice</button>`);
  // The bill now shows a full BREAKDOWN (subtotal · discount · GST · total) summed
  // across the table's non-cancelled orders, not just a one-line "Due/Total".
  // Breakdown from billMath (same rate + discount-before-tax rule as the printed bill),
  // NOT the stored per-order subtotal/tax columns (tax there is a flat 5%, pre-discount).
  const sumSub = mBill.subtotal;
  const sumTax = mBill.tax;
  const sumDisc = mBill.disc;
  const billSec = os.length ? `<div class="sx-sec"><div class="sx-sec-h">Bill${sess && sess.bill_no != null ? ` <span class="sub">· bill #${esc(sess.bill_no)}</span>` : ""}</div><div class="tp-bill">${sumSub > 0 ? `<div class="tp-bl"><span>Subtotal</span><b>${inr(sumSub)}</b></div>` : ""}${sumDisc > 0 ? `<div class="tp-bl disc"><span>Discount</span><b>− ${inr(sumDisc)}</b></div>` : ""}${sumTax > 0 ? `<div class="tp-bl"><span>${esc(taxLabel())}</span><b>${inr(sumTax)}</b></div>` : ""}<div class="tp-bl grand"><span>${due > 0 ? "Total due" : "Total"}</span><span class="tp-bl-amt">${inr(due > 0 ? due : billTotal)}</span></div></div></div>` : "";

  // The PRIMARY table-wide action: accept everything that's new, else serve everything
  // that's cooked. (Per-order Accept stays on each new card; per-dish Serve on each row.)
  // Count orders with un-accepted (received) DISHES — item-level, so it matches the
  // floor tile's "New order" cue and the accept action (acceptTableOrders). Was
  // order-level (o.status==="received"), which hid "Accept all" for a preparing order
  // that still had a freshly-added received dish. (2026-06-26)
  const newOrdersN = os.filter((o) => o.status !== "cancelled" && orderItemRows(o).some((r) => r.status === "received")).length;
  const anyUnservedAccepted = os.some((o) => o.status !== "cancelled" && o.status !== "received" && orderItemRows(o).some((r) => r.status !== "served"));
  let primaryBtn = "";
  if (newOrdersN) primaryBtn = `<button class="btn primary tp-accept-all" data-accept-all="${esc(t)}">✓ Accept all &amp; prepare${newOrdersN > 1 ? ` (${newOrdersN})` : ""}</button>`;
  else if (anyUnservedAccepted) primaryBtn = `<button class="btn green tp-serve-all-orders" data-serve-all-orders="${esc(t)}">🍽️ Serve all</button>`;
  // ONE end-the-table button (was a redundant "Turn table off" + "Free table",
  // which do the same thing once the bill is paid). It adapts to the state:
  //  • bill fully settled → "✓ Free table" (archive the paid orders + close)
  //  • open but unpaid    → "⏻ Close table" (force-close, cancels unmade food)
  //  • legacy no-session + unpaid → a disabled "Settle bill to free" hint.
  const endBtn = canFree
    ? `<button class="btn primary tp-free">✓ Free table</button>`
    : (sess ? `<button class="btn danger" id="sxClose">⏻ Close table</button>`
            : `<button class="btn tp-free" disabled>Settle bill to free</button>`);
  // ONE sticky action bar holds every table-wide action: the primary action + pay +
  // discount on the LEFT, then table-management (shift/print/restart/close) on the RIGHT.
  const tagBtn = tagActionAllowed("table_tags") ? `<button class="btn" id="sxTag" title="Mark this table VIP / Family / Owner's guest">${TABLE_TAG_INFO[tagForTable(t)] ? TABLE_TAG_INFO[tagForTable(t)].emoji : "🏷"} Type</button>` : "";
  // KOT ▾ (Table & KOT operations) lives in the detail HEADER, not this crowded bar
  // (owner, 2026-07-22 — "keep the kot option at the top"): tablePanelParts returns it
  // as kotHeadBtn and BOTH detail headers (docked + floating) render it next to Float.
  // While the menu is on, the footer DROPS its duplicates: 🍴 Split (lives inside KOT)
  // and ⇄ Shift (Change table lives inside KOT). Ladder off → both render as before.
  const kotOn = tableOpsOn() && !!sess;
  const kotHeadBtn = kotOn
    ? `<button class="tp-detail-float tp-kot-head" id="sxKot" title="Table &amp; KOT operations — change table, merge, move a KOT or dish, split, reprint">🧾 KOT ▾</button>`
    : "";
  const shiftFallbackBtn = !kotOn && sess ? `<button class="btn" id="sxShift" title="Move this party to another table">⇄ Shift</button>` : "";
  // ＋ Take order — start a brand-new order for this table, like the waiter tablet.
  // Gated by the take_orders manager power: XRAY_CONTROLS hides it for a manager without
  // the power (and tints it for an admin/owner looking in); the server re-checks too.
  const takeOrderBtn = `<button class="btn primary tp-take-order" data-take-order="${esc(t)}">＋ Take order</button>`;
  const foot = `${takeOrderBtn}${primaryBtn}${payAllBtn}${discBtn}${kotOn ? "" : splitBtn}<span class="tp-foot-spacer"></span>${tagBtn}${shiftFallbackBtn}${printBtn}${os.length ? `<button class="btn" data-tp-restart="${esc(t)}">↻ Restart</button>` : ""}${endBtn}`;

  return { sess, os, canFree, headPill, headMeta, kotHeadBtn, requestsSec, sessionSec, ordersSec, callsSec, billSec, foot };
}

// Compact dish-picker modal for ADDING a dish to an already-placed order (staff
// edit). Lists the live menu with a search; tapping a dish adds it (qty 1) and the
// bill re-prices itself server-side. Stays open so several can be added. (2026-06-17)
function openAddDishModal(orderId, rerender) {
  document.querySelector(".add-dish-overlay")?.remove();
  const dishes = (state.data.items || []).filter((d) => !(d.tags || []).includes("sold-out"));
  const rowsFor = (q) => {
    const ql = (q || "").trim().toLowerCase();
    const list = dishes.filter((d) => !ql || (d.title || "").toLowerCase().includes(ql));
    return list.length
      ? list.map((d) => `<button class="add-dish-row" data-add="${esc(d.id)}"><span>${esc(d.title)}</span><span class="muted">${inr(parseFloat(d.price) || 0)}</span></button>`).join("")
      : `<div class="muted" style="padding:14px">No dishes match.</div>`;
  };
  const wrap = el(`<div class="sx-modal-overlay add-dish-overlay"><div class="sx-modal add-dish-modal"><div class="tbl-modal-head"><div class="tp-detail-top"><h3>Add a dish</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div><input type="search" class="add-dish-search" placeholder="🔎 Search dishes…"><div class="add-dish-list">${rowsFor("")}</div></div></div>`);
  document.body.appendChild(wrap);
  const listEl = wrap.querySelector(".add-dish-list");
  const bind = () => listEl.querySelectorAll("[data-add]").forEach((b) => (b.onclick = async () => {
    try {
      const r = await api("POST", `/orders/${orderId}/add-item`, { dishId: b.dataset.add, qty: 1 });
      if (r && r.ok === false) { toast("Couldn't add: " + (r.reason || "rejected"), "err"); return; }
      toast("Dish added — bill updated", "ok");
      await loadSessions(); if (rerender) rerender();
    } catch (e) { toast("Failed: " + e.message, "err"); }
  }));
  bind();
  const search = wrap.querySelector(".add-dish-search");
  search.oninput = () => { listEl.innerHTML = rowsFor(search.value); bind(); };
  wrap.querySelector(".tbl-modal-close").onclick = () => wrap.remove();
  wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
  search.focus();
}

// ── TAKE ORDER — start a BRAND-NEW dine-in order from the manager panel ─────────
// Mirrors the waiter tablet's order-builder (open table → browse dishes → build a
// cart → send to kitchen) rendered with the editor's own components/styling, posting
// to the manager's server-priced POST /order. Gated by the take_orders manager power
// (the button only shows when the manager has it; the server re-checks managerCan). (2026-07-22)
function localizeCat(name, slug) {
  if (name && typeof name === "object") return name.en || Object.values(name).find((v) => v) || slug;
  return name || slug;
}
function openTakeOrder(table, rerender, opts = {}) {
  const parcel = !!opts.parcel;          // parcel mode = a no-table TAKEAWAY order (Platform system)
  let custName = "", custPhone = "";      // parcel-only optional customer fields
  document.querySelector(".to-overlay")?.remove();
  const dishes = (state.data.items || []).filter((d) => !(d.tags || []).includes("sold-out"));
  const cats = (state.data.categories || []).filter((c) => dishes.some((d) => d.category === c.slug));
  // Dishes with an unknown/empty category still need a home so "all shown" holds.
  const uncategorised = dishes.filter((d) => !cats.some((c) => c.slug === d.category));
  const sections = cats.map((c) => ({ slug: c.slug, name: localizeCat(c.name, c.slug), items: dishes.filter((d) => d.category === c.slug) }))
    .concat(uncategorised.length ? [{ slug: "_other", name: "Other", items: uncategorised }] : []);

  // A cart line is one VARIANT of a dish: the same dish with different allergens/notes
  // is a SEPARATE line (like the tablet). Each line has a stable uid so edits never
  // reshuffle the DOM. Tap-to-add only ever touches the PLAIN variant.
  const cart = [];               // [{ uid, id, title, price, qty, note, avoid:Set }]
  const orderAvoid = new Set();  // whole-order allergens
  let orderNote = "";
  let q = "";
  let uidSeq = 0;
  const editing = new Set();     // cart-line UIDs whose per-dish editor is open

  const byUid = (uid) => cart.find((c) => c.uid === uid);
  const sig = (l) => [...l.avoid].sort().join(",") + "|" + (l.note || "").trim();
  const isPlain = (l) => !l.avoid.size && !(l.note || "").trim();
  const plainLine = (id) => cart.find((c) => c.id === id && isPlain(c));
  const qtyIn = (id) => cart.filter((c) => c.id === id).reduce((s, c) => s + c.qty, 0);
  // Tapping a dish adds to its PLAIN line only — a line carrying an allergy or note is a
  // distinct variant and is never grown by a tap (fixes "add plain → lands on the dairy one").
  const addOne = (id) => { const l = plainLine(id); if (l) { l.qty = Math.min(99, l.qty + 1); return; } const d = dishes.find((x) => x.id === id); if (d) cart.push({ uid: ++uidSeq, id, title: d.title, price: parseFloat(d.price) || 0, qty: 1, note: "", avoid: new Set() }); };
  const incUid = (uid) => { const l = byUid(uid); if (l) l.qty = Math.min(99, l.qty + 1); };
  const decUid = (uid) => { const i = cart.findIndex((c) => c.uid === uid); if (i < 0) return; if (cart[i].qty > 1) cart[i].qty--; else { cart.splice(i, 1); editing.delete(uid); } };
  // After an edit two lines can end up identical (same dish + allergy + note) — merge them.
  const dedupe = () => { for (let i = 0; i < cart.length; i++) for (let j = cart.length - 1; j > i; j--) { if (cart[i].id === cart[j].id && sig(cart[i]) === sig(cart[j])) { cart[i].qty = Math.min(99, cart[i].qty + cart[j].qty); editing.delete(cart[j].uid); cart.splice(j, 1); } } };

  const dishTile = (d) => {
    const n = qtyIn(d.id);
    // No photo (or a dead image URL) → show a default image, not a blank box (owner 2026-07-24).
    // An <img> (not a CSS background) so onerror can also swap a broken URL to the default; the
    // Aevidine mark is a neutral placeholder shown contained + dimmed so it reads as "no photo".
    const DEFAULT_DISH_IMG = "/brand/aevidine-mark.svg";
    const hasImg = !!d.image;
    const img = `<span class="to-dish-img"><img src="${esc(hasImg ? d.image : DEFAULT_DISH_IMG)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${DEFAULT_DISH_IMG}';this.style.objectFit='contain';this.style.opacity='.5';this.style.padding='16%';this.style.boxSizing='border-box'" style="width:100%;height:100%;display:block;box-sizing:border-box;object-fit:${hasImg ? "cover" : "contain"};${hasImg ? "" : "opacity:.5;padding:16%;"}" /></span>`;
    // Big image + name/price; the WHOLE tile taps to add (plain). The only button is a
    // large ✎ on the right to set this dish's allergens/note — no +/− (add by tapping,
    // reduce from the order list on the right). ×N shows the running count for this dish.
    return `<div class="to-dish ${n ? "has" : ""}" data-dish="${esc(d.id)}" role="button" tabindex="0" title="Tap to add">${img}<span class="to-dish-meta"><span class="to-dish-t">${esc(d.title)}</span><span class="to-dish-p">${inr(parseFloat(d.price) || 0)}</span></span><span class="to-dish-side">${n ? `<b class="to-dish-n">×${n}</b>` : ""}<button class="to-dish-edit" data-tile-edit="${esc(d.id)}" title="Allergens & note for this dish">✎</button></span></div>`;
  };
  const listHtml = () => {
    const ql = q.trim().toLowerCase();
    if (ql) { // searching → one flat grid of matches, no headers
      const list = dishes.filter((d) => (d.title || "").toLowerCase().includes(ql));
      return list.length ? `<div class="to-grid">${list.map(dishTile).join("")}</div>` : `<div class="muted" style="padding:16px">No dishes match "${esc(q)}".</div>`;
    }
    // not searching → every category shown, in order, each its own scroll-spy section
    return sections.map((s) => `<section class="to-sec" data-sec="${esc(s.slug)}"><h4 class="to-sec-h">${esc(s.name)}</h4><div class="to-grid">${s.items.map(dishTile).join("")}</div></section>`).join("");
  };
  const catChips = () => sections.map((s, i) => `<button class="to-cat ${i === 0 ? "on" : ""}" data-jump="${esc(s.slug)}">${esc(s.name)}</button>`).join("");
  const algChips = (set, kind, id) => ALLERGENS.map((a) => `<span class="chip to-alg-chip ${set.has(a.slug) ? "on" : ""}" data-alg="${a.slug}" data-kind="${kind}"${id ? ` data-line="${esc(id)}"` : ""}>${esc(a.label)}</span>`).join("");
  const cartLines = () => cart.length
    ? cart.map((c) => {
        const open = editing.has(c.uid);
        const cues = [c.avoid.size ? `⚠ no ${[...c.avoid].join(", ")}` : "", c.note ? `📝 ${c.note}` : ""].filter(Boolean).join(" · ");
        return `<div class="to-line ${open ? "editing" : ""}">
          <div class="to-line-main">
            <span class="to-line-t">${esc(c.title)}${cues ? `<span class="to-line-cue">${esc(cues)}</span>` : ""}</span>
            <span class="to-step"><button class="to-q" data-ldec="${c.uid}" aria-label="One fewer">−</button><b>${c.qty}</b><button class="to-q" data-linc="${c.uid}" aria-label="One more">＋</button></span>
            <span class="to-line-p">${inr((parseFloat(c.price) || 0) * c.qty)}</span>
            <button class="to-edit ${open ? "on" : ""}" data-edit="${c.uid}" title="Allergens & note for this dish">✎</button>
            <button class="to-rm" data-rm="${c.uid}" aria-label="Remove">🗑</button>
          </div>
          ${open ? `<div class="to-line-edit"><div class="to-lbl">Avoid in this dish</div><div class="to-alg">${algChips(c.avoid, "line", c.uid)}</div><input class="to-line-note" data-line="${c.uid}" maxlength="120" placeholder="Note for this dish (e.g. extra spicy)" value="${esc(c.note)}"></div>` : ""}
        </div>`;
      }).join("")
    : `<div class="muted" style="padding:14px 4px">No dishes yet — tap a dish to add it.</div>`;
  // Estimate INCLUDES tax so the "≈ ₹" staff quote matches the server's bill.
  // Parcel (takeaway) is stored & charged at the item subtotal — same as every other
  // Platform order (Zomato/Swiggy rows carry no tax line); dine-in keeps the tax-inclusive quote.
  const estTotal = () => { const sub = cart.reduce((s, c) => s + (parseFloat(c.price) || 0) * c.qty, 0); if (parcel) return inr(sub); const rate = (taxModel(state.data.settings) || {}).rate || 0; return inr(sub + Math.round(sub * rate * 100) / 100); };

  const wrap = el(`<div class="sx-modal-overlay to-overlay"><div class="sx-modal to-modal">
    <div class="tbl-modal-head"><div class="tp-detail-top"><h3>${parcel ? "🥡 New Parcel" : `＋ Take order · Table ${esc(table)}`}</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div>${parcel ? `<div class="to-cust"><input class="to-cust-name" maxlength="120" placeholder="Customer name (optional)"><input class="to-cust-phone" maxlength="20" inputmode="tel" placeholder="Phone (optional)"></div>` : ""}</div>
    <div class="to-body">
      <div class="to-menu">
        <input type="search" class="to-search" placeholder="🔎 Search dishes…">
        <div class="to-cats">${catChips()}</div>
        <div class="to-list">${listHtml()}</div>
      </div>
      <div class="to-cart">
        <div class="to-cart-h">This order</div>
        <div class="to-lines">${cartLines()}</div>
        <div class="to-extras">
          <div class="to-lbl">⚠ Avoid (whole order)</div>
          <div class="to-alg">${algChips(orderAvoid, "order")}</div>
          <textarea class="to-note" rows="2" placeholder="Note for the kitchen (optional)"></textarea>
        </div>
        <div class="to-foot">
          <div class="to-total">${parcel ? "" : "≈ "}<b>${estTotal()}</b></div>
          ${parcel
            ? `<div class="to-pay"><button class="btn green to-send" data-pay="now" ${cart.length ? "" : "disabled"}>Pay now &amp; print</button><button class="btn primary to-send" data-pay="later" ${cart.length ? "" : "disabled"}>Pay on pickup</button></div>`
            : `<button class="btn primary to-send" ${cart.length ? "" : "disabled"}>Send to kitchen</button>`}
        </div>
      </div>
    </div>
  </div></div>`);
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.__lfhClose = close;

  const listEl = wrap.querySelector(".to-list");
  const linesEl = wrap.querySelector(".to-lines");
  const catsEl = wrap.querySelector(".to-cats");
  const totalEl = wrap.querySelector(".to-total b");
  const sendBtns = [...wrap.querySelectorAll(".to-send")]; // parcel has TWO (pay now / pay later); dine-in has one
  if (parcel) {
    const nm = wrap.querySelector(".to-cust-name"); if (nm) nm.oninput = (e) => { custName = e.target.value; };
    const ph = wrap.querySelector(".to-cust-phone"); if (ph) ph.oninput = (e) => { custPhone = e.target.value; };
  }

  const paintCart = () => { linesEl.innerHTML = cartLines(); bindCart(); totalEl.textContent = estTotal(); sendBtns.forEach((b) => (b.disabled = !cart.length)); };
  const paintList = () => { listEl.innerHTML = listHtml(); bindList(); syncSpy(); };

  function bindList() {
    // ✎ on a tile — set this dish's allergens/note (edits the plain line, creating it first).
    listEl.querySelectorAll("[data-tile-edit]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openTileEdit(b.dataset.tileEdit); }));
    // Whole tile is a tap-to-add target (ignore a click that landed on the ✎).
    listEl.querySelectorAll(".to-dish").forEach((t) => (t.onclick = (e) => { if (e.target.closest("[data-tile-edit]")) return; addOne(t.dataset.dish); paintList(); paintCart(); }));
  }
  // Per-dish allergen + note popup opened from a dish tile's ✎ — mirrors the tablet's
  // per-item editor. Edits the PLAIN line (adds it first if needed); giving it an
  // allergy/note turns it into its own variant, so a later tap starts a fresh plain line.
  function openTileEdit(id) {
    let l = plainLine(id);
    if (!l) { addOne(id); l = plainLine(id); paintList(); paintCart(); }
    if (!l) return;
    wrap.querySelector(".to-tileedit-overlay")?.remove();
    const chips = () => ALLERGENS.map((a) => `<span class="chip to-alg-chip ${l.avoid.has(a.slug) ? "on" : ""}" data-alg="${a.slug}">${esc(a.label)}</span>`).join("");
    const ov = el(`<div class="to-tileedit-overlay"><div class="to-tileedit">
      <div class="to-te-head"><b>${esc(l.title)}</b><button class="to-te-x" aria-label="Done">✕</button></div>
      <div class="to-lbl">⚠ Avoid in this dish</div><div class="to-alg to-te-alg">${chips()}</div>
      <input class="to-line-note to-te-note" maxlength="120" placeholder="Note for this dish (e.g. extra spicy)" value="${esc(l.note)}">
      <button class="btn primary to-te-done">Done</button>
    </div></div>`);
    wrap.querySelector(".to-modal").appendChild(ov);
    const done = () => { ov.remove(); dedupe(); paintCart(); paintList(); };
    ov.querySelector(".to-te-x").onclick = done;
    ov.querySelector(".to-te-done").onclick = done;
    ov.onclick = (e) => { if (e.target === ov) done(); };
    ov.querySelectorAll(".to-alg-chip").forEach((chip) => (chip.onclick = () => { const s = chip.dataset.alg; l.avoid.has(s) ? l.avoid.delete(s) : l.avoid.add(s); chip.classList.toggle("on", l.avoid.has(s)); }));
    ov.querySelector(".to-te-note").oninput = (e) => { l.note = e.target.value; };
  }
  function bindCart() {
    linesEl.querySelectorAll("[data-linc]").forEach((b) => (b.onclick = () => { incUid(+b.dataset.linc); paintList(); paintCart(); }));
    linesEl.querySelectorAll("[data-ldec]").forEach((b) => (b.onclick = () => { decUid(+b.dataset.ldec); paintList(); paintCart(); }));
    linesEl.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { const uid = +b.dataset.rm; const i = cart.findIndex((c) => c.uid === uid); if (i >= 0) { editing.delete(uid); cart.splice(i, 1); } paintList(); paintCart(); }));
    // Closing a line's editor de-dupes (in case its allergy/note now matches another line).
    linesEl.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => { const uid = +b.dataset.edit; if (editing.has(uid)) { editing.delete(uid); dedupe(); } else editing.add(uid); paintList(); paintCart(); }));
    // per-dish allergen chips + per-dish note (no de-dupe mid-edit so lines don't collapse under you)
    linesEl.querySelectorAll('.to-alg-chip[data-kind="line"]').forEach((chip) => (chip.onclick = () => { const l = byUid(+chip.dataset.line); if (!l) return; const s = chip.dataset.alg; l.avoid.has(s) ? l.avoid.delete(s) : l.avoid.add(s); paintList(); paintCart(); }));
    linesEl.querySelectorAll(".to-line-note").forEach((inp) => (inp.oninput = () => { const l = byUid(+inp.dataset.line); if (l) l.note = inp.value; }));
  }

  // ── Category scroll-spy: the strip's active chip follows the list scroll, and tapping
  //    a chip jumps to that section — exactly like the guest menu / tablet. ──
  const jumpTo = (slug) => { const sec = listEl.querySelector(`.to-sec[data-sec="${CSS.escape(slug)}"]`); if (sec) listEl.scrollTo({ top: sec.offsetTop - listEl.offsetTop - 4, behavior: "smooth" }); };
  const syncSpy = () => {
    const secs = [...listEl.querySelectorAll(".to-sec")];
    if (!secs.length) return; // searching (flat list) — no spy
    const top = listEl.scrollTop + 8;
    let active = secs[0].dataset.sec;
    for (const s of secs) { if (s.offsetTop - listEl.offsetTop <= top) active = s.dataset.sec; }
    catsEl.querySelectorAll("[data-jump]").forEach((b) => {
      const on = b.dataset.jump === active; b.classList.toggle("on", on);
      // Centre the active chip by nudging the strip's OWN horizontal scroll only —
      // never scrollIntoView (it scrolls a vertical ancestor and hides the strip).
      if (on) { const cr = catsEl.getBoundingClientRect(), br = b.getBoundingClientRect(); catsEl.scrollBy({ left: (br.left + br.width / 2) - (cr.left + cr.width / 2), behavior: "smooth" }); }
    });
  };
  catsEl.querySelectorAll("[data-jump]").forEach((b) => (b.onclick = () => jumpTo(b.dataset.jump)));
  listEl.addEventListener("scroll", () => { window.requestAnimationFrame(syncSpy); }, { passive: true });

  bindList(); bindCart();
  const search = wrap.querySelector(".to-search");
  search.oninput = () => { q = search.value; paintList(); };
  wrap.querySelector(".to-note").oninput = (e) => { orderNote = e.target.value; };
  wrap.querySelectorAll('.to-alg-chip[data-kind="order"]').forEach((chip) => (chip.onclick = () => {
    const s = chip.dataset.alg; orderAvoid.has(s) ? orderAvoid.delete(s) : orderAvoid.add(s);
    chip.classList.toggle("on", orderAvoid.has(s));
  }));
  wrap.querySelector(".tbl-modal-close").onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };

  async function send(confirmDuplicate = false, payMode = null) {
    dedupe();
    if (!cart.length) { toast("Add at least one dish first", "err"); return; }
    // Per-dish avoid + note ride in each item's note (no server change): "⚠ no X, Y · note".
    const items = cart.map((c) => {
      const parts = [c.avoid.size ? `⚠ no ${[...c.avoid].join(", ")}` : "", (c.note || "").trim()].filter(Boolean);
      return { id: c.id, qty: c.qty, note: parts.join(" · ") || undefined };
    });
    const allergies = [...orderAvoid];

    // ── Parcel: a no-table TAKEAWAY order → /parcel (lands in the Platform board). ──
    if (parcel) {
      const payNow = payMode === "now";
      if (!(await confirmDialog(payNow ? "Take payment now and send this parcel to the kitchen?" : "Send this parcel to the kitchen (pay on pickup)?", payNow ? "Pay & send" : "Send"))) return;
      sendBtns.forEach((b) => (b.disabled = true));
      try {
        const r = await api("POST", "/parcel", { items, allergies, note: orderNote || null, customer: custName || null, phone: custPhone || null, paid: payNow, method: payNow ? "cash" : null });
        if (r && r.queued) { toast("Saved ✓ — the parcel will send when you're back online.", "ok"); close(); return; }
        toast(r && r.kot_no != null ? `Parcel sent! Ticket #${r.kot_no}${payNow ? " · paid" : " · pay on pickup"}` : "Parcel sent to the kitchen", "ok");
        // "Pay now & print" → a customer receipt for the counter printer (pay-on-pickup doesn't).
        if (payNow) { try { printParcelReceipt({ kot: r && r.kot_no, items: cart.map((c) => ({ title: c.title, qty: c.qty, price: c.price })), total: cart.reduce((s, c) => s + (parseFloat(c.price) || 0) * c.qty, 0), customer: custName, method: "cash", paid: true }); } catch {} }
        close();
        try { loadPlatform(); } catch {}
        if (rerender) rerender();
      } catch (e) {
        sendBtns.forEach((b) => (b.disabled = false));
        toast("Couldn't send: " + ((e && e.message) || e), "err");
      }
      return;
    }

    if (!confirmDuplicate && !(await confirmDialog(`Send this order for Table ${table} to the kitchen?`, "Yes, send it"))) return;
    sendBtns.forEach((b) => (b.disabled = true));
    try {
      const r = await api("POST", "/order", { table: String(table), items, allergies, note: orderNote || null, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) });
      if (r && r.queued) { toast("Saved ✓ — it'll send to the kitchen when you're back online.", "ok"); close(); await loadSessions(); if (rerender) rerender(); return; }
      toast(r && r.kot_no != null ? `Sent! Kitchen ticket #${r.kot_no}` : "Order sent to the kitchen", "ok");
      close(); await loadSessions(); if (rerender) rerender();
    } catch (e) {
      sendBtns.forEach((b) => (b.disabled = false));
      if (e && e.status === 409 && e.data && e.data.duplicateWarning) {
        if (await confirmDialog("This looks identical to an order you just sent. Send it anyway?", "Send anyway")) return send(true);
        return;
      }
      toast("Couldn't send: " + e.message, "err");
    }
  }
  sendBtns.forEach((b) => (b.onclick = () => send(false, b.dataset.pay || null)));
  syncSpy();
  search.focus();
}

// Shift-table PICKER — mirrors the tablet's nice modal (was a bare prompt() here):
// a grid of the FREE tables to move this party (orders + calls + bill) onto. Only
// free tables show, so you can't pick an occupied one. (owner, 2026-06-18)
function openShiftPicker(t, sess) {
  document.querySelector(".shift-overlay")?.remove();
  const n = Math.max(1, parseInt((state.data.settings || {}).table_count, 10) || 12);
  const free = [];
  // "Free to move to" = not THIS table, not currently open, AND with no pending "wants in"
  // request (summaryTableOpen treats a request-only table as not-open, so without this a shift
  // could land on a table a guest is waiting to open, stranding their request).
  const reqTables = new Set((state.summary && state.summary.requests || []).map((r) => String(r.table_number)));
  for (let i = 1; i <= n; i++) { if (String(i) !== String(t) && !summaryTableOpen(i) && !reqTables.has(String(i))) free.push(i); }
  const grid = free.length
    ? free.map((i) => `<button class="btn shiftpick" data-shiftto="${i}">Table ${i}</button>`).join("")
    : `<div class="muted" style="padding:14px">No free tables to move to right now.</div>`;
  const wrap = el(`<div class="sx-modal-overlay shift-overlay"><div class="sx-modal shift-modal"><div class="tbl-modal-head"><div class="tp-detail-top"><h3>Move Table ${esc(t)} →</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div><div class="muted small" style="padding:0 14px 10px">Move this party — orders, calls &amp; bill included — to a free table:</div><div class="shiftgrid">${grid}</div></div></div>`);
  document.body.appendChild(wrap);
  const closeM = () => wrap.remove();
  wrap.querySelector(".tbl-modal-close").onclick = closeM;
  wrap.onclick = (e) => { if (e.target === wrap) closeM(); };
  wrap.querySelectorAll("[data-shiftto]").forEach((b) => (b.onclick = async () => {
    const to = b.dataset.shiftto; closeM();
    try {
      const r = await api("POST", `/sessions/${sess.id}/shift`, { to });
      if (!r.ok) { toast(r.reason === "target_occupied" ? `Table ${to} already has a party` : "Couldn't shift: " + (r.reason || ""), "err"); return; }
      toast(`Shifted to table ${to}`, "ok");
      followShiftedTable(t, to); // follow the party to its new home in docked OR popup mode
    } catch (e) { toast("Failed: " + e.message, "err"); }
  }));
}

// ── KOT ▾ — Table & KOT operations (PetPooja-style unified menu; owner 2026-07-22) ──
// ONE menu on the table detail for every table/bill operation. Ladder-gated (mig 172):
// admin depth knob → owner grants manager → (tablet has its own rung). Ops arrive in
// phases — the menu lists only what's built, so it grows without UI rework.
// Whether to render the KOT ▾ menu for THIS viewer — the ADMIN X-RAY rule (owner,
// 2026-07-22): from the admin console EVERY feature renders, greyed (xray-off tint via
// XRAY_CONTROLS) when it's not actually on for the real staff, and it genuinely works
// when the admin taps it (the server's tableOpsGate lets the admin super-user through).
// Everyone else follows the ladder: the MODULE must be effective (whoami
// features.table_ops — admin switch AND, when transferred, the owner's toggle); a real
// manager additionally needs the owner's table_ops grant (effectivePowers), while the
// OWNER's higherView sees it tinted when the manager grant is off. Before whoami
// resolves we render the plain Shift fallback — never a button that would 403.
function tableOpsOn() {
  const w = XRAY_WHO;
  if (!w) return false;
  if (w.actor === "admin") return true; // admin view: always visible, tinted when off-for-staff
  if (!(w.features && w.features.table_ops)) return false; // module off: gone for owner + manager
  return w.higherView ? true : !!(w.effectivePowers && w.effectivePowers.table_ops);
}

// One-time styles for the KOT action sheet + its pickers — a proper PetPooja-grade
// surface, not bare buttons (owner design feedback, 2026-07-22). Uses the panel's own
// CSS variables so it follows the theme.
(function injectKotMenuStyles() {
  const css = `
  .kotm-sheet { max-width: 460px; }
  .kotm-head { padding: 16px 18px 10px; }
  .kotm-title { display:flex; align-items:center; gap:10px; }
  .kotm-title h3 { margin:0; font-size:17px; }
  .kotm-bill { color: var(--muted); font-size:12.5px; margin-top:3px; }
  .kotm-list { padding: 6px 12px 14px; }
  .kotm-row { display:flex; align-items:center; gap:13px; width:100%; text-align:left;
    background: var(--panel-2); border:1px solid var(--line); border-radius:12px;
    padding:14px 16px; margin:0 0 9px; cursor:pointer; font:inherit; color:inherit;
    transition: transform .06s, border-color .12s, background .12s; }
  .kotm-row:hover:not(:disabled) { border-color: var(--gold); background: color-mix(in srgb, var(--gold) 6%, var(--panel-2)); }
  .kotm-row:active:not(:disabled) { transform: scale(.985); }
  .kotm-row:disabled { opacity:.45; cursor:default; }
  .kotm-ico { width:46px; height:46px; border-radius:11px; flex:none; display:flex; align-items:center;
    justify-content:center; font-size:19px; background: color-mix(in srgb, var(--gold) 13%, transparent);
    border:1px solid color-mix(in srgb, var(--gold) 30%, transparent); }
  .kotm-txt b { font-size:15.5px; display:block; }
  .kotm-txt small { color: var(--muted); font-size:12.5px; line-height:1.35; display:block; margin-top:1px; }
  .kotm-chev { margin-left:auto; color: var(--muted); font-size:15px; flex:none; }
  .kotm-off-why { font-size:10.5px; color: var(--muted); border:1px solid var(--line);
    border-radius:999px; padding:2px 8px; margin-left:auto; flex:none; }
  .tp-kot-head { font-weight:700; }
  .kotm-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(88px,1fr)); gap:8px; padding:4px 0 6px; }
  .kotm-tile { border:1px solid var(--line); border-radius:12px; background:var(--panel-2);
    padding:10px 6px; text-align:center; cursor:pointer; font:inherit; color:inherit; }
  .kotm-tile b { display:block; font-size:15px; }
  .kotm-tile small { display:block; color:var(--muted); font-size:10.5px; margin-top:2px; }
  .kotm-tile.occ { border-color: color-mix(in srgb, var(--gold) 45%, transparent);
    background: color-mix(in srgb, var(--gold) 8%, var(--panel-2)); }
  .kotm-tile:hover { border-color: var(--gold); }
  /* Miller columns (desktop, owner 2026-07-23): panels sit SIDE BY SIDE like the Mac
     Finder's column view — the card grows a column per step, selections stay lit. */
  .kotm-colwrap { max-width: min(96vw, 1080px); width: fit-content; }
  .kotm-head { display: block; }
  .kotm-cols { display: flex; align-items: stretch; padding: 6px 8px 14px; }
  .kotm-col { width: 360px; flex: none; padding: 6px 10px; overflow-y: auto;
    max-height: min(64vh, 560px); border-right: 1px solid var(--line);
    animation: kotmColIn .16s ease-out; }
  .kotm-col:last-child { border-right: 0; }
  .kotm-col .kotm-grid { grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); }
  .kotm-col-title { font-size: 12px; font-weight: 700; color: var(--muted);
    text-transform: uppercase; letter-spacing: .03em; margin: 4px 2px 10px; }
  .kotm-row.sel { border-color: var(--gold);
    background: color-mix(in srgb, var(--gold) 14%, var(--panel-2)); }
  .kotm-row.sel .kotm-chev { color: var(--gold); font-weight: 800; }
  @keyframes kotmColIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }`;
  const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
})();

// ── MILLER COLUMNS (owner design pattern, 2026-07-23 — "like the Mac Finder") ──
// On a DESKTOP the KOT flows drill ACROSS, not back-and-forth: panel 1 = the
// operations, panel 2 = what to move (KOT / dish / target for 2-step ops), panel 3 =
// where to move it. Each selection stays highlighted so the whole path reads at a
// glance. Phones keep the step-by-step sheets (openKotMenu below). This is the
// STANDING pattern for every future multi-step popup on desktop.
// What each KOT operation actually does — shown as the hover tooltip on its row.
const KOT_TIPS = {"shift": "Moves this whole party — every order, waiter call and the bill — onto an empty table. The old table frees up instantly and the guests' phones follow automatically.", "merge": "Joins this party with another table's party: everything combines into ONE bill on the other table (discounts add up too). Use it when two groups decide to sit together.", "movekot": "Sends ONE order (one kitchen ticket) to another table's bill — for when a single order was punched on the wrong table. Both bills recalculate themselves.", "moveitem": "Sends a single dish to another table. It gets its own new kitchen ticket there, and both bills re-price automatically. A 2-plate line moves both plates.", "split": "Collect one bill as several payments: equal shares, custom amounts, or assign dishes per person. The shares must add up to the bill — the system checks.", "reprint": "Prints an order's kitchen ticket again on the thermal printer — for a lost or unreadable ticket. Nothing changes on the bill."};

// ── HOVER TOOLTIPS (owner, 2026-07-23): hovering ANY button that carries a title/
// data-tip shows a styled bubble describing what it does ("how it works"). One host
// element + document-level delegation, so every current AND future button is covered
// with zero per-feature wiring — give a button a `title` and it just works.
(function tipEngine() {
  const HOLD_MS = 2000; // owner 2026-07-23: only show after the pointer rests ~2s (no flicker while sweeping)
  const host = document.createElement("div");
  host.className = "lfh-tip";
  document.body.appendChild(host);
  let cur = null, timer = null;
  const hide = () => { cur = null; if (timer) { clearTimeout(timer); timer = null; } host.classList.remove("on"); };
  const showFor = (el) => {
    const r = el.getBoundingClientRect();
    host.textContent = el.dataset.tip;
    host.classList.add("on");
    const w = host.offsetWidth, h = host.offsetHeight;
    host.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
    host.style.top = (r.top - h - 9 > 6 ? r.top - h - 9 : r.bottom + 9) + "px";
  };
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest && e.target.closest("[data-tip], button[title], .btn[title]");
    if (el === cur) return;
    // Moving to a different (or no) target: drop the running timer + any shown bubble.
    if (timer) { clearTimeout(timer); timer = null; }
    host.classList.remove("on");
    cur = el || null;
    if (!el) return;
    // Migrate a native title to data-tip once so the browser's own tooltip never doubles up.
    if (!el.dataset.tip && el.title) { el.dataset.tip = el.title; el.removeAttribute("title"); }
    if (!el.dataset.tip) { cur = null; return; }
    // Only reveal once the pointer has RESTED on this element for HOLD_MS (a stable hover).
    timer = setTimeout(() => { if (cur === el) showFor(el); }, HOLD_MS);
  });
  document.addEventListener("mouseout", (e) => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el && el === cur) hide(); });
  document.addEventListener("scroll", hide, true);
  document.addEventListener("click", hide, true);
})();

function openKotColumns(t, sess) {
  document.querySelector(".kotmenu-overlay")?.remove();
  const movable = ordersForTable(t).filter((o) => o.status !== "cancelled" && o.payment_status !== "paid");
  const n = Math.max(1, parseInt((state.data.settings || {}).table_count, 10) || 12);
  let occupiedOthers = 0;
  for (let i = 1; i <= n; i++) if (String(i) !== String(t) && summaryTableOpen(i)) occupiedOthers++;
  const bill = billMath(movable.filter((o) => o.status !== "received"));
  const OPS = [
    { id: "shift", icon: "⇄", label: "Change table", sub: "To a free table", on: !!sess, why: "table closed" },
    { id: "merge", icon: "🪢", label: "Merge tables", sub: "One table, one bill", on: !!sess && occupiedOthers > 0, why: occupiedOthers ? "table closed" : "no other open table" },
    { id: "movekot", icon: "🧾", label: "Move a KOT", sub: "One order moves", on: movable.length > 0, why: "no movable KOT" },
    { id: "moveitem", icon: "🍛", label: "Move a single dish", sub: "One dish moves", on: movable.some((o) => orderItemRows(o).some((r) => r.kind === "session")), why: "no movable dish" },
    { id: "split", icon: "🍴", label: "Split the bill", sub: "Equal · custom · by dish", on: movable.some((o) => o.status !== "received"), why: "nothing settleable" },
    { id: "reprint", icon: "🖨️", label: "Reprint a KOT", sub: "Kitchen ticket again", on: ordersForTable(t).some((o) => o.status !== "cancelled"), why: "no KOTs" },
  ];
  let sel1 = null, sel2 = null; // op id · chosen KOT/dish id
  const wrap = el(`<div class="sx-modal-overlay kotmenu-overlay"><div class="sx-modal kotm-colwrap">
    <div class="tbl-modal-head kotm-head"><div class="tp-detail-top"><div class="kotm-title"><h3>🧾 Table ${esc(t)}</h3></div><button class="tbl-modal-close" aria-label="Close">✕</button></div>
    <div class="kotm-bill">KOT &amp; table operations${bill.total > 0 ? ` · bill due ${inr(bill.total)}` : ""}${sess && sess.bill_no != null ? ` · bill #${esc(sess.bill_no)}` : ""}</div></div>
    <div class="kotm-cols"></div></div></div>`);
  document.body.appendChild(wrap);
  const closeM = () => wrap.remove();
  wrap.querySelector(".tbl-modal-close").onclick = closeM;
  wrap.onclick = (e) => { if (e.target === wrap) closeM(); };
  const colsEl = wrap.querySelector(".kotm-cols");

  const done = (msg) => { closeM(); toast(msg, "ok"); };
  const fail = (m) => toast(m, "err");
  const run = async (method, path, body, okMsg, after) => {
    try {
      const r = await api(method, path, body);
      if (r && r.ok === false) { fail("Couldn't do that: " + (r.reason || "rejected")); return; }
      done(okMsg); if (after) after(r);
    } catch (e) { fail("Failed: " + e.message); }
  };

  // Tile grids per purpose. `mark` = the currently-selected tile (kept highlighted).
  const tiles = (list, attr, subOf) => `<div class="kotm-grid">` +
    list.map((i) => `<button class="kotm-tile${summaryTableOpen(i) ? " occ" : ""}" data-${attr}="${i}"><b>T${i}</b><small>${subOf(i)}</small></button>`).join("") + `</div>`;
  const freeTables = () => { const reqT = new Set((state.summary && state.summary.requests || []).map((r) => String(r.table_number))); const out = []; for (let i = 1; i <= n; i++) if (String(i) !== String(t) && !summaryTableOpen(i) && !reqT.has(String(i))) out.push(i); return out; };
  const occTables = () => { const out = []; for (let i = 1; i <= n; i++) if (String(i) !== String(t) && summaryTableOpen(i)) out.push(i); return out; };
  const allTables = () => { const out = []; for (let i = 1; i <= n; i++) if (String(i) !== String(t)) out.push(i); return out; };
  const tileDue = (i) => { const tile = (state.summary && state.summary.tiles || {})[String(i)]; return tile && tile.due > 0 ? "due " + inr(tile.due) : "open"; };
  const kotCard = (o, attr) => { const nd = orderItemRows(o).reduce((s2, r) => s2 + (parseInt(r.qty, 10) || 1), 0); return `<button class="kotm-row${sel2 === o.id ? " sel" : ""}" data-${attr}="${esc(o.id)}"><span class="kotm-txt"><b>KOT #${o.kot_no != null ? esc(o.kot_no) : "—"}</b><small>${nd} dish${nd === 1 ? "" : "es"} · ${inr(parseFloat(o.total) || 0)}</small></span><span class="kotm-chev">›</span></button>`; };

  // What panel 2 shows per operation; ops with a 3rd step mark their picks sel-able.
  const col2 = () => {
    if (sel1 === "shift") return { title: "Move to which free table?", html: freeTables().length ? tiles(freeTables(), "goshift", () => "free") : `<div class="muted" style="padding:10px">No free tables right now.</div>` };
    if (sel1 === "merge") return { title: "Join which table's party?", html: tiles(occTables(), "gomerge", tileDue) };
    if (sel1 === "movekot") return { title: "Which KOT moves?", html: movable.map((o) => kotCard(o, "pickkot")).join("") };
    if (sel1 === "moveitem") {
      const groups = movable.map((o) => {
        const items = orderItemRows(o).filter((r) => r.kind === "session");
        if (!items.length) return "";
        return `<div class="muted" style="font-size:11px;margin:6px 2px 4px">KOT #${o.kot_no != null ? esc(o.kot_no) : "—"}</div>` +
          items.map((r) => `<button class="kotm-row${sel2 === r.id ? " sel" : ""}" data-pickitem="${esc(r.id)}"><span class="kotm-txt"><b>${r.qty > 1 ? r.qty + "× " : ""}${esc(r.title)}</b><small>${inr(r.price * (r.qty || 1))}</small></span><span class="kotm-chev">›</span></button>`).join("");
      }).join("");
      return { title: "Which dish moves? (a multi-plate line moves whole)", html: groups };
    }
    if (sel1 === "reprint") return { title: "Reprint which KOT?", html: ordersForTable(t).filter((o) => o.status !== "cancelled").map((o) => kotCard(o, "goprint")).join("") };
    return null;
  };
  const col3 = () => {
    if (sel1 === "movekot" && sel2) return { title: "Send that KOT to which table?", html: tiles(allTables(), "gokot", (i) => (summaryTableOpen(i) ? "joins bill" : "free")) };
    if (sel1 === "moveitem" && sel2) return { title: "Send that dish to which table? (new KOT there)", html: tiles(allTables(), "goitem", (i) => (summaryTableOpen(i) ? "joins bill" : "free")) };
    return null;
  };

  const render = () => {
    const c2 = sel1 ? col2() : null;
    const c3 = col3();
    colsEl.innerHTML =
      `<div class="kotm-col">` + OPS.map((r) => `<button class="kotm-row${sel1 === r.id ? " sel" : ""}" data-op="${r.id}" data-tip="${esc(KOT_TIPS[r.id] || "")}" ${r.on ? "" : "disabled"}>
        <span class="kotm-ico">${r.icon}</span><span class="kotm-txt"><b>${r.label}</b><small>${r.sub}</small></span>
        ${r.on ? `<span class="kotm-chev">›</span>` : `<span class="kotm-off-why">${r.why}</span>`}</button>`).join("") + `</div>` +
      (c2 ? `<div class="kotm-col"><div class="kotm-col-title">${c2.title}</div>${c2.html}</div>` : "") +
      (c3 ? `<div class="kotm-col"><div class="kotm-col-title">${c3.title}</div>${c3.html}</div>` : "");
    // panel 1: pick an operation (split hands over to its form — it's a form, not a drill-down)
    colsEl.querySelectorAll("[data-op]").forEach((b) => (b.onclick = () => {
      const op = b.dataset.op;
      if (op === "split") { closeM(); openSplitSettle(t); return; }
      sel1 = op; sel2 = null; render();
    }));
    // panel 2 executors / selectors
    colsEl.querySelectorAll("[data-goshift]").forEach((b) => (b.onclick = () => {
      const to = b.dataset.goshift;
      run("POST", `/sessions/${sess.id}/shift`, { to }, `Shifted to table ${to}`, () => followShiftedTable(t, to));
    }));
    colsEl.querySelectorAll("[data-gomerge]").forEach((b) => (b.onclick = async () => {
      const to = b.dataset.gomerge;
      if (!(await confirmDialog(`Merge Table ${t} into Table ${to}? Both parties become ONE bill on Table ${to}.`, "Merge"))) return;
      run("POST", `/sessions/${sess.id}/merge`, { to }, `Merged into table ${to} — one bill`, () => followShiftedTable(t, to));
    }));
    colsEl.querySelectorAll("[data-pickkot]").forEach((b) => (b.onclick = () => { sel2 = b.dataset.pickkot; render(); }));
    colsEl.querySelectorAll("[data-pickitem]").forEach((b) => (b.onclick = () => { sel2 = b.dataset.pickitem; render(); }));
    colsEl.querySelectorAll("[data-goprint]").forEach((b) => (b.onclick = () => {
      const o = ordersForTable(t).find((x) => x.id === b.dataset.goprint);
      if (o) { printKotTicket(o); done(`KOT #${o.kot_no ?? "—"} sent to print`); }
    }));
    // panel 3 executors
    colsEl.querySelectorAll("[data-gokot]").forEach((b) => (b.onclick = () => run("POST", `/orders/${sel2}/move`, { to: b.dataset.gokot }, `KOT moved to table ${b.dataset.gokot}`)));
    colsEl.querySelectorAll("[data-goitem]").forEach((b) => (b.onclick = () => run("POST", `/order-items/${sel2}/move`, { to: b.dataset.goitem }, `Dish moved to table ${b.dataset.goitem} (new KOT)`)));
  };
  render();
}

function openKotMenu(t, sess) {
  // Desktop → the Finder-style Miller columns above; phone keeps the step sheets.
  if (!isPhoneLayout()) return openKotColumns(t, sess);
  document.querySelector(".kotmenu-overlay")?.remove();
  // Movable KOTs = this table's orders that aren't paid or cancelled (same rule the
  // server's RPC enforces — the row is disabled rather than surprising with a 409).
  const movable = ordersForTable(t).filter((o) => o.status !== "cancelled" && o.payment_status !== "paid");
  // Other OPEN tables (a merge target must already have a party).
  const nAll = Math.max(1, parseInt((state.data.settings || {}).table_count, 10) || 12);
  let occupiedOthers = 0;
  for (let i = 1; i <= nAll; i++) if (String(i) !== String(t) && summaryTableOpen(i)) occupiedOthers++;
  const bill = billMath(movable.filter((o) => o.status !== "received"));
  const rows = [
    { id: "shift", icon: "⇄", label: "Change table", sub: "Party, orders & bill move to a free table", on: !!sess, why: "table closed" },
    { id: "merge", icon: "🪢", label: "Merge tables", sub: "Join another party — one table, one bill", on: !!sess && occupiedOthers > 0, why: occupiedOthers ? "table closed" : "no other open table" },
    { id: "movekot", icon: "🧾", label: "Move a KOT", sub: "Send one order to another table's bill", on: movable.length > 0, why: "no movable KOT" },
    // Only DB-backed dish rows (kind "session") can move — legacy JSON lines have no row id.
    { id: "moveitem", icon: "🍛", label: "Move a single dish", sub: "One dish moves — it gets its own new KOT there", on: movable.some((o) => orderItemRows(o).some((r) => r.kind === "session")), why: "no movable dish" },
    { id: "split", icon: "🍴", label: "Split the bill", sub: "Equal · custom amounts · by dish", on: movable.some((o) => o.status !== "received"), why: "nothing settleable" },
    { id: "reprint", icon: "🖨️", label: "Reprint a KOT", sub: "Print an order's kitchen ticket again", on: ordersForTable(t).some((o) => o.status !== "cancelled"), why: "no KOTs" },
  ];
  const rowHtml = (r) => `<button class="kotm-row" data-kotop="${r.id}" data-tip="${esc(KOT_TIPS[r.id] || "")}" ${r.on ? "" : "disabled"}>
    <span class="kotm-ico">${r.icon}</span>
    <span class="kotm-txt"><b>${r.label}</b><small>${r.sub}</small></span>
    ${r.on ? `<span class="kotm-chev">›</span>` : `<span class="kotm-off-why">${r.why}</span>`}</button>`;
  const wrap = el(`<div class="sx-modal-overlay kotmenu-overlay"><div class="sx-modal kotm-sheet">
    <div class="tbl-modal-head kotm-head"><div class="tp-detail-top"><div class="kotm-title"><h3>🧾 Table ${esc(t)}</h3></div><button class="tbl-modal-close" aria-label="Close">✕</button></div>
    <div class="kotm-bill">KOT &amp; table operations${bill.total > 0 ? ` · bill due ${inr(bill.total)}` : ""}${sess && sess.bill_no != null ? ` · bill #${esc(sess.bill_no)}` : ""}</div></div>
    <div class="kotm-list">${rows.map(rowHtml).join("")}</div></div></div>`);
  document.body.appendChild(wrap);
  const closeM = () => wrap.remove();
  wrap.querySelector(".tbl-modal-close").onclick = closeM;
  wrap.onclick = (e) => { if (e.target === wrap) closeM(); };
  wrap.querySelectorAll("[data-kotop]").forEach((b) => (b.onclick = () => {
    const op = b.dataset.kotop; closeM();
    if (op === "shift" && sess) openShiftPicker(t, sess);
    if (op === "merge" && sess) openMergePicker(t, sess);
    if (op === "movekot") openMoveKotPicker(t);
    if (op === "moveitem") openMoveItemPicker(t);
    if (op === "split") openSplitSettle(t);
    if (op === "reprint") openReprintKotPicker(t);
  }));
}

// Reprint ONE order's kitchen ticket — same 66mm thermal template the kitchen's
// auto-print uses (validated through the real CUPS/ESC-POS chain 2026-07-21; keep the
// two in sync if the recipe ever changes). Local print only — no network, no state.
function printKotTicket(o) {
  try {
    const rname = (state.data.restaurant || {}).name || "Kitchen";
    const kot = o.kot_no != null ? o.kot_no : "—";
    const when = o.created_at ? new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    const rows = orderItemRows(o);
    const linesHtml = rows.map((r) => {
      const opts = Array.isArray(r.options) ? r.options.map((x) => (typeof x === "string" ? x : (x && x.label) || "")).filter(Boolean).join(", ") : "";
      const rem = Array.isArray(r.removed) ? r.removed.filter(Boolean).join(", ") : "";
      return `<div class="kl"><span class="q">${r.qty || 1}×</span><span class="n">${esc(r.title || "")}${opts ? ` <i>(${esc(opts)})</i>` : ""}${rem ? ` <i>— no ${esc(rem)}</i>` : ""}${r.note ? `<br><small>&raquo; ${esc(r.note)}</small>` : ""}</span></div>`;
    }).join("");
    const allerg = Array.isArray(o.allergies) && o.allergies.length ? `<div class="al">⚠ AVOID: ${esc(o.allergies.join(", "))}</div>` : "";
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>KOT ${esc(String(kot))}</title><style>
      *{margin:0;padding:0;box-sizing:border-box}body{font-family:ui-monospace,monospace;width:280px;padding:8px;color:#000}
      .h{text-align:center;font-weight:700;font-size:15px;border-bottom:2px dashed #000;padding-bottom:6px;margin-bottom:6px}
      .meta{display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:4px}
      .kl{font-size:14px;padding:4px 0;border-bottom:1px dotted #999}.kl .q{font-weight:700;margin-right:6px}.kl i{font-style:italic;color:#333;font-size:12px}
      .al{margin-top:8px;font-weight:700;font-size:13px;border:1px solid #000;padding:4px}
      @page{margin:0}
      @media print{body{margin:0 !important;padding:2mm 5mm 4mm !important}.kl,.meta,.al{break-inside:avoid;page-break-inside:avoid}}
    </style></head><body>
      <div class="h">${esc(rname)}<br>KITCHEN TICKET · REPRINT</div>
      <div class="meta"><span>KOT #${esc(String(kot))}</span><span>Table ${esc(String(o.table_number ?? "?"))}</span></div>
      <div class="meta"><span>${esc(when)}</span></div>
      ${linesHtml || "<div>(no items)</div>"}
      ${allerg}
    </body></html>`;
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
      try { w.focus(); w.print(); } catch (e) {}
      setTimeout(cleanup, 60000);
    }, 250);
  } catch (e) { /* printing must NEVER break the panel */ }
}
function openReprintKotPicker(t) {
  document.querySelector(".reprint-overlay")?.remove();
  const os = ordersForTable(t).filter((o) => o.status !== "cancelled");
  if (!os.length) { toast("No KOTs on this table", "err"); return; }
  const rowsH = os.map((o) => {
    const nd = orderItemRows(o).reduce((s, r) => s + (parseInt(r.qty, 10) || 1), 0);
    return `<button class="btn" data-reprint="${esc(o.id)}" style="display:flex;justify-content:space-between;width:100%;margin:0 0 8px;padding:11px 14px"><span><b>KOT #${o.kot_no != null ? esc(o.kot_no) : "—"}</b> · ${nd} dish${nd === 1 ? "" : "es"}</span><span>🖨️</span></button>`;
  }).join("");
  const wrap = el(`<div class="sx-modal-overlay reprint-overlay"><div class="sx-modal" style="max-width:420px">
    <div class="tbl-modal-head"><div class="tp-detail-top"><h3>🖨️ Reprint a KOT — Table ${esc(t)}</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div>
    <div class="dish-edit-body" style="padding:10px 14px 14px">${rowsH}</div></div></div>`);
  document.body.appendChild(wrap);
  const closeM = () => wrap.remove();
  wrap.querySelector(".tbl-modal-close").onclick = closeM;
  wrap.onclick = (e) => { if (e.target === wrap) closeM(); };
  wrap.querySelectorAll("[data-reprint]").forEach((b) => (b.onclick = () => {
    const o = os.find((x) => x.id === b.dataset.reprint);
    closeM();
    if (o) { printKotTicket(o); toast(`KOT #${o.kot_no ?? "—"} sent to print`, "ok"); }
  }));
}

// SPLIT-SETTLE (mig 176) — collect ONE bill as several payment legs. Three ways to cut
// it: equal N-way, custom amounts, or by dish (assign each dish line to a person; each
// person's share scales to the real due, so tax + discount split proportionally). The
// server re-computes the due and refuses shares that don't add up — this UI can't
// under- or over-collect. Replaces the old share CALCULATOR when the KOT ladder is on.
function openSplitSettle(t) {
  document.querySelector(".splitsettle-overlay")?.remove();
  const payable = ordersForTable(t).filter((o) => o.status !== "cancelled" && o.payment_status !== "paid" && o.status !== "received");
  if (!payable.length) { toast("Nothing to split — accept the order first, or it's already paid.", "err"); return; }
  const due = billMath(payable).total;
  const METHODS = ["UPI", "Cash", "Card", "Other"];
  let mode = "equal", n = 2;
  // By-dish state: every dish line (qty-priced) starts on person 1; tapping cycles 1→2→…→N.
  const dishes = [];
  payable.forEach((o) => orderItemRows(o).forEach((r) => dishes.push({ title: r.title, amt: (Number(r.price) || 0) * (r.qty || 1), qty: r.qty || 1, person: 1 })));
  const dishSubtotal = dishes.reduce((s, d) => s + d.amt, 0) || 1;
  const methodSel = (i, v) => `<select class="ss-method" data-leg="${i}" style="padding:8px;border-radius:8px">${METHODS.map((m) => `<option${m === (v || "Cash") ? " selected" : ""}>${m}</option>`).join("")}</select>`;
  const wrap = el(`<div class="sx-modal-overlay splitsettle-overlay"><div class="sx-modal" style="max-width:460px">
    <div class="tbl-modal-head"><div class="tp-detail-top"><h3>🍴 Split Table ${esc(t)}'s bill · ${inr(due)}</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div>
    <div class="dish-edit-body" style="padding:12px 14px 14px">
      <div class="ss-tabs" style="display:flex;gap:6px;margin-bottom:10px">
        <button class="btn ss-tab" data-mode="equal">Equal</button>
        <button class="btn ss-tab" data-mode="custom">Custom</button>
        <button class="btn ss-tab" data-mode="dish">By dish</button>
      </div>
      <div class="ss-body"></div>
      <div class="ss-sum muted small" style="margin:10px 0 8px"></div>
      <button class="btn primary ss-go" style="width:100%">💳 Collect ${inr(due)} in parts</button>
    </div></div></div>`);
  document.body.appendChild(wrap);
  const closeM = () => wrap.remove();
  wrap.querySelector(".tbl-modal-close").onclick = closeM;
  wrap.onclick = (e) => { if (e.target === wrap) closeM(); };
  const bodyEl = wrap.querySelector(".ss-body"), sumEl = wrap.querySelector(".ss-sum");
  // Equal shares that sum EXACTLY to the due (last share absorbs the rounding).
  const equalLegs = () => { const base = Math.floor((due / n) * 100) / 100; const legs = Array.from({ length: n }, () => base); legs[n - 1] = Math.round((due - base * (n - 1)) * 100) / 100; return legs; };
  const personAmounts = () => { const per = Array.from({ length: n }, () => 0); dishes.forEach((d) => { per[Math.min(d.person, n) - 1] += d.amt; }); const scaled = per.map((a) => Math.round((a / dishSubtotal) * due * 100) / 100); const drift = Math.round((due - scaled.reduce((s, x) => s + x, 0)) * 100) / 100; scaled[scaled.length - 1] = Math.round((scaled[scaled.length - 1] + drift) * 100) / 100; return scaled; };
  const legRow = (i, amount, editable, label) => `<div class="ss-leg" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span class="muted" style="min-width:64px">${label || `Person ${i + 1}`}</span>
      <input type="number" step="0.01" min="0" class="ss-amt" data-leg="${i}" value="${amount.toFixed(2)}" ${editable ? "" : "readonly"} style="width:100px;padding:8px;border-radius:8px">
      ${methodSel(i)}
    </div>`;
  const nStepper = () => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span class="muted small">Split between</span>
      <button class="btn ss-n" data-d="-1">−</button><b class="ss-nval">${n}</b><button class="btn ss-n" data-d="1">＋</button><span class="muted small">people</span></div>`;
  const refreshSum = () => {
    const amts = [...bodyEl.querySelectorAll(".ss-amt")].map((x) => Number(x.value) || 0);
    const s = amts.reduce((a, b) => a + b, 0);
    const diff = Math.round((s - due) * 100) / 100;
    sumEl.innerHTML = diff === 0 ? `✓ Shares add up to ${inr(due)}` : `⚠️ Shares total ${inr(s)} — ${diff > 0 ? inr(diff) + " too much" : inr(-diff) + " short"}`;
    sumEl.style.color = diff === 0 ? "var(--green)" : "var(--red)";
  };
  const render = () => {
    wrap.querySelectorAll(".ss-tab").forEach((b) => b.classList.toggle("primary", b.dataset.mode === mode));
    if (mode === "equal") bodyEl.innerHTML = nStepper() + equalLegs().map((a, i) => legRow(i, a, false)).join("");
    else if (mode === "custom") bodyEl.innerHTML = nStepper() + equalLegs().map((a, i) => legRow(i, a, true)).join("");
    else bodyEl.innerHTML = nStepper() +
      `<div class="muted small" style="margin-bottom:6px">Tap a dish to hand it to the next person:</div>` +
      dishes.map((d, i) => `<button class="btn ss-dish" data-dish="${i}" style="display:flex;justify-content:space-between;width:100%;margin-bottom:4px"><span>${d.qty > 1 ? d.qty + "× " : ""}${esc(d.title)}</span><span>P${d.person} · ${inr(d.amt)}</span></button>`).join("") +
      `<div style="margin-top:10px">${personAmounts().map((a, i) => legRow(i, a, false)).join("")}</div>`;
    bodyEl.querySelectorAll(".ss-n").forEach((b) => (b.onclick = () => { n = Math.max(2, Math.min(12, n + Number(b.dataset.d))); dishes.forEach((d) => { if (d.person > n) d.person = 1; }); render(); }));
    bodyEl.querySelectorAll(".ss-dish").forEach((b) => (b.onclick = () => { const d = dishes[Number(b.dataset.dish)]; d.person = d.person >= n ? 1 : d.person + 1; render(); }));
    bodyEl.querySelectorAll(".ss-amt").forEach((x) => (x.oninput = refreshSum));
    refreshSum();
  };
  wrap.querySelectorAll(".ss-tab").forEach((b) => (b.onclick = () => { mode = b.dataset.mode; render(); }));
  render();
  wrap.querySelector(".ss-go").onclick = async () => {
    const amts = [...bodyEl.querySelectorAll(".ss-amt")];
    const splits = amts.map((x) => ({ amount: Number(x.value) || 0, method: bodyEl.querySelector(`.ss-method[data-leg="${x.dataset.leg}"]`).value }));
    const s = splits.reduce((a, b) => a + b.amount, 0);
    if (Math.abs(s - due) > 0.011) { toast("The shares must add up to exactly " + inr(due), "err"); return; }
    if (splits.some((x) => !(x.amount > 0))) { toast("Every share needs an amount above zero.", "err"); return; }
    closeM();
    try {
      const r = await api("POST", `/tables/${t}/pay-split`, { splits });
      toast(`Paid in ${splits.length} parts 💳 — ${r.count} order${r.count === 1 ? "" : "s"} settled`, "ok");
      await pollTables([String(t)]);
    } catch (e) { toast("Couldn't split-settle: " + e.message, "err"); }
  };
}

// Move ONE dish line to another table — two steps in one modal: pick the dish
// (grouped under its KOT), then pick the target table. The dish lands under a fresh
// KOT on the target and BOTH bills re-price server-side (mig 175).
function openMoveItemPicker(t) {
  document.querySelector(".moveitem-overlay")?.remove();
  const orders = ordersForTable(t).filter((o) => o.status !== "cancelled" && o.payment_status !== "paid");
  const groups = orders.map((o) => {
    const items = orderItemRows(o).filter((r) => r.kind === "session");
    if (!items.length) return "";
    return `<div class="muted" style="font-size:11.5px;margin:8px 2px 4px">KOT #${o.kot_no != null ? esc(o.kot_no) : "—"}</div>` +
      items.map((r) => `<button class="btn" data-mvitem="${esc(r.id)}" style="display:flex;justify-content:space-between;width:100%;margin:0 0 6px;padding:10px 14px"><span>${r.qty > 1 ? r.qty + "× " : ""}${esc(r.title)}</span><span>${inr(r.price * (r.qty || 1))}</span></button>`).join("");
  }).join("");
  if (!groups) { toast("No movable dishes on this table", "err"); return; }
  const n = Math.max(1, parseInt((state.data.settings || {}).table_count, 10) || 12);
  const wrap = el(`<div class="sx-modal-overlay moveitem-overlay"><div class="sx-modal" style="max-width:440px">
    <div class="tbl-modal-head"><div class="tp-detail-top"><h3>🍛 Move a dish from Table ${esc(t)}</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div>
    <div class="muted small mvi-hint" style="padding:0 14px 8px">Step 1 · which dish should move? (a multi-plate line moves whole)</div>
    <div class="dish-edit-body mvi-body" style="padding:6px 14px 14px">${groups}</div></div></div>`);
  document.body.appendChild(wrap);
  const closeM = () => wrap.remove();
  wrap.querySelector(".tbl-modal-close").onclick = closeM;
  wrap.onclick = (e) => { if (e.target === wrap) closeM(); };
  const body = wrap.querySelector(".mvi-body");
  const hint = wrap.querySelector(".mvi-hint");
  wrap.querySelectorAll("[data-mvitem]").forEach((b) => (b.onclick = () => {
    const itemId = b.dataset.mvitem;
    hint.textContent = "Step 2 · move it to which table? (it gets its own new KOT there)";
    const tiles = [];
    for (let i = 1; i <= n; i++) {
      if (String(i) === String(t)) continue;
      const open = summaryTableOpen(i);
      tiles.push(`<button class="kotm-tile${open ? " occ" : ""}" data-mvto="${i}"><b>T${i}</b><small>${open ? "joins bill" : "free"}</small></button>`);
    }
    body.innerHTML = `<div class="kotm-grid">${tiles.join("")}</div>`;
    body.querySelectorAll("[data-mvto]").forEach((tb) => (tb.onclick = async () => {
      const to = tb.dataset.mvto; closeM();
      try {
        const r = await api("POST", `/order-items/${itemId}/move`, { to });
        if (r && r.ok === false) { toast("Couldn't move: " + (r.reason || "rejected"), "err"); return; }
        toast(`Dish moved to table ${to} (new KOT)`, "ok");
      } catch (e) { toast("Failed: " + e.message, "err"); }
    }));
  }));
}

// MERGE picker — a grid of the OCCUPIED tables (the opposite of the shift picker's
// free-only grid): pick which party this table joins. Confirms first — a merge can't
// be un-done with one tap (the source session closes; orders/guests move for good).
function openMergePicker(t, sess) {
  document.querySelector(".merge-overlay")?.remove();
  const n = Math.max(1, parseInt((state.data.settings || {}).table_count, 10) || 12);
  const occ = [];
  for (let i = 1; i <= n; i++) { if (String(i) !== String(t) && summaryTableOpen(i)) occ.push(i); }
  const tileDue = (i) => { const tile = (state.summary && state.summary.tiles || {})[String(i)]; return tile && tile.due > 0 ? inr(tile.due) : ""; };
  const grid = occ.length
    ? `<div class="kotm-grid">` + occ.map((i) => `<button class="kotm-tile occ" data-mergeto="${i}"><b>T${i}</b><small>${tileDue(i) ? `due ${tileDue(i)}` : "open"}</small></button>`).join("") + `</div>`
    : `<div class="muted" style="padding:14px">No other open tables to merge with.</div>`;
  const wrap = el(`<div class="sx-modal-overlay merge-overlay"><div class="sx-modal shift-modal"><div class="tbl-modal-head"><div class="tp-detail-top"><h3>🪢 Merge Table ${esc(t)} into →</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div><div class="muted small" style="padding:0 14px 10px">Everything — orders, guests, calls &amp; bill — joins the other table as ONE bill. Table ${esc(t)} then frees up.</div><div class="shiftgrid">${grid}</div></div></div>`);
  document.body.appendChild(wrap);
  const closeM = () => wrap.remove();
  wrap.querySelector(".tbl-modal-close").onclick = closeM;
  wrap.onclick = (e) => { if (e.target === wrap) closeM(); };
  wrap.querySelectorAll("[data-mergeto]").forEach((b) => (b.onclick = async () => {
    const to = b.dataset.mergeto;
    if (!(await confirmDialog(`Merge Table ${t} into Table ${to}? Both parties become ONE bill on Table ${to}.`, "Merge"))) return;
    closeM();
    try {
      const r = await api("POST", `/sessions/${sess.id}/merge`, { to });
      if (r && r.ok === false) { toast("Couldn't merge: " + (r.reason || "rejected"), "err"); return; }
      toast(`Merged into table ${to} — one bill`, "ok");
      followShiftedTable(t, to); // the detail follows the party to its combined home
    } catch (e) { toast("Failed: " + e.message, "err"); }
  }));
}

// Move ONE order (a single KOT) to another table — two steps in one modal: pick the
// KOT, then pick the target table. Unlike Change-table, the target may be OCCUPIED
// (the KOT joins that party's bill) or free (a fresh session opens for it).
function openMoveKotPicker(t) {
  document.querySelector(".movekot-overlay")?.remove();
  const movable = ordersForTable(t).filter((o) => o.status !== "cancelled" && o.payment_status !== "paid");
  if (!movable.length) { toast("No movable KOTs on this table", "err"); return; }
  const n = Math.max(1, parseInt((state.data.settings || {}).table_count, 10) || 12);
  const kotRow = (o) => {
    const items = orderItemRows(o);
    const nd = items.reduce((s, r) => s + (parseInt(r.qty, 10) || 1), 0);
    return `<button class="btn kotpick" data-kot="${esc(o.id)}" style="display:flex;justify-content:space-between;width:100%;margin:0 0 8px;padding:11px 14px">
      <span><b>KOT #${o.kot_no != null ? esc(o.kot_no) : "—"}</b> · ${nd} dish${nd === 1 ? "" : "es"}</span><span>${inr(parseFloat(o.total) || 0)}</span></button>`;
  };
  const wrap = el(`<div class="sx-modal-overlay movekot-overlay"><div class="sx-modal" style="max-width:440px">
    <div class="tbl-modal-head"><div class="tp-detail-top"><h3>🧾 Move a KOT from Table ${esc(t)}</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div>
    <div class="muted small" style="padding:0 14px 8px">Step 1 · which KOT should move?</div>
    <div class="dish-edit-body movekot-body" style="padding:6px 14px 14px">${movable.map(kotRow).join("")}</div></div></div>`);
  document.body.appendChild(wrap);
  const closeM = () => wrap.remove();
  wrap.querySelector(".tbl-modal-close").onclick = closeM;
  wrap.onclick = (e) => { if (e.target === wrap) closeM(); };
  const body = wrap.querySelector(".movekot-body");
  const hint = wrap.querySelector(".muted.small");
  wrap.querySelectorAll("[data-kot]").forEach((b) => (b.onclick = () => {
    const orderId = b.dataset.kot;
    const o = movable.find((x) => x.id === orderId);
    hint.textContent = `Step 2 · move KOT #${o && o.kot_no != null ? o.kot_no : "—"} to which table?`;
    const tiles = [];
    for (let i = 1; i <= n; i++) {
      if (String(i) === String(t)) continue;
      const open = summaryTableOpen(i);
      tiles.push(`<button class="kotm-tile${open ? " occ" : ""}" data-moveto="${i}"><b>T${i}</b><small>${open ? "joins bill" : "free"}</small></button>`);
    }
    body.innerHTML = `<div class="kotm-grid">${tiles.join("")}</div>`;
    body.querySelectorAll("[data-moveto]").forEach((tb) => (tb.onclick = async () => {
      const to = tb.dataset.moveto; closeM();
      try {
        const r = await api("POST", `/orders/${orderId}/move`, { to });
        if (r && r.ok === false) { toast("Couldn't move: " + (r.reason || "rejected"), "err"); return; }
        toast(`KOT moved to table ${to}`, "ok");
        // Both tables repaint via the RPC's breadcrumbs (targeted refetch) — no manual reload.
      } catch (e) { toast("Failed: " + e.message, "err"); }
    }));
  }));
}

// openDiscountModal: replaces the old "type the ₹ amount to knock off" prompt() with
// two staff-friendly ways to land on the same number (owner, 2026-07-01 — "I don't want
// the amount-to-discount option like it's right now"):
//   "They pay"    — staff types the FINAL amount the customer will pay; we work BACKWARD
//                   to the discount (bill − pay) and show the % that comes out to.
//   "Percent off" — staff types a %; we work FORWARD to the discount (bill × %) and show
//                   what the customer ends up paying.
// Both modes just compute the same ₹ discount the server has always accepted — the API
// call at the bottom (POST .../discount {amount, note}) is byte-identical to before, so
// the clamp-to-bill-total safety net and the note field behave exactly as they did.
// Split the bill EVENLY between guests — a helper that shows each person's share (bill total ÷ N,
// the last share absorbs the rounding so they sum EXACTLY to the total). It does NOT change the bill
// or the payment: the manager still taps "Mark paid" to settle the whole bill once collected.
// (Per-item / per-seat splitting with separate payments is a planned bigger step.)
function openSplitBill(total) {
  document.querySelector(".split-overlay")?.remove();
  total = Math.max(0, Number(total) || 0);
  let n = 2;
  const wrap = el(`<div class="sx-modal-overlay split-overlay"><div class="sx-modal" style="max-width:420px">
    <div class="tbl-modal-head"><div class="tp-detail-top"><h3>🍴 Split the bill</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div>
    <div class="dish-edit-body">
      <div class="disc-bill-row"><span>Bill total</span><b>${inr(total)}</b></div>
      <div style="display:flex;align-items:center;gap:12px;margin:14px 0;flex-wrap:wrap">
        <label class="dish-edit-lbl" style="margin:0">Split between</label>
        <button class="btn" id="spMinus" type="button" style="min-width:44px">−</button>
        <b id="spN" style="font-size:18px;min-width:24px;text-align:center">2</b>
        <button class="btn" id="spPlus" type="button" style="min-width:44px">+</button>
        <span class="muted">people</span>
      </div>
      <div id="spBody"></div>
      <div class="muted small" style="margin-top:10px">A helper only — collect each share, then tap “Mark paid” to settle the whole bill.</div>
    </div>
  </div></div>`);
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector(".tbl-modal-close").onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  const paint = () => {
    wrap.querySelector("#spN").textContent = n;
    const base = Math.floor((total / n) * 100) / 100;        // each share, floored to paise
    const shares = Array(n).fill(base);
    shares[n - 1] = Math.round((total - base * (n - 1)) * 100) / 100; // last absorbs the remainder → exact sum
    wrap.querySelector("#spBody").innerHTML = `<div class="tp-bill">` + shares.map((s, i) => `<div class="tp-bl"><span>Person ${i + 1}</span><b>${inr(s)}</b></div>`).join("") + `</div>`;
  };
  wrap.querySelector("#spMinus").onclick = () => { if (n > 2) { n--; paint(); } };
  wrap.querySelector("#spPlus").onclick = () => { if (n < 20) { n++; paint(); } };
  paint();
}

function openDiscountModal(order, rerender, billTotal, bm, wholeBill) {
  document.querySelector(".disc-overlay")?.remove();
  const round2 = (n) => Math.round(n * 100) / 100;
  const clamp = (n, lo, hi) => Math.min(Math.max(Number.isFinite(n) ? n : 0, lo), hi);
  const current = Number(order.discount) || 0;
  // The stored discount is a PRE-TAX rupee amount: billMath subtracts it from the subtotal
  // and THEN adds tax. So "They pay" must recompute the tax — subtracting the discount from
  // the tax-INCLUSIVE total overstated it by discount×taxrate and mis-scaled the % (fixed
  // 2026-07-06). We discount against the table's pre-tax base, preserving any discount
  // already on OTHER orders of the same table (bm = billMath(os), passed by the caller;
  // billTotal is kept only for legacy callers that don't pass bm).
  const rate = bm ? bm.rate : taxModel(state.data.settings).rate;
  const subtotal = bm ? bm.subtotal : ((Number(order.total) || 0) / (1 + rate) + current);
  // wholeBill (manager bill discount): the amount passed IS the whole-bill discount (stored on the
  // session, split server-side), so there is no "other orders' discount" to preserve — discount the
  // full pre-tax bill. Legacy per-order callers keep the old "subtract other orders" behaviour.
  const otherDisc = wholeBill ? 0 : (bm ? Math.max(0, bm.disc - current) : 0);
  const base = Math.max(0, round2(subtotal - otherDisc)); // pre-tax base THIS modal discounts
  const payFor = (d) => round2(Math.max(0, base - clamp(d, 0, base)) * (1 + rate)); // what the customer pays
  const total = payFor(0); // the table total BEFORE this order's discount (shown as "Bill total")
  const maxDisc = base;    // can't discount more than the food (pre-tax) base
  // ONE interface, no mode toggle (owner, 2026-07-03): a Percent and an Amount(₹) field,
  // two-way linked from a single discAmount (₹ off, pre-tax — the value the server stores),
  // so they can never disagree. The % is off the pre-tax base.
  let discAmount = clamp(current, 0, maxDisc);
  let pctVal = base > 0 ? Math.round((discAmount / base) * 1000) / 10 : 0;

  const wrap = el(`<div class="sx-modal-overlay disc-overlay"><div class="sx-modal disc-modal">
    <div class="tbl-modal-head"><div class="tp-detail-top"><h3>Apply discount</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div>
    <div class="dish-edit-body disc-body">
      <div class="disc-bill-row"><span>Bill total</span><b>${inr(total)}</b></div>
      <div class="disc-linked-row">
        <div class="disc-field">
          <label class="dish-edit-lbl">Discount %</label>
          <input type="number" inputmode="decimal" min="0" max="100" step="1" class="dish-edit-custominput disc-input" id="discPctInput" placeholder="0">
        </div>
        <div class="disc-linked-eq">=</div>
        <div class="disc-field">
          <label class="dish-edit-lbl">Discount amount (₹)</label>
          <input type="number" inputmode="decimal" min="0" step="1" class="dish-edit-custominput disc-input" id="discAmtInput" placeholder="0">
        </div>
      </div>
      <div class="chips disc-pct-quick">${[0, 5, 10, 15, 20, 25, 50].map((p) => `<span class="chip disc-pct-pick" data-pct="${p}">${p ? p + "%" : "None"}</span>`).join("")}</div>
      <div class="disc-preview">
        <div class="disc-prev-row"><span>Discount</span><b id="discPrevAmt">− ${inr(current)}</b></div>
        <div class="disc-prev-row grand"><span>They pay</span><b id="discPrevPay">${inr(payFor(discAmount))}</b></div>
      </div>
      <label class="dish-edit-lbl" style="margin-top:14px">Reason <span class="muted small">(optional, shows on the bill)</span></label>
      <input type="text" class="dish-edit-custominput" id="discNoteInput" maxlength="200" placeholder="e.g. loyalty, comp, manager approval">
    </div>
    <div class="dish-edit-foot">
      ${current > 0 ? `<button type="button" class="btn danger disc-remove">Remove discount</button>` : ""}
      <span class="disc-foot-spacer"></span>
      <button type="button" class="btn dish-edit-cancel">Cancel</button>
      <button type="button" class="btn primary disc-apply">Apply</button>
    </div>
  </div></div>`);
  document.body.appendChild(wrap);
  wrap.querySelector("#discNoteInput").value = order.discount_note || "";
  const pctInput = wrap.querySelector("#discPctInput");
  const amtInput = wrap.querySelector("#discAmtInput");
  pctInput.value = pctVal ? String(pctVal) : "";
  amtInput.value = current ? String(round2(current)) : "";

  // Refresh ONLY the preview + the OTHER field from discAmount — never the field the
  // user is typing in (so their caret/partial number isn't clobbered mid-keystroke).
  const paint = (typing) => {
    pctVal = base > 0 ? Math.round((discAmount / base) * 1000) / 10 : 0;
    if (typing !== "pct") pctInput.value = discAmount ? String(pctVal) : "";
    if (typing !== "amt") amtInput.value = discAmount ? String(round2(discAmount)) : "";
    wrap.querySelector("#discPrevAmt").textContent = "− " + inr(discAmount);
    wrap.querySelector("#discPrevPay").textContent = inr(payFor(discAmount));
  };
  paint();

  // Edit % → derive amount (off the pre-tax base). Edit amount → derive %. Both clamp so
  // the discount can't exceed the food's pre-tax value (beyond which they'd just pay ₹0).
  pctInput.oninput = () => { const p = clamp(parseFloat(pctInput.value), 0, 100); discAmount = round2((base * p) / 100); paint("pct"); };
  amtInput.oninput = () => { discAmount = clamp(parseFloat(amtInput.value), 0, maxDisc); paint("amt"); };
  // On blur, snap the field the user was typing in to the CLAMPED value — while typing we
  // leave it raw (caret-safe), but once they leave it the box shouldn't keep showing an
  // over-limit / negative figure that disagrees with the applied discount + "They pay". A
  // full paint() (no "typing" arg) refreshes both fields from the clamped discAmount.
  pctInput.onblur = () => paint();
  amtInput.onblur = () => paint();
  wrap.querySelectorAll(".disc-pct-pick").forEach((c) => (c.onclick = () => { discAmount = round2((base * Number(c.dataset.pct)) / 100); paint(); }));

  const close = () => wrap.remove();
  wrap.querySelector(".tbl-modal-close").onclick = close;
  wrap.querySelector(".dish-edit-cancel").onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };

  const save = async (amount) => {
    const note = wrap.querySelector("#discNoteInput").value.trim();
    close();
    try {
      await api("POST", `/orders/${order.id}/discount`, { amount, note: amount > 0 ? note : "" });
      await loadSessions(); if (rerender) rerender();
      toast(amount > 0 ? `Discount ${inr(amount)} applied — they pay ${inr(payFor(amount))}` : "Discount removed", "ok");
    } catch (e) { toast("Failed: " + e.message, "err"); }
  };
  wrap.querySelector(".disc-apply").onclick = () => save(discAmount);
  const removeBtn = wrap.querySelector(".disc-remove"); if (removeBtn) removeBtn.onclick = () => save(0);
  setTimeout(() => pctInput.focus(), 30);
}

// bindTablePanel: wire up every button inside an already-rendered table detail.
// `root` is the container the detail's HTML lives in (the modal OR the side panel).
// `rerender` redraws the SAME view after a local-state change (modal vs side panel
// have different redraw paths), and `close` deselects/closes that view. Sharing
// this keeps the two views' behaviour identical.
function bindTablePanel(root, t, parts, { rerender, close }) {
  const { sess, os, canFree } = parts;
  const ob = root.querySelector("#sxOpen"); if (ob) ob.onclick = () => openTableSession(t);
  const cb = root.querySelector("#sxClose"); if (cb && sess) cb.onclick = () => closeSession(sess.id);
  // Shift the whole party (orders + calls move along) to an EMPTY table.
  const sh = root.querySelector("#sxShift");
  if (sh && sess) sh.onclick = () => openShiftPicker(t, sess);
  // KOT ▾ — the unified Table & KOT operations menu (replaces Shift when the ladder is on).
  const kb = root.querySelector("#sxKot");
  if (kb && sess) kb.onclick = () => openKotMenu(t, sess);
  // Print bill: a clean printable window with KOT numbers, discounts and totals.
  const pr = root.querySelector("#sxPrint");
  if (pr) pr.onclick = () => printBill(t, sess, os);
  // Invoice-first billing (owner 2026-07-24): Generate invoice / Reopen (void) buttons.
  const gi = root.querySelector("#sxGenInv");
  if (gi && sess) gi.onclick = () => generateInvoice(sess.id);
  const ro = root.querySelector("#sxReopen");
  if (ro && sess) ro.onclick = () => voidInvoice(sess.id);
  const payAll = root.querySelector("#sxPayAll"); if (payAll) payAll.onclick = () => markTablePaid(t);
  const tagB = root.querySelector("#sxTag"); if (tagB) tagB.onclick = () => openTagModal(t);
  // 🍴 Split: with the KOT ladder ON this is the REAL split-settle (several payment
  // legs, mig 176); with it off it stays the old even-share calculator — no regression.
  root.querySelectorAll("[data-split]").forEach((b) => (b.onclick = () => (tableOpsOn() ? openSplitSettle(t) : openSplitBill(parseFloat(b.dataset.split) || 0))));
  // Per-dish DELETE: confirm, then call the server, which deletes the order_item
  // AND recomputes the order's total from the survivors (lfh_delete_order_item) so
  // the bill can't keep charging for a removed dish. Reloads the live board after.
  root.querySelectorAll("[data-item-del]").forEach((b) => (b.onclick = async () => {
    const name = b.dataset.itemName || "this dish";
    if (!(await confirmDialog(`Remove “${name}” from the order? The bill total updates automatically.`, "Remove dish"))) return;
    try {
      const r = await api("POST", `/items/${b.dataset.itemDel}/delete`);
      await loadSessions();
      if (rerender) rerender();
      toast(r && r.order_cancelled ? "Dish removed — order now empty, cancelled" : "Dish removed — bill updated", "ok");
    } catch (e) { toast("Failed: " + e.message, "err"); }
  }));
  // ── STAFF EDIT-AFTER-CONFIRM (owner, 2026-06-17) ──────────────────────────
  // Enter edit mode ONLY after confirming with the kitchen the order's editable
  // (it may already be cooking). The 2-step confirm IS the guard.
  root.querySelectorAll("[data-edit-table]").forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Have you checked with the kitchen that this order is still editable? Only edit if they haven't started making it.", "Yes — it's editable")) {
      editTables.add(String(b.dataset.editTable)); if (rerender) rerender();
    }
  }));
  root.querySelectorAll("[data-done-table]").forEach((b) => (b.onclick = () => { editTables.delete(String(b.dataset.doneTable)); if (rerender) rerender(); }));
  // Quantity −/＋ on one dish: re-prices the bill server-side (clamped 1..99).
  const editQty = async (id, qty) => { try { await api("POST", `/items/${id}/qty`, { qty }); await loadSessions(); if (rerender) rerender(); } catch (e) { toast("Failed: " + e.message, "err"); } };
  root.querySelectorAll("[data-qty-inc]").forEach((b) => (b.onclick = () => editQty(b.dataset.qtyInc, Math.min(99, (parseInt(b.dataset.qty, 10) || 1) + 1))));
  root.querySelectorAll("[data-qty-dec]").forEach((b) => (b.onclick = () => { const q = (parseInt(b.dataset.qty, 10) || 1) - 1; if (q < 1) { toast("Use 🗑 to remove the dish", "err"); return; } editQty(b.dataset.qtyDec, q); }));
  // "✎ Edit" on a dish → the unified editor (allergens incl. custom + kitchen note).
  root.querySelectorAll("[data-edit-dish]").forEach((b) => (b.onclick = () => openDishEditModal(b.dataset.editDish, rerender)));
  // Per-order allergen toggle chips (edit mode): optimistic flip, then persist.
  root.querySelectorAll(".oae-chip[data-alg]").forEach((chip) => (chip.onclick = async () => {
    const id = chip.dataset.alg, slug = chip.dataset.slug;
    const o = (state.data.orders || []).find((x) => x.id === id);
    if (!o) return;
    const cur = new Set((o.allergies || []).map((x) => String(x).toLowerCase()));
    if (cur.has(slug)) cur.delete(slug); else cur.add(slug);
    o.allergies = [...cur]; if (rerender) rerender(); // flip the screen now
    try { await api("POST", `/orders/${id}/allergies`, { allergies: o.allergies }); await loadSessions(); if (rerender) rerender(); }
    catch (e) { toast("Couldn't update allergens: " + e.message, "err"); }
  }));
  // Add a dish to THIS order: a compact dish-picker modal → /orders/:id/add-item.
  root.querySelectorAll("[data-add-dish-order]").forEach((b) => (b.onclick = () => openAddDishModal(b.dataset.addDishOrder, rerender)));
  // ＋ Take order: open the full order-builder for a brand-new order on this table.
  root.querySelectorAll("[data-take-order]").forEach((b) => (b.onclick = () => openTakeOrder(b.dataset.takeOrder, rerender)));
  // Per-bill discount: opens the "they pay / percent off" modal (openDiscountModal).
  // The discount is stored on ONE order but billMath applies it to the WHOLE table's
  // bill, so the modal must show + cap on the TABLE total (billMath(os)), not the one
  // target order's total — else a multi-order table showed the first order's bill and
  // capped the discount at it (bug H8, 2026-07-05).
  root.querySelectorAll("[data-disc]").forEach((b) => (b.onclick = () => {
    const order = (os || []).find((o) => o.id === b.dataset.disc) || { id: b.dataset.disc, total: parseFloat(b.dataset.discMax) || 0, discount: parseFloat(b.dataset.discCur) || 0 };
    const bm = (os && os.length) ? billMath(os) : null;
    // The manager discount is a WHOLE-BILL discount: the server stores it on the session and splits
    // it across the orders (so it can't shrink when the bill is marked paid). Show the SESSION's
    // total discount as "current" — NOT this one order's split share, which would mis-show the amount.
    const wholeBill = !!sess;
    const discOrder = wholeBill
      ? { ...order, discount: Number(sess.discount) || 0, discount_note: sess.discount_note || "" }
      : order;
    openDiscountModal(discOrder, rerender, bm ? bm.total : (Number(order.total) || 0), bm, wholeBill);
  }));
  const auto = root.querySelector("#sxAuto"); if (auto && sess) auto.onchange = () => setSessAutoApprove(sess.id, auto.checked);
  root.querySelectorAll("[data-mem-approve]").forEach((b) => (b.onclick = () => memberAction(b.dataset.memApprove, "approve")));
  root.querySelectorAll("[data-mem-deny]").forEach((b) => (b.onclick = () => memberAction(b.dataset.memDeny, "remove")));
  root.querySelectorAll("[data-mem-kick]").forEach((b) => (b.onclick = () => kickMember(b.dataset.memKick)));
  root.querySelectorAll("[data-mem-head]").forEach((b) => (b.onclick = () => makeHead(b.dataset.memHead)));
  root.querySelectorAll("[data-mem-ban]").forEach((b) => (b.onclick = () => banMember(b.dataset.memBan, b.dataset.banPhone)));
  // Pending open/join/access requests now show INSIDE the detail (tp-req-sec) — approve/
  // deny here, same resolveRequest the floor's Requests card uses. Must be wired HERE
  // (not only the delegated #editor handler): the delegated handler deliberately skips
  // clicks inside [data-table-detail], and the legacy modal lives on document.body.
  root.querySelectorAll("[data-req-approve]").forEach((b) => (b.onclick = () => resolveRequest(b.dataset.reqApprove, "approved")));
  root.querySelectorAll("[data-req-deny]").forEach((b) => (b.onclick = () => resolveRequest(b.dataset.reqDeny, "denied")));
  const rst = root.querySelector("[data-tp-restart]"); if (rst) rst.onclick = () => restartTable(rst.dataset.tpRestart);
  root.querySelectorAll("[data-item-next]").forEach((b) => (b.onclick = () => itemStatus(b.dataset.itemNext, b.dataset.itemStatus)));
  root.querySelectorAll("[data-legacy-order]").forEach((b) => (b.onclick = () => legacyItemStatus(b.dataset.legacyOrder, b.dataset.legacyIdx, b.dataset.legacyStatus)));
  root.querySelectorAll("[data-accept]").forEach((b) => (b.onclick = () => acceptOrder(b.dataset.accept)));
  root.querySelectorAll("[data-accept-all]").forEach((b) => (b.onclick = () => acceptTableOrders(b.dataset.acceptAll)));
  root.querySelectorAll("[data-serveall]").forEach((b) => (b.onclick = () => serveAllOrder(b.dataset.serveall)));
  root.querySelectorAll("[data-serve-all-orders]").forEach((b) => (b.onclick = () => serveAllOrders(b.dataset.serveAllOrders)));
  root.querySelectorAll("[data-pay]").forEach((b) => (b.onclick = () => setOrderPayment(b.dataset.pay, b.dataset.paid !== "1")));
  root.querySelectorAll("[data-call-attend]").forEach((b) => (b.onclick = () => attendCall(b.dataset.callAttend)));
  root.querySelectorAll("[data-attend-all]").forEach((b) => (b.onclick = () => attendTableCalls(b.dataset.attendAll)));
  const free = root.querySelector(".tp-free"); if (free && canFree) free.onclick = () => freeTableAll(t, sess);
}

// renderTablePanel: the legacy POP-UP modal version of the table detail. Kept so any
// remaining caller (state.openSess) still works exactly as before; the Tables tab now
// uses the in-panel master-detail instead (see selectTable / floorHtml's side panel).
function renderTablePanel() {
  if (state.openSess == null) return;
  // keep the scroll position so serving an item doesn't fling the panel back to the top
  const prevModal = document.querySelector(".tbl-modal-overlay .tbl-modal");
  const savedScroll = prevModal ? prevModal.scrollTop : 0;
  document.querySelector(".tbl-modal-overlay")?.remove();
  const t = state.openSess;
  const parts = tablePanelParts(t);
  const { headPill, headMeta, requestsSec, sessionSec, ordersSec, callsSec, billSec, foot } = parts;
  const wrap = el(`<div class="sx-modal-overlay tbl-modal-overlay"><div class="tbl-modal sx-modal"><div class="tbl-modal-head"><div class="tp-detail-top"><h3>${esc(tableLabel(t))}</h3>${headPill}${parts.kotHeadBtn || ""}<button class="tbl-modal-close" aria-label="Close">✕</button></div>${headMeta}</div><div class="tbl-modal-body">${requestsSec}${sessionSec}${ordersSec}${callsSec}${billSec}</div><div class="tbl-modal-foot">${foot}</div></div></div>`);
  document.body.appendChild(wrap);
  const newModal = wrap.querySelector(".tbl-modal"); if (newModal) newModal.scrollTop = savedScroll;
  wrap.querySelector(".tbl-modal-close").onclick = closeTablePanel;
  wrap.onclick = (e) => { if (e.target === wrap) closeTablePanel(); };
  bindTablePanel(wrap, t, parts, { rerender: renderTablePanel, close: closeTablePanel });
}

// Advance ONE dish in a legacy order (items stored in the order's JSON).
async function legacyItemStatus(orderId, index, status) {
  const o0 = (state.data.orders || []).find((x) => x.id === orderId);
  const prev = (o0 && Array.isArray(o0.items) && o0.items[index]) ? (o0.items[index].status || "received") : null;
  const name = (o0 && Array.isArray(o0.items) && o0.items[index] && o0.items[index].title) || "Dish";
  try {
    await api("POST", "/orders/" + orderId + "/item", { index: Number(index), status }); // persist now
    const o = (state.data.orders || []).find((x) => x.id === orderId);                    // optimistic local update
    if (o && Array.isArray(o.items) && o.items[index]) o.items[index].status = status;
    refreshTableDetail();                                                                 // instant redraw from local state (modal OR in-panel detail)
    scheduleServeFlush();                                                                 // one real refresh after you stop clicking
    if (status === "served" && prev && prev !== "served" && window.LFH_UNDO) {
      LFH_UNDO.show({ message: `${name} served`, onUndo: () => editorUndoServe([{ kind: "legacy", orderId, idx: Number(index), prev }]) });
    }
  } catch (e) { toast("Failed: " + e.message, "err"); }
}

// Accept a whole order (received -> preparing). Flips the order AND its dishes,
// optimistically + poll-shielded so it can't flicker back mid-accept.
// Snapshot the still-"received" dishes an accept is about to send to the kitchen, so an
// accidental Accept can be taken back to the new-order queue (owner undo bar, 2026-07-22).
function snapReceived(o) {
  return orderItemRows(o)
    .filter((r) => r.status === "received")
    .map((r) => (r.kind === "session"
      ? { kind: "session", id: r.id, prev: "received" }
      : { kind: "legacy", orderId: r.orderId, idx: r.idx, prev: "received" }));
}
async function acceptOrder(orderId) {
  const o = (state.data.orders || []).find((x) => x.id === orderId);
  const snap = o ? snapReceived(o) : [];
  if (o) { o.status = "preparing"; flipOrderItems(o, "received", "preparing"); opBegin(o.id); }
  floorOpsInFlight++;
  loadSessions(true); renderTablePanel();
  let released = false;
  const release = () => { if (!released) { released = true; floorOpsInFlight--; if (o) opEnd(o.id); } };
  try {
    await api("POST", "/orders/" + orderId + "/accept"); release(); await loadSessions();
    if (snap.length && window.LFH_UNDO) LFH_UNDO.show({ message: "Order accepted", sub: o ? `Table ${o.table_number} · tap undo to unsend` : "Tap undo to unsend", icon: "✋", onUndo: () => editorUndoServe(snap) });
    else toast("Order accepted → preparing", "ok");
  }
  catch (e) { release(); toast("Failed: " + e.message, "err"); await loadSessions(); }
}
// Serve every dish on an order at once → order complete. Optimistic + shielded.
// Snapshot the dishes an order is about to serve (their prior status), so a mis-tapped
// serve can be sent back exactly where each dish was (owner undo bar, 2026-07-22).
// Works for both session order_items (id) and legacy JSON items (orderId + idx).
function snapServable(o) {
  return orderItemRows(o)
    .filter((r) => r.status !== "served")
    .map((r) => (r.kind === "session"
      ? { kind: "session", id: r.id, prev: r.status }
      : { kind: "legacy", orderId: r.orderId, idx: r.idx, prev: r.status }));
}
// Take back a serve: restore each dish's prior status locally + on the server, then
// reconcile. The item-status endpoint only accepts received/preparing/served, so a dish
// that was "ready" (cooked, not yet served) comes back as "preparing".
async function editorUndoServe(snap) {
  if (!snap || !snap.length) return;
  const clamp = (s) => (s === "ready" ? "preparing" : (["received", "preparing", "served"].includes(s) ? s : "preparing"));
  snap.forEach((s) => {
    const to = clamp(s.prev);
    if (s.kind === "session") { const it = (state.board.items || []).find((x) => x.id === s.id); if (it) it.status = to; }
    else { const o = (state.data.orders || []).find((x) => x.id === s.orderId); if (o && Array.isArray(o.items) && o.items[s.idx]) o.items[s.idx].status = to; }
  });
  refreshTableDetail();
  scheduleServeFlush();
  try {
    for (const s of snap) {
      if (s.kind === "session") await api("POST", "/items/" + s.id + "/status", { status: clamp(s.prev) });
      else await api("POST", "/orders/" + s.orderId + "/item", { index: s.idx, status: clamp(s.prev) });
    }
    await loadSessions();
  } catch (e) { toast("Undo failed: " + e.message, "err"); await loadSessions(); }
}

async function serveAllOrder(orderId) {
  const o = (state.data.orders || []).find((x) => x.id === orderId);
  const snap = o ? snapServable(o) : [];
  if (o) { o.status = "served"; flipOrderItems(o, null, "served"); opBegin(o.id); }
  floorOpsInFlight++;
  loadSessions(true); renderTablePanel();
  let released = false;
  const release = () => { if (!released) { released = true; floorOpsInFlight--; if (o) opEnd(o.id); } };
  try {
    await api("POST", "/orders/" + orderId + "/serve-all"); release(); await loadSessions();
    // The undo bar IS the confirmation now (message + a few-second takeback line),
    // so it replaces the old plain "served" toast.
    if (snap.length && window.LFH_UNDO) LFH_UNDO.show({
      message: "All dishes served",
      sub: o ? `Table ${o.table_number} · ${snap.length} dish${snap.length > 1 ? "es" : ""}` : `${snap.length} dishes`,
      onUndo: () => editorUndoServe(snap),
    });
    else toast("All items served", "ok");
  }
  catch (e) { release(); toast("Failed: " + e.message, "err"); await loadSessions(); }
}
// Quick action: accept ALL new orders on a table in one tap. Used by BOTH the
// floor tile's Accept AND the detail's "Accept all & prepare" button — one tap
// accepts the whole table (owner: never open the detail just to accept each).
// Optimistic tile feedback for a NON-selected table: the grid + "To accept" card render
// from state.summary (NOT the board), so an accept/attend that only patched state.data.*
// left the tile looking dead until the server round-trip (fixed 2026-07-06). These patch
// the slim summary tile immediately; pollTables() reconciles exact counts right after.
function patchSummaryTileAccept(t) {
  const s = state.summary || {};
  const tile = (s.tiles || {})[String(t)];
  if (!tile) return;
  const nt = Object.assign({}, tile, { hasNew: false });
  const c = Object.assign({ nw: 0, ck: 0, rd: 0, sv: 0 }, nt.counts || {});
  c.ck += c.nw; c.nw = 0; nt.counts = c;                 // the just-accepted dishes are now cooking
  if (nt.state === "new") { nt.state = "prep"; nt.label = "Preparing"; }
  state.summary = Object.assign({}, s, { tiles: Object.assign({}, s.tiles, { [String(t)]: nt }) });
}
function patchSummaryTileAttend(t) {
  const s = state.summary || {};
  const calls = (s.calls || []).filter((c) => (c.table_number || "").trim() !== String(t)); // drop this table's calls
  const patch = { calls };
  const tile = (s.tiles || {})[String(t)];
  if (tile) patch.tiles = Object.assign({}, s.tiles, { [String(t)]: Object.assign({}, tile, { hasCall: false }) });
  state.summary = Object.assign({}, s, patch);
}
async function acceptTableOrders(t) {
  // TWO-TIER: a tile quick-action can fire on a NON-selected table, whose full order rows
  // aren't in the cache (the grid renders from the slim summary). Ensure this table's slice
  // is loaded so ordersForTable(t) returns its real orders to act on. (No-op cost when it's
  // the selected table — already loaded — but cheap and correct to always refresh first.)
  await ensureTableSlice(t);
  // Accept every order that still has un-accepted (received) DISHES — this matches
  // the tile's "New order" cue, which is ITEM-level (anyReceived). An order can be
  // order-level "preparing" yet still carry a freshly-added dish at "received" (e.g.
  // a dish added after accepting); the old order-LEVEL filter (o.status==="received")
  // silently did NOTHING for those, so the tile showed "Accept" but clicking it fired
  // no request — the "Accept doesn't work" bug. The /accept endpoint flips received
  // item rows → preparing regardless of order status, so this is safe. (2026-06-26)
  const recv = ordersForTable(t).filter((o) => o.status !== "cancelled" && orderItemRows(o).some((r) => r.status === "received"));
  if (!recv.length) return;
  const snap = recv.flatMap((o) => snapReceived(o)); // for the takeback
  // OPTIMISTIC: tile flips to "Preparing" instantly, server told in background.
  recv.forEach((o) => { o.status = "preparing"; flipOrderItems(o, "received", "preparing"); opBegin(o.id); });
  floorOpsInFlight++;
  patchSummaryTileAccept(t); // instant tile feedback even on a non-selected table
  loadSessions(true); renderTablePanel();
  // release first, then refresh — see restartTable for why this order matters.
  let released = false;
  const release = () => { if (!released) { released = true; floorOpsInFlight--; recv.forEach((o) => opEnd(o.id)); } };
  try {
    for (const o of recv) await api("POST", "/orders/" + o.id + "/accept");
    release(); await pollTables([String(t)]); // refresh THIS tile's summary so the grid reflects truth
    if (snap.length && window.LFH_UNDO) LFH_UNDO.show({ message: recv.length > 1 ? `${recv.length} orders accepted` : "Order accepted", sub: `Table ${t} · tap undo to unsend`, icon: "✋", onUndo: () => editorUndoServe(snap) });
    else toast(recv.length > 1 ? recv.length + " orders accepted → preparing" : "Order accepted → preparing", "ok");
  }
  catch (e) { release(); toast("Failed: " + e.message, "err"); await pollTables([String(t)]); } // reload truth on failure
  finally { release(); }
}
// Serve EVERY order on a table at once (the table-wide "mark all served").
// OPTIMISTIC like accept: every dish row flips to served on screen first.
async function serveAllOrders(t) {
  await ensureTableSlice(t); // see acceptTableOrders: the table may not be selected
  const orders = ordersForTable(t);
  if (!orders.length) return;
  const snap = orders.flatMap((o) => snapServable(o));
  orders.forEach((o) => { o.status = "served"; flipOrderItems(o, null, "served"); opBegin(o.id); });
  floorOpsInFlight++;
  loadSessions(true);
  renderTablePanel();
  // release first, then refresh — see restartTable for why this order matters.
  let released = false;
  const release = () => { if (!released) { released = true; floorOpsInFlight--; orders.forEach((o) => opEnd(o.id)); } };
  try {
    for (const o of orders) await api("POST", "/orders/" + o.id + "/serve-all");
    release(); await pollTables([String(t)]);
    if (snap.length && window.LFH_UNDO) LFH_UNDO.show({
      message: "All dishes served",
      sub: `Table ${t} · ${snap.length} dish${snap.length > 1 ? "es" : ""}`,
      onUndo: () => editorUndoServe(snap),
    });
    else toast("All orders served", "ok");
  }
  catch (e) { release(); toast("Failed: " + e.message, "err"); await pollTables([String(t)]); }
  finally { release(); }
}
// Quick action: mark every open call on a table attended (clears the tile's emoji).
async function attendTableCalls(t) {
  await ensureTableSlice(t); // the call rows for a non-selected table aren't cached otherwise
  const cs = callsForTable(t);
  if (!cs.length) return;
  // OPTIMISTIC: the call emojis leave the tile instantly (detail panel reads state.data.calls).
  const before = state.data.calls || [];
  const beforeSummary = state.summary;
  const ids = new Set(cs.map((c) => c.id));
  state.data.calls = before.filter((c) => !ids.has(c.id));
  patchSummaryTileAttend(t); // instant tile feedback (grid reads state.summary, not the board)
  floorOpsInFlight++;
  loadSessions(true);
  try {
    for (const c of cs) await api("PATCH", "/calls/" + c.id, { resolved: true });
    floorOpsInFlight--; await pollTables([String(t)]); // clears the tile's call emoji from the summary
    const callIds = [...ids];
    if (window.LFH_UNDO) LFH_UNDO.show({
      message: `${callIds.length} call${callIds.length > 1 ? "s" : ""} attended`,
      sub: `Table ${t} · tap undo to put them back`,
      icon: "🔔",
      onUndo: async () => { try { await Promise.all(callIds.map((cid) => api("PATCH", "/calls/" + cid, { resolved: false }))); await loadSessions(); } catch (e) { toast("Undo failed: " + e.message, "err"); await loadSessions(); } },
    });
    else toast("Attended", "ok");
  }
  catch (e) { floorOpsInFlight--; state.data.calls = before; state.summary = beforeSummary; await pollTables([String(t)]); toast("Failed: " + e.message, "err"); }
}
// RST: clear a finished table's orders off the floor but KEEP the table open for a new round.
async function restartTable(t) {
  await ensureTableSlice(t); // a non-selected table's orders aren't cached otherwise
  const ids = ordersForTable(t).map((o) => o.id);
  if (!ids.length) return;
  if (!(await confirmDialog(`Restart Table ${t}? Its orders clear off the floor and the table stays OPEN for a fresh round.`, "Restart"))) return;
  // OPTIMISTIC after the confirm: the tile resets instantly, server follows.
  // Orders become SERVED + archived (the round is done; they stay as real,
  // completed orders in records/revenue — NOT cancelled, which would void them).
  (state.data.orders || []).forEach((o) => { if (ids.includes(o.id)) { o.archived = true; o.status = "served"; opBegin(o.id); } });
  floorOpsInFlight++;
  loadSessions(true);
  // release: drop our "mid-save" markers BEFORE the reconciling refresh below —
  // loadSessions only trusts the server's board once nothing is in flight, so
  // holding the markers through the refresh would delay our own reconcile.
  let released = false;
  const release = () => { if (!released) { released = true; floorOpsInFlight--; ids.forEach((id) => opEnd(id)); } };
  try {
    // ONE atomic server call: archive the round + release members + CLEAR the table's live signals
    // (so no ghost waiter-call bell lingers on the emptied table) + reopen if sessions are on.
    // (B12 — was a client PATCH loop that never cleared the signals.)
    await api("POST", "/tables/" + t + "/restart", {});
    release();
    await pollTables([String(t)]); // refresh this tile's summary (cheap, single-table)
    toast(`Table ${t} restarted — still open`, "ok");
  } catch (e) { release(); toast("Could not restart: " + e.message, "err"); await pollTables([String(t)]); }
  finally { release(); }
}
// CLS: free the table (archive orders + close any open session).
async function closeTableQuick(t) { await ensureTableSlice(t); freeTableAll(t, openSessionForTable(t)); }

// Free a table: archive its settled orders off the floor and, if a session is open, close it.
// OPTIMISTIC after the confirm: the tile turns Free instantly; the server
// catches up in the background and a refresh reconciles (or reloads on error).
async function freeTableAll(t, sess) {
  const ids = ordersForTable(t).map((o) => o.id);
  if (!(await confirmDialog(`Free Table ${t}? Settled orders leave the floor${sess ? " and the session closes" : ""} (kept in records).`, "Free table"))) return;
  (state.data.orders || []).forEach((o) => { if (ids.includes(o.id)) { o.archived = true; opBegin(o.id); } });
  if (sess) sess.status = "closed";
  state.openSess = null; state.selectedTable = null; document.querySelector(".tbl-modal-overlay")?.remove(); // close modal AND the in-panel detail
  state.floatingTables = state.floatingTables.filter((f) => String(f.table) !== String(t)); // drop the freed table's popup too
  floorOpsInFlight++;
  loadSessions(true); // instant redraw from local state
  // release first, then refresh — see restartTable for why this order matters.
  let released = false;
  const release = () => { if (!released) { released = true; floorOpsInFlight--; ids.forEach((id) => opEnd(id)); } };
  try {
    for (const id of ids) await api("PATCH", "/orders/" + id, { archived: true });
    if (sess) await api("POST", "/sessions/" + sess.id + "/close");
    release();
    await pollTables([String(t)]); // refresh just this tile's summary (handles drop-to-Free)
    toast(`Table ${t} freed`, "ok");
  } catch (e) { release(); toast("Could not free: " + e.message, "err"); await pollTables([String(t)]); }
  finally { release(); }
}

// ===================== USERS / LOG =====================
// Every guest who joined a table (auto ID = their member id) + the blocklist. From here
// the owner can EXIT (kick) a guest or BLOCK them (they then see a blocked screen).
// loadUsers: fetch the Log tab's data (guests, customers, blocklist, plus their
// order/call activity) and redraw if the Log tab is showing.
async function loadUsers() {
  try { state.users = await api("GET", "/users"); if (state.tab === "log") renderEditor(); }
  catch (e) { toast("Could not load log: " + e.message, "err"); }
}

// logHtml: build the Log tab — a table listing every guest (name, table, role,
// what they did, status, when) with Exit/Block actions, plus the blocklist below.
function logHtml() {
  // Two logs share this tab: the customer/guest log (default) and the staff
  // Operation log (who-did-what across the panels).
  const view = state.logView || "customers";
  // The Customer/Operation switch now lives in the LEFT SIDEBAR (see renderList),
  // so there's no top toggle here.
  if (view === "operations") return oplogHtml();
  const u = state.users || {};
  const members = u.members || [];
  const blocks = u.blocklist || [];
  const blockedPhones = new Set(blocks.filter((b) => b.phone).map((b) => b.phone)); // quick "is this phone blocked?" lookup
  // What each guest DID — aggregate orders + waiter calls by their member id.
  const orderCount = {}, callCount = {};
  (u.orders || []).forEach((o) => { if (o.member_id) orderCount[o.member_id] = (orderCount[o.member_id] || 0) + 1; });
  (u.calls || []).forEach((c) => { if (c.member_id) callCount[c.member_id] = (callCount[c.member_id] || 0) + 1; });

  const head = `<div class="ed-head"><h2>Log <span class="sub">· who did what</span></h2><div class="ed-head-actions">${retentionControl("custlog_retention_days")}<button class="btn" id="refreshLog">↻ Refresh</button></div></div>
    <div class="ord-note">Every guest gets an automatic ID. <b>Role</b> shows who ran the table (👑 Head) vs a joiner (🤝 Partner); <b>Did</b> shows whether they ordered or just called a waiter. Use <b>Exit</b> to remove someone, or <b>Block</b> to stop a misbehaving guest (e.g. someone who calls a waiter but isn't here). <b>Click a row</b> for full details. <span class="lg-muted">This timer clears old guest-activity records only — your bills are kept.</span></div>`;
  const rows = members.length ? members.map((m) => {
    const table = m.session ? m.session.table_number : "—"; // which table they're at
    const open = m.session && m.session.status === "open"; // is that table's session still open?
    const blocked = m.phone && blockedPhones.has(m.phone);
    // Work out a single word for their current status, in priority order.
    const status = m.removed ? "left" : blocked ? "blocked" : open ? (m.approved ? "in session" : "waiting") : "ended";
    const isHead = m.role === "owner"; // the person who started the table
    const role = isHead ? `<span class="logrole head">👑 Head</span>` : `<span class="logrole partner">🤝 Partner</span>`;
    const nOrders = orderCount[m.id] || 0, nCalls = callCount[m.id] || 0;
    let did = "";
    if (nOrders) did += `<span class="logdid order">🛒 ${nOrders} order${nOrders > 1 ? "s" : ""}</span>`;
    if (nCalls) did += `<span class="logdid call">🔔 ${nCalls} call${nCalls > 1 ? "s" : ""}</span>`;
    if (!did) did = (open && !m.approved) ? `<span class="lg-muted">asked to join</span>` : `<span class="lg-muted">joined only</span>`;
    let acts = "";
    if (open && !m.removed) acts += `<button class="btn small" data-exit="${esc(m.id)}">Exit</button>`;
    if (!blocked) acts += `<button class="btn small danger" data-block-phone="${esc(m.phone || "")}" data-block-table="${esc(table)}">Block</button>`;
    return `<div class="logrow logrow-click" data-cust-detail="${esc(m.id)}">
        <div class="logcell"><b>${esc(m.name || (isHead ? "Head" : "Guest"))}</b><small>${esc(String(m.id).slice(0, 8))}</small></div>
        <div class="logcell">T${esc(table)}</div>
        <div class="logcell">${role}</div>
        <div class="logcell logdidcell">${did}</div>
        <div class="logcell"><span class="logstat logstat-${status.replace(/ /g, "-")}">${status}</span></div>
        <div class="logcell"><small>${esc(whenLabel(m.joined_at))}</small></div>
        <div class="logcell logacts">${acts}</div>
      </div>`;
  }).join("") : `<div class="sx-empty">No guests have joined a table yet.</div>`;
  const table = `<div class="logtable"><div class="logrow loghead"><div>Guest</div><div>Table</div><div>Role</div><div>Did</div><div>Status</div><div>When</div><div></div></div>${rows}</div>`;
  const blkRows = blocks.length ? blocks.map((b) => `<div class="sx-blk"><span>${b.phone ? "📵 " + esc(b.phone) : "🚫 table " + esc(b.table_number)}${b.reason ? ` — <small>${esc(b.reason)}</small>` : ""}</span><button class="btn small" data-unblock="${esc(b.id)}">Unblock</button></div>`).join("") : `<div class="sx-empty">Nobody is blocked.</div>`;
  const blkPanel = `<div class="sx-panel" style="margin-top:18px;max-width:560px"><h3>🚫 Blocked <span class="sub">· ${blocks.length}</span></h3>${blkRows}</div>`;
  return head + table + blkPanel;
}

// A gold "manager PIN" pill for a TABLET action that a manager's PIN unlocked. The
// tablet has no per-person login, so a non-empty `actor` on a tablet row is always the
// manager whose PIN authorised the action (recorded server-side, mig-free — the actor
// column). A name containing " / " means the SAME PIN belongs to more than one manager,
// so it's genuinely ambiguous who tapped it — we name them all and tint the pill.
// A person's OWN identity actions (login/logout/profile/password/PIN) also stamp `actor`
// with that person's name, but that's NOT a manager-PIN authorisation — exclude them so a
// tablet login row doesn't wrongly show a gold PIN pill / "Manager PIN" block.
const SELF_ACTOR_ACTIONS = new Set(["login", "logout", "profile_setup", "profile_update", "password_change", "pin_set"]);
function isManagerPinRow(r) {
  return !!r && r.panel === "tablet" && !!r.actor && !SELF_ACTOR_ACTIONS.has(r.action);
}
function pinPill(r) {
  if (!isManagerPinRow(r)) return "";
  const shared = String(r.actor).includes(" / ");
  const title = shared
    ? "This PIN is shared by these managers — any of them could have entered it"
    : "Unlocked by this manager's PIN";
  return ` <span class="op-pinpill${shared ? " op-pinpill-shared" : ""}" title="${esc(title)}">🔑 ${esc(r.actor)}</span>`;
}

// oplogHtml: the Operation log — every staff action across the panels (which
// panel did what, where, and when). Fed by /oplog (the staff_actions table).
function oplogHtml() {
  const rows = state.oplog || [];
  const head = `<div class="ed-head"><h2>Operation log <span class="sub">· staff actions</span></h2><div class="ed-head-actions">${retentionControl("oplog_retention_days")}<button class="btn" id="staffWatch">🔍 Staff watch</button><button class="btn" id="refreshOplog">↻ Refresh</button></div></div>
    <div class="ord-note">Every staff action across the panels — which panel <b>and which device</b> did it, where, and when. Each device gets an automatic ID (shown as <b>#id</b>) until real staff login lands. <b>Click any row</b> for its full date, time and details.</div>`;
  if (!rows.length) return head + `<div class="sx-empty">No staff actions logged yet — accept/serve an order, open/close a table, etc.</div>`;
  const ACT = OP_ACTION_LABELS;
  // Which staff devices are currently blocked → map device_id to its blocklist
  // row id (so we can offer Unblock). Loaded alongside the customer-log data.
  const blockedDev = {};
  ((state.users && state.users.blocklist) || []).forEach((b) => { if (b.device_id) blockedDev[b.device_id] = b.id; });
  // Table-style (like the Customer log): a Device column first so you can see
  // exactly WHICH tablet/kitchen screen did each action, plus Block/Unblock.
  const headRow = `<div class="oprow ophead"><div>Device</div><div>Panel</div><div>Action</div><div>Where</div><div>When</div><div></div></div>`;
  const body = rows.map((r) => {
    const device = r.device_id
      ? `<span class="op-dev">📱 #${esc(r.device_id)}</span>`
      : `<span class="lg-muted">—</span>`;
    const where = r.table_number ? "Table " + esc(r.table_number) : (r.detail ? esc(r.detail) : "");
    // Block/Unblock only for field devices (tablet/kitchen) — never the editor,
    // so the owner can't lock themselves out of the panel that does the unblocking.
    let act = "";
    if (r.device_id && r.panel !== "editor") {
      act = blockedDev[r.device_id]
        ? `<span class="logstat logstat-blocked">blocked</span> <button class="btn small" data-unblock-dev="${esc(blockedDev[r.device_id])}">Unblock</button>`
        : `<button class="btn small danger" data-block-dev="${esc(r.device_id)}">Block</button>`;
    }
    return `<div class="oprow oprow-click${blockedDev[r.device_id] ? " op-blocked" : ""}" data-op-detail="${esc(r.id)}">
      <div class="opcell">${device}</div>
      <div class="opcell"><span class="op-panel op-${esc(r.panel)}">${esc(PANEL_LABEL[r.panel] || r.panel)}</span></div>
      <div class="opcell"><b>${esc(ACT[r.action] || r.action)}</b>${pinPill(r)}${r.actor_id === "00000000-0000-0000-0000-0000000000ad" ? ` <span class="op-pinpill" title="You did this from an admin panel view — staff and owner logs show it as a plain panel action">🛡 Admin</span>` : ""}</div>
      <div class="opcell lg-muted">${where}</div>
      <div class="opcell"><small>${esc(whenLabel(r.created_at))}</small></div>
      <div class="opcell opacts">${act}</div>
    </div>`;
  }).join("");
  return head + `<div class="oplist">${headRow}${body}</div>`;
}

// Fetch the operation log (lazily, when that view is shown).
async function loadOplog() {
  try { state.oplog = await api("GET", "/oplog"); if (state.tab === "log") renderEditor(); }
  catch (e) { toast("Could not load operation log: " + e.message, "err"); }
}

// bindLog: wire up the Log tab's buttons (refresh, exit a guest, block, unblock).
function bindLog() {
  const ed = $("#editor");
  const rb = document.getElementById("refreshLog"); if (rb) rb.onclick = loadUsers;
  ed.querySelectorAll("[data-exit]").forEach((b) => (b.onclick = () => exitUser(b.dataset.exit)));
  ed.querySelectorAll("[data-block-phone]").forEach((b) => (b.onclick = () => blockUser(b.dataset.blockPhone, b.dataset.blockTable)));
  ed.querySelectorAll("[data-unblock]").forEach((b) => (b.onclick = () => unblockLog(b.dataset.unblock)));
  // Operation log: block / unblock a staff DEVICE (tablet / kitchen screen).
  ed.querySelectorAll("[data-block-dev]").forEach((b) => (b.onclick = () => blockDevice(b.dataset.blockDev)));
  ed.querySelectorAll("[data-unblock-dev]").forEach((b) => (b.onclick = () => unblockLog(b.dataset.unblockDev)));
  // Switch between the Customer log and the Operation log.
  ed.querySelectorAll("[data-logview]").forEach((b) => (b.onclick = () => { state.logView = b.dataset.logview; if (state.logView === "operations") loadOplog(); else renderEditor(); }));
  const ro = document.getElementById("refreshOplog"); if (ro) ro.onclick = loadOplog;
  const sw = document.getElementById("staffWatch"); if (sw) sw.onclick = openStaffRisk;
  // "Keep logs for …" dropdown (both logs) → save the new retention.
  ed.querySelectorAll(".ret-select").forEach((s) => (s.onchange = () => saveRetention(s.dataset.ret, s.value)));
  // Click a row to open its full detail (ignore clicks that landed on a button,
  // e.g. Block/Unblock/Exit — those do their own thing).
  ed.querySelectorAll("[data-op-detail]").forEach((row) => (row.onclick = (e) => { if (!e.target.closest("button")) showOpDetail(row.dataset.opDetail); }));
  ed.querySelectorAll("[data-cust-detail]").forEach((row) => (row.onclick = (e) => { if (!e.target.closest("button")) showCustDetail(row.dataset.custDetail); }));
}

// showOpDetail: open the full-info card for one operation-log row — everything about
// that action, laid out in tidy sections (When / Who / What / Manager PIN / Status).
// The Manager-PIN section appears ONLY when a manager's PIN actually authorised the
// action (a tablet row with an `actor`); otherwise it isn't there at all.
function showOpDetail(id) {
  const r = (state.oplog || []).find((x) => x.id === id);
  if (!r) return;
  // On a TABLET row, a non-empty `actor` is the manager whose PIN unlocked it (the tablet has
  // no per-person login) — except the person's own login/profile actions. " / " means one PIN
  // shared by several managers → ambiguous.
  const isPin = isManagerPinRow(r);
  const pinShared = isPin && String(r.actor).includes(" / ");
  const isErr = r.level === "error";
  const isResolved = isErr && !!r.resolved_at;
  const rows = [
    { section: "When" },
    { label: "Date & time", value: fullWhen(r.created_at) },
    { label: "How long ago", value: whenLabel(r.created_at) },
    { section: "Who" },
    isPin
      ? { label: "Panel", value: "Waiter tablet" }
      : { label: "Done by", value: r.actor_id === "00000000-0000-0000-0000-0000000000ad" ? "🛡 Admin (via panel view — invisible to staff & owner logs)" : (r.actor || (r.panel === "db" ? "Direct database edit" : "Panel action (no staff login yet)")) },
    { label: "Panel", value: isPin ? "" : (PANEL_LABEL[r.panel] || r.panel) },
    { label: "Device", value: r.device_id ? "#" + r.device_id : "" },
  ];
  if (isPin) {
    rows.push(
      { section: "Manager PIN", accent: "#d4af37" },
      { label: pinShared ? "Shared PIN of" : "Authorised by", value: "🔑 " + r.actor, strong: true, color: pinShared ? "var(--warn, #e0a800)" : "#d4af37" },
    );
    if (pinShared) rows.push({ label: "Note", value: "This PIN belongs to more than one manager — any of them could have entered it." });
  }
  rows.push(
    { section: "What happened" },
    { label: "Details", value: r.detail || "" },
    { label: "Table", value: r.table_number ? "Table " + r.table_number : "" },
    { label: "Order id", value: r.order_id || "" },
  );
  if (isErr) {
    rows.push(
      { section: "Status" },
      { label: "State", value: isResolved ? "Resolved" : "Open — needs attention" },
      { label: "Resolved at", value: isResolved ? fullWhen(r.resolved_at) : "" },
    );
  }
  rows.push(
    { section: "Reference" },
    { label: "Action code", value: r.action },
    { label: "Log id", value: r.id },
  );
  logDetailDialog(OP_ACTION_LABELS[r.action] || r.action, rows);
}

// showCustDetail: open the full-info card for one customer-log (guest) row.
function showCustDetail(id) {
  const u = state.users || {};
  const m = (u.members || []).find((x) => x.id === id);
  if (!m) return;
  const nOrders = (u.orders || []).filter((o) => o.member_id === id).length;
  const nCalls = (u.calls || []).filter((c) => c.member_id === id).length;
  const table = m.session ? m.session.table_number : "—";
  logDetailDialog("Guest log entry", [
    { label: "Guest", value: m.name || "(unnamed)" },
    { label: "Guest id", value: m.id },
    { label: "Table", value: "T" + table },
    { label: "Role", value: m.role === "owner" ? "👑 Head" : "🤝 Partner" },
    { label: "Phone", value: m.phone || "" },
    { label: "Orders placed", value: String(nOrders) },
    { label: "Waiter calls", value: String(nCalls) },
    { label: "Joined", value: fullWhen(m.joined_at) },
  ]);
}

// exitUser: remove a guest from their table (from the Log tab).
async function exitUser(memberId) {
  if (!(await confirmDialog("Remove this guest from the table? They can't order or call until they rejoin.", "Remove"))) return;
  try { await api("POST", "/members/" + memberId + "/remove"); await loadUsers(); toast("Guest removed", "ok"); }
  catch (e) { toast("Failed: " + e.message, "err"); }
}
// blockUser: block a guest by phone (preferred) or table, so they hit a blocked screen.
async function blockUser(phone, table) {
  const by = phone ? `phone ${phone}` : `table ${table}`;
  if (!(await confirmDialog(`Block this guest (by ${by})? They'll see a blocked screen and can't order or call.`, "Block"))) return;
  try { await api("POST", "/blocklist", phone ? { phone } : { table }); await loadUsers(); toast("Blocked", "ok"); }
  catch (e) { toast("Failed: " + e.message, "err"); }
}
// blockDevice: block a staff DEVICE (a tablet / kitchen screen) by its device id.
// The tablet & kitchen APIs then refuse every request from it until unblocked.
async function blockDevice(deviceId) {
  if (!deviceId) return;
  if (!(await confirmDialog("Block this device? The tablet/kitchen screen using it won't be able to take orders or act until you unblock it.", "Block device"))) return;
  try { await api("POST", "/blocklist", { device_id: deviceId, reason: "device" }); await loadUsers(); toast("Device blocked", "ok"); }
  catch (e) { toast("Failed: " + e.message, "err"); }
}
// unblockLog: remove someone from the blocklist (a guest OR a device). After it,
// loadUsers refreshes the blocklist so the operation-log buttons flip back too.
async function unblockLog(id) {
  try { await api("DELETE", "/blocklist/" + id); await loadUsers(); toast("Unblocked", "ok"); }
  catch (e) { toast("Failed: " + e.message, "err"); }
}

// ---------- tabs + init ----------
// setTab: switch the editor to a different tab. It records the choice (so a refresh
// stays here), resets the selection, shows/hides the search + "New" controls as
// appropriate, redraws, and kicks off any data load that tab needs.
// ── Platform (Zomato / Swiggy / takeaway) orders ────────────────────────────
// Reads the separate aggregator_orders table via GET /platform; renders a
// status board (New → Preparing → Ready → Handed over). Dine-in is untouched.
const PLAT_META = {
  zomato:   { label: "Zomato",   cls: "z" },
  swiggy:   { label: "Swiggy",   cls: "s" },
  takeaway: { label: "Website",  cls: "t" }, // the restaurant's own site (mig 209)
  parcel:   { label: "Parcel",   cls: "p" }, // staff-punched counter parcel — never "Takeaway"
  other:    { label: "Other",    cls: "o" },
};
const platMoney = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
function platAge(iso) { const m = Math.floor(Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? "just now" : m + "m"; }
function platColOf(st) {
  if (st === "new") return "new";
  if (st === "accepted" || st === "preparing") return "prep";
  if (st === "ready") return "ready";
  if (st === "handed_over") return "done";
  return null; // cancelled etc. are not shown on the board
}
function platCardHtml(o) {
  const m = PLAT_META[o.source] || PLAT_META.other;
  const items = Array.isArray(o.items) ? o.items : [];
  const lines = items.map((it) =>
    `<div class="plat-line"><span class="q">${esc(it.qty)}×</span> ${esc(it.title)}${Array.isArray(it.removed) && it.removed.length ? `<span class="no"> no ${esc(it.removed.join(", "))}</span>` : ""}</div>`).join("");
  let action = "";
  if (o.status === "new") action = `<button class="btn primary" data-plat-act="accepted" data-plat-id="${esc(o.id)}">Accept</button><button class="btn ghost" data-plat-act="cancelled" data-plat-id="${esc(o.id)}" title="Reject">✕</button>`;
  else if (o.status === "accepted" || o.status === "preparing") action = `<button class="btn primary" data-plat-act="ready" data-plat-id="${esc(o.id)}">Mark ready</button>`;
  else if (o.status === "ready") action = `<button class="btn primary" data-plat-act="handed_over" data-plat-id="${esc(o.id)}">Hand over</button>`;
  // Payment is tracked for a counter PARCEL and a WEBSITE order (both may be pay-on-pickup);
  // Zomato/Swiggy are prepaid by the platform. Unpaid → a "Collect" button that settles it;
  // paid → a PAID pill.
  const showPay = o.source === "parcel" || o.source === "takeaway";
  const paidPill = showPay ? (o.paid ? `<span class="plat-paid">PAID</span>` : `<span class="plat-unpaid">UNPAID</span>`) : "";
  const collect = (showPay && !o.paid) ? `<button class="btn ghost plat-collect" data-plat-pay="${esc(o.id)}" title="Take payment for this order">💰 Collect</button>` : "";
  return `<div class="plat-card ${m.cls}">
    <div class="plat-ch"><span class="plat-badge ${m.cls}">${esc(m.label)}</span><span class="plat-kot">#${esc(o.kot_no ?? "—")}</span>${paidPill}<span class="plat-age">${esc(platAge(o.created_at))}</span></div>
    <div class="plat-cust">${esc(o.customer_name || "—")}</div>
    <div class="plat-items">${lines || '<span class="plat-empty">no items</span>'}</div>
    <div class="plat-cf"><span class="plat-tot">${platMoney(o.total)}</span><span class="plat-acts">${collect}${action}</span></div>
  </div>`;
}
function platformHtml() {
  const all = state.data.platform || [];
  const cols = { new: [], prep: [], ready: [], done: [] };
  all.forEach((o) => { const c = platColOf(o.status); if (c) cols[c].push(o); });
  const col = (key, label) => `<div class="plat-col"><div class="plat-col-h">${label} <span class="ct">${cols[key].length}</span></div><div class="plat-col-body">${cols[key].map(platCardHtml).join("") || '<div class="plat-col-empty">—</div>'}</div></div>`;
  // The "Add test order" button and the "Show in bills" toggle were REMOVED (owner 2026-07-06):
  //  • the test button inserted a REAL, auto-accepted order that polluted live revenue / the
  //    Z-report with fake money and couldn't be told apart — turned OFF so it can't happen.
  //  • "Show in bills" wrote a flag nothing ever read — it did nothing, so it's gone.
  // The "🆕 New" column shows ONLY when something is actually awaiting acceptance; today every
  // order auto-accepts, so an always-empty New column + its Accept/Reject buttons were dead,
  // misleading UI. It reappears automatically if a real integration ever sends a 'new' order.
  const newCol = cols.new.length ? col("new", "🆕 New") : "";
  // Header title + subtitle built from what's actually live for this restaurant (mig 209): the
  // delivery channels that are on, plus parcels. A restaurant with only parcels reads "Parcels".
  const ch = state.platformChannels || {};
  const platOn = state.platformOn !== false;
  const parcelOn = state.parcelOn === true;
  const chLabels = [];
  if (platOn) { if (ch.zomato) chLabels.push("Zomato"); if (ch.swiggy) chLabels.push("Swiggy"); if (ch.website) chLabels.push("Website"); }
  const title = (platOn && chLabels.length) ? "Platform" : "Parcels";
  const subParts = [...chLabels]; if (parcelOn) subParts.push("Parcels");
  const sub = subParts.length ? `<span class="sub">· ${subParts.join(" · ")}</span>` : "";
  // "Simulate order" — the demo/representation control (no API keys needed). ADMIN/OWNER ONLY:
  // it's a demo tool, so real floor staff never see it (they'd otherwise be able to add fake
  // orders to live revenue — the reason the old test button was removed). The server refuses a
  // non-owner staff request too. Shows a channel picker of the live delivery channels.
  const canSimulate = !!(XRAY_WHO && XRAY_WHO.higherView);
  const simChannels = (platOn && canSimulate) ? [["zomato", "Zomato"], ["swiggy", "Swiggy"], ["website", "Website"]].filter(([k]) => ch[k]) : [];
  const simMenu = simChannels.length
    ? `<div class="plat-sim">
        <button class="btn" id="platSim" title="Add a demo order to try the flow (owner / admin only)">＋ Simulate order ▾</button>
        <div class="plat-sim-menu" id="platSimMenu" hidden>${simChannels.map(([k, l]) => `<button class="btn ghost" data-plat-sim="${k}">${esc(l)}</button>`).join("")}</div>
      </div>` : "";
  return `<div class="ed-head plat-head">
      <h2>${title} ${sub}</h2>
      <div class="plat-head-actions">
        ${simMenu}
        <button class="btn" id="platRefresh" title="Refresh">↻</button>
      </div>
    </div>
    <div class="plat-board">
      ${newCol}${col("prep", "🍳 Preparing")}${col("ready", "✅ Ready")}${col("done", "📦 Handed over")}
    </div>`;
}
function bindPlatform() {
  const rf = document.getElementById("platRefresh"); if (rf) rf.onclick = loadPlatform;
  // Simulate-order menu (demo mode): toggle the channel picker; a pick fires POST /platform/test.
  const sim = document.getElementById("platSim"); const simMenu = document.getElementById("platSimMenu");
  if (sim && simMenu) {
    sim.onclick = (e) => { e.stopPropagation(); simMenu.hidden = !simMenu.hidden; };
    document.addEventListener("click", () => { simMenu.hidden = true; }, { once: true });
    simMenu.querySelectorAll("[data-plat-sim]").forEach((b) => b.onclick = async (e) => {
      e.stopPropagation(); simMenu.hidden = true; b.disabled = true;
      try { await api("POST", "/platform/test", { channel: b.dataset.platSim }); toast("Demo order added ✓", "ok"); await loadPlatform(); }
      catch (err) { toast("Failed: " + err.message, "err"); }
    });
  }
  document.querySelectorAll("[data-plat-act]").forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { await api("POST", `/platform/${b.dataset.platId}/status`, { status: b.dataset.platAct }); await loadPlatform(); }
    catch (e) { toast("Failed: " + e.message, "err"); b.disabled = false; }
  });
  // Collect payment for an unpaid parcel (pay-on-pickup) — settles it, flips the pill to PAID.
  document.querySelectorAll("[data-plat-pay]").forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { await api("POST", `/platform/${b.dataset.platPay}/pay`, { method: "cash" }); toast("Collected ✓", "ok"); await loadPlatform(); }
    catch (e) { toast("Failed: " + e.message, "err"); b.disabled = false; }
  });
}
// Count of platform orders STILL in play (not handed over / cancelled) — shown on
// the Platform tab so the manager sees how many are live without opening the tab.
function updatePlatformBadge() {
  const live = (state.data.platform || []).filter((o) => o.status !== "handed_over" && o.status !== "cancelled").length;
  const b = $("#platformBadge");
  if (b) { b.textContent = live; b.hidden = live === 0; }
}
let platSeq = 0; // own latest-wins guard so platform loads never cancel the board loaders
async function loadPlatform() {
  // Skip the poll entirely when BOTH the platform and parcel modules are off for this
  // restaurant (mig 209) — no board to show, and hitting GET /platform would 403 every tick.
  // (Admin/owner higher-view still polls so the X-ray board works.) Falls through if settings
  // aren't loaded yet (first call) so the initial fetch still runs.
  const s = state.data.settings;
  if (s && !(XRAY_WHO && XRAY_WHO.higherView)) {
    const platEff = s.platform_allowed === true && (s.platform_owner_control !== true || s.platform_enabled !== false);
    const parcelEff = s.parcel_allowed === true && (s.parcel_owner_control !== true || s.parcel_enabled !== false);
    if (!platEff && !parcelEff) { state.data.platform = []; updatePlatformBadge(); return; }
  }
  const seq = ++platSeq;
  try {
    const res = await api("GET", "/platform");
    if (seq !== platSeq) return;
    state.data.platform = res.orders || [];
    state.platformToggles = res.toggles || {};
    state.platformChannels = res.channels || {};   // which delivery channels are live (mig 209)
    state.platformOn = res.platform_on;             // is the platform module effective
    state.parcelOn = res.parcel_on;                 // is the parcel module effective
    updatePlatformBadge();
    if (state.tab === "platform") renderEditor();
  } catch { /* keep last good board */ }
}

function setTab(tab) {
  // Menu-only embed: the only reachable tabs are the menu ones — redirect any other target
  // (boot fallbacks, realtime handlers) to Dishes, and mark the body so the CSS hides the rest.
  if (MENU_ONLY) { document.body.classList.add("menu-only", "skin-" + MENU_SKIN); if (!MENU_TABS.includes(tab)) tab = "items"; }
  if (INV_ONLY) { document.body.classList.add("menu-only", "skin-" + MENU_SKIN); if (tab !== "inventory") tab = "inventory"; }
  // Leaving the Dashboard: destroy its live Chart.js instances so their detached canvases +
  // resize handlers don't linger until the next Dashboard visit.
  if (state.tab === "dash" && tab !== "dash") { dashCharts.forEach((c) => { try { c.destroy(); } catch {} }); dashCharts = []; }
  // Leaving the Tables floor: close any open table detail/popup and tear down its hardware-BACK
  // layers (they were only re-synced on the Tables render, so a stray popup left one registered
  // on another tab → a wasted Back press).
  if (state.tab === "tables" && tab !== "tables") {
    state.floatingTables = [];
    state.selectedTable = null;
    state.openSess = null;
    syncTableBackLayers();
  }
  state.tab = tab;
  try { localStorage.setItem("lfh_editor_tab", tab); } catch {}
  state.isNew = false;
  state._snapPending = true; // re-baseline the unsaved-changes guard for the new tab
  // Search/category-filter are per-sub-tab: carrying "burger" from Dishes into
  // Categories/Tags made those lists look empty. Clear them on any tab switch.
  state.search = "";
  state.catFilter = ""; // "" = All (matches the default)
  const _sb = document.getElementById("search"); if (_sb) _sb.value = "";
  state.sel = tab === "general"
    ? clone(state.data.settings || { id: "site", bubbles_enabled: true, service_mode: false })
    : null;
  // The single "Editor" top tab (data-tab="items") stays highlighted across its
  // three sub-views (Dishes / Categories / Tags).
  const EDITOR_SUB = ["items", "categories", "filters"];
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab || (t.dataset.tab === "items" && EDITOR_SUB.includes(tab))));
  // Show the Dishes/Categories/Tags sub-nav only inside the Editor section, and
  // mark which sub-view is open.
  const sub = document.getElementById("editorSubtabs");
  if (sub) {
    sub.hidden = !EDITOR_SUB.includes(tab);
    sub.querySelectorAll(".subtab").forEach((s) => s.classList.toggle("active", s.dataset.tab === tab));
  }
  // The search box and "+ New" don't apply to the General/Orders/Tables tabs.
  const noList = tab === "general" || tab === "orders" || tab === "tables" || tab === "platform" || tab === "log" || tab === "features" || tab === "dash" || tab === "banquet" || tab === "ratings" || tab === "inventory";
  $("#newBtn").style.display = noList ? "none" : "";
  // Multi-select is Dishes-only; leaving the Dishes tab exits it. syncBulkBtn shows/hides
  // the "Select" button and reflects the current mode.
  if (tab !== "items") { state.bulkMode = false; state.bulkSel.clear(); }
  syncBulkBtn();
  $("#search").style.display = noList ? "none" : "";
  closeSuggest(); // the open suggestions belong to the tab we're leaving
  // Tables tab: drop the whole left sidebar (it only held a dead "Floor map" label).
  // The floor already has its own left tiles + right detail, so it takes the full
  // width — the .no-sidebar class collapses the grid's first column to nothing.
  const layout = document.querySelector(".layout");
  if (layout) layout.classList.toggle("no-sidebar", tab === "tables" || tab === "platform" || tab === "banquet" || tab === "ratings" || tab === "inventory");
  renderCatFilter(); // show category chips on Dishes, hide elsewhere
  renderList();
  renderEditor();
  if (tab === "orders") {
    loadOrders();
    unseenOrders = 0;
    updateOrdersBadge(); // also refreshes the tab title (orders + tables combined)
  }
  if (tab === "tables") {
    loadSessions(); // unified live floor (orders + sessions in one)
    unseenTables = 0; // opening the floor clears its unseen-request badge
    updateTablesBadge();
  }
  if (tab === "log") {
    loadUsers(); // customer-log data
    // If we're restoring straight onto the Operation log (e.g. a refresh stayed
    // there), fetch its data too — otherwise the table would be empty.
    if (state.logView === "operations") loadOplog();
  }
  if (tab === "platform") loadPlatform();
}

// loadOrders: fetch the latest orders (and waiter calls) and redraw if we're on
// the Orders tab. Used by the Refresh button and after any order change.
// Invoice pipeline (manager). generate locks the bill + assigns a permanent number;
// void reopens it for edits (number kept in record). Server-authoritative (migration 073).
// Guard against a double-tap on "Generate invoice": on a laggy tablet two quick taps
// fire two POSTs before the button re-renders, and each consumes an invoice sequence
// number (one gets overwritten) → a gap in the numbering. Keyed per session so two
// DIFFERENT bills can still invoice at once; the same bill can't fire twice in flight.
const _invBusy = new Set();
async function generateInvoice(sid) {
  if (_invBusy.has(sid)) return;
  // A RE-issue (a number already exists → the previous was voided) must say WHY — the
  // reason is recorded in the invoice history. A first-ever issue needs no reason.
  const ss = (state.board.sessions || []).find((s) => s.id === sid);
  const isReissue = ss && ss.invoice_no != null;
  let reason = null;
  if (isReissue) {
    reason = await promptDialog("This invoice was voided. Re-issuing assigns a NEW number — why are you re-issuing it?", { confirmLabel: "Re-issue invoice", placeholder: "corrected GST, fixed items…", required: true });
    if (reason == null) return; // cancelled
  }
  _invBusy.add(sid);
  try { await api("POST", `/sessions/${sid}/invoice`, reason ? { reason } : {}); await loadOrders(); toast(isReissue ? "Invoice re-issued" : "Invoice generated", "ok"); }
  catch (e) { toast("Failed: " + e.message, "err"); }
  finally { _invBusy.delete(sid); }
}
async function voidInvoice(sid) {
  if (!(await confirmDialog("Reopen this bill? Its invoice is voided (kept in records) and the bill unlocks for edits — a new invoice number is issued next time. Only possible while the table is not settled.", "Reopen bill"))) return;
  const reason = await promptDialog("Why are you voiding / reopening this invoice? (required)", { confirmLabel: "Void invoice", placeholder: "refund, correction, wrong GST…", required: true });
  if (reason == null) return; // cancelled — a reason is required
  try { await api("POST", `/sessions/${sid}/void-invoice`, { reason }); await loadOrders(); toast("Invoice voided — bill reopened", "ok"); }
  catch (e) { toast("Failed: " + e.message, "err"); }
}
// Issue a CREDIT NOTE — the legal way to refund/correct a bill WITHOUT changing it (used
// once a bill is settled and can't be edited). Records a new, numbered credit document.
async function creditNote(sid) {
  const amtStr = await promptDialog("Credit note — refund/correction amount (₹)?", { confirmLabel: "Next", placeholder: "e.g. 200", required: true });
  if (amtStr == null) return;
  const amount = Math.round(parseFloat(amtStr) * 100) / 100;
  if (!amount || amount <= 0) { toast("Enter a valid amount", "err"); return; }
  const reason = await promptDialog("Why this credit note? (required)", { confirmLabel: "Issue credit note", placeholder: "overcharge, refund, correction…", required: true });
  if (reason == null) return;
  try { const cn = await api("POST", `/sessions/${sid}/credit-note`, { amount, reason }); await loadOrders(); toast(`Credit note #${cn && cn.credit_no ? cn.credit_no : ""} issued`, "ok"); }
  catch (e) { toast("Failed: " + e.message, "err"); }
}
async function loadOrders() {
  const seq = ++dataSeq;
  try {
    const orders = await api("GET", "/orders");
    if (seq !== dataSeq) return; // a newer refresh started — drop this stale response
    state.data.orders = orders;
    // (Don't set lastOrderCount/lastCallCount here — reconcileBoard owns them from the
    //  summary's live counts; a full-list baseline here would clash and misfire the chime.)
    try {
      const calls = await api("GET", "/calls");
      if (seq !== dataSeq) return; // superseded mid-fetch
      state.data.calls = calls;
    } catch {}
    if (state.tab === "orders") { renderList(); renderEditor(); } // sidebar counts + cards
  } catch (e) {
    toast("Could not load orders: " + e.message, "err");
  }
}

// ---------- live order alerts (owner) ----------
// The editor polls the orders endpoint and chimes + badges when a new order
// lands, no matter which tab the owner is on.
let lastOrderCount = null; // baseline; set on first poll so we don't alert on startup
let lastCallCount = null;  // pending waiter calls baseline (kept for the unseen badge)
// New-call alerts are keyed by CALL ID, not by count. A count can re-trip a toast
// when several pollers fire for the same call (realtime tick + backup poll + wake)
// — the owner saw one call buzz ~3 times. Tracking which call ids we've already
// announced makes the alert fire EXACTLY once per real call, no matter how many
// times we re-poll. null = not baselined yet (don't alert for calls already there).
let seenCallIds = null;
// Optimistic-click bookkeeping: while a save is still travelling to the
// server, the 1-second poll must not overwrite that order with stale data
// (it would flicker the click back). Deletes get the same protection.
const pendingOrderOps = new Map();  // order id -> number of in-flight saves
const pendingDeletes = new Set();   // ids removed on screen, server catching up
const opBegin = (id) => pendingOrderOps.set(id, (pendingOrderOps.get(id) || 0) + 1);
const opEnd = (id) => { const n = (pendingOrderOps.get(id) || 1) - 1; n <= 0 ? pendingOrderOps.delete(id) : pendingOrderOps.set(id, n); };
let lastPollSig = "";               // fingerprint of the last drawn orders view
// While any FLOOR action (open/free/attend/approve…) is mid-save, the poll
// must not replace the board or redraw the Tables tab — it would briefly
// flicker the optimistic change back before the server confirms.
let floorOpsInFlight = 0;
let lastReqCount = null;   // pending requests (join/access/open/waiter) baseline
let unseenOrders = 0;
// Table requests (a guest asking to open/join/access a table) belong to the
// FLOOR, not Orders — so they get their OWN unseen counter and badge on the
// Tables tab. Previously they wrongly bumped the Orders badge (owner report).
let unseenTables = 0;

// updateOrdersBadge: show/hide the little red number on the Orders tab counting
// new things you haven't looked at yet.
function updateOrdersBadge() {
  const b = $("#ordersBadge");
  if (b) { b.textContent = unseenOrders; b.hidden = unseenOrders === 0; }
  refreshTitle();
}

// updateTablesBadge: same idea for the Tables tab — counts unseen floor requests
// (wants-in / join / access) so the owner's eye goes to the FLOOR, where the
// matching 📨 badge already sits on the actual table tile.
function updateTablesBadge() {
  const b = $("#tablesBadge");
  if (b) { b.textContent = unseenTables; b.hidden = unseenTables === 0; }
  refreshTitle();
}

// refreshTitle: the browser-tab title shows the TOTAL unseen (orders + floor
// requests) so a notification is visible even when this tab is in the background.
function refreshTitle() {
  const n = unseenOrders + unseenTables;
  document.title = n ? `(${n}) Menu Editor` : "Menu Editor";
}

// A short, soft two-note chime via the Web Audio API — no sound file needed.
function playOrderChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {}
}

// pollOrders: this runs on every realtime tick / 60s backup (see startOrderWatch). It
// ALWAYS fetches the slim SUMMARY (tiny — drives the GRID, the side-panel queues, AND the
// chimes from any tab via order_count/calls/requests). The full /orders + /calls lists are
// fetched ONLY when the Orders tab is showing (that tab renders all ~200 order cards); the
// owner's 300-table fear is the floor grid, not that one detail tab. On the Tables tab the
// SELECTED table's full slice is refreshed so its detail stays live.
async function pollOrders() {
  const seq = ++dataSeq;
  let summary;
  try {
    summary = await api("GET", "/summary");
  } catch {
    return; // network blip — try again next tick
  }
  if (seq !== dataSeq) return; // a newer loader started — this poll snapshot is stale
  if (!floorOpsInFlight) state.summary = summary; // don't clobber an optimistic tile mid-action
  state.boardLoaded = true;

  // Orders tab → also pull the full order/call lists it renders (merged, optimistic-safe).
  if (state.tab === "orders") {
    try {
      let orders = await api("GET", "/orders");
      if (seq !== dataSeq) return;
      orders = orders
        .filter((o) => !pendingDeletes.has(o.id))
        .map((o) => (pendingOrderOps.has(o.id) ? ((state.data.orders || []).find((x) => x.id === o.id) || o) : o));
      state.data.orders = orders;
    } catch {}
    try { const calls = await api("GET", "/calls"); if (seq !== dataSeq) return; state.data.calls = calls; } catch {}
  } else if (state.tab === "tables" && detailTables().length && !floorOpsInFlight) {
    // Keep EVERY open detail (docked, collapsed-mode modal, or floating) order rows + members fresh.
    try {
      const tables = detailTables();
      const results = await Promise.all(tables.map((t) => {
        const q = "?table=" + encodeURIComponent(t);
        return Promise.all([api("GET", "/sessions" + q), api("GET", "/orders" + q), api("GET", "/calls" + q)]);
      }));
      if (seq !== dataSeq) return;
      tables.forEach((t, i) => mergeTableSlice(t, results[i][0], results[i][1], results[i][2]));
    } catch {}
  }

  // Counts + alerts + redraw live in reconcileBoard(), now driven by the SUMMARY aggregates
  // so the chimes fire identically from any tab and the targeted refetch (pollTables) reuses them.
  reconcileBoard();
}

// reconcileBoard: from the slim SUMMARY aggregates (state.summary), update the live counts,
// redraw the visible tab only when something changed, and fire the new-order / waiter-call /
// request chimes. The summary is fetched on every poll regardless of tab, so the chimes fire
// identically from any tab (no dual-source baseline drift). Called by BOTH the full poll
// (pollOrders) and the targeted refetch (pollTables) so neither path can silently drop an alert.
function reconcileBoard() {
  const summary = state.summary || {};
  // SUMMARY-driven counts (live-only order_count + unresolved calls + pending requests).
  const orderCount = Number(summary.order_count) || 0;
  const calls = summary.calls || [];          // already unresolved-only from the RPC
  const requests = summary.requests || [];    // already pending-only from the RPC
  // Remember the previous counts, then update to the new ones. The "did it grow?"
  // checks below compare prev vs now to detect something brand-new arriving.
  const prev = lastOrderCount;
  lastOrderCount = orderCount;
  lastCallCount = calls.length; // kept for any external reader; alerts now use seenCallIds
  const reqCount = requests.length;
  const prevR = lastReqCount;
  lastReqCount = reqCount;

  // While a serve flush is pending (staff is actively marking dishes), don't let
  // the poll redraw the view under their fingers — the optimistic local render is
  // already on screen and the debounced flush will reconcile it shortly. We still
  // fetched fresh data above, so the new-order/call/request alerts below still fire.
  if (!serveFlushPending()) {
    // Only redraw the Orders tab when something VISIBLE actually changed —
    // rebuilding 200 cards every second ate clicks and scroll position. (The Orders
    // tab still renders from the full state.data.orders fetched in pollOrders.)
    const orders = state.data.orders || [];
    // Redraw fingerprint. It MUST cover every field a bill card renders, or a change made
    // on another device/tab (discount, a new/removed dish, invoice generate/void, bill_no)
    // refetches but never repaints — the card shows a STALE total/invoice state until you
    // touch something or Refresh. So we serialise the FULL rows minus a tiny volatile set
    // (the exact rule kitchen/tablet use — see the boardSig gotcha in CLAUDE.md). Adding a
    // new editable order column needs NO change here; a new heartbeat-y column goes in the set.
    const RT_VOLATILE_ORDER = new Set(["updated_at"]);
    const stripVol = (o) => { const c = {}; for (const k in o) if (!RT_VOLATILE_ORDER.has(k)) c[k] = o[k]; return c; };
    const sig = JSON.stringify([
      orders.map(stripVol),
      calls.map((c) => c.id),
      reqCount,
    ]);
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    // Don't advance lastPollSig when we SKIP the redraw because the owner is typing (B19): otherwise a
    // bill change that lands mid-typing is fingerprinted-as-seen and never repaints until the NEXT
    // change. Leaving it stale means the next poll (once typing stops) still sees a diff and redraws.
    const skippedForTyping = state.tab === "orders" && sig !== lastPollSig && typing;
    if (state.tab === "orders" && sig !== lastPollSig && !typing) { renderList(); renderEditor(); }
    if (!skippedForTyping) lastPollSig = sig;
    if (state.tab === "tables" && !floorOpsInFlight) {
      // TARGETED realtime path (pollTables named specific tables) → patch JUST those tiles +
      // the stats/queues, NOT the whole grid. Any other path (full poll, optimistic action,
      // initial) → the full loadSessions(true) render. patchFloorTiles self-falls-back to a
      // full render if the grid/tiles aren't present or a table detail is open.
      if (targetedPatchTables && targetedPatchTables.length) patchFloorTiles(targetedPatchTables);
      else loadSessions(true); // keep the live floor fresh
    }
  }

  // new order alert (order_count is live orders only; the latest order's table comes
  // alongside it in the summary so the toast still names the table).
  if (prev !== null && orderCount > prev) {
    const newCount = orderCount - prev;
    const where = summary.latest_order_table ? "Table " + summary.latest_order_table : "Walk-in";
    playOrderChime();
    toast(`🔔 ${newCount} new order${newCount > 1 ? "s" : ""} — ${where}`, "ok", null, 6000);
    if (state.tab !== "orders") { unseenOrders += newCount; updateOrdersBadge(); }
  }
  // new waiter-call alert — fire ONCE per call id (see seenCallIds note above)
  const openIds = calls.map((c) => c.id);
  if (seenCallIds === null) {
    seenCallIds = new Set(openIds); // first poll: baseline, don't alert for existing calls
  } else {
    const fresh = calls.filter((c) => !seenCallIds.has(c.id));
    if (fresh.length) {
      const latest = fresh[0];
      const where = latest && latest.table_number ? "Table " + latest.table_number : "a guest";
      playOrderChime();
      toast(`🔔 ${fresh.length > 1 ? fresh.length + " waiter calls" : "Waiter call"} — ${where}`, "ok", null, 6000);
      if (state.tab !== "orders") { unseenOrders += fresh.length; updateOrdersBadge(); }
    }
    seenCallIds = new Set(openIds); // track exactly the calls still open; a re-call gets a new id
  }
  // new request alert (a guest asked to join/access a table, or requested a waiter
  // when they couldn't be auto-let-in). Newest request is last (queue is ascending).
  if (prevR !== null && reqCount > prevR) {
    const latest = requests[reqCount - 1];
    const verb = latest && latest.type === "open" ? "wants to open" : latest && latest.type === "join" ? "wants to join" : "needs access to";
    const where = latest && latest.table_number ? `Table ${latest.table_number}` : "a table";
    playOrderChime();
    toast(`🙋 Request — ${verb} ${where}`, "ok", null, 6000);
    // Floor request → light the TABLES badge (not Orders). The table tile itself
    // already shows the 📨 badge + "Wants in", so this just points the owner there.
    if (state.tab !== "tables") { unseenTables += (reqCount - prevR); updateTablesBadge(); }
  }
}

// pollTables(tables): TARGETED refetch — for each named table fetch ONLY its slim SUMMARY
// tile (?table=N, ~5 kB) and patch it into state.summary.tiles, instead of re-reading the
// whole 84 kB floor on every breadcrumb. The aggregates (calls/requests/joiners/blocklist +
// order_count) are tiny and restaurant-wide, so each per-table call returns them and we take
// the latest. If a named table is the SELECTED one, ALSO refresh its FULL slice so its detail
// stays live. Then reconcileBoard() runs the same counts/chimes/redraw as the full poll. ANY
// surprise → full pollOrders (safe fallback). (owner 2026-06-26 — scope egress per table.)
const tileSeq = {}; // per-table ticket for targeted polls (see below)
async function pollTables(tables) {
  if (!tables || !tables.length) return pollOrders();
  // A FULL reload (pollOrders/loadSessions) bumps dataSeq; capture it so we drop these tile
  // patches only if a full reload started meanwhile (its whole-board snapshot is fresher).
  // pollTables no longer bumps dataSeq itself: two targeted polls for DIFFERENT tables must
  // NOT cancel each other — sharing one counter meant the earlier table's tile went stale
  // until the 60s backstop (fixed 2026-07-06). A per-table ticket handles same-table overlap.
  const born = dataSeq;
  const tlist = tables.map(String);
  const mySeq = {};
  for (const t of tlist) mySeq[t] = (tileSeq[t] = (tileSeq[t] || 0) + 1);
  let results;
  try {
    results = await Promise.all(tlist.map(async (t) => {
      const sum = await api("GET", "/summary?table=" + encodeURIComponent(t));
      return { table: t, sum: sum || {} };
    }));
  } catch (e) { return pollOrders(); }      // network/parse blip → safe full reload
  if (dataSeq !== born) return;             // a FULL reload started — its fresher board wins

  // Patch the changed tables' tiles + refresh the restaurant-wide aggregates (unless a floor
  // action is mid-save, mirroring the board's floorOpsInFlight guard so optimism isn't clobbered).
  if (!floorOpsInFlight) {
    const s = state.summary || { tiles: {} };
    const tiles = Object.assign({}, s.tiles || {});
    const tset = new Set(tlist);
    let latest = null;
    for (const r of results) {
      const t = r.table;
      if (mySeq[t] !== tileSeq[t]) continue; // a newer targeted poll for THIS table won → skip just its tile
      const tile = r.sum.tiles && r.sum.tiles[t];
      if (tile) tiles[t] = tile;            // the table now has a tile (occupied)
      else delete tiles[t];                 // the table dropped off the floor universe → back to plain Free
      latest = r.sum;                       // aggregates are identical across calls; keep the last
    }
    state.summary = Object.assign({}, s, { tiles }, latest ? {
      order_count: latest.order_count,
      latest_order_table: latest.latest_order_table,
      calls: latest.calls || [],
      requests: latest.requests || [],
      joiners: latest.joiners || [],
      blocklist: latest.blocklist || [],
    } : {});
    state.boardLoaded = true;

    // Any OPEN-DETAIL table (docked, collapsed modal, or floating) that's among the changed
    // ones gets its full slice refreshed for the detail.
    const toRefresh = detailTables().filter((t) => tset.has(t));
    if (toRefresh.length) {
      try {
        if (dataSeq !== born) return;
        await Promise.all(toRefresh.map((t) => loadTableSlice(t)));
      } catch {}
    }
  }

  // Route reconcileBoard's RENDER step through the INCREMENTAL patch for just these tables
  // (the chimes/alerts/counts are unchanged — only the floor's draw differs). Set the flag
  // right before, clear it right after: reconcileBoard runs synchronously, so the full-poll
  // path (pollOrders → reconcileBoard) can never see it set.
  targetedPatchTables = tables.map(String);
  try { reconcileBoard(); } finally { targetedPatchTables = null; }
}

// startOrderWatch: kick off the live polling. The first call sets the "baseline"
// counts so we don't alert for orders that were already there; then setInterval
// repeats it every second so the floor and alerts stay near-real-time.
function startOrderWatch() {
  // Boot grace: the initial page load already fetches /all + /summary + /platform fresh
  // (loadAll + this pollOrders + loadPlatform). The realtime CONNECT then fires its own
  // "full reconcile" (menu→loadAll, ops-full→pollOrders+loadPlatform) a moment later,
  // which just re-fetches all three a SECOND time — the boot-load duplication (each was
  // hit ~3×). Skip only the FULL realtime refresh during this short window; TARGETED
  // table events are never skipped, and after the window everything runs normally, so
  // there's zero steady-state staleness. (egress, 2026-07-06)
  rtBootGraceUntil = Date.now() + 3000;
  pollOrders(); // sets the baseline immediately (no alert on first run)
  // Realtime: refresh the floor the instant an order/dish changes, instead of
  // polling every second. Slow 60s timer is the backup if the WebSocket drops;
  // if realtime didn't load, fall back to a gentle 2s poll.
  if (window.LFH_RT) {
    // Split by topic: ops churn → cheap pollOrders(); menu content edits (dishes,
    // categories, filters, settings) → loadAll() so the dish lists refresh live too.
    LFH_RT.start({ handlers: {
      // TARGETED when the breadcrumb names specific tables; FULL otherwise (platform
      // change, wake, reconnect, initial). The full path also refreshes the Platform
      // tab badge — a dine-in table event can't have changed a platform order, so the
      // targeted path skips that extra fetch too.
      ops: (detail) => {
        if (detail && !detail.full && detail.tables && detail.tables.length) pollTables(detail.tables);
        else if (Date.now() >= rtBootGraceUntil) { pollOrders(); loadPlatform(); } // else: boot already loaded it
        // Pay Later view open? A park or collect touches orders → refresh the book LIVE
        // (loadKhataBook self-guards against overlap; one scoped read per event burst).
        if (state.tab === "orders" && ordersViewKey() === "khata") { state.khataLoadedAt = 0; loadKhataBook(); }
      },
      menu: () => { if (Date.now() >= rtBootGraceUntil) loadAll(); }, // boot already loaded the menu
    }});
    setInterval(() => { if (document.hidden) return; pollOrders(); loadPlatform(); }, 60000); // backup sync; skip on a hidden/backgrounded tab (realtime refetches on wake) so an idle tab stops costing egress (B18)
  } else {
    setInterval(() => { if (document.hidden) return; pollOrders(); loadPlatform(); }, 2000); // fallback poll (realtime down); paused while hidden (B18)
  }
}

// --- final wiring: connect the static page controls and start everything up ---
// Keep the floating popups' fixed slots positioned when the window resizes.
// Keep the floating row laid out on resize; crossing the phone/desktop breakpoint (rotate,
// window resize) needs a FULL re-render (the markup itself differs: side panel vs popup-only,
// Dock button, drag handles) — and entering phone mode keeps only the newest popup, unpinned.
let lfhWasPhone = isPhoneLayout();
window.addEventListener("resize", () => {
  const nowPhone = isPhoneLayout();
  if (nowPhone !== lfhWasPhone) {
    lfhWasPhone = nowPhone;
    if (nowPhone && state.floatingTables.length) {
      state.floatingTables = [Object.assign(state.floatingTables[state.floatingTables.length - 1], { pinned: false, slot: 0, x: null, y: null, w: null, h: null })];
      state.floatCols = 1;
    }
    renderEditor();
    return;
  }
  if (state.floatingTables.length) layoutFloatingRow();
});
// ---- Auto-fitting top nav (2026-07-29) ----
// With Banquet + Ratings on there are NINE tabs; brand + tabs + the right-hand actions
// then need ~1500px, so on a laptop or a narrowed window the strip used to side-scroll
// silently and slice a tab in half ("Platf…") with the rest unreachable. A hard-coded
// breakpoint can't solve that (the strip's width depends on how many tabs the restaurant
// actually has), so MEASURE and pick the roomiest mode that still shows EVERY tab:
//   nothing      → the strip fits as-is (normal desktop look)
//   .nav-tight   → tighter pills + restaurant name hidden, and now it fits
//   .nav-compact → it can't fit at any size → the ☰ drawer (phones always land here)
// Each candidate is applied and re-measured in the SAME frame: the browser reflows but
// never paints an in-between state, so there is no flicker and no guesswork.
// This REPLACES the fixed <=1279px drawer breakpoint from PR #527 and keeps its promise:
// a touch device (Aangan's tablet) skips the tight stage entirely and goes to the drawer,
// because shrinking the pills would leave fiddly tap targets instead of 44px rows.
let navFitBusy = false;
function syncNavFit() {
  const bar = document.querySelector(".topbar");
  const tabs = document.getElementById("mainTabs");
  if (!bar || !tabs || navFitBusy) return;
  navFitBusy = true;
  try {
    const body = document.body;
    body.classList.add("nav-measuring"); // freeze bar transitions → measure settled sizes
    const set = (tight, compact) => {
      body.classList.toggle("nav-tight", tight);
      body.classList.toggle("nav-compact", compact);
      if (!compact) navDrawerSet(false); // leaving drawer mode with it open would strand the scrim
    };
    if (window.innerWidth <= 760) { set(false, true); return; }  // phone: always the drawer
    // Room the bar can give the strip = its inner width minus the brand and the actions.
    const room = () => {
      const cs = getComputedStyle(bar);
      const gap = parseFloat(cs.columnGap) || 0;
      const w = (el) => (el ? el.getBoundingClientRect().width : 0);
      return bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
        - w(bar.querySelector(".brand")) - w(bar.querySelector(".top-actions")) - gap * 2 - 4;
    };
    const touch = window.matchMedia("(pointer: coarse)").matches;
    set(false, false);
    if (tabs.scrollWidth <= room()) return;   // fits as-is
    if (!touch) {
      set(true, false);
      if (tabs.scrollWidth <= room()) return; // fits once tightened (mouse only)
    }
    set(false, true);                         // → drawer
  } finally {
    document.body.classList.remove("nav-measuring");
    navFitBusy = false;
  }
}
// Re-fit on the next frame, never straight inside an observer callback (changing layout
// from inside a ResizeObserver is what produces the "ResizeObserver loop" console noise).
let navFitQueued = false;
function queueNavFit() {
  if (navFitQueued) return;
  navFitQueued = true;
  requestAnimationFrame(() => { navFitQueued = false; syncNavFit(); });
}
{
  const tabs = document.getElementById("mainTabs");
  const bar = document.querySelector(".topbar");
  // Re-fit when the bar resizes (window/iframe/sidebar) AND when the tab set itself
  // changes — Banquet un-hides and the red badges appear only after settings/orders load.
  // Watch the bar's CHILDREN too, not just the bar: the connection pill / Profile button
  // are mounted by other scripts a second after boot and the bar's own box never changes,
  // so watching only .topbar left the panel stuck in the wrong mode until the next resize.
  const acts = bar && bar.querySelector(".top-actions");
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(queueNavFit);
    [bar, acts, tabs, bar && bar.querySelector(".brand")].forEach((el) => el && ro.observe(el));
  }
  if (acts && window.MutationObserver) new MutationObserver(queueNavFit).observe(acts, { childList: true });
  if (tabs && window.MutationObserver) {
    // NOT "class": setTab flips .active on every tab click and that never changes widths.
    new MutationObserver(queueNavFit).observe(tabs, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style"] });
  }
  window.addEventListener("resize", queueNavFit);
  window.addEventListener("load", queueNavFit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueNavFit); // the display font lands late and changes every tab's width
  syncNavFit();
}

// ---- Nav drawer (phones, and any width where the tabs can't fit) ----
// The ☰ button slides the .tabs nav in from the left as a drawer (CSS does the
// showing/hiding off body.nav-open; here we just flip that class). Registered with
// LFH_BACK so the phone's hardware BACK closes the drawer instead of leaving the
// panel (project rule: every overlay is a back step). On desktop the burger is
// display:none so none of this ever fires.
let navBackOff = null; // unregister handle while the drawer is open (idempotent)
function navDrawerSet(open) {
  if (open === document.body.classList.contains("nav-open")) return;
  document.body.classList.toggle("nav-open", open);
  const burger = document.getElementById("navBurger");
  if (burger) burger.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    if (window.LFH_BACK && !navBackOff) navBackOff = LFH_BACK.layer("nav-drawer", () => navDrawerSet(false));
  } else if (navBackOff) {
    const off = navBackOff; navBackOff = null; off(); // safe even when BACK itself closed it
  }
}
{
  const burger = document.getElementById("navBurger");
  if (burger) burger.onclick = () => navDrawerSet(!document.body.classList.contains("nav-open"));
  const scrim = document.getElementById("navScrim");
  if (scrim) scrim.onclick = () => navDrawerSet(false);
  const close = document.getElementById("navClose");
  if (close) close.onclick = () => navDrawerSet(false);
  // crossing the phone breakpoint → re-decide the nav mode (syncNavFit closes an open
  // drawer itself whenever the tabs go back into the bar)
  window.matchMedia("(max-width: 760px)").addEventListener("change", () => syncNavFit());
}
// Top tabs + Editor sub-nav switch views — but first guard any unsaved edits.
document.querySelectorAll(".tab").forEach((t) => (t.onclick = async () => { if (await confirmDiscardIfDirty()) { setTab(t.dataset.tab); navDrawerSet(false); } }));
document.querySelectorAll(".subtab").forEach((t) => (t.onclick = async () => { if (await confirmDiscardIfDirty()) setTab(t.dataset.tab); }));
$("#newBtn").onclick = async () => { if (await confirmDiscardIfDirty()) newRecord(); }; // the "+ New" button
// Dishes multi-select toggle.
{ const bb = document.getElementById("bulkBtn"); if (bb) bb.onclick = () => { state.bulkMode = !state.bulkMode; state.bulkSel.clear(); syncBulkBtn(); renderList(); }; }
// Last-ditch guard: refresh / close-tab while a form has unsaved edits → browser prompt.
window.addEventListener("beforeunload", (e) => { if (editorDirty()) { e.preventDefault(); e.returnValue = ""; } });
{ const _ib = document.getElementById("reportIssueBtn"); if (_ib) _ib.onclick = openIssueModal; } // 🚩 report an issue

// Drag the left sidebar's right edge to resize it (width persists across reloads).
(function () {
  const layout = document.querySelector(".layout");
  const rz = document.getElementById("sidebarResizer");
  if (!layout || !rz) return;
  try { const saved = localStorage.getItem("lfh_editor_sidebar_w"); if (saved) layout.style.setProperty("--sidebar-w", saved + "px"); } catch {}
  rz.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { rz.setPointerCapture(e.pointerId); } catch {}
    const move = (ev) => { const w = Math.min(560, Math.max(220, ev.clientX)); layout.style.setProperty("--sidebar-w", w + "px"); try { localStorage.setItem("lfh_editor_sidebar_w", String(w)); } catch {} };
    const up = () => { rz.removeEventListener("pointermove", move); rz.removeEventListener("pointerup", up); };
    rz.addEventListener("pointermove", move);
    rz.addEventListener("pointerup", up);
  });
})();
// Typing in the search box filters the left-hand list live AND shows a suggestions
// dropdown of the top matches (click / ↑↓ + Enter to open one in the editor).
(() => {
  const box = $("#search");
  box.oninput = (e) => { state.search = e.target.value; renderList(); renderSearchSuggest(); };
  box.addEventListener("focus", () => { if ((state.search || "").trim()) renderSearchSuggest(); });
  // A short delay lets a suggestion's mousedown land before we close (belt-and-braces).
  box.addEventListener("blur", () => setTimeout(closeSuggest, 120));
  box.addEventListener("keydown", (e) => {
    const dd = document.getElementById("searchSuggest");
    if (!dd || dd.hidden || !_suggestMatches.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); _suggestIdx = Math.min(_suggestMatches.length - 1, _suggestIdx + 1); paintSuggestActive(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); _suggestIdx = Math.max(0, _suggestIdx - 1); paintSuggestActive(); }
    else if (e.key === "Enter") { e.preventDefault(); openSuggestion(_suggestMatches[_suggestIdx] || _suggestMatches[0]); }
    else if (e.key === "Escape") { closeSuggest(); }
  });
})();
// Ctrl+S (or Cmd+S on Mac) saves the current record instead of saving the web page.
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (state.sel) save();
    return;
  }
  // Power-user shortcuts — desktop only, and ONLY when you're not typing in a field or a
  // modal is open, so they never swallow a keystroke. (Ctrl/Cmd+S above still saves.)
  const el = document.activeElement;
  const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  const modalOpen = document.querySelector(".sx-modal-overlay, .confirm-overlay, .bill-overlay, .disc-overlay, .pay-overlay");
  if (typing || modalOpen || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "/") { // focus the search box
    const sb = document.getElementById("search");
    if (sb && sb.style.display !== "none") { e.preventDefault(); sb.focus(); sb.select && sb.select(); }
    return;
  }
  if (e.key.toLowerCase() === "n") { // + New (only on a list tab where it's shown)
    const nb = document.getElementById("newBtn");
    if (nb && nb.style.display !== "none") { e.preventDefault(); nb.click(); }
    return;
  }
  if (/^[1-9]$/.test(e.key)) { // jump to the Nth visible top tab
    const tabs = [...document.querySelectorAll(".tabs .tab")].filter((t) => !t.hidden && t.offsetParent !== null);
    const idx = Number(e.key) - 1;
    if (tabs[idx]) { e.preventDefault(); tabs[idx].click(); }
  }
});

// THE STARTING POINT.
// First, open the saved tab IMMEDIATELY — before any data has loaded. This is what
// stops the old "refresh flashes Dishes, then jumps to your real tab" bug: setTab
// used to run only after loadAll() finished, so you stared at the default tab for
// the whole network round-trip. Now the correct tab is shown right away (empty for
// a moment), and the data fills into it when it arrives.
setTab(state.tab);

// ── Hardware BACK button ↔ modals ────────────────────────────────────────────
// The manager panel opens ~10 different modals ad-hoc (appendChild + .remove()) and
// never wired any of them to the phone's BACK button, so Back left the whole panel
// mid-action instead of closing the open modal (bug 2026-07-06). Rather than hand-wire
// each open/close (and risk missing one, now or in future), a single adapter WATCHES
// the DOM: when an overlay appears it registers a back layer that closes it; when the
// overlay is removed (by ✕ / backdrop / Esc / completion OR by a back press) it drops
// the layer. Every editor overlay carries one of these classes, so this covers them all
// AND any future modal that follows the same convention. Uses the sanctioned LFH_BACK
// API (backstack.js) — no hand-rolled history in here.
(function wireOverlayBack() {
  if (!window.LFH_BACK || !document.body) return;
  const SEL = ".sx-modal-overlay, .bill-overlay, .confirm-overlay, .disc-overlay, .pay-overlay";
  const off = new WeakMap(); // overlay element → its LFH_BACK unregister fn
  // Prefer the overlay's OWN closer (elm.__lfhClose) when it has one — a bare elm.remove()
  // skipped confirmDialog/issue-modal cleanup, leaving the awaited promise unresolved and a
  // document keydown listener leaked on every phone-Back (2026-07-06). Fall back to remove().
  const track = (elm) => { if (off.has(elm)) return; off.set(elm, LFH_BACK.layer("editor-modal", () => { try { elm.__lfhClose ? elm.__lfhClose() : elm.remove(); } catch (e) {} })); };
  const untrack = (elm) => { const fn = off.get(elm); if (fn) { off.delete(elm); fn(); } };
  const matches = (n) => n.nodeType === 1 && typeof n.matches === "function" && n.matches(SEL);
  new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach((n) => { if (matches(n)) track(n); });
      m.removedNodes.forEach((n) => { if (n.nodeType === 1 && off.has(n)) untrack(n); });
    }
  }).observe(document.body, { childList: true });
})();

// ══════════════════════════════════════════════════════════════════════════════
// HIERARCHY X-RAY (2026-07-05, refined) — the same panel renders differently by WHO
// opened it:
//   • the real MANAGER (own login): a feature the owner turned OFF is HIDDEN entirely.
//   • a HIGHER role viewing in (admin / owner): that feature stays FULLY USABLE but is
//     tinted (colour label only, NOT a lock) so you can see it's off for the staff
//     below you. A faded top ribbon (like the owner panel) marks the admin view and a
//     top-right popout lists every tinted zone; clicking one scrolls to it and points
//     at the setting that controls it. The server still enforces every capability —
//     this is purely presentation.
// ══════════════════════════════════════════════════════════════════════════════
// BANQUET MODULE (mig 130) — a SEPARATE bill-only menu for fixed-plate events.
// The tab exists only when the admin entitlement (settings.banquet_allowed) is on
// (syncBanquetTab). Left card: the banquet menu (CRUD, priced per plate). Right
// card: the bill builder — pick a table, set plate counts, one tap lands a normal
// order on that table at 'served' (no kitchen ticket), and the existing Tables
// billing flow (invoice / discount / mark paid) takes over.
// ══════════════════════════════════════════════════════════════════════════════
async function loadBanquet() {
  try {
    const r = await api("GET", "/banquet/items");
    state.banquet.items = r.items || [];
  } catch (e) {
    state.banquet.items = [];
    toast("Couldn't load the banquet menu: " + e.message, "err");
  }
  state.banquet.loaded = true;
  if (state.tab === "banquet") renderEditor();
}

function banquetHtml() {
  const bq = state.banquet;
  if (!bq.loaded) return `<div class="ed-head"><h2>🎪 Banquet</h2></div><div class="empty">Loading the banquet menu…</div>`;
  const tm = taxModel(state.data.settings);
  const rows = bq.items.map((it) => `
    <div class="bq-row${it.active ? "" : " bq-off"}" data-bq-id="${esc(it.id)}" style="display:grid;grid-template-columns:1fr 110px 130px auto auto;gap:8px;align-items:center;padding:8px 10px;border-radius:9px;background:var(--panel-2);margin-bottom:8px${it.active ? "" : ";opacity:.55"}">
      <input class="sx-input" data-bq-f="title" value="${esc(it.title)}" placeholder="Item name" />
      <input class="sx-input" data-bq-f="price" type="number" min="0" step="1" value="${esc(String(it.price))}" title="Price per unit (₹)" />
      <input class="sx-input" data-bq-f="unit" value="${esc(it.unit || "per plate")}" placeholder="per plate" title='Shown on the bill after the name, e.g. "per plate"' />
      <button class="btn small" data-bq-toggle title="${it.active ? "Hide from the bill builder" : "Show in the bill builder"}">${it.active ? "On" : "Off"}</button>
      <button class="btn small danger" data-bq-del title="Delete">🗑</button>
    </div>`).join("");
  const activeItems = bq.items.filter((it) => it.active);
  let sub = 0;
  const lines = activeItems.map((it) => {
    const q = Math.max(0, Math.round(Number(bq.qty[it.id]) || 0));
    sub += q * (Number(it.price) || 0);
    return `<div style="display:grid;grid-template-columns:1fr 130px 110px;gap:8px;align-items:center;margin-bottom:8px">
      <div><b style="font-size:13.5px">${esc(it.title)}</b><small style="color:var(--muted);display:block">${inr(it.price)} ${esc(it.unit || "per plate")}</small></div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn small" data-bq-minus="${esc(it.id)}">−</button>
        <input class="sx-input" data-bq-qty="${esc(it.id)}" type="number" min="0" max="5000" value="${q}" style="width:64px;text-align:center" title="Plates / count" />
        <button class="btn small" data-bq-plus="${esc(it.id)}">+</button>
      </div>
      <div style="text-align:right;font-weight:700">${q ? inr(q * (Number(it.price) || 0)) : "—"}</div>
    </div>`;
  }).join("");
  const tax = Math.round(sub * tm.rate * 100) / 100;
  const tableCount = Number((state.data.settings || {}).table_count) || 0;
  return `<div class="ed-head"><h2>🎪 Banquet</h2><button class="btn" id="bqRefresh">↻ Refresh</button></div>
  <div class="grid cols-2" style="align-items:start;gap:14px">
    <div class="card">
      <h3>Banquet menu</h3>
      <p style="color:var(--muted);font-size:13px;margin:0 0 12px;line-height:1.5">
        Separate from the dining menu — these lines exist ONLY to build banquet bills
        (price per plate × guests). Guests never see them.</p>
      ${rows || `<div class="sx-empty">No banquet items yet — add the first one below.</div>`}
      <div style="display:grid;grid-template-columns:1fr 110px auto;gap:8px;margin-top:10px">
        <input class="sx-input" id="bqNewTitle" placeholder="New item — e.g. Gujarati Thali" />
        <input class="sx-input" id="bqNewPrice" type="number" min="0" step="1" placeholder="₹ / plate" />
        <button class="btn primary" id="bqAdd">+ Add</button>
      </div>
    </div>
    <div class="card">
      <h3>Generate a banquet bill</h3>
      <p style="color:var(--muted);font-size:13px;margin:0 0 12px;line-height:1.5">
        Set the plate counts and create — the bill appears under <b>Bills</b> (no kitchen
        ticket) for invoice / discount / mark paid. A table is optional: set one only if
        the party actually occupies a floor table.</p>
      ${activeItems.length ? lines : `<div class="sx-empty">Turn on at least one banquet item first.</div>`}
      <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding-top:12px;margin-top:6px">
        <div class="field" style="margin:0"><label style="font-size:11px">Table (optional)</label>
          <input class="sx-input" id="bqTable" type="number" min="1" ${tableCount ? `max="${tableCount}"` : ""} value="${esc(bq.table)}" placeholder="none" style="width:90px" /></div>
        <div style="text-align:right;font-size:13px">
          <div>Subtotal <b>${inr(sub)}</b></div>
          <div style="color:var(--muted)">${esc(taxLabel())} ${tm.pct}% · ${inr(tax)}</div>
          <div style="font-size:15px;margin-top:2px">Total <b>${inr(sub + tax)}</b></div>
        </div>
      </div>
      <button class="btn primary" id="bqPlace" style="width:100%;margin-top:12px" ${sub > 0 ? "" : "disabled"}>🧾 Create the bill</button>
    </div>
  </div>`;
}

function bindBanquet() {
  const ed = $("#editor");
  const bq = state.banquet;
  const rf = document.getElementById("bqRefresh");
  if (rf) rf.onclick = () => { bq.loaded = false; renderEditor(); };
  // Menu card — save a row's edits on change (title/price/unit), toggle, delete.
  ed.querySelectorAll("[data-bq-id]").forEach((row) => {
    const id = row.dataset.bqId;
    const item = bq.items.find((i) => i.id === id);
    if (!item) return;
    // Track in-flight row saves so "Create the bill" can WAIT for them — otherwise editing a
    // price then immediately creating a bill placed it at the OLD price (the place RPC re-prices
    // from the DB, and the row save was still travelling).
    bq._pending = bq._pending || new Set();
    const save = (patch) => {
      const p = (async () => {
        try {
          const saved = await api("POST", "/banquet/item-save", { id, title: item.title, price: item.price, unit: item.unit, active: item.active, sort_order: item.sort_order, ...patch });
          Object.assign(item, saved);
          renderEditor();
        } catch (e) { toast("Couldn't save: " + e.message, "err"); }
      })();
      bq._pending.add(p); p.finally(() => bq._pending.delete(p));
      return p;
    };
    row.querySelectorAll("[data-bq-f]").forEach((inp) => {
      // Keep the local item live as you type so the bill total reflects the edit immediately.
      inp.oninput = () => { const f = inp.dataset.bqF; item[f] = f === "price" ? Number(inp.value) || 0 : inp.value; };
      inp.onchange = () => save({ [inp.dataset.bqF]: inp.dataset.bqF === "price" ? Number(inp.value) || 0 : inp.value });
    });
    row.querySelector("[data-bq-toggle]").onclick = () => save({ active: !item.active });
    row.querySelector("[data-bq-del]").onclick = async () => {
      if (!(await confirmDialog(`Delete "${item.title}" from the banquet menu?`, "Delete"))) return;
      try {
        await api("POST", "/banquet/item-delete", { id });
        bq.items = bq.items.filter((i) => i.id !== id);
        delete bq.qty[id];
        renderEditor();
        toast("Deleted", "ok");
      } catch (e) { toast("Couldn't delete: " + e.message, "err"); }
    };
  });
  const add = document.getElementById("bqAdd");
  if (add) add.onclick = async () => {
    const title = (document.getElementById("bqNewTitle").value || "").trim();
    const price = Number(document.getElementById("bqNewPrice").value) || 0;
    if (!title) { toast("Give the item a name.", "err"); return; }
    try {
      const row = await api("POST", "/banquet/item-save", { title, price, unit: "per plate", active: true, sort_order: bq.items.length + 1 });
      bq.items.push(row);
      renderEditor();
      toast("Added", "ok");
    } catch (e) { toast("Couldn't add: " + e.message, "err"); }
  };
  // Bill-builder card — qty steppers re-render for the live total.
  const setQty = (id, v) => { bq.qty[id] = Math.max(0, Math.min(5000, Math.round(Number(v) || 0))); renderEditor(); };
  ed.querySelectorAll("[data-bq-qty]").forEach((inp) => { inp.onchange = () => setQty(inp.dataset.bqQty, inp.value); });
  ed.querySelectorAll("[data-bq-minus]").forEach((b) => { b.onclick = () => setQty(b.dataset.bqMinus, (Number(bq.qty[b.dataset.bqMinus]) || 0) - 1); });
  ed.querySelectorAll("[data-bq-plus]").forEach((b) => { b.onclick = () => setQty(b.dataset.bqPlus, (Number(bq.qty[b.dataset.bqPlus]) || 0) + 1); });
  const tableInp = document.getElementById("bqTable");
  if (tableInp) tableInp.onchange = () => { bq.table = tableInp.value; };
  const place = document.getElementById("bqPlace");
  if (place) place.onclick = async () => {
    const linesOut = state.banquet.items.filter((i) => i.active && (Number(bq.qty[i.id]) || 0) > 0)
      .map((i) => ({ id: i.id, qty: Math.round(Number(bq.qty[i.id])) }));
    const t = String((tableInp && tableInp.value) || "").trim();
    if (!linesOut.length) { toast("Set a plate count on at least one item.", "err"); return; }
    if (t && !/^\d+$/.test(t)) { toast("That table number doesn't look right — or leave it blank.", "err"); return; }
    place.disabled = true;
    try {
      // Wait for any in-flight menu-row edit (price/title) so the bill is priced from the
      // latest saved values, not a half-committed one.
      if (bq._pending && bq._pending.size) await Promise.allSettled([...bq._pending]);
      const r = await api("POST", "/banquet/place", { table: t, lines: linesOut });
      bq.qty = {}; bq.table = t;
      toast(`Banquet bill created${t ? ` on table ${t}` : ""} — total ${inr(r.total)}.`, "ok");
      // With a table it's a normal open table (settle from Tables); without, it's a
      // standalone bill — send the manager straight to where it now lives.
      setTab(t ? "tables" : "orders");
    } catch (e) {
      toast("Couldn't create the bill: " + e.message, "err");
      place.disabled = false;
    }
  };
}

// Show/hide the Banquet tab from the entitlement — called after every loadAll so
// an admin grant appears on the manager's next refresh without a deploy. If the
// remembered tab IS banquet but the module got revoked, fall back to Dishes.
function syncBanquetTab() {
  const btn = document.querySelector('.tabs .tab[data-tab="banquet"]');
  if (!btn) return;
  // Full ladder (mig 167): admin switch AND (owner's toggle when transferred) AND —
  // for a real manager — the owner->manager grant (higher roles see it regardless,
  // matching the server's managerCan pass-through for admin/owner).
  const s = state.data.settings || {};
  const eff = s.banquet_allowed === true && (s.banquet_owner_control !== true || s.banquet_enabled !== false);
  const granted = !XRAY_WHO || XRAY_WHO.higherView || xrayGrantedForManager("banquet");
  const show = eff && granted;
  btn.hidden = !show;
  if (!show && state.tab === "banquet") setTab("items");
}

// Show/hide the Platform tab from the modules (mig 209). The 🛵 board shows delivery orders
// (platform module) AND/OR staff parcels (parcel module), so the tab is visible when EITHER is
// effective. A real manager also needs the matching owner→manager grant; admin/owner (higherView)
// always see it. If the remembered tab is Platform but both modules got revoked, fall back to floor.
function syncPlatformTab() {
  const btn = document.querySelector('.tabs .tab[data-tab="platform"]');
  if (!btn) return;
  const s = state.data.settings || {};
  const platEff = s.platform_allowed === true && (s.platform_owner_control !== true || s.platform_enabled !== false);
  const parcelEff = s.parcel_allowed === true && (s.parcel_owner_control !== true || s.parcel_enabled !== false);
  const higher = !XRAY_WHO || XRAY_WHO.higherView;
  // Granted if a higher role, OR the manager has EITHER power for whichever module is on.
  const granted = higher || (platEff && xrayGrantedForManager("platform")) || (parcelEff && xrayGrantedForManager("parcel"));
  const show = (platEff || parcelEff) && granted;
  btn.hidden = !show;
  if (!show && state.tab === "platform") setTab("tables");
}

// Show/hide the 📦 Inventory tab from the inventory module (mig 221). Same ladder shape as
// banquet: admin switch AND (owner's toggle when transferred) AND — for a real manager —
// EITHER owner→manager grant (inv_stock runs the stock register, inv_expenses records
// expenses; the tab's sub-views hide individually via /api/inventory/whoami).
function syncInventoryTab() {
  if (INV_ONLY) return; // owner embed: the tab IS the panel; the server gates every call anyway
  const btn = document.querySelector('.tabs .tab[data-tab="inventory"]');
  if (!btn) return;
  const s = state.data.settings || {};
  const eff = s.inventory_allowed === true && (s.inventory_owner_control !== true || s.inventory_enabled !== false);
  const granted = !XRAY_WHO || XRAY_WHO.higherView || xrayGrantedForManager("inv_stock") || xrayGrantedForManager("inv_expenses");
  const show = eff && granted;
  btn.hidden = !show;
  if (!show && state.tab === "inventory") setTab("items");
}

// Extend XRAY_TABS as more tabs become permission-gated. Grant rule matches the
// server's managerCan(): a manager is granted ONLY when the flag is explicitly true.
// ══════════════════════════════════════════════════════════════════════════════
const XRAY_TABS = [
  { tab: "dash", flag: "view_dashboard", label: "Dashboard" },
  // NOTE: the "items" (Editor) tab is deliberately NOT here — instead of vanishing when
  // edit_menu is off it flips to a read-only "View menu" (owner 2026-07-25). That is
  // handled by applyMenuReadonly() below, called from applyHierarchyView.
  { tab: "ratings", flag: "view_ratings", label: "Guest ratings" },
  { tab: "general", flag: "edit_settings", label: "Settings" },
  // Activity log (owner 2026-07-26): the "Activity log" manager power now hides the Log tab
  // for a real manager when it's revoked, instead of the tab lingering and its contents
  // 403-ing. view_logs is ABSENT-means-ON (whoami resolves effectivePowers.view_logs=true by
  // default), so this is non-breaking — the tab only disappears once the owner explicitly
  // switches it off; admin/owner keep it (tinted).
  { tab: "log", flag: "view_logs", label: "Activity log" },
];
// Phase 2 (the ladder, 2026-07-06): permission-gated CONTROLS inside tabs. Matched by
// CSS selector on every repaint (MutationObserver below), so a live-poll re-render can
// never resurrect a hidden button. Same rule as tabs: hidden for the real manager,
// tinted for a higher role. The server enforces each flag regardless (managerCan).
const XRAY_CONTROLS = [
  { selector: "[data-take-order]", flag: "take_orders", label: "Take orders" },
  { selector: "[data-new-parcel]", flag: "parcel", label: "New parcel" },
  { selector: "[data-disc]", flag: "give_discounts", label: "Give discounts" },
  { selector: "[data-void-invoice]", flag: "void_bills", label: "Void / reopen bills" },
  { selector: "#sxKot", flag: "table_ops", label: "Table & KOT operations" },
  { selector: '.list-item[data-settings-section="users"]', flag: "manage_staff", label: "User settings" },
  { selector: '.list-item[data-settings-section="access"]', flag: "manage_staff", label: "Access settings" },
  // ADMIN/OWNER-only settings (owner 2026-07-28, extended 2026-07-29): a real manager only
  // handles per-table name + seats. Billing, KOT printing, dining sessions, the table COUNT
  // and the guest QR links are set from the admin panel
  // (components/admin/RestaurantSettings.tsx). "admin_only_setting" is never a real manager
  // power, so these HIDE for the manager and stay tinted-but-usable for a higher role
  // (admin/owner) looking in — same pattern as Users/Access above.
  { selector: '.list-item[data-settings-section="billing"]', flag: "admin_only_setting", label: "Billing settings" },
  { selector: '.list-item[data-settings-section="kitchen"]', flag: "admin_only_setting", label: "Kitchen settings" },
  { selector: '.list-item[data-settings-section="sessions"]', flag: "admin_only_setting", label: "Dining sessions" },
  { selector: '[data-mgr-hide="table_count"]', flag: "admin_only_setting", label: "Number of tables" },
  { selector: '[data-mgr-hide="table_qr"]', flag: "admin_only_setting", label: "Guest QR links per table" },
  // Waiter sections (mig 222) — a REAL manager power, so it follows the normal rule:
  // hidden when the owner hasn't granted it (or the admin hasn't turned the module on,
  // which whoami already folds into effectivePowers), tinted-but-working for a higher
  // role looking in. Same shape as #sxKot / table_ops above.
  { selector: '[data-mgr-hide="table_sections"]', flag: "table_assign", label: "Who serves which table" },
  // TODAY-ONLY dashboard for a real manager (owner 2026-07-29): the 30-day and 12-month
  // views are admin/owner reporting surfaces, so their sub-nav rows disappear for a manager
  // (and in the actual-manager-view mode). "higher_only_view" has NO admin switch on purpose
  // — it isn't a toggle, it's who the screen belongs to — so the zones list shows no
  // "⚙ change" link for it. The server clamps the range too (app/api/editor stats).
  { selector: '[data-dash-range="30d"]', flag: "higher_only_view", label: "30-day dashboard" },
  { selector: '[data-dash-range="year"]', flag: "higher_only_view", label: "12-month dashboard" },
];
// The two SYNTHETIC flags above are never real manager powers (whoami never returns them, so
// xrayGrantedForManager is always false for them). This maps each to honest words + whether a
// higher role can jump to a control for it, instead of the plain-power "turned off by the
// owner" wording, which was wrong for them (nobody switched these off — they're admin-owned).
const XRAY_NEVER = {
  admin_only_setting: { by: "admin only", why: "it's set from the admin panel", settable: true },
  higher_only_view: { by: "admin / owner only", why: "the manager panel only shows today", settable: false },
};
// `var`, not `let`: this is read by render/permission helpers defined FAR earlier
// in the file (canDeleteBill, platformHtml, the Bills sub-nav…). With `let`, boot's
// setTab(state.tab) → renderEditor() runs BEFORE this line and hit the temporal dead
// zone, throwing "Cannot access 'XRAY_WHO' before initialization" — which killed the
// **Bills (orders) and Platform tabs** (verified against a control; Tables was fine).
// `var` hoists, so an early read safely sees undefined instead.
var XRAY_WHO = null;

// Where "change this" points: the admin jumps to the Access hub deep-linked to the EXACT
// control (?focus=<flag> — the Access page scrolls to it and flashes it, owner 2026-07-28);
// an owner jumps to their own Staff & powers page focused on the exact toggle. Admin-only
// settings (billing/KOT/sessions/table count) have no Access-page card — their home is the
// restaurant detail's ⚙ Settings tab on /aevinite/restaurants.
function xraySettingUrl(flag) {
  if (XRAY_WHO && XRAY_WHO.actor === "admin") {
    if (flag === "admin_only_setting")
      return `/aevinite/restaurants?focus=${encodeURIComponent(PANEL_RID)}&tab=settings`;
    return `/aevinite/access${PANEL_RID ? `?rid=${encodeURIComponent(PANEL_RID)}&` : "?"}focus=${encodeURIComponent(flag)}`;
  }
  return `/owner/staff?focus=${encodeURIComponent(flag)}`;
}

(function injectXrayStyles() {
  const css = `
  /* HIDDEN MEANS GONE. A .list-item has an explicit display:flex in style.css, which
     OVERRIDES the browser's built-in [hidden]{display:none} — so every sidebar row the
     X-ray hid (Billing / Kitchen / Dining sessions / Users / Access, and the dashboard's
     30-day + Year rows) stayed fully VISIBLE for the real manager and in the actual-view
     mode; tapping one just snapped back, which read as "there but broken" (owner
     2026-07-29). Same trap as .field[hidden] below. Force it for every element the X-ray
     hides, whatever its own display is. */
  .list-item[hidden], .card[hidden], .tab[hidden], .subtab[hidden], [data-mgr-hide][hidden] { display: none !important; }
  /* GREYED OUT (off-for-staff) — a neutral mid-grey cue, clearly dimmer than enabled
     controls but never near-black; stays fully clickable for the higher role (owner
     2026-07-28: "grey, not golden"). Generic since Phase 2: tabs AND in-tab controls. */
  .xray-off { position: relative; color: #8b919c !important; opacity: .55; filter: grayscale(1); }
  .xray-off::after { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%;
    background: #9aa0a6; margin-left: 6px; vertical-align: middle; }
  /* A FILLED button (primary/gold or pay/green) greys out the same way — grayscale drains
     the fill so it reads "not available here" at a glance, while staying clickable and
     readable for the admin/owner looking in. */
  .btn.primary.xray-off, .tp-take-order.xray-off, .btn.pay.xray-off, .btn.green.xray-off {
    opacity: .6 !important; filter: grayscale(1);
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, #6b7280 55%, transparent); }
  .xray-pulse { animation: xrayPulse 1.1s ease-out 2; border-radius: 8px; }
  @keyframes xrayPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(217,119,6,0); } 50% { box-shadow: 0 0 0 4px rgba(217,119,6,.55); } }
  /* Faded admin ribbon across the very top — flows above the sticky topbar. */
  #xrayRibbon { display: flex; align-items: center; gap: 12px; padding: 6px 16px;
    background: color-mix(in srgb, #d97706 12%, var(--panel, #fff)); border-bottom: 1px solid color-mix(in srgb, #d97706 40%, transparent);
    font-family: system-ui, sans-serif; font-size: 12px; color: var(--text, #222); position: relative; z-index: 40; }
  #xrayRibbon .rb-tag { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; letter-spacing: .04em;
    color: #b45309; text-transform: uppercase; font-size: 11px; }
  #xrayRibbon .rb-rest { color: var(--muted, #777); font-weight: 600; }
  #xrayRibbon .rb-crumbs { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; flex-wrap: wrap; }
  #xrayRibbon .rb-crumbs a { color: #b45309; text-decoration: none; cursor: pointer; }
  #xrayRibbon .rb-crumbs a:hover { text-decoration: underline; }
  #xrayRibbon .rb-sep { font-size: 9px; color: var(--muted, #888); }
  #xrayRibbon .rb-spacer { margin-left: auto; }
  #xrayRibbon button { font: inherit; cursor: pointer; border-radius: 999px; border: 1px solid color-mix(in srgb, #d97706 45%, transparent);
    background: transparent; color: #b45309; font-weight: 700; padding: 4px 12px; }
  #xrayRibbon button.rb-exit { border-color: var(--line, #ddd); color: var(--muted, #777); }
  #xrayZones { position: absolute; top: calc(100% + 4px); right: 12px; z-index: 60; min-width: 240px;
    background: var(--panel, #fff); border: 1px solid var(--line, #ddd); border-radius: 12px; padding: 6px;
    box-shadow: 0 12px 32px rgba(0,0,0,.18); }
  #xrayZones .zh { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted,#888); padding: 6px 8px 4px; }
  #xrayZones .zrow { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: transparent;
    border: 0; border-radius: 8px; padding: 8px; font: inherit; font-size: 12.5px; color: var(--text,#222); cursor: pointer; }
  #xrayZones .zrow:hover { background: color-mix(in srgb, #d97706 12%, transparent); }
  #xrayZones .zrow .dot { width: 7px; height: 7px; border-radius: 50%; background: #d97706; flex-shrink: 0; }
  #xrayZones .zrow small { color: var(--muted,#888); margin-left: auto; }
  #xrayZones .zrow small.zgo { margin-left: 8px; color: #b45309; font-weight: 700; }
  #xrayZones .zrow small.zgo:hover { text-decoration: underline; }
  #xrayZones .zsep { height: 1px; margin: 6px 4px; background: var(--line, #ddd); }
  #xrayZones .zrow.zsim { font-weight: 700; }
  #xrayZones .zrow.zsim:hover { background: color-mix(in srgb, #6b7280 14%, transparent); }`;
  const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
})();

// Read-only "View menu" styling (owner 2026-07-25): hide the edit-only buttons, block
// the toggles/chips, dim the locked fields, and show a small view-only banner. Toggled
// by body.menu-readonly in applyMenuReadonly(); the server enforces edit_menu regardless.
(function injectMenuReadonlyStyles() {
  const css = `
  /* A .field wrapper has an explicit display, so the plain [hidden] attribute (UA
     display:none) is overridden — force it, so a permission-hidden field (e.g. Price for a
     manager without edit_price) actually disappears in BOTH the manager panel and the owner embed. */
  #editor .field[hidden] { display: none !important; }
  body.menu-readonly #newBtn,
  body.menu-readonly #bulkBtn,
  body.menu-readonly #saveBtn,
  body.menu-readonly #delBtn,
  body.menu-readonly .bulkbar { display: none !important; }
  body.menu-readonly #editor [data-action] { pointer-events: none !important; opacity: .55; }
  body.menu-readonly #editor input:disabled,
  body.menu-readonly #editor select:disabled,
  body.menu-readonly #editor textarea:disabled { opacity: .9; cursor: not-allowed; }
  body.menu-readonly #editor::before {
    content: "👁  View only — menu editing is turned off for you";
    display: block; margin: 0 0 12px; padding: 8px 12px; border-radius: 10px;
    background: color-mix(in srgb, #d97706 12%, var(--panel, #fff));
    border: 1px solid color-mix(in srgb, #d97706 40%, transparent);
    color: #b45309; font-weight: 700; font-size: 12.5px; }
  /* Menu-only embed (owner panel → Menu): drop the whole manager chrome (brand bar,
     Live/Profile/flag/theme/connection, every other top tab, the admin ribbon) so it
     looks native inside the owner panel. The Dishes/Categories/Tags subtabs live in the
     sidebar (kept), and the read-only "View only" banner conveys the mode. */
  body.menu-only .topbar { display: none !important; }
  body.menu-only #xrayRibbon { display: none !important; }
  /* ── OWNER SKIN remap ──────────────────────────────────────────────────────────
     The whole editor is themed off 8 CSS vars; point them at the OWNER panel's tokens
     (app/globals.css .adm) so the embed matches — violet on light, cyan-neon on dark —
     instead of the manager panel's gold. Set on <body> so it overrides both :root and
     html[data-theme] for every descendant. */
  body.menu-only.skin-light {
    --bg:#f6f7f9; --panel:#ffffff; --panel-2:#f2f4f7; --line:#e5e8ee;
    --text:#111827; --muted:#5b6474; --gold:#059669; --gold-strong:#10b981;
  }
  body.menu-only.skin-dark {
    --bg:#0a0c10; --panel:#10141b; --panel-2:#171d28; --line:#1d2430;
    --text:#e6ebf3; --muted:#9aa4b6; --gold:#10b981; --gold-strong:#34d399;
  }
  /* Kill the light theme's hardcoded cream body gradient so --bg shows through. */
  body.menu-only { background: var(--bg) !important; }
  /* Dark ink only on SOLID emerald fills (primary buttons, ticked checkbox). */
  body.menu-only .btn.primary,
  body.menu-only .list-item .bulk-cb.on { color:#04231a; }
  /* The active category chip has a subtle TINT bg (not a solid fill) → keep bright-green
     text + a readable fill so it never goes invisible on tap. */
  body.menu-only .cat-chip.active {
    background: color-mix(in srgb, var(--gold) 26%, var(--panel)) !important;
    color: var(--gold-strong) !important; border-color: var(--gold) !important;
  }
  /* Premium finish: rounder cards + the owner panel's soft elevation on light. */
  body.menu-only .card { border-radius:16px; padding:20px 22px; margin-bottom:16px; }
  body.menu-only.skin-light .card { box-shadow:0 1px 2px rgba(16,24,40,.05), 0 14px 30px -18px rgba(20,16,50,.20); }
  body.menu-only .card h3 { font-size:11.5px; letter-spacing:.7px; margin-bottom:16px; }
  /* ── Owner-embed premium polish (menu-only only; manager panel untouched) ──────── */
  /* Segmented Dishes/Categories/Tags */
  body.menu-only .subtabs{ padding:16px 16px 4px; gap:8px; }
  body.menu-only .subtab{ border-radius:12px; padding:11px 14px; font-weight:700; }
  /* Search + actions row: room to breathe */
  body.menu-only .sidebar-head{ padding:12px 16px; gap:10px; }
  body.menu-only .search{ border-radius:12px; padding:11px 13px; }
  body.menu-only #newBtn, body.menu-only #bulkBtn{ border-radius:12px; padding:10px 15px; }
  body.menu-only .cat-filter{ padding:12px 16px 14px; gap:8px; }
  /* List rows: card-like, comfortable, subtle hover slide + graceful bottom spacing */
  body.menu-only .list{ padding:10px 14px 30px; }
  body.menu-only .list-item{ padding:11px 10px; border-radius:14px; border:1px solid transparent; gap:12px; transition:background .14s, transform .14s, border-color .14s; }
  body.menu-only .list-item:hover{ background:var(--panel-2); transform:translateX(3px); }
  body.menu-only .list-item.active{ background:color-mix(in srgb, var(--gold) 12%, var(--panel-2)); border-color:var(--gold); }
  body.menu-only .list-item .thumb{ width:46px; height:46px; border-radius:12px; }
  body.menu-only .list-item .meta b{ font-size:14.5px; }
  /* Editor pane: roomier header + a generous, graceful bottom */
  body.menu-only .editor{ padding:0 32px 140px; }
  body.menu-only .ed-head{ padding-top:24px; padding-bottom:18px; }
  body.menu-only .ed-head h2{ font-size:27px; font-weight:800; letter-spacing:-.02em; }
  /* Empty state: bigger, centred, friendlier */
  body.menu-only .empty{ padding:110px 20px; font-size:15.5px; line-height:1.6; }
  body.menu-only .empty::before{ content:"🍽"; display:block; font-size:40px; opacity:.5; margin-bottom:14px; }
  /* Categories = ONE horizontal scrolling strip on top (not 4 wrapped rows), so the left
     column is almost entirely the dish list. Overrides the desktop wrap rule. A soft fade on
     the right edge hints there's more to scroll. */
  body.menu-only .cat-filter{ flex-wrap:nowrap !important; overflow-x:auto !important; padding:12px 16px !important;
    scrollbar-width:none; -webkit-mask-image:linear-gradient(90deg,#000 90%,transparent); mask-image:linear-gradient(90deg,#000 90%,transparent); }
  body.menu-only .cat-filter::-webkit-scrollbar{ display:none; }
  body.menu-only .cat-chip{ padding:8px 14px; }`;
  const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
})();

// The LADDER rule (mig 133): a power is granted only when the admin still entitles it
// AND the owner switched it on — the server resolves that into whoami.effectivePowers.
// (managerPermissions kept as the fallback for a stale cached app.js talking to an
// older server response.)
function xrayGrantedForManager(flag) {
  if (!XRAY_WHO) return true;
  if (XRAY_WHO.effectivePowers) return XRAY_WHO.effectivePowers[flag] === true;
  return !!(XRAY_WHO.managerPermissions && XRAY_WHO.managerPermissions[flag] === true);
}
// Who turned it off — names the right rung in the zone list + toast. The synthetic
// admin-owned flags (XRAY_NEVER) were never "switched off" by anyone, so they get their
// own words instead of a misleading "turned off by the owner".
function xrayOffBy(flag) {
  if (XRAY_NEVER[flag]) return XRAY_NEVER[flag].by;
  return XRAY_WHO && XRAY_WHO.offByAdmin && XRAY_WHO.offByAdmin[flag] ? "admin" : "owner";
}
// The tint tooltip for a higher role: says WHY it's off for staff and that they can still use it.
function xrayTintTitle(label, flag) {
  const nv = XRAY_NEVER[flag];
  if (nv) return `Not available to the manager — ${label} is ${nv.by} (${nv.why}). You can still use it from this view.`;
  return `Not available — ${label} isn't enabled for this restaurant's staff (turned off by the ${xrayOffBy(flag)}). You can still use it from this view.`;
}

// Conditional DOM writes: only touch what actually changes, so the steady-state pass
// is mutation-free and the MutationObserver below can never loop on its own writes.
function xraySetHidden(el, hide) { if (el.hidden !== hide) el.hidden = hide; }
function xraySetTint(el, on, title) {
  if (el.classList.contains("xray-off") !== on) el.classList.toggle("xray-off", on);
  const want = on ? title : null;
  if ((el.getAttribute("title") || null) !== want) { if (want) el.setAttribute("title", want); else el.removeAttribute("title"); }
}

// ── Read-only "View menu" (owner 2026-07-25) ─────────────────────────────────────
// When the viewer can't edit the menu, the Editor tab no longer VANISHES — it stays
// visible, renames to "View menu", and every edit control is locked so they can still
// browse dishes / categories / tags. The server (managerCan "edit_menu") refuses the
// writes regardless, so this is the honest matching UI, never the only guard.
//  • admin super-user — always edits (X-ray honesty)
//  • owner — edits unless the ADMIN turned menu editing off for this restaurant
//  • manager — the full ladder result (edit_menu effective)
function menuEditAllowed() {
  if (!XRAY_WHO) return true;                       // pre-boot: assume editable
  if (XRAY_WHO.actor === "admin") return true;
  if (XRAY_WHO.actor === "owner")
    return !(XRAY_WHO.offByAdmin && XRAY_WHO.offByAdmin.edit_menu === true);
  return xrayGrantedForManager("edit_menu");
}
function roSetDisabled(el, on) { if (!!el.disabled !== !!on) el.disabled = !!on; } // conditional → no observer loop
function applyMenuReadonly() {
  const ro = !menuEditAllowed();
  // Rename the top Editor tab (📝 Editor ⇄ 👁 View menu). The items tab is plain text
  // (no child element), so setting textContent is safe; skip if a badge is ever added.
  const tab = document.querySelector('.tabs .tab[data-tab="items"]');
  if (tab && !tab.firstElementChild) {
    const want = ro ? "👁 View menu" : "📝 Editor";
    if (tab.textContent !== want) tab.textContent = want;
  }
  const inMenu = state.tab === "items" || state.tab === "categories" || state.tab === "filters";
  const active = ro && inMenu;
  if (document.body.classList.contains("menu-readonly") !== active) document.body.classList.toggle("menu-readonly", active);
  if (!active) return;
  // Lock every edit field/toggle in the editor form so keyboard editing is impossible too
  // (the +New / Select / Save / Delete buttons and chips are hidden/blocked by the
  // body.menu-readonly CSS). Re-applied on every repaint via the MutationObserver; each
  // write is conditional, so the steady-state pass stays mutation-free (no self-loop).
  document.querySelectorAll('#editor input, #editor select, #editor textarea, #editor [data-action], #editor [data-path]')
    .forEach((el) => roSetDisabled(el, true));
}

function applyHierarchyView() {
  if (!XRAY_WHO) return;
  const higher = !!XRAY_WHO.higherView;                 // admin/owner looking in
  const zones = [];                                     // tinted things on this page (for the popout)
  for (const entry of XRAY_TABS) {
    const btn = document.querySelector(`.tabs .tab[data-tab="${entry.tab}"]`);
    if (!btn) continue;
    const granted = xrayGrantedForManager(entry.flag);
    if (granted) { xraySetHidden(btn, false); xraySetTint(btn, false); continue; } // manager has it → normal for everyone
    if (!higher) { xraySetHidden(btn, true); xraySetTint(btn, false); continue; }  // real manager → hide entirely
    // higher role → TINT (colour only), still fully usable. Record it as a zone.
    xraySetHidden(btn, false);
    xraySetTint(btn, true, xrayTintTitle(entry.label, entry.flag));
    zones.push({ ...entry, el: btn });
  }
  // A real manager must never be LEFT ON a tab that just got hidden (e.g. the default
  // "items" tab with edit_menu off) — hop to the first visible tab instead.
  if (!higher) {
    const active = document.querySelector(".tabs .tab.active");
    if (active && active.hidden) {
      const first = document.querySelector(".tabs .tab:not([hidden])");
      if (first) setTab(first.dataset.tab);
    }
  }
  // Phase 2: in-tab controls (discount / void / staff-settings rows). Fresh query per
  // pass — repaints recreate these nodes, the observer re-runs us, we re-apply.
  for (const entry of XRAY_CONTROLS) {
    const els = document.querySelectorAll(entry.selector);
    if (!els.length) continue;
    const granted = xrayGrantedForManager(entry.flag);
    let counted = false;
    els.forEach((el) => {
      if (granted) { xraySetHidden(el, false); xraySetTint(el, false); return; }
      if (!higher) { xraySetHidden(el, true); xraySetTint(el, false); return; }
      xraySetHidden(el, false);
      xraySetTint(el, true, xrayTintTitle(entry.label, entry.flag));
      if (!counted) { zones.push({ ...entry, el }); counted = true; } // one zone per control type
    });
  }
  // A real manager who raced the whoami hide and parked on an admin-only settings section
  // (billing/kitchen/dining sessions) is bounced back to General so they never sit on cards
  // whose sidebar row is now hidden. One-shot: after the hop the condition self-clears.
  if (!higher && state.tab === "general" && (state.settingsSection === "billing" || state.settingsSection === "kitchen" || state.settingsSection === "sessions")) {
    state.settingsSection = "general";
    renderList();
    renderEditor();
  }
  // Finer edit-menu sub-limits (owner 2026-07-24): the owner can restrict a MANAGER to only
  // some menu actions. The server (menuSubAllowed) already refuses a disallowed create/delete;
  // hide the matching button so it's never shown-then-refused. DEFAULT-ALLOW: whoami.menuSub is
  // resolved per current user (admin/owner = all true; manager = only when the owner configured
  // limits), and a flag that isn't EXPLICITLY false leaves the button visible — an unconfigured
  // restaurant keeps every button, exactly as today. Re-applied each repaint (delBtn is rebuilt
  // per record render), so a redraw can't resurrect a hidden button.
  const msub = XRAY_WHO.menuSub || {};
  for (const [sel, flag] of [
    ["#newBtn", "add_dish"], ["#bulkBtn", "delete_dish"], ["#delBtn", "delete_dish"],
    ['.subtab[data-tab="categories"]', "manage_categories"], // hide the whole sub-section…
    ['.subtab[data-tab="filters"]', "manage_filters"],       // …not just its + / delete buttons
  ]) {
    const el = document.querySelector(sel);
    if (el) xraySetHidden(el, msub[flag] === false);
  }
  // A real manager sitting on a sub-tab that just got hidden hops back to Dishes.
  if (!higher) {
    const activeSub = document.querySelector('.subtab[data-tab="' + state.tab + '"]');
    if (activeSub && activeSub.hidden) setTab("items");
  }
  // Field-level menu limits inside the dish form — hide the control a restricted manager
  // isn't allowed instead of showing-then-refusing it (owner/admin get all, so nothing hides).
  const priceEl = document.querySelector('#editor [data-path="price"]');
  if (priceEl) { const f = priceEl.closest(".field"); if (f) xraySetHidden(f, msub.edit_price === false); }
  const soldEl = document.querySelector('#editor [data-action="toggleSoldOut"]');
  if (soldEl) xraySetHidden(soldEl, msub.mark_86 === false);
  applyMenuReadonly(); // flip the Editor tab to a locked "View menu" when editing is off
  renderXrayRibbon(higher, zones);
}

// Re-apply on every repaint. The panel redraws lists/orders/tables in place on live
// polls; without this, a redraw would resurrect a hidden discount/void button. The
// conditional writes above make steady-state passes mutation-free (no self-loop);
// rAF coalesces bursts of mutations into one pass.
let xrayPassQueued = false;
new MutationObserver(() => {
  if (xrayPassQueued || !XRAY_WHO) return;
  xrayPassQueued = true;
  requestAnimationFrame(() => { xrayPassQueued = false; applyHierarchyView(); });
}).observe(document.body, { childList: true, subtree: true });

// Flip this admin-view TAB between the full admin view and the "actual panel" view
// (?view=real — the server then answers whoami exactly as the real manager gets it).
// Pure URL state: reloading this iframe with/without the param is the whole toggle.
function xraySetViewReal(on) {
  const u = new URL(location.href);
  if (on) u.searchParams.set("view", "real"); else u.searchParams.delete("view");
  location.replace(u.toString());
}

function renderXrayRibbon(higher, zones) {
  let rb = document.getElementById("xrayRibbon");
  const zp = document.getElementById("xrayZones");
  // The ACTUAL-VIEW mode (?view=real) renders like a real manager (higher=false), but the
  // admin still needs the ribbon — it's the only way back to the full admin view.
  const sim = !!(XRAY_WHO && XRAY_WHO.simulated);
  if (!higher && !sim) { if (rb) rb.remove(); if (zp) zp.remove(); syncRibbonHeight(); return; }
  if (!rb) { rb = document.createElement("div"); rb.id = "xrayRibbon"; document.body.insertBefore(rb, document.body.firstChild); }
  const who = sim || XRAY_WHO.actor === "admin" ? "Admin" : "Owner";
  const restEl = document.getElementById("brandRest");
  const restName = restEl ? restEl.textContent.replace(/^·\s*/, "") : "";
  const n = zones.length;
  // Skip identical rebuilds: the MutationObserver re-runs applyHierarchyView on every
  // repaint, and rewriting our own innerHTML would itself be a mutation → a loop.
  const sig = `${who}|${sim ? "sim" : "full"}|${restName}|${zones.map((z) => z.label).join(",")}`;
  if (rb.dataset.sig === sig) return;
  rb.dataset.sig = sig;
  // The ADMIN came here from the console → show the PATH (Restaurants › name ›
  // Manager panel), the same breadcrumb the owner panel's admin bar uses (owner,
  // 2026-07-06). An OWNER looking into their own manager panel has no console to
  // crumb back to, so they keep the plain restaurant-name label.
  const crumbs = who === "Admin"
    ? `<nav class="rb-crumbs" aria-label="Breadcrumb"><a id="xrayHome">Restaurants</a>` +
      `<i class="fas fa-chevron-right rb-sep"></i><span>${esc(restName) || "…"}</span>` +
      `<i class="fas fa-chevron-right rb-sep"></i><span>Manager panel</span></nav>`
    : (restName ? `<span class="rb-rest">${esc(restName)}</span>` : "");
  rb.innerHTML =
    `<span class="rb-tag"><i class="fas fa-user-shield"></i> ${who} view${sim ? " · as real manager" : ""}</span>` +
    crumbs +
    `<span class="rb-spacer"></span>` +
    (sim
      ? `<button id="xrayFullBtn" title="Back to the full admin view (everything visible)"><i class="fas fa-user-shield"></i> See full admin view</button>`
      : `<button id="xrayZonesBtn">${n} zone${n === 1 ? "" : "s"} off for staff <i class="fas fa-chevron-down" style="font-size:9px"></i></button>`) +
    `<button class="rb-exit" id="xrayExit"><i class="fas fa-arrow-rotate-left"></i> Exit view</button>`;
  const xrayFullBtn = document.getElementById("xrayFullBtn");
  if (xrayFullBtn) xrayFullBtn.onclick = () => xraySetViewReal(false);
  const xrayHome = document.getElementById("xrayHome");
  if (xrayHome) xrayHome.onclick = () => {
    try { window.top.location.href = "/aevinite/restaurants"; } catch { window.location.href = "/aevinite/restaurants"; }
  };
  document.getElementById("xrayExit").onclick = async () => {
    try { await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) }); } catch {}
    try { window.top.location.href = "/aevinite/restaurants"; } catch { window.location.href = "/aevinite/restaurants"; }
  };
  const zbtn = document.getElementById("xrayZonesBtn"); // absent in the actual-view mode
  if (zbtn) zbtn.onclick = () => toggleXrayZones(zones);
  syncRibbonHeight();
}

// The ribbon flows ABOVE the sticky topbar, but .layout / .floor-side / the floating
// card size themselves with fixed 100vh calcs — publish the ribbon's real height as
// --ribbon-h so those calcs subtract it (otherwise the page bottom hangs below the
// viewport in admin/owner view and the detail footer gets clipped — owner 2026-07-05).
function syncRibbonHeight() {
  const rb = document.getElementById("xrayRibbon");
  document.documentElement.style.setProperty("--ribbon-h", (rb ? rb.offsetHeight : 0) + "px");
}

function toggleXrayZones(zones) {
  let zp = document.getElementById("xrayZones");
  if (zp) { (zp._xrayClose || (() => zp.remove()))(); return; }
  zp = document.createElement("div"); zp.id = "xrayZones";
  // Bottom row (owner 2026-07-28): flip THIS TAB to the ACTUAL panel — exactly what the
  // real manager sees, with their real limited access. Admin-view tabs only (the pin is
  // what carries ?view=real); an owner looking into their own manager panel has no
  // simulate mode, they ARE the reference view the toggle imitates one rung down.
  const simRow = (XRAY_WHO && XRAY_WHO.actor === "admin" && PANEL_RID)
    ? `<div class="zsep"></div><button class="zrow zsim" id="xraySimRow" title="Reload this tab showing exactly what the real manager sees — same limited access, fully working">` +
      `<span class="dot" style="background:#6b7280"></span>👁 See the actual manager panel</button>`
    : "";
  // A synthetic admin-owned zone (XRAY_NEVER) reads "admin only" and, when there's no
  // switch for it (higher_only_view), carries no "⚙ change" link — there's nothing to open.
  zp.innerHTML = `<div class="zh">Not in the manager's panel</div>` + (zones.length
    ? zones.map((z, i) => {
        const nv = XRAY_NEVER[z.flag];
        const by = nv ? esc(nv.by) : `by ${xrayOffBy(z.flag)}`;
        const go = !nv || nv.settable
          ? `<small class="zgo" data-zgo="${i}" title="Open the setting that controls this">⚙ change</small>` : "";
        return `<button class="zrow" data-zi="${i}"><span class="dot"></span>${z.label} <small>${by}</small>${go}</button>`;
      }).join("")
    : `<div class="zrow" style="cursor:default">Nothing is off here.</div>`) + simRow;
  document.getElementById("xrayRibbon").appendChild(zp);
  const simBtn = zp.querySelector("#xraySimRow");
  if (simBtn) simBtn.onclick = () => xraySetViewReal(true);
  // Hardware BACK closes the popout (not the site) — the panels' backstack manager.
  const backOff = window.LFH_BACK ? LFH_BACK.layer("xray-zones", () => zp.remove()) : null;
  const closeZp = () => { zp.remove(); if (backOff) backOff(); };
  zp._xrayClose = closeZp;
  zp.querySelectorAll(".zrow[data-zi]").forEach((row) => {
    row.onclick = (e) => {
      const z = zones[+row.dataset.zi];
      closeZp();
      if (!z) return;
      // "⚙ change" → jump straight to the setting that controls this (Phase 5).
      if (e.target.closest("[data-zgo]")) {
        try { window.top.location.href = xraySettingUrl(z.flag); } catch { window.location.href = xraySettingUrl(z.flag); }
        return;
      }
      // Locate: re-resolve NOW — live repaints replace nodes, so a captured el may be stale.
      const el = z.tab ? document.querySelector(`.tabs .tab[data-tab="${z.tab}"]`) : document.querySelector(z.selector);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        el.classList.remove("xray-pulse"); void el.offsetWidth; el.classList.add("xray-pulse");
        const nv = XRAY_NEVER[z.flag];
        toast(nv
          ? `${z.label}: ${nv.by} — ${nv.why}. The manager panel doesn't show it at all.`
          : `${z.label}: off for staff (by the ${xrayOffBy(z.flag)}). Tap ⚙ change to open its setting.`, "ok");
      } else {
        toast(`${z.label} isn't on this screen right now${XRAY_NEVER[z.flag] && !XRAY_NEVER[z.flag].settable ? "." : " — tap ⚙ change to open its setting."}`, "ok");
      }
    };
  });
}
// Close the zones popout on an outside click.
document.addEventListener("click", (e) => {
  const zp = document.getElementById("xrayZones");
  if (zp && !e.target.closest("#xrayZones") && !e.target.closest("#xrayZonesBtn")) (zp._xrayClose || (() => zp.remove()))();
});

// Copy-to-clipboard for any [data-copy-link] button (the per-table Guest QR links). Delegated so it
// works for every table row without per-render wiring. Clipboard API needs https/localhost; falls
// back to a prompt() the owner can copy from if it's blocked.
document.addEventListener("click", (e) => {
  const cb = e.target.closest("[data-copy-link]");
  if (!cb) return;
  const url = cb.getAttribute("data-copy-link") || "";
  const flash = () => { const o = cb.textContent; cb.textContent = "✓ Copied"; setTimeout(() => { cb.textContent = o; }, 1400); toast("Link copied", "ok"); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(flash).catch(() => window.prompt("Copy this table's link:", url));
  else window.prompt("Copy this table's link:", url);
});

api("GET", "/whoami").then((w) => { XRAY_WHO = w;
  // TODAY-ONLY dashboard for a real manager (owner 2026-07-29). The 30-day / 12-month rows are
  // hidden for them (XRAY_CONTROLS), so a range REMEMBERED in localStorage from an earlier
  // admin/owner session on this device would otherwise leave them on a wide view with no way
  // back. Snap it to today before the first dashboard paint; the server clamps it too.
  if (!w.higherView && dashRange !== "today") {
    dashRange = "today";
    try { localStorage.setItem("lfh_dash_range", "today"); } catch {}
    if (state.tab === "dash") { renderList(); loadDashboard(); }
  }
  applyHierarchyView();
  // The module tabs (Banquet, Platform) grant depends on WHO is viewing, so re-sync them once
  // whoami resolves (they first paint with higher-view assumed while whoami is still pending).
  try { syncBanquetTab(); syncPlatformTab(); syncInventoryTab(); } catch (e) {}
  // Repaint the active view now that we know WHO is viewing — the floor first paints
  // before whoami resolves, so admin-view-only cues (e.g. a VIP/guest tag when the
  // feature is off for staff) were missing until a click forced a redraw (owner
  // 2026-07-24: "tag not showing on the tile until I open the table"). tagForTable etc.
  // depend on XRAY_WHO, so a single repaint here makes them correct on load.
  try { if (typeof renderEditor === "function") renderEditor(); } catch (e) {}
}).catch(() => {});

// Then load all the data, refresh the current view in place, and start live polling.
// If the very first load fails, show "connection failed" so it's obvious the local
// server probably isn't running.
loadAll()
  .then(() => { renderCatFilter(); renderList(); renderEditor(); startOrderWatch(); loadPlatform(); applyHierarchyView(); /* refresh the admin ribbon with the restaurant name */ })
  .catch((e) => {
    $("#conn").textContent = "connection failed";
    $("#conn").className = "conn err";
    toast("Could not load: " + e.message, "err");
  });
