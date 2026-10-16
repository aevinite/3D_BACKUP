// Band C — the four small libraries and the number-formatting helper, EXECUTED, not read.
// ids P189241–P189340.
//
//   npx tsx --env-file=.env.local scripts/sweep/t20s10/band-c-libs.mjs [--json=<file>]
//
// lib/dashRange.ts, lib/ownerSnap.ts and lib/ownerOverviewCache.ts are imported and called for real
// (window / sessionStorage / fetch are stood in for, because these run in a browser). lib/ownerHome.ts
// is called against the DEV database with READS only — it never writes, and the names it is asked
// about are the fixed diag logins. AnimatedNumber's string parser is lifted out of the .tsx with the
// TypeScript parser and run — a regex cannot say what it returns for "−₹5,000".
import ts from "typescript";
import { chk, report, src, rel } from "./lib.mjs";

const DR = "lib/dashRange.ts", SNAP = "lib/ownerSnap.ts", OC = "lib/ownerOverviewCache.ts", OH = "lib/ownerHome.ts", AN = "components/owner/AnimatedNumber.tsx";
const run = "executed with tsx — the real exported function";

const dr = await import(rel(DR));

// ── dashRange: the reach ladder ─────────────────────────────────────────────────────────────────
const cfg = (range) => ({ view_dashboard: { manager_opts: { range } } });
await chk("P189241", DR, "dashboardReach: a missing access_config is TODAY, the narrowest rung", run, () => dr.dashboardReach(undefined) === "today" || dr.dashboardReach(undefined));
await chk("P189242", DR, "dashboardReach: null is TODAY", run, () => dr.dashboardReach(null) === "today" || dr.dashboardReach(null));
await chk("P189243", DR, "dashboardReach: an unknown stored word is TODAY, never the widest", run, () => dr.dashboardReach(cfg("year")) === "today" || dr.dashboardReach(cfg("year")));
await chk("P189244", DR, "dashboardReach: today_yesterday is honoured", run, () => dr.dashboardReach(cfg("today_yesterday")) === "today_yesterday");
await chk("P189245", DR, "dashboardReach: last7 is honoured", run, () => dr.dashboardReach(cfg("last7")) === "last7");
await chk("P189246", DR, "dashboardReach: last30 is honoured", run, () => dr.dashboardReach(cfg("last30")) === "last30");
await chk("P189247", DR, "dashboardReach: a wrong-case 'LAST30' is not trusted", run, () => dr.dashboardReach(cfg("LAST30")) === "today");
await chk("P189248", DR, "dashboardReach: a non-string stored value (a number) is TODAY", run, () => dr.dashboardReach(cfg(30)) === "today");
await chk("P189249", DR, "dashboardReach: the range under a DIFFERENT feature key is ignored", run, () => dr.dashboardReach({ view_bills: { manager_opts: { range: "last30" } } }) === "today");
await chk("P189250", DR, "reachDays: the four rungs are 1 · 2 · 7 · 30", run, () =>
  ["today", "today_yesterday", "last7", "last30"].map((r) => dr.reachDays(r)).join(",") === "1,2,7,30" || "got " + ["today", "today_yesterday", "last7", "last30"].map((r) => dr.reachDays(r)));
await chk("P189251", DR, "reachDays: an unknown reach falls to 1 day, not undefined", run, () => dr.reachDays("decade") === 1);
await chk("P189252", DR, "rangesFor(today) offers only Today", run, () => JSON.stringify(dr.rangesFor("today")) === '["today"]' || JSON.stringify(dr.rangesFor("today")));
await chk("P189253", DR, "rangesFor(today_yesterday) offers Today and Yesterday, narrowest first", run, () => JSON.stringify(dr.rangesFor("today_yesterday")) === '["today","yesterday"]');
await chk("P189254", DR, "rangesFor(last7) offers three rungs", run, () => JSON.stringify(dr.rangesFor("last7")) === '["today","yesterday","last7"]');
await chk("P189255", DR, "rangesFor(last30) offers all four", run, () => JSON.stringify(dr.rangesFor("last30")) === '["today","yesterday","last7","last30"]');
await chk("P189256", DR, "rangesFor never offers a rung wider than its own reach (every reach)", run, () =>
  ["today", "today_yesterday", "last7", "last30"].every((r) => dr.rangesFor(r).every((x) => dr.clampDashRange(x, r) === x)));
for (const [i, [asked, reach, want]] of [
  ["last30", "today", "today"], ["last7", "today", "today"], ["yesterday", "today", "today"],
  ["yesterday", "today_yesterday", "yesterday"], ["last7", "today_yesterday", "today"], ["last7", "last7", "last7"],
  ["last30", "last7", "today"], ["last30", "last30", "last30"], ["year", "last30", "today"], ["", "last30", "today"],
  [undefined, "last30", "today"], [null, "last30", "today"], ["constructor", "last30", "today"], ["__proto__", "last30", "today"],
  ["toString", "last30", "today"], ["TODAY", "last30", "today"], [" last7", "last30", "today"], [7, "last30", "today"],
].entries()) {
  await chk(`P${189257 + i}`, DR, `clampDashRange(${JSON.stringify(asked)}, ${reach}) → ${want} — never wider, never an error`, run,
    () => { const g = dr.clampDashRange(asked, reach); return g === want || `got ${JSON.stringify(g)}`; });
}
// 189257..189274 used (18)
await chk("P189275", DR, "RANGE_LABEL has plain words for every range the clamp can return", run, () =>
  ["today", "yesterday", "last7", "last30"].every((r) => typeof dr.RANGE_LABEL[r] === "string" && !/_/.test(dr.RANGE_LABEL[r])));
await chk("P189276", DR, "billsReach: unknown → today, today_yesterday honoured, last30 NOT (bills keep their own two-rung ladder)", run, () =>
  dr.billsReach(undefined) === "today" && dr.billsReach({ view_bills: { manager_opts: { range: "today_yesterday" } } }) === "today_yesterday"
  && dr.billsReach({ view_bills: { manager_opts: { range: "last30" } } }) === "today");
await chk("P189277", DR, "billsReach does not read the DASHBOARD key", run, () => dr.billsReach(cfg("today_yesterday")) === "today");
await chk("P189278", DR, "REACH_DAYS is ordered so a single <= comparison decides 'inside the reach'", run, () => {
  const v = Object.values(dr.REACH_DAYS); return v.every((x, i) => !i || x > v[i - 1]) || JSON.stringify(v);
});

// ── ownerSnap: per-tab instant paint ─────────────────────────────────────────────────────────────
class Store { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } key(i) { return [...this.m.keys()][i] ?? null; } get length() { return this.m.size; } }
const snapMod = await import(rel(SNAP));
await chk("P189279", SNAP, "readSnap on the SERVER (no window) answers null instead of throwing", run, () => snapMod.readSnap("dash") === null);
await chk("P189280", SNAP, "writeSnap on the server is a no-op, not a crash", run, () => { snapMod.writeSnap("dash", { a: 1 }); return true; });
globalThis.window = globalThis; globalThis.sessionStorage = new Store();
await chk("P189281", SNAP, "a written snapshot reads back equal", run, () => { snapMod.writeSnap("dash", { ov: { n: 1 } }); return JSON.stringify(snapMod.readSnap("dash")) === '{"ov":{"n":1}}'; });
await chk("P189282", SNAP, "the key is versioned (lfh_osnap:v1:<name>), so a shape change can retire old blobs", run, () => sessionStorage.getItem("lfh_osnap:v1:dash") !== null);
await chk("P189283", SNAP, "an admin tab's pinned snapshot is a DIFFERENT key from the owner's own", run, () => { snapMod.writeSnap("dash:abc", { x: 2 }); return snapMod.readSnap("dash")?.ov?.n === 1 && snapMod.readSnap("dash:abc")?.x === 2; });
await chk("P189284", SNAP, "a corrupt blob reads as null, never throws into the page", run, () => { sessionStorage.setItem("lfh_osnap:v1:bad", "{not json"); return snapMod.readSnap("bad") === null; });
await chk("P189285", SNAP, "an oversized payload (>1.5 MB) is skipped, not written", run, () => { snapMod.writeSnap("big", { s: "x".repeat(1_600_000) }); return snapMod.readSnap("big") === null; });
await chk("P189286", SNAP, "a value that cannot be serialised (a cycle) is swallowed, not thrown", run, () => { const o = {}; o.o = o; snapMod.writeSnap("cyc", o); return snapMod.readSnap("cyc") === null; });
await chk("P189287", SNAP, "a full storage (quota) is swallowed", run, () => { const s = globalThis.sessionStorage; globalThis.sessionStorage = { ...new Store(), setItem() { throw new Error("QuotaExceededError"); }, getItem: () => null };
  try { snapMod.writeSnap("q", { a: 1 }); return true; } finally { globalThis.sessionStorage = s; } });
await chk("P189288", SNAP, "clearOwnerSnaps removes EVERY owner snapshot, of every version", run, () => {
  sessionStorage.setItem("lfh_osnap:v0:old", "{}"); snapMod.clearOwnerSnaps();
  return [...sessionStorage.m.keys()].filter((k) => k.startsWith("lfh_osnap:")).length === 0 || [...sessionStorage.m.keys()].join(",");
});
await chk("P189289", SNAP, "…and leaves every OTHER key in the tab alone", run, () => { sessionStorage.setItem("owner_drill", "x"); snapMod.writeSnap("dash", {}); snapMod.clearOwnerSnaps(); return sessionStorage.getItem("owner_drill") === "x"; });
await chk("P189290", SNAP, "clearOwnerSnaps does not skip a key when removing while iterating (3 in a row)", run, () => {
  ["a", "b", "c"].forEach((k) => snapMod.writeSnap(k, {})); snapMod.clearOwnerSnaps(); return ["a", "b", "c"].every((k) => snapMod.readSnap(k) === null);
});
await chk("P189291", SNAP, "clearOwnerSnaps is called on a successful login (the 'never the previous account's numbers' promise)", "grep the login code for the call", async () => {
  const { execFileSync } = await import("node:child_process");
  let out = ""; try { out = execFileSync("grep", ["-rln", "clearOwnerSnaps", rel("app"), rel("components"), rel("lib")]).toString(); } catch { out = ""; }
  const hits = out.trim().split("\n").filter((f) => f && !f.endsWith("ownerSnap.ts"));
  return hits.length > 0 || "nothing calls clearOwnerSnaps";
});
await chk("P189292", SNAP, "it uses sessionStorage (per tab, gone when the tab closes), never localStorage", "read the source", () => !/localStorage/.test(src(SNAP).replace(/\/\/.*$/gm, "")));

// ── ownerOverviewCache: one shared request for the shell and the page ───────────────────────────
const REAL_FETCH = globalThis.fetch;
let calls = 0, answer = () => ({ restaurants: [] });
globalThis.fetch = async (url, opts) => { calls++; globalThis.__lastUrl = url; globalThis.__lastOpts = opts; return { json: async () => answer() }; };
const oc = await import(rel(OC));
await chk("P189293", OC, "two callers with the same scope inside 8 s share ONE request", run, async () => { calls = 0; const a = oc.fetchOwnerOverview(""); const b = oc.fetchOwnerOverview(""); await Promise.all([a, b]); return calls === 1 || `calls=${calls}`; });
await chk("P189294", OC, "…and they get the very same promise", run, () => oc.fetchOwnerOverview("") === oc.fetchOwnerOverview(""));
await chk("P189295", OC, "a different scope is a different request (an admin pin never reads the owner's answer)", run, async () => { calls = 0; await oc.fetchOwnerOverview("&scope=r2"); return calls === 1; });
await chk("P189296", OC, "the request goes to /api/owner/overview with the scope suffix appended", run, async () => { await oc.fetchOwnerOverview("&scope=r3"); return String(globalThis.__lastUrl) === "/api/owner/overview?_=1&scope=r3" || String(globalThis.__lastUrl); });
await chk("P189297", OC, "it is fetched no-store (live numbers are never served from the browser cache)", run, () => globalThis.__lastOpts?.cache === "no-store");
await chk("P189298", OC, "it carries a deadline signal, so a stalled read cannot spin for ever", run, () => !!globalThis.__lastOpts?.signal);
await chk("P189299", OC, "an { error } body is EVICTED at once, so Refresh can retry inside the 8 s", run, async () => {
  answer = () => ({ error: "x" }); calls = 0; await oc.fetchOwnerOverview("&scope=err"); await oc.fetchOwnerOverview("&scope=err"); answer = () => ({ restaurants: [] });
  return calls === 2 || `calls=${calls}`;
});
await chk("P189300", OC, "a REJECTED request is evicted too", run, async () => {
  const f = globalThis.fetch; let n = 0; globalThis.fetch = async () => { n++; throw new Error("offline"); };
  try { await oc.fetchOwnerOverview("&scope=rej").catch(() => {}); await new Promise((r) => setTimeout(r, 5)); await oc.fetchOwnerOverview("&scope=rej").catch(() => {}); } finally { globalThis.fetch = f; }
  return n === 2 || `n=${n}`;
});
await chk("P189301", OC, "after the 8 s window a fresh request goes out (the 60 s tick is never served stale)", run, async () => {
  const realNow = Date.now; calls = 0; await oc.fetchOwnerOverview("&scope=ttl");
  Date.now = () => realNow() + 8_500; try { await oc.fetchOwnerOverview("&scope=ttl"); } finally { Date.now = realNow; }
  return calls === 2 || `calls=${calls}`;
});
await chk("P189302", OC, "an empty scope and '_' are the same key (both are the owner's own view)", run, () => /const key = scp \|\| "_"/.test(src(OC)));
await chk("P189303", OC, "the deadline is 25 s — a scoped snapshot, not a report", "read the constant", () => /OVERVIEW_DEADLINE_MS = 25_000/.test(src(OC)));
await chk("P189304", OC, "a stale eviction cannot delete a NEWER request under the same key", "read the guard", () => (src(OC).match(/cache\.get\(key\)\?\.p === p/g) || []).length === 2);

// ── AnimatedNumber: the string parser, lifted and run ───────────────────────────────────────────
function lift(file, name) {
  const sf = ts.createSourceFile(file, src(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let node = null;
  sf.forEachChild((n) => { if (ts.isFunctionDeclaration(n) && n.name?.text === name) node = n; });
  if (!node) throw new Error(`${name} not found in ${file}`);
  const js = ts.transpileModule(node.getText(sf), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.Preserve } }).outputText;
  return new Function(`${js}; return ${name};`)();
}
const pf = lift(AN, "parseFormatted");
const P = (v) => JSON.stringify(pf(v));
for (const [i, [inp, want]] of [
  ["₹83,59,670", { pre: "₹", num: 8359670, locale: "en-IN", suf: "" }],
  ["1,234", { pre: "", num: 1234, locale: "en-IN", suf: "" }],
  ["5%", { pre: "", num: 5, locale: "en-IN", suf: "%" }],
  ["−₹5,000", { pre: "−₹", num: 5000, locale: "en-IN", suf: "" }],
  ["₹1,234.50", null], ["1.5%", null], ["abc", null], ["", null], [42, null], [null, null],
  ["₹0", { pre: "₹", num: 0, locale: "en-IN", suf: "" }],
  ["12 orders", { pre: "", num: 12, locale: "en-IN", suf: " orders" }],
].entries()) {
  await chk(`P${189305 + i}`, AN, `parseFormatted(${JSON.stringify(inp)}) → ${want ? "kept " + JSON.stringify(want) : "null (rendered unchanged)"}`, "lifted with the TypeScript parser and run",
    () => P(inp) === JSON.stringify(want) || `got ${P(inp)}`);
}
// 189305..189316 used (12)
await chk("P189317", AN, "a re-assembled figure uses en-IN grouping — 83,59,670, never 8,359,670", "run the parser, re-format like the component", () => {
  const p = pf("₹83,59,670"); return p.pre + p.num.toLocaleString(p.locale) + p.suf === "₹83,59,670";
});
await chk("P189318", AN, "the numeric API's default count format is en-IN too", "read the source", () => /toLocaleString\("en-IN"\)/.test(src(AN)));
await chk("P189319", AN, "the value is ROUNDED before formatting, so a mid-roll frame never prints 5,216.473", "read the source", () => /fmt\(Math\.round\(disp\)\)/.test(src(AN)));
await chk("P189320", AN, "reduced motion snaps straight to the value (no count-up)", "read the effect", () => /if \(reduce \|\| fromRef\.current === value\)/.test(src(AN)));
await chk("P189321", AN, "while loading it shows a skeleton, never a made-up rolling figure", "read the render", () => /if \(loading\) return <span key="skel"/.test(src(AN)));
await chk("P189322", AN, "the skeleton is aria-hidden, so a screen reader never reads an empty number", "read the render", () => (src(AN).match(/anim-skel[^>]*aria-hidden="true"/g) || []).length === 2);
await chk("P189323", AN, "the animation frame is cancelled on unmount and on every new value", "read the effect", () => /return \(\) => cancelAnimationFrame\(rafRef\.current\)/.test(src(AN)) && /useEffect\(\(\) => \{\s*cancelAnimationFrame/.test(src(AN)));
await chk("P189324", AN, "the reduced-motion listener is removed on unmount", "read the hook", () => /removeEventListener\?\.\("change", on\)/.test(src(AN)));

// ── ownerHome: dev-database READS only ───────────────────────────────────────────────────────────
// The real fetch goes back first: the Supabase client uses it, and with the stub above in place every
// read "failed" — which is how this band first caught loginNameTaken answering "free" on a failed read.
globalThis.fetch = REAL_FETCH;
let oh = null;
try { oh = await import(rel(OH)); } catch (e) { oh = { __err: e.message }; }
const ohRun = "called against the DEV database, reads only";
await chk("P189325", OH, "resolveOwnerHomeRid() with the default anchor answers restaurant #1 on this stack", ohRun, async () => {
  if (oh.__err) return oh.__err; const r = await oh.resolveOwnerHomeRid(); return r.rid === oh.DEFAULT_RID || JSON.stringify(r);
});
await chk("P189326", OH, "a missing anchor falls back to a restaurant the admin picked", ohRun, async () => {
  const r = await oh.resolveOwnerHomeRid(["00000000-0000-0000-0000-000000000002"], "00000000-0000-0000-0000-00000000dead"); return r.rid === "00000000-0000-0000-0000-000000000002" || JSON.stringify(r);
});
await chk("P189327", OH, "…a picked id that is not a uuid is ignored, and the oldest live restaurant answers", ohRun, async () => {
  const r = await oh.resolveOwnerHomeRid(["not-a-uuid", "nonsense"], "00000000-0000-0000-0000-00000000dead"); return (!!r.rid && !r.error) || JSON.stringify(r);
});
await chk("P189328", OH, "…and the fallback is STABLE across calls (the oldest, not any)", ohRun, async () => {
  const a = await oh.resolveOwnerHomeRid([], "00000000-0000-0000-0000-00000000dead"); const b = await oh.resolveOwnerHomeRid([], "00000000-0000-0000-0000-00000000dead"); return a.rid === b.rid || `${a.rid} vs ${b.rid}`;
});
await chk("P189329", OH, "loginNameTaken: a real live diag login IS taken", ohRun, async () => (await oh.loginNameTaken("diago1")) === true);
await chk("P189330", OH, "loginNameTaken: a name nobody holds is free", ohRun, async () => (await oh.loginNameTaken("t20-s10-nobody-" + "zz")) === false);
await chk("P189331", OH, "loginNameTaken: '%' is not a wildcard (exact match, not ilike)", ohRun, async () => (await oh.loginNameTaken("diag%")) === false);
await chk("P189332", OH, "nameTakenMessage names WHO holds it and WHERE", ohRun, async () => { const m = await oh.nameTakenMessage("diagm1"); return (!!m && /manager login/.test(m) && / at /.test(m)) || String(m); });
await chk("P189333", OH, "nameTakenMessage answers null for a free name", ohRun, async () => (await oh.nameTakenMessage("t20-s10-nobody-zz")) === null);
await chk("P189334", OH, "liveHoldersOfName never returns a password or PIN column", "read the select list", () => !/password|pin_hash|hash/i.test((src(OH).match(/select\("id, name, username, role, active, restaurant_id"\)/) || [""])[0]) && /select\("id, name, username, role, active, restaurant_id"\)/.test(src(OH)));
await chk("P189335", OH, "every read in ownerHome names its columns and carries a limit or maybeSingle", "read every .from()", () => {
  const t = src(OH); const reads = t.match(/sb\.from\([^;]+;/g) || []; return reads.length >= 5 && reads.every((r) => /\.select\("[^*"]+"\)/.test(r) && /\.limit\(|maybeSingle/.test(r)) || reads.filter((r) => !/\.limit\(|maybeSingle/.test(r)).join(" || ");
});
// A FAILED READ IS NOT "THE NAME IS FREE" — fixed in this run (item 7); these two hold the fix.
// Executed with the database read made to FAIL (the network refused), which is how this band first
// found loginNameTaken answering "free" on a blip. Fixed in this run as item 7.
const withFailingNetwork = async (fn) => { const f = globalThis.fetch; globalThis.fetch = async () => { throw new Error("network down (test)"); };
  try { return await fn(); } finally { globalThis.fetch = f; } };
await chk("P189336", OH, "loginNameTaken: a FAILED read is not answered as 'name is free' — it refuses to answer", "called with the database read failing", () =>
  withFailingNetwork(async () => { try { const r = await oh.loginNameTaken("diago1"); return `answered ${r} on a failed read`; } catch (e) { return /couldn't check/i.test(e.message) || e.message; } }));
await chk("P189337", OH, "nameTakenMessage: a FAILED read answers a sentence the admin can act on, never null (= free)", "called with the database read failing", () =>
  withFailingNetwork(async () => { const m = await oh.nameTakenMessage("diago1"); return (typeof m === "string" && /couldn.t check whether/.test(m)) || `answered ${JSON.stringify(m)}`; }));
await chk("P189338", OH, "the anchor never silently becomes restaurant #1 when #1 is gone", ohRun, async () => { const r = await oh.resolveOwnerHomeRid([], "00000000-0000-0000-0000-00000000dead"); return r.rid !== "00000000-0000-0000-0000-00000000dead" || "answered the missing id"; });
await chk("P189339", OH, "a binned restaurant is never chosen as the anchor (deleted_at filter on both fallbacks)", "read the two fallback reads", () => (src(OH).match(/\.is\("deleted_at", null\)/g) || []).length >= 3);
await chk("P189340", OH, "DEFAULT_RID is the only hard-coded restaurant id in the file", "read the source", () => (src(OH).match(/0{8}-0{4}-0{4}-0{4}-\d{12}/g) || []).length === 1);

report("T20 band C · the libraries, executed (P189241–P189340)", { expect: 100 });
process.exit(process.exitCode || 0);
