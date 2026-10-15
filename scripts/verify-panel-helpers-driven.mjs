// verify-panel-helpers-driven.mjs — FIVE SMALL THINGS THE SHARED PANEL FILES NOW DO, DRIVEN FOR REAL.
//
//   npm run verify:panel-helpers-driven
//
// Sweep #10 T16 round 2 (owner, 2026-10-15: "do all five"). Each section runs the REAL shipped file in
// a real browser against a tiny local server of its own — no app, no database, no login — so it can
// never add load, set off one of the app's own limits, or write a row.
//   1. Report an issue → a BIG phone photo is made smaller and attached, not refused (issue-raise.js)
//   2. ⚙ drawer → "Take guest menu offline" is shown only to a manager it was handed to (maint.js)
//   3. First-login card → a save kept on the device (no signal) lets the person carry on (maint.js)
//   4. My profile & pay → says what the number counts, and invites rather than scores (myprofile.js)
//   5. Audit / Activity "A–Z" sorts → a row with no name goes LAST, not first (auditsort.js)
//   6. My profile & pay → a failed re-read after a save keeps the form; a second save never re-sends
//      the phone from the old number (myprofile.js, items 18 and 19)
//   7. Report an issue → a photo is never dropped in silence when Send is pressed with no signal
//      (issue-raise.js, item 20)
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// Coverage for sweep #10 T16 round 2 (scripts/sweep/t16s10/cov.mjs) — a no-op unless T16_COV is set.
import { covStart, covStop } from "./sweep/t16s10/cov.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = (f) => readFileSync(join(ROOT, "public/panels", f), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); } };
if (process.argv.some((a) => a.startsWith("--base"))) console.log("verify-panel-helpers-driven: --base does not apply — this guard runs its own server.");

// ── the stand-in server ──────────────────────────────────────────────────────────────────────
const W = { profile: null, maint: { maintenance: false, canChange: false }, maintStatus: 200, uploads: [], saves: [] };
const page = (scripts, pre = "") => `<!doctype html><meta charset="utf-8"><body><div class="topbar"><div class="top-actions"><button id="myProfileBtn" hidden>me</button></div></div>
  <script>window.LFH_TEST_PACING = { first: 300, base: 400, max: 800, wake: 50, stuck: 1500, boot: 400 };</script>${pre}
  ${scripts.map((f) => `<script>${file(f)}</script>`).join("\n")}`;
const server = http.createServer((req, res) => {
  const json = (code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (req.url === "/issue") { res.writeHead(200, { "content-type": "text/html" }); return res.end(page(["shrinkimg.js", "issue-raise.js"])); }
  if (req.url === "/issue-off") { res.writeHead(200, { "content-type": "text/html" }); return res.end(page(["shrinkimg.js", "issue-raise.js"], `<script>Object.defineProperty(navigator, "onLine", { configurable: true, get: () => window.__on !== false });</script>`)); }
  if (req.url === "/issue-noshrink") { res.writeHead(200, { "content-type": "text/html" }); return res.end(page(["issue-raise.js"])); }
  if (req.url === "/drawer") { res.writeHead(200, { "content-type": "text/html" }); return res.end(page(["backstack.js", "maint.js", "outbox.js", "myprofile.js"])); }
  if (req.url === "/drawer-offline") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(page(["backstack.js", "maint.js", "outbox.js", "myprofile.js"], `<script>window.__off = false; Object.defineProperty(navigator, "onLine", { configurable: true, get: () => !window.__off });</script>`));
  }
  if (req.method === "GET" && req.url.startsWith("/api/panel-profile")) {
    if (W.gets && W.gets.length) { const g = W.gets.length > 1 ? W.gets.shift() : W.gets[0]; return json(g.status, g.body); }   // section 6: scripted reads
    return json(200, W.profile || { staff: false });
  }
  if (req.url.startsWith("/api/maintenance")) return json(W.maintStatus, W.maint);
  let body = [];
  req.on("data", (c) => body.push(c));
  req.on("end", () => {
    const buf = Buffer.concat(body);
    if (req.url.startsWith("/api/issue-media")) {
      // multipart: find the part's content type and its size, roughly (the boundary lines are small)
      const head = buf.slice(0, 600).toString("latin1");
      const type = (head.match(/Content-Type: (image\/[a-z]+)/i) || [])[1] || "?";
      W.uploads.push({ type, bytes: buf.length });
      return json(200, { url: "https://example.invalid/p.webp" });
    }
    if (req.url.startsWith("/api/panel-profile")) { W.saves.push(buf.toString("utf8")); (W.expects ||= []).push(req.headers["x-lfh-expect"] || ""); return json(200, { ok: true }); }
    return json(200, { ok: true });
  });
});
await new Promise((r, j) => { server.once("error", j); server.listen(0, "127.0.0.1", r); });
const BASE = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
await covStart(p);
const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
const until = async (fn, ms = 8000) => { const t = Date.now() + ms; while (Date.now() < t) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

// ── 1. a big photo ───────────────────────────────────────────────────────────────────────────
console.log("\n1) Report an issue — a big phone photo is made smaller, not refused");
// A 3000×3000 photo of noise at JPEG quality 1 — the shape of a new phone's camera, well over 5 MB.
const PICK = () => `(async () => {
  const c = document.createElement("canvas"); c.width = 3000; c.height = 3000; const x = c.getContext("2d");
  const d = x.createImageData(3000, 3000); for (let i = 0; i < d.data.length; i++) d.data[i] = (Math.random() * 256) | 0; x.putImageData(d, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 1));
  const f = new File([blob], "camera.jpg", { type: "image/jpeg" });
  const dt = new DataTransfer(); dt.items.add(f); const inp = document.getElementById("lfhirFile"); inp.files = dt.files;
  inp.dispatchEvent(new Event("change")); return f.size; })()`;
const openIssue = () => p.evaluate(() => { window.__sent = []; window.LFH_ISSUE.open({ api: async (path, o) => { window.__sent.push({ path, o }); return { ok: true }; } }); });
await p.goto(BASE + "/issue"); await openIssue();
const big = await p.evaluate(PICK());
ok(big > 5 * 1024 * 1024, `the test photo really is over 5 MB (${(big / 1048576).toFixed(1)} MB)`);
const sendLocked = await p.evaluate(() => document.getElementById("lfhirSend").disabled || /smaller/.test(document.getElementById("lfhirStatus").textContent));
ok(sendLocked, "while it is being made smaller, Send waits (so the photo cannot be dropped mid-way)");
const attached = await until(() => p.evaluate(() => !!document.querySelector("#lfhirPrevs img")), 20000);
const said = await p.evaluate(() => document.getElementById("lfhirStatus").textContent);
ok(attached && !/5 MB|too big/i.test(said), "it is attached, with no refusal on screen", said);
ok(await p.evaluate(() => !document.getElementById("lfhirSend").disabled), "…and Send is usable again");
await p.fill("#lfhirSubj", "Fridge not cooling"); await p.click("#lfhirSend");
await until(async () => W.uploads.length > 0, 15000);
const up = W.uploads.at(-1) || {};
ok(up.type === "image/webp" && up.bytes < 5 * 1024 * 1024, "what travels is the smaller WebP, under the server's 5 MB limit", JSON.stringify(up));
// …the same photo on a device that cannot shrink it: refused, in words a person can act on.
await p.goto(BASE + "/issue-noshrink"); await openIssue(); await p.evaluate(PICK());
await until(() => p.evaluate(() => /too big/.test(document.getElementById("lfhirStatus").textContent)), 5000);
const refused = await p.evaluate(() => ({ s: document.getElementById("lfhirStatus").textContent, img: !!document.querySelector("#lfhirPrevs img") }));
ok(!refused.img && /too big to send\. Take a new one, or pick a smaller picture\./.test(refused.s), "where it cannot be shrunk it is refused — saying what to do, not '5 MB'", refused.s);
// …and a shrink that is still too big is refused the same way, never attached.
await p.goto(BASE + "/issue"); await p.evaluate(() => { window.LFH_IMG.shrink = async () => ({ file: new File([new Uint8Array(6 * 1024 * 1024)], "x.webp", { type: "image/webp" }) }); });
await openIssue(); await p.evaluate(PICK());
await until(() => p.evaluate(() => /too big/.test(document.getElementById("lfhirStatus").textContent)), 8000);
ok(await p.evaluate(() => !document.querySelector("#lfhirPrevs img") && /too big/.test(document.getElementById("lfhirStatus").textContent)), "a photo still over 5 MB after shrinking is refused, never attached");
// …and a small photo is attached exactly as it was, with no shrink step at pick time.
await p.goto(BASE + "/issue"); await p.evaluate(() => { window.__shr = 0; const o = window.LFH_IMG.shrink; window.LFH_IMG.shrink = async (f) => { window.__shr++; return o(f); }; });
await openIssue();
await p.evaluate(async () => { const c = document.createElement("canvas"); c.width = 200; c.height = 200; const b = await new Promise((r) => c.toBlob(r, "image/png"));
  const dt = new DataTransfer(); dt.items.add(new File([b], "s.png", { type: "image/png" })); const i = document.getElementById("lfhirFile"); i.files = dt.files; i.dispatchEvent(new Event("change")); });
await until(() => p.evaluate(() => !!document.querySelector("#lfhirPrevs img")), 5000);
ok(await p.evaluate(() => window.__shr === 0 && !!document.querySelector("#lfhirPrevs img")), "a small photo attaches at once (the pick-time shrink runs only for a big one)");

// ── 2. the drawer's guest-menu switch ────────────────────────────────────────────────────────
console.log("\n2) ⚙ drawer — the guest-menu switch is there only for a manager it was handed to");
const MANAGER = { staff: true, id: "u1", username: "diagm1", role: "manager", name: "Diag", phone: "9", needsProfile: false, hasPin: true, profileModule: true, profile: {}, completeness: { filled: 1, total: 8 }, job: {} };
const drawerText = async () => {
  await p.evaluate(() => { const o = document.querySelector(".lfh-ov, .lfh-overlay"); if (o) o.remove(); });
  await until(() => p.evaluate(() => !!document.getElementById("staffSettingsBtn")), 8000);
  await p.click("#staffSettingsBtn");
  await p.waitForTimeout(500);
  return p.evaluate(() => { const secs = [...document.querySelectorAll(".lfh-sec")]; const g = secs.find((s) => /Guest menu/.test(s.textContent)); return { shown: !!g && !g.hidden && g.offsetParent !== null, text: g ? g.textContent : "" }; });
};
W.profile = MANAGER; W.maint = { maintenance: false, canChange: false }; W.maintStatus = 200;
await p.goto(BASE + "/drawer");
let d = await drawerText();
ok(!d.shown, "not handed over → no Guest menu section at all (absent, never a button that ends in 'ask your admin')", JSON.stringify(d));
W.maint = { maintenance: false, canChange: true };
await p.goto(BASE + "/drawer"); d = await drawerText();
ok(d.shown && /Take guest menu offline/.test(d.text), "handed over → the section is there, pointing the right way", JSON.stringify(d));
W.maint = { maintenance: true, canChange: true }; d = await drawerText();
ok(d.shown && /Bring menu back online/.test(d.text), "…and when the menu is offline it offers to bring it back", JSON.stringify(d));
W.maintStatus = 503; W.maint = { error: "busy" }; d = await drawerText();
ok(d.shown && /Couldn't read the guest menu/.test(d.text), "a read that fails AFTER a yes keeps the section, saying it couldn't read (mid-incident, the way back must not vanish)", JSON.stringify(d));
await p.goto(BASE + "/drawer"); d = await drawerText();
ok(!d.shown, "…but a read that fails with no earlier yes shows nothing — an unknown is not a yes", JSON.stringify(d));
W.maintStatus = 200; W.maint = { maintenance: false, canChange: null };
await p.goto(BASE + "/drawer"); d = await drawerText();
ok(!d.shown, "a server that could not tell (canChange:null) and no earlier yes → nothing", JSON.stringify(d));
W.profile = { ...MANAGER, role: "kitchen" }; W.maint = { maintenance: false, canChange: true };
await p.goto(BASE + "/drawer"); d = await drawerText();
ok(!d.shown, "the kitchen never sees it, whatever the server says");

// ── 3. the first-login card with no signal ───────────────────────────────────────────────────
console.log("\n3) First-login card — a save kept on the device lets the person carry on");
W.profile = { ...MANAGER, role: "tablet", needsProfile: true, name: "", phone: "" }; W.saves = [];
await p.goto(BASE + "/drawer-offline");
await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("lfh_outbox"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await p.reload();
const setupOpen = await until(() => p.evaluate(() => /Welcome/.test(document.body.innerText)), 10000);
ok(setupOpen, "the first-login card opens");
await p.evaluate(() => { window.__off = true; window.dispatchEvent(new Event("offline")); });
const inputs = await p.$$(".lfh-ov input, .lfh-overlay input, input.lfh-in, .lfh-sec input");
const fillable = [];
for (const i of inputs) if (await i.isVisible()) fillable.push(i);
if (fillable[0]) await fillable[0].fill("waiter1");
if (fillable[1]) await fillable[1].fill("9876543210");
await p.getByRole("button", { name: /Save & continue/ }).click();
await p.waitForTimeout(400);
const msg = await p.evaluate(() => document.body.innerText);
ok(/Saved on this device/.test(msg), "it says the details are kept on the device and will sync");
const moved = await until(() => p.evaluate(() => !/Welcome/i.test(document.body.innerText) && /your details/i.test(document.body.innerText)), 5000);
ok(moved, "…and then it becomes the everyday profile card — no longer stuck on setup");
await p.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "✕"); if (b) b.click(); });
await p.waitForTimeout(300);
ok(await p.evaluate(() => !/your details/i.test(document.body.innerText) && !/one more step/i.test(document.body.innerText)), "…and the ✕ now closes it (it used to answer 'One more step')");
ok(await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().queued.some((x) => /panel-profile/.test(x.path))), "the change is still in the queue, waiting to be sent");
ok(W.saves.length === 0, "…and nothing was sent while the device was offline");
await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("lfh_outbox"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));

// ── 4. My profile & pay wording ──────────────────────────────────────────────────────────────
console.log("\n4) My profile & pay — says what the number counts, and invites rather than scores");
for (const [filled, want] of [[0, "No details added yet"], [3, "3 of 8 key details added"], [8, "All 8 key details added"]]) {
  W.profile = { ...MANAGER, completeness: { filled, total: 8 } };
  await p.goto(BASE + "/drawer");
  await until(() => p.evaluate(() => !!window.LFH_ME), 5000);
  const t = await p.evaluate(async () => { await window.LFH_ME.open(); return document.getElementById("meBody").innerText; });
  ok(t.includes(want) && !/details filled/.test(t), `${filled} of 8 → "${want}"`, t.split("\n").slice(0, 6).join(" | "));
}

// ── 5. the A–Z sorts ─────────────────────────────────────────────────────────────────────────
console.log("\n5) Audit / Activity A–Z — a row with no name goes last");
const S = createRequire(import.meta.url)(join(ROOT, "public/panels/auditsort.js"));
const rows = [{ id: 1, actor: "", at: "2026-10-01" }, { id: 2, actor: "zed", at: "2026-10-01" }, { id: 3, actor: null, at: "2026-10-01" }, { id: 4, actor: "Amy", at: "2026-10-01" }, { id: 5, actor: "  ", at: "2026-10-01" }];
const order = (list, id, key) => { const c = list.find((x) => x.id === id).cmp; return rows.map((r) => ({ ...r, [key]: r.actor, created_at: r.at })).sort(c).map((r) => r.id).join(","); };
const amyZedThenBlanks = (s) => /^4,2,/.test(s) && s.split(",").slice(2).sort().join(",") === "1,3,5";
for (const [list, name] of [[S.SORTS || S.AUDIT_SORTS, "Audit"], [S.ACTIVITY_SORTS, "Activity"]]) {
  if (!list) { ok(false, `${name}: the sort list is exported`); continue; }
  for (const [id, key] of [["person", "actor"], ["restaurant", "restaurant_name"]].concat(name === "Activity" ? [["panel", "panel"]] : [])) {
    const got = order(list, id, key);
    ok(amyZedThenBlanks(got), `${name} → ${id} (A–Z): Amy, zed, then every blank (empty, missing, spaces)`, got);
  }
}

// ── 6. My profile & pay — saving twice (items 18 and 19, round 2) ────────────────────────────
console.log("\n6) My profile & pay — a save whose re-read fails, then a second save");
const ME6 = { staff: true, id: "u1", username: "w1", role: "tablet", name: "Asha", phone: "1111111111", profileModule: true, profile: {}, completeness: { filled: 1, total: 8 }, job: {} };
W.profile = null; W.saves = []; W.expects = [];
W.gets = [{ status: 200, body: ME6 }, { status: 200, body: ME6 }, { status: 503, body: {} }];
await p.goto(BASE + "/drawer"); await until(() => p.evaluate(() => !!window.LFH_ME), 5000);
await p.evaluate(() => window.LFH_ME.open()); await p.waitForSelector("#meForm", { timeout: 5000 });
await p.fill('input[name="phone"]', "2222222222"); await p.click(".me-save"); await p.waitForTimeout(800);
const after1 = await p.evaluate(() => ({ t: document.getElementById("meBody").innerText, b: (document.querySelector(".me-save") || {}).textContent, d: (document.querySelector(".me-save") || {}).disabled }));
ok(!/Couldn't load/.test(after1.t) && after1.b === "Saved ✓" && after1.d === false, "a save the server accepted, then a busy re-read: the form and 'Saved ✓' stay (never 'Couldn't load'), and Save works again", JSON.stringify({ b: after1.b, d: after1.d, t: after1.t.slice(0, 60) }));
if (after1.b === "Saved ✓") {
  await p.fill('input[name="email"]', "asha@example.invalid"); await p.click(".me-save"); await p.waitForTimeout(800);
  const phones = W.saves.map((x) => JSON.parse(x)).filter((x) => "phone" in x).length;
  ok(phones === 1, "…and the second save does not send the phone again from the old number (which the server would call someone else's change)", `${phones} phone write(s)`);
}
W.gets = null;
W.profile = ME6;
await p.goto(BASE + "/drawer-offline"); await until(() => p.evaluate(() => !!window.LFH_ME), 5000);
await p.evaluate(() => { window.__off = true; });
await p.evaluate(() => window.LFH_ME.open()); await p.waitForSelector("#meForm", { timeout: 5000 });
await p.fill('input[name="phone"]', "2222222222"); await p.click(".me-save"); await p.waitForTimeout(600);
await p.evaluate(() => { const o = [...document.querySelectorAll(".lfh-ov")].pop(); if (o) o.remove(); });
await p.fill('input[name="phone"]', "3333333333"); await p.click(".me-save"); await p.waitForTimeout(600);
const chain = await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().queued.filter((x) => x.body && "phone" in x.body).map((x) => x.expect.fields.phone + "→" + x.body.phone).join(", "));
ok(chain === "1111111111→2222222222, 2222222222→3333333333", "two saves kept on the device: each phone change is edited from the number this device last sent", chain);
await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("lfh_outbox"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));

// ── 7. Report an issue with no signal (item 20, round 2) ───────────────────────────────────
console.log("\n7) Report an issue — a photo attached, then Send with no signal");
await p.goto(BASE + "/issue-off");
await p.evaluate(() => { window.__sent = []; window.LFH_ISSUE.open({ api: async (m, path, b) => { window.__sent.push(b); return { ok: true, queued: true }; } }); });
await p.evaluate(async () => { const c = document.createElement("canvas"); c.width = 60; c.height = 60; const b = await new Promise((r) => c.toBlob(r, "image/png"));
  const dt = new DataTransfer(); dt.items.add(new File([b], "f.png", { type: "image/png" })); const i = document.getElementById("lfhirFile"); i.files = dt.files; i.dispatchEvent(new Event("change")); });
await until(() => p.evaluate(() => !!document.querySelector("#lfhirPrevs img")), 5000);
await p.evaluate(() => { window.__on = false; window.dispatchEvent(new Event("offline")); });
await p.fill("#lfhirSubj", "Fridge not cooling"); await p.click("#lfhirSend"); await p.waitForTimeout(300);
const off7 = await p.evaluate(() => ({ sent: window.__sent.length, img: !!document.querySelector("#lfhirPrevs img"), s: document.getElementById("lfhirStatus").textContent }));
ok(off7.sent === 0 && off7.img && /You're offline, so the photo can't go with it yet\. Remove it to save the ticket now/.test(off7.s), "the photo is NOT dropped: nothing is saved, it stays attached, and Send says why", JSON.stringify(off7));
if (off7.img && !off7.sent && await p.evaluate(() => !!document.getElementById("lfhirSend"))) {
  await p.evaluate(() => { window.__on = true; window.dispatchEvent(new Event("online")); }); W.uploads = [];
  await p.click("#lfhirSend"); await until(async () => W.uploads.length > 0, 8000); await p.waitForTimeout(300);
  const on7 = await p.evaluate(() => window.__sent[0] || null);
  ok(W.uploads.length === 1 && on7 && /^https:/.test(on7.image_url || ""), "…and back online, the same Send uploads it and the photo goes with the ticket", JSON.stringify({ up: W.uploads.length, t: on7 }));
} else ok(false, "…and back online, the same Send uploads it — not reached: the ticket had already gone without the photo");

ok(errs.length === 0, "no page threw while being driven", errs.join(" | "));
await covStop(p);
await browser.close(); server.close();
console.log(`\n${fail ? "❌" : "✅"} panel helpers driven: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
