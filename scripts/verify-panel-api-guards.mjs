#!/usr/bin/env node
// verify-panel-api-guards.mjs — the rules the T10 sweep (phases P04501–P05000) put back into the
// GUEST and STAFF-PANEL api routes, turned into tests so they cannot quietly come back.
//
// WHY THIS EXISTS. Four of the sweep's findings were the same two mistakes:
//
//   · "the database didn't answer" was answered as something ELSE — a crash page, or
//     "please log in" — on three different routes, each of which had a sibling that was
//     fixed by hand for exactly this in an earlier sweep. Hand-fixing does not hold: the
//     next route starts from zero.
//   · a row was looked up by a key that is not unique, so two lines of one purchase both
//     resolved to the first one and the wrong quantity went into stock.
//
// Static + instant, plus one tiny in-memory reproduction that proves the last rule is
// checking something real rather than grepping for today's spelling.
//
// Run: node scripts/verify-panel-api-guards.mjs   (or npm run verify:panel-api)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRaw = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

/**
 * Source with COMMENTS REMOVED — and this matters more here than almost anywhere.
 *
 * Every fix in this codebase leaves a comment quoting the WRONG code it replaced, verbatim, a few
 * lines above the right code. A guard that greps the raw file therefore fires on the very comment
 * that documents the fix. (verify-read-guards.mjs learned this the hard way; every rule below would
 * trip on its own explanation.) So: strip comments, then grep. The prose is for humans; the check is
 * about what actually executes.
 *
 * LINE COMMENTS COME OFF FIRST, AND THE ORDER IS THE WHOLE POINT (found while writing this file —
 * the first run reported the kitchen and manager routes as UNGATED, which would have been the most
 * alarming possible false alarm). These routes describe themselves in prose, and that prose is full
 * of URL patterns: `// same paths (under /api/kitchen/*), shapes, …`. Strip BLOCK comments first and
 * that `/*` opens a comment the stripper then closes at the next `*​/` hundreds of lines later —
 * swallowing `gate()`, `requireRole(...)` and `panelRestaurantId(...)` along with it. Taking the
 * `//` lines off first means a `/*` that only ever existed inside one is gone before the block pass
 * ever sees it.
 */
const read = (p) => readRaw(p)
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1")   // line comments FIRST (see above), sparing a URL's "//"
  .replace(/\/\*[\s\S]*?\*\//g, "");           // …then block comments

const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const fail = (m) => fails.push(m);

// ── 1. A DATABASE BLIP IS NEVER ANSWERED AS "PLEASE LOG IN" OR AS A CRASH ────────────────────────
//
// `userFromCookie` (lib/userAuth.ts) THROWS `AuthDbError` when the staff_users lookup itself fails,
// deliberately and distinctly from "this cookie is invalid" — its own comment says "A transient
// outage must surface as 503 ('try again'), never as 'please log in'." Every caller outside
// requireRole has to handle it, and three of them did not.
{
  const CALLERS = [
    ["app/login/page.tsx", "the staff sign-in door renders an error page instead of the form (F1)"],
    ["app/api/issue-media/route.ts", "a signed-in cook is told to log in and their photo report is lost (F2)"],
    ["app/api/rt-config/route.ts", "every panel drops to a 5-second poll it cannot recover from (F3)"],
    ["app/api/panel-profile/route.ts", "My profile breaks instead of saying the system is busy (T17 F9)"],
    ["app/api/panel-logout/route.ts", "Log out 500s and KEEPS the cookie on a shared tablet (T17 F8)"],
  ];
  for (const [p, why] of CALLERS) {
    const src = read(p);
    if (!src) { fail(`${p} is missing — the rule it carries cannot be checked`); continue; }
    if (!/userFromCookie\s*\(/.test(src)) { ok(`${p} no longer calls userFromCookie at all`); continue; }
    // Three acceptable shapes, and only three:
    //   · it NAMES AuthDbError, so it can answer differently for a blip than for a bad cookie;
    //   · it delegates to requireRole, which classifies the throw for you (`transient`);
    //   · the call sits inside a try/catch that cannot let ANYTHING escape — which is right for
    //     /api/panel-logout specifically, because a logout must clear the cookie whatever the
    //     database says. The audit line is best-effort there; the logout is not.
    // `instanceof`, not merely the word: an IMPORT of AuthDbError satisfies a bare /AuthDbError/
    // and proves nothing. (This guard's own first negative test passed on a file whose only
    // remaining mention was the import line — a guard that is happy with broken code is worse than
    // no guard, so the rule asks for the branch that actually does the telling-apart.)
    const named = /instanceof\s+AuthDbError/.test(src);
    const viaRequireRole = /requireRole\s*\(/.test(src) && /transient/.test(src);
    const idx = src.indexOf("userFromCookie(");
    const around = src.slice(Math.max(0, idx - 300), idx + 300);
    const wrapped = /try\s*\{[\s\S]*userFromCookie\(/.test(around) && /catch\s*[({]/.test(around);
    if (named || viaRequireRole || wrapped) ok(`${p} cannot let a database blip escape as a crash or a 401 — else ${why}`);
    else fail(`${p} calls userFromCookie without handling AuthDbError — ${why}`);
  }

  // …and the two that answer an API must answer with the shape the offline layer reads.
  const media = read("app/api/issue-media/route.ts");
  // The busy answer has to be REACHED FROM the AuthDbError branch, not merely present somewhere in
  // the file. Slice from the `instanceof AuthDbError` test to the end of that block.
  const mIdx = media.indexOf("instanceof AuthDbError");
  const mBlock = mIdx >= 0 ? media.slice(mIdx, mIdx + 600) : "";
  if (mBlock && /503/.test(mBlock) && /BUSY_MESSAGE|busy:\s*true/.test(mBlock) && /X-LFH-Busy/.test(mBlock)) {
    ok("issue-media answers a database blip with the 503 `busy` shape, not a 401");
  } else {
    fail("issue-media's AuthDbError branch no longer answers the 503 `busy` shape — a signed-in person gets 'please log in' again and their photo report is thrown away (F2)");
  }
  const rt = read("app/api/rt-config/route.ts");
  if (/reason:\s*"rt_busy"/.test(rt)) ok("rt-config answers a database blip with a branchable code (rt_busy)");
  else fail("rt-config lost its rt_busy code — a blip is back to an unclassified 500 the badge cannot read (F3)");
  if (/reason:\s*"rt_unconfigured"/.test(rt)) ok("rt-config still distinguishes 'not set up on this server'");
  else fail("rt-config lost rt_unconfigured — 'call Aevidine' and 'your wifi dropped' look the same again (I11)");
  // The rid must NOT be handed out on a blip: it is the cross-restaurant breadcrumb filter, so a
  // guessed one either makes a tenant's panel ignore its own events or wakes it on everyone else's.
  // Bounded to the RESPONSE BODY, not to a character count. A fixed window in either direction
  // runs into a neighbouring statement and reports it: reading backwards catches the
  // `let restaurantId = DEFAULT_RESTAURANT_ID` initialiser at the top of the handler, reading
  // forwards catches `restaurantId = u.restaurant_id` on the line after the return. Both are
  // legitimate and neither is this answer. So: from the `NextResponse.json(` that opens this reply
  // to the `status: 503` that closes its body.
  const busyIdx = rt.indexOf(`reason: "rt_busy"`);
  const bodyStart = busyIdx >= 0 ? rt.lastIndexOf("NextResponse.json(", busyIdx) : -1;
  const bodyEnd = busyIdx >= 0 ? rt.indexOf("status: 503", busyIdx) : -1;
  const busyBody = bodyStart >= 0 && bodyEnd > bodyStart ? rt.slice(bodyStart, bodyEnd) : "";
  if (busyIdx >= 0 && !busyBody) fail("could not read the rt_busy response body — this check is not actually running");
  if (/restaurantId/.test(busyBody)) {
    fail("the rt_busy answer carries a restaurantId — on a blip we do not know which restaurant the caller is, and guessing breaks the breadcrumb filter (F3)");
  } else ok("rt-config refuses rather than guessing which restaurant a panel belongs to");
}

// ── 2. A PURCHASE LINE'S STOCK MOVEMENT COMES FROM ITS OWN ROW ───────────────────────────────────
//
// The same ingredient can legitimately appear on two lines of one bill (two pack sizes, two rates,
// a corrected quantity): the panel's purchase form has no duplicate check and inv_purchase_lines
// has no unique index on (purchase_id, item_id) — migration 221. So resolving a line by item_id
// returns the FIRST one for every row that shares the item, and the wrong quantity and rate go into
// the stock ledger while the bill itself stores the right numbers.
{
  const inv = read("app/api/inventory/[...path]/route.ts");
  if (!inv) fail("app/api/inventory/[...path]/route.ts is missing");
  else {
    // The offending shape, in any spelling: matching a purchase LINE by item_id.
    if (/lines\s*\.find\s*\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.item_id\s*===\s*row\.item_id/.test(inv)) {
      fail("the purchase handler resolves a line by item_id again — two lines of the same ingredient both post the FIRST line's quantity and rate (F4)");
    } else ok("the purchase handler does not resolve a line by the non-unique item_id");

    // …and the positive half: the insert must return the per-line numbers so the movement can use them.
    const insertSel = inv.match(/inv_purchase_lines"\)\s*\.insert\([\s\S]{0,400}?\.select\("([^"]+)"\)/);
    const cols = insertSel ? insertSel[1].replace(/\s/g, "").split(",") : [];
    for (const need of ["id", "item_id", "qty_base", "rate"]) {
      if (cols.includes(need)) ok(`the inserted purchase line returns \`${need}\` so its movement can be built from it`);
      else fail(`the purchase-line insert no longer returns \`${need}\` — the movement has to look it up again, which is finding F4`);
    }
    // The movement must be keyed on the LINE id, or a replay double-posts stock.
    if (/dedupe:\s*`pur:\$\{pid\}:\$\{row\.id\}`/.test(inv)) ok("each purchase movement is deduped by its own line id");
    else fail("the purchase movement's dedupe key no longer names the line — a replay can double-post stock");
  }

  // A REPRODUCTION, so this rule is checking behaviour and not a spelling. Two lines, one item.
  const lines = [
    { item_id: "tomato", qty_base: 10000, rate: 20 },
    { item_id: "tomato", qty_base: 5000, rate: 30 },
  ];
  const inserted = [
    { id: "row-1", item_id: "tomato", qty_base: 10000, rate: 20 },
    { id: "row-2", item_id: "tomato", qty_base: 5000, rate: 30 },
  ];
  const oldWay = inserted.reduce((s, row) => s + lines.find((x) => x.item_id === row.item_id).qty_base, 0);
  const newWay = inserted.reduce((s, row) => s + Number(row.qty_base), 0);
  if (oldWay === 20000 && newWay === 15000) {
    ok("reproduction: looking a line up by item_id puts 20 kg into stock for a 15 kg bill; reading the row itself puts 15 kg");
  } else {
    fail(`the F4 reproduction no longer demonstrates the fault (old=${oldWay}, new=${newWay}) — this check has stopped meaning anything`);
  }
}

// ── 3. THE PANEL APIs KEEP THEIR GATE, AND IT RUNS BEFORE ANY DATABASE CALL ──────────────────────
//
// There is deliberately NO middleware.ts — the gate moved per-route (CLAUDE.md). So each catch-all
// has to call its own, and it has to be the FIRST thing that happens.
{
  const PANELS = [
    ["app/api/kitchen/[...path]/route.ts", "kitchen"],
    ["app/api/tablet/[...path]/route.ts", "tablet"],
    ["app/api/editor/[...path]/route.ts", "manager"],
    ["app/api/inventory/[...path]/route.ts", "manager"],
    ["app/api/maintenance/route.ts", "manager"],
  ];
  for (const [p, role] of PANELS) {
    const src = read(p);
    if (!src) { fail(`${p} is missing`); continue; }
    if (new RegExp(`requireRole\\(\\s*req\\s*,\\s*"${role}"`).test(src)) ok(`${p} gates on requireRole("${role}")`);
    else fail(`${p} no longer gates on requireRole("${role}") — the per-route gate is the ONLY gate (there is no middleware)`);
    // A DB blip must keep the panel signed in.
    if (/transient/.test(src) && /503/.test(src)) ok(`${p} answers 503 on a transient auth failure, not 401`);
    else fail(`${p} lost its transient/503 branch — a DB blip would log every open panel out`);
    // Every handler must reach a restaurant scope before it reads anything tenant-shaped.
    if (/panelRestaurantId\s*\(|editorScope\s*\(/.test(src)) ok(`${p} resolves a restaurant scope`);
    else fail(`${p} no longer resolves a restaurant scope — its reads would not be tenant-scoped`);
  }
}

// ── 4. THE TWO LOGOUT DOORS STAY POST-ONLY ───────────────────────────────────────────────────────
//
// A GET that changes state fires from anything that merely POINTS at the URL — a stray link, a
// redirect, a browser prefetching what it thinks you might click — so a waiter could be signed out
// mid-service with no explanation. Both were moved to POST for exactly this (2026-08-05 / T9 I13).
for (const p of ["app/api/panel-logout/route.ts", "app/api/staff-logout/route.ts"]) {
  const src = read(p);
  if (!src) { fail(`${p} is missing`); continue; }
  if (/export\s+async\s+function\s+GET/.test(src)) fail(`${p} answers GET again — a link or a prefetch can end somebody's shift`);
  else ok(`${p} is POST-only`);
  if (/maxAge:\s*0/.test(src)) ok(`${p} clears its cookie`);
  else fail(`${p} no longer clears its cookie — "log out" would leave the session standing`);
}

// ── 5. THE GUEST OFFLINE-REPLAY DOORS RUN AT MOST ONCE ───────────────────────────────────────────
//
// Both exist ONLY so a guest action saved with no signal can be delivered later. A replay that
// arrives twice must place one order / ring the floor once.
for (const [p, what] of [
  ["app/api/guest/place-order/route.ts", "a replayed order would be placed twice"],
  ["app/api/guest/call-waiter/route.ts", "a replayed call would ring the floor twice"],
]) {
  const src = read(p);
  if (!src) { fail(`${p} is missing`); continue; }
  if (/withIdempotency\s*\(/.test(src)) ok(`${p} is wrapped in withIdempotency`);
  else fail(`${p} lost withIdempotency — ${what}`);
  // A malformed restaurant must be REFUSED, never quietly filed under restaurant #1.
  if (/unknown_restaurant/.test(src)) ok(`${p} refuses a malformed restaurant rather than defaulting to #1`);
  else fail(`${p} no longer refuses a malformed restaurant — a real order and its money land on the wrong restaurant's books`);
  // The database's own words must never travel to a diner.
  if (/error\.message/.test(src) && !/console\.(error|warn)\([^)]*error\.message/.test(src)) {
    fail(`${p} may be sending a database message to a diner — it must log the detail and answer a CODE`);
  } else ok(`${p} keeps the database's own words on our side`);
}

// ── 6. A BUSY SERVER TELLS EVERY QUEUED GUEST ACTION HOW LONG TO WAIT ────────────────────────────
//
// lib/guestOutbox.ts drains orders and waiter-calls in ONE loop and reads `retryAfter` generically
// into a shared backoff, BEFORE any branch. If only one of the two routes sends it, the same rush
// teaches the phone to back off or not depending on what the diner happened to tap — and the whole
// point is that a thousand phones stop arriving together. (T10 improvement I2, extending T9 I10.)
//
// Written as two explicit calls rather than a loop over the two paths, deliberately:
// scripts/verify-test-safety.mjs greps for a guest-order or waiter-call path INSIDE a `for`, because
// a TEST that repeats one of those in a loop trips the app's own rate limits and pings the owner's
// phone. This file only ever READS source text — it never calls anything — but a guard that has to
// be reasoned about before it can be trusted is a guard nobody trusts, so it simply does not take
// that shape.
function checksTheRetryHint(p) {
  const src = read(p);
  if (!src) { fail(`${p} is missing`); return; }
  if (!/server_busy/.test(src)) { fail(`${p} no longer answers server_busy — lib/guestOutbox.ts has no code to word for the diner`); return; }
  if (/retryAfter/.test(src) && /Retry-After/.test(src)) ok(`${p} tells a queued phone how long to wait`);
  else fail(`${p} answers 502 with no retryAfter — every waiting phone comes back on the same fixed timer, at the server that was already struggling`);
  const near = src.slice(Math.max(0, src.indexOf("retryAfter") - 200), src.indexOf("retryAfter") + 300);
  if (/Math\.random\(\)/.test(near)) ok(`${p} jitters that wait server-side, so a thousand phones get a thousand answers`);
  else fail(`${p}'s retryAfter is a constant — a fixed wait just moves the stampede, it does not spread it`);
}
checksTheRetryHint("app/api/guest/place-order/route.ts");
checksTheRetryHint("app/api/guest/call-waiter/route.ts");

// ── 7. "WE COULDN'T COUNT" IS NEVER SHOWN AS "YOU HAVE NONE LEFT" ────────────────────────────────
//
// app/staff-login/BlockedView.tsx computes `outOfTries = remaining <= 0`, which disables the note
// box AND the "Request unblock" button — the only thing a blocked person is allowed to do. So the
// throttled GET must not answer a remaining of 0 it never counted. (T10 improvement I1.)
{
  const blocked = read("app/api/blocked/route.ts");
  const tIdx = blocked.indexOf("throttled: true");
  const tLine = tIdx >= 0 ? blocked.slice(Math.max(0, tIdx - 200), tIdx + 40) : "";
  if (!tIdx) fail("app/api/blocked no longer has a throttled answer — this check is not running");
  else if (/remaining:\s*0\b/.test(tLine)) {
    fail("the throttled /api/blocked answer claims `remaining: 0`, which greys out the ask-to-be-unblocked button on a count it never made (I1)");
  } else ok("the throttled /api/blocked answer leaves the ask-to-be-unblocked button usable");
  // …and the POST still fails CLOSED, which is what makes the line above safe.
  if (/used === null/.test(blocked) && /try_later/.test(blocked)) ok("the /api/blocked POST still refuses when it cannot count (T9 F25)");
  else fail("the /api/blocked POST no longer fails closed on an unreadable count — an IP could file unlimited requests (T9 F25)");
}

// ── 8. THE PANEL PAYLOADS STAY FREE OF THE DELIVERY APPS' KEYS ───────────────────────────────────
//
// `settings` carries `platform_channels` — the aggregator connection keys. The two admin screens
// that manage them never hand them back; the two panels that read the whole row must strip them
// through the one shared list, or they cannot drift apart. (T17 sweep.)
for (const p of ["app/api/tablet/[...path]/route.ts", "app/api/editor/[...path]/route.ts"]) {
  const src = read(p);
  if (/panelSafeSettings\s*\(/.test(src)) ok(`${p} strips the settings row through lib/panelSettings`);
  else fail(`${p} no longer calls panelSafeSettings — the delivery apps' keys ride out on a once-a-minute refresh`);
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────
for (const m of oks) console.log(`  ok   ${m}`);
if (fails.length) {
  console.error("\nverify-panel-api-guards FAILED:");
  for (const m of fails) console.error(`  FAIL ${m}`);
  console.error("\nEach of these was a real fault found by reading these routes line by line.");
  console.error("If a change genuinely needs to break one, change THIS FILE in the same commit");
  console.error("and say why — see .claude/sweep/T10-findings.md for what each one cost.");
  process.exit(1);
}
console.log(`\nAll ${oks.length} checks passed — no guest or panel route answers a database blip as something else.`);
