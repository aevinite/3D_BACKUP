// inventory.js — the manager panel's 📦 Inventory tab (mig 221, Stage 1).
// Self-contained: app.js only calls LFH_INV.render(container) when the tab opens.
// Talks to /api/inventory/* (power-enforced server-side; whoami here is display truth).
//
// Sub-views: Stock · To order · Purchases · Count · Waste · Expenses.
// Phone-first: big tap targets, one-column cards, popups registered with LFH_BACK.
// Egress: fetch on open + after own writes only — no polling (the stock room doesn't
// change under you the way the floor does; a manual ↻ is always there).
(function () {
  "use strict";

  const S = {
    view: "stock",           // stock | order | purchases | count | waste | expenses
    can: { stock: false, expenses: false },
    role: "",
    items: [],               // ingredient master incl. balances
    vendors: [],
    purchases: [],
    waste: [],
    expenses: null,          // { month, expenses, totals, total }
    orderList: [],
    negative: [],
    count: null,             // open draft: { id, lines: Map(item_id -> counted purchase-qty string) }
    countSaved: null,        // last submitted count summary (variance screen)
    loaded: false,
    root: null,
  };

  // ── plumbing ────────────────────────────────────────────────────────────────
  const $ = (sel, el) => (el || S.root || document).querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inr = (n) => "₹" + (Math.round(Number(n || 0) * 100) / 100).toLocaleString("en-IN");
  const toastMsg = (m) => { if (typeof window.toast === "function") window.toast(m); };
  const scoped = (p) => (typeof window.ridQ === "function" ? window.ridQ(p) : p);

  // ONE TAP = ONE ACTION, AND TWO TAPS = TWO ACTIONS. Both halves matter, and getting the
  // second one wrong is expensive here because these writes are stock and money.
  //
  // The first version minted a fresh uuid inside every call, so an accidental double-tap became
  // two stock movements (the save buttons are not disabled while the request is in flight, and
  // every movement's own dedupe key is built from the row the handler has just INSERTED — so it
  // cannot recognise a second insert). The fix for that was to derive the id from the write's
  // CONTENT and reuse it for 30 seconds. That closed the double-tap and opened something worse:
  // two DELIBERATE identical entries inside the window silently became one. Two ₹500 cash
  // expenses logged back to back recorded ₹500 and said "Expense recorded" twice; two 1 kg trays
  // of the same tomatoes binned recorded one, so stock stayed a kilo too high.
  //
  // So dedupe on CONCURRENCY, not on content-over-time: an identical write that arrives while
  // the first is STILL IN FLIGHT is the double-tap, and it is dropped. Once the first has
  // finished, an identical write is a person doing the same thing again and gets its own id.
  const inFlight = new Set();
  const flightKey = (method, path, body) => method + " " + path + " " + (body ? JSON.stringify(body) : "");
  const newActionId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

  // Every write gets a deadline, like every other write in the app (public/panels/outbox.js,
  // lib/menu.ts). This helper had none, so an overloaded database that answers nothing left the
  // person's tap on a spinner with no result and no trace. Guarded because reading
  // AbortSignal.timeout throws on an older phone.
  const INV_TIMEOUT_MS = 15000;
  function invDeadline() {
    try {
      return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(INV_TIMEOUT_MS) : undefined;
    } catch (e) { return undefined; }
  }

  // ── A COUNT TYPED IN A COLD STORE MUST NOT BE LOST (T17 sweep, 2026-08-13, finding F12) ────────
  //
  // Every write here was a bare fetch with a 15-second deadline and nothing behind it, so a save
  // made where the signal doesn't reach — the walk-in, the dry store, the back door — died in a red
  // toast and the typed figure was gone. Meanwhile docs/OFFLINE-SYNC.md listed inventory as one of
  // the three surfaces that DOES queue, which is the sentence a later session trusts instead of
  // checking. Stock-taking is also the single most likely place in the product for two people to be
  // working at once, so losing one of them silently is the worst possible place for it.
  //
  // The plain (JSON) writes now go through the SAME queue every other staff panel uses: saved on the
  // device, replayed in order when the signal returns, visible in the shared "saved on this device"
  // bar. Nothing about the server changes — the queue sends the identical request with the identical
  // X-LFH-Action-Id, so withIdempotency still makes a replay run at most once, and X-LFH-Expect
  // still refuses an overwrite.
  //
  // A write CARRYING A PHOTO deliberately does not queue: the outbox stores JSON in IndexedDB, not
  // files, and a queued purchase whose bill photo had silently vanished would be worse than an
  // honest refusal. Those stay online-only and say so — see the message in the catch below.
  const canQueue = () => !!(window.LFH_OUTBOX && typeof window.LFH_OUTBOX.send === "function");

  async function inv(method, path, body, photoFile, extra) {
    const url = "/api/inventory" + scoped(path);
    const opts = { method, headers: {} };
    let key = null;
    if (method !== "GET") {
      // The double-tap guard: an IDENTICAL write already in flight is the second tap of one
      // gesture, so refuse it here rather than let it become a second stock movement. It is not
      // a dropped tap — the first one is being carried out and the person sees its result.
      key = flightKey(method, path, body);
      if (inFlight.has(key)) throw new Error("Already saving that — one moment.");
      inFlight.add(key);
      // Every write carries an action id so the server's withIdempotency guard makes a network
      // retry run at most once. A FRESH id per call on purpose: see the note above — an id reused
      // across time is what silently merged two deliberate entries into one.
      opts.headers["X-LFH-Action-Id"] = newActionId();
      // WHAT THE SCREEN WAS EDITING FROM, when the caller says. The server refuses instead of
      // overwriting someone else's change and tells this person what it says now (lib/clash.ts).
      if (extra && extra.expect) opts.headers["X-LFH-Expect"] = JSON.stringify(extra.expect);
      if (photoFile) {
        const fd = new FormData();
        fd.append("payload", JSON.stringify(body || {}));
        fd.append("photo", photoFile);
        opts.body = fd;                       // browser sets the multipart content-type
      } else if (body) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
      }
    }
    // A READ GETS A CEILING TOO (T9 sweep, 2026-08-17). The deadline used to be inside the
    // write-only branch above, so a GET on a database that is up but answering nothing left the
    // Inventory tab on "Loading inventory…" for as long as the manager was willing to stare at
    // it — nothing rejected, so the error path that already exists never ran and there was
    // nothing to tap. Same 15s and the same guarded helper; the catch below turns it into a
    // sentence rather than the browser's own wording.
    opts.signal = invDeadline();
    try {
      // THE QUEUE OWNS EVERY PLAIN WRITE (see the note above canQueue). It sends the same request
      // this function would have sent — same path, same body, same action id, same expectation —
      // and when there is no signal it saves it on the device and replays it in order instead of
      // throwing the person's typing away. A queued write answers { ok:true, queued:true }, which
      // every caller here already treats as success; the shared bar is what tells the person it is
      // saved-but-not-sent, exactly as it does for the floor.
      if (method !== "GET" && !photoFile && canQueue()) {
        return await window.LFH_OUTBOX.send({
          base: "/api/inventory",
          method,
          path: scoped(path),
          body: body || null,
          panel: "inventory",
          expect: (extra && extra.expect) || null,
        });
      }
      const res = await fetch(url, opts);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A clash carries the server's plain sentence — show THAT, not a status code, so the
        // person reads "someone else changed the counted quantity" and can look.
        const e = new Error((json && json.clash && json.clash.plain) || (json && json.error) || res.statusText);
        e.status = res.status; e.data = json;
        throw e;
      }
      return json;
    } catch (e) {
      // A PHOTO NEEDS SIGNAL, AND THE PERSON HAS TO BE TOLD THAT (see the note above canQueue).
      // Only this path can still lose a tap to a dead connection, so it says which part is the
      // problem instead of leaving them to guess — the entry can be saved now and the photo added
      // afterwards from the same screen.
      if (method !== "GET" && photoFile && (e && (e.name === "TypeError" || e.name === "TimeoutError" || e.name === "AbortError"))) {
        const off = new Error("A photo needs a connection. Save this without the photo for now and add it when the signal is back.");
        off.status = 0;
        throw off;
      }
      // A read that ran out of time says so in English. The browser's own wording for an aborted
      // request ("signal is aborted without reason") is not something to put on a manager's screen.
      if (method === "GET" && e && (e.name === "TimeoutError" || e.name === "AbortError")) {
        const slow = new Error("This is taking longer than it should — the system didn't answer. Tap the tab again to retry.");
        slow.status = 0;
        throw slow;
      }
      throw e;
    } finally {
      if (key) inFlight.delete(key);
    }
  }

  // Purchase-unit display: balances live in base units; people think in kg/L/pc.
  const inBuy = (it, baseQty) => {
    const f = Number(it.purchase_factor) || 1;
    const v = Number(baseQty || 0) / f;
    return (Math.round(v * 100) / 100) + " " + esc(it.purchase_uom);
  };
  const itemById = (id) => S.items.find((i) => i.id === id);

  // ── back-button layers: every popup peels off with hardware BACK ────────────
  let offLayer = null;
  /* ASKING, WITHOUT THE BROWSER'S OWN DIALOG (T9 third sweep, 2026-08-31).
     This file had four of them left: three prompt()s asking WHY a purchase or a waste line is
     being struck out, and one confirm() before throwing a draft count away. On a kiosk browser, an
     embedded webview, or Chrome after "prevent this page from creating additional dialogs",
     prompt() answers NULL and confirm() answers FALSE, both without showing anything at all — and
     every one of these call sites reads `if (!answer) return;`. So the manager tapped Void, and
     nothing happened and nothing was said.
     That is worse than the "add another line" case fixed on 2026-08-30, which at least refused out
     loud. And the answer here is a REASON KEPT ON RECORD: a void exists to be explainable later.
     LFH_ASK (maint.js, loaded by every panel that loads this file) is tried first; the browser's
     own stays as the last resort for a page that somehow has neither. */
  async function askWhy(question, title) {
    if (window.LFH_ASK && window.LFH_ASK.text) {
      return await window.LFH_ASK.text(question, { title: title || "Why?", yes: "Save the reason", placeholder: "Type the reason" });
    }
    return window.prompt(question);
  }
  async function askYesNo(question, title, yes) {
    if (typeof confirmDialog === "function") return await confirmDialog(question, yes || "Yes");
    if (window.LFH_ASK && window.LFH_ASK.confirm) return await window.LFH_ASK.confirm(question, { title: title, yes: yes, danger: true });
    return window.confirm(question);
  }

  function openPop(id, html, onBind) {
    closePop();
    const wrap = document.createElement("div");
    wrap.className = "inv-pop-backdrop";
    wrap.id = "invPop";
    wrap.innerHTML = `<div class="inv-pop" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) closePop(); });
    if (window.LFH_BACK) offLayer = window.LFH_BACK.layer(id, closePop);
    if (onBind) onBind(wrap.firstElementChild);
  }
  function closePop() {
    const el = document.getElementById("invPop");
    if (el) el.remove();
    if (offLayer) { try { offLayer(); } catch {} offLayer = null; }
  }

  // ── data loads (each view loads only what it shows) ─────────────────────────
  async function loadCore() {
    // ?all=1: keep RETIRED items in memory too — retired rows stay reachable from a
    // "show retired" toggle (a mis-tapped Active used to make an item unrecoverable
    // from the UI, QA sweep 2026-07-29), and old purchase/waste rows can still name
    // an ingredient that was retired later. Pickers filter to active themselves.
    const [w, items] = await Promise.all([inv("GET", "/whoami"), inv("GET", "/items?all=1")]);
    S.can = w.can; S.role = w.role; S.items = items.items || []; S.loaded = true;
    if (!S.can.stock && S.can.expenses) S.view = "expenses";
  }
  const reloadItems = async () => { S.items = (await inv("GET", "/items?all=1")).items || []; };
  const loadVendors = async () => { S.vendors = (await inv("GET", "/vendors")).vendors || []; };

  // ── render root ─────────────────────────────────────────────────────────────
  async function render(container) {
    S.root = container;
    container.innerHTML = `<div class="inv-wrap"><div class="empty">Loading inventory…</div></div>`;
    try {
      if (!S.loaded) await loadCore();
    } catch (e) {
      container.innerHTML = `<div class="inv-wrap"><div class="empty">⚠️ ${esc(e.message)}</div></div>`;
      return;
    }
    paint();
    refreshView();
  }

  function paint() {
    const pills = [
      S.can.stock && { id: "stock", label: "📦 Stock" },
      S.can.stock && { id: "order", label: "🛒 To order" },
      S.can.stock && { id: "purchases", label: "🧾 Purchases" },
      S.can.stock && { id: "count", label: "🔢 Count" },
      S.can.stock && { id: "waste", label: "🗑️ Waste" },
      S.can.stock && { id: "recipes", label: "🍛 Recipes" },
      S.can.stock && { id: "usage", label: "📊 Usage" },
      S.can.expenses && { id: "expenses", label: "💸 Expenses" },
    ].filter(Boolean);
    if (!pills.length) {
      S.root.innerHTML = `<div class="inv-wrap"><div class="empty">Your owner hasn't given you inventory access yet.</div></div>`;
      return;
    }
    S.root.innerHTML = `
      <div class="inv-wrap">
        <div class="inv-pills" role="tablist">
          ${pills.map((p) => `<button class="inv-pill${S.view === p.id ? " on" : ""}" data-view="${p.id}">${p.label}</button>`).join("")}
          <button class="inv-pill ghost" id="invRefresh" title="Refresh">↻</button>
        </div>
        <div id="invBody" class="inv-body"><div class="empty">Loading…</div></div>
      </div>`;
    S.root.querySelectorAll(".inv-pill[data-view]").forEach((b) => {
      b.onclick = () => { S.view = b.dataset.view; paint(); refreshView(); };
    });
    $("#invRefresh").onclick = () => refreshView(true);
  }

  async function refreshView(force) {
    const body = $("#invBody");
    if (!body) return;
    try {
      if (S.view === "stock") {
        if (force) await reloadItems();
        S.negative = (await inv("GET", "/negative")).items || [];
        renderStock(body);
      } else if (S.view === "order") {
        S.orderList = (await inv("GET", "/order-list")).list || [];
        renderOrder(body);
      } else if (S.view === "purchases") {
        S.purchases = (await inv("GET", "/purchases?limit=30")).purchases || [];
        renderPurchases(body);
      } else if (S.view === "count") {
        renderCount(body);
      } else if (S.view === "waste") {
        S.waste = (await inv("GET", "/waste?days=30")).waste || [];
        renderWaste(body);
      } else if (S.view === "recipes") {
        S.recipes = await inv("GET", "/recipes");
        renderRecipes(body);
      } else if (S.view === "usage") {
        S.usage = await inv("GET", "/usage?days=" + (S.usageDays || 7));
        renderUsage(body);
      } else if (S.view === "expenses") {
        S.expenses = await inv("GET", "/expenses" + (S.expMonth ? `?month=${S.expMonth}` : ""));
        renderExpenses(body);
      }
    } catch (e) {
      body.innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`;
    }
  }

  // ═════════════════════════════ STOCK ═════════════════════════════
  function renderStock(body) {
    const active = S.items.filter((i) => i.active);
    const retired = S.items.filter((i) => !i.active);
    const cats = [...new Set(active.map((i) => i.category))].sort();
    const totalValue = active.reduce((s, i) => s + Math.max(0, Number(i.qty_base)) * Number(i.avg_cost), 0);
    const low = active.filter((i) => i.par_qty != null && Number(i.qty_base) < Number(i.par_qty));
    body.innerHTML = `
      <div class="inv-statrow">
        <div class="inv-stat"><span>Stock value</span><b>${inr(totalValue)}</b></div>
        <div class="inv-stat"><span>Ingredients</span><b>${active.length}</b></div>
        <div class="inv-stat${low.length ? " warn" : ""}"><span>Low</span><b>${low.length}</b></div>
        <div class="inv-stat${S.negative.length ? " bad" : ""}"><span>Below zero</span><b>${S.negative.length}</b></div>
      </div>
      ${S.negative.length ? `<div class="inv-note">⚠️ ${S.negative.length} ingredient${S.negative.length > 1 ? "s show" : " shows"} less than zero — usually a purchase that wasn't entered. Tap it, check its history, then enter the missing bill.</div>` : ""}
      <div class="inv-toolbar">
        <input id="invSearch" class="inv-search" type="search" placeholder="Search ingredients…" />
        <button class="btn primary" id="invAddItem">+ Ingredient</button>
      </div>
      <div id="invStockList">${stockListHtml(active, cats, "")}</div>
      ${retired.length ? `<button class="inv-retired-toggle" id="invShowRetired">${S.showRetired ? "Hide" : "Show"} retired ingredients (${retired.length})</button>` : ""}
      ${S.showRetired && retired.length ? `<div id="invRetiredList">${retired.map((i) => `
        <button class="inv-row retiredrow" data-item="${i.id}">
          <span class="inv-row-name">${esc(i.name)} <span class="inv-badge neg">retired</span></span>
          <span class="inv-row-qty">${inBuy(i, i.qty_base)}</span>
          <span class="inv-row-val dim">tap to restore</span>
        </button>`).join("")}</div>` : ""}`;
    $("#invAddItem").onclick = () => itemPop(null);
    $("#invSearch").oninput = (e) => {
      const q = e.target.value.trim().toLowerCase();
      $("#invStockList").innerHTML = stockListHtml(active, cats, q);
      bindStockRows();
    };
    const rt = $("#invShowRetired");
    if (rt) rt.onclick = () => { S.showRetired = !S.showRetired; renderStock(body); };
    bindStockRows();
  }
  function stockListHtml(active, cats, q) {
    const match = (i) => !q || i.name.toLowerCase().includes(q);
    return cats.map((c) => {
      const rows = active.filter((i) => i.category === c && match(i));
      if (!rows.length) return "";
      return `<div class="inv-cat">${esc(c)}</div>` + rows.map((i) => {
        const lowBadge = i.par_qty != null && Number(i.qty_base) < Number(i.par_qty) ? `<span class="inv-badge low">low</span>` : "";
        const negBadge = Number(i.qty_base) < 0 ? `<span class="inv-badge neg">−</span>` : "";
        return `<button class="inv-row" data-item="${i.id}">
          <span class="inv-row-name">${esc(i.name)} ${lowBadge}${negBadge}</span>
          <span class="inv-row-qty">${inBuy(i, i.qty_base)}</span>
          <span class="inv-row-val">${inr(Math.max(0, Number(i.qty_base)) * Number(i.avg_cost))}</span>
        </button>`;
      }).join("");
    }).join("") || `<div class="empty">No ingredients yet — add your first one.</div>`;
  }
  const bindStockRows = () => S.root.querySelectorAll(".inv-row[data-item]").forEach((r) => { r.onclick = () => itemPop(itemById(r.dataset.item)); });

  // The ingredient popup: create/edit + the plain-language unit sentence + history.
  function itemPop(it) {
    const isNew = !it;
    const v = it || { name: "", category: "general", storage_area: "", base_uom: "g", purchase_uom: "kg", purchase_factor: 1000, par_qty: null, min_qty: null, last_rate: null, track_level: "FULL", active: true };
    openPop("inv-item", `
      <h3>${isNew ? "New ingredient" : esc(v.name)}</h3>
      <label>Name <input id="ipName" value="${esc(v.name)}" maxlength="80" placeholder="e.g. Onion" /></label>
      <div class="inv-grid2">
        <label>Category <input id="ipCat" value="${esc(v.category)}" list="ipCatList" maxlength="40" />
          <datalist id="ipCatList">${[...new Set(S.items.map((x) => x.category))].map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
        <label>Storage area <input id="ipArea" value="${esc(v.storage_area || "")}" maxlength="40" placeholder="e.g. walk-in" /></label>
      </div>
      <div class="inv-grid3">
        <label>Bought as <input id="ipBuyUom" value="${esc(v.purchase_uom)}" maxlength="12" /></label>
        <label>Counted in <select id="ipBaseUom" ${!isNew ? "data-locked=1" : ""}>
          ${["g", "ml", "pc"].map((u) => `<option value="${u}"${v.base_uom === u ? " selected" : ""}>${u}</option>`).join("")}</select></label>
        <label class="inv-factor">1 <span id="ipBuyEcho">${esc(v.purchase_uom)}</span> = <input id="ipFactor" type="number" inputmode="decimal" value="${esc(v.purchase_factor)}" min="0.001" step="any" /> <span id="ipBaseEcho">${esc(v.base_uom)}</span></label>
      </div>
      <p class="inv-sentence" id="ipSentence"></p>
      <div class="inv-grid3">
        <label>Par level (<span class="ipBuyEchoN">${esc(v.purchase_uom)}</span>) <input id="ipPar" type="number" inputmode="decimal" value="${v.par_qty != null ? Math.round((Number(v.par_qty) / Number(v.purchase_factor)) * 100) / 100 : ""}" step="any" placeholder="e.g. 5" /></label>
        <label>Urgent below (<span class="ipBuyEchoN">${esc(v.purchase_uom)}</span>) <input id="ipMin" type="number" inputmode="decimal" value="${v.min_qty != null ? Math.round((Number(v.min_qty) / Number(v.purchase_factor)) * 100) / 100 : ""}" step="any" placeholder="e.g. 2" /></label>
        <label>Rate (₹/<span id="ipRateEcho">${esc(v.purchase_uom)}</span>) <input id="ipRate" type="number" inputmode="decimal" value="${v.last_rate ?? ""}" min="0" step="any" /></label>
      </div>
      ${isNew ? `<label>Opening stock (in <span class="ipBuyEchoN">${esc(v.purchase_uom)}</span>, optional) <input id="ipOpening" type="number" inputmode="decimal" min="0" step="any" placeholder="what's on the shelf right now" /></label>` : ""}
      <label class="inv-check"><input id="ipCountOnly" type="checkbox" ${v.track_level === "COUNT_ONLY" ? "checked" : ""}/> Count-only (never used in recipes — salt, foil…)</label>
      ${!isNew ? `<label class="inv-check"><input id="ipActive" type="checkbox" ${v.active ? "checked" : ""}/> Active (untick to retire this ingredient)</label>` : ""}
      <div class="inv-pop-actions">
        ${!isNew ? `<button class="btn" id="ipHistory">🕘 History</button>` : ""}
        <span style="flex:1"></span>
        <button class="btn" id="ipCancel">Cancel</button>
        <button class="btn primary" id="ipSave">${isNew ? "Add ingredient" : "Save"}</button>
      </div>`, (pop) => {
      // The plain-language echo: unit-conversion typos are the #1 silent killer of
      // inventory accuracy, so read the setup back as a sentence (research: Toast's
      // "does this sentence make sense?" — with the self-service edit path they lack).
      const sentence = () => {
        const buy = $("#ipBuyUom", pop).value || "?", base = $("#ipBaseUom", pop).value, f = $("#ipFactor", pop).value || "?";
        $("#ipSentence", pop).textContent = `You buy ${$("#ipName", pop).value || "this"} in ${buy}. 1 ${buy} = ${f} ${base}. Stock and counts are kept in ${base}.`;
        $("#ipBuyEcho", pop).textContent = buy; $("#ipBaseEcho", pop).textContent = base; $("#ipRateEcho", pop).textContent = buy;
        pop.querySelectorAll(".ipBuyEchoN").forEach((el) => { el.textContent = buy; });
      };
      ["ipName", "ipBuyUom", "ipBaseUom", "ipFactor"].forEach((id) => { const el = $("#" + id, pop); el.oninput = sentence; el.onchange = sentence; });
      sentence();
      $("#ipCancel", pop).onclick = closePop;
      if (!isNew) $("#ipHistory", pop).onclick = () => historyPop(it);
      $("#ipSave", pop).onclick = async () => {
        const payload = {
          name: $("#ipName", pop).value.trim(),
          category: $("#ipCat", pop).value.trim() || "general",
          storage_area: $("#ipArea", pop).value.trim() || null,
          purchase_uom: $("#ipBuyUom", pop).value.trim() || "kg",
          base_uom: $("#ipBaseUom", pop).value,
          purchase_factor: Number($("#ipFactor", pop).value),
          // Par / urgent / opening are TYPED in purchase units (kg/L — how people think)
          // and stored in base units: convert with the factor as typed in this form.
          par_qty: $("#ipPar", pop).value === "" ? null : Number($("#ipPar", pop).value) * Number($("#ipFactor", pop).value || 1),
          min_qty: $("#ipMin", pop).value === "" ? null : Number($("#ipMin", pop).value) * Number($("#ipFactor", pop).value || 1),
          last_rate: $("#ipRate", pop).value === "" ? null : Number($("#ipRate", pop).value),
          track_level: $("#ipCountOnly", pop).checked ? "COUNT_ONLY" : "FULL",
        };
        if (isNew && $("#ipOpening", pop).value !== "") payload.opening_qty = Number($("#ipOpening", pop).value) * Number($("#ipFactor", pop).value || 1);
        if (!isNew) payload.active = $("#ipActive", pop).checked;
        try {
          // An EXISTING ingredient is the classic "two managers, one item" collision — its name,
          // pack size and reorder levels are all typed values someone else can be typing too. Send
          // what this form was opened on, so the second save is refused and told, not silently
          // preferred. A NEW ingredient has no row to overwrite, so it needs no expectation.
          await inv("POST", isNew ? "/items" : "/items/" + it.id, payload, null, isNew ? undefined : {
            // All FIVE typed values this form carries, not just two. The comment above has
            // always claimed "name, pack size AND reorder levels" were protected, but only the
            // first two were ever sent — so two managers editing the same ingredient's par or
            // urgent-below level at once still silently overwrote each other, and no guard could
            // see it (verify:clash asks whether an expectation is SENT, not whether it covers the
            // form). The ordering levels are `par_qty` / `min_qty` (mig 221) and are held here in
            // BASE units, exactly as the payload sends them, so the comparison is like-for-like.
            // The server caps at 8 fields (lib/clash.ts), so five is comfortably inside it.
            expect: { table: "inv_items", id: it.id, fields: {
              name: String(it.name || ""),
              purchase_factor: Number(it.purchase_factor),
              purchase_uom: String(it.purchase_uom || ""),
              par_qty: it.par_qty ?? null,
              min_qty: it.min_qty ?? null,
            } },
          });
          toastMsg(isNew ? "Ingredient added" : "Saved");
          closePop();
          await reloadItems();
          refreshView();
        } catch (e) { toastMsg("⚠️ " + e.message); }
      };
    });
  }

  // Per-item movement history (the "where did my stock go" answer).
  async function historyPop(it) {
    const KIND_LABEL = { opening: "Opening stock", purchase: "Purchase", purchase_void: "Purchase voided", count_adjust: "Count correction", waste: "Waste", waste_void: "Waste struck out", consumption: "Used by orders", consumption_reversal: "Order cancelled", adjustment: "Adjustment", transfer_in: "Transfer in", transfer_out: "Transfer out", production: "Production" };
    let rows = [];
    try { rows = (await inv("GET", "/movements?item=" + it.id)).movements || []; } catch (e) { toastMsg("⚠️ " + e.message); return; }
    openPop("inv-history", `
      <h3>🕘 ${esc(it.name)}</h3>
      <div class="inv-hist">
        ${rows.length ? rows.map((m) => `
          <div class="inv-hist-row">
            <span class="${Number(m.qty_base) >= 0 ? "in" : "out"}">${Number(m.qty_base) >= 0 ? "+" : ""}${inBuy(it, m.qty_base)}</span>
            <span>${esc(KIND_LABEL[m.kind] || m.kind)}${m.reason ? " · " + esc(m.reason) : ""}</span>
            <span class="dim">${new Date(m.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${m.created_by ? " · " + esc(m.created_by) : ""}</span>
          </div>`).join("") : `<div class="empty">No movements yet.</div>`}
      </div>
      <div class="inv-pop-actions"><span style="flex:1"></span><button class="btn" id="ihClose">Close</button></div>`,
      (pop) => { $("#ihClose", pop).onclick = closePop; });
  }

  // ═════════════════════════════ TO ORDER ═════════════════════════════
  function renderOrder(body) {
    const list = S.orderList;
    body.innerHTML = `
      <div class="inv-note soft">Everything under its par level, with how much to buy. Set par levels on each ingredient to grow this list.</div>
      ${list.length ? `
        <div class="inv-toolbar"><span class="dim">${list.length} item${list.length > 1 ? "s" : ""} to buy</span><button class="btn" id="invCopyList">📋 Copy list</button></div>
        ${list.map((i) => `
          <div class="inv-row static">
            <span class="inv-row-name">${i.urgent ? "🔴 " : ""}${esc(i.name)}</span>
            <span class="inv-row-qty">have ${inBuy(i, i.qty_base)}</span>
            <span class="inv-row-val"><b>buy ${i.suggest} ${esc(i.purchase_uom)}</b></span>
          </div>`).join("")}` : `<div class="empty">🎉 Nothing to order — everything is at or above its par level.</div>`}`;
    const btn = $("#invCopyList");
    if (btn) btn.onclick = async () => {
      const text = list.map((i) => `${i.name} — ${i.suggest} ${i.purchase_uom}`).join("\n");
      // navigator.clipboard only exists in secure contexts — a manager tablet on a LAN
      // IP doesn't have it. Fall back to the legacy textarea copy, then to showing the
      // text so it can always be selected by hand (QA sweep 2026-07-29).
      let done = false;
      try { await navigator.clipboard.writeText(text); done = true; } catch {}
      if (!done) {
        const ta = document.createElement("textarea");
        try {
          ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select();
          done = document.execCommand("copy");
        } catch {} finally { ta.remove(); }
      }
      if (done) toastMsg("List copied — paste it into WhatsApp");
      else openPop("inv-copy", `<h3>🛒 Order list</h3><textarea class="inv-copyta" readonly>${esc(text)}</textarea>
        <div class="inv-pop-actions"><span style="flex:1"></span><button class="btn" id="icClose">Close</button></div>`,
        (pop) => { $("#icClose", pop).onclick = closePop; $(".inv-copyta", pop).select(); });
    };
  }

  // ═════════════════════════════ PURCHASES ═════════════════════════════
  function renderPurchases(body) {
    body.innerHTML = `
      <div class="inv-toolbar">
        <button class="btn primary" id="invNewBill">+ Vendor bill</button>
        <button class="btn" id="invNewCash">⚡ Quick cash buy</button>
      </div>
      ${S.purchases.length ? S.purchases.map((p) => `
        <button class="inv-row${p.voided_at ? " voided" : ""}" data-pur="${p.id}">
          <span class="inv-row-name">${p.kind === "cash" ? "⚡ Cash buy" : "🧾 " + esc(p.vendor_name || "Bill")}${p.bill_no ? ` <span class="dim">#${esc(p.bill_no)}</span>` : ""}${p.voided_at ? ` <span class="inv-badge neg">voided</span>` : ""}</span>
          <span class="inv-row-qty dim">${esc(p.bill_date)}</span>
          <span class="inv-row-val">${inr(p.total)}</span>
        </button>`).join("") : `<div class="empty">No purchases yet. Enter your first bill — stock and rates update on their own.</div>`}`;
    $("#invNewBill").onclick = () => purchasePop("bill");
    $("#invNewCash").onclick = () => purchasePop("cash");
    body.querySelectorAll("[data-pur]").forEach((r) => { r.onclick = () => purchaseDetailPop(r.dataset.pur); });
  }

  function purchasePop(kind) {
    const lines = [];   // { item_id, qty, rate }
    const stockables = S.items.filter((i) => i.active);
    openPop("inv-purchase", `
      <h3>${kind === "cash" ? "⚡ Quick cash buy" : "🧾 New vendor bill"}</h3>
      ${kind === "bill" ? `
        <div class="inv-grid2">
          <label>Supplier <input id="ppVendor" list="ppVendorList" placeholder="type a name" maxlength="80" />
            <datalist id="ppVendorList"></datalist></label>
          <label>Bill no. <input id="ppBillNo" maxlength="40" /></label>
        </div>` : `<div class="inv-note soft">Market/mandi purchase with no bill — 60 seconds, photo of the slip if you have one.</div>`}
      <div class="inv-grid2">
        <label>Date <input id="ppDate" type="date" value="${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}" /></label>
        <label>Photo <input id="ppPhoto" type="file" accept="image/*" capture="environment" /></label>
      </div>
      <div class="inv-lines" id="ppLines"></div>
      <div class="inv-addline">
        <select id="ppItem"><option value="">+ item…</option>${stockables.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("")}</select>
        <input id="ppQty" type="number" inputmode="decimal" min="0" step="any" placeholder="qty" />
        <span id="ppUom" class="dim"></span>
        <input id="ppRate" type="number" inputmode="decimal" min="0" step="any" placeholder="₹/unit" />
        <button class="btn" id="ppAdd">Add</button>
      </div>
      <div class="inv-total">Total: <b id="ppTotal">₹0</b></div>
      <label>Note <input id="ppNote" maxlength="200" placeholder="optional" /></label>
      <div class="inv-pop-actions">
        <button class="btn" id="ppCancel">Cancel</button><span style="flex:1"></span>
        <button class="btn primary" id="ppSave">Save purchase</button>
      </div>`, (pop) => {
      if (kind === "bill") loadVendors().then(() => { $("#ppVendorList", pop).innerHTML = S.vendors.map((v) => `<option value="${esc(v.name)}">`).join(""); }).catch(() => {});
      const sel = $("#ppItem", pop);
      sel.onchange = () => {
        const it = itemById(sel.value);
        $("#ppUom", pop).textContent = it ? it.purchase_uom : "";
        if (it && it.last_rate != null) $("#ppRate", pop).value = it.last_rate;
      };
      const redraw = () => {
        $("#ppLines", pop).innerHTML = lines.map((l, n) => {
          const it = itemById(l.item_id);
          return `<div class="inv-line"><span>${esc(it.name)}</span><span>${l.qty} ${esc(it.purchase_uom)} × ₹${l.rate}</span><b>${inr(l.qty * l.rate)}</b><button class="inv-x" data-n="${n}">✕</button></div>`;
        }).join("");
        $("#ppTotal", pop).textContent = inr(lines.reduce((s, l) => s + l.qty * l.rate, 0));
        pop.querySelectorAll(".inv-x").forEach((x) => { x.onclick = () => { lines.splice(Number(x.dataset.n), 1); redraw(); }; });
      };
      // ── THE SAME INGREDIENT TWICE: ASK FIRST (owner, 2026-08-18 — "can do the 8th one with ask first")
      //
      // Nothing stopped a second "Tomatoes" line going on quietly. That IS sometimes what you want —
      // two crate sizes at two rates, or a correction — so it is not refused; it is just no longer
      // silent. The T10 sweep found the server was ALSO getting it wrong (both lines posted the
      // first one's quantity and rate into stock); that half is fixed in app/api/inventory, so the
      // stock ledger is right either way now. This is the other half: the person entering the bill
      // gets told, before it lands, that this ingredient is already on it.
      //
      // confirmDialog() is the editor's own dialog (public/panels/editor/app.js) — a classic script
      // sharing this page's global scope. Guarded by `typeof`, the same way this file already guards
      // window.toast, because inventory.js must not assume anything about load order; a browser
      // where it is genuinely absent falls back to the built-in confirm rather than losing the
      // question. Never silently added either way — the tap always ends in something visible.
      $("#ppAdd", pop).onclick = async () => {
        const item_id = sel.value, qty = Number($("#ppQty", pop).value), rate = Number($("#ppRate", pop).value);
        if (!item_id) return toastMsg("Pick an item");
        if (!(qty > 0)) return toastMsg("Enter the quantity");
        if (!(rate >= 0)) return toastMsg("Enter the rate");
        const already = lines.filter((l) => l.item_id === item_id);
        if (already.length) {
          const it = itemById(item_id) || { name: "this ingredient", purchase_uom: "" };
          const sofar = already.map((l) => `${l.qty} ${it.purchase_uom} × ₹${l.rate}`).join(" and ");
          const ask = `"${it.name}" is already on this bill (${sofar}). Add another line for it?`;
          // …and LFH_ASK (maint.js, loaded by every panel that loads this one) sits between the
          // editor's own dialog and the browser's, added T9 second sweep 2026-08-30. window.confirm
          // is the LAST resort for a reason: a kiosk browser, a webview and Chrome after "prevent
          // this page from creating additional dialogs" all answer it false without showing it, so
          // on those devices this question could only ever be answered NO — the manager was told
          // "Not added" every time and had no way at all to put a second line on the bill. It is
          // still a visible refusal rather than a silent one, which is why this is the third fault
          // of its kind and not the first, but a dead end is a dead end.
          //
          // The chain itself moved into askYesNo() on 2026-08-31, when three more prompt()s and a
          // confirm() were found in this same file and needed the identical order. Two copies of a
          // fallback order is how they drift — see "a new way replaces the old one".
          const said = await askYesNo(ask, "Already on this bill", "Add another line");
          if (!said) { toastMsg("Not added — the line was left as it is"); return; }
        }
        lines.push({ item_id, qty, rate });
        sel.value = ""; $("#ppQty", pop).value = ""; $("#ppRate", pop).value = ""; $("#ppUom", pop).textContent = "";
        redraw();
      };
      $("#ppCancel", pop).onclick = closePop;
      $("#ppSave", pop).onclick = async () => {
        if (!lines.length) return toastMsg("Add at least one item");
        const btn = $("#ppSave", pop); btn.disabled = true;
        try {
          const payload = {
            kind,
            vendor_name: kind === "bill" ? ($("#ppVendor", pop).value.trim() || null) : null,
            bill_no: kind === "bill" ? ($("#ppBillNo", pop).value.trim() || null) : null,
            bill_date: $("#ppDate", pop).value,
            note: $("#ppNote", pop).value.trim() || null,
            lines: lines.map((l) => ({ item_id: l.item_id, qty_purchase: l.qty, rate: l.rate })),
          };
          const photo = $("#ppPhoto", pop).files[0] || null;
          await inv("POST", "/purchases", payload, photo);
          toastMsg("Purchase saved — stock updated");
          closePop();
          await reloadItems();
          refreshView();
        } catch (e) { toastMsg("⚠️ " + e.message); btn.disabled = false; }
      };
    });
  }

  async function purchaseDetailPop(id) {
    let d;
    try { d = await inv("GET", "/purchases/" + id); } catch (e) { toastMsg("⚠️ " + e.message); return; }
    const p = d.purchase;
    openPop("inv-purchase-detail", `
      <h3>${p.kind === "cash" ? "⚡ Cash buy" : "🧾 " + esc(p.vendor_name || "Bill")} <span class="dim">${esc(p.bill_date)}</span></h3>
      ${p.voided_at ? `<div class="inv-note">Voided by ${esc(p.voided_by || "?")} — ${esc(p.void_reason || "")}</div>` : ""}
      ${(d.lines || []).map((l) => { const it = itemById(l.item_id) || { name: "?", purchase_uom: "" }; return `<div class="inv-line"><span>${esc(it.name)}</span><span>${l.qty_purchase} ${esc(it.purchase_uom)} × ₹${l.rate}</span><b>${inr(l.amount)}</b></div>`; }).join("")}
      <div class="inv-total">Total: <b>${inr(p.total)}</b>${p.created_by ? `<span class="dim"> · entered by ${esc(p.created_by)}</span>` : ""}</div>
      ${p.photo_url ? `<a href="${esc(p.photo_url)}" target="_blank" rel="noopener"><img class="inv-photo" src="${esc(p.photo_url)}" alt="bill photo" /></a>` : ""}
      <div class="inv-pop-actions">
        ${!p.voided_at ? `<button class="btn danger" id="pdVoid">Void (with reason)</button>` : ""}
        <span style="flex:1"></span><button class="btn" id="pdClose">Close</button>
      </div>`, (pop) => {
      $("#pdClose", pop).onclick = closePop;
      const vb = $("#pdVoid", pop);
      if (vb) vb.onclick = async () => {
        const reason = await askWhy("This is kept on record, so it can be explained later.", "Why is this purchase being voided?");
        if (!reason || !reason.trim()) return;
        try {
          await inv("POST", `/purchases/${id}/void`, { reason: reason.trim() });
          toastMsg("Purchase voided — stock reversed");
          closePop();
          await reloadItems();
          refreshView();
        } catch (e) { toastMsg("⚠️ " + e.message); }
      };
    });
  }

  // ═════════════════════════════ COUNT ═════════════════════════════
  // Blind, resumable: type what you SEE (in purchase units); every line saves as you
  // go, so a dead battery loses nothing. Variances appear only after submit.
  function renderCount(body) {
    if (S.count) return renderCountSheet(body);
    body.innerHTML = `
      <div class="inv-note soft">Count what's physically on the shelf. It saves line by line (safe to pause), and stock corrects itself when you submit.</div>
      <div class="inv-toolbar"><button class="btn primary" id="invStartCount">▶ Start a stock count</button></div>
      <div id="invCountHist"><div class="empty">Loading past counts…</div></div>`;
    $("#invStartCount").onclick = async () => {
      try {
        const r = await inv("POST", "/counts");
        S.count = { id: r.id, lines: new Map() };
        renderCount(body);
      } catch (e) { toastMsg("⚠️ " + e.message); }
    };
    inv("GET", "/counts").then((r) => {
      const counts = (r.counts || []).filter((c) => c.status !== "discarded");
      const open = counts.find((c) => c.status === "draft");
      if (open && !S.count) {
        S.count = { id: open.id, lines: new Map() };
        // resume: pull already-saved lines back into the sheet
        inv("GET", "/counts/" + open.id).then((d) => {
          (d.lines || []).forEach((l) => {
            const it = itemById(l.item_id);
            if (it) S.count.lines.set(l.item_id, String(Number(l.counted_base) / Number(it.purchase_factor)));
          });
          renderCount(body);
        }).catch(() => renderCount(body));
        return;
      }
      const el = $("#invCountHist");
      if (el) el.innerHTML = counts.length ? counts.map((c) => `
        <div class="inv-row static"><span class="inv-row-name">${c.status === "draft" ? "✏️ Draft" : "✅ Submitted"} count</span>
        <span class="inv-row-qty dim">${esc(c.count_date)}</span><span class="inv-row-val dim">${esc(c.created_by || "")}</span></div>`).join("")
        : `<div class="empty">No counts yet.</div>`;
    }).catch(() => {});
  }

  function renderCountSheet(body) {
    const countable = S.items.filter((i) => i.active && i.track_level !== "EXPENSE");
    // Walk-the-shelf order: storage area first, then category, then name.
    const groups = {};
    countable.forEach((i) => { const k = i.storage_area || "Everywhere else"; (groups[k] = groups[k] || []).push(i); });
    const keys = Object.keys(groups).sort((a, b) => (a === "Everywhere else") - (b === "Everywhere else") || a.localeCompare(b));
    body.innerHTML = `
      <div class="inv-note soft">Blind count: type what you actually see, in the buying unit. Leave blank anything you didn't count — blanks are skipped, never zeroed.</div>
      ${keys.map((k) => `<div class="inv-cat">${esc(k)}</div>` + groups[k].map((i) => `
        <div class="inv-countrow">
          <span class="inv-row-name">${esc(i.name)}</span>
          <input class="inv-countin" data-item="${i.id}" type="number" inputmode="decimal" min="0" step="any"
            value="${esc(S.count.lines.get(i.id) ?? "")}" placeholder="—" /> <span class="dim">${esc(i.purchase_uom)}</span>
        </div>`).join("")).join("")}
      <div class="inv-pop-actions sticky">
        <button class="btn" id="ccDiscard">Discard</button><span style="flex:1"></span>
        <span class="dim" id="ccSavedNote"></span>
        <button class="btn primary" id="ccSubmit">Submit count</button>
      </div>`;
    body.querySelectorAll(".inv-countin").forEach((input) => {
      input.onchange = async () => {
        const itemId = input.dataset.item, it = itemById(itemId);
        const val = input.value.trim();
        if (val === "") { S.count.lines.delete(itemId); return; }
        const buyQty = Number(val);
        if (!Number.isFinite(buyQty) || buyQty < 0) return toastMsg("Enter a number");
        // WHAT THIS SCREEN BELIEVED THE LINE SAID, read BEFORE we overwrite the map below.
        // A count is normally done by two people at once and the row is one per (count, item),
        // upserted on save — so without this the second save silently won and the other
        // person's figure vanished into the stock adjustment with nobody told.
        // Nothing typed here yet → null, which the gate compares as "the line was empty".
        const was = S.count.lines.get(itemId);
        const wasCounted = was === undefined || was === "" ? null : Number(was) * Number(it.purchase_factor);
        S.count.lines.set(itemId, val);
        try {
          await inv("POST", `/counts/${S.count.id}/line`, { item_id: itemId, counted_base: buyQty * Number(it.purchase_factor) }, null, {
            expect: { table: "inv_count_lines", where: { count_id: S.count.id, item_id: itemId }, fields: { counted_base: wasCounted } },
          });
          $("#ccSavedNote").textContent = "saved ✓";
          setTimeout(() => { const n = $("#ccSavedNote"); if (n) n.textContent = ""; }, 1500);
        } catch (e) { toastMsg("⚠️ " + e.message); }
      };
    });
    $("#ccDiscard").onclick = async () => {
      if (!(await askYesNo("Everything typed into this draft count will be lost.", "Throw this draft count away?", "Throw it away"))) return;
      // A REFUSED DISCARD MUST NOT LOOK LIKE A DONE ONE (T9 sweep #7, 2026-08-22).
      //
      // This swallowed every error and cleared the sheet anyway. So if the server refused — the
      // draft had already been submitted from another device, the count no longer existed — the
      // sheet closed with nothing said, and then came straight back: refreshView() re-reads
      // /counts, finds the draft still open, and resumes it with every figure still in it. A tap
      // that produces no result and no sentence is a dropped tap, which this codebase does not
      // allow. (There is nothing to catch when there is simply no signal: the queue keeps the
      // discard and answers ok:true, and the resume is then correct rather than confusing.)
      const btn = $("#ccDiscard");
      if (btn) btn.disabled = true;
      try {
        await inv("POST", `/counts/${S.count.id}/discard`);
      } catch (e) {
        if (btn) btn.disabled = false;
        toastMsg("⚠️ Couldn't throw the count away: " + ((e && e.message) || "the system didn't answer"));
        return;                       // the sheet stays exactly as it was, with the figures in it
      }
      S.count = null;
      refreshView();
    };
    $("#ccSubmit").onclick = async () => {
      if (!S.count.lines.size) return toastMsg("Count at least one item first");
      const btn = $("#ccSubmit"); btn.disabled = true;
      try {
        const r = await inv("POST", `/counts/${S.count.id}/submit`);
        const cid = S.count.id;
        S.count = null;
        await reloadItems();
        toastMsg(`Count done — ${r.adjusted} item${r.adjusted === 1 ? "" : "s"} corrected`);
        varianceSummaryPop(cid);
        refreshView();
      } catch (e) { toastMsg("⚠️ " + e.message); btn.disabled = false; }
    };
  }

  // After submit: show what moved (counted vs expected, valued) — the honest mirror.
  async function varianceSummaryPop(countId) {
    let d;
    try { d = await inv("GET", "/counts/" + countId); } catch { return; }
    const rows = (d.lines || []).map((l) => {
      const it = itemById(l.item_id) || { name: "?", purchase_factor: 1, purchase_uom: "" };
      const diff = Number(l.counted_base) - Number(l.system_base);
      return { it, diff, val: diff * Number(l.unit_cost_snap) };
    }).filter((r) => Math.abs(r.diff) > 0.0001).sort((a, b) => a.val - b.val);
    openPop("inv-variance", `
      <h3>Count result</h3>
      ${rows.length ? rows.map((r) => `
        <div class="inv-line"><span>${esc(r.it.name)}</span>
          <span class="${r.diff < 0 ? "out" : "in"}">${r.diff > 0 ? "+" : ""}${inBuy(r.it, r.diff)}</span>
          <b class="${r.val < 0 ? "out" : "in"}">${inr(r.val)}</b></div>`).join("")
        : `<div class="empty">🎯 Everything matched — no corrections needed.</div>`}
      <div class="inv-pop-actions"><span style="flex:1"></span><button class="btn primary" id="vsClose">Done</button></div>`,
      (pop) => { $("#vsClose", pop).onclick = closePop; });
  }

  // ═════════════════════════════ WASTE ═════════════════════════════
  const WASTE_LABELS = { spoiled: "🥀 Spoiled", burnt: "🔥 Burnt", spilled: "💧 Spilled", expired: "📅 Expired", staff_meal: "🍽️ Staff meal", complimentary: "🎁 On the house", other: "❓ Other" };
  function renderWaste(body) {
    const total = S.waste.filter((w) => !w.voided_at).reduce((s, w) => s + Number(w.qty_base) * Number(w.unit_cost_snap), 0);
    body.innerHTML = `
      <div class="inv-toolbar">
        <span class="dim">Last 30 days: <b>${inr(total)}</b> wasted</span>
        <button class="btn primary" id="invNewWaste">+ Log waste</button>
      </div>
      ${S.waste.length ? S.waste.map((w) => {
        const it = itemById(w.item_id) || { name: "?", purchase_factor: 1, purchase_uom: "" };
        return `<div class="inv-row static${w.voided_at ? " voided" : ""}" data-waste="${w.id}">
          <span class="inv-row-name">${WASTE_LABELS[w.reason] || esc(w.reason)} — ${esc(it.name)}${w.voided_at ? ` <span class="inv-badge neg">struck out</span>` : ""}</span>
          <span class="inv-row-qty">${inBuy(it, w.qty_base)}</span>
          <span class="inv-row-val">${inr(Number(w.qty_base) * Number(w.unit_cost_snap))}</span>
          ${!w.voided_at ? `<button class="inv-x" data-void="${w.id}" title="Strike out">✕</button>` : ""}
        </div>`;
      }).join("") : `<div class="empty">Nothing wasted in the last 30 days — or nothing logged yet.</div>`}`;
    $("#invNewWaste").onclick = wastePop;
    body.querySelectorAll("[data-void]").forEach((x) => {
      x.onclick = async (e) => {
        e.stopPropagation();
        const reason = await askWhy("This is kept on record, so it can be explained later.", "Why strike this out?");
        if (!reason || !reason.trim()) return;
        try {
          await inv("POST", `/waste/${x.dataset.void}/void`, { reason: reason.trim() });
          toastMsg("Struck out — stock restored");
          await reloadItems();
          refreshView();
        } catch (err2) { toastMsg("⚠️ " + err2.message); }
      };
    });
  }

  function wastePop() {
    const usable = S.items.filter((i) => i.active && i.track_level !== "EXPENSE");
    let reason = "";
    openPop("inv-waste", `
      <h3>🗑️ Log waste</h3>
      <label>What <select id="wpItem"><option value="">pick an ingredient…</option>${usable.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("")}</select></label>
      <label>How much <span class="inv-inline"><input id="wpQty" type="number" inputmode="decimal" min="0" step="any" /> <span id="wpUom" class="dim"></span></span></label>
      <div class="inv-reasons">${Object.entries(WASTE_LABELS).map(([k, l]) => `<button class="inv-reason" data-r="${k}">${l}</button>`).join("")}</div>
      <div class="inv-grid2">
        <label>Note <input id="wpNote" maxlength="200" placeholder="optional" /></label>
        <label>Photo <input id="wpPhoto" type="file" accept="image/*" capture="environment" /></label>
      </div>
      <div class="inv-pop-actions"><button class="btn" id="wpCancel">Cancel</button><span style="flex:1"></span><button class="btn primary" id="wpSave">Save</button></div>`, (pop) => {
      const sel = $("#wpItem", pop);
      sel.onchange = () => { const it = itemById(sel.value); $("#wpUom", pop).textContent = it ? it.purchase_uom : ""; };
      pop.querySelectorAll(".inv-reason").forEach((b) => {
        b.onclick = () => { reason = b.dataset.r; pop.querySelectorAll(".inv-reason").forEach((x) => x.classList.toggle("on", x === b)); };
      });
      $("#wpCancel", pop).onclick = closePop;
      $("#wpSave", pop).onclick = async () => {
        const it = itemById(sel.value);
        const qty = Number($("#wpQty", pop).value);
        if (!it) return toastMsg("Pick an ingredient");
        if (!(qty > 0)) return toastMsg("Enter how much");
        if (!reason) return toastMsg("Pick a reason");
        try {
          await inv("POST", "/waste", { item_id: it.id, qty_base: qty * Number(it.purchase_factor), reason, note: $("#wpNote", pop).value.trim() || null }, $("#wpPhoto", pop).files[0] || null);
          toastMsg("Waste logged");
          closePop();
          await reloadItems();
          refreshView();
        } catch (e) { toastMsg("⚠️ " + e.message); }
      };
    });
  }

  // ═════════════════════════════ RECIPES (Stage 2) ═════════════════════════════
  // A dish's recipe = ingredients per ONE plate, typed in BASE units (250 g, 30 ml —
  // exactly how recipes are written). Plate cost = Σ qty × current average cost.
  const dishLines = (slug) => (S.recipes.lines || []).filter((l) => l.owner_type === "dish" && l.owner_key === slug);
  const prepLines = (id) => (S.recipes.lines || []).filter((l) => l.owner_type === "prep" && l.owner_key === id);
  const linesCost = (lines) => lines.reduce((s, l) => { const it = itemById(l.item_id); return s + Number(l.qty_base) * Number(it ? it.avg_cost : 0); }, 0);

  function renderRecipes(body) {
    const dishes = S.recipes.dishes || [];
    const preps = S.items.filter((i) => i.active && i.recipe_batch_base);
    const mapped = dishes.filter((d) => dishLines(d.slug).length);
    body.innerHTML = `
      <div class="inv-note soft">Map each dish's ingredients once — stock then deducts itself the moment an order reaches the kitchen, and the 📊 Usage view starts explaining where stock goes.</div>
      <div class="inv-statrow">
        <div class="inv-stat"><span>Dishes with a recipe</span><b>${mapped.length} / ${dishes.length}</b></div>
        <div class="inv-stat"><span>Prep recipes</span><b>${preps.length}</b></div>
      </div>
      <div class="inv-toolbar">
        <input id="rcSearch" class="inv-search" type="search" placeholder="Search dishes…" />
        <button class="btn" id="rcAddPrep">+ Prep recipe</button>
      </div>
      <div id="rcPrepList">${preps.length ? `<div class="inv-cat">Prep items (made in batches)</div>` + preps.map((p) => {
        const cost = linesCost(prepLines(p.id)) ;
        return `<div class="inv-row static">
          <span class="inv-row-name">🍲 ${esc(p.name)} <span class="dim">batch of ${inBuy(p, p.recipe_batch_base)} ≈ ${inr(cost)}</span></span>
          <button class="btn" data-editprep="${p.id}">✎ Recipe</button>
          <button class="btn primary" data-makeprep="${p.id}">Make a batch</button>
        </div>`;
      }).join("") : ""}</div>
      <div class="inv-cat">Dishes</div>
      <div id="rcDishList"></div>`;
    const drawDishes = (q) => {
      const rows = dishes.filter((d) => !q || d.title.toLowerCase().includes(q));
      $("#rcDishList").innerHTML = rows.map((d) => {
        const lines = dishLines(d.slug);
        const cost = linesCost(lines);
        const margin = d.price > 0 && lines.length ? Math.round((1 - cost / d.price) * 100) : null;
        return `<button class="inv-row" data-dish="${esc(d.slug)}">
          <span class="inv-row-name">${esc(d.title)}${lines.length ? "" : ` <span class="inv-badge low">no recipe</span>`}</span>
          <span class="inv-row-qty">${lines.length ? `cost ${inr(cost)} / ₹${d.price}` : `₹${d.price}`}</span>
          <span class="inv-row-val${margin != null && margin < 50 ? " out" : ""}">${margin != null ? margin + "% margin" : "—"}</span>
        </button>`;
      }).join("") || `<div class="empty">No dishes match.</div>`;
      body.querySelectorAll("[data-dish]").forEach((r) => { r.onclick = () => recipePop("dish", r.dataset.dish, dishes.find((d) => d.slug === r.dataset.dish)); });
    };
    drawDishes("");
    $("#rcSearch").oninput = (e) => drawDishes(e.target.value.trim().toLowerCase());
    body.querySelectorAll("[data-editprep]").forEach((b) => { b.onclick = () => recipePop("prep", b.dataset.editprep, itemById(b.dataset.editprep)); });
    body.querySelectorAll("[data-makeprep]").forEach((b) => { b.onclick = () => makeBatchPop(itemById(b.dataset.makeprep)); });
    $("#rcAddPrep").onclick = () => {
      const candidates = S.items.filter((i) => i.active && i.track_level !== "EXPENSE" && !i.recipe_batch_base);
      if (!candidates.length) return toastMsg("Add the prep item as an ingredient first (e.g. “Gravy base”), then give it a recipe here.");
      openPop("inv-pickprep", `<h3>🍲 New prep recipe</h3>
        <p class="dim">Pick the ingredient this recipe MAKES (add it in Stock first if it doesn't exist yet — e.g. “Gravy base”).</p>
        <label>Prep item <select id="ppkItem">${candidates.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("")}</select></label>
        <div class="inv-pop-actions"><button class="btn" id="ppkCancel">Cancel</button><span style="flex:1"></span><button class="btn primary" id="ppkGo">Next</button></div>`,
        (pop) => {
          $("#ppkCancel", pop).onclick = closePop;
          $("#ppkGo", pop).onclick = () => { const it = itemById($("#ppkItem", pop).value); recipePop("prep", it.id, it); };
        });
    };
  }

  // The shared recipe editor: for a DISH (per plate, shows margin) or a PREP item
  // (per batch, asks the batch size). Lines are typed in each ingredient's BASE unit.
  function recipePop(kind, key, subject) {
    const existing = (kind === "dish" ? dishLines(key) : prepLines(key)).map((l) => ({ item_id: l.item_id, qty_base: Number(l.qty_base) }));
    const lines = existing.slice();
    const pickable = S.items.filter((i) => i.active && i.track_level !== "EXPENSE" && i.id !== key);
    const title = kind === "dish" ? (subject ? subject.title : key) : (subject ? subject.name : "Prep");
    openPop("inv-recipe", `
      <h3>🍛 ${esc(title)} — recipe</h3>
      ${kind === "prep" ? `<label class="inv-factor">One batch makes <input id="rpBatch" type="number" inputmode="decimal" min="0.001" step="any"
          value="${subject && subject.recipe_batch_base ? Math.round((Number(subject.recipe_batch_base) / Number(subject.purchase_factor)) * 100) / 100 : ""}" /> <span>${esc(subject ? subject.purchase_uom : "")}</span></label>`
        : `<p class="dim">Ingredients for ONE plate. Stock deducts automatically when an order reaches the kitchen.</p>`}
      <div class="inv-lines" id="rpLines"></div>
      <div class="inv-addline">
        <select id="rpItem"><option value="">+ ingredient…</option>${pickable.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("")}</select>
        <input id="rpQty" type="number" inputmode="decimal" min="0" step="any" placeholder="qty" />
        <span id="rpUom" class="dim"></span>
        <button class="btn" id="rpAdd">Add</button>
      </div>
      <div class="inv-total" id="rpTotal"></div>
      <div class="inv-pop-actions">
        <button class="btn" id="rpCancel">Cancel</button><span style="flex:1"></span>
        <button class="btn primary" id="rpSave">Save recipe</button>
      </div>`, (pop) => {
      const sel = $("#rpItem", pop);
      sel.onchange = () => { const it = itemById(sel.value); $("#rpUom", pop).textContent = it ? it.base_uom : ""; };
      const redraw = () => {
        $("#rpLines", pop).innerHTML = lines.map((l, n) => {
          const it = itemById(l.item_id) || { name: "?", base_uom: "", avg_cost: 0 };
          return `<div class="inv-line"><span>${esc(it.name)}</span><span>${l.qty_base} ${esc(it.base_uom)}</span><b>${inr(l.qty_base * Number(it.avg_cost))}</b><button class="inv-x" data-n="${n}">✕</button></div>`;
        }).join("") || `<div class="empty">No ingredients yet.</div>`;
        const cost = linesCost(lines);
        const priceBit = kind === "dish" && subject && subject.price > 0 && lines.length
          ? ` · sells ₹${subject.price} · <b>${Math.round((1 - cost / subject.price) * 100)}% margin</b>` : "";
        $("#rpTotal", pop).innerHTML = `${kind === "dish" ? "Plate cost" : "Batch cost"}: <b>${inr(cost)}</b>${priceBit}`;
        pop.querySelectorAll(".inv-x").forEach((x) => { x.onclick = () => { lines.splice(Number(x.dataset.n), 1); redraw(); }; });
      };
      redraw();
      $("#rpAdd", pop).onclick = () => {
        const it = itemById(sel.value); const qty = Number($("#rpQty", pop).value);
        if (!it) return toastMsg("Pick an ingredient");
        if (!(qty > 0)) return toastMsg("Enter the quantity");
        const ex = lines.find((l) => l.item_id === it.id);
        if (ex) ex.qty_base = qty; else lines.push({ item_id: it.id, qty_base: qty });
        sel.value = ""; $("#rpQty", pop).value = ""; $("#rpUom", pop).textContent = "";
        redraw();
      };
      $("#rpCancel", pop).onclick = closePop;
      $("#rpSave", pop).onclick = async () => {
        const payload = { lines };
        if (kind === "prep") {
          const b = Number($("#rpBatch", pop).value);
          if (!(b > 0)) return toastMsg("Say how much one batch makes");
          payload.batch_base = b * Number(subject.purchase_factor);
        }
        try {
          await inv("POST", `/recipes/${kind}/${encodeURIComponent(key)}`, payload);
          toastMsg("Recipe saved");
          closePop();
          await reloadItems();
          refreshView();
        } catch (e) { toastMsg("⚠️ " + e.message); }
      };
    });
  }

  function makeBatchPop(it) {
    openPop("inv-batch", `
      <h3>🍲 Make a batch — ${esc(it.name)}</h3>
      <p class="dim">Ingredients come out of stock, the made quantity goes in — at the batch's real cost.</p>
      <label class="inv-factor">Made <input id="mbQty" type="number" inputmode="decimal" min="0.001" step="any"
        value="${Math.round((Number(it.recipe_batch_base) / Number(it.purchase_factor)) * 100) / 100}" /> <span>${esc(it.purchase_uom)}</span></label>
      <div class="inv-pop-actions"><button class="btn" id="mbCancel">Cancel</button><span style="flex:1"></span><button class="btn primary" id="mbGo">Record batch</button></div>`,
      (pop) => {
        $("#mbCancel", pop).onclick = closePop;
        $("#mbGo", pop).onclick = async () => {
          const qty = Number($("#mbQty", pop).value);
          if (!(qty > 0)) return toastMsg("Enter how much you made");
          const btn = $("#mbGo", pop); btn.disabled = true;
          try {
            const r = await inv("POST", "/production", { item_id: it.id, qty_base: qty * Number(it.purchase_factor) });
            toastMsg(`Batch recorded — cost ${inr(r.cost)}`);
            closePop();
            await reloadItems();
            refreshView();
          } catch (e) { toastMsg("⚠️ " + e.message); btn.disabled = false; }
        };
      });
  }

  // ═════════════════════════════ USAGE / VARIANCE (Stage 2) ═════════════════════
  // Where did stock go: bought in, used by orders (from recipes), wasted, and count
  // corrections — the corrections column IS the unexplained difference the counts found.
  function renderUsage(body) {
    const rows = (S.usage.rows || []).map((r) => ({ ...r, it: itemById(r.item_id) })).filter((r) => r.it);
    const tot = (k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
    const days = S.usage.days;
    rows.sort((a, b) => Math.abs(Number(b.adjusted_val)) - Math.abs(Number(a.adjusted_val)));
    body.innerHTML = `
      <div class="inv-toolbar">
        <span class="inv-inline">${[7, 30, 90].map((d) => `<button class="inv-pill${days === d ? " on" : ""}" data-days="${d}">${d} days</button>`).join("")}</span>
      </div>
      <div class="inv-statrow">
        <div class="inv-stat"><span>Used by orders</span><b>${inr(-tot("consumed_val"))}</b></div>
        <div class="inv-stat"><span>Wasted</span><b>${inr(-tot("wasted_val"))}</b></div>
        <div class="inv-stat${tot("adjusted_val") < -1 ? " bad" : ""}"><span>Count corrections</span><b>${inr(tot("adjusted_val"))}</b></div>
      </div>
      <div class="inv-note soft">“Count corrections” is stock the counts found missing (−) or extra (+) beyond orders and logged waste — the closest thing to a leak meter. Map more recipes to make it sharper.</div>
      ${rows.length ? rows.map((r) => `
        <div class="inv-row static">
          <span class="inv-row-name">${esc(r.it.name)}
            <span class="dim block">bought ${inBuy(r.it, r.purchased_base)} · used ${inBuy(r.it, -r.consumed_base)} · wasted ${inBuy(r.it, -r.wasted_base)}</span></span>
          <span class="inv-row-val ${Number(r.adjusted_val) < -0.01 ? "out" : Number(r.adjusted_val) > 0.01 ? "in" : "dim"}">${Number(r.adjusted_base) ? (Number(r.adjusted_base) > 0 ? "+" : "") + inBuy(r.it, r.adjusted_base) + " · " + inr(r.adjusted_val) : "—"}</span>
        </div>`).join("") : `<div class="empty">No stock movement in the last ${days} days.</div>`}`;
    body.querySelectorAll("[data-days]").forEach((b) => {
      b.onclick = () => { S.usageDays = Number(b.dataset.days); refreshView(); };
    });
  }

  // ═════════════════════════════ EXPENSES ═════════════════════════════
  const EXP_LABELS = { breakage: "🔨 Breakage", repair: "🛠️ Repair", utilities: "💡 Utilities", cleaning: "🧹 Cleaning", supplies: "📦 Supplies", rent: "🏠 Rent", transport: "🛵 Transport", misc: "🧾 Other" };
  function renderExpenses(body) {
    const d = S.expenses || { month: "", expenses: [], totals: {}, total: 0 };
    const monthLabel = d.month ? new Date(d.month + "-01").toLocaleString("en-IN", { month: "long", year: "numeric" }) : "";
    body.innerHTML = `
      <div class="inv-toolbar">
        <span class="inv-inline"><button class="btn" id="exPrev">‹</button><b style="min-width:130px;text-align:center">${esc(monthLabel)}</b><button class="btn" id="exNext">›</button></span>
        <button class="btn primary" id="invNewExp">+ Add expense</button>
      </div>
      <div class="inv-statrow">
        <div class="inv-stat"><span>This month</span><b>${inr(d.total)}</b></div>
        ${Object.entries(d.totals).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `<div class="inv-stat"><span>${EXP_LABELS[k] || k}</span><b>${inr(v)}</b></div>`).join("")}
      </div>
      ${(d.expenses || []).length ? d.expenses.map((e) => `
        <div class="inv-row static${e.voided_at ? " voided" : ""}">
          <span class="inv-row-name">${EXP_LABELS[e.category] || esc(e.category)} — ${esc(e.title)}${e.voided_at ? ` <span class="inv-badge neg">struck out</span>` : ""}
            <span class="dim block">${esc(e.expense_date)} · ${esc(e.created_by || "")}${e.note ? " · " + esc(e.note) : ""}</span></span>
          ${e.photo_url ? `<a class="inv-thumb" href="${esc(e.photo_url)}" target="_blank" rel="noopener"><img src="${esc(e.photo_url)}" alt="" /></a>` : ""}
          <span class="inv-row-val">${inr(e.amount)}</span>
          ${!e.voided_at ? `<button class="inv-x" data-voidexp="${e.id}" title="Strike out">✕</button>` : ""}
        </div>`).join("") : `<div class="empty">No expenses recorded in ${esc(monthLabel)}.</div>`}`;
    const shiftMonth = (dir) => {
      const [y, m] = (d.month || new Date().toISOString().slice(0, 7)).split("-").map(Number);
      const nd = new Date(Date.UTC(y, m - 1 + dir, 1));
      S.expMonth = nd.toISOString().slice(0, 7);
      refreshView();
    };
    $("#exPrev").onclick = () => shiftMonth(-1);
    $("#exNext").onclick = () => shiftMonth(1);
    $("#invNewExp").onclick = expensePop;
    body.querySelectorAll("[data-voidexp]").forEach((x) => {
      x.onclick = async () => {
        const reason = await askWhy("This is kept on record, so it can be explained later.", "Why strike this out?");
        if (!reason || !reason.trim()) return;
        try {
          await inv("POST", `/expenses/${x.dataset.voidexp}/void`, { reason: reason.trim() });
          toastMsg("Struck out");
          refreshView();
        } catch (e) { toastMsg("⚠️ " + e.message); }
      };
    });
  }

  function expensePop() {
    let category = "";
    openPop("inv-expense", `
      <h3>💸 Add an expense</h3>
      <div class="inv-reasons">${Object.entries(EXP_LABELS).map(([k, l]) => `<button class="inv-reason" data-c="${k}">${l}</button>`).join("")}</div>
      <label>What happened <input id="epTitle" maxlength="120" placeholder="e.g. Bar lamp broken" /></label>
      <div class="inv-grid2">
        <label>Amount (₹) <input id="epAmt" type="number" inputmode="decimal" min="0" step="any" /></label>
        <label>Date <input id="epDate" type="date" value="${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}" /></label>
      </div>
      <div class="inv-grid2">
        <label>Note <input id="epNote" maxlength="300" placeholder="optional" /></label>
        <label>Photo <input id="epPhoto" type="file" accept="image/*" capture="environment" /></label>
      </div>
      <div class="inv-note soft">The owner sees every entry — what, who wrote it, the photo — and the monthly total in their reports.</div>
      <div class="inv-pop-actions"><button class="btn" id="epCancel">Cancel</button><span style="flex:1"></span><button class="btn primary" id="epSave">Save expense</button></div>`, (pop) => {
      pop.querySelectorAll(".inv-reason").forEach((b) => {
        b.onclick = () => { category = b.dataset.c; pop.querySelectorAll(".inv-reason").forEach((x) => x.classList.toggle("on", x === b)); };
      });
      $("#epCancel", pop).onclick = closePop;
      $("#epSave", pop).onclick = async () => {
        const title = $("#epTitle", pop).value.trim();
        const amount = Number($("#epAmt", pop).value);
        if (!category) return toastMsg("Pick a category");
        if (!title) return toastMsg("Say what it was");
        // A BLANK AMOUNT IS NOT ₹0 (sweep #8 T7). `Number("")` is 0, and 0 is both finite and
        // not negative — so leaving the amount box empty passed this gate, posted an expense of
        // ₹0 and answered "Expense recorded". The manager saw a success, the owner's monthly
        // total gained a meaningless row, and the real figure was never captured. Every other
        // quantity box in this file already asks the same question the right way round
        // (`if (!(qty > 0))` in the waste and batch popups); this one now matches them.
        if (!(amount > 0)) return toastMsg("Enter the amount");
        try {
          await inv("POST", "/expenses", { category, title, amount, expense_date: $("#epDate", pop).value, note: $("#epNote", pop).value.trim() || null }, $("#epPhoto", pop).files[0] || null);
          toastMsg("Expense recorded");
          closePop();
          refreshView();
        } catch (e) { toastMsg("⚠️ " + e.message); }
      };
    });
  }

  // ── THE STOCK FIGURES MOVE ON THEIR OWN, SO THE SCREEN HAS TO FOLLOW (T13 sweep, 2026-08-05) ──
  // `trg_inv_deplete_order` (mig 224) posts a consumption movement for every recipe ingredient of
  // every dish on every kitchen-committed order. So during service these numbers change constantly
  // with nobody touching them — and this file had no setInterval, no realtime handler and no
  // visibilitychange hook. Whatever was on screen was frozen at the moment the tab was opened, with
  // nothing saying so: a manager could read "chicken 4.2 kg", decide whether to 86 a dish, and be
  // acting on a figure twenty minutes and thirty orders old. Two managers counting stock on two
  // devices were each certain of a different number.
  //
  // Deliberately driven by the `ops` breadcrumb the manager panel ALREADY receives, not by new
  // triggers on the inv_* tables: stock only moves because an order moved (or because a person did
  // something right here), and a per-ingredient trigger would raise fifteen breadcrumbs for one
  // five-dish order — a firehose aimed at the connection budget. So this costs ZERO extra reads on
  // an idle floor and zero when the tab isn't open.
  //
  // Two guards keep it cheap and safe: only when the Inventory tab is actually showing (its body
  // element is in the document), and never while a popup is open — refreshView() repaints #invBody
  // and would tear a half-finished count or purchase out from under the person filling it in.
  let bumpTimer = null;
  function liveBump() {
    const body = document.getElementById("invBody");
    if (!body || !body.offsetParent) return;              // tab not on screen → nothing to refresh
    if (document.hidden) return;                          // backgrounded → the wake event will do it
    if (document.querySelector(".inv-pop, #invPop")) return; // someone is mid-entry — never clobber it
    clearTimeout(bumpTimer);
    // Coalesce a rush: a burst of orders is one refresh, not one per order.
    bumpTimer = setTimeout(() => { refreshView(true).catch(() => {}); }, 1200);
  }

  // Public surface for app.js
  window.LFH_INV = {
    render,
    reset() { S.loaded = false; S.count = null; },   // admin switches restaurant → refetch
    // Called from app.js's realtime `ops` handler — see liveBump above.
    live: liveBump,
  };
})();
