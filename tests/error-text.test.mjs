// tests/error-text.test.mjs — a recorded problem must be READABLE by a person.
// Run with: npm run test:errors  (plain `node --test`, no extra dependencies)
//
// The bug this pins down (owner ticket, 2026-07-31): the waiter tablet's floor read failed while
// the database was overloaded, Supabase's gateway answered with a Cloudflare error PAGE, and the
// app stored that page verbatim. The admin's Problems list, the Logs row, the phone alert and the
// title of the "Fix NOW" ticket all read `<!DOCTYPE html> <!--[if lt IE 7]>…`. Nothing was broken
// about the fix pipeline — the owner simply could not tell what had gone wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readableError, errorSig } from "../lib/errorSignature.ts";

// The real thing, as it was stored on 2026-07-31 (trimmed; the tail is Cloudflare boilerplate).
const CF_522 = `<!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
<!--[if IE 7]>    <html class="no-js ie7 oldie" lang="en-US"> <![endif]-->
<!--[if IE 8]>    <html class="no-js ie8 oldie" lang="en-US"> <![endif]-->
<!--[if gt IE 8]><!--> <html class="no-js" lang="en-US"> <!--<![endif]-->
<head>

<title>supabase.co | 522: Connection timed out</title>
<meta charset="UTF-8" />
</head><body><h1>Connection timed out</h1></body></html>`;

test("a gateway error page becomes one plain sentence, keeping what it said", () => {
  const out = readableError(CF_522);
  assert.equal(out, 'the server replied with an error page instead of data: "supabase.co | 522: Connection timed out"');
});

test("no markup survives — this is what reached the owner's screen and phone", () => {
  const out = readableError(CF_522);
  for (const junk of ["<!DOCTYPE", "<html", "<title>", "<!--", "-->", "<meta"]) {
    assert.ok(!out.includes(junk), `recorded text still contains ${junk}`);
  }
});

test("an error page with no <title> still never records raw markup", () => {
  const out = readableError("<html><body><h1>502 Bad Gateway</h1><p>nginx</p></body></html>");
  assert.ok(!out.includes("<"), "stripped fallback leaked a tag");
  assert.ok(out.includes("502 Bad Gateway"), "the one useful line was thrown away");
});

test("ordinary error messages are returned untouched", () => {
  // These are the messages that actually explain a fault — they must not be reworded.
  for (const msg of [
    "canceling statement due to statement timeout",
    "upstream request timeout",
    'invalid input syntax for type uuid: "7f3a"',
    "new row violates row-level security policy",
    "",
  ]) {
    assert.equal(readableError(msg), msg);
  }
});

test("null/undefined never blow up the logger", () => {
  assert.equal(readableError(null), "");
  assert.equal(readableError(undefined), "");
});

test("the readable text still groups as ONE problem, whatever the request id", () => {
  // Two 522s minutes apart must land in the same Problems tile rather than looking like
  // two different faults (that is what errorSig is for; it must survive the rewording).
  const a = errorSig(`GET summary — ${readableError(CF_522)}`);
  const b = errorSig(`GET summary — ${readableError(CF_522.replace("522", "523"))}`);
  assert.equal(a, b, "the same gateway failure produced two different signatures");
  assert.ok(a.length > 0);
});

// The shape logError actually stores: "<what was being done> — <message>", capped at 500.
test("the stored line reads as a sentence and fits the column", () => {
  const detail = `${"GET summary"} — ${readableError(CF_522)}`.slice(0, 500);
  assert.ok(detail.startsWith("GET summary — the server replied"), detail.slice(0, 60));
  assert.ok(detail.length < 500, "a whole page is still being stored");
});

// ── "IT ISN'T THERE ANY MORE" IS NOT A CRASH (2026-08-03) ─────────────────────────────────────
// From the admin error board on 2026-08-02: "POST orders/<id>/accept — Cannot coerce the result
// to a single JSON object". A tap landed on an order that no longer existed, so the .single()
// lookup matched nothing, PostgREST said PGRST116 — and the route turned that into a 500. Three
// things were wrong at once: a developer's sentence reached a waiter mid-service; a red crash row
// went onto the board next to the real faults; and 5xx means "the server is struggling, keep the
// tap and retry it", so a tap that could NEVER succeed was queued and retried behind their back.
// (Exactly the fault lib/dbRefusal.ts was written for — see migration 260 — one class wider.)
import { isMissingRow, refusalStatus, refusalMessage, worthLogging, isDataRefusal } from "../lib/dbRefusal.ts";

/** What supabase-js hands back for a .single() that matched nothing, as `must()` rethrows it. */
const noRow = () => Object.assign(new Error("Cannot coerce the result to a single JSON object"), {
  code: "PGRST116", details: "The result contains 0 rows", hint: null,
});
/** The SAME code for the opposite problem: a duplicate row that should not exist. */
const twoRows = () => Object.assign(new Error("Cannot coerce the result to a single JSON object"), {
  code: "PGRST116", details: "Results contain 2 rows, application/vnd.pgrst.object+json requires 1 row", hint: null,
});
/** A genuine server failure — the case that must keep every bit of its old behaviour. */
const serverDown = () => Object.assign(new Error("canceling statement due to statement timeout"), {
  code: "57014", details: null,
});

test("a row that is gone is a 404, not a 500 — so the tap is never retried behind their back", () => {
  assert.equal(refusalStatus(noRow()), 404);
  assert.ok(refusalStatus(noRow()) < 500, "5xx would send it to the offline queue forever");
  assert.equal(isMissingRow(noRow()), true);
});

test("what the waiter reads is a sentence, not PostgREST", () => {
  const msg = refusalMessage(noRow());
  assert.ok(!/coerce|JSON|PGRST/i.test(msg), msg);
  assert.match(msg, /not there any more/i);
});

test("an ordinary race is not written to the error board", () => {
  assert.equal(worthLogging(noRow()), false);
});

test("MORE than one row is a real fault and keeps its 500 and its red row", () => {
  // Same PGRST116 code, opposite meaning: a duplicate that should not exist.
  assert.equal(isMissingRow(twoRows()), false);
  assert.equal(refusalStatus(twoRows()), 500);
  assert.equal(worthLogging(twoRows()), true);
});

test("a struggling server still behaves exactly as before — 500, logged, retried", () => {
  assert.equal(refusalStatus(serverDown()), 500);
  assert.equal(worthLogging(serverDown()), true);
  assert.equal(isDataRefusal(serverDown()), false);
  assert.equal(refusalMessage(serverDown()), "canceling statement due to statement timeout");
});

test("the value-refusal cases mig 260 fixed are untouched", () => {
  const check = Object.assign(new Error('new row for relation "settings" violates check constraint "settings_floor_per_row_range"'), { code: "23514" });
  assert.equal(refusalStatus(check), 400);
  assert.equal(worthLogging(check), true, "a constraint the code outgrew must stay visible");
  assert.match(refusalMessage(check), /between 2 and 30/);
});
