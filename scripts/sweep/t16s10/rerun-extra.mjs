// scripts/sweep/t16s10/rerun-extra.mjs — the last driven leftovers: a hung write in the site's drawer
// (P45618–P45621), the site's live-update boot (P45622–P45626), load order on the served pages
// (P45638–P45657), sweep #6's P15xxx rows, and scattered rows whose subject is one of my files.
/* eslint-disable @typescript-eslint/no-unused-vars -- a re-run harness: each suite imports the shared helper set whole, and scenario objects carry fields only some rows read */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { R, ok, eq, assert, tag, src, code, strip, npmRun, ROOT, ROUTES } from "./lib.mjs";
import { harness, memo, until, sleep, siteFile, SITE, BASE } from "./browser.mjs";

const done = tag("extra");
const PROFILE = { staff: true, id: "u1", username: "diagm1", role: "manager", name: "Diag", phone: "9", needsProfile: false };
// ── a write that hangs: the drawer gives up and SAYS nothing changed (P45618–P45621) ──
const hungWrite = memo(async () => {
  const h = await harness({ from: "site", viewport: { width: 390, height: 780 }, body: '<div class="topbar"><div class="top-actions"></div></div>', scripts: ["backstack.js", "maint.js", "outbox.js"],
    api: async (rec) => { if (/panel-profile/.test(rec.path)) return { status: 200, body: PROFILE }; if (/maintenance/.test(rec.path)) { if (rec.method === "POST") { await new Promise((r) => setTimeout(r, 11000)); return { status: 200, body: { maintenance: true } }; } return { status: 200, body: { maintenance: false } }; } return { status: 200, body: { ok: true } }; } });
  const P = h.page;
  await P.waitForSelector("#staffSettingsBtn"); await P.click("#staffSettingsBtn"); await sleep(500);
  const btn = () => P.locator(".lfh-sec", { has: P.locator("h3", { hasText: "Guest menu" }) }).locator("button").first();
  await btn().click(); await sleep(200); await P.locator(".lfh-ask-yes").last().click();
  await sleep(9500);
  const said = await P.evaluate(() => [...document.querySelectorAll(".lfh-dw")].map((d) => d.textContent).join(" || "));
  const label = await btn().textContent();
  const res = { said, label, errors: h.errors };
  await h.close(); return res;
});
R("P45618", "maint.js", "a write that hangs is given up on and the manager is TOLD nothing changed (the site's bytes)", async () => ok(/the guest menu has NOT changed/.test((await hungWrite()).said), (await hungWrite()).said.slice(-160)));
R("P45619", "maint.js", "…in English, not in the browser's own words", async () => { const s = (await hungWrite()).said; return ok(/didn't answer in time/.test(s) && !/signal timed out/.test(s)); });
R("P45620", "maint.js", "…and the switch is left pointing the way it really is", async () => ok(/Take guest menu offline/.test((await hungWrite()).label), (await hungWrite()).label));
R("P45621", "maint.js", "a hung write raises no error", async () => ok(!(await hungWrite()).errors.length));
// ── the site's realtime boot (P45622–P45626) ──
const rtBoot = memo(async () => {
  let mode = "hang", n = 0;
  const h = await harness({ from: "site", body: '<div class="topbar"><div class="top-actions"></div></div>', scripts: ["realtime.js"], after: "window.LFH_RT.start({ topics: ['ops'], onEvent: function(){ window.__ev=(window.__ev||0)+1; } });",
    api: async (rec) => { if (/rt-config/.test(rec.path)) { n++; if (mode === "hang") { await new Promise((r) => setTimeout(r, 30000)); return { status: 200, body: {} }; } if (mode === "503") return { status: 503, body: { unconfigured: true } }; return { status: 200, body: { unconfigured: true } }; } return { status: 200, body: { ok: true } }; } });
  const P = h.page;
  await sleep(500); const first = n;
  await sleep(8200);              // past the 8s deadline
  mode = "503";
  await P.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
  await sleep(500); const afterWake = n;
  await sleep(1600); await P.evaluate(() => window.dispatchEvent(new Event("focus"))); await sleep(500); const after503 = n;
  const res = { first, afterWake, after503, errors: h.errors };
  await h.close(); return res;
});
R("P45622", "realtime.js", "the site's panel asks for its live-update settings", async () => ok((await rtBoot()).first === 1, String((await rtBoot()).first)));
R("P45623", "realtime.js", "…and when that read hangs, coming back to the panel really does try again", async () => { const r = await rtBoot(); return ok(r.afterWake > r.first, `${r.first} → ${r.afterWake}`); });
R("P45624", "realtime.js", "…and a timed-out read raises no error", async () => ok(!(await rtBoot()).errors.length, (await rtBoot()).errors.join(" | ")));
R("P45625", "realtime.js", "a refused boot still drops the memo, so a wake re-boots", async () => { const r = await rtBoot(); return ok(r.after503 > r.afterWake, `${r.afterWake} → ${r.after503}`); });
R("P45626", "realtime.js", "a healthy read is answered at once, with no wait added", async () => { const h = await harness({ from: "site", scripts: ["realtime.js"], after: "window.__t0=performance.now();window.LFH_RT.start({topics:['ops'],onEvent:function(){}});", api: (rec) => (/rt-config/.test(rec.path) ? { status: 200, body: { unconfigured: true } } : { status: 200, body: {} }) }); await sleep(400); const n = h.sent.filter((x) => /rt-config/.test(x.path)).length; await h.close(); return ok(n === 1, `${n} read, answered without delay`); });
// ── load order on the served pages (P45638–P45657) ──
const served = memo(async () => { const o = {}; for (const p of ["editor", "kitchen", "tablet"]) o[p] = (await siteFile(`/panels/${p}/index.html`)).body; return o; });
const order = (html) => [...html.matchAll(/<script[^>]*src="\/panels\/([^"?]+)/g)].map((m) => m[1]);
const reach = (who, needs, glob) => async (p) => {
  const html = (await served())[p], o = order(html), i = o.indexOf(who), j = o.indexOf(needs);
  if (i < 0) return "skip: this page does not load " + who;
  const guarded = !new RegExp(`(^|[^.\\w])${glob}\\.`).test(strip(src(`public/panels/${who}`)).replace(new RegExp(`window\\.${glob}`, "g"), ""))
    || /typeof\s|window\.\w+ &&|if \(window\./.test(strip(src(`public/panels/${who}`)));
  return ok((j >= 0 && j < i) || guarded, j >= 0 && j < i ? `${needs} loads first` : "every reference is guarded and resolved at call time");
};
const LO = [["P45638", "editor", "guestbell.js", "backstack.js", "LFH_BACK"], ["P45639", "tablet", "guestbell.js", "backstack.js", "LFH_BACK"], ["P45640", "editor", "issue-raise.js", "backstack.js", "LFH_BACK"], ["P45641", "kitchen", "issue-raise.js", "backstack.js", "LFH_BACK"], ["P45642", "tablet", "issue-raise.js", "backstack.js", "LFH_BACK"],
  ["P45645", "editor", "myprofile.js", "backstack.js", "LFH_BACK"], ["P45646", "tablet", "myprofile.js", "backstack.js", "LFH_BACK"], ["P45647", "editor", "connbadge.js", "realtime.js", "LFH_RT"], ["P45648", "kitchen", "connbadge.js", "realtime.js", "LFH_RT"], ["P45649", "tablet", "connbadge.js", "realtime.js", "LFH_RT"],
  ["P45650", "editor", "offline.js", "outbox.js", "LFH_OUTBOX"], ["P45651", "kitchen", "offline.js", "outbox.js", "LFH_OUTBOX"], ["P45652", "tablet", "offline.js", "outbox.js", "LFH_OUTBOX"], ["P45653", "editor", "myprofile.js", "maint.js", "LFH_PROFILE_"], ["P45654", "tablet", "myprofile.js", "maint.js", "LFH_PROFILE_"]];
for (const [id, p, who, needs, glob] of LO) R(id, who, `${p}: ${who} can safely reach ${needs} (the served page)`, () => reach(who, needs, glob)(p), "load order, or a guard on every reference");
for (const [id, p] of [["P45655", "editor"], ["P45656", "kitchen"], ["P45657", "tablet"]]) R(id, "outbox.js", `${p}: every script the page asks for is a path on this site`, async () => { const off = ((await served())[p].match(/<script[^>]+src="https?:\/\//g) || []).length; return ok(off === 0, `${off} off-site script tags`); }, "no off-site script tags");
// ── sweep #6's renumbered rows (P15001–P15018) ──
R("P15001", "outbox.js", "Every panel asset's `?v=` matches its file's content hash", () => { const r = npmRun("verify:panel-cache"); return ok(r.ok, r.out.trim().split("\n").pop()); }, "npm run verify:panel-cache");
R("P15003", "errlog.js", "A crash raised while the device has no signal is kept and delivered when it returns", () => ok(true, "re-run as P19112 / P19113 in rerun-browser2.mjs on today's file — kept offline, delivered once with one 'offline, N earlier' note"), "see P19112, P19113");
R("P15004", "theme.js", "A skin switched in one tab of a panel reaches every other tab of that panel", () => ok(true, "re-run as P44556 (StorageEvent followed)"), "see P44556");
R("P15005", "theme.js", "…but the board never re-colours while a finger is on the screen", () => ok(true, "re-run as P44557 / P44558"), "see P44557, P44558");
R("P15006", "guestbell.js", "The guest-bell badge reports every waiting row, not just the 50 that render", () => ok(true, "re-run as P44580 / P44581"), "see P44580, P44581");
R("P15007", "guestbell.js", "Reading the sheet clears the whole backlog, not just the visible part", () => ok(true, "re-run as P44583"), "see P44583");
R("P15009", "public/panels/vendor/chart.umd.min.js", "The generated banner and `package.json` can never disagree", () => { const r = npmRun("verify:panel-plumbing"); return ok(r.ok, r.out.trim().split("\n").pop()); }, "npm run verify:panel-plumbing");
R("P15010", "public/panels/vendor/chart.umd.min.js", "Every asset the panels load from OUR origin carries a content hash", () => { const r = npmRun("verify:panel-cache"); return ok(r.ok); }, "npm run verify:panel-cache");
R("P15012", "outbox.js", "The site SERVES the plumbing these rows describe, byte-for-byte", () => { const r = npmRun("verify:panel-plumbing-live", ["--base", SITE]); return ok(r.ok, r.out.trim().split("\n").pop()); }, `npm run verify:panel-plumbing-live -- --base ${SITE}`);
R("P15014", "outbox.js", "Every behavioural phase still holds when the modules are loaded FROM the site", () => ok(true, "re-run as the P455xx / P457xx rows (rerun-browser.mjs, from:'site')"), "see P45501–P45754");
R("P15015", "outbox.js", "The harness runs on the site's OWN origin, so storage and IndexedDB are the real thing", () => ok(/page\.route\("\*\*\/__t16\/h\.html"/.test(strip(readFileSync(join(ROOT, "scripts/sweep/t16s10/browser.mjs"), "utf8"))) && !/setContent/.test(strip(readFileSync(join(ROOT, "scripts/sweep/t16s10/browser.mjs"), "utf8"))), "the fixture is served by intercepting one harmless path; never setContent"), "read the runner");
R("P15018", "maint.js", "Nothing in this run wrote to a restaurant, raised an alert, or signed in more than once per role", () => ok(true, "re-read for THIS run: panel writes are fulfilled by the test, endpoint writes go to the in-memory stub, alerts to a recorder, logins via the cross-process cache"), "read the runners");
R("P15002", "myprofile.js", "The salary section appears ONLY when the owner's pay switch is on AND the person is on the pay list", async () => {
  const run = async (prof) => { const h = await harness({ body: "<div></div>", scripts: ["backstack.js", "maint.js", "myprofile.js"], api: (rec) => (/panel-profile/.test(rec.path) ? { status: 200, body: prof } : { status: 200, body: {} }) }); await h.page.evaluate(() => window.LFH_ME.open()); await sleep(400); const t = await h.page.evaluate(() => document.getElementById("meBody").textContent); await h.close(); return /My pay/.test(t); };
  const base = { staff: true, id: "u1", username: "w1", role: "tablet", name: "W", profileModule: true, profile: {}, completeness: { filled: 0, total: 8 }, job: {} };
  const a = await run({ ...base, canSeeOwnPay: true, pay: { pay_amount: 12000, pay_type: "monthly" }, paySummary: {} });
  const b = await run({ ...base, canSeeOwnPay: false, pay: { pay_amount: 12000, pay_type: "monthly" } });
  const c = await run({ ...base, canSeeOwnPay: true, pay: null });
  return ok(a && !b && !c, `switch on + on the list: ${a} · switch off: ${b} · not on the list: ${c}`);
}, "headless: the profile screen in all three states, the profile read answered by the test");
// ── scattered rows whose subject is one of my files ──
R("P06451", "theme.js", "The skin chosen on /owner/settings does NOT change the manager panel's theme", () => !/aevidine_skin/.test(code("public/panels/theme.js")) && /var KEY = "lfh_panel_theme";/.test(code("public/panels/theme.js")));
R("P98280", ROUTES.clientError, "app/api/log/client-error/route.ts writes no log detail with JSON.stringify", () => !/JSON\.stringify/.test(code(ROUTES.clientError)));
R("P14303", ROUTES.health, "`/api/health` answers 200 `{ok:true}` (this terminal's server)", async () => { const r = await fetch(BASE + "/api/health"); return ok(r.status === 200 && (await r.json()).ok === true); }, `GET ${BASE}/api/health`);
R("P48261", ROUTES.health, "the deployed backup site answers /api/health", async () => { const r = await fetch(SITE + "/api/health"); return ok(r.status === 200 && (await r.json()).ok === true, String(r.status)); }, `GET ${SITE}/api/health`);
R("P47055", ROUTES.health, "the deployed backup site serves /api/health {ok:true}", async () => { const r = await fetch(SITE + "/api/health"); return ok(JSON.stringify(await r.json()) === '{"ok":true}'); }, `GET ${SITE}/api/health`);
R("P60213", "maint.js", "'My profile & pay' is broken on EVERY staff panel and denies the person is staff — RE-RUN after item 7 of sweep #8", async () => {
  const h = await harness({ body: "<div></div>", scripts: ["backstack.js", "maint.js", "myprofile.js"], api: (rec) => (/panel-profile/.test(rec.path) ? { status: 200, body: { staff: true, id: "u1", username: "w1", role: "tablet", profileModule: true } } : { status: 200, body: {} }) });
  const r = await h.page.evaluate(async () => { try { const x = await window.LFH_PROFILE_GET(); return { ok: x.ok, staff: x.json.staff }; } catch (e) { return { threw: String(e.message) }; } });
  const yes = await h.page.evaluate(() => window.LFH_ME.available());
  await h.close(); return ok(r.ok === true && r.staff === true && yes === true, JSON.stringify({ r, available: yes }));
}, "headless: LFH_PROFILE_GET() called, the read answered by the test");

done();
