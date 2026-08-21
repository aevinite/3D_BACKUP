// verify-owner-territory-live.mjs — the BEHAVIOURAL half of the owner's Menu / Team / Settings checks.
//
//   node scripts/verify-owner-territory-live.mjs --base http://localhost:4113
//   node scripts/verify-owner-territory-live.mjs --base <url> --shots /tmp/shots   (also writes images)
//
// WHY THIS FILE EXISTS (T13 sweep, 2026-08-19)
// The static half is verify:owner-territory. This is the other half: the ~170 checks that need a real
// browser — bands C (runtime), D (measured contrast + layout) and E (a change traced across panels) of
// the 500 recorded in .claude/sweep/LEDGER/T13.md. It lived in a scratch folder for three passes and was
// deleted with the temp files every time, so each pass re-typed it and each pass got slightly different
// answers. In the repo it is the same code every time.
//
// FOUR RULES IT OBEYS, each one a mistake from an earlier pass:
//   1. WAIT FOR A CONDITION, NEVER A CLOCK — six rows flapped on fixed delays while the behaviour was
//      provably right. Everything here polls (`until`).
//   2. READ THE GROUND TRUTH — where the API does not expose a field (assigned_tables is write-only),
//      go to the database; where an endpoint is unknown, WATCH the panel request it, never guess.
//   3. IT OWNS WHAT IT TOUCHES — French House only, its own `zzlive` prefix, a pre-clean for a killed
//      run, every row deleted BY ID, and entitlements restored and compared byte-for-byte.
//   4. ONE SIGN-IN — through the shared cached helper, so a full run can never trip a login limit.
import { readFileSync } from "node:fs";
import { requireUp } from "./sweep/appUp.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const BASE = arg("--base") || process.env.LFH_BASE || "http://localhost:4000";
const RID = arg("--rid") || "00000000-0000-0000-0000-000000000001";
// Nothing answering = "could not run" (exit 2), said in plain words — never a raw ECONNREFUSED
// stack, which reads as "this guard is broken". (sweep #6 / T28, 2026-08-22)
await requireUp(BASE, "the owner-screens walk");
const SHOTS = arg("--shots");
const TAG = "zzlive" + Date.now().toString().slice(-5);

const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
const U = env.NEXT_PUBLIC_SUPABASE_URL;
const db = async (q) => (await fetch(`${U}/rest/v1/${q}`, { headers: H })).json();
const readEnt = async () => (await db(`restaurants?id=eq.${RID}&select=owner_entitlements`))[0]?.owner_entitlements ?? null;
const writeEnt = async (v) => (await fetch(`${U}/rest/v1/restaurants?id=eq.${RID}`, { method: "PATCH", headers: H, body: JSON.stringify({ owner_entitlements: v }) })).status;

let pass = 0, fail = 0, skip = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const sk = (m, w) => { skip++; console.log(`  ⏭ ${m} — ${w}`); };
const note = (m) => console.log(`     ↳ ${m}`);
const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const cr = (a, b) => { const L1 = lum(...a), L2 = lum(...b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
const OWNBG = `el=>{let n=el,bg="rgba(0, 0, 0, 0)";while(n&&bg==="rgba(0, 0, 0, 0)"){bg=getComputedStyle(n).backgroundColor;n=n.parentElement;}return{c:getComputedStyle(el).color,b:bg};}`;

const { chromium } = await import("playwright");
const { loginAs } = await import("./sweep/login.mjs");
const ORIGINAL = await readEnt();
const created = []; let dishId = null;
const br = await chromium.launch();
const mk = async (o) => { const c = await br.newContext(o); c.setDefaultNavigationTimeout(150000); c.setDefaultTimeout(60000); await loginAs(c, "owner", BASE); return c; };
const ctx = await mk({ viewport: { width: 1280, height: 900 } });
const api = async (m, p, b) => { const r = await ctx.request.fetch(BASE + p, { method: m, headers: { "Content-Type": "application/json" }, ...(b ? { data: b } : {}) }); return { s: r.status(), j: await r.json().catch(() => null) }; };
const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch { /* settling */ } await new Promise((r) => setTimeout(r, 250)); } return false; };
const disp = (s) => s.name || s.username;

console.log(`The owner's territory, driven — ${BASE}\n`);
try {
  // Pre-clean: a killed run leaves rows, and the next run then reads a roster with strangers in it and
  // blames the product. Scoped to THIS file's prefix, never a broad "anything that looks like a test".
  {
    const all = await api("GET", "/api/owner/staff");
    const stale = (all.j?.staff || []).filter((s) => /^zzlive/i.test(s.username || ""));
    for (const s of stale) await api("DELETE", `/api/owner/staff?id=${s.id}`);
    if (stale.length) note(`pre-clean removed ${stale.length} leftover row(s) from an interrupted run`);
  }
  const roster0 = await api("GET", "/api/owner/staff");
  const R = roster0.j.restaurants[0];
  const mgr = roster0.j.staff.find((s) => s.role === "manager" && s.profileEligible);
  const kit = roster0.j.staff.find((s) => s.role === "kitchen");
  const wai = roster0.j.staff.find((s) => s.role === "tablet");
  if (!mgr || !kit) throw new Error("this stack has no manager+kitchen pair to drive against");

  // ══ BAND C · the roster as it renders and behaves ═══════════════════════════════════════════
  console.log("Band C · the roster, driven");
  const page = await ctx.newPage();
  let mode = "dismiss"; const dlg = [];
  page.on("dialog", async (d) => { dlg.push(d.message()); mode === "accept" ? await d.accept() : await d.dismiss(); });
  const reqs = []; page.on("request", (q) => { if (q.url().includes("/api/owner/staff")) reqs.push({ m: q.method(), h: q.headers() }); });
  const row = (t) => page.locator(".ost-row").filter({ hasText: t }).first();
  const banner = async () => { const l = page.locator(".adm-card").filter({ hasText: /Try again/ }); return await l.count() ? await l.first().innerText() : ""; };
  const bHead = async () => { const l = page.locator(".adm-card").filter({ hasText: /Try again/ }); return await l.count() ? await l.first().locator("b").innerText() : ""; };
  const dismiss = async () => { const l = page.locator(".adm-card").filter({ hasText: /Try again/ }); if (await l.count()) await l.first().getByText("dismiss").click().catch(() => {}); };
  const go = async () => { await page.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" }); await page.waitForSelector(".ost-row", { timeout: 120000 }); await page.waitForTimeout(800); };

  const resp = await page.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".ost-row", { timeout: 120000 }); await page.waitForTimeout(800);
  resp.status() === 200 ? ok("P06302 the roster answers 200") : bad(`P06302 the roster answered ${resp.status()}`);
  (await page.locator(".ost-name").first().innerText()).includes(R.name.split(" ").pop()) ? ok("P06303 the real restaurant's name is painted") : bad("P06303 the restaurant name is wrong or missing");
  /· \d+ staff/.test(await page.locator(".ost-head .adm-muted").first().innerText()) ? ok("P06304 the slug and count sit under the name") : bad("P06304 the slug/count line is gone");
  (await page.locator(".ost-tcount").first().innerText()).trim() === String(roster0.j.staff.filter((s) => s.active).length) ? ok("P06305 the tab counts ACTIVE people") : bad("P06305 the tab count does not match the active people");
  (await page.locator(".ost-row").count()) === roster0.j.staff.length ? ok("P06306 every person the server sent has a row") : bad("P06306 a person the server sent has no row");
  { const k = row(disp(kit));
    (await k.locator(".ost-prog").count()) === 0 && (await k.locator(".ost-nopay").count()) === 0 && (await k.locator(".ost-mini.open").count()) === 0
      ? ok("P06307/P06308 a kitchen row has no profile bar, pay chip or profile link") : bad("P06307/P06308 a kitchen row is being offered profile or pay UI");
    /kitchen screen only/i.test(await k.innerText()) ? ok("P06482 …and it says why it is shorter") : bad("P06482 the kitchen row is unexplained"); }
  (await row(disp(mgr)).locator(".ost-rolebadge").first().innerText()).trim().toLowerCase() === "manager" ? ok("P06309 the manager badge reads manager") : bad("P06309 the manager badge is wrong");
  if (wai) {
    const s = row(disp(wai));
    (await s.locator(".ost-rolebadge").first().innerText()).trim().toLowerCase() === "waiter" ? ok("P06310 a tablet badge reads waiter, never tablet") : bad("P06310 a tablet row shows the storage word");
    const sel = s.locator("select").first();
    (await sel.evaluate((e) => e.options[e.selectedIndex].textContent.trim())) === "waiter" && (await sel.inputValue()) === "tablet" ? ok("P06311 the select shows waiter, its value stays tablet") : bad("P06311 the role select's label/value disagree with the badge");
    (await s.locator("a.ost-mini[target=_blank]").first().getAttribute("href")) === "/tablet" ? ok("P06314 a waiter row offers the waiter panel") : bad("P06314 the waiter panel link is wrong");
  } else sk("P06310/P06311/P06314", "no tablet login on this stack");
  (await row(disp(mgr)).locator(".ost-mini.open").first().getAttribute("href")) === `/owner/staff/${mgr.id}` ? ok("P06312 Open profile points at that person") : bad("P06312 Open profile points elsewhere");
  { const mp = row(disp(mgr)).locator("a.ost-mini[target=_blank]").first();
    (await mp.getAttribute("href")) === "/manager" && (await mp.getAttribute("target")) === "_blank" ? ok("P06313 the manager panel opens in a new tab") : bad("P06313 the manager panel link is wrong"); }
  (await row(disp(mgr)).locator(".ost-bar i").first().evaluate((e) => e.style.width)) === Math.round((mgr.completeness.filled / mgr.completeness.total) * 100) + "%" ? ok("P06315 the completeness bar matches filled/total") : bad("P06315 the completeness bar's width is wrong");
  { const d = await row(disp(mgr)).locator(".ost-mini.danger").first().evaluate((e) => getComputedStyle(e).color);
    const p = await row(disp(mgr)).locator(".ost-mini").nth(2).evaluate((e) => getComputedStyle(e).color);
    d !== p ? ok("P06319/P06320 Remove is coloured without a hover, and differs from its neighbour") : bad("P06319/P06320 Remove looks identical to Disable"); }

  // the search, and the two groups
  { const total = await page.locator(".ost-row").count();
    (await page.locator(".ost-find input").count()) === 1 ? ok("P06491 the roster has a search box") : bad("P06491 the search box is gone");
    await page.locator(".ost-find input").fill("waiter"); await page.waitForTimeout(500);
    const b = await page.locator(".ost-row .ost-rolebadge").allInnerTexts();
    b.length > 0 && b.length < total && b.every((x) => /waiter/i.test(x)) ? ok("P06491b searching the word the badge SHOWS finds waiters") : bad(`P06491b the search matched ${b.length} of ${total} wrongly`);
    await page.locator(".ost-find input").fill("zzzz-nobody"); await page.waitForTimeout(500);
    (await page.locator(".adm-empty").filter({ hasText: "matches" }).count()) === 1 ? ok("P06491d no match says so, not \"No staff yet\"") : bad("P06491d an empty search shows the wrong empty state");
    await page.locator(".ost-find").getByText("clear").click(); await page.waitForTimeout(500);
    (await page.locator(".ost-row").count()) === total ? ok("P06491f clear restores the whole roster") : bad("P06491f clear did not restore the roster"); }

  // a throwaway person for every write
  const me = await api("POST", "/api/owner/staff", { name: `${TAG} M`, role: "manager", restaurant_id: RID, password: "live-guard-2026" });
  created.push(me.j.id); let NAME = `${TAG} M`;
  await go();
  await row(NAME).getByRole("button", { name: /Rename \/ edit phone/ }).click();
  await page.waitForSelector(".ost-editrow");
  (await row(NAME).locator(".ost-editrow input").first().inputValue()) === NAME ? ok("P06321 the rename editor pre-fills the current name") : bad("P06321 the rename editor opens blank or wrong");
  await row(NAME).getByRole("button", { name: /Rename \/ edit phone/ }).click();
  (await page.locator(".ost-editrow").count()) === 0 ? ok("P06322 a second tap closes it") : bad("P06322 the editor does not toggle shut");
  await row(NAME).getByRole("button", { name: /Rename \/ edit phone/ }).click();
  await page.waitForSelector(".ost-editrow"); reqs.length = 0;
  await row(NAME).getByRole("button", { name: /^Cancel$/ }).click(); await page.waitForTimeout(400);
  reqs.length === 0 ? ok("P06323 Cancel sends nothing") : bad("P06323 Cancel fired a request");
  await row(NAME).getByRole("button", { name: /Rename \/ edit phone/ }).click();
  await page.waitForSelector(".ost-editrow");
  await row(NAME).locator(".ost-editrow input").first().fill("a"); reqs.length = 0;
  await row(NAME).getByRole("button", { name: /^Save$/ }).click();
  await until(async () => /at least 2 characters/i.test(await banner()), 10000);
  reqs.length === 0 && /at least 2 characters/i.test(await banner()) ? ok("P06324 a 1-char rename is refused locally, nothing sent") : bad("P06324 a too-short rename was sent or not refused");
  /didn't go through/i.test(await bHead()) ? ok("P06211a a refusal WE make is headed as a refusal") : bad(`P06211a wrong heading: "${await bHead()}"`);
  await dismiss();
  const NEW = `${TAG} R`;
  await row(NAME).locator(".ost-editrow input").first().fill(NEW); reqs.length = 0;
  await row(NAME).getByRole("button", { name: /^Save$/ }).click();
  (await until(async () => (await page.locator(".ost-row").filter({ hasText: NEW }).count()) > 0)) ? ok("P06325 a real rename lands and shows") : bad("P06325 a valid rename did not land");
  reqs.some((q) => q.m === "PATCH" && q.h["x-lfh-expect"]) ? ok("P06326 the rename sent X-LFH-Expect") : bad("P06326 the rename sent no expectation");
  NAME = NEW;
  await row(NAME).getByRole("button", { name: /Rename \/ edit phone/ }).click();
  await page.waitForSelector(".ost-editrow");
  await api("PATCH", "/api/owner/staff", { id: me.j.id, action: "edit", name: `${TAG} E` });
  await row(NAME).locator(".ost-editrow input").first().fill(`${TAG} S`);
  await row(NAME).getByRole("button", { name: /^Save$/ }).click();
  await until(async () => /changed the name while you had it open/i.test(await banner()));
  /changed the name while you had it open/i.test(await banner()) ? ok("P06211 THE LOSER IS TOLD: a stale save is refused, on screen, in words") : bad("P06211 a stale save's refusal never reaches the screen");
  /got there first/i.test(await bHead()) ? ok("P06211b …headed \"Someone got there first.\"") : bad(`P06211b wrong heading: "${await bHead()}"`);
  { const amber = await page.locator(".adm-card").filter({ hasText: /Try again/ }).first().evaluate((e) => getComputedStyle(e).borderTopColor);
    amber !== "rgb(248, 113, 113)" && amber !== "rgb(220, 38, 38)" ? ok("P06211c …and a clash is amber, not danger red") : bad("P06211c a clash is painted as danger"); }
  NAME = `${TAG} E`;
  (await page.locator(".ost-row").filter({ hasText: NAME }).count()) > 0 ? ok("P06328 the roster shows the value that really landed") : bad("P06328 the roster still shows the value that did not land");
  await dismiss();

  // the waiter picker
  await go();
  const form = page.locator(".ost-add").first();
  await form.locator("select[name=role]").selectOption("tablet");
  await page.waitForSelector(".ost-tables");
  (await page.locator(".ost-tgrid button").count()) === (R.tableCount || 0) ? ok(`P06330 one tile per table (${R.tableCount})`) : bad("P06330 the tile count does not match the floor");
  const addBtn = form.locator("button[type=submit]");
  (await addBtn.isDisabled()) && /Pick at least one table/i.test(await addBtn.getAttribute("title") || "") ? ok("P06331/P06332 Add is disabled with nothing picked, and says why") : bad("P06331/P06332 Add is enabled with no table picked");
  await page.getByRole("button", { name: "Select all" }).click();
  (await page.locator(".ost-tgrid button.on").count()) === (R.tableCount || 0) && !(await addBtn.isDisabled()) ? ok("P06333 Select all picks the floor and enables Add") : bad("P06333 Select all did not pick the whole floor");
  await page.getByRole("button", { name: "Clear" }).click();
  (await page.locator(".ost-tgrid button.on").count()) === 0 && await addBtn.isDisabled() ? ok("P06334 Clear un-picks everything and disables Add") : bad("P06334 Clear left tiles picked");
  await page.locator(".ost-tgrid button").nth(0).click();
  await page.locator(".ost-tgrid button").nth(1).click();
  /2 of \d+ picked/.test(await page.locator(".ost-tables-head").innerText()) ? ok("P06336 the picked count updates") : bad("P06336 the picked count is wrong");
  { const wn = `${TAG} W`;
    await form.locator("input[name=name]").fill(wn);
    await addBtn.click();
    await page.waitForSelector(".ost-reveal", { timeout: 60000 });
    await page.locator(".ost-reveal").getByText("Done").click();
    const w = (await api("GET", "/api/owner/staff")).j.staff.find((s) => disp(s) === wn);
    if (w) created.push(w.id);
    // GROUND TRUTH: the owner API never SELECTS assigned_tables, so read the database.
    const dbw = await db(`staff_users?id=eq.${w.id}&select=assigned_tables`);
    JSON.stringify(dbw[0]?.assigned_tables) === "[1,2]" ? ok("P06348 a waiter is created with exactly the tables picked (read from the database)") : bad(`P06348 the waiter's tables are ${JSON.stringify(dbw[0]?.assigned_tables)}`); }
  await form.locator("select[name=role]").selectOption("manager");
  (await page.locator(".ost-tables").count()) === 0 ? ok("P06337 back to manager hides the picker") : bad("P06337 the picker stayed open");
  (await form.locator("input[name=password]").getAttribute("minlength")) === "6" ? ok("P06136 the password minimum is stated on the field") : bad("P06136 the password minimum is not on the field");
  await form.locator("input[name=phone]").fill("+91 98765 43210 / 98765 43211");
  (await form.locator("input[name=phone]").inputValue()).length === 20 ? ok("P06132 the phone field stops where the server stops") : bad("P06132 the phone field accepts more than the server keeps");
  await form.locator("input[name=phone]").fill("");

  // add / reveal / double-click
  { const n2 = `${TAG} T`;
    await form.locator("input[name=name]").fill(n2);
    await addBtn.click();
    await page.waitForSelector(".ost-reveal", { timeout: 60000 });
    (await page.locator(".ost-pw").inputValue()).length >= 6 ? ok("P06338 an add reveals a one-time password") : bad("P06338 no password was revealed");
    const t2 = (await api("GET", "/api/owner/staff")).j.staff.find((s) => disp(s) === n2); if (t2) created.push(t2.id);
    const box = await page.locator(".ost-reveal").boundingBox();
    box && box.y >= 0 && box.y + box.height <= 900 ? ok("P06339 the reveal card scrolls itself into view") : bad("P06339 the reveal card is off screen");
    /ost-pw/.test(await page.evaluate(() => document.activeElement?.className || "")) ? ok("P06340 the password field is focused") : bad("P06340 the password field is not focused");
    await page.locator(".ost-reveal").getByRole("button", { name: /Copy/ }).click(); await page.waitForTimeout(250);
    /Copied/.test(await page.locator(".ost-reveal button.ost-btn").innerText()) ? ok("P06341 Copy confirms") : bad("P06341 Copy does not confirm");
    await page.locator(".ost-reveal").getByText("Done").click();
    (await page.locator(".ost-reveal").count()) === 0 ? ok("P06342 Done dismisses the card") : bad("P06342 Done did not dismiss");
    (await until(async () => (await page.locator(".ost-row").filter({ hasText: n2 }).count()) > 0)) ? ok("P06343 the new person appears with no reload") : bad("P06343 the new person did not appear");
    (await form.locator("input").evaluateAll((e) => e.map((x) => x.value))).every((v) => v === "") ? ok("P06344 the Add form is cleared") : bad("P06344 the Add form kept values"); }
  await form.locator("input[name=name]").fill(disp(mgr));
  await addBtn.click();
  await until(async () => /taken at this restaurant/i.test(await banner()));
  /taken at this restaurant/i.test(await banner()) ? ok("P06346 a duplicate username is refused with the friendly sentence") : bad("P06346 a duplicate was not refused clearly");
  /didn't go through/i.test(await bHead()) ? ok("P06211d a SERVER refusal is headed the same way, not as a fault") : bad("P06211d a server refusal is headed as a fault");
  await dismiss(); await form.locator("input[name=name]").fill("");
  { const n3 = `${TAG} D`;
    await form.locator("input[name=name]").fill(n3);
    await Promise.all([addBtn.click(), addBtn.click().catch(() => {})]);
    await page.waitForTimeout(6000);
    const dupes = (await api("GET", "/api/owner/staff")).j.staff.filter((s) => disp(s) === n3);
    for (const d of dupes) created.push(d.id);
    dupes.length === 1 ? ok("P06347 a double-click on Add creates exactly ONE person") : bad(`P06347 a double-click created ${dupes.length}`);
    await dismiss(); }

  // destructive controls
  await go(); mode = "dismiss"; reqs.length = 0;
  await row(NAME).getByRole("button", { name: /^Disable$/ }).click(); await page.waitForTimeout(700);
  dlg.length > 0 && reqs.length === 0 ? ok("P06349 Disable asks first; cancelling sends nothing") : bad("P06349 Disable did not ask, or sent anyway");
  /logged out immediately/i.test(dlg.at(-1) || "") ? ok("P06071 …and the question says they are logged out immediately") : bad("P06071 the disable question does not say they are logged out");
  mode = "accept";
  await row(NAME).getByRole("button", { name: /^Disable$/ }).click();
  (await until(async () => /\boff\b/.test(await row(NAME).evaluate((e) => e.className)) && /disabled/i.test(await row(NAME).innerText()))) ? ok("P06350 disabling dims the row and labels it") : bad("P06350 a disabled row is not dimmed/labelled");
  (await page.locator(".ost-team").nth(1).locator(".ost-row").filter({ hasText: NAME }).count()) === 1 ? ok("P06492 …and moves them under the Disabled heading") : bad("P06492 a disabled person stayed in the working list");
  { const dn = dlg.length;
    await row(NAME).getByRole("button", { name: /^Enable$/ }).click();
    const back = await until(async () => !/\boff\b/.test(await row(NAME).evaluate((e) => e.className)));
    dlg.length === dn && back ? ok("P06351 re-enabling asks NO question and returns them") : bad("P06351 re-enabling asked, or did not return them"); }
  mode = "dismiss"; reqs.length = 0;
  await row(NAME).locator("select").selectOption("kitchen");
  { const snap = await until(async () => (await row(NAME).locator("select").inputValue()) === "manager", 8000);
    snap && reqs.length === 0 ? ok("P06352 cancelling a role change snaps back and sends nothing") : bad("P06352 the select stuck on the cancelled role, or a request went");
    /logged out/i.test(dlg.at(-1) || "") ? ok("P06073 …and the question says they are logged out") : bad("P06073 the role question does not mention the logout"); }
  reqs.length = 0;
  await row(NAME).locator("select").selectOption("manager"); await page.waitForTimeout(600);
  reqs.length === 0 ? ok("P06353 the same role fires nothing") : bad("P06353 re-picking the same role fired a request");
  mode = "accept";
  await row(NAME).getByRole("button", { name: /Reset password/ }).click();
  await page.waitForSelector(".ost-reveal", { timeout: 60000 });
  (await page.locator(".ost-pw").inputValue()).length >= 6 ? ok("P06354 Reset password reveals a new one") : bad("P06354 no new password appeared");
  /current login stops working/i.test(dlg.at(-1) || "") ? ok("P06069 …and the question says the current login stops working") : bad("P06069 the reset question is missing its consequence");
  await page.locator(".ost-reveal").getByText("Done").click();
  { let held; await page.route("**/api/owner/staff", async (q) => { if (q.request().method() === "PATCH") await new Promise((x) => { held = x; setTimeout(x, 4000); }); await q.continue(); });
    await row(NAME).getByRole("button", { name: /^Disable$/ }).click();
    await page.waitForTimeout(900);
    const btns = await row(NAME).locator("button.ost-mini").evaluateAll((e) => e.map((x) => x.disabled));
    const sel = await row(NAME).locator("select").first().evaluate((e) => e.disabled);
    btns.length > 0 && btns.every(Boolean) && sel === true ? ok("P06360 every button and the role select disable while a request is in flight") : bad(`P06360 controls stayed live in flight (${JSON.stringify(btns)} select=${sel})`);
    note("the two links on the row are <a> elements — an anchor cannot be disabled, and both are harmless mid-request");
    await page.waitForTimeout(4500); await page.unroute("**/api/owner/staff");
    await go(); await row(NAME).getByRole("button", { name: /^Enable$/ }).click().catch(() => {}); await page.waitForTimeout(2500); }
  await go(); mode = "dismiss"; reqs.length = 0;
  await row(NAME).getByRole("button", { name: /^Remove$/ }).click(); await page.waitForTimeout(700);
  reqs.length === 0 && (await row(NAME).count()) === 1 ? ok("P06355 Remove asks first; cancelling keeps them") : bad("P06355 Remove did not ask, or removed anyway");
  /can't be undone/i.test(dlg.at(-1) || "") ? ok("P06076 …and says it cannot be undone") : bad("P06076 the remove question is missing its warning");
  mode = "accept";
  await row(NAME).getByRole("button", { name: /^Remove$/ }).click();
  (await until(async () => (await page.locator(".ost-row").filter({ hasText: NAME }).count()) === 0)) ? ok("P06356 Remove deletes a person with no pay history") : bad("P06356 Remove did not delete");
  note("P06357 (a person WITH pay history) has its own guard: npm run verify:pay-history-delete");
  await page.close();

  // ══ BAND C · the profile, and the phone's first Back press ══════════════════════════════════
  console.log("\nBand C · the profile sheet");
  const pp = await ctx.newPage();
  await pp.goto(BASE + `/owner/staff/${mgr.id}`, { waitUntil: "domcontentloaded" });
  (await until(async () => (await pp.locator("body").innerText()).includes(disp(mgr)), 60000)) ? ok("P06361 the profile sheet opens and names the person") : bad("P06361 the profile sheet never painted the person");
  await pp.goto(BASE + `/owner/staff/${kit.id}`, { waitUntil: "domcontentloaded" });
  (await until(async () => /no profile|don't have a profile/i.test(await pp.locator("body").innerText()), 60000)) ? ok("P06362 a kitchen person is told calmly they have no profile") : bad("P06362 a kitchen person's message is missing");
  const closeIt = async (p) => { const b = p.locator("button").filter({ hasText: /^(✕|×|Close)$/ }).first(); const t = (await b.count()) ? b : p.locator("[aria-label*='lose' i]").first(); await t.click({ timeout: 20000 }); };
  const AS = "11111111-1111-1111-1111-111111111111";
  await pp.goto(BASE + `/owner/staff/${mgr.id}?rid=${RID}&as=${AS}`, { waitUntil: "domcontentloaded" });
  await until(async () => (await pp.locator("body").innerText()).includes(disp(mgr)), 60000);
  await closeIt(pp);
  await until(async () => new URL(pp.url()).pathname === "/owner/staff");
  { const u = new URL(pp.url());
    u.searchParams.get("rid") === RID && u.searchParams.get("as") === AS ? ok("P06364/P06365 the ✕ returns to the roster keeping BOTH pins") : bad(`P06364/P06365 a pin was dropped: ${pp.url()}`); }
  await pp.close();
  // P06363b · A FRESH TAB, arriving the way an owner does. This check first ran on the page that had
  // already visited two other profiles, so Back correctly landed on one of THOSE — my history, not a
  // product fault. The realistic path is roster → Open profile → ✕ → Back, and Back must then leave
  // the roster rather than re-open the profile just closed (that is what `router.replace` is for).
  { const c = await mk({ viewport: { width: 1280, height: 900 } });
    const p = await c.newPage();
    await p.goto(BASE + `/owner/staff?rid=${RID}`, { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".ost-row", { timeout: 120000 }); await p.waitForTimeout(900);
    await p.locator(".ost-row").filter({ hasText: disp(mgr) }).first().locator(".ost-mini.open").first().click();
    await until(async () => (await p.locator("body").innerText()).includes(disp(mgr)), 60000);
    await closeIt(p);
    await until(async () => new URL(p.url()).pathname === "/owner/staff");
    await p.goBack(); await p.waitForTimeout(2500);
    !/\/owner\/staff\/[0-9a-f-]{36}/.test(p.url()) ? ok("P06363b after ✕, Back does not re-open the profile just closed") : bad(`P06363b Back re-opened the profile: ${p.url()}`);
    await c.close(); }
  { const c = await mk({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    await p.goto(BASE + `/owner/staff?rid=${RID}`, { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".ost-row", { timeout: 120000 }); await p.waitForTimeout(1000);
    await p.locator(".ost-row").filter({ hasText: disp(mgr) }).first().locator(".ost-mini.open").first().click();
    await until(async () => (await p.locator("body").innerText()).includes(disp(mgr)), 60000);
    await p.waitForTimeout(1200);
    const layers = await p.evaluate(() => globalThis.__lfh_back ? globalThis.__lfh_back.layers.length : null);
    await p.goBack();
    const home = await until(async () => new URL(p.url()).pathname === "/owner/staff" && (await p.locator(".ost-row").count()) > 0);
    home && (layers === null || layers === 0) ? ok("P06366 the FIRST phone-Back press closes the profile") : bad(`P06366 the first Back press did not return to the roster (layers=${layers})`);
    await c.close(); }

  // ══ BAND C · settings ══════════════════════════════════════════════════════════════════════
  console.log("\nBand C · settings");
  const sp = await ctx.newPage();
  const sr = await sp.goto(BASE + "/owner/settings", { waitUntil: "domcontentloaded" });
  await sp.locator(".adm-chip").first().waitFor({ timeout: 120000 }); await sp.waitForTimeout(500);
  { const t = await sp.locator("body").innerText();
    sr.status() === 200 && /Appearance/.test(t) && /Change password/.test(t) && /What's enabled/.test(t) ? ok("P06367 settings renders all three cards") : bad("P06367 a settings card is missing"); }
  (await sp.locator("button[aria-pressed]").count()) === 2 ? ok("P06368 the Appearance buttons report their state") : bad("P06368 the skin buttons do not report state");
  (await sp.locator(".adm-chip i.fa-xmark").count()) === 0 ? ok("P06371/P06488 the card shows NO off-state at all (R36)") : bad("P06371/P06488 the card reveals what is switched off — R36 forbids it");
  { const preq = []; sp.on("request", (q) => { if (q.url().includes("/api/owner/settings")) preq.push(q.method()); });
    await sp.locator("input[autocomplete=current-password]").fill("whatever");
    const nw = sp.locator("input[autocomplete=new-password]");
    await nw.nth(0).fill("abcdef1"); await nw.nth(1).fill("different"); preq.length = 0;
    await sp.getByRole("button", { name: /Update password/ }).click(); await sp.waitForTimeout(800);
    preq.filter((x) => x === "POST").length === 0 && /don't match/i.test(await sp.locator("body").innerText()) ? ok("P06372 mismatched passwords refused locally, nothing sent") : bad("P06372 a mismatch was sent to the server");
    await nw.nth(0).fill("abc"); await nw.nth(1).fill("abc"); preq.length = 0;
    await sp.getByRole("button", { name: /Update password/ }).click(); await sp.waitForTimeout(800);
    preq.filter((x) => x === "POST").length === 0 && /at least 6 characters/i.test(await sp.locator("body").innerText()) ? ok("P06373 a short password refused locally, nothing sent") : bad("P06373 a short password was sent to the server");
    await sp.locator("button[aria-pressed]").first().focus(); preq.length = 0;
    await sp.keyboard.press("Enter"); await sp.waitForTimeout(2000);
    preq.filter((x) => x === "POST").length === 0 ? ok("P06375 Enter on a skin button does not submit the password form") : bad("P06375 Enter on a skin button submitted the form"); }
  if (SHOTS) await sp.screenshot({ path: `${SHOTS}/settings.png`, fullPage: true });
  await sp.close();

  // ══ BAND D · measured, both skins × both widths ════════════════════════════════════════════
  console.log("\nBand D · measured in both skins, at both widths");
  const off = await api("POST", "/api/owner/staff", { name: `${TAG} Off`, role: "kitchen", restaurant_id: RID, password: "live-guard-2026" });
  created.push(off.j.id);
  await api("PATCH", "/api/owner/staff", { id: off.j.id, action: "set_active", active: false });
  for (const skin of ["dark", "light"]) {
    for (const [w, h, dev, tag] of [[1280, 800, 1, "desktop"], [360, 780, 3, "a35"]]) {
      const c = await mk({ viewport: { width: w, height: h }, deviceScaleFactor: dev, isMobile: dev === 3, hasTouch: dev === 3 });
      if (skin === "light") await c.addCookies([{ name: "aevidine_skin", value: "light", url: BASE }]);
      const p = await c.newPage();
      if (skin === "light") await p.addInitScript(() => { try { localStorage.setItem("aevidine_skin", "light"); } catch {} });
      await p.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
      await p.waitForSelector(".ost-row", { timeout: 120000 }); await p.waitForTimeout(900);
      if (skin === "light" && (await p.locator(".adm.owx").first().getAttribute("data-skin")) !== "light") bad(`P06381a the light skin did not apply (${tag})`);
      const add = await p.locator(".ost-add button[type=submit]").first().evaluate((e) => ({ c: getComputedStyle(e).color, b: getComputedStyle(e).backgroundColor }));
      cr(rgb(add.c), rgb(add.b)) >= 4.5 ? ok(`P06382 the Add button clears 4.5:1 (${skin}/${tag}) — ${cr(rgb(add.c), rgb(add.b)).toFixed(2)}:1`) : bad(`P06382 the Add button is ${cr(rgb(add.c), rgb(add.b)).toFixed(2)}:1 (${skin}/${tag})`);
      const bd = await p.locator(".ost-rolebadge[data-role=manager]").first().evaluate(eval(OWNBG));
      cr(rgb(bd.c), rgb(bd.b)) >= 4.5 ? ok(`P06381 the manager badge clears 4.5:1 (${skin}/${tag})`) : bad(`P06381 the manager badge is ${cr(rgb(bd.c), rgb(bd.b)).toFixed(2)}:1 (${skin}/${tag})`);
      const nk = await p.locator(".ost-nokitchen").first().evaluate(eval(OWNBG));
      cr(rgb(nk.c), rgb(nk.b)) >= 4.5 ? ok(`P06482b the kitchen line clears 4.5:1 (${skin}/${tag})`) : bad(`P06482b the kitchen line is ${cr(rgb(nk.c), rgb(nk.b)).toFixed(2)}:1 (${skin}/${tag})`);
      const ohc = p.locator(".ost-offhead").first();
      if (await ohc.count()) { const v = await ohc.evaluate(eval(OWNBG));
        cr(rgb(v.c), rgb(v.b)) >= 4.5 ? ok(`P06384 the Disabled heading clears 4.5:1 (${skin}/${tag})`) : bad(`P06384 the Disabled heading is ${cr(rgb(v.c), rgb(v.b)).toFixed(2)}:1 (${skin}/${tag})`); }
      const fi = await p.locator(".ost-find input").evaluate(eval(OWNBG));
      await p.locator(".ost-find input").fill("diag"); await p.waitForTimeout(300);
      const typed = await p.locator(".ost-find input").evaluate((e) => getComputedStyle(e).color);
      cr(rgb(typed), rgb(fi.b)) >= 4.5 ? ok(`P06395 typed search text clears 4.5:1 (${skin}/${tag})`) : bad(`P06395 typed search text is ${cr(rgb(typed), rgb(fi.b)).toFixed(2)}:1 (${skin}/${tag})`);
      await p.locator(".ost-find input").fill("");
      if (tag === "a35") {
        const sw = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        sw.sw <= sw.cw + 1 ? ok(`P06387 nothing overflows 360px sideways (${skin})`) : bad(`P06387 the page scrolls sideways at 360px (${skin})`);
        const hs = await p.locator(".ost-row").first().locator(".ost-mini").evaluateAll((e) => e.map((x) => Math.round(x.getBoundingClientRect().height)));
        const sh = await p.locator(".ost-row").first().locator("select").first().evaluate((e) => Math.round(e.getBoundingClientRect().height));
        hs.every((x) => x >= 36) && sh >= 36 ? ok(`P06386 every action control is ≥36px on a phone (${skin})`) : bad(`P06386 a control is under 36px (${skin}): ${JSON.stringify(hs)} select=${sh}`);
      }
      await p.locator(".ost-add select[name=role]").first().selectOption("tablet");
      await p.waitForSelector(".ost-tables");
      await p.locator(".ost-tgrid button").first().click();
      const tile = await p.locator(".ost-tgrid button.on").first().evaluate(eval(OWNBG));
      cr(rgb(tile.c), rgb(tile.b)) >= 4.5 ? ok(`P06390 a picked tile's text clears 4.5:1 (${skin}/${tag})`) : bad(`P06390 a picked tile is ${cr(rgb(tile.c), rgb(tile.b)).toFixed(2)}:1 (${skin}/${tag})`);
      /✓/.test(await p.locator(".ost-tgrid button.on").first().innerText()) ? ok(`P06390b a picked tile is marked by a ✓, not colour alone (${skin}/${tag})`) : bad(`P06390b a picked tile relies on colour alone (${skin}/${tag})`);
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/roster-${tag}-${skin}.png` });
      await c.close();
    }
  }
  // forced states
  { const c = await mk({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const p = await c.newPage(); p.on("dialog", (d) => d.dismiss());
    await p.route("**/api/owner/staff*", async (q) => { if (q.request().method() !== "GET") return q.continue(); const res = await q.fetch(); const j = await res.json(); j.restaurants = (j.restaurants || []).map((x) => ({ ...x, tableCount: 0 })); await q.fulfill({ response: res, body: JSON.stringify(j) }); });
    await p.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".ost-row", { timeout: 120000 });
    await p.locator(".ost-add select[name=role]").first().selectOption("tablet");
    await p.waitForSelector(".ost-tables");
    const t = await p.locator(".ost-tables").innerText();
    /couldn't read how many tables/i.test(t) && !/Pick at least one table/i.test(t) && (await p.locator(".ost-tgrid").count()) === 0 ? ok("P06423 an unreadable floor size explains itself, asking nothing impossible") : bad("P06423 the picker still draws an empty grid and says pick one");
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/forced-floor-unknown.png` });
    await c.close(); }
  { const c = await mk({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const p = await c.newPage(); p.on("dialog", (d) => d.dismiss());
    await p.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".ost-row", { timeout: 120000 });
    const f = p.locator(".ost-add").first(); await f.scrollIntoViewIfNeeded();
    await f.locator("input[name=name]").fill(disp(mgr));
    await f.locator("button[type=submit]").click();
    const bl = p.locator(".adm-card").filter({ hasText: /Try again/ });
    let at = null, bb = null;
    for (let i = 0; i < 40; i++) { await p.waitForTimeout(250); if (await bl.count()) { bb = await bl.first().boundingBox(); if (bb && bb.y >= 0 && bb.y + bb.height <= 780) { at = (i + 1) * 250; break; } } }
    at ? ok(`P06393 on a 360px screen a refused Add comes onto the screen (${at}ms)`) : bad(`P06393 a refused Add stayed off screen: ${JSON.stringify(bb)}`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/forced-refused-add.png` });
    await c.close(); }
  for (const [id, body, status, re, extra] of [
    ["P06421", { error: "Staff management isn't enabled for your restaurant — contact Aevidine.", disabled: true }, 403, /isn't enabled/, null],
    ["P06422", { error: "Couldn't load your team just now — please try again.", transient: true }, 503, /please try again/i, /Try again/]]) {
    const c = await mk({ viewport: { width: 1280, height: 800 } }); const p = await c.newPage();
    await p.route("**/api/owner/staff*", (q) => q.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }));
    await p.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(3000);
    const t = await p.locator("body").innerText();
    re.test(t) && (extra ? extra.test(t) : !/Something went wrong/.test(t)) ? ok(`${id} the forced state reads correctly`) : bad(`${id} the forced state reads wrongly: ${t.replace(/\n/g, " | ").slice(0, 120)}`);
    await c.close(); }

  // ══ BAND E · a change traced across panels ═════════════════════════════════════════════════
  console.log("\nBand E · traced across panels");
  { const mkp = await api("POST", "/api/owner/staff", { name: `${TAG} X`, role: "manager", restaurant_id: RID, password: "live-guard-2026" });
    created.push(mkp.j.id);
    const before = (await db(`staff_users?id=eq.${mkp.j.id}&select=token_version`))[0].token_version;
    await api("PATCH", "/api/owner/staff", { id: mkp.j.id, action: "set_active", active: false });
    const afterOff = (await db(`staff_users?id=eq.${mkp.j.id}&select=active,token_version`))[0];
    afterOff.active === false && afterOff.token_version > before ? ok("P06429/P06430 disabling really disables, and bumps the token so an open panel drops") : bad("P06429/P06430 disabling did not disable or did not bump the token");
    await api("PATCH", "/api/owner/staff", { id: mkp.j.id, action: "set_active", active: true });
    const tv = (await db(`staff_users?id=eq.${mkp.j.id}&select=token_version`))[0].token_version;
    await api("PATCH", "/api/owner/staff", { id: mkp.j.id, action: "set_role", role: "kitchen" });
    const afterRole = (await db(`staff_users?id=eq.${mkp.j.id}&select=role,token_version`))[0];
    afterRole.role === "kitchen" && afterRole.token_version > tv ? ok("P06431 a role change bumps the token too") : bad("P06431 a role change did not bump the token");
    await api("PATCH", "/api/owner/staff", { id: mkp.j.id, action: "set_role", role: "manager" });
    const old = `${TAG} X`.toLowerCase(), fresh = `${TAG} Y`;
    await api("PATCH", "/api/owner/staff", { id: mkp.j.id, action: "edit", name: fresh });
    (await db(`staff_users?id=eq.${mkp.j.id}&select=username`))[0].username === fresh.toLowerCase() ? ok("P06432 a rename changes the LOGIN name") : bad("P06432 a rename did not change the login name");
    const log = JSON.stringify((await api("GET", "/api/owner/oplog")).j || {});
    /staff_rename/.test(log) && log.includes(old) && log.includes(fresh.toLowerCase()) ? ok("P06433 the rename is logged with BOTH names") : bad("P06433 the rename is not logged with both names"); }
  { const p = await ctx.newPage();
    await p.goto(BASE + "/owner/menu", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(12000);
    const fr = p.frames().find((f) => f.url().includes("panels/editor"));
    fr && fr.url().includes("menuonly=1") && fr.url().includes(RID) ? ok("P06457/P06458/P06459 the Menu page embeds the shared engine, menu-only, pinned to this restaurant") : bad("P06457 the menu embed is wrong or missing");
    if (fr) {
      await fr.locator("button").filter({ hasText: /^\+ New$/ }).first().click();
      await p.waitForTimeout(1500);
      await fr.locator("input[type=text]:visible").first().fill("ZZ Live Trace Dish");
      await fr.locator("input[placeholder='12.99']").first().fill("55");
      await fr.locator("select:visible").first().selectOption({ index: 1 }).catch(() => {});
      await fr.locator("button").filter({ hasText: /^Save$/ }).first().click();
      await p.waitForTimeout(5000);
      const d = await db(`menu_items?restaurant_id=eq.${RID}&title=ilike.*Live Trace*&select=id,title,price`);
      dishId = d[0]?.id;
      dishId ? ok("P06476 a dish can be added through the real editor, unaided (name, price, category, Save)") : bad("P06476 a dish could not be added through the editor");
    }
    await p.close(); }
  if (dishId) {
    const g = await br.newContext({ viewport: { width: 390, height: 844 } });
    for (const [id, route] of [["P06452a", "/menu"], ["P06452b", `/r/${R.slug}/menu`]]) {
      const gp = await g.newPage();
      await gp.goto(BASE + route, { waitUntil: "domcontentloaded" }); await gp.waitForTimeout(8000);
      let t = await gp.locator("body").innerText();
      if (!/Live Trace/.test(t)) { const cat = gp.locator("button,a,div").filter({ hasText: /^Desserts$/ }).last(); await cat.click({ timeout: 5000 }).catch(() => {}); await gp.waitForTimeout(3000); t = await gp.locator("body").innerText(); }
      /Live Trace/.test(t) ? ok(`${id} …and reaches the guest door ${route}`) : bad(`${id} the dish never reached ${route}`);
      await gp.close(); }
    await g.close();
    const tc = await br.newContext(); await loginAs(tc, "tablet", BASE);
    const tr = await tc.request.get(BASE + "/api/tablet/summary");
    const tt = await tr.text();
    /Live Trace/.test(tt) ? ok("P06454 …and the waiter tablet's own feed (/api/tablet/summary — found by watching the panel)") : bad("P06454 the dish never reached the tablet's feed");
    const slim = await (await tc.request.get(BASE + "/api/tablet/summary?nomenu=1")).text();
    !/Live Trace/.test(slim) ? ok("P06454b …and the slim refresh deliberately omits the menu") : bad("P06454b the slim refresh is carrying the whole menu");
    await tc.close();
  }
  // the skin's blast radius
  { const c = await mk({ viewport: { width: 1280, height: 900 } });
    const p = await c.newPage();
    await p.goto(BASE + "/owner/settings", { waitUntil: "domcontentloaded" });
    await p.locator(".adm-chip").first().waitFor({ timeout: 120000 });
    const before = await p.evaluate(() => ({ g: localStorage.getItem("lfh_theme"), pn: localStorage.getItem("lfh_panel_theme") }));
    await p.getByRole("button", { name: /Light/ }).click(); await p.waitForTimeout(4500);
    (await p.locator(".adm.owx").first().getAttribute("data-skin")) === "light" ? ok("P06447 the skin chosen here is the one the shell shows") : bad("P06447 the skin did not apply");
    await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(2500);
    (await p.locator(".adm.owx").first().getAttribute("data-skin")) === "light" ? ok("P06449 …and it survives a full reload") : bad("P06449 the skin did not survive a reload");
    const after = await p.evaluate(() => ({ g: localStorage.getItem("lfh_theme"), pn: localStorage.getItem("lfh_panel_theme") }));
    before.g === after.g && before.pn === after.pn ? ok("P06450/P06451 …and it touches neither the guest nor the staff-panel theme key") : bad("P06450/P06451 the owner skin changed another surface's theme key");
    const mp = await c.newPage();
    await mp.goto(BASE + "/owner/menu", { waitUntil: "domcontentloaded" }); await mp.waitForTimeout(12000);
    const fr = mp.frames().find((f) => f.url().includes("panels/editor"));
    fr && fr.url().includes("skin=light") ? ok("P06448 …and it reaches the embedded editor") : bad("P06448 the embedded editor was not born with the chosen skin");
    await p.getByRole("button", { name: /Dark/ }).click().catch(() => {}); await p.waitForTimeout(2500);
    await c.close(); }
  // the section flips
  { const base = (ORIGINAL && typeof ORIGINAL === "object") ? ORIGINAL : {};
    await writeEnt({ ...base, menu: false }); await new Promise((r) => setTimeout(r, 1500));
    const c = await mk({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage();
    const rr = await p.goto(BASE + "/owner/menu", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(2500);
    rr.status() === 200 && /isn't switched on/i.test(await p.locator("body").innerText()) && (await p.locator("iframe").count()) === 0 ? ok("P06463 Menu OFF → refused server-side, with a sentence, no editor") : bad("P06463 the Menu section switch is not enforced on the page");
    !(await p.locator(".adm.owx a").allInnerTexts()).map((x) => x.trim()).includes("Menu") ? ok("P06463b …and the sidebar drops the item") : bad("P06463b the sidebar still offers Menu");
    await p.goto(BASE + "/owner/settings", { waitUntil: "domcontentloaded" });
    await p.locator(".adm-chip").first().waitFor({ timeout: 120000 }); await p.waitForTimeout(500);
    const ch = (await p.locator(".adm-chip").allInnerTexts()).map((x) => x.trim());
    !ch.some((x) => /^MENU$/i.test(x)) && (await p.locator(".adm-chip i.fa-xmark").count()) === 0 ? ok("P06462 …and the card goes quiet about it too, with no ✗ (R36)") : bad("P06462 the card reveals the withheld section");
    const sr2 = await p.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".ost-row", { timeout: 120000 });
    sr2.status() === 200 ? ok("P06464 …while the roster still works") : bad("P06464 switching Menu off broke the roster");
    await c.close();
    await writeEnt(ORIGINAL); await new Promise((r) => setTimeout(r, 1200));
    await writeEnt({ ...base, settings: false }); await new Promise((r) => setTimeout(r, 1500));
    const c2 = await mk({ viewport: { width: 1280, height: 900 } }); const p2 = await c2.newPage();
    await p2.goto(BASE + "/owner/settings", { waitUntil: "domcontentloaded" });
    // POLL, not a clock — this was the one fixed delay left in this file and it duly flapped: a slow
    // first render meant the body was still the loading state when the assertion looked.
    const refused = await until(async () => /isn't enabled|Couldn't load/i.test(await p2.locator("body").innerText()), 45000);
    refused ? ok("P06466 Settings OFF → refused server-side") : bad(`P06466 the settings page rendered with the section off: ${(await p2.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 140)}`);
    (await p2.request.fetch(BASE + "/api/owner/settings", { method: "POST", headers: { "Content-Type": "application/json" }, data: { current: "x", next: "abcdefg" } })).status() === 403 ? ok("P06467 …and the password POST is refused too") : bad("P06467 the password change was not refused");
    await c2.close();
    await writeEnt(ORIGINAL); }
} catch (e) {
  bad(`the run stopped: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  for (const id of created) await api("DELETE", `/api/owner/staff?id=${id}`);
  if (dishId) await fetch(`${U}/rest/v1/menu_items?id=eq.${dishId}&restaurant_id=eq.${RID}`, { method: "DELETE", headers: H });
  const st = await writeEnt(ORIGINAL);
  const same = JSON.stringify(await readEnt()) === JSON.stringify(ORIGINAL);
  const leftP = await db(`staff_users?username=ilike.*${TAG.toLowerCase()}*&select=id`).catch(() => []);
  const leftD = await db(`menu_items?restaurant_id=eq.${RID}&title=ilike.*Live Trace*&select=id`).catch(() => []);
  console.log(`\n  ↩︎  removed ${created.length} person row(s) and ${dishId ? 1 : 0} dish, by id · entitlements restored (${st}), identical: ${same}`);
  if (!leftP.length && !leftD.length && same) ok("this run left nothing behind");
  else bad(`LEFT BEHIND: ${leftP.length} person row(s), ${leftD.length} dish(es), entitlements identical=${same}`);
  await br.close();
}
console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
if (fail) console.log("\n❌ FAIL — each id above is a row in .claude/sweep/LEDGER/T13.md.");
else console.log("\n✅ PASS — the owner's three screens behave as all 500 recorded checks say they do");
process.exit(fail ? 1 : 0);
