// verify-outbound-honesty.mjs — "does an answer we send OUT ever carry our database's words,
// and does a RETRY ever read as a failure?"
//
//   node scripts/verify-outbound-honesty.mjs                # static (no DB, no login)
//   node scripts/verify-outbound-honesty.mjs --base <url>    # + live checks (read-only, writes nothing)
//
// WHY THIS EXISTS (T9 sweep, 2026-08-05 — the follow-up pass)
// Two habits kept reappearing in different files, and both were found again in this scope:
//
//   1. A DATABASE MESSAGE SENT TO SOMEONE WHO CANNOT USE IT. `/api/maintenance` answered a failed
//      read with `r.error.message`, so a malformed `?rid=` put *"invalid input syntax for type
//      uuid"* on a manager's screen (seen live). The aggregator webhook did the same OUTWARD, to a
//      third party: a duplicate insert sent back *"duplicate key value violates unique constraint
//      aggregator_orders_restaurant_source_ext_key"* — our schema, in Zomato's log. The project
//      already knows this rule (guest/place-order logs the detail and answers a CODE; owner/staff
//      maps 23505 to a friendly 409) — it just had not reached these two.
//
//   2. A RETRY ANSWERED AS A FAILURE. `lfh_platform_insert` is a plain INSERT and
//      aggregator_orders has UNIQUE (restaurant_id, source, external_id) (mig 079), so a retried
//      webhook could never create a duplicate ORDER — that part was always safe. But it threw,
//      the route turned it into a 500, and **every aggregator treats 5xx as "not delivered"**. So
//      an order we already had would be retried forever and never acknowledged. The fix is the
//      contract our own panels already have (lib/idempotency.ts): a duplicate is answered with the
//      ORIGINAL row and a 200.
//
// This file pins both, so neither habit can come back quietly.
import fs from "node:fs";
import path from "node:path";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const BASE = arg("--base");
let fail = 0, pass = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const read = (f) => { try { return fs.readFileSync(path.resolve(f), "utf8"); } catch { return null; } };

console.log("Outbound honesty — plain words out, a retry is not a failure\n");

// ── 1 · a retried aggregator order is acknowledged, not refused ─────────────────────────────────
{
  const agg = read("lib/aggregators.ts");
  if (!agg) bad("lib/aggregators.ts not found (if it moved, update this guard)");
  else {
    if (/23505/.test(agg)) ok("a unique-violation on ingest is recognised as a repeat, not an error");
    else bad("ingestIncoming does not handle 23505 — a retried webhook still answers as a failure");
    // It must answer with the row we ALREADY hold, or the aggregator has nothing to match on.
    if (/from\("aggregator_orders"\)[\s\S]{0,220}external_id/.test(agg)) ok("the existing order is looked up and returned");
    else bad("the repeat path does not return the existing order");
    if (/duplicate:\s*true/.test(agg)) ok("the repeat is flagged `duplicate: true` for the caller");
    else bad("nothing tells the caller this was a repeat");
    // And no database text may travel outward.
    if (!/throw new Error\(error\.message\)/.test(agg)) ok("ingest no longer throws the raw database message");
    else bad("ingest still throws `error.message` — that text reaches an outside caller");
    if (/console\.error\(`\[aggregators\]/.test(agg) || /console\.error\("\[aggregators\]/.test(agg))
      ok("the real detail is logged on our side");
    else bad("the database detail is discarded instead of logged — we'd have nothing to debug with");
  }
  const route = read("app/api/aggregators/webhook/[source]/route.ts");
  if (!route) bad("the webhook route not found");
  else if (/row\?\.duplicate/.test(route)) ok("the webhook answers a repeat with 200, so the retry loop ends");
  else bad("the webhook does not pass `duplicate` through — a repeat still looks undelivered");
}

// ── 2 · no route in this scope hands a database message to its caller ──────────────────────────
{
  // `error.message` straight into a response body. Each of these was a real screen or a real
  // outbound payload; add a file here when a new public/panel-facing route appears.
  const WATCH = [
    "app/api/maintenance/route.ts",
    "app/api/aggregators/webhook/[source]/route.ts",
    "app/api/guest/place-order/route.ts",
    "app/api/r/[restaurant]/menu-data/route.ts",
  ];
  for (const f of WATCH) {
    const src = read(f);
    if (!src) { bad(`${f} not found`); continue; }
    // A raw passthrough looks like: error: <something>.error.message   (inside a NextResponse.json)
    const raw = [...src.matchAll(/error:\s*[A-Za-z_$][\w.$]*\.error\.message/g)].length;
    if (!raw) ok(`${f} sends no raw database message`);
    else bad(`${f} sends a database message to its caller (${raw} place(s))`);
  }
}

// ── 3 · live, and it writes NOTHING ────────────────────────────────────────────────────────────
if (!BASE) {
  console.log("\n  (skipped the live checks — pass --base <url> to run them)");
} else {
  const { adminHeaders } = await import("./sweep/login.mjs");
  const { randomUUID } = await import("node:crypto");
  const H = { ...adminHeaders(BASE), "Content-Type": "application/json" };

  // The maintenance zero-rows branch. A RANDOM uuid can never be a real restaurant, so the UPDATE
  // matches nothing and nothing is created, changed or deleted (the "a probe must never be able to
  // change anything" rule). The admin super-user's own path skips the per-restaurant write gate,
  // which is what makes this branch reachable at all without touching data.
  const ghost = randomUUID();
  for (const on of [true, false]) {
    const r = await fetch(`${BASE}/api/maintenance?rid=${ghost}`, { method: "POST", headers: H, body: JSON.stringify({ on }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409) ok(`taking the menu ${on ? "down" : "back up"} on a restaurant with no settings row → 409, refused in words`);
    else bad(`expected 409, got ${r.status} — a write that matched no row must not read as success`);
    if (j.error && !/uuid|syntax|constraint|relation|column/i.test(String(j.error)))
      ok("the refusal is a plain sentence, with no database words in it");
    else bad(`the refusal carries database words: ${String(j.error).slice(0, 90)}`);
  }

  // A malformed rid used to surface "invalid input syntax for type uuid" from Postgres.
  const r2 = await fetch(`${BASE}/api/maintenance?rid=not-a-uuid`, { method: "POST", headers: H, body: JSON.stringify({ on: false }) });
  const j2 = await r2.json().catch(() => ({}));
  if (!/invalid input syntax|uuid/i.test(String(j2.error || "")))
    ok("a malformed restaurant id no longer prints a Postgres parse error on the screen");
  else bad(`a Postgres parse error still reaches the caller: ${String(j2.error).slice(0, 90)}`);

  // The webhook stays dormant and says so, without a signature or a payload being needed.
  const w = await fetch(`${BASE}/api/aggregators/webhook/zomato`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const wj = await w.json().catch(() => ({}));
  if (w.status === 200 && wj.disabled === true) ok("the aggregator webhook is still dormant and answers { disabled: true }");
  else bad(`unexpected webhook answer: ${w.status} ${JSON.stringify(wj).slice(0, 90)}`);
  const w2 = await fetch(`${BASE}/api/aggregators/webhook/nonsense`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (w2.status === 404) ok("an unknown source is refused with 404");
  else bad(`an unknown source answered ${w2.status}, expected 404`);
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(fail
  ? "\n❌ FAIL — plain words go out; the detail stays in our log; a repeat is answered, not refused."
  : "\n✅ PASS — nothing we send out carries our database's words, and a retry is acknowledged");
process.exit(fail ? 1 : 0);
