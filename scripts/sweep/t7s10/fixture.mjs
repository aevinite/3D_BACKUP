// scripts/sweep/t7s10/fixture.mjs — an IN-MEMORY party at one table, for driving my third's screens
// without writing a single row. The panel's own state is swapped for the duration of `body` and
// restored in a finally (and the floor redrawn), so the real board is back the moment it ends.
//
// WITH(spec, body) returns an expression string for ev(). spec:
//   { t, sessions: true|false, orders: [{ id, status, pay, items: [{ title, qty, status, price, is_mrp }], allergies, mins, discount }],
//     invoice: null | { no, voided, atMinsAgo }, calls: [...], requests: [...], joiners: [...] }
export const WITH = (spec, body) => `(async () => {
  const SPEC = ${JSON.stringify(spec)};
  const T = String(SPEC.t || (parseInt(state.data.settings.table_count, 10) || 12));
  const now = Date.now(), iso = (m) => new Date(now - m * 60000).toISOString();
  const keep = { orders: state.data.orders, calls: state.data.calls, sessions: state.board.sessions, items: state.board.items,
    requests: state.board.requests, summary: state.summary, settings: { ...state.data.settings }, tableSlices: state.tableSlices };
  const sid = "t7s10-sess-" + T;
  const sess = SPEC.noSession ? null : { id: sid, table_number: T, status: "open", opened_at: iso(SPEC.openedMins || 40), auto_approve: true,
    invoice_no: SPEC.invoice ? SPEC.invoice.no : null, invoice_voided: !!(SPEC.invoice && SPEC.invoice.voided),
    invoice_at: SPEC.invoice ? iso(SPEC.invoice.atMinsAgo || 10) : null, bill_no: SPEC.billNo || null, discount: SPEC.sessDiscount || 0 };
  const orders = (SPEC.orders || []).map((o, i) => {
    const items = (o.items || []).map((it) => ({ title: it.title, qty: it.qty || 1, status: it.status || o.status, price: String(it.price ?? 100), is_mrp: !!it.is_mrp, tax_mode: it.tax_mode || null }));
    const sub = items.reduce((a, it) => a + Number(it.price) * it.qty, 0);
    return { id: o.id || ("t7s10-ord-" + i), table_number: T, session_id: sess ? sid : null, status: o.status || "preparing",
      payment_status: o.pay || "pending", archived: false, created_at: iso(o.mins ?? (30 - i)), kot_no: o.kot ?? (900 + i),
      items, subtotal: sub, tax: Math.round(sub * 0.05 * 100) / 100, total: Math.round((sub - (o.discount || 0)) * 1.05 * 100) / 100,
      discount: o.discount || 0, allergies: o.allergies || [], taxable_base: sub, nontax_amount: 0, mrp_amount: 0, tax_rate: SPEC.taxRate ?? 0.05 };
  });
  const items = orders.flatMap((o, i) => (SPEC.orders[i].legacy ? [] : o.items.map((it, j) => ({ id: o.id + "-it" + j, order_id: o.id, title: it.title, qty: it.qty, status: it.status, unit_price: it.price, removed: [], note: "", is_mrp: it.is_mrp }))));
  // FREEZE THE NETWORK'S HAND ON THE BOARD for the duration: while floorOpsInFlight > 0 the panel
  // does not let a server answer overwrite the summary or a slice (its own optimistic-write rule),
  // and a table slice read is answered by the fixture itself.
  const keepSlice = loadTableSlice;
  floorOpsInFlight++;
  loadTableSlice = async () => {};
  try {
    state.data.orders = (keep.orders || []).filter((o) => String(o.table_number) !== T).concat(orders);
    state.board.sessions = (keep.sessions || []).filter((s) => String(s.table_number) !== T).concat(sess ? [sess] : []);
    state.board.items = (keep.items || []).filter((x) => !orders.some((o) => o.id === x.order_id)).concat(items);
    state.data.calls = (keep.calls || []).filter((c) => String(c.table_number) !== T).concat((SPEC.calls || []).map((c, i) => ({ id: "t7s10-call-" + i, table_number: T, resolved: false, created_at: iso(c.mins || 1), type: c.type || "waiter", session_id: sess ? sid : null })));
    state.board.requests = (keep.requests || []).filter((r) => String(r.table_number) !== T).concat((SPEC.requests || []).map((r, i) => ({ id: "t7s10-req-" + i, table_number: T, type: r.type || "join", created_at: iso(r.mins || 1), name: r.name || "Guest" })));
    if (SPEC.settings) Object.assign(state.data.settings, SPEC.settings);
    // The floor tile of an UNSELECTED table is drawn from the slim summary, so the same party is
    // written there too — computed by the panel's own parity reference (tableTileStateFromBoard).
    const b = tableTileStateFromBoard(T);
    state.summary = Object.assign({}, keep.summary, { tiles: Object.assign({}, (keep.summary || {}).tiles, { [T]: { state: b.st, label: b.label, meta: b.meta, counts: b.counts, pay: b.pay, members: b.guests, hasNew: b.hasNew, hasCall: b.hasCall, hasReq: b.hasReq, hasJoin: b.hasJoin, due: b.due } }),
      calls: ((keep.summary || {}).calls || []).concat(state.data.calls.filter((c) => String(c.table_number) === T)) });
    return await (async () => { ${body} })();
  } finally {
    loadTableSlice = keepSlice;
    floorOpsInFlight = Math.max(0, floorOpsInFlight - 1);
    if (!SPEC.keepOpen) { try { (state.floatingTables || []).slice().forEach((f) => { if (String(f.table) === T) closeFloatingTable(T); }); } catch {} }
    state.data.orders = keep.orders; state.data.calls = keep.calls; state.board.sessions = keep.sessions; state.board.items = keep.items;
    state.board.requests = keep.requests; state.summary = keep.summary; state.tableSlices = keep.tableSlices;
    for (const k of Object.keys(state.data.settings)) if (!(k in keep.settings)) delete state.data.settings[k];
    Object.assign(state.data.settings, keep.settings);
    document.querySelectorAll('.sx-modal-overlay, .kotmenu-overlay, [data-floating-table]').forEach((x) => { if (x.closest && x.closest('#editor')) return; });
  }
})()`;
