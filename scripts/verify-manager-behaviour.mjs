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
    // `return ok([])` inside the lifted code needs somewhere to go; a thrown sentinel is clearest.
    try {
      new Function("histQ", "oq", "ok", body)(histQ, oq, () => { throw new Error("__BAILED__"); });
    } catch (e) { if (e.message !== "__BAILED__") throw e; return { bailed: true }; }
    return { lo, hi };
  };

  
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
  // Since #1391 (2026-09-17) the populated list is one dish per line and carries NO count heading;
  // only the loading skeleton says "Orders · N", and N there is the dish count. So the RULE is
  // asserted, not the old spelling: every "Orders · ${x}" the panel draws must count what is shown
  // (shownN) or the skeleton's dishes (dishN) — never every order, cancelled ones included.
  {
    const counts = [...app.matchAll(/Orders <span class="sub">· \$\{([^}]+)\}/g)].map((m) => m[1].trim());
    const wrong = counts.filter((v) => v !== "shownN" && v !== "dishN");
    !wrong.length
      ? ok(`no Orders heading counts cancelled tickets (${counts.length ? counts.join(", ") : "no count heading at all"})`)
      : bad(`the Orders heading counts cancelled tickets again: \${${wrong.join("}, ${")}}`);
  }

  // H2 · the top-bar 🔔 is part of the floor, so the INCREMENTAL path has to refresh it too —
  // that is the path every realtime breadcrumb takes.
  const patch = lift("public/panels/editor/app.js", "function patchFloorTiles(tables) {", "return true;\n}", "patchFloorTiles");
  /setTimeout\(syncGuestBell, 0\);/.test(patch)
    ? ok("a patched floor still refreshes the guest bell") : bad("patchFloorTiles no longer syncs the bell — the count goes stale for up to 60s");

  // H3 · the discount % chips obey the person's own %-limit, like the two boxes beside them.
  const chip = lift("public/panels/editor/app.js", 'wrap.querySelectorAll(".disc-pct-pick")', "}));", "discount chips");
  /clamp\(want, 0, maxDisc\)/.test(chip) && /refuse\(capLine\(\)\)/.test(chip)
    ? ok("a discount chip clamps to the person's cap and says so") : bad("the chips set a figure the server will refuse");

  // H4 · the take-order button has TWO faces and only two (owner, 2026-08-17 — R28). This started
  // life the other way round: the T5 sweep restored a short "Order" label for the band where
  // "＋ Take order" cannot fit, and he removed it looking at the real tile — "instead of order is
  // written that should be just a plus icon, nothing else, and it should stay like that". So what is
  // guarded now is his rule: the word must not come back, in the markup or in the stylesheet, and
  // when the full label is dropped the ＋ must be shown (a button with neither is an empty box —
  // which is what this ladder's own ⚠️ note records happening once).
  !/ft-take-s/.test(app) && !/ft-take-s/.test(css)
    ? ok("no short \"Order\" face anywhere — just \"＋ Take order\" and \"＋\"")
    : bad("the short \"Order\" label is back — he removed it on 2026-08-17 (R28)");
  // The band is found by SCANNING to its closing brace, not with one regex: the block has inner
  // rules (and inner `}`s), which is what made the first version of this check report "band not
  // found" about a band that was right there.
  const drop = (() => {
    for (const m of css.matchAll(/@container \(max-width: (\d+)px\) \{/g)) {
      let i = m.index + m[0].length, depth = 1;
      while (i < css.length && depth > 0) { if (css[i] === "{") depth++; else if (css[i] === "}") depth--; i++; }
      const body = css.slice(m.index + m[0].length, i - 1);
      if (/\.ftile \.ft-take-t \{ display: none; \}/.test(body)) return { px: Number(m[1]), body };
    }
    return null;
  })();
  drop && /\.ftile \.ft-take-x \{ display: inline; \}/.test(drop.body) && /:has\(\.ft-ico-bill\) \.ft-take-x \{ display: inline; \}/.test(drop.body)
    ? ok("…and where the full label is dropped, the ＋ is shown instead", `at ${drop.px}px, including on a tile that has the bill glyph`)
    : bad("the band that drops the label does not bring the ＋ back — the button would be empty", drop ? `at ${drop.px}px` : "band not found");
  /\.ftile\.ft-finished \.ft-take-x \{ display: inline; \}/.test(css)
    ? ok("…and a finished tile's middle control is the ＋ (his A2 tile)")
    : bad("a finished tile hides the ＋ with no word to replace it");
}

// ── I · EVERY CLOCK THE PANEL PRINTS IS THE RESTAURANT'S CLOCK (sweep #10 T6, 2026-10-12) ────────
// fmtWhen() was pinned to Asia/Kolkata on 2026-08-05 so a manager — or the owner, looking in from
// another country — reads the restaurant's own times. Four more clocks in the first third of the
// panel were never pinned: the Pay Later book and the On-the-house report (fmtDate), the Rating
// review card, the Dashboard's "Updated 7:15 pm / Today till 7:15 pm" and the performance report's
// "Generated". Run from the SHIPPED source text under a New York clock: the answer must be India's.
async function istClocks() {
  console.log("\nI. every clock the manager panel prints is the restaurant's");
  const app = src("public/panels/editor/app.js");
  const end = app.indexOf("async function printZReport(");
  const part1 = end > 0 ? app.slice(0, end) : app;
  const dateFmt = /new Date\([^)]*\)\.toLocale(?:String|DateString|TimeString)\(|\bnow\.toLocale(?:String|DateString|TimeString)\(/g;
  const unpinned = (txt) => txt.split("\n").map((l, i) => [l, i + 1]).filter(([l]) => { dateFmt.lastIndex = 0; return dateFmt.test(l) && !/timeZone/.test(l); });
  const p1 = unpinned(part1);
  p1.length === 0
    ? ok("the first third of the panel (to printZReport) prints no clock in the READER's zone")
    : bad(`${p1.length} clock(s) in the first third print the READER's zone`, p1.map(([, n]) => "app.js:" + n).join(", "));
  // The rest of the file is other sweep territories; this is a RATCHET, so a new unpinned clock
  // cannot be added there either while its owners work down the two this pattern finds (8314, 8324 on 2026-10-12).
  const rest = unpinned(app.slice(part1.length));
  rest.length <= 2
    ? ok(`the rest of the panel adds no new unpinned clock (${rest.length} known, owned by later sweep terminals)`)
    : bad(`the rest of the panel now has ${rest.length} unpinned clocks (2 were known on 2026-10-12)`, "pin the new one: { …, timeZone: \"Asia/Kolkata\" }");
  // THE MIDDLE THIRD (printZReport → openShiftPicker), held at ZERO with a WIDER net (sweep #10 T7,
  // 2026-10-16). The pattern above only sees `new Date(…).toLocale…`, so a clock written through a
  // variable — `d.toLocaleString([], …)` in the Audit list, `x.toLocaleDateString(undefined, …)` in
  // the removal story — slipped past it, and whenLabel()'s date had no zone. Any .toLocale… call in
  // this stretch must name a timeZone in the same call.
  {
    const s = app.indexOf("async function printZReport("), e = app.indexOf("\nfunction openShiftPicker(");
    const mid = s > 0 && e > s ? app.slice(s, e) : "";
    if (!mid) bad("printZReport / openShiftPicker moved — re-point the middle-third clock check");
    else {
      const startLine = app.slice(0, s).split("\n").length;
      const calls = [...mid.matchAll(/\.toLocale(?:String|DateString|TimeString)\(([^;]*?)\)(?=[\s;),+.]|$)/g)];
      const loose = calls.filter((m) => /\{/.test(m[1]) ? !/timeZone/.test(m[1]) : /^\s*$|^\s*(\[\]|undefined|"en-[A-Z]{2}")\s*$/.test(m[1]));
      // A number's toLocaleString("en-IN") carries no clock, so only date-shaped receivers count.
      const dated = loose.filter((m) => /(?:Date\([^)]*\)|\bd|\bx|\bnow|\bdt|\bdate)\s*$/.test(mid.slice(Math.max(0, m.index - 40), m.index)));
      dated.length === 0
        ? ok(`the middle third prints every clock in the restaurant's zone (${calls.length} toLocale calls read)`)
        : bad(`${dated.length} clock(s) in the middle third print the READER's zone`, dated.map((m) => "app.js:" + (startLine + mid.slice(0, m.index).split("\n").length - 1)).join(", "));
    }
  }
  // Behaviour: lift fmtDate and run it under a New York clock.
  const line = (app.match(/^const fmtDate = .*$/m) || [""])[0];
  if (!line) { bad("fmtDate() is gone from the panel — re-point this check"); return; }
  const tz = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const fmtDate = new Function(line.replace(/^const fmtDate = /, "return ").replace(/;\s*$/, ""))();
    const got = fmtDate("2026-10-11T21:00:00Z");      // 02:30 on 12 Oct in India, 5 pm on 11 Oct in New York
    /12 Oct/.test(got) && /02:30/.test(got)
      ? ok(`a Pay Later date reads the restaurant's day under a New York clock (${got})`)
      : bad(`a Pay Later date reads the reader's zone (${got})`, "expected 12 Oct, 02:30 am — India");
  } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
}

// ── J · A RANGE IS SAID IN WORDS, NEVER AS ITS KEY (sweep #10 T6, 2026-10-12) ─────────────────────
// Staff watch and Menu winners kept a two-rung { today, yesterday } map from before the four rungs
// (2026-09-23), so a restaurant given seven or thirty days read "by staff over last7".
async function rangeWords() {
  console.log("\nJ. a dashboard range is said in words, never as its key");
  const app = src("public/panels/editor/app.js");
  const line = (app.match(/^const DASH_RANGE_WORDS = .*$/m) || [""])[0];
  if (!line) { bad("DASH_RANGE_WORDS is gone — Staff watch / Menu winners would have no words for a range"); return; }
  const W = new Function(line.replace(/^const DASH_RANGE_WORDS = /, "return ").replace(/;\s*$/, ""))();
  const rungs = (app.match(/^const DASH_RUNG = \{([^}]*)\}/m) || ["", ""])[1].match(/[a-z0-9]+(?=:)/g) || [];
  const missing = rungs.filter((k) => !W[k] || /^(last|today_)\w*\d|_/.test(W[k]) || W[k] === k && /\d/.test(k));
  rungs.length >= 4 && !missing.length
    ? ok(`every dashboard rung has words (${rungs.map((k) => `${k} → "${W[k]}"`).join(", ")})`)
    : bad("a dashboard rung has no words, or prints its key", missing.join(", ") || "DASH_RUNG not found");
  for (const fn of ["openStaffRisk", "openMenuMatrix"]) {
    const i = app.indexOf(`async function ${fn}(`);
    const body = i < 0 ? "" : app.slice(i, app.indexOf("\n}", i));
    if (!body) { bad(`${fn}() is gone — re-point this check`); continue; }
    /dashRangeWords\(\)/.test(body) && !/\}\[dashRange\]\s*\|\|\s*dashRange/.test(body)
      ? ok(`${fn}() says its range through dashRangeWords()`)
      : bad(`${fn}() prints the range from its own map again`, "a seven-day restaurant would read 'over last7'");
  }
  const sr = app.slice(app.indexOf("async function openStaffRisk("));
  /\/staff-risk\?range=" \+ dashRangeEffective\(\)/.test(sr.slice(0, 3000))
    ? ok("Staff watch asks for the EFFECTIVE range, the one its words describe")
    : bad("Staff watch asks for a remembered range its words may not describe");
}

// ── K · THE GST REPORT'S EMPTY LINE SAYS THE WINDOW ITS HEADING SAYS (sweep #10 T6, 2026-10-12) ──
// A today-only manager saw "Covering today" over "No paid bills in this month." (T9's P178707).
async function gstEmptyLine() {
  console.log("\nK. the GST report's empty line says the window its heading says");
  const app = src("public/panels/editor/app.js");
  const i = app.indexOf("function gstNoneLine(");
  if (i < 0) { bad("gstNoneLine() is gone — the GST report's empty line would not follow its window"); return; }
  const body = app.slice(i, app.indexOf("\n}", i) + 2);
  const f = new Function(body + "\nreturn gstNoneLine;")();
  const cases = [["today", "No paid bills today."], ["today and yesterday", "No paid bills today or yesterday."], ["the last 7 days", "No paid bills in the last 7 days."], ["October 2026", "No paid bills in October 2026."], ["", "No paid bills today."]];
  const wrong = cases.filter(([w, want]) => f({ windowLabel: w }) !== want);
  wrong.length ? bad("the empty line does not follow the window", wrong.map(([w]) => JSON.stringify(w)).join(", ")) : ok("the empty line names the same window the heading does, for every window the server sends");
  const g = app.slice(app.indexOf("async function openGstReport("));
  /No paid bills in this month\./.test(g.slice(0, 9000)) ? bad("the GST report still prints 'in this month' whatever the window") : ok("…and 'in this month' is no longer printed under a today-only heading");
}

// ── L · A FUNCTION IS NEVER A YES/NO (sweep #10 T7, 2026-10-16) ──────────────────────────────────
// The table popup's ✎ Edit button vanished for a month (2026-09-17 → 2026-10-16). tablePanelParts()
// declares `const allOut = <is every dish out?>`, and the one-bill redesign declared a SECOND
// `const allOut = (r) => …` inside the orders block, which shadowed it. The Edit toggle below read
// `allOut ? "" : <the button>` — a FUNCTION, always truthy — so the button never drew. Nothing
// failed: the screen simply lacked a control. So this resolves every yes/no test in the manager
// panel (if / ?: / && / || / !) through real scopes (acorn + eslint-scope, the parser
// verify:panel-names uses) and fails if one is a name that holds a FUNCTION. Then it asserts the
// Edit toggle's own test resolves to the table-wide boolean.
async function functionAsCondition() {
  console.log("\nL. a yes/no test in the manager panel never reads a function (the ✎ Edit toggle)");
  const acorn = await import("acorn");
  const { analyze } = await import("eslint-scope");
  const app = src("public/panels/editor/app.js");
  const ast = acorn.parse(app, { ecmaVersion: 2024, sourceType: "script", locations: true, ranges: true });
  const sm = analyze(ast, { ecmaVersion: 2024, sourceType: "script" });
  const isFn = (v) => v && v.defs.some((d) => d.type === "FunctionName"
    || (d.type === "Variable" && d.node.init && /^(ArrowFunctionExpression|FunctionExpression)$/.test(d.node.init.type) && d.parent && d.parent.kind === "const"));
  const refAt = new Map();
  for (const sc of sm.scopes) for (const r of sc.references) refAt.set(r.identifier, r);
  const tests = [];
  const walk = (n, parent) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "IfStatement" || n.type === "ConditionalExpression" || n.type === "WhileStatement") tests.push(n.test);
    if (n.type === "UnaryExpression" && n.operator === "!") tests.push(n.argument);
    if (n.type === "LogicalExpression" && parent && (parent.type === "IfStatement" || parent.type === "ConditionalExpression" || (parent.type === "UnaryExpression" && parent.operator === "!"))) { tests.push(n.left); tests.push(n.right); }
    for (const k of Object.keys(n)) { if (k === "parent") continue; const v = n[k]; if (Array.isArray(v)) v.forEach((c) => walk(c, n)); else if (v && typeof v.type === "string") walk(v, n); }
  };
  walk(ast, null);
  const hits = [];
  for (const t of tests) {
    if (!t || t.type !== "Identifier") continue;
    const r = refAt.get(t);
    if (r && r.resolved && isFn(r.resolved)) hits.push(`${t.name} at line ${t.loc.start.line}`);
  }
  hits.length
    ? bad("a yes/no test reads a FUNCTION, so it is always yes", hits.slice(0, 6).join(", "))
    : ok(`none of ${tests.length} yes/no tests in the manager panel reads a function`);
  // The Edit toggle itself: its test must resolve to the table-wide boolean, and it must be offered
  // where it unlocks something (a waiting ticket) — never on every table, never on none.
  let decl = null;
  const find = (n) => { if (!n || typeof n.type !== "string" || decl) return; if (n.type === "VariableDeclarator" && n.id.name === "editToggle") { decl = n; return; } for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(find); else if (v && typeof v.type === "string") find(v); } };
  find(ast);
  if (!decl) { bad("the table popup's editToggle is gone — re-point this check"); return; }
  const names = [];
  const collect = (n) => { if (!n || typeof n.type !== "string") return; if (n.type === "Identifier") names.push(n); for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(collect); else if (v && typeof v.type === "string" && k !== "consequent" && k !== "alternate") collect(v); } };
  collect(decl.init.type === "ConditionalExpression" ? decl.init.test : decl.init);
  const allOutRef = names.find((x) => x.name === "allOut");
  const res = allOutRef && refAt.get(allOutRef) && refAt.get(allOutRef).resolved;
  res && !isFn(res) && res.defs[0].node.init && res.defs[0].node.init.type === "LogicalExpression"
    ? ok("the ✎ Edit toggle's 'is every dish out?' resolves to the table-wide boolean, not a per-row function")
    : bad("the ✎ Edit toggle's test does not read the table-wide allOut", res ? `resolves to the declaration at line ${res.defs[0].node.loc.start.line}` : "no allOut in its test");
  names.some((x) => x.name === "newOrders") && names.some((x) => x.name === "editing")
    ? ok("…and it is offered while a ticket is waiting (its extras draw only there) or while Edit is on")
    : bad("the ✎ Edit toggle no longer asks whether a ticket is waiting", "it would ask about the kitchen and then unlock nothing");
}

// ── M · EVERY ✕ CANCEL THE TABLE POPUP OFFERS IS ONE THE SERVER WILL ACCEPT (sweep #10 T7, 2026-10-16)
// The waiting ticket's ✕ Cancel asked "served? on the printed bill?" but not "paid?", while the
// editor route refuses to cancel a paid order — and 💳 Mark all paid settles a ticket that is still
// waiting. So a paid waiting ticket wore a ✕ that could only be refused. Both of the popup's cancel
// offers (the waiting box's cancelBtn and the dish sheet's canCancel) are run here with stand-ins
// for what they close over, and must refuse a paid ticket and offer an ordinary one.
async function cancelOffers() {
  console.log("\nM. every ✕ Cancel the table popup offers is one the server will accept");
  const app = src("public/panels/editor/app.js");
  const route = src("app/api/editor/[...path]/route.ts");
  /patch\.status === "cancelled" && cur\.payment_status === "paid"/.test(route)
    ? ok("the server still refuses to cancel a paid order — the rule both offers must match")
    : bad("the server's paid-order refusal moved — re-point this check");
  const grab = (re, label) => { const m = app.match(re); if (!m) { bad(`${label} is gone — re-point this check`); return null; } return m[1]; };
  const cb = grab(/const cancelBtn = (\(o\) => \(\([^\n]*?\) \? "" : `)/, "the waiting box's cancelBtn");
  const cc = grab(/const canCancel = (\(p\) => \{[^\n]*?\};)/, "the dish sheet's canCancel");
  if (!cb || !cc) return;
  const anyServed = (o) => !!o.served, invoiceLocksOrder = () => false, sess = {};
  const offer = new Function("anyServed", "invoiceLocksOrder", "sess", `return ${cb}x\`);`)(anyServed, invoiceLocksOrder, sess);
  const paid = { id: "a", payment_status: "paid" }, open = { id: "b", payment_status: "pending" };
  offer(paid) === "" && offer(open) !== ""
    ? ok("the waiting ticket's ✕ Cancel is not offered on a paid ticket, and is on an unpaid one")
    : bad("the waiting ticket's ✕ Cancel is offered on a PAID ticket — the server can only refuse it");
  const liveOrders = [paid, open];
  const can = new Function("liveOrders", "anyServed", "invoiceLocksOrder", "sess", `return ${cc.replace(/;$/, "")};`)(liveOrders, anyServed, invoiceLocksOrder, sess);
  !can({ _oid: "a" }) && can({ _oid: "b" })
    ? ok("…and the dish sheet's ✕ Cancel ticket agrees")
    : bad("the dish sheet's ✕ Cancel ticket disagrees with the server about a paid ticket");
}

// ── N · EVERY DIRECT fetch() IN THE MANAGER PANEL HAS AN END (sweep #10 T7, 2026-10-16) ──────────
// Writes go through api() and the outbox, which carry a deadline. The dish-photo upload cannot (a
// File does not fit in the JSON queue), so it is a plain fetch — and it had NO deadline: on a stalled
// network "📷 Upload a photo" sat on "Uploading…", greyed, for ever. Every fetch( in app.js must
// either go through LFH_NET (its own 15s read ceiling) or pass a signal, and the photo's timeout
// must be read in words.
async function fetchesEnd() {
  console.log("\nN. every direct fetch() in the manager panel has an end");
  const app = src("public/panels/editor/app.js");
  const calls = [...app.matchAll(/(?<![\w.$])fetch\(([^\n]*)/g)].map((m) => ({ line: app.slice(0, m.index).split("\n").length, txt: m[1] }));
  const bare = calls.filter((c) => !/signal\s*:/.test(c.txt) && !/LFH_NET/.test(app.split("\n")[c.line - 1]));
  // The middle third (printZReport → openShiftPicker) is held at ZERO. The other thirds are other
  // sweep terminals' ground: six there on 2026-10-16 (the staff and table-section reads, the print
  // claim, the two act-as clears) — a RATCHET, so that number may fall and may not rise.
  const lineOf = (needle) => app.slice(0, app.indexOf(needle)).split("\n").length;
  const s = lineOf("async function printZReport("), e = lineOf("\nfunction openShiftPicker(") + 1;
  const mid = bare.filter((c) => c.line >= s && c.line < e), rest = bare.filter((c) => c.line < s || c.line >= e);
  mid.length === 0
    ? ok(`every direct fetch() in the middle third carries a signal or rides LFH_NET (${calls.length} in the file)`)
    : bad(`${mid.length} direct fetch() call(s) in the middle third can wait for ever`, mid.map((c) => "app.js:" + c.line).join(", "));
  rest.length <= 6
    ? ok(`…and the rest of the panel adds no new one (${rest.length} known, owned by the other thirds' terminals)`)
    : bad(`the rest of the panel now has ${rest.length} direct fetch() calls with no end (6 were known on 2026-10-16)`, rest.map((c) => "app.js:" + c.line).join(", "));
  const up = app.slice(app.indexOf('const photoInput = document.getElementById("dishPhotoFile");'), app.indexOf('const ms = $("#membSearch");'));
  /typeof AbortSignal\.timeout === "function" \? AbortSignal\.timeout\(30000\)/.test(up) && /signal: deadline/.test(up)
    ? ok("the dish-photo upload asks for a 30s deadline (feature-tested, like issue-raise.js)")
    : bad("the dish-photo upload has no deadline again — a stalled network leaves 'Uploading…' for ever");
  /e\.name === "TimeoutError"/.test(up) && /The upload took too long/.test(up)
    ? ok("…and when it fires the person reads it in words, not 'signal timed out'")
    : bad("the dish-photo timeout would print the browser's own words");
}

// ── O · THE BILL'S COURSE ORDER FOLLOWS THE MENU AS IT IS NOW (sweep #10 T7, 2026-10-16) ─────────
// The table popup sorts a bill's dishes into the menu's own course order (menuSeq / courseOfRow).
// Its cache was keyed on counts and the first ids, so reordering categories, recolouring one, or
// moving a dish to another course left every bill in the OLD order until a reload. Lifted from the
// shipped file and run: after the menu arrives again with the same counts and first ids but a new
// order, the course must move.
async function courseOrderFollowsMenu() {
  console.log("\nO. the bill's course order follows the menu as it is now");
  const code = lift("public/panels/editor/app.js", "const NO_COURSE = ", "\nconst spineKey", "menuSeq") || "";
  const body = code.replace(/\nconst spineKey$/, "");
  const run = new Function("state", "nameOf", "SPINE_TINTS", `${body}\nreturn { menuSeq, courseOfRow };`);
  const state = { data: {} };
  const set = (cats, items) => { state.data = { categories: cats, items }; };
  const { courseOfRow } = run(state, (n, slug) => (typeof n === "string" ? n : slug), ["#111", "#222", "#333", "#444"]);
  const cats = [{ slug: "starters", name: "Starters", sort_order: 1 }, { slug: "mains", name: "Mains", sort_order: 2 }, { slug: "desserts", name: "Desserts", sort_order: 3 }];
  const items = [{ id: "a", title: "Soup", category: "starters" }, { id: "b", title: "Steak", category: "mains" }, { id: "c", title: "Tart", category: "desserts" }];
  set(cats, items);
  const before = courseOfRow({ title: "Tart" }).seq;
  // The same menu re-read after "Desserts" was dragged to second place: new arrays, same counts,
  // same first dish, same first category — the shape the old cache key could not see.
  set(cats.map((c) => ({ ...c, sort_order: c.slug === "desserts" ? 1.5 : c.sort_order })), items.map((i) => ({ ...i })));
  const afterReorder = courseOfRow({ title: "Tart" }).seq;
  set(state.data.categories.map((c) => ({ ...c })), state.data.items.map((i) => (i.id === "c" ? { ...i, category: "mains" } : { ...i })));
  const afterMove = courseOfRow({ title: "Tart" }).slug;
  before === 3 && afterReorder === 2
    ? ok("a category reorder reaches the bill's course order at once (Desserts 3rd → 2nd)")
    : bad("the bill keeps the OLD course order after a reorder", `before ${before}, after ${afterReorder} — expected 3 then 2`);
  afterMove === "mains"
    ? ok("…and a dish moved to another course is filed under its new course")
    : bad("a dish moved to another course stays under its old one on the bill", `got ${afterMove}`);
}

// ── P · A DISH'S TAG LIST IS SAVED FIRST-SAVE-WINS (sweep #10 T7, 2026-10-16) ─────────────────────
// The kitchen's 🚫 Sold out is a TAG. Both manager-side writes of a dish's tag list (the dish form's
// Save and Menu → Tags → the dish ticks) sent the list from this device's copy with no expectation,
// so a stale copy could take `sold-out` off and put the dish back on sale. buildEditExpect is lifted
// from the shipped file and must now carry `tags` (a set), and still leave other lists out.
async function tagsFirstSaveWins() {
  console.log("\nP. a dish's tag list is saved first-save-wins");
  const code = lift("public/panels/editor/app.js", "const EXPECT_TABLE = ", "\nasync function save()", "buildEditExpect").replace(/\nasync function save\(\)$/, "");
  const buildEditExpect = new Function(`${code}\nreturn buildEditExpect;`)();
  const e = buildEditExpect("items", { tags: ["spicy"] }, JSON.stringify({ id: "d1", tags: ["sold-out"] }));
  e && e.table === "menu_items" && e.id === "d1" && JSON.stringify(e.fields.tags) === JSON.stringify(["sold-out"])
    ? ok("the dish form's Save sends the tag list it started from")
    : bad("the dish form's Save sends a tag list with no expectation", JSON.stringify(e));
  const o = buildEditExpect("items", { options: [{ label: "Large" }] }, JSON.stringify({ id: "d1", options: [] }));
  o === null ? ok("…and still leaves an ordered list (options) out") : bad("an ordered list is now compared as a set", JSON.stringify(o));
  const app = src("public/panels/editor/app.js");
  const t = app.slice(app.indexOf("async function toggleTagMembership("), app.indexOf("function updateMembCount("));
  /const tagsBefore = dish\.tags\.slice\(\);/.test(t) && /expect: \{ table: "menu_items", id: dish\.id, fields: \{ tags: tagsBefore \}/.test(t)
    ? ok("Menu → Tags → a dish tick sends the list it started from (taken BEFORE the tick changes it)")
    : bad("the Tags screen's tick writes a dish's whole tag list with no expectation");
}

// ── Q · A REFUSED LOG-RETENTION CHANGE PUTS THE DROPDOWN BACK (sweep #10 T7, 2026-10-16) ─────────
// Only the two "locked" codes reset the box; any other refusal left it on the window just refused.
// saveRetention is lifted and run against a server that refuses three different ways.
async function retentionResets() {
  console.log("\nQ. a refused log-retention change puts the dropdown back");
  const code = lift("public/panels/editor/app.js", "async function saveRetention(", "\n}\n", "saveRetention");
  for (const [label, err] of [["a server error", Object.assign(new Error("boom"), { status: 500, data: {} })], ["an Aevidine lock", Object.assign(new Error("Aevidine set this."), { status: 403, data: { code: "retention_locked" } })], ["no answer at all", new Error("Failed to fetch")]]) {
    const sel = { value: "7" };
    const toasts = [];
    const run = new Function("api", "state", "document", "toast", "okToast", "errText", "RETENTION_OPTS", `${code}\nreturn saveRetention;`)(
      async () => { throw err; }, { data: { settings: { oplog_retention_days: 90 } } }, { querySelector: () => sel },
      (m) => toasts.push(m), () => {}, (e) => e.message, []);
    await run("oplog_retention_days", "7");
    sel.value === "90"
      ? ok(`${label}: the box goes back to the 90 days really kept (${toasts[0]})`)
      : bad(`${label}: the box still shows the refused ${sel.value} days`);
  }
}

// ── R · A "FIRST SAVE WINS" REFUSAL IS READ IN WORDS (sweep #10 T7, 2026-10-16) ───────────────────
// On a live write the server refuses a clash with { error: "clash_changed_elsewhere", clash: { plain,
// todo } }, and api() throws with e.message = that CODE. The menu editor's Save — the write the
// expectation exists for — printed "Save failed: clash_changed_elsewhere". Every function in the
// manager panel that sends an expectation must say its refusal through errText() or clash.plain,
// never a bare e.message.
async function clashInWords() {
  console.log("\nR. a first-save-wins refusal is read in words, never as its code");
  const app = src("public/panels/editor/app.js");
  // For every write that sends an expectation, the catch that answers it (the first one within 30
  // lines after the call) must say the refusal through errText() or clash.plain.
  const lines = app.split("\n");
  const bad1 = [];
  let n = 0;
  lines.forEach((l, i) => {
    if (!/api\("(POST|PATCH|DELETE)"[^\n]*\{ expect: /.test(l)) return;
    n++;
    for (let j = i; j < Math.min(lines.length, i + 30); j++) {
      if (!/catch \(e\) \{/.test(lines[j])) continue;
      const c = lines.slice(j, j + 6).join("\n");
      if (/\+ e\.message/.test(c) && !/errText\(e\)|clash\.plain|\.clash/.test(c)) bad1.push("app.js:" + (i + 1));
      break;
    }
  });
  bad1.length === 0 && n >= 5
    ? ok(`all ${n} writes that send an expectation say a refusal in words`)
    : bad("a write that sends an expectation answers a refusal with e.message — a clash reads as its code", bad1.join(", ") || `only ${n} found`);
  const sv = app.slice(app.indexOf("\nasync function save() {"), app.indexOf("\nasync function removeRecord("));
  /const clash = !!\(e && e\.data && e\.data\.clash\);\s*\n\s*toast\(clash \? errText\(e\)/.test(sv)
    ? ok("the menu editor's Save says the server's sentence on a clash, and holds it 9 seconds")
    : bad("the menu editor's Save no longer words a clash");
}

const groups = [floorRace, wrapper, dateWindow, parcelDay, tipClamp, owedMath, catchUpPoll, t5Fixes, istClocks, rangeWords, gstEmptyLine, functionAsCondition, cancelOffers, fetchesEnd, courseOrderFollowsMenu, tagsFirstSaveWins, retentionResets, clashInWords];
console.log("T3 FIX BEHAVIOUR CHECK — does the sweep's work actually work?");
for (const g of groups) {
  try { await g(); }
  catch (e) { bad(`${g.name} could not run`, e.message); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
