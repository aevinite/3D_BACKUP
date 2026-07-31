#!/usr/bin/env node
// verify-access-live.mjs — drives the rebuilt access model in the RUNNING app, signed in as
// each REAL role (not as the admin, who sees everything by design).
//
// Static guards prove a switch reaches code; this proves the screen a person actually sees
// obeys it. Every check below is a promise the owner made me: a switched-off tab is gone AND
// its endpoint refuses, the menu master really removes the guest menu, the manager panel
// configures no permissions, and the owner panel has no permission screens left.
//
//   node scripts/verify-access-live.mjs                  (defaults to http://localhost:4010)
//   VERIFY_BASE=http://localhost:4000 node scripts/verify-access-live.mjs
//
// Signs in ONCE per role — loginAs caches the session, so this never trips the login limit.
import { chromium } from "playwright";
import { loginAs, adminHeaders } from "./sweep/login.mjs";
import { readFileSync } from "node:fs";
const B = process.env.VERIFY_BASE || "http://localhost:4010";
const H = adminHeaders(B);
const env = {}; for (const l of readFileSync(new URL("../.env.local", import.meta.url),"utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) env[m[1]]=m[2].trim(); }
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
const db = (q) => fetch(`${U}/rest/v1/${q}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } }).then((r) => r.json());
const bad = (t) => ["-->", "${", "[object Object]", "NaN"].filter((x) => t.includes(x));

const rests = await (await fetch(B + "/api/admin/restaurants", { headers: H })).json();
const list = Array.isArray(rests) ? rests : rests.restaurants || [];
const fh = list.find((x) => x.slug === "french-house");
let pass = 0, fail = 0;
const ck = (n, ok, got) => { ok ? (pass++, console.log("  PASS " + n)) : (fail++, console.log("  FAIL " + n + " · got: " + JSON.stringify(got))); };

const browser = await chromium.launch();

// ── 1 · every panel still opens for its real role ──────────────────────────
console.log("\n[1] each role can still sign in and use its panel");
for (const role of ["manager", "owner", "kitchen", "tablet"]) {
  const ctx = await browser.newContext();
  const route = await loginAs(ctx, role, B);
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e.message)));
  await p.goto(B + route, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  // manager/kitchen/tablet are served INSIDE an iframe (PanelFrame), so the outer body is
  // empty by design — read the frame, or this "check" can never fail for the wrong reason.
  const inner = await p.frameLocator("iframe").locator("body").innerText().catch(() => "");
  const txt = (inner && inner.length > 20) ? inner : await p.locator("body").innerText().catch(() => "");
  // Assert the panel's OWN landmark, never a character count: an idle kitchen board is a
  // perfectly healthy screen that happens to be short, and a length threshold would call
  // it broken while missing a screen that renders the wrong thing at length.
  const LANDMARK = { manager: /Editor|Tables|Bills/i, owner: /Dashboard|Revenue|Today/i,
                     kitchen: /Kitchen live orders/i, tablet: /Table|Floor|Order/i };
  ck(`${role} panel renders its own screen`, LANDMARK[role].test(txt), txt.slice(0, 60));
  ck(`${role} panel has no leaked code`, bad(txt).length === 0, bad(txt));
  ck(`${role} panel has no page errors`, errs.length === 0, errs.slice(0, 2));
  await ctx.close();
}

// ── 2 · Manager's menu: switch the Log tab off, prove it goes AND refuses ──
console.log("\n[2] Manager's menu — switching a tab off removes it and refuses its endpoint");
const setTab = (key, on) => fetch(B + "/api/admin/restaurants/access-tree", {
  method: "POST", headers: { ...H, "Content-Type": "application/json" },
  body: JSON.stringify({ restaurant_id: fh.id, patch: { tabs: { manager: { [key]: on } } } }) });
await setTab("log", false);
{
  const ctx = await browser.newContext();
  const route = await loginAs(ctx, "manager", B);
  const p = await ctx.newPage();
  await p.goto(B + route, { waitUntil: "networkidle" });
  await p.waitForTimeout(3000);
  const tabs = await p.frameLocator("iframe").locator(".tabs .tab:not([hidden])").allInnerTexts().catch(() => []);
  const flat = tabs.join(" ").toLowerCase();
  ck("Log tab is gone for a real manager", !flat.includes("log"), tabs);
  const api = await p.evaluate(async () => (await fetch("/api/editor/oplog", { cache: "no-store" })).status);
  ck("…and /api/editor/oplog refuses it (403)", api === 403, api);
  await ctx.close();
}
await setTab("log", true);
{
  const ctx = await browser.newContext();
  const route = await loginAs(ctx, "manager", B);
  const p = await ctx.newPage();
  await p.goto(B + route, { waitUntil: "networkidle" });
  await p.waitForTimeout(3000);
  const api = await p.evaluate(async () => (await fetch("/api/editor/oplog", { cache: "no-store" })).status);
  ck("switching it back on restores the endpoint", api === 200, api);
  await ctx.close();
}

// ── 3 · Menu master: off = the guest menu is genuinely gone ───────────────
console.log("\n[3] Menu master — off means no guest menu at all");
const setMenu = (on) => fetch(B + "/api/admin/restaurants/access-tree", {
  method: "POST", headers: { ...H, "Content-Type": "application/json" },
  body: JSON.stringify({ restaurant_id: fh.id, patch: { settings: { menu_enabled: on } } }) });
const before = await fetch(`${B}/r/${fh.slug}/menu`);
ck("menu opens while the switch is on", before.status === 200, before.status);
await setMenu(false);
// getSettings caches a restaurant's row for 8s (lib/menu.ts SETTINGS_TTL_MS), so a switch
// takes up to that long to bite everywhere. Wait it out rather than racing our own cache.
await new Promise((r) => setTimeout(r, 9000));
const off = await fetch(`${B}/r/${fh.slug}/menu`);
const offItem = await fetch(`${B}/r/${fh.slug}/item/anything`);
ck("menu is not found with the switch off", off.status === 404, off.status);
ck("a dish URL is not found either", offItem.status === 404, offItem.status);
await setMenu(true);
await new Promise((r) => setTimeout(r, 9000));
const back = await fetch(`${B}/r/${fh.slug}/menu`);
ck("menu comes back when switched on", back.status === 200, back.status);

// ── 4 · the manager panel carries no permission screens any more ──────────
console.log("\n[4] the manager panel configures no permissions");
{
  const ctx = await browser.newContext();
  const route = await loginAs(ctx, "manager", B);
  const p = await ctx.newPage();
  await p.goto(B + route, { waitUntil: "networkidle" });
  await p.waitForTimeout(3000);
  const f = p.frameLocator("iframe");
  await f.locator('.tab[data-tab="general"]').click().catch(() => {});
  await p.waitForTimeout(1500);
  const rows = await f.locator(".list-item:not([hidden])").allInnerTexts().catch(() => []);
  const flat = rows.join(" | ").toLowerCase();
  ck("no Billing row", !flat.includes("billing"), rows);
  ck("no Kitchen row", !flat.includes("kot printing"), rows);
  ck("no Dining-sessions row", !flat.includes("qr & location"), rows);
  ck("Sections row is the rota, not 'permissions'", !flat.includes("permissions & sections"), rows);
  await ctx.close();
}

// ── 5 · owner panel: Powers tab gone, roster intact ───────────────────────
console.log("\n[5] owner panel — no permission screens, roster intact");
{
  const ctx = await browser.newContext();
  await loginAs(ctx, "owner", B);
  const p = await ctx.newPage();
  await p.goto(B + "/owner/staff", { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const txt = await p.locator("body").innerText();
  ck("Powers tab is gone", !/\bPowers\b/.test(txt), txt.match(/Powers/g));
  ck("the team roster still renders", txt.length > 400, txt.length);
  await p.goto(B + "/owner/settings", { waitUntil: "networkidle" });
  await p.waitForTimeout(2000);
  const s = await p.locator("body").innerText();
  ck("'Features you control' is gone", !s.includes("Features you control"), true);
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
