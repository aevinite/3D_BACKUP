// verify:recycle-name — a login in the RECYCLE BIN must behave like a DELETED one:
// its name is free to re-use, and RESTORING it asks the admin who keeps the name
// instead of failing or silently renaming somebody (owner, 2026-08-01; mig 245).
//
// Runs against the QA server on the DEV database — never AV live. Discipline: it makes
// NO login attempts at all (admin cookie only, so it can never raise a rate-limit alert
// about the owner), each scenario uses its OWN throwaway "zz" pair so one case can't set
// up the next, and every row it creates is deleted at the end.
// Usage: node scripts/verify-recycle-name.mjs [--base http://localhost:4000] [--browser]
//        --browser also drives the real chooser dialog. Both UI faults it checks for
//        SHIPPED once: a refusal rendered behind the overlay (so the button looked
//        dead), and the dialog portalled out of `.adm` (a white card in a dark app).
import { createHash } from "node:crypto";
import fs from "node:fs";
import { requireUp } from "./sweep/appUp.mjs";

const args = process.argv.slice(2);
const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const BASE = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "") || "http://localhost:4000";
const cookie = "lfh_staff_auth=" + createHash("sha256").update(env.ADMIN_PASSWORD).digest("hex");
// Nothing answering = "could not run" (exit 2), said in plain words — never a raw ECONNREFUSED
// stack, which reads as "this guard is broken". (sweep #6 / T28, 2026-08-22)
await requireUp(BASE, "the restore-and-rename walk");
const SB = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
let fails = 0;
const check = (n, p, x = "") => { console.log(`${p ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); if (!p) fails++; };

const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, {
    method: opts.method || "GET",
    headers: { cookie, ...(opts.body ? { "content-type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const rest = (q, opts = {}) => fetch(`${SB}/rest/v1/${q}`, {
  method: opts.method || "GET",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, ...(opts.body ? { "content-type": "application/json" } : {}) },
  body: opts.body,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const mkOwner = (name) => api("/api/admin/owners", { method: "POST", body: { action: "create_owner", name } });
const binIt = async (id) => {
  await api("/api/admin/owners", { method: "PATCH", body: { owner_id: id, action: "set_active", active: false } });
  return api(`/api/admin/owners?id=${id}`, { method: "DELETE" });
};
const restore = (id, resolve) => api("/api/admin/owners", { method: "POST", body: { action: "restore_owner", owner_id: id, ...(resolve ? { resolve } : {}) } });
const row = async (id) => (await rest(`staff_users?id=eq.${id}&select=id,username,name,active,deleted_at`)).json?.[0];
// One binned owner + one live owner fighting over `name`.
const pair = async (name) => {
  const old = await mkOwner(name);
  await binIt(old.json.id);
  const live = await mkOwner(name);
  return { oldId: old.json.id, liveId: live.json.id, liveStatus: live.status, liveErr: live.json.error };
};

try {
  await rest(`staff_users?username=like.zz*&role=eq.owner`, { method: "DELETE" });

  // ── 1. THE ASK: a name in the recycle bin is free to use again ───────────────
  const p1 = await pair("zzrishi");
  check("the SAME name can be used again while the old owner sits in the bin", p1.liveStatus === 200, p1.liveErr || `status ${p1.liveStatus}`);
  const dupLive = await mkOwner("zzrishi");
  check("but a LIVE owner still reserves it (409)", dupLive.status === 409, `${dupLive.status} ${dupLive.json.error || ""}`);

  // ── 2. Restoring it is a QUESTION, never a silent failure or a silent rename ──
  const r1 = await restore(p1.oldId);
  check("restore answers 409 with a conflict block", r1.status === 409 && !!r1.json.conflict, `${r1.status} ${r1.json.error || ""}`);
  check("the conflict names both sides", r1.json.conflict?.restored?.id === p1.oldId && r1.json.conflict?.existing?.id === p1.liveId);
  check("it offers to rename the live owner (both are owners)", r1.json.conflict?.canRenameExisting === true);
  check("nothing changed — the owner is still in the bin", !!(await row(p1.oldId)).deleted_at);
  check("…and the live owner still has the name", (await row(p1.liveId)).username === "zzrishi");

  // ── 3. Option A: the returning owner takes a new name ────────────────────────
  const r2 = await restore(p1.oldId, { mode: "rename_restored", name: "zzrishi old" });
  check("A · restore under a new name succeeds", r2.status === 200, r2.json.error || "");
  const a3 = await row(p1.oldId);
  check("A · it is live again, under the new name", a3.deleted_at === null && a3.username === "zzrishi old", a3.username);
  check("A · it comes back SUSPENDED, exactly as before", a3.active === false);
  check("A · the current owner kept the disputed name", (await row(p1.liveId)).username === "zzrishi");

  // ── 4. Option B: rename the LIVE owner instead, freeing the name ─────────────
  const p2 = await pair("zzbob");
  const r3 = await restore(p2.oldId, { mode: "rename_existing", name: "zzbob two" });
  check("B · rename-the-other-one restore succeeds", r3.status === 200, r3.json.error || "");
  const b4o = await row(p2.oldId), b4l = await row(p2.liveId);
  check("B · the returning owner is live under its ORIGINAL name", b4o.deleted_at === null && b4o.username === "zzbob", b4o.username);
  check("B · the other owner was renamed, visibly", b4l.username === "zzbob two", b4l.username);
  check("B · the rename is written to the log", (await api("/api/admin/owners?id=" + p2.liveId)).json.activity?.some((x) => x.action === "owner_rename"));

  // ── 5. Guard rails ───────────────────────────────────────────────────────────
  const p3 = await pair("zzcarl");
  check("a 1-character rename is refused", (await restore(p3.oldId, { mode: "rename_restored", name: "x" })).status === 400);
  check("renaming ONTO another live owner is refused", (await restore(p3.oldId, { mode: "rename_restored", name: "zzbob two" })).status === 409);
  check("renaming the live owner to the SAME disputed name is refused", (await restore(p3.oldId, { mode: "rename_existing", name: "zzcarl" })).status === 400);
  check("renaming the live owner onto a THIRD live name is refused", (await restore(p3.oldId, { mode: "rename_existing", name: "zzbob two" })).status === 409);
  check("after all those refusals it is STILL in the bin", !!(await row(p3.oldId)).deleted_at);
  const noClash = await pair("zzdave");
  await rest(`staff_users?id=eq.${noClash.liveId}`, { method: "DELETE" }); // free the name behind its back
  check("a restore with no clash still works with one press", (await restore(noClash.oldId)).status === 200);

  // ── 5b. Names people can actually type ───────────────────────────────────────
  // An owner could be created or restored as "🙂🙂" / "--" while a waiter couldn't:
  // the owners route counted raw characters, the staff routes count letters+digits.
  const emoji = await mkOwner("🙂🙂");
  check("an emoji-only owner name is refused at CREATE", emoji.status === 400, `${emoji.status} ${emoji.json.error || ""}`);
  const p3b = await pair("zzemoji");
  check("…and at RESTORE too", (await restore(p3b.oldId, { mode: "rename_restored", name: "🙂🙂" })).status === 400);
  check("a name with 2 real letters is still fine", (await restore(p3b.oldId, { mode: "rename_restored", name: "zz9" })).status === 200);

  // ── 6. A binned row is not a login, even when a live row shares its name ─────
  const p4 = await pair("zzerin");
  const live = await rest(`staff_users?username=eq.zzerin&deleted_at=is.null&select=id`);
  const all = await rest(`staff_users?username=eq.zzerin&select=id`);
  check("two rows share the name, but only ONE is live", (all.json || []).length === 2 && (live.json || []).length === 1, `${(all.json || []).length} rows, ${(live.json || []).length} live`);
  check("the live one is the new owner, not the binned one", live.json?.[0]?.id === p4.liveId);
  // The exact filter loginUser now runs — the binned row can never be a candidate.
  const cand = await rest(`staff_users?username=eq.zzerin&active=is.true&deleted_at=is.null&select=id`);
  check("the login lookup can only ever match the live row", (cand.json || []).every((r) => r.id !== p4.oldId));

  // ── 7. The database still refuses two LIVE rows with one name ────────────────
  const forced = await rest(`staff_users?id=eq.${p4.oldId}`, {
    method: "PATCH", body: JSON.stringify({ deleted_at: null }),
  });
  check("the unique index still blocks two live rows sharing a name", forced.status >= 400, `status ${forced.status}`);
  // ── 8. The dialog itself (opt-in: needs a browser) ───────────────────────────
  if (args.includes("--browser")) {
    const { chromium } = await import("playwright");
    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
    await ctx.addCookies([{ name: "lfh_staff_auth", value: cookie.split("=")[1], url: BASE }]);
    const page = await ctx.newPage();
    const jsErrors = [];
    page.on("pageerror", (e) => jsErrors.push(String(e)));
    try {
      const u = await pair("zzdialog");
      await mkOwner("zztaken already");
      await page.goto(`${BASE}/aevinite/recycle`, { waitUntil: "networkidle", timeout: 60000 });
      // Target the row BY NAME. `.last()` once clicked whichever bin row happened to be
      // last — with real binned owners on the page that could restore someone's actual
      // account, and it made the guard test a different owner than it then asserted on.
      const ourRow = page.locator('[data-owner="zzdialog"]');
      await ourRow.waitFor({ timeout: 15000 });
      await ourRow.getByRole("button", { name: /Restore \(suspended\)/ }).click();
      await page.waitForTimeout(1500);
      check("UI · the chooser opens instead of an error", await page.locator('[role="dialog"]').count() === 1);

      const card = page.locator('[role="dialog"] .adm-card');
      const box = await card.boundingBox();
      check("UI · the whole box is on screen", !!box && box.y >= 0 && box.y + box.height <= 951, box ? `y ${Math.round(box.y)} h ${Math.round(box.height)}` : "none");
      const skin = await page.evaluate(() => {
        const lum = (c) => { const m = c.match(/\d+/g) || [0, 0, 0]; return (+m[0] * 299 + +m[1] * 587 + +m[2] * 114) / 1000; };
        return Math.abs(lum(getComputedStyle(document.querySelector('[role="dialog"] .adm-card')).backgroundColor)
                      - lum(getComputedStyle(document.querySelector(".adm")).backgroundColor));
      });
      check("UI · it wears the console's skin (not a white card in the dark)", skin < 90, `gap ${Math.round(skin)}`);

      // The refusal must land INSIDE the dialog — this one shipped invisible.
      await page.getByLabel("New name for the owner who currently has it").fill("zztaken already");
      await page.getByRole("button", { name: /Rename them & restore/ }).click();
      await page.waitForTimeout(2500);
      const alertLoc = page.locator('[role="dialog"] [role="alert"]');
      check("UI · a refusal is shown inside the dialog, on top", await alertLoc.count() === 1
        && await alertLoc.evaluate((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!el.offsetParent && (hit === el || el.contains(hit)); }));

      // A second clash announces itself instead of quietly swapping in another person.
      await page.getByLabel("New name for the owner being restored").fill("zztaken already");
      await page.getByRole("button", { name: /Restore under this name/ }).click();
      await page.waitForTimeout(2500);
      check("UI · a second clash says so", /is taken as well/.test(await page.locator('[role="dialog"]').innerText()));

      await page.getByLabel("New name for the owner being restored").fill("zzdialog old");
      await page.getByRole("button", { name: /Restore under this name/ }).click();
      await page.waitForTimeout(2500);
      const fin = (await rest(`staff_users?id=eq.${u.oldId}&select=username,deleted_at`)).json?.[0];
      check("UI · the admin can still finish after two refusals", fin?.deleted_at === null && fin?.username === "zzdialog old", fin?.username);
      check("UI · no JS errors", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | "));
    } finally { await b.close(); }
  }
} finally {
  const del = await rest(`staff_users?username=like.zz*&role=eq.owner`, { method: "DELETE" });
  const left = await rest(`staff_users?username=like.zz*&select=id`);
  console.log(`cleanup: removed test owners (status ${del.status}), ${((left.json) || []).length} zz* rows left`);
}
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
