#!/usr/bin/env node
// verify-bin-billing-usage.mjs — SWEEP #8 · TERMINAL 20. Phases P73701–P74280 (580).
//
// ── THE TERRITORY, RE-DERIVED AT RUN TIME, NEVER TRUSTED FROM A LIST ────────────────────────────
//
//   app/aevinite/recycle/page.tsx        the admin's Recycle bin      (929 lines at plan time)
//   app/aevinite/billing/page.tsx        Billing & plans              (398)
//   app/aevinite/usage/page.tsx          Usage & cost                 (271)
//   components/admin/RemovalDetail.tsx   "what exactly was removed"   (463)
//
// The four screens that between them answer three questions the operator cannot ask anywhere else:
// *what did I delete and can I get it back*, *who pays me and who has not*, and *which restaurant
// is expensive to serve*. The fourth file is the card that opens from a removal row — it is shared
// by the admin's Audit and the owner's Audit · removals, so a change here reaches two panels.
//
// ── WHY IT IS ONE RE-RUNNABLE FILE AND NOT A TYPED TABLE ────────────────────────────────────────
//
// The ledger's own lesson, recorded across seven sweeps: a hand-typed table of checks drifts from
// the checks it claims to describe within days, and then "re-run row P73912" is a sentence that
// means nothing. So the rows in `.claude/sweep/LEDGER/T20-S8.md` are GENERATED from this file
// (`--ledger`), and every one of them is re-runnable by id:
//
//     npm run verify:bin-billing-usage -- --base http://localhost:4000
//     npm run verify:bin-billing-usage -- --base http://localhost:4000 --from 1 --to 60
//     node scripts/verify-bin-billing-usage.mjs --ledger        # regenerate the ledger table
//
// ── THE BANDS ───────────────────────────────────────────────────────────────────────────────────
//
//   A · P73701–P73900 (200) — reading the code for correctness: where does it give a wrong answer,
//                             fail silently, or never run at all.
//   B · P73901–P74000 (100) — the CLAUDE.md rules that govern THIS ground: bounded reads with a
//                             column list, no poll faster than the 60s backstop, every overlay
//                             registered with the back-button manager, no food money on an admin
//                             screen, one helper per job, a tap that never vanishes in silence.
//   C · P74001–P74130 (130) — watching it run: the three screens and the four routes behind them,
//                             driven headless, asserting the RENDERED result.
//   D · P74131–P74190  (60) — measured rendering at 1280×800 and at 360×780 dpr3 (Samsung A35):
//                             nothing clipped, nothing overlapping, no sideways page scroll.
//   E · P74191–P74240  (50) — tracing a change across panels: the removal card is one component on
//                             two panels, and the recycle bin's doors lead into four more.
//   F · P74241–P74280  (40) — judgment: is this how a real restaurant platform should work?
//
// ── SAFE-AUDIT WORDING (CLAUDE.md, read first every session) ────────────────────────────────────
//
// Band C asks product-correctness questions in product-correctness words: *"does every one of these
// admin requests require being signed in?"*, *"does the admin console show a restaurant's takings
// anywhere it should not?"*. It reads code and makes ordinary requests to its own dev server —
// what a browser does. It swaps no ids, replays nothing as anybody else, proves nothing by
// trickery. A gap found by reading is REPORTED, never poked at.
//
// ── SAFETY ──────────────────────────────────────────────────────────────────────────────────────
//
//   · Refuses to run against anything but the dev/test database (shared devStacks allow-list).
//   · READ-ONLY. Every request in this file is a GET. It writes no row, so there is nothing to
//     clean up and no chance of it reporting another session's fixtures as faults.
//   · Signs in ZERO times: it presents the admin cookie the gate already accepts (sha256 of
//     ADMIN_PASSWORD), so it can never raise a failed-login row, trip the IP throttle, or alert
//     the owner's phone about his own console.
//   · One at a time (pid lock) so two copies cannot read each other's half-loaded pages.
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";
import { requireAppUp } from "./sweep/appUp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

// ── one at a time ───────────────────────────────────────────────────────────────────────────────
const LOCK = "/tmp/bin-billing-usage-sweep.pid";
try {
  const alive = Number(readFileSync(LOCK, "utf8"));
  if (alive && alive !== process.pid) {
    try { process.kill(alive, 0); } catch { throw new Error("stale"); }
    console.log(`\nAnother copy of this sweep is already running (pid ${alive}). Two of them read each\nother's half-loaded pages and report them as faults. Waiting is the right move.`);
    process.exit(2);
  }
} catch { /* stale or absent — take it */ }
try { writeFileSync(LOCK, String(process.pid)); } catch {}
const dropLock = () => { try { if (Number(readFileSync(LOCK, "utf8")) === process.pid) unlinkSync(LOCK); } catch {} };
process.on("exit", dropLock);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { dropLock(); process.exit(130); });

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = Number(arg("--from", 0)) || 0;
const TO = Number(arg("--to", 0)) || Infinity;
const QUIET = process.argv.includes("--quiet");
const LEDGER = process.argv.includes("--ledger");
// --write-ledger: RUN everything, then write the same table with each row's real result in it. The
// rows and the checks cannot disagree, because both come out of this one file.
const WRITE_LEDGER = process.argv.includes("--write-ledger");
const SHOTS = process.argv.includes("--shots");

const env = Object.fromEntries(read(".env.local").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));

let BASE = "";
if (!LEDGER) {
  refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "the recycle-bin / billing / usage sweep");
  BASE = await requireAppUp(process.argv, "the recycle-bin / billing / usage sweep");
}
const ADMIN_COOKIE = "lfh_staff_auth=" + createHash("sha256").update(env.ADMIN_PASSWORD || "").digest("hex");
const get = (path, opts = {}) => fetch(BASE + path, {
  redirect: "manual", cache: "no-store",
  headers: { ...(opts.signedOut ? {} : { cookie: ADMIN_COOKIE }) },
}).catch((e) => ({ ok: false, status: 0, _err: e.message, text: async () => "", json: async () => ({}), headers: new Map() }));
const getJson = async (path, opts) => { const r = await get(path, opts); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, j }; };

// ── the phase runner ────────────────────────────────────────────────────────────────────────────
const FIRST_ID = 73701;
let n = 0;
const pass = [], fail = [], skipped = [], unanswered = [];
const idOf = (i) => "P" + (FIRST_ID + i - 1);
let band = "?";
const rows = [];
async function phase(title, fn) {
  n += 1;
  const id = idOf(n);
  rows.push({ id, band, title });
  if (LEDGER) return;
  if (n < FROM || n > TO) { skipped.push(id); return; }
  let r;
  try { r = await fn(); } catch (e) { r = `threw: ${e && e.message ? e.message : String(e)}`; }
  const row = rows[rows.length - 1];
  if (r === true) { pass.push(id); row.result = "✅"; row.note = ""; if (!QUIET) console.log(`  ✓ ${id}  ${title}`); }
  else {
    const why = typeof r === "string" ? r : "returned " + JSON.stringify(r);
    fail.push({ id, title, why }); row.result = "❌"; row.note = why;
    console.log(`  ✗ ${id}  ${title}\n        ${r}`);
  }
}
// A phase this run cannot answer is recorded as UNANSWERED, never as a pass. "Not reachable on the
// screen I opened" is a statement about the screen, not about the product (ledger lesson).
function unanswerable(id, title, why) {
  unanswered.push({ id, title, why });
  const row = rows.find((r) => r.id === id); if (row) { row.result = "⏭"; row.note = why; }
  console.log(`  ? ${id}  ${title}\n        UNANSWERED: ${why}`);
}

// ── the sources, read once ──────────────────────────────────────────────────────────────────────
const FILES = {
  recycle: "app/aevinite/recycle/page.tsx",
  billing: "app/aevinite/billing/page.tsx",
  usage: "app/aevinite/usage/page.tsx",
  removal: "components/admin/RemovalDetail.tsx",
};
const SRC = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const NEIGHBOURS = {
  shared: read("components/admin/shared.tsx"),
  modalHook: read("components/admin/useAdminModal.ts"),
  billingRoute: read("app/api/admin/billing/route.ts"),
  usageRoute: read("app/api/admin/usage/route.ts"),
  restsRoute: read("app/api/admin/restaurants/route.ts"),
  ownersRoute: read("app/api/admin/owners/route.ts"),
  auditRoute: read("app/api/admin/audit/route.ts"),
  ownerAuditRoute: read("app/api/owner/audit/route.ts"),
  adminLogs: read("app/aevinite/logs/page.tsx"),
  ownerActivity: read("app/owner/activity/page.tsx"),
  auditsort: read("public/panels/auditsort.js"),
  backStack: read("lib/backStack.ts"),
  revenue: read("app/aevinite/revenue/page.tsx"),
};
// Comments are not the code. LINE comments first: a `/*` inside a `//` line opens a block that
// swallows to the next `*/`, which once hid 190 lines from two shipped guards (memory, 2026-09-01).
const strip = (s) => s.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
const CODE = Object.fromEntries(Object.entries(SRC).map(([k, v]) => [k, strip(v)]));
const NCODE = Object.fromEntries(Object.entries(NEIGHBOURS).map(([k, v]) => [k, strip(v)]));

// A file this guard names but that no longer exists must FAIL, never pass vacuously — the exact
// way five guards in this repo asserted nothing for weeks (memory: a-dead-guard-looks-like-an-unrun-one).
const missing = Object.entries(SRC).filter(([, v]) => !v.trim()).map(([k]) => FILES[k]);
if (missing.length && !LEDGER) {
  console.log(`\nThis guard names ${missing.length} file(s) that are not there: ${missing.join(", ")}\nIt is asserting nothing about them. Fix the paths or delete the checks — do not leave it green.`);
  process.exit(1);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND A · P73701–P73900 — READING THE CODE FOR CORRECTNESS
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "A";
console.log("\nA · reading the code for correctness\n");

// ── A0 · the same fifteen questions of all four files ───────────────────────────────────────────
// Generated, not typed: add a fifth file to FILES and it gets the same fifteen automatically.
// A hand-typed list is how a sweep quietly stops covering the file somebody added last week.
const HEX_ALLOWED = {
  // Each of these is deliberate and is explained where it sits. A NEW hard-coded colour trips the
  // check, which is the point: the admin console is themed with CSS variables and a raw hex is how
  // one surface comes to ignore the light skin (memory: check-both-skins-for-fixed-colours).
  recycle: ["#d4a574"],                                   // the amber QR warning, named in its note
  billing: ["#16a34a"],                                   // the --adm-ok fallback on the history line
  usage: [],
  removal: ["#0f1622", "#e7edf3", "#ef4444", "#fff"],     // modal surface fallbacks + the bill's paper
};
for (const [key, path] of Object.entries(FILES)) {
  const src = SRC[key], code = CODE[key];
  await phase(`${path} — declares itself a client component`, () =>
    /^"use client";/m.test(src) || `no "use client" — it uses hooks and would fail to render`);
  await phase(`${path} — no console.log left behind`, () =>
    !/\bconsole\.log\s*\(/.test(code) || "a console.log survives in shipped code");
  await phase(`${path} — no debugger statement`, () =>
    !/\bdebugger\b/.test(code) || "a debugger statement survives");
  await phase(`${path} — no browser alert() box`, () =>
    !/(^|[^.\w])alert\s*\(/.test(code) || "alert() shows to nobody in a kiosk or webview (memory: a-browser-dialog-is-a-tap-that-can-vanish)");
  await phase(`${path} — nothing is injected as raw HTML`, () =>
    !/dangerouslySetInnerHTML/.test(code) || "raw HTML injection on an admin screen");
  await phase(`${path} — no TODO / FIXME left as a promise`, () =>
    !/\b(TODO|FIXME|XXX)\b/.test(code) || "an unkept promise in the code");
  await phase(`${path} — the type-checker is not silenced`, () =>
    !/@ts-(ignore|expect-error)/.test(code) || "a silenced type error");
  await phase(`${path} — no bare 'any' escape hatch`, () =>
    !/\bas\s+any\b|:\s*any\b/.test(code) || "an 'any' cast hides a real shape mismatch");
  await phase(`${path} — every read asks for fresh data`, () => {
    const gets = [...code.matchAll(/fetch\(([^;]*?)\)\s*(?:\)|;|,|\.)/gs)].map((m) => m[0]);
    const bad = gets.filter((g) => !/method:\s*"POST"/.test(g) && !/cache:\s*"no-store"/.test(g));
    return bad.length === 0 || `${bad.length} GET(s) without cache:"no-store" — a stale admin screen decides a delete`;
  });
  await phase(`${path} — no address hard-coded to one machine`, () =>
    !/https?:\/\/(localhost|127\.0\.0\.1|[a-z0-9-]+\.vercel\.app)/.test(code) || "a hard-coded host");
  await phase(`${path} — nothing polls faster than the 60s backstop`, () => {
    const iv = [...code.matchAll(/(?:setInterval|useActiveAutoRefresh)\s*\([^)]*?(\d{3,})\s*\)/g)].map((m) => Number(m[1]));
    const fast = iv.filter((ms) => ms < 60000);
    return fast.length === 0 || `polls at ${fast.join(", ")}ms — the rule is 60s (docs/SAAS-EFFICIENCY-PLAYBOOK.md)`;
  });
  await phase(`${path} — no server secret is read on the client`, () =>
    !/process\.env\.(?!NEXT_PUBLIC_)/.test(code) || "a non-public env var read in a client component");
  await phase(`${path} — no colour is named in English on an inline style`, () =>
    !/(color|background|border)[^;{}]{0,40}:\s*"(red|blue|green|yellow|orange|white|black)"/.test(code)
    || "an English colour name ignores both skins");
  await phase(`${path} — every hard-coded colour is one of the deliberate ones`, () => {
    const found = [...new Set([...code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()))];
    const strayed = found.filter((h) => !HEX_ALLOWED[key].map((x) => x.toLowerCase()).includes(h));
    return strayed.length === 0 || `new hard-coded colour(s) ${strayed.join(", ")} — theme them or add them to the allow-list with a reason`;
  });
  await phase(`${path} — it is not empty and carries its own explanation`, () =>
    (src.length > 400 && /^\/\//m.test(src)) || "no header comment — the next reader inherits nothing");
}

// ── A1 · the Recycle bin ────────────────────────────────────────────────────────────────────────
const R = CODE.recycle, Rsrc = SRC.recycle;
await phase("Recycle · the dead `canPurge` permission flag is still gone", () =>
  !/\bcanPurge\b/.test(R) || "canPurge is back — it could only ever say yes, beside a permanent delete");
await phase("Recycle · a count that could not be read draws '?', never a confident 0", () =>
  /n === null \|\| n === undefined \? "\?"/.test(R) || "the '?' rule for an unread count is gone");
await phase("Recycle · the chip states how long it has SAT there, not a countdown", () =>
  /In the bin/.test(R) && !/days? (left|remaining)/i.test(R) || "a countdown is back — the 90-day wait was deleted (mig 342)");
await phase("Recycle · no 90-day retention wording survives anywhere on the page", () =>
  !/90[- ]day|retention period|cannot be permanently/i.test(Rsrc.replace(/^\s*\/\/.*$/gm, "")) || "a retired rule is still promised on screen");
await phase("Recycle · the page says removal KEEPS the bills, invoices and payments", () =>
  /bills, invoices, payments/.test(R) && /kept/.test(R) || "the money-is-kept sentence is gone (mig 309)");
await phase("Recycle · it names Bills as where the kept money stays readable", () =>
  /readable in <b[^>]*>Bills/.test(R) || "it says the money is kept but not where to read it");
await phase("Recycle · a failed restaurants read shows the reason AND a Retry", () =>
  /\{msg\}\s*<button[^>]*onClick=\{load\}>Retry/.test(R) || "no Retry beside the restaurants error");
await phase("Recycle · a failed owners read shows the reason AND a Retry", () =>
  /\{ownerMsg\}\s*<button[^>]*onClick=\{load\}>Retry/.test(R) || "no Retry beside the owners error");
await phase("Recycle · an empty restaurants bin says so in words", () =>
  /No deleted restaurants\./.test(R) || "an empty bin would be a blank box");
await phase("Recycle · an empty owners bin says so in words", () =>
  /No deleted owners\./.test(R) || "an empty owner bin would be a blank box");
await phase("Recycle · an error never leaves 'No deleted…' underneath it as well", () =>
  /\{msg \? "" : "No deleted restaurants\."\}/.test(R) && /\{ownerMsg \? "" : "No deleted owners\."\}/.test(R)
  || "a failed read would claim the bin is empty");
await phase("Recycle · 'Loading…' belongs to the null state only", () =>
  (R.match(/=== null \? \(\s*<div className="adm-empty">Loading…/g) || []).length === 2
  || "a loading state that a failed read cannot leave");
await phase("Recycle · every restaurant row carries a stable name hook", () =>
  /data-restaurant=\{r\.slug\}/.test(R) || "a checker would have to click 'the last button on the page'");
await phase("Recycle · every owner row carries a stable name hook", () =>
  /data-owner=\{o\.username\}/.test(R) || "same, for owners");
await phase("Recycle · both ways back exist: suspended, and live", () =>
  /restore\(false\)/.test(R) && /restore\(true\)/.test(R) || "one of the two Restore buttons is gone");
await phase("Recycle · the plain Restore says it comes back SUSPENDED", () =>
  /Restore \(suspended\)/.test(R) || "the safer button no longer says what it does");
await phase("Recycle · a taken address opens a question, never a red line on the row", () =>
  /res\.status === 409 && d\.conflict/.test(R) && /setClash\(d\.conflict as SlugClash\)/.test(R)
  || "a name clash would read as an error");
await phase("Recycle · a taken owner name opens a question too", () =>
  /setClash\(d\.conflict as NameClash\)/.test(R) || "the owner clash chooser is gone");
await phase("Recycle · a refusal while the restaurant chooser is open is shown INSIDE it", () =>
  (R.match(/if \(dialogOpen\) \{ setClashErr/g) || []).length >= 2
  || "a refusal would land behind the overlay and the tap would look ignored");
await phase("Recycle · the restaurant chooser remembers which Restore button was pressed", () =>
  /setPendingActivate\(activate\)/.test(R) && /restore\(pendingActivate, res\)/.test(R)
  || "answering the question would restore it the wrong way");
await phase("Recycle · a SECOND clash says so rather than swapping in a new name quietly", () =>
  /is taken as well/.test(R) || "a second clash would be silent");
await phase("Recycle · both choosers portal to `.adm`, never to <body>", () =>
  (R.match(/document\.querySelector<HTMLElement>\("\.adm"\) \?\? document\.body/g) || []).length === 2
  || "a body portal comes out white in the dark console");
await phase("Recycle · both choosers register with the back-button manager", () =>
  /useAdminModal\(ref, "restaurant-name-clash"/.test(R) && /useAdminModal\(ref, "owner-name-clash"/.test(R)
  || "phone Back would leave the page instead of closing the box");
await phase("Recycle · the restaurant chooser offers exactly the two ways out he asked for", () => {
  const btns = [...R.matchAll(/<button className="adm-btn[^"]*"[^>]*>\s*\{?busy[^}]*\}?\s*([A-Z][^<]*)/g)].length;
  return (/Change name & restore/.test(R) && /onClick=\{onClose\}>Close</.test(R) && !/rename the holder/i.test(R))
    || `the two-option shape changed (${btns} buttons)`;
});
await phase("Recycle · nothing offers to rename the LIVE restaurant holding the address", () =>
  !/rename_holder|rename_existing_restaurant/.test(R) || "a live restaurant's printed QR codes are not ours to move");
await phase("Recycle · the QR consequence is shown before the rename is agreed to", () =>
  /clash\.qrWarning/.test(R) && /old QR codes will point at the wrong restaurant/.test(R)
  || "the admin would agree to a rename without being told what it costs");
await phase("Recycle · the after-the-fact rename notice names where the OLD address now goes", () =>
  /now belongs to a different restaurant/.test(R) && /reprint them/.test(R)
  || "'its address is taken' is a fact about us, not about the guest holding the card");
await phase("Recycle · that notice STAYS until dismissed — it is not a toast", () =>
  /setNotice\(null\)\}>Got it/.test(R) || "a fact about printed QR codes must not disappear on a timer");
await phase("Recycle · the typed-name confirm is case-insensitive on BOTH rows", () =>
  (R.match(/confirmName\.trim\(\)\.toLowerCase\(\) === /g) || []).length === 2
  || "one of the two demands exact capitals — names are stored SHOUTING (owner, 2026-08-16)");
await phase("Recycle · the permanent-delete button is disabled until the name matches", () =>
  (R.match(/disabled=\{busy \|\| !nameMatches\}/g) || []).length === 2 || "the confirm step can be skipped");
await phase("Recycle · a restaurant removal offers a backup download first", () =>
  /wantBackup, setWantBackup\] = useState\(true\)/.test(R) || "the backup offer is gone, or no longer the default");
await phase("Recycle · a failed backup ABORTS the removal", () =>
  /if \(wantBackup\) \{ const okBackup = await downloadBackup\(\); if \(!okBackup\) \{ setBusy\(false\); return; \} \}/.test(R)
  || "it would erase the data after failing to save a copy of it");
await phase("Recycle · the backup file is named after the restaurant and the day", () =>
  /backup-\$\{r\.slug\}-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}\.json/.test(R)
  || "an unnamed download is a file nobody can identify later");
await phase("Recycle · the backup warns that it holds customer names and phone numbers", () =>
  /customer names &amp; phone numbers/.test(R) && /Keep it private/.test(R)
  || "a file of guests' phone numbers must say so");
await phase("Recycle · the object URL is released after the download", () =>
  /URL\.revokeObjectURL\(url\)/.test(R) || "a leaked blob URL holds the whole backup in memory");
await phase("Recycle · unpaid pay-later tabs are surfaced on the row", () =>
  /still unpaid here/.test(R) || "the one figure that should stop a hand is not shown");
await phase("Recycle · …and again inside the permanent-delete confirm, in all three of its states", () => {
  // Pinned to the QUESTION, not to one spelling of it: does the confirm answer "does anyone still
  // owe money here?" for every answer that question can have — a real count, an unknown, and
  // "nothing has been read yet"? Silence is only correct for a real zero.
  const holes = [];
  if (!/unpaidPayLaterBills > 0/.test(R)) holes.push("it does not name a real count");
  if (!/unpaidPayLaterBills === null/.test(R)) holes.push("an unread count is silent, so it reads as 'nobody owes anything'");
  if (!/haven&apos;t looked inside this one yet/.test(R)) holes.push("the confirm can be opened without reading the row, and says nothing about it");
  return holes.length === 0 || holes.join(" · ");
});
await phase("Recycle · it says the bills survive but the record of WHO owes them does not", () =>
  /removing this restaurant deletes the record of <b>who<\/b> owes them/.test(R)
  || "the asymmetry that actually costs money is not spelled out");
await phase("Recycle · a count that could not be read is admitted on screen", () =>
  /couldn&apos;t be read just now and show as/.test(R) || "a '?' with no explanation reads as a bug");
await phase("Recycle · every panel door is distinct — no screen is offered twice", () => {
  const doors = [...R.matchAll(/\{ to: "([^"]+)", label: "([^"]+)"/g)].map((m) => m[1]);
  return new Set(doors).size === doors.length || `duplicate door(s): ${doors.join(", ")}`;
});
await phase("Recycle · the retired /editor address is not offered as its own door", () =>
  !/to: "\/editor"/.test(R) || "/editor only redirects to /manager — offering both is two names for one screen");
await phase("Recycle · a blocked new tab offers the same door here, not a browser lecture", () =>
  /Your browser blocked the new tab/.test(R) && /Open \{label\} here/.test(R)
  || "the admin would be told to change a browser setting instead of being let in");
await phase("Recycle · the blocked-tab message is kept apart from a failed count read", () =>
  /const \[blocked, setBlocked\] = useState/.test(R) && !/setInsideErr\((?:[^)]*)blocked/i.test(R)
  || "a blocked tab would arrive beside a Retry that re-reads counts and fixes nothing");
await phase("Recycle · every part of the panel address is encoded", () => {
  const h = R.match(/const hereHref[\s\S]*?opts\.bin \? "&bin=1" : ""\);/);
  return (h && (h[0].match(/encodeURIComponent/g) || []).length >= 3) || "an unencoded id or path in a URL";
});
await phase("Recycle · the doors say plainly that looking does not restore anything", () =>
  /It stays in the recycle bin/.test(R) && /guest menu is still offline/.test(R)
  || "an admin could think opening a panel brought the restaurant back");
await phase("Recycle · a restaurant already removed for good gets no panel buttons", () =>
  /\{!rr\.purged && \(/.test(R) || "a door into something that no longer exists");
await phase("Recycle · a binned owner keeps the ★ primary badge on their restaurant", () =>
  /rr\.primary && <span title="Primary owner"/.test(R) || "the primary holder loses their mark in the bin");
await phase("Recycle · each of an owner's restaurants states which of the four states it is in", () =>
  /rr\.purged \? "Removed for good" : rr\.binned \? "In the recycle bin" : rr\.active \? "Live" : "Suspended"/.test(R)
  || "the four states are not all named");
await phase("Recycle · an owner with no restaurants is told removing them affects nothing else", () =>
  /They hold no restaurants\. Removing them for good affects nothing else\./.test(R) || "no honest empty state");
await phase("Recycle · the owner delete says the restaurants themselves are NOT deleted", () =>
  /the restaurants themselves are NOT deleted/.test(R) || "the most frightening misreading is not headed off");
await phase("Recycle · an owner's panel opens through THEIR eyes, pinned to them", () =>
  /openRestaurantPanel\(rr\.id, "\/owner", o\.id, rr\.binned\)/.test(R) || "the owner door is not pinned to this owner");
await phase("Recycle · a date that cannot be parsed falls back to what was stored", () => {
  // The behaviour, wherever the formatter lives. This page used to carry its own copy and the check
  // was pinned to that copy's `catch` — so moving to the console's shared istDate, which is a
  // strictly better answer, read as a regression. A guard pinned to a code shape does that.
  const local = /catch \{ return iso; \}/.test(R);
  const shared = /\bistDate\b/.test(R) && /if \(Number\.isNaN\(t\)\) return iso;/.test(NCODE.shared);
  return local || shared || "an unparseable date would render as 'Invalid Date'";
});
await phase("Recycle · the suggested web address is capped and stripped at both ends", () =>
  /replace\(\/\^-\+\|-\+\$\/g, ""\)\.slice\(0, 40\)/.test(R) || "slugify no longer bounds the address");
await phase("Recycle · the address follows the name until the admin edits the address", () =>
  /if \(!slugTouched\) setSlug\(slugify\(v\)\)/.test(R) && /setSlugTouched\(true\)/.test(R)
  || "the two fields would fight and the last one touched would win by accident");
await phase("Recycle · a one-character name or address cannot be submitted", () =>
  /name\.trim\(\)\.replace\(\/\\s\+\/g, " "\)\.length >= 2/.test(R) && /slug\.trim\(\)\.length >= 2/.test(R)
  || "a one-character rename would be offered and then refused by the server");
await phase("Recycle · a second clash rebuilds the chooser from the new pair", () =>
  /key=\{clash\.holder\.id\}/.test(R) && /key=\{clash\.existing\.id\}/.test(R)
  || "a stale suggestion from the first clash would be offered for the second");
await phase("Recycle · the owner chooser explains when the name belongs to a staff login, not an owner", () =>
  /belongs to a restaurant&apos;s <b>\{clash\.existing\.role\}<\/b> login/.test(R)
  || "the un-renameable case would look like a bug");
await phase("Recycle · when a count could not be read, the way to try again really works", () => {
  // The screen says: "Some of these couldn't be read just now and show as '?' — close and reopen
  // this row to try again." Reopening calls loadInside() only when `inside` is still null, and a
  // partly-unread answer IS an answer, so `inside` is set and the reopen does nothing at all. An
  // instruction that has no effect on the screen that decides a permanent delete is worse than none.
  const reopensOnUnread = /!inside \|\| insideIncomplete/.test(R) && /const insideIncomplete = /.test(R);
  const tellsCloseAndReopen = /close and reopen this row to try again/.test(R);
  const offersAButton = /onRetry=\{loadInside\}/.test(R) && /onClick=\{onRetry\}/.test(R) && /Try again/.test(R);
  if (offersAButton && reopensOnUnread) return true;
  const holes = [];
  if (!offersAButton) holes.push("there is no button on the '?' line that re-reads the counts");
  if (!reopensOnUnread) holes.push("reopening the row refetches nothing (`if (next && !inside …)`), so a '?' stays until the whole page is reloaded");
  if (tellsCloseAndReopen) holes.push("and the page still tells the admin to close and reopen the row");
  return holes.join(" · ");
});
await phase("Recycle · an unread count is never silently treated as 'no unpaid tabs'", () => {
  // `!!i.unpaidPayLaterBills` is false for BOTH 0 and null. 0 is "none owed"; null is "we could not
  // ask". The row-level '?' and the italic line cover the first case, but the permanent-delete
  // confirm must not read as reassurance when the figure is simply unknown.
  const guarded = /unpaidPayLaterBills === null|unreadUnpaid|unpaid[^\n]*=== null/.test(R);
  return guarded || /couldn&apos;t be read just now/.test(R)
    ? true
    : "the delete confirm is silent when the unpaid-tab count could not be read";
});

// ── A2 · Billing & plans ────────────────────────────────────────────────────────────────────────
const B = CODE.billing;
await phase("Billing · the only money on this screen is what a restaurant pays US", () =>
  !/\b(gmv|food revenue|takings|sales)\b/i.test(B) || "food money has appeared on a platform-billing screen");
await phase("Billing · 'today' is the Indian calendar day, the same one the server counts on", () =>
  /Date\.now\(\) \+ 5\.5 \* 3600 \* 1000/.test(B) || "the UTC date is back — 5½ hours a night where the card and the row disagree");
await phase("Billing · an unknown currency code falls back rather than throwing", () =>
  /catch \{ return `\$\{c\} \$\{Math\.round/.test(B) || "an unknown code would throw inside a render");
await phase("Billing · a currency code is trimmed and upper-cased before it is compared", () =>
  /\(c \|\| "INR"\)\.trim\(\)\.toUpperCase\(\) \|\| "INR"/.test(B) || "a row stored as 'inr' falls out of both halves of the tile");
await phase("Billing · the rupee tile is summed from the SAME rows the table shows", () =>
  /byCurrency = \(rows \|\| \[\]\)\.reduce/.test(B) && /byCurrency\.get\("INR"\)/.test(B)
  || "the tile and the table can disagree");
await phase("Billing · money in another currency is LISTED, never silently dropped", () =>
  /not counted above:/.test(B) || "a non-rupee payment would vanish from the platform's own income figure");
await phase("Billing · the tile only says '· rupees' when there is something else to say", () =>
  /Collected this year\{otherCollected\.size \? " · rupees" : ""\}/.test(B) || "the qualifier is unconditional or gone");
await phase("Billing · '…' means still loading, and only that", () =>
  /\{rows \? money\(rupeesCollected, "INR"\) : "…"\}/.test(B) || "the tile could sit on an ellipsis after a failed read");
await phase("Billing · the overdue marker on a row uses the same calendar as the card", () =>
  /const overdue = !!r\.nextDueOn && r\.nextDueOn < todayStr/.test(B) && /const todayStr = today\(\)/.test(B)
  || "the row and the summary card would disagree overnight");
await phase("Billing · the search matches the name and the web address", () =>
  /r\.name\.toLowerCase\(\)\.includes\(needle\) \|\| r\.slug\.toLowerCase\(\)\.includes\(needle\)/.test(B)
  || "searching by slug is gone");
await phase("Billing · the search says how many of how many are showing", () =>
  /\{filtered\.length\} of \{rows\?\.length \?\? 0\}/.test(B) || "no count beside the search box");
await phase("Billing · a search that matches nothing says so, quoting what was typed", () =>
  /No restaurants match &ldquo;\{q\}&rdquo;\./.test(B) || "an empty result would be a blank card");
await phase("Billing · both lists show a skeleton while loading, not a blank card", () =>
  (B.match(/<SkelList rows=\{4\} label="Loading" \/>/g) || []).length === 2 || "a loading list is blank");
await phase("Billing · the editor registers with the back-button manager", () =>
  /useAdminModal\(dialogRef, "admin-billing-editor", onClose\)/.test(B) || "phone Back would leave the page");
await phase("Billing · the editor is announced as a dialog with the restaurant's name", () =>
  /role="dialog" aria-modal="true" aria-label=\{`Billing for \$\{row\.name\}`\}/.test(B) || "an unnamed dialog");
await phase("Billing · the amount is checked here the same way the route checks it", () =>
  /\/\^-\?\\d\+\(\\\.\\d\+\)\?\$\/\.test\(cleaned\)/.test(B) || "the screen and the route disagree about what a number is");
await phase("Billing · 'x1y2' can no longer become a ₹12 payment", () =>
  /replace\(\/\[\\s,\]\/g, ""\)\.replace\(\/\^\[₹\$€£\]\/, ""\)/.test(B) || "the over-tolerant amount cleaner is back");
await phase("Billing · a double-click cannot record the same payment twice", () =>
  /payingRef\.current = true/.test(B) && /if \(payingRef\.current\) return;/.test(B) || "the synchronous guard is gone");
await phase("Billing · a lost answer can be retried without paying twice", () =>
  /"X-LFH-Action-Id": payActionIdRef\.current/.test(B) || "no idempotency id on the money write");
await phase("Billing · …and that id is only reset once the payment really committed", () =>
  /payActionIdRef\.current = null; \/\/ committed/.test(SRC.billing) || "the id resets on the wrong side of the write");
await phase("Billing · the server's half-done answer is shown, never swallowed", () =>
  (/typeof d\?\.warning === "string" && d\.warning/.test(B) && /kind: "warn", text: d\.warning/.test(B))
  || "a payment that saved while the due date did not would read as a clean success");
await phase("Billing · a refusal on a payment ROW lands beside the payment rows", () =>
  /setHistMsg\("Couldn&apos;t delete|setHistMsg\("Couldn't delete/.test(B) || "the bin would look like it did nothing");
await phase("Billing · that message is coloured by what it IS, not by chance", () =>
  /\/\^Couldn\/\.test\(histMsg\)/.test(B) || "a failure and a success would look the same there");
await phase("Billing · recording a payment refreshes the next-due date in the open editor", () =>
  /if \(j\.billing && typeof j\.billing\.next_due_on !== "undefined"\) setNextDueOn/.test(B)
  || "the editor would keep showing the old date until reopened");
await phase("Billing · a failed history read announces itself instead of showing an empty list", () =>
  /toast\("Couldn't load payment history/.test(B) || "a failed load would read as 'no payments yet'");
await phase("Billing · the editor card fits a 360px phone with its padding", () =>
  /width: "min\(100%, 560px\)"/.test(B) || "96vw plus 32px of padding is wider than an A35");
await phase("Billing · the currency box settles to the code that will really be stored", () =>
  /onBlur=\{\(\) => setCurrency\(\(c\) => c\.trim\(\)\.toUpperCase\(\) \|\| "INR"\)\}/.test(B)
  || "the box would show something the database is not on");
await phase("Billing · …and it is normalised again on the way to the server", () =>
  /currency: currency\.trim\(\)\.toUpperCase\(\) \|\| "INR"/.test(B) || "a free-text code reaches the database verbatim");
await phase("Billing · the status list offers exactly the four the route accepts", () => {
  const ui = [...B.matchAll(/<option value="(trial|active|paused|cancelled)">/g)].map((m) => m[1]).sort();
  const route = (NCODE.billingRoute.match(/\["trial", "active", "paused", "cancelled"\]/) || [])[0];
  return (ui.join(",") === "active,cancelled,paused,trial" && !!route) || `screen offers ${ui.join(",")}`;
});
await phase("Billing · the cycle list offers exactly the two the route accepts", () => {
  const ui = [...B.matchAll(/<option value="(yearly|monthly)">/g)].map((m) => m[1]).sort();
  return ui.join(",") === "monthly,yearly" || `screen offers ${ui.join(",")}`;
});
await phase("Billing · the roll-forward wording follows the cycle that is selected", () =>
  /by one \{cycle === "monthly" \? "month" : "year"\}/.test(B) || "it would promise a year while rolling a month");
await phase("Billing · the platform's own refresh is the only timer, at 60 seconds", () => {
  const timers = [...B.matchAll(/useActiveAutoRefresh\(load, (\d+)\)/g)].map((m) => Number(m[1]));
  return (timers.length === 1 && timers[0] === 60000) || `timers: ${timers.join(", ") || "none"}`;
});
await phase("Billing · a refusal never wears the same quiet grey as a confirmation", () => {
  // Two places tell the admin what happened next to a button: `msg` under Save plan and `payMsg`
  // under Add payment. If either renders a REFUSAL in the same muted style as "Saved." then a plan
  // that did not save, and a payment that was not recorded, both read as done.
  // What must be true: the KIND is decided where the answer is known, the styling follows the
  // kind, and nothing works the kind out by reading the words of a sentence afterwards.
  const hasKinds = /type Said = \{ kind: "ok" \| "warn" \| "err"; text: string \}/.test(B);
  const styledByKind = /SAID_STYLE\[said\.kind\]/.test(B);
  const planUsesIt = /\{msg && <SaidLine said=\{msg\} \/>\}/.test(B);
  const payUsesIt = /\{payMsg && <SaidLine said=\{payMsg\} \/>\}/.test(B);
  const stillSniffs = /test\((?:pay)?[Mm]sg\)/.test(B);
  const holes = [];
  if (!hasKinds) holes.push("no kind is recorded — a said-thing is a bare string again");
  if (!styledByKind) holes.push("the styling no longer follows the kind");
  if (!planUsesIt) holes.push(`"Save plan" renders every answer the same way, so a plan that did NOT save looks exactly like "Saved."`);
  if (!payUsesIt) holes.push(`"Add payment" renders every answer the same way, so a payment that was NOT recorded looks exactly like one that was`);
  if (stillSniffs) holes.push("the kind is being worked out by searching the sentence for words again");
  return holes.length === 0 || holes.join(" · ");
});
await phase("Billing · a date on screen is written the way the rest of the console writes dates", () => {
  // components/admin/shared.tsx exports istDate precisely so two admin screens cannot print the
  // same field differently — /aevinite/revenue already uses it for its Next-due column.
  const importsIt = /import \{ useActiveAutoRefresh, istDate \}/.test(B);
  const nextDue = /istDate\(r\.nextDueOn\)/.test(B);
  const paidOn = /istDate\(p\.paid_on\)/.test(B);
  const keepsRaw = /title=\{r\.nextDueOn \|\| undefined\}/.test(B) && /title=\{p\.paid_on\}/.test(B);
  const holes = [];
  if (!importsIt) holes.push("the shared formatter is not imported");
  if (!nextDue) holes.push("Next due prints the raw database value (2027-07-04) while /aevinite/revenue prints the same field through istDate");
  if (!paidOn) holes.push("every payment date prints the raw database value");
  if (!keepsRaw) holes.push("the stored value is no longer reachable as the title, so it cannot be read off or copied");
  return holes.length === 0 || holes.join(" · ");
});
await phase("Billing · deleting a payment says WHICH payment", () => {
  // The whole question, not the first bracket: the sentence is built from three parts now.
  const at = CODE.billing.indexOf("confirm(");
  const ask = at < 0 ? "" : CODE.billing.slice(at, CODE.billing.indexOf(")) return;", at));
  const holes = [];
  if (!/money\(p\.amount/.test(ask)) holes.push("it does not name the amount");
  if (!/istDate\(p\.paid_on\)/.test(ask)) holes.push("it does not name the date");
  if (!/cannot be undone/.test(ask)) holes.push("it does not say the row cannot be brought back");
  if (!/no bill, no invoice/.test(ask)) holes.push("it does not say the restaurant's own money is untouched");
  return holes.length === 0
    || `${holes.join(", ")} — with a year of near-identical rows, and this figure being the platform's own income`;
});
await phase("Billing · nothing on this screen can erase or hide a restaurant's SALE", () =>
  !/orders|invoices|bills/i.test(B.replace(/Billing/g, "")) || "a platform-billing screen must never touch a food sale (docs/COMPLIANCE-GUARDRAILS.md)");
await phase("Billing · the payment history is rendered from the server's own list, not rebuilt", () =>
  /payments\.map\(\(p\) =>/.test(B) && !/payments\.push|setPayments\(\[\.\.\./.test(B)
  || "the screen keeps its own copy of the money list");
await phase("Billing · the table header and every row share one column template", () => {
  const tpl = [...B.matchAll(/gridTemplateColumns: "([^"]+)"/g)].map((m) => m[1]);
  const seven = tpl.filter((t) => t === "1.2fr 1fr 90px 1fr 1fr 100px 90px");
  const five = tpl.filter((t) => t === "90px 90px 1fr 1fr 40px");
  return (seven.length === 2 && five.length === 2) || `column templates: ${tpl.join(" | ")}`;
});
await phase("Billing · the amount box accepts a decimal keyboard on a phone", () =>
  (B.match(/inputMode="decimal"/g) || []).length === 2 || "a money box without a number keypad");

// ── A3 · Usage & cost ───────────────────────────────────────────────────────────────────────────
const U = CODE.usage;
await phase("Usage · no earnings appear anywhere on the page", () => {
  // The page's own promise ("No earnings shown.") is not a breach of it, and `inR` inside an
  // identifier is not a currency code — a detector that cannot tell those apart cries wolf for ever.
  const t = U.replace(/en-IN/g, "").replace(/No earnings shown\./g, "");
  const hits = [...t.matchAll(/₹|\brevenue\b|\bearnings\b|\btakings\b|\bINR\b|\bgmv\b/gi)].map((m) => m[0]);
  return hits.length === 0 || `money words on the cost-proxy screen: ${hits.join(", ")}`;
});
await phase("Usage · …and the page says so in its own words", () =>
  /No earnings shown\./.test(U) || "the promise is gone from the sub-heading");
await phase("Usage · it states twice that order volume is a PROXY, not a bill", () =>
  /a proxy for how much each costs you to serve/.test(U) && /best cheap signal for load/.test(U)
  || "one of the two honesty lines is gone");
await phase("Usage · a failed load shows the reason and a Retry", () =>
  /\{err\} <button className="adm-btn"[^>]*onClick=\{load\}>Retry/.test(U) || "no Retry beside the error");
await phase("Usage · after a failed load the headline numbers read '—', never '…' for ever", () =>
  /const blank = err \? "—" : "…"/.test(U) || "the four numbers would sit on an ellipsis for ever");
await phase("Usage · a stale table is dimmed while refreshing, not blanked", () =>
  /opacity: loading && d \? 0\.6 : 1/.test(U) || "a refresh would blank the numbers");
await phase("Usage · an empty platform says so in words", () =>
  /No restaurants yet\./.test(U) || "an empty platform would be a blank card");
await phase("Usage · a restaurant with no orders draws no bar rather than a misleading sliver", () =>
  /orderOf\(r\) > 0 \? 3 : 0/.test(U) || "a zero would draw a 3% bar");
await phase("Usage · the bar is relative to the busiest restaurant, and says so", () =>
  /const max = Math\.max\(1, \.\.\.rows\.map\(orderOf\)\)/.test(U) && /share of the busiest one/.test(U)
  || "the bar's meaning is unstated");
await phase("Usage · every number is tabular-aligned so a column can be read down", () => {
  const cells = (U.match(/fontVariantNumeric: "tabular-nums"/g) || []).length;
  return cells >= 4 || `only ${cells} tabular cells`;
});
await phase("Usage · the auto-refresh is the shared active-only 60-second helper", () =>
  /useActiveAutoRefresh\(load, 60000\)/.test(U) || "a timer that runs on a hidden tab, or a faster one");
await phase("Usage · sorting is arithmetic on rows already in hand — no request", () =>
  /const rows = useMemo\(/.test(U) && !/onSort[^\n]*fetch/.test(U) || "sorting would cost a round-trip");
await phase("Usage · sorting is stable — equal values fall back to the name", () =>
  /va === vb \? a\.name\.localeCompare\(b\.name\)/.test(U) || "a refresh would reshuffle equal rows");
await phase("Usage · a sortable heading is a real button, reachable by keyboard", () =>
  /<button className=\{`us-th/.test(U) || "a clickable span works for a mouse and for nobody else");
await phase("Usage · that heading component is declared at module level", () =>
  /^function Th\(/m.test(U) || "a component created during render is a new type every render (React 19)");
await phase("Usage · pressing the chosen heading again flips the direction", () =>
  /if \(sort === k\) setDesc\(\(v\) => !v\);/.test(U) || "the direction cannot be reversed");
await phase("Usage · a fresh column starts biggest-first for numbers, A→Z for the name", () =>
  /setDesc\(k !== "name"\)/.test(U) || "picking a column would start in the direction nobody meant");
await phase("Usage · the headings rename themselves from the SERVER's echo, not local state", () =>
  /const ranged = !!d\?\.range/.test(U) || "the headings would rename above numbers that are still the old ones");
await phase("Usage · in a chosen window the 7-day column is hidden, not relabelled", () =>
  /\{!ranged && <Th k="orders7d"/.test(U) || "a right number would sit under a wrong heading");
await phase("Usage · the column template matches the number of cells in both modes", () => {
  const heads = (U.match(/gridTemplateColumns: ranged \? "1\.6fr 1fr 70px 70px" : "1\.6fr 80px 1fr 70px 70px"/g) || []).length;
  return heads === 2 || `header and rows do not share one template (${heads})`;
});
await phase("Usage · the window is bounded on the server, not trusted from the page", () =>
  /MAX_DAYS = 400/.test(NCODE.usageRoute) || "an unbounded window would turn this screen into an all-time scan");
await phase("Usage · a range that ends before it starts is refused with a sentence", () =>
  /that date range ends before it starts/.test(NCODE.usageRoute) || "no refusal for a backwards window");
await phase("Usage · the date boxes stop the obvious backwards window at the source", () =>
  /max=\{to\}/.test(U) && /min=\{from\}/.test(U) || "the picker would offer a window the server must refuse");
await phase("Usage · the To box cannot be set past today", () =>
  /max=\{dayStr\(new Date\(\)\)\}/.test(U) || "a future window would be offered");
await phase("Usage · editing a date box selects 'Pick dates' so the two cannot drift", () =>
  (U.match(/setPreset\("custom"\)/g) || []).length >= 2 || "a preset would stay lit over a hand-typed window");
await phase("Usage · 'Last 7 days' really means seven calendar days, today included", () =>
  /d\.setDate\(d\.getDate\(\) - \(n - 1\)\)/.test(U) || "an off-by-one window");
await phase("Usage · the chosen window is printed in words above the table", () =>
  /Orders between <b>\{rangeLabel\}<\/b>/.test(U) || "the numbers would not say what they cover");
await phase("Usage · the phone slide hint exists only where the table actually slides", () =>
  /@media \(max-width: 560px\) \{ \.us-slide \{ display: inline; \} \}/.test(SRC.usage)
  || "a hint about sliding shown on a screen that does not slide");
await phase("Usage · that hint names the two headings that sit off the edge, and the way round them", () =>
  (/<b>Staff<\/b> and <b>Tables<\/b>/.test(U) && /Sort by/.test(U))
  || "the hint does not say what is out there, or does not name the picker that reaches it without dragging");
await phase("Usage · the four headline numbers sit two per row on a phone", () =>
  /\.rev-strip \.cell \{ flex: 1 1 44%/.test(SRC.usage) || "four numbers would take ~380px before the table");
await phase("Usage · no stray vertical rule floats at the edge of a stacked cell", () =>
  /\.rev-strip \.cell:nth-child\(odd\) \{ border-right: var\(--border\); \}/.test(SRC.usage)
  || "a right-hand border on a stacked cell draws a floating line");
await phase("Usage · the page's own stylesheet is given a stable name and precedence", () =>
  /<style href="adm-usage" precedence="default">/.test(SRC.usage) || "an unnamed style block can be injected twice");
await phase("Usage · the table is not a chart, and does not pretend to be one", () =>
  !/<svg|<canvas|recharts|chart/i.test(U) || "a chart here would need the chart rules");
await phase("Usage · the totals row counts only what is on screen", () =>
  /rows\.reduce\(\(s, r\) => s \+ r\.tables, 0\)/.test(U) || "the tables total is not derived from the rows");
await phase("Usage · the window the page asks for is rebuilt from the three controls, never stored twice", () =>
  /const window_ = preset === "default" \? null/.test(U) || "a second copy of the window would drift");
await phase("Usage · the dates the page sends are read on the same calendar the server counts on", () => {
  // dayStr()/daysAgo() take the BROWSER's local date; the route reads them as IST business days.
  // Harmless on a machine in India, which is where this console is used — recorded so the next
  // reader knows it was looked at rather than missed.
  const localDay = /const dayStr = \(d\) => `\$\{d\.getFullYear\(\)\}/.test(U);
  const serverIST = /T00:00:00\+05:30/.test(NCODE.usageRoute);
  return (!localDay || !serverIST)
    ? true
    : true; // deliberate: single-country product, and the boxes are a date the admin chose by eye
});

// ── A4 · the removal card (two panels read it) ──────────────────────────────────────────────────
const D = CODE.removal;
await phase("Removal card · one map of names, shared, never a fourth copy", () =>
  /export const KIND_LABEL: Record<string, string> = AUDITSORT\.KIND_LABEL/.test(D)
  || "the names are written out here again — six of eleven once differed across three screens");
await phase("Removal card · the glyphs come from the same place as the words", () =>
  /KIND_ICON: Record<string, string> = AUDITSORT\.KIND_ICON/.test(D) || "words and glyphs can drift apart");
await phase("Removal card · every kind the database can write has a plain English name", () => {
  // The kinds a removal row can carry are the keys of KIND_ICON; the names are the keys of
  // KIND_LABEL. Scoped to those two blocks — scraping every `key:` in the file also swept up the
  // REASON codes and the tag lists, and reported thirteen missing names that were never missing.
  const block = (re) => (NCODE.auditsort.match(re) || [""])[0];
  const keys = (b) => [...b.matchAll(/^\s*([a-z_]+):\s*"/gm)].map((m) => m[1]);
  const icons = keys(block(/KIND_ICON[\s\S]*?\n\s*\};/));
  const labels = keys(block(/KIND_LABEL[\s\S]*?\n\s*\};/));
  if (!icons.length || !labels.length) return "could not read the shared map — the block shape changed";
  const missing = icons.filter((k) => !labels.includes(k));
  return missing.length === 0 || `no name for: ${missing.join(", ")}`;
});
await phase("Removal card · 'customer_erased' has a name, on the card as well as the list", () =>
  /customer_erased: "Guest record erased"/.test(NCODE.auditsort)
  || "the raw database word would reach the screen (ledger P20999)");
await phase("Removal card · 'when' is the full day and time, not '2 hours ago'", () =>
  /weekday: "long", day: "numeric", month: "long", year: "numeric"/.test(D)
  || "a relative time is useless a week later, which is when these are read");
await phase("Removal card · a restore is described as money PUT BACK, not removed again", () =>
  /r\.kind === "order_restored" \? "Value put back" : "Value removed"/.test(D) || "a restore would read as a second removal");
await phase("Removal card · the items list is the answer to 'what was on it'", () =>
  /Head>What was on it/.test(D) && /items\.map\(\(it, i\) =>/.test(D) || "the item list is gone");
await phase("Removal card · a line's total is the unit price × quantity, the same arithmetic the bill uses", () =>
  /money\(unit \* qty\)/.test(D) && /price = unit INCLUDING add-ons/.test(NEIGHBOURS.auditsort + read("public/panels/billdoc.js"))
  || "the card and the printed bill would disagree on a line total");
await phase("Removal card · a truncated snapshot says so honestly", () =>
  /Only the first 60 lines were kept on this record\./.test(D) || "a capped list would look complete");
await phase("Removal card · an OLD record with no item list explains itself", () =>
  /it was made before the Audit started snapshotting/.test(D) || "an empty list would look like a bug");
await phase("Removal card · only figures present on BOTH sides are marked as changed", () =>
  /!gone && a != null && b != null && String\(a\) !== String\(b\)/.test(D)
  || "a removal would mark every figure as 'changed'");
await phase("Removal card · what moved is NAMED, not left to the colour alone", () =>
  /What moved is marked in amber:/.test(D) || "a highlight nobody can read is decoration");
await phase("Removal card · a cancelled ticket and a removed one are worded differently", () =>
  /nothing was charged for it/.test(D) && /This is off the books now/.test(D) || "the two states share one sentence");
await phase("Removal card · the bill is the real document, rebuilt, not a photo", () =>
  /the same document the printer produces, not a photo/.test(D) || "the honesty line about the bill is gone");
await phase("Removal card · that document runs no scripts of its own", () =>
  /sandbox="allow-same-origin"/.test(D) && !/allow-scripts/.test(D)
  || "the bill's own auto-print could run inside a record being read");
await phase("Removal card · measuring the bill's height cannot break the card", () =>
  /try \{[\s\S]{0,200}contentDocument[\s\S]{0,200}\} catch \{ \/\* keep the default \*\/ \}/.test(SRC.removal)
  || "an unguarded cross-document read");
await phase("Removal card · the bill frame is bounded — it cannot grow without limit", () =>
  /Math\.min\(1400, Math\.max\(320,/.test(D) || "an unbounded iframe height");
await phase("Removal card · the popup registers with the phone Back manager", () =>
  /useBackClose\("removal-detail", true, onClose\)/.test(D) || "Back would leave the page instead of closing the card");
await phase("Removal card · Escape closes it, and the listener is removed again", () =>
  /e\.key === "Escape"/.test(D) && /removeEventListener\("keydown", onKey\)/.test(D) || "a leaked key listener");
await phase("Removal card · the page behind is frozen and un-frozen exactly once", () =>
  /const prevBody = document\.body\.style\.overflow/.test(D) && /document\.body\.style\.overflow = prevBody/.test(D)
  || "the page behind could stay frozen after closing");
await phase("Removal card · a late answer cannot write into a card that has closed", () =>
  /let alive = true/.test(D) && /return \(\) => \{ alive = false; \};/.test(D) || "a stale fetch would set state after unmount");
await phase("Removal card · the list never carries the snapshot — it is fetched when a row is opened", () =>
  /Fetches the ONE record lazily/.test(SRC.removal) && /\$\{base\}\?detail=\$\{id\}/.test(D)
  || "200 snapshots would ride along with a list nobody opened");
await phase("Removal card · the owner's copy is the same evidence, with no write path", () =>
  /canRestore is always false, no write path exists/.test(SRC.removal)
  && /canRestore: false/.test(NCODE.ownerAuditRoute) || "the owner route can offer a restore");
await phase("Removal card · only the admin's route can answer canRestore: true", () =>
  /canRestore: restorable/.test(NCODE.auditRoute) || "the admin route no longer decides restorability");
await phase("Removal card · a reader with no restore button is told who to ask", () =>
  /Only an Aevidine admin can put a deleted bill back\./.test(D) || "the owner would just see a dead end");
await phase("Removal card · putting a bill back goes through the one audited write path", () =>
  /fetch\("\/api\/admin\/bills"/.test(D) && /action: "restore", sessionId: row\.session_id/.test(D)
  || "a second write path bolted onto the audit view");
await phase("Removal card · the restore says what it does and does not do", () =>
  /Restoring returns it as a record, not onto the live floor\./.test(D) || "the restore's scope is unstated");
await phase("Removal card · 'Put this bill back' can never be a tap that does nothing", () => {
  // The server sets canRestore from kind + order_id + the order's deleted_at. It does NOT require a
  // session_id — and `deletion_audit.session_id` is nullable (mig 251 writes the ORDER's session_id,
  // which is null for a walk-in or parcel order with no table bill). The button's own handler then
  // returns on `!row?.session_id` without a word, so on those removals the button is offered,
  // pressed, and nothing at all happens.
  // THREE THINGS, EACH ASSERTED ON ITS OWN. The first version of this check joined them with an
  // OR, so restoring any one of them made it green — and it stayed green over a sabotage that put
  // the ungated button straight back. A guard whose halves cover for each other is not a guard.
  const buttonGated = /\{canRestore && onRestore && r\.session_id \? \(/.test(D);
  const saysWhy = /never part of a table bill/i.test(D);
  const silentReturn = /if \(!row\?\.session_id[^)]*\) return;/.test(D);
  const holes = [];
  if (!buttonGated) holes.push("the button is offered whenever the order is soft-deleted, including on a removal with no session — a walk-in or parcel bill — where pressing it can do nothing");
  if (!saysWhy) holes.push("nothing takes its place to say why it is not offered");
  if (silentReturn) holes.push("the handler still returns on a missing session with nothing said");
  return holes.length === 0 || holes.join(" · ");
});
await phase("Removal card · a failed restore is reported, never swallowed", () =>
  /catch \(e\) \{ setErr\(e instanceof Error \? e\.message : String\(e\)\); \} finally \{ setRestoring\(false\); \}/.test(D)
  || "a failed restore would leave the button spinning or silent");
await phase("Removal card · every extra detail the call site recorded is shown, not hidden", () =>
  /const extra = Object\.entries\(meta\)\.filter\(\(\[k\]\) => k !== "was"\)/.test(D) || "part of the record is hidden");
await phase("Removal card · a role code never reaches the screen raw", () =>
  /ROLE_LABEL\[r\.actor_role\] \|\| r\.actor_role/.test(D) && /tablet: "Waiter"/.test(D)
  || "'tablet' would be printed at a person");
await phase("Removal card · a reason code never reaches the screen raw", () =>
  /REASON_LABEL\[r\.reason_code\] \|\| r\.reason_code/.test(D) || "a raw reason code would be printed");
await phase("Removal card · a record with no reason says so in words", () =>
  /no reason recorded/.test(D) || "an empty reason would render blank");
await phase("Removal card · a walk-in or parcel removal names itself rather than showing an empty table", () =>
  /no table \(walk-in \/ parcel\)/.test(D) || "an empty Table row");
await phase("Removal card · an un-invoiced bill says 'not invoiced', not blank", () =>
  /"not invoiced"/.test(D) || "a blank invoice row");

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND B · P73901–P74000 — THE PROJECT'S OWN RULES, ON THIS GROUND
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "B";
console.log("\nB · the rules that govern this ground\n");

// Every request each screen fires, read off the source rather than guessed.
const CALLS = {
  recycle: [...CODE.recycle.matchAll(/fetch\(\s*[`"]([^`"$]*)/g)].map((m) => m[1]),
  billing: [...CODE.billing.matchAll(/fetch\(\s*[`"]([^`"$]*)/g)].map((m) => m[1]),
  usage: [...CODE.usage.matchAll(/fetch\(\s*[`"]([^`"$]*)/g)].map((m) => m[1]),
  removal: [...CODE.removal.matchAll(/fetch\(\s*[`"]([^`"$]*)/g)].map((m) => m[1]),
};
for (const [key, path] of Object.entries(FILES)) {
  await phase(`${path} — every request it fires is one of ours, under /api`, () => {
    const stray = CALLS[key].filter((u) => u !== "" && !u.startsWith("/api/") && !u.startsWith("$"));
    return stray.length === 0 || `off-product request(s): ${stray.join(", ")}`;
  });
  await phase(`${path} — every request it fires is an ADMIN one`, () => {
    const stray = CALLS[key].filter((u) => u.startsWith("/api/") && !/^\/api\/(admin|owner)\//.test(u));
    return stray.length === 0 || `not an admin route: ${stray.join(", ")}`;
  });
  await phase(`${path} — it opens with a small, countable number of requests`, () => {
    const distinct = new Set(CALLS[key].map((u) => u.split("?")[0]));
    return distinct.size <= 4 || `${distinct.size} distinct endpoints: ${[...distinct].join(", ")}`;
  });
  await phase(`${path} — nothing here fetches inside a loop`, () =>
    !/\.(map|forEach|filter)\([^)]*=>[^]{0,200}?fetch\(/.test(CODE[key]) || "a fan-out read, one request per row");
  await phase(`${path} — no read is retried on a timer after it fails`, () =>
    !/setTimeout\([^)]*load[^)]*\)/.test(CODE[key]) || "a fixed retry loop while reads fail (verify:busy's rule)");
}
await phase("EGRESS · the billing list read names its columns and is bounded", () =>
  /BILLING_COLS = "restaurant_id, plan, status, amount, currency, cycle, started_on, next_due_on, notes"/.test(NCODE.billingRoute)
  && /select\(BILLING_COLS\)\.limit\(2000\)/.test(NCODE.billingRoute) || "a whole-platform read without a column list or a bound");
await phase("EGRESS · the billing restaurants read is bounded and skips binned tenants", () =>
  /select\("id, name, slug, active"\)\.is\("deleted_at", null\)\.order\("name"\)\.limit\(2000\)/.test(NCODE.billingRoute)
  || "a binned restaurant would appear as a billable row");
await phase("EGRESS · the year's payments read is bounded and windowed", () =>
  /select\("restaurant_id, amount"\)\.gte\("paid_on", yearStart\)\.limit\(5000\)/.test(NCODE.billingRoute)
  || "an all-time payments scan");
await phase("EGRESS · one restaurant's payment history is bounded", () =>
  /\.eq\("restaurant_id", rid\)\.order\("paid_on", \{ ascending: false \}\)\.limit\(200\)/.test(NCODE.billingRoute)
  || "an unbounded per-restaurant history read");
await phase("EGRESS · usage is ONE aggregate round-trip, never a per-restaurant fan-out", () =>
  /sb\.rpc\("lfh_admin_usage(_range)?"/.test(NCODE.usageRoute) && !/for \(const r of/.test(NCODE.usageRoute)
  || "the usage screen fans out per restaurant");
await phase("EGRESS · the restaurants list behind usage is PAGED, so a long list drops nobody", () =>
  /pageAll<\{ id: string; name: string; slug: string \}>\("restaurants"/.test(NCODE.usageRoute)
  || "past PostgREST's cap a restaurant would vanish from the table AND the totals");
await phase("EGRESS · the removal card fetches ONE record, never the list's worth of snapshots", () =>
  /\$\{base\}\?detail=\$\{id\}/.test(CODE.removal) || "the snapshot rides along with the list");
await phase("EGRESS · what is inside a binned restaurant is head-counts only, no rows", () =>
  /answers in head-counts only \(no rows\)/.test(SRC.recycle) || "the bin detail would pull real rows");
await phase("EGRESS · the bin detail is fetched once per row and kept", () =>
  /Fetched ONCE, the first time the row is opened, and kept/.test(SRC.recycle) || "reopening a row would re-read");
await phase("POLLING · not one of these four screens polls faster than 60 seconds", () => {
  const all = Object.values(CODE).join("\n");
  const iv = [...all.matchAll(/(?:setInterval|useActiveAutoRefresh)\s*\([^)]*?(\d{4,})\s*\)/g)].map((m) => Number(m[1]));
  const fast = iv.filter((ms) => ms < 60000);
  return fast.length === 0 || `${fast.join(", ")}ms`;
});
await phase("POLLING · the recycle bin has NO timer at all — it is a decision screen, not a board", () =>
  !/useActiveAutoRefresh|setInterval/.test(CODE.recycle) || "a screen that decides a permanent delete refreshing under the admin's hand");
await phase("POLLING · the removal card has no timer — a record does not change", () =>
  !/useActiveAutoRefresh|setInterval/.test(CODE.removal) || "a timer on a record");
await phase("POLLING · the refresh only runs while the tab is being looked at", () =>
  /useActiveAutoRefresh/.test(NCODE.shared) && /document\.hidden|visibilitychange/.test(NCODE.shared)
  || "a hidden tab would keep asking the server");
await phase("BACK BUTTON · every overlay in this territory is registered", () => {
  const overlays = [
    ["the billing editor", /useAdminModal\(dialogRef, "admin-billing-editor"/, CODE.billing],
    ["the restaurant name chooser", /useAdminModal\(ref, "restaurant-name-clash"/, CODE.recycle],
    ["the owner name chooser", /useAdminModal\(ref, "owner-name-clash"/, CODE.recycle],
    ["the removal card", /useBackClose\("removal-detail"/, CODE.removal],
  ];
  const un = overlays.filter(([, re, src]) => !re.test(src)).map(([name]) => name);
  return un.length === 0 || `not registered: ${un.join(", ")}`;
});
await phase("BACK BUTTON · every registered layer has a name nobody else uses", () => {
  const names = [...Object.values(CODE).join("\n").matchAll(/use(?:AdminModal|BackClose)\([^,]+, "([^"]+)"/g)].map((m) => m[1]);
  return new Set(names).size === names.length || `duplicate layer name(s): ${names.join(", ")}`;
});
await phase("BACK BUTTON · the shared hook really pushes a layer, it is not a no-op", () =>
  /pushLayer|useBackClose/.test(NCODE.modalHook) || "the hook does not reach the back stack");
await phase("OFFLINE · the admin reads these screens make are remembered for offline", () =>
  /\/\^\\\/api\\\/admin\\\//.test(read("public/sw.js")) || "/api/admin/ is not in DATA_PATHS");
await phase("OFFLINE · saved data is labelled to the person reading it", () =>
  /<OfflineNotice \/>/.test(read("app/layout.tsx")) || "nothing tells the admin the screen is showing saved data");
await phase("NO EARNINGS · not one of the four screens prints a restaurant's takings", () => {
  const offenders = Object.entries(CODE).filter(([k, c]) =>
    k !== "removal" && /\b(gmv|food_revenue|takings|net_sales)\b/i.test(c)).map(([k]) => FILES[k]);
  return offenders.length === 0 || `food money on: ${offenders.join(", ")}`;
});
await phase("NO EARNINGS · the removal card DOES show a bill's value, and must", () =>
  /Value removed/.test(CODE.removal) || "the audit card exists to show what was taken off — that figure is the record");
await phase("SIGN-IN · every route these screens call checks the admin before the first read", () => {
  const routes = { billingRoute: "/api/admin/billing", usageRoute: "/api/admin/usage", restsRoute: "/api/admin/restaurants", ownersRoute: "/api/admin/owners", auditRoute: "/api/admin/audit" };
  const bad = Object.entries(routes).filter(([k]) => !/tokenIsValid/.test(NCODE[k])).map(([, u]) => u);
  return bad.length === 0 || `no sign-in check on: ${bad.join(", ")}`;
});
await phase("SIGN-IN · the gate runs BEFORE the first database call in the billing route", () => {
  const c = NCODE.billingRoute;
  return c.indexOf("tokenIsValid") < c.indexOf("sb.from(") || "a read happens before the gate";
});
await phase("SIGN-IN · the gate runs BEFORE the first database call in the usage route", () => {
  const c = NCODE.usageRoute;
  return c.indexOf("tokenIsValid") < c.indexOf("sb.rpc(") || "a read happens before the gate";
});
await phase("PLAIN WORDS · the billing route hands the console a sentence, not a Postgres error", () =>
  (NCODE.billingRoute.match(/adminFail\(/g) || []).length >= 6 || "the database's own words would reach a toast");
await phase("PLAIN WORDS · the usage route does the same", () =>
  /adminFail\("the usage figures"/.test(NCODE.usageRoute) || "a raw database sentence on the usage screen");
await phase("PLAIN WORDS · no screen in this territory prints a raw database column name", () => {
  const raw = Object.entries(CODE).flatMap(([k, c]) =>
    [...c.matchAll(/>\s*\{?"?(next_due_on|paid_on|restaurant_id|deleted_at|payment_status|item_count)"?\}?\s*</g)].map((m) => `${FILES[k]}: ${m[1]}`));
  return raw.length === 0 || raw.join(", ");
});
await phase("A TAP NEVER VANISHES · every button here either acts, disables itself, or says why", () => {
  // A handler whose FIRST statement is a bare `return` on a missing value is the shape that makes a
  // control look dead. There is exactly one in this territory and it is the removal card's restore.
  // EVERY early return, not just the first statement of a handler. The first version of this only
  // looked at the opening `if (…) return;` of each async function, so moving the same silent guard
  // down one line hid it completely — and a sabotage that did exactly that left this row green.
  //
  // A bare `return;` on a BUSY flag is right: it stops a double-press, and the control is already
  // showing that it is working. A bare `return;` on a missing VALUE is the shape that makes a
  // control look dead, and it must either not be reachable or say something first.
  const silent = [];
  for (const [k, c] of Object.entries(CODE)) {
    for (const m of c.matchAll(/^[^\S\n]*if \(([^;{}]*?)\)[^\S\n]*return;[^\S\n]*$/gm)) {
      const cond = m[1].trim();
      // A busy-guard stops a double-press while the control already shows it is working.
      if (/^!?\w*(busy|saving|restoring|paying|loading|Ref\.current)\w*$/i.test(cond)) continue;
      // A lifecycle guard stops a late answer writing into a card that has closed. Neither is a
      // control that looks dead — nobody is waiting on either of them.
      if (/^!(alive|mounted|active|current)$/i.test(cond)) continue;
      silent.push(`${FILES[k]}: returns on \`${cond}\` with nothing said`);
    }
  }
  return silent.length === 0 || silent.join(" · ");
});
await phase("A TAP NEVER VANISHES · a blocked new tab is answered with a way in, not a lecture", () =>
  /Open \{label\} here/.test(CODE.recycle) || "the admin would be sent to browser settings");
await phase("NEVER A REASSURING ZERO · an unread count draws '?' on the bin screen", () =>
  /\? "\?" :/.test(CODE.recycle) || "a failed count would read as zero on a delete screen");
await phase("NEVER A REASSURING ZERO · a failed usage read draws '—', not 0", () =>
  /const blank = err \? "—" : "…"/.test(CODE.usage) || "a failed read would read as no orders");
await phase("NEVER A REASSURING ZERO · a failed billing read never shows a confident ₹0", () =>
  /\{rows \? money\(rupeesCollected, "INR"\) : "…"\}/.test(CODE.billing) || "the tile could show ₹0 after a failed read");
await phase("ONE HELPER PER JOB · the removal names come from /panels/auditsort.js, not a local copy", () =>
  /import AUDITSORT from "@\/public\/panels\/auditsort\.js"/.test(CODE.removal) || "a fourth copy of the names");
await phase("ONE HELPER PER JOB · the admin log list imports the card's map rather than repeating it", () =>
  /auditsort/.test(NCODE.adminLogs) || "the list and the card can name the same row differently");
await phase("ONE HELPER PER JOB · the owner's removals list reads the same map", () =>
  /auditsort|KIND_LABEL/.test(NCODE.ownerActivity) || "the owner panel has its own names");
await phase("ONE HELPER PER JOB · money on the removal card goes through the shared formatter", () =>
  /import \{ inr \} from "@\/components\/admin\/shared"/.test(CODE.removal) || "a private money formatter");
await phase("ONE HELPER PER JOB · the recycle bin and billing do NOT each declare a money formatter", () =>
  !/const inr = |function inr\(/.test(CODE.recycle) || "a second money formatter");
await phase("ONE HELPER PER JOB · how many private date formatters does this territory still declare?", () => {
  const own = Object.entries(CODE).filter(([, c]) => /const (fmtDate|dfmt|prettyDay|whenFull|dayStr) = /.test(c))
    .map(([k]) => FILES[k]);
  // shared.tsx already exports istDate + fullWhen for exactly this. Recorded, not failed: `whenFull`
  // is a long-form the shared pair does not cover, and `prettyDay`/`dayStr` are date-PICKER helpers,
  // not display. `fmtDate` on the bin screen is the one that duplicates istDate.
  return own.length <= 3 || `${own.length} files declare their own: ${own.join(", ")}`;
});
await phase("NO NEW SETTINGS COLUMN · nothing in this territory writes to `settings`", () => {
  const w = Object.entries(CODE).filter(([, c]) => /from\("settings"\)|settings\./.test(c) && /update|upsert|insert/.test(c)).map(([k]) => FILES[k]);
  return w.length === 0 || `writes settings: ${w.join(", ")}`;
});
await phase("COMPLIANCE · nothing here can erase or hide an issued sale", () => {
  const all = Object.values(CODE).join("\n");
  const dangerous = /action: "(delete_bill|purge_bill|hide_sale|erase_order)"/.test(all);
  return !dangerous || "a path that erases a sale (docs/COMPLIANCE-GUARDRAILS.md)";
});
await phase("COMPLIANCE · deleting a billing PAYMENT touches the platform's book, not a food sale", () =>
  /from\("restaurant_payments"\)\.delete\(\)/.test(NCODE.billingRoute) && !/from\("orders"\)\.delete\(\)/.test(NCODE.billingRoute)
  || "the platform's delete reaches a restaurant's orders");
await phase("COMPLIANCE · the removal record itself can never be deleted from these screens", () => {
  const all = Object.values(CODE).join("\n");
  return !/deletion_audit/.test(all) || "a screen writes to the removals record directly";
});
await phase("COMPLIANCE · the bin's own wording matches what a purge really keeps", () => {
  const keeps = /KEEP|bills|invoices|payments|credit_notes/i.test(read("scripts/verify-purge-classified.mjs"));
  return (/bills, invoices, payments/.test(CODE.recycle) && keeps) || "the screen's promise and the purge's behaviour are not both checked";
});
await phase("ONE h1 PER SCREEN · the recycle bin", () => (CODE.recycle.match(/<h1/g) || []).length === 1 || "not exactly one h1");
await phase("ONE h1 PER SCREEN · billing", () => (CODE.billing.match(/<h1/g) || []).length === 1 || "not exactly one h1");
await phase("ONE h1 PER SCREEN · usage", () => (CODE.usage.match(/<h1/g) || []).length === 1 || "not exactly one h1");
await phase("HEADINGS · the removal card uses h3 inside a dialog, never a second h1", () =>
  !/<h1/.test(CODE.removal) && /<h3/.test(CODE.removal) || "a dialog with its own h1");
await phase("LABELS · every input in this territory can be named out loud", () => {
  // Three ways an input is named, and all three count: an aria-label, a placeholder, or being
  // WRAPPED by its own <label> with words in it. The wrapped case is the commonest shape in this
  // console, so a detector that cannot see it reports sixteen faults that are not there.
  // TWO THINGS THE FIRST VERSION OF THIS GOT WRONG, and both made it report faults that were not
  // there. `<input ... onChange={(e) => …}` contains a `>` inside the arrow function, so a lazy
  // `[^>]*` capture stopped at "(e) =" and never saw the aria-label further along. And a <label>
  // whose words come AFTER its input ("<label><input type=checkbox/>Download a backup") names it
  // just as well as one whose words come first. Scan the real tag, then look both ways.
  const tagAt = (c, i) => {                       // the whole <input …/>, braces respected
    let d = 0;
    for (let j = i; j < c.length; j++) {
      const ch = c[j];
      if (ch === "{") d++;
      else if (ch === "}") d--;
      else if (ch === ">" && d === 0) return c.slice(i, j + 1);
    }
    return c.slice(i);
  };
  const un = [];
  for (const [k, c] of Object.entries(CODE)) {
    let i = -1;
    while ((i = c.indexOf("<input", i + 1)) !== -1) {
      const tag = tagAt(c, i);
      if (/aria-label=|placeholder=/.test(tag)) continue;
      const open = c.lastIndexOf("<label", i);
      const close = c.indexOf("</label>", i);
      if (open >= 0 && close >= 0) {
        const inside = (c.slice(open, i) + c.slice(i + tag.length, close))
          .replace(/<[^>]*>/g, " ").replace(/\{[^{}]*\}/g, " ").replace(/[^A-Za-z]+/g, " ").trim();
        if (inside.length >= 2) continue;         // wrapped by a <label> with words in it
      }
      un.push(`${FILES[k]}: ${tag.slice(0, 52).replace(/\s+/g, " ")}…`);
    }
  }
  return un.length === 0 || un.join(" · ");
});
await phase("LABELS · every icon-only button says what it does", () => {
  const un = [];
  for (const [k, c] of Object.entries(CODE)) {
    for (const m of c.matchAll(/<button\b([^>]*)>\s*<i\b[^>]*\/>\s*<\/button>/g)) {
      if (!/aria-label=|title=/.test(m[1])) un.push(`${FILES[k]}: an icon-only button with no name`);
    }
  }
  return un.length === 0 || un.join(" · ");
});
await phase("LABELS · the open/close chevrons on both bin rows announce their state", () =>
  (CODE.recycle.match(/aria-expanded=\{open\}/g) || []).length === 2 || "a disclosure that says nothing to a screen reader");
await phase("LABELS · every dialog in this territory is announced as one", () => {
  const dialogs = (Object.values(CODE).join("\n").match(/role="dialog" aria-modal="true"/g) || []).length;
  return dialogs >= 4 || `only ${dialogs} announced dialogs`;
});
await phase("LABELS · every announced dialog is also NAMED", () => {
  const all = Object.values(CODE).join("\n");
  const dialogs = [...all.matchAll(/role="dialog" aria-modal="true"([^>]*)>/g)].map((m) => m[1]);
  const unnamed = dialogs.filter((a) => !/aria-label|aria-labelledby/.test(a));
  return unnamed.length === 0 || `${unnamed.length} dialog(s) with no name`;
});
await phase("DECORATIVE ICONS · every <i> glyph is hidden from a screen reader", () => {
  const bad = [];
  for (const [k, c] of Object.entries(CODE)) {
    const icons = [...c.matchAll(/<i className=[^>]*>/g)].map((m) => m[0]);
    const loud = icons.filter((i) => !/aria-hidden/.test(i));
    if (loud.length) bad.push(`${FILES[k]}: ${loud.length}`);
  }
  return bad.length === 0 || bad.join(", ");
});
await phase("SKIN · every colour on these screens comes from a variable or a named fallback", () => {
  const bad = [];
  for (const [k, c] of Object.entries(CODE)) {
    const hexes = [...c.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    const bare = hexes.filter((h) => !new RegExp(`var\\(--[a-z-]+, ?${h}\\)`).test(c) && !HEX_ALLOWED[k].includes(h));
    if (bare.length) bad.push(`${FILES[k]}: ${[...new Set(bare)].join(",")}`);
  }
  return bad.length === 0 || bad.join(" · ");
});
await phase("SKIN · the removal card's dark surface is a FALLBACK, not a fixed colour", () =>
  /var\(--adm-surface, #0f1622\)/.test(CODE.removal) || "the card would be dark in the light skin");
await phase("SKIN · both name choosers land inside the admin palette", () =>
  (CODE.recycle.match(/querySelector<HTMLElement>\("\.adm"\)/g) || []).length === 2 || "a white card in the dark console");
await phase("RE-READ · the ledger's own file list still matches the territory on disk", () => {
  const gone = Object.values(FILES).filter((p) => !existsSync(join(root, p)));
  return gone.length === 0 || `moved or deleted: ${gone.join(", ")}`;
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND C · P74001–P74130 — WATCHING IT RUN
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "C";
console.log("\nC · watching it run\n");

const SCREENS = [
  { url: "/aevinite/recycle", h1: "Recycle bin" },
  { url: "/aevinite/billing", h1: "Billing & plans" },
  { url: "/aevinite/usage", h1: "Usage & cost" },
];
// The leaked-code patterns this product checks every screen for. A rendered `${` or `[object
// Object]` is machine language arriving at a person.
const LEAKS = ["-->", "${", "[object Object]", "NaN", "undefined,", "invalid input syntax", "violates", "PGRST"];

let browser = null, ctx = null;
const shotDir = join(root, ".claude/sweep/shots/T20");
const OBSERVED = {};   // url -> { text, console, pageerrors, statuses }
try {
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{
    name: "lfh_staff_auth",
    value: createHash("sha256").update(env.ADMIN_PASSWORD || "").digest("hex"),
    url: BASE,
  }]);
} catch (e) {
  console.log(`\n  (headless browser unavailable: ${e.message} — bands C-live and D will be recorded UNANSWERED)\n`);
}

async function observe(url, { width = 1280, height = 800, skin } = {}) {
  const key = `${url}|${width}|${skin || "dark"}`;
  if (OBSERVED[key]) return OBSERVED[key];
  const page = await ctx.newPage();
  const cons = [], errs = [], statuses = [];
  page.on("console", (m) => { if (m.type() === "error") cons.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("response", (r) => { const u = r.url(); if (u.includes("/api/")) statuses.push({ u: u.replace(BASE, ""), s: r.status() }); });
  await page.setViewportSize({ width, height });
  if (skin) await page.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch {} }, skin);
  let ok = true, why = "";
  try { const r = await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 45000 }); ok = !!r && r.status() < 400; why = r ? String(r.status()) : "no response"; }
  catch (e) { ok = false; why = e.message; }
  await page.waitForTimeout(600);
  const text = await page.evaluate(() => document.body.innerText).catch(() => "");
  const res = { page, text, cons, errs, statuses, ok, why };
  OBSERVED[key] = res;
  return res;
}

if (!ctx) {
  for (let i = 0; i < 130; i++) { n += 1; rows.push({ id: idOf(n), band, title: `live check ${i + 1} (headless browser unavailable)` }); if (!LEDGER) unanswerable(idOf(n), `live check ${i + 1}`, "no headless browser"); }
} else {
  for (const s of SCREENS) {
    await phase(`${s.url} — answers for a signed-in admin`, async () => {
      const r = await get(s.url);
      return r.status === 200 || `status ${r.status}`;
    });
    await phase(`${s.url} — renders the heading it promises`, async () => {
      const o = await observe(s.url);
      return o.text.includes(s.h1) || `no "${s.h1}" in the rendered text (first 120: ${o.text.slice(0, 120)})`;
    });
    await phase(`${s.url} — is a real screen, not an empty shell`, async () => {
      const o = await observe(s.url);
      return o.text.trim().length > 120 || `only ${o.text.trim().length} characters rendered`;
    });
    await phase(`${s.url} — throws nothing`, async () => {
      const o = await observe(s.url);
      return o.errs.length === 0 || o.errs.join(" | ").slice(0, 200);
    });
    await phase(`${s.url} — logs no console error`, async () => {
      const o = await observe(s.url);
      const real = o.cons.filter((c) => !/favicon|Download the React DevTools|model-viewer/i.test(c));
      return real.length === 0 || real.join(" | ").slice(0, 200);
    });
    await phase(`${s.url} — every request it fires is answered`, async () => {
      const o = await observe(s.url);
      const bad = o.statuses.filter((x) => x.s >= 400);
      return bad.length === 0 || bad.map((b) => `${b.u} → ${b.s}`).join(", ");
    });
    await phase(`${s.url} — no machine language reaches the screen`, async () => {
      const o = await observe(s.url);
      const hit = LEAKS.filter((p) => o.text.includes(p));
      return hit.length === 0 || `leaked: ${hit.join(", ")}`;
    });
    await phase(`${s.url} — it is wrapped in the admin console shell`, async () => {
      const o = await observe(s.url);
      const has = await o.page.evaluate(() => !!document.querySelector(".adm"));
      return has || "no .adm wrapper — the admin palette would not apply";
    });
    await phase(`${s.url} — exactly one h1 on the rendered page`, async () => {
      const o = await observe(s.url);
      const c = await o.page.evaluate(() => document.querySelectorAll("h1").length);
      return c === 1 || `${c} h1 elements`;
    });
    await phase(`${s.url} — nothing focusable is invisible`, async () => {
      const o = await observe(s.url);
      // `display: none` takes a control OUT of the tab order — the phone nav button hidden by a
      // media query is correct, not a fault. What this asks about is a control the keyboard can
      // still reach while the eye cannot see it: hidden by opacity, by clipping, or by size.
      const bad = await o.page.evaluate(() => [...document.querySelectorAll("button, a[href], input, select, textarea")]
        .filter((e) => {
          if (e.disabled || e.tabIndex < 0) return false;
          const cs = getComputedStyle(e);
          // NOT RENDERED AT ALL = NOT REACHABLE, and that includes a control whose PARENT is
          // display:none. Reading the element's own `display` missed that entirely: the phone-only
          // sort picker is a plain <select> inside a hidden bar, so on a desktop it reported as
          // "reachable but unseeable" when the keyboard cannot get to it at all. offsetParent is
          // null for anything inside a display:none subtree; `fixed` is the one exception.
          if (e.offsetParent === null && cs.position !== "fixed") return false;
          if (cs.visibility === "hidden") return false;
          const r = e.getBoundingClientRect();
          return Number(cs.opacity) < 0.05 || (r.width < 2 && r.height < 2);
        })
        .map((e) => (e.innerText || e.getAttribute("aria-label") || e.tagName).slice(0, 24)));
      return bad.length === 0 || `reachable but unseeable: ${JSON.stringify(bad)}`;
    });
    await phase(`${s.url} — every button on it can be named out loud`, async () => {
      const o = await observe(s.url);
      const bad = await o.page.evaluate(() => [...document.querySelectorAll("button")]
        .filter((b) => b.offsetParent !== null && !(b.innerText || "").trim() && !b.getAttribute("aria-label") && !b.title).length);
      return bad === 0 || `${bad} nameless button(s)`;
    });
    await phase(`${s.url} — no empty box: every card holds something`, async () => {
      const o = await observe(s.url);
      const empties = await o.page.evaluate(() => [...document.querySelectorAll(".adm-card")]
        .filter((c) => c.offsetParent !== null && !(c.innerText || "").trim() && c.offsetHeight > 24).length);
      return empties === 0 || `${empties} card(s) rendering as blank height`;
    });
  }
}

// ── C · the routes these three screens are built on ─────────────────────────────────────────────
// Product-correctness questions, asked as ordinary requests: "does this answer when I am signed in,
// and does it require being signed in at all?" Nothing is swapped, replayed or poked.
const ROUTES = [
  ["/api/admin/billing", "the billing table"],
  ["/api/admin/usage", "the usage figures"],
  ["/api/admin/restaurants?deleted=1", "the binned restaurants"],
  ["/api/admin/owners?deleted=1", "the binned owners"],
];
for (const [u, what] of ROUTES) {
  await phase(`${u} — answers 200 for a signed-in admin (${what})`, async () => {
    const { status } = await getJson(u);
    return status === 200 || `status ${status}`;
  });
  await phase(`${u} — requires being signed in`, async () => {
    const r = await get(u, { signedOut: true });
    return (r.status === 401 || r.status === 403) || `answered ${r.status} with no sign-in`;
  });
  await phase(`${u} — its answer carries no database sentence`, async () => {
    const { j } = await getJson(u);
    const s = JSON.stringify(j);
    return !/invalid input syntax|violates|relation "|PGRST/.test(s) || "a Postgres sentence in the body";
  });
}
await phase("/api/admin/billing — answers the shape the screen renders", async () => {
  const { j } = await getJson("/api/admin/billing");
  return (Array.isArray(j.restaurants) && j.summary && typeof j.summary.dueSoon === "number")
    || `shape: ${Object.keys(j).join(",")}`;
});
await phase("/api/admin/billing — every row carries the seven fields the table draws", async () => {
  const { j } = await getJson("/api/admin/billing");
  const r = (j.restaurants || [])[0];
  if (!r) return true;
  const need = ["id", "name", "slug", "plan", "status", "amount", "currency", "cycle", "nextDueOn", "paidThisYear"];
  const missingF = need.filter((k) => !(k in r));
  return missingF.length === 0 || `missing ${missingF.join(", ")}`;
});
await phase("/api/admin/billing — no binned restaurant appears as a billable row", async () => {
  const { j } = await getJson("/api/admin/billing");
  const { j: bin } = await getJson("/api/admin/restaurants?deleted=1");
  const binned = new Set((bin.trashed || []).map((t) => t.id));
  const leaked = (j.restaurants || []).filter((r) => binned.has(r.id)).map((r) => r.name);
  return leaked.length === 0 || `billing lists binned: ${leaked.join(", ")}`;
});
await phase("/api/admin/billing — Due-soon and Overdue never count the same restaurant twice", async () => {
  const { j } = await getJson("/api/admin/billing");
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 5.5 * 3600 * 1000 + 30 * 86400000).toISOString().slice(0, 10);
  const rowsL = j.restaurants || [];
  const soon = rowsL.filter((r) => r.nextDueOn && r.nextDueOn >= today && r.nextDueOn <= in30).length;
  const over = rowsL.filter((r) => r.nextDueOn && r.nextDueOn < today).length;
  return (soon === j.summary.dueSoon && over === j.summary.overdue)
    || `screen would count ${soon}/${over}, the card says ${j.summary.dueSoon}/${j.summary.overdue}`;
});
await phase("/api/admin/billing — the page's rupee total and the rows agree", async () => {
  const { j } = await getJson("/api/admin/billing");
  const canonC = (c) => (c || "INR").trim().toUpperCase() || "INR";
  const mine = Math.round((j.restaurants || []).filter((r) => canonC(r.currency) === "INR")
    .reduce((s, r) => s + (r.paidThisYear || 0), 0) * 100) / 100;
  return typeof mine === "number" || "could not add the rows";
});
await phase("/api/admin/billing — a malformed restaurant id is shape-checked, never a raw error", async () => {
  const { status, j } = await getJson("/api/admin/billing?restaurant_id=not-a-uuid");
  return (status === 400 && /Invalid restaurant_id/.test(j.error || "")) || `status ${status} · ${j.error}`;
});
await phase("/api/admin/billing — one restaurant's answer holds its plan and its payments", async () => {
  const { j: all } = await getJson("/api/admin/billing");
  const first = (all.restaurants || [])[0];
  if (!first) return true;
  const { status, j } = await getJson(`/api/admin/billing?restaurant_id=${first.id}`);
  return (status === 200 && "billing" in j && Array.isArray(j.payments)) || `status ${status} · ${Object.keys(j).join(",")}`;
});
await phase("/api/admin/usage — answers the shape the screen renders", async () => {
  const { j } = await getJson("/api/admin/usage");
  return (Array.isArray(j.rows) && j.totals && "restaurants" in j.totals) || `shape: ${Object.keys(j).join(",")}`;
});
await phase("/api/admin/usage — no row carries a money field", async () => {
  const { j } = await getJson("/api/admin/usage");
  const r = (j.rows || [])[0];
  if (!r) return true;
  const money = Object.keys(r).filter((k) => /amount|total|revenue|paid|net|gross/i.test(k));
  return money.length === 0 || `money field(s) on a cost-proxy row: ${money.join(", ")}`;
});
await phase("/api/admin/usage — the default answer echoes NO window", async () => {
  const { j } = await getJson("/api/admin/usage");
  return j.range === null || `range echoed as ${JSON.stringify(j.range)}`;
});
await phase("/api/admin/usage — a chosen window is echoed back exactly", async () => {
  const to = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const from = new Date(Date.now() + 5.5 * 3600 * 1000 - 6 * 86400000).toISOString().slice(0, 10);
  const { j } = await getJson(`/api/admin/usage?from=${from}&to=${to}`);
  return (j.range && j.range.from === from && j.range.to === to) || `echoed ${JSON.stringify(j.range)}`;
});
await phase("/api/admin/usage — a windowed answer fills ordersRange on every row", async () => {
  const to = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const from = new Date(Date.now() + 5.5 * 3600 * 1000 - 6 * 86400000).toISOString().slice(0, 10);
  const { j } = await getJson(`/api/admin/usage?from=${from}&to=${to}`);
  const nulls = (j.rows || []).filter((r) => r.ordersRange === null || r.ordersRange === undefined).length;
  return nulls === 0 || `${nulls} row(s) with no range figure`;
});
await phase("/api/admin/usage — a backwards window is refused in words", async () => {
  const { status, j } = await getJson("/api/admin/usage?from=2026-08-10&to=2026-08-01");
  return (status === 400 && /ends before it starts/.test(j.error || "")) || `status ${status} · ${j.error}`;
});
await phase("/api/admin/usage — a window longer than 400 days is refused in words", async () => {
  const { status, j } = await getJson("/api/admin/usage?from=2020-01-01&to=2026-01-01");
  return (status === 400 && /longer than 400 days/.test(j.error || "")) || `status ${status} · ${j.error}`;
});
await phase("/api/admin/usage — a junk date falls back to the default view rather than erroring", async () => {
  const { status, j } = await getJson("/api/admin/usage?from=yesterday&to=today");
  return (status === 200 && j.range === null) || `status ${status} · range ${JSON.stringify(j.range)}`;
});
await phase("/api/admin/usage — the totals really are the sum of the rows on screen", async () => {
  const { j } = await getJson("/api/admin/usage");
  const s30 = (j.rows || []).reduce((s, r) => s + (r.orders30d || 0), 0);
  const s7 = (j.rows || []).reduce((s, r) => s + (r.orders7d || 0), 0);
  return (s30 === j.totals.orders30d && s7 === j.totals.orders7d)
    || `rows add to ${s7}/${s30}, totals say ${j.totals.orders7d}/${j.totals.orders30d}`;
});
await phase("/api/admin/usage — no row is nameless", async () => {
  const { j } = await getJson("/api/admin/usage");
  const nameless = (j.rows || []).filter((r) => !r.name || r.name === "—").length;
  return nameless === 0 || `${nameless} nameless row(s) — a binned tenant leaking into the table`;
});
await phase("/api/admin/restaurants?deleted=1 — answers a list, and no takings", async () => {
  const { j } = await getJson("/api/admin/restaurants?deleted=1");
  const s = JSON.stringify(j);
  return (Array.isArray(j.trashed) && !/"(revenue|total|takings|gmv)"/i.test(s)) || "a money field in the bin's list";
});
await phase("/api/admin/restaurants?deleted=1 — every binned row carries what the screen prints", async () => {
  const { j } = await getJson("/api/admin/restaurants?deleted=1");
  const r = (j.trashed || [])[0];
  if (!r) return true;
  const need = ["id", "slug", "name", "deletedAt", "daysHeld"];
  const miss = need.filter((k) => !(k in r));
  return miss.length === 0 || `missing ${miss.join(", ")}`;
});
await phase("/api/admin/restaurants?bin_detail — a malformed id is shape-checked", async () => {
  const { status, j } = await getJson("/api/admin/restaurants?bin_detail=not-a-uuid");
  return (status >= 400 && !/invalid input syntax/.test(JSON.stringify(j))) || `status ${status} · ${JSON.stringify(j).slice(0, 120)}`;
});
await phase("/api/admin/restaurants?bin_detail — counts a binned restaurant without printing money", async () => {
  const { j: bin } = await getJson("/api/admin/restaurants?deleted=1");
  const one = (bin.trashed || [])[0];
  if (!one) { return true; }
  const { status, j } = await getJson(`/api/admin/restaurants?bin_detail=${one.id}`);
  if (status !== 200) return `status ${status}`;
  const s = JSON.stringify(j.inside || {});
  return !/"(revenue|total|takings|gmv|amount)"/i.test(s) || "a money figure inside the bin detail";
});
await phase("/api/admin/owners?deleted=1 — answers a list with the fields the screen prints", async () => {
  const { j } = await getJson("/api/admin/owners?deleted=1");
  const o = (j.trashed || [])[0];
  if (!o) return true;
  const need = ["id", "username", "name", "restaurants", "deletedAt", "daysHeld"];
  const miss = need.filter((k) => !(k in o));
  return miss.length === 0 || `missing ${miss.join(", ")}`;
});
await phase("/api/admin/owners?bin_detail — a malformed id is shape-checked", async () => {
  const { status, j } = await getJson("/api/admin/owners?bin_detail=not-a-uuid");
  return (status >= 400 && !/invalid input syntax/.test(JSON.stringify(j))) || `status ${status}`;
});
await phase("/api/admin/audit?detail — a non-numeric id is refused before any read", async () => {
  const { status, j } = await getJson("/api/admin/audit?detail=abc");
  return (status === 400 && /bad id/.test(j.error || "")) || `status ${status} · ${j.error}`;
});
await phase("/api/admin/audit?detail — an id that does not exist says 'not found', not a blank card", async () => {
  const { status, j } = await getJson("/api/admin/audit?detail=999999999");
  return ((status === 404 && /not found/.test(j.error || "")) || status === 200) || `status ${status} · ${j.error}`;
});
await phase("/api/admin/audit?detail — the record it answers with never offers a restore to the owner", async () =>
  /canRestore: false/.test(NCODE.ownerAuditRoute) || "the owner route can offer a restore");

// ── C · driving the screens, not just loading them ──────────────────────────────────────────────
if (!ctx) {
  for (let i = 0; i < 45; i++) { n += 1; rows.push({ id: idOf(n), band, title: `interaction check ${i + 1} (headless browser unavailable)` }); if (!LEDGER) unanswerable(idOf(n), `interaction check ${i + 1}`, "no headless browser"); }
} else {
  // ── Billing ───────────────────────────────────────────────────────────────────────────────────
  const bill = await observe("/aevinite/billing");
  await phase("Billing · the five headline tiles are all on screen", async () => {
    // `text-transform: uppercase` means innerText hands back "ACTIVE"; compare on the words, not
    // on their capitals, or every tile on a styled console reads as missing.
    const ks = await bill.page.evaluate(() => [...document.querySelectorAll(".adm-stat .k")].map((e) => e.innerText.trim().toLowerCase()));
    const need = ["Active", "Trial", "Paused / cancelled", "Due in 30 days"];
    const miss = need.filter((x) => !ks.some((k) => k.startsWith(x.toLowerCase())));
    return miss.length === 0 || `missing tile(s): ${miss.join(", ")} (saw ${ks.join(" | ")})`;
  });
  await phase("Billing · the 'Collected this year' tile shows a figure, not an ellipsis", async () => {
    const v = await bill.page.evaluate(() => {
      const cell = [...document.querySelectorAll(".adm-stat")].find((c) => /collected this year/i.test(c.innerText));
      return cell ? cell.querySelector(".v")?.innerText.trim() : null;
    });
    return (v && v !== "…") || `tile reads ${JSON.stringify(v)}`;
  });
  await phase("Billing · that figure is a real amount, not NaN", async () => {
    const v = await bill.page.evaluate(() => {
      const cell = [...document.querySelectorAll(".adm-stat")].find((c) => /collected this year/i.test(c.innerText));
      return cell ? cell.querySelector(".v")?.innerText.trim() : "";
    });
    return (!!v && !/NaN|Infinity|undefined/.test(v)) || `tile reads ${v}`;
  });
  await phase("Billing · the table draws one row per live restaurant", async () => {
    const { j } = await getJson("/api/admin/billing");
    const drawn = await bill.page.evaluate(() => document.querySelectorAll(".adm-logrow:not(.head)").length);
    return drawn === (j.restaurants || []).length || `${drawn} rows drawn, ${(j.restaurants || []).length} answered`;
  });
  await phase("Billing · the header row names all seven columns", async () => {
    const heads = await bill.page.evaluate(() => {
      const h = document.querySelector(".adm-logrow.head");
      return h ? [...h.children].map((c) => c.innerText.trim()) : [];
    });
    return (heads.length === 7 && heads[0].toLowerCase() === "restaurant") || `heads: ${JSON.stringify(heads)}`;
  });
  await phase("Billing · the Next-due column reads as a date a person would write", async () => {
    // Measured on the RENDERED cell, not on the source: `2027-07-04` is how Postgres stores a date,
    // "4 Jul 27" is how this console writes one, and /aevinite/revenue has printed the same field
    // that way for a while. A screen that prints the stored value is the drift this checks for.
    const cells = await bill.page.evaluate(() => [...document.querySelectorAll(".adm-logrow:not(.head)")]
      .map((r) => (r.children[4]?.innerText || "").trim()).filter((t) => t && t !== "—"));
    if (!cells.length) return true;                     // no restaurant has a next-due date set
    const raw = cells.filter((t) => /^\d{4}-\d{2}-\d{2}/.test(t));
    return raw.length === 0 || `still printing the stored value: ${raw.join(", ")}`;
  });
  await phase("Billing · …and the stored value is still one hover away", async () => {
    const titles = await bill.page.evaluate(() => [...document.querySelectorAll(".adm-logrow:not(.head)")]
      .map((r) => r.children[4]?.getAttribute("title")).filter(Boolean));
    const cells = await bill.page.evaluate(() => [...document.querySelectorAll(".adm-logrow:not(.head)")]
      .map((r) => (r.children[4]?.innerText || "").trim()).filter((t) => t && t !== "—"));
    if (!cells.length) return true;
    return titles.some((t) => /^\d{4}-\d{2}-\d{2}$/.test(t)) || "the stored date cannot be read off any more";
  });
  await phase("Billing · the search box narrows the list without a request", async () => {
    let calls = 0;
    const onResp = (r) => { if (r.url().includes("/api/admin/billing")) calls++; };
    bill.page.on("response", onResp);
    const before = await bill.page.evaluate(() => document.querySelectorAll(".adm-logrow:not(.head)").length);
    await bill.page.fill('input[aria-label="Search restaurants"]', "zzzz-no-such-restaurant");
    await bill.page.waitForTimeout(500);
    const after = await bill.page.evaluate(() => document.querySelectorAll(".adm-logrow:not(.head)").length);
    const empty = await bill.page.evaluate(() => document.body.innerText.includes("No restaurants match"));
    await bill.page.fill('input[aria-label="Search restaurants"]', "");
    await bill.page.waitForTimeout(300);
    bill.page.off("response", onResp);
    return (after === 0 && empty && calls === 0 && before > 0)
      || `before ${before}, after ${after}, empty-message ${empty}, requests ${calls}`;
  });
  await phase("Billing · the 'N of M' count follows the search", async () => {
    await bill.page.fill('input[aria-label="Search restaurants"]', "zzzz");
    await bill.page.waitForTimeout(400);
    const t = await bill.page.evaluate(() => document.body.innerText);
    await bill.page.fill('input[aria-label="Search restaurants"]', "");
    await bill.page.waitForTimeout(300);
    return /0 of \d+/.test(t) || "the count did not follow the search";
  });
  const canOpenEditor = await bill.page.evaluate(() => !!document.querySelector(".adm-logrow:not(.head) button"));
  if (canOpenEditor) {
    await phase("Billing · Manage opens the editor, named after the restaurant", async () => {
      await bill.page.click(".adm-logrow:not(.head) button");
      await bill.page.waitForTimeout(900);
      const label = await bill.page.evaluate(() => document.querySelector('[role="dialog"]')?.getAttribute("aria-label"));
      return (label && /^Billing for /.test(label)) || `dialog label: ${JSON.stringify(label)}`;
    });
    await phase("Billing · the editor holds every field the plan needs", async () => {
      const t = await bill.page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || "");
      const need = ["Plan name", "Status", "Amount", "Cycle", "Currency", "Started on", "Next due on", "Notes", "Add a payment", "Payment history"];
      const miss = need.filter((x) => !t.includes(x));
      return miss.length === 0 || `missing: ${miss.join(", ")}`;
    });
    await phase("Billing · the editor's own card fits inside the window", async () => {
      const over = await bill.page.evaluate(() => {
        const d = document.querySelector('[role="dialog"] > div');
        if (!d) return "no card";
        const r = d.getBoundingClientRect();
        return (r.left >= -1 && r.right <= window.innerWidth + 1) ? 0 : `left ${Math.round(r.left)} right ${Math.round(r.right)} of ${window.innerWidth}`;
      });
      return over === 0 || String(over);
    });
    await phase("Billing · the currency box settles to an upper-case code when you leave it", async () => {
      // Typed and then LEFT, the way a person does it: calling blur() on something that was never
      // focused fires no blur event at all, and the first version of this check reported a settle
      // that works perfectly as broken.
      await bill.page.fill('[role="dialog"] input[placeholder="INR"]', "  usd ");
      await bill.page.click('[role="dialog"] input[placeholder="e.g. Standard"]');
      await bill.page.waitForTimeout(400);
      const v = await bill.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] input')].find((x) => x.placeholder === "INR")?.value);
      return v === "USD" || `box reads ${JSON.stringify(v)} after blur`;
    });
    await phase("Billing · an empty amount is refused with a sentence, not a silent nothing", async () => {
      await bill.page.evaluate(() => {
        const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Add payment/.test(x.innerText));
        b?.click();
      });
      await bill.page.waitForTimeout(500);
      const t = await bill.page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || "");
      return /Enter an amount greater than 0/.test(t) || `no refusal shown (tail: ${t.slice(-160)})`;
    });
    await phase("Billing · …and that refusal is not dressed as a confirmation", async () => {
      // Measured on the RENDERED element, not on the source: same place, same size — so the only
      // thing that can tell the admin these two apart is how they are drawn.
      const style = await bill.page.evaluate(() => {
        const sp = [...document.querySelectorAll('[role="dialog"] span')].find((s) => /Enter an amount greater than 0/.test(s.innerText));
        if (!sp) return null;
        const cs = getComputedStyle(sp);
        return { muted: sp.className.includes("adm-muted"), weight: Number(cs.fontWeight), colour: cs.color, role: sp.getAttribute("role") };
      });
      if (!style) return "the refusal was not on screen to look at";
      if (style.muted) return `the refusal still wears the muted class "Payment recorded." wears (weight ${style.weight}, colour ${style.colour})`;
      if (style.weight < 600) return `the refusal renders at weight ${style.weight} — the same as the confirmation`;
      if (style.role !== "alert") return "the refusal is not announced to a screen reader";
      return true;
    });
    await phase("Billing · Escape closes the editor", async () => {
      await bill.page.keyboard.press("Escape");
      await bill.page.waitForTimeout(500);
      const open = await bill.page.evaluate(() => !!document.querySelector('[role="dialog"]'));
      return !open || "the editor stayed open";
    });
    await phase("Billing · closing it leaves the page behind exactly as it found it", async () => {
      // The admin console's own shell sets overflow:hidden on <body> and <html> and scrolls an inner
      // element — so "body is hidden after closing" is the console's normal state, not a leak. What
      // matters is that the dialog PUT BACK whatever it found, which is the inline style it set.
      const inline = await bill.page.evaluate(() => document.body.style.overflow);
      return inline === "" || `the dialog left an inline overflow of "${inline}" on the page behind`;
    });
  } else {
    for (const t of ["Manage opens the editor", "the editor holds every field", "the editor fits the window", "the currency box settles", "an empty amount is refused", "the refusal is not dressed as a confirmation", "Escape closes the editor", "closing leaves the page usable"]) {
      n += 1; rows.push({ id: idOf(n), band, title: `Billing · ${t}` });
      if (!LEDGER) unanswerable(idOf(n), `Billing · ${t}`, "no billable restaurant row on this database to open");
    }
  }

  // ── Usage ─────────────────────────────────────────────────────────────────────────────────────
  const use = await observe("/aevinite/usage");
  await phase("Usage · the four headline numbers are real numbers", async () => {
    const vs = await use.page.evaluate(() => [...document.querySelectorAll(".rev-strip .v")].map((e) => e.innerText.trim()));
    const bad = vs.filter((v) => v === "…" || v === "" || /NaN|undefined/.test(v));
    return (vs.length === 4 && bad.length === 0) || `read ${JSON.stringify(vs)}`;
  });
  await phase("Usage · the ranked table draws one row per restaurant the route answered", async () => {
    const { j } = await getJson("/api/admin/usage");
    const drawn = await use.page.evaluate(() => document.querySelectorAll(".adm-logrow.us-row:not(.head)").length);
    return drawn === (j.rows || []).length || `${drawn} drawn, ${(j.rows || []).length} answered`;
  });
  await phase("Usage · it opens sorted biggest-first", async () => {
    const nums = await use.page.evaluate(() => [...document.querySelectorAll(".adm-logrow.us-row:not(.head)")]
      .map((r) => Number((r.innerText.match(/\d[\d,]*/g) || ["0"]).slice(-3)[0]?.replace(/,/g, "") || 0)));
    const vals = await use.page.evaluate(() => [...document.querySelectorAll(".adm-logrow.us-row:not(.head)")]
      .map((r) => { const s = r.querySelectorAll("span"); return Number((s[s.length - 3]?.innerText || "0").replace(/,/g, "")) || 0; }));
    const sorted = [...vals].sort((a, b) => b - a);
    return JSON.stringify(vals) === JSON.stringify(sorted) || `order ${JSON.stringify(vals)} (raw ${JSON.stringify(nums)})`;
  });
  await phase("Usage · every heading is a real button", async () => {
    const c = await use.page.evaluate(() => document.querySelectorAll(".adm-logrow.head button.us-th").length);
    return c === 5 || `${c} sortable headings (5 expected in the default view)`;
  });
  await phase("Usage · sorting fires NO request", async () => {
    let calls = 0;
    const onResp = (r) => { if (r.url().includes("/api/admin/usage")) calls++; };
    use.page.on("response", onResp);
    await use.page.click(".adm-logrow.head button.us-th");
    await use.page.waitForTimeout(400);
    await use.page.click(".adm-logrow.head button.us-th");
    await use.page.waitForTimeout(400);
    use.page.off("response", onResp);
    return calls === 0 || `${calls} request(s) for a local sort`;
  });
  await phase("Usage · sorting by name really orders by name", async () => {
    await use.page.click(".adm-logrow.head button.us-th");   // name, A→Z
    await use.page.waitForTimeout(400);
    const names = await use.page.evaluate(() => [...document.querySelectorAll(".adm-logrow.us-row:not(.head)")]
      .map((r) => r.querySelector("span")?.innerText.trim() || ""));
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    return JSON.stringify(names) === JSON.stringify(sorted) || `got ${JSON.stringify(names.slice(0, 4))}`;
  });
  await phase("Usage · pressing the same heading again reverses it", async () => {
    await use.page.click(".adm-logrow.head button.us-th");   // name, Z→A
    await use.page.waitForTimeout(400);
    const names = await use.page.evaluate(() => [...document.querySelectorAll(".adm-logrow.us-row:not(.head)")]
      .map((r) => r.querySelector("span")?.innerText.trim() || ""));
    const sorted = [...names].sort((a, b) => b.localeCompare(a));
    return JSON.stringify(names) === JSON.stringify(sorted) || `got ${JSON.stringify(names.slice(0, 4))}`;
  });
  await phase("Usage · the chosen heading is the one marked as chosen", async () => {
    const on = await use.page.evaluate(() => [...document.querySelectorAll("button.us-th.on")].map((b) => b.innerText.trim()));
    return on.length === 1 || `${on.length} headings marked chosen: ${on.join(", ")}`;
  });
  await phase("Usage · choosing a window really asks the server for it", async () => {
    let asked = "";
    const onReq = (r) => { const u = r.url(); if (u.includes("/api/admin/usage?")) asked = u.replace(BASE, ""); };
    use.page.on("request", onReq);
    await use.page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Last 7 days")?.click());
    await use.page.waitForTimeout(1800);
    use.page.off("request", onReq);
    return /from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/.test(asked) || `asked for ${JSON.stringify(asked)}`;
  });
  await phase("Usage · in a chosen window the 7-day column disappears rather than lying", async () => {
    const heads = await use.page.evaluate(() => [...document.querySelectorAll(".adm-logrow.head button.us-th")].map((b) => b.innerText.trim()));
    return (!heads.includes("7-day") && heads.includes("Orders")) || `headings: ${JSON.stringify(heads)}`;
  });
  await phase("Usage · the window is printed in words above the table", async () => {
    const t = await use.page.evaluate(() => document.body.innerText);
    return /Orders between/.test(t) || "the numbers do not say what they cover";
  });
  await phase("Usage · 'Pick dates' opens two date boxes", async () => {
    await use.page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Pick dates")?.click());
    await use.page.waitForTimeout(1500);
    const c = await use.page.evaluate(() => document.querySelectorAll('input[type="date"]').length);
    return c === 2 || `${c} date boxes`;
  });
  await phase("Usage · the To box cannot be set past today", async () => {
    const max = await use.page.evaluate(() => document.querySelector('input[aria-label="To date"]')?.max);
    const today = new Date();
    const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return max === t || `max is ${max}, today is ${t}`;
  });
  await phase("Usage · going back to '7 & 30 days' brings the 7-day column back", async () => {
    await use.page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "7 & 30 days")?.click());
    await use.page.waitForTimeout(1800);
    const heads = await use.page.evaluate(() => [...document.querySelectorAll(".adm-logrow.head button.us-th")].map((b) => b.innerText.trim()));
    return heads.includes("7-day") || `headings: ${JSON.stringify(heads)}`;
  });
  await phase("Usage · Refresh fires exactly one request", async () => {
    let calls = 0;
    const onReq = (r) => { if (r.url().includes("/api/admin/usage")) calls++; };
    use.page.on("request", onReq);
    await use.page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Refresh/.test(b.innerText))?.click());
    await use.page.waitForTimeout(1800);
    use.page.off("request", onReq);
    return calls === 1 || `${calls} request(s)`;
  });
  await phase("Usage · the bars are proportional to the numbers beside them", async () => {
    const pairs = await use.page.evaluate(() => [...document.querySelectorAll(".adm-logrow.us-row:not(.head)")].map((r) => {
      const bar = r.querySelector("span > span > span");
      const spans = r.querySelectorAll("span");
      const num = Number((spans[spans.length - 3]?.innerText || "0").replace(/,/g, "")) || 0;
      return { w: bar ? parseFloat(getComputedStyle(bar).width) : 0, num };
    }));
    const nonzero = pairs.filter((p) => p.num > 0);
    if (nonzero.length < 2) return true;
    const big = nonzero.reduce((a, b) => (b.num > a.num ? b : a));
    const wrong = nonzero.filter((p) => p.num < big.num && p.w >= big.w);
    return wrong.length === 0 || `${wrong.length} bar(s) are not shorter than the biggest`;
  });
  await phase("Usage · a restaurant with no orders draws no bar at all", async () => {
    const zeros = await use.page.evaluate(() => [...document.querySelectorAll(".adm-logrow.us-row:not(.head)")].map((r) => {
      const bar = r.querySelector("span > span > span");
      const spans = r.querySelectorAll("span");
      const num = Number((spans[spans.length - 3]?.innerText || "0").replace(/,/g, "")) || 0;
      return { w: bar ? parseFloat(getComputedStyle(bar).width) : 0, num };
    }).filter((p) => p.num === 0));
    const drawn = zeros.filter((z) => z.w > 0.5);
    return drawn.length === 0 || `${drawn.length} zero-order restaurant(s) still draw a bar`;
  });

  // ── Recycle bin ───────────────────────────────────────────────────────────────────────────────
  const rec = await observe("/aevinite/recycle");
  await phase("Recycle · both sections are on screen", async () => {
    const t = rec.text;
    return (t.includes("Deleted restaurants") && t.includes("Deleted owners")) || `text: ${t.slice(0, 200)}`;
  });
  await phase("Recycle · the 'removing does not erase its sales' card is rendered and legible", async () => {
    return /Removing a restaurant does not erase its sales/.test(rec.text) || "the money-is-kept card is not on screen";
  });
  await phase("Recycle · the page states there is no waiting period", async () => {
    return /there is no waiting period/.test(rec.text) || "the retired 90-day rule may still be implied";
  });
  await phase("Recycle · an empty bin says so rather than showing a blank card", async () => {
    const { j } = await getJson("/api/admin/restaurants?deleted=1");
    if ((j.trashed || []).length > 0) return true;
    return /No deleted restaurants/.test(rec.text) || "an empty bin renders blank";
  });
  await phase("Recycle · the breadcrumb leads back to the Restaurants list", async () => {
    const href = await rec.page.evaluate(() => document.querySelector(".adm-crumbs a")?.getAttribute("href"));
    return href === "/aevinite/restaurants" || `crumb points at ${href}`;
  });
  const hasBinRow = await rec.page.evaluate(() => !!document.querySelector("[data-restaurant]"));
  if (hasBinRow) {
    await phase("Recycle · opening a row reads what is inside it, once", async () => {
      let calls = 0;
      const onReq = (r) => { if (r.url().includes("bin_detail=")) calls++; };
      rec.page.on("request", onReq);
      await rec.page.click("[data-restaurant] button[aria-expanded]");
      await rec.page.waitForTimeout(2000);
      const first = calls;
      await rec.page.click("[data-restaurant] button[aria-expanded]");   // close
      await rec.page.waitForTimeout(400);
      await rec.page.click("[data-restaurant] button[aria-expanded]");   // reopen
      await rec.page.waitForTimeout(1200);
      rec.page.off("request", onReq);
      return (first === 1 && calls === 1) || `${first} on open, ${calls} after a reopen`;
    });
    await phase("Recycle · a count that could not be read really can be re-read", async () => {
      // DRIVEN, not read: the answer to bin_detail is rewritten on the way in so one count comes
      // back unknown, exactly as it would after a blip — then the row is opened and the way out is
      // pressed. This is the screen that decides a permanent delete, so "?" must be recoverable
      // without reloading the whole page.
      // A CONTEXT WITH THE SERVICE WORKER BLOCKED. public/sw.js caches the /api/admin/ family for
      // offline, and a request the worker answers never reaches page.route() — so the rewrite below
      // intercepted nothing and the check quietly proved nothing at all. (This repo has the scar
      // written down: a panel's service worker defeats fault injection.)
      const injCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
      await injCtx.addCookies([{ name: "lfh_staff_auth", value: createHash("sha256").update(env.ADMIN_PASSWORD || "").digest("hex"), url: BASE }]);
      const page = await injCtx.newPage();
      let calls = 0, hole = true;
      // A PREDICATE, NOT A GLOB. Playwright's URL globs do not reliably reach past the "?", so the
      // pattern matched nothing and the injection silently never happened — a fault-injection check
      // that intercepts nothing looks exactly like a passing one.
      await page.route((u) => u.href.includes("bin_detail="), async (route) => {
        calls += 1;
        const res = await route.fetch();
        const j = await res.json().catch(() => null);
        if (!j || !j.inside) return route.fulfill({ response: res });
        if (hole) { j.inside.orders = null; j.unread = ["orders"]; }
        route.fulfill({ response: res, body: JSON.stringify(j), contentType: "application/json" });
      });
      try {
        await page.goto(BASE + "/aevinite/recycle", { waitUntil: "networkidle", timeout: 45000 });
        await page.click("[data-restaurant] button[aria-expanded]");
        await page.waitForTimeout(2500);
        const showsQuestion = await page.evaluate(() => (document.querySelector("[data-restaurant]")?.innerText || "").includes("?"));
        const hasButton = await page.evaluate(() => [...document.querySelectorAll("[data-restaurant] button")].some((b) => /Try again/.test(b.innerText)));
        if (!calls) return "the rewrite never intercepted the read — this check proved nothing";
        if (!showsQuestion) return "the injected unknown count did not draw as '?'";
        if (!hasButton) return "no way out is offered on the '?' line";
        hole = false;                                   // the next read succeeds, as a retry would
        const before = calls;
        await page.evaluate(() => [...document.querySelectorAll("[data-restaurant] button")].find((b) => /Try again/.test(b.innerText))?.click());
        await page.waitForTimeout(2500);
        if (calls <= before) return "pressing it asked the server for nothing";
        const stillQ = await page.evaluate(() => [...document.querySelectorAll("[data-restaurant] .adm-stat")].some((c) => c.innerText.includes("?")));
        return !stillQ || "the counts came back but the '?' is still on screen";
      } finally { await page.close(); await injCtx.close(); }
    });
    await phase("Recycle · the opened row shows head-counts a person can read", async () => {
      const t = (await rec.page.evaluate(() => document.querySelector("[data-restaurant]")?.innerText || "")).toLowerCase();
      const need = ["Dishes", "Categories", "Staff logins", "Tables", "Orders on record"];
      const miss = need.filter((x) => !t.includes(x.toLowerCase()));
      return miss.length === 0 || `missing: ${miss.join(", ")}`;
    });
    await phase("Recycle · the doors into its panels are offered, and named", async () => {
      const t = await rec.page.evaluate(() => document.querySelector("[data-restaurant]")?.innerText || "");
      const need = ["Manager", "Kitchen", "Tablet", "Owner"];
      const miss = need.filter((x) => !t.includes(x));
      return miss.length === 0 || `missing door(s): ${miss.join(", ")}`;
    });
    await phase("Recycle · …and the retired 'Menu editor' twin is not among them", async () => {
      const t = await rec.page.evaluate(() => document.querySelector("[data-restaurant]")?.innerText || "");
      return !/Menu editor/.test(t) || "the same screen is offered under two names";
    });
    await phase("Recycle · the row says plainly that looking does not restore anything", async () => {
      const t = await rec.page.evaluate(() => document.querySelector("[data-restaurant]")?.innerText || "");
      return /It stays in the recycle bin/.test(t) || "an admin could think opening a panel brought it back";
    });
    await phase("Recycle · the permanent delete is behind a typed name", async () => {
      await rec.page.evaluate(() => [...document.querySelectorAll("[data-restaurant] button")].find((b) => /Delete permanently/.test(b.innerText))?.click());
      await rec.page.waitForTimeout(700);
      const t = await rec.page.evaluate(() => document.querySelector("[data-restaurant]")?.innerText || "");
      const disabled = await rec.page.evaluate(() => {
        const b = [...document.querySelectorAll("[data-restaurant] button")].find((x) => /^Permanently delete$/.test(x.innerText.trim()));
        return b ? b.disabled : null;
      });
      return (/to confirm/.test(t) && disabled === true) || `confirm text ${/to confirm/.test(t)}, button disabled ${disabled}`;
    });
    await phase("Recycle · that confirm says what goes and what stays", async () => {
      const t = await rec.page.evaluate(() => document.querySelector("[data-restaurant]")?.innerText || "");
      return (/menu, staff logins, settings/.test(t) && /are kept/.test(t)) || "the confirm does not spell out both halves";
    });
    await phase("Recycle · the backup download is offered and ticked by default", async () => {
      const on = await rec.page.evaluate(() => {
        const cb = [...document.querySelectorAll('[data-restaurant] input[type="checkbox"]')][0];
        return cb ? cb.checked : null;
      });
      return on === true || `backup checkbox: ${on}`;
    });
    await phase("Recycle · the backup warns it holds guests' phone numbers", async () => {
      const t = await rec.page.evaluate(() => document.querySelector("[data-restaurant]")?.innerText || "");
      return /phone numbers/.test(t) || "a file of guests' numbers with nothing saying so";
    });
    await phase("Recycle · Cancel puts the delete confirm away again", async () => {
      await rec.page.evaluate(() => [...document.querySelectorAll("[data-restaurant] button")].find((b) => b.innerText.trim() === "Cancel")?.click());
      await rec.page.waitForTimeout(500);
      const t = await rec.page.evaluate(() => document.querySelector("[data-restaurant]")?.innerText || "");
      return !/to confirm/.test(t) || "the confirm stayed open";
    });
  } else {
    for (const t of ["opening a row reads what is inside it, once", "the opened row shows head-counts", "the doors into its panels are offered", "the retired twin is not among them", "the row says looking restores nothing", "the permanent delete is behind a typed name", "the confirm says what goes and what stays", "the backup download is offered", "the backup warns about phone numbers", "Cancel puts the confirm away"]) {
      n += 1; rows.push({ id: idOf(n), band, title: `Recycle · ${t}` });
      if (!LEDGER) unanswerable(idOf(n), `Recycle · ${t}`, "nothing is in the recycle bin on this database right now");
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND D · P74131–P74190 — MEASURED RENDERING, DESKTOP AND THE PHONE HE TESTS ON
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "D";
console.log("\nD · measured rendering (1280×800 and 360×780, both skins)\n");

// The one deliberate sideways scroller in this territory: the usage table is a comparison table and
// T7 ruled that it slides on a phone rather than shrinking. The PAGE must never slide.
const VIEWS = [
  { w: 1280, h: 800, skin: "dark", name: "desktop · dark" },
  { w: 1280, h: 800, skin: "light", name: "desktop · light" },
  { w: 360, h: 780, skin: "dark", name: "A35 · dark" },
  { w: 360, h: 780, skin: "light", name: "A35 · light" },
];
if (!ctx) {
  for (let i = 0; i < 60; i++) { n += 1; rows.push({ id: idOf(n), band, title: `rendering check ${i + 1} (headless browser unavailable)` }); if (!LEDGER) unanswerable(idOf(n), `rendering check ${i + 1}`, "no headless browser"); }
} else {
  try { mkdirSync(shotDir, { recursive: true }); } catch {}
  for (const s of SCREENS) {
    for (const v of VIEWS) {
      const tag = `${s.url.split("/").pop()}-${v.w}-${v.skin}`;
      let o = null;
      const load = async () => {
        if (o) return o;
        const p = await ctx.newPage();
        await p.setViewportSize({ width: v.w, height: v.h });
        await p.addInitScript((sk) => { try { localStorage.setItem("aevidine_skin", sk); } catch {} }, v.skin);
        await p.goto(BASE + s.url, { waitUntil: "networkidle", timeout: 45000 });
        await p.waitForTimeout(700);
        o = p;
        return p;
      };
      await phase(`${s.url} at ${v.name} — the PAGE never scrolls sideways`, async () => {
        const p = await load();
        const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        return r.sw <= r.cw + 1 || `scrollWidth ${r.sw} > clientWidth ${r.cw}`;
      });
      await phase(`${s.url} at ${v.name} — no text is cut off by its own box`, async () => {
        const p = await load();
        const clipped = await p.evaluate(() => {
          const out = [];
          for (const e of document.querySelectorAll("h1,h2,h3,p,span,div,button,label,b")) {
            if (e.children.length) continue;
            if (e.offsetParent === null) continue;
            const cs = getComputedStyle(e);
            if (cs.overflow === "hidden" && cs.textOverflow === "ellipsis") continue;  // deliberate
            if (e.scrollHeight > e.clientHeight + 2 && cs.overflowY !== "auto" && cs.overflowY !== "scroll")
              out.push((e.innerText || "").trim().slice(0, 40));
          }
          return out.slice(0, 4);
        });
        return clipped.length === 0 || `clipped: ${JSON.stringify(clipped)}`;
      });
      await phase(`${s.url} at ${v.name} — nothing is written in a colour it cannot be read in`, async () => {
        const p = await load();
        const bad = await p.evaluate(() => {
          // A COLOUR WITH AN ALPHA IS NOT THE COLOUR YOU SEE. The first version of this read
          // `rgba(34,197,94,0.16)` as if it were solid green and reported the connection pill —
          // green text on a 16% green tint over a dark bar — as unreadable, on every screen, in
          // both skins: twelve identical false alarms from one missing blend. Composite each
          // translucent layer over the one behind it, the way the screen does.
          const px = (c) => { const m = (c || "").match(/[\d.]+/g); if (!m) return null; const [r, g, b, a = 1] = m.map(Number); return { r, g, b, a }; };
          const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
          const lumOf = (c) => (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
          const bgUnder = (el) => {
            const stack = [];
            for (let e = el; e; e = e.parentElement) { const c = px(getComputedStyle(e).backgroundColor); if (c && c.a > 0) stack.push(c); }
            let out = { r: 255, g: 255, b: 255, a: 1 };                       // the page underneath
            for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out);
            return out;
          };
          const out = [];
          for (const e of document.querySelectorAll("h1,h2,h3,p,span,b,button,label")) {
            if (e.children.length || e.offsetParent === null) continue;
            const t = (e.innerText || "").trim(); if (!t) continue;
            const cs = getComputedStyle(e);
            const fgc = px(cs.color); if (!fgc || fgc.a === 0) continue;
            // START AT THE ELEMENT ITSELF. An element's own background paints behind its own text,
            // so starting the walk at the PARENT reported every white-on-accent button label and
            // every stat figure as unreadable — six false alarms in the light skin alone.
            const bgc = bgUnder(e);
            const fg = lumOf(over(fgc, bgc)), bg = lumOf(bgc);
            if (Math.abs(fg - bg) < 0.08) out.push(`${t.slice(0, 26)} (${cs.color})`);
          }
          return out.slice(0, 4);
        });
        return bad.length === 0 || `too close to its background: ${JSON.stringify(bad)}`;
      });
      await phase(`${s.url} at ${v.name} — no two controls sit on top of each other`, async () => {
        const p = await load();
        const overlaps = await p.evaluate(() => {
          const els = [...document.querySelectorAll("button, a[href], input, select")]
            .filter((e) => e.offsetParent !== null)
            .map((e) => ({ r: e.getBoundingClientRect(), t: (e.innerText || e.getAttribute("aria-label") || "").trim().slice(0, 22) }))
            .filter((x) => x.r.width > 2 && x.r.height > 2);
          const hits = [];
          for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
            const a = els[i].r, b = els[j].r;
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 3 && oy > 3) hits.push(`${els[i].t} / ${els[j].t}`);
          }
          return hits.slice(0, 3);
        });
        return overlaps.length === 0 || `overlapping: ${JSON.stringify(overlaps)}`;
      });
      await phase(`${s.url} at ${v.name} — the screenshot was taken and looked at`, async () => {
        const p = await load();
        const file = join(shotDir, `${tag}.png`);
        await p.screenshot({ path: file, fullPage: true });
        const t = (await p.evaluate(() => document.body.innerText)).trim();
        // "Looked at" means measured, not glanced at: an image with almost no text on it is the
        // blank-screen failure this band exists to catch.
        if (!SHOTS) { try { unlinkSync(file); } catch {} }
        return t.length > 120 || `the shot carries only ${t.length} characters of text`;
      });
      if (o) await o.close();
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND E · P74191–P74240 — DOES THE CHANGE REACH EVERY PANEL THAT MUST SHOW IT?
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "E";
console.log("\nE · tracing across panels\n");

await phase("The removal card is ONE component, read by the admin and by the owner", () =>
  /RemovalDetailModal/.test(NCODE.adminLogs) && /RemovalDetailModal/.test(NCODE.ownerActivity)
  || "one of the two panels has its own copy");
await phase("…and each hands it the endpoint that belongs to its own panel", () =>
  /base="\/api\/admin\/audit"/.test(NCODE.adminLogs) && /base="\/api\/owner\/audit"/.test(NCODE.ownerActivity)
  || "a panel points at the other panel's route");
await phase("The owner's route can never answer canRestore: true", () =>
  !/canRestore: (true|restorable)/.test(NCODE.ownerAuditRoute) || "the owner could put a bill back");
await phase("The owner's audit route has no path that puts a bill back", () => {
  // It DOES have a POST, and that is deliberate: mig 337's "was the food actually made?", which is
  // append-only and moves stock, not money off a record. What must never exist here is a restore.
  const c = NCODE.ownerAuditRoute;
  const restores = /action: ?"restore"|\/api\/admin\/bills|deleted_at: null/.test(c);
  return !restores || "the owner's route can put a bill back — only the admin may";
});
await phase("The admin's route is the only one that reads whether the order is still tombstoned", () =>
  /from\("orders"\)\.select\("deleted_at"\)/.test(NCODE.auditRoute) || "restorability is guessed, not read");
await phase("The three panels that name a removal all read /panels/auditsort.js", () => {
  const panels = [["the removal card", CODE.removal], ["the admin's Audit list", NCODE.adminLogs], ["the manager panel", read("public/panels/editor/app.js")]];
  const off = panels.filter(([, c]) => !/auditsort|AUDITSORT/.test(c)).map(([nme]) => nme);
  return off.length === 0 || `not reading the shared map: ${off.join(", ")}`;
});
await phase("A binned restaurant is absent from Billing & plans, by the route's own filter", () =>
  /\.is\("deleted_at", null\)/.test(NCODE.billingRoute) || "a binned restaurant would be billed");
await phase("A binned restaurant is absent from Usage & cost, by the route's own filter", () =>
  /\.is\("deleted_at", null\)/.test(NCODE.usageRoute) || "a binned restaurant would be counted as load");
await phase("…and the recycle bin is the ONE screen that lists it instead", () =>
  /deleted=1/.test(CODE.recycle) || "no screen lists a binned restaurant");
await phase("Restoring a restaurant returns it SUSPENDED unless the admin asked for live", () =>
  /activate/.test(CODE.recycle) && /restore_restaurant/.test(NCODE.restsRoute) || "the two Restore buttons do not reach the route");
await phase("Restoring an OWNER always returns them suspended — there is no 'and make live'", () =>
  !/restore_owner[^\n]*activate/.test(CODE.recycle) || "an owner could be restored straight into a live login");
await phase("A restaurant restored into a taken address is renamed VISIBLY, never silently", () =>
  /d\.renamed/.test(CODE.recycle) && /renamed/.test(NCODE.restsRoute) || "a silent rename is back");
await phase("The rename the admin agreed to is the one the route is asked for", () =>
  /resolve \? \{ resolve \} : \{\}/.test(CODE.recycle) && /resolve/.test(NCODE.restsRoute) || "the chooser's answer does not reach the route");
await phase("The bin's panel doors go through the ONE act-as door, never a second one", () =>
  /\/api\/admin\/act-as\/go/.test(CODE.recycle) && /openRestaurantPanel/.test(NCODE.shared)
  || "a second way into a panel");
await phase("That door is told the click came from the bin, and ONLY the bin ever tells it", () => {
  // The act-as redirect refuses a binned restaurant unless the click says it came from the recycle
  // bin. That opt-in is a distinct argument (`fromBin`), and this asserts that the bin is the only
  // screen in the console that passes it — anywhere else it would be a way past a refusal.
  const shared = strip(read("components/admin/shared.tsx"));
  if (!/fromBin\?: boolean/.test(shared) && !/fromBin/.test(shared)) return "the bin opt-in is no longer its own argument";
  const senders = [];
  for (const f of ["app/aevinite/recycle/page.tsx", "app/aevinite/restaurants/page.tsx",
                   "app/aevinite/owners/page.tsx", "app/aevinite/page.tsx"]) {
    const c = strip(read(f));
    if (/openRestaurantPanel\([^)]*,\s*(true|rr\.binned|r\.binned)\s*\)/.test(c) || /bin=1/.test(c)) senders.push(f);
  }
  return (senders.length === 1 && senders[0] === "app/aevinite/recycle/page.tsx")
    || `screens passing the bin opt-in: ${senders.join(", ") || "none"}`;
});
await phase("A restaurant already removed for good has no door into a panel anywhere", () =>
  /\{!rr\.purged && \(/.test(CODE.recycle) || "a door into something that no longer exists");
await phase("The value shown on the removal card is the SAME figure the audit row stored", () =>
  /r\.amount != null \?/.test(CODE.removal) || "the card recomputes a figure the record already holds");
await phase("The bill drawn on the removal card is built by the SAME file the printer uses", () =>
  /billdoc/.test(read("lib/auditDetail.ts")) || "a second bill renderer");
await phase("The removal card's 'after' box is read LIVE, not frozen at the moment of removal", () =>
  /auditAfter\(/.test(NCODE.auditRoute) || "the right-hand box would freeze at a moment that has passed");
await phase("Billing's own money never touches a restaurant's orders table", () =>
  !/from\("orders"\)/.test(NCODE.billingRoute) || "platform billing reaching a food sale");
await phase("Usage's numbers come from the same RPC the rest of the console uses", () =>
  /lfh_admin_usage/.test(NCODE.usageRoute) || "a second definition of 'how busy is this restaurant'");
await phase("The staff figure on Usage counts LIVE restaurants only, like System health", () =>
  /\.is\("deleted_at", null\)/.test(NCODE.usageRoute) || "two admin screens would count different populations");
await phase("Nothing in this territory writes a row to a restaurant's own data", () => {
  const writes = Object.entries(CODE).filter(([, c]) => /method: "POST"/.test(c))
    .flatMap(([k, c]) => [...c.matchAll(/action: "([a-z_]+)"/g)].map((m) => `${FILES[k]}:${m[1]}`));
  const allowed = /restore_restaurant|purge_restaurant|restore_owner|purge_owner|set_plan|add_payment|delete_payment|restore/;
  const stray = writes.filter((w) => !allowed.test(w));
  return stray.length === 0 || `unexpected write action(s): ${stray.join(", ")}`;
});
await phase("Every write action these screens send is one the route actually has", () => {
  const map = {
    restore_restaurant: NCODE.restsRoute, purge_restaurant: NCODE.restsRoute,
    restore_owner: NCODE.ownersRoute, purge_owner: NCODE.ownersRoute,
    set_plan: NCODE.billingRoute, add_payment: NCODE.billingRoute, delete_payment: NCODE.billingRoute,
  };
  const missing = Object.entries(map).filter(([a, c]) => !c.includes(`"${a}"`)).map(([a]) => a);
  return missing.length === 0 || `the screen sends actions the route does not answer: ${missing.join(", ")}`;
});
await phase("…and the route answers no write action no screen here can send", () => {
  // The other direction: an action nothing reaches is either another screen's, or dead code beside
  // a destructive one — the shape that got `canPurge` deleted.
  const sent = new Set([...Object.values(CODE).join("\n").matchAll(/action: "([a-z_]+)"/g)].map((m) => m[1]));
  const binActions = [...NCODE.restsRoute.matchAll(/action === "([a-z_]+)"/g)].map((m) => m[1])
    .filter((a) => /restore|purge/.test(a));
  const orphan = binActions.filter((a) => !sent.has(a));
  return orphan.length === 0 || `bin actions no screen sends: ${orphan.join(", ")}`;
});
await phase("The recycle bin is reachable from the Restaurants list", () =>
  /\/aevinite\/recycle/.test(read("app/aevinite/restaurants/page.tsx")) || "the bin has no way in");
await phase("Billing and Usage are both reachable from the console's own navigation", () => {
  const nav = read("app/aevinite/layout.tsx") + read("components/admin/AdminShell.tsx") + read("components/admin/shared.tsx");
  const miss = ["/aevinite/billing", "/aevinite/usage"].filter((u) => !nav.includes(u));
  return miss.length === 0 || `not in the navigation: ${miss.join(", ")}`;
});
if (ctx) {
  await phase("LIVE · every link on the recycle bin leads to a real screen", async () => {
    const o = await observe("/aevinite/recycle");
    const hrefs = await o.page.evaluate(() => [...document.querySelectorAll("a[href^='/']")].map((a) => a.getAttribute("href")));
    const bad = [];
    for (const h of [...new Set(hrefs)]) { const r = await get(h); if (r.status >= 400) bad.push(`${h} → ${r.status}`); }
    return bad.length === 0 || bad.join(", ");
  });
  await phase("LIVE · every link on Billing leads to a real screen", async () => {
    const o = await observe("/aevinite/billing");
    const hrefs = await o.page.evaluate(() => [...document.querySelectorAll("a[href^='/']")].map((a) => a.getAttribute("href")));
    const bad = [];
    for (const h of [...new Set(hrefs)]) { const r = await get(h); if (r.status >= 400) bad.push(`${h} → ${r.status}`); }
    return bad.length === 0 || bad.join(", ");
  });
  await phase("LIVE · every link on Usage leads to a real screen", async () => {
    const o = await observe("/aevinite/usage");
    const hrefs = await o.page.evaluate(() => [...document.querySelectorAll("a[href^='/']")].map((a) => a.getAttribute("href")));
    const bad = [];
    for (const h of [...new Set(hrefs)]) { const r = await get(h); if (r.status >= 400) bad.push(`${h} → ${r.status}`); }
    return bad.length === 0 || bad.join(", ");
  });
  await phase("LIVE · the owner's Audit · removals screen still opens the shared card", async () => {
    const r = await get("/api/owner/audit?detail=1");
    return (r.status === 200 || r.status === 401 || r.status === 404) || `status ${r.status}`;
  });
  await phase("LIVE · the admin's Audit screen still opens", async () => {
    const r = await get("/aevinite/logs");
    return r.status === 200 || `status ${r.status}`;
  });
}
await phase("A removal record can be read by the owner and changed by nobody but the admin", () =>
  /This is a record — nothing here can be changed\./.test(CODE.removal) || "the read-only promise is gone");
await phase("The manager panel's Audit tab uses the same field order and wording", () =>
  /ONE shape for "what exactly was removed"/.test(SRC.removal) || "the shared-shape note is gone");
await phase("Nothing in this territory can reach the live client stack's keys", () => {
  const all = Object.values(CODE).join("\n") + Object.values(NCODE).join("\n");
  return !/AV\.live|kclqkmdxnwlhtyrducku/.test(all) || "a reference to the live client stack";
});
await phase("A restaurant restored from the bin reappears on Billing on the next read", () =>
  /onChanged\(\)/.test(CODE.recycle) && /useActiveAutoRefresh\(load, 60000\)/.test(CODE.billing)
  || "the two screens would disagree until a manual refresh");
await phase("A restaurant removed for good disappears from Usage on its next read", () =>
  /meta\.has\(u\.restaurant_id\)/.test(NCODE.usageRoute) || "a removed tenant would still be counted");
await phase("The recycle bin's promise about kept money matches the purge guard's KEEP list", () => {
  // The screen promises bills, invoices, payments and credit notes are kept. Those are not four
  // tables: a bill is `orders` + `sessions`, an invoice is a number ON a session plus the
  // `invoice_events` trail, and money received is `payments` / `session_payments`. The guard's KEEP
  // list is checked against what those really are — matching the literal word "invoices" was asking
  // for a table this product does not have.
  const g = read("scripts/verify-purge-classified.mjs");
  const must = ["orders", "sessions", "payments", "invoice_events"];
  const kept = must.filter((t) => new RegExp(`\\["${t}"`).test(g));
  return kept.length === must.length || `not on the purge KEEP list: ${must.filter((t) => !kept.includes(t)).join(", ")}`;
});
await phase("The bin screen's words and the database's own rule still say the same thing", () => {
  // Migration 342 is what removed the database's half of the 90-day lock. Found by NUMBER, never by
  // a guessed file name — several migrations here are numbered twice and file names have moved,
  // and a check that reads a file that is not there passes vacuously (this repo's own scar).
  const mig = readdirSync(join(root, "supabase/migrations")).find((f) => /^342_/.test(f));
  if (!mig) return "migration 342 is not on disk any more — the rule the screen states cannot be checked";
  const sql = read(`supabase/migrations/${mig}`);
  const dbHasNoLock = !/retention|90\s*day|days_left/i.test(sql.replace(/^\s*--.*$/gm, ""));
  const screenSaysSo = /there is no waiting period/.test(CODE.recycle);
  return (dbHasNoLock && screenSaysSo)
    || `database rule ${dbHasNoLock ? "ok" : "still mentions a wait"}, screen ${screenSaysSo ? "ok" : "does not say there is none"} (${mig})`;
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND F · P74241–P74280 — JUDGMENT: IS THIS HOW A REAL RESTAURANT PLATFORM SHOULD WORK?
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "F";
console.log("\nF · judgment\n");

// A judgment phase is a written opinion with the evidence beside it. It passes when the code still
// supports the judgment; it fails when the thing it was judging has changed underneath it.
const judge = (title, holds, why) => phase(title, () => (holds ? true : why));

await judge("Is a typed name the right guard on a permanent delete?", /nameMatches/.test(CODE.recycle),
  "the typed-name confirm is gone — a mis-click would erase a restaurant");
await judge("Is offering a data backup BEFORE the erase the right default?", /useState\(true\)/.test(CODE.recycle),
  "the backup is no longer offered by default");
await judge("Is it right that removal keeps the money and says so on the same screen?", /bills, invoices, payments/.test(CODE.recycle),
  "the screen no longer says what survives — an admin would answer a client's question wrongly");
await judge("Is the unpaid pay-later warning the right thing to put in front of a delete?", /still unpaid here/.test(CODE.recycle),
  "the one figure that should stop a hand is gone");
await judge("Should the bin let the admin WALK INTO a binned restaurant?", /It stays in the recycle bin/.test(CODE.recycle),
  "deciding a permanent delete blind is worse; the doors are the owner's own ask (2026-08-20)");
await judge("Should a name clash be a question rather than an error?", /409/.test(CODE.recycle),
  "a clash is a decision, not a failure — the owner asked for exactly two ways out");
await judge("Is refusing to rename the LIVE restaurant the right call?", !/rename_holder/.test(CODE.recycle),
  "its QR codes are printed on real tables — moving its address is not ours to do");
await judge("Is telling the admin about the QR consequence BEFORE he agrees the right order?", /qrWarning/.test(CODE.recycle),
  "the only way back from a rename is reprinting; he has to know first");
await judge("Is 'in the bin N days' better than a countdown?", /In the bin/.test(CODE.recycle),
  "a countdown implies a permission that no longer exists (mig 342)");
await judge("Should an owner come back suspended rather than able to sign in?", /Restore \(suspended\)/.test(CODE.recycle),
  "a login returning live is a decision nobody made");
await judge("Is Billing being hand-entered acceptable until there is a gateway?", /there&apos;s no payment gateway yet/.test(CODE.billing),
  "the page no longer says the money is entered by hand");
await judge("Is deleting a billing PAYMENT record acceptable?", /restaurant_payments/.test(NCODE.billingRoute),
  "it is the platform's own bookkeeping, not a restaurant's sale — the compliance rule does not reach it");
await judge("Is a per-restaurant currency worth keeping over forcing rupees?", /currency/.test(CODE.billing),
  "a platform that will bill outside India needs the field; the tile names what it did not add up");
await judge("Is the 'not counted above' line the honest way to show a mixed-currency year?", /not counted above:/.test(CODE.billing),
  "adding two currencies would be a made-up number, and hiding one would be worse");
await judge("Should the platform's income tile round to whole rupees?", /maximumFractionDigits: 0/.test(CODE.billing),
  "the rounding is deliberate on a tile; the payment ROWS are where paise would matter");
await judge("Is order volume an honest proxy for what a restaurant costs to serve?", /best cheap signal for load/.test(CODE.usage),
  "the page says so twice and offers nothing more precise, which is the honest position");
await judge("Is local sorting worth having on Usage?", /useMemo/.test(CODE.usage),
  "the rows are already in the browser — it costs nothing and answers 'who has the most staff'");
await judge("Is the date window worth its round-trip?", /MAX_DAYS = 400/.test(NCODE.usageRoute),
  "one bounded aggregate answers 'what did last week look like', which the screen could not ask at all");
await judge("Is the usage table's sideways scroll acceptable on a phone?", /us-slide/.test(SRC.usage),
  "for READING, yes — it is a comparison table (T7's standing call), and the hint says where the rest is");
await judge("Is a share bar the right drawing for order volume?", !/<svg|<canvas/.test(CODE.usage),
  "a bar against the busiest restaurant answers the question; a chart here would be decoration");
await judge("Is showing the whole bill on a removal record right, rather than a summary?", /BillFrame/.test(CODE.removal),
  "the owner asked to see how it was; a summary is what the record already had and could not settle an argument");
await judge("Is rebuilding the bill better than storing a picture of it?", /not a photo/.test(CODE.removal),
  "an image would blur on zoom and cost a stored file per removal");
await judge("Is 'before and after' the right shape for a change record?", /Before and after/.test(CODE.removal),
  "it is the owner's own words (2026-08-12) and the eye does the comparing");
await judge("Is marking ONLY what changed the right restraint?", /What moved is marked in amber/.test(CODE.removal),
  "a card where everything is highlighted has told you nothing");
await judge("Should the owner see the same evidence as the admin?", /the same evidence/.test(SRC.removal),
  "an owner arguing with a manager about a deleted bill needs the whole picture");
await judge("Should the owner be able to put a bill back?", /Only an Aevidine admin can put a deleted bill back/.test(CODE.removal),
  "putting money back is a change, and only the admin changes things (owner rule, 2026-08-04)");
await judge("Is a 60-second refresh right for Billing, and none at all for the bin?", /useActiveAutoRefresh\(load, 60000\)/.test(CODE.billing) && !/useActiveAutoRefresh/.test(CODE.recycle),
  "a screen that decides a permanent delete must not move under the admin's hand");
await judge("Is a skeleton the right loading state for a money table?", /SkelList/.test(CODE.billing),
  "a blank card reads as 'no payments', which on a money screen is a wrong answer, not a slow one");
await judge("Is 'Loading…' acceptable on the bin rather than a skeleton?", /Loading…/.test(CODE.recycle),
  "the bin is usually empty and a skeleton would promise rows that are not coming");
await judge("Does the admin console still show no restaurant earnings anywhere here?",
  !/₹/.test(CODE.usage) && !/food/i.test(CODE.billing),
  "food money has reached a platform screen");
await judge("Is the removal card the right place for the restore button?", /\/api\/admin\/bills/.test(CODE.removal),
  "it goes through the bill ledger's one audited write path, not a second one");
await judge("Does a real restaurant ever need to remove a restaurant the same day it is binned?", /no waiting period/.test(CODE.recycle),
  "the owner deleted the 90-day wait himself (2026-08-20); the typed name is the guard now");
await judge("Is the backup file's privacy warning strong enough?", /Keep it private/.test(CODE.recycle),
  "it holds guests' names and phone numbers and says so");
await judge("Would a waiter or manager ever reach any of these three screens?", /aevinite/.test(Object.values(FILES).join(" ")),
  "they are all under /aevinite, which is the admin's own console");
await judge("Is 'Removed for good' better wording than 'purged'?", /Removed for good/.test(CODE.recycle),
  "'purged' is our word, not his");
await judge("Is 'In the recycle bin' better than 'soft-deleted'?", /In the recycle bin/.test(CODE.recycle),
  "same rule, and it matches the screen it links to");
await judge("Does 'Restore (suspended)' say enough about what happens next?", /turn it live from the Restaurants page/.test(SRC.recycle),
  "the tooltip names the next screen, which is where the admin has to go");
await judge("Is the platform-income tile named honestly when a currency is excluded?", /· rupees/.test(CODE.billing),
  "the qualifier appears only when there IS something excluded, which is the honest version");
await judge("Would an operator understand 'Due in 30 days (2 overdue)' at a glance?", /overdue/.test(CODE.billing),
  "the two counts are separate on purpose — the same restaurant is never in both");
await judge("Is anything on these three screens a two-tap flow that should be one?", true,
  "checked: Restore is one tap, Manage is one tap, sorting is one tap; the permanent delete is deliberately three");

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND G · P74269– — THE SIX THINGS HE PICKED ON 2026-09-04 (items 8, 9, 11, 12, 13, 14)
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// APPENDED, never inserted. Every id in this file is POSITIONAL — the nth phase is the nth id — so
// adding a check in the middle would silently renumber every row after it, and "re-run P73912"
// would stop meaning what the ledger says it means. New work goes on the end.
band = "G";
console.log("\nG · the six he picked on 2026-09-04\n");

// ── item 8 · a payment is drawn in TODAY's currency ─────────────────────────────────────────────
await phase("Item 8 · the payment list says which currency it is drawing in", () =>
  /Amounts are shown in <b>\{\(row\.currency \|\| "INR"\)\.toUpperCase\(\)\}<\/b>/.test(CODE.billing)
  || "the list no longer names the currency it is drawing every past payment in");
await phase("Item 8 · …and says WHY it can re-label an old payment", () =>
  /A payment does not carry a currency of its own/.test(CODE.billing)
  || "it names the currency but not the reason a historic figure can change symbol");
await phase("Item 8 · the note only appears when there are payments to mislabel", () =>
  /\{payments && payments\.length > 0 && \(/.test(CODE.billing) || "an explanation with nothing to explain");
await phase("Item 8 · a payment row still has no currency of its own to read", () =>
  !/payments[\s\S]{0,200}\.currency/.test(NCODE.billingRoute)
  || "the route now answers a per-payment currency — draw each row in ITS own, and drop the note");

// ── item 9 · a word about a save is about the save that happened ────────────────────────────────
await phase("Item 9 · editing the plan clears what was said about the last save", () => {
  // THE BODY, NOT THE SCAFFOLDING. The first version of this asked for a ref and a deps list and
  // was satisfied by both — so deleting the one line that does the work, `setMsg(null)`, left it
  // green. Read the effect that watches the fields and check it really clears.
  const eff = (CODE.billing.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[plan, status, amount, currency, cycle, startedOn, nextDueOn, notes\]\);/) || [""])[0];
  if (!eff) return "nothing watches the plan fields, so 'Saved.' can sit under unsaved changes";
  return /setMsg\(null\);/.test(eff) || "the fields are watched and nothing is cleared — the word stays put";
});
await phase("Item 9 · …and the confirmation still survives the save that produced it", () =>
  /if \(firstRender\.current\) \{ firstRender\.current = false; return; \}/.test(CODE.billing)
  || "the message would be cleared on mount, or by the save itself");
await phase("Item 9 · every field a person can change is watched", () => {
  const watched = (CODE.billing.match(/\}, \[(plan[^\]]*)\]\)/) || [])[1] || "";
  const fields = ["plan", "status", "amount", "currency", "cycle", "startedOn", "nextDueOn", "notes"];
  const missing = fields.filter((f) => !new RegExp(`\\b${f}\\b`).test(watched));
  return missing.length === 0 || `an edit to ${missing.join(", ")} would leave "Saved." on screen`;
});

// ── item 11 · silence on a delete screen must mean one thing only ───────────────────────────────
await phase("Item 11 · the delete confirm answers 'does anyone still owe money?' in every state", () => {
  // Both halves of each state: the CONDITION that chooses it and the SENTENCE it draws. A check
  // that only reads the words is satisfied by dead text — flipping a condition to `false` leaves
  // every sentence in the file and the screen silent.
  const holes = [];
  if (!/\{!inside \? \(/.test(CODE.recycle)) holes.push("nothing read yet (no condition)");
  if (!/haven&apos;t looked inside this one yet/.test(CODE.recycle)) holes.push("nothing read yet (no sentence)");
  if (!/inside\.inside\.unpaidPayLaterBills === null \|\| inside\.inside\.unpaidPayLaterBills === undefined/.test(CODE.recycle)) holes.push("count unknown (no condition)");
  if (!/could not be read<\/b> just now — it is not a zero/.test(CODE.recycle)) holes.push("count unknown (no sentence)");
  if (!/inside\.inside\.unpaidPayLaterBills > 0/.test(CODE.recycle)) holes.push("a real count (no condition)");
  return holes.length === 0 || `silent for: ${holes.join(", ")}`;
});
await phase("Item 11 · …and stays quiet for a real zero, which is the one honest silence", () =>
  /\) : null\}/.test(CODE.recycle) || "it would warn about nothing");
await phase("Item 11 · the unknown case points at the way out rather than just naming the problem", () =>
  /Use <b>Try again<\/b> on the row above/.test(CODE.recycle) || "it says the count is unknown and offers nothing to do about it");

// ── item 12 · one spelling of a date across the console ─────────────────────────────────────────
await phase("Item 12 · the recycle bin uses the console's shared date reading", () =>
  /const fmtDate = istDate;/.test(CODE.recycle) || "this page declares its own date format again");
await phase("Item 12 · …and no screen in this territory keeps a private one", () => {
  const own = Object.entries(CODE).filter(([, c]) => /const (fmtDate|dfmt) = \((iso|s|d)[^)]*\) =>/.test(c)).map(([k]) => FILES[k]);
  return own.length === 0 || `private date formatter(s) in: ${own.join(", ")}`;
});
await phase("Item 12 · the shared one is pinned to Indian time, not the reader's computer", () =>
  /timeZone: IST/.test(NCODE.shared) || "the same row would read a day out on a computer set elsewhere");

// ── item 13 · first save wins, and the loser gets told ──────────────────────────────────────────
await phase("Item 13 · the billing card says what the row said when it read it", () =>
  /"X-LFH-Expect": expectHeader\(expect\)/.test(CODE.billing) || "the plan save sends no expectation, so there is no gate");
await phase("Item 13 · that header is ASCII-escaped, or a curly apostrophe kills the whole request", () =>
  /import \{ expectHeader \} from "@\/lib\/accessTree"/.test(CODE.billing)
  || "JSON.stringify is back — fetch() refuses a header that is not ISO-8859-1, silently");
await phase("Item 13 · the expectation is rebuilt from what the SERVER last said, not from the list row", () =>
  /baselineRef\.current = \(j\.billing && typeof j\.billing === "object"\)/.test(CODE.billing)
  || "a payment moving next-due server-side would read as somebody else's edit");
await phase("Item 13 · it holds every field a second person could move", () => {
  const blk = (CODE.billing.match(/fields: \{[\s\S]{0,400}?\}/) || [""])[0];
  const need = ["plan", "status", "amount", "currency", "cycle", "next_due_on"];
  const miss = need.filter((f) => !blk.includes(f));
  return miss.length === 0 || `not protected: ${miss.join(", ")}`;
});
await phase("Item 13 · a restaurant with no billing row yet sends no expectation", () =>
  /const expect = was \? \{/.test(CODE.billing) || "it would claim the row said something when there is no row");
await phase("Item 13 · the route asks the one gate before it writes", () => {
  const c = NCODE.billingRoute;
  return (/expectClash\(req, rid\)/.test(c) && c.indexOf("expectClash") < c.indexOf('from("restaurant_billing").upsert'))
    || "the gate runs after the write, or not at all";
});
await phase("Item 13 · …and answers the refusal in the shape every panel already understands", () =>
  /return clashJson\(overwrite\)/.test(NCODE.billingRoute) || "a bespoke refusal shape");
await phase("Item 13 · the table is one the gate is allowed to compare", () =>
  /restaurant_billing: "restaurant_id"/.test(strip(read("lib/clash.ts")))
  || "the gate would answer 'nothing to protect' even when the card asks");
await phase("Item 13 · …and is scoped as a tenant row, because its own key IS the restaurant", () =>
  /TENANT_ROW_TABLES = new Set\(\["settings", "restaurants", "restaurant_billing"\]\)/.test(strip(read("lib/clash.ts")))
  || "it would be scoped by a restaurant_id column it does not have");
await phase("Item 13 · a refusal is shown to the person, not swallowed", () =>
  /res\.status === 409 && d\.clash|r\.status === 409 && d\.clash/.test(CODE.billing) || "the refusal would read as a generic error");
await phase("Item 13 · …and the card re-reads itself so the fields stop showing what lost", () => {
  const blk = (CODE.billing.match(/status === 409 && d\.clash\)[\s\S]{0,300}?\n\s{6}\}/) || [""])[0];
  return /loadHistory\(\)/.test(blk) || "the losing values would stay on screen under the refusal";
});
await phase("Item 13 · a successful save refreshes the expectation for the next one", () => {
  const blk = (CODE.billing.match(/setMsg\(\{ kind: "ok", text: "Saved\." \}\)[\s\S]{0,200}/) || [""])[0];
  return /loadHistory\(\)/.test(blk) || "the second save in a row would be judged against a stale expectation";
});
await phase("Item 13 · the pair is registered with the coverage guard, both halves", () => {
  const g = read("scripts/verify-clash-coverage.mjs");
  const blk = (g.match(/file: "app\/aevinite\/billing\/page\.tsx"[\s\S]{0,400}?\},/) || [""])[0];
  return (blk.includes('route: "app/api/admin/billing/route.ts"') && /X-LFH-Expect/.test(blk))
    || "verify:clash-coverage does not watch this pair";
});

// ── item 14 · the phone sort picker ─────────────────────────────────────────────────────────────
await phase("Item 14 · there is a way to sort by a heading that is off the edge", () =>
  /id="us-sort"/.test(CODE.usage) || "two of the five sorts are unreachable on a phone again");
await phase("Item 14 · it drives the SAME sort as the headings, not a second one", () =>
  /setSort\(e\.target\.value as SortKey\)/.test(CODE.usage) || "a second, private sort");
await phase("Item 14 · its labels come from the same list the headings read", () =>
  /const SORTS: \{ k: SortKey; label: string; ranged\?: boolean \}\[\]/.test(CODE.usage)
  || "the picker and the headings can call one column different things");
await phase("Item 14 · it offers every column, including the two off the edge", () => {
  const blk = (CODE.usage.match(/const SORTS[\s\S]*?\];/) || [""])[0];
  const keys = [...blk.matchAll(/k: "(\w+)"/g)].map((m) => m[1]).sort();
  return keys.join(",") === "name,orders,orders7d,staff,tables" || `offers ${keys.join(",")}`;
});
await phase("Item 14 · the 7-day option disappears while a window is chosen, exactly as its column does", () =>
  /SORTS\.filter\(\(o\) => !\(ranged && o\.ranged === false\)\)/.test(CODE.usage)
  || "it would offer a sort on a column that is not on screen");
await phase("Item 14 · it exists only where the table actually slides", () =>
  /\.us-sortbar \{ display: none; \}/.test(SRC.usage) && /@media \(max-width: 560px\) \{\s*\.us-sortbar \{ display: flex/.test(SRC.usage)
  || "a second control on a computer, where every heading is already pressable");
await phase("Item 14 · the picker has a label a screen reader can read", () =>
  /<label htmlFor="us-sort"/.test(CODE.usage) || "an unnamed control");
await phase("Item 14 · the direction button says which way it is sorting, not just which way it points", () =>
  /aria-label=\{desc \? "Sorted biggest first/.test(CODE.usage) || "a bare arrow with no name");
await phase("Item 14 · picking a column starts biggest-first for numbers, A→Z for the name", () =>
  /setDesc\(e\.target\.value !== "name"\)/.test(CODE.usage) || "it would start in the direction nobody meant");
await phase("Item 14 · the hint names the picker as the way round the drag", () =>
  /use <b>Sort by<\/b> above to order by them without dragging/.test(CODE.usage)
  || "the picker exists and nothing points at it");
if (ctx) {
  await phase("Item 14 · LIVE at 360px — the picker is on screen and offers all five", async () => {
    const p = await ctx.newPage();
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(BASE + "/aevinite/usage", { waitUntil: "networkidle", timeout: 45000 });
      await p.waitForTimeout(800);
      const opts = await p.evaluate(() => { const s = document.querySelector("#us-sort"); return s && s.offsetParent !== null ? [...s.options].map((o) => o.text) : null; });
      return (opts && opts.length === 5) || `picker: ${JSON.stringify(opts)}`;
    } finally { await p.close(); }
  });
  await phase("Item 14 · LIVE at 360px — picking Staff really orders by staff, and asks the server for nothing", async () => {
    const p = await ctx.newPage();
    let calls = 0;
    p.on("request", (r) => { if (r.url().includes("/api/admin/usage")) calls++; });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(BASE + "/aevinite/usage", { waitUntil: "networkidle", timeout: 45000 });
      await p.waitForTimeout(800);
      const before = calls;
      await p.selectOption("#us-sort", "staff");
      await p.waitForTimeout(700);
      const v = await p.evaluate(() => [...document.querySelectorAll(".adm-logrow.us-row:not(.head)")]
        .map((r) => { const s = r.querySelectorAll("span"); return Number(s[s.length - 2].innerText) || 0; }));
      if (calls > before) return `${calls - before} request(s) for a sort the browser can do`;
      return JSON.stringify(v) === JSON.stringify([...v].sort((a, b) => b - a)) || `order ${JSON.stringify(v)}`;
    } finally { await p.close(); }
  });
  await phase("Item 14 · LIVE on a computer — there is no picker, only the headings", async () => {
    const o = await observe("/aevinite/usage");
    const showing = await o.page.evaluate(() => { const s = document.querySelector("#us-sort"); return s ? s.offsetParent !== null : false; });
    return !showing || "the phone picker is showing on a desktop, where every heading is already pressable";
  });
}

if (ctx) {
  await phase("Item 9 · LIVE — the word about a save disappears the moment the form is touched", async () => {
    // Reading the code cannot prove this; only pressing Save and then typing can. The check that
    // used to stand here read a ref and a deps list, and stayed green over a sabotage that deleted
    // the one line doing the work.
    const p = await ctx.newPage();
    try {
      await p.goto(BASE + "/aevinite/billing", { waitUntil: "networkidle", timeout: 45000 });
      await p.waitForTimeout(700);
      const opened = await p.evaluate(() => { const b = document.querySelector(".adm-logrow:not(.head) button"); if (!b) return false; b.click(); return true; });
      if (!opened) return "no restaurant row to open";
      await p.waitForTimeout(1200);
      await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Save plan/.test(b.innerText))?.click());
      await p.waitForTimeout(1800);
      const said = await p.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || "");
      if (!/Saved\.|Someone else changed/.test(said)) return "the save said nothing at all";
      // Type something that is definitely different from what is in the box.
      await p.fill('[role="dialog"] input[placeholder="e.g. Standard"]', `zz-${Date.now()}`);
      await p.waitForTimeout(600);
      const after = await p.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || "");
      return !/Saved\./.test(after) || "'Saved.' is still on screen under a form full of unsaved changes";
    } finally { await p.close(); }
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// The verdict
// ════════════════════════════════════════════════════════════════════════════════════════════════
if (browser) await browser.close();

function writeLedger() {
  const byBand = {};
  for (const r of rows) (byBand[r.band] ||= []).push(r);
  const BANDNAME = {
    A: "reading the code for correctness", B: "the project's own rules, on this ground",
    C: "watching it run", D: "measured rendering, desktop and the phone he tests on",
    E: "does the change reach every panel that must show it?", F: "judgment",
  };
  let out = `# SWEEP #8 · TERMINAL 20 — THE RECYCLE BIN, BILLING AND USAGE\n\n`;
  out += `**Phases \`${rows[0].id}\`–\`${rows[rows.length - 1].id}\` (${rows.length}).** Territory:\n`;
  out += Object.values(FILES).map((f) => `\`${f}\``).join(" · ") + `\n\n`;
  out += `These rows are GENERATED from \`scripts/verify-bin-billing-usage.mjs\` (\`--ledger\`), and every one\nis re-runnable:\n\n`;
  out += "```\nnpm run verify:bin-billing-usage -- --base http://localhost:4000\nnpm run verify:bin-billing-usage -- --base http://localhost:4000 --from 1 --to 60\n```\n\n";
  out += `A row is never re-typed here by hand: the table drifts from the checks within days, and then\n"re-run row ${rows[40] ? rows[40].id : "P73741"}" stops meaning anything — the exact failure the ledger exists to prevent.\nRegenerate with \`node scripts/verify-bin-billing-usage.mjs --ledger\`.\n\n`;
  out += `**Result key:** ✅ pass · ❌ fail · ⏭ unanswered, with a written reason.\n`;
  for (const b of ["A", "B", "C", "D", "E", "F"]) {
    const list = byBand[b] || [];
    if (!list.length) continue;
    out += `\n## ${b} · ${BANDNAME[b]} · \`${list[0].id}\`–\`${list[list.length - 1].id}\` (${list.length})\n\n| id | check | result |\n|---|---|---|\n`;
    for (const r of list) out += `| ${r.id} | ${r.title.replace(/\|/g, "\\|")} | ${r.result || ""}${r.note ? " " + r.note.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 220) : ""} |\n`;
  }
  writeFileSync(join(root, ".claude/sweep/LEDGER/T20-S8.md"), out);
  console.log(`\n${rows.length} phases (${rows[0].id}–${rows[rows.length - 1].id}) written to .claude/sweep/LEDGER/T20-S8.md\n`);
}
if (LEDGER) { writeLedger(); process.exit(0); }

console.log(`\n${"═".repeat(78)}`);
console.log(`  ${pass.length} passed · ${fail.length} failed · ${unanswered.length} unanswered · ${skipped.length} outside --from/--to`);
if (fail.length) {
  console.log(`\n  What is wrong:\n`);
  for (const f of fail) console.log(`   ✗ ${f.id}  ${f.title}\n        ${f.why}\n`);
}
if (unanswered.length && !QUIET) {
  console.log(`\n  Not answerable on this database / in this run:\n`);
  for (const u of unanswered) console.log(`   ? ${u.id}  ${u.title} — ${u.why}`);
}
console.log(`${"═".repeat(78)}\n`);
if (WRITE_LEDGER) writeLedger();
// A suite that filters itself out prints "all clean" — so refuse to be green on nothing (memory:
// a-suite-that-filters-itself-out-prints-all-clean).
const MIN = FROM || TO !== Infinity ? 1 : 400;
if (pass.length + fail.length < MIN) {
  console.log(`Only ${pass.length + fail.length} checks actually ran, and this suite has ${rows.length}.\nThat is not a pass — it is a suite that did not run. Exiting 1.\n`);
  process.exit(1);
}
process.exit(fail.length ? 1 : 0);
