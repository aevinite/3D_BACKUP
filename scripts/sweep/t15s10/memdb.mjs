// scripts/sweep/t15s10/memdb.mjs — a small in-memory stand-in for the supabase query builder.
//
// WHY: most of the territory is functions whose correctness is "which rows does this statement
// reach, and what does it do with the answer". A recording fake can only say which filters were
// sent; this one APPLIES them, so a check can put two restaurants' rows in a table and see that only
// one restaurant's changed — with nothing written to the shared database at all.
//
// It understands exactly what the printing files use: select (with count/head), insert, update,
// upsert, delete · eq neq is in lt lte gt gte · `or()` for the print queue's own liveFilter string ·
// order · limit · maybeSingle / single. Unique keys raise a 23505 the way Postgres does.
// Every statement is also recorded in `log`, so a check can assert what was sent as well as what
// happened.
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export function memDb(init = {}, { unique = {} } = {}) {
  const tables = {};
  for (const [t, rows] of Object.entries(init)) tables[t] = rows.map((r) => ({ ...r }));
  const log = [];
  const tbl = (t) => (tables[t] ||= []);
  const cmp = (a, b) => (a == null ? -1 : b == null ? 1 : a < b ? -1 : a > b ? 1 : 0);

  // "status.eq.queued,and(status.eq.printing,claimed_at.lt.2026-…)" — only the shapes the code uses.
  const orMatch = (row, expr) => {
    const parts = []; let depth = 0, cur = "";
    for (const ch of expr) {
      if (ch === "(") depth++; if (ch === ")") depth--;
      if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
    }
    if (cur) parts.push(cur);
    const one = (p) => {
      if (p.startsWith("and(")) return p.slice(4, -1).split(",").every(one);
      const [col, op, ...rest] = p.split("."); const v = rest.join(".");
      const x = row[col];
      if (op === "eq") return String(x) === v;
      if (op === "lt") return x != null && String(x) < v;
      if (op === "is") return v === "null" ? x == null : String(x) === v;
      throw new Error(`memdb: or() shape not understood: ${p}`);
    };
    return parts.some(one);
  };

  const exec = (q) => {
    log.push(q);
    const rows = tbl(q.table);
    const filters = q.ops.filter(([k]) => ["eq", "neq", "is", "in", "lt", "lte", "gt", "gte", "or", "not"].includes(k));
    const match = (r) => filters.every(([k, c, v]) => {
      if (k === "eq") return r[c] === v || String(r[c]) === String(v);
      if (k === "neq") return r[c] !== v;
      if (k === "is") return v === null ? r[c] == null : r[c] === v;
      if (k === "in") return v.map(String).includes(String(r[c]));
      if (k === "lt") return r[c] != null && r[c] < v;
      if (k === "lte") return r[c] != null && r[c] <= v;
      if (k === "gt") return r[c] != null && r[c] > v;
      if (k === "gte") return r[c] != null && r[c] >= v;
      if (k === "or") return orMatch(r, c);
      return true;
    });
    const verb = q.ops.find(([k]) => ["insert", "update", "upsert", "delete"].includes(k));
    const sel = q.ops.find(([k]) => k === "select");
    const shape = (list) => {
      const order = q.ops.filter(([k]) => k === "order");
      let out = [...list];
      for (const [, col, o] of order.reverse()) out.sort((a, b) => cmp(a[col], b[col]) * (o?.ascending === false ? -1 : 1));
      const lim = q.ops.find(([k]) => k === "limit");
      if (lim) out = out.slice(0, lim[1]);
      const cols = sel && sel[1] && sel[1] !== "*" ? sel[1].split(",").map((s) => s.trim()) : null;
      if (cols) out = out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
      return out;
    };
    const finish = (list, count) => {
      const single = q.ops.find(([k]) => k === "maybeSingle" || k === "single");
      const head = sel && sel[2]?.head;
      const res = { data: head ? null : list, error: null, count: sel && sel[2]?.count ? count : null };
      if (single) {
        if (list.length > 1) return { data: null, error: { code: "PGRST116", message: "more than one row" } };
        if (!list.length && single[0] === "single") return { data: null, error: { code: "PGRST116", message: "no rows" } };
        res.data = list[0] ?? null;
      }
      return res;
    };
    const uniq = (row, ignore) => {
      for (const key of unique[q.table] || []) {
        const clash = rows.find((r) => r !== ignore && key.every((c) => r[c] != null && r[c] === row[c]));
        if (clash) return { data: null, error: { code: "23505", message: `duplicate key on ${q.table}(${key.join(",")})` } };
      }
      return null;
    };
    if (!verb) { const hit = rows.filter(match); return finish(shape(hit), hit.length); }
    if (verb[0] === "insert" || verb[0] === "upsert") {
      const list = Array.isArray(verb[1]) ? verb[1] : [verb[1]];
      const made = [];
      for (const r0 of list) {
        const r = { id: uuid(), created_at: new Date().toISOString(), ...r0 };
        if (verb[0] === "upsert") {
          const keys = String(verb[2]?.onConflict || "id").split(",");
          const old = rows.find((x) => keys.every((k) => x[k] === r[k]));
          if (old) { Object.assign(old, r0); made.push(old); continue; }
        }
        const e = uniq(r); if (e) return e;
        rows.push(r); made.push(r);
      }
      return finish(sel ? shape(made) : [], made.length);
    }
    const hit = rows.filter(match);
    if (verb[0] === "delete") {
      for (const r of hit) rows.splice(rows.indexOf(r), 1);
      return finish(sel ? shape(hit) : [], hit.length);
    }
    for (const r of hit) { const e = uniq({ ...r, ...verb[1] }, r); if (e) return e; }
    for (const r of hit) Object.assign(r, verb[1]);
    return finish(sel ? shape(hit) : [], hit.length);
  };

  const from = (table) => {
    const q = { table, ops: [] };
    const chain = new Proxy({}, {
      get(_, k) {
        if (k === "then") return (res, rej) => { try { const out = exec(q); api.afterExec?.(q, out); res(out); } catch (e) { rej(e); } };
        return (...a) => { q.ops.push([k, ...a]); return chain; };
      },
    });
    return chain;
  };
  // afterExec(q, answer) runs after each statement — how a check makes something happen BETWEEN two
  // statements of the function under test (another screen pressing a button mid-request).
  const api = { from, tables, log, rpc: async () => ({ data: null, error: null }), afterExec: null };
  return api;
}
