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
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

// ── ONE SWEEP AT A TIME ──────────────────────────────────────────────────────────────────────
// Two copies of this file running together fight over one restaurant's routes and permissions, and
// the loser reports the winner's writes as product faults — that is what run 9's five failures were
// (2026-08-29). `verify:everything` already refuses to start while another run is alive; this file
// needs the same manners.
const LOCK = "/tmp/printing-sweep.pid";
try {
  const alive = Number(readFileSync(LOCK, "utf8"));
  if (alive && alive !== process.pid) {
    try { process.kill(alive, 0); }              // signal 0 = "does this process exist?"
    catch { throw new Error("stale"); }
    console.log(`\nAnother printing sweep is already running (pid ${alive}). Two of them fight over one\nrestaurant and each reports the other's writes as faults. Waiting is the right move.`);
    process.exit(2);
  }
} catch (e) { if (e && e.message && e.message.includes("already running")) throw e; }
try { writeFileSync(LOCK, String(process.pid)); } catch {}
const dropLock = () => { try { if (Number(readFileSync(LOCK, "utf8")) === process.pid) unlinkSync(LOCK); } catch {} };
process.on("exit", dropLock);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { dropLock(); process.exit(130); });

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
// Nothing answering on --base is "could not run", never "ran and found a fault". Without this the
// first api() call threw a bare fetch error 20 lines into the run, after the header had already
// printed, and 500 phases read as broken instead of not started.
const { requireUp } = await import("./sweep/appUp.mjs");
const { restoreOnExit } = await import("./sweep/restore.mjs");
await requireUp(BASE, "the 500-phase printing sweep");

let n = 0, pass = 0, fail = 0, skip = 0;
const fails = [];
const phase = async (title, fn) => {
  n++;
  if (n < FROM || n > TO) return;
  try {
    const r = await fn();
    // A skipped phase must say WHY it was skipped. It used to say "needs the virtual printers" for
    // every skip, including eight banquet phases that were really skipped because no banquet bill
    // existed — a skip that reads as green while blaming the wrong thing is worse than a red one.
    if (r === "skip" || (typeof r === "string" && r.startsWith("skip:"))) {
      skip++;
      const why = typeof r === "string" && r.startsWith("skip:") ? r.slice(5).trim() : "needs the virtual printers";
      console.log(`  ⃘ ${String(n).padStart(3)}  ${title}  — skipped (${why})`);
      return;
    }
    if (r === true || r === undefined) { pass++; if (process.env.SWEEP_QUIET !== "1") console.log(`  ✅ ${String(n).padStart(3)}  ${title}`); return; }
    fail++; fails.push(`${n} · ${title} → ${r}`); console.log(`  ❌ ${String(n).padStart(3)}  ${title}  → ${r}`);
  } catch (e) { fail++; fails.push(`${n} · ${title} → threw ${e.message}`); console.log(`  ❌ ${String(n).padStart(3)}  ${title}  → threw ${e.message.slice(0, 120)}`); }
};

// ── the world this sweep works in ─────────────────────────────────────────────────────────────
const made = { agents: [], jobs: [], orders: [], events: [] };
let RID = "", bagWas = {}, switchesWas = {}, TOKEN = "", AGENT = null, SESSION = null;
// The one reusable, voided banquet bill (§9 makes it) — §16 prints it too, so it lives out here.
let BQ_BILL_ID = null;
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
// ── crash safety: what this run changed, written to disk BEFORE it changes it ────────────────
// A sweep killed by a timeout never reaches its own restore, so it leaves the shared restaurant's
// permissions rewritten — and every later run then fails on that mess. On 2026-08-29 fourteen
// phases went red for exactly this, and every one of them read like a product bug (a feature cap
// left switched off vetoes printing for EVERYONE). So each mutation of the shared world is stashed
// first; the next run puts it back before testing anything.
const STASH = "/tmp/printing-sweep-restore.json";
const stash = (patch) => {
  let cur = {};
  try { cur = JSON.parse(readFileSync(STASH, "utf8")); } catch {}
  // First writer wins — the EARLIEST capture is the true original, not the latest.
  const out = { ...cur };
  if (patch.restaurant) out.restaurant = { ...patch.restaurant, ...(cur.restaurant || {}) };
  if (patch.people) out.people = { ...patch.people, ...(cur.people || {}) };
  if (patch.settings) out.settings = { ...patch.settings, ...(cur.settings || {}) };
  try { writeFileSync(STASH, JSON.stringify(out, null, 1)); } catch {}
};
const stashClear = () => { try { unlinkSync(STASH); } catch {} };

// EMPTY THE QUEUE, not just the rows this run happens to remember. `made.jobs` misses every ticket
// the mig-335 trigger queued by itself when the sweep placed an order — and those are exactly the
// ones that sit AHEAD of the next phase's ticket and make it read as "the helper was not handed the
// job". Scoped to tickets older than this instant, so a session working alongside this one never
// loses a ticket it just made. Dismissed, never "printed": no paper is claimed to exist.
// THE PANEL READS ARE SHARED FOR ~1.5s ON PURPOSE (mig 238, and CLAUDE.md says so). So a route
// written a moment ago can be answered with what was true a moment before that — an honestly stale
// answer, not a fault. Ask again before calling it one, and if it never settles, report the last
// thing it actually said.
const settles = async (read, want, tries = 5, gapMs = 700) => {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await read();
    if (want(last)) return { ok: true, last };
    if (i < tries - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  return { ok: false, last: last || {} };
};

const drain = async () => {
  const cutoff = new Date().toISOString();
  for (const st of ["queued", "printing"]) {
    try { await db(`print_jobs?restaurant_id=eq.${RID}&status=eq.${st}&created_at=lt.${cutoff}`,
      { method: "PATCH", body: JSON.stringify({ status: "dismissed", done_at: cutoff }) }); } catch {}
  }
};
// Take tickets off the queue until the one we are waiting for comes out. /next handing the OLDEST
// queued ticket first is CORRECT — a phase that demands its own ticket be first is asserting the
// queue is empty, which is a different thing and not true after a killed run.
// Like takeUntil, but the ticket we are waiting for is left CLAIMED — the caller still has to fetch
// its paper and print it. Only the ones queued ahead of it are cleared out of the way.
const takeUntilClaim = async (jobId, max = 15) => {
  for (let i = 0; i < max; i++) {
    const r = await agentCall("/next");
    if (r.status !== 200) return null;
    const g = await r.json();
    if (g.id === jobId) return g;
    await agentCall(`/job/${g.id}/done`, { method: "POST", body: "{}" });
  }
  return null;
};
const takeUntil = async (jobId, max = 15) => {
  for (let i = 0; i < max; i++) {
    const r = await agentCall("/next");
    if (r.status !== 200) return null;
    const g = await r.json();
    await agentCall(`/job/${g.id}/done`, { method: "POST", body: "{}" });
    if (g.id === jobId) return g;
  }
  return null;
};

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
const tk = mint(); TOKEN = tk.t;
// ── A KILLED RUN MUST NOT BLOCK THE NEXT ONE ─────────────────────────────────────────────────
// Found on 2026-08-29: the previous run was killed by a two-minute timeout, so its cleanup never
// ran, and every run afterwards died on startup with a UNIQUE(restaurant_id, name) clash on
// "sweep-pc" — 7 phases in, before it could test anything. A test harness that one crash disables
// is a harness nobody trusts.
// Scoped to the EXACT names this file creates, never "whatever is there": these deletes must be
// unable to touch a real restaurant's computer.
for (const leftover of ["sweep-pc", "Sweep PC", "Perm PC", "Review PC", "Review PC 2"]) {
  try { await db(`print_agents?restaurant_id=eq.${RID}&name=eq.${encodeURIComponent(leftover)}`, { method: "DELETE" }); } catch {}
}
try { await db(`print_pairings?hostname=in.("Sweep Machine","Review PC","Review PC 2","live-probe")`, { method: "DELETE" }); } catch {}
try { await db(`print_agents?restaurant_id=eq.${RID}&name=like.Sweep Machine*`, { method: "DELETE" }); } catch {}

// Put back the permissions a killed run rewrote, from the stash it wrote before touching them.
try {
  const old = JSON.parse(readFileSync(STASH, "utf8"));
  if (old.restaurant) await db(`restaurants?id=eq.${RID}`, { method: "PATCH", body: JSON.stringify(old.restaurant) });
  // …and the printing MODE, the three paper lines and the two switches. Leaving those mid-change is
  // subtler than leaving a permission off: the next run captures the polluted state as "how this
  // restaurant was", restores THAT at the end, and quietly reports the early routing phases as
  // product faults (run 5, phase 36: the kitchen was told it may print when the route named a
  // computer, because the mode left behind said otherwise).
  if (old.settings) await db(`settings?restaurant_id=eq.${RID}`, { method: "PATCH", body: JSON.stringify(old.settings) });
  for (const [pid, permissions] of Object.entries(old.people || {})) {
    await db(`staff_users?id=eq.${pid}`, { method: "PATCH", body: JSON.stringify({ permissions }) });
  }
  console.log("  \u21ba a previous run was killed — the permissions it had rewritten were put back before starting.");
} catch {}
stashClear();

// ONLY NOW is it safe to ask this restaurant how it is set up. Reading it BEFORE the heal above —
// which is what the first version of this did — captures a killed run's half-written state as
// "how the restaurant was", puts THAT back at the end, and writes a stash that the heal then
// deletes one line later. So the settings had no crash protection at all, and every run after a
// kill quietly inherited the mess (found 2026-08-29, by noticing the stash file was never on disk
// while a run was in flight).
const [st0] = await db(`settings?restaurant_id=eq.${RID}&select=modules,auto_print_kot,auto_print_kot_allowed,kot_print_target`);
bagWas = st0.modules || {};
switchesWas = { auto_print_kot: st0.auto_print_kot, auto_print_kot_allowed: st0.auto_print_kot_allowed, kot_print_target: st0.kot_print_target };
stash({ settings: { modules: bagWas, ...switchesWas } });
// AND put them back on a CATCHABLE interruption, without waiting for the next run to notice
// (T28, item 12). The stash above is the stronger half — it survives a kill, which nothing in the
// process can — but it only heals on the NEXT run, so between a Ctrl-C and that run the restaurant
// is left with this sweep's printing routes. The two together cover both: this one restores at
// once when the signal can be caught, the stash covers the kill that cannot be.
restoreOnExit("the restaurant's printing routes + auto-print switches", async () => {
  await db(`settings?restaurant_id=eq.${RID}`, { method: "PATCH", body: JSON.stringify({ modules: bagWas, ...switchesWas }) });
});

// Tickets still queued from a killed run sit AHEAD of this run's in the queue. Dismissed, never
// printed — and scoped to tickets older than this process, so a session testing alongside this one
// never loses a ticket it just made.
const RUN_START = new Date().toISOString();
try {
  const stale = await db(`print_jobs?select=id&restaurant_id=eq.${RID}&status=eq.queued&created_at=lt.${RUN_START}`);
  if (stale.length) {
    await db(`print_jobs?restaurant_id=eq.${RID}&status=eq.queued&created_at=lt.${RUN_START}`,
      { method: "PATCH", body: JSON.stringify({ status: "dismissed" }) });
    console.log(`  \u21ba ${stale.length} ticket(s) left queued by an earlier run were cleared (dismissed, not printed).`);
  }
} catch {}

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
const [OWNER] = await db(`staff_users?select=id,name&role=eq.owner&restaurant_id=eq.${RID}&order=id.asc&limit=1`);
// "A DIFFERENT PERSON" HAS TO BE A DIFFERENT MANAGER, not an owner. The address book checks that the
// person named on a manager-panel route is someone who may print there at all, so naming an OWNER is
// refused for being ineligible — a true answer to a question this phase is not asking. It asks about
// IDENTITY: the route names a real, eligible manager, and the manager signed in is somebody else, so
// the refusal must be `other_person`. Ordered, and explicitly not diagm1, so it can never drift onto
// the very person whose cookie asManager() carries.
const [OTHER_MGR] = await db(`staff_users?select=id,name&role=eq.manager&restaurant_id=eq.${RID}&id=neq.${mgr.id}&order=id.asc&limit=1`);

const SHAPES = [
  { label: "nothing routed", route: {}, kitchen: true, manager: false },
  { label: "a COMPUTER owns the kitchen slips", route: { kot: { agent: AGENT.id, printer: VIRT.kitchen } }, kitchen: false, manager: false },
  { label: "the KITCHEN screen is named", route: { kot: { via: "screen", panel: "kitchen" } }, kitchen: true, manager: false },
  { label: "the MANAGER screen is named", route: { kot: { via: "screen", panel: "manager" } }, kitchen: false, manager: true },
  { label: "the OWNER screen is named", route: { kot: { via: "screen", panel: "owner" } }, kitchen: false, manager: false },
  { label: "the TABLET is named", route: { kot: { via: "screen", panel: "tablet" } }, kitchen: false, manager: false },
  { label: "the manager screen AND that particular manager", route: { kot: { via: "screen", panel: "manager", person: mgr.id } }, kitchen: false, manager: true },
  { label: "the manager screen but a DIFFERENT person", route: { kot: { via: "screen", panel: "manager", person: (OTHER_MGR || OWNER).id } }, kitchen: false, manager: false, expectRefuse: "other_person" },
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
    const r = await settles(() => asKitchen("/board?autojobs=1"), (b) => (b.autoPrintKot === true) === sh.kitchen);
    return r.ok || `board says autoPrintKot=${r.last.autoPrintKot}, printRefused=${r.last.printRefused}`;
  });
  await phase(`  …and the MANAGER screen ${sh.manager ? "may" : "may NOT"} print it`, async () => {
    const r = await settles(() => asManager("/print-jobs/pending"), (d) => (!d.off) === sh.manager);
    return r.ok || `pending says off=${r.last.off}, printRefused=${r.last.printRefused}`;
  });
  if (sh.expectRefuse) {
    await phase(`  …and the screen is told WHY (${sh.expectRefuse})`, async () => {
      const rr = await settles(async () => ({ b: await asKitchen("/board?autojobs=1"), p: await asManager("/print-jobs/pending") }),
        (x) => x.b.printRefused === sh.expectRefuse || x.p.printRefused === sh.expectRefuse);
      const b = rr.last.b || {}, p2 = rr.last.p || {};
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
// The browser is needed for the ON-SCREEN section too, not only for measuring paper, so it is not
// tied to whether the virtual printers happen to be set up.
const { chromium } = await import("playwright").catch(() => ({ chromium: null }));
const browser = chromium ? await chromium.launch() : null;
const printAndMeasure = async (kind, which, paper, payload, orderId) => {
  // queue it addressed to the virtual printer, claim it as the helper, fetch the document, render it
  // at the route's paper size, and print — exactly the helper's own sequence.
  const [job] = await db("print_jobs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
    restaurant_id: RID, kind, status: "queued", reprint: false, agent_id: AGENT.id, printer: VIRT[which],
    ...(orderId ? { order_id: orderId } : {}), payload: payload || {} }) });
  made.jobs.push(job.id);
  const got = await takeUntilClaim(job.id);
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

// ══ 4b · THE BANQUET SHEET, measured on the document itself ══════════════════════════════════
// Big paper cannot be measured through a thermal driver (see the note above), so it is measured
// where the fault would actually be: the document the helper renders.
//
// AND THE SIZE IS NOT THE PRINTING SCREEN'S TO CHOOSE. `banquetDocHtml` draws exactly two sheets,
// A4 or A5, and picks between them from the RESTAURANT'S own `settings.banquet_paper_size` — set on
// the Banquet screen, beside the margins. Because the sheet declares that page size itself,
// `withPaper` returns it untouched, so the paper dropdown that used to sit on the Banquet line of
// the Printing screen changed nothing at all. The first version of this section asked for an A6 slip
// and measured an A5 sheet, and reported the DOCUMENT as broken. It was the question that was wrong.
// So: drive the setting that really decides, and check the sheet obeys it.
if (!browser) {
  for (const label of ["A5 (the restaurant's default)", "A4 (the restaurant chose the big sheet)"]) {
    await phase(`a BANQUET SHEET is drawn at ${label}`, () => "skip: no browser to measure it in");
    await phase(`  …its ink fits inside ${label}`, () => "skip: no browser to measure it in");
    await phase(`  …and it declares that page size itself`, () => "skip: no browser to measure it in");
  }
} else {
  // A BANQUET SHEET NEEDS A BANQUET BILL, and this table's own rule is "a wrong bill is voided,
  // never deleted — the row and its number stay" (mig 237). So the sweep must not make one per run:
  // thirty runs would burn thirty numbers out of the restaurant's series. It makes ONE, marked and
  // VOIDED (so it can never read as money taken), and every later run finds and reuses it.
  const SWEEP_BILL = "sweep — printing sweep fixture, never a real function";
  let [bq] = await db(`banquet_bills?restaurant_id=eq.${RID}&select=id&remark=eq.${encodeURIComponent(SWEEP_BILL)}&limit=1`);
  if (!bq) {
    const rows = await db(`banquet_bills?restaurant_id=eq.${RID}&select=bill_seq&order=bill_seq.desc&limit=1`);
    const seq = ((rows[0] || {}).bill_seq || 0) + 1;
    try {
      [bq] = await db("banquet_bills", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
        restaurant_id: RID, bill_seq: seq, bill_no: `SWEEP-${seq}`,
        subtotal: 1000, tax: 50, total: 1050, received: 0,
        hall: "Sweep Hall", func: "Printing sweep", pax: 40, rate: 25,
        cust_name: "Printing sweep fixture", table_number: "S1",
        remark: SWEEP_BILL, prepared_by: "printing sweep", created_by: "printing sweep",
        voided_at: new Date().toISOString(), void_reason: "test fixture — never a real function", voided_by: "printing sweep",
      }) });
    } catch { bq = null; }
  }
  BQ_BILL_ID = bq ? bq.id : null;
  // The two sheets the document can be, and the restaurant setting that chooses between them.
  const SHEETS = [["A5 (the restaurant's default)", "a5", 148, 210], ["A4 (the restaurant chose the big sheet)", "a4", 210, 297]];
  const bqSizeWas = (await db(`settings?restaurant_id=eq.${RID}&select=banquet_paper_size`))[0]?.banquet_paper_size ?? null;
  for (const [label, sizeKey, wMm, hMm] of SHEETS) {
    let doc = null, box = null;
    if (bq) {
      await setSwitches({ banquet_paper_size: sizeKey });
      await api("/api/admin/printing/routes", { method: "POST", body: JSON.stringify({ rid: RID, routes: {
        banquet: { agent: AGENT.id, printer: VIRT.banquet } } }) });
      const [job] = await db("print_jobs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
        restaurant_id: RID, kind: "banquet", status: "queued", reprint: false, agent_id: AGENT.id, printer: VIRT.banquet, payload: { billId: bq.id } }) });
      made.jobs.push(job.id);
      const got = await takeUntilClaim(job.id);
      if (got) {
        const res = await agentCall(`/job/${got.id}/document`);
        if (res.status === 200) {
          doc = await res.text();
          const p3 = await browser.newPage();
          // MEASURE IT AT THE SIZE THE SHEET SAYS IT IS. Laid out in the browser's default 1280px
          // window every sheet measured 338.7mm wide — 1280px in millimetres, i.e. the window.
          await p3.setViewportSize({ width: Math.round((wMm / 25.4) * 96), height: Math.round((hMm / 25.4) * 96) });
          await p3.setContent(doc, { waitUntil: "load" });
          box = await p3.evaluate(() => {
            let l = Infinity, r = -1;
            for (const el of document.querySelectorAll("body *")) {
              const q = el.getBoundingClientRect();
              if (q.width > 0 && q.height > 0) { l = Math.min(l, q.left); r = Math.max(r, q.right); }
            }
            const mm = (px) => Math.round((px / 96) * 25.4 * 10) / 10;
            return { inkL: l === Infinity ? null : mm(l), inkR: r < 0 ? null : mm(r) };
          });
          await p3.close();
        }
        await agentCall(`/job/${got.id}/done`, { method: "POST", body: "{}" });
      }
    }
    await phase(`a BANQUET SHEET is drawn at ${label}`, () => !bq ? "skip: no banquet bill on this restaurant to print" : (doc ? true : "no document came back"));
    await phase(`  …its ink fits inside ${label}`, () => !bq ? "skip: no banquet bill on this restaurant to print" : !box ? "not measured"
      : (box.inkR !== null && box.inkR <= wMm + 1 && (box.inkL ?? 0) >= -1) || `ink ${box.inkL}–${box.inkR}mm on a ${wMm}mm sheet`);
    await phase(`  …and it declares that page size itself, so nothing downstream re-sizes it`, () =>
      !bq ? "skip: no banquet bill on this restaurant to print" : !doc ? "no document"
      : new RegExp(`@page[^}]*size:\\s*${wMm}mm\\s+${hMm}mm`).test(doc)
        || `the sheet does not declare ${wMm}mm ${hMm}mm — withPaper would then stretch it to whatever the route says`);
  }
  await db(`settings?restaurant_id=eq.${RID}`, { method: "PATCH", body: JSON.stringify({ banquet_paper_size: bqSizeWas }) });
  await phase("the Printing screen offers NO paper choice for a banquet sheet, because it cannot honour one", () => {
    const t = read("lib/printBoardWords.ts");
    return /papersFor\s*=\s*\(kind[^)]*\)\s*=>\s*\(?kind === "banquet" \? \[\]/.test(t)
      || "the banquet line offers paper sizes again — whatever is picked, the sheet still comes out at whatever the Banquet screen says";
  });
  await phase("…and it says where that size really lives instead of going quiet", () => {
    const t = read("lib/printBoardWords.ts");
    return /PAPER_ELSEWHERE[\s\S]{0,200}banquet[\s\S]{0,120}Banquet screen/.test(t)
      || "nothing tells the admin where the banquet sheet's size is set";
  });
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
  const g = await takeUntil(o.jobId);
  return (g && g.id === o.jobId) || "the helper was never handed this order's ticket"; });
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
  await takeUntil(job.id);
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
    if (permsWas === null) { permsWas = r.manager_permissions || {}; stash({ restaurant: { manager_permissions: permsWas } });
      restoreOnExit("the restaurant's manager_permissions", () =>
        db(`restaurants?id=eq.${RID}`, { method: "PATCH", body: JSON.stringify({ manager_permissions: permsWas }) })); }
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

// ══ 6d · THE ONE TOGGLE, AND THE ROUTES IT MOVES (owner, 2026-08-28) ═════════════════════════
// "I want the toggle AND the simplified UI — you only see the option you have selected." The part a
// screenshot cannot check is that the toggle MOVES the three paper lines: if the mode changed alone,
// a restaurant switched to Chrome would keep three routes pointing at a computer, the board would say
// one thing and the paper would do another.
{
  const setMode = (mode, person) => api("/api/admin/printing/mode", { method: "POST",
    body: JSON.stringify({ rid: RID, mode, ...(person ? { person } : {}) }) });
  const kotRoute = async () => {
    const [st] = await db(`settings?restaurant_id=eq.${RID}&select=modules,auto_print_kot`);
    return { kot: st.modules?.printing?.routes?.kot || {}, mode: st.modules?.printing?.mode, auto: st.auto_print_kot };
  };

  await phase("the mode is stored, and defaults to a computer", async () => {
    const r = await setMode("computer");
    const a = await kotRoute();
    return (r.ok && a.mode === "computer") || `status ${r.status} · mode ${a.mode}`;
  });
  await phase("switching to A SCREEN moves the paper lines with it", async () => {
    // give it a computer route first, so there is something to move
    await api("/api/admin/printing/routes", { method: "POST", body: JSON.stringify({ rid: RID,
      routes: { kot: { via: "computer", agent: AGENT.id, printer: VIRT.kitchen } } }) });
    const r = await setMode("screen", mgr.id);
    const a = await kotRoute();
    return (r.ok && a.mode === "screen" && a.kot.via === "screen" && a.kot.person === mgr.id)
      || `status ${r.status} · ${JSON.stringify(a)}`;
  });
  await phase("…and auto-print is re-asserted, so a mode change never silently stops printing", async () => {
    const a = await kotRoute();
    return a.auto === true || `auto_print_kot is ${a.auto} after a mode change`;
  });
  await phase("a line set to NOBODY survives a mode change — the decision outlives the mechanism", async () => {
    await api("/api/admin/printing/routes", { method: "POST", body: JSON.stringify({ rid: RID, routes: { bill: { via: "off" } } }) });
    await setMode("computer");
    const [st] = await db(`settings?restaurant_id=eq.${RID}&select=modules`);
    const bill = st.modules?.printing?.routes?.bill || {};
    return bill.via === "off" || `the bill line became ${JSON.stringify(bill)} — "we do not print this" was thrown away by a mechanism change`;
  });
  await phase("…and going back to a computer does NOT invent a printer nobody chose", async () => {
    const a = await kotRoute();
    return (!a.kot.printer && !a.kot.agent) || `it kept ${JSON.stringify(a.kot)} — the board would point at a printer nobody picked`;
  });
  // ── THE NEW MODEL, asserted where it is decided (owner, 2026-08-29) ────────────────────────
  await phase("switching to A SCREEN puts the bill back to whoever presses Print", async () => {
    await api("/api/admin/printing/routes", { method: "POST", body: JSON.stringify({ rid: RID,
      routes: { bill: { via: "computer", agent: AGENT.id, printer: VIRT.counter } } }) });
    await setMode("screen", mgr.id);
    const [st] = await db(`settings?restaurant_id=eq.${RID}&select=modules`);
    const bill = st.modules?.printing?.routes?.bill || {};
    return !bill.via
      || `the bill line is ${JSON.stringify(bill)} — a screen was handed the bills too, which is how one person's screen ended up popping every piece of paper in the restaurant`;
  });
  await phase("…and the banquet sheet too", async () => {
    const [st] = await db(`settings?restaurant_id=eq.${RID}&select=modules`);
    const bq = st.modules?.printing?.routes?.banquet || {};
    return !bq.via || `the banquet line is ${JSON.stringify(bq)}`;
  });
  await phase("a KITCHEN person can be the printing screen, and the panel follows their role", async () => {
    const [cook] = await db(`staff_users?select=id,name&restaurant_id=eq.${RID}&role=eq.kitchen&order=id.asc&limit=1`);
    if (!cook) return "skip: this restaurant has no kitchen user";
    const r = await setMode("screen", cook.id);
    const a = await kotRoute();
    return (r.ok && a.kot.panel === "kitchen" && a.kot.person === cook.id)
      || `status ${r.status} · ${JSON.stringify(a.kot)} — the panel used to be hard-coded to "manager", which refused every cook and left the picker with no kitchen option at all`;
  });
  await phase("…and that cook's screen is the one handed the ticket", async () => {
    const b = await asKitchen("/board?autojobs=1");
    return b.autoPrintKot === true || `the kitchen board says ${b.autoPrintKot} (refused: ${b.printRefused})`;
  });
  await phase("…while the manager's screen is not", async () => {
    const d = await asManager("/print-jobs/pending");
    return d.off === true || "the manager screen was handed the kitchen tickets as well";
  });
  await phase("naming a person overrides a previous “Nobody” — it is the same one question", async () => {
    await api("/api/admin/printing/routes", { method: "POST", body: JSON.stringify({ rid: RID, routes: { kot: { via: "off" } } }) });
    const r = await setMode("screen", mgr.id);
    const a = await kotRoute();
    return (r.ok && a.kot.via === "screen" && a.kot.person === mgr.id)
      || `it stayed ${JSON.stringify(a.kot)} — picking somebody after choosing Nobody saved nothing and the screen snapped back`;
  });
  await phase("a mode that is not one of the two is refused", async () => {
    const r = await setMode("carrier-pigeon");
    return r.status >= 400 || `it answered ${r.status}`;
  });
  await phase("…and a person who is not this restaurant's staff is refused", async () => {
    const r = await setMode("screen", "00000000-0000-0000-0000-0000000000ff");
    return r.status >= 400 || `it answered ${r.status} — a screen route could name somebody else's staff`;
  });
}

// ══ 8 · THE TWO LAUNCHER FILES, property by property, on all three systems ════════════════════
// Owner, 2026-08-28: "check every single bit of thing." These are the files a restaurant TYPES, so a
// wrong one is a shop that cannot print and a person who cannot tell why. Every property below is
// either something he asked for by name or something that was measured to matter.
{
  const helperSrc = read("lib/printHelperScript.ts");
  const stationSrc = read("lib/printStationScript.ts");

  // The generated text itself, not the generator — that is what lands on the shop's machine. Built
  // through the real API so the sweep tests what a person is actually handed.
  const state = await api(`/api/admin/printing/state?rid=${RID}`).then((r) => r.json());
  const H = state.files || {};
  const S = state.stationFiles || {};

  for (const os of ["mac", "windows", "linux"]) {
    // ── the HELPER file ────────────────────────────────────────────────────────────────────────
    await phase(`helper/${os}: the board hands out a file at all`, () =>
      (!!H[os]?.text && H[os].text.length > 500) || `got ${H[os]?.text?.length || 0} bytes`);
    await phase(`helper/${os}: it is named the way the steps say`, () =>
      H[os]?.filename === { mac: "print-helper.command", windows: "print-helper.bat", linux: "print-helper.sh" }[os]
        || `named ${H[os]?.filename}`);
    await phase(`helper/${os}: NO restaurant secret is baked into it (mig 368)`, () =>
      !/lfhp_/.test(H[os]?.text || "") || "a printing token is in the file — one file per restaurant again, and a credential in a text file on a counter");
    await phase(`helper/${os}: it pairs itself instead`, () =>
      /pair\/start/.test(H[os]?.text || "") && /pair\/poll/.test(H[os]?.text || "") || "the helper no longer pairs itself");
    await phase(`helper/${os}: it points at THIS site, not a constant`, () =>
      (H[os]?.text || "").includes(BASE) || `it does not mention ${BASE} — a helper aimed at the wrong site never prints and never says why`);
    await phase(`helper/${os}: it writes its token to its own disk`, () =>
      /TOKEN_FILE|TOKENFILE/.test(H[os]?.text || "") || "no token file — it would re-pair on every start");
    await phase(`helper/${os}: it installs its own start-up`, () =>
      /LaunchAgents|GetFolderPath\('Startup'\)|autostart/.test(H[os]?.text || "") || "auto-start is an instruction again; a skipped step means the shop opens and nothing prints");
    await phase(`helper/${os}: a second copy steps aside instead of fighting`, () =>
      /ALREADY RUNNING|already running/i.test(H[os]?.text || "") || "no single-instance guard: auto-start plus a double-click puts two helpers on one token");
    await phase(`helper/${os}: it says where its log is, or writes one`, () =>
      /helper\.log|LOG=/.test(H[os]?.text || "") || "no log — a silent failure has nowhere to be read");

    // ── the STATION file (mode B) ──────────────────────────────────────────────────────────────
    await phase(`station/${os}: the board hands out a file at all`, () =>
      (!!S[os]?.text && S[os].text.length > 300) || `got ${S[os]?.text?.length || 0} bytes`);
    await phase(`station/${os}: it is named the way the steps say`, () =>
      S[os]?.filename === { mac: "print-station.command", windows: "print-station.bat", linux: "print-station.sh" }[os]
        || `named ${S[os]?.filename}`);
    await phase(`station/${os}: silent printing is on (--kiosk-printing)`, () =>
      /--kiosk-printing/.test(S[os]?.text || "") || "without it every ticket waits for somebody to click Print");
    await phase(`station/${os}: and it is NOT fullscreen kiosk`, () =>
      !/--kiosk(\s|\\|\^|$)/.test(S[os]?.text || "") || "--kiosk is fullscreen — the OPPOSITE of the out-of-the-way window he asked for, and what the old guide told people to use");
    await phase(`station/${os}: its own Chrome profile, so real tabs are untouched`, () =>
      /--user-data-dir/.test(S[os]?.text || "") || "it would take over the person's ordinary Chrome, tabs and logins");
    await phase(`station/${os}: the three anti-throttling flags are all present`, () => {
      const t = S[os]?.text || "";
      const missing = ["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"].filter((f) => !t.includes(f));
      return missing.length === 0 || `missing ${missing.join(", ")} — a hidden Chrome is throttled, the panel stops polling, tickets queue and NOTHING says so (measured: 13 beacons in 14s WITH them)`;
    });
    await phase(`station/${os}: NO password or token is in it`, () =>
      !/lfhp_|password=|PASSWORD=/i.test(S[os]?.text || "") || "a credential is in the station file; the person signs in once in the window instead");
    await phase(`station/${os}: it stops the machine sleeping`, () =>
      /caffeinate|powercfg|xset/.test(S[os]?.text || "") || (os === "linux" ? true : "a sleeping computer prints nothing — the commonest 'it stopped overnight'"));
    await phase(`station/${os}: it points at a panel on THIS site`, () =>
      (S[os]?.text || "").includes(BASE) && /manager|kitchen/.test(S[os]?.text || "") || "the station file does not open a panel on this site");
    await phase(`station/${os}: it tells the person to sign in once`, () =>
      /sign in/i.test(S[os]?.text || "") || "nothing tells them the one manual step this mode has");
  }

  // Mac-only, and it is the one measured on the machine.
  await phase("station/mac: it hands the screen back to whoever had it", () =>
    /WASFRONT/.test(S.mac?.text || "") && /to activate/.test(S.mac?.text || "")
      || "the mac launcher stopped restoring focus. Measured: even with open -g -j -n and a REAL url the frontmost app went Finder → Google Chrome");
  await phase("station/mac: it launches with open -g -j -n, not the binary", () =>
    /open -g -j -n/.test(S.mac?.text || "") || "running the binary directly steals focus outright");
  await phase("station/windows: it starts MINIMISED", () =>
    /start .*\/min/i.test(S.windows?.text || "") || "start /min is the whole answer on Windows; without it the window opens in front of somebody's work");

  // ── both generators refuse to leak the host language ──────────────────────────────────────────
  for (const [name, src] of [["helper", helperSrc], ["station", stationSrc]]) {
    await phase(`${name} generator: every shell default is escaped for the template literal`, () => {
      // Shell's ${VAR:-default} collides with TS interpolation. An unescaped one is a build error,
      // so this is really a canary for the next person copying a line in.
      const bad = [...src.matchAll(/[^\\]\$\{[A-Z_]+:-/g)];
      return bad.length === 0 || `${bad.length} unescaped shell default(s) — TypeScript will eat them`;
    });
    // THIS PHASE REPLACED A WRONG ONE. Its first version tried to find back-ticks in the generator's
    // template bodies — but the bodies legitimately contain NESTED template literals inside ${…},
    // and stripping ${…} with a non-greedy [^}]* stops at the first brace and leaves them behind. It
    // failed against code that is fine, and `tsc` already guarantees the thing it was reaching for:
    // an unbalanced back-tick does not compile. So it asserts something tsc cannot instead — that
    // nothing leaked into the text a person actually types.
    await phase(`${name} generator: nothing leaked into the file a person types`, () => {
      const texts = Object.values(name === "helper" ? H : S).map((f) => f?.text || "");
      // NOT `${lowercase}` — that pattern was too broad and flagged ${dims%% *} and ${dims##* },
      // which are legitimate shell parameter expansions the generator escapes ON PURPOSE so they
      // reach the file intact. (Second wrong version of this phase; a TS interpolation cannot
      // survive into the text anyway, because it is evaluated. Only these three markers can.)
      const bad = texts.filter((t) => /undefined|\[object Object\]|\bNaN\b/.test(t));
      return bad.length === 0 || `${bad.length} of ${texts.length} generated file(s) contain undefined / [object Object] / an unresolved interpolation — a person would type that into a shop's computer`;
    });
  }
}

// ══ 9 · THE GUIDE — it is what a restaurant reads when nobody is on the phone ══════════════════
{
  const g = read("public/print-setup.html");
  const live = await fetch(BASE + "/print-setup.html").then((r) => r.text()).catch(() => "");
  await phase("the guide is served at all", () => live.length > 5000 || `got ${live.length} bytes`);
  await phase("…and what is served is what is in the repo", () => live.length === g.length || `served ${live.length} vs repo ${g.length} bytes`);
  for (const [id, why] of [
    ["twoways", "the two ways to print — the first thing a restaurant must choose"],
    ["station", "the print-station file's own steps"],
    ["helper", "the helper's own steps"],
    ["after", "what happens after it is installed — shutdowns, restarts, a new computer"],
    ["windows", "the Windows menu"], ["mac", "the Mac menu"], ["linux", "the Linux / Pi menu"],
    ["devices", "which devices can never be the printer"],
    ["wrong", "the what-went-wrong table"],
  ]) await phase(`the guide has its ${id} section — ${why}`, () => g.includes(`id="${id}"`) || `#${id} is gone`);
  await phase("the guide never tells anyone to DOWNLOAD a script", () =>
    !/download the (script|file|helper)/i.test(g) || "a downloaded script is blocked outright by macOS and warned about by Windows");
  await phase("…and says so, so nobody wonders why it is typed by hand", () =>
    /Apple could not verify|blocked by/i.test(g) || "the reason the file is typed rather than downloaded is not written down");
  await phase("the guide's own site address is this deployment's", () =>
    /data-site-url/.test(g) || "the guide hard-codes a site address; a client would set up a helper pointing at the wrong one");
  await phase("no section is referred to by NUMBER (the numbers move per menu)", () =>
    !/§\d/.test(g.replace(/<!--[\s\S]*?-->/g, "")) || "a §number cross-reference points at the wrong section in two of the three menus");
  await phase("the guide says a browser can only print to the DEFAULT printer", () =>
    /default.{0,40}printer/i.test(g) || "the one real limit of mode B is not stated, so a shop will buy a second printer and wonder why it cannot be chosen");
}

// ══ 10 · THE PERMISSION MATRIX — every rung, on the PICKER and on the GATE ════════════════════
// This is where the sharpest bug in this feature lived: the Printing board offered a manager whose
// own page said no, because the picker read the restaurant-wide grant while the gate read all three
// rungs. So every state below is asserted on BOTH sides — the list of people the board offers, and
// what the server actually does when that person's screen asks to print.
{
  // It MUST be the very person whose cookie asManager() carries. The picker is asked about a person
  // by id and the gate answers as the signed-in person; ask about two DIFFERENT managers and every
  // "the board offered them but the server refused" reading is the harness's own fault. Found
  // 2026-08-29: `role=eq.manager&limit=1` picked "raj" while the cookie was diagm1's, and eight
  // phases accused the product of the exact bug the owner's review had found.
  const [mgrU] = await db(`staff_users?select=id,name,username,permissions&restaurant_id=eq.${RID}&username=eq.diagm1`);
  const [othU] = await db(`staff_users?select=id,name,username,permissions&restaurant_id=eq.${RID}&role=eq.manager&order=id.desc&limit=1`);
  const [rr] = await db(`restaurants?select=manager_permissions,access_config&id=eq.${RID}`);
  const mpWas = rr.manager_permissions || {}, acWas = rr.access_config || {};
  const permWas = mgrU.permissions || {};
  stash({ restaurant: { manager_permissions: mpWas, access_config: acWas }, people: { [mgrU.id]: permWas } });

  await phase("permissions · the person the board is asked about is the person the server answers as", () =>
    (mgrU && mgrU.id === mgr.id) || `the picker is asked about ${mgrU?.username} but the gate answers as ${mgr.username} — this harness would blame the product for its own mix-up`);

  const setRestaurant = (mp, ac) => db(`restaurants?id=eq.${RID}`, { method: "PATCH",
    body: JSON.stringify({ manager_permissions: { ...mpWas, ...mp }, access_config: { ...acWas, ...ac } }) });
  const setPerson = (u, v) => db(`staff_users?id=eq.${u.id}`, { method: "PATCH",
    body: JSON.stringify({ permissions: v === null ? permWas : { ...permWas, print_here: v } }) });
  const offered = async () => {
    const d = await api(`/api/admin/printing/state?rid=${RID}`).then((r) => r.json());
    return (d.people || []).filter((p) => p.panels.includes("manager")).map((p) => p.id);
  };
  // WHAT THE SERVER DOES, asked as that very person — the other half of the same rule.
  const mgrMayPrint = async () => {
    const d = await asManager("/print-jobs/pending");
    return { off: d.off === true, refused: d.printRefused || null };
  };

  // A screen route naming that manager, so "may print" is a real question for them.
  await api("/api/admin/printing/routes", { method: "POST",
    body: JSON.stringify({ rid: RID, routes: { kot: { via: "screen", panel: "manager", person: mgrU.id } } }) });
  await setSwitches({ auto_print_kot: true, auto_print_kot_allowed: true });

  // ══ THE RULE THIS SECTION NOW ASSERTS ═══════════════════════════════════════════════════════
  //
  // It used to be "the permission decides who may be picked", and the picker hid anybody whose
  // "May be the printer" was off. That is retired, because it produced the two faults the owner hit
  // on 2026-08-29: a kitchen user could never be picked at all, and he was sent to Access &
  // permissions in the middle of setting a printer up — *"remove it completely from the access and
  // permission"*.
  //
  // The rule now:
  //   · the picker lists EVERY active person, grouped by the screen they stand at;
  //   · NAMING somebody on the Printing board IS the permission — the admin has already answered
  //     the question that permission asks, and their explicit, one-person choice wins;
  //   · anybody the admin has NOT named is still governed by "May be the printer", which is what
  //     that row goes on meaning for every screen that is not the named one.
  const routeToMe = () => api("/api/admin/printing/routes", { method: "POST",
    body: JSON.stringify({ rid: RID, routes: { kot: { via: "screen", panel: "manager", person: mgrU.id } } }) });
  const routeToNobodyInParticular = () => api("/api/admin/printing/routes", { method: "POST",
    body: JSON.stringify({ rid: RID, routes: { kot: null } }) });

  await phase("permissions · the picker lists every active person, whatever their own permission", async () => {
    await setRestaurant({ print_here: false }, {});
    await setPerson(mgrU, "off");
    const list = await offered();
    return list.includes(mgrU.id)
      || "the picker hid somebody because of a permission — that is what made a kitchen user impossible to choose and sent him off to Access in the middle of the job";
  });
  await phase("permissions · …including people who stand at the KITCHEN screen", async () => {
    const d = await api(`/api/admin/printing/state?rid=${RID}`).then((r) => r.json());
    return (d.people || []).some((x) => (x.panels || []).includes("kitchen"))
      || "no kitchen person is offered at all — the exact thing he reported";
  });
  await phase("permissions · being NAMED by the admin lets that screen print, permission or not", async () => {
    await setRestaurant({ print_here: false }, {});
    await setPerson(mgrU, "off");
    await routeToMe();
    const r = await mgrMayPrint();
    return !r.off
      || `the server refused the very person the admin named (${r.refused}) — the board offers them, the paper goes nowhere, and nothing says why`;
  });
  await phase("permissions · …and the feature cap does not undo the admin's own choice either", async () => {
    await setRestaurant({ print_here: false }, { print_here: { on: false } });
    await routeToMe();
    const r = await mgrMayPrint();
    return !r.off || `refused with ${r.refused} — the admin set both of these; the one they made LAST, naming a person, is the answer`;
  });
  await phase("permissions · somebody the admin did NOT name may not print, however they are set", async () => {
    await setRestaurant({ print_here: true }, {});
    await setPerson(mgrU, "on");
    await api("/api/admin/printing/routes", { method: "POST",
      body: JSON.stringify({ rid: RID, routes: { kot: { via: "screen", panel: "manager", person: (OTHER_MGR || OWNER).id } } }) });
    const r = await mgrMayPrint();
    return r.off || "a second screen was handed the kitchen tickets — one person's screen means one";
  });
  await phase("permissions · …and it says WHY, so nobody stares at a silent printer", async () => {
    const r = await mgrMayPrint();
    return !!r.refused || "refused with no reason given";
  });
  // WITH NOTHING ROUTED THE DEFAULT ROOM IS THE KITCHEN, and that is a deliberate rule with its own
  // comment in counterPrintTarget: an unanswered restaurant prints its slips in the kitchen, not on
  // whichever manager happens to have a screen open. My first version of this phase asserted the
  // opposite from screenMayPrint's "nothing routed → whoever is entitled may print" — true of that
  // one function, and overruled for the manager panel one layer up. The phase was wrong, not the code.
  await phase("permissions · with NOTHING routed, the kitchen is the default room, not a manager's screen", async () => {
    await routeToNobodyInParticular();
    await setRestaurant({ print_here: true }, {});
    await setPerson(mgrU, null);
    const r = await mgrMayPrint();
    return r.off || "a manager screen started auto-printing kitchen slips just because nobody had answered the question";
  });
  // …so the permission is asked where it is actually reachable: the route names the MANAGER PANEL,
  // but nobody in particular. That is the case the row still governs.
  const routeToTheManagerPanel = () => api("/api/admin/printing/routes", { method: "POST",
    body: JSON.stringify({ rid: RID, routes: { kot: { via: "screen", panel: "manager" } } }) });
  await phase("permissions · the panel is named but no person → “May be the printer” ON lets them print", async () => {
    await routeToTheManagerPanel();
    await setRestaurant({ print_here: true }, {});
    await setPerson(mgrU, null);
    const r = await mgrMayPrint();
    return !r.off || `refused with ${r.refused}`;
  });
  await phase("permissions · …and OFF stops them, with a reason on the screen", async () => {
    await setRestaurant({ print_here: false }, {});
    await setPerson(mgrU, "off");
    const r = await mgrMayPrint();
    return (r.off && r.refused === "not_allowed")
      || `may=${!r.off} refused=${r.refused} — the row still has to mean something for every screen the admin has not named`;
  });
  await phase("permissions · the picker and the gate agree about the person who IS named", async () => {
    await setRestaurant({ print_here: true }, {});
    await setPerson(mgrU, null);
    await routeToMe();
    const list = await offered();
    const r = await mgrMayPrint();
    return (list.includes(mgrU.id) && !r.off)
      || `offered=${list.includes(mgrU.id)} mayPrint=${!r.off} — the picker and the gate are two copies of one rule again`;
  });
  await routeToNobodyInParticular();

  // put the world back before anything else runs
  await db(`restaurants?id=eq.${RID}`, { method: "PATCH", body: JSON.stringify({ manager_permissions: mpWas, access_config: acWas }) });
  await setPerson(mgrU, null);
  await phase("permissions · restored exactly as they were", async () => {
    const [now] = await db(`restaurants?select=manager_permissions,access_config&id=eq.${RID}`);
    const [nowU] = await db(`staff_users?select=permissions&id=eq.${mgrU.id}`);
    return (JSON.stringify(now.manager_permissions) === JSON.stringify(mpWas)
      && JSON.stringify(now.access_config) === JSON.stringify(acWas)
      && JSON.stringify(nowU.permissions) === JSON.stringify(permWas))
      || "the sweep did not put this restaurant's permissions back — a test that leaves the world changed is worse than no test";
  });

  // ── print_setup: the OTHER permission, and it must not be the same one ──────────────────────
  const setSetup = (v) => db(`restaurants?id=eq.${RID}`, { method: "PATCH",
    body: JSON.stringify({ manager_permissions: { ...mpWas, print_setup: v } }) });
  const mgrPost = (path, body, device) => fetch(BASE + "/api/editor" + path, { method: "POST",
    headers: { "content-type": "application/json", cookie: MANAGER_COOKIE + "; lfh_panel_device=" + (device || "perm-dev") },
    body: JSON.stringify(body || {}) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  for (const [verb, payload] of [
    ["this-computer", { name: "Perm PC" }],
    ["mode", { mode: "screen" }],
    ["route", { kind: "kot", who: "off" }],
    ["unlink", {}],
    ["test", { printer: "whatever" }],
  ]) {
    await setSetup(false);
    await phase(`print_setup OFF → the panel refuses /printing/${verb} on the SERVER`, async () => {
      const r = await mgrPost("/printing/" + verb, payload);
      return r.status >= 400 || `it answered ${r.status} — hiding the button has never been a gate`;
    });
  }
  await setSetup(true);
  await phase("print_setup ON → the panel's own state says maySetup", async () => {
    const d = await asManager("/printing/state");
    return d.maySetup === true || `maySetup was ${JSON.stringify(d.maySetup)}`;
  });
  await phase("…and print_setup is NOT the same switch as print_here", () => {
    const t = read("lib/accessTree.ts");
    return /id: "print_setup"/.test(t) && /id: "print_here"/.test(t)
      || "the two printing permissions have been merged: being the printer and deciding where the whole restaurant's paper goes are different amounts of trust";
  });
  await db(`restaurants?id=eq.${RID}`, { method: "PATCH", body: JSON.stringify({ manager_permissions: mpWas }) });
}

// ══ 11 · MODE × PAPER × STATE — the whole grid, stored AND as each screen sees it ═════════════
{
  const setMode = (mode, person) => api("/api/admin/printing/mode", { method: "POST",
    body: JSON.stringify({ rid: RID, mode, ...(person ? { person } : {}) }) });
  const setPaper = (kind, route) => api("/api/admin/printing/routes", { method: "POST",
    body: JSON.stringify({ rid: RID, routes: { [kind]: route } }) });
  const stored = async (kind) => {
    const [st] = await db(`settings?restaurant_id=eq.${RID}&select=modules,auto_print_kot`);
    return { r: st.modules?.printing?.routes?.[kind] || {}, mode: st.modules?.printing?.mode, auto: st.auto_print_kot };
  };
  const [mgrU2] = await db(`staff_users?select=id&restaurant_id=eq.${RID}&role=eq.manager&limit=1`);

  for (const kind of ["kot", "bill", "banquet"]) {
    // ── in COMPUTER mode ──────────────────────────────────────────────────────────────────────
    await setMode("computer");
    await phase(`grid · computer/${kind}: a computer + its printer is stored`, async () => {
      const r = await setPaper(kind, { via: "computer", agent: AGENT.id, printer: VIRT.kitchen });
      const s2 = await stored(kind);
      return (r.ok && s2.r.agent === AGENT.id && s2.r.printer === VIRT.kitchen) || `status ${r.status} · ${JSON.stringify(s2.r)}`;
    });
    await phase(`grid · computer/${kind}: a printer that machine never reported is refused`, async () => {
      const r = await setPaper(kind, { via: "computer", agent: AGENT.id, printer: "No-Such-Printer" });
      return r.status >= 400 || "a route was saved to a printer that does not exist — it prints nowhere while looking set";
    });
    await phase(`grid · computer/${kind}: a computer that is not this restaurant's is refused`, async () => {
      const r = await setPaper(kind, { via: "computer", agent: "00000000-0000-0000-0000-0000000000ff", printer: VIRT.kitchen });
      return r.status >= 400 || "a route was saved to another restaurant's machine";
    });
    await phase(`grid · computer/${kind}: NOBODY is stored as a decision, not an empty line`, async () => {
      const r = await setPaper(kind, { via: "off" });
      const s2 = await stored(kind);
      return (r.ok && s2.r.via === "off" && !s2.r.agent) || `${JSON.stringify(s2.r)}`;
    });
    if (kind === "kot") {
      await phase(`grid · computer/kot: NOBODY switches auto-print off at the source`, async () => {
        const s2 = await stored("kot");
        return s2.auto === false || `auto_print_kot is ${s2.auto} — mig 335's trigger would keep filling the basket behind a switch that says off`;
      });
      await phase(`grid · computer/kot: …and switching it back on re-asserts auto-print`, async () => {
        await setPaper("kot", { via: "computer", agent: AGENT.id, printer: VIRT.kitchen });
        const s2 = await stored("kot");
        return s2.auto === true || `auto_print_kot is ${s2.auto}`;
      });
    }

    // ── in SCREEN mode ────────────────────────────────────────────────────────────────────────
    await setMode("screen", mgrU2.id);
    await phase(`grid · screen/${kind}: the mode put this line on a screen`, async () => {
      const s2 = await stored(kind);
      // a line the mode left as "nobody" stays that way — that is the rule, so accept either
      return (s2.r.via === "screen" && s2.r.panel === "manager") || s2.r.via === "off"
        || `${JSON.stringify(s2.r)} — the toggle did not move this line`;
    });
    await phase(`grid · screen/${kind}: it carries the named person, not a device`, async () => {
      const s2 = await stored(kind);
      if (s2.r.via !== "screen") return true;
      return (s2.r.person === mgrU2.id && !s2.r.device)
        || `person=${s2.r.person} device=${s2.r.device} — the toggle stores { person } with no device, and a per-paper On must match it`;
    });
    await phase(`grid · screen/${kind}: NOBODY still overrides the mode`, async () => {
      await setPaper(kind, { via: "off" });
      const s2 = await stored(kind);
      return s2.r.via === "off" || `${JSON.stringify(s2.r)}`;
    });
    // A MECHANISM CHANGE IS NOT AN ANSWER. Flipping "computer / screen" says how the paper comes
    // out, not whether it comes out, so a line set to Nobody must survive it untouched.
    await phase(`grid · screen/${kind}: …and it survives switching mode back and forth`, async () => {
      await setMode("computer");
      await setMode("screen");                     // no person: the mechanism only
      const s2 = await stored(kind);
      return s2.r.via === "off" || `"nobody" became ${JSON.stringify(s2.r)} — a mechanism change threw away a deliberate decision`;
    });
    // …but NAMING SOMEBODY IS an answer, and only for the kitchen line, which is the only paper a
    // screen can own. Choosing a person in that one dropdown is the same control that says Nobody,
    // so it has to be able to say yes as well as no (owner, 2026-08-29).
    await phase(`grid · screen/${kind}: naming a person ${kind === "kot" ? "DOES" : "does not"} turn it back on`, async () => {
      await setMode("screen", mgrU2.id);
      const s2 = await stored(kind);
      return (kind === "kot" ? s2.r.via === "screen" : s2.r.via === "off")
        || `${kind} became ${JSON.stringify(s2.r)}`;
    });
    await setPaper(kind, { via: "off" });          // back to the state the next phase expects
    await setPaper(kind, null);   // leave the line unanswered for the next kind
  }
  await setMode("computer");
}

// ══ 12 · THE EDGES OF THE HANDOVER — what the helper is told when things go wrong ═════════════
// The queue's whole promise is "a ticket stays pending until paper really exists". Every phase here
// is one way that promise could quietly become a lie: a second machine closing a ticket it never
// printed, a ticket retried forever, a document handed to the wrong computer, a claim two helpers
// both win. None of these have a screen — they are the machinery under every printing screen there
// is — so this section is the only place they are ever looked at.
{
  const other = mint();
  const [otherAgent] = await db("print_agents", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
    restaurant_id: RID, name: "sweep-pc-2", token_hash: other.h, last_seen_at: new Date().toISOString(),
    printers: [{ name: VIRT.kitchen, desc: "virtual thermal", paper: { wMm: 79.7, hMm: 64.2 } }] }) });
  made.agents.push(otherAgent.id);
  // Route the TEST kind at this computer too. A ticket is only ever handed to the machine its kind
  // is routed to — queue a kind nothing points at and the claim correctly answers "nothing for you",
  // which the first run of this section reported as six product faults of its own making.
  const mineOnly = { kot: { agent: AGENT.id, printer: VIRT.kitchen }, test: { agent: AGENT.id, printer: VIRT.kitchen } };
  await setRoutes(mineOnly);
  await setSwitches({ auto_print_kot: true, auto_print_kot_allowed: true });

  const queueOne = async (patch = {}) => {
    const [j] = await db("print_jobs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
      restaurant_id: RID, kind: "test", status: "queued", reprint: false, printer: VIRT.kitchen, payload: {}, ...patch }) });
    made.jobs.push(j.id); return j;
  };
  const claim = async (tok) => { const r = await agentCall("/next", {}, tok); return r.status === 200 ? r.json() : null; };

  await phase("nothing queued → the helper is told 204, not an empty answer with a body", async () => {
    await drain();
    const r = await agentCall("/next");
    return (r.status === 204 && (await r.text()) === "") || `it answered ${r.status} with a body — a helper polling all day pays for every byte of that`;
  });
  await phase("a made-up code is refused", async () => (await agentCall("/next", {}, "lfhp_not-a-real-code")).status === 401 || "it was answered");
  await phase("no code at all is refused", async () => (await fetch(BASE + "/api/print-agent/next")).status === 401 || "it was answered");
  await phase("an unknown request is a plain 404, not a crash", async () =>
    (await agentCall("/nonsense-verb")).status === 404 || "it did not say 404");

  await phase("a ticket claimed by one computer is not handed to the other", async () => {
    await drain(); const j = await queueOne();
    const mine = await takeUntilClaim(j.id);
    if (!mine || mine.id !== j.id) return "the first computer was not handed it";
    const theirs = await claim(other.t);
    await agentCall(`/job/${j.id}/done`, { method: "POST", body: "{}" });
    return theirs === null || "BOTH computers were handed the same ticket — the same paper would come out twice, in two rooms";
  });
  await phase("…and the other computer cannot mark it printed either", async () => {
    await drain(); const j = await queueOne();
    await takeUntilClaim(j.id);
    const r = await agentCall(`/job/${j.id}/done`, { method: "POST", body: "{}" }, other.t);
    await agentCall(`/job/${j.id}/done`, { method: "POST", body: "{}" });
    return r.status === 409 || `it answered ${r.status} — a ticket could be marked printed by a computer with no paper in it`;
  });
  await phase("…and it cannot read the paper for it either", async () => {
    await drain(); const j = await queueOne();
    await takeUntilClaim(j.id);
    const r = await agentCall(`/job/${j.id}/document`, {}, other.t);
    await agentCall(`/job/${j.id}/done`, { method: "POST", body: "{}" });
    return r.status === 409 || `it answered ${r.status}`;
  });
  await phase("a ticket that does not exist is a 404 to the helper", async () =>
    (await agentCall("/job/00000000-0000-0000-0000-0000000000ff/done", { method: "POST", body: "{}" })).status === 404 || "it was not 404");

  await phase("a failed print goes BACK in the queue, it is not thrown away", async () => {
    await drain(); const j = await queueOne();
    await takeUntilClaim(j.id);
    await agentCall(`/job/${j.id}/failed`, { method: "POST", body: JSON.stringify({ error: "sweep — pretend paper jam" }) });
    const [row] = await db(`print_jobs?id=eq.${j.id}&select=status,attempts,claimed_at`);
    return (row.status === "queued" && row.attempts === 1 && row.claimed_at === null)
      || `it is ${row.status} after ${row.attempts} attempt(s) — a jam would lose the ticket`;
  });
  await phase("…and the reason is written on it, so a person can read what went wrong", async () => {
    const [row] = await db(`print_jobs?select=error&id=eq.${made.jobs[made.jobs.length - 1]}`);
    return /paper jam/.test(String(row.error)) || "no reason was kept: " + row.error;
  });
  await phase("…and it is handed out again", async () => {
    const want = made.jobs[made.jobs.length - 1];
    const g = await takeUntilClaim(want);
    return (g && g.id === want) || "the ticket never came back";
  });
  await phase("…and the helper is told which attempt this is", async () => {
    const [row] = await db(`print_jobs?select=attempts&id=eq.${made.jobs[made.jobs.length - 1]}`);
    return row.attempts >= 1 || "the count is not kept";
  });
  await phase("five failures PARK the ticket instead of retrying it for ever", async () => {
    const id = made.jobs[made.jobs.length - 1];
    let parked = false, said = null;
    for (let i = 0; i < 8; i++) {
      // It may ALREADY be claimed — the phase before this one claimed it to prove a failed ticket
      // comes back. Claiming again would answer "nothing for you" and the loop would exit having
      // failed it exactly once, which is what the first version of this phase reported as a fault.
      const [row] = await db(`print_jobs?id=eq.${id}&select=status`);
      if (row.status !== "printing") { const g = await takeUntilClaim(id); if (!g) break; }
      const r = await agentCall(`/job/${id}/failed`, { method: "POST", body: JSON.stringify({ error: "sweep — still jammed" }) }).then((x) => x.json());
      if (r.parked) { parked = true; said = r.attempts; break; }
    }
    const [row] = await db(`print_jobs?id=eq.${id}&select=status,attempts`);
    return (parked && row.status === "failed") || `after ${row.attempts} attempts it is ${row.status} · the helper was told parked=${parked} at ${said}`;
  });
  await phase("…and a parked ticket is never handed out again (it waits for a person)", async () => {
    const g = await claim(TOKEN);
    if (g) await agentCall(`/job/${g.id}/done`, { method: "POST", body: "{}" });
    return g === null || "a ticket nobody can print was handed out again — the helper would loop on it for ever";
  });

  // A SALE CANNOT BE DELETED, and the database itself is what says so — the first run of this
  // section tried to delete an order to create the "the order is gone" case and was refused by the
  // compliance trigger with "Corrections use void". That refusal is the product being RIGHT, so it
  // is asserted here rather than worked around, and the case below is built the honest way instead:
  // a ticket that points at an order id that never existed.
  await phase("an order cannot be deleted out of the books, even by the service key", async () => {
    const o = await newOrder(94, "Not-deletable dish");
    await db(`print_jobs?id=eq.${o.jobId}`, { method: "PATCH", body: JSON.stringify({ status: "dismissed" }) }).catch(() => {});
    let refused = false, why = "";
    try { await db(`orders?id=eq.${o.order.id}`, { method: "DELETE" }); }
    catch (e) { refused = true; why = e.message; }
    const [still] = await db(`orders?id=eq.${o.order.id}&select=id`);
    return (refused && !!still)
      || `the row was deleted — a sale disappeared from the books (refused=${refused}${why ? ", " + why.slice(0, 60) : ""})`;
  });
  // A ticket cannot even POINT at an order that is not there — print_jobs.order_id is a foreign key,
  // which is the database refusing to hold a ticket for a sale that does not exist. So the case is
  // built the only way it can really happen: a kitchen ticket with no order on it at all, which is
  // what a ticket becomes when its order is cancelled (ON DELETE SET NULL, mig 341).
  await phase("a kitchen ticket with nothing left to draw is closed, not retried for ever", async () => {
    await drain();
    const j = await queueOne({ kind: "kot", order_id: null });
    const g = await takeUntilClaim(j.id);
    if (!g || g.id !== j.id) return "it was not handed over";
    const r = await agentCall(`/job/${j.id}/document`);
    const [row] = await db(`print_jobs?id=eq.${j.id}&select=status,error`);
    return (r.status === 204 && row.status === "dismissed")
      || `document ${r.status}, ticket ${row.status} — the helper would ask for this paper for ever`;
  });
  await phase("…and it says WHY on the ticket, not just 'dismissed'", async () => {
    const [row] = await db(`print_jobs?select=error&id=eq.${made.jobs[made.jobs.length - 1]}`);
    return /nothing to print/.test(String(row.error || "")) || "no reason: " + row.error;
  });

  await phase("the paper says which printer it is for, in its own header", async () => {
    await drain(); const j = await queueOne();
    const g = await takeUntilClaim(j.id);
    const r = await agentCall(`/job/${g.id}/document`);
    const hdr = r.headers.get("x-lfh-printer");
    await agentCall(`/job/${j.id}/done`, { method: "POST", body: "{}" });
    return hdr === VIRT.kitchen || `the header said "${hdr}" — the file and the printer would come from two different answers`;
  });
  await phase("…and what paper is in it", async () => {
    await api("/api/admin/printing/routes", { method: "POST", body: JSON.stringify({ rid: RID,
      routes: { test: { agent: AGENT.id, printer: VIRT.kitchen, paper: { wMm: 57.8, hMm: 64.2 } } } }) });
    await drain(); const j = await queueOne();
    const g = await takeUntilClaim(j.id);
    const r = await agentCall(`/job/${g.id}/document`);
    const hdr = r.headers.get("x-lfh-paper");
    await agentCall(`/job/${j.id}/done`, { method: "POST", body: "{}" });
    return /^57\.8x64\.2mm$/.test(String(hdr)) || `the header said "${hdr}" — the driver would rotate the ticket`;
  });
  await phase("…and the paper is never cached by anything in between", async () => {
    await drain(); const j = await queueOne();
    const g = await takeUntilClaim(j.id);
    const r = await agentCall(`/job/${g.id}/document`);
    const cc = r.headers.get("cache-control");
    await agentCall(`/job/${j.id}/done`, { method: "POST", body: "{}" });
    return /no-store/.test(String(cc)) || `cache-control is "${cc}" — yesterday's ticket could print`;
  });
  await phase("a test page names the restaurant, the computer and the printer", async () => {
    await drain(); const j = await queueOne();
    const g = await takeUntilClaim(j.id);
    const html = await agentCall(`/job/${g.id}/document`).then((r) => r.text());
    await agentCall(`/job/${j.id}/done`, { method: "POST", body: "{}" });
    return (html.includes(VIRT.kitchen) && /sweep-pc/.test(html))
      || "a test page that does not say which printer it came out of tells nobody anything";
  });

  await phase("the helper is told what it is expected to print", async () => {
    await setRoutes({ kot: { agent: AGENT.id, printer: VIRT.kitchen }, bill: { agent: otherAgent.id, printer: VIRT.counter } });
    const j = await agentCall("/hello", { method: "POST", body: JSON.stringify({ fingerprint: "sweep-fp-mine", printers: ALL_PRINTERS }) }).then((r) => r.json());
    return (j.mine || []).includes("kot") || "it was not told the kitchen tickets are its job: " + JSON.stringify(j.mine);
  });
  await phase("…and not told it is expected to print somebody else's paper", async () => {
    const j = await agentCall("/hello", { method: "POST", body: JSON.stringify({ fingerprint: "sweep-fp-mine", printers: ALL_PRINTERS }) }).then((r) => r.json());
    return !(j.mine || []).includes("bill") || "it thinks the bills are its job too";
  });
  await phase("…and it is told how often to ask, so it never invents its own rate", async () => {
    const j = await agentCall("/hello", { method: "POST", body: JSON.stringify({ fingerprint: "sweep-fp-mine", printers: ALL_PRINTERS }) }).then((r) => r.json());
    return (typeof j.pollMs === "number" && j.pollMs >= 1000) || "pollMs is " + j.pollMs;
  });
  await phase("…and whether printing is on at all", async () => {
    const j = await agentCall("/hello", { method: "POST", body: JSON.stringify({ fingerprint: "sweep-fp-mine", printers: ALL_PRINTERS }) }).then((r) => r.json());
    return typeof j.printing === "boolean" || "it was not told: " + JSON.stringify(j.printing);
  });

  await phase("two helpers asking at the very same moment never both get the ticket", async () => {
    await drain();
    const j = await queueOne();
    await setRoutes({ kot: { agent: AGENT.id, printer: VIRT.kitchen }, test: {} });
    const [a, b] = await Promise.all([agentCall("/next", {}, TOKEN), agentCall("/next", {}, other.t)]);
    const got = [a, b].filter((r) => r.status === 200).length;
    for (const r of [a, b]) if (r.status === 200) { const g = await r.json(); await agentCall(`/job/${g.id}/done`, { method: "POST", body: "{}" }, g.id === j.id ? undefined : other.t).catch(() => {}); }
    return got <= 1 || "both were handed work at once — the same ticket would print twice";
  });
  await phase("a removed computer's tickets do not vanish with it", async () => {
    await drain();
    const j = await queueOne({ agent_id: otherAgent.id, status: "queued" });
    await db(`print_agents?id=eq.${otherAgent.id}`, { method: "DELETE" });
    made.agents = made.agents.filter((x) => x !== otherAgent.id);
    const [row] = await db(`print_jobs?id=eq.${j.id}&select=id,agent_id,status`);
    return (row && row.status === "queued")
      || "removing a computer took its unprinted tickets with it — the kitchen would never learn those orders existed";
  });
}

// ══ 13 · ONE TRUTH, FOUR SCREENS ═════════════════════════════════════════════════════════════
// The pile-up behind a dead printer is shown in four places — the kitchen board, the manager's
// floor strip, the manager's print sheet and the admin's Printing screen. They are four reads of
// one number, and the moment any of them counts it a different way, two people looking at two
// screens argue about whether the printer is stuck. Every phase here queues a KNOWN number of
// tickets and asks all four what they see.
{
  await setSwitches({ auto_print_kot: true, auto_print_kot_allowed: true });
  await setRoutes({ kot: { agent: AGENT.id, printer: VIRT.kitchen } });
  await drain();

  const seen = async () => {
    const [k, pend, floor, board] = await Promise.all([
      asKitchen("/board?autojobs=1"),
      asManager("/print-jobs/pending"),
      asManager("/summary"),                    // the manager's FLOOR read carries the printer strip
      api(`/api/admin/printing/state?rid=${RID}`).then((r) => r.json()),
    ]);
    // On the admin board the pile-up is `stuck` — `waiting` there is the whole queue across all
    // three papers, which is a different question and comparing it here would be comparing two
    // honest numbers and calling the difference a bug.
    return {
      kitchen: k?.waiting?.n ?? null,
      pending: pend?.waiting?.n ?? null,
      floor: floor?.printer?.waiting?.n ?? null,
      admin: board?.stuck?.n ?? null,
      thresholds: [k?.stuckAfterMs, pend?.stuckAfterMs, floor?.printer?.stuckAfterMs, board?.stuck?.afterMs],
      oldest: { kitchen: k?.waiting?.oldestMs ?? null, admin: board?.stuck?.oldestMs ?? null },
    };
  };
  const agree = (o, want) => {
    const got = [o.kitchen, o.pending, o.floor, o.admin];
    if (got.some((v) => v === null)) return `a screen did not answer at all: kitchen=${o.kitchen} sheet=${o.pending} floor=${o.floor} admin=${o.admin}`;
    if (new Set(got).size !== 1) return `four screens, ${new Set(got).size} different answers: kitchen=${o.kitchen} sheet=${o.pending} floor=${o.floor} admin=${o.admin}`;
    return got[0] === want || `every screen says ${got[0]}, but ${want} ticket(s) are waiting`;
  };

  await phase("nothing waiting → all four screens say nothing is waiting", async () => agree(await seen(), 0));

  const held = [];
  for (const n of [1, 2, 3]) {
    const [j] = await db("print_jobs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
      restaurant_id: RID, kind: "kot", status: "queued", reprint: false, printer: VIRT.kitchen, payload: {} }) });
    made.jobs.push(j.id); held.push(j.id);
    await phase(`${n} ticket(s) behind the printer → all four screens say ${n}`, async () => agree(await seen(), n));
  }

  await phase("the threshold for 'stuck' is ONE number, not four copies", async () => {
    const o = await seen();
    const t = o.thresholds.filter((x) => typeof x === "number");
    return (t.length === 4 && new Set(t).size === 1)
      || `the screens carry ${new Set(t).size} different ideas of how long is too long: ${JSON.stringify(o.thresholds)} — two of them would call the same printer stuck and not stuck`;
  });
  await phase("…and the age of the oldest is the same on the kitchen board and the admin screen", async () => {
    const o = await seen();
    if (o.oldest.kitchen === null || o.oldest.admin === null) return "one of them does not report an age at all";
    return Math.abs(o.oldest.kitchen - o.oldest.admin) < 4000
      || `the kitchen says ${o.oldest.kitchen}ms, the admin says ${o.oldest.admin}ms`;
  });
  await phase("…and it is counted, not listed — the pile-up read never returns the rows", async () => {
    const t = read("lib/printQueue.ts");
    const fn = t.slice(t.indexOf("export async function waitingToPrint"), t.indexOf("export async function waitingToPrint") + 1400);
    return (/head:\s*true|count:\s*"exact"/.test(fn) && !/select\("\*"\)/.test(fn))
      || "the count is fetched as rows — a hundred tickets behind a dead printer would be a hundred rows down every screen's poll, every few seconds";
  });

  await phase("the tickets print → all four screens go quiet again", async () => {
    for (const id of held) {
      await db(`print_jobs?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "done", done_at: new Date().toISOString() }) });
    }
    return agree(await seen(), 0);
  });

  await phase("printing switched off by the admin → the kitchen board is told, in the same read", async () => {
    await setSwitches({ auto_print_kot_allowed: false });
    const k = await asKitchen("/board?autojobs=1");
    await setSwitches({ auto_print_kot_allowed: true });
    return k.autoPrintKot === false || "the kitchen screen still believes it may print";
  });
  await phase("…and the manager's sheet is told too, in the same breath", async () => {
    await setSwitches({ auto_print_kot_allowed: false });
    const d = await asManager("/print-jobs/pending");
    await setSwitches({ auto_print_kot_allowed: true });
    return d.off === true || "the manager's sheet still believes it may print";
  });

  for (const m of ["computer", "screen"]) {
    await phase(`the mode the admin chose ("${m}") is the mode the manager's board shows`, async () => {
      await api("/api/admin/printing/mode", { method: "POST", body: JSON.stringify({ rid: RID, mode: m }) });
      const [adm, mgrBoard] = await Promise.all([
        api(`/api/admin/printing/state?rid=${RID}`).then((r) => r.json()),
        asManager("/printing/state"),
      ]);
      return (adm.mode === m && mgrBoard.mode === m)
        || `the admin screen says "${adm.mode}" and the manager's says "${mgrBoard.mode}" — one of the two people is setting up the wrong thing`;
    });
  }
  await phase("the printer the admin picked is the printer the manager's board names", async () => {
    await api("/api/admin/printing/mode", { method: "POST", body: JSON.stringify({ rid: RID, mode: "computer" }) });
    await api("/api/admin/printing/routes", { method: "POST", body: JSON.stringify({ rid: RID,
      routes: { kot: { agent: AGENT.id, printer: VIRT.banquet } } }) });
    const mgrBoard = await asManager("/printing/state");
    return mgrBoard?.routes?.kot?.printer === VIRT.banquet
      || `the manager's board names "${mgrBoard?.routes?.kot?.printer}" while the admin picked "${VIRT.banquet}"`;
  });
  await phase("…and both screens list the same computers", async () => {
    const [adm, mgrBoard] = await Promise.all([
      api(`/api/admin/printing/state?rid=${RID}`).then((r) => r.json()),
      asManager("/printing/state"),
    ]);
    const a = (adm.agents || []).map((x) => x.id).sort().join(",");
    const b = (mgrBoard.agents || []).map((x) => x.id).sort().join(",");
    return a === b || `the admin sees ${(adm.agents || []).length} computer(s), the manager sees ${(mgrBoard.agents || []).length}`;
  });
  await phase("a printer complaint raised in the kitchen reaches the manager's floor strip", async () => {
    const [e] = await db("printer_events", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
      restaurant_id: RID, kind: "paper_out", note: "sweep — cross-panel", reported_by: "sweep", printer: VIRT.kitchen }) });
    made.events.push(e.id);
    await new Promise((r) => setTimeout(r, 1700));   // the floor read is shared for 1.5s on purpose
    const floor = await asManager("/summary");
    const list = floor?.printer?.events || [];
    await db(`printer_events?id=eq.${e.id}`, { method: "PATCH", body: JSON.stringify({ status: "resolved", resolved_at: new Date().toISOString() }) });
    return list.some((x) => x.id === e.id)
      || "a cook reported a jammed printer and the manager's floor never heard about it";
  });
}

// ── WHAT COUNTS AS A FAULT ON A SCREEN, measured in the page itself ──────────────────────────
// Shared by BOTH boards (§14 the admin console, §15 the manager panel) on purpose: they are two
// separate implementations of one screen, and the only way to know a fault fixed on one is fixed on
// the other is to measure them with the very same ruler.
  // WHAT COUNTS AS A FAULT, measured in the page itself.
// `contrastSel` narrows WHICH text the colour check judges. The admin console's Printing page is a
// screen this feature owns outright, so it judges everything on it. The manager panel is not: the
// printing board is a few cards inside somebody else's screen, drawn with the panel's shared
// headings, muted text and buttons. Repainting those under cover of a printing fix would change
// every screen in that panel, so the check judges the board's OWN classes and the shared palette is
// reported to the owner as a decision instead of quietly restyled.
const auditFor = (rootSel, contrastSel = "*") => `(() => {
    // ASK THE BROWSER, do not infer. A closed <details> hides its contents with
    // \`content-visibility: hidden\` on ::details-content — the subtree is not painted, but
    // getBoundingClientRect() still hands back a stale box for everything inside it. Measuring those
    // boxes, this audit reported two pairs of controls "sitting on top of each other" at 390px on
    // 2026-08-29 and I very nearly restyled a screen that was correct: at that exact point
    // elementFromPoint returns NOTHING, and checkVisibility() returns false. Same family as the two
    // traps already in this project's notes — offsetParent lying about fixed elements, and a
    // hit-test lying on a sideways-scrolling row.
    const vis = (el) => {
      if (typeof el.checkVisibility === "function"
          && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return false;
      const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0.05;
    };
    const sel = (el) => { let s = el.tagName.toLowerCase();
      if (el.id) return s + "#" + el.id;
      if (el.className && typeof el.className === "string") s += "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".");
      return s + (el.textContent ? ' "' + el.textContent.trim().slice(0, 22) + '"' : ""); };
    // MEASURE THE SCREEN THIS CAMPAIGN IS ABOUT. The admin console's own shell — the sidebar, its
    // small-caps group labels, the footer — surrounds all 23 admin pages; failing the printing
    // campaign on it would be restyling the whole console under cover of a printing fix, and its
    // 11px group labels are a deliberate pattern, not a fault of this screen.
    const root = document.querySelector(${JSON.stringify(rootSel)}) || document.body;
    const all = [...root.querySelectorAll("*")].filter(vis);
    // A LINK INSIDE A SENTENCE IS TEXT, not a control. The 44px floor is about standalone targets;
    // applying it to a word in a paragraph would demand every inline link in the app grow a box, and
    // it flagged "The restaurant's own guide →" sitting mid-sentence in the header (2026-08-29).
    // A link is only judged as a target when it stands on its own — its parent has no other words.
    const inProse = (el) => {
      if (el.tagName !== "A") return false;
      if (!/^inline/.test(getComputedStyle(el).display)) return false;
      const p = el.parentElement; if (!p) return false;
      return (p.textContent || "").trim().length > (el.textContent || "").trim().length + 3;
    };
    const tappable = all.filter((el) => (/^(button|a|select|input|textarea)$/i.test(el.tagName) || el.getAttribute("role") === "button") && !inProse(el));

    // 1 · two things a person can press, sitting on top of each other
    const overlaps = [];
    for (let i = 0; i < tappable.length; i++) for (let j = i + 1; j < tappable.length; j++) {
      const a = tappable[i], b = tappable[j];
      if (a.contains(b) || b.contains(a)) continue;
      const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
      const w = Math.min(x.right, y.right) - Math.max(x.left, y.left);
      const h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
      if (w > 2 && h > 2) overlaps.push(sel(a) + "  ×  " + sel(b));
    }
    // 2 · a word wider than the box drawn around it — the "pill crossing the label" fault
    const clipped = all.filter((el) => {
      if (!el.textContent || !el.textContent.trim()) return false;
      if (el.children.length) return false;
      const st = getComputedStyle(el);
      if (st.overflow === "visible" && st.textOverflow !== "ellipsis") return false;
      if (/scroll|auto/.test(st.overflowX)) return false;
      return el.scrollWidth > el.clientWidth + 2;
    }).map(sel);
    // 3 · targets a FINGER cannot hit. 44px is Apple's floor and 48dp is Material's; 34 is the
    // kindest reading of either. Applied at phone width only, on purpose: the floor exists because a
    // fingertip is about 9mm across, and a mouse pointer is one pixel. Judging a desktop screen by it
    // failed four admin-bar buttons that are 30px tall and perfectly clickable with a mouse.
    const touch = window.innerWidth <= 640;
    const small = !touch ? [] : tappable.filter((el) => { const r = el.getBoundingClientRect();
      if (el.type === "checkbox" || el.type === "radio") return false;
      return r.height < 34 || r.width < 24; }).map((el) => sel(el) + " " + Math.round(el.getBoundingClientRect().width) + "×" + Math.round(el.getBoundingClientRect().height));
    // 4 · text you cannot read against what is behind it
    // COLOURS COME BACK IN TWO SPELLINGS. Tailwind 4 emits color-mix results as
    // \`color(srgb 0.88 0.91 0.99)\` — channels 0–1, not 0–255. The first version of this audit
    // divided those by 255 as well, read a pale blue card as near-black, and reported the mode
    // toggle's text as 1.18:1 — invisible — when it is about 14:1. Measure the measurer first.
    const lum = (c) => {
      if (!c) return null;
      const isUnit = /^color\\(/i.test(c);
      const m = c.match(/[\\d.]+/g);
      if (!m) return null;
      const nums = isUnit ? m.slice(-4) : m;                 // color(srgb r g b [/ a]) — drop the name
      if (nums.length > 3 && Number(nums[3]) < 0.95) return null;   // see-through: skip
      const f = nums.slice(0, 3).map((v) => { const x = isUnit ? Number(v) : Number(v) / 255;
        return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    };
    // A GRADIENT IS NOT A COLOUR, and pretending otherwise invents faults. The panel's primary
    // buttons are filled with \`linear-gradient(#e8b884, #d4a574)\`, so their backgroundColor is
    // transparent; walking past it to the card behind reported the label at 1.15:1 — invisible —
    // when it actually measures 8.85:1 against the gold it sits on (2026-08-29). When the nearest
    // painted surface is a gradient this returns null and the element is COUNTED as unmeasurable
    // rather than judged. Second time this audit has invented a colour fault; both times the answer
    // was to stop inferring.
    const bgOf = (el) => { let n = el; while (n && n !== document.documentElement) {
        const st = getComputedStyle(n);
        if (st.backgroundImage && st.backgroundImage !== "none") return null;   // gradient or picture
        const l = lum(st.backgroundColor); if (l !== null) return l;
        n = n.parentElement; }
      return lum(getComputedStyle(document.body).backgroundColor) ?? 1; };
    const faint = [], unmeasured = [];
    const judged = new Set([...root.querySelectorAll(${JSON.stringify(contrastSel)})]);
    for (const el of all) {
      if (!judged.has(el)) continue;
      if (el.children.length || !el.textContent || !el.textContent.trim()) continue;
      const st = getComputedStyle(el);
      const fs = parseFloat(st.fontSize), fw = Number(st.fontWeight) || 400;
      const fg = lum(st.color); if (fg === null) continue;
      const bg = bgOf(el);
      if (bg === null) { unmeasured.push(sel(el)); continue; }   // sits on a gradient — say so, do not guess
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      const big = fs >= 24 || (fs >= 18.66 && fw >= 700);
      if (ratio < (big ? 3 : 4.5)) faint.push(sel(el) + " " + ratio.toFixed(2) + ":1 @" + Math.round(fs) + "px");
    }
    // 5 · type too small to read on a phone
    // A separator is not read, it is looked past. The rule is "no type too small to READ", so an
    // element whose whole text is one piece of punctuation (the breadcrumb's "\u203a") is not type.
    const tiny = all.filter((el) => {
      if (el.children.length) return false;
      const t = (el.textContent || "").trim();
      if (!t || !/[\\p{L}\\p{N}]/u.test(t)) return false;
      return parseFloat(getComputedStyle(el).fontSize) < 11.5;
    }).map((el) => sel(el) + " @" + getComputedStyle(el).fontSize);
    // 6 · sideways scroll
    const sideways = document.documentElement.scrollWidth > window.innerWidth + 2;
    const widest = all.filter((el) => el.getBoundingClientRect().right > window.innerWidth + 2).map(sel);
    return { overlaps: overlaps.slice(0, 6), clipped: clipped.slice(0, 6), small: small.slice(0, 6),
             faint: faint.slice(0, 6), unmeasured: unmeasured.slice(0, 6), tiny: tiny.slice(0, 6),
             sideways, widest: widest.slice(0, 4), controls: tappable.length };
})()`;

// ══ 14 · THE BOARDS ON SCREEN — measured, in both skins, at both widths ══════════════════════
// The owner's words on 2026-08-26: "Check the UI also. Is it user friendly?" — and the bug he
// reported the week before was a coloured pill CROSSING the word next to it, in one skin only.
// So none of this is an opinion about taste. Every phase below opens the real screen and MEASURES
// it: boxes that overlap, text that is cut off, targets too small for a finger, text too close in
// colour to what is behind it, and a screen that scrolls sideways on a phone. A fault here is a
// number with a selector next to it.
if (!browser) {
  for (const t of ["the two boards open at all", "…nothing overlaps", "…nothing is cut off", "…every target is finger-sized", "…every word is readable against what is behind it", "…it does not scroll sideways on a phone"]) await phase(t, () => "skip");
} else {

  const ctx = await browser.newContext();
  await ctx.addCookies([
    { name: "lfh_staff_auth", value: adminCookie.split("=")[1], domain: "localhost", path: "/" },
  ]);
  const openAdmin = async (skin, width) => {
    const page = await ctx.newPage();
    await page.setViewportSize({ width, height: 900 });
    await ctx.addCookies([{ name: "aevidine_skin", value: skin, domain: "localhost", path: "/" }]);
    await page.goto(`${BASE}/aevinite/printing?rid=${RID}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    return page;
  };

  for (const skin of ["dark", "light"]) {
    for (const [wLabel, width] of [["a desktop", 1440], ["a phone", 390]]) {
      let page = null, a = null;
      await phase(`the admin Printing screen opens in ${skin} on ${wLabel}`, async () => {
        page = await openAdmin(skin, width);
        a = await page.evaluate(auditFor("main.adm-main"));
        return a.controls > 0 || "the screen rendered nothing a person can press";
      });
      await phase(`  …nothing a person can press overlaps anything else (${skin}, ${wLabel})`, () =>
        !a ? "the screen never opened" : a.overlaps.length === 0
          || `${a.overlaps.length} pair(s) sit on top of each other — the fault he reported on Access: ${a.overlaps.join(" · ")}`);
      await phase(`  …no word is cut off by its own box (${skin}, ${wLabel})`, () =>
        !a ? "the screen never opened" : a.clipped.length === 0 || `cut off: ${a.clipped.join(" · ")}`);
      await phase(`  …every target is big enough for a finger (${skin}, ${wLabel})`, () =>
        !a ? "the screen never opened" : a.small.length === 0 || `too small: ${a.small.join(" · ")}`);
      await phase(`  …every word is readable against what is behind it (${skin}, ${wLabel})`, () =>
        !a ? "the screen never opened" : a.faint.length === 0
          || `${a.faint.length} too close in colour — this is exactly the "not coming in the light mode" fault: ${a.faint.join(" · ")}`);
      await phase(`  …no type is too small to read (${skin}, ${wLabel})`, () =>
        !a ? "the screen never opened" : a.tiny.length === 0 || `under 12px: ${a.tiny.join(" · ")}`);
      await phase(`  …the screen does not scroll sideways (${skin}, ${wLabel})`, () =>
        !a ? "the screen never opened" : a.sideways === false || `it scrolls sideways — past the edge: ${a.widest.join(" · ")}`);
      if (page) await page.close();
    }
  }

  // THE TOGGLE'S WHOLE POINT: you see the setup for the mode you chose, and NOT the other one.
  // The owner asked for it in those words — "only option which is selected setting for that option
  // will be shown" — so it is measured on the rendered screen, not in the source.
  const modeCounts = {};
  for (const m of ["computer", "screen"]) {
    await phase(`choosing "${m}" shows that setup and hides the other one`, async () => {
      await api("/api/admin/printing/mode", { method: "POST", body: JSON.stringify({ rid: RID, mode: m }) });
      const page = await openAdmin("dark", 1440);
      const seen = await page.evaluate(`(() => {
        const root = document.querySelector("main.adm-main") || document.body;
        const vis = (el) => (typeof el.checkVisibility !== "function"
          || el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }))
          && el.getBoundingClientRect().width > 0;
        return { text: root.innerText,
          controls: [...root.querySelectorAll("button, select, input, a")].filter(vis).length };
      })()`);
      modeCounts[m] = seen.controls;
      await page.close();
      const wantsHelper = /helper|computer that prints|\.command|\.bat/i.test(seen.text);
      const wantsStation = /print station|minimi|Chrome/i.test(seen.text);
      return m === "computer"
        ? (wantsHelper || "the computer setup is not on the screen after choosing it")
        : (wantsStation || "the screen setup is not on the screen after choosing it");
    });
  }
  await phase("…and choosing one mode is genuinely LESS to read, not the same screen twice", () =>
    (modeCounts.computer && modeCounts.screen)
      ? (modeCounts.computer !== modeCounts.screen
         || `both modes show ${modeCounts.computer} controls — the toggle hides nothing, which is the complaint he made about the old screen`)
      : "the counts were never taken");
  await phase("…and neither mode is a wall of controls (he called the old one 'too much complicated')", () => {
    const worst = Math.max(modeCounts.computer || 0, modeCounts.screen || 0);
    return worst <= 40 || `the busier mode puts ${worst} controls on one screen`;
  });

  await ctx.close();
}

// ══ 15 · THE MANAGER'S OWN BOARD, ON SCREEN ══════════════════════════════════════════════════
// "the UI/UX is also not identical" (owner, 2026-08-26). The restaurant's own person sets their
// printer up on the manager panel, not in the admin console, and that board is a completely separate
// implementation — hand-built HTML in public/panels/editor/app.js against a different stylesheet and
// a different theme key (lfh_panel_theme, default LIGHT, remembered per staff member). So it gets the
// same measurements, in its own skins: a fault fixed on one board is not fixed on the other.
if (!browser) {
  for (const t of ["the manager's Printing board opens", "…nothing overlaps", "…nothing is cut off", "…every target is finger-sized", "…every word is readable", "…it does not scroll sideways"]) await phase(t, () => "skip: no browser");
} else {
  // The Printing section only exists in Settings when the ADMIN has allowed printing for this
  // restaurant (`auto_print_kot_allowed`) — that is deliberate, and it is checked as its own phase
  // further down. Here it just has to be ON, or every measurement below would be of an empty screen.
  await setSwitches({ auto_print_kot: true, auto_print_kot_allowed: true });
  const openPanel = async (theme, width) => {
    const c = await browser.newContext();
    await c.addCookies(MANAGER_COOKIE.split("; ").filter(Boolean).map((kv) => {
      const i = kv.indexOf("=");
      return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: "localhost", path: "/" };
    }).concat([{ name: "lfh_panel_device", value: DEVICE, domain: "localhost", path: "/" }]));
    await c.addInitScript(`try { localStorage.setItem("lfh_panel_theme", ${JSON.stringify(theme)}); } catch (e) {}`);
    const pg = await c.newPage();
    await pg.setViewportSize({ width, height: 900 });
    await pg.goto(`${BASE}/panels/editor/index.html`, { waitUntil: "networkidle" });
    await pg.waitForTimeout(1800);
    // CLICK IT THE WAY A PERSON DOES — ⚙️ Settings, then Printing. Reaching in and setting
    // `state.settingsSection` looked like it worked (renderEditor ran, no error) and drew the menu's
    // empty state instead, because the left list is what actually moves the section. Driving the
    // real controls also proves the road there exists, which is half of what this section is for.
    const reached = await pg.evaluate(`(() => {
      const tab = [...document.querySelectorAll(".tab")].find((t) => (t.dataset.tab || "") === "general");
      if (!tab) return "there is no Settings tab on this panel";
      tab.click();
      return "ok";
    })()`);
    if (reached !== "ok") return { c, pg, reached };
    await pg.waitForTimeout(900);
    const opened = await pg.evaluate(`(() => {
      const li = document.querySelector('li[data-settings-section="printing"]');
      if (!li) return "Settings has no Printing section — the restaurant's printing is switched off, or this person may not set it up";
      li.click();
      return "ok";
    })()`);
    await pg.waitForTimeout(1500);
    return { c, pg, reached: opened };
  };

  for (const theme of ["light", "dark"]) {
    for (const [wLabel, width] of [["a desktop", 1440], ["a phone", 390]]) {
      let ses = null, a = null;
      await phase(`the manager's Printing board opens in ${theme} on ${wLabel}`, async () => {
        ses = await openPanel(theme, width);
        if (ses.reached !== "ok") return ses.reached;
        a = await ses.pg.evaluate(auditFor("#editor", '[class*="pw-"]'));
        return a.controls > 0 || "the board rendered nothing a person can press";
      });
      await phase(`  …nothing a person can press overlaps anything else (manager, ${theme}, ${wLabel})`, () =>
        !a ? "the board never opened" : a.overlaps.length === 0 || `${a.overlaps.length} pair(s): ${a.overlaps.join(" · ")}`);
      await phase(`  …no word is cut off by its own box (manager, ${theme}, ${wLabel})`, () =>
        !a ? "the board never opened" : a.clipped.length === 0 || `cut off: ${a.clipped.join(" · ")}`);
      await phase(`  …every target is big enough for a finger (manager, ${theme}, ${wLabel})`, () =>
        !a ? "the board never opened" : a.small.length === 0 || `too small: ${a.small.join(" · ")}`);
      await phase(`  …every word the Printing board itself styles is readable (manager, ${theme}, ${wLabel})`, () =>
        !a ? "the board never opened" : a.faint.length === 0 || `${a.faint.length} too close in colour: ${a.faint.join(" · ")}`);
      await phase(`  …no type is too small to read (manager, ${theme}, ${wLabel})`, () =>
        !a ? "the board never opened" : a.tiny.length === 0 || `under 12px: ${a.tiny.join(" · ")}`);
      await phase(`  …the board does not scroll sideways (manager, ${theme}, ${wLabel})`, () =>
        !a ? "the board never opened" : a.sideways === false || `it scrolls sideways — past the edge: ${a.widest.join(" · ")}`);
      if (ses) await ses.c.close();
    }
  }

  // THE SAME TOGGLE, THE SAME WORDS. The two boards are separate code; the way they drift apart is
  // one of them being taught something the other is not.
  for (const m of ["computer", "screen"]) {
    await phase(`the manager's board shows the "${m}" setup when that mode is chosen`, async () => {
      await api("/api/admin/printing/mode", { method: "POST", body: JSON.stringify({ rid: RID, mode: m }) });
      const ses = await openPanel("light", 1440);
      if (ses.reached !== "ok") { await ses.c.close(); return ses.reached; }
      const text = await ses.pg.evaluate(`(document.querySelector("#editor") || document.body).innerText`);
      await ses.c.close();
      return m === "computer"
        ? (/helper|computer that prints|\.command|\.bat/i.test(text) || "the computer setup is not on the manager's board")
        : (/print station|minimi|Chrome/i.test(text) || "the screen setup is not on the manager's board");
    });
  }
}

// ══ 16 · THE OTHER TWO PAPERS — bills and banquet sheets, end to end ═════════════════════════
// Everything above this is mostly about kitchen slips, because that is the paper with a person
// standing over it. But a restaurant routes THREE, and the other two travel a different road: the
// panel asks /print/send, and a "no computer owns this" answer is not a failure — it is the fallback
// that keeps every restaurant without a helper working exactly as it always did.
//
// The asymmetry below is deliberate and is written on the board itself (lib/printBoardWords):
//   kitchen slips → "Nobody — do not print kitchen slips"
//   bill, banquet → "Whoever presses Print (a window opens)"
// So "off" means genuinely nobody for a KOT, and means "the screen does it" for the other two.
// These phases exist so nobody later "fixes" that into consistency and silently stops a restaurant
// being able to print a bill.
{
  const send = (kind, extra) => fetch(BASE + "/api/editor/print/send", {
    method: "POST", headers: { "content-type": "application/json", cookie: MANAGER_COOKIE + "; lfh_panel_device=" + DEVICE },
    body: JSON.stringify({ kind, ...(extra || {}) }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  const jobsFor = (kind) => db(`print_jobs?restaurant_id=eq.${RID}&kind=eq.${kind}&select=id,printer,agent_id,payload,status&order=created_at.desc&limit=1`);

  const CASES = [
    { kind: "bill", id: () => ({ sessionId: SESSION.id }), what: "a bill" },
    { kind: "banquet", id: () => ({ billId: BQ_BILL_ID }), what: "a banquet sheet" },
  ];

  for (const c of CASES) {
    await phase(`${c.what}: nothing routed → the window opens, which is what every restaurant without a helper does`, async () => {
      if (c.kind === "banquet" && !BQ_BILL_ID) return "skip: no banquet bill on this restaurant to print";
      await setRoutes({ [c.kind]: {} });
      const r = await send(c.kind, c.id());
      return r.body.noRoute === true || `it answered ${JSON.stringify(r.body).slice(0, 120)}`;
    });
    await phase(`${c.what}: set to "Whoever presses Print" → the window still opens (that IS the setting)`, async () => {
      if (c.kind === "banquet" && !BQ_BILL_ID) return "skip: no banquet bill on this restaurant to print";
      await setRoutes({ [c.kind]: { via: "off" } });
      const r = await send(c.kind, c.id());
      return r.body.noRoute === true
        || `it answered ${JSON.stringify(r.body).slice(0, 120)} — the board promises a window here, and a restaurant that could not print a bill would be stuck`;
    });
    await phase(`${c.what}: a computer owns it → it goes in the basket instead`, async () => {
      if (c.kind === "banquet" && !BQ_BILL_ID) return "skip: no banquet bill on this restaurant to print";
      await drain();
      await setRoutes({ [c.kind]: { agent: AGENT.id, printer: VIRT.counter } });
      const r = await send(c.kind, c.id());
      if (r.body.noRoute) return "it still told the screen to open a window while a computer owns this paper — two printers, one bill";
      const [j] = await jobsFor(c.kind);
      return (j && j.agent_id === AGENT.id) || `no ticket was queued for that computer: ${JSON.stringify(j || null).slice(0, 120)}`;
    });
    await phase(`${c.what}: …and the ticket carries the printer the admin chose`, async () => {
      if (c.kind === "banquet" && !BQ_BILL_ID) return "skip: no banquet bill on this restaurant to print";
      const [j] = await jobsFor(c.kind);
      return (j && j.printer === VIRT.counter) || `the ticket says "${j && j.printer}"`;
    });
    await phase(`${c.what}: …and it carries the id the paper is built from, not the paper itself`, async () => {
      if (c.kind === "banquet" && !BQ_BILL_ID) return "skip: no banquet bill on this restaurant to print";
      const [j] = await jobsFor(c.kind);
      const p = j?.payload || {};
      return (c.kind === "bill" ? !!p.sessionId : !!p.billId)
        || `the ticket carries ${JSON.stringify(p).slice(0, 90)} — a document frozen at queue time would print yesterday's numbers`;
    });
    await phase(`${c.what}: …and the helper can actually FETCH that paper`, async () => {
      if (c.kind === "banquet" && !BQ_BILL_ID) return "skip: no banquet bill on this restaurant to print";
      const [j] = await jobsFor(c.kind);
      if (!j) return "there was no ticket to fetch";
      const g = await takeUntilClaim(j.id);
      if (!g) return "the helper was never handed it";
      const res = await agentCall(`/job/${j.id}/document`);
      const html = res.status === 200 ? await res.text() : "";
      await agentCall(`/job/${j.id}/done`, { method: "POST", body: "{}" });
      return (res.status === 200 && html.length > 200)
        || `the helper asked for the paper and got ${res.status} — this is exactly how the banquet sheet was silently dropped before 2026-08-29`;
    });
    await phase(`${c.what}: …and a screen route sends it back to the window (a screen is not a helper)`, async () => {
      if (c.kind === "banquet" && !BQ_BILL_ID) return "skip: no banquet bill on this restaurant to print";
      await setRoutes({ [c.kind]: { via: "screen", panel: "manager" } });
      const r = await send(c.kind, c.id());
      return r.body.noRoute === true || `it answered ${JSON.stringify(r.body).slice(0, 120)}`;
    });
    await phase(`${c.what}: …and a removed computer hands the paper back to the screen`, async () => {
      if (c.kind === "banquet" && !BQ_BILL_ID) return "skip: no banquet bill on this restaurant to print";
      await setRoutes({ [c.kind]: { agent: "00000000-0000-0000-0000-0000000000bb", printer: VIRT.counter } });
      const r = await send(c.kind, c.id());
      return r.body.noRoute === true
        || "a computer that no longer exists still owns this paper — nothing would ever print and no window would open";
    });
  }

  await phase("only a bill or a banquet sheet can be sent this way", async () => {
    const r = await send("kot", {});
    return r.status === 400 || `a kitchen slip was accepted through the bill door (${r.status})`;
  });
  await phase("…and a made-up kind is refused too", async () => {
    const r = await send("payslip", {});
    return r.status === 400 || `it answered ${r.status}`;
  });

  // THE ADMIN LOOKING IS NOT THE RESTAURANT PRINTING (owner, 2026-08-20).
  await phase("the ADMIN opening a restaurant's panel does not make paper come out at their counter", async () => {
    await setRoutes({ bill: { agent: AGENT.id, printer: VIRT.counter } });
    await drain();
    const before = (await jobsFor("bill"))[0]?.id || null;
    const r = await fetch(BASE + `/api/editor/print/send?rid=${RID}`, {
      method: "POST", headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ kind: "bill", sessionId: SESSION.id }),
    }).then(async (x) => ({ status: x.status, body: await x.json().catch(() => ({})) }));
    const after = (await jobsFor("bill"))[0]?.id || null;
    return (r.body.adminView === true && after === before)
      || `it answered ${JSON.stringify(r.body).slice(0, 120)} and the basket ${after === before ? "did not change" : "GAINED a ticket"}`;
  });
  await phase("…and it says which printer it WOULD have used, so we can tell them", async () => {
    const r = await fetch(BASE + `/api/editor/print/send?rid=${RID}`, {
      method: "POST", headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ kind: "bill", sessionId: SESSION.id }),
    }).then((x) => x.json());
    return (r.printer === VIRT.counter) || `it named "${r.printer}"`;
  });
  await phase("…and `force` is the deliberate way to help them, and it DOES print", async () => {
    await drain();
    const before = (await jobsFor("bill"))[0]?.id || null;
    await fetch(BASE + `/api/editor/print/send?rid=${RID}`, {
      method: "POST", headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ kind: "bill", sessionId: SESSION.id, force: true }),
    });
    const after = (await jobsFor("bill"))[0]?.id || null;
    return (after && after !== before) || "force did nothing — there would be no way to help a restaurant whose printer we can see is idle";
  });
}

// ══ 17 · THE THINGS HE ASKED FOR, PINNED ═════════════════════════════════════════════════════
// Every phase here exists because of one sentence he said on 2026-08-29, and each one names it. A
// requirement with no test is a requirement that comes back a month later as a bug report.
{
  const admPage = read("app/aevinite/printing/page.tsx");
  const panel = read("public/panels/editor/app.js");
  const helpers = read("lib/printHelpers.ts");
  const station = read("lib/printStationScript.ts");
  // JUDGE THE CODE, NOT THE NOTE EXPLAINING IT. Three of these phases failed on their first run
  // against the very comments that say why the bad thing is absent — "`--kiosk` is deliberately
  // absent", "hiding by NAME would hide the restaurant's own Chrome". This project has the mirror
  // of that already written down (verify:rejected once passed by matching a note's anchor inside
  // the note); a guard that reads prose is measuring the wrong thing in either direction.
  const strip = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, " ")            // /* block comments */
    .split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "").replace(/^\s*#(?!!).*$/, "")).join("\n");
  const stationCode = strip(station);

  // ── "whenever you switch, there is no UI for confirmation or stuff like that" ───────────────
  await phase("the mode switch asks IN THE PAGE, on the admin board", () =>
    /adm-confirm/.test(admPage) || "the admin board has no in-page confirmation strip");
  await phase("…and on the manager panel", () =>
    /pw-confirm/.test(panel) || "the manager panel has no in-page confirmation strip");
  await phase("…and neither of them uses a browser confirm() to do it", () => {
    const a = /confirm\(`Switch this restaurant/.test(admPage);
    const b = /confirm\("Switch this restaurant/.test(panel);
    return (!a && !b) || `a grey browser box is back (admin=${a} panel=${b}) — it has no room to say what the switch costs`;
  });
  await phase("…and the confirmation says what the switch will COST, not just 'are you sure'", () =>
    (/are cleared/.test(admPage) && /stays that way/.test(admPage))
    || "the strip does not say what is cleared and what survives");

  // ── "in the middle of thing, you tell me to go to the access and permission… remove it" ─────
  await phase("the Printing menu never sends anybody to Access & permissions", () =>
    !/aevinite\/access/.test(admPage) || "the Printing screen links to Access again — that is the interruption he asked to be rid of");
  await phase("…and Access no longer embeds the printing board inside itself", () =>
    !/panel: "printing"/.test(read("lib/accessTree.ts")) || "the whole Printing menu is embedded in an Access row again: one setup, two places");

  // ── "the person will be only choose for KOT… other user will work as they work" ─────────────
  await phase("a screen can own the KITCHEN TICKETS and nothing else", () => {
    const w = helpers.slice(helpers.indexOf("export async function writeMode"));
    return /if \(k !== "kot"\)/.test(w)
      || "writeMode no longer singles the kitchen slip out — bills and banquet sheets are being dragged onto one person's screen again";
  });
  await phase("…and the panel a screen route names FOLLOWS the person's role", () =>
    /export function panelForRole/.test(helpers) && /panelForRole\(u\.role\)/.test(helpers)
    || "the panel is being decided separately from the person again — hard-coding it to \"manager\" is what left the picker with no kitchen option");
  await phase("…so a cook, a waiter and a manager all map to a real screen", () => {
    const f = helpers.slice(helpers.indexOf("export function panelForRole"), helpers.indexOf("export function panelForRole") + 400);
    return (/kitchen/.test(f) && /tablet/.test(f) && /manager/.test(f)) || "panelForRole does not cover every role that has a screen";
  });

  // ── "there is not kitchen panel available" ──────────────────────────────────────────────────
  await phase("the picker offers people from EVERY screen, kitchen included", async () => {
    const d = await api(`/api/admin/printing/state?rid=${RID}`).then((r) => r.json());
    const panels = new Set((d.people || []).flatMap((x) => x.panels || []));
    return (panels.has("kitchen") && panels.has("manager"))
      || `the picker only knows about ${[...panels].join(", ") || "nobody"}`;
  });
  await phase("…and it is grouped by the screen a person stands at, not left as one long list", () =>
    /PANEL_GROUPS/.test(admPage) && /Kitchen screen/.test(admPage)
    || "the people are one flat list again — a cook is findable only by knowing their name");

  // ── "I'm seeing so much buttons and it is getting very complicated" ─────────────────────────
  await phase("a paper line is ONE control, not five", () => {
    const hasOne = /pickPrinter/.test(admPage) && /printerValue/.test(admPage);
    const noOld = !/onClick=\{\(\) => void saveRoute\(kind\)\}/.test(admPage);
    return (hasOne && noOld) || `one dropdown=${hasOne}, the old On/Nobody/computer/printer/Save row gone=${noOld}`;
  });
  await phase("…and it saves on change, with no Save button beside it", () =>
    !/>Save<\/button>/.test(admPage) || "a Save button is back next to a dropdown — that is two controls pretending to be one");
  await phase("…and screen mode has no three-paper card at all, because there is nothing to answer", () =>
    /step3 = mode !== "computer" \? ""/.test(panel)
    || "the manager panel still draws three paper lines in screen mode — three controls that change nothing");

  // ── "the printer option is there but greyed out, and when you hover it, it tells you" ───────
  await phase("with no computer set up, the printer dropdown is DISABLED", () =>
    /disabled=\{busy === "routes" \|\| agents\.length === 0\}/.test(admPage)
    || "the dropdown stays live with nothing to choose from");
  await phase("…and it SAYS why, on hover and to a screen reader", () =>
    /title=\{agents\.length === 0 \? "Set a computer up in step 3 first/.test(admPage) && /aria-describedby/.test(admPage)
    || "it is greyed out with no explanation — which is worse than not being there");
  await phase("…and the manager panel does the same", () =>
    /Set this computer up above first/.test(panel) || "the panel's dropdown greys out silently");

  // ── "no two cards called 4" ─────────────────────────────────────────────────────────────────
  // ON THE SCREEN, not in the source: the two mode branches both contain a card 3, and only one of
  // them is ever drawn. Reading the file counted both and reported a clash that no person can see.
  for (const m of ["computer", "screen"]) {
    await phase(`no two cards carry the same number, in ${m} mode`, async () => {
      if (!browser) return "skip: no browser to look at the rendered screen";
      await api("/api/admin/printing/mode", { method: "POST", body: JSON.stringify({ rid: RID, mode: m }) });
      const ctx2 = await browser.newContext();
      await ctx2.addCookies([{ name: "lfh_staff_auth", value: adminCookie.split("=")[1], domain: "localhost", path: "/" }]);
      const pg2 = await ctx2.newPage();
      await pg2.goto(`${BASE}/aevinite/printing?rid=${RID}`, { waitUntil: "networkidle" });
      await pg2.waitForTimeout(700);
      const nums = await pg2.evaluate(`[...document.querySelectorAll("main.adm-main h2")].map(h=>(h.textContent.trim().match(/^(\\d+) ·/)||[])[1]).filter(Boolean)`);
      await ctx2.close();
      return new Set(nums).size === nums.length || `${m} mode numbers its cards ${nums.join(", ")}`;
    });
  }

  // ── "the Chrome should also work in background… doesn't affect other tab while print" ───────
  await phase("the print station hides its own window instead of borrowing the screen", () =>
    /set visible of \(first process whose unix id is/.test(station)
    || "the launcher is back to taking focus and handing it back after a wait — which is three seconds of Chrome on top of somebody's work");
  await phase("…and it hides it BY PROCESS ID, never by name", () => {
    const byName = /set visible of process .{0,4}Google Chrome/.test(stationCode);
    return !byName || "hiding by name would hide the restaurant's OWN Chrome as well — same app, same name, all windows";
  });
  await phase("…and it keeps trying, because Chrome raises itself when its window is ready", () =>
    /for _ in 1 2 3 4 5/.test(station) || "one attempt only — measured: Chrome comes to the front after the launcher has moved on");
  await phase("…and it never uses --kiosk, which would take the whole screen", () =>
    !/--kiosk(?!-printing)/.test(stationCode) || "--kiosk is back: a full-screen Chrome nobody can get out of");
  await phase("…and it keeps the three flags that stop a hidden window being throttled", () =>
    /--disable-background-timer-throttling/.test(station) && /--disable-backgrounding-occluded-windows/.test(station) && /--disable-renderer-backgrounding/.test(station)
    || "a hidden Chrome would be slowed to a crawl and a ticket would print minutes late");
}

// ══ 18 · A REAL ORDER, AND WHOSE SCREEN IT POPS UP ON ════════════════════════════════════════
// Owner, 2026-08-29: *"if you order from anything, the KOT pop up will happen in that particular
// user screen. So you have to make it like that… test all that by yourself."*
//
// Everything above tests the setup. This tests the CONSEQUENCE: name a cook, put a real order in,
// and follow the ticket to a screen. It is the only section that would notice if the whole routing
// story were right on paper and wrong in the room.
{
  const [cook] = await db(`staff_users?select=id,name,username&restaurant_id=eq.${RID}&role=eq.kitchen&order=id.asc&limit=1`);
  if (!cook) {
    for (const t of ["a named cook's screen is handed the ticket", "…and the manager's screen is not", "…and the manager can still print a bill"]) {
      await phase(t, () => "skip: this restaurant has no kitchen user to name");
    }
  } else {
    await setSwitches({ auto_print_kot: true, auto_print_kot_allowed: true });
    const r = await api("/api/admin/printing/mode", { method: "POST", body: JSON.stringify({ rid: RID, mode: "screen", person: cook.id }) });

    await phase("naming a cook on the Printing board is accepted", async () =>
      r.ok || `it answered ${r.status}: ${JSON.stringify(await r.json()).slice(0, 140)}`);
    await phase("…and the kitchen line now names that cook, on the KITCHEN panel", async () => {
      const [st] = await db(`settings?restaurant_id=eq.${RID}&select=modules`);
      const k = st.modules?.printing?.routes?.kot || {};
      return (k.via === "screen" && k.panel === "kitchen" && k.person === cook.id) || JSON.stringify(k);
    });
    await phase("…and the bill goes back to whoever presses Print, untouched by that choice", async () => {
      const [st] = await db(`settings?restaurant_id=eq.${RID}&select=modules`);
      const b = st.modules?.printing?.routes?.bill || {};
      return !b.via || `the bill line is ${JSON.stringify(b)} — one person's screen was handed the bills too`;
    });

    // …and now a real order, the way a waiter puts one in.
    await drain();
    const o = await newOrder(78, "End-to-end dish");
    await phase("an order queues a kitchen ticket", () =>
      !!o.jobId || "no ticket was queued for a brand-new order with printing on");
    await phase("…and the NAMED COOK's screen is handed it", async () => {
      const r2 = await settles(() => asKitchen("/board?autojobs=1"), (b) => (b.printJobs || []).length > 0);
      return r2.ok || `the cook's board was handed ${(r2.last.printJobs || []).length} ticket(s) · autoPrint=${r2.last.autoPrintKot} refused=${r2.last.printRefused}`;
    });
    await phase("…and the MANAGER's screen is not", async () => {
      const d = await asManager("/print-jobs/pending");
      return ((d.jobs || []).length === 0 && d.off === true)
        || `the manager screen was handed ${(d.jobs || []).length} ticket(s) — this is the "his screen will be loaded with all the tickets" complaint`;
    });
    await phase("…and the manager is TOLD why, rather than the sheet just being empty", async () => {
      const d = await asManager("/print-jobs/pending");
      return !!d.printRefused || "no reason given, so a manager sees an empty sheet and cannot tell if it is broken";
    });
    await phase("…and the manager can still print a BILL, exactly as before", async () => {
      const res = await fetch(BASE + "/api/editor/print/send", {
        method: "POST", headers: { "content-type": "application/json", cookie: MANAGER_COOKIE + "; lfh_panel_device=" + DEVICE },
        body: JSON.stringify({ kind: "bill", sessionId: SESSION.id }),
      }).then((x) => x.json()).catch(() => ({}));
      return res.noRoute === true
        || `it answered ${JSON.stringify(res).slice(0, 120)} — "other user will work as they work" means the bill window still opens`;
    });
    await phase("…and switching that cook off again leaves nobody printing by themselves", async () => {
      await api("/api/admin/printing/routes", { method: "POST", body: JSON.stringify({ rid: RID, routes: { kot: { via: "off" } } }) });
      const r2 = await settles(() => asKitchen("/board?autojobs=1"), (b) => b.autoPrintKot === false);
      return r2.ok || `the kitchen board still says ${r2.last.autoPrintKot}`;
    });
    await drain();
  }
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
// This block runs after the big try/catch above, so a THROW still reaches it. What it never covered
// is an INTERRUPTION — Ctrl-C, or a lane runner killing this guard for running past its timeout —
// and this sweep changes a real restaurant's printing routes, its auto-print switches and its
// manager permissions. The same put-backs are registered with restoreOnExit() at the point each
// original is captured, so a caught signal runs them too. (sweep #7 / T28, 2026-08-27.)
try { await setRoutes(bagWas.printing?.routes || {}); } catch {}
try { await db(`settings?restaurant_id=eq.${RID}`, { method: "PATCH", body: JSON.stringify({ modules: bagWas, ...switchesWas }) }); } catch {}
for (const id of made.events) { try { await db(`printer_events?id=eq.${id}`, { method: "DELETE" }); } catch {} }
for (const id of made.jobs)   { try { await db(`print_jobs?id=eq.${id}`,   { method: "DELETE" }); } catch {} }
for (const id of made.orders) { try { await db(`orders?id=eq.${id}`,       { method: "DELETE" }); } catch {} }
for (const id of made.agents) { try { await db(`print_agents?id=eq.${id}`, { method: "DELETE" }); } catch {} }
// The manager permission section 6b switched on and off is the restaurant's, not ours (mig 367).
if (permsWas !== null) { try { await db(`restaurants?id=eq.${RID}`, { method: "PATCH", body: JSON.stringify({ manager_permissions: permsWas }) }); } catch {} }
stashClear();   // everything is back — a next run has nothing to heal.

console.log("─".repeat(78));
console.log(`${n} phases · ${pass} passed · ${fail} failed · ${skip} skipped`);
if (fails.length) {
  console.log("\nwhat failed:");
  for (const f of fails) console.log("  · " + f);
  // …and the narrowest command that re-checks only the failing stretch. This is 500 phases; re-running
  // all of them to re-check three is why a suite this size stops being run at all.
  // (sweep #7 / T28, 2026-08-28.)
  const nums = fails.map((f) => Number(String(f).split(" ")[0])).filter(Number.isFinite);
  if (nums.length) {
    const { rerunLine } = await import("./sweep/rerun.mjs");
    console.log("\n" + rerunLine("verify:printing-sweep", { base: BASE, from: Math.min(...nums), to: Math.max(...nums) }));
  }
}
console.log("test rows removed; the restaurant's own printing settings put back.");
process.exit(fail ? 1 : 0);
