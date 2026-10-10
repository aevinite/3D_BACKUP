// In-memory database client: every chained call is recorded; the awaited answer comes from
// globalThis.__t18.reply(query) — a check sets it. No query ever leaves the process.
export const supabaseAdmin = {
  from(table) {
    const q = { table, ops: [] };
    (globalThis.__t18.calls ||= []).push(q);
    const chain = new Proxy({}, {
      get(_, k) {
        if (k === "then") return (res, rej) => Promise.resolve().then(() => globalThis.__t18.reply(q)).then(res, rej);
        return (...a) => { q.ops.push([k, ...a]); return chain; };
      },
    });
    return chain;
  },
};
