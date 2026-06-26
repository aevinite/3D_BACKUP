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
  board: { sessions: [], members: [], items: [], requests: [], blocklist: [] }, // v2 sessions live board
  boardLoaded: false, // false until the live board arrives once → drives the floor skeleton (no "all Free" flash on load)
  openSess: null, // table number whose session modal is open
  selectedTable: null, // table number whose DETAIL is shown IN the right side panel (Tables tab master-detail). null = show the floor controls instead.
  floorSideCollapsed: lsGet("lfh_floor_side_collapsed", "0") === "1", // F1: right floor panel collapsed → clicking a table opens a FULL-SCREEN popup instead of the in-side detail.
  ordersView: lsGet("lfh_editor_ordersview", "live"), // Orders left-bar: live | previous | bills | calls — remembered across refresh
  billSearch: "", billSearchType: "inv", billSort: "new", // Bills → Today/Previous search + sort
  logView: lsGet("lfh_editor_logview", "customers"),  // Log left-bar: customers | operations — remembered across refresh
  users: { members: [], customers: [], blocklist: [] }, // Log tab data
};

// ---------- tiny helpers ----------
// $  : shorthand for "find the first element matching this CSS selector".
const $ = (s, r = document) => r.querySelector(s);
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

// api: the one helper every server call goes through. Give it the HTTP method
// ("GET"/"POST"/"PATCH"/"DELETE"), the path (e.g. "/orders"), and optionally a
// body object. It sends the request to our local server, reads back the JSON,
// and throws a clear error if the server reported a problem.
async function api(method, path, body) {
  const res = await fetch("/api/editor" + path, {
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
    ul.appendChild(el(`<li class="list-item active"><div class="thumb"><i class="fas fa-gear"></i></div><div class="meta"><b>Site settings</b><small>general</small></div></li>`));
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

// formGeneral: the site-wide Settings form — maintenance mode, the bubble
// effect, table count, and the dining-session/location options.
function formGeneral(s) {
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
  </div>
  <div class="card"><h3>Tables / seating</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      How many tables the restaurant has. Drives the live floor map in the
      <b>Tables</b> tab — Save, then open Tables.
    </p>
    <div style="max-width:200px">${tf("Number of tables", "table_count", s.table_count ?? 12, { type: "number", min: 1, max: 500, step: 1 })}</div>
  </div>
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
  </div>
  <div class="card"><h3>Tablet (waiter) permissions</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      What the waiter can do with a bill on the tablet. Each is independent and starts
      <b>Off</b> (hidden). <b>On</b> = the waiter can do it directly; <b>On · needs manager PIN</b>
      = allowed but a manager PIN is required each time. Applying a discount, marking a bill
      paid, and generating an invoice are separate controls.
    </p>
    <div class="grid cols-3">
      ${triSel("Apply discount", "tablet_discount", s.tablet_discount)}
      ${triSel("Mark bill paid", "tablet_mark_paid", s.tablet_mark_paid)}
    </div>
  </div>
  <div class="card"><h3>Billing &amp; invoice</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.5">
      These appear on the printed tax invoice exactly as typed. Set your real name,
      address, phone and GSTIN. <b>Invoice prefix</b> + financial year build the number
      (e.g. <code>LFH/2025-26/000042</code>). <b>Tax rate</b> 0.05 = 5% (blank = 5%).
    </p>
    ${tf("Restaurant name", "restaurant_name", s.restaurant_name ?? "")}
    ${tf("Address", "restaurant_address", s.restaurant_address ?? "")}
    <div class="grid cols-3">
      ${tf("Phone", "restaurant_phone", s.restaurant_phone ?? "")}
      ${tf("GSTIN", "gstin", s.gstin ?? "")}
      ${tf("Invoice prefix", "invoice_prefix", s.invoice_prefix ?? "")}
    </div>
    <div style="max-width:200px">${tf("Tax rate (0.05 = 5%)", "tax_rate", s.tax_rate ?? "", { type: "number", step: "any", min: 0 })}</div>
  </div>
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
    : `${cancelled ? "" : `<button class="ord-btn ${paid ? "ghost" : "pay"}" data-pay="${esc(o.id)}" data-paid="${paid ? "1" : "0"}">
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
    ${Number(o.discount) > 0 ? `<div class="ord-disc">Discount${o.discount_note ? ` (${esc(o.discount_note)})` : ""}<span>− ${inr(o.discount)}</span></div>` : ""}
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
function billMath(orders) {
  const live = (orders || []).filter((o) => o.status !== "cancelled");
  const subtotal = live.reduce((a, o) => a + (parseFloat(o.subtotal) || 0), 0);
  const disc = live.reduce((a, o) => a + (parseFloat(o.discount) || 0), 0);
  const taxable = Math.max(0, subtotal - disc);
  const rate = Number((state.data.settings || {}).tax_rate) || 0.05;
  const tax = Math.round(taxable * rate * 100) / 100;
  const total = Math.round((taxable + tax) * 100) / 100;
  return { subtotal, disc, taxable, rate, tax, total };
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
    const pay = anyUnpaid ? `<button class="ord-btn pay" data-sess-pay="${esc(sessKey)}">💳 Mark paid</button>` : "";
    billBtns = pay + `<button class="ord-btn" data-print-group="${esc(sessKey)}">🖨 Print</button><button class="ord-btn ghost" data-void-invoice="${esc(sid)}">↩ Reopen</button>`;
  } else {
    // legacy non-session order — keep the direct pay
    billBtns = anyUnpaid ? `<button class="ord-btn pay" data-sess-pay="${esc(sessKey)}">💳 Mark paid</button>` : "";
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
    ${disc > 0 ? `<div class="ord-disc">Discount<span>− ${inr(disc)}</span></div>` : ""}
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
// Start of TODAY's business day (05:00 IST) in ms — same rule the server uses, so
// "Today" vs "Previous" bills line up. (The owner's browser is in the café's TZ.)
function businessDayStartMs() {
  const d = new Date(); const s = new Date(d);
  s.setHours(5, 0, 0, 0);
  if (d.getHours() < 5) s.setDate(s.getDate() - 1);
  return s.getTime();
}
function ordersBuckets() {
  const all = state.data.orders || [];
  // LIVE = the active working set: not archived and not cancelled (a still-open bill
  // never hides in a records view wearing live buttons; "Restore to floor" returns
  // it here). RECORDS = archived (freed/settled) OR cancelled — split by day into
  // TODAY (this business day) and PREVIOUS (older).
  const live = all.filter((o) => !o.archived && o.status !== "cancelled");
  const records = all.filter((o) => o.archived || o.status === "cancelled");
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
function ordersPreviousHtml(previous, kind = "previous") {
  const isToday = kind === "today";
  const groups = groupOrdersBySession(previous);
  const bills = groups.map((g) => {
    const o0 = g[0];
    const total = billMath(g).total;
    return {
      key: o0.session_id || ("solo:" + o0.id), table: (o0.table_number || "").trim(),
      billNo: o0.bill_no, invNo: o0.invoice_no, voided: !!o0.invoice_voided,
      customer: o0.customer_name || "", total, ts: new Date(o0.created_at || 0).getTime(),
      when: o0.created_at ? new Date(o0.created_at).toLocaleString() : "",
      cancelled: g.every((o) => o.status === "cancelled"),
    };
  });
  const q = (state.billSearch || "").toLowerCase().trim();
  const stype = state.billSearchType || "inv", sort = state.billSort || "new";
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
      <span class="bill-count">${list.length} bill${list.length === 1 ? "" : "s"} · ${inr(list.reduce((s, b) => s + b.total, 0))}</span>
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
  const _bm = billMath(g); const total = _bm.total; const disc = _bm.disc;
  const lines = g.map((o) => (o.items || []).map((i) => {
    const det = itemDetailLine(i);
    return `<div class="bm-line"><span class="bm-nm">${esc(i.title)} <span class="bm-q">×${esc(i.qty)}</span>${det}</span><span class="bm-pr">${inr(parseFloat(i.price) || 0)}</span></div>`;
  }).join("")).join("");
  const wrap = document.createElement("div");
  wrap.className = "bill-overlay";
  wrap.innerHTML = `<div class="bill-modal">
      <div class="bm-head"><b>${o0.table_number ? "Table " + esc(o0.table_number) : "Walk-in"} · Bill #${esc(o0.bill_no ?? "—")}</b>
        ${o0.invoice_no != null ? `<span class="inv-chip${o0.invoice_voided ? " voided" : ""}">${esc(invFmt(o0.invoice_no))}${o0.invoice_voided ? " · voided" : ""}</span>` : ""}</div>
      <div class="bm-sub">${esc(o0.customer_name || "")}${o0.created_at ? " · " + esc(new Date(o0.created_at).toLocaleString()) : ""}</div>
      <div class="bm-items">${lines}</div>
      ${disc > 0 ? `<div class="bm-trow"><span>Discount</span><span>− ${inr(disc)}</span></div>` : ""}
      <div class="bm-trow grand"><span>Total</span><span>${inr(total)}</span></div>
      <div class="bm-actions">
        <button class="btn primary" data-bm-print>🖨 Print</button>
        <button class="btn" data-bm-restore>↩ Restore to floor</button>
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
  wrap.querySelector("[data-bm-restore]").onclick = async () => { close(); for (const o of g) await restoreTable(o.id); };
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

// Bring a previous-order record back onto the live floor. Un-archive it, and if
// it was cancelled, revive it to "received" so it re-enters the live working set
// (otherwise a restored cancelled order would stay filed under Previous). After
// this it's a normal live order again and can be edited the usual way.
async function restoreTable(id) {
  const o = (state.data.orders || []).find((x) => x.id === id);
  const patch = { archived: false };
  if (o && o.status === "cancelled") patch.status = "received";
  try {
    await api("PATCH", "/orders/" + id, patch);
    if (o) { o.archived = false; if (patch.status) o.status = patch.status; }
    renderEditor();
    toast("Restored to the live floor", "ok");
  } catch (e) {
    toast("Restore failed: " + e.message, "err");
  }
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
  lastOrderCount = state.data.orders.length;
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
    lastOrderCount = before.length;
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
    await api("PATCH", "/orders/" + id, { payment_status: paid ? "paid" : "pending", ...(revertReason ? { revert_reason: revertReason } : {}) });
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

// markTablePaid: settle the WHOLE table in one tap — mark every unpaid (non-
// cancelled) order paid after a single "are you sure?" confirm. Used by the
// on-tile quick button AND the "Mark all paid" button in the table popup, so
// staff don't have to settle three orders separately.
async function markTablePaid(t) {
  const os = ordersForTable(t).filter((o) => o.status !== "cancelled" && o.payment_status !== "paid");
  if (!os.length) { toast("Nothing to settle — already paid", "ok"); return; }
  const due = os.reduce((s, o) => s + (parseFloat(o.total) || 0) - (parseFloat(o.discount) || 0), 0);
  if (!(await confirmDialog(`Mark table ${t} PAID — settle all ${os.length} order${os.length > 1 ? "s" : ""} (${inr(due)})? Only confirm if the payment has actually been collected.`, "Yes, payment done"))) return;
  // One confirm above; each order flips quietly, then one summary toast.
  for (const o of os) await setOrderPayment(o.id, true, { skipConfirm: true, quiet: true });
  toast(`Table ${t} settled 💳`, "ok");
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
  let s;
  try { s = await api("GET", "/stats?range=" + dashRange); }
  catch (e) { body.innerHTML = `<div class="empty">Couldn't load stats: ${esc(e.message)}</div>`; return; }
  const RL = { today: "today", "30d": "last 30 days", year: "last 12 months" };
  const rangeLabel = RL[dashRange] || dashRange;
  // The range sub-nav lives in the LEFT SIDEBAR (renderList), so the content is
  // full-width: the Today view leads with the live per-channel summary box.
  const summary = dashRange === "today" ? dashTodayBox(s) : "";
  body.innerHTML = `
    ${summary}
    <div class="dash-cards">
      <div class="dash-card"><small>Revenue · ${rangeLabel}</small><b>${inr(s.revenue)}</b></div>
      <div class="dash-card"><small>Orders</small><b>${s.orderCount}</b></div>
      <div class="dash-card"><small>Avg order</small><b>${inr(s.avgOrder)}</b></div>
      <div class="dash-card"><small>Paid / unpaid</small><b>${s.paid} / ${s.unpaid}</b></div>
      <div class="dash-card"><small>Cancelled</small><b>${s.cancelled}</b></div>
    </div>
    <div class="dash-grid">
      <div class="dash-chart"><h4>Sales · ${rangeLabel}</h4><canvas id="chSales"></canvas></div>
      <div class="dash-chart"><h4>Top dishes</h4><canvas id="chTop"></canvas></div>
      <div class="dash-chart"><h4>Orders by hour</h4><canvas id="chHours"></canvas></div>
      <div class="dash-chart"><h4>Category share</h4><canvas id="chCats"></canvas></div>
    </div>`;
  dashCharts.forEach((c) => { try { c.destroy(); } catch {} });
  dashCharts = [];
  if (typeof Chart === "undefined") { body.insertAdjacentHTML("beforeend", `<div class="empty">Charts library didn't load (offline?) — the numbers above still work.</div>`); return; }
  Chart.defaults.color = "#a89a87"; Chart.defaults.borderColor = "rgba(150,140,125,0.15)";
  const gold = "#d4a574", goldSoft = "rgba(212,165,116,0.25)";
  // Sales series (already bucketed + ordered by the server); shown in rupees (×INR_RATE) to match the cards.
  dashCharts.push(new Chart(document.getElementById("chSales"), {
    type: "line",
    data: { labels: s.series.map((p) => p.label), datasets: [{ label: "₹ sales", data: s.series.map((p) => Math.round((p.revenue || 0) * INR_RATE)), borderColor: gold, backgroundColor: goldSoft, fill: true, tension: 0.35, pointRadius: 2 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  }));
  dashCharts.push(new Chart(document.getElementById("chTop"), {
    type: "bar",
    data: { labels: s.topDishes.map(([t]) => t), datasets: [{ label: "plates", data: s.topDishes.map(([, n]) => n), backgroundColor: gold }] },
    options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
  }));
  dashCharts.push(new Chart(document.getElementById("chHours"), {
    type: "bar",
    data: { labels: Array.from({ length: 24 }, (_, h) => h + ":00"), datasets: [{ label: "orders", data: s.hours, backgroundColor: goldSoft, borderColor: gold, borderWidth: 1 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  }));
  const catEntries = Object.entries(s.cats).sort((a, b) => b[1] - a[1]);
  dashCharts.push(new Chart(document.getElementById("chCats"), {
    type: "doughnut",
    data: { labels: catEntries.map(([c]) => c), datasets: [{ data: catEntries.map(([, n]) => n), backgroundColor: ["#d4a574", "#7ec88a", "#4f9dff", "#e8a13c", "#b58ae6", "#ef7d7d", "#5bc8c8", "#c8b35b", "#8a93a6"] }] },
    options: { plugins: { legend: { position: "right" } } },
  }));
}


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
  // White-label identity: prefer THIS restaurant's own settings, then its menu
  // wordmark. The French House logo / phone / "Merci" footer apply ONLY to the
  // flagship (#1); every other restaurant prints its own name + sign-off.
  const r = state.data.restaurant || {};
  const isDefault = r.slug === "french-house" || r.id === "00000000-0000-0000-0000-000000000001";
  const name = esc(s.restaurant_name || (isDefault ? "Little French House" : (r.logo_text || (r.name && r.name.en) || "Restaurant")));
  const addr = esc(s.restaurant_address || "");
  const phone = esc(s.restaurant_phone || (isDefault ? "+91 90999 14418" : ""));
  const gstin = esc(s.gstin || "");
  // Per-cuisine sign-off so each bill feels native to its restaurant.
  const FOOTERS = {
    "pizza-palace": "Grazie — a presto! 🍕",
    "sakura-sushi": "Arigato — mata kite ne 🍣",
    "taco-fiesta": "¡Gracias — vuelve pronto! 🌮",
    "burger-barn": "Y'all come back now! 🍔",
    "spice-route": "Dhanyavaad — padharo! 🍛",
    "green-bowl": "Stay fresh — see you soon! 🥗",
  };
  const footer = s.bill_footer || FOOTERS[r.slug] || (isDefault ? "Merci — see you again soon 🥐" : "Thank you — please visit again");
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
  <div class="t"><span>CGST ${pct / 2}%</span><span>${inr(half)}</span></div>
  <div class="t"><span>SGST ${pct / 2}%</span><span>${inr(half)}</span></div>
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
    ed.innerHTML = floorHtml();
    bindFloor();
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
        if (!grp.length) return;
        if (!(await confirmDialog("Mark this whole bill PAID? Only confirm if the payment has actually been collected.", "Yes, payment done"))) return;
        for (const o of grp) await setOrderPayment(o.id, true, { skipConfirm: true, quiet: true });
        toast("Bill marked paid 💳", "ok");
      };
    });
    // Today/Previous: bill cards open a modal; search + sort drive the grid.
    ed.querySelectorAll("[data-bill-open]").forEach((c) => { c.onclick = () => openBillModal(c.dataset.billOpen); });
    const _bst = ed.querySelector("[data-bill-stype]");
    if (_bst) _bst.onchange = () => { state.billSearchType = _bst.value; state.billSearch = ""; renderEditor(); };
    const _bso = ed.querySelector("[data-bill-sort]");
    if (_bso) _bso.onchange = () => { state.billSort = _bso.value; renderEditor(); };
    const _bq = ed.querySelector("[data-bill-q]");
    if (_bq) _bq.oninput = () => {
      state.billSearch = _bq.value;
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
        if (!ids.length) return;
        if (!(await confirmDialog(`Mark this whole bill PAID (${ids.length} order${ids.length > 1 ? "s" : ""})? Only confirm if the payment has actually been collected.`, "Yes, payment done"))) return;
        ids.forEach((id) => setOrderPayment(id, true, { skipConfirm: true }));
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
  const title = isGeneral ? "General settings" : (state.isNew ? `New ${TAB_LABEL[state.tab]}` : recLabel(state.sel));
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
      let [board, orders, calls] = await Promise.all([api("GET", "/sessions"), api("GET", "/orders"), api("GET", "/calls")]);
      if (seq !== dataSeq) return; // a newer refresh started — drop this stale snapshot
      // Same shields the 1-second poll uses (see pollOrders). One action's
      // refresh must not wipe ANOTHER action's optimistic state while that
      // save is still travelling — e.g. opening tables 1, 2, 3 quickly:
      // table 1's refresh used to land before the server had processed
      // table 3, flickering tile 3 back to "Free" for a split second.
      // Keep local order rows whose saves are in flight, keep optimistic
      // deletes gone, and only take the server's board once NO floor action
      // is mid-save (the last one to finish reconciles everything).
      orders = orders
        .filter((o) => !pendingDeletes.has(o.id))
        .map((o) => (pendingOrderOps.has(o.id) ? ((state.data.orders || []).find((x) => x.id === o.id) || o) : o));
      if (!floorOpsInFlight) state.board = board;
      state.data.orders = orders; state.data.calls = calls;
      state.boardLoaded = true; // the live board has arrived at least once → real tiles, not the skeleton
    } catch (e) {
      toast("Could not load tables: " + e.message, "err");
      return;
    }
  }
  if (state.tab !== "tables") return;
  const board = state.board || {}, orders = state.data.orders || [], calls = state.data.calls || [];
  // Only touch the DOM when something actually changed, so a background poll never
  // flashes the floor or the open panel (and never steals a click mid-tick).
  const openCalls = (calls || []).filter((c) => !c.resolved).map((c) => c.id).join(",");
  // "sig" is a fingerprint of everything on the board. If a poll arrives and the
  // fingerprint hasn't changed, there's literally nothing new — so skip the redraw.
  const sig = JSON.stringify(board) + "|" + JSON.stringify(orders) + "|" + openCalls;
  if (fromPoll && sig === lastBoardSig) return;
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
  const pending = { id: "pending-" + t, table_number: t, status: "open", auto_approve: false };
  state.board.sessions = [...(state.board.sessions || []), pending];
  // Opening a table ALSO approves its pending "let me in / open" requests on the
  // server (see /api/editor sessions/open). Clear them from local state in the SAME
  // tick, or the tile flashes an "Attend" quick-action for ~1s: the optimistic
  // session makes the tile "seated" (so the Open branch no longer matches) while the
  // still-pending request keeps hasReq true → it falls to the hasJoin||hasReq→Attend
  // branch until the refetch lands. Remember the cleared ones so we can undo on error.
  const reqsBefore = state.board.requests || [];
  state.board.requests = reqsBefore.filter((r) => String(r.table_number) !== t);
  floorOpsInFlight++;
  loadSessions(true); // render-only, no network
  try { await api("POST", "/sessions/open", { table: t }); floorOpsInFlight--; await loadSessions(); toast("Table opened", "ok"); }
  catch (e) {
    floorOpsInFlight--;
    state.board.sessions = (state.board.sessions || []).filter((s) => s.id !== pending.id); // undo
    state.board.requests = reqsBefore;                                                      // undo the request clear too
    loadSessions(true);
    toast("Could not open: " + e.message, "err");
  }
}
// openAllTables: seat every table that isn't open yet, in one go (asks first).
async function openAllTables() {
  const n = Math.max(1, parseInt((state.data.settings || {}).table_count, 10) || 12);
  const targets = [];
  for (let i = 1; i <= n; i++) if (!openSessionForTable(String(i))) targets.push(String(i));
  if (!targets.length) return toast("Every table is already open", "ok");
  if (!(await confirmDialog(`Open all ${targets.length} remaining table${targets.length > 1 ? "s" : ""}?`, "Open all"))) return;
  // Fire the opens in parallel; count what failed instead of stopping halfway.
  const results = await Promise.allSettled(targets.map((t) => api("POST", "/sessions/open", { table: t })));
  const failed = results.filter((r) => r.status === "rejected").length;
  await loadSessions();
  toast(failed ? `Opened ${targets.length - failed}, ${failed} failed` : `Opened ${targets.length} table${targets.length > 1 ? "s" : ""}`, failed ? "err" : "ok");
}
// closeAllTables: end EVERY open session at once (asks first — guests at those
// tables can no longer order until reopened).
async function closeAllTables() {
  const open = (state.board.sessions || []).filter((s) => s.status === "open");
  if (!open.length) return toast("No open tables", "ok");
  // Floor-wide = the scary red confirm (see confirmDialog), so it can't be
  // mistaken for the routine one-table popup when speed-clicking.
  if (!(await confirmDialog(`Close ALL ${open.length} open table${open.length > 1 ? "s" : ""}? Guests at them can't order until reopened.`, `Close all ${open.length}`, { floorwide: true }))) return;
  const tables = open.map((s) => String(s.table_number)); // remembered for UNDO
  const results = await Promise.allSettled(open.map((s) => api("POST", "/sessions/" + s.id + "/close")));
  const failed = results.filter((r) => r.status === "rejected").length;
  await loadSessions();
  if (failed) return toast(`Closed ${open.length - failed}, ${failed} failed`, "err");
  // Gmail-style safety net: 8 seconds to take it back. UNDO reopens the same
  // table numbers (fresh sessions — guests who were seated stay disconnected).
  toast(`Closed ${tables.length} table${tables.length > 1 ? "s" : ""}`, "ok", {
    label: "UNDO",
    fn: async () => {
      await Promise.allSettled(tables.map((tb) => api("POST", "/sessions/open", { table: tb })));
      await loadSessions();
      toast(`Reopened ${tables.length} table${tables.length > 1 ? "s" : ""}`, "ok");
    },
  }, 8000);
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
async function memberAction(id, kind) {
  try { await api("POST", "/members/" + id + "/" + (kind === "approve" ? "approve" : "remove")); await loadSessions(); toast(kind === "approve" ? "Approved" : "Removed", "ok"); }
  catch (e) { toast("Failed: " + e.message, "err"); }
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
  const before = state.board.requests || [];
  state.board.requests = before.filter((r) => r.id !== id);
  floorOpsInFlight++;
  loadSessions(true);
  try { await api("POST", "/requests/" + id + "/resolve", { status }); floorOpsInFlight--; await loadSessions(); toast(status === "approved" ? "Approved" : "Dismissed", "ok"); }
  catch (e) { floorOpsInFlight--; state.board.requests = before; loadSessions(true); toast("Failed: " + e.message, "err"); }
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
// OPTIMISTIC: the row leaves the "Needs" list (and the tile emoji) instantly.
async function attendCall(id) {
  const before = state.data.calls || [];
  state.data.calls = before.filter((c) => c.id !== id);
  floorOpsInFlight++;
  loadSessions(true);
  try { await api("PATCH", "/calls/" + id, { resolved: true }); toast("Marked attended", "ok"); }
  catch (e) { state.data.calls = before; loadSessions(true); toast("Failed: " + e.message, "err"); }
  finally { floorOpsInFlight--; }
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
function tableTileState(t) {
  const os = ordersForTable(t);
  const sess = openSessionForTable(t);
  const mem = sess ? membersOf(sess.id) : [];
  const pending = mem.filter((m) => !m.approved).length;
  const cart = sess && Array.isArray(sess.cart) ? sess.cart : []; // shared cart being built, not yet ordered
  const cartCount = cart.reduce((a, it) => a + (parseInt(it.qty, 10) || 1), 0);
  const calls = callsForTable(t);
  const reqs = reqsForTable(t); // pending open/join/access requests (guest asked staff to let them in)
  const items = os.flatMap((o) => orderItemRows(o));
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
    const served = items.filter((i) => i.status === "served").length;
    meta = items.length ? `${served}/${items.length} served${due > 0 ? ` · ${inr(due)} due` : ""}` : `${os.length} order${os.length > 1 ? "s" : ""}`;
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

// floorHtml: build the whole unified floor — the grid of table tiles on the left
// (with a legend and on-tile quick buttons) and a side panel on the right holding
// the session toggles, café location, requests queue and blocklist.
function floorHtml() {
  const s = state.data.settings || {};
  const sessionsOn = !!s.sessions_enabled;
  // Number of tables to draw. On the very FIRST paint the settings haven't
  // loaded yet, so without help we'd default to 12 and then jump to the real 13
  // a moment later — a visible "one tile forms, then another" flicker in the
  // skeleton. Fix: remember the real count in localStorage and use it as the
  // default, so the skeleton starts at the right size. (Falls back to 12 only
  // on a browser that has never loaded this editor.)
  let cachedN = parseInt(localStorage.getItem("lfh_editor_table_count"), 10);
  if (!Number.isFinite(cachedN) || cachedN < 1) cachedN = 12;
  const n = Math.max(1, parseInt(s.table_count, 10) || cachedN);
  if (s.table_count) { try { localStorage.setItem("lfh_editor_table_count", String(parseInt(s.table_count, 10))); } catch {} }
  const reqs = state.board.requests || [];
  const blocks = state.board.blocklist || [];

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
    const skelMain = `<div class="floor-main"><div class="ed-head"><h2>Tables <span class="sub">· live floor</span></h2><button class="btn" id="refreshFloor">↻ Refresh</button></div>${legend}<div class="ftile-grid">${skel}</div></div>`;
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
  let cOcc = 0, cPay = 0, cNew = 0, cCall = 0; // running tallies for the stats strip
  for (let i = 1; i <= n; i++) {
    const { st, label, meta, badges, pay, done, hasNew, hasCall, hasReq, hasJoin } = tableTileState(i); // everything this tile needs
    if (st !== "free" && st !== "req") cOcc++;   // occupied = open/seated/ordering (free & "wants in" don't count)
    if (pay === "red" || st === "bill") cPay++;  // a bill still owed
    if (hasNew) cNew++;                          // a new order waiting to be accepted
    if (hasCall) cCall++;                        // a waiter call ringing
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
    const offIcon = st === "free" ? `<i class="fas fa-chair ft-officon" aria-hidden="true"></i>` : "";
    tiles += `<div class="ftile ft-${st}${pay ? " pay-" + pay : ""}${String(state.selectedTable) === String(i) ? " ft-sel" : ""}" data-floor-table="${i}" role="button" tabindex="0">
        ${offIcon}
        <div class="ft-top"><span class="ft-num">${i}</span>${badges ? `<span class="ft-badges">${badges}</span>` : ""}</div>
        <div class="ft-label">${esc(label)}</div><div class="ft-meta">${esc(meta)}</div>
        ${quick ? `<div class="ft-quick">${quick}</div>` : ""}</div>`;
  }
  // The header keeps ONLY the safe Refresh button. Open all / Close all used to
  // sit right beside it, styled the same — one fast click aimed at Refresh once
  // closed the entire floor (owner hit this 2026-06-11). They now live in the
  // side panel's "Dining sessions" card, well away from the speed-click zone.
  // Stats strip — the whole floor's health at a glance (owner: see it without counting
  // tiles). "Needs you" = new orders + ringing calls + open requests + waiting joiners.
  const pendingJoinersN = (state.board.sessions || []).filter((ss) => ss.status === "open").reduce((a, ss) => a + membersOf(ss.id).filter((m) => !m.approved && !m.removed).length, 0);
  const needsYou = cNew + cCall + reqs.length + pendingJoinersN;
  const statsStrip = sessionsOn ? `<div class="floor-stats"><div class="fstat"><div class="fstat-n">${cOcc}/${n}</div><div class="fstat-l">Occupied</div></div><div class="fstat warn"><div class="fstat-n">${cPay}</div><div class="fstat-l">To pay</div></div><div class="fstat alert"><div class="fstat-n">${needsYou}</div><div class="fstat-l">Needs you</div></div></div>` : "";
  const main = `<div class="floor-main"><div class="ed-head"><h2>Tables <span class="sub">· live floor</span></h2><button class="btn" id="refreshFloor">↻ Refresh</button></div>${statsStrip}${legend}<div class="ftile-grid">${tiles}</div></div>`;

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

  // Pending JOINERS (partners waiting to be let into an open table) belong in this
  // queue too (owner, 2026-06-12) — before this they only existed as a tiny 🙋
  // badge on the tile. Each row offers the full set: ✕ decline, Ban (confirmed,
  // declines AND blocklists), Transfer (they become the head — the current head
  // is kicked; confirmed), and OK (approve into the table).
  const joiners = [];
  (state.board.sessions || []).filter((ss) => ss.status === "open").forEach((ss) => {
    membersOf(ss.id).filter((m) => !m.approved && !m.removed).forEach((m) => joiners.push({ ...m, table_number: ss.table_number }));
  });
  const joinerRows = joiners.map((m) =>
    `<div class="sx-req"><div class="sx-req-info"><span class="sx-tag sx-tag-join">join</span> ${esc(m.name || "Guest")} · join T${esc(m.table_number)}<small>${esc(timeAgo(m.joined_at))}</small></div><div class="sx-req-actions"><button class="btn small" data-mem-deny="${esc(m.id)}" title="Decline this join request">✕</button><button class="btn small danger" data-mem-ban="${esc(m.id)}" data-ban-phone="${esc(m.phone || "")}" title="Decline AND add to the blocklist">Ban</button><button class="btn small" data-mem-head="${esc(m.id)}" title="Make them the table's head — the current head is kicked">Transfer</button><button class="btn small primary" data-mem-approve="${esc(m.id)}">OK</button></div></div>`
  ).join("");
  const reqCount = reqs.length + joiners.length;
  const reqCard = sessionsOn ? `<div class="fc-card"><h3>Requests <span class="sub">· ${reqCount}</span></h3>${reqCount ? joinerRows + reqs.map((r) => {
    const who = esc(r.name || r.phone || "Someone");
    const what = r.type === "open" ? `open T${esc(r.table_number)}` : r.type === "join" ? `join T${esc(r.table_number)}` : `access T${esc(r.table_number)}`;
    // "access" = a guest asked for a WAITER to come over (e.g. their join was
    // declined, or location failed) — so the quick action reads "✓ Attend",
    // exactly like a water call, instead of an ambiguous "OK".
    const okLabel = r.type === "open" ? "Open" : r.type === "access" ? "✓ Attend" : "OK";
    return `<div class="sx-req"><div class="sx-req-info"><span class="sx-tag sx-tag-${esc(r.type)}">${esc(r.type)}</span> ${who} · ${what}<small>${esc(timeAgo(r.created_at))}</small></div><div class="sx-req-actions"><button class="btn small" data-req-deny="${esc(r.id)}">✕</button><button class="btn small primary" data-req-approve="${esc(r.id)}">${okLabel}</button></div></div>`;
  }).join("") : `<div class="sx-empty">No pending requests.</div>`}</div>` : "";

  // Active waiter calls across all OPEN tables (water/napkin/clean…), one row each.
  // This stays in sync with the tile emojis — both read state.data.calls and refresh
  // on the same 1s poll, and "Done" here resolves the same call the tile shows.
  const liveCalls = (state.data.calls || []).filter((c) => !c.resolved && openSessionForTable((c.table_number || "").trim()));
  const needsCard = sessionsOn ? `<div class="fc-card"><h3>Needs <span class="sub">· ${liveCalls.length}</span></h3>${liveCalls.length ? liveCalls.map((c) =>
    `<div class="sx-req"><div class="sx-req-info">${callEmoji(c.note)} T${esc(c.table_number)} · ${esc(c.note || "Waiter")}<small>${esc(timeAgo(c.created_at))}</small></div><div class="sx-req-actions"><button class="btn small primary" data-call-attend="${esc(c.id)}">Done</button></div></div>`
  ).join("") : `<div class="sx-empty">No active calls.</div>`}</div>` : "";

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
    const { headPill, headMeta, sessionSec, buildingSec, ordersSec, callsSec, billSec, foot } = parts;
    sideInner = `<div class="tp-detail" data-table-detail="${esc(t)}">
        <div class="tp-detail-head">
          <div class="tp-detail-top"><h3>Table ${esc(t)}</h3>${headPill}<button class="tp-detail-close" id="tpDetailClose" aria-label="Back to floor controls" title="Back to floor controls">✕</button></div>
          ${headMeta}
        </div>
        <div class="tp-detail-body">${sessionSec}${buildingSec}${ordersSec}${callsSec}${billSec}</div>
        <div class="tp-detail-foot">${foot}</div>
      </div>`;
  } else {
    sideInner = `${bulkCard}${reqCard}${needsCard}${blkCard}${controls}`;
  }
  // F1: collapsed (controls mode only) → hide the side panel so the floor goes
  // full-width; a slim chevron re-opens it. While collapsed, tapping a tile opens
  // the FULL-SCREEN table popup (see bindFloor). A SELECTED table's detail is never
  // collapsed — it has its own ✕ that returns to the controls.
  if (state.floorSideCollapsed && state.selectedTable == null) {
    return `<div class="floor-wrap floor-collapsed">${main}<button class="floor-side-toggle is-collapsed" id="floorSideToggle" title="Show floor controls" aria-label="Show floor controls">‹</button></div>`;
  }
  const collapseBtn = state.selectedTable == null
    ? `<button class="floor-side-toggle" id="floorSideToggle" title="Hide this panel" aria-label="Hide this panel">›</button>` : "";
  return `<div class="floor-wrap">${main}<div class="floor-resizer" id="floorResizer" title="Drag to resize"></div><aside class="floor-side" style="width:${sideW}px;flex:0 0 ${sideW}px">${collapseBtn}${sideInner}</aside></div>`;
}

// bindFloor: wire up the unified floor after it's drawn — clicking a tile opens
// its detail panel, the on-tile quick buttons do their one action, the side panel
// toggles save settings, and the divider can be dragged to resize the side panel.
function bindFloor() {
  const ed = $("#editor");
  const rb = document.getElementById("refreshFloor");
  if (rb) rb.onclick = () => loadSessions();
  // Bulk open/close for the whole floor (both confirm before acting).
  const oa = document.getElementById("floorOpenAll");
  if (oa) oa.onclick = () => openAllTables();
  const ca = document.getElementById("floorCloseAll");
  if (ca) ca.onclick = () => closeAllTables();
  ed.querySelectorAll("[data-floor-table]").forEach((t) => (t.onclick = () => {
    // F1: collapsed right panel → open a FULL-SCREEN popup; open panel → in-side detail.
    if (state.floorSideCollapsed) openTablePanel(t.dataset.floorTable);
    else selectTable(t.dataset.floorTable);
  }));
  // F1: collapse / expand the right floor panel (state persisted across reloads).
  const sideToggle = ed.querySelector("#floorSideToggle");
  if (sideToggle) sideToggle.onclick = () => { state.floorSideCollapsed = !state.floorSideCollapsed; lsSet("lfh_floor_side_collapsed", state.floorSideCollapsed ? "1" : "0"); renderEditor(); };
  // quick actions on the tile itself — stopPropagation so they don't also open the detail panel
  ed.querySelectorAll("[data-quick-open]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openTableSession(b.dataset.quickOpen); }));
  ed.querySelectorAll("[data-quick-accept]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); acceptTableOrders(b.dataset.quickAccept); }));
  ed.querySelectorAll("[data-quick-attend]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); attendTableCalls(b.dataset.quickAttend); }));
  // Tile "Attend" for a join/access request: open the table's panel (the request
  // needs a decision — approve / transfer / decline / ban — not a blind resolve).
  ed.querySelectorAll("[data-quick-requests]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); selectTable(b.dataset.quickRequests); }));
  // The Requests card's joiner rows reuse the member actions (same data-attrs as
  // the table panel, but bound here because these rows live in the side panel).
  ed.querySelectorAll("[data-mem-approve]").forEach((b) => (b.onclick = () => memberAction(b.dataset.memApprove, "approve")));
  ed.querySelectorAll("[data-mem-deny]").forEach((b) => (b.onclick = () => memberAction(b.dataset.memDeny, "remove")));
  ed.querySelectorAll("[data-mem-head]").forEach((b) => (b.onclick = () => makeHead(b.dataset.memHead)));
  ed.querySelectorAll("[data-mem-ban]").forEach((b) => (b.onclick = () => banMember(b.dataset.memBan, b.dataset.banPhone)));
  ed.querySelectorAll("[data-quick-restart]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); restartTable(b.dataset.quickRestart); }));
  ed.querySelectorAll("[data-quick-close]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); closeTableQuick(b.dataset.quickClose); }));
  ed.querySelectorAll("[data-quick-pay]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); markTablePaid(b.dataset.quickPay); }));
  ed.querySelectorAll("[data-req-approve]").forEach((b) => (b.onclick = () => resolveRequest(b.dataset.reqApprove, "approved")));
  ed.querySelectorAll("[data-req-deny]").forEach((b) => (b.onclick = () => resolveRequest(b.dataset.reqDeny, "denied")));
  ed.querySelectorAll("[data-unblock]").forEach((b) => (b.onclick = () => unblock(b.dataset.unblock)));
  // The "Needs" card's Done buttons resolve a single waiter call (in sync with the tiles).
  ed.querySelectorAll("[data-call-attend]").forEach((b) => (b.onclick = () => attendCall(b.dataset.callAttend)));
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
// open/closeTablePanel: remember which table's big control panel is open. Opening
// also kicks off a fresh load so the panel is never showing stale data.
function openTablePanel(table) { state.openSess = String(table); renderTablePanel(); loadSessions(); /* refresh immediately so a reopened table is never stale */ }
function closeTablePanel() { state.openSess = null; document.querySelector(".sx-modal-overlay")?.remove(); }

// selectTable / deselectTable — the NEW master-detail (Tables tab). Selecting a
// table shows its full detail IN the right side panel (not a pop-up); deselecting
// returns the panel to the whole-floor controls. Both just set state + redraw the
// floor, and kick a fresh load so the detail is never stale.
function selectTable(table) { state.selectedTable = String(table); renderEditor(); loadSessions(); }
function deselectTable() { state.selectedTable = null; renderEditor(); }

// refreshTableDetail: redraw whichever table-detail view is currently open after a
// local (optimistic) change, so the instant feedback works in BOTH places. There
// are two: the legacy pop-up modal (state.openSess) and the new in-panel master-
// detail (state.selectedTable). renderTablePanel() only redraws the modal — it bails
// when no modal is open — so on its own it leaves the in-panel detail stale. This
// covers both, and preserves the in-panel body's scroll so serving a dish doesn't
// fling the list back to the top.
function refreshTableDetail() {
  if (state.openSess != null) { renderTablePanel(); return; }
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
  // STAFF EDIT (a real, not-yet-served dish): qty −/＋ steppers + a single "✎ Edit"
  // button that opens ONE modal to set allergens (standard + custom) and the kitchen
  // note. The controls sit on a FULL-WIDTH row below the dish so the name keeps its
  // room; the dish's current allergens + note show read-only on the line above.
  // No editing once a dish is READY or SERVED — it's cooked/out, too late to change.
  const canEdit = editing && row.kind === "session" && row.status !== "served" && row.status !== "ready";
  const editRow = canEdit
    ? `<div class="sx-dish-edit-row"><span class="sx-item-edit"><button class="sx-qty" data-qty-dec="${esc(row.id)}" data-qty="${esc(row.qty)}" title="Fewer">−</button><button class="sx-qty" data-qty-inc="${esc(row.id)}" data-qty="${esc(row.qty)}" title="More">＋</button></span><button class="sx-dish-edit-btn" data-edit-dish="${esc(row.id)}" title="Edit allergens & note for this dish">✎ Edit</button></div>`
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
  const item = (state.board.items || []).find((i) => i.id === itemId);
  if (!item) { toast("That dish is no longer on the order.", "err"); return; }
  const order = (state.data.orders || []).find((o) => o.id === item.order_id) || {};
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
  // Both totals are net of any discounts staff have given.
  const due = os.filter((o) => o.status !== "cancelled" && o.payment_status !== "paid").reduce((s, o) => s + (parseFloat(o.total) || 0) - (parseFloat(o.discount) || 0), 0);
  const billTotal = os.filter((o) => o.status !== "cancelled").reduce((s, o) => s + (parseFloat(o.total) || 0) - (parseFloat(o.discount) || 0), 0);
  const canFree = os.length > 0 && os.every((o) => o.payment_status === "paid" || o.status === "cancelled");

  // ── HEAD: a status pill, a one-line summary (bill #, guests, dishes, due) and a
  // dish-status PROGRESS BAR (how much of this table is served vs cooking vs new).
  // Both detail views (in-panel + legacy modal) render these so they stay identical.
  const tile = tableTileState(t);
  const headPill = `<span class="tp-pill tp-pill-${esc(tile.st)}">● ${esc(tile.label)}</span>`;
  const liveRowsAll = os.filter((o) => o.status !== "cancelled").flatMap((o) => orderItemRows(o));
  const cServed = liveRowsAll.filter((r) => r.status === "served").length;
  const cCook = liveRowsAll.filter((r) => r.status === "preparing" || r.status === "ready").length;
  const cRecv = liveRowsAll.filter((r) => r.status === "received").length;
  const nItems = liveRowsAll.length || 1;
  const guestsN = sess ? membersOf(sess.id).length : 0;
  const subLine = `<div class="tp-det-sub">${sess && sess.bill_no != null ? `<span>Bill <b>#${esc(sess.bill_no)}</b></span>` : ""}<span><b>${guestsN}</b> guest${guestsN === 1 ? "" : "s"}</span><span><b>${liveRowsAll.length}</b> dish${liveRowsAll.length === 1 ? "" : "es"}</span>${due > 0 ? `<span>Due <b>${inr(due)}</b></span>` : billTotal > 0 ? `<span>Total <b>${inr(billTotal)}</b></span>` : ""}</div>`;
  const progress = liveRowsAll.length ? `<div class="tp-prog"><div class="tp-prog-bar"><span class="pp-served" style="width:${(cServed / nItems) * 100}%"></span><span class="pp-cook" style="width:${(cCook / nItems) * 100}%"></span><span class="pp-recv" style="width:${(cRecv / nItems) * 100}%"></span></div><div class="tp-prog-leg"><span><i class="pl-served"></i>${cServed} served</span><span><i class="pl-cook"></i>${cCook} cooking</span><span><i class="pl-recv"></i>${cRecv} new</span></div></div>` : "";
  const headMeta = subLine + progress;

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

  // Live shared cart: what the table is building right now but hasn't sent yet.
  // Clears itself the moment they place the order (cart → []).
  let buildingSec = "";
  const cart = sess && Array.isArray(sess.cart) ? sess.cart : [];
  if (cart.length) {
    const cartTotal = cart.reduce((a, it) => a + (parseFloat(it.price) || 0) * (parseInt(it.qty, 10) || 1), 0);
    const rows = cart.map((it) => `<div class="sx-item"><span class="sx-item-qty">×${esc(String(it.qty || 1))}</span><div class="sx-item-info"><span class="sx-item-name">${esc(it.title || "Item")}</span></div><span class="sx-item-price"></span><div class="sx-item-acts"><span class="ord-pill building">building</span></div></div>`).join("");
    buildingSec = `<div class="sx-sec"><div class="sx-sec-h">🛒 Building <span class="sub">· not sent yet</span></div>${rows}<div class="sx-total">Cart <b>${inr(cartTotal)}</b></div></div>`;
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
  const nonCanc = os.filter((o) => o.status !== "cancelled");
  const sumSub = nonCanc.reduce((s, o) => s + (parseFloat(o.subtotal) || 0), 0);
  const sumTax = nonCanc.reduce((s, o) => s + (parseFloat(o.tax) || 0), 0);
  const sumDisc = nonCanc.reduce((s, o) => s + (parseFloat(o.discount) || 0), 0);
  const billSec = os.length ? `<div class="sx-sec"><div class="sx-sec-h">Bill${sess && sess.bill_no != null ? ` <span class="sub">· bill #${esc(sess.bill_no)}</span>` : ""}</div><div class="tp-bill">${sumSub > 0 ? `<div class="tp-bl"><span>Subtotal</span><b>${inr(sumSub)}</b></div>` : ""}${sumDisc > 0 ? `<div class="tp-bl disc"><span>Discount</span><b>− ${inr(sumDisc)}</b></div>` : ""}${sumTax > 0 ? `<div class="tp-bl"><span>GST</span><b>${inr(sumTax)}</b></div>` : ""}<div class="tp-bl grand"><span>${due > 0 ? "Total due" : "Total"}</span><span class="tp-bl-amt">${inr(due > 0 ? due : billTotal)}</span></div></div></div>` : "";

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

  return { sess, os, canFree, headPill, headMeta, sessionSec, buildingSec, ordersSec, callsSec, billSec, foot };
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
  for (let i = 1; i <= n; i++) { if (String(i) !== String(t) && !openSessionForTable(i)) free.push(i); }
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
  // Per-bill discount: ask for the amount (with the order total as the cap).
  root.querySelectorAll("[data-disc]").forEach((b) => (b.onclick = async () => {
    const max = parseFloat(b.dataset.discMax) || 0;
    const cur = parseFloat(b.dataset.discCur) || 0;
    const raw = prompt(`Discount for this order (0 – ${max})${cur > 0 ? ` — currently ${cur}` : ""}:`, cur ? String(cur) : "");
    if (raw === null) return; // cancelled — leave the discount as-is
    // A non-numeric typo must NOT silently wipe an existing discount: bail out.
    const parsed = parseFloat(raw);
    if (raw.trim() !== "" && !Number.isFinite(parsed)) { toast("That's not a number — discount unchanged", "err"); return; }
    const amount = Math.min(Math.max(parsed || 0, 0), max);
    const note = amount > 0 ? (prompt("Reason (optional, shows on the bill):") || "") : "";
    try { await api("POST", `/orders/${b.dataset.disc}/discount`, { amount, note }); await loadSessions(); if (rerender) rerender(); toast(amount > 0 ? `Discount ${inr(amount)} applied` : "Discount removed", "ok"); }
    catch (e) { toast("Failed: " + e.message, "err"); }
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
  const { headPill, headMeta, sessionSec, buildingSec, ordersSec, callsSec, billSec, foot } = parts;
  const wrap = el(`<div class="sx-modal-overlay tbl-modal-overlay"><div class="tbl-modal sx-modal"><div class="tbl-modal-head"><div class="tp-detail-top"><h3>Table ${esc(t)}</h3>${headPill}<button class="tbl-modal-close" aria-label="Close">✕</button></div>${headMeta}</div><div class="tbl-modal-body">${sessionSec}${buildingSec}${ordersSec}${callsSec}${billSec}</div><div class="tbl-modal-foot">${foot}</div></div></div>`);
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
  try { for (const o of recv) await api("POST", "/orders/" + o.id + "/accept"); toast(recv.length > 1 ? recv.length + " orders accepted → preparing" : "Order accepted → preparing", "ok"); }
  catch (e) { release(); toast("Failed: " + e.message, "err"); await loadSessions(); } // reload truth on failure
  finally { release(); }
}
// Serve EVERY order on a table at once (the table-wide "mark all served").
// OPTIMISTIC like accept: every dish row flips to served on screen first.
async function serveAllOrders(t) {
  const orders = ordersForTable(t);
  if (!orders.length) return;
  orders.forEach((o) => { o.status = "served"; flipOrderItems(o, null, "served"); opBegin(o.id); });
  floorOpsInFlight++;
  loadSessions(true);
  renderTablePanel();
  // release first, then refresh — see restartTable for why this order matters.
  let released = false;
  const release = () => { if (!released) { released = true; floorOpsInFlight--; orders.forEach((o) => opEnd(o.id)); } };
  try { for (const o of orders) await api("POST", "/orders/" + o.id + "/serve-all"); toast("All orders served", "ok"); }
  catch (e) { release(); toast("Failed: " + e.message, "err"); await loadSessions(); }
  finally { release(); }
}
// Quick action: mark every open call on a table attended (clears the tile's emoji).
async function attendTableCalls(t) {
  const cs = callsForTable(t);
  // OPTIMISTIC: the call emojis leave the tile instantly.
  const before = state.data.calls || [];
  const ids = new Set(cs.map((c) => c.id));
  state.data.calls = before.filter((c) => !ids.has(c.id));
  floorOpsInFlight++;
  loadSessions(true);
  try { for (const c of cs) await api("PATCH", "/calls/" + c.id, { resolved: true }); toast("Attended", "ok"); }
  catch (e) { state.data.calls = before; loadSessions(true); toast("Failed: " + e.message, "err"); }
  finally { floorOpsInFlight--; }
}
// RST: clear a finished table's orders off the floor but KEEP the table open for a new round.
async function restartTable(t) {
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
    await loadSessions();
    toast(`Table ${t} restarted — still open`, "ok");
  } catch (e) { release(); toast("Could not restart: " + e.message, "err"); await loadSessions(); }
  finally { release(); }
}
// CLS: free the table (archive orders + close any open session).
function closeTableQuick(t) { freeTableAll(t, openSessionForTable(t)); }

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
    await loadSessions();
    toast(`Table ${t} freed`, "ok");
  } catch (e) { release(); toast("Could not free: " + e.message, "err"); await loadSessions(); }
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
    lastOrderCount = state.data.orders.length;
    try {
      const calls = await api("GET", "/calls");
      if (seq !== dataSeq) return; // superseded mid-fetch
      state.data.calls = calls;
      lastCallCount = (state.data.calls || []).filter((c) => !c.resolved).length;
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

// pollOrders: this runs once a second (see startOrderWatch). Each tick it re-fetches
// orders, waiter calls, and the sessions board, refreshes whatever tab is showing,
// and — by comparing the new counts to the last counts — chimes + toasts + badges
// whenever something NEW arrives, no matter which tab the owner is currently on.
async function pollOrders() {
  const seq = ++dataSeq;
  let orders, calls, board;
  try {
    orders = await api("GET", "/orders");
  } catch {
    return; // network blip — try again next tick
  }
  if (seq !== dataSeq) return; // a newer loader started — this poll snapshot is stale
  // Merge, don't clobber: keep the LOCAL copy of any order whose save is
  // still in flight, and keep optimistically-deleted rows gone — otherwise
  // this poll would flicker fresh clicks back to their old state.
  orders = orders
    .filter((o) => !pendingDeletes.has(o.id))
    .map((o) => (pendingOrderOps.has(o.id) ? ((state.data.orders || []).find((x) => x.id === o.id) || o) : o));
  state.data.orders = orders;
  try { calls = await api("GET", "/calls"); if (seq !== dataSeq) return; state.data.calls = calls; } catch { calls = state.data.calls || []; }
  // The session board (sessions + members + the requests queue + blocklist) is now
  // refreshed on every tick too, so the live cart and the request queue stay fresh
  // and we can chime for new requests from ANY tab.
  try {
    board = await api("GET", "/sessions");
    if (seq !== dataSeq) return; // superseded by a newer loader — drop this board snapshot
    // Don't clobber the board while a floor action's save is still in flight.
    if (!floorOpsInFlight) state.board = board; else board = state.board || {};
    state.boardLoaded = true; // a poll fetch counts too: we now know the real floor
  } catch { board = state.board || {}; }

  // Remember the previous counts, then update to the new ones. The "did it grow?"
  // checks below compare prev vs now to detect something brand-new arriving.
  const prev = lastOrderCount;
  lastOrderCount = orders.length;
  const pending = (calls || []).filter((c) => !c.resolved).length;
  lastCallCount = pending; // kept for any external reader; alerts now use seenCallIds
  const reqCount = (board.requests || []).length;
  const prevR = lastReqCount;
  lastReqCount = reqCount;

  // While a serve flush is pending (staff is actively marking dishes), don't let
  // the poll redraw the view under their fingers — the optimistic local render is
  // already on screen and the debounced flush will reconcile it shortly. We still
  // fetched fresh data above, so the new-order/call/request alerts below still fire.
  if (!serveFlushPending()) {
    // Only redraw the Orders tab when something VISIBLE actually changed —
    // rebuilding 200 cards every second ate clicks and scroll position.
    const sig = JSON.stringify([
      orders.map((o) => [o.id, o.status, o.payment_status, o.archived ? 1 : 0]),
      (calls || []).filter((c) => !c.resolved).map((c) => c.id),
      (board && board.requests ? board.requests.length : 0),
    ]);
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (state.tab === "orders" && sig !== lastPollSig && !typing) { renderList(); renderEditor(); }
    lastPollSig = sig;
    if (state.tab === "tables" && !floorOpsInFlight) loadSessions(true); // keep the live floor fresh
  }

  // new order alert
  if (prev !== null && orders.length > prev) {
    const newCount = orders.length - prev;
    const latest = orders[0];
    const where = latest && latest.table_number ? "Table " + latest.table_number : "Walk-in";
    playOrderChime();
    toast(`🔔 ${newCount} new order${newCount > 1 ? "s" : ""} — ${where}`, "ok", null, 6000);
    if (state.tab !== "orders") { unseenOrders += newCount; updateOrdersBadge(); }
  }
  // new waiter-call alert — fire ONCE per call id (see seenCallIds note above)
  const openCalls = (calls || []).filter((c) => !c.resolved);
  const openIds = openCalls.map((c) => c.id);
  if (seenCallIds === null) {
    seenCallIds = new Set(openIds); // first poll: baseline, don't alert for existing calls
  } else {
    const fresh = openCalls.filter((c) => !seenCallIds.has(c.id));
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
    const latest = (board.requests || [])[reqCount - 1];
    const verb = latest && latest.type === "open" ? "wants to open" : latest && latest.type === "join" ? "wants to join" : "needs access to";
    const where = latest && latest.table_number ? `Table ${latest.table_number}` : "a table";
    playOrderChime();
    toast(`🙋 Request — ${verb} ${where}`, "ok", null, 6000);
    // Floor request → light the TABLES badge (not Orders). The table tile itself
    // already shows the 📨 badge + "Wants in", so this just points the owner there.
    if (state.tab !== "tables") { unseenTables += (reqCount - prevR); updateTablesBadge(); }
  }
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
      ops:  () => { pollOrders(); loadPlatform(); /* keeps the Platform tab badge live on every tab */ },
      menu: () => loadAll(),
    }});
    setInterval(() => { pollOrders(); loadPlatform(); }, 60000); // backup sync (also ages out handed-over platform tickets)
  } else {
    setInterval(() => { pollOrders(); loadPlatform(); }, 2000); // fallback poll
  }
}

// --- final wiring: connect the static page controls and start everything up ---
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
// Then load all the data, refresh the current view in place, and start live polling.
// If the very first load fails, show "connection failed" so it's obvious the local
// server probably isn't running.
loadAll()
  .then(() => { renderCatFilter(); renderList(); renderEditor(); startOrderWatch(); loadPlatform(); /* populate the Platform tab badge on boot */ })
  .catch((e) => {
    $("#conn").textContent = "connection failed";
    $("#conn").className = "conn err";
    toast("Could not load: " + e.message, "err");
  });
