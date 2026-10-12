// verify-public-endpoints.mjs — the three endpoints on the deliberately-public list, driven IN MEMORY.
//
//   npm run verify:public-endpoints
//
// /api/health, /api/log/client-error and /api/maintenance are the shared panel plumbing's server
// half (sweep #10 T16). The REAL route files are bundled with esbuild and their handlers called with
// a stubbed database (scripts/panel-stubs), a stubbed phone alert and a stubbed owner portfolio — so
// every branch runs, nothing is written anywhere, nobody's phone buzzes, and no request is ever sent
// to a running app without a login "to see what happens" (the "nobody" here is a stubbed identity).
//
// WHY IT EXISTS: sweep #10 T16 found /api/maintenance scoping an OWNER to their login's "home" row —
// restaurant #1 — instead of a restaurant they own. Section 3 pins the fix.
import { call, world, g, FH, PP } from "./sweep/t16s10/routes.mjs";

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); } };
if (process.argv.some((a) => a.startsWith("--base"))) console.log("verify-public-endpoints: --base does not apply — the handlers run in memory.");

console.log("\n1) /api/health — a connection probe and nothing else");
await world({ who: "nobody" }); let r = await call("health", "GET");
ok(r.status === 200 && r.text === '{"ok":true}', "answers {ok:true} with no login of any kind", r.text);
ok(/no-store/.test(r.headers.get("cache-control") || ""), "…and is never cached");
ok(g().READS.length === 1 && g().READS[0].table === "restaurants", "…after exactly one bounded read", JSON.stringify(g().READS));
await world({ fail: { restaurants: "error" } }); r = await call("health", "GET");
ok(r.status === 503 && r.text === '{"ok":false,"db":false}', "a database that does not answer turns it 503, with no detail", r.text);
await world({ fail: { restaurants: "throw" } }); r = await call("health", "GET");
ok(r.status === 503 && r.text === '{"ok":false}', "…and one that throws is 503 too, never a crash page", r.text);

console.log("\n2) /api/maintenance — a staff member reads and changes ONLY their own restaurant's switch");
await world({ who: "nobody" }); r = await call("maintenance", "GET");
ok(r.status === 401 && g().READS.length === 0, "no login → 401, before any database read");
await world({ who: "blip" }); r = await call("maintenance", "GET");
ok(r.status === 503, "a login lookup that blipped → 503 so the panel retries, not a sign-out");
await world(); r = await call("maintenance", "GET", { query: "?rid=" + PP });
ok(r.status === 200 && r.json.maintenance === false, "a manager naming ANOTHER restaurant still reads their own (French House off, Pizza Palace on)", JSON.stringify(r.json));
await world(); r = await call("maintenance", "POST", { body: { on: true } });
ok(r.status === 403 && g().WRITES.length === 0, "taking the menu down is refused while the admin has not switched that power on");
await world({ access: { maintenance: { on: true, manager_opts: { who: "owner_manager" } } } }); r = await call("maintenance", "POST", { body: { on: true }, query: "?rid=" + PP });
const w = g().WRITES[0] || {};
ok(r.status === 200 && g().FIX.settings.find((x) => x.restaurant_id === FH).service_mode === true && g().FIX.settings.find((x) => x.restaurant_id === PP).service_mode === true && w.matched === 1, "…and once allowed, a manager naming another restaurant still flips only THEIR OWN", JSON.stringify(w));
await world({ who: "admin" }); r = await call("maintenance", "POST", { body: { on: false }, query: "?rid=" + PP });
ok(r.status === 200 && (g().LOGS[0] || {}).panel === "admin", "the admin's flip is recorded in the admin's log, out of the owner's feed", JSON.stringify(g().LOGS[0]));

console.log("\n3) /api/maintenance — an OWNER is scoped to a restaurant they own, never to the #1 home row");
await world({ who: "owner", owned: { o1: [PP] } }); r = await call("maintenance", "GET");
ok(r.status === 400 && g().READS.filter((x) => x.table === "settings").length === 0, "an owner naming no restaurant is refused, not guessed (no settings read)", `${r.status} ${r.text}`);
await world({ who: "owner", owned: { o1: [PP] } }); r = await call("maintenance", "GET", { query: "?rid=" + FH });
ok(r.status === 403 && g().READS.filter((x) => x.table === "settings").length === 0, "an owner naming a restaurant they do NOT own is refused", `${r.status} ${r.text}`);
await world({ who: "owner", owned: { o1: [PP] } }); r = await call("maintenance", "GET", { query: "?rid=" + PP });
ok(r.status === 200 && r.json.maintenance === true, "an owner naming their own restaurant reads THAT restaurant's switch", JSON.stringify(r.json));
await world({ who: "owner", owned: { o1: [PP] }, access: { maintenance: { on: true } } }); g().FIX.restaurants.find((x) => x.id === PP).access_config = { maintenance: { on: true } };
r = await call("maintenance", "POST", { body: { on: false }, query: "?rid=" + PP });
ok(r.status === 200 && g().FIX.settings.find((x) => x.restaurant_id === PP).service_mode === false && g().FIX.settings.find((x) => x.restaurant_id === FH).service_mode === false, "…and an owner's flip lands on their restaurant and touches no other");
await world({ who: "owner", owned: { o1: [PP] }, access: { maintenance: { on: true } } }); r = await call("maintenance", "POST", { body: { on: true }, query: "?rid=" + FH });
ok(r.status === 403 && g().WRITES.length === 0, "an owner can never flip a restaurant they do not own, even with the power on there");

console.log("\n4) /api/log/client-error — accepts a crash from anyone, writes only what it should");
const post = (body, headers = {}) => call("clientError", "POST", { body, headers });
await world({ who: "nobody" }); r = await post({ panel: "manager", message: "boom", where: "app.js:1" });
ok(r.json.ok === true && g().FIX.staff_actions.filter((x) => x.action === "client_error").length === 1, "a crash report is filed with no login");
await world(); r = await post("x".repeat(2049));
ok(r.json.skipped === "too_large" && !g().FIX.staff_actions.length, "a body over 2 KB is dropped before parsing");
await world(); r = await post({ panel: "nonsense" });
ok(r.json.skipped === "bad_panel" && !g().FIX.staff_actions.length, "an unknown panel writes nothing");
await world(); await post({ panel: "guest", message: "boom", where: "/r/french-house/menu", rid: PP });
ok((g().FIX.staff_actions[0] || {}).restaurant_id === FH, "a restaurant the ADDRESS contradicts is filed under the address");
const now = new Date().toISOString();
await world({ actions: Array.from({ length: 5 }, (_, i) => ({ id: "a" + i, device_id: "ip:unknown", action: "client_error", created_at: now })) });
r = await post({ panel: "manager", message: "sixth" });
ok(r.json.skipped === "rate_limited", "a caller with no cookie is capped at five crashes in ten minutes too");
await world(); await post({ panel: "manager", kind: "taps", detail: "[1]" }); await Promise.all(g().AFTER);
ok(g().ALERTS.length === 0, "a tap breadcrumb never pings the owner's phone");

console.log(`\n${fail ? "❌" : "✅"} public endpoints: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
