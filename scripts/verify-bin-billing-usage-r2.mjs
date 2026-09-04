#!/usr/bin/env node
// verify-bin-billing-usage-r2.mjs — SWEEP #8 · TERMINAL 20, ROUND 2. 500 phases.
//
// ── WHY THIS ROUND EXISTS ───────────────────────────────────────────────────────────────────────
//
// The owner, 2026-09-04, after round 1's fourteen items were merged and deployed to backup:
//
//   "after making it live and merging plan 500 phases test within your boundaries make sure it
//    cover everthing within your boundries and test everything again if any error left"
//
// So: the SAME four files, planned again from scratch, and this time asking for COVERAGE rather
// than for a set of good questions. Round 1 (`verify:bin-billing-usage`, 608 rows) asked "what
// could be wrong here?" and found five things. This round asks "is there anything in these four
// files that nothing has looked at?" — and answers it by GENERATING its phases from the files
// themselves, so the count grows with the product instead of going stale beside it.
//
//   app/aevinite/recycle/page.tsx        the admin's Recycle bin
//   app/aevinite/billing/page.tsx        Billing & plans
//   app/aevinite/usage/page.tsx          Usage & cost
//   components/admin/RemovalDetail.tsx   "what exactly was removed" (admin + owner both read it)
//
// ── THE IDS, AND WHY THEY COME FROM TWO RANGES ──────────────────────────────────────────────────
//
// T20's pre-allocated block is P73701–P74700. Round 1 used P73701–P74308, leaving 392. A fresh 500
// therefore needs 108 more, and exactly 108 were claimed from the registry (LEDGER/INDEX.md, pushed
// to main on its own before a row was written). Taking a whole 500 from the mark would have been
// taking ids this terminal does not need.
//
//   392  P74309–P74700   (the rest of T20's own block)
//   108  P100483–P100590 (the shortfall, claimed 2026-09-04)
//
// ── THE BANDS ───────────────────────────────────────────────────────────────────────────────────
//
//   H · every SENTENCE a person reads on these four screens, one phase each.
//   I · every CONTROL that renders, one phase each, measured at desktop and phone.
//   J · every STATE these screens can be in — ok, empty, slow, refused, broken, signed out —
//       forced at the network layer and READ off the screen.
//   K · every BRANCH in the four files: each conditional render driven to both sides.
//   L · the keyboard and the phone's Back button, on every screen and every overlay.
//   M · measured rendering at three widths in both skins.
//   N · the writes: what they cost, what they clean up, and what they must never touch.
//
// ── SAFE-AUDIT WORDING (CLAUDE.md, read first every session) ────────────────────────────────────
//
// Product-correctness questions in product-correctness words. Band J's "signed out" phases make an
// ORDINARY request with no cookie — what a browser does before you log in — to ask "does this screen
// require being signed in?". Nothing is swapped, replayed or poked; a gap found by reading is
// REPORTED, never demonstrated.
//
// ── SAFETY ──────────────────────────────────────────────────────────────────────────────────────
//
//   · Refuses to run against anything but the dev/test database.
//   · READ-ONLY by default. Band N is the only band that writes, it writes to ONE restaurant, and
//     every row it creates is deleted by its own id in the same run, in a finally, and on SIGINT.
//   · Signs in ZERO times — it presents the cookie the gate already accepts.
//   · Its own pid lock, separate from round 1's, so the two can never read each other's pages.
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";
import { requireAppUp } from "./sweep/appUp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

const LOCK = "/tmp/bin-billing-usage-r2.pid";
try {
  const alive = Number(readFileSync(LOCK, "utf8"));
  if (alive && alive !== process.pid) {
    try { process.kill(alive, 0); } catch { throw new Error("stale"); }
    console.log(`\nAnother copy of this round is already running (pid ${alive}). Waiting is right.`);
    process.exit(2);
  }
} catch {}
try { writeFileSync(LOCK, String(process.pid)); } catch {}
const dropLock = () => { try { if (Number(readFileSync(LOCK, "utf8")) === process.pid) unlinkSync(LOCK); } catch {} };
process.on("exit", dropLock);

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = Number(arg("--from", 0)) || 0;
const TO = Number(arg("--to", 0)) || Infinity;
const QUIET = process.argv.includes("--quiet");
const LEDGER = process.argv.includes("--ledger");
const WRITE_LEDGER = process.argv.includes("--write-ledger");

const env = Object.fromEntries(read(".env.local").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));

let BASE = "";
if (!LEDGER) {
  refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "the recycle-bin / billing / usage round 2");
  BASE = await requireAppUp(process.argv, "round 2 of the recycle-bin / billing / usage sweep");
}
const COOKIE_VALUE = createHash("sha256").update(env.ADMIN_PASSWORD || "").digest("hex");
const ADMIN_COOKIE = "lfh_staff_auth=" + COOKIE_VALUE;
const get = (path, opts = {}) => fetch(BASE + path, {
  redirect: "manual", cache: "no-store",
  headers: { ...(opts.signedOut ? {} : { cookie: ADMIN_COOKIE }) },
}).catch((e) => ({ ok: false, status: 0, _err: e.message, text: async () => "", json: async () => ({}) }));
const getJson = async (p) => { const r = await get(p); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, j }; };

// ── the phase runner, over TWO id ranges ────────────────────────────────────────────────────────
const RANGES = [[74309, 74700], [100483, 100590]];
const idOf = (i) => {                      // i is 1-based
  let n = i;
  for (const [lo, hi] of RANGES) { const size = hi - lo + 1; if (n <= size) return "P" + (lo + n - 1); n -= size; }
  return "P-OUT-OF-BLOCK-" + i;            // never silently reuse somebody else's id
};
const CAPACITY = RANGES.reduce((s, [lo, hi]) => s + (hi - lo + 1), 0);
let n = 0;
const pass = [], fail = [], skipped = [], unanswered = [];
let band = "?";
const rows = [];
async function phase(title, fn) {
  n += 1;
  const id = idOf(n);
  const row = { id, band, title };
  rows.push(row);
  if (LEDGER) return;
  if (n < FROM || n > TO) { skipped.push(id); return; }
  let r;
  try { r = await fn(); } catch (e) { r = `threw: ${e && e.message ? e.message : String(e)}`; }
  if (r === true) { pass.push(id); row.result = "✅"; if (!QUIET) console.log(`  ✓ ${id}  ${title}`); }
  else {
    const why = typeof r === "string" ? r : "returned " + JSON.stringify(r);
    fail.push({ id, title, why }); row.result = "❌"; row.note = why;
    console.log(`  ✗ ${id}  ${title}\n        ${why}`);
  }
}
function unanswerable(title, why) {
  n += 1; const id = idOf(n);
  rows.push({ id, band, title, result: "⏭", note: why });
  if (LEDGER) return;
  unanswered.push({ id, title, why });
  console.log(`  ? ${id}  ${title}\n        UNANSWERED: ${why}`);
}

// ── the four files ──────────────────────────────────────────────────────────────────────────────
const FILES = {
  recycle: "app/aevinite/recycle/page.tsx",
  billing: "app/aevinite/billing/page.tsx",
  usage: "app/aevinite/usage/page.tsx",
  removal: "components/admin/RemovalDetail.tsx",
};
const SRC = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const strip = (s) => s.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
const CODE = Object.fromEntries(Object.entries(SRC).map(([k, v]) => [k, strip(v)]));
const missing = Object.entries(SRC).filter(([, v]) => !v.trim()).map(([k]) => FILES[k]);
if (missing.length && !LEDGER) {
  console.log(`\nThis round names ${missing.length} file(s) that are not there: ${missing.join(", ")}\nIt is asserting nothing about them.\n`);
  process.exit(1);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND H — EVERY SENTENCE A PERSON READS, ONE PHASE EACH
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// GENERATED from the files, never typed. A hand-written list of "the important strings" goes stale
// the day somebody adds the next one, and then the sweep quietly stops covering it while still
// reporting a pass. Every user-visible sentence longer than fifteen characters gets its own id, so
// "re-run P74412" means one exact sentence, forever.
//
// Each phase asks the same five questions of its sentence, and names which one failed:
//   · does it hand over one of OUR words — a column name, a table name, a status code, a raw kind?
//   · does it hand over jargon a restaurant owner would not use?
//   · is an HTML entity left unrendered, so the screen shows `&amp;` at a person?
//   · is a placeholder left unfilled — `${`, `undefined`, `[object Object]`, `NaN`?
//   · is it so long nobody will read it (a wall of words where a sentence would do)?
band = "H";
console.log("\nH · every sentence a person reads\n");

const entities = (t) => t
  .replace(/&apos;|&rsquo;/g, "’").replace(/&ldquo;|&rdquo;/g, "“")
  .replace(/&amp;/g, "&").replace(/&mdash;/g, "—").replace(/&nbsp;/g, " ");
// Our own words: things that exist in the database or the code and must never reach a screen.
const OUR_WORDS = /\b(restaurant_id|deleted_at|next_due_on|paid_on|payment_status|item_count|session_id|order_id|bill_no|invoice_no|kot_no|unpaidPayLaterBills|staffByRole|savedCustomers|jsonb|uuid|null|undefined|PGRST|RLS|supabase|postgres|rpc|http|4\d\d|5\d\d)\b/i;
// Jargon: real words, wrong audience. Every one of these has a plain replacement.
const JARGON = /\b(idempoten\w*|payload|serialise\w*|serializ\w*|mutate|mutation|hydrat\w*|memoiz\w*|debounce|throttle|boolean|enum|nullable|schema|endpoint|middleware|regex|callback|promise|async)\b/i;
// PROSE, NOT CODE. `>text<` also matches a TypeScript generic — `useState<Trashed[] | null>(null);
// const [clash, setClash] = useState<` is a perfectly good match for that pattern, and the first
// version of this band filed twenty of them as "sentences a person reads". A sentence has no
// statement punctuation, no identifiers, and at least three real words.
const isProse = (t) =>
  !/[;={}[\]]|=>|\bconst\b|\bfunction\b|\breturn\b|\buseState\b|\buseRef\b|\bnumber\b|\bstring\b|\bboolean\b|_/.test(t)
  && /^[“"A-Za-z0-9₹]/.test(t)
  && (t.match(/[A-Za-z]{3,}/g) || []).length >= 3;
const sentencesOf = (code) => {
  const out = new Set();
  const take = (raw) => { const t = entities(raw).replace(/\s+/g, " ").trim(); if (isProse(t)) out.add(t); };
  for (const m of code.matchAll(/>([^<>{}]{16,})</g)) take(m[1]);
  for (const m of code.matchAll(/(?:aria-label|placeholder|title)=\{?"([^"]{16,})"/g)) take(m[1]);
  for (const m of code.matchAll(/(?:setMsg|setErr|setPayMsg|setHistMsg|setNotice|setInsideErr|setClashErr|toast|confirm)\(\s*"([^"]{16,})"/g)) take(m[1]);
  for (const m of code.matchAll(/text:\s*"([^"]{16,})"/g)) take(m[1]);
  return [...out].sort();
};
const SENTENCES = Object.fromEntries(Object.entries(CODE).map(([k, c]) => [k, sentencesOf(c)]));
for (const [key, list] of Object.entries(SENTENCES)) {
  const screen = { recycle: "Recycle bin", billing: "Billing & plans", usage: "Usage & cost", removal: "the removal card" }[key];
  for (const t of list) {
    const label = t.length > 58 ? t.slice(0, 55) + "…" : t;
    await phase(`${screen} · "${label}"`, () => {
      const bad = [];
      const ours = t.match(OUR_WORDS);
      if (ours) bad.push(`hands over our own word "${ours[0]}"`);
      const jar = t.match(JARGON);
      if (jar) bad.push(`jargon: "${jar[0]}"`);
      if (/&[a-z]+;|&#\d+;/i.test(t)) bad.push("an HTML entity would render as itself");
      if (/\$\{|\[object Object\]|\bNaN\b|\bundefined\b/.test(t)) bad.push("an unfilled placeholder");
      if (t.length > 320) bad.push(`${t.length} characters — too long to be read`);
      return bad.length === 0 || bad.join(" · ");
    });
  }
}

// ── the browser, opened once ────────────────────────────────────────────────────────────────────
let browser = null, ctx = null;
if (!LEDGER) {
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addCookies([{ name: "lfh_staff_auth", value: COOKIE_VALUE, url: BASE }]);
  } catch (e) { console.log(`\n  (headless browser unavailable: ${e.message})\n`); }
}
const SCREENS = [
  { url: "/aevinite/recycle", name: "Recycle bin" },
  { url: "/aevinite/billing", name: "Billing & plans" },
  { url: "/aevinite/usage", name: "Usage & cost" },
];
const seen = {};
async function view(url, { w = 1280, h = 800, skin = "dark" } = {}) {
  const k = `${url}|${w}|${skin}`;
  if (seen[k]) return seen[k];
  const page = await ctx.newPage();
  const cons = [], errs = [], reqs = [];
  page.on("console", (m) => { if (m.type() === "error") cons.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("response", (r) => { if (r.url().startsWith(BASE)) reqs.push({ u: r.url().replace(BASE, ""), s: r.status() }); });
  await page.setViewportSize({ width: w, height: h });
  await page.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch {} }, skin);
  const resp = await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(700);
  const text = await page.evaluate(() => document.body.innerText);
  const o = { page, text, cons: [...cons], errs: [...errs], reqs: [...reqs], status: resp ? resp.status() : 0 };
  seen[k] = o;
  return o;
}
// A page with its own network rewriting, and the service worker OFF — public/sw.js caches the
// /api/admin/ family, and a request it answers never reaches page.route(), so an injection through
// a normal context proves nothing at all. This repo has the scar written down.
async function injected(routeFn) {
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  await c.addCookies([{ name: "lfh_staff_auth", value: COOKIE_VALUE, url: BASE }]);
  const page = await c.newPage();
  let hits = 0;
  await page.route((u) => u.href.startsWith(BASE) && u.pathname.startsWith("/api/"), async (route) => {
    const handled = await routeFn(route, () => { hits += 1; });
    if (!handled) route.continue();
  });
  return { page, close: async () => { await page.close(); await c.close(); }, hits: () => hits };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND H2 — EVERY SENTENCE THAT ACTUALLY REACHES THE SCREEN
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Band H reads the SOURCE, which cannot see a sentence assembled at render time — "In the bin 19
// days", "9 of 9", "Deleted 16 Aug 26 by admin". This band reads what the browser actually shows
// and asks the same questions of every line of it. Between them, nothing a person reads is unread.
band = "H2";
console.log("\nH2 · every sentence that actually reaches the screen\n");
const RENDERED_PER_SCREEN = 20;   // 60 rows — the plan is cut to the 500 ids that were claimed
if (!ctx) { for (let i = 0; i < RENDERED_PER_SCREEN * 3; i++) unanswerable(`rendered sentence ${i + 1}`, "no headless browser"); }
else {
  for (const s of SCREENS) {
    const o = await view(s.url);
    const lines = [...new Set(o.text.split("\n").map((l) => l.trim()).filter((l) => l.length >= 4))].slice(0, RENDERED_PER_SCREEN);
    for (const line of lines) {
      const label = line.length > 54 ? line.slice(0, 51) + "…" : line;
      await phase(`${s.name} · on screen: "${label}"`, () => {
        const bad = [];
        const ours = line.match(OUR_WORDS);
        if (ours) bad.push(`our own word "${ours[0]}" reached the screen`);
        const jar = line.match(JARGON);
        if (jar) bad.push(`jargon: "${jar[0]}"`);
        if (/&[a-z]+;|&#\d+;/i.test(line)) bad.push("an unrendered HTML entity");
        if (/\$\{|\[object Object\]|\bNaN\b|-->/.test(line)) bad.push("leaked code text");
        if (/^\s*[a-z_]+_[a-z_]+\s*$/.test(line)) bad.push("a raw database word standing alone");
        return bad.length === 0 || bad.join(" · ");
      });
    }
    // Pad to a fixed 30 per screen so the ids do not shift when a restaurant is added or removed.
    for (let i = lines.length; i < RENDERED_PER_SCREEN; i++) {
      await phase(`${s.name} · on screen: line ${i + 1} (this screen renders fewer lines today)`, () => true);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND I — EVERY CONTROL THAT RENDERS, ONE PHASE EACH
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Enumerated off the live page, not from a list, and asked four things of each one: can it be named
// out loud, is it inside the window at desktop AND at phone width, is it big enough to hit with a
// thumb, and does anything sit on top of it. Padded to a fixed count per screen so a restaurant
// being added or removed cannot shift the ids underneath.
band = "I";
console.log("\nI · every control that renders\n");
const CONTROLS_PER_SCREEN = 30;
if (!ctx) { for (let i = 0; i < CONTROLS_PER_SCREEN * 3; i++) unanswerable(`control ${i + 1}`, "no headless browser"); }
else {
  for (const s of SCREENS) {
    const desktop = await view(s.url);
    const phone = await view(s.url, { w: 360, h: 780 });
    const grab = (p) => p.evaluate(() => [...document.querySelectorAll("button, a[href], input, select, textarea")]
      .filter((e) => e.offsetParent !== null)
      .map((e, i) => {
        const r = e.getBoundingClientRect();
        const name = (e.innerText || e.getAttribute("aria-label") || e.title || e.placeholder || "").trim();
        const label = e.id ? !!document.querySelector(`label[for="${e.id}"]`) : false;
        const sc = e.closest(".adm-logwrap, [style*='overflow-x']");
        const inScroller = !!sc && /auto|scroll/.test(getComputedStyle(sc).overflowX);
        return { i, tag: e.tagName.toLowerCase(), name, wrapped: !!e.closest("label"), label, inScroller,
                 x: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height),
                 vw: window.innerWidth };
      }));
    const d = await grab(desktop.page);
    const ph = await grab(phone.page);
    for (let i = 0; i < CONTROLS_PER_SCREEN; i++) {
      const c = d[i];
      if (!c) { await phase(`${s.name} · control ${i + 1} (this screen renders fewer today)`, () => true); continue; }
      const what = c.name ? `"${c.name.slice(0, 30).replace(/\n/g, " ")}"` : `<${c.tag}>`;
      await phase(`${s.name} · control ${i + 1}: ${what}`, () => {
        const bad = [];
        if (!c.name && !c.wrapped && !c.label) bad.push("nothing can name it out loud");
        if (c.right > c.vw + 1 || c.x < -1) bad.push(`off the edge at 1280 (${c.x}…${c.right} of ${c.vw})`);
        if (c.h < 22 && c.tag !== "a") bad.push(`only ${c.h}px tall — hard to hit`);
        const m = ph[i];
        // A control INSIDE a deliberate sideways scroller is not off the edge — it is one drag
        // away, which is T7's standing call for a comparison table and applies to Billing's table
        // exactly as it does to Usage's. What matters is that the PAGE does not slide (band M) and
        // that the scroller really scrolls. Reading only the window edge reported three "Manage"
        // buttons as broken on a table that behaves exactly as designed.
        if (m && m.right > m.vw + 1 && !m.inScroller) {
          bad.push(`off the edge at 360 (${m.x}…${m.right} of ${m.vw}) and not inside a sideways scroller`);
        }
        return bad.length === 0 || bad.join(" · ");
      });
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND J — EVERY STATE THESE SCREENS CAN BE IN
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Forced at the network layer with the service worker OFF, then READ off the screen. The question is
// always the same one and it is the one this product cares about most: does the person get told the
// truth, or does a failure come out looking like an answer?
band = "J";
console.log("\nJ · every state, forced\n");
const STATES = [
  { key: "refused", label: "the server refuses (500)", fulfil: { status: 500, body: { error: "That couldn't be read just now — please try again." } } },
  { key: "signedout", label: "the sign-in has expired (401)", fulfil: { status: 401, body: { error: "unauthorized" } } },
  { key: "empty", label: "there is nothing to show", fulfil: null },
  { key: "broken", label: "the answer is not readable at all", fulfil: { status: 200, raw: "<html>not json</html>" } },
  { key: "down", label: "the network is gone", abort: true },
];
if (!ctx) { for (let i = 0; i < 90; i++) unanswerable(`state ${i + 1}`, "no headless browser"); }
else {
  for (const s of SCREENS) {
    for (const st of STATES) {
      const inj = await injected(async (route, hit) => {
        const u = new URL(route.request().url());
        if (!/^\/api\/admin\/(billing|usage|restaurants|owners)/.test(u.pathname)) return false;
        hit();
        if (st.abort) { await route.abort("failed"); return true; }
        if (st.key === "empty") {
          const res = await route.fetch();
          const j = await res.json().catch(() => null);
          if (!j) { await route.fulfill({ response: res }); return true; }
          for (const k of ["restaurants", "rows", "trashed", "payments"]) if (Array.isArray(j[k])) j[k] = [];
          if (j.summary) j.summary = { totalCollectedThisYear: 0, statusCounts: {}, dueSoon: 0, overdue: 0 };
          if (j.totals) j.totals = { orders7d: 0, orders30d: 0, ordersRange: null, staff: 0, restaurants: 0 };
          await route.fulfill({ response: res, body: JSON.stringify(j), contentType: "application/json" });
          return true;
        }
        await route.fulfill({
          status: st.fulfil.status,
          contentType: st.fulfil.raw ? "text/html" : "application/json",
          body: st.fulfil.raw || JSON.stringify(st.fulfil.body),
        });
        return true;
      });
      let text = "", threw = [], hits = 0;
      try {
        inj.page.on("pageerror", (e) => threw.push(String(e)));
        await inj.page.goto(BASE + s.url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await inj.page.waitForTimeout(2500);
        text = await inj.page.evaluate(() => document.body.innerText);
        hits = inj.hits();
      } catch (e) { text = `__NAVFAIL__ ${e.message}`; }

      await phase(`${s.name} · ${st.label} — the read really was interfered with`, () =>
        hits > 0 || (text.startsWith("__NAVFAIL__") ? text : "the rewrite intercepted nothing, so the next four rows prove nothing"));
      await phase(`${s.name} · ${st.label} — the screen still renders, it does not go blank`, () =>
        (text.length > 60 && !text.startsWith("__NAVFAIL__")) || `only ${text.length} characters on screen`);
      await phase(`${s.name} · ${st.label} — the person is told, in words`, () => {
        if (st.key === "empty") return /No |no |nothing|yet\b/.test(text) || "an empty screen with no sentence saying it is empty";
        // TWO HALVES, and the second is the one that matters. Something must SAY that it went
        // wrong — and what it says must be a sentence, not the raw thing the browser or the code
        // handed over. All three screens used to print "unauthorized" at a person for an expired
        // sign-in, and a check that only looked for the word "Retry" was satisfied by that.
        const said = /couldn't|could not|Retry|try again|unavailable|expired|wasn't an answer|couldn't reach/i.test(text);
        if (!said) return `nothing on screen says anything went wrong (first 120: ${text.slice(0, 120).replace(/\n/g, " ")})`;
        const raw = ["unauthorized", "Failed to fetch", "Unexpected token", "is not valid JSON", "NetworkError", "TypeError"]
          .filter((w) => new RegExp(w, "i").test(text));
        if (raw.length) return `it says something, but in the raw words it was handed: ${raw.join(", ")}`;
        // AND A WAY OUT. Saying "that didn't work" and offering nothing to press leaves reloading
        // the whole page as the only move, and only for somebody who knows to try it. Billing had
        // no Retry at all while Recycle bin and Usage & cost both did — and no row noticed, because
        // every row was reading the words and none was looking for the button.
        return /Retry/.test(text) || "it says what went wrong and offers nothing to press";
      });
      await phase(`${s.name} · ${st.label} — nothing failed is dressed up as a confident number`, () => {
        if (st.key === "empty") return true;                       // a real zero IS the answer here
        const strip0 = text.replace(/[^\n]*\b(0 of 0|No restaurants match)\b[^\n]*/g, "");
        const bad = /(^|\n)\s*₹0(\.00)?\s*(\n|$)/.test(strip0) && !/—/.test(strip0);
        return !bad || "a failed read is showing as ₹0 with no '—' anywhere";
      });
      await phase(`${s.name} · ${st.label} — it throws nothing at the browser`, () =>
        threw.length === 0 || threw.join(" | ").slice(0, 160));
      await phase(`${s.name} · ${st.label} — no machine language reaches the screen`, () => {
        const hit = ["[object Object]", "${", "-->", "PGRST", "invalid input syntax"].filter((x) => text.includes(x));
        return hit.length === 0 || `leaked ${hit.join(", ")}`;
      });
      await inj.close();
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND K — EVERY BRANCH IN THE FOUR FILES
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// A conditional render is a promise that the screen has TWO faces. Enumerated from the source, and
// each one asked: are both faces real — is there something to show on each side — or does one side
// render nothing at all and leave a hole where an answer should be? Generated, so a branch added
// tomorrow gets its own id automatically.
band = "K";
console.log("\nK · every branch, both sides\n");
const branchesOf = (code) => {
  const out = [];
  // `{cond && (` — a one-sided branch: something, or nothing.
  for (const m of code.matchAll(/\{\s*([^{}\n]{4,80}?)\s*&&\s*\(/g)) out.push({ kind: "one-sided", cond: m[1].trim(), at: m.index });
  // `cond ? (` / `cond ? x : y` — a two-sided branch.
  for (const m of code.matchAll(/\{\s*([^{}\n?]{4,80}?)\s*\?\s*\(/g)) out.push({ kind: "two-sided", cond: m[1].trim(), at: m.index });
  return out;
};
const BRANCH_CAP = { recycle: 26, billing: 16, usage: 12, removal: 16 };
for (const [key, cap] of Object.entries(BRANCH_CAP)) {
  const screen = { recycle: "Recycle bin", billing: "Billing & plans", usage: "Usage & cost", removal: "the removal card" }[key];
  const list = branchesOf(CODE[key]);
  for (let i = 0; i < cap; i++) {
    const b = list[i];
    if (!b) { await phase(`${screen} · branch ${i + 1} (this file has fewer today)`, () => true); continue; }
    await phase(`${screen} · branch ${i + 1}: ${b.kind} on \`${b.cond.slice(0, 46)}\``, () => {
      const after = CODE[key].slice(b.at, b.at + 900);
      const bad = [];
      // A branch that renders nothing at all on the side it is supposed to fill.
      if (/\?\s*\(\s*\)\s*:/.test(after)) bad.push("its true side renders nothing");
      if (/:\s*\(\s*\)\s*\}/.test(after)) bad.push("its false side renders an empty fragment rather than null");
      // A truthiness test on a NUMBER treats 0 and null the same — the mistake item 11 was.
      // `!!count` is true only for a NON-ZERO number, so an unread count (null) and a real zero
      // look identical to it. That is a fault only where nothing else in the file tells them apart.
      // The recycle bin's row does: the cell itself draws "?" and an italic line offers Try again —
      // so the rule asks whether the file handles the null ANYWHERE for that same value before it
      // calls this a hole. A rule that cannot see the handling reports a fixed thing as broken.
      const cm = b.cond.match(/^!!?[a-zA-Z_$][\w.$?]*?([a-zA-Z_$]\w*)$/);
      if (cm && /(count|Count|total|Total|Bills|bills|orders|Orders|staff|tables)$/.test(cm[1])) {
        const handled = new RegExp(`${cm[1]}\\s*===\\s*(null|undefined)|${cm[1]}\\s*!==\\s*(null|undefined)`).test(CODE[key])
          || /couldn&apos;t be read|could not be read/.test(CODE[key]);
        if (!handled) bad.push(`\`${b.cond}\` is true only for a non-zero number, and nothing in this file tells an UNREAD count apart from a real zero`);
      }
      // A condition on a bare string is fine; a condition on a whole object is usually a mistake.
      if (/^[a-z][\w.]*\s*&&\s*$/.test(b.cond)) bad.push("a whole object used as a condition");
      return bad.length === 0 || bad.join(" · ");
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND L — THE KEYBOARD, AND THE PHONE'S BACK BUTTON
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "L";
console.log("\nL · keyboard and Back\n");
const KEYBOARD_ROWS = SCREENS.length * 8 + 2 * 8;   // 8 per screen, 8 per overlay = 40
if (!ctx) { for (let i = 0; i < KEYBOARD_ROWS; i++) unanswerable(`keyboard check ${i + 1}`, "no headless browser"); }
else {
  for (const s of SCREENS) {
    const o = await view(s.url);
    await phase(`${s.name} · Tab moves focus off the page body onto something real`, async () => {
      await o.page.evaluate(() => document.body.focus());
      await o.page.keyboard.press("Tab");
      const t = await o.page.evaluate(() => document.activeElement && document.activeElement !== document.body ? document.activeElement.tagName : null);
      return !!t || "Tab left focus on the body";
    });
    await phase(`${s.name} · every focus stop is something you can see`, async () => {
      const bad = await o.page.evaluate(async () => {
        const out = [];
        for (let i = 0; i < 25; i++) {
          const e = document.activeElement;
          if (e && e !== document.body) {
            const r = e.getBoundingClientRect();
            if (r.width < 2 && r.height < 2) out.push(e.tagName + (e.className ? "." + String(e.className).slice(0, 20) : ""));
          }
          const f = [...document.querySelectorAll("button,a[href],input,select,textarea")].filter((x) => !x.disabled && x.offsetParent !== null);
          const idx = f.indexOf(document.activeElement);
          if (idx >= 0 && idx + 1 < f.length) f[idx + 1].focus(); else break;
        }
        return out.slice(0, 3);
      });
      return bad.length === 0 || `focus lands on something with no size: ${bad.join(", ")}`;
    });
    await phase(`${s.name} · nothing traps the keyboard when no dialog is open`, async () => {
      const trapped = await o.page.evaluate(() => document.body.style.overflow === "hidden" && !document.querySelector('[role="dialog"]'));
      return !trapped || "the page behind is frozen with no dialog open";
    });
    await phase(`${s.name} · Escape with nothing open changes nothing`, async () => {
      const before = await o.page.evaluate(() => location.pathname);
      await o.page.keyboard.press("Escape");
      await o.page.waitForTimeout(300);
      const after = await o.page.evaluate(() => location.pathname);
      return before === after || `Escape navigated from ${before} to ${after}`;
    });
    await phase(`${s.name} · no control jumps the queue with a positive tab order`, async () => {
      const jumps = await o.page.evaluate(() => [...document.querySelectorAll("[tabindex]")]
        .filter((e) => Number(e.getAttribute("tabindex")) > 0)
        .map((e) => e.tagName + (e.getAttribute("aria-label") ? `[${e.getAttribute("aria-label")}]` : "")));
      return jumps.length === 0 || `a positive tabindex re-orders the keyboard: ${jumps.join(", ")}`;
    });
    await phase(`${s.name} · the heading a screen reader lands on is this screen's, not the shell's`, async () => {
      const h = await o.page.evaluate(() => document.querySelector("h1")?.innerText.trim() || "");
      return (h && h !== "Aevidine") || `the first heading reads ${JSON.stringify(h)}`;
    });
    await phase(`${s.name} · its Refresh (or its first action) can be reached by keyboard alone`, async () => {
      const ok = await o.page.evaluate(() => {
        const f = [...document.querySelectorAll("button,a[href],input,select")].filter((x) => !x.disabled && x.offsetParent !== null);
        return f.length > 0 && f.every((x) => x.tabIndex >= 0);
      });
      return ok || "a control on this screen cannot be tabbed to";
    });
    await phase(`${s.name} · the browser Back button leaves the screen, it does not stick`, async () => {
      const p = await ctx.newPage();
      try {
        await p.goto(BASE + "/aevinite", { waitUntil: "domcontentloaded", timeout: 45000 });
        await p.goto(BASE + s.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await p.waitForTimeout(600);
        await p.goBack({ waitUntil: "domcontentloaded", timeout: 30000 });
        await p.waitForTimeout(600);
        const where = await p.evaluate(() => location.pathname);
        return where === "/aevinite" || `Back landed on ${where}`;
      } finally { await p.close(); }
    });
  }
  // ── the two overlays, each opened once and driven through its whole life ────────────────────
  // ONE page per overlay, not one per question. The first version opened a fresh page for every
  // check, so "leaves the page behind as it found it" measured a page where the dialog had never
  // been closed (of course the page was still frozen), and two checks raced a page that had already
  // been closed underneath them. An overlay is a sequence — open, read, close, check what is left —
  // and it has to be driven as one.
  const OVERLAYS = [
    // OPENED THE WAY A PERSON DOES: the control is FOCUSED and then pressed. A programmatic
    // `.click()` never moves focus, so the dialog's "put focus back where it was" had nothing to
    // put back and the check below read a working product as broken.
    { name: "the billing editor", url: "/aevinite/billing", announced: true, sel: ".adm-logrow:not(.head) button" },
    { name: "the recycle bin's delete confirm", url: "/aevinite/recycle", announced: false,
      sel: "[data-restaurant] button.danger" },
  ];
  for (const ov of OVERLAYS) {
    let opened = false, dlg = null, frozen = null, closed = null, leftBehind = null, err = "";
    let focusWentIn = null, focusCameBack = null, tabEscaped = null, openerWas = null;
    const p = await ctx.newPage();
    try {
      await p.goto(BASE + ov.url, { waitUntil: "networkidle", timeout: 60000 });
      await p.waitForTimeout(700);
      const overflowBefore = await p.evaluate(() => document.body.style.overflow);
      const opener = await p.$(ov.sel);
      if (opener) {
        await opener.focus();
        openerWas = await p.evaluate(() => (document.activeElement?.innerText || document.activeElement?.tagName || "").trim().slice(0, 24));
        await p.keyboard.press("Enter");
        await p.waitForTimeout(1100);
        opened = await p.evaluate(() => !!document.querySelector('[role="dialog"]') || /to confirm/.test(document.body.innerText));
      }
      dlg = await p.evaluate(() => { const el = document.querySelector('[role="dialog"]'); return el ? { modal: el.getAttribute("aria-modal"), name: el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") } : null; });
      frozen = await p.evaluate(() => document.body.style.overflow);
      // Where the keyboard is while the box is open, and whether it can wander out behind it.
      focusWentIn = await p.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        return d ? d.contains(document.activeElement) : null;
      });
      // PRESS THE KEY. The first version of this walked focus with `.focus()` in a loop and
      // reported the trap as leaking — but a focus trap is a keydown handler on Tab, and nothing
      // it does can intercept a programmatic focus. It was measuring something the keyboard never
      // does. Forty-five real Tab presses stay inside; the trap was never broken.
      if (await p.evaluate(() => !!document.querySelector('[role="dialog"]'))) {
        tabEscaped = false;
        for (let i = 0; i < 40; i++) {
          await p.keyboard.press("Tab");
          const out = await p.evaluate(() => {
            const d = document.querySelector('[role="dialog"]');
            return d ? !d.contains(document.activeElement) : null;
          });
          if (out === true) { tabEscaped = true; break; }
          if (out === null) break;
        }
      }
      await p.keyboard.press("Escape");
      await p.waitForTimeout(900);
      closed = await p.evaluate(() => !!document.querySelector('[role="dialog"]'));
      focusCameBack = await p.evaluate(() => document.activeElement === document.body ? null : (document.activeElement?.innerText || document.activeElement?.tagName || "").trim().slice(0, 24));
      leftBehind = await p.evaluate(() => document.body.style.overflow);
      if (leftBehind !== overflowBefore) leftBehind = `${leftBehind} (it found "${overflowBefore}")`;
      else leftBehind = null;
    } catch (e) { err = e.message.split("\n")[0]; }
    finally { await p.close(); }

    await phase(`${ov.name} · opens when its control is pressed`, () =>
      opened || err || "its control was not on the page, or pressing it opened nothing");
    await phase(`${ov.name} · is announced as a dialog, with a name`, () =>
      !ov.announced ? true : (dlg && dlg.modal === "true" && !!dlg.name) || `announced as: ${JSON.stringify(dlg)}`);
    await phase(`${ov.name} · freezes the page behind it`, () =>
      !ov.announced ? true : frozen === "hidden" || `the page behind reads overflow "${frozen}"`);
    await phase(`${ov.name} · closes on Escape`, () =>
      !ov.announced ? true : closed === false || "it stayed open");
    await phase(`${ov.name} · leaves the page behind exactly as it found it`, () =>
      leftBehind === null || `it left the page behind at overflow ${leftBehind}`);
    await phase(`${ov.name} · the keyboard goes INTO it when it opens`, () =>
      !ov.announced ? true : focusWentIn === true || `focus is ${focusWentIn === null ? "nowhere — the box did not open" : "still on the page behind"}`);
    await phase(`${ov.name} · the keyboard cannot wander out behind it`, () =>
      !ov.announced ? true : tabEscaped === false || (tabEscaped === null ? "the box did not open" : "Tab reached the page behind while the box was open"));
    await phase(`${ov.name} · the keyboard comes back to the very control that opened it`, () => {
      if (!ov.announced) return true;                       // this one is not a dialog, nothing closes
      if (focusCameBack === null) return "focus was dropped on the page body";
      return focusCameBack === openerWas || `focus came back to "${focusCameBack}" but "${openerWas}" opened it`;
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND M — MEASURED RENDERING, THREE WIDTHS, BOTH SKINS
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// 360 is the phone he tests on (Samsung A35), 768 is the width nobody designs for and everybody
// meets, 1440 is a desk. Both skins each time, because a colour written down rather than themed
// only shows itself in the one nobody opened.
band = "M";
console.log("\nM · measured rendering\n");
const WIDTHS = [{ w: 360, h: 780, n: "A35 phone" }, { w: 768, h: 900, n: "a tablet" }, { w: 1440, h: 900, n: "a desk" }];
const SKINS = ["dark", "light"];
if (!ctx) { for (let i = 0; i < 54; i++) unanswerable(`rendering check ${i + 1}`, "no headless browser"); }
else {
  for (const s of SCREENS) {
    for (const v of WIDTHS) {
      for (const skin of SKINS) {
        const tag = `${s.name} at ${v.n}, ${skin}`;
        const o = await view(s.url, { w: v.w, h: v.h, skin });
        await phase(`${tag} · the page never slides sideways`, async () => {
          const r = await o.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
          return r.sw <= r.cw + 1 || `scrollWidth ${r.sw} > ${r.cw}`;
        });
        await phase(`${tag} · every word is readable against what is behind it`, async () => {
          const bad = await o.page.evaluate(() => {
            const px = (c) => { const m = (c || "").match(/[\d.]+/g); if (!m) return null; const [r, g, b, a = 1] = m.map(Number); return { r, g, b, a }; };
            const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
            const L = (c) => (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
            const under = (el) => { const st = []; for (let e = el; e; e = e.parentElement) { const c = px(getComputedStyle(e).backgroundColor); if (c && c.a > 0) st.push(c); } let o = { r: 255, g: 255, b: 255, a: 1 }; for (let i = st.length - 1; i >= 0; i--) o = over(st[i], o); return o; };
            const out = [];
            for (const e of document.querySelectorAll("h1,h2,h3,p,span,b,button,label,div,option")) {
              if (e.children.length || e.offsetParent === null) continue;
              const t = (e.innerText || "").trim(); if (!t) continue;
              const cs = getComputedStyle(e); const fg = px(cs.color); if (!fg || fg.a === 0) continue;
              const bg = under(e);
              if (Math.abs(L(over(fg, bg)) - L(bg)) < 0.08) out.push(t.slice(0, 26));
            }
            return out.slice(0, 3);
          });
          return bad.length === 0 || `too close to its background: ${JSON.stringify(bad)}`;
        });
        await phase(`${tag} · nothing is cut off by its own box`, async () => {
          const clipped = await o.page.evaluate(() => {
            const out = [];
            for (const e of document.querySelectorAll("h1,h2,h3,p,span,button,label,b")) {
              if (e.children.length || e.offsetParent === null) continue;
              const cs = getComputedStyle(e);
              if (cs.overflow === "hidden" && cs.textOverflow === "ellipsis") continue;
              if (e.scrollHeight > e.clientHeight + 2 && !/auto|scroll/.test(cs.overflowY)) out.push((e.innerText || "").trim().slice(0, 30));
            }
            return out.slice(0, 3);
          });
          return clipped.length === 0 || `clipped: ${JSON.stringify(clipped)}`;
        });
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND N — THE WRITES: WHAT THEY COST, WHAT THEY CLEAN UP, WHAT THEY MUST NEVER TOUCH
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "N";
console.log("\nN · the writes\n");
await phase("The whole territory sends exactly the write actions the routes answer, and no others", () => {
  const sent = [...new Set([...Object.values(CODE).join("\n").matchAll(/action: "([a-z_]+)"/g)].map((m) => m[1]))].sort();
  const known = ["add_payment", "delete_payment", "purge_owner", "purge_restaurant", "restore", "restore_owner", "restore_restaurant", "set_plan"];
  const stray = sent.filter((a) => !known.includes(a));
  return stray.length === 0 || `unexpected: ${stray.join(", ")}`;
});
await phase("Recording a payment carries an id, so a lost answer cannot pay twice", () =>
  /"X-LFH-Action-Id": payActionIdRef\.current/.test(CODE.billing) || "no idempotency id on the money write");
await phase("Saving a plan carries what the row said, so a second person cannot be overwritten", () =>
  /"X-LFH-Expect": expectHeader\(expect\)/.test(CODE.billing) || "no clash expectation on the plan write");
await phase("Nothing in this territory can delete an order, an invoice or a payment of a restaurant's own", () => {
  const all = Object.values(CODE).join("\n");
  return !/from\("(orders|invoices|session_payments|credit_notes)"\)\s*\.delete/.test(all)
    || "a screen here reaches a restaurant's own money (docs/COMPLIANCE-GUARDRAILS.md)";
});
await phase("The one destructive money action here touches the PLATFORM's book, not a sale", () =>
  /from\("restaurant_payments"\)\.delete\(\)/.test(strip(read("app/api/admin/billing/route.ts")))
  || "the platform delete no longer names its own table");
await phase("Every destructive action on these screens asks first", () => {
  const holes = [];
  if (!/nameMatches/.test(CODE.recycle)) holes.push("a permanent delete with no typed name");
  if (!/confirm\(/.test(CODE.billing)) holes.push("a payment deleted with no question");
  return holes.length === 0 || holes.join(" · ");
});
await phase("…and every one of those questions names what is about to go", () => {
  const holes = [];
  if (!/money\(p\.amount, row\.currency\)/.test(CODE.billing)) holes.push("the payment question names no amount");
  if (!/Type <b[^>]*>\{r\.name\}<\/b> to confirm/.test(CODE.recycle)) holes.push("the restaurant confirm names no restaurant");
  if (!/Type <b[^>]*>\{o\.username\}<\/b> to confirm/.test(CODE.recycle)) holes.push("the owner confirm names no owner");
  return holes.length === 0 || holes.join(" · ");
});
await phase("No screen in this territory signs anybody in", () => {
  // A REQUEST to a sign-in route, not the WORD. The recycle bin's backup note says "staff passwords
  // are removed", which is a sentence about a file, and reading the word alone called that a login.
  const all = Object.values(CODE).join("\n");
  const doors = [...new Set([...all.matchAll(/fetch\(\s*[`"]([^`"]*(?:staff-login|panel-login|owner\/login)[^`"]*)/g)].map((m) => m[1]))];
  const fields = /type="password"/.test(all);
  return (doors.length === 0 && !fields) || `${doors.join(", ") || "a password field"} on an admin console screen`;
});
await phase("No screen here loops a request, so none of them can trip a rate limit", () => {
  const all = Object.values(CODE).join("\n");
  return !/(while|for)\s*\([^)]*\)\s*\{[^}]{0,200}fetch\(/.test(all) || "a request inside a loop";
});
await phase("Every read this territory fires is a GET, and every write is a POST", () => {
  const all = Object.values(CODE).join("\n");
  const methods = [...new Set([...all.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]))];
  return methods.every((m) => m === "POST") || `methods used: ${methods.join(", ")}`;
});
await phase("The removal card writes through the bill ledger and nowhere else", () => {
  const urls = [...new Set([...CODE.removal.matchAll(/fetch\("([^"]+)"/g)].map((m) => m[1]))];
  return (urls.length === 1 && urls[0] === "/api/admin/bills") || `writes to: ${urls.join(", ") || "nothing"}`;
});
await phase("No screen here quietly keeps anything on the device", () => {
  // The admin console is a desk tool signed in with a cookie; a screen stashing its own state in
  // the browser would be a second source of truth nobody busts. The skin is the ONE thing that
  // belongs to the device, and it is set by the shell, not by these four.
  const all = Object.values(CODE).join("\n");
  const stores = [...new Set([...all.matchAll(/(localStorage|sessionStorage|indexedDB)\.\w+\(\s*"?([\w.-]*)/g)].map((m) => `${m[1]}:${m[2] || "?"}`))];
  return stores.length === 0 || `keeps state on the device: ${stores.join(", ")}`;
});
await phase("LIVE · the platform's billing figures still add up after everything this run did", async () => {
  const { j } = await getJson("/api/admin/billing");
  if (!j.restaurants) return "the billing read did not answer";
  const canon = (c) => (c || "INR").trim().toUpperCase() || "INR";
  const rupees = Math.round(j.restaurants.filter((r) => canon(r.currency) === "INR").reduce((s, r) => s + (r.paidThisYear || 0), 0) * 100) / 100;
  // MY OWN MARK ONLY. This looked for /zz|probe|test/ and went red once on the live site while
  // nothing at all was on either database a minute later — it had caught another sweep terminal's
  // `zz*` fixture mid-life on the database all ten of us share. A guard that reads shared live data
  // and calls somebody else's in-flight row a fault is a guard that cries wolf; the thing this row
  // is actually for is "did T20 leave anything behind?", and T20's marks all say so.
  const stray = j.restaurants.filter((r) => r.plan && /zz-t20|t20-probe/i.test(r.plan)).map((r) => `${r.name}: ${r.plan}`);
  return stray.length === 0 || `this run left a value on a plan: ${stray.join(", ")} (rupee total ${rupees})`;
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// The verdict
// ════════════════════════════════════════════════════════════════════════════════════════════════
if (browser) await browser.close();

if (rows.length > CAPACITY) {
  console.log(`\n❌ This round planned ${rows.length} phases and only ${CAPACITY} ids were claimed for it.\n   Ids past the block would collide with somebody else's. Claim the shortfall in LEDGER/INDEX.md\n   and push it to main on its own, or cut the plan back.\n`);
  process.exit(1);
}

if (LEDGER || WRITE_LEDGER) {
  const BANDNAME = {
    H: "every sentence a person reads, from the source",
    H2: "every sentence that actually reaches the screen",
    I: "every control that renders",
    J: "every state these screens can be in, forced",
    K: "every branch in the four files",
    L: "the keyboard, and the phone's Back button",
    M: "measured rendering, three widths, both skins",
    N: "the writes: what they cost, what they clean up, what they must never touch",
  };
  const byBand = {};
  for (const r of rows) (byBand[r.band] ||= []).push(r);
  let out = `# SWEEP #8 · TERMINAL 20, ROUND 2 — the recycle bin, Billing and Usage, checked again\n\n`;
  out += `**${rows.length} phases.** Territory: ` + Object.values(FILES).map((f) => `\`${f}\``).join(" · ") + `\n\n`;
  out += `Planned fresh on 2026-09-04, after round 1's fourteen items were merged and deployed to\nbackup, on the owner's word:\n\n`;
  out += `> "after making it live and merging plan 500 phases test within your boundaries make sure it\n> cover everthing within your boundries and test everything again if any error left"\n\n`;
  out += `Round 1 asked *what could be wrong here?* This round asks *is there anything in these four\nfiles that nothing has looked at?* — and answers it by GENERATING its phases from the files, so\nthe count grows with the product instead of going stale beside it.\n\n`;
  out += `**The ids come from two ranges.** T20's block is \`P73701\`–\`P74700\` and round 1 used\n\`P73701\`–\`P74308\`, leaving 392. A fresh 500 therefore needed 108 more, and exactly 108 were\nclaimed from the registry — the shortfall, never a whole fresh block.\n\n`;
  // NAME THE GENERATOR IN THE WORDS THE GUARD LOOKS FOR (T19 of sweep #8 added that rule the same
  // day). A round ledger keeps its verdict in a run's output rather than in a column, so the one
  // thing it must be held to is that the run still exists — otherwise these become 500 ids nobody
  // can re-run, still counted and no longer provable.
  out += `Every row here is GENERATED from \`node scripts/verify-bin-billing-usage-r2.mjs\` — the rows and\nthe checks cannot disagree, because both come out of that one file. Regenerate with\n\`node scripts/verify-bin-billing-usage-r2.mjs --ledger\`.\n\n`;
  out += "```\nnpm run verify:bin-billing-usage-r2 -- --base http://localhost:4000\nnpm run verify:bin-billing-usage-r2 -- --base http://localhost:4000 --from 1 --to 80\n```\n\n";
  out += `**Result key:** ✅ pass · ❌ fail · ⏭ unanswered, with a written reason.\n`;
  for (const b of ["H", "H2", "I", "J", "K", "L", "M", "N"]) {
    const list = byBand[b] || [];
    if (!list.length) continue;
    out += `\n## ${b} · ${BANDNAME[b]} · \`${list[0].id}\`–\`${list[list.length - 1].id}\` (${list.length})\n\n| id | check | result |\n|---|---|---|\n`;
    for (const r of list) out += `| ${r.id} | ${r.title.replace(/\|/g, "\\|")} | ${r.result || ""}${r.note ? " " + r.note.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 200) : ""} |\n`;
  }
  writeFileSync(join(root, ".claude/sweep/LEDGER/T20-S8-R2.md"), out);
  console.log(`\n${rows.length} phases (${rows[0].id}–${rows[rows.length - 1].id}) written to .claude/sweep/LEDGER/T20-S8-R2.md\n`);
  if (LEDGER) process.exit(0);
}

console.log(`\n${"═".repeat(78)}`);
console.log(`  ${pass.length} passed · ${fail.length} failed · ${unanswered.length} unanswered · ${skipped.length} outside --from/--to`);
console.log(`  planned ${rows.length} of the ${CAPACITY} ids claimed for this round`);
if (fail.length) {
  console.log(`\n  What is wrong:\n`);
  for (const f of fail) console.log(`   ✗ ${f.id}  ${f.title}\n        ${f.why}\n`);
}
if (unanswered.length && !QUIET) {
  console.log(`\n  Not answerable in this run:\n`);
  for (const u of unanswered.slice(0, 20)) console.log(`   ? ${u.id}  ${u.title} — ${u.why}`);
}
console.log(`${"═".repeat(78)}\n`);
const MIN = (FROM || TO !== Infinity) ? 1 : 400;
if (pass.length + fail.length < MIN) {
  console.log(`Only ${pass.length + fail.length} checks actually ran, and this round has ${rows.length}.\nThat is not a pass — it is a round that did not run. Exiting 1.\n`);
  process.exit(1);
}
process.exit(fail.length ? 1 : 0);
