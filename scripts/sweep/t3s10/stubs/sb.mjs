// A stand-in for the service-role Supabase client — just enough of the query builder for the four
// guest routes and lib/idempotency.ts. Backed by G.TABLES; every read and RPC is logged so a check
// can assert what the handler actually did. No socket is ever opened.
import { G } from "./state.mjs";
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
function builder(table) {
  const st = { table, filters: [], op: "select", patch: null, limit: null, cols: null };
  const rows = () => (G.TABLES[table] ||= []);
  const match = (r) => st.filters.every((f) => String(r[f.col]) === String(f.val));
  const api = {
    select(c) { if (st.op === "select") st.cols = c; return api; },
    insert(p) { st.op = "insert"; st.patch = p; return api; },
    update(p) { st.op = "update"; st.patch = p; return api; },
    delete() { st.op = "delete"; return api; },
    eq(col, val) { st.filters.push({ col, val }); return api; },
    gte() { return api; }, order() { return api; },
    limit(n) { st.limit = n; return api; },
    single() { return settle(true); },
    maybeSingle() { return settle(true); },
    then(res, rej) { return settle(false).then(res, rej); },
  };
  async function settle(one) {
    if (G.THROW_FROM === table) throw new Error("stub: read failed");
    if (st.op === "insert") {
      const p = clone(st.patch);
      if (table === "action_idempotency" && rows().some((r) => r.action_id === p.action_id)) {
        return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      rows().push({ done: false, result: null, created_at: new Date().toISOString(), ...p });
      return { data: null, error: null };
    }
    if (st.op === "update") { for (const r of rows().filter(match)) Object.assign(r, clone(st.patch)); return { data: null, error: null }; }
    if (st.op === "delete") { G.TABLES[table] = rows().filter((r) => !match(r)); return { data: null, error: null }; }
    G.READS.push({ table, filters: st.filters.map((f) => f.col), limit: st.limit, cols: st.cols });
    let out = rows().filter(match);
    if (st.limit != null) out = out.slice(0, st.limit);
    return one ? { data: clone(out[0] ?? null), error: null } : { data: clone(out), error: null };
  }
  return api;
}
export const supabaseAdmin = {
  from: (t) => builder(t),
  rpc(name, args) {
    G.RPC_CALLS.push({ name, args: clone(args) });
    const impl = G.RPC[name];
    const r = typeof impl === "function" ? impl(args) : impl;
    if (r && typeof r === "object" && ("data" in r || "error" in r)) return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    return Promise.resolve({ data: r ?? null, error: null });
  },
};
