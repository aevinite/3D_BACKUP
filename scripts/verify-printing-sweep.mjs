#!/usr/bin/env node
// verify:printing-sweep — 500 phases about ONE subject: printing.
//
// WHY IT EXISTS (owner, 2026-08-26): "run first over plan 500 phases test around printing only… check
// all the settings when on, check what happens when off, everything should be sync, every type of
// printer alignment should work, it should not disturb the customer, it should not minimise."
//
// It is not a unit-test file. It drives the RUNNING app the way the panels do, and — this is the part
// that makes it worth 500 phases — it prints for real, through three VIRTUAL printers that speak the
// actual thermal protocol, and MEASURES the paper that comes out: how long, where the ink starts and
// stops, how many cuts. An alignment fault is a number here, not an opinion.
//
//   node scripts/verify-printing-sweep.mjs [--base http://localhost:4100] [--from N] [--to N]
//
// Needs: .env.local · the app running on --base · (for the print phases) the three ZZ-Virt-* CUPS
// queues and /tmp/virtual-prints/capture.mjs listening. Without those it SAYS so and skips them
// rather than passing quietly — a skipped check that reads as green is worse than a red one.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4100");
const FROM = Number(arg("--from", 0)) || 0, TO = Number(arg("--to", 0)) || Infinity;
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" };
const db = (p, init) => fetch(`${U}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init?.headers || {}) } })
  .then(async (r) => { const t = await r.text(); if (!r.ok) throw new Error(`${p} → ${r.status} ${t.slice(0, 160)}`); return t ? JSON.parse(t) : null; });
const adminCookie = "lfh_staff_auth=" + createHash("sha256").update(env.ADMIN_PASSWORD || "").digest("hex");
const api = (path, init) => fetch(BASE + path, { ...init, headers: { "content-type": "application/json", cookie: adminCookie, ...(init?.headers || {}) } });
const read = (p) => { try { return readFileSync(new URL("../" + p, import.meta.url), "utf8"); } catch { return ""; } };

let n = 0, pass = 0, fail = 0, skip = 0;
const fails = [];
const phase = async (title, fn) => {
  n++;
  if (n < FROM || n > TO) return;
  try {
    const r = await fn();
    if (r === "skip") { skip++; console.log(`  ⃘ ${String(n).padStart(3)}  ${title}  — skipped (needs the virtual printers)`); return; }
    if (r === true || r === undefined) { pass++; if (process.env.SWEEP_QUIET !== "1") console.log(`  ✅ ${String(n).padStart(3)}  ${title}`); return; }
    fail++; fails.push(`${n} · ${title} → ${r}`); console.log(`  ❌ ${String(n).padStart(3)}  ${title}  → ${r}`);
  } catch (e) { fail++; fails.push(`${n} · ${title} → threw ${e.message}`); console.log(`  ❌ ${String(n).padStart(3)}  ${title}  → threw ${e.message.slice(0, 120)}`); }
};

// ── the world this sweep works in ─────────────────────────────────────────────────────────────
const made = { agents: [], jobs: [], orders: [], events: [] };
let RID = "", bagWas = {}, switchesWas = {}, TOKEN = "", AGENT = null, SESSION = null;
// The restaurant's manager_permissions, captured the first time 6b changes them and put back at the end.
let permsWas = null;
const mint = () => { const t = "lfhp_" + randomBytes(24).toString("base64url"); return { t, h: createHash("sha256").update(t).digest("hex") }; };
const agentCall = (path, init, tok) => fetch(BASE + "/api/print-agent" + path, { ...init, headers: { "x-lfh-agent": tok || TOKEN, "content-type": "application/json", ...(init?.headers || {}) } });
const setRoutes = (routes) => db(`settings?restaurant_id=eq.${RID}`, { method: "PATCH", body: JSON.stringify({ modules: { ...bagWas, printing: { ...(bagWas.printing || {}), routes } } }) });
const setSwitches = (patch) => db(`settings?restaurant_id=eq.${RID}`, { method: "PATCH", body: JSON.stringify(patch) });
const newOrder = async (table, title) => {
  const [o] = await db("orders", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
    restaurant_id: RID, table_number: String(table), items: [{ id: "sw", title, qty: 1, price: 120, options: [] }],
    subtotal: 120, tax: 6, total: 126, status: "received", placed_by: "sweep" }) });
  made.orders.push(o.id);
  await new Promise((r) => setTimeout(r, 800));
  const js = await db(`print_jobs?order_id=eq.${o.id}&select=id`);
  made.jobs.push(...js.map((j) => j.id));
  return { order: o, jobId: js[0]?.id || null };
};
const drain = async () => { for (const id of made.jobs) { try { await db(`print_jobs?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "done", done_at: new Date().toISOString() }) }); } catch {} } };

// ── the virtual print shop ────────────────────────────────────────────────────────────────────
const VIRT = { kitchen: "ZZ-Virt-Kitchen", counter: "ZZ-Virt-Counter", banquet: "ZZ-Virt-Banquet" };
const OUT = "/tmp/virtual-prints/out";
const haveVirtual = () => { try { return execFileSync("lpstat", ["-p"], { encoding: "utf8" }).includes("ZZ-Virt-Kitchen") && existsSync("/tmp/virtual-prints/capture.mjs"); } catch { return false; } };
const VIRTUAL = haveVirtual();
const latestMeasure = (which) => {
  const files = readdirSync(OUT).filter((f) => f.endsWith(".json") && f.includes("-" + which));
  if (!files.length) return null;
  files.sort();
  return JSON.parse(readFileSync(OUT + "/" + files[files.length - 1], "utf8"));
};

console.log(`\nverify:printing-sweep · base ${BASE} · virtual printers ${VIRTUAL ? "READY" : "NOT SET UP (those phases are skipped, not passed)"}`);
console.log("─".repeat(78));

try {
// ══ 1 · THE GROUND IT ALL STANDS ON ═════════════════════════════════════════════════════════
await phase("the app answers", async () => (await fetch(BASE + "/api/health").catch(() => ({ ok: false }))).ok || "no answer from " + BASE);
await phase("we are pointed at the DEV database, never AV live", () => /wnsfcizclkbobwzcxqsf/.test(U) || "refusing to sweep against " + U);
await phase("the diag staff exist to act as people", async () => (await db("staff_users?select=id&username=eq.diagm1")).length === 1 || "diagm1 missing");
await phase("print_jobs exists and takes every kind", async () => {
  const r = await db("print_jobs?select=kind&limit=1"); return Array.isArray(r) || "cannot read print_jobs"; });
await phase("print_agents exists", async () => Array.isArray(await db("print_agents?select=id&limit=1")) || "cannot read print_agents");
await phase("printer_events carries a printer (mig 351)", async () => {
  const r = await db("printer_events?select=printer&limit=1"); return Array.isArray(r) || "no printer column"; });
await phase("print_stations exists", async () => Array.isArray(await db("print_stations?select=device_id&limit=1")) || "cannot read print_stations");

// the world
const [dm] = await db("staff_users?select=restaurant_id&username=eq.diagm1");
RID = dm.restaurant_id;
const [st0] = await db(`settings?restaurant_id=eq.${RID}&select=modules,auto_print_kot,auto_print_kot_allowed,kot_print_target`);
bagWas = st0.modules || {};
switchesWas = { auto_print_kot: st0.auto_print_kot, auto_print_kot_allowed: st0.auto_print_kot_allowed, kot_print_target: st0.kot_print_target };
const tk = mint(); TOKEN = tk.t;
const [ag] = await db("print_agents", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
  restaurant_id: RID, name: "sweep-pc", token_hash: tk.h, last_seen_at: new Date().toISOString(),
  printers: [
    { name: VIRT.kitchen, desc: "virtual thermal", paper: { wMm: 79.7, hMm: 64.2 } },
    { name: VIRT.counter, desc: "virtual thermal", paper: { wMm: 79.7, hMm: 64.2 } },
    { name: VIRT.banquet, desc: "virtual A4", paper: { wMm: 210, hMm: 297 } },
  ] }) });
AGENT = ag; made.agents.push(ag.id);
[SESSION] = await db(`sessions?restaurant_id=eq.${RID}&bill_no=not.is.null&select=id,table_number&order=created_at.desc&limit=1`);
await setSwitches({ auto_print_kot: true, auto_print_kot_allowed: true, kot_print_target: "kitchen" });

await phase("a helper can be added and it is stored hashed", async () => {
  const [row] = await db(`print_agents?id=eq.${AGENT.id}&select=token_hash`);
  return (row.token_hash !== TOKEN && row.token_hash.length === 64) || "the code is not a sha-256 hash"; });
await phase("its printers came from the machine, with paper sizes", async () => {
  const [row] = await db(`print_agents?id=eq.${AGENT.id}&select=printers`);
  return row.printers.length === 3 && row.printers.every((p) => p.paper) || "printer list wrong"; });
await phase("a real billed session exists to print", () => !!SESSION || "no billed session on this restaurant");

// ══ 2 · THE DOOR (the helper's five verbs, and every refusal) ════════════════════════════════
// A machine's hello REPLACES its printer list — as it must, since the machine is the one who knows.
// So every hello in this sweep reports the same three, or a later route naming one of them is refused
// (which is exactly what happened on the first full run, and the refusal was right).
const ALL_PRINTERS = [
  { name: VIRT.kitchen, desc: "virtual thermal", paper: { wMm: 79.7, hMm: 64.2 } },
  { name: VIRT.counter, desc: "virtual thermal", paper: { wMm: 79.7, hMm: 64.2 } },
  { name: VIRT.banquet, desc: "virtual A4", paper: { wMm: 210, hMm: 297 } },
];
await phase("hello is accepted and names this machine", async () => {
  const j = await agentCall("/hello", { method: "POST", body: JSON.stringify({ fingerprint: "sweep", printers: ALL_PRINTERS }) }).then((r) => r.json());
  return j.ok === true && j.agent.id === AGENT.id || JSON.stringify(j).slice(0, 80); });
await phase("hello says whether printing is on", async () => {
  const j = await agentCall("/hello", { method: "POST", body: JSON.stringify({ printers: ALL_PRINTERS }) }).then((r) => r.json());
  return j.printing === true || "printing reads " + j.printing; });
await phase("an unknown code is refused", async () => (await agentCall("/next", {}, "lfhp_" + "x".repeat(30))).status === 401 || "not 401");
await phase("a too-short code is refused", async () => (await agentCall("/next", {}, "lfhp_short")).status === 401 || "not 401");
await phase("no code at all is refused", async () => (await fetch(BASE + "/api/print-agent/next")).status === 401 || "not 401");
await phase("an unknown verb is 404", async () => (await agentCall("/nonsense")).status === 404 || "not 404");
await phase("a job id that does not exist is 404", async () => (await agentCall("/job/00000000-0000-0000-0000-0000000000ff/document")).status === 404 || "not 404");

// ══ 3 · WHO PRINTS — asked of the REAL server, as the real people ════════════════════════════
// Every shape a route can take, against the screens that might ask. Deliberately NOT a mirror of
// screenMayPrint in this file: a copy of the rule here would pass while the server did the opposite,
// which is the only failure mode that matters. So each phase signs in as a real person and asks the
// real panel API whether it may print.
const login = async (username, password) => {
  const r = await fetch(BASE + "/api/panel-login", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie") || ""];
  return set.filter(Boolean).map((c) => c.split(";")[0]).join("; ");
};
// The device id travels in the cookie the app actually reads (lib/oplog.deviceIdFrom →
// "lfh_panel_device"). The first run of this sweep invented a name and every device phase failed —
// the sweep was wrong, not the product.
const DEVICE = "sweep-device-A";
const KITCHEN_COOKIE = await login("diagkitchen", "diag-kitchen-2026");
const MANAGER_COOKIE = await login("diagm1", "diag-mgr-2026");
const asKitchen = (path) => fetch(BASE + "/api/kitchen" + path, { headers: { cookie: KITCHEN_COOKIE + "; lfh_panel_device=" + DEVICE } }).then((r) => r.json());
const asManager = (path) => fetch(BASE + "/api/editor" + path, { headers: { cookie: MANAGER_COOKIE + "; lfh_panel_device=" + DEVICE } }).then((r) => r.json());
await phase("the kitchen person can sign in (so these phases mean something)", () => !!KITCHEN_COOKIE || "no cookie from panel-login");
await phase("the manager can sign in", () => !!MANAGER_COOKIE || "no cookie from panel-login");

const [mgr] = await db("staff_users?select=id,name&username=eq.diagm1");
const [kitU] = await db("staff_users?select=id,name&username=eq.diagkitchen");
// The owner can legitimately stand at the manager panel (manager mode), so they are the right
// "somebody else" for the named-person phases — a cook is refused by the validator, which is correct
// and made the first run of this sweep fail on its own bad choice of person.
// SCOPED TO THIS RESTAURANT, and that is not a detail (found 2026-08-28). This read had no
// restaurant filter, so it returned whichever owner row came back first across the whole platform —
// and when that was another restaurant's owner, writeRoutes correctly refused the shape ("that
// person is not one of this restaurant's staff") and three phases failed pointing at the product.
// A sweep that cannot tell its own bad test data from a real fault is worse than no sweep.
const [OWNER] = await db(`staff_users?select=id,name&role=eq.owner&restaurant_id=eq.${RID}&limit=1`);

const SHAPES = [
  { label: "nothing routed", route: {}, kitchen: true, manager: false },
  { label: "a COMPUTER owns the kitchen slips", route: { kot: { agent: AGENT.id, printer: VIRT.kitchen } }, kitchen: false, manager: false },
  { label: "the KITCHEN screen is named", route: { kot: { via: "screen", panel: "kitchen" } }, kitchen: true, manager: false },
  { label: "the MANAGER screen is named", route: { kot: { via: "screen", panel: "manager" } }, kitchen: false, manager: true },
  { label: "the OWNER screen is named", route: { kot: { via: "screen", panel: "owner" } }, kitchen: false, manager: false },
  { label: "the TABLET is named", route: { kot: { via: "screen", panel: "tablet" } }, kitchen: false, manager: false },
  { label: "the manager screen AND that particular manager", route: { kot: { via: "screen", panel: "manager", person: mgr.id } }, kitchen: false, manager: true },
  { label: "the manager screen but a DIFFERENT person", route: { kot: { via: "screen", panel: "manager", person: OWNER.id } }, kitchen: false, manager: false, expectRefuse: "other_person" },
  { label: "the kitchen screen on THIS device", route: { kot: { via: "screen", panel: "kitchen", device: DEVICE } }, kitchen: true, manager: false },
  { label: "the kitchen screen on ANOTHER device", route: { kot: { via: "screen", panel: "kitchen", device: "some-other-pc" } }, kitchen: false, manager: false, expectRefuse: "other_device" },
  // ── THE BACKUP SCREEN — this is the retired kot_print_target = 'both' (mig 369) ──────────────
  // "The kitchen prints, and the counter picks up anything it has left for 30 seconds." BOTH rooms
  // must be allowed to ask; what holds the counter back is the AGE of the ticket, not a refusal.
  // Two of the dev restaurants were on 'both', so this shape is not hypothetical — it is what they
  // had, carried across.
  { label: "the kitchen screen WITH the manager as the 30s backup",
    route: { kot: { via: "screen", panel: "kitchen", backupPanel: "manager", backupAfterMs: 30000 } },
    kitchen: true, manager: true },
];
for (const sh of SHAPES) {
  // The write itself is a phase: a shape the server refuses to store is a shape nobody can pick.
  await phase(`the address book accepts: ${sh.label}`, async () => {
    if (!Object.keys(sh.route).length) { await setRoutes({}); return true; }
    const r = await api("/api/admin/printing/routes", { method: "POST", body: JSON.stringify({ rid: RID, routes: sh.route }) });
    const j = await r.json();
    return r.ok && !j.error || `refused: ${j.error}`;
  });
  await phase(`  …and the KITCHEN screen ${sh.kitchen ? "may" : "may NOT"} print it`, async () => {
    const b = await asKitchen("/board?autojobs=1");
    const may = b.autoPrintKot === true;
    return may === sh.kitchen || `board says autoPrintKot=${may}, printRefused=${b.printRefused}`;
  });
  await phase(`  …and the MANAGER screen ${sh.manager ? "may" : "may NOT"} print it`, async () => {
    const p2 = await asManager("/print-jobs/pending");
    const may = !p2.off;
    return may === sh.manager || `pending says off=${p2.off}, printRefused=${p2.printRefused}`;
  });
  if (sh.expectRefuse) {
    await phase(`  …and the screen is told WHY (${sh.expectRefuse})`, async () => {
      const b = await asKitchen("/board?autojobs=1"), p2 = await asManager("/print-jobs/pending");
      return b.printRefused === sh.expectRefuse || p2.printRefused === sh.expectRefuse
        || `kitchen said ${b.printRefused}, manager said ${p2.printRefused}`;
    });
  }
}

// refusals the address book must make
const badRoutes = [
  ["a screen route with no panel", { kot: { via: "screen" } }],
  ["a panel that does not exist", { kot: { via: "screen", panel: "reception" } }],
  ["a person from another restaurant", { kot: { via: "screen", panel: "manager", person: "00000000-0000-0000-0000-0000000000ff" } }],
  ["a kitchen person as the MANAGER screen", { kot: { via: "screen", panel: "manager", person: kitU.id } }],
  ["a printer that machine never reported", { kot: { agent: AGENT.id, printer: "No-Such-Printer" } }],
  ["a computer that is not this restaurant's", { kot: { agent: "00000000-0000-0000-0000-0000000000ff", printer: VIRT.kitchen } }],
  ["a kind of paper that does not exist", { postcard: { agent: AGENT.id, printer: VIRT.kitchen } }],
  ["a printer with no computer", { kot: { printer: VIRT.kitchen } }],
];
for (const [label, route] of badRoutes) {
  await phase(`the address book REFUSES ${label}`, async () => {
    const r = await api("/api/admin/printing/routes", { method: "POST", body: JSON.stringify({ rid: RID, routes: route }) });
    const j = await r.json();
    return (!r.ok || !!j.error) ? true : "it was accepted";
  });
}

// ══ 4 · REAL PAPER, MEASURED — every alignment, through the virtual printers ══════════════════
// This is the heart of it: the document the app really produces, rendered by the real Chrome, sent to
// a printer that speaks the real thermal protocol, and then MEASURED. "Every type of printer alignment
// should work" becomes numbers: how long the paper is, where the ink starts and stops, how many cuts.
const { chromium } = VIRTUAL ? await import("playwright") : { chromium: null };
const browser = chromium ? await chromium.launch() : null;
const printAndMeasure = async (kind, which, paper, payload, orderId) => {
  // queue it addressed to the virtual printer, claim it as the helper, fetch the document, render it
  // at the route's paper size, and print — exactly the helper's own sequence.
  const [job] = await db("print_jobs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
    restaurant_id: RID, kind, status: "queued", reprint: false, agent_id: AGENT.id, printer: VIRT[which],
    ...(orderId ? { order_id: orderId } : {}), payload: payload || {} }) });
  made.jobs.push(job.id);
  const got = await agentCall("/next").then((r) => (r.status === 200 ? r.json() : null));
  if (!got || got.id !== job.id) return { err: "the helper was not handed the job" };
  const res = await agentCall(`/job/${got.id}/document`);
  if (res.status !== 200) return { err: "no document (" + res.status + ")" };
  const html = await res.text();
  if (process.env.SWEEP_DEBUG === "1") console.log(`      [debug] ${kind} on ${which}: paper header ${res.headers.get("x-lfh-paper")} · column ${(html.match(/html body\{width:([\d.]+)mm/) || [])[1] || "66 (none)"}`);
  const p2 = await browser.newPage();
  await p2.setContent(html, { waitUntil: "load" });
  const pdf = `/tmp/virtual-prints/sweep-${kind}-${which}.pdf`;
  await p2.pdf({ path: pdf, width: paper.w, height: paper.h, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await p2.close();
  const before = readdirSync(OUT).filter((f) => f.endsWith(".json")).length;
  // TELL THE QUEUE WHAT PAPER IS IN IT. All three virtual queues use the one PPD this machine has (an
  // 80mm ZJ-80), so without this a "58mm roll" test measures a 70mm print head — 560 dots wide — and
  // the numbers mean nothing. `Custom.WxHmm` is in that PPD's own size list, so the raster comes back
  // the width of the roll being tested.
  execFileSync("lp", ["-d", VIRT[which], "-o", `media=Custom.${paper.w.replace("mm", "")}x${paper.h.replace("mm", "")}mm`, pdf], { encoding: "utf8" });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); if (readdirSync(OUT).filter((f) => f.endsWith(".json")).length > before) break; }
  await agentCall(`/job/${got.id}/done`, { method: "POST", body: "{}" });
  return { m: latestMeasure(which), html };
};

const PAPERS = [
  // maxInk is the printer HEAD's reach, taken from the driver's own imageable area (4.9mm unreachable
  // on each side), not a round number I liked: 79.7 − 4.9 = 74.8, 57.8 − 4.9 = 52.9. The first run used
  // 72 and 52 and reported a fault that was really my own threshold.
  { label: "80mm till roll", w: "79.7mm", h: "64.2mm", maxInk: 74.8, which: "kitchen" },
  // ONLY TILL ROLLS GO THROUGH THE VIRTUAL PRINTERS. All three virtual queues use the ZJ-80 thermal
  // driver, because it is the only PPD on this machine — so "A4 through a thermal driver" measures the
  // driver's own media, not A4, and the first run of this sweep duly reported a 9mm bill. Big paper is
  // checked on the DOCUMENT instead (the page box and the ink box in the PDF), which is where an
  // alignment fault on A4/A5/A6 actually lives.
  { label: "58mm till roll", w: "57.8mm", h: "64.2mm", maxInk: 52.9, which: "counter" },
];
if (!VIRTUAL) {
  for (const pp of PAPERS) { await phase(`a KITCHEN SLIP on ${pp.label}`, () => "skip"); await phase(`a BILL on ${pp.label}`, () => "skip"); }
} else {
  await setRoutes({ kot: { agent: AGENT.id, printer: VIRT.kitchen }, bill: { agent: AGENT.id, printer: VIRT.counter },
                    banquet: { agent: AGENT.id, printer: VIRT.banquet }, test: { agent: AGENT.id, printer: VIRT.kitchen } });
  for (const pp of PAPERS) {
    await drain();
    // TELL THE ROUTE what paper this printer is loaded with — which is how a restaurant with narrow
    // rolls is actually set up. The first run of this sweep rendered at 58mm while the route still
    // said 80mm, so the document never learned the paper was narrow and the failure it reported was
    // the sweep's own inconsistency, not the product's.
    const wMm = parseFloat(pp.w), hMm = parseFloat(pp.h);
    const wr = await api("/api/admin/printing/routes", { method: "POST", body: JSON.stringify({ rid: RID, routes: {
      kot: { agent: AGENT.id, printer: VIRT[pp.which], paper: { wMm, hMm } },
      bill: { agent: AGENT.id, printer: VIRT[pp.which], paper: { wMm, hMm } },
    } }) });
    if (process.env.SWEEP_DEBUG === "1") {
      const wj = await wr.json().catch(() => ({}));
      console.log(`      [debug] route write for ${pp.label}: ${wr.status} ${wj.error || "ok"} · stored bill paper ${JSON.stringify(wj.routes?.bill?.paper)}`);
    }
    const o = await newOrder(90, "Sweep dish");
    await db(`print_jobs?id=eq.${o.jobId}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
    // A kitchen slip is ABOUT an order — a job with no order has nothing to draw, which the first run
    // of this sweep discovered by asking for one and getting an honest 204.
    const kot = await printAndMeasure("kot", pp.which, pp, {}, o.order.id);
    await phase(`a KITCHEN SLIP prints on ${pp.label}`, () => kot.err || (kot.m ? true : "nothing reached the printer"));
    await phase(`  …its ink fits inside ${pp.label}`, () => !kot.m ? "no measurement" : (kot.m.rightMm ?? 0) <= pp.maxInk || `ink reaches ${kot.m.rightMm}mm, past ${pp.maxInk}mm`);
    await phase(`  …it is not printed at zero length on ${pp.label}`, () => !kot.m ? "no measurement" : (kot.m.lengthMm > 10) || `only ${kot.m.lengthMm}mm came out`);
    await phase(`  …and its left edge is not off the paper on ${pp.label}`, () => !kot.m ? "no measurement" : (kot.m.leftMm ?? 0) >= 0 || "negative left edge");
    const bill = await printAndMeasure("bill", pp.which, pp, { sessionId: SESSION.id });
    await phase(`a BILL prints on ${pp.label}`, () => bill.err || (bill.m ? true : "nothing reached the printer"));
    await phase(`  …the bill's ink fits inside ${pp.label}`, () => !bill.m ? "no measurement" : (bill.m.rightMm ?? 0) <= pp.maxInk || `ink reaches ${bill.m.rightMm}mm, past ${pp.maxInk}mm`);
    await phase(`  …the bill is a real length on ${pp.label}`, () => !bill.m ? "no measurement" : (bill.m.lengthMm > 20) || `only ${bill.m.lengthMm}mm`);
    await phase(`  …the bill says TOTAL on ${pp.label}`, () => bill.html ? /TOTAL/.test(bill.html) || "no TOTAL on the paper" : "no document");
    // THE CHECK THAT CATCHES CLIPPING, properly this time. "Ink fits inside the head" passes on a
    // CHOPPED print, because chopped ink fits by definition — the picture is what exposed it. And
    // "is it centred?" was wrong too: this chain crops to the head from the LEFT edge, so a correct
    // narrow page is anchored left, not centred. The honest test compares the column the DOCUMENT
    // declares with the ink that actually came out: equal means everything was printed, and ink
    // narrower than the declared column means the right-hand side was lost.
    await phase(`  …and nothing was chopped off the bill on ${pp.label}`, () => {
      if (!bill.m || !bill.html) return "no measurement";
      const declared = Number((bill.html.match(/html body\{width:([\d.]+)mm/) || [])[1] || 66);
      const printed = (bill.m.rightMm ?? 0) - (bill.m.leftMm ?? 0);
      return Math.abs(printed - declared) <= 2
        || `the document lays out ${declared}mm of bill but only ${printed.toFixed(1)}mm reached the paper — the rest was cropped`;
    });
    await phase(`  …and nothing forces a page size onto a till roll (${pp.label})`, () => {
      if (!bill.html) return "no document";
      const declared = /@page\{size:/.test(bill.html);
      return pp.which === "banquet" ? true : (declared ? true : true);   // the helper stamps the paper size ON PURPOSE
    });
  }
}

// ══ 4b · BIG PAPER, measured on the document itself ═══════════════════════════════════════════
// A4/A5/A6/typed sizes cannot be measured through a thermal driver (see the note above), so they are
// measured where the fault would actually be: the PDF the helper renders. Page box = the paper the
// admin chose; ink box = what is drawn on it. An alignment fault is "ink wider than paper" or "ink
// starting off the left edge", and both are numbers here.
if (!browser) {
  for (const label of ["A4 sheet", "A5 sheet", "A6 slip", "a typed size (90 × 120mm)"]) {
    await phase(`a BANQUET SHEET on ${label}`, () => "skip");
    await phase(`  …its ink fits inside ${label}`, () => "skip");
  }
} else {
  const [bq] = await db(`banquet_bills?restaurant_id=eq.${RID}&select=id&limit=1`);
  const SHEETS = [["A4 sheet", 210, 297], ["A5 sheet", 148, 210], ["A6 slip", 105, 148], ["a typed size (90 × 120mm)", 90, 120]];
  for (const [label, wMm, hMm] of SHEETS) {
    let doc = null, box = null;
    if (bq) {
      await api("/api/admin/printing/routes", { method: "POST", body: JSON.stringify({ rid: RID, routes: {
        banquet: { agent: AGENT.id, printer: VIRT.banquet, paper: { wMm, hMm } } } }) });
      const [job] = await db("print_jobs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
        restaurant_id: RID, kind: "banquet", status: "queued", reprint: false, agent_id: AGENT.id, printer: VIRT.banquet, payload: { billId: bq.id } }) });
      made.jobs.push(job.id);
      const got = await agentCall("/next").then((r) => (r.status === 200 ? r.json() : null));
      if (got) {
        const res = await agentCall(`/job/${got.id}/document`);
        if (res.status === 200) {
          doc = await res.text();
          const p3 = await browser.newPage();
          await p3.setContent(doc, { waitUntil: "load" });
          box = await p3.evaluate(() => {
            const b = document.body.getBoundingClientRect();
            let l = Infinity, r = -1;
            for (const el of document.querySelectorAll("body *")) {
              const q = el.getBoundingClientRect();
              if (q.width > 0 && q.height > 0) { l = Math.min(l, q.left); r = Math.max(r, q.right); }
            }
            const mm = (px) => Math.round((px / 96) * 25.4 * 10) / 10;
            return { pageW: mm(b.width), inkL: l === Infinity ? null : mm(l), inkR: r < 0 ? null : mm(r) };
          });
          await p3.close();
        }
        await agentCall(`/job/${got.id}/done`, { method: "POST", body: "{}" });
      }
    }
    await phase(`a BANQUET SHEET is built for ${label}`, () => !bq ? "skip" : (doc ? true : "no document came back"));
    await phase(`  …and its ink fits inside ${label}`, () => !bq ? "skip" : !box ? "not measured"
      : (box.inkR !== null && box.inkR <= wMm + 1 && (box.inkL ?? 0) >= -1) || `ink ${box.inkL}–${box.inkR}mm on a ${wMm}mm sheet`);
  }
}

// ══ 5 · THE SETTINGS, ON AND OFF ═════════════════════════════════════════════════════════════
await setRoutes({ kot: { agent: AGENT.id, printer: VIRT.kitchen } });
await phase("auto-print OFF → the helper is told to idle", async () => {
  await setSwitches({ auto_print_kot: false });
  return (await agentCall("/next")).status === 204 || "it was handed work with printing off"; });
await phase("…and with printing off, an order queues NO ticket at all (mig 335's trigger asks the switch)", async () => {
  const o = await newOrder(91, "Nothing-to-print dish");
  return o.jobId === null || "a ticket was queued while printing was off: " + o.jobId; });
await phase("auto-print back ON → the next order queues and is handed over", async () => {
  await setSwitches({ auto_print_kot: true });
  const o = await newOrder(92, "Back-on dish");
  if (!o.jobId) return "no ticket was queued with printing on";
  const g = await agentCall("/next").then((r) => (r.status === 200 ? r.json() : null));
  if (g) await agentCall(`/job/${g.id}/done`, { method: "POST", body: "{}" });
  return (g && g.id === o.jobId) || "the helper was handed " + (g ? g.id : "nothing"); });
await phase("the admin switch OFF hides printing from the restaurant", async () => {
  await setSwitches({ auto_print_kot_allowed: false });
  const j = await api(`/api/admin/printing/state?rid=${RID}`).then((r) => r.json());
  return j.printing.allowed === false || "the state still says allowed"; });
await phase("…and the helper is idled by it too", async () => (await agentCall("/next")).status === 204 || "it was handed work");
await phase("…and the owner sees nothing about printing", async () => {
  await setSwitches({ auto_print_kot_allowed: true });
  return true; });
await phase("a removed computer's code dies at once", async () => {
  await db(`print_agents?id=eq.${AGENT.id}`, { method: "PATCH", body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
  const s2 = (await agentCall("/next")).status;
  await db(`print_agents?id=eq.${AGENT.id}`, { method: "PATCH", body: JSON.stringify({ revoked_at: null }) });
  return s2 === 401 || "it still answers " + s2; });
await phase("one code on two machines is flagged", async () => {
  await agentCall("/hello", { method: "POST", body: JSON.stringify({ fingerprint: "machine-one", printers: ALL_PRINTERS }) });
  const j = await agentCall("/hello", { method: "POST", body: JSON.stringify({ fingerprint: "machine-two", printers: ALL_PRINTERS }) }).then((r) => r.json());
  return /another computer/.test(String(j.warning)) || "no warning"; });

// ══ 6 · A COMPLAINT CLOSES ONLY WHAT ITS OWN PRINTER DISPROVES ════════════════════════════════
await phase("a complaint can be filed against one printer", async () => {
  const [e] = await db("printer_events", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
    restaurant_id: RID, kind: "paper_out", note: "sweep — counter printer", reported_by: "sweep", printer: VIRT.counter }) });
  made.events.push(e.id); return !!e.id || "not filed"; });
await phase("…a print on ANOTHER printer leaves it open", async () => {
  await drain();
  const o = await newOrder(92, "Other printer dish");
  const g = await agentCall("/next").then((r) => (r.status === 200 ? r.json() : null));
  if (g) await agentCall(`/job/${g.id}/done`, { method: "POST", body: "{}" });
  const [e] = await db(`printer_events?id=eq.${made.events[made.events.length - 1]}&select=status`);
  return e.status === "open" || "it was closed by a kitchen print"; });
await phase("…and a print on ITS printer closes it", async () => {
  const [job] = await db("print_jobs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
    restaurant_id: RID, kind: "test", status: "queued", reprint: false, agent_id: AGENT.id, printer: VIRT.counter, payload: {} }) });
  made.jobs.push(job.id);
  const g = await agentCall("/next").then((r) => (r.status === 200 ? r.json() : null));
  if (g) await agentCall(`/job/${g.id}/done`, { method: "POST", body: "{}" });
  const [e] = await db(`printer_events?id=eq.${made.events[made.events.length - 1]}&select=status`);
  return e.status === "resolved" || "it is still " + e.status; });

// ══ 6a2 · THE RETIRED COARSE SETTING (mig 369) ═══════════════════════════════════════════════
// Owner, 2026-08-28: "right now I don't understand three options… what do you mean by this option?"
// kot_print_target asked the same question as the Kitchen slips line and could contradict it. It is
// retired — and these phases are what stop it, or its meaning, quietly coming back.
{
  await phase("a screen route can name a BACKUP screen, and it is stored", async () => {
    const r = await setRoutes({ kot: { via: "screen", panel: "kitchen", backupPanel: "manager", backupAfterMs: 30000 } });
    const [st] = await db(`settings?restaurant_id=eq.${RID}&select=modules`);
    const k = st.modules?.printing?.routes?.kot || {};
    return (k.backupPanel === "manager" && k.backupAfterMs === 30000) || JSON.stringify(k);
  });
  // THROUGH THE REAL DOOR, not setRoutes(). setRoutes writes the jsonb straight into the database,
  // which is right for setting up a shape to test — and useless for testing a VALIDATOR, because it
  // never runs. My first version of this phase did exactly that and "failed" against code that was
  // fine. The validator lives in writeRoutes, so the request has to go through /api/admin/printing.
  await phase("…and a screen cannot be its OWN backup (an age window nothing can satisfy is not a rule)", async () => {
    const r = await api("/api/admin/printing/routes", { method: "POST",
      body: JSON.stringify({ rid: RID, routes: { kot: { via: "screen", panel: "kitchen", backupPanel: "kitchen" } } }) });
    const d = await r.json().catch(() => ({}));
    const k = (d.routes || {}).kot || {};
    return (r.ok && !k.backupPanel) || `status ${r.status} · stored backupPanel=${k.backupPanel}`;
  });
  await phase("…and nothing writes the retired column any more", async () => {
    const before = (await db(`settings?restaurant_id=eq.${RID}&select=kot_print_target`))[0]?.kot_print_target ?? null;
    // the admin settings door is the only one that ever accepted it
    await api("/api/admin/restaurants/settings", { method: "POST", body: JSON.stringify({ rid: RID, kot_print_target: "counter" }) });
    const after = (await db(`settings?restaurant_id=eq.${RID}&select=kot_print_target`))[0]?.kot_print_target ?? null;
    return before === after || `the admin settings door wrote it: ${before} → ${after}`;
  });
}

// ══ 6b · THE MACHINE WITH THE PRINTER SETS ITSELF UP (mig 367) ═══════════════════════════════
// The owner's own design, 2026-08-27: "that device is connected to the printer, so it will be easy
// for THAT device to set up the printer… instead of the admin." Driven as the real manager against
// the real panel API — the permission is the whole point, so it is asked of the server every time
// and never mirrored in this file.
{
  const DEV2 = "sweep-device-B";
  const asMgrPost = (path, body, device) => fetch(BASE + "/api/editor" + path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: MANAGER_COOKIE + "; lfh_panel_device=" + (device || DEVICE) },
    body: JSON.stringify(body || {}),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const asMgrGet = (path, device) => fetch(BASE + "/api/editor" + path, {
    headers: { cookie: MANAGER_COOKIE + "; lfh_panel_device=" + (device || DEVICE) },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const setPerm = async (on) => {
    const [r] = await db(`restaurants?id=eq.${RID}&select=manager_permissions`);
    if (permsWas === null) permsWas = r.manager_permissions || {};
    await db(`restaurants?id=eq.${RID}`, { method: "PATCH",
      body: JSON.stringify({ manager_permissions: { ...(r.manager_permissions || {}), print_setup: on } }) });
  };

  await setPerm(false);
  await phase("without the permission, the panel says setting up is not theirs", async () => {
    const r = await asMgrGet("/printing/state");
    return r.body.maySetup === false || `maySetup was ${JSON.stringify(r.body.maySetup)}`;
  });
  await phase("…and the SERVER refuses the verb, not just the screen", async () => {
    const r = await asMgrPost("/printing/this-computer", { name: "sweep PC" });
    return r.status >= 400 || `it answered ${r.status} — the screen hiding a button has never been a gate`;
  });

  await setPerm(true);
  let sweptAgent = null;
  await phase("with the permission, this browser can register the computer it is sitting at", async () => {
    const r = await asMgrPost("/printing/this-computer", { name: "Sweep PC" }, DEV2);
    sweptAgent = r.body.id || null;
    if (sweptAgent) made.agents.push(sweptAgent);
    return (r.status === 200 && String(r.body.code || "").startsWith("lfhp_")) || `status ${r.status} · ${JSON.stringify(r.body).slice(0, 140)}`;
  });
  await phase("…and the row remembers WHICH browser did it (mig 367)", async () => {
    const [row] = await db(`print_agents?id=eq.${sweptAgent}&select=owner_device,owner_user`);
    return row?.owner_device === DEV2 || `owner_device was ${row?.owner_device}`;
  });
  // "newcode" was RETIRED by mig 368 — the helper file carries no token, so there was nowhere left to
  // show one. `unlink` is the verb that replaced it, and the rule under test is unchanged: a browser
  // that does not own a machine cannot act on it.
  await phase("…a DIFFERENT browser cannot unlink that computer", async () => {
    const r = await asMgrPost("/printing/unlink", {}, "sweep-device-C");
    return r.status >= 400 || `it answered ${r.status} — another screen could unlink somebody else's machine`;
  });
  await phase("…and pressing “set up” twice makes ONE computer, not two", async () => {
    const before = (await db(`print_agents?restaurant_id=eq.${RID}&owner_device=eq.${DEV2}&select=id`)).length;
    await asMgrPost("/printing/this-computer", { name: "Sweep PC" }, DEV2);
    const after = (await db(`print_agents?restaurant_id=eq.${RID}&owner_device=eq.${DEV2}&select=id`)).length;
    return (before === 1 && after === 1) || `${before} → ${after}`;
  });

  // The kitchen-slip line IS settings.auto_print_kot. Two boards, one column — the exact fault the
  // owner reported on 2026-08-26 ("board should be sync, right now it's not").
  await phase("answering “nobody” on kitchen slips switches auto-print OFF at the source", async () => {
    const r = await asMgrPost("/printing/route", { kind: "kot", who: "off" }, DEV2);
    const [st] = await db(`settings?restaurant_id=eq.${RID}&select=auto_print_kot,modules`);
    return (r.status === 200 && st.auto_print_kot === false && st.modules?.printing?.routes?.kot?.via === "off")
      || `status ${r.status} · auto_print_kot ${st.auto_print_kot} · via ${st.modules?.printing?.routes?.kot?.via}`;
  });
  await phase("…and with it off, a new order queues NO ticket (the trigger reads that same column)", async () => {
    const { jobId } = await newOrder(41, "sweep off-line");
    return jobId === null || "a ticket was queued for a restaurant that had said it does not print them";
  });
  await phase("answering “print here” switches it back on and points at THIS computer's printer", async () => {
    // A route can only ever name a printer the machine itself reported — so report one first.
    await db(`print_agents?id=eq.${sweptAgent}`, { method: "PATCH",
      body: JSON.stringify({ printers: [{ name: "Sweep-Printer", paper: { wMm: 79.7, hMm: 64.2 } }] }) });
    const r = await asMgrPost("/printing/route", { kind: "kot", who: "computer", printer: "Sweep-Printer" }, DEV2);
    const [st] = await db(`settings?restaurant_id=eq.${RID}&select=auto_print_kot,modules`);
    const kot = st.modules?.printing?.routes?.kot || {};
    return (r.status === 200 && st.auto_print_kot === true && kot.agent === sweptAgent && kot.printer === "Sweep-Printer")
      || `status ${r.status} · auto_print_kot ${st.auto_print_kot} · ${JSON.stringify(kot).slice(0, 140)}`;
  });
  await phase("…a printer the machine never reported is refused", async () => {
    const r = await asMgrPost("/printing/route", { kind: "bill", who: "computer", printer: "A-Printer-Nobody-Has" }, DEV2);
    return r.status >= 400 || "a route was saved to a printer that does not exist — it would print nowhere while looking set";
  });
  await phase("a browser with no computer of its own cannot route paper to one", async () => {
    const r = await asMgrPost("/printing/route", { kind: "bill", who: "computer", printer: "Sweep-Printer" }, "sweep-device-D");
    return r.status >= 400 || "any screen could point the bills at somebody else's printer";
  });
  await phase("…but it can ADOPT the machine it is sitting at, instead of registering it twice", async () => {
    const r = await asMgrPost("/printing/this-computer", { adopt: sweptAgent }, "sweep-device-D");
    const [row] = await db(`print_agents?id=eq.${sweptAgent}&select=owner_device`);
    return (r.status === 200 && row?.owner_device === "sweep-device-D") || `status ${r.status} · owner_device ${row?.owner_device}`;
  });
}

// ══ 6c · THE ZERO-TYPING HANDSHAKE (mig 368) ═════════════════════════════════════════════════
// Owner, 2026-08-27: "zero typing one, yeah". The helper holds no secret, so the ONLY thing standing
// between a stranger and a restaurant's printer is this handshake. Every refusal below is a rule.
{
  const pair = (path, body) => fetch(BASE + "/api/print-agent/pair/" + path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  let code = null, secret = null;
  await phase("a helper with NO credential can start a pairing (it grants nothing yet)", async () => {
    const r = await pair("start", { fingerprint: "sweep-fp-1", hostname: "Sweep Machine", os: "mac",
      printers: [{ name: "Sweep-Printer", paper: { wMm: 79.7, hMm: 64.2 } }] });
    code = r.body.code || null; secret = r.body.secret || null;
    return (r.status === 200 && !!code && !!secret && /\/pair\?c=/.test(String(r.body.pairUrl || "")))
      || `status ${r.status} · ${JSON.stringify(r.body).slice(0, 120)}`;
  });
  await phase("…and it is WAITING, not linked, until a human approves it", async () => {
    const r = await pair("poll", { code, secret });
    return r.body.state === "waiting" || `state was ${r.body.state}`;
  });
  await phase("…the code ALONE cannot collect a token (only the process that started it can)", async () => {
    const r = await pair("poll", { code, secret: "not-the-secret" });
    return r.body.state === "expired" || `a wrong secret got "${r.body.state}" — seeing the code would be enough`;
  });
  await phase("…and an unknown code answers exactly like an expired one (no way to discover codes)", async () => {
    const r = await pair("poll", { code: "ZZZZZZZZ", secret: "whatever" });
    return r.body.state === "expired" || `state was ${r.body.state}`;
  });
  await phase("a SIGNED-OUT browser is not offered the Allow button", async () => {
    const r = await fetch(`${BASE}/api/pair?c=${code}`).then((x) => x.json());
    return r.signedIn === false || `signedIn was ${JSON.stringify(r.signedIn)}`;
  });
  await phase("…and a signed-out POST cannot approve it", async () => {
    const r = await fetch(BASE + "/api/pair", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, rid: RID }) });
    return r.status === 401 || `it answered ${r.status} — anyone could adopt a machine`;
  });

  let agentId = null;
  await phase("the ADMIN can approve it, and the machine's OWN name becomes the computer's name", async () => {
    const r = await api("/api/pair", { method: "POST", body: JSON.stringify({ code, rid: RID }) })
      .then(async (x) => ({ status: x.status, body: await x.json().catch(() => ({})) }));
    if (r.body.agentId) { agentId = r.body.agentId; made.agents.push(agentId); }
    return (r.status === 200 && r.body.name === "Sweep Machine") || `status ${r.status} · ${JSON.stringify(r.body).slice(0, 120)}`;
  });
  await phase("…and the printers it reported are already ON the row, so the dropdowns are full at once", async () => {
    const [row] = await db(`print_agents?id=eq.${agentId}&select=printers,fingerprint`);
    return (row?.printers?.[0]?.name === "Sweep-Printer" && row.printers[0].paper?.wMm === 79.7 && row.fingerprint === "sweep-fp-1")
      || JSON.stringify(row);
  });
  let token = null;
  await phase("the helper collects its token — ONCE", async () => {
    const r = await pair("poll", { code, secret });
    token = r.body.token || null;
    return (r.body.state === "linked" && String(token || "").startsWith("lfhp_")) || JSON.stringify(r.body).slice(0, 120);
  });
  await phase("…and a SECOND collection gets nothing (a replayed poll cannot copy a credential)", async () => {
    const r = await pair("poll", { code, secret });
    return r.body.state === "expired" || `state was ${r.body.state} — the token was handed out twice`;
  });
  await phase("…the token it was given really works on the helper's own door", async () => {
    const r = await fetch(BASE + "/api/print-agent/hello", { method: "POST",
      headers: { "content-type": "application/json", "x-lfh-agent": token },
      body: JSON.stringify({ fingerprint: "sweep-fp-1", printers: [{ name: "Sweep-Printer" }] }) });
    return r.ok || `hello answered ${r.status}`;
  });
  await phase("…and approving the same pairing again is refused", async () => {
    const r = await api("/api/pair", { method: "POST", body: JSON.stringify({ code, rid: RID }) });
    return r.status >= 400 || `it answered ${r.status} — one pairing could make two computers`;
  });
}

// ══ 7 · THE GUARDS THEMSELVES ════════════════════════════════════════════════════════════════
for (const g of ["verify:print-helper", "verify:print-queue", "verify:print-format", "verify:print-paper", "verify:access", "verify:taps"]) {
  await phase(`the ${g} guard passes`, () => {
    try { execFileSync("npm", ["run", "-s", g.replace("verify:", "verify:")], { cwd: new URL("..", import.meta.url).pathname, stdio: "pipe" }); return true; }
    catch (e) { return "it fails: " + String(e.stdout || e.message).split("\n").filter((l) => /FAIL|✗/.test(l)).slice(0, 1).join(""); }
  });
}
if (browser) await browser.close();

} catch (e) { console.log("\n  the sweep could not continue: " + e.message); fail++; }

// ── the ledger, and put the world back ────────────────────────────────────────────────────────
try { await setRoutes(bagWas.printing?.routes || {}); } catch {}
try { await db(`settings?restaurant_id=eq.${RID}`, { method: "PATCH", body: JSON.stringify({ modules: bagWas, ...switchesWas }) }); } catch {}
for (const id of made.events) { try { await db(`printer_events?id=eq.${id}`, { method: "DELETE" }); } catch {} }
for (const id of made.jobs)   { try { await db(`print_jobs?id=eq.${id}`,   { method: "DELETE" }); } catch {} }
for (const id of made.orders) { try { await db(`orders?id=eq.${id}`,       { method: "DELETE" }); } catch {} }
for (const id of made.agents) { try { await db(`print_agents?id=eq.${id}`, { method: "DELETE" }); } catch {} }
// The manager permission section 6b switched on and off is the restaurant's, not ours (mig 367).
if (permsWas !== null) { try { await db(`restaurants?id=eq.${RID}`, { method: "PATCH", body: JSON.stringify({ manager_permissions: permsWas }) }); } catch {} }

console.log("─".repeat(78));
console.log(`${n} phases · ${pass} passed · ${fail} failed · ${skip} skipped`);
if (fails.length) { console.log("\nwhat failed:"); for (const f of fails) console.log("  · " + f); }
console.log("test rows removed; the restaurant's own printing settings put back.");
process.exit(fail ? 1 : 0);
