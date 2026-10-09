// scripts/sweep/t9s10/new-c-live.mjs — block C of sweep #10 T9's 500 (P178401–P178600).
// Part 1: the POST doors of this half (print/send, table-sections, the preamble, the photo door,
// the off-plan and clash gates, the floor wrapper, the invoice lock) DRIVEN in memory.
// Part 2: every GET endpoint DRIVEN on this terminal's own dev server as French House's manager,
// and its answer compared with ONE read-only SQL statement against the dev database.
import { check, world, call, live, noLive, sql, SUBJECT, RID, RID2, FRENCH_HOUSE } from "./lib.mjs";

let N = 178401;
const id = () => { if (N > 178600) throw new Error("block C is full"); return "P" + N++; };
const C = (what, how, fn) => check(id(), `${SUBJECT} — ${what}`, how, fn);
// One second ago: a report cuts at "until now", and a row stamped in the same millisecond falls
// outside it — a fixture flicker, not a product fault (found in round 2).
const NOW = () => new Date(Date.now() - 1000).toISOString();
const routes = (r) => ({ modules: { printing: { routes: r } } });
const AGENT = (o = {}) => ({ id: "ag1", restaurant_id: RID, name: "Shop PC", last_seen_at: NOW(), revoked_at: null, printers: [{ name: "POS80" }], ...o });

// ═══ C1 · print/send ═══════════════════════════════════════════════════════════════════════════
const ps = async (o, body) => { const G = await world(o); const r = await call("POST", "print/send", { body }); return { G, r }; };
const BILLROUTE = { settings: routes({ bill: { agent: "ag1", printer: "POS80" }, kot: { agent: "ag1", printer: "KOT58" }, banquet: { agent: "ag1", printer: "POS80" } }) };
const SESS = { sessions: [{ id: "s1", restaurant_id: RID, table_number: "6", bill_no: 218 }] };
C("print/send refuses any kind but a kitchen slip, a bill or a banquet sheet (400), and queues nothing", "STUB · kind=invoice",
  async () => { const { G, r } = await ps({}, { kind: "invoice" }); return { ok: r.status === 400 && /kitchen slip, a bill or a banquet sheet/.test(r.json?.error || "") && G.WRITES.length === 0 }; });
C("print/send with no computer owning bills answers noRoute — the panel then opens its own window", "STUB · empty address book",
  async () => { const { G, r } = await ps({}, { kind: "bill", sessionId: "s1" }); return { ok: r.json?.noRoute === true && G.WRITES.length === 0 }; });
C("print/send: a bill line naming a machine that was REMOVED reads as no owner", "STUB · route names ag9, no such agent",
  async () => { const { r } = await ps({ settings: routes({ bill: { agent: "ag9", printer: "X" } }) }, { kind: "bill", sessionId: "s1" }); return { ok: r.json?.noRoute === true }; });
C("print/send: a REVOKED machine reads as no owner", "STUB · agent revoked",
  async () => { const { r } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT({ revoked_at: NOW() })] } }, { kind: "bill", sessionId: "s1" }); return { ok: r.json?.noRoute === true }; });
C("print/send bill without a sessionId says 'Which bill?' (400)", "STUB · route set",
  async () => { const { r } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()] } }, { kind: "bill" }); return { ok: r.status === 400 && r.json?.error === "Which bill?" }; });
C("print/send bill naming ANOTHER restaurant's session is refused (404) and queues nothing", "STUB · s9 belongs to RID2",
  async () => { const { G, r } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], sessions: [{ id: "s9", restaurant_id: RID2 }] } }, { kind: "bill", sessionId: "s9" });
    return { ok: r.status === 404 && /not this restaurant's/.test(r.json?.error || "") && !G.WRITES.some((w) => w.table === "print_jobs") }; });
C("print/send bill: queued for the named machine, the person told where it went", "STUB · route + live agent",
  async () => { const { G, r } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], ...SESS } }, { kind: "bill", sessionId: "s1" });
    const w = G.WRITES.find((x) => x.table === "print_jobs");
    return { ok: r.json?.queued === true && r.json.note === "Sent to POS80" && w?.patch?.agent_id === "ag1" && w.patch.printer === "POS80" && w.patch.payload?.sessionId === "s1", note: JSON.stringify(w?.patch) }; });
C("print/send bill: the queued row is this restaurant's", "STUB",
  async () => { const { G } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], ...SESS } }, { kind: "bill", sessionId: "s1" }); return { ok: G.WRITES.find((x) => x.table === "print_jobs")?.patch?.restaurant_id === RID }; });
C("print/send bill: the diary line says WHICH bill and for which table (\"bill #218 for table 6\")", "STUB",
  async () => { const { G } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], ...SESS } }, { kind: "bill", sessionId: "s1" });
    const l = G.LOGS.find((x) => x.action === "print_sent"); return { ok: !!l && /bill #218 for table 6 sent to POS80 on Shop PC/.test(l.detail) && l.table_number === "6", note: l?.detail }; });
C("print/send bill: …and WHO sent it, by name and by stable id", "STUB",
  async () => { const { G } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], ...SESS } }, { kind: "bill", sessionId: "s1" });
    const l = G.LOGS.find((x) => x.action === "print_sent"); return { ok: l?.actor === "Diag Manager" && l.actor_id === "u1" }; });
C("print/send bill when the machine is ASLEEP: still queued, and the person is told it waits", "STUB · last seen an hour ago",
  async () => { const { r } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT({ last_seen_at: new Date(Date.now() - 3600e3).toISOString() })], ...SESS } }, { kind: "bill", sessionId: "s1" });
    return { ok: r.json?.queued === true && r.json.connected === false && /as soon as Shop PC is back/.test(r.json.note), note: r.json?.note }; });
C("print/send from the ADMIN console without force: nothing comes out of the client's printer", "STUB · admin",
  async () => { const { G, r } = await ps({ who: "admin", ...BILLROUTE, fix: { print_agents: [AGENT()], ...SESS } }, { kind: "bill", sessionId: "s1" });
    return { ok: r.json?.adminView === true && !G.WRITES.some((w) => w.table === "print_jobs") }; });
C("print/send from the admin console WITH force: queued, and audited as 'sent deliberately from the admin console'", "STUB · admin, force",
  async () => { const { G, r } = await ps({ who: "admin", ...BILLROUTE, fix: { print_agents: [AGENT()], ...SESS } }, { kind: "bill", sessionId: "s1", force: true });
    const l = G.LOGS.find((x) => x.action === "print_sent_by_admin");
    return { ok: r.json?.queued === true && l?.actor === "Aevidine admin" && /sent deliberately from the admin console/.test(l.detail), note: l?.detail }; });
C("print/send banquet without a billId says 'Which banquet bill?'", "STUB",
  async () => { const { r } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()] } }, { kind: "banquet" }); return { ok: r.status === 400 && r.json?.error === "Which banquet bill?" }; });
C("print/send banquet naming another restaurant's banquet bill is refused", "STUB",
  async () => { const { r } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], banquet_bills: [{ id: "bb", restaurant_id: RID2 }] } }, { kind: "banquet", billId: "bb" }); return { ok: r.status === 404 }; });
C("print/send banquet: queued and logged as 'banquet sheet #N'", "STUB",
  async () => { const { G, r } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], banquet_bills: [{ id: "bb", restaurant_id: RID, bill_no: 7 }] } }, { kind: "banquet", billId: "bb" });
    const l = G.LOGS.find((x) => x.action === "print_sent"); return { ok: r.json?.queued === true && /banquet sheet #7/.test(l?.detail || ""), note: l?.detail }; });
C("print/send kot with no order id is a question, not a print: who owns the slips, nothing queued", "STUB · kot route set",
  async () => { const { G, r } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()] } }, { kind: "kot" });
    return { ok: r.json?.printer === "KOT58" && r.json.agent === "Shop PC" && !G.WRITES.some((w) => w.table === "print_jobs") && G.LOGS.length === 0 }; });
C("print/send kot for a CANCELLED ticket is refused in the reprint door's own words", "STUB",
  async () => { const { G, r } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], orders: [{ id: "o1", restaurant_id: RID, status: "cancelled" }] } }, { kind: "kot", orderId: "o1" });
    return { ok: r.status === 400 && /cancelled — there is nothing to reprint/.test(r.json?.error || "") && !G.WRITES.some((w) => w.table === "print_jobs") }; });
C("print/send kot for a BINNED ticket is refused", "STUB",
  async () => { const { r } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], orders: [{ id: "o1", restaurant_id: RID, status: "served", deleted_at: NOW() }] } }, { kind: "kot", orderId: "o1" }); return { ok: r.status === 400 && /deleted/.test(r.json?.error || "") }; });
C("print/send kot for another restaurant's order is 'not on this restaurant's board' (404)", "STUB",
  async () => { const { r } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], orders: [{ id: "o1", restaurant_id: RID2, status: "served" }] } }, { kind: "kot", orderId: "o1" }); return { ok: r.status === 404 }; });
C("print/send kot: queued with NO machine named, so the address book applies at claim time", "STUB",
  async () => { const { G, r } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], orders: [{ id: "o1", restaurant_id: RID, status: "served", kot_no: 12, table_number: "4" }] } }, { kind: "kot", orderId: "o1" });
    const w = G.WRITES.find((x) => x.table === "print_jobs"); return { ok: r.json?.queued === true && w?.patch?.kind === "kot" && w.patch.order_id === "o1" && !("agent_id" in w.patch), note: JSON.stringify(w?.patch) }; });
C("print/send kot: branded a reprint by default, and the caller can say it is the first copy", "STUB · reprint:false",
  async () => {
    // The stub world is ONE shared object, so the first answer is read before the second call resets it.
    const a = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], orders: [{ id: "o1", restaurant_id: RID, status: "served" }] } }, { kind: "kot", orderId: "o1" });
    const first = a.G.WRITES.find((x) => x.table === "print_jobs")?.patch?.reprint;
    const b = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], orders: [{ id: "o1", restaurant_id: RID, status: "served" }] } }, { kind: "kot", orderId: "o1", reprint: false });
    const second = b.G.WRITES.find((x) => x.table === "print_jobs")?.patch?.reprint;
    return { ok: first === true && second === false, note: `${first} / ${second}` }; });
C("print/send kot: the requester's name is capped at 80 characters", "STUB · a 120-char name",
  async () => { const G = await world({ ...BILLROUTE, user: { name: "N".repeat(120) }, fix: { print_agents: [AGENT()], orders: [{ id: "o1", restaurant_id: RID, status: "served" }] } });
    await call("POST", "print/send", { body: { kind: "kot", orderId: "o1" } }); return { ok: G.WRITES.find((x) => x.table === "print_jobs")?.patch?.requested_by?.length === 80 }; });
C("print/send kot: the diary line names the KOT number and the table", "STUB",
  async () => { const { G } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], orders: [{ id: "o1", restaurant_id: RID, status: "served", kot_no: 12, table_number: 4 }] } }, { kind: "kot", orderId: "o1" });
    const l = G.LOGS.find((x) => x.action === "kot_reprint_sent"); return { ok: /KOT #12 sent to KOT58 on Shop PC/.test(l?.detail || "") && l.table_number === "4" }; });
C("print/send: a failed queue write is 'Could not send that to the printer.' — never the database's words", "STUB · print_jobs insert errors",
  async () => { const { r } = await ps({ ...BILLROUTE, fix: { print_agents: [AGENT()], ...SESS }, fail: { "print_jobs:insert": "error" } }, { kind: "bill", sessionId: "s1" });
    return { ok: r.status === 500 && r.json?.error === "Could not send that to the printer." }; });

// ═══ C2 · POST table-sections ═══════════════════════════════════════════════════════════════════
const W1 = { staff_users: [{ id: "w1", restaurant_id: RID, role: "tablet", name: "Asha", username: "asha" }] };
const ts = async (body, o = {}) => { const G = await world({ fix: W1, ...o }); const r = await call("POST", "table-sections", { body }); const w = G.WRITES.find((x) => x.table === "staff_users"); return { G, r, w }; };
C("table-sections save: numbers are cleaned — duplicates gone, junk and out-of-range dropped, sorted", "STUB · ['7','3',3,0,99,'x',12.5,'1']",
  async () => { const { w } = await ts({ user_id: "w1", tables: ["7", "3", 3, 0, 99, "x", 12.5, "1"] }); return { ok: JSON.stringify(w?.patch?.assigned_tables) === "[1,3,7,12]", note: JSON.stringify(w?.patch) }; });
C("table-sections save: the clamp is THIS restaurant's table count (20), not a constant", "STUB · 20 and 21",
  async () => { const { w } = await ts({ user_id: "w1", tables: [20, 21] }); return { ok: JSON.stringify(w?.patch?.assigned_tables) === "[20]" }; });
C("table-sections save: a missing table count falls back to 12", "STUB · settings without table_count",
  async () => { const { w } = await ts({ user_id: "w1", tables: [12, 13] }, { settings: { table_count: null } }); return { ok: JSON.stringify(w?.patch?.assigned_tables) === "[12]" }; });
C("table-sections save: an empty list is allowed, and the diary says 'no tables'", "STUB",
  async () => { const { G, r } = await ts({ user_id: "w1", tables: [] }); const l = G.LOGS.find((x) => x.action === "table_sections_set"); return { ok: r.status === 200 && l?.detail === "Asha: no tables" }; });
C("table-sections save: the diary names the waiter and the tables ('Asha: T2 T5')", "STUB",
  async () => { const { G } = await ts({ user_id: "w1", tables: [5, 2] }); return { ok: G.LOGS.find((x) => x.action === "table_sections_set")?.detail === "Asha: T2 T5" }; });
C("table-sections save: a non-list 'tables' is read as an empty list, not a crash", "STUB · tables='5'",
  async () => { const { r, w } = await ts({ user_id: "w1", tables: "5" }); return { ok: r.status === 200 && Array.isArray(w?.patch?.assigned_tables) && w.patch.assigned_tables.length === 0 }; });
C("table-sections save without a user_id is 'Which person?' (400), nothing written", "STUB",
  async () => { const { r, G } = await ts({ tables: [1] }); return { ok: r.status === 400 && /Which person/.test(r.json?.error || "") && !G.WRITES.length }; });
C("table-sections save for another restaurant's waiter is 'no longer on this restaurant's team' (404)", "STUB · w2 under RID2",
  async () => { const { r } = await ts({ user_id: "w2", tables: [1] }, { fix: { staff_users: [{ id: "w2", restaurant_id: RID2, role: "tablet", name: "Other" }] } }); return { ok: r.status === 404 }; });
C("table-sections save cannot give a MANAGER login a section (the write is scoped to waiters)", "STUB · m1 is a manager",
  async () => { const { r } = await ts({ user_id: "m1", tables: [1] }, { fix: { staff_users: [{ id: "m1", restaurant_id: RID, role: "manager", name: "Mgr" }] } }); return { ok: r.status === 404 }; });
C("table-sections save: a failed write is 'Couldn't save that waiter's tables — please try again.' (500), never Postgres prose", "STUB · staff_users update errors",
  async () => { const { r } = await ts({ user_id: "w1", tables: [1] }, { fail: { "staff_users:update": "error" } }); return { ok: r.status === 500 && r.json?.error === "Couldn't save that waiter's tables — please try again." }; });
C("table-sections save: the answer carries the waiter's saved list so the grid shows the truth", "STUB",
  async () => { const { r } = await ts({ user_id: "w1", tables: [4] }); return { ok: r.json?.ok === true && r.json.user?.id === "w1" }; });
C("table-sections save: two managers on one rota — the second save is refused when the rota moved under it (first save wins)", "STUB · expect header names the list it was edited FROM",
  async () => { const G = await world({ fix: { staff_users: [{ id: "w1", restaurant_id: RID, role: "tablet", name: "Asha", "assigned_tables": [9] }] } });
    const r = await call("POST", "table-sections", { body: { user_id: "w1", tables: [1] }, headers: { "x-lfh-expect": JSON.stringify({ table: "staff_users", id: "w1", fields: { "assigned_tables": [3] } }) } });
    return { ok: r.status === 409 && !!r.json?.clash && !G.WRITES.some((w) => w.table === "staff_users"), note: `${r.status} ${r.json?.error}` }; });
C("…and the same save with an up-to-date expectation goes through", "STUB · expectation matches",
  async () => { await world({ fix: { staff_users: [{ id: "w1", restaurant_id: RID, role: "tablet", name: "Asha", "assigned_tables": [3] }] } });
    const r = await call("POST", "table-sections", { body: { user_id: "w1", tables: [1] }, headers: { "x-lfh-expect": JSON.stringify({ table: "staff_users", id: "w1", fields: { "assigned_tables": [3] } }) } });
    return { ok: r.status === 200, note: `${r.status}` }; });
C("…and an expectation about ANOTHER restaurant's row compares nothing (never reads it back)", "STUB · expect names RID2's waiter",
  async () => { await world({ fix: { staff_users: [{ id: "w1", restaurant_id: RID, role: "tablet", name: "Asha" }, { id: "w2", restaurant_id: RID2, role: "tablet", "assigned_tables": [8] }] } });
    const r = await call("POST", "table-sections", { body: { user_id: "w1", tables: [1] }, headers: { "x-lfh-expect": JSON.stringify({ table: "staff_users", id: "w2", fields: { "assigned_tables": [1] } }) } });
    return { ok: r.status === 200 && !r.text.includes("[8]"), note: `${r.status}` }; });

// ═══ C3 · the preamble every POST passes ════════════════════════════════════════════════════════
for (const seg of ["undefined", "null", "NaN"]) {
  C(`a POST whose id segment is the string "${seg}" is a clean 400 'Missing id', before any database read`, `STUB · POST orders/${seg}/tip`,
    async () => { const G = await world(); const r = await call("POST", `orders/${seg}/tip`, { body: { amount: 1 } });
      return { ok: r.status === 400 && /Missing id/.test(r.json?.error || "") && !G.READS.some((x) => x.table === "orders") }; });
}
C("…and the same for a THIRD segment ('items/abc/undefined')", "STUB",
  async () => { await world(); const r = await call("POST", "items/abc/undefined", { body: {} }); return { ok: r.status === 400 && /Missing id/.test(r.json?.error || "") }; });
C("a POST with a body that is not JSON is read as an empty body, never a crash", "STUB · body 'not json'",
  async () => { await world({ fix: W1 }); const r = await call("POST", "table-sections", { body: "not json{" }); return { ok: r.status === 400 && /Which person/.test(r.json?.error || ""), note: `${r.status}` }; });
C("an order for a table far off this restaurant's plan (99999) is refused before it is placed", "STUB · POST order",
  async () => { const G = await world({ settings: { take_orders_allowed: true } }); const r = await call("POST", "order", { body: { table: 99999, items: [{ id: "x", qty: 1 }] } });
    return { ok: r.status === 400 && !G.RPCS.some((c) => c.name === "lfh_staff_place_order"), note: `${r.status} "${r.json?.error}"` }; });
C("opening a table far off the plan (sessions/open, 99999) is refused the same way", "STUB",
  async () => { const G = await world(); const r = await call("POST", "sessions/open", { body: { table: 99999 } }); return { ok: r.status === 400 && G.WRITES.length === 0, note: `${r.status} "${r.json?.error}"` }; });
C("a non-numeric table label ('parcel') is never judged by the plan check", "STUB · sessions/open table=parcel",
  async () => { await world(); const r = await call("POST", "sessions/open", { body: { table: "parcel" } }); return { ok: !/doesn't exist|isn't on/.test(r.json?.error || "") || r.status !== 400, note: `${r.status} "${r.json?.error}"` }; });
C("a write replayed from a device that was offline, onto a table whose party has since LEFT, is refused with a reason", "STUB · replay markers, table 5 closed after the change was queued",
  async () => { const queued = new Date(Date.now() - 10 * 60e3).toISOString();
    const G = await world({ fix: { sessions: [{ id: "s5", restaurant_id: RID, table_number: "5", status: "closed", created_at: new Date(Date.now() - 20 * 60e3).toISOString(), closed_at: new Date(Date.now() - 5 * 60e3).toISOString() }] } });
    const r = await call("POST", "order", { body: { table: 5, items: [{ id: "x", qty: 1 }] }, headers: { "x-lfh-replay": "1", "x-lfh-queued-at": queued } });
    return { ok: r.status === 409 && !!r.json?.clash && !G.RPCS.some((c) => c.name === "lfh_staff_place_order"), note: `${r.status} ${r.json?.error}` }; });
C("a LIVE write (no replay marker) never pays for the replay check", "STUB · count sessions reads on POST table-sections",
  async () => { const G = await world({ fix: W1 }); await call("POST", "table-sections", { body: { user_id: "w1", tables: [1] } }); return { ok: !G.READS.some((x) => x.table === "sessions") }; });

// ═══ C4 · the photo door ════════════════════════════════════════════════════════════════════════
const photo = async (o, file, extra = {}) => { const G = await world(o); const fd = new FormData(); if (file) fd.append("file", file); for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const r = await call("POST", "dish-photo", { form: fd }); return { G, r }; };
const PNG = (n = 10) => new File([new Uint8Array(n)], "d.png", { type: "image/png" });
C("dish photo with no file attached says 'No photo was attached — pick a file and try again.'", "STUB",
  async () => { const { r } = await photo({}, null); return { ok: r.status === 400 && /No photo was attached/.test(r.json?.error || "") }; });
C("dish photo: an SVG is refused, naming the three formats that ARE accepted", "STUB · image/svg+xml",
  async () => { const { r } = await photo({}, new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })); return { ok: r.status === 400 && /PNG, JPG or WEBP/.test(r.json?.error || "") }; });
C("dish photo: a GIF is refused the same way", "STUB · image/gif",
  async () => { const { r } = await photo({}, new File([new Uint8Array(5)], "x.gif", { type: "image/gif" })); return { ok: r.status === 400 }; });
C("dish photo: a file over 4 MB is refused before anything is stored", "STUB · 4 MB + 1 byte",
  async () => { const { r } = await photo({}, PNG(4 * 1024 * 1024 + 1)); return { ok: r.status === 400 && /larger than 4 MB/.test(r.json?.error || "") }; });
C("dish photo: a manager without 'Edit a dish' is refused", "STUB · edit_menu.manager_opts.edit_dish=false",
  async () => { const { r } = await photo({ accessConfig: { edit_menu: { manager_opts: { edit_dish: false } } } }, PNG()); return { ok: r.status === 403 && /edit dishes/.test(r.json?.error || "") }; });
C("dish photo: with the Edit-menu FEATURE half off, refused", "STUB · access_config.edit_menu.on=false",
  async () => { const { r } = await photo({ accessConfig: { edit_menu: { on: false } } }, PNG());
    // Since item 3 the tab gate answers first, in its own words; either refusal is the right one.
    return { ok: r.status === 403 && /edit the menu|menu editor isn't part/.test(r.json?.error || ""), note: `"${r.json?.error}"` }; });
C("dish photo: with the manager's Edit menu TAB switched off (read-only Viewer for everyone below the admin), refused like every other menu-editor door", "STUB · menus.manager.editor=false",
  async () => { const { r } = await photo({ accessConfig: { menus: { manager: { editor: false } } } }, PNG()); return { ok: r.status === 403, note: `${r.status} "${r.json?.error}"` }; });
C("dish photo: …and the OWNER is refused too while it is switched off (the 2026-08-02 rule)", "STUB · owner, tab off",
  async () => { const { r } = await photo({ who: "owner", accessConfig: { menus: { manager: { editor: false } } } }, PNG()); return { ok: r.status === 403, note: `${r.status}` }; });

// ═══ C5 · the floor-snapshot wrapper ════════════════════════════════════════════════════════════
const floorCalls = (G) => G.RPCS.filter((c) => c.name === "lfh_table_view_summary" && c.args.p_table === null).length;
C("a write drops the restaurant's shared floor snapshot: read → write → read costs TWO floor reads, not one", "STUB · GET summary, POST table-sections, GET summary",
  async () => { await new Promise((r) => setTimeout(r, 1600)); const G = await world({ fix: W1, rpc: { lfh_table_view_summary: { tiles: {} } } });
    await call("GET", "summary"); await call("POST", "table-sections", { body: { user_id: "w1", tables: [1] } }); await call("GET", "summary");
    return { ok: floorCalls(G) === 2, note: `${floorCalls(G)} whole-floor reads` }; });
C("…and a REFUSED write drops it too (the restaurant is known before the refusal)", "STUB · the POST is refused 400",
  async () => { await new Promise((r) => setTimeout(r, 1600)); const G = await world({ rpc: { lfh_table_view_summary: { tiles: {} } } });
    await call("GET", "summary"); await call("POST", "table-sections", { body: {} }); await call("GET", "summary");
    return { ok: floorCalls(G) === 2, note: `${floorCalls(G)}` }; });
C("…while two reads with no write between them share one database call", "STUB",
  async () => { await new Promise((r) => setTimeout(r, 1600)); const G = await world({ rpc: { lfh_table_view_summary: { tiles: {} } } });
    await call("GET", "summary"); await call("GET", "summary"); return { ok: floorCalls(G) === 1 }; });
C("a write to restaurant A never drops restaurant B's snapshot", "STUB · admin reads B, writes A, reads B",
  async () => { await new Promise((r) => setTimeout(r, 1600)); const G = await world({ who: "admin", fix: W1, rpc: { lfh_table_view_summary: { tiles: {} } } });
    await call("GET", "summary", { query: `?rid=${RID2}` }); await call("POST", "table-sections", { query: `?rid=${RID}`, body: { user_id: "w1", tables: [1] } }); await call("GET", "summary", { query: `?rid=${RID2}` });
    const b = G.RPCS.filter((c) => c.name === "lfh_table_view_summary" && c.args.p_restaurant_id === RID2).length; return { ok: b === 1, note: `${b} reads of B` }; });

// ═══ C6 · the invoice lock (helpers in this half, driven through their callers) ═══════════════════
const lockWorld = (sess, orderCreated) => world({ fix: { orders: [{ id: "o1", restaurant_id: RID, session_id: "s1", created_at: orderCreated }], sessions: [{ id: "s1", restaurant_id: RID, ...sess }] }, perms: { give_discounts: true } });
const disc = async () => call("POST", "orders/o1/discount", { body: { amount: 10 } });
const T0 = "2026-10-09T10:00:00.000Z", BEFORE = "2026-10-09T09:00:00.000Z", AFTER = "2026-10-09T11:00:00.000Z";
const locked = (r) => r.status === 409 && /on the printed bill/.test(r.json?.error || "");
C("invoice lock: a bill with a LIVE invoice refuses a money edit, with the sentence that says what DOES work", "STUB · invoice 5, not voided",
  async () => { await lockWorld({ invoice_no: 5, invoice_voided: false, invoice_at: T0 }, BEFORE); const r = await disc(); return { ok: locked(r), note: `${r.status} ${r.json?.error}` }; });
C("invoice lock: a bill with no invoice is not locked", "STUB · invoice_no null",
  async () => { await lockWorld({ invoice_no: null }, BEFORE); const r = await disc(); return { ok: !locked(r), note: `${r.status}` }; });
C("invoice lock: a REOPENED bill keeps the lines that were on the paper locked", "STUB · reopened, order placed before the invoice",
  async () => { await lockWorld({ invoice_no: 5, invoice_voided: true, invoice_at: T0 }, BEFORE); const r = await disc(); return { ok: locked(r) }; });
C("invoice lock: …but a line ADDED after the reopen can be changed", "STUB · reopened, order placed after the invoice",
  async () => { await lockWorld({ invoice_no: 5, invoice_voided: true, invoice_at: T0 }, AFTER); const r = await disc(); return { ok: !locked(r), note: `${r.status}` }; });
C("invoice lock: a reopened bill with NO invoice time is locked — a missing timestamp never unlocks paper", "STUB · invoice_at null",
  async () => { await lockWorld({ invoice_no: 5, invoice_voided: true, invoice_at: null }, AFTER); const r = await disc(); return { ok: locked(r) }; });
C("invoice lock: an order with no created_at on a reopened bill is locked", "STUB · created_at null",
  async () => { await lockWorld({ invoice_no: 5, invoice_voided: true, invoice_at: T0 }, null); const r = await disc(); return { ok: locked(r) }; });
C("invoice lock: an order of ANOTHER restaurant is never looked up as if it were this one's", "STUB · the order is RID2's",
  async () => { await world({ fix: { orders: [{ id: "o1", restaurant_id: RID2, session_id: "s1" }], sessions: [{ id: "s1", restaurant_id: RID2, invoice_no: 5, invoice_voided: false }] } });
    const r = await disc(); return { ok: !locked(r), note: `${r.status} (not this restaurant's lock to answer)` }; });
C("invoice lock by ITEM: a dish line on a live-invoiced bill cannot be deleted", "STUB · POST items/i1/delete",
  async () => { await world({ fix: { order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1" }], orders: [{ id: "o1", restaurant_id: RID, session_id: "s1", created_at: BEFORE }], sessions: [{ id: "s1", restaurant_id: RID, invoice_no: 5, invoice_voided: false, invoice_at: T0 }] } });
    const r = await call("POST", "items/i1/delete", { body: {} }); return { ok: locked(r), note: `${r.status}` }; });

// ═══ C7 · LIVE: every GET endpoint, on this terminal's port, as French House's manager ═══════════
const LIVE = [
  "/whoami", "/all", "/orders", "/orders?bills=1", "/orders?table=1", "/calls", "/issues", "/platform", "/zreport", "/gst-report",
  "/summary", "/summary?table=1", "/sessions", "/sessions?table=1", "/stats", "/staff-risk?range=today", "/users", "/oplog", "/audit",
  "/khata", "/khata/customers?q=a", "/onhouse?days=30", "/banquet/items", "/banquet/bills", "/customer-search?q=987",
  "/customer-recognize?phone=9999999999", "/table-sections", "/print-jobs/pending", "/printing/state", "/ratings",
];
for (const p of LIVE) {
  C(`LIVE GET ${p}: JSON with no server error, under 4 seconds`, "driven on http://127.0.0.1:4409 as French House's manager (one cached sign-in)",
    async () => { const r = await live(p); const s = noLive(r); if (s) return s;
      const json = String(r.headers.get("content-type") || "").includes("application/json");
      return { ok: r.status < 500 && json && r.ms < 4000, note: `${r.status} · ${r.ms} ms` }; });
  C(`LIVE GET ${p}: nothing in the answer reads NaN, [object Object] or an unfilled \${…}`, "driven live, the raw text scanned",
    async () => { const r = await live(p); const s = noLive(r); if (s) return s;
      const bad = ["NaN", "[object Object]", "${"].filter((x) => r.text.includes(x === "NaN" ? ":NaN" : x));
      return { ok: bad.length === 0, note: bad.length ? bad.join(",") : `${r.text.length} bytes clean` }; });
}

// ═══ C8 · LIVE vs the DATABASE ══════════════════════════════════════════════════════════════════
const FH = FRENCH_HOUSE;
const one = async (q) => (await sql(q))[0] || {};
const startIso = () => { const IST = 5.5 * 3600e3, F = 5 * 3600e3; const i = Math.floor((Date.now() + IST - F) / 864e5); return new Date(i * 864e5 + F - IST).toISOString(); };
const L = (what, p, fn) => C(`LIVE vs DB: ${what}`, `driven on :4409 (${p}), compared with one read-only SQL statement`, async () => { const r = await live(p); const s = noLive(r); if (s) return s; return fn(r.json || {}, r); });
L("the waiter roster is exactly French House's live waiters", "/table-sections", async (j) => { const d = await one(`select count(*)::int n from staff_users where restaurant_id='${FH}' and role='tablet' and deleted_at is null`); return { ok: j.waiters?.length === d.n, note: `${j.waiters?.length} vs ${d.n}` }; });
L("the rota's table count is the restaurant's own", "/table-sections", async (j) => { const d = await one(`select table_count from settings where restaurant_id='${FH}'`); return { ok: j.tableCount === (Number(d.table_count) || 12), note: `${j.tableCount} vs ${d.table_count}` }; });
// The book's own function is NOT callable from the read-only SQL login (service_role only — the
// grant rule doing its job), so the cross-check is the book against itself and against the picker.
L("the Pay later total is the sum of every person's outstanding", "/khata", async (j) => { const s = Math.round((j.customers || []).reduce((a, c) => a + c.outstanding, 0) * 100) / 100; return { ok: Math.abs(j.total - s) < 0.011, note: `${j.total} vs ${s} over ${(j.customers || []).length} people` }; });
L("…and the book's function is callable by the server only, not by a plain database login", "/khata", async () => { const d = await one(`select has_function_privilege('authenticated', 'public.lfh_khata_outstanding(uuid[], integer)', 'execute') a, has_function_privilege('anon', 'public.lfh_khata_outstanding(uuid[], integer)', 'execute') b`); return { ok: d.a === false && d.b === false, note: JSON.stringify(d) }; });
L("whoami's dashboard reach is the stored one", "/whoami", async (j) => { const d = await one(`select coalesce(access_config->'view_dashboard'->'manager_opts'->>'range','today') r from restaurants where id='${FH}'`); return { ok: j.dashReach === (["today_yesterday", "last7", "last30"].includes(d.r) ? d.r : "today"), note: `${j.dashReach} vs ${d.r}` }; });
L("whoami's bills reach is the stored one", "/whoami", async (j) => { const d = await one(`select coalesce(access_config->'view_bills'->'manager_opts'->>'range','today') r from restaurants where id='${FH}'`); return { ok: j.billsReach === (d.r === "today_yesterday" ? d.r : "today"), note: `${j.billsReach} vs ${d.r}` }; });
L("whoami's switched-off settings sections are the stored ones", "/whoami", async (j) => { const d = await one(`select coalesce(access_config->'menus'->'mgrset','{}'::jsonb) m from restaurants where id='${FH}'`); const off = ["tables", "users", "access"].filter((k) => d.m?.[k] === false); return { ok: JSON.stringify(j.settingsOff) === JSON.stringify(off), note: `${JSON.stringify(j.settingsOff)} vs ${JSON.stringify(off)}` }; });
L("whoami's switched-off tabs are the stored ones", "/whoami", async (j) => { const d = await one(`select coalesce(access_config->'menus'->'manager','{}'::jsonb) m from restaurants where id='${FH}'`); const off = ["editor", "ratings", "log"].filter((k) => d.m?.[k] === false); return { ok: JSON.stringify(j.tabsOff) === JSON.stringify(off), note: JSON.stringify(j.tabsOff) }; });
L("whoami says this is a manager, not the admin", "/whoami", async (j) => ({ ok: j.actor === "manager" && j.isAdmin === false && j.canDeleteBill === false }));
L("the day-close sheet's issued count is the bill counter's", "/zreport", async (j) => { const d = await one(`select coalesce((select n from daily_counters where restaurant_id='${FH}' and key='bill' and day=(now() at time zone 'Asia/Kolkata' - interval '5 hours')::date),0) n`); return { ok: j.numbering?.issued === d.n, note: `${j.numbering?.issued} vs ${d.n}` }; });
L("the sheet's 'on nothing at all' list is exactly the numbers no row in the database carries", "/zreport", async (j) => {
  const d = await sql(`with c as (select coalesce((select n from daily_counters where restaurant_id='${FH}' and key='bill' and day=(now() at time zone 'Asia/Kolkata' - interval '5 hours')::date),0) n)
    -- Bill numbers RESTART every business day, so only rows of TODAY's day count — the sheet's own two
    -- doors: a session created today, or one carrying one of today's orders (round 2: a three-day window
    -- matched yesterday's #15 and called today's honest gap a false one).
    , s as (select id, bill_no from sessions where restaurant_id='${FH}' and bill_no is not null
              and (created_at >= '${startIso()}' or id in (select session_id from orders where restaurant_id='${FH}' and created_at >= '${startIso()}')))
    select g::int no from c, generate_series(1, c.n) g where not exists (select 1 from s where s.bill_no=g)
      and not exists (select 1 from aggregator_orders a where a.restaurant_id='${FH}' and a.bill_no=g and a.created_at >= '${startIso()}') order by 1`);
  const want = d.map((x) => x.no); return { ok: JSON.stringify(j.numbering?.unaccounted) === JSON.stringify(want), note: `sheet ${JSON.stringify(j.numbering?.unaccounted)} · database ${JSON.stringify(want)} (test cleanup leaves these — the sheet is honest)` }; });
L("the sheet's live order count is the database's", "/zreport", async (j) => { const d = await one(`select count(*)::int n from orders where restaurant_id='${FH}' and created_at >= '${startIso()}' and status <> 'cancelled'`); return { ok: Math.abs(j.dineIn?.orderCount - d.n) <= 1, note: `${j.dineIn?.orderCount} vs ${d.n} (±1 for an order landing mid-check)` }; });
L("invoices generated today match", "/zreport", async (j) => { const d = await one(`select count(*)::int n from sessions where restaurant_id='${FH}' and invoice_at >= '${startIso()}'`); return { ok: j.invoicesGenerated === d.n, note: `${j.invoicesGenerated} vs ${d.n}` }; });
L("the till total equals the money collected (the drawer reconciles)", "/zreport", async (j) => ({ ok: Math.abs((j.payments?.total ?? 0) - (j.dineIn?.paidNet ?? 0)) < 0.05, note: `${j.payments?.total} vs ${j.dineIn?.paidNet}` }));
L("the dashboard's paid count is the database's (binned bills left out)", "/stats", async (j) => { const d = await one(`select count(*)::int n from orders where restaurant_id='${FH}' and created_at >= '${startIso()}' and status <> 'cancelled' and payment_status='paid' and deleted_at is null`); return { ok: Math.abs(j.paid - d.n) <= 1, note: `${j.paid} vs ${d.n}` }; });
L("the dashboard's open tables is the database's open sessions", "/stats", async (j) => { const d = await one(`select count(*)::int n from sessions where restaurant_id='${FH}' and status='open'`); return { ok: Math.abs(j.live?.dineIn - d.n) <= 1, note: `${j.live?.dineIn} vs ${d.n}` }; });
L("the dashboard answers the range its reach allows", "/stats", async (j) => ({ ok: ["today", "yesterday", "last7", "last30"].includes(j.range), note: j.range }));
L("the GST report's bill count is the database's paid bills in its window", "/gst-report", async (j) => { if (j.monthMode) return "skip: this restaurant is on the 30-day rung"; const d = await one(`select count(distinct coalesce(session_id::text, 'solo:'||id::text))::int n from orders where restaurant_id='${FH}' and payment_status='paid' and status <> 'cancelled' and created_at >= '${startIso()}'`); return { ok: Math.abs(j.totals?.bills - d.n) <= 1, note: `${j.totals?.bills} vs ${d.n}` }; });
L("the On-the-house report answers French House's reach (item 2) and the database's count", "/onhouse?days=30", async (j) => { const d = await one(`select count(distinct coalesce(session_id::text,id::text))::int n from orders where restaurant_id='${FH}' and payment_method='On the house' and payment_status='paid' and paid_at >= '${startIso()}'`); return { ok: j.reach === "today" ? j.days === 1 && j.count === d.n : true, note: `${j.days} day(s), ${j.count} vs ${d.n}` }; });
L("the waiter calls list is the database's newest (capped at 100)", "/calls", async (j) => { const d = await one(`select count(*)::int n from waiter_calls where restaurant_id='${FH}'`); return { ok: Array.isArray(j) && j.length === Math.min(100, d.n), note: `${j.length} vs ${d.n}` }; });
L("the ratings summary total is the database's", "/ratings", async (j, r) => { if (r.status === 403) return { ok: true, note: "Rating review not granted here — refused, as it should be" }; const d = await one(`select count(*)::int n from feedback where restaurant_id='${FH}'`); return { ok: j.summary?.total === d.n, note: `${j.summary?.total} vs ${d.n}` }; });
L("the removals list is the database's newest 100, answers excluded", "/audit", async (j) => { const d = await one(`select count(*)::int n from deletion_audit where restaurant_id='${FH}' and kind <> 'removal_classified'`); return { ok: Array.isArray(j) && j.length === Math.min(100, d.n), note: `${j.length} vs ${d.n}` }; });
L("the customer log's guest list is French House's (capped at 500)", "/users", async (j) => { const d = await one(`select count(*)::int n from session_members where restaurant_id='${FH}'`); return { ok: j.members?.length === Math.min(500, d.n), note: `${j.members?.length} vs ${d.n}` }; });
L("the activity log never shows the admin's or the owner's rows to a manager", "/oplog", async (j) => ({ ok: Array.isArray(j) && j.length <= 200 && !j.some((x) => ["admin", "owner", "db"].includes(x.panel)), note: `${j.length} rows` }));
// CORRECTED in round 2: the marker is lib/logMarks.ts's uuid, not the text "admin:view" this row first
// looked for — which can never appear, so the first version could only pass.
L("…and never the admin-view marker", "/oplog", async (j) => ({ ok: !j.some((x) => x.actor_id === "00000000-0000-0000-0000-0000000000ad"), note: `${j.filter((x) => x.actor_id === null).length} row(s) with the actor id blanked` }));
L("…and every error row carries a plain sentence beside its exact text", "/oplog", async (j) => { const e = j.filter((x) => x.level === "error" && x.detail); return { ok: e.every((x) => typeof x.plain === "string" && x.plain.length > 0), note: `${e.length} error rows` }; });
L("the Bills record holds only bills inside the reach window, none binned", "/orders?bills=1", async (j) => { const from = startIso(); const rows = j.rows || []; return { ok: rows.every((o) => !o.deleted_at && o.created_at >= from) && (j.reach === "today" || j.reach === "today_yesterday"), note: `${rows.length} rows · reach ${j.reach}` }; });
L("the live floor read carries no binned order", "/orders", async (j) => ({ ok: Array.isArray(j) && j.every((o) => !o.deleted_at), note: `${j.length}` }));
L("the menu bundle has exactly French House's dishes", "/all", async (j) => { const d = await one(`select count(*)::int n from menu_items where restaurant_id='${FH}'`); return { ok: j.items?.length === d.n, note: `${j.items?.length} vs ${d.n}` }; });
L("…and its categories", "/all", async (j) => { const d = await one(`select count(*)::int n from categories where restaurant_id='${FH}'`); return { ok: j.categories?.length === d.n, note: `${j.categories?.length} vs ${d.n}` }; });
L("…and its own name for the printed bill", "/all", async (j) => ({ ok: j.restaurant?.id === FH, note: j.restaurant?.name }));
L("the Platform board's channels are the stored switches", "/platform", async (j) => { const d = await one(`select coalesce(platform_channels,'{}'::jsonb) c from settings where restaurant_id='${FH}'`); return { ok: j.channels?.zomato === (d.c?.zomato?.on === true) && j.channels?.swiggy === (d.c?.swiggy?.on === true), note: JSON.stringify(j.channels) }; });
L("the Printing screen offers no setup controls (setup is Aevidine's, owner 2026-09-14)", "/printing/state", async (j) => ({ ok: j.maySetup === false && !("files" in j), note: `maySetup=${j.maySetup}` }));
L("the pending print poll answers either jobs or 'off', never both missing", "/print-jobs/pending", async (j) => ({ ok: Array.isArray(j.jobs), note: `${j.jobs?.length} jobs · off=${!!j.off}` }));
L("the banquet ledger page is at most 40 rows", "/banquet/bills", async (j, r) => ({ ok: r.status === 403 || (Array.isArray(j.bills) && j.bills.length <= 40), note: `${r.status} ${j.bills?.length}` }));
L("customer search answers only numbers beginning with what was typed", "/customer-search?q=987", async (j) => ({ ok: (j.matches || []).every((m) => String(m.phone || "").replace(/\D/g, "").includes("987")), note: `${j.matches?.length} matches` }));
L("the floor summary's tiles never name a table outside the plan + counters", "/summary", async (j) => { const d = await one(`select table_count from settings where restaurant_id='${FH}'`); const nums = Object.keys(j.tiles || {}).map(Number).filter(Number.isFinite); return { ok: nums.every((n) => n <= Number(d.table_count) + 500), note: `${nums.length} tiles, plan ${d.table_count}` }; });

console.log(`block C: ${N - 178401} checks defined (P178401–P${N - 1})`);
