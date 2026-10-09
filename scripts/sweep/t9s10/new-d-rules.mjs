// scripts/sweep/t9s10/new-d-rules.mjs — block D of sweep #10 T9's 500 (P178601–P178700).
// The project's own rules, applied to my half: every database function it calls is callable by
// the server only, every rejected idea still carries its marker (the list is docs/REJECTED-IDEAS.md), every new read since the last
// sweep is scoped and bounded, and the guards that name this file are green.
import { execFileSync } from "node:child_process";
import { check, sql, SUBJECT, ROOT, HC, GC, PC, MC, MINE, chains, endpoint, helper, rd } from "./lib.mjs";

let N = 178601;
const id = () => { if (N > 178700) throw new Error("block D is full"); return "P" + N++; };
const C = (what, how, fn) => check(id(), `${SUBJECT} — ${what}`, how, fn);
const guard = (args) => { try { execFileSync(args[0], args.slice(1), { cwd: ROOT, stdio: "pipe", timeout: 300000 }); return { ok: true }; }
  catch (e) { return { ok: false, out: (String(e.stdout || "") + String(e.stderr || "")).slice(-300) }; } };

// ── D1 · every database function this half calls is the server's alone ──────────────────────────
const RPCS = [...new Set([...MINE.matchAll(/sb\.rpc\("([a-z_0-9]+)"/g)].map((m) => m[1]))].sort();
for (const fn of RPCS) {
  C(`database function ${fn} (called by this half) cannot be run by an anonymous or a plain signed-in database login`, "one read-only SQL statement — has_function_privilege for anon and authenticated, every overload",
    async () => { const r = await sql(`select p.oid::regprocedure::text f, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${fn}'`);
      const open = r.filter((x) => x.a || x.u);
      return { ok: r.length > 0 && open.length === 0, note: r.length ? (open.length ? `open to: ${open.map((x) => x.f).join(", ")}` : `${r.length} overload(s), server only`) : "function not found" }; });
}
C(`this half calls ${RPCS.length} database functions, and each is listed above`, "read the half for sb.rpc(\"…\")", () => ({ ok: RPCS.length >= 8, note: RPCS.join(", ") }));

// ── D2 · the rejected ideas still carry their markers in this half ───────────────────────────────
for (const [r, near, why] of [
  ["R27", "async function canDeleteBill", "nobody at the restaurant deletes a bill — cancel is the only route out"],
  ["R48", 'return err("No restaurant scope — open this panel from the admin console.", 400)', "the 'No restaurant scope' sentence stays (reachable by the admin only)"],
  ["R56", 'await log("editor", g.user ? "print_sent" : "print_sent_by_admin"', "the admin's print row stays visible to the restaurant"],
]) {
  C(`REJECTED ${r} still has its code comment right where someone would change it (${why})`, "read the 60 lines above the line it guards",
    () => { const i = MINE.indexOf(near); if (i < 0) return { ok: false, note: "the guarded line moved" }; const above = MINE.slice(Math.max(0, i - 6000), i);
      return { ok: new RegExp(`REJECTED \\(owner, 20\\d\\d-\\d\\d-\\d\\d\\)[\\s\\S]{0,200}${r}|${r}[\\s\\S]{0,400}REJECTED|REJECTED[\\s\\S]{0,400}${r}`).test(above), note: r }; });
}
C("REJECTED (owner, 2026-08-19): the bill_printed_at read changes one word on one button and nothing else — its comment is in place", "read GET /orders",
  () => /REJECTED \(owner, 2026-08-19\)/.test(endpoint("orders")));
C("`npm run verify:rejected` is green", "the guard run", () => { const g = guard(["node", "scripts/verify-rejected-ideas.mjs"]); return { ok: g.ok, note: g.ok ? "green" : g.out }; });

// ── D3 · the statements that arrived since sweep #8 are scoped and bounded ───────────────────────
const CH = chains(MINE);
const NEW = [
  ["deletion_audit", "madeAnswers() — food that was made (2026-09-25)", helper("async function madeAnswers")],
  ["sessions", "invoiceLockedByOrder() — invoice_at (2026-09-25)", helper("async function invoiceLockedByOrder")],
  ["restaurants", "managerSectionOff() — the Sections switch (item 1)", helper("async function managerSectionOff")],
  ["restaurants", "GET /onhouse — the dashboard reach (item 2)", endpoint("onhouse")],
  ["restaurants", "GET /gst-report — the dashboard reach (2026-09-23)", endpoint("gst-report")],
  ["orders", "POST print/send kot — the order check (2026-09-14)", PC.slice(PC.indexOf('if (kind === "kot")'), PC.indexOf("const payload: Record<string, unknown> = {};"))],
];
for (const [table, where, text] of NEW) {
  const c = chains(text).find((x) => x.table === table);
  C(`${where}: its ${table} read says which restaurant it is for`, "bracket-matched the chain",
    () => c ? { ok: /\.eq\("restaurant_id", rid\)|\.eq\("id", rid\)/.test(c.flat), note: c.flat.slice(0, 110) } : { ok: false, note: "no such read" });
  C(`${where}: its ${table} read cannot come back unbounded`, "bracket-matched the chain",
    () => c ? { ok: /maybeSingle\(|\.limit\(|\.single\(/.test(c.flat), note: c.flat.slice(-60) } : { ok: false, note: "no such read" });
}
C("print/send kot: the queued row carries this restaurant's id, so the claim can only ever be this restaurant's", "read the insert",
  () => /from\("print_jobs"\)\.insert\(\{\s*restaurant_id: rid, kind: "kot"/.test(MINE));

// ── D4 · reads that still take every column (listed, not changed — see the report) ──────────────
const STAR = CH.filter((c) => /\.select\("\*"\)/.test(c.flat));
C(`${STAR.length} reads in this half still select every column — each is restaurant-scoped AND bounded`, "every select(\"*\") chain read",
  () => {
    // A chain assigned to a variable takes its bound on a later line (`let cq = sb.from(...)` …
    // `cq.order(…).limit(100)`), so "bounded" is read from the statement that actually runs.
    const boundedLater = (c) => { const m = MINE.slice(Math.max(0, c.at - 40), c.at).match(/(?:let|const) (\w+) = $/); return !!m && new RegExp(`\\b${m[1]}\\b[^;]{0,200}\\.limit\\(`).test(MINE.slice(c.at, c.at + 600)); };
    const bad = STAR.filter((c) => !/restaurant_id", rid\)|\.eq\("id", (rid|id)\)/.test(c.flat) || !(/\.limit\(|maybeSingle\(/.test(c.flat) || boundedLater(c)));
    return { ok: bad.length === 0, note: `${STAR.map((c) => c.table).join(", ")}${bad.length ? ` · NOT: ${bad.map((c) => c.table).join(", ")}` : ""}` }; });
C("…and the four in GET /all say WHY they stay whole-row (the editor form edits every column)", "read GET /all",
  () => /SELECT \* is kept here \(the editor form edits every column\)/.test(endpoint("all")));
C("…and the live floor's whole-row orders read says why (the board renders every column)", "read GET /orders",
  () => /The no-param floor read keeps select\("\*"\)/.test(endpoint("orders")));

// ── D5 · nothing private leaves, nothing private is printed ──────────────────────────────────────
C("this half never hands process.env to a response", "read the half", () => !/ok\([^)]*process\.env/.test(MC));
C("this half's console lines never print a request body, a cookie or a token", "read every console.* line",
  () => { const lines = [...MC.matchAll(/console\.(log|error|warn)\(([^;]*)\);/g)].map((m) => m[2]);
    const bad = lines.filter((l) => /body|cookie|token|password|secret/i.test(l)); return { ok: bad.length === 0, note: `${lines.length} console line(s)` }; });
C("the helper's install text no longer leaves this panel (owner, 2026-09-14: setup is Aevidine's)", "read GET /printing",
  () => !/helperFiles\(/.test(strip0(endpoint("printing"))) && /const maySetup = false;/.test(endpoint("printing")));
function strip0(t) { return t.replace(/^\s*\/\/.*$/gm, ""); }
C("a settings row never leaves through /all with the delivery apps' keys (panelSafeSettings)", "read GET /all", () => /panelSafeSettings\(must\(settings\)\)/.test(endpoint("all")));

// ── D6 · money reads are behind the dashboard's permission, and clamp to its reach ────────────────
for (const ep of ["zreport", "gst-report", "stats", "staff-risk", "onhouse"]) {
  C(`GET /${ep} is behind view_dashboard`, "read the endpoint's first lines", () => /managerCan\(g, rid, "view_dashboard"\)\)\) return permDenied\("view the dashboard"\)/.test(endpoint(ep)));
}
for (const ep of ["gst-report", "stats", "staff-risk", "onhouse"]) {
  C(`GET /${ep} clamps itself to the Access screen's dashboard reach`, "read the endpoint", () => /dashboardReach\(/.test(endpoint(ep)));
}
C("GET /zreport stays a single business day (it is the day-close sheet), so it needs no reach clamp", "read the endpoint", () => /const since = businessDayStartIso\(\);/.test(endpoint("zreport")));

// ── D7 · the guards that name this file are green today ─────────────────────────────────────────
for (const [name, args] of [
  ["verify:floor", ["node", "scripts/verify-floor-share.mjs"]],
  ["verify:manager-gates", ["node", "scripts/verify-manager-gates.mjs"]],
  ["verify:xray", ["node", "scripts/verify-xray-marks.mjs"]],
  ["verify:retention", ["node", "scripts/verify-retention-lock.mjs"]],
  ["verify:one-bill-delete", ["node", "scripts/verify-one-bill-delete.mjs"]],
  ["verify:print-queue", ["node", "scripts/verify-print-queue.mjs"]],
  ["verify:scoped-reads", ["node", "scripts/verify-scoped-reads.mjs"]],
  ["verify:rpc-scoped", ["node", "scripts/verify-rpc-scoped.mjs"]],
  ["verify:clash-coverage", ["node", "scripts/verify-clash-coverage.mjs"]],
  ["verify:t25-writes", ["node", "scripts/verify-t25-editor-writes.mjs"]],
  ["verify:panel-cache", ["node", "scripts/verify-panel-cache.mjs"]],
  ["verify:access", ["npm", "run", "-s", "verify:access"]],
]) {
  C(`\`${name}\` is green on this branch`, `the guard run (${args.join(" ")})`, () => { const g = guard(args); return { ok: g.ok, note: g.ok ? "green" : g.out }; });
}

// ── D8 · comment truth in this half ─────────────────────────────────────────────────────────────
C("the comment describing customer-capture sits above the TABLE-SECTIONS branch, not its own (a misplaced comment — listed, not a fault)", "read the lines above `if (a === \"table-sections\")`",
  () => { const i = MINE.indexOf('if (a === "table-sections")'); const above = MINE.slice(i - 1500, i); const misplaced = /customer-capture — save the guest's name/.test(above);
    return { ok: true, note: misplaced ? "still misplaced — Part 4 improvement" : "in place" }; });
C("every write branch in this half writes its diary line through log(), which names the person", "read print/send and table-sections",
  () => !/await logAction\(/.test(PC) && /await log\("editor", "table_sections_set"/.test(PC) && /await log\("editor", "kot_reprint_sent"/.test(PC));

console.log(`block D: ${N - 178601} checks defined (P178601–P${N - 1})`);
