// verify-pay-history-delete.mjs — "can a person's pay history be erased by deleting their login?"
//
//   node scripts/verify-pay-history-delete.mjs --base http://localhost:4113
//
// WHY THIS FILE EXISTS (T13 sweep, 2026-08-19)
// Ledger row P06357 sat as a written MANUAL check for three passes: "removing a person WITH pay
// history is refused, and the reason names the entries". It stayed manual because proving it needs
// real money rows, and a guard that invents salary records on a live restaurant is worse than no
// guard. So nobody ran it, which is the same as not having it — and the rule it protects is a
// compliance one: a salary or an advance is part of the books (docs/COMPLIANCE-GUARDRAILS.md), and
// a login delete must never take one with it.
//
// It is safe to run because it owns everything it touches: it creates its OWN throwaway person,
// records ONE ₹1 entry through the product's own endpoint, asserts the refusal at the API and ON
// SCREEN, then deletes the payment row and the person BY ID. It never reads or writes anybody
// else's rows, and the finally block runs even on a crash. One sign-in, through the shared cached
// helper, so it cannot trip a login limit.
import { readFileSync } from "node:fs";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const BASE = arg("--base") || process.env.LFH_BASE || "http://localhost:4000";
const RID = arg("--rid") || "00000000-0000-0000-0000-000000000001";
const TAG = "zzpay" + Date.now().toString().slice(-5);

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };

const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
const U = env.NEXT_PUBLIC_SUPABASE_URL;

console.log("A person's pay history cannot be erased by deleting their login\n");

const { chromium } = await import("playwright");
const { loginAs } = await import("./sweep/login.mjs");
const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
ctx.setDefaultNavigationTimeout(150000); ctx.setDefaultTimeout(60000);
const api = async (m, p, b) => {
  const r = await ctx.request.fetch(BASE + p, { method: m, headers: { "Content-Type": "application/json" }, ...(b ? { data: b } : {}) });
  return { s: r.status(), j: await r.json().catch(() => null) };
};
const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch { /* settling */ } await new Promise((r) => setTimeout(r, 250)); } return false; };
let personId = null, payId = null;

try {
  await loginAs(ctx, "owner", BASE);
  const mk = await api("POST", "/api/owner/staff", { name: `${TAG} Paid`, role: "manager", restaurant_id: RID, password: "guard-pass-2026" });
  if (mk.s !== 200 || !mk.j?.id) throw new Error(`could not create the throwaway person (${mk.s})`);
  personId = mk.j.id;
  await api("PATCH", "/api/owner/staff", { id: personId, action: "set_payroll", in_payroll: true });
  const today = new Date().toISOString().slice(0, 10);
  const p1 = await api("POST", "/api/owner/staff", {
    action: "record_payment", staff_id: personId, kind: "salary", amount: 1, mode: "cash",
    paid_on: today, for_period: today.slice(0, 7), note: "verify-pay-history-delete — removed in the same run",
  });
  payId = p1.j?.payment?.id;
  if (p1.s === 200 && payId) ok("a ₹1 entry can be recorded for a pay-list person (the setup this needs)");
  else bad(`could not record the entry (${p1.s}) — the rest of this guard cannot run`);

  if (payId) {
    const del = await api("DELETE", `/api/owner/staff?id=${personId}`);
    if (del.s === 409) ok("the DELETE is refused with 409, not silently allowed");
    else bad(`the delete answered ${del.s} — a login with pay history must never be deletable`);
    const msg = String(del.j?.error || "");
    if (/\b1 pay entr(y|ies)\b/i.test(msg)) ok("the refusal names how many entries are at stake");
    else bad(`the refusal does not name the count: "${msg.slice(0, 90)}"`);
    if (/books/i.test(msg)) ok("…says why (the entries are part of the books)");
    else bad("…does not say why it matters, so it reads as an arbitrary block");
    if (/Mark as left/i.test(msg)) ok("…and offers the compliant way forward");
    else bad("…offers no way forward, which is how someone starts looking for a delete that does work");

    const still = await (await fetch(`${U}/rest/v1/staff_users?id=eq.${personId}&select=id`, { headers: H })).json();
    if (still.length === 1) ok("the person is still there — nothing was erased");
    else bad("the person was deleted despite the refusal");
    const payStill = await (await fetch(`${U}/rest/v1/staff_payments?id=eq.${payId}&select=id`, { headers: H })).json();
    if (payStill.length === 1) ok("…and so is the money row");
    else bad("the payment row is gone — this is the erasure the rule exists to prevent");

    // AND THE OWNER MUST SEE IT. A 409 nobody reads is the same as a silent refusal.
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    await page.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".ost-row", { timeout: 120000 });
    await page.waitForTimeout(900);
    const row = page.locator(".ost-row").filter({ hasText: `${TAG} Paid` }).first();
    const banner = async () => { const l = page.locator(".adm-card").filter({ hasText: /Try again/ }); return await l.count() ? await l.first().innerText() : ""; };
    await row.getByRole("button", { name: /^Remove$/ }).click();
    await until(async () => /pay entr/i.test(await banner()));
    const b = await banner();
    if (/pay entr/i.test(b)) ok("the owner is told, on screen, in words");
    else bad("the refusal never reaches the screen — the owner taps Remove and sees nothing");
    if (/Mark as left/i.test(b)) ok("…with the way forward, on screen too");
    else bad("the on-screen message drops the way forward");
    if (!/^Something went wrong/.test(b)) ok("…headed as a refusal, not as a fault");
    else bad("it is headed \"Something went wrong\" — the system worked; this is a refusal");
    if ((await page.locator(".ost-row").filter({ hasText: `${TAG} Paid` }).count()) === 1) ok("and the person is still on the roster");
    else bad("the row vanished from the roster even though the delete was refused");
    await page.close();
  }
} catch (e) {
  bad(`could not run: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  // The money row first — it is what blocks the delete — then the person. Both BY ID.
  if (payId) { const r = await fetch(`${U}/rest/v1/staff_payments?id=eq.${payId}`, { method: "DELETE", headers: H }); console.log(`  ↩︎  removed the ₹1 entry by id (${r.status})`); }
  if (personId) { const d = await api("DELETE", `/api/owner/staff?id=${personId}`); console.log(`  ↩︎  removed the throwaway person (${d.s})`); }
  const leftP = await (await fetch(`${U}/rest/v1/staff_users?username=ilike.*${TAG.toLowerCase()}*&select=id`, { headers: H })).json().catch(() => []);
  const leftM = await (await fetch(`${U}/rest/v1/staff_payments?note=ilike.*verify-pay-history-delete*&select=id`, { headers: H })).json().catch(() => []);
  if (!leftP.length && !leftM.length) ok("this guard left nothing behind");
  else bad(`LEFT BEHIND: ${leftP.length} person row(s), ${leftM.length} payment row(s) — clean these up by hand`);
  await br.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log("\n❌ FAIL — see docs/COMPLIANCE-GUARDRAILS.md: a sale, a salary and an advance are part of the books.");
else console.log("\n✅ PASS — a login with pay history cannot be deleted, and the owner is told why");
process.exit(fail ? 1 : 0);
