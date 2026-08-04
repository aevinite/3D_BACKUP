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
const inr = (n) => "₹" + Math.round((parseFloat(n) || 0) * INR_RATE).toLocaleString("en-US");

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
const api = async (method, path, body, opts) => {
  // Writes go through the offline outbox: sent now if online, else saved on this
  // device and replayed on reconnect (at-most-once via X-LFH-Action-Id). GETs stay
  // a plain fetch. Same return/throw contract as before (see outbox.js send()).
  if (method !== "GET" && window.LFH_OUTBOX) {
    // `expect` (optional) travels as X-LFH-Expect so the server can refuse instead of
    // overwriting a change someone else made on another device while this person was typing.
    return window.LFH_OUTBOX.send({ base: "/api/tablet", method, path: ridQ(path), body, panel: "tablet", expect: opts && opts.expect });
  }
  let r;
  try {
    r = await fetch("/api/tablet" + ridQ(path), { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  } catch (netErr) {
    netErr.offline = true; // no reply at all → offline, not a broken server
    throw netErr;
  }
  if (r.status === 401) { location.href = "/login"; throw new Error("login"); }
  // Live reply or the device's saved copy? The offline bar needs to know.
  if (window.LFH_OFF) window.LFH_OFF.noteResponse(r);
  const j = await r.json().catch(() => null);
  // Attach the parsed body + status to the error so callers can read server flags like
  // duplicateWarning (#15) / needPin, which a bare message string would have dropped.
  if (!r.ok) { const e = new Error((j && j.error) || r.statusText); e.status = r.status; e.data = j; e.offline = (j && j.offline === true) || r.headers.get("X-LFH-Offline") === "1"; e.busy = (j && j.busy === true) || r.headers.get("X-LFH-Busy") === "1"; throw e; }
  return j;
};
// #2: a write that returned { queued:true } was saved on THIS device (offline) and will
// sync on reconnect — it did NOT fail. Callers show a friendly "saved" note instead of a
// success/failure toast, and skip the post-write GET (which would reject offline).
const isQueued = (r) => !!(r && r.queued === true);
// Accurate whether offline (syncs on reconnect) or online-with-a-pending-queue (syncs now).
const OFFLINE_SAVED_MSG = "Saved ✓ — syncing automatically.";
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
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
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
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
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
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
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

// Run an action that MAY need a manager PIN: try it plainly first (so it stays
// frictionless when no PIN is configured yet, or for the admin super-user); if the
// server answers "manager PIN required", prompt once and retry with it. Reloads on
// success; a cancelled PIN aborts silently; real errors toast.
async function actGated(method, path, body, opts = {}) {
  try {
    let r;
    // opts.expect (optional) says what the screen was editing FROM, so a PIN-gated value edit
    // (a discount, say) gets the same no-silent-overwrite protection as a plain one.
    const apiOpts = opts.expect ? { expect: opts.expect } : undefined;
    try {
      r = await api(method, path, body, apiOpts);
    } catch (e) {
      if (!/manager pin/i.test(String(e && e.message))) throw e;
      let pin = await pinPrompt(opts.message);
      while (pin) {
        try { r = await api(method, path, { ...(body || {}), managerPin: pin }, apiOpts); break; }
        catch (e2) {
          if (/manager pin/i.test(String(e2 && e2.message))) { pin = await pinPrompt(opts.message, "That PIN didn't match — try again."); continue; }
          throw e2;
        }
      }
      if (!pin) return; // cancelled
    }
    if (isQueued(r)) { toast(OFFLINE_SAVED_MSG); return; }  // #2: saved offline — skip the offline GET + the success toast
    await load();
    if (typeof opts.onSuccess === "function") { try { opts.onSuccess(); } catch (e) {} }
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

function effRate() {
  const s = state.data.settings || {};
  const comps = Array.isArray(s.tax_components)
    ? s.tax_components.map((c) => ({ label: String((c && c.label) || "").trim(), rate: Number(c && c.rate) || 0 })).filter((c) => c.label && c.rate > 0)
    : [];
  if (comps.length) return comps.reduce((a, c) => a + c.rate, 0) / 100;
  return Number(s.tax_rate) || 0.05;
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
    .sort((a, b) => a - b);
  return out.concat(extras);
}

// stepTables(): the order the ‹ › buttons in an open table's popup walk. Deliberately the
// tables the FLOOR is drawing right now, in the same order and through the same section rule
// (inMySection), so "next" can only ever mean the next table this waiter actually serves —
// and, when a filter is on, the next one they were looking at. Strings, to compare with
// state.table without surprises. (owner, 2026-08-03: "toggle the tables very fast".)
function stepTables() {
  return floorTableList().filter((i) => passesFilter(i)).map(String);
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
const tableLabel = (t) => { const n = tname(t); return n ? `${n} (T${t})` : `Table ${t}`; };
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
  if (el && !el.title) el.title = "Not available — this isn't enabled for this restaurant's waiters. You can still use it from the admin view.";
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
  state.ordering = false; state.quick = false; state.cart = []; state.note = ""; state.allergies = ""; state.dishSearch = "";
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
  await ensurePartySlices(t, true);     // FORCE a fresh pull — never trust up-to-60s-stale cached detail (M10);
                                        // a merged table needs its whole PARTY's slices, not just its own
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
  // A FINISHED table says so and WAITS: everything served AND the whole bill paid ("done"),
  // which is the manager's own rule — nothing ends a table by itself, a person decides when
  // the guests have actually left. The manager floor has carried a ⏻ close on that tile since
  // 2026-08-02; the tablet made a waiter open the popup to find it, and this is the "everything
  // else like a manager" the owner asked for. Its confirm is the second step, as always.
  const finished = st.cls === "done" && !a.unpaid;
  const acts = isFree ? "" :
    (finished ? `<span class="tclose" role="button" data-quick="close" data-qt="${partyHead}" title="Everything served and the bill is paid — close ${esc(tableLabel(i))} and free it" aria-label="Close ${esc(tableLabel(i))}">⏻</span>` : "")
    + (tshow("tablet_take_orders") ? `<span class="t-take${txray("tablet_take_orders")}" role="button" data-quick="order" data-qt="${i}" title="Add another order for ${esc(tableLabel(i))}"><i class="t-take-x">＋</i><i class="t-take-t">Take order</i></span>` : "")
    + (a.nw > 0 ? `<span class="tacc" role="button" data-quick="accept" data-qt="${i}" title="Accept the new order">✓</span>` : "")
    + (st.cls === "bill" && tshow("tablet_mark_paid") ? `<span class="tpay${txray("tablet_mark_paid")}" role="button" data-quick="pay" data-qt="${partyHead}" title="Mark the bill paid">💳</span>` : "");
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
const FLOOR_PER_ROW_MIN = 2, FLOOR_PER_ROW_MAX = 30, FLOOR_PER_ROW_DEFAULT = 6;
function floorPerRow() {
  const n = Math.round(Number((state.data.settings || {}).floor_per_row));
  if (!Number.isFinite(n)) return FLOOR_PER_ROW_DEFAULT;
  return Math.min(Math.max(n, FLOOR_PER_ROW_MIN), FLOOR_PER_ROW_MAX);
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

function renderFloor() {
  bindFloorDelegation(); // attach the ONE delegated tile/quick/chip handler (boolean-guarded)
  const _t0 = performance.now();

  const navEl = document.getElementById("floorNav");
  if (navEl) navEl.innerHTML = floorNavHtml();
  const legEl = document.getElementById("floorLegend");
  if (legEl) legEl.innerHTML = floorLegendHtml();
  syncQuickOrderBtn();
  renderMySection();               // sections: "Your tables · 1-6" (no-op when unrestricted)

  const tilesGrid = document.getElementById("tiles");
  if (tilesGrid) tilesGrid.style.setProperty("--per-row", String(floorPerRow()));

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
  // ensureTableSlice + filter logic verbatim (NOT flattened) so behaviour is unchanged.
  const tilesEl = $("#tiles");
  if (tilesEl) tilesEl.addEventListener("click", async (e) => {
    let q;
    // Quick "Accept" — load the table's orders first (grid has only the slim summary), then accept.
    if ((q = e.target.closest(".tacc[data-quick='accept']"))) {
      const qt = q.dataset.qt;
      await ensurePartySlices(qt, true); // FORCE — the tile's summary can be fresh while the cached
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
      await ensurePartySlices(t, true); // FORCE fresh rows so billNo/due + optimisticPay reflect the
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
    const std = ALLERGENS.map((a) => `<span class="chip talg ${working.has(a.slug) ? "on" : ""}" data-slug="${esc(a.slug)}"${orderWide.has(a.slug) ? ' data-orderwide="1"' : ""}>${esc(a.label)}${owTag(a.slug)}</span>`).join("");
    // Custom allergens are their own chips — tap one to REMOVE it (same as a standard chip).
    const cust = [...working].filter((s) => !STD.includes(s)).map((s) => `<span class="chip talg on" data-slug="${esc(s)}"${orderWide.has(s) ? ' data-orderwide="1"' : ""}>${esc(labelFor(s))}${owTag(s)}</span>`).join("");
    return std + cust;
  };
  const ov = document.createElement("div");
  ov.className = "dish-edit-overlay";
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  ov.innerHTML = `<div class="dish-edit-box" style="width:min(94vw,460px);max-height:90vh;overflow:auto;background:var(--panel);color:var(--text);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
    <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line)"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">Edit dish · ${esc(item.title)}</h3><button class="dish-edit-close" aria-label="Close" style="background:var(--panel-2);border:0;color:var(--text);border-radius:8px;padding:6px 10px;cursor:pointer">✕</button></div>
    <div style="padding:16px 18px">
      ${item.status === "served" ? `<div class="muted" style="font-size:13px;line-height:1.5;margin:0 0 12px;padding:9px 11px;border:1px solid var(--line);border-radius:9px">This dish is already <b style="color:#4ade80">served</b> — allergens &amp; note are locked now. If it went out by mistake, use <b>↩ Send back to kitchen</b> below.</div>` : ""}
      <div style="font-size:13px;font-weight:700;margin:0 0 8px">⚠ Allergies to avoid <span class="muted small">— tap to add or remove</span></div>
      <div class="dish-alg-list" style="display:flex;flex-wrap:wrap;gap:8px"></div>
      <div style="display:flex;gap:8px;margin-top:10px"><input type="text" class="dish-edit-custominput" maxlength="24" placeholder="Type a custom allergen — e.g. water" style="flex:1;min-width:0;padding:9px 11px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px"><button class="btn small dish-edit-customadd">Add</button></div>
      <div style="font-size:13px;font-weight:700;margin:15px 0 6px">✎ Note for the kitchen</div>
      <textarea class="dish-edit-note" rows="2" maxlength="200" placeholder="e.g. less ice, extra chocolate" style="width:100%;box-sizing:border-box;padding:9px 11px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;resize:vertical"></textarea>
    </div>
    <div style="display:flex;gap:10px;align-items:center;padding:14px 18px;border-top:1px solid var(--line)">${(item.status === "served") ? `<button class="btn dish-edit-unserve" style="margin-right:auto;border-color:#7f5f1d;color:#f0b232" title="Mark this dish not-served so the kitchen can remake/re-serve it">↩ Send back to kitchen</button>` : ""}<button class="btn dish-edit-cancel"${(item.status === "served") ? "" : ' style="margin-left:auto"'}>Cancel</button>${(item.status === "served") ? `<button class="btn primary dish-edit-save" disabled title="Already served — allergens & note are locked; use Send back to kitchen">Save</button>` : `<button class="btn primary dish-edit-save">Save</button>`}</div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector(".dish-edit-note").value = item.note || "";
  const listEl = ov.querySelector(".dish-alg-list");
  const input = ov.querySelector(".dish-edit-custominput");
  const bindChips = () => listEl.querySelectorAll("[data-slug]").forEach((c) => (c.onclick = async () => {
    const s = c.dataset.slug;
    if (working.has(s)) {
      // #4: turning OFF an order-wide avoid clears it from EVERY dish — confirm first.
      if (orderWide.has(s) && !(await confirmDialog(`"${s}" is set for the WHOLE order. Removing it here takes it off EVERY dish on this order, not just this one. Remove it from all?`, "Remove from all"))) return;
      working.delete(s);
    } else working.add(s);
    redraw();
  }));
  const redraw = () => { listEl.innerHTML = chipsHtml(); bindChips(); };
  redraw();
  const addCustom = () => { const v = norm(input.value); if (v) working.add(v); input.value = ""; redraw(); input.focus(); };
  ov.querySelector(".dish-edit-customadd").onclick = addCustom;
  input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } };
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
  setTimeout(() => input.focus(), 30);
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
    const load = dishN
      ? `<div class="ord"><div class="ordh"><span class="left"><span class="skel skel-kot"></span><span class="when" style="display:flex;align-items:center;gap:7px"><span class="tsl-dot"></span> syncing…</span></span></div>${[52, 38, 61, 45].slice(0, Math.min(4, dishN)).map(skelRow).join("")}</div>`
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
        <div class="sec"><h3>Orders</h3>${unsentBox}${pills}${load}</div>
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
        ? `<span class="iedit"><button class="qbtn" data-qty-dec="${esc(r.id)}" data-qty="${r.qty}" title="Fewer">−</button><button class="qbtn" data-qty-inc="${esc(r.id)}" data-qty="${r.qty}" title="More">＋</button><button class="qbtn" data-edit-dish="${esc(r.id)}" title="Edit allergens & note for this dish">✎ Edit</button></span>`
      : "";
    // The trailing status/serve/edit/delete cluster is ONE .iacts container so narrow
    // phones can wrap it to its own right-aligned second row (the name + price keep the
    // first row) instead of crushing the dish name to a sliver (A36 audit 2026-07-20).
    return `<div class="iline${editing ? " editing" : ""}"><span class="iqty">${r.qty}×</span><span class="inm">${esc(r.title)}${remMark}${opt}${rem}${note}</span>${priceTag}<span class="iacts">${statusBadge}${serveBtn}${editCtl}${delBtn}</span></div>`;
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
  const billDiscLbl = discPct(preTax(os.filter((o) => o.status !== "cancelled").reduce((a2, o) => a2 + (Number(o.total) || 0), 0)), s && s.discount);

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
      <div style="flex:1"><h2 style="margin:0;font-size:19px">${esc(tableLabel(t))}</h2><div class="pmeta">${mergeGroupLabel(t) ? `<span class="tmerge">⇄ one party · ${esc(mergeGroupLabel(t))}</span> · ` : ""}${s ? `${a.guests ? `${a.guests} guest${a.guests > 1 ? "s" : ""} · ` : ""}${os.length ? `bill #${esc(a.billNo ?? "—")}` : "no bill yet"} · <span class="live">● open</span>` : `<span class="off">closed</span>`}${unsentMeta}</div></div>
      ${stepBtns}
    </div>
    ${headOps ? `<div class="phead-ops">${headOps}</div>` : ""}
    <div class="detail-body">
      ${reqRows ? `<div class="sec"><h3>Requests</h3>${reqRows}</div>` : ""}
      ${joinRows ? `<div class="sec"><h3>Waiting to join</h3>${joinRows}</div>` : ""}
      ${callRows ? `<div class="sec"><h3>Calls</h3>${calls.length > 1 ? `<button class="btn small primary" data-attend-all-calls="${esc(t)}">Attend all (${calls.length})</button>` : ""}${callRows}</div>` : ""}
      ${s ? `<div class="sec"><h3>Party</h3>${partyRows || `<div class="muted small">No guests joined yet.</div>`}</div>` : ""}
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
      ${s && os.length && a.unpaid && tshow("tablet_mark_paid") ? `<button class="btn pay${txray("tablet_mark_paid")}" id="payBill"${os.some((o) => o.status === "received") ? ' disabled title="Accept the order first — the bill can only be paid once accepted."' : ""}>💳 Mark bill paid</button>` : ""}
      ${s && os.length && a.paid && tshow("tablet_mark_paid") ? `<button class="btn${txray("tablet_mark_paid")}" id="unpayBill" title="Reopen this paid bill (a refund/correction — asks for a reason)">↩ Mark unpaid</button>` : ""}
      ${s ? `<button class="btn danger" id="closeTable">✕ Close table</button>` : ""}
    </div>
    ${foot}
   </div>`;
  { const dc = $("#detailClose"); if (dc) dc.onclick = () => { state.table = null; renderPanel(); renderFloor(); }; }
  // #10: backdrop tap closes the detail popup, consistent with every other tablet popup.
  p.onclick = (e) => { if (e.target === p) { state.table = null; renderPanel(); renderFloor(); } };
  // ‹ › step to the previous/next table WITHOUT closing the popup. selectTable() does the
  // rest (it fetches that table's slice and repaints), so this is the same one-tap open the
  // floor gives — just reachable from inside an open table.
  document.querySelectorAll("[data-step-table]").forEach((b) => (b.onclick = () => selectTable(b.dataset.stepTable)));

  // wire it up
  document.querySelectorAll("[data-req-approve]").forEach((b) => (b.onclick = () => act(() => api("POST", `/requests/${b.dataset.reqApprove}/resolve`, { status: "approved" }))));
  document.querySelectorAll("[data-req-deny]").forEach((b) => (b.onclick = () => act(() => api("POST", `/requests/${b.dataset.reqDeny}/resolve`, { status: "denied" }))));
  document.querySelectorAll("[data-attend]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.attend;
    const c = (state.data.calls || []).find((x) => x.id === id);
    try {
      const r = await api("POST", `/calls/${id}/attend`);
      if (isQueued(r)) { toast(OFFLINE_SAVED_MSG); return; }
      await load();
      // A mis-tapped "Done" silently drops a real guest call — offer a takeback (2026-07-22).
      if (window.LFH_UNDO) LFH_UNDO.show({
        message: "Call attended",
        sub: c ? `Table ${c.table_number} · ${c.note || "call"} — tap undo` : "Tap undo to put the call back",
        icon: "🔔",
        onUndo: () => api("POST", `/calls/${id}/reopen`).then(() => load()).catch((e) => { toast("Undo failed: " + errText(e), false); load(); }),
      });
    } catch (e) { toast("Failed: " + errText(e), false); }
  }));
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
  document.querySelectorAll("[data-attend-all-calls]").forEach((b) => (b.onclick = async () => {
    const tbl = b.dataset.attendAllCalls;
    const ids = callsOf(tbl).map((c) => c.id);
    if (!ids.length) return;
    try {
      for (const id of ids) await api("POST", `/calls/${id}/attend`);
      await load();
      if (window.LFH_UNDO) LFH_UNDO.show({
        message: `${ids.length} call${ids.length > 1 ? "s" : ""} attended`,
        sub: `Table ${tbl} · tap undo to put them back`,
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
  document.querySelectorAll("[data-qty-inc]").forEach((b) => (b.onclick = () => bumpItemQty(b.dataset.qtyInc, +1)));
  document.querySelectorAll("[data-qty-dec]").forEach((b) => (b.onclick = () => bumpItemQty(b.dataset.qtyDec, -1)));
  // "✎ Edit" one dish → the unified modal (allergens incl. custom + kitchen note),
  // IDENTICAL to the manager panel's openDishEditModal.
  document.querySelectorAll("[data-edit-dish]").forEach((b) => (b.onclick = () => openDishEditModal(b.dataset.editDish)));
  // Add a dish to THIS already-placed order: reuse the dish browser in add mode.
  document.querySelectorAll("[data-add-dish]").forEach((b) => (b.onclick = () => { state.ordering = true; state.viewOrder = false; state.addToOrderId = b.dataset.addDish; state.cat = ""; state.dishSearch = ""; state._omTop = 0; state._addedThisVisit = 0; renderPanel(); }));
  // Per-order allergen chips: toggle an allergen on/off for the whole order.
  document.querySelectorAll(".talg[data-alg]").forEach((chip) => (chip.onclick = () => {
    const id = chip.dataset.alg, slug = chip.dataset.slug;
    const o = (state.data.orders || []).find((x) => x.id === id);
    if (!o) return;
    const wasAllergies = Array.isArray(o.allergies) ? [...o.allergies] : []; // what the screen showed
    const cur = new Set(wasAllergies.map((x) => String(x).toLowerCase()));
    if (cur.has(slug)) cur.delete(slug); else cur.add(slug);
    o.allergies = [...cur];        // OPTIMISTIC: update local state now so any re-render reflects it
    chip.classList.toggle("on");   // INSTANT visual feedback — before this it only hit the server, so the tap felt dead ("allergy not clicking")
    act(() => api("POST", `/orders/${id}/allergies`, { allergies: [...cur] }, { expect: { table: "orders", id, fields: { allergies: wasAllergies } } }));
  }));
  const shb = $("#shiftTable"); if (shb && s) shb.onclick = () => renderShiftPicker(t, s);
  const mob = $("#moveOrderBtn"); if (mob && s) mob.onclick = () => renderMoveOrderPicker(t);   // was dead: renderMoveOrderPicker/Target existed but nothing opened them (fixed 2026-07-06)
  const kmb = $("#kotMenuBtn"); if (kmb && s) kmb.onclick = () => renderKotMenu(t, s);
  // Restart: clear this round's orders off the floor (they stay served+archived in
  // records) but keep the table OPEN for a fresh round. Mirrors the manager.
  const pb = $("#payBill"); if (pb) pb.onclick = () => payBillWithMethod(t, a);
  const ub = $("#unpayBill"); if (ub) ub.onclick = () => markBillUnpaid(t);
  const tgb = $("#tagTable"); if (tgb) tgb.onclick = () => openTagSheet(t);
  const gib = $("#genInvoiceBtn"); if (gib && s) gib.onclick = () => genInvoice(s.id);
  const bdb = $("#billDiscountBtn"); if (bdb && s) bdb.onclick = () => tabletBillDiscount(t);
  const clb = $("#closeTable"); if (clb && s) clb.onclick = () => closeTableAndFree(t);
  { const tob = $("#takeOrder"); if (tob) tob.onclick = () => { state.ordering = true; state.viewOrder = false; state.cart = []; state.allergies = ""; state.cat = ""; state.dishSearch = ""; state._omTop = 0; renderPanel(); }; }
  restoreScroll();   // #U2: keep the popup scroll across a live-update rebuild (same table)
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
  await ensurePartySlices(t, true);
  const s = sessionOf(t);
  if (!s) { toast("That table is already free.", false); await load(); renderFloor(); return; }
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
          sub: ord ? `Table ${ord.table_number} · tap undo to put it back` : "Tap undo to put it back",
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
function optimisticAccept(orderIds) {
  if (!orderIds.length) return;
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
          sub: o ? `Table ${o.table_number} · tap undo to unsend` : "Tap undo to unsend",
          icon: "✋",
          onUndo: () => undoServe(snap),
        });
      }
    })
    .catch((e) => { toast("Failed: " + errText(e), false); load(); });
}
function optimisticServeAll(orderIds) {
  if (!orderIds.length) return;
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
          sub: o ? `Table ${o.table_number} · ${snap.length} dish${snap.length > 1 ? "es" : ""}` : `${snap.length} dishes`,
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
function renderKotMenu(t, s) {
  const movable = ordersOf(t).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled");
  const row = (id, icon, label, sub, on) => `<button class="kotm-row" data-kotop="${id}" ${on ? "" : "disabled"}>
    <span class="kotm-ico">${icon}</span><span class="kotm-txt"><b>${label}</b><small>${sub}</small></span><span class="kotm-chev">›</span></button>`;
  let occupiedOthers = 0;
  // Count what the merge picker will actually OFFER (a joined table can't host a party), so the
  // row is never enabled onto an empty picker.
  for (let i = 1, n = tableCount(); i <= n; i++) if (String(i) !== String(t) && canHostAParty(i)) occupiedOthers++;
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
    (!!(state.data.settings || {}).split_bill_enabled
      ? row("split", "🍴", "Split the bill", "Collect one bill as several payments — equal, custom, or by dish", tshow("tablet_mark_paid") && movable.some((o) => o.status !== "received"))
      : "");
  const { dropLayer } = renderPickerShell(`Table ${esc(t)} — KOT &amp; table operations`, `<div class="pactions">${body}</div>`, "tablet-kot-menu", renderPanel);
  document.querySelectorAll("[data-kotop]").forEach((b) => (b.onclick = () => {
    dropLayer(); // drop this step's back layer before advancing (same rule as move-order's step 1)
    if (b.dataset.kotop === "shift" && s) renderShiftPicker(t, s);
    if (b.dataset.kotop === "merge" && s) renderMergePicker(t, s);
    if (b.dataset.kotop === "movekot") renderMoveOrderPicker(t);
    if (b.dataset.kotop === "moveitem") renderMoveItemPicker(t);
    if (b.dataset.kotop === "split") renderSplitSettle(t);
  }));
}

// SPLIT-SETTLE (mig 176) — collect ONE bill as several payment legs (equal / custom /
// by dish). Mirrors the manager's flow; the server re-computes the due and refuses
// shares that don't add up, and the ladder + tablet_mark_paid gates apply server-side.
function renderSplitSettle(t) {
  const payable = partyOrders(t).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled" && o.status !== "received"); // a merged party splits its WHOLE bill
  if (!payable.length) { toast("Nothing to split — accept the order first, or it's already paid.", false); return; }
  const rate = effRate();
  const due = Math.round(payable.reduce((s, o) => s + (Number(o.total) || 0) - (Number(o.discount) || 0) * (1 + rate), 0) * 100) / 100;
  const METHODS = ["UPI", "Cash", "Card", "Other"];
  let mode = "equal", n = 2;
  const dishes = [];
  payable.forEach((o) => dishRowsOf(o).forEach((r) => dishes.push({ title: r.title, amt: (Number(r.price) || 0) * (r.qty || 1), qty: r.qty || 1, person: 1 })));
  const dishSubtotal = dishes.reduce((s, d) => s + d.amt, 0) || 1;
  const bodyShell = `<div class="ss-tabs" style="display:flex;gap:6px;margin-bottom:10px">
      <button class="btn ss-tab" data-mode="equal">Equal</button><button class="btn ss-tab" data-mode="custom">Custom</button><button class="btn ss-tab" data-mode="dish">By dish</button>
    </div><div class="ss-body"></div><div class="ss-sum muted small" style="margin:10px 0 8px"></div>
    <button class="btn primary ss-go" style="width:100%">💳 Collect ${inr(due)} in parts</button>`;
  const { dropLayer } = renderPickerShell(`Split Table ${esc(t)}'s bill · ${inr(due)}`, bodyShell, "tablet-split-settle", renderPanel);
  const p = $("#panel");
  const bodyEl = p.querySelector(".ss-body"), sumEl = p.querySelector(".ss-sum");
  const methodSel = (i) => `<select class="ss-method" data-leg="${i}" style="padding:8px;border-radius:8px">${METHODS.map((m) => `<option${m === "Cash" ? " selected" : ""}>${m}</option>`).join("")}</select>`;
  const equalLegs = () => { const base = Math.floor((due / n) * 100) / 100; const legs = Array.from({ length: n }, () => base); legs[n - 1] = Math.round((due - base * (n - 1)) * 100) / 100; return legs; };
  const personAmounts = () => { const per = Array.from({ length: n }, () => 0); dishes.forEach((d) => { per[Math.min(d.person, n) - 1] += d.amt; }); const scaled = per.map((a) => Math.round((a / dishSubtotal) * due * 100) / 100); const drift = Math.round((due - scaled.reduce((s, x) => s + x, 0)) * 100) / 100; scaled[scaled.length - 1] = Math.round((scaled[scaled.length - 1] + drift) * 100) / 100; return scaled; };
  const legRow = (i, amount, editable) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span class="muted" style="min-width:60px">Person ${i + 1}</span><input type="number" step="0.01" min="0" class="ss-amt" data-leg="${i}" value="${amount.toFixed(2)}" ${editable ? "" : "readonly"} style="width:96px;padding:8px;border-radius:8px">${methodSel(i)}</div>`;
  const nStepper = () => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span class="muted small">Split between</span><button class="btn ss-n" data-d="-1">−</button><b>${n}</b><button class="btn ss-n" data-d="1">＋</button><span class="muted small">people</span></div>`;
  const refreshSum = () => {
    const s = [...bodyEl.querySelectorAll(".ss-amt")].reduce((a, x) => a + (Number(x.value) || 0), 0);
    const diff = Math.round((s - due) * 100) / 100;
    sumEl.textContent = diff === 0 ? `✓ Shares add up to ${inr(due)}` : `⚠️ Shares total ${inr(s)} — ${diff > 0 ? inr(diff) + " too much" : inr(-diff) + " short"}`;
  };
  const render = () => {
    p.querySelectorAll(".ss-tab").forEach((b) => b.classList.toggle("primary", b.dataset.mode === mode));
    if (mode === "equal") bodyEl.innerHTML = nStepper() + equalLegs().map((a, i) => legRow(i, a, false)).join("");
    else if (mode === "custom") bodyEl.innerHTML = nStepper() + equalLegs().map((a, i) => legRow(i, a, true)).join("");
    else bodyEl.innerHTML = nStepper() + `<div class="muted small" style="margin-bottom:6px">Tap a dish to hand it to the next person:</div>` +
      dishes.map((d, i) => `<button class="btn" data-dish="${i}" style="display:flex;justify-content:space-between;width:100%;margin-bottom:4px"><span>${d.qty > 1 ? d.qty + "× " : ""}${esc(d.title)}</span><span>P${d.person} · ${inr(d.amt)}</span></button>`).join("") +
      `<div style="margin-top:10px">${personAmounts().map((a, i) => legRow(i, a, false)).join("")}</div>`;
    bodyEl.querySelectorAll(".ss-n").forEach((b) => (b.onclick = () => { n = Math.max(2, Math.min(12, n + Number(b.dataset.d))); dishes.forEach((d) => { if (d.person > n) d.person = 1; }); render(); }));
    bodyEl.querySelectorAll("[data-dish]").forEach((b) => (b.onclick = () => { const d = dishes[Number(b.dataset.dish)]; d.person = d.person >= n ? 1 : d.person + 1; render(); }));
    bodyEl.querySelectorAll(".ss-amt").forEach((x) => (x.oninput = refreshSum));
    refreshSum();
  };
  p.querySelectorAll(".ss-tab").forEach((b) => (b.onclick = () => { mode = b.dataset.mode; render(); }));
  render();
  p.querySelector(".ss-go").onclick = () => {
    const splits = [...bodyEl.querySelectorAll(".ss-amt")].map((x) => ({ amount: Number(x.value) || 0, method: bodyEl.querySelector(`.ss-method[data-leg="${x.dataset.leg}"]`).value }));
    const s = splits.reduce((a, b2) => a + b2.amount, 0);
    if (Math.abs(s - due) > 0.011) { toast("The shares must add up to exactly " + inr(due), false); return; }
    if (splits.some((x) => !(x.amount > 0))) { toast("Every share needs an amount above zero.", false); return; }
    dropLayer();
    actGated("POST", `/tables/${t}/pay`, { splits }, {
      message: "Enter a manager PIN to split-settle this bill.",
      onSuccess: () => offerPayUndo(t, { message: `Paid in ${splits.length} parts` }),
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
  const bodyHtml = `<div class="muted small" style="margin-bottom:10px">Pick the dish to move off Table ${esc(t)} (a multi-plate line moves whole):</div><div class="pactions">${groups || `<div class="muted">No movable dishes.</div>`}</div>`;
  const { dropLayer } = renderPickerShell("Move a dish", bodyHtml, "tablet-moveitem-picker", renderPanel);
  document.querySelectorAll("[data-mvitem]").forEach((b) => (b.onclick = () => { dropLayer(); renderMoveItemTarget(t, b.dataset.mvitem); }));
}
function renderMoveItemTarget(t, itemId) {
  const tiles = [];
  for (let i = 1, n = tableCount(); i <= n; i++) {
    if (String(i) === String(t)) continue;
    const st2 = tileState(i);
    tiles.push(`<button class="kotm-tile${tileIsOpen(i) ? " occ" : ""}" data-mvto="${i}"><b>T${i}</b><small>${st2.label}</small></button>`);
  }
  const bodyHtml = `<div class="muted small" style="margin-bottom:10px">Send this dish to which table? (it gets its own new KOT there)</div><div class="kotm-grid">${tiles.join("")}</div>`;
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
  const bodyHtml = `<div class="muted small" style="margin-bottom:10px">Everything — orders, guests &amp; bill — joins the other table as ONE bill. Table ${esc(t)} then frees up:</div><div class="shiftgrid">${btns}</div>`;
  const { dropLayer } = renderPickerShell(`Merge Table ${esc(t)} into →`, bodyHtml, "tablet-merge-picker", renderPanel);
  document.querySelectorAll("[data-mergeto]").forEach((b) => (b.onclick = async () => {
    const to = b.dataset.mergeto;
    if (!(await confirmDialog(`Merge Table ${t} into Table ${to}? Both parties become ONE bill on Table ${to}.`, "Merge"))) return;
    dropLayer();
    actGated("POST", `/sessions/${s.id}/merge`, { to }, {
      message: "Enter a manager PIN to merge these tables.",
      onSuccess: () => { state.table = String(to); toast(`Merged into table ${to} — one bill`); renderFloor(); renderPanel(); },
    });
  }));
}

function renderShiftPicker(t, s) {
  const n = tableCount();
  const free = [];
  // FREE = not open, read from the summary (tileIsOpen) — works for every tile, not just the
  // selected one whose slice is cached. (Two-tier: the grid no longer holds every table's session.)
  for (let i = 1; i <= n; i++) { if (String(i) !== String(t) && inMySection(i) && !tileIsOpen(i)) free.push(i); }
  const btns = free.length
    ? free.map((i) => `<button class="btn shiftpick" data-shiftto="${i}">Table ${i}</button>`).join("")
    : `<div class="muted">No free tables to shift to.</div>`;
  const body = `<div class="muted small" style="margin-bottom:10px">Move this party — orders &amp; calls included — to a free table:</div><div class="shiftgrid">${btns}</div>`;
  const { dropLayer } = renderPickerShell(`Move Table ${esc(t)} →`, body, "tablet-shift-picker", renderPanel);
  document.querySelectorAll("[data-shiftto]").forEach((b) => (b.onclick = () => {
    const to = b.dataset.shiftto;
    dropLayer();
    runOptimistic(
      () => { if (s) s.table_number = to; state.data.orders.forEach((o) => { if (String(o.table_number) === String(t)) o.table_number = to; }); state.table = to; },
      () => api("POST", `/sessions/${s.id}/shift`, { to }),
    );
  }));
}

// Move a SINGLE order to another table's bill. Two taps: pick the order, pick the
// target table. PAID / cancelled orders are excluded — settled revenue can't be re-homed.
function renderMoveOrderPicker(t) {
  const os = ordersOf(t).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled");
  // Show each order's NET due (total − discount, discount before tax), not the gross total,
  // so it reads like every other money view on the panel. (audit 2026-07-08)
  const netDue = (o) => Math.max(0, (Number(o.total) || 0) - (Number(o.discount) || 0) * (1 + effRate()));
  const list = os.map((o, i) => `<button class="btn" style="text-align:left" data-pickorder="${esc(o.id)}">#${esc(o.kot_no ?? "—")} · Order ${i + 1} · ${inr(netDue(o))}</button>`).join("");
  const body = `<div class="muted small" style="margin-bottom:10px">Pick the order to move off Table ${esc(t)}:</div><div class="pactions">${list || `<div class="muted">No movable orders (paid bills can't be moved).</div>`}</div>`;
  const { dropLayer } = renderPickerShell("Move an order", body, "tablet-move-picker", renderPanel);
  // Drop THIS step's back-stack layer before advancing to the target step — otherwise the
  // step-1 layer leaks and the phone Back button needs one extra press afterwards. (audit 2026-07-08)
  document.querySelectorAll("[data-pickorder]").forEach((b) => (b.onclick = () => { dropLayer(); renderMoveOrderTarget(t, b.dataset.pickorder); }));
}
function renderMoveOrderTarget(t, orderId) {
  const n = tableCount();
  const tiles = [];
  for (let i = 1; i <= n; i++) {
    if (String(i) === String(t) || !inMySection(i)) continue;  // sections: only my own tables
    const st = tileState(i);
    tiles.push(`<button class="btn shiftpick" data-moveto="${i}">Table ${i}<br><span class="muted small">${st.label}</span></button>`);
  }
  const body = `<div class="muted small" style="margin-bottom:10px">Send this order to which table's bill?</div><div class="shiftgrid">${tiles.length ? tiles.join("") : `<div class="muted">No other table in your section to move this to.</div>`}</div>`;
  const { dropLayer } = renderPickerShell("Move order →", body, "tablet-move-target", () => renderMoveOrderPicker(t));
  document.querySelectorAll("[data-moveto]").forEach((b) => (b.onclick = () => {
    const to = b.dataset.moveto;
    dropLayer();
    runOptimistic(
      () => { const o = state.data.orders.find((x) => x.id === orderId); if (o) o.table_number = to; },
      () => api("POST", `/orders/${orderId}/move`, { to }),
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
    if (isQueued(r)) { toast(OFFLINE_SAVED_MSG); return; }  // #2: saved offline — not a failure, and load() would no-op
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
    if (isQueued(r)) { toast(OFFLINE_SAVED_MSG); return; }  // #2: offline queue — friendly note, skip the offline GET
    await load();
  } catch (e) {
    // Someone else changed the same thing first: say so plainly and refresh, rather than
    // "Failed: clash_changed_elsewhere".
    const clash = e && e.data && e.data.clash;
    if (clash) { toast(clash.plain, false, 9000); load().catch(() => {}); return; }
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
  if (!it) return;
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
      toast(clash ? clash.plain : "Failed: " + e.message, false, clash ? 9000 : undefined);
      load().catch(() => {});
    });
  clearTimeout(qtyReconcileTimer);
  qtyReconcileTimer = setTimeout(() => load().catch(() => {}), 700);
}

// ensureTableSlice(t): make sure table t's FULL slice (sessions/orders/items/calls/…) is in the
// local cache before a tile QUICK-ACTION on a NON-selected table runs. The grid renders from the
// slim summary, so an unselected table has NO order rows cached — and Accept/Mark-paid need them
// (the ids to act on, the due/billNo to confirm). Mirrors the editor's ensureTableSlice. The
// SELECTED table's slice is already kept fresh by load(); best-effort (a fetch blip just no-ops).
async function ensureTableSlice(t, force) {
  // Already have this table's rows cached (orders OR an open session)? Nothing to fetch —
  // UNLESS `force` (bug M10, 2026-07-05): when OPENING a table's detail we must always
  // re-pull its slice, because a live update to a DIFFERENT table only refreshes the
  // selected table's slice, so a previously-viewed table's cached rows can be up to 60s
  // stale. selectTable passes force=true so re-opening a table never shows stale detail.
  if (!force && ((state.data.orders || []).some((o) => String(o.table_number) === String(t))
      || (state.data.sessions || []).some((s) => String(s.table_number) === String(t)))) return;
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
// A merged party spans SEVERAL tables' slices — any whole-party read or action must have them
// all cached, or partyOrders() silently sees half the bill. Forced on purpose, same reasoning
// as the manager's ensurePartySlices: a whole-party action can fire the instant a detail opens.
async function ensurePartySlices(t, force = true) {
  await Promise.all(partyTablesOf(t).map((x) => ensureTableSlice(x, force).catch(() => {})));
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
  if (!reason) { toast("Cancelled — a reason is required.", false); return; }
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
      sub: `Table ${t} · tap undo to reopen the bill`,
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
    Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
    ov.innerHTML = `<div class="pay-box" style="width:min(94vw,420px);max-height:90vh;overflow:auto;background:var(--panel);color:var(--text);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
      <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line)"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">${esc(label)}</h3><button class="pay-close" aria-label="Close" style="background:var(--panel-2);border:0;color:var(--text);border-radius:8px;padding:6px 10px;cursor:pointer">✕</button></div>
      <div style="padding:16px 18px">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px;color:var(--muted);margin-bottom:12px"><span>Amount collected</span><b style="color:var(--text);font-size:15px">${inr(due)}</b></div>
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
          <div class="pay-other-pick" style="display:flex;flex-direction:column;gap:8px">
            <button type="button" class="btn pay-other-choice" data-oc="write" style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;padding:12px 14px;border-radius:12px;line-height:1.35"><b style="font-size:14px">✎ Another way to pay</b><small style="font-size:11.5px;color:var(--muted);font-weight:400">Wallet, bank transfer, cheque — type what it was</small></button>
            ${opts.split ? `<button type="button" class="btn pay-other-choice" data-oc="split" style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;padding:12px 14px;border-radius:12px;line-height:1.35"><b style="font-size:14px">⇄ Split the payment</b><small style="font-size:11.5px;color:var(--muted);font-weight:400">Part one way, part another — ₹200 UPI, ₹200 cash, and so on</small></button>` : ""}
          </div>
          <div class="pay-other-write" style="display:none">
            <div style="font-size:13px;font-weight:700;margin:0 0 8px">What kind?</div>
            <input type="text" class="pay-other-input" maxlength="60" placeholder="e.g. wallet, bank transfer" style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;margin-bottom:10px">
            <button type="button" class="btn primary pay-other-confirm" style="width:100%">Confirm</button>
          </div>
          <div class="pay-other-split" style="display:none">
            <div style="font-size:13px;font-weight:700;margin:0 0 3px">How much came in each way?</div>
            <div style="font-size:11.5px;color:var(--muted);margin:0 0 10px">Add a part for every way they paid. The parts have to add up to ${inr(due)}.</div>
            <div class="pay-split-rows"></div>
            <button type="button" class="btn pay-split-add" style="width:100%;margin-top:2px">＋ Add another part</button>
            <div class="pay-split-sum" style="margin:9px 0 8px;font-size:12.5px;font-weight:700"></div>
            <button type="button" class="btn primary pay-split-go" style="width:100%">Take payment</button>
          </div>
        </div>
        ${opts.crm === false ? "" : `
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
        </div>`}
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
    const finish = (method, note) => { resolved = true; const cust = readCust(); close(); resolve({ method, note, cust }); };
    const cancel = () => { close(); if (!resolved) resolve(null); };
    ov.querySelector(".pay-close").onclick = cancel;
    ov.querySelector(".pay-cancel-btn").onclick = cancel;
    ov.onclick = (e) => { if (e.target === ov) cancel(); };
    ov.querySelectorAll(".pay-method-btn").forEach((b) => (b.onclick = () => {
      // The two special settles (mig 166): resolve with a marker — the CALLER runs the
      // dedicated flow (person picker / no-charge settle); no payment method involved.
      if (b.dataset.special) { resolved = true; close(); resolve({ special: b.dataset.special }); return; }
      const m = b.dataset.method;
      if (m === "Other") {
        ov.querySelector(".pay-other-field").style.display = "";
        ov.querySelector(".pay-other-input").focus();
        return;
      }
      finish(m, null);
    }));
    // "Other" opens a choice of TWO things (owner, 2026-08-02): type another way to pay, or
    // SPLIT the bill across ways — "₹200 from this, ₹200 from that". Split is offered only
    // when the caller can post it (opts.split = a whole table's bill).
    ov.querySelectorAll(".pay-other-choice").forEach((b) => (b.onclick = () => {
      ov.querySelector(".pay-other-pick").style.display = "none";
      if (b.dataset.oc === "write") { ov.querySelector(".pay-other-write").style.display = ""; ov.querySelector(".pay-other-input").focus(); }
      else { ov.querySelector(".pay-other-split").style.display = ""; renderSplit(); }
    }));
    const otherInput = ov.querySelector(".pay-other-input");
    const confirmOther = () => finish("Other", otherInput.value.trim());
    ov.querySelector(".pay-other-confirm").onclick = confirmOther;
    otherInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); confirmOther(); } };

    // ── Split across ways to pay ────────────────────────────────────────────────────
    // The parts must add up to the bill EXACTLY — the server recomputes the due and refuses
    // anything else (lib/paySplit.ts), so this can neither under- nor over-collect.
    const legs = [{ amount: "", method: "UPI", note: "" }, { amount: "", method: "Cash", note: "" }];
    const legSum = () => Math.round(legs.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100;
    const legLeft = () => Math.round((due - legSum()) * 100) / 100;
    const rowsEl = ov.querySelector(".pay-split-rows");
    const sumEl = ov.querySelector(".pay-split-sum");
    const inpCss = "box-sizing:border-box;padding:10px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px";
    function renderSplit() {
      if (!rowsEl) return;
      rowsEl.innerHTML = legs.map((l, i) => `<div class="pay-split-row" data-i="${i}" style="display:grid;grid-template-columns:1fr auto 30px;gap:8px;align-items:center;margin-bottom:8px">
          <input type="number" inputmode="decimal" min="0" step="1" class="psr-amt" value="${l.amount}" placeholder="₹ amount" style="${inpCss};width:100%">
          <select class="psr-method" style="${inpCss};font-weight:600">${["UPI", "Cash", "Card", "Other"].map((m) => `<option${m === l.method ? " selected" : ""}>${m}</option>`).join("")}</select>
          ${legs.length > 2 ? `<button type="button" class="psr-del" aria-label="Remove this part" style="width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--muted);font-size:13px;cursor:pointer">✕</button>` : `<span></span>`}
          ${l.method === "Other" ? `<input type="text" class="psr-note" maxlength="60" value="${esc(l.note || "")}" placeholder="What kind? e.g. wallet, cheque" style="${inpCss};grid-column:1 / -1;width:100%">` : ""}
        </div>`).join("");
      rowsEl.querySelectorAll(".pay-split-row").forEach((row) => {
        const i = Number(row.dataset.i);
        row.querySelector(".psr-amt").oninput = (e) => { legs[i].amount = e.target.value; refreshSplitSum(); };
        row.querySelector(".psr-method").onchange = (e) => { legs[i].method = e.target.value; renderSplit(); };
        const nEl = row.querySelector(".psr-note"); if (nEl) nEl.oninput = (e) => { legs[i].note = e.target.value; };
        const dEl = row.querySelector(".psr-del"); if (dEl) dEl.onclick = () => { legs.splice(i, 1); renderSplit(); };
      });
      refreshSplitSum();
    }
    function refreshSplitSum() {
      if (!sumEl) return;
      const left = legLeft();
      sumEl.textContent = left === 0 ? `✓ The parts add up to ${inr(due)}`
        : left > 0 ? `${inr(left)} still to cover` : `${inr(-left)} more than the bill`;
      sumEl.style.color = left === 0 ? "#16a34a" : "#e11d48";
    }
    const addBtn = ov.querySelector(".pay-split-add");
    if (addBtn) addBtn.onclick = () => {
      if (legs.length >= 12) { toast("A bill can be split into at most 12 parts."); return; }
      const left = legLeft();
      legs.push({ amount: left > 0 ? String(left) : "", method: "Cash", note: "" });
      renderSplit();
    };
    const goBtn = ov.querySelector(".pay-split-go");
    // Stays ENABLED and says WHY it won't go — a disabled button that swallows the tap is
    // indistinguishable from a broken one (owner rule: never drop a tap in silence).
    if (goBtn) goBtn.onclick = () => {
      const left = legLeft();
      if (legs.some((l) => !(Number(l.amount) > 0))) { toast("Every part needs an amount above zero — remove the empty one."); return; }
      if (left !== 0) { toast(left > 0 ? `${inr(left)} of the bill is still uncovered.` : `The parts are ${inr(-left)} more than the bill.`); return; }
      if (legs.length < 2) { toast("A split needs at least two parts."); return; }
      resolved = true;
      const cust = readCust();
      close();
      resolve({
        method: "Split", note: null, cust,
        splitLegs: legs.map((l) => ({ amount: Math.round(Number(l.amount) * 100) / 100, method: l.method, note: (l.note || "").trim().slice(0, 200) || null })),
      });
    };

    // Repeat-customer recognition: as the waiter types a known number, show a chip and
    // pre-fill the name. Read-only lookup (stores nothing); debounced to one call.
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
    // A whole table's bill can be collected in parts (Other → Split the payment).
    split: true,
  };
  const picked = await openPaymentMethodModal(a.due, `Mark bill ${a.billNo ? `#${a.billNo} ` : ""}paid for table ${t}`, opts);
  if (!picked) return;
  // Paid in PARTS — one server call settles the whole bill and records each part
  // (owner, 2026-08-02). actGated covers both modes: straight through when the waiter's
  // mark-paid is 'on', and the manager-PIN round-trip when it's 'pin'.
  if (picked.splitLegs) {
    const how = picked.splitLegs.map((l) => `${inr(l.amount)} ${l.method}`).join(" + ");
    await actGated("POST", `/tables/${t}/pay-split`, { splits: picked.splitLegs },
      { message: "Enter a manager PIN to mark this bill paid.", onSuccess: () => offerPayUndo(t, { message: `Bill paid in ${picked.splitLegs.length} parts — ${how}` }) });
    if (picked.cust) captureCustomer(t, picked.cust);
    return;
  }
  if (picked.special === "onhouse") {
    // actGated handles BOTH modes: direct when 'on', and the PIN round-trip when the
    // server answers "manager pin" ('pin' mode) — same as every other gated action.
    actGated("POST", `/tables/${t}/on-the-house`, {}, { message: "Enter a manager PIN to settle this bill on the house.", onSuccess: () => offerPayUndo(t, { message: "On the house — settled free", icon: "🏠" }) });
    return;
  }
  if (picked.special === "khata") { await tabletKhataFlow(t, a.due); return; }
  payBill(t, picked.method, picked.note);
  if (picked.cust) captureCustomer(t, picked.cust);
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
    Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
    const inputCss = "width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px";
    ov.innerHTML = `<div style="width:min(94vw,420px);max-height:90vh;overflow:auto;background:var(--panel);color:var(--text);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
      <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line)"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">Pay Later — who's this bill on?</h3><button class="kp-close" aria-label="Close" style="background:var(--panel-2);border:0;color:var(--text);border-radius:8px;padding:6px 10px;cursor:pointer">✕</button></div>
      <div style="padding:16px 18px">
        <div style="display:flex;justify-content:space-between;font-size:13.5px;color:var(--muted);margin-bottom:10px"><span>Table ${esc(t)} bill</span><b style="color:var(--text)">${inr(due)}</b></div>
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
      if (pickedId) { resolved = true; close(); resolve({ customer_id: pickedId }); return; }
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
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
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
          if (!/manager pin/i.test(String(e && e.message))) throw e;
          let pin = await pinPrompt("Enter a manager PIN to mark this table.");
          let okd = false;
          while (pin) {
            try { await api("POST", `/tables/${t}/tag`, { tag, managerPin: pin }); okd = true; break; }
            catch (e2) {
              if (/manager pin/i.test(String(e2 && e2.message))) { pin = await pinPrompt("Enter a manager PIN to mark this table.", "That PIN didn't match — try again."); continue; }
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
  const base = Math.max(0, round2(total / (1 + rate)));
  const maxDisc = base; // can't discount more than the food's pre-tax value
  const payFor = (d) => round2(Math.max(0, base - clamp(d, 0, base)) * (1 + rate));
  let payVal = payFor(current);
  let pctVal = base > 0 ? Math.round((clamp(current, 0, base) / base) * 1000) / 10 : 0;
  const fieldCss = "width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:17px;font-weight:700";
  const lblCss = "font-size:13px;font-weight:700;margin:0 0 8px";

  const ov = document.createElement("div");
  ov.className = "disc-overlay";
  Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
  ov.innerHTML = `<div class="disc-box" style="width:min(94vw,420px);max-height:90vh;overflow:auto;background:var(--panel);color:var(--text);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
    <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line)"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">${opts.bill ? "Discount whole bill" : "Apply discount"}</h3><button class="disc-close" aria-label="Close" style="background:var(--panel-2);border:0;color:var(--text);border-radius:8px;padding:6px 10px;cursor:pointer">✕</button></div>
    <div style="padding:16px 18px">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px;color:var(--muted);margin-bottom:12px"><span>Bill total</span><b style="color:var(--text);font-size:15px">${inr(total)}</b></div>
      <div style="display:flex;align-items:flex-end;gap:10px">
        <div style="flex:1">
          <div style="${lblCss}">Discount %</div>
          <input type="number" inputmode="decimal" min="0" max="100" step="1" class="disc-pct-input" placeholder="0" style="${fieldCss}">
        </div>
        <div style="padding-bottom:12px;color:var(--muted);font-weight:800;font-size:16px">=</div>
        <div style="flex:1">
          <div style="${lblCss}">Discount amount (₹)</div>
          <input type="number" inputmode="decimal" min="0" step="1" class="disc-amt-input" placeholder="0" style="${fieldCss}">
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">${[0, 5, 10, 15, 20, 25, 50].map((p) => `<span class="chip disc-pct-pick" data-pct="${p}">${p ? p + "%" : "None"}</span>`).join("")}</div>
      <div style="margin-top:16px;padding:12px 14px;border-radius:12px;background:var(--bg);border:1px solid var(--line);display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;font-size:13.5px;color:var(--muted)"><span>Discount</span><b class="disc-prev-amt" style="color:var(--text)">− ${inr(current)}</b></div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:14.5px;padding-top:6px;margin-top:2px;border-top:1px dashed var(--line)">
          <span style="color:var(--gold-strong);font-weight:800">They pay</span>
          <label style="display:inline-flex;align-items:center;gap:1px;cursor:text;border:1px solid var(--line);border-radius:9px;padding:3px 8px 3px 9px;background:var(--panel)" title="Type what the customer will actually pay — the discount works itself out">
            <span style="color:var(--gold-strong);font-weight:800;font-size:15px">₹</span>
            <input type="number" inputmode="decimal" min="0" step="1" class="disc-pay-input" aria-label="Amount they pay" style="width:7ch;border:0;background:transparent;padding:0;margin:0;text-align:right;color:var(--gold-strong);font-weight:800;font-size:15px;font-family:inherit;font-variant-numeric:tabular-nums;outline:none">
          </label>
        </div>
      </div>
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
  paint();

  ov.querySelectorAll(".disc-pct-pick").forEach((c) => (c.onclick = () => { discAmount = round2((base * Number(c.dataset.pct)) / 100); setBlank(false); paint(); }));
  pctInput.oninput = () => {
    const raw = pctInput.value.trim();
    const p = parseFloat(raw);
    if (raw === "" || !(p >= 0)) { setBlank(true); return; }
    setBlank(false); discAmount = round2((base * clamp(p, 0, 100)) / 100); paint("pct");
  };
  amtInput.oninput = () => {
    const raw = amtInput.value.trim();
    const a = parseFloat(raw);
    if (raw === "" || !(a >= 0)) { setBlank(true); return; }
    setBlank(false); discAmount = clamp(a, 0, maxDisc); paint("amt");
  };
  payInput.oninput = () => {
    const raw = payInput.value.trim();
    const p = parseFloat(raw);
    if (raw === "" || !(p >= 0)) { setBlank(true); return; }
    setBlank(false);
    // "They pay P" (tax-incl) → discount d = base − P/(1+rate), clamped to the food base.
    discAmount = clamp(round2(base - clamp(p, 0, payFor(0)) / (1 + rate)), 0, maxDisc);
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
  const billTotal = partyOrders(t).filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + (Number(o.total) || 0), 0); // whole bill, gross — the whole PARTY's
  openDiscountModal({ id: s.id, table_number: t, total: billTotal, discount: Number(s.discount) || 0, discount_note: s.discount_note || "" }, { bill: true });
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
  return `<button class="dish ${out ? "out" : ""} ${inCartQty ? "in" : ""}" data-dish="${esc(d.id)}" ${out ? "disabled" : ""}>
    ${out ? "" : `<span class="dedit" data-dishedit="${esc(d.id)}" role="button" aria-label="Quantity / allergy" title="Set quantity or allergy">✎</span>`}
    <span class="dname">${esc(d.title)}</span>
    <span class="drow">
      <span class="dprice">${out ? "SOLD OUT" : (d.open_price ? "Set price" : inr(dishPrice(d)))}</span>
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
    if (!d) return;
    const out = (d.tags || []).includes("sold-out");
    btn.classList.toggle("out", out);
    btn.disabled = out;
    const priceEl = btn.querySelector(".dprice");
    if (priceEl) priceEl.textContent = out ? "SOLD OUT" : inr(dishPrice(d));
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
  let idx = state.cart.findIndex((l) => l.id === id && !l.options && !l.allergy && !l.note);
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
    if (!d) return;
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
    const line = state.cart.find((l) => l.id === d.id && !l.options && !l.allergy && !l.note);
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
  state._opt = { d, sel, editIndex, allergy: (line && line.allergy) || "", qty: (line && line.qty) || 1 };
  if (window.LFH_BACK && !optBackOff) optBackOff = LFH_BACK.layer("tablet-optpopup", closeDishOptions);
  drawDishOptions();
}
function closeDishOptions() {
  const ov = document.getElementById("optOverlay"); if (ov) ov.remove();
  state._opt = null;
  if (optBackOff) { optBackOff(); optBackOff = null; }
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
        <div class="optgroup"><h4>✎ Note / allergy <span class="muted small">· kitchen sees exactly what you type</span></h4>
          <input type="text" id="optAllergy" class="note allergy" placeholder="e.g. no nuts, less ice" value="${esc(state._opt.allergy || "")}"></div>
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
  const al = ov.querySelector("#optAllergy"); if (al) al.oninput = (e) => (state._opt.allergy = e.target.value);
  ov.querySelector("#optMinus").onclick = () => { state._opt.qty = Math.max(1, qty - 1); drawDishOptions(); };
  ov.querySelector("#optPlus").onclick = () => { state._opt.qty = Math.min(99, qty + 1); drawDishOptions(); };
  ov.querySelector("#optClose").onclick = closeDishOptions;
  ov.querySelector("#optAdd").onclick = () => {
    const opts = [];
    for (const g of (d.options || [])) for (const c of (g.choices || [])) {
      if ((sel[g.name] || []).includes(c.label)) opts.push({ group: g.name, label: c.label, price: Number(c.price) || 0 });
    }
    const unitPrice = base + opts.reduce((s, o) => s + o.price, 0);
    const allergy = (state._opt.allergy || "").trim();
    const useQty = Math.max(1, state._opt.qty || 1);
    // ADD-TO-EXISTING-ORDER mode: send straight to the order's add-item endpoint.
    // The ✎ box travels as a VERBATIM note (kitchen sees exactly what was typed) —
    // it used to become removed[], which force-prefixed "NO" onto every entry.
    if (state.addToOrderId) {
      addDishToOrder(state.addToOrderId, { dishId: d.id, qty: useQty, options: opts.length ? opts.map((o) => ({ group: o.group, label: o.label })) : undefined, note: allergy || undefined });
      closeDishOptions();
      return;
    }
    const line = { id: d.id, title: d.title, price: unitPrice, qty: useQty, options: opts.length ? opts : undefined,
      allergy: allergy || undefined };
    if (editIndex != null && state.cart[editIndex]) state.cart[editIndex] = line;
    else state.cart.push(line);
    closeDishOptions();
    // Patch in place — no full re-render, so the browse scroll + the view-order stay put.
    updateDishBadges(); updateOrderCart(); updateViewPill();
  };
}

// The "This order" pane — kept EXACTLY as before (owner 2026-07-03: "this order thing is
// perfect right now"), it just lives in its own scroll region now instead of under the grid.
function orderCartHtml() {
  const lines = state.cart.map((l, i) => `<div class="cline">
      <span class="cname">${esc(l.title)}${l.options && l.options.length ? `<small class="copts">${esc(l.options.map((o) => o.label).join(", "))}</small>` : ""}${l.allergy ? `<small class="callergy">✎ ${esc(l.allergy)}</small>` : ""}${l.note ? `<small class="copts">✎ ${esc(l.note)}</small>` : ""}</span>
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
      <input type="text" id="orderAllergy" class="note allergy" placeholder="⚠ Avoid in ALL dishes — e.g. nuts, dairy" value="${esc(state.allergies || "")}">
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
    if (!d) return;
    // Open-price line: ✎ re-asks the price (there are no size/extras to pick), instead of the
    // options popup — which would have no groups and reset this line's price to 0.
    if (l.open_price || d.open_price) {
      const p = await pricePrompt(d.title, l.price);
      if (p != null) { l.price = p; updateOrderCart(); updateViewPill(); }
      return;
    }
    renderDishOptions(d, +b.dataset.edit);
  }));
  // ONE box, ALLERGY-only (owner, 2026-07-06). Its text is the whole-order avoid list
  // applied to every dish ("no X" on each line + "⚠ AVOID" on the KOT) — so it must NOT
  // be used for free-text notes (a note like "birthday cake" would read as "no birthday
  // cake"). The label is worded allergen-only to steer waiters away from notes; per-dish
  // notes go through the ✎ Edit modal instead.
  const al = c.querySelector("#orderAllergy"); if (al) al.oninput = (e) => (state.allergies = e.target.value);
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
  for (const i of floorTableList()) {
    if (!inMySection(i)) continue;          // a sectioned waiter only serves their own tables
    // A MERGED table is not a free one, whatever its own summary tile says: its party — and
    // its bill — live on the table it is joined to, and that is where this order would land.
    // Saying "free" here would be the same lie the floor tiles were fixed for (mig 249).
    const parent = mergeParentOf(i);
    const busy = !!parent || tileIsOpen(i);
    const what = parent ? `joins ${esc(tname(parent) || "T" + parent)}'s bill` : busy ? "joins its bill" : "free";
    tiles.push(`<button class="qdest-t${busy ? " busy" : ""}" data-qdest="${i}"><b>${esc(tname(i) || "T" + i)}</b><small>${what}</small></button>`);
  }
  const ov = document.createElement("div");
  ov.className = "qdest-overlay";
  ov.innerHTML = `<div class="qdest-box">
    <div class="qdest-head"><h3>Which table gets this order?</h3><button class="qdest-x" aria-label="Close">✕</button></div>
    <div class="muted small" style="margin:2px 0 12px">Tap a table to send it to the kitchen — a busy table adds it to that table's bill.</div>
    <div class="qdest-grid">${tiles.join("")}</div>
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
// menu) with the added items, ONE allergy/note field for the kitchen and SEND — reached
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
function renderOrderMode() {
  // Phone: the added-items review lives on its OWN screen (like the guest menu), reached
  // by the floating "View order" pill. Desktop keeps the side pane, so it never sets
  // viewOrder. (owner 2026-07-05)
  // Never strand the waiter on an empty "Your order" review: if the cart is empty, show the
  // dish MENU (what they actually need) instead of the "no dishes" screen. Only open the review
  // when there's actually something in the cart. This kills the intermittent "no dishes added"
  // screen when the order opens. (audit 2026-07-09)
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
    <div class="om lite">
      <div class="om-head">
        <h2>${state.quick ? "⚡ Quick order" : `${addMode ? "Add · " : ""}${esc(tableLabel(state.table))}`}</h2>
        <input type="search" id="dishSearch" class="order-search om-search" placeholder="🔎 Search dishes…" value="${esc(state.dishSearch)}">
        <button class="btn small ${addMode ? "primary" : ""}" id="omExit">${addMode ? `✓ Done${state._addedThisVisit ? ` (${state._addedThisVisit} added)` : ""}` : "← back"}</button>
      </div>
      <div class="om-body ${addMode ? "no-cart" : ""}">
        <nav class="om-nav" id="omNav">${orderNavHtml()}</nav>
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
        // The ✎ per-item box travels as a VERBATIM note — the kitchen sees exactly what
        // the waiter typed ("less ice", "no nuts", "extra spicy"). It used to become a
        // removed[] list, which force-prefixed "NO" onto every entry ("less ice" printed
        // as "NO LESS ICE" — owner 2026-07-21). removed[] keeps its real "NO X" wording
        // for guest allergen tags and the staff allergy-edit modal, which still write it.
        const typed = (l.allergy || "").trim();
        const note = [l.note, typed].filter(Boolean).join(" · ");
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
      note: state.note.trim() || null,
    }, extra || {});
    const place = (extra) => api("POST", "/order", buildBody(extra));
    // A finished send (real ticket OR safely queued offline): drop the back steps + reset.
    const finishSent = () => {
      if (voBackOff) { voBackOff(); voBackOff = null; }
      if (omBackOff) { omBackOff(); omBackOff = null; }
      state.ordering = false; state.cart = []; state.viewOrder = false; state.note = ""; state.allergies = ""; state._omTop = 0;
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
      if (seq !== loadSeq) return;
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
  patchTabletTiles(tables);
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
const tickClock = () => {
  const dc = document.getElementById("dwClock");
  if (dc) dc.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
load().catch((e) => { if (!(window.LFH_OFF && window.LFH_OFF.isOfflineErr(e))) toast("Can't reach the database: " + e.message, false); });

// ── HIERARCHY X-RAY ribbon (Phase 3) ─────────────────────────────────────────
// Marks the admin act-as view and counts the billing controls that are off for
// waiters (the tinted ones). body is a flex column, so the ribbon simply takes the
// top row — no viewport math needed. Server still enforces everything (tabletPerm).
const XRAY_CAPS = [
  { key: "tablet_take_orders", label: "Take orders" },
  { key: "tablet_discount", label: "Apply discount" },
  { key: "tablet_mark_paid", label: "Mark bill paid" },
  { key: "tablet_invoice", label: "Generate invoice" },
  { key: "tablet_banquet", label: "Banquet billing" },
  { key: "tablet_table_ops", label: "Table & KOT operations" },
];
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
    font-size: 12px; color: var(--text, #e8eefc); position: relative; z-index: 40; }
  #xrayRibbon .rb-tag { font-weight: 800; letter-spacing: .04em; color: #f59e0b; text-transform: uppercase; font-size: 11px; }
  #xrayRibbon .rb-rest { color: var(--muted, #9fb0cc); font-weight: 600; }
  #xrayRibbon .rb-crumbs { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; flex-wrap: wrap; }
  #xrayRibbon .rb-crumbs a { color: #f59e0b; text-decoration: none; cursor: pointer; }
  #xrayRibbon .rb-crumbs a:hover { text-decoration: underline; }
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
      `<nav class="rb-crumbs" aria-label="Breadcrumb"><a id="xrayHome">Restaurants</a>` +
      `<span class="rb-sep">›</span><span>${restS ? esc(restS) : "…"}</span>` +
      `<span class="rb-sep">›</span><span>Tablet panel</span></nav>` +
      `<span class="rb-spacer"></span>` +
      `<button id="xrayFullBtn" title="Back to the full admin view (everything visible)">See full admin view</button>` +
      `<button class="rb-exit" id="xrayExit">Exit view</button>`;
    document.getElementById("xrayFullBtn").onclick = () => xraySetViewReal(false);
    document.getElementById("xrayHome").onclick = () => {
      try { window.top.location.href = "/aevinite/restaurants"; } catch { window.location.href = "/aevinite/restaurants"; }
    };
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
    // The PATH the admin walked in through — Restaurants › name › Tablet panel —
    // the owner panel's breadcrumb language (owner, 2026-07-06). This ribbon is
    // admin-only (tHigher), so the console crumb is always right here.
    `<nav class="rb-crumbs" aria-label="Breadcrumb"><a id="xrayHome">Restaurants</a>` +
    `<span class="rb-sep">›</span><span>${rest ? esc(rest) : "…"}</span>` +
    `<span class="rb-sep">›</span><span>Tablet panel</span></nav>` +
    `<span class="rb-spacer"></span>` +
    `<button id="xrayZonesBtn">${whoName ? `${n} thing${n === 1 ? "" : "s"} ${esc(whoName)} doesn't have` : `${n} control${n === 1 ? "" : "s"} off for waiters`} ▾</button>` +
    `<button class="rb-exit" id="xrayExit">Exit view</button>`;
  document.getElementById("xrayHome").onclick = () => {
    try { window.top.location.href = "/aevinite/restaurants"; } catch { window.location.href = "/aevinite/restaurants"; }
  };
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
// Boot: learn WHO is viewing, then repaint so the templates' tshow()/txray() see it.
// One tiny request, once per page load — no polling.
api("GET", "/whoami").then((w) => {
  TABLET_WHO = w;
  if (!tHigher() && !tSim()) return;
  renderXrayRibbon();
  lastSig = ""; // force one repaint — buttons may need to appear tinted
  renderFloor(); if (!state.ordering && !state.pickerOpen) renderPanel();   // #U1: don't clobber an open Move picker
}).catch(() => {});
// Realtime: refetch only when something on the floor actually changes (instant),
// instead of polling every second. A slow 60s timer is the backup if the
// WebSocket drops; if realtime didn't load, fall back to a gentle 2s poll.
if (window.LFH_RT) {
  // Split by topic: ops churn → TARGETED loadTables() when the breadcrumb names specific
  // tables, else full load() (wake, reconnect, initial, or any unscopable event). menu edits
  // (dish/price/category changes) always do a full load() so the dish browser refreshes.
  LFH_RT.start({ handlers: {
    ops: (detail) => (detail && !detail.full && detail.tables && detail.tables.length) ? loadTables(detail.tables) : load(),
    // #17: after a menu change lands, if the waiter is mid-order patch the open dish grid in
    // place so a just-sold-out dish becomes untappable immediately (load() skips renderPanel
    // while ordering, so without this the grid stayed stale). Flag the menu stale so this load()
    // is a FULL one that actually refetches the dishes (normal refreshes are slim). (perf 2026-07-20)
    menu: () => { state._menuStale = true; return load().then(() => { if (state.ordering) updateDishAvailability(); }).catch(() => {}); },
  }});
  // Backup floor sync every 60s (slim). Every ~10th minute also flag the menu stale so the next
  // load refetches dishes — a safety-net that self-heals a missed realtime `menu` event. (perf 2026-07-20)
  let _menuHealN = 0;
  setInterval(() => { if ((++_menuHealN % 10) === 0) state._menuStale = true; load().catch(() => {}); }, 60000);
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
    // #5: clock lives here on phones (moved off the cramped top bar; desktop keeps it on the bar).
    '<div class="dw-row"><span>Time</span><span class="dw-prof" id="dwClock">…</span></div>' +
    // Build tag: lets the owner confirm at a glance he's on the latest code (rules out a stale cache). (audit 2026-07-09)
    '<div class="dw-row"><span>Build</span><span class="dw-prof">tablet-20260722kot1</span></div>' +
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
    Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(4,8,18,.66)", backdropFilter: "blur(3px)", zIndex: "99990", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
    ov.innerHTML = `<div style="width:min(92vw,360px);background:var(--panel);color:var(--text);border-radius:16px;padding:18px 18px calc(18px + var(--sab));box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
      <div style="display:flex;align-items:center;gap:10px;margin:0 0 14px"><h3 style="margin:0;font-size:16px;font-weight:800;flex:1">⚙️ Settings</h3><button class="set-close" aria-label="Close" style="background:var(--panel-2);border:0;color:var(--text);border-radius:8px;width:40px;height:40px;font-size:16px;cursor:pointer">✕</button></div>
      <a class="dw-btn danger" href="/api/panel-logout" style="margin-top:0">Log out</a>
      <div class="muted" style="font-size:12px;margin-top:10px">More settings will live here soon.</div>
    </div>`;
    document.body.appendChild(ov);
    let backOff = window.LFH_BACK ? LFH_BACK.layer("tablet-settings", () => closeSheet()) : null;
    const closeSheet = () => { if (backOff) { backOff(); backOff = null; } ov.remove(); };
    ov.querySelector(".set-close").onclick = closeSheet;
    ov.onclick = (e) => { if (e.target === ov) closeSheet(); };
  }
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
    const tax = Math.round(sub * effRate() * 100) / 100;
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
        if (!/manager pin/i.test(String(e && e.message))) throw e;
        let pin = await pinPrompt("Banquet billing needs a manager PIN.");
        while (pin) {
          try { r = await api("POST", "/banquet/place", { table: t, lines, managerPin: pin }); break; }
          catch (e2) {
            if (/manager pin/i.test(String(e2 && e2.message))) { pin = await pinPrompt("Banquet billing needs a manager PIN.", "That PIN didn't match — try again."); continue; }
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
