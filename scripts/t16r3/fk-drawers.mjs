// Family K — SECOND PASS, AIMED BY COVERAGE: the three forms a person fills in — the ⚙ Settings drawer
// (maint.js), My profile & pay (myprofile.js) and Report an issue (issue-raise.js). The first pass had
// never run 174, 88 and 126 of their code lines. Every check types and taps like a person and reads
// the sentence that comes back; the server is the stand-in, so nothing is saved anywhere.
import { C, ok } from "./lib.mjs";
import { page, open, setApi, log, sleep, until } from "./server.mjs";

const ONLINE = "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});";
const PACE = "window.LFH_TEST_PACING={first:60,base:80,max:240,wake:0,stuck:60000,boot:150};";
const TOP = '<div class="topbar"><b>Panel</b><div class="top-actions"></div></div><main>Board</main>';
const ME = (o = {}) => ({ staff: true, id: "u1", name: "Asha Rao", username: "asha", phone: "9800000000", role: "manager", hasPin: true, canSelfReset: true, canSelfSetPin: true, needsProfile: false,
  profileModule: true, canSeeOwnPay: true, job: { designation: "Floor manager", shift_label: "Evening", weekly_off: ["monday"] }, profile: { notes: "" },
  pay: { pay_type: "monthly", pay_amount: 21000, pay_extras: [{ kind: "allowance", label: "Travel", amount: 1500 }, { kind: "deduction", label: "Meal", amount: 600 }] },
  payments: [{ amount: 21000, kind: "salary", paid_on: "2026-10-01", mode: "upi", for_period: "2026-09-01" }, { amount: 2000, kind: "advance", paid_on: "2026-09-12", mode: "cash", voided_at: "2026-09-13", void_reason: "entered twice" }],
  paySummary: { thisMonth: 21000, advanceOutstanding: 2000, lastPaidOn: "2026-10-01" }, completeness: { filled: 3, total: 9, selfFilled: 3, selfTotal: 8, missing: ["email"] }, ...o });   // the real shape (lib/staffProfileShared.ts completeness)
function api({ me = ME(), maint = { maintenance: false, canChange: true }, post = () => ({ status: 200, body: { ok: true } }), maintPost = (b) => ({ status: 200, body: { maintenance: b.on === true, canChange: true } }), meStatus = 200 } = {}) {
  return (r) => {
    if (r.path.startsWith("/api/panel-profile") && r.method === "GET") return typeof meStatus === "function" ? meStatus() : { status: meStatus, body: meStatus === 200 ? me : { error: "busy" } };
    if (r.path.startsWith("/api/panel-profile")) { let b = {}; try { b = JSON.parse(r.body || "{}"); } catch {} return post(b); }
    if (r.path.startsWith("/api/maintenance") && r.method === "GET") return typeof maint === "function" ? maint() : { status: 200, body: maint };
    if (r.path.startsWith("/api/maintenance")) { let b = {}; try { b = JSON.parse(r.body || "{}"); } catch {} return maintPost(b); }
    if (r.path.startsWith("/api/panel-logout")) return { status: 200, body: { ok: true } };
    return { status: 200, body: { ok: true } };
  };
}
const SP = page("k-maint", { pre: ONLINE + PACE, body: TOP, scripts: ["backstack.js", "outbox.js", "maint.js"] });
async function drawer(o, path = SP) {
  setApi(api(o));
  const h = await open(path); const p = h.page;
  await until(() => p.evaluate(() => !!document.getElementById("staffSettingsBtn")), 5000);
  if (!(o && o.me && o.me.needsProfile)) await p.click("#staffSettingsBtn");
  await sleep(400);
  return h;
}
const inDrawer = (p, sel) => p.locator(".lfh-ov").last().locator(sel);
const msgs = (p) => p.evaluate(() => [...document.querySelectorAll(".lfh-ov .lfh-msg")].map((m) => m.textContent.trim()).filter(Boolean));
const clickText = (p, re) => p.evaluate((re) => { const b = [...document.querySelectorAll(".lfh-ov button")].reverse().find((x) => new RegExp(re).test(x.textContent)); if (b) b.click(); return !!b; }, re);
const posts = (path) => log.filter((x) => x.method === "POST" && x.path.startsWith(path)).map((x) => { try { return JSON.parse(x.body); } catch { return x.body; } });

// ── the ⚙ Settings drawer ─────────────────────────────────────────────────────────────────────
C("K", "maint.js", "everyday drawer: the phone box carries no * — and saving it EMPTY is accepted, as the label promises (item 30); an empty username is refused in words and sends nothing", async () => {
  const h = await drawer(); const p = h.page;
  const star = await p.evaluate(() => [...document.querySelectorAll(".lfh-ov .lfh-lab")].map((l) => l.textContent.trim()));
  await inDrawer(p, 'input[placeholder="Your phone number"]').fill("");
  await clickText(p, "^Save details$"); await sleep(500);
  const m1 = await msgs(p), sent1 = posts("/api/panel-profile");
  await inDrawer(p, 'input[placeholder="Your username"]').fill("");
  await clickText(p, "^Save details$"); await sleep(400);
  const m2 = await msgs(p), sent2 = posts("/api/panel-profile").length;
  await h.close();
  return ok(star.some((t) => /^Phone$/.test(t)) && m1.includes("Saved.") && sent1.length === 1 && sent1[0].phone === "" && m2.some((m) => /Your username is required/.test(m)) && sent2 === 1, JSON.stringify({ star, m1, sent1, m2, sent2 }));
});
C("K", "maint.js", "first-login setup opens by itself with no ✕, needs BOTH name and phone and a 4–8 digit PIN for a manager who has none, then says 'All set — welcome aboard!' and the button becomes Profile", async () => {
  const h = await drawer({ me: ME({ needsProfile: true, hasPin: false, phone: "" }) }); const p = h.page;
  await until(() => p.evaluate(() => !!document.querySelector(".lfh-ov")), 4000);
  const r = {};
  r.noX = await p.evaluate(() => !document.querySelector(".lfh-ov .lfh-x"));
  r.welcome = await p.evaluate(() => (document.querySelector(".lfh-ov .lfh-h1") || {}).textContent);
  await clickText(p, "Save & continue"); await sleep(300); r.m1 = await msgs(p);
  await inDrawer(p, 'input[placeholder="Your phone number"]').fill("9811111111");
  await clickText(p, "Save & continue"); await sleep(300); r.m2 = await msgs(p);
  await inDrawer(p, 'input[placeholder="4–8 digit manager PIN"]').fill("12a4");
  await clickText(p, "Save & continue"); await sleep(300); r.m3 = await msgs(p);
  await inDrawer(p, 'input[placeholder="4–8 digit manager PIN"]').fill("4821");
  await clickText(p, "Save & continue"); await sleep(400); r.m4 = await msgs(p);
  r.sent = posts("/api/panel-profile");
  await sleep(900); r.btn = await p.evaluate(() => document.getElementById("staffSettingsBtn").textContent.trim());
  await h.close();
  return ok(r.noX && /Welcome, Asha Rao/.test(r.welcome) && r.m1.some((m) => /Both your username and phone are required/.test(m)) && r.m2.some((m) => /4–8 digit manager PIN/.test(m)) && r.m3.some((m) => /4–8 digit manager PIN/.test(m)) && r.m4.some((m) => /All set — welcome aboard/.test(m)) && r.sent.length === 1 && r.sent[0].pin === "4821" && /Profile/.test(r.btn), JSON.stringify(r));
});
C("K", "maint.js", "details saved with no signal: 'Saved on this device — it will sync when you're back online', and the change waits in the queue under a readable name", async () => {
  const h = await drawer(); const p = h.page;
  await p.evaluate(() => { window.__on = false; window.dispatchEvent(new Event("offline")); });
  await inDrawer(p, 'input[placeholder="Your username"]').fill("Asha R");
  await clickText(p, "^Save details$"); await sleep(500);
  const m = await msgs(p), q = await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().queued.map((x) => x.label));
  await h.close();
  return ok(m.some((x) => /Saved on this device — it will sync when you're back online/.test(x)) && q.length === 1 && /^Save your details$/i.test(q[0]), JSON.stringify({ m, q }));
});
C("K", "maint.js", "Change password: empty fields refused, no signal refused in words (nothing sent), the server's own refusal shown, success says it is signing you out and goes to the sign-in page", async () => {
  let answer = { status: 400, body: { error: "Your current password is wrong." } };
  const h = await drawer({ post: (b) => (b.newPassword ? answer : { status: 200, body: { ok: true } }) }); const p = h.page;
  const r = {};
  await clickText(p, "^Change password$"); await sleep(200); r.empty = await msgs(p);
  await inDrawer(p, 'input[placeholder="Current password"]').fill("old-one");
  await inDrawer(p, 'input[placeholder="New password (min 6)"]').fill("new-one-7");
  await p.evaluate(() => { window.__on = false; }); await clickText(p, "^Change password$"); await sleep(300); r.off = await msgs(p); r.sentOff = posts("/api/panel-profile").length; await p.evaluate(() => { window.__on = true; });
  await clickText(p, "^Change password$"); await sleep(400); r.wrong = await msgs(p);
  answer = { status: 200, body: { ok: true } };
  await clickText(p, "^Change password$"); await sleep(300); r.done = await msgs(p);
  await p.waitForURL(/\/login/, { timeout: 4000 }).catch(() => {}); r.url = p.url();
  await h.close();
  return ok(r.empty.some((x) => /Fill both fields/.test(x)) && r.off.some((x) => /offline — a password change needs a connection/.test(x)) && r.sentOff === 0 && r.wrong.some((x) => /current password is wrong/.test(x)) && r.done.some((x) => /signing you out/.test(x)) && /\/login$/.test(r.url), JSON.stringify(r));
});
C("K", "maint.js", "PIN: anything but 4–8 digits refused; a good one says 'PIN saved.'; a manager whose admin owns the PIN, and a person whose admin owns the password, see a note instead of a box", async () => {
  const h = await drawer(); const p = h.page;
  await inDrawer(p, 'input[placeholder="4–8 digit PIN"]').fill("12");
  await clickText(p, "^Change PIN$"); await sleep(200); const bad = await msgs(p);
  await inDrawer(p, 'input[placeholder="4–8 digit PIN"]').fill("90210");
  await clickText(p, "^Change PIN$"); await sleep(400); const good = await msgs(p);
  await h.close();
  const h2 = await drawer({ me: ME({ canSelfSetPin: false, canSelfReset: false }) }); const p2 = h2.page;
  const notes = await p2.evaluate(() => [...document.querySelectorAll(".lfh-ov .lfh-note")].map((n) => n.textContent));
  const boxes = await p2.evaluate(() => document.querySelectorAll('.lfh-ov input[type=password]').length);
  await h2.close();
  return ok(bad.some((x) => /PIN must be 4–8 digits/.test(x)) && good.some((x) => /PIN saved/.test(x)) && notes.some((n) => /admin manages your PIN/.test(n)) && notes.some((n) => /admin manages your password/.test(n)) && boxes === 0, JSON.stringify({ bad, good, notes, boxes }));
});
C("K", "maint.js", "Guest menu: hidden from a manager it was not handed to; for one it was — asks IN the panel first (Cancel changes nothing), then switches and says so on the button; a refusal says the menu has NOT changed; an unreadable state offers to check again", async () => {
  const r = {};
  let h = await drawer({ maint: { maintenance: false, canChange: false } }); let p = h.page; await sleep(300);
  r.hiddenForOther = await p.evaluate(() => { const s = [...document.querySelectorAll(".lfh-ov .lfh-sec")].find((x) => /Guest menu/.test(x.textContent)); return !s || s.hidden; });
  await h.close();
  let refuse = false;
  h = await drawer({ maintPost: (b) => (refuse ? { status: 403, body: { error: "Taking the menu down isn't switched on for you — ask your admin." } } : { status: 200, body: { maintenance: b.on === true, canChange: true } }) }); p = h.page; await sleep(400);
  r.btn0 = await p.evaluate(() => [...document.querySelectorAll(".lfh-ov button")].map((b) => b.textContent).find((t) => /guest menu|menu back/i.test(t)));
  await clickText(p, "Take guest menu offline"); await sleep(300);
  r.ask = await p.evaluate(() => { const d = [...document.querySelectorAll('.lfh-ov [role=dialog]')].pop(); return d && d.innerText.replace(/\s+/g, " "); });
  await clickText(p, "^Cancel$"); await sleep(300); r.afterCancel = posts("/api/maintenance").length;
  await clickText(p, "Take guest menu offline"); await sleep(300); await clickText(p, "^Take it offline$"); await sleep(500);
  r.sent = posts("/api/maintenance"); r.btn1 = await p.evaluate(() => [...document.querySelectorAll(".lfh-ov button")].map((b) => b.textContent).find((t) => /menu back|guest menu/i.test(t)));
  refuse = true; await clickText(p, "Bring menu back online"); await sleep(300); await clickText(p, "^Bring it back$"); await sleep(500);
  r.refused = await p.evaluate(() => { const d = [...document.querySelectorAll('.lfh-ov [role=dialog]')].pop(); return d && d.innerText.replace(/\s+/g, " "); });
  await h.close();
  h = await drawer({ maint: () => ({ status: 503, body: {} }) }); p = h.page; await sleep(500);
  r.unread = await p.evaluate(() => [...document.querySelectorAll(".lfh-ov button")].map((b) => b.textContent).find((t) => /Couldn't read the guest menu/.test(t)));
  await h.close();
  return ok(r.hiddenForOther && /Take guest menu offline/.test(r.btn0 || "") && /Take the guest menu offline\?/.test(r.ask || "") && r.afterCancel === 0 && r.sent.length === 1 && r.sent[0].on === true && /Bring menu back online/.test(r.btn1 || "") && /Nothing changed/.test(r.refused || "") && /has NOT changed/.test(r.refused || "") && /tap to check again/.test(r.unread || ""), JSON.stringify(r).slice(0, 1200));
});
C("K", "maint.js", "Sign out goes to the sign-in page — and still does within about 4 s when the server never answers", async () => {
  setApi((r) => (r.path.startsWith("/api/panel-logout") ? "hang" : api()(r)));
  const h = await open(SP); const p = h.page;
  await until(() => p.evaluate(() => !!document.getElementById("staffSettingsBtn")), 5000);
  await p.click("#staffSettingsBtn"); await sleep(300);
  const t0 = Date.now(); await clickText(p, "Sign out|Log out");
  await p.waitForURL(/\/login/, { timeout: 7000 }).catch(() => {});
  const secs = (Date.now() - t0) / 1000, url = p.url();
  await h.close();
  return ok(/\/login$/.test(url) && secs < 6.5, `${url} after ${secs.toFixed(1)}s`);
});
C("K", "maint.js", "LFH_ASK — the in-panel questions: confirm answers true/false (Back = No), say waits for OK, text keeps Save disabled until something is typed, Enter saves, Cancel and Back give null", async () => {
  setApi(api());
  const h = await open(SP); const p = h.page; await sleep(300);
  const r = await p.evaluate(async () => {
    const sl = (ms) => new Promise((x) => setTimeout(x, ms)); const A = window.LFH_ASK; const out = {};
    const tap = (re) => { const b = [...document.querySelectorAll(".lfh-ov button")].reverse().find((x) => re.test(x.textContent)); b && b.click(); };
    let pr = A.confirm("Close table 4?", { yes: "Close it" }); await sl(100); tap(/^Close it$/); out.yes = await pr;
    pr = A.confirm("Close table 4?"); await sl(100); tap(/^Cancel$/); out.no = await pr;
    pr = A.confirm("Close table 4?"); await sl(150); history.back(); await sl(400); out.back = await pr;
    pr = A.say("Saved."); await sl(100); tap(/^OK$/); out.say = await pr;
    pr = A.text("Why is this being voided?"); await sl(100);
    const go = [...document.querySelectorAll(".lfh-ov button")].reverse().find((x) => /^Save$/.test(x.textContent)); out.disabledEmpty = go.disabled;
    const inp = document.querySelector(".lfh-ov input.lfh-in"); inp.value = "  wrong table  "; inp.dispatchEvent(new Event("input")); out.enabledTyped = !go.disabled;
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); out.text = await pr;
    pr = A.text("Why?"); await sl(100); tap(/^Cancel$/); out.cancel = await pr;
    pr = A.text("Why?"); await sl(150); history.back(); await sl(400); out.textBack = await pr;
    out.left = document.querySelectorAll(".lfh-ov").length;
    return out;
  });
  await h.close();
  return ok(r.yes === true && r.no === false && r.back === false && r.say === true && r.disabledEmpty && r.enabledTyped && r.text === "wrong table" && r.cancel === null && r.textBack === null && r.left === 0, JSON.stringify(r));
});
C("K", "maint.js", "a busy server at start does not hide the Profile button for the shift: two 503s, then it appears by itself; signed out (staff:false) adds nothing; the kitchen (no profile at all) adds nothing", async () => {
  let n = 0; setApi(api({ meStatus: () => (++n <= 2 ? { status: 503, body: {} } : { status: 200, body: ME() }) }));
  let h = await open(SP); let p = h.page;
  const appeared = await until(() => p.evaluate(() => !!document.getElementById("staffSettingsBtn")), 8000);
  await h.close();
  setApi(api({ me: { staff: false } })); h = await open(SP); p = h.page; await sleep(900);
  const none = await p.evaluate(() => !document.getElementById("staffSettingsBtn")); await h.close();
  const KP = page("k-kitchen", { pre: ONLINE + PACE + "window.LFH_NO_PROFILE_AT_ALL=true;", body: TOP, scripts: ["backstack.js", "maint.js"] });
  setApi(api({ me: ME({ needsProfile: true, role: "kitchen" }) })); h = await open(KP); p = h.page; await sleep(900);
  const kitchen = await p.evaluate(() => !document.getElementById("staffSettingsBtn") && !document.querySelector(".lfh-ov")); await h.close();
  return ok(appeared && n >= 3 && none && kitchen, JSON.stringify({ appeared, reads: n, none, kitchen }));
});

// ── My profile & pay ──────────────────────────────────────────────────────────────────────────
const MP = page("k-me", { pre: ONLINE + PACE, body: TOP, scripts: ["backstack.js", "outbox.js", "maint.js", "myprofile.js"] });
const meText = (p) => p.evaluate(() => { const b = document.querySelector(".me-wrap"); return b ? b.innerText.replace(/\s+/g, " ") : null; });
C("K", "myprofile.js", "My profile & pay shows what the person is owed and was paid, in rupees and dates they can read — a cancelled payment struck through WITH its reason; the job the owner set; Back closes it", async () => {
  setApi(api());
  const h = await open(MP); const p = h.page; await sleep(300);
  await p.evaluate(() => window.LFH_ME.open()); await sleep(700);
  const t = await meText(p), strike = await p.evaluate(() => [...document.querySelectorAll(".me-row[style*=line-through]")].map((r) => r.innerText));
  await p.evaluate(() => history.back()); await sleep(400); const closed = await p.evaluate(() => !document.querySelector(".me-wrap"));
  await h.close();
  return ok(!/undefined|NaN|\[object/.test(t) && /3 of 9 key details added/.test(t) && /₹21,000 paid this month/.test(t) && /₹2,000 advance pending/.test(t) && /Travel · ₹1,500/.test(t) && /Meal · ₹600/.test(t) && /taken off every cycle/.test(t) && /Every payment \(2\)/i.test(t) && /for September 2026/.test(t) && strike.length === 1 && /cancelled: entered twice/.test(strike[0]) && /Floor manager/.test(t) && /Evening shift/.test(t) && /Weekly off: Monday/.test(t) && closed, (t || "").slice(0, 900));
});
C("K", "myprofile.js", "when it cannot load it says so and offers Try again (which works); signed out, or profiles not switched on for this restaurant, each get their own plain sentence", async () => {
  let n = 0; setApi(api({ meStatus: () => (++n === 1 ? { status: 503, body: {} } : { status: 200, body: ME() }) }));
  const P1 = page("k-me-alone", { pre: ONLINE, body: TOP, scripts: ["backstack.js", "myprofile.js"] });
  let h = await open(P1); let p = h.page;
  await p.evaluate(() => window.LFH_ME.open()); await sleep(600); const failed = await meText(p);
  await p.click("#meRetry"); await sleep(700); const after = await meText(p); await h.close();
  setApi(api({ me: { staff: false } })); h = await open(P1); p = h.page; await p.evaluate(() => window.LFH_ME.open()); await sleep(500); const out = await meText(p); await h.close();
  setApi(api({ me: ME({ profileModule: false }) })); h = await open(P1); p = h.page; await p.evaluate(() => window.LFH_ME.open()); await sleep(500); const off = await meText(p);
  const avail = await p.evaluate(() => window.LFH_ME.available()); await h.close();
  return ok(/Couldn't load your profile just now/.test(failed) && /paid this month/.test(after) && /not signed in as a staff member/.test(out) && /not switched on for this restaurant/.test(off) && avail === false, JSON.stringify({ failed: failed.slice(0, 120), after: after.slice(0, 80), out, off, avail }));
});
C("K", "myprofile.js", "saving my details: with no signal 'Saved here for now'; refused by the server 'Not saved' with its reason and the form kept; accepted 'Saved ✓'", async () => {
  let post = () => ({ status: 200, body: { ok: true } });
  setApi((r) => api({ post: (b) => post(b) })(r));
  const h = await open(MP); const p = h.page; await sleep(300);
  await p.evaluate(() => window.LFH_ME.open()); await sleep(600);
  const dialog = () => p.evaluate(() => { const d = [...document.querySelectorAll('.lfh-ov [role=dialog]')].pop(); const t = d && d.innerText.replace(/\s+/g, " "); const b = d && [...d.querySelectorAll("button")].pop(); b && b.click(); return t; });
  await p.evaluate(() => { window.__on = false; window.dispatchEvent(new Event("offline")); });
  await p.fill('#meForm input[name="phone"]', "9822222222"); await p.click("#meForm .me-save"); await sleep(600); const off = await dialog();
  await p.evaluate(() => { window.__on = true; }); post = () => ({ status: 400, body: { error: "That phone number is already used by someone else." } });
  await p.evaluate(() => window.LFH_OUTBOX.dismiss && window.LFH_OUTBOX.getSnapshot().queued.forEach((q) => window.LFH_OUTBOX.dismiss(q.id)));
  await p.fill('#meForm input[name="phone"]', "9833333333"); await p.click("#meForm .me-save"); await sleep(700); const no = await dialog();
  const kept = await p.evaluate(() => (document.querySelector('#meForm input[name="phone"]') || {}).value);
  post = () => ({ status: 200, body: { ok: true } });
  await p.click("#meForm .me-save"); await sleep(250); const btn = await p.evaluate(() => (document.querySelector("#meForm .me-save") || {}).textContent);
  await h.close();
  return ok(/Saved here for now/.test(off || "") && /Not saved/.test(no || "") && /already used by someone else/.test(no || "") && kept === "9833333333" && /Saved ✓|Save my details/.test(btn || ""), JSON.stringify({ off, no, kept, btn }));
});

// ── Report an issue ───────────────────────────────────────────────────────────────────────────
const IP = page("k-issue", { pre: ONLINE, scripts: ["backstack.js", "shrinkimg.js", "issue-raise.js"] });
async function issue(mediaAnswer) {
  setApi((r) => (r.path.startsWith("/api/issue-media") ? (typeof mediaAnswer === "function" ? mediaAnswer(r) : mediaAnswer) : { status: 200, body: { ok: true } }));
  const h = await open(IP); const p = h.page;
  await p.evaluate(() => { window.__tickets = []; window.LFH_ISSUE.open({ api: async (m, path, body) => { window.__tickets.push(body); return { ok: true }; } }); }); await sleep(200);
  await p.fill(".lfhir-ov input", "Printer jammed");
  return h;
}
const status = (p) => p.evaluate(() => (document.querySelector(".lfhir-status") || {}).textContent || "");
async function attach(p, { w = 800, h = 600, type = "image/png", bytes = null } = {}) {
  const buf = await p.evaluate(async ([w, h, type, bytes]) => {
    if (bytes) return Array.from(new Uint8Array(bytes).fill(7));
    const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.fillStyle = "#3a6"; x.fillRect(0, 0, w, h);
    const b = await new Promise((r) => c.toBlob(r, type)); return Array.from(new Uint8Array(await b.arrayBuffer()));
  }, [w, h, type, bytes]);
  await p.setInputFiles(".lfhir-ov input[type=file]", { name: "shot." + (type.split("/")[1] || "bin"), mimeType: type, buffer: Buffer.from(buf) });
  await sleep(500);
}
C("K", "issue-raise.js", "a photo is attached with a preview and a named Remove button, uploaded once, and its address goes in the ticket; Remove takes it off again", async () => {
  const h = await issue({ status: 200, body: { url: "https://x/media/1.webp" } }); const p = h.page;
  await attach(p);
  const prev = await p.evaluate(() => { const x = document.querySelector(".lfhir-prev"); return x && { text: x.innerText, rm: (x.querySelector(".x") || {}).getAttribute && x.querySelector(".x").getAttribute("aria-label"), btn: [...document.querySelectorAll(".lfhir-ov button")].map((b) => b.textContent.trim()).find((t) => /photo/i.test(t)) }; });
  await p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].find((b) => /^Send/.test(b.textContent.trim())).click()); await sleep(800);
  const r = await p.evaluate(() => window.__tickets);
  const uploads = log.filter((x) => x.path.startsWith("/api/issue-media")).length;
  await h.close();
  return ok(prev && /Photo attached/.test(prev.text) && prev.rm === "Remove photo" && /Remove photo/.test(prev.btn) && uploads === 1 && r.length === 1 && r[0].image_url === "https://x/media/1.webp", JSON.stringify({ prev, uploads, r }));
});
C("K", "issue-raise.js", "a file that is not a photo is refused in words; a photo the server will not take stops the ticket with a sentence naming the PHOTO (the ticket itself is not lost)", async () => {
  const h = await issue({ status: 500, body: { error: "Upload failed" } }); const p = h.page;
  await attach(p, { type: "application/pdf", bytes: 100 }); const notPhoto = await status(p);
  await attach(p);
  await p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].find((b) => /^Send/.test(b.textContent.trim())).click()); await sleep(900);
  const st = await status(p), tickets = await p.evaluate(() => window.__tickets.length), stillOpen = await p.evaluate(() => !!document.querySelector(".lfhir-ov"));
  await h.close();
  return ok(/must be a PNG, JPG or WEBP/.test(notPhoto) && /photo|Upload failed/i.test(st) && st.length > 10 && tickets === 0 && stillOpen, JSON.stringify({ notPhoto, st, tickets, stillOpen }));
});
C("K", "issue-raise.js", "a photo upload the server never answers is given up after 30 s with 'taking too long … remove it and send the ticket'", async () => {
  const h = await issue("hang"); const p = h.page;
  await attach(p);
  await p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].find((b) => /^Send/.test(b.textContent.trim())).click());
  await until(async () => /taking too long/.test(await status(p)), 34000, 500);
  const st = await status(p); await h.close();
  return ok(/photo is taking too long to upload/.test(st) && /Remove it and send the ticket/.test(st), st);
});
C("K", "issue-raise.js", "no microphone on the device (or permission refused): the voice note button says so in words instead of failing silently", async () => {
  const P2 = page("k-issue-nomic", { pre: ONLINE + "try{navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('denied','NotAllowedError'))}catch(e){}", scripts: ["backstack.js", "issue-raise.js"] });
  setApi(() => ({ status: 200, body: { ok: true } }));
  const h = await open(P2); const p = h.page;
  await p.evaluate(() => window.LFH_ISSUE.open({ api: async () => ({ ok: true }) })); await sleep(200);
  const rec = await p.evaluate(() => { const b = [...document.querySelectorAll(".lfhir-ov button")].find((x) => /voice note/i.test(x.textContent)); return b ? { disabled: b.disabled, title: b.title } : null; });
  if (rec && !rec.disabled) { await p.evaluate(() => [...document.querySelectorAll(".lfhir-ov button")].find((x) => /voice note/i.test(x.textContent)).click()); await sleep(400); }
  const st = await status(p); await h.close();
  return ok(rec && (rec.disabled ? /can't record audio/.test(rec.title) : /Couldn't use the microphone — allow mic access/.test(st)), JSON.stringify({ rec, st }));
});
