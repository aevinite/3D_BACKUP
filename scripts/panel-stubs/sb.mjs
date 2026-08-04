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
    order() { return api; }, limit() { return api; }, range() { return api; },
    single() { return settle(true); },
    maybeSingle() { return settle(true); },
    then(res, rej) { return settle(false).then(res, rej); },
  };
  function settle(one) {
    const found = rows();
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
    const src = st.op === "select" ? found : (G.FIX[st.table] || []).filter(match);
    return Promise.resolve({ data: one ? (src[0] ? clone(src[0]) : null) : clone(src), error: null, count: src.length });
  }
  return api;
}
export const supabaseAdmin = {
  from: (t) => builder(t),
  rpc: (name, args) => { G.RPCS.push({ name, args: clone(args || {}) }); return Promise.resolve({ data: name in G.RPC_ANSWERS ? G.RPC_ANSWERS[name] : { ok: true }, error: null }); },
};
