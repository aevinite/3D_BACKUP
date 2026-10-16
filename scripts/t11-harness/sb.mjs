// T11 round 2's stand-in for the service-role Supabase client — STRICTER than the shared stubs, on purpose:
//   · a select with a COLUMN LIST hands back only those columns (so "the board never ships the webhook payload"
//     is proved by what comes back, and a handler reading a column it never selected sees undefined, as for real);
//   · count:"exact" counts BEFORE .limit(), and .order() sorts — PostgREST's behaviour, which the shared stubs skip;
//   · every statement is logged in G.SCOPE_LOG (table, verb, filters, patch) so "every statement names the
//     restaurant" is asked of the code's REAL queries;
//   · G.FAIL / G.FAIL_NTH fail one table/verb on purpose ("error" | "throw" | "timeout" | "refuse" | "empty").
// No socket is ever opened.
import { G } from "../panel-stubs/state.mjs";
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const colsOf = (s) => (typeof s !== "string" || /[*()]/.test(s) ? null : s.split(",").map((c) => c.trim()).filter(Boolean).map((c) => c.split(":").pop()));
function builder(table) {
  const st = { table, filters: [], op: "select", patch: null, head: false, cols: null, orders: [] };
  const match = (row) => st.filters.every((f) => {
    const v = row[f.col];
    if (f.kind === "eq") return String(v) === String(f.val);
    if (f.kind === "neq") return String(v) !== String(f.val);
    if (f.kind === "is") return f.val === null ? (v === null || v === undefined) : v === f.val;
    if (f.kind === "not_is") return !(v === null || v === undefined);
    if (f.kind === "in") return (f.val || []).map(String).includes(String(v));
    if (f.kind === "gte") return String(v) >= String(f.val);
    if (f.kind === "lte") return String(v) <= String(f.val);
    if (f.kind === "lt") return String(v) < String(f.val);
    if (f.kind === "gt") return String(v) > String(f.val);
    return true;
  });
  const api = {
    select(c, opts) { if (st.op === "select") st.cols = colsOf(c); else st.retCols = colsOf(c); if (opts && opts.head) st.head = true; if (opts && opts.count) st.count = opts.count; return api; },
    update(p) { st.op = "update"; st.patch = p; return api; },
    insert(p) { st.op = "insert"; st.patch = p; return api; },
    delete() { st.op = "delete"; return api; },
    upsert(p, o) { st.op = "upsert"; st.patch = p; st.conflict = o && o.onConflict; return api; },
    eq(col, val) { st.filters.push({ kind: "eq", col, val }); return api; },
    neq(col, val) { st.filters.push({ kind: "neq", col, val }); return api; },
    is(col, val) { st.filters.push({ kind: "is", col, val }); return api; },
    not(col, kind, val) { st.filters.push(kind === "is" && val === null ? { kind: "not_is", col } : { kind: "neq", col, val }); return api; },
    in(col, val) { st.filters.push({ kind: "in", col, val }); return api; },
    gte(col, val) { st.filters.push({ kind: "gte", col, val }); return api; },
    lte(col, val) { st.filters.push({ kind: "lte", col, val }); return api; },
    lt(col, val) { st.filters.push({ kind: "lt", col, val }); return api; },
    gt(col, val) { st.filters.push({ kind: "gt", col, val }); return api; },
    or() { return api; }, ilike() { return api; }, contains() { return api; }, like() { return api; },
    order(col, o) { st.orders.push({ col, asc: !(o && o.ascending === false) }); return api; },
    limit(n) { st.lim = n; return api; }, range(a, b) { st.rng = [a, b]; return api; },
    single() { return settle(true); }, maybeSingle() { return settle(true); },
    then(res, rej) { return settle(false).then(res, rej); },
  };
  function settle(one) {
    (G.SCOPE_LOG ||= []).push({ table: st.table, op: st.op, filters: st.filters.map((f) => ({ ...f })), patch: clone(st.patch ?? null), cols: st.cols });
    const ck = st.table + ":" + st.op;
    G.CALLS ||= {}; G.CALLS[ck] = (G.CALLS[ck] || 0) + 1;
    const nth = G.FAIL_NTH && G.FAIL_NTH[ck];
    const mode = nth && nth.at === G.CALLS[ck] ? nth.mode : G.FAIL && (G.FAIL[ck] || G.FAIL[st.table]);
    if (mode === "throw") return Promise.reject(new Error("stub: " + st.table + " unreachable"));
    if (mode === "error") return Promise.resolve({ data: null, error: { message: "stub: " + st.table + " failed", code: "XX000" }, count: null });
    if (mode === "timeout") return Promise.resolve({ data: null, error: { message: "canceling statement due to statement timeout", code: "57014" }, count: null });
    if (mode === "refuse") return Promise.resolve({ data: null, error: { message: 'invalid input syntax for type uuid: "x"', code: "22P02" }, count: null });
    if (mode === "empty") return Promise.resolve({ data: one ? null : [], error: null, count: 0 });
    if (mode === "missing") return Promise.resolve({ data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116", details: "The result contains 0 rows" }, count: null });
    let found = (G.FIX[st.table] || []).filter(match);
    if (st.op !== "select") {
      G.WRITES.push({ table: st.table, op: st.op, patch: clone(st.patch ?? null), matched: found.length, at: G.WRITES.length });
      if (st.op === "update") for (const r of found) Object.assign(r, st.patch);
      if (st.op === "insert" || st.op === "upsert") {
        const out = [];
        for (const r of (Array.isArray(st.patch) ? st.patch : [st.patch])) {
          const cols = st.op === "upsert" && st.conflict ? String(st.conflict).split(",").map((c) => c.trim()) : null;
          const hit = cols && (G.FIX[st.table] || []).find((x) => cols.every((c) => String(x[c]) === String(r[c])));
          if (hit) { Object.assign(hit, r); out.push(hit); } else { const row = { id: "new-" + Math.random().toString(36).slice(2, 8), ...r }; (G.FIX[st.table] ||= []).push(row); out.push(row); }
        }
        found = out;
      }
      if (st.op === "delete") G.FIX[st.table] = (G.FIX[st.table] || []).filter((r) => !match(r));
    } else (G.READS ||= []).push({ table: st.table, op: "select", matched: found.length });
    const total = found.length;
    for (const o of [...st.orders].reverse()) found = [...found].sort((a, b) => (String(a[o.col] ?? "") < String(b[o.col] ?? "") ? -1 : String(a[o.col] ?? "") > String(b[o.col] ?? "") ? 1 : 0) * (o.asc ? 1 : -1));
    if (st.rng) found = found.slice(st.rng[0], st.rng[1] + 1);
    if (st.lim != null) found = found.slice(0, st.lim);
    if (st.head) return Promise.resolve({ data: null, error: null, count: total });
    const pick = st.op === "select" ? st.cols : st.retCols;
    const shaped = pick ? found.map((r) => Object.fromEntries(pick.filter((c) => c in r).map((c) => [c, r[c]]))) : found;
    return Promise.resolve({ data: one ? (shaped[0] ? clone(shaped[0]) : null) : clone(shaped), error: null, count: st.count ? total : shaped.length });
  }
  return api;
}
export const supabaseAdmin = {
  from: (t) => builder(t),
  rpc: (name, args) => {
    G.RPCS.push({ name, args: clone(args || {}) });
    const fm = G.FAIL && G.FAIL["rpc:" + name];
    if (fm && typeof fm === "object") return Promise.resolve({ data: null, error: fm });   // a database refusal with its own code
    if (fm === "throw") return Promise.reject(new Error("stub: rpc " + name + " unreachable"));
    if (fm === "error") return Promise.resolve({ data: null, error: { message: "stub: rpc " + name + " failed" } });
    if (G.RPC_IMPL && G.RPC_IMPL[name]) return Promise.resolve({ data: G.RPC_IMPL[name](clone(args || {})), error: null });
    return Promise.resolve({ data: name in G.RPC_ANSWERS ? G.RPC_ANSWERS[name] : { ok: true }, error: null });
  },
};
