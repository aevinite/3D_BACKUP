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
const VALID_TABS = ["items", "categories", "filters", "orders", "tables", "platform", "dash", "log", "features", "general"];
// Remember which tab you were on so a refresh keeps you there (e.g. stay on
// Orders during a busy service instead of snapping back to Dishes).
const savedTab = (() => { try { return localStorage.getItem("lfh_editor_tab"); } catch { return null; } })();
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
  tab: savedTab === "sessions" ? "tables" : (VALID_TABS.includes(savedTab) ? savedTab : "items"), // "sessions" merged into "tables"
  data: { items: [], categories: [], filters: [], orders: [], calls: [], settings: { id: "site", bubbles_enabled: true, service_mode: false } },
  sel: null,      // working copy of the record being edited
  isNew: false,
  search: "",
  catFilter: "", // Dishes tab: selected category slug to filter by ("" = All)
  board: { sessions: [], members: [], items: [], requests: [], blocklist: [] }, // v2 sessions live board (TIER 2: only the SELECTED table's full slice now)
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
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// inr: show a stored USD amount as Indian rupees, rounded to whole ₹.
// Orders store totals in USD (the menu's source-of-truth currency); the owner
// wants the editor to read in ₹ (2026-06-10). The rate mirrors CURRENCIES in
// the menu app's lib/format.ts — update both together when rates move.
const INR_RATE = 1; // prices are stored in rupees now (migration 043) — no conversion
const inr = (usd) => "₹" + Math.round((parseFloat(usd) || 0) * INR_RATE).toLocaleString("en-US");
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
    const close = (val) => {
      wrap.classList.remove("show");
      setTimeout(() => wrap.remove(), 200);
      resolve(val);
    };
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
    document.addEventListener("keydown", function esc2(e) {
      if (e.key === "Escape") { close(false); document.removeEventListener("keydown", esc2); }
    });
  });
}

// Manager (or any staff) raises an operational issue → the owner sees it on their
// Issues page and the admin sees it as a platform complaint. Mirrors confirmDialog.
function openIssueModal() {
  const wrap = document.createElement("div");
  wrap.className = "confirm-overlay";
  wrap.innerHTML = `
    <div class="confirm-box" style="text-align:left;max-width:430px">
      <div style="font-weight:800;font-size:16px;margin-bottom:4px">🚩 Report an issue</div>
      <div style="color:var(--muted);font-size:12.5px;margin-bottom:13px">Flag a problem (equipment, stock, staffing…) — the owner sees it on their dashboard.</div>
      <input id="issSubj" placeholder="Subject — e.g. Fridge not cooling" maxlength="120" style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2,var(--bg));color:var(--text);font:inherit;margin-bottom:8px"/>
      <textarea id="issBody" placeholder="Details (optional)" rows="3" style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2,var(--bg));color:var(--text);font:inherit;resize:vertical;margin-bottom:13px"></textarea>
      <div class="confirm-actions">
        <button class="btn confirm-cancel">Cancel</button>
        <button class="btn primary iss-send">Send to owner</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  const close = () => { wrap.classList.remove("show"); setTimeout(() => wrap.remove(), 200); };
  wrap.querySelector(".confirm-cancel").onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  document.addEventListener("keydown", function escI(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", escI); } });
  setTimeout(() => { const f = wrap.querySelector("#issSubj"); if (f) f.focus(); }, 60);
  wrap.querySelector(".iss-send").onclick = async () => {
    const subject = wrap.querySelector("#issSubj").value.trim();
    if (!subject) { toast("Please add a subject", "err"); return; }
    const body = wrap.querySelector("#issBody").value.trim();
    const btn = wrap.querySelector(".iss-send"); btn.disabled = true;
    try { await api("POST", "/issue", { subject, body }); toast("Issue sent to the owner ✓", "ok"); close(); }
    catch (e) { toast("Couldn't send: " + e.message, "err"); btn.disabled = false; }
  };
}

// PER-TAB restaurant pin (ADMIN "view as" only): the wrapper page forwards ?rid=
// into this iframe; echoing it on EVERY API call pins this tab to that restaurant
// even if the admin opens another restaurant's panel later (the act-as cookie is
// browser-wide and used to shift this tab's data — owner bug, 2026-07-03). Empty
// for real staff logins; the server ignores it for them anyway.
const PANEL_RID = new URLSearchParams(location.search).get("rid") || "";
const ridQ = (path) => PANEL_RID ? path + (path.includes("?") ? "&" : "?") + "rid=" + encodeURIComponent(PANEL_RID) : path;

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
async function api(method, path, body) {
  const res = await fetch("/api/editor" + ridQ(path), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, // turn the body object into JSON text to send
  });
  const json = await res.json().catch(() => ({})); // read the reply; if it isn't JSON, fall back to {}
  if (!res.ok) throw new Error(json.error || res.statusText); // not OK? surface the server's error message
  return json;
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
  const restName = rr.logo_text || (rr.name && rr.name.en) || rr.name_en || (state.data.settings || {}).restaurant_name || "";
  const brandEl = document.getElementById("brandRest");
  if (brandEl) brandEl.textContent = restName ? "· " + restName : "";
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

function renderList() {
  const ul = $("#list");
  ul.innerHTML = ""; // wipe the old list before drawing the new one
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
    ul.appendChild(mk("calls", "🔔", "Calls", callCount));
    return;
  }
  if (state.tab === "tables") {
    // Nothing in the sidebar for Tables — it's hidden (see setTab's .no-sidebar);
    // the floor uses the full width.
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
      li.onclick = () => { dashRange = key; renderList(); loadDashboard(); };
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
  const q = state.search.toLowerCase();
  // On the Dishes tab, also narrow to the chosen category (if any).
  const catF = state.tab === "items" ? state.catFilter : "";
  records()
    // keep only dishes in the chosen category (Dishes tab; "" = All)
    .filter((r) => !catF || r.category === catF)
    // keep only rows that match the search box (search across the whole row's text)
    .filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q))
    .forEach((r) => {
      const active = state.sel && !state.isNew && recKey(r) === recKey(state.sel); // is this the row being edited?
      const hidden = state.tab !== "items" && r.active === false; // greyed-out "hidden from menu" rows
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
        `<li class="list-item ${active ? "active" : ""} ${hidden ? "hidden-row" : ""}">
          ${thumb}
          <div class="meta">
            <b>${esc(recLabel(r))}${state.tab === "items" && r.dish_no != null ? ` <span class="dish-no">#${esc(String(r.dish_no))}</span>` : ""}${hidden ? '<span class="badge-off">hidden</span>' : ""}</b>
            <small>${esc(recKey(r) || "")}</small>
          </div>
        </li>`
      );
      li.onclick = () => {
        // INSTANT feedback: highlight this row right now, before any heavy
        // work, so the click never feels ignored (it used to take ~1s).
        ul.querySelectorAll(".list-item.active").forEach((x) => x.classList.remove("active"));
        li.classList.add("active");
        selectRecord(r); // then open it in the editor on the right
      };
      ul.appendChild(li);
    });
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
      veg: false, is4d: false, model_folder: "",
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
  // No renderList() here: rebuilding the whole sidebar on every click was a
  // big part of the lag, and the click handler already moved the highlight.
  renderEditor();
}
// newRecord: start a fresh, blank row for the current tab.
function newRecord() {
  state.sel = blank(state.tab);
  state.isNew = true;
  renderList();
  renderEditor();
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
  </div>

  <div class="card"><h3>Image</h3>
    <div class="grid cols-2" style="align-items:start">
      ${tf("Image URL", "image", it.image, { ph: "https://…" })}
      <img id="imgPreview" class="preview-img" src="${esc(it.image || "")}" alt="" style="opacity:${it.image ? 1 : 0.2}"/>
    </div>
  </div>

  <div class="card"><h3>3D · 4D</h3>
    <div style="margin-bottom:14px">${toggle("4D mode — cyan glow outline + 3D preview", "is4d", it.is4d)}</div>
    <div class="grid cols-2">
      ${tf("Model folder", "model_folder", it.model_folder)}
      <div></div>
      ${tf("GLB — small (fast load)", "model_small_url", it.model_small_url, { span: true, ph: "https://…/model_small.glb" })}
      ${tf("GLB — optimized (full quality)", "model_optimized_url", it.model_optimized_url, { span: true, ph: "https://…/model-optimized.glb" })}
    </div>
    <span class="hint">4D only appears on the menu when both GLB URLs are filled.</span>
  </div>

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
    else { state.staffDenied = null; state.staffTeam = d.staff || []; state.staffRestaurantId = (d.restaurants || [])[0]?.id || null; state.staffActor = d.actor || "manager"; }
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
          <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.03em;padding:3px 8px;border-radius:999px;background:color-mix(in srgb, var(--gold) 18%, transparent);color:var(--gold-strong)">${esc(u.role)}</span>
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
      <input class="sx-input" id="usrNewName" placeholder="Name (their login)" style="flex:1 1 150px"/>
      <select id="usrNewRole" style="flex:0 0 auto;padding:9px 12px;border-radius:8px;border:1px solid var(--line);background:var(--panel-2);color:var(--text)">${ROLES.map((r) => `<option value="${r}">${r}</option>`).join("")}</select>
      <input class="sx-input" id="usrNewPassword" placeholder="Password (blank = auto)" style="flex:1 1 150px"/>
      <button class="btn primary" id="usrAddStaff">+ Add</button>
    </div>
  </div>`;
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
  let cells = "";
  for (let i = 1; i <= n; i++) {
    cells += `<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:8px;background:var(--panel-2)">
      <span style="font-weight:700;font-size:13px;min-width:26px">T${i}</span>
      <input type="number" min="1" max="30" data-path="table_seats.${i}" value="${esc(seats[String(i)] ?? 4)}"
        style="width:56px;padding:5px 6px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--text)"/>
    </div>`;
  }
  return `<div class="card"><h3>Table setting</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      How many people can sit at each table. Shows next to the chair icon on the floor
      map and the tablet — a table with nothing set here defaults to 4.
    </p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;max-height:340px;overflow-y:auto;padding-right:4px">${cells}</div>
  </div>`;
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
];
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
      ${ACCESS_CAPS.map((c) => triSel(c.label, c.key, s[c.key])).join("")}
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
          <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.03em;padding:3px 8px;border-radius:999px;background:color-mix(in srgb, var(--gold) 18%, transparent);color:var(--gold-strong)">${esc(u.role)}</span>
          <span style="font-weight:700;font-size:13.5px">${esc(u.name || u.username)}</span>
          ${u.active ? "" : `<span style="font-size:10.5px;color:var(--red);font-weight:700">disabled</span>`}
          ${Object.keys(u.permissions || {}).length ? `<span style="font-size:10.5px;color:var(--gold-strong);font-weight:700" title="This person has their own settings">· custom</span>` : ""}
        </div>
        <div class="grid cols-3" style="gap:8px">${ACCESS_CAPS.map((c) => selFor(u, c)).join("")}</div>
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
    return `
  <div class="card"><h3>Tables / seating</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      How many tables the restaurant has. Drives the live floor map in the
      <b>Tables</b> tab — Save, then open Tables.
    </p>
    <div style="max-width:200px">${tf("Number of tables", "table_count", s.table_count ?? 12, { type: "number", min: 1, max: 500, step: 1 })}</div>
  </div>
  ${tableSeatingCardHtml(s)}
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
    if (!s.restaurant_name) s.restaurant_name = bi.name;
    if (!s.restaurant_address) s.restaurant_address = bi.address;
    if (!s.restaurant_phone) s.restaurant_phone = bi.phone;
    if (!s.gstin) s.gstin = bi.gstin;
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
    ${tf("Address", "restaurant_address", s.restaurant_address ?? "")}
    <div class="grid cols-3">
      ${tf("Phone", "restaurant_phone", s.restaurant_phone ?? "")}
      ${tf("GSTIN", "gstin", s.gstin ?? "", { hint: s.gstin === "24AAAAA0000A1Z5" ? "⚠ Placeholder — replace with your REAL GSTIN before tax filing." : "" })}
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

// orderCardHtml: build the big card for ONE order in the Orders tab — its items,
// allergy note, total, payment pill, and the action buttons that fit its current
// stage. `freed` = true means it's an archived/cleared order shown in the lower
// "Freed tables" section, which only gets a "Restore to floor" button.
function orderCardHtml(o, freed = false) {
  const status = o.status || "received"; // default a missing status to "received"
  const meta = STATUS_META[status] || STATUS_META.received; // look up its label + colour
  const when = o.created_at ? new Date(o.created_at).toLocaleString() : ""; // friendly date/time
  // Build one line per item, including any chosen options, "NO …" removals, and notes.
  const items = (o.items || [])
    .map((i) => `<div class="ord-line"><span class="ol-name">${esc(i.title)}${dishNoTag(i.title)}</span><span class="ol-qty">×${esc(i.qty)}</span><span class="ol-price">${inr(parseFloat(i.price) || 0)}</span>${itemDetailLine(i)}</div>`)
    .join("");
  // Order-wide allergies shown READ-ONLY (no always-on toggle chips any more — owner,
  // 2026-06-17). Adding/removing an allergen now lives in the gated staff EDIT flow.
  const allergy = (o.allergies || []).length
    ? `<div class="ord-allergy">⚠ Avoid: ${o.allergies.map(esc).join(", ")}</div>`
    : "";
  // Actions depend on where the order is in its lifecycle.
  let actions = "";
  if (status === "received") {
    actions = `<button class="ord-btn accept" data-act="preparing" data-id="${esc(o.id)}">✓ Accept &amp; Prepare</button>
               <button class="ord-btn ghost" data-act="cancelled" data-id="${esc(o.id)}">Cancel</button>`;
  } else if (status === "preparing") {
    actions = `<button class="ord-btn serve" data-act="served" data-id="${esc(o.id)}">🍽️ Mark Served</button>
               <button class="ord-btn ghost" data-act="cancelled" data-id="${esc(o.id)}">Cancel</button>`;
  } else if (status === "served") {
    actions = `<button class="ord-btn ghost" data-act="preparing" data-id="${esc(o.id)}">↩ Reopen</button>`;
  } else {
    actions = `<button class="ord-btn ghost" data-act="received" data-id="${esc(o.id)}">↩ Restore</button>`;
  }
  const paid = o.payment_status === "paid"; // has the guest settled this order?
  const cancelled = status === "cancelled"; // voided: no money is due, so no pay control
  // Can this whole table leave the floor? Only when EVERY non-archived order on
  // it is settled (paid or cancelled) — never free a table with money still due.
  const tnum = (o.table_number || "").trim();
  // tableOrders: every live order sharing this table number.
  const tableOrders = tnum
    ? (state.data.orders || []).filter((x) => !x.archived && (x.table_number || "").trim() === tnum)
    : [];
  // tableDue: add up the money still owed across the whole table.
  const tableDue = tableOrders
    .filter((x) => x.status !== "cancelled" && x.payment_status !== "paid")
    .reduce((s, x) => s + (parseFloat(x.total) || 0), 0);
  const tableSettled = tableOrders.length > 0 && tableDue === 0; // nothing left to pay → safe to free
  // Freed cards: just a "restore to floor" affordance. Live cards: full actions.
  const actionsRow = freed
    ? `<button class="ord-btn ghost" data-restore="${esc(o.id)}">↩ Restore to floor</button>`
    : `${cancelled ? "" : `<button class="ord-btn ${paid ? "ghost" : "pay"}" data-pay="${esc(o.id)}" data-paid="${paid ? "1" : "0"}"${status === "received" && !paid ? ' disabled title="Accept the order first — it can only be paid once accepted."' : ""}>
        ${paid ? "↩ Mark unpaid" : "💳 Mark paid"}
      </button>`}
      ${actions}
      ${tnum && paid
        ? (tableSettled
            ? `<button class="ord-btn free-table" data-free-table="${esc(tnum)}">🪑 Free table ${esc(tnum)}</button>`
            : `<button class="ord-btn free-table" disabled title="Settle the rest of this table first">🪑 ${inr(tableDue)} still due</button>`)
        : ""}`;
  return `<div class="card ord-card ord-${meta.cls} ${paid ? "is-paid" : ""} ${freed ? "is-freed" : ""}">
    <div class="ord-top">
      <label class="ord-check"><input type="checkbox" class="ord-select" data-sel="${esc(o.id)}"> </label>
      ${o.kot_no != null ? `<span class="kot-chip" title="Kitchen ticket number">#${esc(o.kot_no)}</span>` : ""}
      <b>${o.table_number ? "Table " + esc(o.table_number) : "Walk-in / no table"}</b>
      <span class="ord-pill ${meta.cls}">${meta.label}</span>
      ${cancelled
        ? `<span class="pay-pill voided">— Voided</span>`
        : `<span class="pay-pill ${paid ? "paid" : "pending"}">${paid ? "💳 Paid" : "⏳ Unpaid"}</span>`}
      ${o.archived ? `<span class="ord-pill freed-pill">✓ Freed</span>` : ""}
      <button class="ord-del" data-del="${esc(o.id)}" title="Delete order">🗑</button>
    </div>
    <small class="ord-when">${esc(when)}</small>
    <div class="ord-items">${items}</div>
    ${allergy}
    ${Number(o.subtotal) > 0 ? `<div class="ord-sub"><span>Subtotal</span><span>${inr(Number(o.subtotal))}</span></div>` : ""}
    ${Number(o.discount) > 0 ? `<div class="ord-disc">Discount${o.discount_note ? ` (${esc(o.discount_note)})` : ""}<span>− ${inr(o.discount)}</span></div>` : ""}
    ${Number(o.tax) > 0 ? `<div class="ord-sub"><span>${esc(taxLabel())} ${taxModel(state.data.settings).pct}%</span><span>${inr(Number(o.tax))}</span></div>` : ""}
    <div class="ord-total"><span>Total</span><span>${inr((Number(o.total) || 0) - (Number(o.discount) || 0))}</span></div>
    <div class="ord-actions">${actionsRow}</div>
  </div>`;
}

// mergedOrderCardHtml: build ONE card for a whole group of orders that belong
// together (same session / same table visit) — every dish from every order in one
// combined list with a SINGLE bill (owner: merge the orders, one bill). The
// separate order rows still exist underneath as the record. Per-order accept/serve/
// pay become session-level (they reuse the table-wide helpers).
// Financial-year string for invoice numbers, e.g. "2025-26" (FY starts April).
function financialYear() {
  const d = new Date(); const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}
// Display an invoice number: <prefix>/<FY>/<6-digit>, e.g. LFH/2025-26/000042.
function invFmt(no) {
  if (no == null) return "";
  const pfx = (state.data.settings || {}).invoice_prefix || "INV";
  return `${pfx}/${financialYear()}/${String(no).padStart(6, "0")}`;
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
    gstin: s.gstin || (isDefault ? "" : DEFAULT_BILL.gstin),
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
  const sessKey = o0.session_id || o0.id; // group key for delete-all
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
    billBtns = anyUnpaid ? `<button class="ord-btn invoice" data-gen-invoice="${esc(sid)}">🧾 Generate invoice</button>` : "";
  } else if (sid && invoiced) {
    const pay = anyUnpaid ? `<button class="ord-btn pay" data-sess-pay="${esc(sessKey)}"${anyReceived ? ' disabled title="Accept the order first — the bill can only be paid once accepted."' : ""}>💳 Mark paid</button>` : "";
    billBtns = pay + `<button class="ord-btn" data-print-group="${esc(sessKey)}">🖨 Print</button><button class="ord-btn ghost" data-void-invoice="${esc(sid)}">↩ Reopen</button>`;
  } else {
    // legacy non-session order — keep the direct pay
    billBtns = anyUnpaid ? `<button class="ord-btn pay" data-sess-pay="${esc(sessKey)}"${anyReceived ? ' disabled title="Accept the order first — the bill can only be paid once accepted."' : ""}>💳 Mark paid</button>` : "";
  }
  const tableDue = live.filter((o) => o.payment_status !== "paid").reduce((s, o) => s + (Number(o.total) || 0) - (Number(o.discount) || 0), 0);
  const freeBtn = (tnum && paid)
    ? (tableDue === 0 ? `<button class="ord-btn free-table" data-free-table="${esc(tnum)}">🪑 Free table ${esc(tnum)}</button>` : "")
    : "";
  return `<div class="card ord-card ord-${cls} ${paid ? "is-paid" : ""}">
    <div class="ord-top">
      ${kots.length ? `<span class="kot-chip" title="Kitchen tickets">#${esc(kots[0])}${kots.length > 1 ? ` +${kots.length - 1}` : ""}</span>` : ""}
      <b>${tnum ? "Table " + esc(tnum) : "Walk-in / no table"}</b>
      <span class="ord-pill ${cls}">${label}</span>
      <span class="pay-pill ${paid ? "paid" : "pending"}">${paid ? "💳 Paid" : "⏳ Unpaid"}</span>
      ${invoiced ? `<span class="inv-chip" title="Tax invoice">${esc(invFmt(invNo))}</span>` : (sid && invVoided ? `<span class="inv-chip voided">invoice voided</span>` : "")}
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
  return ["live", "daybills", "previous", "calls"].includes(v) ? v : "live";
}

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
  const live = all.filter((o) => !o.archived && o.status !== "cancelled" && !paidKeys.has(sessKey(o)));
  const records = all.filter((o) => o.archived || o.status === "cancelled" || paidKeys.has(sessKey(o)));
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
  const pendingTotal = unpaidGroups.reduce((s, g) => s + billMath(g).total, 0);
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
      billNo: o0.bill_no, invNo: o0.invoice_no, voided: !!o0.invoice_voided,
      customer: o0.customer_name || "", total, paid, ts: new Date(o0.created_at || 0).getTime(),
      when: o0.created_at ? new Date(o0.created_at).toLocaleString() : "",
      cancelled: g.every((o) => o.status === "cancelled"),
    };
  });
  const q = (state.billSearch || "").toLowerCase().trim();
  const stype = state.billSearchType || "date", sort = state.billSort || "new";
  const fieldOf = (b) => stype === "inv" ? String(invFmt(b.invNo)).toLowerCase()
    : stype === "bill" ? String(b.billNo ?? "")
    : stype === "table" ? String(b.table)
    : stype === "cust" ? b.customer.toLowerCase()
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
  const headRow = `<div class="ord-section-divider"><h3>${isToday ? "📅 Today's bills" : "✓ Previous bills"}</h3>${isToday ? "" : `<button class="btn danger" id="clearFreed">🗑 Clear all</button>`}</div>`;
  return headRow + bar + grid;
}
function billCardHtml(b) {
  const dot = b.cancelled ? "cancelled" : (b.voided ? "voided" : "paid");
  return `<div class="bill-card" data-bill-open="${esc(b.key)}">
    <span class="bill-dot ${dot}"></span>
    <div class="bill-bn">${b.table ? "Table " + esc(b.table) + " · " : ""}#${esc(b.billNo ?? "—")}</div>
    <div class="bill-cust">${esc(b.customer || "—")}</div>
    <div class="bill-amt">${inr(b.total)}</div>
    <div class="bill-when">${esc(b.when)}</div>
    ${b.invNo != null ? `<div class="bill-inv">${esc(invFmt(b.invNo))}${b.voided ? " · voided" : ""}</div>` : ""}
  </div>`;
}
// Expand one bill into a modal: full item list + totals + Print / Restore / Close.
function openBillModal(key) {
  const g = (key || "").startsWith("solo:")
    ? (state.data.orders || []).filter((o) => o.id === key.slice(5))
    : (state.data.orders || []).filter((o) => o.session_id === key);
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
      <div class="bm-head"><b>${o0.table_number ? "Table " + esc(o0.table_number) : "Walk-in"} · Bill #${esc(o0.bill_no ?? "—")}</b>${o0.invoice_voided ? `<span class="inv-chip voided">voided</span>` : ""}</div>
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
        <button class="btn confirm-cancel" data-bm-close>Close</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  const onEsc = (e) => { if (e.key === "Escape") close(); };
  const close = () => { wrap.classList.remove("show"); document.removeEventListener("keydown", onEsc); setTimeout(() => wrap.remove(), 180); };
  document.addEventListener("keydown", onEsc);
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  wrap.querySelector("[data-bm-close]").onclick = close;
  wrap.querySelector("[data-bm-print]").onclick = () => printBill(o0.table_number, { invoice_no: o0.invoice_no, bill_no: o0.bill_no }, g);
  const freeBtn = wrap.querySelector("[data-bm-free]");
  if (freeBtn) freeBtn.onclick = async () => { close(); await freeTable(freeBtn.dataset.bmFree); };
  const restoreBtn = wrap.querySelector("[data-bm-restore]");
  if (restoreBtn) restoreBtn.onclick = async () => { close(); await restoreBill(g); };
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
    revertReason = (window.prompt("This bill is PAID. Reason for reverting it to unpaid (refund / wrong entry)?") || "").trim();
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
async function deleteOrders(ids, all = false) {
  const before = state.data.orders || [];
  // The server KEEPS settled (paid, not voided) bills — they're financial
  // records. Mirror that rule here so the optimistic view matches what actually
  // happens (otherwise a paid bill would vanish then reappear on the next poll).
  const isRecord = (o) => o.payment_status === "paid" && o.status !== "cancelled";
  const targetIds = all ? before.map((o) => o.id) : (ids || []);
  const gone = before.filter((o) => targetIds.includes(o.id) && !isRecord(o)).map((o) => o.id);
  const goneSet = new Set(gone);
  state.data.orders = before.filter((o) => !goneSet.has(o.id));
  // (lastOrderCount is owned solely by reconcileBoard now, derived from the summary's
  //  live order_count — don't set it here from the full-list length or the two baselines
  //  would disagree and the next poll could fire a spurious "new order" chime.)
  gone.forEach((id) => pendingDeletes.add(id)); // poll must not resurrect them
  renderEditor();
  try {
    let r;
    if (all) r = await api("POST", "/orders/delete", { all: true });
    else if (ids && ids.length === 1) r = await api("DELETE", "/orders/" + ids[0]);
    else r = await api("POST", "/orders/delete", { ids });
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
async function setOrderPayment(id, paid, opts = {}) {
  if (paid && !opts.skipConfirm) {
    if (!(await confirmDialog("Mark this order PAID? Only confirm if the payment has actually been collected.", "Yes, payment done"))) return;
  }
  const o = (state.data.orders || []).find((x) => x.id === id);
  const prev = o ? o.payment_status : null;
  // Reverting an ALREADY-PAID bill is a refund/correction — require a reason
  // (the server logs it). Routine "mark unpaid" on a never-paid order is free.
  let revertReason = null;
  if (!paid && prev === "paid") {
    revertReason = (window.prompt("This bill is PAID. Reason for reverting it to unpaid (refund / wrong entry)?") || "").trim();
    if (!revertReason) { toast("Revert cancelled — a reason is required.", "err"); return; }
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
    // The bulk "settle whole table" path passes quiet:true so we toast once at the
    // end instead of once per order.
    if (!opts.quiet) toast(paid ? "Marked paid 💳" : "Marked unpaid", "ok");
  } catch (e) {
    if (o && prev !== null) o.payment_status = prev;   // undo on failure
    renderEditor();
    renderTablePanel();
    toast("Could not update payment: " + e.message, "err");
  } finally {
    opEnd(id);
  }
}

// openPaymentMethodModal(due, label): "how did they pay?" — UPI/Cash/Card, or Other
// with a short typed note. Picking a method IS the confirmation (no separate "are you
// sure?" step — the old confirmDialog is folded into this one tap). Resolves
// { method, note } once staff pick one, or null if they cancel; talks to nothing
// itself — payOrdersWithMethod below does the actual save. (owner, 2026-07-01)
function openPaymentMethodModal(due, label) {
  return new Promise((resolve) => {
    document.querySelector(".pay-overlay")?.remove();
    const wrap = el(`<div class="sx-modal-overlay pay-overlay"><div class="sx-modal pay-modal">
      <div class="tbl-modal-head"><div class="tp-detail-top"><h3>${esc(label)}</h3><button class="tbl-modal-close" aria-label="Close">✕</button></div></div>
      <div class="dish-edit-body">
        <div class="disc-bill-row"><span>Amount collected</span><b>${inr(due)}</b></div>
        <div class="dish-edit-lbl">How did they pay? <span class="muted small">— only pick one if the money's actually in hand</span></div>
        <div class="pay-method-grid">
          <button type="button" class="pay-method-btn" data-method="UPI"><span class="pmi">📱</span>UPI</button>
          <button type="button" class="pay-method-btn" data-method="Cash"><span class="pmi">💵</span>Cash</button>
          <button type="button" class="pay-method-btn" data-method="Card"><span class="pmi">💳</span>Card</button>
          <button type="button" class="pay-method-btn" data-method="Other"><span class="pmi">⋯</span>Other</button>
        </div>
        <div class="pay-other-field" style="display:none">
          <label class="dish-edit-lbl">What kind?</label>
          <input type="text" class="dish-edit-custominput" id="payOtherInput" maxlength="60" placeholder="e.g. wallet, bank transfer">
          <button type="button" class="btn primary pay-other-confirm">Confirm</button>
        </div>
      </div>
      <div class="dish-edit-foot"><button type="button" class="btn dish-edit-cancel">Cancel</button></div>
    </div></div>`);
    document.body.appendChild(wrap);
    let resolved = false;
    const close = () => wrap.remove();
    const finish = (method, note) => { resolved = true; close(); resolve({ method, note }); };
    const cancel = () => { close(); if (!resolved) resolve(null); };
    wrap.querySelector(".tbl-modal-close").onclick = cancel;
    wrap.querySelector(".dish-edit-cancel").onclick = cancel;
    wrap.onclick = (e) => { if (e.target === wrap) cancel(); };
    wrap.querySelectorAll(".pay-method-btn").forEach((b) => (b.onclick = () => {
      const m = b.dataset.method;
      if (m === "Other") {
        wrap.querySelector(".pay-method-grid").style.display = "none";
        wrap.querySelector(".pay-other-field").style.display = "";
        wrap.querySelector("#payOtherInput").focus();
        return;
      }
      finish(m, null);
    }));
    const otherInput = wrap.querySelector("#payOtherInput");
    const confirmOther = () => finish("Other", otherInput.value.trim());
    wrap.querySelector(".pay-other-confirm").onclick = confirmOther;
    otherInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); confirmOther(); } };
  });
}

// payOrdersWithMethod: the ONE shared "close this bill" flow — opens the payment-
// method modal, then marks every given order paid with the picked method. Used by
// all three real "mark a whole bill paid" entry points (table detail, Bills tab,
// session card), so a bill is never settled without a method recorded. The smaller
// PER-ORDER correction toggle (data-pay) stays a plain flip via setOrderPayment's
// own confirm — that's a fix-a-mistake action, not a new payment being collected.
async function payOrdersWithMethod(orders, label) {
  if (!orders.length) { toast("Nothing to settle — already paid", "ok"); return false; }
  const due = orders.reduce((s, o) => s + (parseFloat(o.total) || 0) - (parseFloat(o.discount) || 0), 0);
  const picked = await openPaymentMethodModal(due, label);
  if (!picked) return false; // cancelled
  for (const o of orders) await setOrderPayment(o.id, true, { skipConfirm: true, quiet: true, method: picked.method, note: picked.note });
  toast(`Marked paid via ${picked.method} 💳`, "ok");
  return true;
}

// markTablePaid: settle the WHOLE table in one go — mark every unpaid (non-
// cancelled) order paid via payOrdersWithMethod. Used by the on-tile quick button
// AND the "Mark all paid" button in the table popup, so staff don't have to settle
// three orders separately.
async function markTablePaid(t) {
  await ensureTableSlice(t); // a non-selected table's orders aren't cached otherwise
  const os = ordersForTable(t).filter((o) => o.status !== "cancelled" && o.payment_status !== "paid");
  if (!(await payOrdersWithMethod(os, `Mark table ${t} paid`))) return;
  await pollTables([String(t)]); // refresh this tile's summary → green pay ring / "Cleared"
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

let dashRange = "today"; // today | 30d | year — Today leads (the live summary box); 30d/year still a click away
// The Today summary box: a live snapshot across every channel (dine-in tables +
// Zomato/Swiggy/takeaway live orders) and today's combined totals. Built from the
// `live` + `platformToday` fields the /stats endpoint adds.
function dashTodayBox(s) {
  const live = s.live || {}; const pt = s.platformToday || { count: 0, revenue: 0 };
  const totalOrders = (s.orderCount || 0) + (pt.count || 0);
  const totalRev = (s.revenue || 0) + (pt.revenue || 0);
  const card = (cls, ico, lbl, n, meta) =>
    `<div class="tbox ${cls}"><span class="tbox-bar"></span><div class="tbox-top"><span class="tbox-ico"><i class="fas ${ico}"></i></span><span class="tbox-lbl">${lbl}</span></div><div class="tbox-n">${n}</div><div class="tbox-meta">${esc(meta)}</div></div>`;
  return `<div class="dash-today">
    <div class="dash-today-h">Right now <span class="sub">· live across every channel</span></div>
    <div class="dash-today-strip">
      ${card("dine", "fa-chair", "Dine-in", live.dineIn || 0, "tables running")}
      ${card("z", "fa-bolt", "Zomato", live.zomato || 0, "live orders")}
      ${card("s", "fa-bowl-food", "Swiggy", live.swiggy || 0, "live orders")}
      ${card("t", "fa-bag-shopping", "Takeaway", live.takeaway || 0, "live orders")}
      ${card("tot", "fa-indian-rupee-sign", "Today", inr(totalRev), totalOrders + " orders")}
    </div>
  </div>`;
}
async function loadDashboard() {
  const body = document.getElementById("dashBody");
  if (!body) return;
  // Latest-wins guard (the app's standard stale-refresh fix): a fast tab+range
  // double-click used to interleave two runs — the older one rebuilt the DOM
  // mid-flight and Chart.js threw "can't acquire context".
  const seq = (loadDashboard._seq = (loadDashboard._seq || 0) + 1);
  let s;
  try { s = await api("GET", "/stats?range=" + dashRange); }
  catch (e) { if (seq === loadDashboard._seq) body.innerHTML = `<div class="empty">Couldn't load stats: ${esc(e.message)}</div>`; return; }
  if (seq !== loadDashboard._seq) return;
  const RL = { today: "today", "30d": "last 30 days", year: "last 12 months" };
  const rangeLabel = RL[dashRange] || dashRange;
  // The range sub-nav lives in the LEFT SIDEBAR (renderList), so the content is
  // full-width: the Today view leads with the live per-channel summary box.
  const summary = dashRange === "today" ? dashTodayBox(s) : "";
  // KPI cards (redesign 2026-07-05): icon chip + big number + a helping sub-line,
  // derived ONLY from fields /stats already returns — no new reads. Every card is
  // a BUTTON that opens its detail (owner's rule: no dead stat tiles), and no card
  // repeats a number another card's sub-line already states.
  const kpi = (id, icon, tint, label, value, sub, texty) => `
    <button class="dash-card" data-kpi="${id}" type="button" title="Open detail">
      <span class="kic" style="background:${tint}22;color:${tint}"><i class="fa-solid ${icon}"></i></span>
      <span class="kbody"><small>${label}</small><b${texty ? ` class="ktext"` : ""}>${value}</b></span>
      <span class="ksub">${sub}</span>
      <i class="fa-solid fa-chevron-right kgo" aria-hidden="true"></i>
    </button>`;
  const peakHour = (s.hours || []).some((v) => v > 0) ? (s.hours || []).indexOf(Math.max(...s.hours)) : -1;
  const topDish = (s.topDishes || [])[0];
  body.innerHTML = `
    ${summary}
    <div class="dash-cards">
      ${kpi("revenue", "fa-indian-rupee-sign", "#b97f35", `Revenue · ${rangeLabel}`, inr(s.revenue), s.paid ? `avg ${inr(s.avgOrder)} per paid bill` : "no paid bills yet")}
      ${kpi("orders", "fa-utensils", "#2a78d6", "Orders", s.orderCount, `${s.paid} paid · ${s.unpaid} unpaid`)}
      ${kpi("peak", "fa-clock", "#168e5d", "Busiest hour", peakHour < 0 ? "—" : `${peakHour}:00`, peakHour < 0 ? "no orders yet" : `${s.hours[peakHour]} order${s.hours[peakHour] === 1 ? "" : "s"} in that hour`)}
      ${kpi("topdish", "fa-star", "#9085e9", "Top dish", topDish ? esc(topDish[0]) : "—", topDish ? `${topDish[1]} plates sold` : "no dishes sold yet", true)}
      ${kpi("cancelled", "fa-ban", "#b34a4a", "Cancelled", s.cancelled, "kept out of revenue")}
    </div>
    <div class="dash-grid">
      <div class="dash-chart wide"><h4>Sales <span>· ${rangeLabel}</span></h4><div class="chart-wrap tall"><canvas id="chSales"></canvas></div></div>
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
    cancelled: () => goBills("previous"),
    peak: () => document.getElementById("chHours")?.closest(".dash-chart")?.scrollIntoView({ behavior: "smooth", block: "center" }),
    topdish: () => {
      const t = (s.topDishes || [])[0]?.[0];
      const item = (state.data.items || []).find((i) => i.title === t);
      if (item && typeof openDishEditModal === "function") openDishEditModal(item.id, () => {});
      else setTab("items");
    },
  };
  body.querySelectorAll("[data-kpi]").forEach((b) => (b.onclick = () => KPI_GO[b.dataset.kpi]?.()));
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
  // Sales — gradient area, ₹k axis, index-hover. Words instead of a blank grid at ₹0.
  const salesPts = s.series.map((p) => Math.round((p.revenue || 0) * INR_RATE));
  if (salesPts.some((v) => v > 0)) {
    const sctx = document.getElementById("chSales").getContext("2d");
    const grad = sctx.createLinearGradient(0, 0, 0, 260);
    grad.addColorStop(0, "rgba(185,127,53,.28)"); grad.addColorStop(1, "rgba(185,127,53,.02)");
    dashCharts.push(new Chart(sctx, {
      type: "line",
      data: { labels: s.series.map((p) => p.label), datasets: [{ label: "₹ sales", data: salesPts, borderColor: gold, backgroundColor: grad, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.25 }] },
      options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => " " + inr(c.parsed.y) } } },
        scales: { x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: tickLimit("chSales") } },
                  y: { beginAtZero: true, border: { display: false }, ticks: { maxTicksLimit: 5, callback: (v) => v >= 1000 ? "₹" + Math.round(v / 1000) + "k" : "₹" + v } } } },
    }));
  } else {
    emptyCard("chSales", `Sales <span>· ${rangeLabel}</span>`, "No sales in this range yet.");
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
      <div class="pay-row">
        <span class="dot" style="background:${catColor(i)}"></span>
        <span class="m">${esc(c)}</span><span class="amt">${n.toLocaleString("en-IN")}</span>
        <span class="meta">${Math.round((n / catTotal) * 100)}% of plates</span>
      </div>`).join("");
    dashCharts.push(new Chart(document.getElementById("chCats"), {
      type: "doughnut",
      data: { labels: catEntries.map(([c]) => c), datasets: [{ data: catEntries.map(([, n]) => n), backgroundColor: catEntries.map((_, i) => catColor(i)), borderColor: surface, borderWidth: 2, hoverOffset: 6 }] },
      options: { cutout: "68%", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.parsed} plates` } } } },
    }));
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
      <div class="pay-row">
        <span class="dot" style="background:${payColor(m)}"></span>
        <span class="m">${esc(m)}</span><span class="amt">${inr(rev)}</span>
        <span class="meta">${Math.round((rev / payTotal) * 100)}%${bills ? ` · ${bills} bill${bills === 1 ? "" : "s"}` : ""}</span>
      </div>`).join("");
    dashCharts.push(new Chart(payChart, {
      type: "doughnut",
      data: { labels: payEntries.map(([m]) => m), datasets: [{
        data: payEntries.map(([, rev]) => rev),
        backgroundColor: payEntries.map(([m]) => payColor(m)),
        borderColor: surface, borderWidth: 2, hoverOffset: 6,
      }] },
      options: { cutout: "68%", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${inr(ctx.parsed)}` } } } },
    }));
  } else if (payChart) {
    emptyCard("chPay", `Payment methods <span>· ${rangeLabel}</span>`, "No paid bills in this range yet.");
  }
}
// Chart ink (axis labels, donut slice-gaps) is baked into the canvas at draw
// time, so a light↔dark flip while the Dashboard is open must redraw it once.
new MutationObserver(() => {
  if (document.querySelector('.tab[data-tab="dash"].active')) loadDashboard();
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
  const invNo = sess && sess.invoice_no != null ? esc(invFmt(sess.invoice_no)) : "";
  const billNo = sess && sess.bill_no != null ? esc(sess.bill_no) : "";
  const now = new Date();
  const pct = Math.round(m.rate * 10000) / 100; // e.g. 5
  const half = Math.round((m.tax / 2) * 100) / 100;
  // Tax rows on the printed bill: if the restaurant configured named components
  // (tax_components → m.taxComponents), itemise EACH (label · its % · its amount, amounts
  // computed from the taxable value so they sum to m.tax). Otherwise keep the historical
  // 50/50 CGST+SGST split. (owner, 2026-07-03 — customisable multi-tax on the customer bill.)
  const taxRows = (m.taxComponents && m.taxComponents.length)
    ? m.taxComponents.map((c) => `<div class="t"><span>${esc(c.label)} ${c.rate}%</span><span>${inr(Math.round(m.taxable * (c.rate / 100) * 100) / 100)}</span></div>`).join("")
    : `<div class="t"><span>CGST ${pct / 2}%</span><span>${inr(half)}</span></div><div class="t"><span>SGST ${pct / 2}%</span><span>${inr(half)}</span></div>`;
  const w = window.open("", "_blank", "width=380,height=680");
  if (!w) { toast("Allow popups for this site to print the bill", "err"); return; }
  w.document.write(`<!doctype html><title>Tax Invoice — ${name}</title>
<style>
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
  .g{display:flex;justify-content:space-between;border-top:2px solid #111;margin-top:7px;padding-top:7px;font-weight:700;font-size:14px}
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
<div style="margin-top:8px">
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
<div class="sec">Platform (Zomato / Swiggy / takeaway)</div>
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

// Save ONE switch: merge it into the current overrides and store the whole
// features object (the server replaces the JSON bag as a unit).
async function saveFeature(key, value) {
  const prev = (state.data.settings || {}).features || {};
  const next = { ...prev, [key]: value };
  state.data.settings = { ...(state.data.settings || {}), features: next }; // optimistic
  try { const r = await api("POST", "/settings", { features: next }); state.data.settings = r; toast("Saved", "ok"); }
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
    ed.innerHTML = `<div class="ed-head"><h2>Dashboard</h2><div style="display:flex;gap:8px"><button class="btn primary" id="mgrReport">📄 Download report</button><button class="btn" id="zReport">📋 Day-close (Z)</button><button class="btn" id="dashRefresh">↻ Refresh</button></div></div><div id="dashBody" class="dash-body"><div class="empty">Crunching the numbers…</div></div>`;
    document.getElementById("dashRefresh").onclick = () => renderEditor();
    document.getElementById("zReport").onclick = () => printZReport();
    document.getElementById("mgrReport").onclick = () => printManagerReport();
    loadDashboard();
    return;
  }
  if (state.tab === "platform") {
    ed.innerHTML = platformHtml();
    bindPlatform();
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
        if (await confirmDialog("Delete this order? It will be permanently removed.", "Delete")) deleteOrders([btn.dataset.del]);
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
        if (ids.length && await confirmDialog(`Delete this whole bill (${ids.length} order${ids.length > 1 ? "s" : ""})? Permanently removed.`, "Delete")) deleteOrders(ids);
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
      if (await confirmDialog(`Delete ${ids.length} selected order${ids.length > 1 ? "s" : ""}? They'll be permanently removed.`, "Delete")) deleteOrders(ids);
    };
    // Clear every freed/archived record in one go (the records you can't otherwise
    // reach with the active-orders bulk bar).
    const clearFreed = document.getElementById("clearFreed");
    if (clearFreed) clearFreed.onclick = async () => {
      const ids = (state.data.orders || []).filter((o) => o.archived).map((o) => o.id);
      if (!ids.length) return;
      if (await confirmDialog(`Permanently delete all ${ids.length} freed record${ids.length > 1 ? "s" : ""}?`, "Delete")) deleteOrders(ids);
    };
    return;
  }
  // From here down we're on an editable tab (dishes/categories/filters/settings).
  // If nothing is selected yet, show a gentle prompt.
  if (!state.sel) {
    ed.innerHTML = `<div class="empty">Pick something on the left, or hit <b>+ New</b>.</div>`;
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

  // ---- "User setting" card (Settings tab): the manager's own team ----
  if (state.tab === "general" && !state.staffLoaded) loadStaffTeam();

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
    const payload = { ...dish };
    delete payload.created_at;
    delete payload.updated_at;
    await api("POST", "/items", payload);
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
  const it = state.sel;
  const kind = state.tab === "general" ? "settings" : state.tab; // which table to write to
  const keyField = (state.tab === "items" || state.tab === "general") ? "id" : "slug"; // its unique-key column
  // New dish: if the id (permanent key) or slug (URL) weren't filled in, derive
  // them from the title so adding a dish never fails for a missing key. You only
  // have to type a name. (Editing keeps the existing id/slug untouched.)
  if (state.tab === "items" && state.isNew) {
    const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!it.slug && it.title) it.slug = slugify(it.title);
    if (!it.id) it.id = it.slug || slugify(it.title);
  }
  if (state.tab === "items" && !it.title) { toast("Give the dish a name first", "err"); return; }
  if (!it[keyField]) { toast(`${keyField === "id" ? "ID" : "Slug"} is required`, "err"); return; }
  if (state.tab === "items" && !it.slug) { toast("Slug is required", "err"); return; }

  // Copy the record but drop the timestamps — the database manages those itself.
  const payload = { ...it };
  delete payload.created_at;
  delete payload.updated_at;
  try {
    const key = recKey(it);
    await api("POST", "/" + kind, payload);
    toast("Saved ✓", "ok");
    await loadAll();
    if (state.tab === "general") {
      state.sel = clone(state.data.settings || it);
    } else {
      const fresh = records().find((r) => recKey(r) === key);
      state.sel = fresh ? clone(fresh) : null;
    }
    state.isNew = false;
    renderList();
    renderEditor();
  } catch (e) {
    toast("Save failed: " + e.message, "err");
  }
}

// removeRecord: permanently delete the currently-selected dish/category/filter.
async function removeRecord() {
  const it = state.sel;
  // Use the app's own styled confirm dialog (every other delete does), not the
  // browser's plain native popup — keeps the look consistent.
  if (!(await confirmDialog(`Delete "${recLabel(it)}"? This can't be undone.`, "Delete"))) return;
  try {
    await api("DELETE", "/" + state.tab + "/" + encodeURIComponent(recKey(it)));
    toast("Deleted", "ok");
    state.sel = null;
    state.isNew = false;
    await loadAll();
    renderEditor();
  } catch (e) {
    toast("Delete failed: " + e.message, "err");
  }
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
  return new Date(ts).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
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
    await api("POST", "/settings", { id: "site", [which]: days });
    state.data.settings = { ...(state.data.settings || { id: "site" }), [which]: days };
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
  const body = rows
    .filter((r) => r && r.value != null && r.value !== "")
    .map((r) => `<div class="ld-row"><span class="ld-k">${esc(r.label)}</span><span class="ld-v">${esc(r.value)}</span></div>`)
    .join("");
  wrap.innerHTML = `
    <div class="confirm-box logdetail">
      <div class="confirm-msg"><b>${esc(title)}</b></div>
      <div class="ld-list">${body}</div>
      <div class="confirm-actions"><button class="btn confirm-ok">Close</button></div>
    </div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  const close = () => { wrap.classList.remove("show"); setTimeout(() => wrap.remove(), 200); };
  wrap.querySelector(".confirm-ok").onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  document.addEventListener("keydown", function k(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", k); }
  });
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
  lastBoardSig = sig;
  const ed = $("#editor");
  // Don't yank the floor out from under the owner mid-edit: if they're typing in a
  // field during a background poll, hold off on the full redraw.
  const typing = document.activeElement && ed.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (!fromPoll || !typing) {
    // Keep the in-panel table detail's scroll across a background re-render so a
    // live poll never flings a half-read order list back to the top.
    const prevBody = ed.querySelector(".tp-detail-body");
    const detailTop = prevBody ? prevBody.scrollTop : 0;
    renderEditor();
    const newBody = ed.querySelector(".tp-detail-body");
    if (newBody) newBody.scrollTop = detailTop;
  }
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
    // Gmail-style 8s UNDO: reopen exactly the tables we closed (fresh sessions).
    toast(skipped ? `Closed ${closed}, left ${skipped} (unpaid/cooking)` : `Closed ${closed} table${closed > 1 ? "s" : ""}`, skipped ? "err" : "ok", closedTables.length ? {
      label: "UNDO",
      fn: async () => {
        await Promise.allSettled(closedTables.map((tb) => api("POST", "/sessions/open", { table: tb })));
        await loadSessions();
        toast(`Reopened ${closedTables.length} table${closedTables.length > 1 ? "s" : ""}`, "ok");
      },
    } : undefined, 8000);
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
  try {
    await api("POST", "/sessions/" + id + "/close", force ? { force: true } : undefined);
    state.openSess = null; state.selectedTable = null; document.querySelector(".sx-modal-overlay")?.remove(); // close modal AND the in-panel detail
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
    await api("POST", "/blocklist", { member_id: id, phone: phone || undefined });
    await api("POST", "/members/" + id + "/remove");
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
    toast("Marked attended", "ok");
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
  const items = os.flatMap((o) => orderItemRows(o));
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
  const due = os.filter(isUnpaidBill).reduce((s, o) => s + (parseFloat(o.total) || 0) - (parseFloat(o.discount) || 0), 0);

  let st = "free", label = "Free", meta = "tap to open";
  if (os.length) {
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
    meta = items.length ? `${served}/${totalQ} served${due > 0 ? ` · ${inr(due)} due` : ""}` : `${os.length} order${os.length > 1 ? "s" : ""}`;
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
  return `<div class="ftile ft-${st}${pay ? " pay-" + pay : ""}${String(state.selectedTable) === String(i) ? " ft-sel" : ""}" data-floor-table="${i}" role="button" tabindex="0">
        ${offIcon}
        <div class="ft-top"><span class="ft-num">${i}</span>${badges ? `<span class="ft-badges">${badges}</span>` : ""}</div>
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
  for (let i = 1; i <= n; i++) {
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
  for (let i = 1; i <= n; i++) {
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
  const main = `<div class="floor-main"><div class="ed-head"><h2>Table view <span class="sub">· live</span></h2>${collapsedNow ? "" : densityBtnsHtml()}</div>${statsStrip}${legend}<div class="ftile-grid" data-density="${state.floorTileDensity || "m"}">${tiles}</div></div>`;

  // side panel — everyday things FIRST (whole-floor open/close, requests, needs),
  // rarely-touched feature switches + café location LAST (owner, 2026-06-12:
  // "these on/off things you rarely use — keep them at the bottom").
  const tgl = (label, key) => `<label class="fc-toggle"><input type="checkbox" data-setting="${key}" ${s[key] ? "checked" : ""}/><span class="fc-sw"></span><span>${label}</span></label>`;
  // Whole-floor bulk actions — used every open/close of the day, so they live on
  // top. (Deliberately STILL not next to the header's Refresh button: a misfired
  // speed-click there once closed the whole floor. Both confirm before acting.)
  const bulkCard = sessionsOn ? `<div class="fc-card"><h3>Whole floor</h3><div class="fc-bulk"><button class="btn small" id="floorOpenAll">⬆ Open all</button><button class="btn small danger" id="floorCloseAll">⬇ Close all</button></div></div>` : "";
  const controls = `<div class="fc-card">
      <h3>Features <span class="sub">· rarely changed</span></h3>
      ${tgl("System ON", "sessions_enabled")}
      <div class="fc-sub"${sessionsOn ? "" : " hidden"}>${tgl("Require location", "require_location")}${tgl("Require code", "require_otp")}</div>
      <h4>Café location</h4>
      <div class="fc-geo">
        <label class="fc-field"><span>Latitude (north–south)</span><input class="sx-input" id="fcLat" placeholder="e.g. 23.0274" value="${s.geo_lat ?? ""}"/></label>
        <label class="fc-field"><span>Longitude (east–west)</span><input class="sx-input" id="fcLng" placeholder="e.g. 72.4726" value="${s.geo_lng ?? ""}"/></label>
        <label class="fc-field"><span>Radius (metres)</span><input class="sx-input" id="fcRad" placeholder="e.g. 250" value="${s.geo_radius_m ?? 250}"/></label>
      </div>
      <button class="btn small primary" id="fcSaveGeo">Save location</button></div>`;

  // Pending JOINERS + open/join/access requests → the "Requests" card; active waiter
  // calls → the "Needs" card. Both are now built by SHARED module-level functions
  // (floorReqCardHtml / floorNeedsCardHtml) so the incremental patch path can refresh
  // just these two cards in place with byte-identical markup. They carry stable ids
  // (#fcReq / #fcNeeds) and their buttons are wired by the ONE delegated click handler.
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
    const { headPill, headMeta, sessionSec, ordersSec, callsSec, billSec, foot } = parts;
    // Pop this table out into the FLOATING layer (owner request, 2026-07-02 — "movable",
    // "many popups at the same time"). Docking back happens from the floating card's own
    // "⇱ Dock" button (bindFloor), not here — this button only ever pops OUT.
    const alreadyFloating = state.floatingTables.some((f) => String(f.table) === String(t));
    const floatBtn = alreadyFloating ? "" : `<button class="tp-detail-float" data-float-open="${esc(t)}" title="Pop out as a movable floating window">⤢ Float</button>`;
    sideInner = `<div class="tp-detail" data-table-detail="${esc(t)}">
        <div class="tp-detail-head">
          <div class="tp-detail-top"><h3>Table ${esc(t)}</h3>${headPill}${floatBtn}<button class="tp-detail-close" id="tpDetailClose" aria-label="Back to floor controls" title="Back to floor controls">✕</button></div>
          ${headMeta}
        </div>
        <div class="tp-detail-body">${sessionSec}${ordersSec}${callsSec}${billSec}</div>
        <div class="tp-detail-foot">${foot}</div>
      </div>`;
  } else {
    sideInner = `${bulkCard}${reqCard}${needsCard}${blkCard}${controls}`;
  }
  // FLOATING LAYER: every table in state.floatingTables gets its own draggable card,
  // rendered ALONGSIDE whatever the side panel is doing above — fully independent (owner,
  // 2026-07-02: "this only happens in popup mode, not the side thing — when the side thing
  // is closed [docked] that still happens [normally]"). Non-pinned cards get their
  // left/top/width from layoutFloatingRow() right after this markup lands (bindFloor);
  // pinned ones (dragged) keep the exact x/y/w they were dropped at.
  const floatingLayerHtml = state.floatingTables.map((f) => {
    const parts = tablePanelParts(f.table);
    const { headPill, headMeta, sessionSec, ordersSec, callsSec, billSec, foot } = parts;
    const dockBtn = isPhoneLayout() ? "" : `<button class="tp-detail-float" data-float-dock="${esc(f.table)}" title="Dock back to the side panel">⇱ Dock</button>`; // no side panel on a phone → nothing to dock into
    // A PINNED card keeps its dragged/resized geometry (x/y/w/h); a free one gets only its
    // auto-arrange width here and its left/top/width from layoutFloatingRow after render.
    const styleParts = [`width:${f.w || 400}px`];
    if (f.pinned && f.x != null) { styleParts.push(`left:${f.x}px`, `top:${f.y}px`, "right:auto"); if (f.h) styleParts.push(`height:${f.h}px`); }
    return `<div class="tp-detail-floating${f.pinned ? " tp-pinned" : ""}" data-floating-table="${esc(f.table)}" style="${styleParts.join(";")}">
      <div class="tp-detail" data-table-detail="${esc(f.table)}">
        <div class="tp-detail-head">
          <div class="tp-detail-top"><h3>Table ${esc(f.table)}</h3>${headPill}${dockBtn}<button class="tp-detail-close" data-float-close="${esc(f.table)}" aria-label="Close" title="Close">✕</button></div>
          ${headMeta}
        </div>
        <div class="tp-detail-body">${sessionSec}${ordersSec}${callsSec}${billSec}</div>
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
    // The bulk Open-all / Close-all live in the side panel — which is hidden while
    // collapsed. Without this, "Open all" vanished when the floor was collapsed (owner
    // 2026-06-27: "open all tables button not working"). Surface them in a small bar on
    // the collapsed floor so they're always reachable. Same ids → bindFloor wires them;
    // the side panel's copies never co-exist (the panel isn't rendered when collapsed).
    const cb = sessionsOn ? `<div class="floor-collapsed-bar"><button class="btn small" id="floorOpenAll" title="Open all tables">⬆ Open all</button><button class="btn small danger" id="floorCloseAll" title="Close all tables">⬇ Close all</button></div>` : "";
    return `<div class="floor-wrap floor-collapsed">${main}${cb}<button class="floor-side-toggle is-collapsed" id="floorSideToggle" title="Show floor controls" aria-label="Show floor controls">‹</button></div>${floatingLayerHtml}`;
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
  // While ANY table's DETAIL is open (docked, collapsed-mode modal, or a floating popup), the
  // detail node(s) + their slice rows need the full render path to refresh — so patch isn't
  // safe; fall back. (Churn while a few tables are open is bounded — not the steady-state freeze case.)
  if (detailTables().length) { loadSessions(true); return false; }
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
// settings toggles, Save location, the Block input, the Blocked card's Unblock, the resizer,
// and the selected-table detail panel) stay in bindFloor and are re-wired on full renders.
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
  ed.querySelectorAll("[data-setting]").forEach((c) => (c.onchange = () => saveSetting(c.dataset.setting, c.checked)));
  const sg = document.getElementById("fcSaveGeo"); if (sg) sg.onclick = saveGeo;
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

// Flip a session toggle (system on / require location / require code) right from the floor.
// OPTIMISTIC: the toggle (and anything it shows/hides) reacts instantly.
async function saveSetting(key, value) {
  const prev = (state.data.settings || {})[key];
  state.data.settings = { ...(state.data.settings || {}), [key]: value };
  floorOpsInFlight++;
  loadSessions(true);
  try { const r = await api("POST", "/settings", { [key]: value }); state.data.settings = r; loadSessions(true); toast("Saved", "ok"); }
  catch (e) {
    state.data.settings = { ...(state.data.settings || {}), [key]: prev }; // undo
    loadSessions(true);
    toast("Failed: " + e.message, "err");
  } finally { floorOpsInFlight--; }
}
// Save the café location from the side panel.
async function saveGeo() {
  const lat = (document.getElementById("fcLat").value || "").trim();
  const lng = (document.getElementById("fcLng").value || "").trim();
  const rad = (document.getElementById("fcRad").value || "").trim();
  try {
    const r = await api("POST", "/settings", { geo_lat: lat === "" ? null : parseFloat(lat), geo_lng: lng === "" ? null : parseFloat(lng), geo_radius_m: rad === "" ? 250 : parseInt(rad, 10) });
    state.data.settings = r; toast("Location saved", "ok");
  } catch (e) { toast("Failed: " + e.message, "err"); }
}

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
function closeTablePanel() { state.openSess = null; document.querySelector(".sx-modal-overlay")?.remove(); }

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
  const unpaidOs = os.filter((o) => o.status !== "cancelled" && o.payment_status !== "paid");
  const mBill = billMath(os);
  const mDue = billMath(unpaidOs);
  const due = streaming ? (Number(sumTile.due) || 0) : mDue.total;
  const billTotal = streaming ? (Number(sumTile.due) || 0) : mBill.total;
  const canFree = os.length > 0 && os.every((o) => o.payment_status === "paid" || o.status === "cancelled");

  // ── HEAD: a status pill, a one-line summary (bill #, guests, dishes, due) and a
  // dish-status PROGRESS BAR (how much of this table is served vs cooking vs new).
  // Both detail views (in-panel + legacy modal) render these so they stay identical.
  const tile = tableTileState(t);
  const headPill = `<span class="tp-pill tp-pill-${esc(tile.st)}">● ${esc(tile.label)}</span>`;
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
    return { sess: null, os: [], canFree: false, headPill, headMeta, sessionSec, ordersSec, callsSec: "", billSec: "", foot: "" };
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
  const printBtn = os.length ? `<button class="btn" id="sxPrint">🖨 Print</button>` : "";
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
  const foot = `${primaryBtn}${payAllBtn}${discBtn}<span class="tp-foot-spacer"></span>${sess ? `<button class="btn" id="sxShift" title="Move this party to another table">⇄ Shift</button>` : ""}${printBtn}${os.length ? `<button class="btn" data-tp-restart="${esc(t)}">↻ Restart</button>` : ""}${endBtn}`;

  return { sess, os, canFree, headPill, headMeta, sessionSec, ordersSec, callsSec, billSec, foot };
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

// Shift-table PICKER — mirrors the tablet's nice modal (was a bare prompt() here):
// a grid of the FREE tables to move this party (orders + calls + bill) onto. Only
// free tables show, so you can't pick an occupied one. (owner, 2026-06-18)
function openShiftPicker(t, sess) {
  document.querySelector(".shift-overlay")?.remove();
  const n = Math.max(1, parseInt((state.data.settings || {}).table_count, 10) || 12);
  const free = [];
  // "Free to move to" = not THIS table and not currently open — read from the slim summary
  // (the board is no longer fetched whole, so openSessionForTable only knows the open-detail table).
  for (let i = 1; i <= n; i++) { if (String(i) !== String(t) && !summaryTableOpen(i)) free.push(i); }
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
      await loadSessions(); toast(`Shifted to table ${to}`, "ok");
      selectTable(to); // follow the party to its new home
    } catch (e) { toast("Failed: " + e.message, "err"); }
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
function openDiscountModal(order, rerender, billTotal) {
  document.querySelector(".disc-overlay")?.remove();
  // billTotal = the WHOLE table's bill (the discount, though stored on one order, is
  // applied table-wide by billMath). Falls back to the single order's total for any
  // legacy caller (bug H8, 2026-07-05).
  const total = billTotal != null ? Number(billTotal) || 0 : Number(order.total) || 0;
  const current = Number(order.discount) || 0;
  const round2 = (n) => Math.round(n * 100) / 100;
  const clamp = (n, lo, hi) => Math.min(Math.max(Number.isFinite(n) ? n : 0, lo), hi);
  // ONE interface, no mode toggle (owner, 2026-07-03 — "merge the two modes… both things
  // in one interface"): a Percent field and an Amount(₹) field that are TWO-WAY LINKED —
  // edit one and the other recalculates from the same discAmount, so they can never disagree.
  // Default 0%. discAmount (₹ off) is the single source of truth the server has always taken.
  let discAmount = current;
  let pctVal = total > 0 ? Math.round((current / total) * 1000) / 10 : 0;

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
        <div class="disc-prev-row grand"><span>They pay</span><b id="discPrevPay">${inr(round2(total - current))}</b></div>
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
    pctVal = total > 0 ? Math.round((discAmount / total) * 1000) / 10 : 0;
    if (typing !== "pct") pctInput.value = discAmount ? String(pctVal) : "";
    if (typing !== "amt") amtInput.value = discAmount ? String(round2(discAmount)) : "";
    wrap.querySelector("#discPrevAmt").textContent = "− " + inr(discAmount);
    wrap.querySelector("#discPrevPay").textContent = inr(round2(total - discAmount));
  };
  paint();

  // Edit % → derive amount. Edit amount → derive %. Both clamp to the bill.
  pctInput.oninput = () => { const p = clamp(parseFloat(pctInput.value), 0, 100); discAmount = round2((total * p) / 100); paint("pct"); };
  amtInput.oninput = () => { discAmount = clamp(parseFloat(amtInput.value), 0, total); paint("amt"); };
  wrap.querySelectorAll(".disc-pct-pick").forEach((c) => (c.onclick = () => { discAmount = round2((total * Number(c.dataset.pct)) / 100); paint(); }));

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
      toast(amount > 0 ? `Discount ${inr(amount)} applied — they pay ${inr(round2(total - amount))}` : "Discount removed", "ok");
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
  // Print bill: a clean printable window with KOT numbers, discounts and totals.
  const pr = root.querySelector("#sxPrint");
  if (pr) pr.onclick = () => printBill(t, sess, os);
  const payAll = root.querySelector("#sxPayAll"); if (payAll) payAll.onclick = () => markTablePaid(t);
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
  // Per-bill discount: opens the "they pay / percent off" modal (openDiscountModal).
  // The discount is stored on ONE order but billMath applies it to the WHOLE table's
  // bill, so the modal must show + cap on the TABLE total (billMath(os)), not the one
  // target order's total — else a multi-order table showed the first order's bill and
  // capped the discount at it (bug H8, 2026-07-05).
  root.querySelectorAll("[data-disc]").forEach((b) => (b.onclick = () => {
    const order = (os || []).find((o) => o.id === b.dataset.disc) || { id: b.dataset.disc, total: parseFloat(b.dataset.discMax) || 0, discount: parseFloat(b.dataset.discCur) || 0 };
    const tableBill = (os && os.length) ? billMath(os).total : (Number(order.total) || 0);
    openDiscountModal(order, rerender, tableBill);
  }));
  const auto = root.querySelector("#sxAuto"); if (auto && sess) auto.onchange = () => setSessAutoApprove(sess.id, auto.checked);
  root.querySelectorAll("[data-mem-approve]").forEach((b) => (b.onclick = () => memberAction(b.dataset.memApprove, "approve")));
  root.querySelectorAll("[data-mem-deny]").forEach((b) => (b.onclick = () => memberAction(b.dataset.memDeny, "remove")));
  root.querySelectorAll("[data-mem-kick]").forEach((b) => (b.onclick = () => kickMember(b.dataset.memKick)));
  root.querySelectorAll("[data-mem-head]").forEach((b) => (b.onclick = () => makeHead(b.dataset.memHead)));
  root.querySelectorAll("[data-mem-ban]").forEach((b) => (b.onclick = () => banMember(b.dataset.memBan, b.dataset.banPhone)));
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
  const prevModal = document.querySelector(".sx-modal-overlay .tbl-modal");
  const savedScroll = prevModal ? prevModal.scrollTop : 0;
  document.querySelector(".sx-modal-overlay")?.remove();
  const t = state.openSess;
  const parts = tablePanelParts(t);
  const { headPill, headMeta, sessionSec, ordersSec, callsSec, billSec, foot } = parts;
  const wrap = el(`<div class="sx-modal-overlay tbl-modal-overlay"><div class="tbl-modal sx-modal"><div class="tbl-modal-head"><div class="tp-detail-top"><h3>Table ${esc(t)}</h3>${headPill}<button class="tbl-modal-close" aria-label="Close">✕</button></div>${headMeta}</div><div class="tbl-modal-body">${sessionSec}${ordersSec}${callsSec}${billSec}</div><div class="tbl-modal-foot">${foot}</div></div></div>`);
  document.body.appendChild(wrap);
  const newModal = wrap.querySelector(".tbl-modal"); if (newModal) newModal.scrollTop = savedScroll;
  wrap.querySelector(".tbl-modal-close").onclick = closeTablePanel;
  wrap.onclick = (e) => { if (e.target === wrap) closeTablePanel(); };
  bindTablePanel(wrap, t, parts, { rerender: renderTablePanel, close: closeTablePanel });
}

// Advance ONE dish in a legacy order (items stored in the order's JSON).
async function legacyItemStatus(orderId, index, status) {
  try {
    await api("POST", "/orders/" + orderId + "/item", { index: Number(index), status }); // persist now
    const o = (state.data.orders || []).find((x) => x.id === orderId);                    // optimistic local update
    if (o && Array.isArray(o.items) && o.items[index]) o.items[index].status = status;
    refreshTableDetail();                                                                 // instant redraw from local state (modal OR in-panel detail)
    scheduleServeFlush();                                                                 // one real refresh after you stop clicking
  } catch (e) { toast("Failed: " + e.message, "err"); }
}

// Accept a whole order (received -> preparing). Flips the order AND its dishes,
// optimistically + poll-shielded so it can't flicker back mid-accept.
async function acceptOrder(orderId) {
  const o = (state.data.orders || []).find((x) => x.id === orderId);
  if (o) { o.status = "preparing"; flipOrderItems(o, "received", "preparing"); opBegin(o.id); }
  floorOpsInFlight++;
  loadSessions(true); renderTablePanel();
  let released = false;
  const release = () => { if (!released) { released = true; floorOpsInFlight--; if (o) opEnd(o.id); } };
  try { await api("POST", "/orders/" + orderId + "/accept"); release(); await loadSessions(); toast("Order accepted → preparing", "ok"); }
  catch (e) { release(); toast("Failed: " + e.message, "err"); await loadSessions(); }
}
// Serve every dish on an order at once → order complete. Optimistic + shielded.
async function serveAllOrder(orderId) {
  const o = (state.data.orders || []).find((x) => x.id === orderId);
  if (o) { o.status = "served"; flipOrderItems(o, null, "served"); opBegin(o.id); }
  floorOpsInFlight++;
  loadSessions(true); renderTablePanel();
  let released = false;
  const release = () => { if (!released) { released = true; floorOpsInFlight--; if (o) opEnd(o.id); } };
  try { await api("POST", "/orders/" + orderId + "/serve-all"); release(); await loadSessions(); toast("All items served", "ok"); }
  catch (e) { release(); toast("Failed: " + e.message, "err"); await loadSessions(); }
}
// Quick action: accept ALL new orders on a table in one tap. Used by BOTH the
// floor tile's Accept AND the detail's "Accept all & prepare" button — one tap
// accepts the whole table (owner: never open the detail just to accept each).
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
  // OPTIMISTIC: tile flips to "Preparing" instantly, server told in background.
  recv.forEach((o) => { o.status = "preparing"; flipOrderItems(o, "received", "preparing"); opBegin(o.id); });
  floorOpsInFlight++;
  loadSessions(true); renderTablePanel();
  // release first, then refresh — see restartTable for why this order matters.
  let released = false;
  const release = () => { if (!released) { released = true; floorOpsInFlight--; recv.forEach((o) => opEnd(o.id)); } };
  try {
    for (const o of recv) await api("POST", "/orders/" + o.id + "/accept");
    toast(recv.length > 1 ? recv.length + " orders accepted → preparing" : "Order accepted → preparing", "ok");
    release(); await pollTables([String(t)]); // refresh THIS tile's summary so the grid reflects truth
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
  orders.forEach((o) => { o.status = "served"; flipOrderItems(o, null, "served"); opBegin(o.id); });
  floorOpsInFlight++;
  loadSessions(true);
  renderTablePanel();
  // release first, then refresh — see restartTable for why this order matters.
  let released = false;
  const release = () => { if (!released) { released = true; floorOpsInFlight--; orders.forEach((o) => opEnd(o.id)); } };
  try {
    for (const o of orders) await api("POST", "/orders/" + o.id + "/serve-all");
    toast("All orders served", "ok");
    release(); await pollTables([String(t)]);
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
  const ids = new Set(cs.map((c) => c.id));
  state.data.calls = before.filter((c) => !ids.has(c.id));
  floorOpsInFlight++;
  loadSessions(true);
  try {
    for (const c of cs) await api("PATCH", "/calls/" + c.id, { resolved: true });
    toast("Attended", "ok");
    floorOpsInFlight--; await pollTables([String(t)]); // clears the tile's call emoji from the summary
  }
  catch (e) { floorOpsInFlight--; state.data.calls = before; await pollTables([String(t)]); toast("Failed: " + e.message, "err"); }
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
    for (const id of ids) await api("PATCH", "/orders/" + id, { archived: true, status: "served" });
    // End the round → RELEASE the head + partners from this session (same as a close),
    // so the next round is a fresh party. (owner, 2026-06-18)
    const rsess = openSessionForTable(t);
    if (rsess) { for (const m of membersOf(rsess.id)) { try { await api("POST", "/members/" + m.id + "/remove"); } catch { /* keep clearing the rest */ } } }
    // keep the table OPEN for the next round — open a fresh session if it doesn't have one
    if ((state.data.settings || {}).sessions_enabled && !openSessionForTable(t)) await api("POST", "/sessions/open", { table: String(t) });
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
  state.openSess = null; state.selectedTable = null; document.querySelector(".sx-modal-overlay")?.remove(); // close modal AND the in-panel detail
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

// oplogHtml: the Operation log — every staff action across the panels (which
// panel did what, where, and when). Fed by /oplog (the staff_actions table).
function oplogHtml() {
  const rows = state.oplog || [];
  const head = `<div class="ed-head"><h2>Operation log <span class="sub">· staff actions</span></h2><div class="ed-head-actions">${retentionControl("oplog_retention_days")}<button class="btn" id="refreshOplog">↻ Refresh</button></div></div>
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
      <div class="opcell"><span class="op-panel op-${esc(r.panel)}">${esc(r.panel)}</span></div>
      <div class="opcell"><b>${esc(ACT[r.action] || r.action)}</b></div>
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
  // "Keep logs for …" dropdown (both logs) → save the new retention.
  ed.querySelectorAll(".ret-select").forEach((s) => (s.onchange = () => saveRetention(s.dataset.ret, s.value)));
  // Click a row to open its full detail (ignore clicks that landed on a button,
  // e.g. Block/Unblock/Exit — those do their own thing).
  ed.querySelectorAll("[data-op-detail]").forEach((row) => (row.onclick = (e) => { if (!e.target.closest("button")) showOpDetail(row.dataset.opDetail); }));
  ed.querySelectorAll("[data-cust-detail]").forEach((row) => (row.onclick = (e) => { if (!e.target.closest("button")) showCustDetail(row.dataset.custDetail); }));
}

// showOpDetail: open the full-info card for one operation-log row.
function showOpDetail(id) {
  const r = (state.oplog || []).find((x) => x.id === id);
  if (!r) return;
  logDetailDialog("Operation log entry", [
    { label: "Action", value: OP_ACTION_LABELS[r.action] || r.action },
    { label: "Panel", value: r.panel },
    { label: "Device", value: r.device_id ? "#" + r.device_id : "—" },
    // The "who" slot — filled once staff login lands (migration 053 actor column).
    { label: "By", value: r.actor || "— (no staff login yet, device only)" },
    { label: "Table", value: r.table_number ? "Table " + r.table_number : "" },
    { label: "Note", value: r.detail || "" },
    { label: "Order id", value: r.order_id || "" },
    { label: "When", value: fullWhen(r.created_at) },
  ]);
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
  takeaway: { label: "Takeaway", cls: "t" },
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
  return `<div class="plat-card ${m.cls}">
    <div class="plat-ch"><span class="plat-badge ${m.cls}">${esc(m.label)}</span><span class="plat-kot">#${esc(o.kot_no ?? "—")}</span><span class="plat-age">${esc(platAge(o.created_at))}</span></div>
    <div class="plat-cust">${esc(o.customer_name || "—")}</div>
    <div class="plat-items">${lines || '<span class="plat-empty">no items</span>'}</div>
    <div class="plat-cf"><span class="plat-tot">${platMoney(o.total)}</span><span class="plat-acts">${action}</span></div>
  </div>`;
}
function platformHtml() {
  const all = state.data.platform || [];
  const tg = state.platformToggles || {};
  const cols = { new: [], prep: [], ready: [], done: [] };
  all.forEach((o) => { const c = platColOf(o.status); if (c) cols[c].push(o); });
  const col = (key, label) => `<div class="plat-col"><div class="plat-col-h">${label} <span class="ct">${cols[key].length}</span></div><div class="plat-col-body">${cols[key].map(platCardHtml).join("") || '<div class="plat-col-empty">—</div>'}</div></div>`;
  return `<div class="ed-head plat-head">
      <h2>Platform <span class="sub">· Zomato · Swiggy · Takeaway</span></h2>
      <div class="plat-head-actions">
        <label class="plat-toggle"><input type="checkbox" id="platInBills" ${tg.platform_in_bills ? "checked" : ""}/> Show in bills</label>
        <button class="btn primary" id="platTestBtn">＋ Add test order</button>
        <button class="btn" id="platRefresh" title="Refresh">↻</button>
      </div>
    </div>
    <div class="plat-board">
      ${col("new", "🆕 New")}${col("prep", "🍳 Preparing")}${col("ready", "✅ Ready")}${col("done", "📦 Handed over")}
    </div>`;
}
function bindPlatform() {
  const tb = document.getElementById("platTestBtn");
  if (tb) tb.onclick = async () => { tb.disabled = true; try { await api("POST", "/platform/test"); await loadPlatform(); toast("Test order added", "ok"); } catch (e) { toast("Failed: " + e.message, "err"); } tb.disabled = false; };
  const rf = document.getElementById("platRefresh"); if (rf) rf.onclick = loadPlatform;
  const ib = document.getElementById("platInBills");
  if (ib) ib.onchange = async () => { try { await api("POST", "/platform/toggles", { platform_in_bills: ib.checked }); toast(ib.checked ? "Platform orders will show in bills" : "Platform orders hidden from bills", "ok"); } catch (e) { toast("Failed: " + e.message, "err"); ib.checked = !ib.checked; } };
  document.querySelectorAll("[data-plat-act]").forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { await api("POST", `/platform/${b.dataset.platId}/status`, { status: b.dataset.platAct }); await loadPlatform(); }
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
  const seq = ++platSeq;
  try {
    const res = await api("GET", "/platform");
    if (seq !== platSeq) return;
    state.data.platform = res.orders || [];
    state.platformToggles = res.toggles || {};
    updatePlatformBadge();
    if (state.tab === "platform") renderEditor();
  } catch { /* keep last good board */ }
}

function setTab(tab) {
  state.tab = tab;
  try { localStorage.setItem("lfh_editor_tab", tab); } catch {}
  state.isNew = false;
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
  const noList = tab === "general" || tab === "orders" || tab === "tables" || tab === "platform" || tab === "log" || tab === "features" || tab === "dash";
  $("#newBtn").style.display = noList ? "none" : "";
  $("#search").style.display = noList ? "none" : "";
  // Tables tab: drop the whole left sidebar (it only held a dead "Floor map" label).
  // The floor already has its own left tiles + right detail, so it takes the full
  // width — the .no-sidebar class collapses the grid's first column to nothing.
  const layout = document.querySelector(".layout");
  if (layout) layout.classList.toggle("no-sidebar", tab === "tables" || tab === "platform");
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
async function generateInvoice(sid) {
  try { await api("POST", `/sessions/${sid}/invoice`); await loadOrders(); toast("Invoice generated", "ok"); }
  catch (e) { toast("Failed: " + e.message, "err"); }
}
async function voidInvoice(sid) {
  if (!(await confirmDialog("Reopen this bill? Its invoice is voided (kept in records) and the bill unlocks for edits — a new invoice number is issued next time.", "Reopen bill"))) return;
  const reason = window.prompt("Reason for voiding (optional):", "") || null;
  try { await api("POST", `/sessions/${sid}/void-invoice`, { reason }); await loadOrders(); toast("Invoice voided — bill reopened", "ok"); }
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
    const sig = JSON.stringify([
      orders.map((o) => [o.id, o.status, o.payment_status, o.archived ? 1 : 0]),
      calls.map((c) => c.id),
      reqCount,
    ]);
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (state.tab === "orders" && sig !== lastPollSig && !typing) { renderList(); renderEditor(); }
    lastPollSig = sig;
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
async function pollTables(tables) {
  if (!tables || !tables.length) return pollOrders();
  const seq = ++dataSeq;
  let results;
  try {
    results = await Promise.all(tables.map(async (t) => {
      const sum = await api("GET", "/summary?table=" + encodeURIComponent(t));
      return { table: String(t), sum: sum || {} };
    }));
  } catch (e) { return pollOrders(); }      // network/parse blip → safe full reload
  if (seq !== dataSeq) return;              // a newer loader started — drop this stale snapshot

  // Patch the changed tables' tiles + refresh the restaurant-wide aggregates (unless a floor
  // action is mid-save, mirroring the board's floorOpsInFlight guard so optimism isn't clobbered).
  if (!floorOpsInFlight) {
    const s = state.summary || { tiles: {} };
    const tiles = Object.assign({}, s.tiles || {});
    const tset = new Set(tables.map(String));
    let latest = null;
    for (const r of results) {
      const t = r.table;
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
        if (seq !== dataSeq) return;
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
        else { pollOrders(); loadPlatform(); }
      },
      menu: () => loadAll(),
    }});
    setInterval(() => { pollOrders(); loadPlatform(); }, 60000); // backup sync (also ages out handed-over platform tickets)
  } else {
    setInterval(() => { pollOrders(); loadPlatform(); }, 2000); // fallback poll
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
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => setTab(t.dataset.tab))); // top tabs switch views
document.querySelectorAll(".subtab").forEach((t) => (t.onclick = () => setTab(t.dataset.tab))); // Editor sub-nav: Dishes/Categories/Tags
$("#newBtn").onclick = newRecord; // the "+ New" button
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
// Typing in the search box filters the left-hand list live.
$("#search").oninput = (e) => { state.search = e.target.value; renderList(); };
// Ctrl+S (or Cmd+S on Mac) saves the current record instead of saving the web page.
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (state.sel) save();
  }
});

// THE STARTING POINT.
// First, open the saved tab IMMEDIATELY — before any data has loaded. This is what
// stops the old "refresh flashes Dishes, then jumps to your real tab" bug: setTab
// used to run only after loadAll() finished, so you stared at the default tab for
// the whole network round-trip. Now the correct tab is shown right away (empty for
// a moment), and the data fills into it when it arrives.
setTab(state.tab);

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
// Extend XRAY_TABS as more tabs become permission-gated. Grant rule matches the
// server's managerCan(): a manager is granted ONLY when the flag is explicitly true.
// ══════════════════════════════════════════════════════════════════════════════
const XRAY_TABS = [
  { tab: "dash", flag: "view_dashboard", label: "Dashboard" },
  // (Bills discount/void live inside the Bills tab as actions, not whole tabs — a
  //  later vertical tints those controls the same way via this same WHO signal.)
];
// Manager powers all live on the OWNER panel's "Staff & powers" (Access) page.
const XRAY_SETTING_URL = "/owner/staff";
let XRAY_WHO = null;

(function injectXrayStyles() {
  const css = `
  /* Tinted (off-for-staff) — colour cue only; stays fully clickable for the higher role. */
  .tab.xray-off { position: relative; color: var(--gold-strong, #b8860b) !important; opacity: .72; }
  .tab.xray-off::after { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%;
    background: #d97706; margin-left: 6px; vertical-align: middle; }
  .xray-pulse { animation: xrayPulse 1.1s ease-out 2; border-radius: 8px; }
  @keyframes xrayPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(217,119,6,0); } 50% { box-shadow: 0 0 0 4px rgba(217,119,6,.55); } }
  /* Faded admin ribbon across the very top — flows above the sticky topbar. */
  #xrayRibbon { display: flex; align-items: center; gap: 12px; padding: 6px 16px;
    background: color-mix(in srgb, #d97706 12%, var(--panel, #fff)); border-bottom: 1px solid color-mix(in srgb, #d97706 40%, transparent);
    font-family: system-ui, sans-serif; font-size: 12px; color: var(--text, #222); position: relative; z-index: 40; }
  #xrayRibbon .rb-tag { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; letter-spacing: .04em;
    color: #b45309; text-transform: uppercase; font-size: 11px; }
  #xrayRibbon .rb-rest { color: var(--muted, #777); font-weight: 600; }
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
  #xrayZones .zrow small { color: var(--muted,#888); margin-left: auto; }`;
  const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
})();

function xrayGrantedForManager(flag) { return XRAY_WHO && XRAY_WHO.managerPermissions && XRAY_WHO.managerPermissions[flag] === true; }

function applyHierarchyView() {
  if (!XRAY_WHO) return;
  const higher = !!XRAY_WHO.higherView;                 // admin/owner looking in
  const zones = [];                                     // tinted things on this page (for the popout)
  for (const entry of XRAY_TABS) {
    const btn = document.querySelector(`.tabs .tab[data-tab="${entry.tab}"]`);
    if (!btn) continue;
    const granted = xrayGrantedForManager(entry.flag);
    btn.hidden = false; btn.classList.remove("xray-off"); btn.removeAttribute("title");
    if (granted) continue;                               // manager has it → normal for everyone
    if (!higher) { btn.hidden = true; continue; }        // real manager → hide entirely
    // higher role → TINT (colour only), still fully usable. Record it as a zone.
    btn.classList.add("xray-off");
    btn.title = `${entry.label} is off for staff — you can still use it (admin view)`;
    zones.push({ ...entry, el: btn });
  }
  renderXrayRibbon(higher, zones);
}

function renderXrayRibbon(higher, zones) {
  let rb = document.getElementById("xrayRibbon");
  const zp = document.getElementById("xrayZones");
  if (!higher) { if (rb) rb.remove(); if (zp) zp.remove(); syncRibbonHeight(); return; }
  if (!rb) { rb = document.createElement("div"); rb.id = "xrayRibbon"; document.body.insertBefore(rb, document.body.firstChild); }
  const who = XRAY_WHO.actor === "admin" ? "Admin" : "Owner";
  const restEl = document.getElementById("brandRest");
  const restName = restEl ? restEl.textContent.replace(/^·\s*/, "") : "";
  const n = zones.length;
  rb.innerHTML =
    `<span class="rb-tag"><i class="fas fa-user-shield"></i> ${who} view</span>` +
    (restName ? `<span class="rb-rest">${restName}</span>` : "") +
    `<span class="rb-spacer"></span>` +
    `<button id="xrayZonesBtn">${n} zone${n === 1 ? "" : "s"} off for staff <i class="fas fa-chevron-down" style="font-size:9px"></i></button>` +
    `<button class="rb-exit" id="xrayExit"><i class="fas fa-arrow-rotate-left"></i> Exit view</button>`;
  document.getElementById("xrayExit").onclick = async () => {
    try { await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) }); } catch {}
    try { window.top.location.href = "/aevinite/restaurants"; } catch { window.location.href = "/aevinite/restaurants"; }
  };
  document.getElementById("xrayZonesBtn").onclick = () => toggleXrayZones(zones);
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
  if (zp) { zp.remove(); return; }
  zp = document.createElement("div"); zp.id = "xrayZones";
  zp.innerHTML = `<div class="zh">Off for staff on this page</div>` + (zones.length
    ? zones.map((z, i) => `<button class="zrow" data-zi="${i}"><span class="dot"></span>${z.label}<small>tap to locate</small></button>`).join("")
    : `<div class="zrow" style="cursor:default">Nothing is off here.</div>`);
  document.getElementById("xrayRibbon").appendChild(zp);
  zp.querySelectorAll(".zrow[data-zi]").forEach((row) => {
    row.onclick = () => {
      const z = zones[+row.dataset.zi];
      zp.remove();
      if (z && z.el) {
        z.el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        z.el.classList.remove("xray-pulse"); void z.el.offsetWidth; z.el.classList.add("xray-pulse");
        toast(`${z.label}: off for staff. Change it in the owner's Access settings.`, "ok");
      }
    };
  });
}
// Close the zones popout on an outside click.
document.addEventListener("click", (e) => {
  const zp = document.getElementById("xrayZones");
  if (zp && !e.target.closest("#xrayZones") && !e.target.closest("#xrayZonesBtn")) zp.remove();
});

api("GET", "/whoami").then((w) => { XRAY_WHO = w; applyHierarchyView(); }).catch(() => {});

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
