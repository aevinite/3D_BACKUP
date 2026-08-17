/* guestbell.js — WHAT THE GUEST MENU IS ASKING FOR, in one place, on the manager panel and the
 * waiter tablet. (Owner, 2026-08-13.)
 *
 * WHAT HE ASKED FOR
 *   "There should be a notification thing on manager [and] tablet panel, both, which will show the
 *   live waiter, count, and like accepting and all that stuff for the guest menu … and if the guest
 *   menu is not working in some restaurant, like we have closed it, it will not even show that."
 *
 * WHAT IT IS
 *   A 🔔 in the panel's top bar with a count, and a sheet listing everything the guest side is
 *   waiting on right now, newest first:
 *     · a table that rang for a waiter (with what they said, if they said anything)
 *     · a new guest order nobody has accepted yet
 *     · someone waiting to be let in to a table
 *     · a request raised from a table
 *   Tapping a row opens that table, where the buttons that answer it already live.
 *
 * THREE THINGS THAT ARE DELIBERATE
 *
 * 1. IT COSTS NOTHING TO RUN. It makes no request of its own — not one. Every line it shows is
 *    already in the panel's own board ('state.summary'), which both panels poll and refresh from
 *    the realtime breadcrumb anyway. A notification centre that polled would be the exact shape
 *    this project has been burned by (96% of egress was whole-board re-reads), and it would be
 *    paying twice for data already on the device.
 *
 * 2. WITH THE GUEST MENU OFF IT DOES NOT EXIST. Not a greyed bell, not a bell reading zero —
 *    nothing renders at all. That was the half he stressed, and it is the same rule the floor
 *    legend already follows for the 🔔 "called" entry (owner, 2026-08-01: "if the menu will be
 *    off then this also should not show"). The gate is 'settings.menu_enabled', which the ADMIN
 *    owns on the Access screen — so the feature is admin-controlled through a switch that already
 *    exists, rather than growing a second toggle for the same decision.
 *
 * 3. IT NEVER WRITES ANYTHING. Accepting an order, approving a guest and answering a call all have
 *    one home each already. A second set of buttons here would be a second write path to keep in
 *    step with the first — the twin-panel drift this codebase has been bitten by repeatedly. A row
 *    is a doorway, not a duplicate control.
 *
 * HOW A PANEL WIRES IT UP — one call, at the bottom of its own render:
 *
 *   LFH_BELL.sync({
 *     menuOn:  <boolean>,           // settings.menu_enabled !== false
 *     rows:    [ { kind, table, text, at } … ],
 *     onOpen:  function (table) {}, // take me to that table
 *   });
 *
 * 'kind' is one of "call" | "order" | "join" | "request" — it picks the icon and the wording.
 */
(function () {
  var mounted = null;      // the <button> in the top bar, once there is something to mount it in
  var sheet = null;
  var backOff = null;
  var last = { menuOn: false, rows: [], onOpen: null };
  // WHICH ROWS HAVE BEEN SEEN — not "when did you last look".
  //
  // A timestamp was the obvious way and it is wrong here, because the most important row has no
  // time on it: the floor summary reports an unaccepted order as a STATE, not a moment (mig 238).
  // Anything without a time would then be permanently new, so the badge could never clear — and a
  // badge that never goes down is a badge people stop reading, which is worse than no badge.
  //
  // So each row carries an identity (its own id, or the `key` the panel builds) and the device
  // remembers the ones already read. A second order at the same table changes that identity, so it
  // counts as new again — which is the behaviour a waiter would expect.
  //
  // Capped and pruned to what is currently on screen, so this can never grow: a restaurant that
  // has been open for a year keeps a list the size of its floor, not the size of its year.
  var SEEN_KEY = "lfh_bell_seen";
  function readSeen() {
    try { var v = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function rowKey(r) { return String(r.key || (r.kind + ":" + (r.table == null ? "" : r.table) + ":" + (r.id || r.at || ""))); }
  // READ THE SEEN LIST ONCE PER PASS, NOT ONCE PER ROW (T9 sweep, 2026-08-17).
  //
  // `isNew()` used to re-read AND re-parse the whole list out of localStorage for every single
  // row, and both the count and the sheet ask it — measured at 90 synchronous storage reads and
  // 90 JSON.parses for one 30-row pass, on a file whose own doc line says it is "cheap enough to
  // call on every paint". localStorage is synchronous, so that is main-thread time on the
  // busiest device in the building, every time the floor repaints. One read per pass, held in a
  // Set, is the same answer for a fraction of the work.
  var seenSet = null;
  function seen() {
    if (!seenSet) seenSet = new Set(readSeen());
    return seenSet;
  }
  function forgetSeen() { seenSet = null; }   // after a write, or when the rows change
  function isNew(r) { return !seen().has(rowKey(r)); }
  function markSeen() {
    try {
      // Only what is on screen right now — a row that has been answered is gone, and remembering
      // it forever would just make the list of remembered things outlive the things themselves.
      var keys = last.rows.map(rowKey).slice(0, 200);
      localStorage.setItem(SEEN_KEY, JSON.stringify(keys));
      seenSet = new Set(keys);   // we just wrote it — no need to read it back
    } catch (e) { forgetSeen(); }
  }

  function el(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }

  function fmtAgo(ts) {
    if (!ts) return "";
    var mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    var d = new Date(ts), h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + ap;
  }

  // WHAT EACH KIND IS, in the words the floor already uses. No new vocabulary: "called" and
  // "new order" are what the tiles and the legend say, so the bell and the floor read as one thing.
  var KINDS = {
    call:    { icon: "🔔", what: "rang for a waiter" },
    order:   { icon: "🧾", what: "sent a new order" },
    join:    { icon: "🙋", what: "is waiting to be let in" },
    request: { icon: "✋", what: "asked for something" },
  };

  function injectStyles() {
    if (document.getElementById("lfh-bell-style")) return;
    var css = [
      // The button borrows the panel's own top-bar button shape (.theme-toggle exists in both
      // panels' stylesheets) so it can never look like a bolted-on third-party thing.
      ".lfh-bell{position:relative}",
      ".lfh-bell-n{position:absolute;top:-4px;right:-4px;min-width:17px;height:17px;padding:0 4px;",
      "  border-radius:999px;background:#dc2626;color:#fff;font:800 10.5px/17px system-ui,sans-serif;",
      "  text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.35);pointer-events:none}",
      ".lfh-bell-back{position:fixed;inset:0;z-index:99998;background:rgba(4,8,18,.6);",
      "  backdrop-filter:blur(3px);display:flex;align-items:flex-end;justify-content:center}",
      "@media(min-width:700px){.lfh-bell-back{align-items:center;padding:24px}}",
      ".lfh-bell-sheet{width:min(560px,100%);max-height:min(84vh,720px);overflow:auto;",
      "  background:var(--panel,#0f1830);color:var(--text,#e7eefc);",
      "  border:1px solid var(--line,rgba(127,127,127,.28));border-radius:18px 18px 0 0;",
      // --sab, not --safe-b: the panels define --sab as max(env(safe-area-inset-bottom), --safe-b)
      // precisely because only ONE of those two is ever real — --safe-b is injected by the host
      // page into the iframe, env() only works when the panel is open on its own. Reading the
      // injected one alone meant the last row of this sheet sat under a phone's home indicator
      // whenever the panel was opened directly. undobar.js already reads it this way.
      "  padding:18px 18px calc(18px + var(--sab, env(safe-area-inset-bottom, 0px)));box-shadow:0 -18px 60px rgba(0,0,0,.5);",
      "  font:500 13.5px/1.45 system-ui,sans-serif}",
      "@media(min-width:700px){.lfh-bell-sheet{border-radius:18px}}",
      ".lfh-bell-hd{display:flex;align-items:flex-start;gap:10px}",
      ".lfh-bell-hd h3{margin:0;font-size:16.5px;font-weight:800;flex:1}",
      ".lfh-bell-hd p{margin:6px 0 0;font-size:12.5px;opacity:.75;font-weight:500}",
      ".lfh-bell-x{border:0;background:rgba(127,127,127,.18);color:inherit;border-radius:10px;",
      "  width:32px;height:32px;font-size:16px;cursor:pointer;flex:0 0 auto}",
      // A row is a doorway to the table, so it looks and behaves like a button.
      ".lfh-bell-row{display:flex;align-items:center;gap:11px;width:100%;margin-top:10px;",
      "  padding:12px 13px;border-radius:13px;text-align:left;cursor:pointer;",
      "  background:rgba(127,127,127,.10);border:1px solid var(--line,rgba(127,127,127,.24));",
      "  color:inherit;font:inherit}",
      ".lfh-bell-row:hover{background:rgba(127,127,127,.18)}",
      ".lfh-bell-row.is-new{border-color:rgba(220,38,38,.55);background:rgba(220,38,38,.10)}",
      ".lfh-bell-ic{font-size:19px;flex:0 0 auto;line-height:1}",
      ".lfh-bell-tx{flex:1;min-width:0}",
      ".lfh-bell-tx b{display:block;font-size:13.5px;font-weight:800}",
      ".lfh-bell-tx small{display:block;font-size:12px;opacity:.8;font-weight:500;margin-top:2px}",
      ".lfh-bell-when{font-size:11.5px;opacity:.6;font-weight:700;flex:0 0 auto}",
      ".lfh-bell-empty{margin-top:14px;padding:16px;border-radius:12px;text-align:center;",
      "  background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.32);color:#16a34a;font-weight:800}",
    ].join("\n");
    var s = document.createElement("style"); s.id = "lfh-bell-style"; s.textContent = css;
    document.head.appendChild(s);
  }

  // WHERE THE BUTTON GOES. Both panels keep their top-bar buttons in '.top-actions'; the manager
  // calls it that too. Fall back to the topbar itself so a layout change can't make the bell
  // disappear silently — it just sits somewhere slightly different.
  function host() {
    return document.querySelector(".top-actions") || document.querySelector(".topbar") || null;
  }

  function mount() {
    if (mounted && mounted.isConnected) return mounted;
    var h = host(); if (!h) return null;
    injectStyles();
    var b = el("button", "theme-toggle lfh-bell");
    b.type = "button";
    b.id = "lfhBellBtn";
    b.title = "What the guest menu is waiting for";
    b.setAttribute("aria-label", "Guest notifications");
    b.appendChild(el("span", null, "🔔"));
    b.addEventListener("click", function (e) { e.stopPropagation(); openSheet(); });
    // Before the theme button if there is one, so the bell doesn't move when the theme button
    // re-renders; otherwise at the end.
    var theme = h.querySelector("#themeToggle");
    if (theme) h.insertBefore(b, theme); else h.appendChild(b);
    mounted = b;
    return b;
  }

  function unmount() {
    if (mounted) { mounted.remove(); mounted = null; }
    closeSheet();
  }

  function newCount() {
    return last.rows.filter(isNew).length;
  }

  function paintButton() {
    var b = mount(); if (!b) return;
    var n = newCount();
    var badge = b.querySelector(".lfh-bell-n");
    if (!n) { if (badge) badge.remove(); b.setAttribute("aria-label", "Guest notifications — nothing waiting"); return; }
    if (!badge) { badge = el("span", "lfh-bell-n"); b.appendChild(badge); }
    badge.textContent = n > 99 ? "99+" : String(n);
    b.setAttribute("aria-label", n === 1 ? "1 new thing from the guest menu" : n + " new things from the guest menu");
  }

  function rowNode(r) {
    var k = KINDS[r.kind] || KINDS.request;
    var node = el("button", "lfh-bell-row" + (isNew(r) ? " is-new" : ""));
    node.type = "button";
    node.appendChild(el("span", "lfh-bell-ic", k.icon));
    var tx = el("span", "lfh-bell-tx");
    tx.appendChild(el("b", null, (r.table ? "Table " + r.table + " " : "") + k.what));
    if (r.text) tx.appendChild(el("small", null, r.text));
    node.appendChild(tx);
    node.appendChild(el("span", "lfh-bell-when", fmtAgo(r.at)));
    node.addEventListener("click", function () {
      closeSheet();
      // A doorway, never a second control: hand the table to the panel and let its own screen
      // answer it. A row we can't tie to a table just closes.
      try { if (r.table != null && last.onOpen) last.onOpen(String(r.table)); } catch (e) {}
    });
    return node;
  }

  function renderSheet() {
    if (!sheet) return;
    var body = sheet.querySelector(".lfh-bell-sheet");
    body.innerHTML = "";
    var hd = el("div", "lfh-bell-hd");
    var wrap = el("div"); wrap.style.flex = "1";
    wrap.appendChild(el("h3", null, "From the guest menu"));
    wrap.appendChild(el("p", null, last.rows.length
      ? "Tap one to go to that table."
      : "Nothing is waiting from the tables right now."));
    hd.appendChild(wrap);
    var x = el("button", "lfh-bell-x", "✕"); x.type = "button";
    x.addEventListener("click", closeSheet);
    hd.appendChild(x);
    body.appendChild(hd);
    if (!last.rows.length) { body.appendChild(el("div", "lfh-bell-empty", "✓ All caught up")); return; }
    last.rows.forEach(function (r) { body.appendChild(rowNode(r)); });
  }

  function openSheet() {
    if (sheet) return;
    injectStyles();
    sheet = el("div", "lfh-bell-back");
    sheet.appendChild(el("div", "lfh-bell-sheet"));
    sheet.addEventListener("click", function (e) { if (e.target === sheet) closeSheet(); });
    document.body.appendChild(sheet);
    renderSheet();
    // Hardware back closes this first instead of leaving the panel (the back-button rule —
    // every popup registers the moment it is built, never a hand-rolled pushState).
    if (window.LFH_BACK && window.LFH_BACK.layer) backOff = window.LFH_BACK.layer("guest-bell", closeSheet);
    // Opening IS reading them. The count clears; the rows keep their red edge until this sheet is
    // closed, so the person can still see which ones were new while they read the list.
    markSeen();
    paintButton();
  }

  function closeSheet() {
    if (!sheet) return;
    sheet.remove(); sheet = null;
    if (backOff) { try { backOff(); } catch (e) {} backOff = null; }
    // Repaint the count (the rows just went from new to read) — but ONLY if there is still
    // supposed to be a bell. unmount() removes the button and then closes the sheet, so an
    // unconditional paint here put the button straight back: switch the guest menu off with
    // the sheet open and the bell survived it. Measured on both panels before this guard.
    if (last.menuOn) paintButton();
  }

  /**
   * Called by each panel after it renders. Cheap enough to call on every paint: it only touches
   * the DOM when something actually changed.
   */
  function sync(next) {
    var menuOn = !!(next && next.menuOn);
    last = {
      menuOn: menuOn,
      rows: (next && Array.isArray(next.rows) ? next.rows : []).slice()
        // Newest first — a waiter reads the top of a list.
        .sort(function (a, b) { return (b.at || 0) - (a.at || 0); })
        // A ceiling, so a floor that has got away from someone cannot build a list nobody can
        // scroll. The count on the button is still the true one.
        .slice(0, 50),
      onOpen: (next && typeof next.onOpen === "function") ? next.onOpen : null,
    };
    // THE GUEST MENU IS OFF → THERE IS NO BELL. Not a zero, not a greyed button: gone.
    if (!menuOn) { unmount(); return; }
    paintButton();
    if (sheet) renderSheet();
  }

  window.LFH_BELL = {
    sync: sync,
    open: openSheet,
    close: closeSheet,
    // For a panel that wants the number itself (and for tests).
    count: function () { return newCount(); },
  };
})();
