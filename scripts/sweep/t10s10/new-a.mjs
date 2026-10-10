// Block A — logins and restaurant separation, for EVERY endpoint in my half (P179101–P179404).
// Four checks per endpoint, all driven in memory against the real bundled route:
//   +0  nobody signed in            → 401, and not one statement, write or database function ran
//   +1  the sign-in lookup blipped  → 503 "retrying" (the panel stays signed in), nothing ran
//   +2  every WRITE on a restaurant's table names this restaurant (an insert carries it)
//   +3  every READ on a restaurant's table names this restaurant
// Run as a fully-granted French House manager in a world where BOTH restaurants hold the same
// shapes of rows. A few doors are only reachable as the owner or the admin console — those are
// driven as that person, said so in the row. (lib/removalAudit.ts and lib/sessionClose.ts were named
// exemptions until round 2 scoped their statements, 2026-10-10 — now nothing is exempt but the dish id.)
import { check, call } from "./lib.mjs";
import { ENDPOINTS, fullWorld, TENANT_TABLES, ID } from "./endpoints.mjs";

// Which person reaches each door's working path, and anything else it needs.
const REACH = {
  "simulate a delivery order": { who: "admin" },
  "delete one bill (admin only)": { who: "admin" },
  "delete a ticket (admin only)": { who: "admin" },
  "save a setting": { who: "owner" },
  "generate the tax invoice": { body: { cust_phone: "9876543210", cust_name: "Asha" } },
  "settle on the house": { drop: [ID.order2, ID.cancelled] },
  "park the bill on pay-later": { drop: [ID.order2, ID.cancelled], served: true },
};
// Statements that are not this file's, or that are deliberate. Keyed `label|op:table`.
const EXEMPT = {
  "edit a dish|select:menu_items": "a dish id is the GLOBAL key: the create checks it is free for every restaurant, and the edit reads the id's owner and refuses another restaurant's dish (409)",
};
const scopedTo = (s, rid) => (s.op === "insert" || s.op === "upsert")
  ? (Array.isArray(s.patch) ? s.patch : [s.patch]).every((x) => x && x.restaurant_id === rid)
  : s.filters.some((f) => f.col === "restaurant_id" && f.kind === "eq" && f.val === rid);

async function drive(label, verb, path, body, mode) {
  const o = REACH[label] || {};
  const G = await fullWorld({ who: mode === "nobody" || mode === "blip" ? mode : o.who });
  if (o.drop) G.FIX.orders = G.FIX.orders.filter((x) => !o.drop.includes(x.id));
  if (o.served) for (const x of G.FIX.orders) if (x.id === ID.order) x.status = "served";
  G.SCOPE_LOG.length = 0;
  const b = body === null ? undefined : { ...body, ...(o.body || {}) };
  const r = await call(verb, path, b === undefined ? {} : { body: b });
  return { G, r, who: o.who || "manager" };
}

let n = 179101;
for (const [verb, path, body, label] of ENDPOINTS) {
  const id = (k) => `P${n + k}`;
  const what = `${verb} ${path.replace(/[0-9a-f-]{36}/g, ":id")} (${label})`;
  check(id(0), `${what} — signed out: refused 401 before any database work`, "STUB · nobody signed in",
    async () => { const { G, r } = await drive(label, verb, path, body, "nobody");
      return { ok: r.status === 401 && G.SCOPE_LOG.length === 0 && G.RPCS.length === 0 && G.WRITES.length === 0, note: `${r.status} · ${G.SCOPE_LOG.length} statements` }; });
  check(id(1), `${what} — the sign-in lookup blipped: 503 "retrying", nothing ran`, "STUB · requireRole answers transient",
    async () => { const { G, r } = await drive(label, verb, path, body, "blip");
      return { ok: r.status === 503 && /retrying/.test(r.text) && G.SCOPE_LOG.length === 0 && G.RPCS.length === 0, note: `${r.status}` }; });
  check(id(2), `${what} — every write on a restaurant's table names French House`, "STUB · fully-granted, both restaurants populated; SCOPE_LOG of writes",
    async () => { const { G, r, who } = await drive(label, verb, path, body);
      const w = G.SCOPE_LOG.filter((s) => TENANT_TABLES.has(s.table) && s.op !== "select");
      const bad = w.filter((s) => !scopedTo(s, "rest-1") && !EXEMPT[`${label}|${s.op}:${s.table}`]);
      const ex = [...new Set(w.filter((s) => !scopedTo(s, "rest-1")).map((s) => `${s.op}:${s.table}`))];
      return { ok: bad.length === 0, note: `${r.status} as ${who} · ${w.length} write(s)${ex.length ? ` · named exemptions: ${ex.join(", ")}` : ""}${bad.length ? ` · UNSCOPED ${bad.map((s) => s.op + ":" + s.table).join(", ")}` : ""}` }; });
  check(id(3), `${what} — every read on a restaurant's table names French House`, "STUB · as above; SCOPE_LOG of reads",
    async () => { const { G, r, who } = await drive(label, verb, path, body);
      const rd = G.SCOPE_LOG.filter((s) => TENANT_TABLES.has(s.table) && s.op === "select");
      const bad = rd.filter((s) => !scopedTo(s, "rest-1") && !EXEMPT[`${label}|select:${s.table}`]);
      const ex = [...new Set(rd.filter((s) => !scopedTo(s, "rest-1")).map((s) => s.table))];
      return { ok: bad.length === 0, note: `${r.status} as ${who} · ${rd.length} read(s)${ex.length ? ` · named exemptions: ${ex.join(", ")}` : ""}${bad.length ? ` · UNSCOPED ${bad.map((s) => s.table).join(", ")}` : ""}` }; });
  n += 4;
}
