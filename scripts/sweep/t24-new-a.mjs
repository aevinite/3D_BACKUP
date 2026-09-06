// t24-new-a.mjs — sweep #8 T24, block A: the gate, the restaurant scope, and every single read
// statement in this half measured against the two rules that make a shared database safe:
// scoped by restaurant_id, and bounded.
import { check, nid, F } from "./t24-run.mjs";

const { src, HELPERS, GETBLK, POSTBLK_A, chains, endpointBlock, ALL_GET_PATHS, ANON, L, live, needLive, J } = F;
const code = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const MINE = HELPERS + GETBLK + POSTBLK_A;
const MC = code(MINE);
const HC = code(HELPERS);
const GC = code(GETBLK);
const PC = code(POSTBLK_A);
const count = (t, re) => (t.match(re) || []).length;

// ── A1 · DOES EVERY ONE OF THESE NEED A LOGIN? (28 endpoints, driven signed OUT) ───────────────

for (const p of ALL_GET_PATHS) {
  check(nid(), `signed out, GET /api/editor${p} answers "please log in" and no data`, "driven live with no cookie",
    () => {
      const r = ANON[p];
      if (!r || !r.status) return "skip: no answer from this terminal's dev server";
      return { ok: r.status === 401 && /Not authorised/.test(r.text), note: `status ${r.status}` };
    });
}

// ── A2 · SIGNED IN AS A REAL MANAGER, does each one answer at all? ────────────────────────────
const LIVE_KEYS = Object.keys(F.PATHS);
for (const k of LIVE_KEYS) {
  check(nid(), `signed in, GET /api/editor${F.PATHS[k]} answers without a server error`, "driven live as this restaurant's manager",
    () => {
      const r = live(k);
      if (!r) return "skip: no answer from this terminal's dev server";
      return { ok: r.status < 500, note: `status ${r.status}` };
    });
}
// …and every answer is JSON a panel can read, never an HTML error page.
for (const k of LIVE_KEYS) {
  check(nid(), `GET /api/editor${F.PATHS[k]} answers JSON, not an HTML error page`, "driven live",
    () => {
      const r = live(k);
      if (!r) return "skip: no answer from this terminal's dev server";
      return { ok: r.json !== null, note: r.json === null ? r.text.slice(0, 60) : "" };
    });
}
// …and no answer carries a raw database sentence into a manager's toast.
const DB_PROSE = /permission denied for|violates row-level security|invalid input syntax|does not exist|schema cache|relation "|column .* does not exist|JWT expired|statement timeout/i;
for (const k of LIVE_KEYS) {
  check(nid(), `GET /api/editor${F.PATHS[k]} never hands the database's own words to the screen`, "driven live, error text read",
    () => {
      const r = live(k);
      if (!r) return "skip: no answer from this terminal's dev server";
      const e = r.json && typeof r.json.error === "string" ? r.json.error : "";
      return { ok: !DB_PROSE.test(e), note: e ? e.slice(0, 70) : "" };
    });
}

// ── A3 · EVERY READ IN THIS HALF: scoped by restaurant, and bounded ───────────────────────────
// Tenant tables — a read of one of these without restaurant_id is a read of the whole platform.
const TENANT = ["orders", "order_items", "sessions", "session_members", "waiter_calls", "requests",
  "settings", "menu_items", "categories", "filters", "customers", "khata_customers", "print_jobs",
  "printer_events", "print_agents", "table_merges", "staff_users", "aggregator_orders", "issues",
  "blocklist", "staff_actions", "banquet_items", "banquet_bills", "feedback", "session_payments",
  "bill_chain", "deletion_audit", "daily_counters", "restaurants"];
const CH = chains(MC);
// LOCK THE COUNT. Ids below are positional, so a read INSERTED in the middle would shift every one
// of them and turn this whole block into a lie. If this row goes red, do not renumber — append the
// new read's rows at the END of the block and move this number.
// ── THE PER-STATEMENT ROWS BELOW ARE ORDERED BY TABLE, NOT BY FILE POSITION ────────────────────
// A positional id shifts the moment a read is inserted anywhere above it, and then every row after
// it silently names a different statement — the drift this repo has already recorded once. Ordering
// by (table name, n-th read of that table) means a new `settings` read moves only the later
// `settings` rows, and leaves `orders`, `sessions` and the other 26 tables exactly where they were.
//
// The count is still locked, per table. If this row goes red, do NOT renumber: append the new
// read's rows at the END of the block and move the number for its table.
//
// 96 statements as of 2026-09-06: 91 when this block was written, +6 when the half's boundary moved
// to the true end of the POST `order` branch, −1 when the Pay Later picker's own orders read was
// replaced by the book's RPC (item 2).
const BY_TABLE = (() => {
  const seen = new Map();
  const out = [];
  for (const c of CH) {
    const table = (c.flat.match(/from\("([^"]+)"\)/) || [])[1] || "?";
    const n = (seen.get(table) || 0) + 1;
    seen.set(table, n);
    out.push({ ...c, table, n });
  }
  return out.sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : a.n - b.n));
})();
const TABLE_COUNTS = {
  aggregator_orders: 7, app_config: 1, banquet_bills: 3, banquet_items: 1,
  bill_chain: 1, blocklist: 1, categories: 1, customers: 1,
  daily_counters: 1, deletion_audit: 2, feedback: 1, filters: 1,
  issues: 1, khata_customers: 1, menu_items: 2, order_items: 3,
  orders: 18, print_jobs: 2, printer_events: 1, restaurants: 9,
  session_members: 4, session_payments: 2, sessions: 13, settings: 11,
  staff_actions: 2, staff_users: 2, table_merges: 2, waiter_calls: 2,
};
check(nid(), "this half still holds exactly 96 database statements, and the same number of them per table",
  "bracket-matched every sb.from(...) chain in the half, then counted by table",
  () => {
    const got = {};
    for (const c of BY_TABLE) got[c.table] = (got[c.table] || 0) + 1;
    const moved = [...new Set([...Object.keys(TABLE_COUNTS), ...Object.keys(got)])]
      .filter((t) => (TABLE_COUNTS[t] || 0) !== (got[t] || 0))
      .map((t) => `${t} ${TABLE_COUNTS[t] || 0}→${got[t] || 0}`);
    return { ok: CH.length === 96 && moved.length === 0,
             note: moved.length ? moved.join(", ") : `${CH.length} statements across ${Object.keys(got).length} tables` };
  });

// Reads that are legitimately scoped by something OTHER than restaurant_id, each with its reason.
const SCOPE_EXEMPT = [
  ['from("app_config")', "a PLATFORM row, not a restaurant's — the admin's log-retention lock, keyed by name"],
  ['from("restaurants")', "the restaurant row ITSELF, found by its own primary key"],
];
BY_TABLE.forEach(({ table, n, ...c }) => {
  const why = SCOPE_EXEMPT.find(([frag]) => c.flat.includes(frag));
  check(nid(), `${table} read ${n}: it says WHICH restaurant it is for`, `bracket-matched the chain, at route line ~${c.line} today`,
    () => {
      if (!TENANT.includes(table)) return { ok: true, note: `${table} is not a tenant table` };
      if (why) return { ok: /\.eq\("id", rid\)|\.eq\("key",/.test(c.flat), note: `allowed: ${why[1]}` };
      if (/restaurant_id/.test(c.flat)) return true;
      // A read keyed on ids that CAME from a scoped read is scoped by construction — but it has to
      // be one of those, not merely an `.in()` of something.
      const derived = /\.in\("(id|session_id|order_id)", (sids|ids|sIds|oids|daysSessionIds|people\.map)/.test(c.flat)
        || /\.eq\("order_id", job\.order_id\)/.test(c.flat);
      if (derived) return { ok: true, note: "scoped by ids that came from a restaurant-scoped read" };
      // A chain HELD IN A VARIABLE takes its scope on the next line — `let q = sb.from(...)` then
      // `if (rid) q = q.eq("restaurant_id", rid)`. Reading only the first statement calls that
      // unscoped, which it is not; the rule is about the statement that actually runs.
      const before = MC.slice(Math.max(0, MC.indexOf(c.chain) - 40), MC.indexOf(c.chain)).match(/(?:let|const)\s+(\w+)\s*=\s*$/);
      if (before) {
        const after = MC.slice(MC.indexOf(c.chain) + c.chain.length, MC.indexOf(c.chain) + c.chain.length + 900);
        if (new RegExp(`\\b${before[1]}\\b[^;]{0,200}restaurant_id`).test(after)) return { ok: true, note: `scoped on the next line, through ${before[1]}` };
      }
      return { ok: false, note: c.flat.slice(0, 90) };
    });
});
BY_TABLE.forEach(({ table, n, ...c }) => {
  const isWrite = /\.(update|insert|upsert|delete)\(/.test(c.flat);
  check(nid(), `${table} read ${n}: it cannot come back unbounded`, `bracket-matched the chain, at route line ~${c.line} today`,
    () => {
      if (isWrite) return { ok: true, note: "a write, not a read" };
      if (/\.limit\(|maybeSingle\(|\.single\(|count:\s*"exact"|\.range\(/.test(c.flat)) return true;
      // A chain assigned to a variable takes its bound later — `let q = sb.from(...)` … `q.limit(n)`.
      const assigned = MC.slice(Math.max(0, MC.indexOf(c.chain) - 40), MC.indexOf(c.chain)).match(/(?:let|const)\s+(\w+)\s*=\s*$/);
      if (assigned) {
        const after = MC.slice(MC.indexOf(c.chain) + c.chain.length, MC.indexOf(c.chain) + c.chain.length + 12000);
        if (new RegExp(`\\b${assigned[1]}\\b[^;]{0,300}\\.limit\\(`).test(after)) return { ok: true, note: `bounded later, through ${assigned[1]}` };
      }
      // An `.in()` over a list this handler built is bounded by that list.
      if (/\.in\("[^"]+", \[?[a-zA-Z]/.test(c.flat)) return { ok: true, note: "bounded by the id list it was given" };
      return { ok: false, note: c.flat.slice(0, 110) };
    });
});

// ── A4 · THE GATE ITSELF ───────────────────────────────────────────────────────────────────────
check(nid(), "the gate asks for a MANAGER, not merely for any signed-in person", "read gate()", () => /requireRole\(req, "manager"\)/.test(HC));
check(nid(), "a database blip while checking the cookie is a 503, so the panel stays logged in and retries", "read gate()",
  () => /g\.transient[\s\S]{0,200}status: 503/.test(HC));
check(nid(), "…and only a genuinely bad cookie gets the 401 that bounces to /login", "read gate()",
  () => /: NextResponse\.json\(\{ error: "Not authorised — please log in\." \}, \{ status: 401 \}\)/.test(HC));
check(nid(), "the 503 sentence says the database, not 'unauthorised' — a person can act on it", "read gate()",
  () => /Server can't reach the database — retrying\./.test(HC));
check(nid(), "the gate returns the user, never a bare boolean, so every handler can attribute what it does", "read gate()",
  () => /return \{ user: g\.user \};/.test(HC));
check(nid(), "the ADMIN super-user reaches this panel with no staff cookie at all (g.user === null)", "read the handlers' null-user branches",
  () => count(MC, /!g\.user/g) >= 6);
check(nid(), "every one of the four methods runs the gate as its FIRST statement", "read the four entry points",
  () => ["export async function GET(", "async function postImpl(", "async function patchImpl(", "async function deleteImpl("]
    .every((f) => /^\s*const g = await gate\(req\); if \(g instanceof NextResponse\) return g;/m.test(src.slice(src.indexOf(f), src.indexOf(f) + 300))));

// ── A5 · editorScope — the one choke point ────────────────────────────────────────────────────
check(nid(), "an OWNER may only edit a restaurant they own — a hand-typed rid for someone else's is refused", "read editorScope",
  () => /if \(!owned\.includes\(urlRid\)\) return err\("You can only edit restaurants you own\.", 403\)/.test(HC));
check(nid(), "…and the owner's estate is asked for fresh, never taken from the request", "read editorScope",
  () => /const owned = await enabledOwnedRestaurantIds\(u\.id\)/.test(HC));
check(nid(), "a MANAGER's ?rid= is ignored entirely — they stay pinned to their own restaurant", "read editorScope",
  () => /if \(u && u\.role === "owner"\)/.test(HC) && !/role === "manager"[\s\S]{0,120}searchParams\.get\("rid"\)/.test(HC));
check(nid(), "the refusal is a 403 with a sentence, not a silent re-scope to somebody else's restaurant", "read editorScope",
  () => !/return DEFAULT_RESTAURANT_ID/.test(HC.slice(HC.indexOf("async function editorScope"), HC.indexOf("async function editorScope") + 1200)));
check(nid(), "editorScope returns either a restaurant id or a response — never undefined", "read editorScope",
  () => /Promise<string \| NextResponse>/.test(HC));
check(nid(), "every caller checks for the response form before using the value", "read the four entry points",
  () => count(code(src), /if \(rid instanceof NextResponse\) return rid;/g) >= 4);

// ── A6 · tabGate — a switched-off tab's endpoints refuse too ───────────────────────────────────
check(nid(), "the admin super-user keeps every tab, so a switched-off one stays inspectable", "read tabGate", () => /if \(!g\.user\) return null;/.test(HC));
check(nid(), "a path that belongs to no tab pays nothing — the lookup only runs on a match", "read tabGate",
  () => /const hit = TAB_PATHS\.find[\s\S]{0,80}?if \(!hit\) return null;/.test(HC));
check(nid(), "the gate checks BOTH halves — the tab is on AND the power is granted", "read tabGate",
  () => /if \(managerTabOn\(cfg, hit\.tab\) && granted\) return null;/.test(HC));
check(nid(), "each power is written out at its own managerCan call, not looked up from a map", "read tabGate",
  () => /managerCan\(g, rid, "edit_menu"\)/.test(HC) && /managerCan\(g, rid, "view_ratings"\)/.test(HC) && /managerCan\(g, rid, "view_logs"\)/.test(HC));
check(nid(), "a LIVE ORDER's dish action is NOT the menu editor — marking a dish served survives Edit-menu being off", "read ORDER_ITEM_ACTION + the editor row",
  () => /const ORDER_ITEM_ACTION = \/\^items\\\/\[\^\/\]\+\\\/\(delete\|qty\|note\|removed\|status\)\$\//.test(HC)
    && /\/\^items\(\\\/\|\$\)\/\.test\(p\) && !ORDER_ITEM_ACTION\.test\(p\)/.test(HC));
check(nid(), "…and the pattern really does exclude all five of those verbs", "run ORDER_ITEM_ACTION over the five paths",
  () => ["delete", "qty", "note", "removed", "status"].every((v) => /^items\/[^/]+\/(delete|qty|note|removed|status)$/.test(`items/abc-123/${v}`)));
check(nid(), "…while a menu-editor path still matches the editor tab", "run the editor test over the menu paths",
  () => ["items", "items/abc", "categories", "categories/x", "filters"].every((p) =>
    (/^(categories|filters)(\/|$)/.test(p) || (/^items(\/|$)/.test(p) && !/^items\/[^/]+\/(delete|qty|note|removed|status)$/.test(p)))));
check(nid(), "RECORDING a removal (POST /audit) lands whether or not anyone may VIEW the tab", "read the log row of TAB_PATHS",
  () => /\(p === "audit" \|\| p === "users"\) && method === "GET"/.test(HC));
check(nid(), "…and the Bills menu is NOT on this gate — it is fixed for every manager", "read TAB_PATHS", () => !/tab: "bills"/.test(HC));
check(nid(), "the refusal names the tab in words a manager understands", "read the LABEL map",
  () => /editor: "the menu editor", ratings: "guest ratings", log: "the Audit & logs tab"/.test(HC));
check(nid(), "the refusal is a 403, not a 404 that reads like a broken link", "read tabGate", () => /isn't part of this restaurant's manager panel\.`, 403\)/.test(HC));
check(nid(), "tabGate is given the METHOD, so a read-only rule can differ from a write one", "read the four call sites",
  () => count(code(src), /tabGate\(g, rid, path, req\.method\)/g) >= 4);
