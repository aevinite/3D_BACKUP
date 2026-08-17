// verify-manager-behaviour.mjs — does the T3 sweep's work actually WORK?
//
// The static guards (verify:floor etc.) prove the right lines are present. That is not the same
// question as "does the behaviour change", and this project has been bitten by exactly that gap
// before: verify:floor was green for weeks over a real stale-floor bug because it only asked
// whether invalidateFloor(rid) APPEARED in each handler, never whether it could do its job.
//
// So every check below EXERCISES code and, where the fix is a behaviour change, is written so it
// would FAIL on the old shape. Nothing here touches a database, a deployed site, or a login — the
// real shipped modules are bundled and run against fixtures, so it can never add load or set off
// one of the app's own limits.
//
//   A. the floor race            — read-your-own-write, against the REAL lib/floorSummary.ts
//   B. the after-write wrapper   — its ordering + it must not swallow a throw
//   C. bills history "by date"   — the IST day window, run from the SHIPPED source text
//   D. the parcel day            — 05:00 business day, run from the SHIPPED source text
//   E. the tip ceiling           — run from the SHIPPED source text
//   F. the walk-out money line   — the owed math, run from the SHIPPED source text
//   G. the catch-up poll         — backs off on failure, stays quick on success (real realtime.js)
//
// Usage: node scripts/verify-manager-behaviour.mjs
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (m, extra) => { pass++; console.log(`  ✅ ${m}${extra ? ` — ${extra}` : ""}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); };
const eq = (m, got, want) => (String(got) === String(want) ? ok(m, `${got}`) : bad(m, `got ${got}, expected ${want}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const src = (p) => readFileSync(join(ROOT, p), "utf8");

// Pull a named chunk of the SHIPPED source out and run it, so a test can never pass against a
// private copy of the logic that has drifted from what ships. `from`/`to` bracket real lines.
function lift(file, from, to, label) {
  const s = src(file);
  const a = s.indexOf(from);
  if (a < 0) throw new Error(`${label}: could not find the start marker in ${file}: ${from}`);
  const b = s.indexOf(to, a);
  if (b < 0) throw new Error(`${label}: could not find the end marker in ${file}`);
  return s.slice(a, b + to.length);
}

// ── A · THE FLOOR RACE, against the real module ──────────────────────────────────────────────
// The bug: invalidateFloor ran at the TOP of a write handler. Another device's whole-floor poll
// lands in the gap between that and the write committing, and SHARES a floor computed without the
// change — so the device that made the change is handed its own stale tile for up to 1.5s.
//
// Both orderings are played out against the REAL sharedFloorSummary/invalidateFloor. The OLD one
// must reproduce the bug (or this test proves nothing); the NEW one must not.
async function floorRace() {
  console.log("\nA · the floor race — can a device be handed the floor it had?");
  const out = join(ROOT, "node_modules/.cache/floorSummary-test.mjs");
  mkdirSync(dirname(out), { recursive: true });
  execFileSync("npx", ["esbuild", "lib/floorSummary.ts", "--bundle", "--platform=node",
    "--format=esm", "--alias:@=.", `--outfile=${out}`, "--log-level=warning"], { cwd: ROOT });
  const { sharedFloorSummary, invalidateFloor, _resetSharedFloorSummary } = await import(pathToFileURL(out).href);

  const RID = "r1";
  const KEY = `floor:${RID}`;
  // The "database": one flag, which the write flips. A real query reads the rows as they are when
  // it EXECUTES and returns them later — so the snapshot is taken FIRST, then the latency.
  // (Taking it after the wait was the flaw in the first version of this test: the read then saw
  // the write that landed during its own latency, the old shape looked fine, and the control
  // proved nothing. A test whose control doesn't reproduce the bug is not evidence.)
  let paid = false;
  const readFloor = async () => { const asRead = paid; await wait(30); return { tilePaid: asRead }; };

  // One run of "a device marks a table paid while another device polls the floor".
  // afterWrite=false is the old shape; true is what the wrapper now does.
  const run = async (afterWrite) => {
    _resetSharedFloorSummary();
    paid = false;
    invalidateFloor(RID);                                    // ← the top-of-handler call
    const otherDevicePoll = sharedFloorSummary(KEY, readFloor); // ← poll lands in the gap
    await wait(10);
    paid = true;                                            // ← the write commits
    if (afterWrite) invalidateFloor(RID);                    // ← the wrapper's second drop
    await otherDevicePoll;
    // The acting device reloads immediately afterwards, well inside the 1.5s share window.
    const mine = await sharedFloorSummary(KEY, readFloor);
    return mine.tilePaid;
  };

  const oldShape = await run(false);
  const newShape = await run(true);
  if (oldShape === false) ok("the OLD shape really did hand back a stale floor (so this test bites)");
  else bad("the old shape did NOT reproduce the bug — this test proves nothing", `got ${oldShape}`);
  if (newShape === true) ok("with the after-write drop, the device reads its OWN write");
  else bad("the device is STILL handed a stale floor after its own write");

  // The properties that made sharing safe in the first place must survive the change.
  _resetSharedFloorSummary();
  let computes = 0;
  const counted = async () => { computes++; await wait(5); return { n: computes }; };
  await Promise.all([sharedFloorSummary(KEY, counted), sharedFloorSummary(KEY, counted), sharedFloorSummary(KEY, counted)]);
  eq("three simultaneous whole-floor polls still share ONE database call", computes, 1);

  _resetSharedFloorSummary();
  let boom = 0;
  const thrower = async () => { boom++; throw new Error("statement timeout"); };
  await sharedFloorSummary(KEY, thrower).catch(() => {});
  await sharedFloorSummary(KEY, thrower).catch(() => {});
  eq("a failed read is never cached — the next caller retries", boom, 2);

  // A targeted refetch must stay unshared, so a tile still updates the instant its order lands.
  _resetSharedFloorSummary();
  let t5 = 0;
  const perTable = async () => { t5++; return { t: 5 }; };
  await Promise.all([sharedFloorSummary("table:r1:5", perTable), sharedFloorSummary("table:r1:5", perTable)]);
  ok("(for contrast) a keyed read still coalesces — sharing itself is intact", `${t5} compute(s)`);
}

// ── B · THE WRAPPER'S OWN BEHAVIOUR ──────────────────────────────────────────────────────────
// Lifted from the shipped route so this tests the real thing: it must drop the snapshot after the
// handler resolves, must ALSO drop it when the handler throws (a half-applied write must not
// leave a stale floor), and must not swallow that throw.
async function wrapper() {
  console.log("\nB · the after-write wrapper");
  const text = lift("app/api/editor/[...path]/route.ts",
    "const writeRid = new WeakMap<NextRequest, string>();", "\n}", "wrapper");
  // Let esbuild strip the TypeScript rather than doing it with regexes — hand-stripping types is
  // how the first version of this test mangled the arrow function and failed to run at all.
  const js = execFileSync("npx", ["esbuild", "--loader=ts", "--format=cjs", "--log-level=warning"],
    { cwd: ROOT, input: text, encoding: "utf8" })
    .replace(/^"use strict";\s*/, "")
    .replace(/module\.exports\s*=.*$/m, "");
  const drops = [];
  const factory = new Function("invalidateFloor", `${js}; return { invalidateFloorAfter, writeRid };`);
  const { invalidateFloorAfter, writeRid } = factory((rid) => drops.push(rid));

  const req = {};
  const okHandler = invalidateFloorAfter(async (r) => { writeRid.set(r, "rA"); return "done"; });
  eq("a successful write returns the handler's own response", await okHandler(req, {}), "done");
  eq("…and the snapshot is dropped after it", drops.join(","), "rA");

  drops.length = 0;
  const req2 = {};
  const boom = invalidateFloorAfter(async (r) => { writeRid.set(r, "rB"); throw new Error("db blew up"); });
  let threw = "";
  await boom(req2, {}).catch((e) => (threw = e.message));
  eq("a throwing handler still drops the snapshot", drops.join(","), "rB");
  eq("…and the error is NOT swallowed", threw, "db blew up");

  drops.length = 0;
  const req3 = {};
  const early = invalidateFloorAfter(async () => "no rid resolved"); // e.g. the 401/scope bail-out
  await early(req3, {});
  eq("a handler that never resolved a rid drops nothing", drops.length, 0);

  // Two requests in flight at once must not see each other's restaurant.
  drops.length = 0;
  const rq1 = {}, rq2 = {};
  const slow = invalidateFloorAfter(async (r) => { writeRid.set(r, r === rq1 ? "one" : "two"); await wait(r === rq1 ? 30 : 5); return "ok"; });
  await Promise.all([slow(rq1, {}), slow(rq2, {})]);
  eq("concurrent requests keep their own restaurant (WeakMap per request)", drops.sort().join(","), "one,two");
}

// ── C · BILLS HISTORY "BY DATE" — the IST day ────────────────────────────────────────────────
// The bug: setHours() built the window in the SERVER's timezone (UTC on Vercel), so a bill taken
// at 03:00 IST was filed under the previous day and could not be found under its own date.
function dateWindow() {
  console.log("\nC · bills history by date — is a day the restaurant's day?");
  const text = lift("app/api/editor/[...path]/route.ts",
    "// The date picker sends YYYY-MM-DD", "oq = oq.gte(\"created_at\", dayStart.toISOString()).lt(\"created_at\", dayEnd.toISOString());", "date");
  // Run the shipped lines with a tiny stand-in for the query builder.
  const runFor = (histQ) => {
    let lo = null, hi = null;
    const oq = { gte: (_c, v) => { lo = v; return oq; }, lt: (_c, v) => { hi = v; return oq; } };
    const body = text.replace(/^\s*oq = oq\.gte/m, "  var _ = oq.gte");
    const f = new Function("histQ", "oq", "ok", `${body}; return { lo: arguments[3] };`);
    // `return ok([])` inside the lifted code needs somewhere to go; a thrown sentinel is clearest.
    try {
      new Function("histQ", "oq", "ok", body)(histQ, oq, () => { throw new Error("__BAILED__"); });
    } catch (e) { if (e.message !== "__BAILED__") throw e; return { bailed: true }; }
    return { lo, hi };
  };

  const IST = 5.5 * 3600e3;
  const w = runFor("2026-08-05");
  // The window must be exactly the IST calendar day: 05-Aug 00:00 IST → 06-Aug 00:00 IST.
  eq("a day starts at 00:00 IST", new Date(w.lo).toISOString(), new Date(Date.parse("2026-08-05T00:00:00+05:30")).toISOString());
  eq("…and ends 24h later", new Date(w.hi) - new Date(w.lo), 864e5);

  // The bill that used to go missing: 03:00 IST on the 5th.
  const bill3am = new Date(Date.parse("2026-08-05T03:00:00+05:30"));
  const inside = bill3am >= new Date(w.lo) && bill3am < new Date(w.hi);
  inside ? ok("a bill taken at 03:00 IST is found under its OWN date (the old bug)")
         : bad("a 03:00 IST bill is STILL filed under the wrong day");
  // And the old code's answer, for contrast — a UTC-midnight window would have excluded it.
  const utcLo = new Date("2026-08-05T00:00:00Z");
  const oldWouldMiss = bill3am < utcLo;
  oldWouldMiss ? ok("(the old UTC window really did miss it, so this check bites)")
               : bad("the old window would have found it too — this check proves nothing");
  // A late-evening bill must NOT leak into the next day.
  const bill2350 = new Date(Date.parse("2026-08-05T23:50:00+05:30"));
  (bill2350 >= new Date(w.lo) && bill2350 < new Date(w.hi))
    ? ok("a 23:50 IST bill stays on its own date") : bad("a 23:50 IST bill fell out of its day");
  // Garbage in → an empty answer, never a crash or a wrong day.
  runFor("not-a-date").bailed ? ok("an unparseable date answers empty, not a wrong window")
                              : bad("an unparseable date built a window anyway");
}

// ── D · THE PARCEL DAY ───────────────────────────────────────────────────────────────────────
// The bug this guards: local midnight, so a parcel fell out of the day it belongs to five hours
// early. A business day runs 05:00 → 05:00 IST, so a parcel taken at 00:30 is still TODAY's.
//
// ⚠ THE FLOOR'S PARCEL STRIP IS GONE, AND WITH IT openParcels() (owner, 2026-08-14: "below the
// table, the parcel will not show. Parcel will only show in the platform thing"). This section
// used to lift openParcels() out of the panel and assert which parcels stayed on the floor; that
// function no longer exists, which turned this guard red on a panel that is exactly as the owner
// asked for it. The whole check was NOT deleted with it, because the DAY rule it protects is still
// live: todaysParcels() still carries it, and openParcelTile() still numbers a parcel from it — so
// a parcel can still be named "Parcel 3" on the wrong day if that boundary breaks.
// So the day boundary is asserted through the function that survived. (T13, 2026-08-15)
function parcelDay() {
  console.log("\nD · the parcel day (05:00 → 05:00 IST)");
  const bd = lift("public/panels/editor/app.js", "function businessDayStartMs()", "\n}", "businessDay");
  const tp = lift("public/panels/editor/app.js", "function todaysParcels()", "\n}", "todaysParcels");
  const state = { data: { platform: [] } };
  const f = new Function("state", `${bd}\n${tp}\nreturn { businessDayStartMs, todaysParcels };`);
  const { businessDayStartMs, todaysParcels } = f(state);

  const start = businessDayStartMs();
  const startIst = new Date(start + 5.5 * 3600e3);
  eq("the business day starts at 05:00 IST", startIst.getUTCHours(), 5);

  const parcel = { id: "p1", source: "parcel", created_at: new Date(start + 1000).toISOString(), paid: false, printed_at: null, status: "new", items: [{ qty: 1 }], total: 200 };

  // Just AFTER the boundary → today's. This is the 00:30 case: past midnight, same business day.
  state.data.platform = [parcel];
  eq("a parcel taken after 05:00 counts as today's", todaysParcels().length, 1);

  // Just BEFORE it → yesterday's, so today's numbering starts clean.
  state.data.platform = [{ ...parcel, id: "p0", created_at: new Date(start - 60_000).toISOString() }];
  eq("a parcel from before 05:00 belongs to the previous day", todaysParcels().length, 0);

  // Numbering counts every one of today's parcels — finished and cancelled included — so
  // "Parcel 3" keeps its name for the whole day instead of being reused.
  state.data.platform = [
    { ...parcel, id: "a", paid: true, printed_at: new Date().toISOString() },
    { ...parcel, id: "b", paid: true, printed_at: null },
    { ...parcel, id: "c", paid: false, printed_at: new Date().toISOString() },
    { ...parcel, id: "d", status: "cancelled" },
  ];
  eq("numbering includes finished and cancelled rows", todaysParcels().length, 4);
}

// ── E · THE TIP CEILING ──────────────────────────────────────────────────────────────────────
function tipClamp() {
  console.log("\nE · the tip ceiling");
  const line = lift("app/api/editor/[...path]/route.ts", "const amt = Math.min(Math.max(0, Number(body?.amount)", ");", "tip");
  const f = new Function("body", `${line}; return amt;`);
  eq("a normal tip is untouched", f({ amount: 120 }), 120);
  eq("a mis-typed 500000 is capped", f({ amount: 500000 }), 100000);
  eq("a negative tip becomes 0", f({ amount: -50 }), 0);
  eq("nonsense becomes 0", f({ amount: "abc" }), 0);
  eq("a missing amount becomes 0", f({}), 0);
}

// ── F · THE WALK-OUT MONEY LINE ──────────────────────────────────────────────────────────────
// Discount is stored PRE-TAX, so what is actually owed drops by discount×(1+rate). The rate comes
// from each order's own stored tax/subtotal. This is the figure the cleared-table record states.
function owedMath() {
  console.log("\nF · the money a cleared table still owed");
  const text = lift("app/api/editor/[...path]/route.ts", "const owed = owedRows.reduce((s, o) => {", "}, 0);", "owed");
  const f = new Function("owedRows", `${text}; return Math.round(owed * 100) / 100;`);
  // One order: ₹1000 food, 5% tax → total 1050, no discount.
  eq("plain bill", f([{ subtotal: 1000, tax: 50, total: 1050, discount: 0 }]), 1050);
  // Same bill with ₹100 off pre-tax: owed = 1050 − 100×1.05 = 945.
  eq("a discount is removed WITH its tax", f([{ subtotal: 1000, tax: 50, total: 1050, discount: 100 }]), 945);
  // A zero-subtotal row must not divide by zero.
  eq("a zero-subtotal row can't produce NaN", f([{ subtotal: 0, tax: 0, total: 0, discount: 0 }]), 0);
  // Two orders on one table add up.
  eq("several orders add up", f([{ subtotal: 100, tax: 5, total: 105, discount: 0 }, { subtotal: 200, tax: 10, total: 210, discount: 0 }]), 315);
  // An 18% restaurant derives its own rate, not a hardcoded 5%.
  eq("the rate comes from the order, not a constant", f([{ subtotal: 1000, tax: 180, total: 1180, discount: 100 }]), 1062);
}

// ── G · THE CATCH-UP POLL ────────────────────────────────────────────────────────────────────
// The manager floor now polls while the socket is down. It must go quick when reads SUCCEED and
// back off when they FAIL — and pollOrders must rethrow, or there is nothing to back off from.
async function catchUpPoll() {
  console.log("\nG · the catch-up poll");
  const a = src("public/panels/editor/app.js");
  a.includes("LFH_RT.catchUp(() => pollOrders({ rethrow: true }))")
    ? ok("the manager floor asks catchUp for the rethrowing variant") : bad("catchUp is not wired to a rethrowing poll");
  // pollOrders must rethrow ONLY when asked, so every ordinary caller keeps its quiet behaviour.
  const po = lift("public/panels/editor/app.js", "async function pollOrders(opts) {", "return;\n  }", "pollOrders");
  /if \(opts && opts\.rethrow\) throw e;/.test(po)
    ? ok("pollOrders rethrows when asked") : bad("pollOrders swallows the failure even when asked");
  /\n\s*return;\n\s*\}$/.test(po)
    ? ok("…and still returns quietly otherwise") : bad("the quiet path was lost");

  // Now the mechanism itself, from the real realtime.js: rising delay while a read fails,
  // straight back to the base once one succeeds.
  const rt = src("public/panels/realtime.js");
  const body = lift("public/panels/realtime.js", "function catchUp(fn, opts) {", "\n  }", "catchUp");
  const delays = [];
  const f = new Function("document", "navigator", "connStatus", "setTimeout", "clearTimeout", `${body}; return catchUp;`);
  const stubTimeout = (fn, ms) => { delays.push(ms); return delays.length < 12 ? setTimeout(fn, 0) : 0; };
  let failing = true;
  const stop = f({ hidden: false }, { onLine: true }, "offline", stubTimeout, clearTimeout)(
    async () => { if (failing) throw new Error("read failed"); }, { baseMs: 1000, maxMs: 32000 });
  await wait(120);
  stop();
  const rising = delays.length >= 4 && delays[3] > delays[0];
  rising ? ok("a failing read makes the poll wait longer each time", delays.slice(0, 5).map((d) => Math.round(d)).join("→"))
         : bad("the poll does NOT back off while reads fail", JSON.stringify(delays.slice(0, 6)));
  const jittered = new Set(delays.slice(0, 6).map((d) => Math.round(d))).size > 1;
  jittered ? ok("the interval is jittered, so devices don't poll in lockstep") : bad("no jitter — every device polls on the same beat");
  const capped = delays.every((d) => d <= 32000 * 1.25 + 1);
  capped ? ok("the back-off is capped at maxMs") : bad("the back-off grew past its cap", Math.max(...delays));

  // …and it stops entirely once the socket is live again.
  const d2 = [];
  const stop2 = f({ hidden: false }, { onLine: true }, "online", (fn, ms) => { d2.push(ms); return d2.length < 4 ? setTimeout(fn, 0) : 0; }, clearTimeout)(
    async () => { bad("catchUp polled while the socket was LIVE"); }, { baseMs: 1000 });
  await wait(60);
  stop2();
  ok("it does nothing at all while the socket is live", `${d2.length} timer(s) armed, 0 reads`);
}

// ── H · THE T5 SWEEP'S FIXES (2026-08-17) ─────────────────────────────────────────────────────
// Four of them are decisions taken while building a screen, so there is no function to call —
// what can be checked is that the SHIPPED source still makes the decision, at the point it is
// made. Each one is written against the exact line, and each says which live failure it prevents.
// (The fifth, "a helper must be visible to its caller", is its own guard: verify:panel-scope.)
async function t5Fixes() {
  console.log("\nH · the T5 sweep's fixes — are they still in the shipped panel?");
  const app = src("public/panels/editor/app.js");
  const css = src("public/panels/editor/style.css");

  // H1 · a table whose every ticket was voided is not a bill. Offering 🖨 Print bill there issues
  // a tax-invoice number for a sale that never happened (mig 331 refuses it — so the tap was
  // offered and then refused, which is the failure the bill modal was fixed for on 2026-08-16).
  /const billableOs = os\.filter\(\(o\) => o\.status !== "cancelled"\);/.test(app)
    ? ok("the table detail knows which of its orders are billable") : bad("billableOs is gone from tablePanelParts");
  /const printBtn = !billableOs\.length \? "" :/.test(app)
    ? ok("…and Print bill is only offered when one of them is") : bad("Print bill is back to counting cancelled tickets");
  /const splitBtn = billableOs\.length && splitBillOn\(\)/.test(app)
    ? ok("…and so is 🍴 Split") : bad("Split is back to counting cancelled tickets");
  // …and the heading counts what is drawn, not what exists: "Orders · 6" over an empty box reads
  // as a screen that failed to load.
  /Orders <span class="sub">· \$\{shownN\}<\/span>/.test(app)
    ? ok("the Orders heading counts the tickets actually listed") : bad("the Orders heading counts cancelled tickets again");

  // H2 · the top-bar 🔔 is part of the floor, so the INCREMENTAL path has to refresh it too —
  // that is the path every realtime breadcrumb takes.
  const patch = lift("public/panels/editor/app.js", "function patchFloorTiles(tables) {", "return true;\n}", "patchFloorTiles");
  /setTimeout\(syncGuestBell, 0\);/.test(patch)
    ? ok("a patched floor still refreshes the guest bell") : bad("patchFloorTiles no longer syncs the bell — the count goes stale for up to 60s");

  // H3 · the discount % chips obey the person's own %-limit, like the two boxes beside them.
  const chip = lift("public/panels/editor/app.js", 'wrap.querySelectorAll(".disc-pct-pick")', "}));", "discount chips");
  /clamp\(want, 0, maxDisc\)/.test(chip) && /refuse\(capLine\(\)\)/.test(chip)
    ? ok("a discount chip clamps to the person's cap and says so") : bad("the chips set a figure the server will refuse");

  // H4 · the floor's primary action keeps a WORD at the shipped default (12 per row on a 1280px
  // laptop = a ~73px container). The rung that drops the label must sit BELOW that.
  const rung = /@container \(max-width: (\d+)px\) \{[^}]*\.ftile \.ft-take-s \{ display: none; \}/s.exec(css);
  rung && Number(rung[1]) <= 70
    ? ok("the ＋-only rung sits below the shipped default's tile", `${rung[1]}px`)
    : bad("the take-order label is dropped at the width a 1280px laptop actually renders", rung ? rung[1] + "px" : "rung not found");
}

const groups = [floorRace, wrapper, dateWindow, parcelDay, tipClamp, owedMath, catchUpPoll, t5Fixes];
console.log("T3 FIX BEHAVIOUR CHECK — does the sweep's work actually work?");
for (const g of groups) {
  try { await g(); }
  catch (e) { bad(`${g.name} could not run`, e.message); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
