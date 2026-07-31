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
