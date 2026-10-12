// Stand-in for lib/supabaseAdmin.ts (the server's service-role client). Every statement is recorded in
// W.fromLog with its table, verb and filters; W.from[table] decides the answer: an answer object, a
// function (stmt) => answer, or "throw" to reject like an unreachable database.
import { W } from "./world.mjs";
function stmt(table) {
  const st = { table, op: "select", filters: [], patch: null, single: false, count: null, cols: null };
  const settle = () => {
    W.fromLog.push({ table: st.table, op: st.op, filters: st.filters.slice(), patch: st.patch, cols: st.cols });
    const a = W.from[st.table];
    if (a === "throw") return Promise.reject(new Error("stand-in: " + st.table + " unreachable"));
    const v = typeof a === "function" ? a(st) : a;
    if (v === undefined) return Promise.resolve({ data: st.single ? null : [], error: null, count: 0 });
    return Promise.resolve(v);
  };
  const c = {};
  for (const m of ["eq", "neq", "is", "in", "gt", "gte", "lt", "lte", "like", "ilike", "not", "or", "match", "contains"]) {
    c[m] = (col, val) => { st.filters.push({ kind: m, col, val }); return c; };
  }
  c.select = (cols, opts) => { if (st.op === "select") st.cols = cols; if (opts && opts.count) st.count = opts.count; return c; };
  c.order = () => c; c.range = () => c;
  c.limit = (n) => { st.filters.push({ kind: "limit", col: null, val: n }); return c; };
  for (const op of ["update", "insert", "upsert", "delete"]) c[op] = (patch) => { st.op = op; st.patch = patch ?? null; return c; };
  c.maybeSingle = () => { st.single = true; return settle(); };
  c.single = () => { st.single = true; return settle(); };
  c.then = (res, rej) => settle().then(res, rej);
  return c;
}
export const supabaseAdmin = {
  from: (t) => stmt(t),
  rpc: (fn, args) => { W.rpcLog.push({ fn, args }); const a = W.rpc[fn]; const v = typeof a === "function" ? a(args) : a; return Promise.resolve(v === undefined ? { data: null, error: null } : v); },
  storage: { from: () => ({ upload: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: "https://stub/x" } }) }) },
};
