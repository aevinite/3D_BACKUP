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

  async function inv(method, path, body, photoFile) {
    const url = "/api/inventory" + scoped(path);
    const opts = { method, headers: {} };
    if (method !== "GET") {
      // Every write carries an action id so the server's withIdempotency guard makes a
      // network retry / double-tap run at most once (same rule as the ordering paths).
      opts.headers["X-LFH-Action-Id"] = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
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
    const res = await fetch(url, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || res.statusText);
    return json;
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
          await inv("POST", isNew ? "/items" : "/items/" + it.id, payload);
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
      $("#ppAdd", pop).onclick = () => {
        const item_id = sel.value, qty = Number($("#ppQty", pop).value), rate = Number($("#ppRate", pop).value);
        if (!item_id) return toastMsg("Pick an item");
        if (!(qty > 0)) return toastMsg("Enter the quantity");
        if (!(rate >= 0)) return toastMsg("Enter the rate");
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
        const reason = prompt("Why is this purchase being voided? (kept on record)");
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
        S.count.lines.set(itemId, val);
        try {
          await inv("POST", `/counts/${S.count.id}/line`, { item_id: itemId, counted_base: buyQty * Number(it.purchase_factor) });
          $("#ccSavedNote").textContent = "saved ✓";
          setTimeout(() => { const n = $("#ccSavedNote"); if (n) n.textContent = ""; }, 1500);
        } catch (e) { toastMsg("⚠️ " + e.message); }
      };
    });
    $("#ccDiscard").onclick = async () => {
      if (!confirm("Throw this draft count away?")) return;
      try { await inv("POST", `/counts/${S.count.id}/discard`); } catch {}
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
        const reason = prompt("Why strike this out? (kept on record)");
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
        const reason = prompt("Why strike this out? (kept on record)");
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
        if (!Number.isFinite(amount) || amount < 0) return toastMsg("Enter the amount");
        try {
          await inv("POST", "/expenses", { category, title, amount, expense_date: $("#epDate", pop).value, note: $("#epNote", pop).value.trim() || null }, $("#epPhoto", pop).files[0] || null);
          toastMsg("Expense recorded");
          closePop();
          refreshView();
        } catch (e) { toastMsg("⚠️ " + e.message); }
      };
    });
  }

  // Public surface for app.js
  window.LFH_INV = {
    render,
    reset() { S.loaded = false; S.count = null; },   // admin switches restaurant → refetch
  };
})();
