import * as __fs from "node:fs";
globalThis.__T30FS = __fs;
// scripts/t30-harness/sb.mjs — the in-memory stand-in for lib/supabaseAdmin. One world on globalThis.
//   W.FIX[table] = rows · W.FAIL["table:op"] = "error" | "throw" | {code, message} · W.FAIL_NTH["table:op"] = {at, mode}
//   W.WRITES / W.READS record every call; W.RPC[name] = fn(args) answers an rpc.
export const W = (globalThis.__T30 ||= { FIX: {}, FAIL: {}, FAIL_NTH: {}, CALLS: {}, WRITES: [], READS: [], RPCS: [], RPC: {} });
export function world(fix = {}) {
  W.FIX = JSON.parse(JSON.stringify(fix)); W.FAIL = {}; W.FAIL_NTH = {}; W.CALLS = {};
  W.WRITES.length = 0; W.READS.length = 0; W.RPCS.length = 0; W.RPC = {};
}
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
// T30_RECORD=<file> (round 3): note every table the real code touches, every database function it
// calls, and the filters each query uses, so scripts/sweep/t30s10/parity.mjs can check them against
// the dev database's own catalog. The harness runs every line of these files, so this is every query
// they can make — not a sample. (COLUMNS are not taken from here: the clash tests hand in made-up
// field names on purpose; parity.mjs reads each query's columns from the code instead.)
const REC = process.env.T30_RECORD ? (globalThis.__T30REC ||= { tables: new Set(), queries: new Map(), rpcs: new Set() }) : null;
if (REC && !globalThis.__T30RECHOOK) {
  globalThis.__T30RECHOOK = 1;
  process.on("exit", () => globalThis.__T30FS.writeFileSync(process.env.T30_RECORD, JSON.stringify({ tables: [...REC.tables].sort(), rpcs: [...REC.rpcs].sort(), queries: [...REC.queries.values()] })));
}
function builder(table) {
  const st = { table, filters: [], op: "select", patch: null, cols: null, lim: null, order: null, rng: null };
  const match = (row) => st.filters.every(([k, c, v]) => {
    const x = row[c];
    if (k === "eq") return String(x) === String(v);
    if (k === "neq") return String(x) !== String(v);
    if (k === "is") return v === null ? x === null || x === undefined : x === v;
    if (k === "in") return (v || []).map(String).includes(String(x));
    if (k === "gte") return String(x) >= String(v);
    return true;
  });
  const failOf = () => {
    const ck = `${table}:${st.op}`; W.CALLS[ck] = (W.CALLS[ck] || 0) + 1;
    const nth = W.FAIL_NTH[ck]; if (nth && nth.at === W.CALLS[ck]) return nth.mode;
    return W.FAIL[ck];
  };
  const settle = async (one) => {
    if (REC) {
      REC.tables.add(table);
      const filters = [...new Set(st.filters.filter((f) => f[0] === "eq" || f[0] === "in" || f[0] === "is").map((f) => f[1]))].sort();
      const key = `${table}|${st.op}|${filters.join(",")}`; if (!REC.queries.has(key)) REC.queries.set(key, { table, op: st.op, filters });
    }
    const f = failOf();
    if (f === "throw") throw new Error(`stub: ${table} unreachable`);
    if (f === "nodata") return { data: null, error: null, count: null };
    if (f) return { data: null, error: typeof f === "object" ? f : { message: `stub: ${table} ${st.op} failed`, code: "XX000" }, count: null };
    let found = (W.FIX[table] || []).filter(match);
    if (st.order) found = [...found].sort((a, b) => (String(a[st.order.col]) < String(b[st.order.col]) ? -1 : 1) * (st.order.asc ? 1 : -1));
    if (st.lim != null) found = found.slice(0, st.lim);
    if (st.rng) found = found.slice(st.rng[0], st.rng[1] + 1);
    if (st.op === "select") { W.READS.push({ table, cols: st.cols, filters: clone(st.filters) }); return { data: one ? (found.length === 1 ? clone(found[0]) : found.length ? clone(found[0]) : null) : clone(found), error: null, count: found.length }; }
    W.WRITES.push({ table, op: st.op, patch: clone(st.patch), filters: clone(st.filters), matched: found.length });
    if (st.op === "update") { const before = clone(found); for (const r of found) Object.assign(r, clone(st.patch)); return { data: one ? before[0] ?? null : before, error: null }; }
    if (st.op === "insert") {
      const list = Array.isArray(st.patch) ? st.patch : [st.patch];
      const made = list.map((r) => ({ id: r.id || `new-${Math.random().toString(36).slice(2, 9)}`, ...clone(r) }));
      if (W.UNIQUE && W.UNIQUE[table]) for (const r of made) if ((W.FIX[table] || []).some((x) => W.UNIQUE[table].every((c) => String(x[c]) === String(r[c])))) return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${table}_uq"` } };
      (W.FIX[table] ||= []).push(...made);
      return { data: one ? made[0] : made, error: null };
    }
    if (st.op === "delete") { W.FIX[table] = (W.FIX[table] || []).filter((r) => !match(r)); return { data: clone(found), error: null }; }
    return { data: null, error: null };
  };
  const q = {
    select(c) { st.cols = c ?? st.cols; return q; },
    insert(p) { st.op = "insert"; st.patch = p; return q; },
    update(p) { st.op = "update"; st.patch = p; return q; },
    delete() { st.op = "delete"; return q; },
    eq(c, v) { st.filters.push(["eq", c, v]); return q; },
    neq(c, v) { st.filters.push(["neq", c, v]); return q; },
    is(c, v) { st.filters.push(["is", c, v]); return q; },
    in(c, v) { st.filters.push(["in", c, v]); return q; },
    gte(c, v) { st.filters.push(["gte", c, v]); return q; },
    order(col, o) { st.order = { col, asc: !(o && o.ascending === false) }; return q; },
    limit(n) { st.lim = n; return q; },
    range(a, b) { st.rng = [a, b]; return q; },
    single() { return settle(true); }, maybeSingle() { return settle(true); },
    then(res, rej) { return settle(false).then(res, rej); },
  };
  return q;
}
export const supabaseAdmin = {
  from: (t) => builder(t),
  rpc: async (name, args) => { if (REC) REC.rpcs.add(name); W.RPCS.push({ name, args: clone(args) }); const f = W.FAIL["rpc:" + name]; if (f === "throw") throw new Error("stub rpc unreachable"); if (f) return { data: null, error: { message: "stub rpc failed" } }; return { data: W.RPC[name] ? W.RPC[name](args) : null, error: null }; },
};
