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
const inr = (n) => "₹" + Math.round((parseFloat(n) || 0) * INR_RATE).toLocaleString("en-US");

// One dish flows new → cooking → ready → served, then wraps back so a mis-tap is
// undoable. "ready" = kitchen finished it, waiter still has to carry it out (the
// pink alert); "served" = the waiter delivered it. Labels are the words shown.
// Waiter tap flow MATCHES the manager: cooking → served in one tap (the kitchen
// owns "ready"; if they're too busy to mark it, the waiter who carries the food
// just serves it directly). A dish already marked "ready" by the kitchen also
// serves in one tap. (owner, 2026-06-14)
const NEXT_STATUS = { received: "preparing", preparing: "served", ready: "served", served: "received" };
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
  note: "",             // one note for the whole order
  floorFilter: "all",   // which tables the floor shows: all | needs | open | free
  allergies: "",        // order-level allergies (comma list), applied to the whole order
  editOrders: new Set(),// order ids currently in staff EDIT mode (after the kitchen-confirm)
  addToOrderId: null,   // when set, the dish browser ADDS to this existing order (not a new one)
};

// PER-TAB restaurant pin (ADMIN "view as" only): ?rid= comes in via the iframe URL and
// is echoed on every API call so this tab never shifts restaurants when the admin opens
// another restaurant's panel (the act-as cookie is browser-wide — owner bug, 2026-07-03).
// Empty for real staff logins; the server ignores it for them.
const PANEL_RID = new URLSearchParams(location.search).get("rid") || "";
const ridQ = (path) => PANEL_RID ? path + (path.includes("?") ? "&" : "?") + "rid=" + encodeURIComponent(PANEL_RID) : path;
const api = async (method, path, body) => {
  const r = await fetch("/api/tablet" + ridQ(path), { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = "/login"; throw new Error("login"); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error) || r.statusText);
  return j;
};
const toast = (msg, ok = true) => {
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
  setTimeout(() => t.remove(), 2600);
};
// Two-step confirm (a promise that resolves true/false) — used before sending
// an order to the kitchen, so a stray tap can't fire a ticket.
const confirmDialog = (text, yesLabel = "Yes, send it") => new Promise((resolve) => {
  $("#confirmText").textContent = text;
  $("#confirmYes").textContent = yesLabel;
  $("#confirmOverlay").hidden = false;
  $("#confirmYes").onclick = () => { $("#confirmOverlay").hidden = true; resolve(true); };
  $("#confirmNo").onclick = () => { $("#confirmOverlay").hidden = true; resolve(false); };
});

// Ask for a MANAGER PIN (a self-contained modal so it needs nothing in the HTML).
// Resolves with the typed digits, or null if cancelled. Sensitive tablet actions
// (ban, discount, closing/restarting a busy table) are unlocked by a manager's PIN.
const pinPrompt = (message, errText) => new Promise((resolve) => {
  const ov = document.createElement("div");
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  const box = document.createElement("div");
  Object.assign(box.style, { width: "min(92vw,340px)", background: "#0f1830", color: "#e7eefc", borderRadius: "16px", padding: "20px", boxShadow: "0 20px 60px rgba(0,0,0,.5)", fontFamily: "system-ui,sans-serif" });
  box.innerHTML = `
    <div style="font-size:16px;font-weight:800;margin:0 0 6px">🔑 Manager PIN</div>
    <div style="font-size:13px;color:#9fb2d8;margin:0 0 12px">${message || "A manager PIN is required for this action."}</div>
    <input class="pp-in" type="password" inputmode="numeric" maxlength="8" placeholder="••••" autocomplete="off"
      style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:18px;letter-spacing:4px;text-align:center;outline:none" />
    <div class="pp-err" style="font-size:12px;color:#fca5a5;min-height:16px;margin:6px 2px 0">${errText || ""}</div>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="pp-cancel" style="flex:1;padding:11px;border:0;border-radius:10px;font-weight:700;background:#243049;color:#fff;cursor:pointer">Cancel</button>
      <button class="pp-ok" style="flex:1;padding:11px;border:0;border-radius:10px;font-weight:700;background:#3b82f6;color:#fff;cursor:pointer">Confirm</button>
    </div>`;
  ov.appendChild(box);
  document.body.appendChild(ov);
  const input = box.querySelector(".pp-in");
  const err = box.querySelector(".pp-err");
  setTimeout(() => input.focus(), 50);
  const done = (val) => { ov.remove(); resolve(val); };
  box.querySelector(".pp-cancel").onclick = () => done(null);
  box.querySelector(".pp-ok").onclick = () => {
    const v = input.value.trim();
    if (!/^\d{4,8}$/.test(v)) { err.textContent = "Enter the 4–8 digit PIN."; return; }
    done(v);
  };
  input.onkeydown = (e) => { if (e.key === "Enter") box.querySelector(".pp-ok").click(); else if (e.key === "Escape") done(null); };
  ov.onclick = (e) => { if (e.target === ov) done(null); };
});

// Run an action that MAY need a manager PIN: try it plainly first (so it stays
// frictionless when no PIN is configured yet, or for the admin super-user); if the
// server answers "manager PIN required", prompt once and retry with it. Reloads on
// success; a cancelled PIN aborts silently; real errors toast.
async function actGated(method, path, body, opts = {}) {
  try {
    try {
      await api(method, path, body);
    } catch (e) {
      if (!/manager pin/i.test(String(e && e.message))) throw e;
      let pin = await pinPrompt(opts.message);
      while (pin) {
        try { await api(method, path, { ...(body || {}), managerPin: pin }); break; }
        catch (e2) {
          if (/manager pin/i.test(String(e2 && e2.message))) { pin = await pinPrompt(opts.message, "That PIN didn't match — try again."); continue; }
          throw e2;
        }
      }
      if (!pin) return; // cancelled
    }
    await load();
    if (opts.toast) toast(opts.toast);
  } catch (e) {
    toast("Failed: " + e.message, false);
  }
}

// ── floor helpers ────────────────────────────────────────────────────────────
const sessionOf = (t) => state.data.sessions.find((s) => String(s.table_number) === String(t) && s.status === "open");
const ordersOf = (t) => state.data.orders.filter((o) => String(o.table_number) === String(t) && o.status !== "cancelled");
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
  const db = (state.data.items || []).filter((i) => i.order_id === o.id);
  if (db.length) return db.map((r) => ({ id: r.id, title: r.title, qty: r.qty || 1, status: r.status || "received", options: r.options, removed: r.removed, note: r.note, price: Number(r.unit_price) || 0, added_allergens: r.added_allergens, removed_flag: r.removed_flag, fromDb: true }));
  const js = Array.isArray(o.items) ? o.items : [];
  return js.map((r) => ({ id: null, title: r.title || r.name, qty: r.qty || 1, status: r.status || o.status || "received", options: r.options, removed: r.removed, note: r.note, price: Number(r.price) || 0, fromDb: false }));
}

// ── TIER 1: the slim per-tile summary (drives the GRID) ──────────────────────
// summaryTile(t): the server-computed tile for table t (state/label/meta/counts/due/pay +
// badge counts), or a synthetic "free" tile when the summary has none. The grid reads ONLY
// this — never the full board — so an unselected table needs no order rows cached.
function summaryTile(t) {
  return (state.summary.tiles || {})[String(t)]
    || { state: "free", label: "Free", meta: "tap to open", members: 0, pending: 0, counts: { nw: 0, ck: 0, rd: 0, sv: 0 }, due: 0, pay: "", hasNew: false, hasCall: false, hasReq: false, hasJoin: false, reqs: 0, calls: 0 };
}
// The per-restaurant waiter calls for table t (with their notes → the call emoji). Comes from
// the summary's tiny calls[] list (only OPEN-session calls), NOT the full board.
function summaryCallsOf(t) {
  return (state.summary.calls || []).filter((c) => !c.resolved && String(c.table_number).trim() === String(t));
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
    const os = ordersOf(t), s = sessionOf(t);
    let nw = 0, ck = 0, rd = 0, sv = 0, due = 0;
    const kots = [];
    os.forEach((o) => {
      if (o.kot_no != null) kots.push(o.kot_no);
      // Due counts only ACCEPTED unpaid bills (not brand-new 'received' orders) — matches the
      // summary's due so the grid tile and the detail never disagree on the amount owed.
      if (o.status !== "cancelled" && o.status !== "received" && o.payment_status !== "paid") due += (Number(o.total) || 0) - (Number(o.discount) || 0);
      dishRowsOf(o).forEach((r) => {
        const q = r.qty || 1;
        if (r.status === "served") sv += q; else if (r.status === "ready") rd += q; else if (r.status === "preparing") ck += q; else nw += q;
      });
    });
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
    if (s) return a.guests ? { cls: "seated", label: "Seated" } : { cls: "waiting", label: "Open" };
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
  const tile = summaryTile(i);
  return !!(tile.hasCall || tile.hasReq || tile.hasNew || (tile.counts && tile.counts.rd > 0));
}

function tableCount() { return Math.max(1, parseInt((state.data.settings || {}).table_count, 10) || 12); }
// Is table i OPEN (has a dining session / live orders)? Read from the summary tile state so it
// works for EVERY tile, not just the loaded one — "free" and "req" are the only not-open states.
function tileIsOpen(i) {
  const s = summaryTile(i).state;
  return s !== "free" && s !== "req";
}
// Tablet billing permission for an action (set by the manager in General settings):
// 'off' (hidden — default) | 'on' (waiter can do it) | 'pin' (needs a manager PIN).
const tperm = (k) => ((state.data.settings || {})[k] || "off");

// selectTable(t): open table t's DETAIL. The grid only had the slim summary, so we pull table t's
// FULL slice (orders/items/members/calls/…) before the detail can show real rows. Render once
// immediately for instant feedback (the panel shows what's cached — often a quick skeleton), then
// re-render after the slice lands. Mirrors the manager selecting a table. (owner 2026-06-27)
async function selectTable(t) {
  state.table = String(t);
  state.ordering = false; state.cart = []; state.note = ""; state.dishSearch = "";
  renderFloor(); renderPanel();         // instant feedback (selected tile highlights; detail fills in next)
  // Stacked (phone/narrow) layout: the detail sits below the floor — jump to it.
  if (window.matchMedia("(max-width: 760px)").matches) {
    document.getElementById("panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  await ensureTableSlice(t);            // load this table's full detail rows
  if (String(state.table) !== String(t)) return; // the waiter already moved on — don't clobber
  lastSig = boardSig(state);            // adopt as baseline so the next poll doesn't re-flicker the detail
  renderFloor();
  if (!state.ordering) renderPanel();
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
function tileHtml(i) {
  const st = tileState(i), a = tableAgg(i), tile = summaryTile(i);
  // Badges/quick-action read the SUMMARY (works for every tile). The selected table's
  // tableAgg comes from its slice; the summary badge counts still match (same RPC mirror).
  const calls = summaryCallsOf(i), joiners = tile.pending || 0, reqsN = tile.reqs || 0;
  const called = (tile.hasCall || tile.hasReq);
  // Three-way: red ring for an accepted-unpaid bill, green for accepted-paid, NOTHING for a
  // brand-new order (was a 2-way ternary that wrongly painted new orders green/"paid").
  const payCls = a.unpaid ? "pay-unpaid" : a.paid ? "pay-paid" : "";
  // Body differs by state: free tables get the big Open button; open tables
  // get guests + the meta line, and (once there are dishes) a progress bar + count pills.
  let body = "";
  if (st.cls === "free" || st.cls === "req") {
    // Seat count (owner request, 2026-07-01 — the tablet had NO capacity info at all
    // before) from the table_seats setting (migration 111); no entry → 4, same default
    // the manager floor uses. Only shown on free/req tiles — occupied tiles show the
    // guest count instead (already more useful once a party is actually seated).
    const seats = ((state.data.settings || {}).table_seats || {})[String(i)] || 4;
    body = `<span class="tsub">${st.cls === "req" ? "asked to open" : "tap to open"}</span><span class="tseats">🪑 ${seats} seats</span><span class="topen" data-quick="open" data-qt="${i}">Open</span>`;
  } else {
    // KOT # rides on the full slice only (the summary RPC carries no KOT — it's the shared
    // manager RPC). For the selected table we show "KOT #…"; for every other tile we show the
    // summary's meta line ("x/y served · ₹z due" / "n orders"), exactly like the manager.
    const sub = a.kots.length
      ? `KOT #${a.kots[a.kots.length - 1]}${a.kots.length > 1 ? ` +${a.kots.length - 1}` : ""}`
      : (a.meta || (a.guests ? "" : "no order yet"));
    const total = a.nw + a.ck + a.rd + a.sv;
    const strip = total > 0 ? `<div class="tstrip">${a.nw ? `<i style="width:${(a.nw / total) * 100}%;background:#f59e0b"></i>` : ""}${a.ck ? `<i style="width:${(a.ck / total) * 100}%;background:#4f9dff"></i>` : ""}${a.rd ? `<i style="width:${(a.rd / total) * 100}%;background:#ec4899"></i>` : ""}${a.sv ? `<i style="width:${(a.sv / total) * 100}%;background:#22c55e"></i>` : ""}</div>` : "";
    const pills = total > 0 ? `<div class="tpills">${a.nw ? `<span class="tpill nw">${a.nw} new</span>` : ""}${a.ck ? `<span class="tpill ck">${a.ck} cooking</span>` : ""}${a.rd ? `<span class="tpill rd">${a.rd} ready</span>` : ""}${a.sv ? `<span class="tpill sv">${a.sv} served</span>` : ""}</div>` : "";
    // ONE contextual quick action, same priority as the manager floor tile:
    // new order → Accept, a call/request → Attend, served-but-unpaid → Mark paid.
    let quick = "";
    if (a.nw > 0) quick = `<span class="tacc" data-quick="accept" data-qt="${i}">✓ Accept</span>`;
    else if (called || joiners) quick = `<span class="tatt" data-quick="attend" data-qt="${i}">Attend</span>`;
    else if (st.cls === "bill" && tperm("tablet_mark_paid") !== "off") quick = `<span class="tpay" data-quick="pay" data-qt="${i}">💳 Mark paid</span>`;
    body = `<span class="tsub">${a.guests ? `${a.guests} guest${a.guests > 1 ? "s" : ""} · ` : ""}${esc(sub)}</span>${strip}${pills}${quick}`;
  }
  return `<button class="tile t-${st.cls} ${payCls} ${state.table === String(i) ? "sel" : ""}" data-t="${i}">
      <span class="tbadges">${calls.length ? `<em class="b-call" title="${esc(calls.map((c) => c.note || "call").join(", "))}">${[...new Set(calls.map((c) => callIcon(c.note)))].join("")}</em>` : ""}${reqsN ? `<em class="b-req">📨${reqsN}</em>` : ""}${joiners ? `<em class="b-join">🙋${joiners}</em>` : ""}</span>
      <span class="tnum">${i}</span>
      <span class="tlabel">${st.label}</span>
      ${body}
    </button>`;
}

// floorCountsHtml() / floorNavHtml(): the two filter strips (count chips beside the brand on
// wide screens; the floor-nav row on narrow). Shared so the patch can refresh their counts in
// place with byte-identical markup. Their buttons are wired ONCE by bindFloorDelegation on the
// stable #counts / #floorNav containers, so rewriting innerHTML never orphans a handler.
function floorFilterCounts() {
  const n = tableCount();
  let cNeeds = 0, cOpen = 0, cFree = 0;
  for (let i = 1; i <= n; i++) { if (needsAttention(i)) cNeeds++; if (tileIsOpen(i)) cOpen++; else cFree++; }
  return [["all", "All", n], ["needs", "⚠ Needs", cNeeds], ["open", "Active", cOpen], ["free", "Free", cFree]];
}
function floorCountsHtml() {
  const filt = state.floorFilter || "all";
  return floorFilterCounts().map(([k, lbl, c]) =>
    `<button class="cchip ${k === "needs" && c ? "needs" : ""} ${filt === k ? "on" : ""}" data-filter="${k}"><b>${c}</b> ${lbl.replace("⚠ ", "")}</button>`).join("");
}
function floorNavHtml() {
  const filt = state.floorFilter || "all";
  return floorFilterCounts().map(([k, lbl, c]) =>
    `<button class="fnav ${filt === k ? "on" : ""}" data-filter="${k}">${lbl} <em>${c}</em></button>`).join("");
}

function renderFloor() {
  bindFloorDelegation(); // attach the ONE delegated tile/quick/chip handler (boolean-guarded)
  const _t0 = performance.now();
  const n = tableCount();
  const countsEl = document.getElementById("counts");
  if (countsEl) countsEl.innerHTML = floorCountsHtml();
  const navEl = document.getElementById("floorNav");
  if (navEl) navEl.innerHTML = floorNavHtml();

  let html = "";
  for (let i = 1; i <= n; i++) {
    if (!passesFilter(i)) continue;        // SHARED predicate — patch path agrees on visibility
    html += tileHtml(i);                   // SHARED tile builder — single source of truth
  }
  $("#tiles").innerHTML = html || `<div class="muted" style="padding:14px">No tables here right now.</div>`;
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
  // their counts in place. Their buttons are delegated on #counts/#floorNav, so this is safe.
  const countsEl = document.getElementById("counts");
  if (countsEl) countsEl.innerHTML = floorCountsHtml();
  const navEl = document.getElementById("floorNav");
  if (navEl) navEl.innerHTML = floorNavHtml();
  window.__lfhPerf.patches++;
  window.__lfhPerf.tilesPatched += patched;
  window.__lfhPerf.lastMs = performance.now() - _t0;
}

// bindFloorDelegation: attach the floor's click handling ONCE on the stable containers
// (#tiles for tiles + quick buttons; #counts/#floorNav for the filter chips — all three are
// static in index.html, only their innerHTML changes). Why delegation instead of per-tile
// onclick? At 300 tables the old renderFloor re-bound ~300 listeners on EVERY render; with one
// delegated handler, patched/replaced tile nodes need NO re-binding — the listener lives on the
// parent and finds the clicked target via .closest(). A boolean guard means repeated renders
// never stack duplicate listeners. Mirrors the manager's bindFloorDelegation.
let floorDelegationBound = false;
function bindFloorDelegation() {
  if (floorDelegationBound) return;
  floorDelegationBound = true;
  // Filter chips (count chips + floor-nav row) — change the floor filter, then full render.
  const onChip = (e) => { const b = e.target.closest("[data-filter]"); if (b) { state.floorFilter = b.dataset.filter; renderFloor(); } };
  const countsEl = document.getElementById("counts");
  if (countsEl) countsEl.addEventListener("click", onChip);
  const navEl = document.getElementById("floorNav");
  if (navEl) navEl.addEventListener("click", onChip);
  // The tile grid — quick actions FIRST (nested inside the tile; matching one and returning
  // replicates the old stopPropagation so a quick button never ALSO selects the tile), then the
  // tile-select. Every data-attr handled here lives on a node the PATCH path may replace, which
  // is exactly why they MUST be delegated. The accept/pay branches inline their original
  // ensureTableSlice + filter logic verbatim (NOT flattened) so behaviour is unchanged.
  const tilesEl = $("#tiles");
  if (tilesEl) tilesEl.addEventListener("click", async (e) => {
    let q;
    // Quick "Open" on a free tile.
    if ((q = e.target.closest(".topen[data-quick='open']"))) { optimisticOpen(q.dataset.qt); return; }
    // Quick "Accept" — load the table's orders first (grid has only the slim summary), then accept.
    if ((q = e.target.closest(".tacc[data-quick='accept']"))) {
      const qt = q.dataset.qt;
      await ensureTableSlice(qt);
      optimisticAccept(ordersOf(qt).filter((o) => o.status === "received").map((o) => o.id));
      return;
    }
    // Quick "Attend" — open the table's detail to handle the call / join request.
    if ((q = e.target.closest(".tatt[data-quick='attend']"))) { selectTable(q.dataset.qt); return; }
    // Quick "Mark paid" — same payment-method modal + whole-table pay as the detail panel,
    // without opening it.
    if ((q = e.target.closest(".tpay[data-quick='pay']"))) {
      const t = q.dataset.qt;
      await ensureTableSlice(t);  // load the table's orders so billNo/due + optimisticPay have real rows
      const a = tableAgg(t);
      await payBillWithMethod(t, a);
      return;
    }
    // TILE SELECT last — only reached when no quick button above matched.
    const tile = e.target.closest(".tile[data-t]");
    if (tile) selectTable(tile.dataset.t);
  });
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
  const STD = ALLERGENS.map((a) => a.slug);
  const labelFor = (slug) => { const a = ALLERGENS.find((x) => x.slug === slug); return a ? a.label : "🚫 " + slug; };
  const chipsHtml = () => {
    const std = ALLERGENS.map((a) => `<span class="chip talg ${working.has(a.slug) ? "on" : ""}" data-slug="${esc(a.slug)}">${esc(a.label)}</span>`).join("");
    // Custom allergens are their own chips — tap one to REMOVE it (same as a standard chip).
    const cust = [...working].filter((s) => !STD.includes(s)).map((s) => `<span class="chip talg on" data-slug="${esc(s)}">${esc(labelFor(s))}</span>`).join("");
    return std + cust;
  };
  const ov = document.createElement("div");
  ov.className = "dish-edit-overlay";
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  ov.innerHTML = `<div class="dish-edit-box" style="width:min(94vw,460px);max-height:90vh;overflow:auto;background:#0f1830;color:#e7eefc;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
    <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #1d2944"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">Edit dish · ${esc(item.title)}</h3><button class="dish-edit-close" aria-label="Close" style="background:#243049;border:0;color:#fff;border-radius:8px;padding:6px 10px;cursor:pointer">✕</button></div>
    <div style="padding:16px 18px">
      <div style="font-size:13px;font-weight:700;margin:0 0 8px">⚠ Allergies to avoid <span class="muted small">— tap to add or remove</span></div>
      <div class="dish-alg-list" style="display:flex;flex-wrap:wrap;gap:8px"></div>
      <div style="display:flex;gap:8px;margin-top:10px"><input type="text" class="dish-edit-custominput" maxlength="24" placeholder="Type a custom allergen — e.g. water" style="flex:1;min-width:0;padding:9px 11px;border-radius:9px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:14px"><button class="btn small dish-edit-customadd">Add</button></div>
      <div style="font-size:13px;font-weight:700;margin:15px 0 6px">✎ Note for the kitchen</div>
      <textarea class="dish-edit-note" rows="2" maxlength="200" placeholder="e.g. less ice, extra chocolate" style="width:100%;box-sizing:border-box;padding:9px 11px;border-radius:9px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:14px;resize:vertical"></textarea>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;padding:14px 18px;border-top:1px solid #1d2944"><button class="btn dish-edit-cancel">Cancel</button><button class="btn primary dish-edit-save">Save</button></div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector(".dish-edit-note").value = item.note || "";
  const listEl = ov.querySelector(".dish-alg-list");
  const input = ov.querySelector(".dish-edit-custominput");
  const bindChips = () => listEl.querySelectorAll("[data-slug]").forEach((c) => (c.onclick = () => { const s = c.dataset.slug; working.has(s) ? working.delete(s) : working.add(s); redraw(); }));
  const redraw = () => { listEl.innerHTML = chipsHtml(); bindChips(); };
  redraw();
  const addCustom = () => { const v = norm(input.value); if (v) working.add(v); input.value = ""; redraw(); input.focus(); };
  ov.querySelector(".dish-edit-customadd").onclick = addCustom;
  input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } };
  const close = () => ov.remove();
  ov.querySelector(".dish-edit-close").onclick = close;
  ov.querySelector(".dish-edit-cancel").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  const same = (a, b) => JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());
  ov.querySelector(".dish-edit-save").onclick = async () => {
    const note = ov.querySelector(".dish-edit-note").value.trim();
    const removed = [...initial].filter((s) => !working.has(s));  // cleared → drop everywhere
    const added = [...working].filter((s) => !initial.has(s));    // new avoids → this dish only
    const newItemRemoved = [...new Set([...itemRemoved.filter((s) => !removed.includes(s)), ...added])];
    const newOrderAllergies = orderAllergies.filter((s) => !removed.includes(s));
    try {
      if (note !== String(item.note || "").trim()) await api("POST", `/items/${item.id}/note`, { note });
      if (!same(newItemRemoved, itemRemoved)) await api("POST", `/items/${item.id}/removed`, { removed: newItemRemoved });
      if (order.id && !same(newOrderAllergies, orderAllergies)) await api("POST", `/orders/${order.id}/allergies`, { allergies: newOrderAllergies });
      close();
      await load(); if (!state.ordering) renderPanel();
      toast("Dish updated");
    } catch (e) { toast("Couldn't save: " + e.message, false); }
  };
  setTimeout(() => input.focus(), 30);
}

// ── the table detail panel (view mode) ───────────────────────────────────────
function renderPanel() {
  const p = $("#panel");
  p.classList.remove("has-detail");
  // Not ordering → make sure the order-mode takeover + its back-stack layer are gone,
  // whatever path ended the ordering (send, ← back, ✓ Done, hardware back, drawer close).
  if (!state.ordering) {
    document.body.classList.remove("om-mode");
    p.classList.remove("om-open");
    const off = omBackOff; omBackOff = null; if (off) off();
  }
  if (!state.table) { p.innerHTML = `<div class="empty">Tap a table to see it — or to take an order for it.</div>`; return; }
  if (state.ordering) { renderOrderMode(); return; }
  const t = state.table, s = sessionOf(t), a = tableAgg(t);

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
    const load = dishN
      ? `<div class="ord"><div class="ordh"><span class="left"><span class="skel skel-kot"></span><span class="when" style="display:flex;align-items:center;gap:7px"><span class="tsl-dot"></span> syncing…</span></span></div>${[52, 38, 61, 45].slice(0, Math.min(4, dishN)).map(skelRow).join("")}</div>`
      : `<div class="muted" style="display:flex;align-items:center;gap:8px;padding:6px 0"><span class="tsl-dot"></span> Loading order details…</div>`;
    const payCls = a.unpaid ? "unpaid" : a.paid ? "paid" : "";
    const billBox = (a.due > 0 || dishN) ? `<div class="foot"><div class="billbox ${payCls}"><span class="bn">bill</span>${a.due > 0 ? `<span class="due">${inr(a.due)} due</span>` : ""}<span class="pay">${a.unpaid ? "● UNPAID" : a.paid ? "paid ✓" : "● new"}</span></div></div>` : "";
    p.classList.add("has-detail");
    p.innerHTML = `
      <div class="phead">
        <div style="flex:1"><h2 style="margin:0;font-size:19px">Table ${esc(t)}</h2><div class="pmeta">${a.guests ? `${a.guests} guest${a.guests > 1 ? "s" : ""} · ` : ""}${dishN ? `${dishN} dish${dishN === 1 ? "" : "es"}` : "opening…"}</div></div>
        <button class="btn small backtop" id="backTop">↑ Tables</button>
        <span class="live">● open</span>
      </div>
      <div class="detail-body">
        <div class="sec"><h3>Orders</h3>${pills}${load}</div>
      </div>
      <div class="dacts">
        <button class="btn primary big" id="takeOrder">＋ Take order</button>
      </div>
      ${billBox}`;
    const bt = $("#backTop"); if (bt) bt.onclick = () => document.querySelector(".floor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    $("#takeOrder").onclick = () => { state.ordering = true; state.cart = []; state.cat = ""; state.dishSearch = ""; state._omTop = 0; renderPanel(); };
    return;
  }

  // renderPanel only ever draws the SELECTED table, whose full slice is loaded — so read its
  // orders straight from the slice (tableAgg no longer carries `os`, which would be empty for an
  // unselected table anyway). calls/joiners/members/reqs likewise come from the loaded slice.
  const os = ordersOf(t), calls = callsOf(t), joiners = joinersOf(t), members = s ? membersOf(t) : [], reqs = reqsOf(t);
  // Invoice generation (tablet_invoice setting) is independent of Mark bill paid — a
  // waiter can invoice before or after payment. `s` comes straight from `select("*")`
  // on sessions, so invoice_no/invoice_voided are already on it, same as the manager reads.
  const invoiced = !!(s && s.invoice_no != null && !s.invoice_voided);

  const reqRows = reqs.map((r) => `<div class="row"><span>📨 ${r.type === "open" ? "Asked to open" : "Asked for access"}${r.name ? ` · ${esc(r.name)}` : ""}</span><span class="reqbtns"><button class="btn small primary" data-req-approve="${esc(r.id)}">Approve</button><button class="btn small" data-req-deny="${esc(r.id)}">Deny</button></span></div>`).join("");
  const joinRows = joiners.map((m) => `<div class="row"><span>🙋 ${esc(m.name || "Guest")} wants to join</span><button class="btn small primary" data-approve="${esc(m.id)}">Approve</button></div>`).join("");
  const partyRows = members.map((m) => `<div class="row"><span>${m.role === "owner" ? "👑" : "•"} ${esc(m.name || "Guest")}${m.approved ? "" : ` <span class="muted">(pending)</span>`}</span>${m.role === "owner" ? `<span class="muted small">head</span>` : `<span class="reqbtns"><button class="btn small" data-makehead="${esc(m.id)}">Make head</button><button class="btn small" data-kick="${esc(m.id)}">Kick</button><button class="btn small danger" data-ban="${esc(m.id)}">Ban</button></span>`}</div>`).join("");
  // Each order is a card: KOT chip, time, "via app" badge for guest/phone orders,
  // every dish with a tappable status pill, and an Accept button when it's new.
  // One dish row: qty · name · price · status badge · Serve button, with per-item
  // allergens (the order-wide "avoid in all" distributed onto each item; no banner).
  const dishRowHtml = (r, o) => {
    const opt = (r.options && r.options.length) ? `<div class="iopt">${esc(r.options.map((x) => x.label || x).join(" · "))}</div>` : "";
    const orderAllergies = Array.isArray(o.allergies) ? o.allergies : [];
    const lineRem = [...new Set([...(Array.isArray(r.removed) ? r.removed : []), ...orderAllergies])];
    // A staff-ADDED allergen carries a green "＋"; a removed one flags "✎−" on the name.
    const addedSet = new Set((Array.isArray(r.added_allergens) ? r.added_allergens : []).map((x) => String(x).toLowerCase()));
    const rem = lineRem.length ? `<div class="irem">no ${lineRem.map((x) => `${esc(String(x))}${addedSet.has(String(x).toLowerCase()) ? `<sup class="alg-add" title="Added after the order was placed">＋</sup>` : ""}`).join(", ")}</div>` : "";
    const remMark = r.removed_flag ? ` <span class="alg-removed" title="An allergen was removed after the order was placed">✎−</span>` : "";
    const note = r.note ? `<div class="iopt">“${esc(r.note)}”</div>` : "";
    const priceTag = r.price > 0 ? `<span class="iprice">${inr(r.price * r.qty)}</span>` : "";
    const statusBadge = `<span class="ist ${r.status}">${STATUS_WORD[r.status] || r.status}</span>`;
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
    const editCtl = (editing && r.fromDb && r.status !== "served" && r.status !== "ready")
      ? `<span class="iedit"><button class="qbtn" data-qty-dec="${esc(r.id)}" data-qty="${r.qty}" title="Fewer">−</button><button class="qbtn" data-qty-inc="${esc(r.id)}" data-qty="${r.qty}" title="More">＋</button><button class="qbtn" data-edit-dish="${esc(r.id)}" title="Edit allergens & note for this dish">✎ Edit</button></span>`
      : "";
    return `<div class="iline${editing ? " editing" : ""}"><span class="iqty">${r.qty}×</span><span class="inm">${esc(r.title)}${remMark}${opt}${rem}${note}</span>${priceTag}${statusBadge}${serveBtn}${editCtl}${delBtn}</div>`;
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
    // Order-wide allergen chips = the 6 standard toggles only, EXACTLY like the
    // manager's per-order chips. A CUSTOM ("other") allergen is added per-dish via
    // the "✎ Edit" modal, not here. (owner, 2026-06-18 — mirror the manager)
    const aSet = new Set((Array.isArray(o.allergies) ? o.allergies : []).map((x) => String(x).toLowerCase()));
    const chips = ALLERGENS.map((a) => `<span class="chip talg ${aSet.has(a.slug) ? "on" : ""}" data-alg="${esc(o.id)}" data-slug="${a.slug}">${esc(a.label)}</span>`).join("");
    return `<div class="ordctl ordctl-edit">
      <div class="ordctl-alg"><span class="muted small">⚠ Avoid (all dishes):</span>${chips}</div>
      <div class="ordctl-row">
        <button class="btn small" data-add-dish="${esc(o.id)}">＋ Add dish</button>
        ${tperm("tablet_discount") !== "off" ? `<button class="btn small" data-discount="${esc(o.id)}">− Discount${Number(o.discount) > 0 ? ` (${inr(o.discount)})` : ""}</button>` : ""}
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

  const callRows = calls.map((c) => `<div class="row"><span>🔔 ${esc(c.note || "Waiter call")}</span><button class="btn small primary" data-attend="${esc(c.id)}">Done</button></div>`).join("");

  // Bottom bar: bill + paid/unpaid on the left; a big ATTEND filling the rest when
  // there's a call (sized to whatever space is left, exactly as asked). The bill
  // number only exists once the table has ordered — until then we say so plainly.
  let foot = "";
  if (s) {
    const hasOrders = os.length > 0;
    const payCls = a.unpaid ? "unpaid" : a.paid ? "paid" : "";
    const billInner = hasOrders
      ? `<span class="bn">bill #${esc(a.billNo ?? "—")}</span>${invoiced ? `<span class="inv">🧾 #${esc(s.invoice_no)}</span>` : ""}${a.due > 0 ? `<span class="due">${inr(a.due)} due</span>` : ""}<span class="pay">${a.unpaid ? "● UNPAID" : a.paid ? "paid ✓" : "● new"}</span>`
      : `<span class="bn">no bill yet</span><span class="due">starts on first order</span>`;
    const attend = calls.length
      ? `<button class="attend ${calls.length > 1 ? "more" : ""}" data-attend="${esc(calls[0].id)}">🔔 ATTEND — ${esc(calls[0].note || "call")}${calls.length > 1 ? ` (+${calls.length - 1} more)` : ""}</button>`
      : "";
    foot = `<div class="foot"><div class="billbox ${payCls}">${billInner}</div>${attend}</div>`;
  }

  p.classList.add("has-detail");
  p.innerHTML = `
    <div class="phead">
      <div style="flex:1"><h2 style="margin:0;font-size:19px">Table ${esc(t)}</h2><div class="pmeta">${s ? `${a.guests ? `${a.guests} guest${a.guests > 1 ? "s" : ""} · ` : ""}${os.length ? `bill #${esc(a.billNo ?? "—")}` : "no bill yet"}` : "closed"}</div></div>
      <button class="btn small backtop" id="backTop">↑ Tables</button>
      ${s ? `<span class="live">● open</span>` : `<span class="off">closed</span>`}
    </div>
    <div class="detail-body">
      ${reqRows ? `<div class="sec"><h3>Requests</h3>${reqRows}</div>` : ""}
      ${joinRows ? `<div class="sec"><h3>Waiting to join</h3>${joinRows}</div>` : ""}
      ${callRows ? `<div class="sec"><h3>Calls</h3>${calls.length > 1 ? `<button class="btn small primary" data-attend-all-calls="${esc(t)}">Attend all (${calls.length})</button>` : ""}${callRows}</div>` : ""}
      ${s ? `<div class="sec"><h3>Party</h3>${partyRows || `<div class="muted small">No guests joined yet.</div>`}</div>` : ""}
      <div class="sec"><h3>Orders</h3>${(os.filter((o) => o.status === "received").length > 1) ? `<button class="accept accept-all" data-accept-all="${esc(t)}">✓ Accept all &amp; prepare (${os.filter((o) => o.status === "received").length})</button>` : ""}${(os.some((o) => o.status !== "received" && o.status !== "cancelled" && dishRowsOf(o).some((r) => r.fromDb && r.status !== "served"))) ? `<button class="serve-all-btn" data-serve-all="${esc(t)}">🍽️ Serve all</button>` : ""}${orderCards || `<div class="muted">No orders yet.</div>`}</div>
    </div>
    <div class="dacts">
      ${s ? "" : `<button class="btn" id="openTable">Open this table</button>`}
      <button class="btn primary big" id="takeOrder">＋ Take order</button>
      ${s ? `<button class="btn" id="shiftTable">⇄ Move table</button>` : ""}
      ${s && os.length ? `<button class="btn" id="restartTable">↻ Restart</button>` : ""}
      ${s && os.length && !invoiced && tperm("tablet_invoice") !== "off" ? `<button class="btn" id="genInvoiceBtn">🧾 Generate invoice</button>` : ""}
      ${s && os.length && a.unpaid && tperm("tablet_mark_paid") !== "off" ? `<button class="btn pay" id="payBill"${os.some((o) => o.status === "received") ? ' disabled title="Accept the order first — the bill can only be paid once accepted."' : ""}>💳 Mark bill paid</button>` : ""}
      ${s ? `<button class="btn danger" id="closeTable">✕ Close table</button>` : ""}
    </div>
    ${foot}`;

  // wire it up
  document.querySelectorAll("[data-req-approve]").forEach((b) => (b.onclick = () => act(() => api("POST", `/requests/${b.dataset.reqApprove}/resolve`, { status: "approved" }))));
  document.querySelectorAll("[data-req-deny]").forEach((b) => (b.onclick = () => act(() => api("POST", `/requests/${b.dataset.reqDeny}/resolve`, { status: "denied" }))));
  document.querySelectorAll("[data-attend]").forEach((b) => (b.onclick = () => act(() => api("POST", `/calls/${b.dataset.attend}/attend`))));
  document.querySelectorAll("[data-approve]").forEach((b) => (b.onclick = () => act(() => api("POST", `/members/${b.dataset.approve}/approve`))));
  document.querySelectorAll("[data-makehead]").forEach((b) => (b.onclick = () => act(() => api("POST", `/members/${b.dataset.makehead}/make-head`))));
  // Kick a guest off the table (table stays open). Confirm first — it ends access.
  document.querySelectorAll("[data-kick]").forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Kick this guest from the table? Their access ends now — the table stays open.", "Kick"))
      act(() => api("POST", `/members/${b.dataset.kick}/remove`));
  }));
  // Ban a guest: kicked now AND blocklisted so they can't rejoin. Destructive — confirm.
  document.querySelectorAll("[data-ban]").forEach((b) => (b.onclick = async () => {
    if (await confirmDialog("Ban this guest? They're kicked now and blocked from rejoining this table.", "Ban"))
      actGated("POST", `/members/${b.dataset.ban}/ban`, null, { message: "Enter a manager PIN to ban this guest." });
  }));
  // Auto-approve toggle: future joiners are approved automatically (no staff review).
  // Attend every waiter call on the table in one tap.
  document.querySelectorAll("[data-attend-all-calls]").forEach((b) => (b.onclick = () => act(async () => {
    for (const c of callsOf(b.dataset.attendAllCalls)) await api("POST", `/calls/${c.id}/attend`);
  })));
  // Discount: shown only when the manager enables it for the tablet (General settings
  // → tablet_discount = on/pin; default off = no button). tabletDiscount() applies
  // the on/pin rule; the server enforces it too.
  document.querySelectorAll("[data-discount]").forEach((b) => (b.onclick = () => tabletDiscount(b.dataset.discount)));
  // Accept ONE order — optimistic (flips received→preparing instantly, persists in bg).
  document.querySelectorAll("[data-accept]").forEach((b) => (b.onclick = () => optimisticAccept([b.dataset.accept])));
  // Accept ALL un-accepted orders on the table in one tap — optimistic + bulk.
  document.querySelectorAll("[data-accept-all]").forEach((b) => (b.onclick = () =>
    optimisticAccept(ordersOf(b.dataset.acceptAll).filter((o) => o.status === "received").map((o) => o.id))));
  // Serve ALL accepted-but-unserved dishes on the table in one tap — optimistic + bulk.
  // Flips every dish to served on screen INSTANTLY, then fires one /serve-all per order
  // in the background (mirrors the manager + advanceDish). No more waiting on the network.
  document.querySelectorAll("[data-serve-all]").forEach((b) => (b.onclick = () =>
    optimisticServeAll(ordersOf(b.dataset.serveAll).filter((o) => o.status !== "received" && o.status !== "cancelled" && dishRowsOf(o).some((r) => r.fromDb && r.status !== "served")).map((o) => o.id))));
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
    if (await confirmDialog("Delete this whole order? It will be permanently removed.", "Delete order"))
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
  document.querySelectorAll("[data-qty-inc]").forEach((b) => (b.onclick = () => act(() => api("POST", `/items/${b.dataset.qtyInc}/qty`, { qty: Math.min(99, (parseInt(b.dataset.qty, 10) || 1) + 1) }))));
  document.querySelectorAll("[data-qty-dec]").forEach((b) => (b.onclick = () => { const q = (parseInt(b.dataset.qty, 10) || 1) - 1; if (q < 1) { toast("Use 🗑 to remove the dish", false); return; } act(() => api("POST", `/items/${b.dataset.qtyDec}/qty`, { qty: q })); }));
  // "✎ Edit" one dish → the unified modal (allergens incl. custom + kitchen note),
  // IDENTICAL to the manager panel's openDishEditModal.
  document.querySelectorAll("[data-edit-dish]").forEach((b) => (b.onclick = () => openDishEditModal(b.dataset.editDish)));
  // Add a dish to THIS already-placed order: reuse the dish browser in add mode.
  document.querySelectorAll("[data-add-dish]").forEach((b) => (b.onclick = () => { state.ordering = true; state.addToOrderId = b.dataset.addDish; state.cat = ""; state.dishSearch = ""; state._omTop = 0; renderPanel(); }));
  // Per-order allergen chips: toggle an allergen on/off for the whole order.
  document.querySelectorAll(".talg[data-alg]").forEach((chip) => (chip.onclick = () => {
    const id = chip.dataset.alg, slug = chip.dataset.slug;
    const o = (state.data.orders || []).find((x) => x.id === id);
    if (!o) return;
    const cur = new Set((Array.isArray(o.allergies) ? o.allergies : []).map((x) => String(x).toLowerCase()));
    if (cur.has(slug)) cur.delete(slug); else cur.add(slug);
    o.allergies = [...cur];        // OPTIMISTIC: update local state now so any re-render reflects it
    chip.classList.toggle("on");   // INSTANT visual feedback — before this it only hit the server, so the tap felt dead ("allergy not clicking")
    act(() => api("POST", `/orders/${id}/allergies`, { allergies: [...cur] }));
  }));
  const ob = $("#openTable"); if (ob) ob.onclick = () => optimisticOpen(t);
  const shb = $("#shiftTable"); if (shb && s) shb.onclick = () => renderShiftPicker(t, s);
  // Restart: clear this round's orders off the floor (they stay served+archived in
  // records) but keep the table OPEN for a fresh round. Mirrors the manager.
  const rsb = $("#restartTable"); if (rsb && s) rsb.onclick = async () => {
    if (!(await confirmDialog(`Restart table ${t}? Its current orders clear off the floor and the table stays OPEN for a fresh round.`, "Restart"))) return;
    // Restart means NO ONE is sitting and the round is cleared — show that INSTANTLY.
    // Clear this table's orders + free its seats locally so the tile never flashes the
    // old "1 seated"/round state during the (gated) round-trip. The final load() below
    // reconciles — and reverts this if the manager PIN is cancelled. (owner, 2026-06-20)
    const sid = s.id;
    state.data.orders = state.data.orders.filter((o) => String(o.table_number) !== String(t));
    state.data.members = state.data.members.filter((m) => m.session_id !== sid);
    renderFloor(); renderPanel();
    await actGated("POST", `/tables/${t}/restart`, null, { message: "This table has a round going — enter a manager PIN to restart it." });
    await load(); // reconcile (also reverts the optimistic clear if the PIN was cancelled)
  };
  const pb = $("#payBill"); if (pb) pb.onclick = () => payBillWithMethod(t, a);
  const gib = $("#genInvoiceBtn"); if (gib && s) gib.onclick = () => genInvoice(s.id);
  const clb = $("#closeTable"); if (clb && s) clb.onclick = async () => {
    const warn = a.unpaid && os.length ? ` The bill (${inr(a.due)}) is still UNPAID.` : "";
    if (!(await confirmDialog(`Close table ${t} and free it?${warn}`, "Close table"))) return;
    // OPTIMISTIC: drop the session locally so the tile frees INSTANTLY, then persist.
    state.data.sessions = (state.data.sessions || []).filter((x) => x.id !== s.id);
    state.table = null; state.ordering = false;
    renderFloor(); renderPanel();
    try {
      await api("POST", `/sessions/${s.id}/close`);
      await load();
    } catch (e) {
      await load(); // server refused — refetch so the still-open table reappears
      if (/close anyway/i.test(String(e && e.message))) {
        if (await confirmDialog(`${e.message}`, "Close anyway")) {
          await actGated("POST", `/sessions/${s.id}/close`, { force: true }, { message: "Enter a manager PIN to close this busy table.", toast: "Table closed" });
        }
        return;
      }
      toast("Failed: " + e.message, false);
    }
  };
  const bt = $("#backTop"); if (bt) bt.onclick = () => document.querySelector(".floor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  $("#takeOrder").onclick = () => { state.ordering = true; state.cart = []; state.cat = ""; state.dishSearch = ""; state._omTop = 0; renderPanel(); };
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
function advanceDish(id, cur) {
  const next = NEXT_STATUS[cur] || "preparing";
  const it = (state.data.items || []).find((x) => x.id === id);
  if (it) it.status = next;            // optimistic — the pill flips instantly
  // Adopt this state as the baseline so a poll that arrives with the SAME
  // (server-confirmed) data won't repaint the panel under the waiter's finger.
  lastSig = boardSig(state);
  renderFloor();
  if (!state.ordering) renderPanel();
  // Fire-and-forget; reconcile once after the taps stop (not per tap).
  api("POST", `/items/${id}/status`, { status: next })
    .then(() => scheduleServeReconcile())
    .catch((e) => { toast("Failed: " + e.message, false); load(); });
}

// Bulk order actions (accept / serve-all) the OPTIMISTIC way — flip the orders +
// their dishes in local state and repaint INSTANTLY, then persist in the background
// (one bulk call per order), then reconcile once after. Mirrors advanceDish above
// and the manager's serveAllOrders/acceptTableOrders so it feels instant instead of
// making the waiter wait on the network. (owner, 2026-06-18)
function flipOrders(orderIds, { from, to, orderStatus }) {
  const items = state.data.items || [];
  orderIds.forEach((oid) => {
    const o = (state.data.orders || []).find((x) => x.id === oid);
    if (o) o.status = orderStatus;
    items.forEach((it) => { if (it.order_id === oid && (from ? it.status === from : it.status !== "served")) it.status = to; });
    if (o && Array.isArray(o.items)) o.items = o.items.map((i) => ((from ? i.status === from : i.status !== "served") ? { ...i, status: to } : i));
  });
  lastSig = boardSig(state);           // adopt as baseline so a poll can't flicker it back
  renderFloor();
  if (!state.ordering) renderPanel();
}
function optimisticAccept(orderIds) {
  if (!orderIds.length) return;
  flipOrders(orderIds, { from: "received", to: "preparing", orderStatus: "preparing" });
  Promise.all(orderIds.map((oid) => api("POST", `/orders/${oid}/accept`)))
    .then(() => scheduleServeReconcile())
    .catch((e) => { toast("Failed: " + e.message, false); load(); });
}
function optimisticServeAll(orderIds) {
  if (!orderIds.length) return;
  flipOrders(orderIds, { from: null, to: "served", orderStatus: "served" });
  Promise.all(orderIds.map((oid) => api("POST", `/orders/${oid}/serve-all`)))
    .then(() => scheduleServeReconcile())
    .catch((e) => { toast("Failed: " + e.message, false); load(); });
}

// Shift the WHOLE party to another free table. Optimistic: move the tiles/labels
// immediately, fire the RPC, then reconcile on the next load — no dead wait.
function renderShiftPicker(t, s) {
  const n = tableCount();
  const free = [];
  // FREE = not open, read from the summary (tileIsOpen) — works for every tile, not just the
  // selected one whose slice is cached. (Two-tier: the grid no longer holds every table's session.)
  for (let i = 1; i <= n; i++) { if (String(i) !== String(t) && !tileIsOpen(i)) free.push(i); }
  const btns = free.length
    ? free.map((i) => `<button class="btn shiftpick" data-shiftto="${i}">Table ${i}</button>`).join("")
    : `<div class="muted">No free tables to shift to.</div>`;
  $("#panel").classList.remove("has-detail");
  $("#panel").innerHTML = `
    <div class="phead"><h2>Move Table ${esc(t)} →</h2><button class="btn small" id="shiftBack">← back</button></div>
    <div class="muted small" style="margin-bottom:10px">Move this party — orders &amp; calls included — to a free table:</div>
    <div class="shiftgrid">${btns}</div>`;
  $("#shiftBack").onclick = renderPanel;
  document.querySelectorAll("[data-shiftto]").forEach((b) => (b.onclick = () => {
    const to = b.dataset.shiftto;
    runOptimistic(
      () => { if (s) s.table_number = to; state.data.orders.forEach((o) => { if (String(o.table_number) === String(t)) o.table_number = to; }); state.table = to; },
      () => api("POST", `/sessions/${s.id}/shift`, { to }),
    );
  }));
}

// Move a SINGLE order to another table's bill. Two taps: pick the order, pick the
// target table.
function renderMoveOrderPicker(t) {
  const os = ordersOf(t);
  const list = os.map((o, i) => `<button class="btn" style="text-align:left" data-pickorder="${esc(o.id)}">#${esc(o.kot_no ?? "—")} · Order ${i + 1} · ${inr(o.total)}</button>`).join("");
  $("#panel").classList.remove("has-detail");
  $("#panel").innerHTML = `
    <div class="phead"><h2>Move an order</h2><button class="btn small" id="moveBack">← back</button></div>
    <div class="muted small" style="margin-bottom:10px">Pick the order to move off Table ${esc(t)}:</div>
    <div class="pactions">${list || `<div class="muted">No orders.</div>`}</div>`;
  $("#moveBack").onclick = renderPanel;
  document.querySelectorAll("[data-pickorder]").forEach((b) => (b.onclick = () => renderMoveOrderTarget(t, b.dataset.pickorder)));
}
function renderMoveOrderTarget(t, orderId) {
  const n = tableCount();
  const tiles = [];
  for (let i = 1; i <= n; i++) {
    if (String(i) === String(t)) continue;
    const st = tileState(i);
    tiles.push(`<button class="btn shiftpick" data-moveto="${i}">Table ${i}<br><span class="muted small">${st.label}</span></button>`);
  }
  $("#panel").innerHTML = `
    <div class="phead"><h2>Move order →</h2><button class="btn small" id="moveBack2">← back</button></div>
    <div class="muted small" style="margin-bottom:10px">Send this order to which table's bill?</div>
    <div class="shiftgrid">${tiles.join("")}</div>`;
  $("#moveBack2").onclick = () => renderMoveOrderPicker(t);
  document.querySelectorAll("[data-moveto]").forEach((b) => (b.onclick = () => {
    const to = b.dataset.moveto;
    runOptimistic(
      () => { const o = state.data.orders.find((x) => x.id === orderId); if (o) o.table_number = to; },
      () => api("POST", `/orders/${orderId}/move`, { to }),
    );
  }));
}

// Apply a local change, repaint instantly, then persist and reconcile from the
// server. On failure we toast and reload so the screen can't lie.
async function runOptimistic(mutate, fn) {
  try { mutate(); renderFloor(); renderPanel(); await fn(); }
  catch (e) { toast("Failed: " + e.message, false); }
  await load();   // load() already repaints if anything changed — no second render (that was the extra flash)
}

const act = async (fn) => { try { await fn(); await load(); } catch (e) { toast("Failed: " + e.message, false); } };

// ensureTableSlice(t): make sure table t's FULL slice (sessions/orders/items/calls/…) is in the
// local cache before a tile QUICK-ACTION on a NON-selected table runs. The grid renders from the
// slim summary, so an unselected table has NO order rows cached — and Accept/Mark-paid need them
// (the ids to act on, the due/billNo to confirm). Mirrors the editor's ensureTableSlice. The
// SELECTED table's slice is already kept fresh by load(); best-effort (a fetch blip just no-ops).
async function ensureTableSlice(t) {
  // Already have this table's rows cached (orders OR an open session)? Nothing to fetch.
  if ((state.data.orders || []).some((o) => String(o.table_number) === String(t))
      || (state.data.sessions || []).some((s) => String(s.table_number) === String(t))) return;
  try {
    const slice = await api("GET", "/state?table=" + encodeURIComponent(t));
    const tset = String(t);
    const dedupeById = (arr) => { const m = new Map(); for (const x of arr) if (x && x.id != null) m.set(x.id, x); return [...m.values()]; };
    const d = state.data || {};
    const freshSessions = slice.sessions || [];
    const purgeSids = new Set();
    for (const s of (d.sessions || [])) if (String(s.table_number) === tset) purgeSids.add(s.id);
    for (const s of freshSessions) purgeSids.add(s.id);
    const freshOrders = slice.orders || [];
    const purgeOids = new Set();
    for (const o of (d.orders || [])) if (String(o.table_number) === tset) purgeOids.add(o.id);
    for (const o of freshOrders) purgeOids.add(o.id);
    state.data = Object.assign({}, d, {
      sessions: dedupeById((d.sessions || []).filter((s) => String(s.table_number) !== tset).concat(freshSessions)),
      orders: dedupeById((d.orders || []).filter((o) => String(o.table_number) !== tset).concat(freshOrders)),
      members: dedupeById((d.members || []).filter((m) => !purgeSids.has(m.session_id)).concat(slice.members || [])),
      items: dedupeById((d.items || []).filter((it) => !purgeOids.has(it.order_id)).concat(slice.items || [])),
      calls: dedupeById((d.calls || []).filter((c) => String(c.table_number) !== tset).concat(slice.calls || [])),
      requests: dedupeById((d.requests || []).filter((r) => String(r.table_number) !== tset).concat(slice.requests || [])),
    });
  } catch { /* leave cache as-is; the action then no-ops rather than throwing */ }
}

// Open a table INSTANTLY (mirrors the manager): drop a pending "open" session into
// local state + repaint NOW, then create it on the server and reconcile. On failure
// runOptimistic's load() refetches and the pending session disappears. (owner, 2026-06-19)
function optimisticOpen(table) {
  const t = String(table);
  if (sessionOf(t)) return; // already open
  runOptimistic(
    () => {
      state.data.sessions = [...(state.data.sessions || []), { id: "pending-" + t, table_number: t, status: "open", auto_approve: false }];
      if (Array.isArray(state.data.requests)) state.data.requests = state.data.requests.filter((r) => !(r.type === "open" && String(r.table_number) === t));
      // The GRID tile reads the slim SUMMARY (tier 1), not the slice patched above — without
      // this the tile sat on "Free" for the whole server round-trip (~2s) while the detail
      // already said open (owner report, 2026-07-02). Mirror the manager's openTableSession:
      // flip this tile to "Open / waiting" locally NOW; load() reconciles to server truth after.
      const tiles = Object.assign({}, state.summary.tiles || {});
      tiles[t] = Object.assign({}, tiles[t] || {}, {
        state: "waiting", label: "Open", meta: "waiting for guests",
        counts: { nw: 0, ck: 0, rd: 0, sv: 0 }, due: 0, pay: "",
        members: 0, pending: 0, hasNew: false, hasCall: false, hasReq: false, hasJoin: false, reqs: 0, calls: 0,
      });
      state.summary = Object.assign({}, state.summary, { tiles });
    },
    () => api("POST", "/sessions/open", { table: t }),
  );
}

// Mark a table's whole bill paid INSTANTLY: flip every order's payment_status to
// "paid" locally so the tile/detail re-read as paid (no due) right away, then persist
// + reconcile. runOptimistic's load() reverts on failure. (owner, 2026-06-20)
function optimisticPay(t, method, note) {
  runOptimistic(
    () => { state.data.orders.forEach((o) => { if (String(o.table_number) === String(t)) o.payment_status = "paid"; }); },
    () => api("POST", `/tables/${t}/pay`, method ? { payment_method: method, payment_note: note || "" } : null),
  );
}
// Settle a table's bill respecting the manager's tablet_mark_paid setting: 'on' →
// instant optimistic pay; 'pin' → manager-PIN-gated (the server also enforces it).
// method/note come from openPaymentMethodModal (payBillWithMethod below) — optional
// so this still works if ever called without them.
function payBill(t, method, note) {
  const body = method ? { payment_method: method, payment_note: note || "" } : null;
  if (tperm("tablet_mark_paid") === "pin") {
    actGated("POST", `/tables/${t}/pay`, body, { message: "Enter a manager PIN to mark this bill paid.", toast: method ? `Bill paid via ${method}` : "Bill paid" });
  } else {
    optimisticPay(t, method, note);
  }
}
// openPaymentMethodModal(due, label): "how did they pay?" — UPI/Cash/Card, or Other
// with a short typed note. Picking a method IS the confirmation (replaces the old
// plain confirmDialog — one tap instead of two). Resolves { method, note }, or null
// if cancelled. Mirrors the manager panel's version, styled inline like this file's
// other self-contained modals (openDishEditModal, openDiscountModal, pinPrompt).
// (owner, 2026-07-01)
function openPaymentMethodModal(due, label) {
  return new Promise((resolve) => {
    document.querySelector(".pay-overlay")?.remove();
    const ov = document.createElement("div");
    ov.className = "pay-overlay";
    Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
    ov.innerHTML = `<div class="pay-box" style="width:min(94vw,420px);max-height:90vh;overflow:auto;background:#0f1830;color:#e7eefc;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
      <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #1d2944"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">${esc(label)}</h3><button class="pay-close" aria-label="Close" style="background:#243049;border:0;color:#fff;border-radius:8px;padding:6px 10px;cursor:pointer">✕</button></div>
      <div style="padding:16px 18px">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px;color:#9fb2d8;margin-bottom:12px"><span>Amount collected</span><b style="color:#e7eefc;font-size:15px">${inr(due)}</b></div>
        <div style="font-size:13px;font-weight:700;margin:0 0 8px">How did they pay? <span style="color:#9fb2d8;font-weight:400">— only pick one if the money's actually in hand</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <button type="button" class="pay-method-btn" data-method="UPI" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 10px;min-height:64px;border-radius:12px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:14px;font-weight:600"><span style="font-size:22px">📱</span>UPI</button>
          <button type="button" class="pay-method-btn" data-method="Cash" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 10px;min-height:64px;border-radius:12px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:14px;font-weight:600"><span style="font-size:22px">💵</span>Cash</button>
          <button type="button" class="pay-method-btn" data-method="Card" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 10px;min-height:64px;border-radius:12px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:14px;font-weight:600"><span style="font-size:22px">💳</span>Card</button>
          <button type="button" class="pay-method-btn" data-method="Other" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 10px;min-height:64px;border-radius:12px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:14px;font-weight:600"><span style="font-size:22px">⋯</span>Other</button>
        </div>
        <div class="pay-other-field" style="display:none;margin-top:12px">
          <div style="font-size:13px;font-weight:700;margin:0 0 8px">What kind?</div>
          <input type="text" class="pay-other-input" maxlength="60" placeholder="e.g. wallet, bank transfer" style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:14px;margin-bottom:10px">
          <button type="button" class="btn primary pay-other-confirm" style="width:100%">Confirm</button>
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding:14px 18px;border-top:1px solid #1d2944"><button class="btn pay-cancel-btn">Cancel</button></div>
    </div>`;
    document.body.appendChild(ov);
    let resolved = false;
    const close = () => ov.remove();
    const finish = (method, note) => { resolved = true; close(); resolve({ method, note }); };
    const cancel = () => { close(); if (!resolved) resolve(null); };
    ov.querySelector(".pay-close").onclick = cancel;
    ov.querySelector(".pay-cancel-btn").onclick = cancel;
    ov.onclick = (e) => { if (e.target === ov) cancel(); };
    ov.querySelectorAll(".pay-method-btn").forEach((b) => (b.onclick = () => {
      const m = b.dataset.method;
      if (m === "Other") {
        ov.querySelector(".pay-other-field").style.display = "";
        ov.querySelector(".pay-other-input").focus();
        return;
      }
      finish(m, null);
    }));
    const otherInput = ov.querySelector(".pay-other-input");
    const confirmOther = () => finish("Other", otherInput.value.trim());
    ov.querySelector(".pay-other-confirm").onclick = confirmOther;
    otherInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); confirmOther(); } };
  });
}
// payBillWithMethod: the ONE shared "close this bill" flow for the tablet — opens the
// payment-method modal, then settles the table with the picked method. Replaces the
// plain confirmDialog on BOTH entry points (the floor-tile quick pay + the table
// detail's Mark paid button) with one that also records HOW the money came in.
async function payBillWithMethod(t, a) {
  const picked = await openPaymentMethodModal(a.due, `Mark bill ${a.billNo ? `#${a.billNo} ` : ""}paid for table ${t}`);
  if (!picked) return;
  payBill(t, picked.method, picked.note);
}
// Generate this table's invoice number, respecting tablet_invoice: 'on' → direct;
// 'pin' → manager-PIN-gated (server enforces it too). Independent of Mark bill paid —
// the RPC is idempotent, so this is safe even if somehow clicked twice.
function genInvoice(sid) {
  if (tperm("tablet_invoice") === "pin") {
    actGated("POST", `/sessions/${sid}/invoice`, null, { message: "Enter a manager PIN to generate this invoice.", toast: "Invoice generated" });
  } else {
    act(() => api("POST", `/sessions/${sid}/invoice`));
  }
}
// openDiscountModal: replaces the old "type the ₹ amount to knock off" prompt() with two
// staff-friendly ways to land on the same number (owner, 2026-07-01 — "I don't want the
// amount-to-discount option like it's right now"):
//   "They pay"    — staff types the FINAL amount the customer will pay; we work BACKWARD
//                   to the discount (bill − pay) and show the % that comes out to.
//   "Percent off" — staff types a %; we work FORWARD to the discount (bill × %) and show
//                   what the customer ends up paying.
// Both modes converge on the same ₹ discount the server has always accepted, so the final
// save() below still respects tablet_discount (off/on/pin) exactly like before — only the
// INPUT changed. Mirrors the manager panel's version, styled inline like this file's other
// self-contained modals (openDishEditModal, pinPrompt).
function openDiscountModal(order) {
  document.querySelector(".disc-overlay")?.remove();
  const total = Number(order.total) || 0;
  const current = Number(order.discount) || 0;
  let mode = "pay"; // "pay" | "percent"
  let payVal = total > 0 ? Math.max(0, total - current) : total;
  let pctVal = total > 0 ? Math.round((current / total) * 1000) / 10 : 0;

  const ov = document.createElement("div");
  ov.className = "disc-overlay";
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  ov.innerHTML = `<div class="disc-box" style="width:min(94vw,420px);max-height:90vh;overflow:auto;background:#0f1830;color:#e7eefc;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
    <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #1d2944"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">Apply discount</h3><button class="disc-close" aria-label="Close" style="background:#243049;border:0;color:#fff;border-radius:8px;padding:6px 10px;cursor:pointer">✕</button></div>
    <div style="padding:16px 18px">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px;color:#9fb2d8;margin-bottom:12px"><span>Bill total</span><b style="color:#e7eefc;font-size:15px">${inr(total)}</b></div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <span class="chip disc-mode-chip on" data-mode="pay" style="flex:1;text-align:center;padding:9px 10px">They pay</span>
        <span class="chip disc-mode-chip" data-mode="percent" style="flex:1;text-align:center;padding:9px 10px">Percent off</span>
      </div>
      <div data-panel="pay">
        <div style="font-size:13px;font-weight:700;margin:0 0 8px">Amount they'll pay</div>
        <input type="number" inputmode="decimal" min="0" step="1" class="disc-pay-input" placeholder="e.g. 3000" style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:17px;font-weight:700">
      </div>
      <div data-panel="percent" style="display:none">
        <div style="font-size:13px;font-weight:700;margin:0 0 8px">Percent off</div>
        <input type="number" inputmode="decimal" min="0" max="100" step="1" class="disc-pct-input" placeholder="e.g. 20" style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:17px;font-weight:700">
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">${[5, 10, 15, 20, 25, 50].map((p) => `<span class="chip disc-pct-pick" data-pct="${p}">${p}%</span>`).join("")}</div>
      </div>
      <div style="margin-top:16px;padding:12px 14px;border-radius:12px;background:#0a1326;border:1px solid #1d2944;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;font-size:13.5px;color:#9fb2d8"><span>Discount</span><b class="disc-prev-amt" style="color:#e7eefc">− ${inr(current)}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:13.5px;color:#9fb2d8"><span>That's</span><b class="disc-prev-pct" style="color:#e7eefc">${pctVal}% off</b></div>
        <div style="display:flex;justify-content:space-between;font-size:14.5px;padding-top:6px;margin-top:2px;border-top:1px dashed #1d2944"><span style="color:#60a5fa;font-weight:800">They pay</span><b class="disc-prev-pay" style="color:#60a5fa;font-weight:800">${inr(payVal)}</b></div>
      </div>
      <div style="font-size:13px;font-weight:700;margin:15px 0 6px">Reason <span style="color:#9fb2d8;font-weight:400">(optional)</span></div>
      <input type="text" class="disc-note-input" maxlength="200" placeholder="e.g. loyalty, comp, manager approval" style="width:100%;box-sizing:border-box;padding:9px 11px;border-radius:9px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:14px">
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;padding:14px 18px;border-top:1px solid #1d2944">
      ${current > 0 ? `<button class="btn danger disc-remove-btn">Remove</button><span style="flex:1"></span>` : ""}
      <button class="btn disc-cancel-btn">Cancel</button>
      <button class="btn primary disc-apply-btn">Apply</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector(".disc-note-input").value = order.discount_note || "";
  const payInput = ov.querySelector(".disc-pay-input");
  const pctInput = ov.querySelector(".disc-pct-input");
  payInput.value = payVal ? String(payVal) : "";
  pctInput.value = pctVal ? String(pctVal) : "";

  let discAmount = current;
  const clamp = (n, lo, hi) => Math.min(Math.max(Number.isFinite(n) ? n : 0, lo), hi);
  const round2 = (n) => Math.round(n * 100) / 100;
  const updatePreview = () => {
    if (mode === "pay") {
      payVal = clamp(parseFloat(payInput.value), 0, total);
      discAmount = round2(total - payVal);
    } else {
      pctVal = clamp(parseFloat(pctInput.value), 0, 100);
      discAmount = round2((total * pctVal) / 100);
      payVal = round2(total - discAmount);
    }
    pctVal = total > 0 ? Math.round((discAmount / total) * 1000) / 10 : 0;
    ov.querySelector(".disc-prev-amt").textContent = "− " + inr(discAmount);
    ov.querySelector(".disc-prev-pct").textContent = pctVal + "% off";
    ov.querySelector(".disc-prev-pay").textContent = inr(payVal);
  };
  updatePreview();

  const setMode = (m) => {
    mode = m;
    ov.querySelectorAll(".disc-mode-chip").forEach((c) => c.classList.toggle("on", c.dataset.mode === m));
    ov.querySelector('[data-panel="pay"]').style.display = m === "pay" ? "" : "none";
    ov.querySelector('[data-panel="percent"]').style.display = m === "percent" ? "" : "none";
    (m === "pay" ? payInput : pctInput).focus();
    updatePreview();
  };
  ov.querySelectorAll(".disc-mode-chip").forEach((c) => (c.onclick = () => setMode(c.dataset.mode)));
  ov.querySelectorAll(".disc-pct-pick").forEach((c) => (c.onclick = () => { pctInput.value = c.dataset.pct; updatePreview(); }));
  payInput.oninput = updatePreview;
  pctInput.oninput = updatePreview;

  const close = () => ov.remove();
  ov.querySelector(".disc-close").onclick = close;
  ov.querySelector(".disc-cancel-btn").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };

  const save = (amount) => {
    const note = ov.querySelector(".disc-note-input").value.trim();
    close();
    const body = { amount, note: amount > 0 ? note : "" };
    if (tperm("tablet_discount") === "pin") {
      actGated("POST", `/orders/${order.id}/discount`, body, { message: "Enter a manager PIN to apply this discount.", toast: amount > 0 ? `Discount ${inr(amount)} applied` : "Discount removed" });
    } else {
      act(() => api("POST", `/orders/${order.id}/discount`, body));
    }
  };
  ov.querySelector(".disc-apply-btn").onclick = () => save(discAmount);
  const removeBtn = ov.querySelector(".disc-remove-btn"); if (removeBtn) removeBtn.onclick = () => save(0);
  setTimeout(() => payInput.focus(), 30);
}

// tabletDiscount: entry point wired from the "− Discount" button on each order card —
// opens the modal above scoped to that order (clamped to that order's own total).
function tabletDiscount(orderId) {
  const o = (state.data.orders || []).find((x) => x.id === orderId);
  if (!o) { toast("That order is no longer on the board.", false); return; }
  openDiscountModal(o);
}

// ── order-taking mode ────────────────────────────────────────────────────────
const dishPrice = (d) => Number(String(d.price).replace(/[^0-9.]/g, "")) || 0;

// Add ONE dish to an already-placed order (staff edit). Server prices + re-prices.
// Stays in add mode so the waiter can add several, then taps "✓ Done".
async function addDishToOrder(orderId, payload) {
  try {
    const r = await api("POST", `/orders/${orderId}/add-item`, payload);
    if (r && r.ok === false) { toast("Couldn't add: " + (r.reason || "rejected"), false); return; }
    toast("Dish added ✓");
    await load();
    if (state.addToOrderId) renderOrderMode(); else if (!state.ordering) renderPanel();
  } catch (e) { toast("Failed: " + e.message, false); }
}

// Menu-style browse (owner, 2026-07-03): ALL categories are laid out as sections in ONE
// scrollable browser — the category rail/chips JUMP to a section on tap and FOLLOW the
// scroll (scroll-spy, same trick as the guest menu's computeSpy). Searching collapses the
// sections into a single flat result list, exactly like before.
function orderSections() {
  const q = state.dishSearch.trim().toLowerCase();
  if (q) {
    const dishes = state.data.dishes.filter((d) => (d.title || "").toLowerCase().includes(q));
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
function dishBtnHtml(d) {
  const out = (d.tags || []).includes("sold-out");
  // Total this dish across ALL its cart lines (a dish can now appear on several
  // lines — e.g. plain + "no nuts"), so the badge shows the true count.
  const inCartQty = state.cart.filter((l) => l.id === d.id).reduce((s, l) => s + l.qty, 0);
  return `<button class="dish ${out ? "out" : ""} ${inCartQty ? "in" : ""}" data-dish="${esc(d.id)}" ${out ? "disabled" : ""}>
    <span class="dname">${esc(d.title)}</span>
    <span class="drow">
      <span class="dprice">${out ? "SOLD OUT" : inr(dishPrice(d))}</span>
      <span class="dbadge">${out ? "" : inCartQty ? `<span class="dqty">×${inCartQty}</span>` : `<span class="dadd" aria-hidden="true">＋</span>`}</span>
    </span>
  </button>`;
}
function orderSectionsHtml() {
  const secs = orderSections();
  if (!secs.length) return `<div class="muted" style="padding:14px">No dishes match.</div>`;
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
    if (!s) return;
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
    if (slot && !btn.disabled) slot.innerHTML = qty ? `<span class="dqty">×${qty}</span>` : `<span class="dadd" aria-hidden="true">＋</span>`;
  });
}
function bindDishButtons() {
  document.querySelectorAll("[data-dish]").forEach((b) => (b.onclick = () => {
    const d = state.data.dishes.find((x) => x.id === b.dataset.dish);
    if (!d) { toast("That dish just changed — refreshing the menu", false); renderOrderMode(); return; }
    if (Array.isArray(d.options) && d.options.length) { renderDishOptions(d, null); return; }
    // ADD-TO-EXISTING-ORDER mode: a plain dish is added straight away (no cart).
    if (state.addToOrderId) { addDishToOrder(state.addToOrderId, { dishId: d.id, qty: 1 }); return; }
    // A quick tap only stacks onto a PLAIN line of this dish — one with no options,
    // no per-item allergy and no note. An edited line (e.g. "no nuts") is left alone,
    // so tapping the dish again starts a fresh plain line instead of bumping the
    // customised one — letting a waiter order "1 no-nuts" AND "1 normal" of the same
    // dish side by side. (owner, 2026-06-16)
    const line = state.cart.find((l) => l.id === d.id && !l.options && !l.allergy && !l.note);
    if (line) line.qty = Math.min(99, line.qty + 1);
    else state.cart.push({ id: d.id, title: d.title, price: dishPrice(d), qty: 1 });
    // Patch the badge + cart pane in place — a full re-render would reset the browse scroll.
    updateDishBadges(); updateOrderCart();
  }));
}

function renderDishOptions(d, editIndex) {
  // Leaving the browser for the options screen — remember the browse spot so the
  // rebuild on return lands exactly where the waiter was.
  const sc = $("#omScroll"); if (sc) state._omTop = sc.scrollTop;
  const sel = {};
  const line = editIndex != null ? state.cart[editIndex] : null;
  if (line && line.options) for (const o of line.options) (sel[o.group] = sel[o.group] || []).push(o.label);
  // carry the line's per-item allergy + note so editing keeps them
  state._opt = { d, sel, editIndex, allergy: (line && line.allergy) || "", note: (line && line.note) || "" };
  drawDishOptions();
}
function drawDishOptions() {
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
  $("#panel").classList.remove("has-detail");
  // Size/extras (if the dish has any) PLUS a per-item allergy + note — so the
  // waiter can flag "no nuts" or "less ice" on this one dish, not the whole order.
  // .om-optwrap gives the screen its own padding + scroll while the panel is the
  // full-screen order takeover (which strips the panel's usual padding).
  $("#panel").innerHTML = `
    <div class="om-optwrap">
    <div class="phead"><h2>${esc(d.title)}</h2><button class="btn small" id="optBack">← back</button></div>
    <div class="muted small">Base ${inr(base)}</div>
    ${groups || `<div class="muted small">No size / extras for this dish.</div>`}
    <div class="optgroup"><h4>⚠ Allergy / avoid <span class="muted small">· this item</span></h4>
      <input type="text" id="optAllergy" class="note allergy" placeholder="e.g. nuts, dairy" value="${esc(state._opt.allergy || "")}"></div>
    <div class="optgroup"><h4>Note <span class="muted small">· optional</span></h4>
      <input type="text" id="optNote" class="note" placeholder="e.g. less ice, extra hot" value="${esc(state._opt.note || "")}"></div>
    <div class="ctotal"><span>Per item</span><b>${inr(unit)}</b></div>
    <button class="btn primary big" id="optAdd">${editIndex != null ? "Update item" : "Add to order"}</button>
    </div>`;
  document.querySelectorAll("[data-optg]").forEach((b) => (b.onclick = () => {
    const g = b.dataset.optg, l = b.dataset.optl, multi = b.dataset.multi === "true";
    const cur = sel[g] || [];
    sel[g] = multi ? (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]) : (cur.includes(l) ? [] : [l]);
    drawDishOptions();
  }));
  // Persist the typed allergy/note onto _opt so a re-render (toggling an option)
  // doesn't wipe them.
  const al = $("#optAllergy"); if (al) al.oninput = (e) => (state._opt.allergy = e.target.value);
  const nt = $("#optNote"); if (nt) nt.oninput = (e) => (state._opt.note = e.target.value);
  $("#optBack").onclick = renderOrderMode;
  $("#optAdd").onclick = () => {
    const opts = [];
    for (const g of (d.options || [])) for (const c of (g.choices || [])) {
      if ((sel[g.name] || []).includes(c.label)) opts.push({ group: g.name, label: c.label, price: Number(c.price) || 0 });
    }
    const unitPrice = base + opts.reduce((s, o) => s + o.price, 0);
    const allergy = (state._opt.allergy || "").trim();
    const noteRaw = (state._opt.note || "").trim();
    // ADD-TO-EXISTING-ORDER mode: send straight to the order's add-item endpoint.
    // The allergy rides as this dish's own `removed` list (NOT the order-wide
    // list), so it stays on this dish only — mirroring how new orders carry it.
    if (state.addToOrderId) {
      const removed = allergy ? allergy.split(",").map((s) => s.trim()).filter(Boolean) : [];
      addDishToOrder(state.addToOrderId, { dishId: d.id, qty: 1, options: opts.length ? opts.map((o) => ({ group: o.group, label: o.label })) : undefined, removed: removed.length ? removed : undefined, note: noteRaw || undefined });
      state._opt = null;
      return;
    }
    const line = { id: d.id, title: d.title, price: unitPrice, qty: 1, options: opts.length ? opts : undefined,
      allergy: allergy || undefined, note: noteRaw || undefined };
    if (editIndex != null && state.cart[editIndex]) { line.qty = state.cart[editIndex].qty; state.cart[editIndex] = line; }
    else state.cart.push(line);
    state._opt = null;
    renderOrderMode();
  };
}

// The "This order" pane — kept EXACTLY as before (owner 2026-07-03: "this order thing is
// perfect right now"), it just lives in its own scroll region now instead of under the grid.
function orderCartHtml() {
  const lines = state.cart.map((l, i) => `<div class="cline">
      <span class="cname">${esc(l.title)}${l.options && l.options.length ? `<small class="copts">${esc(l.options.map((o) => o.label).join(", "))}</small>` : ""}${l.allergy ? `<small class="callergy">⚠ ${esc(l.allergy)}</small>` : ""}${l.note ? `<small class="copts">✎ ${esc(l.note)}</small>` : ""}</span>
      <span class="cqty"><button class="qbtn" data-minus="${i}">−</button><b>${l.qty}</b><button class="qbtn" data-plus="${i}">+</button><button class="qbtn edit" data-edit="${i}" title="Size / extras / allergy">✎</button></span>
      <span class="cprice">${inr(l.price * l.qty)}</span>
    </div>`).join("");
  const total = state.cart.reduce((s, l) => s + l.price * l.qty, 0);
  return `<div class="cart">
      <h3>This order</h3>
      <div class="cart-lines">${lines || `<div class="muted">Tap dishes to add them.</div>`}</div>
      <input type="text" id="orderAllergy" class="note allergy" placeholder="⚠ Allergies / notes for the kitchen (e.g. nuts, less ice) — whole order" value="${esc(state.allergies || "")}">
      <div class="ctotal"><span>Items total</span><b>${inr(total)}</b></div>
      <div class="muted small">Final bill (incl. tax) is computed by the system when you send it.</div>
      <button class="btn primary big" id="sendOrder" ${state.cart.length ? "" : "disabled"}>SEND TO KITCHEN</button>
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
  c.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => {
    const l = state.cart[+b.dataset.edit];
    const d = l && state.data.dishes.find((x) => x.id === l.id);
    if (d) renderDishOptions(d, +b.dataset.edit);
  }));
  // The separate kitchen-note field was removed (owner, 2026-07-03 — allergy covers it);
  // the allergy box now doubles as the whole-order note-to-kitchen.
  const al = c.querySelector("#orderAllergy"); if (al) al.oninput = (e) => (state.allergies = e.target.value);
  const send = c.querySelector("#sendOrder"); if (send) send.onclick = sendOrder;
}
// Leave order mode by ANY exit (← back, ✓ Done, hardware back) — one place drops the
// takeover class + the back-stack layer so none of them can leak.
let omBackOff = null;
function exitOrderMode() {
  state.ordering = false; state.addToOrderId = null; state._omTop = 0;
  renderPanel();
}
function renderOrderMode() {
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
    <div class="om lite">
      <div class="om-head">
        <h2>${addMode ? "Add · " : ""}Table ${esc(state.table)}</h2>
        <input type="search" id="dishSearch" class="order-search om-search" placeholder="🔎 Search dishes…" value="${esc(state.dishSearch)}">
        <button class="btn small ${addMode ? "primary" : ""}" id="omExit">${addMode ? "✓ Done" : "← back"}</button>
      </div>
      <div class="om-body ${addMode ? "no-cart" : ""}">
        <nav class="om-nav" id="omNav">${orderNavHtml()}</nav>
        <div class="om-scroll" id="omScroll">${addMode ? `<div class="muted small om-hint">Tap a dish to add it to this order — the bill updates automatically.</div>` : ""}${orderSectionsHtml()}</div>
        ${addMode ? "" : `<aside class="om-cart" id="omCart"></aside>`}
      </div>
    </div>`;
  bindDishButtons();
  wireOrderNav();
  updateOrderCart();
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
async function sendOrder() {
  if (sendingOrder) return;
  const count = state.cart.reduce((s, l) => s + l.qty, 0);
  if (!(await confirmDialog(`Send ${count} item${count > 1 ? "s" : ""} to the kitchen for table ${state.table}?`))) return;
  sendingOrder = true;
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
    const r = await api("POST", "/order", {
      table: state.table,
      items: state.cart.map((l) => {
        const removed = splitCsv(l.allergy);
        return {
          id: l.id, qty: l.qty,
          options: l.options ? l.options.map((o) => ({ group: o.group, label: o.label })) : undefined,
          removed: removed.length ? removed : undefined,
          note: l.note || undefined,
        };
      }),
      allergies: [...new Set(orderAllergies)],
      note: state.note.trim() || null,
    });
    if (!r || r.ok !== true) { toast("Rejected: " + ((r && r.reason) || "unknown") + (r && r.item ? ` (${r.item})` : ""), false); return; }
    toast(`Sent! Kitchen ticket #${r.kot_no}`);
    state.ordering = false; state.cart = []; state.note = ""; state.allergies = ""; state._omTop = 0;
    await load(); renderPanel();
  } catch (e) { toast("Failed: " + e.message, false); }
  finally {
    sendingOrder = false;
    const b = document.getElementById("sendOrder");
    if (b) { b.disabled = false; b.textContent = "SEND TO KITCHEN"; }
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
  if (el) el.textContent = restDisplayName(r);
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
// ensureTableSlice) pulls full rows. Drops the table's old rows + adds the fresh, dedup'd by id.
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
  if (!tables || !tables.length) return load();
  const seq = ++loadSeq;
  const sel = state.table != null ? String(state.table) : null;
  let tileResps, selSlice;
  try {
    [tileResps, selSlice] = await Promise.all([
      Promise.all(tables.map((t) => api("GET", "/summary?table=" + encodeURIComponent(t)))),
      (sel != null && tables.map(String).includes(sel)) ? api("GET", "/state?table=" + encodeURIComponent(sel)) : Promise.resolve(null),
    ]);
  } catch (e) { return load(); }        // network/parse blip → safe full reload
  if (seq !== loadSeq) return;          // a newer refresh started — drop this stale snapshot

  // Patch each changed table's tile into the cached summary; a table that's now gone from the
  // server's tile set (e.g. dropped below table_count) is set to nothing so it renders "free".
  const tiles = Object.assign({}, state.summary.tiles || {});
  tileResps.forEach((resp, i) => {
    const t = String(tables[i]);
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
  });
  // Refresh the selected table's full detail slice if it changed.
  if (sel != null && selSlice) mergeSelectedSlice(sel, selSlice);

  const sig = boardSig(state);
  if (sig === lastSig) return;          // nothing visible changed — don't repaint
  lastSig = sig;
  // TARGETED path → patch JUST the named tiles + the filter counts, NOT the whole grid (the
  // 300-table freeze fix). patchTabletTiles self-falls-back to a full renderFloor() if a tile's
  // filter membership flipped or the grid isn't present. The detail panel (#panel) is a separate
  // container, so patching tiles never disturbs an open detail — keep its same guard below.
  patchTabletTiles(tables);
  if (!state.ordering) renderPanel();   // never repaint the detail under a mid-order waiter
}

async function load() {
  const seq = ++loadSeq;
  const sel = state.table != null ? String(state.table) : null;
  // TIER 1: the slim summary drives the GRID + side aggregates + the table-agnostic bundle
  // (settings/dishes/categories/restaurant). TIER 2: if a table's detail is open, ALSO fetch its
  // full slice so the detail renders complete order/member rows. The grid never needs the slice.
  const [summary, selSlice] = await Promise.all([
    api("GET", "/summary"),
    sel != null ? api("GET", "/state?table=" + encodeURIComponent(sel)) : Promise.resolve(null),
  ]);
  if (seq !== loadSeq) return;          // a newer refresh started — this one is stale, drop it
  // Split the full-summary response into the per-tile summary (+ aggregates) and the agnostic bundle.
  const { settings, dishes, categories, restaurant, ...summaryOnly } = summary || {};
  state.summary = summaryOnly;
  state.data = Object.assign({}, state.data, {
    settings: settings ?? null,
    dishes: dishes || [],
    categories: categories || [],
    restaurant: restaurant ?? null,
    // Stale per-table detail rows from a previously-selected table are harmless (the grid ignores
    // state.data; the detail re-pulls below), but we clear them so a closed table can't linger.
    sessions: [], members: [], orders: [], items: [], calls: [], requests: [],
  });
  if (sel != null && selSlice) mergeSelectedSlice(sel, selSlice);
  // Show WHICH restaurant this panel is scoped to (multi-tenant). Set here in load()
  // — NOT in renderFloor()/renderPanel() — because they're skipped when the board
  // signature is unchanged, and the name must still appear on the very first load.
  setRestName(restaurant);
  const sig = boardSig(state);
  if (sig === lastSig) return;
  lastSig = sig;
  renderFloor();
  if (!state.ordering) renderPanel();
}
setInterval(() => ($("#clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })), 1000);
load().catch((e) => toast("Can't reach the database: " + e.message, false));
// Realtime: refetch only when something on the floor actually changes (instant),
// instead of polling every second. A slow 60s timer is the backup if the
// WebSocket drops; if realtime didn't load, fall back to a gentle 2s poll.
if (window.LFH_RT) {
  // Split by topic: ops churn → TARGETED loadTables() when the breadcrumb names specific
  // tables, else full load() (wake, reconnect, initial, or any unscopable event). menu edits
  // (dish/price/category changes) always do a full load() so the dish browser refreshes.
  LFH_RT.start({ handlers: {
    ops: (detail) => (detail && !detail.full && detail.tables && detail.tables.length) ? loadTables(detail.tables) : load(),
    menu: () => load(),
  }});
  setInterval(() => load().catch(() => {}), 60000); // backup sync
} else {
  setInterval(() => load().catch(() => {}), 2000); // fallback poll
}

/* ════════════════════════════════════════════════════════════════════════════
   PHONE RESPONSIVE (2026-06-30): a hamburger drawer (profile + settings + logout)
   and a full-screen work panel with a top-right ✕ close. Pure UI add-on — it reads
   the existing global `state` / `renderPanel` / `renderFloor`, so the ordering logic
   is untouched. All behaviour is gated to phone widths by CSS; desktop is unchanged.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  // ── Full-screen panel close (✕) ──────────────────────────────────────────
  const closeBtn = document.createElement("button");
  closeBtn.id = "tabletClose"; closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close"); closeBtn.textContent = "✕";
  document.body.appendChild(closeBtn);
  closeBtn.onclick = () => { state.table = null; state.ordering = false; renderPanel(); renderFloor(); };

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
    '<div class="dw-row"><span>Theme</span><button class="btn small" id="dwTheme" type="button">Light / Dark</button></div>' +
    '<a class="dw-btn danger" id="dwLogout" href="/api/panel-logout">Log out</a>';
  document.body.appendChild(backdrop); document.body.appendChild(drawer);

  let drawerOff = null;
  const openDrawer = () => {
    backdrop.classList.add("open"); drawer.classList.add("open");
    drawer.querySelector("#dwRest").textContent = (document.getElementById("restName")?.textContent || "").trim() || "—";
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
  const ham = document.getElementById("hamburger"); if (ham) ham.onclick = openDrawer;

  let profileLoaded = false;
  async function loadProfile() {
    if (profileLoaded) return; // name/role don't change within a session
    try {
      const r = await fetch("/api/panel-profile", { cache: "no-store" });
      const j = await r.json();
      if (!j.error) {
        drawer.querySelector("#dwName").textContent = j.name || j.username || "Staff";
        drawer.querySelector("#dwRole").textContent = [j.role, j.username].filter(Boolean).join(" · ");
        profileLoaded = true;
      }
    } catch { /* offline — leave the placeholder */ }
  }
})();
