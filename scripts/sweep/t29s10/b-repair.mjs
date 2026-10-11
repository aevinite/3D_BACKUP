// Section B — the Repair Kit (/api/admin/repair). Emergency surgery during live service: void a bill,
// delete an order, re-fire to the kitchen, unstick a table, move an order's time. Read for every rule,
// then DRIVEN only along paths that must refuse or answer "already done" — so no bill, order or table
// changes. French House for the drives; Aangan only read.
export default function section(c) {
  const F = "app/api/admin/repair/route.ts";
  const S = () => c.clean(F);
  const op = (name) => { const s = S(); const a = s.indexOf(`op === "${name}"`); const b = s.indexOf("if (op === ", a + 5); return s.slice(a, b > -1 ? b : s.indexOf('return err("unknown repair op")')); };

  c.sec("B · Repair Kit — read for every rule");
  c.phase("the pick-list read names its columns and carries NO money column (the admin sees no earnings)",
    `read ${F} GET: the sessions and orders selects`, () => {
      const g = c.handlers(F).GET;
      return /select\("id, table_number, status, bill_no, invoice_no, invoice_voided"\)/.test(g) && /select\("id, table_number, kot_no, status, payment_status, created_at, session_id"\)/.test(g) && !/total|discount|amount/.test(g.match(/select\([^)]*\)/g).join()) || "a money column reached the pick-list";
    });
  c.phase("…both lists are scoped to the one restaurant asked for and bounded (300 tables, 60 orders)",
    "read the two chains", () => (c.handlers(F).GET.match(/\.eq\("restaurant_id", rid\)/g) || []).length === 2 && /\.limit\(300\)/.test(c.handlers(F).GET) && /\.limit\(60\)/.test(c.handlers(F).GET));
  c.phase("…only live work is offered: open/pending tables, unarchived orders",
    "read the filters", () => /\.in\("status", \["open", "pending"\]\)/.test(S()) && /\.eq\("archived", false\)/.test(S()));
  c.phase("every repair needs a written reason, trimmed and capped at 200 characters",
    "read the handler head", () => /const reason = String\(body\.reason \|\| ""\)\.trim\(\)\.slice\(0, 200\);/.test(S()) && /if \(!reason\) return err\("A reason is required for every repair\."\)/.test(S()));
  c.phase("the restaurant id is shape-checked before anything else is read",
    "read the order of checks", () => S().indexOf('if (!UUID.test(rid)) return err("invalid restaurant_id")') < S().indexOf("readOne<"));
  for (const o of ["void_bill", "delete_order", "refire_order", "unstick_table", "edit_time"]) {
    c.phase(`${o}: its target id is shape-checked before any read`, `read the ${o} branch`,
      () => /if \(!UUID\.test\((sessionId|orderId)\)\) return err\("invalid (session|order)_id"\)/.test(op(o)) && op(o).search(/UUID\.test/) < op(o).search(/readOne|sb\./));
    c.phase(`${o}: the row is read scoped to this restaurant AND its id, through readOne (absent ≠ unreadable)`, `read the ${o} branch`,
      () => /readOne</.test(op(o)) || "reads its row another way");
  }
  c.phase("readOne itself filters on BOTH the id and the restaurant", "read readOne",
    () => /\.eq\("id", id\)\.eq\("restaurant_id", rid\)\.maybeSingle\(\)/.test(S()));
  c.phase("void_bill refuses a bill that has no invoice yet (409, in words)", "read void_bill",
    () => /if \(!owns\.invoice_no\) return err\("This bill has no invoice to void\.", 409\)/.test(op("void_bill")));
  c.phase("void_bill refuses a bill already reopened, in the manager's own words", "read void_bill",
    () => /if \(owns\.invoice_voided\) return err\("This bill is already reopened — it's open for edits right now\.", 409\)/.test(op("void_bill")));
  c.phase("void_bill reads the bill's total BEFORE reopening it, and refuses if that read fails", "read void_bill",
    () => { const v = op("void_bill"); return v.indexOf("beforeQ.error") > -1 && v.indexOf("beforeQ.error") < v.indexOf('rpc("lfh_void_invoice"'); });
  c.phase("void_bill names who did it in the invoice history (p_actor)", "read the RPC call",
    () => /p_actor: "Admin \(repair\)"/.test(op("void_bill")));
  c.phase("void_bill writes the reopen into the Removals record with the amount it stood at", "read the recordRemoval call",
    () => /kind: "invoice_voided"[\s\S]*amount: wasTotal/.test(op("void_bill")));
  c.phase("delete_order is a SOFT delete — the shared tombstone, never a SQL DELETE", "read delete_order",
    () => /softDeleteOrders\(/.test(op("delete_order")) && !/\.delete\(\)/.test(op("delete_order")));
  c.phase("delete_order records the removal ONLY after the delete's own count says something went", "read delete_order (item 3)",
    () => op("delete_order").indexOf("if (deleted === 0) return already()") < op("delete_order").indexOf("recordRemoval("));
  c.phase("refire_order refuses an order whose table is not a plain number", "read refire_order",
    () => /if \(!\/\^\\d\+\$\/\.test\(table\)\) return err\(/.test(op("refire_order")));
  c.phase("refire_order refuses an order with no dishes", "read refire_order", () => /if \(!items\.length\) return err\("That order has no dishes to re-fire\."\)/.test(op("refire_order")));
  c.phase("refire_order turns each of the four kitchen refusals into its own sentence", "read the ok:false branch",
    () => ["duplicate", "sold_out", "unknown_item", "price_required"].every((k) => op("refire_order").includes(`placed.reason === "${k}"`)));
  c.phase("refire_order never calls a re-fire with no kitchen ticket a success", "read the kot_no check",
    () => /if \(!placed\?\.kot_no\) \{\s*return err\(/.test(op("refire_order")));
  c.phase("refire_order's 'cancel the old one' tells the truth when the cancel fails", "read cancel_old",
    () => /oldCancelled = !c\.error/.test(op("refire_order")) && /oldCancelFailed: true/.test(op("refire_order")));
  c.phase("unstick_table does not record a repair on a table that is already closed", "read unstick_table",
    () => { const u = op("unstick_table"); return u.indexOf('owns.status === "closed"') > -1 && u.indexOf('owns.status === "closed"') < u.indexOf("logRepair("); });
  c.phase("unstick_table clears the table's leftover waiter calls / signals after closing it", "read unstick_table",
    () => op("unstick_table").indexOf("clearTableSignals(") > op("unstick_table").indexOf("closeSession("));
  c.phase("edit_time refuses a date it cannot read, and a year outside 2020-2100", "read edit_time",
    () => /if \(isNaN\(d\.getTime\(\)\)\) return err\("Pick a valid date and time\."\)/.test(op("edit_time")) && /if \(yr < 2020 \|\| yr > 2100\)/.test(op("edit_time")));
  c.phase("edit_time's update is scoped to the order AND the restaurant", "read the update",
    () => /update\(\{ created_at: d\.toISOString\(\) \}\)\.eq\("id", orderId\)\.eq\("restaurant_id", rid\)/.test(op("edit_time")));
  c.phase("every repair leaves a warn-level diary line naming the reason", "read logRepair",
    () => /logAction\("admin", action, \{ restaurant_id: rid, level: "warn", detail: reason/.test(S()));
  c.phase("every repair drops the shared floor snapshot before AND after the write", "read handler + dropFloorAfter",
    () => /invalidateFloor\(rid\);\s*writeRid\.set\(req, rid\)/.test(S()) && /if \(rid\) invalidateFloor\(rid\)/.test(S()));
  c.phase("…and the after-write restaurant rides on the request, never a shared variable", "read writeRid",
    () => /new WeakMap<NextRequest, string>\(\)/.test(S()) && !/^let rid/m.test(S()));
  c.phase("a double press is answered once (the POST is wrapped once-only)", "read the export",
    () => /export const POST = withIdempotency\(dropFloorAfter, "admin"\)/.test(S()));
  c.phase("anything the database refuses reaches the console as a sentence, never its own words (item 10)", "read the catch",
    () => /return adminFail\("that repair"/.test(S()) && !/err\(e instanceof Error \? e\.message/.test(S()));

  c.sec("B · Repair Kit — driven, refusals and already-done answers only (French House)");
  c.phase("the pick-list answers for French House, every table open or pending", "GET ?restaurant_id=<FH>", async () => {
    const r = await c.req(`/api/admin/repair?restaurant_id=${c.FH}`);
    c.cache.repairFH = r.json;
    return r.status === 200 && r.json.sessions.every((s) => ["open", "pending"].includes(s.status)) || `${r.status}`;
  });
  c.phase("…its table count is the database's own count of open/pending tables", "head count on sessions", async () => {
    const n = await c.count("sessions", `restaurant_id=eq.${c.FH}&status=in.(open,pending)`);
    return c.cache.repairFH.sessions.length === Math.min(n, 300) || `route ${c.cache.repairFH.sessions.length}, database ${n}`;
  });
  c.phase("…and every order it offers really belongs to French House and is not archived", "look each one up", async () => {
    const ids = c.cache.repairFH.orders.map((o) => o.id);
    if (!ids.length) return { ok: true, note: "no live orders right now — nothing to cross-check" };
    const rows = (await c.sq(`orders?select=id,restaurant_id,archived&id=in.(${ids.join(",")})`)).json;
    return rows.every((o) => o.restaurant_id === c.FH && o.archived === false) || "an offered order is not French House's, or is archived";
  });
  c.phase("Aangan's pick-list is Aangan's own (read only)", "GET ?restaurant_id=<Aangan>, look the ids up", async () => {
    const r = await c.req(`/api/admin/repair?restaurant_id=${c.AANGAN}`);
    const ids = r.json.sessions.map((s) => s.id);
    if (!ids.length) return { ok: r.status === 200, note: "Aangan has no open tables right now" };
    const rows = (await c.sq(`sessions?select=restaurant_id&id=in.(${ids.join(",")})`)).json;
    return rows.every((x) => x.restaurant_id === c.AANGAN) || "a session of another restaurant appeared";
  });
  c.phase("a malformed restaurant id gets a plain refusal, not a database error", "GET ?restaurant_id=nope",
    async () => { const r = await c.req("/api/admin/repair?restaurant_id=nope"); return r.status === 400 || `${r.status}`; });
  c.phase("a repair with no reason is refused before anything is read", "POST without reason",
    async () => { const r = await c.post("/api/admin/repair", { op: "unstick_table", restaurant_id: c.FH, session_id: c.FH }); return r.status === 400 && /reason is required/.test(r.json?.error) || `${r.status} ${r.json?.error}`; });
  c.phase("a malformed session id on a void is refused in words", "POST void_bill session_id=nope",
    async () => { const r = await c.post("/api/admin/repair", { op: "void_bill", restaurant_id: c.FH, session_id: "nope", reason: "t29 check" }); return r.status === 400 || `${r.status}`; });
  c.phase("voiding a bill that has no invoice yet is refused, and nothing changes", "find a French House table with no invoice; POST void_bill", async () => {
    const s = (await c.sq(`sessions?select=id,invoice_no,invoice_voided,status&restaurant_id=eq.${c.FH}&invoice_no=is.null&limit=1`)).json[0];
    if (!s) return "skip:French House has no table without an invoice right now";
    const r = await c.post("/api/admin/repair", { op: "void_bill", restaurant_id: c.FH, session_id: s.id, reason: "t29 check" });
    const after = (await c.sq(`sessions?select=invoice_no,invoice_voided,status&id=eq.${s.id}`)).json[0];
    return r.status === 409 && /no invoice to void/.test(r.json?.error) && JSON.stringify(after) === JSON.stringify({ invoice_no: s.invoice_no, invoice_voided: s.invoice_voided, status: s.status }) || `${r.status} ${r.json?.error}`;
  });
  c.phase("voiding a bill that is already reopened is refused in the manager's own words", "find one; POST void_bill", async () => {
    const s = (await c.sq(`sessions?select=id&restaurant_id=eq.${c.FH}&invoice_voided=eq.true&invoice_no=not.is.null&limit=1`)).json[0];
    if (!s) return "skip:French House has no reopened bill right now";
    const r = await c.post("/api/admin/repair", { op: "void_bill", restaurant_id: c.FH, session_id: s.id, reason: "t29 check" });
    return r.status === 409 && /already reopened/.test(r.json?.error) || `${r.status} ${r.json?.error}`;
  });
  c.phase("voiding a SETTLED bill says 'issue a credit note instead' and changes nothing (item 10)", "POST void_bill on a closed invoiced table", async () => {
    const s = (await c.sq(`sessions?select=id,status,invoice_voided&restaurant_id=eq.${c.FH}&status=eq.closed&invoice_no=not.is.null&invoice_voided=eq.false&deleted_at=is.null&limit=1`)).json[0];
    if (!s) return "skip:no settled invoiced bill on French House";
    const r = await c.post("/api/admin/repair", { op: "void_bill", restaurant_id: c.FH, session_id: s.id, reason: "t29 check" });
    const a = (await c.sq(`sessions?select=status,invoice_voided&id=eq.${s.id}`)).json[0];
    return r.status === 409 && /credit note/.test(r.json?.error) && a.status === "closed" && a.invoice_voided === false || `${r.status} ${r.json?.error}`;
  });
  c.phase("…and that sentence carries none of the database's own words", "read the same answer", async () => {
    const s = (await c.sq(`sessions?select=id&restaurant_id=eq.${c.FH}&status=eq.closed&invoice_no=not.is.null&invoice_voided=eq.false&deleted_at=is.null&limit=1`)).json[0];
    if (!s) return "skip:no settled invoiced bill on French House";
    const r = await c.post("/api/admin/repair", { op: "void_bill", restaurant_id: c.FH, session_id: s.id, reason: "t29 check" });
    return !/lfh:|exception|violates|constraint/i.test(r.text) || r.text.slice(0, 120);
  });
  c.phase("deleting an order that is already deleted answers 'already deleted' and writes no Removals row (item 3)", "POST delete_order on a tombstoned order", async () => {
    const o = (await c.sq(`orders?select=id&restaurant_id=eq.${c.FH}&deleted_at=not.is.null&limit=1`)).json[0];
    if (!o) return "skip:no deleted order on French House";
    const before = await c.count("deletion_audit", `order_id=eq.${o.id}`);
    const r = await c.post("/api/admin/repair", { op: "delete_order", restaurant_id: c.FH, order_id: o.id, reason: "t29 check" });
    const after = await c.count("deletion_audit", `order_id=eq.${o.id}`);
    return r.status === 200 && r.json.alreadyDeleted === true && before === after || `${r.status} removals ${before}→${after}`;
  });
  c.phase("unsticking a table that is already closed answers 'already closed' and writes no diary line", "POST unstick_table on a closed session", async () => {
    const s = (await c.sq(`sessions?select=id&restaurant_id=eq.${c.FH}&status=eq.closed&limit=1`)).json[0];
    const r = await c.post("/api/admin/repair", { op: "unstick_table", restaurant_id: c.FH, session_id: s.id, reason: "t29 check" });
    const lines = await c.count("staff_actions", `action=eq.repair_unstick_table&created_at=gte.${c.T0}`);
    return r.status === 200 && r.json.alreadyClosed === true && lines === 0 || `${r.status} ${JSON.stringify(r.json)} lines ${lines}`;
  });
  c.phase("the same press sent twice (same once-only id) gets the same answer and does the work once", "POST unstick twice with one X-LFH-Action-Id", async () => {
    const s = (await c.sq(`sessions?select=id&restaurant_id=eq.${c.FH}&status=eq.closed&limit=1`)).json[0];
    const id = crypto.randomUUID(); c.idem.push(id);
    const body = { op: "unstick_table", restaurant_id: c.FH, session_id: s.id, reason: "t29 twice" };
    const a = await c.req("/api/admin/repair", { method: "POST", body, headers: { "X-LFH-Action-Id": id } });
    const b = await c.req("/api/admin/repair", { method: "POST", body, headers: { "X-LFH-Action-Id": id } });
    // The second answer is the STORED first one, marked duplicate:true — compared field by field.
    const norm = (j) => JSON.stringify(Object.keys(j || {}).filter((k) => !["__by", "duplicate"].includes(k)).sort().map((k) => [k, j[k]]));
    return a.status === b.status && norm(a.json) === norm(b.json) && b.json?.duplicate === true || `${a.status}/${b.status} ${JSON.stringify(b.json)}`;
  });
  c.phase("moving an order's time to an unreadable date is refused and the order keeps its time", "POST edit_time created_at=garbage", async () => {
    const o = (await c.sq(`orders?select=id,created_at&restaurant_id=eq.${c.FH}&limit=1`)).json[0];
    const r = await c.post("/api/admin/repair", { op: "edit_time", restaurant_id: c.FH, order_id: o.id, created_at: "not a date", reason: "t29 check" });
    const a = (await c.sq(`orders?select=created_at&id=eq.${o.id}`)).json[0];
    return r.status === 400 && a.created_at === o.created_at || `${r.status}`;
  });
  c.phase("…and to a fat-fingered year (1999) is refused the same way", "POST edit_time 1999", async () => {
    const o = (await c.sq(`orders?select=id,created_at&restaurant_id=eq.${c.FH}&limit=1`)).json[0];
    const r = await c.post("/api/admin/repair", { op: "edit_time", restaurant_id: c.FH, order_id: o.id, created_at: "1999-01-01T10:00:00Z", reason: "t29 check" });
    const a = (await c.sq(`orders?select=created_at&id=eq.${o.id}`)).json[0];
    return r.status === 400 && /check the year/.test(r.json?.error) && a.created_at === o.created_at || `${r.status} ${r.json?.error}`;
  });
  c.phase("re-firing an order whose table is not a plain number is refused before the kitchen hears of it", "POST refire_order on a non-numeric table", async () => {
    const recent = (await c.sq(`orders?select=id,table_number&restaurant_id=eq.${c.FH}&order=created_at.desc&limit=500`)).json || [];
    const o = recent.find((x) => !/^\d+$/.test(String(x.table_number || "")));
    if (!o || /^\d+$/.test(String(o.table_number))) return "skip:French House has no order on a non-numeric table";
    const kot0 = await c.count("orders", `restaurant_id=eq.${c.FH}&created_at=gte.${c.T0}`);
    const r = await c.post("/api/admin/repair", { op: "refire_order", restaurant_id: c.FH, order_id: o.id, reason: "t29 check" });
    const kot1 = await c.count("orders", `restaurant_id=eq.${c.FH}&created_at=gte.${c.T0}`);
    return r.status === 400 && kot0 === kot1 || `${r.status} new orders ${kot0}→${kot1}`;
  });
  c.phase("an unknown repair is refused and nothing is written", "POST op=teleport", async () => {
    const r = await c.post("/api/admin/repair", { op: "teleport", restaurant_id: c.FH, reason: "t29 check" });
    return r.status === 400 && /unknown repair op/.test(r.json?.error) || `${r.status}`;
  });
  c.phase("no refusal above wrote a Removals row or a repair diary line", "count both since this run began", async () => {
    const rm = await c.count("deletion_audit", `restaurant_id=eq.${c.FH}&created_at=gte.${c.T0}`);
    const dl = await c.count("staff_actions", `action=like.repair_*&created_at=gte.${c.T0}`);
    return rm === 0 && dl === 0 || `removals ${rm}, repair lines ${dl}`;
  });
}
