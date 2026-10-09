// A stand-in for the service-role Supabase client: enough of the query builder for the manager
// route's gate paths, backed by the shared fixtures in state.mjs. Records every write so a test
// can assert what the handler actually did. No socket is ever opened.
import { G } from "./state.mjs";
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
function builder(table) {
  const st = { table, filters: [], op: "select", patch: null, head: false };
  const match = (row) => st.filters.every((f) => {
    const v = row[f.col];
    if (f.kind === "eq") return String(v) === String(f.val);
    if (f.kind === "neq") return String(v) !== String(f.val);
    if (f.kind === "is") return f.val === null ? (v === null || v === undefined) : v === f.val;
    if (f.kind === "not_is") return !(v === null || v === undefined);
    if (f.kind === "in") return (f.val || []).map(String).includes(String(v));
    if (f.kind === "gte") return String(v) >= String(f.val);
    if (f.kind === "lt") return String(v) < String(f.val);
    return true;
  });
  const rows = () => (G.FIX[st.table] || []).filter(match);
  const api = {
    select(_c, opts) { st.op = st.op === "select" ? "select" : st.op; if (opts && opts.head) st.head = true; return api; },
    update(p) { st.op = "update"; st.patch = p; return api; },
    insert(p) { st.op = "insert"; st.patch = p; return api; },
    delete() { st.op = "delete"; return api; },
    upsert(p) { st.op = "upsert"; st.patch = p; return api; },
    eq(col, val) { st.filters.push({ kind: "eq", col, val }); return api; },
    neq(col, val) { st.filters.push({ kind: "neq", col, val }); return api; },
    is(col, val) { st.filters.push({ kind: "is", col, val }); return api; },
    not(col, kind, val) { st.filters.push(kind === "is" && val === null ? { kind: "not_is", col } : { kind: "eq", col, val }); return api; },
    in(col, val) { st.filters.push({ kind: "in", col, val }); return api; },
    gte(col, val) { st.filters.push({ kind: "gte", col, val }); return api; },
    lt(col, val) { st.filters.push({ kind: "lt", col, val }); return api; },
    or() { return api; }, ilike() { return api; }, contains() { return api; },
    order() { return api; }, limit() { return api; },
    // OPT-IN PAGING (sweep #10 T9, 2026-10-09). range() used to be a no-op, so a handler that pages
    // "until a short page" (the Z-report, the GST report, the dashboard) was handed the SAME rows
    // on every page and looped to its safety cap. A guard sets G.HONOUR_RANGE = true to get real
    // offsets; nothing changes for a guard that does not.
    range(a, b) { st.range = [a, b]; return api; },
    single() { return settle(true); },
    maybeSingle() { return settle(true); },
    then(res, rej) { return settle(false).then(res, rej); },
  };
  function settle(one) {
    // OPT-IN FAILURES (sweep #10 T17 round 4). A guard may set G.FAIL["table:op"] (or G.FAIL["table"]) to "error" or
    // "throw", or G.FAIL_NTH["table:op"] = { at: n, mode } to fail only the n-th such call — so "the database blipped
    // on THIS read" can be proved instead of assumed. Nothing changes for a guard that sets neither.
    const ck = st.table + ":" + st.op;
    if (G.FAIL || G.FAIL_NTH) {
      G.CALLS ||= {}; G.CALLS[ck] = (G.CALLS[ck] || 0) + 1;
      const nth = G.FAIL_NTH && G.FAIL_NTH[ck];
      const mode = nth && nth.at === G.CALLS[ck] ? nth.mode : G.FAIL && (G.FAIL[ck] || G.FAIL[st.table]);
      if (mode === "throw") return Promise.reject(new Error("stub: " + st.table + " unreachable"));
      if (mode === "error") return Promise.resolve({ data: null, error: { message: "stub: " + st.table + " failed" }, count: null });
      // "refuse" = the database refusing the VALUE (22P02, e.g. a non-id in a uuid column) — a 4xx, never a retry.
      if (mode === "refuse") return Promise.resolve({ data: null, error: { message: 'invalid input syntax for type uuid: "x"', code: "22P02" }, count: null });
    }
    const found = rows();
    // Every trip is recorded, reads included — see the note on G.READS in state.mjs.
    if (st.op === "select") (G.READS ||= []).push({ table: st.table, op: "select", matched: found.length, at: (G.READS || []).length });
    if (st.op !== "select") {
      G.WRITES.push({ table: st.table, op: st.op, patch: clone(st.patch ?? null), matched: found.length, at: G.WRITES.length });
      if (st.op === "update") for (const r of found) Object.assign(r, st.patch);
      if (st.op === "insert" || st.op === "upsert") {
        const list = Array.isArray(st.patch) ? st.patch : [st.patch];
        for (const r of list) (G.FIX[st.table] ||= []).push({ id: "new-" + Math.random().toString(36).slice(2, 8), ...r });
      }
      if (st.op === "delete") G.FIX[st.table] = (G.FIX[st.table] || []).filter((r) => !match(r));
    }
    if (st.head) return Promise.resolve({ data: null, error: null, count: found.length });
    // A DELETE'S RETURNING SELECT HANDS BACK THE ROWS IT REMOVED (sweep #8 T25, improvement 6).
    // This re-read the table AFTER deleting, so `.delete().select()` always came back EMPTY — the
    // opposite of what PostgREST does. Measured against the dev database with a throwaway row:
    // a real delete answers [{...}] and a delete that matched nothing answers [] with no error.
    // The old shape made the stub unable to tell those two apart, so any guard checking "did this
    // delete actually remove anything" read as a refusal on a delete that worked.
    let src = st.op === "select" ? found : st.op === "delete" ? found : (G.FIX[st.table] || []).filter(match);
    if (G.HONOUR_RANGE && st.range && st.op === "select") src = src.slice(st.range[0], st.range[1] + 1);
    return Promise.resolve({ data: one ? (src[0] ? clone(src[0]) : null) : clone(src), error: null, count: src.length });
  }
  return api;
}
export const supabaseAdmin = {
  from: (t) => builder(t),
  // A guard may hand the stub a stand-in for a real database function (G.RPC_IMPL[name] = (args) => data), so a
  // function that WRITES — like lfh_staff_login_failed (mig 411) — changes the fixture world the way the SQL does.
  rpc: (name, args) => { G.RPCS.push({ name, args: clone(args || {}) }); const fm = G.FAIL && G.FAIL["rpc:" + name]; if (fm === "throw") return Promise.reject(new Error("stub: rpc " + name + " unreachable")); if (fm === "error") return Promise.resolve({ data: null, error: { message: "stub: rpc " + name + " failed" } }); if (G.RPC_IMPL && G.RPC_IMPL[name]) return Promise.resolve({ data: G.RPC_IMPL[name](clone(args || {})), error: null }); return Promise.resolve({ data: name in G.RPC_ANSWERS ? G.RPC_ANSWERS[name] : { ok: true }, error: null }); },
};
