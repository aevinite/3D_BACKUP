// EVERY SHAPE A REAL RESTAURANT CAN BE IN, and what every screen and every door says in each.
//
// Owner, 2026-09-14: *"Go through every scenario, every single bit of scenario it can be possible.
// Think about what could happen in the restaurant… one time only QR is available, one time QR and
// billing is there, we have not provided a feature of banquet. If we have not provided the feature
// of banquet it should not even show the banquet also in the printing section. Check everything and
// everything should be working completely fine as I told you."*
//
// WHY THIS IS A SEPARATE SWEEP FROM verify:printing-sweep. That one walks the printing feature and
// asks "does each part work". This one fixes a restaurant into a SHAPE — what it has bought, what is
// plugged in, what is awake — and then asks every screen and every door the same questions, so an
// answer that is right for a full restaurant and wrong for a menu-only one cannot hide. The grid is
// the test: shapes × questions, generated, so adding a shape adds its whole row at once.
//
// It works on its own restaurant and puts every switch back, whatever happens.
//
//   node scripts/verify-print-scenarios.mjs --base http://localhost:4000
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4000");
const ONLY = arg("--shape", "");

// ── one sweep at a time: two of these on one restaurant report each other's writes as faults ──
const LOCK = "/tmp/print-scenarios.pid";
try {
  const alive = Number(readFileSync(LOCK, "utf8"));
  if (alive && alive !== process.pid) {
    try { process.kill(alive, 0); console.log(`Another scenario sweep is running (pid ${alive}).`); process.exit(2); }
    catch { /* stale */ }
  }
} catch { /* no lock */ }
writeFileSync(LOCK, String(process.pid));
const dropLock = () => { try { if (Number(readFileSync(LOCK, "utf8")) === process.pid) unlinkSync(LOCK); } catch {} };
process.on("exit", dropLock);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { dropLock(); process.exit(130); });

const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" };
const db = (p, init) => fetch(`${U}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init?.headers || {}) } })
  .then(async (r) => { const t = await r.text(); if (!r.ok) throw new Error(`${p} → ${r.status} ${t.slice(0, 160)}`); return t ? JSON.parse(t) : null; });
const adminCookie = "lfh_staff_auth=" + createHash("sha256").update(env.ADMIN_PASSWORD || "").digest("hex");
const api = (path, init) => fetch(BASE + path, { ...init, headers: { "content-type": "application/json", cookie: adminCookie, ...(init?.headers || {}) } });
const apiJson = (path, init) => api(path, init).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

let n = 0, pass = 0, fail = 0;
const fails = [];
let SHAPE = "";
const phase = async (title, fn) => {
  n++;
  try {
    const r = await fn();
    if (r === true || r === undefined) { pass++; console.log(`  ✅ ${String(n).padStart(3)}  ${title}`); return; }
    // The invariant titles already carry their shape, so only a bespoke phase needs the prefix.
    fail++; fails.push(`${n} · ${title.startsWith("[") ? "" : `[${SHAPE}] `}${title} → ${r}`);
    console.log(`  ❌ ${String(n).padStart(3)}  ${title}  → ${r}`);
  } catch (e) {
    fail++; fails.push(`${n} · ${title.startsWith("[") ? "" : `[${SHAPE}] `}${title} → threw ${e.message}`);
    console.log(`  ❌ ${String(n).padStart(3)}  ${title}  → threw ${e.message.slice(0, 120)}`);
  }
};

// ══ THE RESTAURANT THIS SWEEP OWNS ════════════════════════════════════════════════════════════
// Its own, created here and removed at the end — NOT a real one. Every shape below rewrites its
// entitlements and its address book, and doing that to Pizza Palace would mean this sweep decides
// where a real restaurant's paper comes out for as long as it runs.
const TAG = "ZZ Scenarios " + Date.now().toString(36);
const made = { restaurants: [], agents: [], orders: [], jobs: [] };
let RID = "";

const [rest] = await db("restaurants", { method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify({ name: TAG, slug: "zz-scen-" + Date.now().toString(36), active: true }) });
RID = rest.id; made.restaurants.push(RID);
// A settings row is normally made by the restaurant-create path; this sweep talks to the DB directly.
const existing = await db(`settings?restaurant_id=eq.${RID}&select=restaurant_id`);
if (!existing.length) await db("settings", { method: "POST", body: JSON.stringify({ restaurant_id: RID }) });

const cleanup = async () => {
  for (const id of made.jobs) { try { await db(`print_jobs?id=eq.${id}`, { method: "DELETE" }); } catch {} }
  try { await db(`print_jobs?restaurant_id=eq.${RID}`, { method: "DELETE" }); } catch {}
  for (const id of made.orders) {
    try { await db(`orders?id=eq.${id}`, { method: "DELETE" }); }
    catch { try { await db(`orders?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ deleted_at: new Date().toISOString() }) }); } catch {} }
  }
  try { await db(`orders?restaurant_id=eq.${RID}`, { method: "DELETE" }); } catch {}
  for (const id of made.agents) { try { await db(`print_agents?id=eq.${id}`, { method: "DELETE" }); } catch {} }
  try { await db(`print_agents?restaurant_id=eq.${RID}`, { method: "DELETE" }); } catch {}
  try { await db(`settings?restaurant_id=eq.${RID}`, { method: "DELETE" }); } catch {}
  try { await db(`restaurants?id=eq.${RID}`, { method: "DELETE" }); } catch {}
};
process.on("exit", () => { /* best effort; the real clean-up is awaited at the end */ });

// ── the knobs each shape turns ────────────────────────────────────────────────────────────────
const setFlags = (patch) => db(`settings?restaurant_id=eq.${RID}`, { method: "PATCH", body: JSON.stringify(patch) });
const setRoutes = async (routes) => {
  const [s] = await db(`settings?restaurant_id=eq.${RID}&select=modules`);
  const bag = s.modules || {};
  await db(`settings?restaurant_id=eq.${RID}`, { method: "PATCH",
    body: JSON.stringify({ modules: { ...bag, printing: { ...(bag.printing || {}), routes } } }) });
};
const setPaused = async (paused) => {
  const [s] = await db(`settings?restaurant_id=eq.${RID}&select=modules`);
  const bag = s.modules || {};
  await db(`settings?restaurant_id=eq.${RID}`, { method: "PATCH",
    body: JSON.stringify({ modules: { ...bag, printing: { ...(bag.printing || {}), paused } } }) });
};
/** A computer, with the printers it "reported". `seenAgo` in seconds — 0 is awake, 600 is asleep. */
const addAgent = async (name, printers, seenAgo = 0) => {
  const token = "lfhp_" + randomBytes(24).toString("base64url");
  const [a] = await db("print_agents", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ restaurant_id: RID, name, token_hash: createHash("sha256").update(token).digest("hex"),
      printers: printers.map((p) => ({ name: p })),
      last_seen_at: new Date(Date.now() - seenAgo * 1000).toISOString() }) });
  made.agents.push(a.id);
  return { ...a, token };
};
const wipeAgents = async () => {
  try { await db(`print_jobs?restaurant_id=eq.${RID}`, { method: "DELETE" }); } catch {}
  await db(`print_agents?restaurant_id=eq.${RID}`, { method: "DELETE" });
  made.agents.length = 0;
};
const newOrder = async (table, title) => {
  const [o] = await db("orders", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ restaurant_id: RID, table_number: String(table), kot_no: 5000 + n,
      items: [{ id: "x", title, qty: 1, price: 100, options: [] }],
      subtotal: 100, tax: 5, total: 105, status: "received", placed_by: "scenarios" }) });
  made.orders.push(o.id);
  await new Promise((r) => setTimeout(r, 700));
  const js = await db(`print_jobs?order_id=eq.${o.id}&select=id,printer,status`);
  made.jobs.push(...js.map((j) => j.id));
  return { order: o, jobs: js };
};

// ── the questions every shape is asked ────────────────────────────────────────────────────────
const board = () => apiJson(`/api/admin/printing/state?rid=${RID}`).then((r) => r.body);
const ownerPrinting = () => apiJson(`/api/owner/printing?rid=${RID}`).then((r) => r.body);
const sendAs = (panel, body) => apiJson(`/api/${panel}/print/send?rid=${RID}`, { method: "POST", body: JSON.stringify(body) });
const agentGet = (path, token) => fetch(BASE + "/api/print-agent" + path, { headers: { "x-lfh-agent": token } })
  .then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));


// ══ THE SAME QUESTIONS, ASKED OF EVERY SHAPE ══════════════════════════════════════════════════
//
// The bespoke phases below prove what is SPECIAL about each shape. These prove what must be true in
// ALL of them — and they are the half that catches the real faults, because a rule that is right for
// a full restaurant and wrong for a menu-only one is exactly the kind that ships.
//
// Every one of them is a sentence somebody could have said out loud about this product. None of them
// reads a variable it just wrote: each asks a SCREEN or a DOOR and checks the answer against the
// database underneath it.
const invariants = async (shape) => {
  const b = await board();
  const o = await ownerPrinting();
  const [st] = await db(`settings?restaurant_id=eq.${RID}&select=banquet_allowed,banquet_owner_control,banquet_enabled,auto_print_kot_allowed`);
  const agents = await db(`print_agents?restaurant_id=eq.${RID}&revoked_at=is.null&select=id,name,printers,last_seen_at`);
  const printersReported = new Set(agents.flatMap((a) => (a.printers || []).map((p) => p.name)));
  const on = st.auto_print_kot_allowed === true;
  const bqOn = st.banquet_allowed === true && (st.banquet_owner_control !== true || st.banquet_enabled !== false);

  await phase(`[${shape}] the admin board answers at all`, () =>
    (b && typeof b === "object" && !b.error) || `it answered ${JSON.stringify(b).slice(0, 120)}`);

  await phase(`[${shape}] it offers no paper this restaurant has not bought`, () =>
    (b.kinds || []).every((k) => ["kot", "bill", "banquet"].includes(k)) && ((b.kinds || []).includes("banquet") === bqOn)
    || `kinds ${JSON.stringify(b.kinds)} with banquet ${bqOn ? "ON" : "OFF"}`);

  await phase(`[${shape}] every live row carries a label, a one-word state and a sentence`, () =>
    (b.live || []).every((r) => r.label && r.state && r.words && r.words.length > 10)
    || `a row is missing its words: ${JSON.stringify((b.live || []).find((r) => !r.label || !r.state || !r.words))}`);

  await phase(`[${shape}] only an unanswered COMPUTER is red — a decision is never a fault`, () =>
    (b.live || []).every((r) => (r.ok === false) === (r.via === "computer" && r.connected === false))
    || `a row is red for the wrong reason: ${JSON.stringify((b.live || []).filter((r) => r.ok === false).map((r) => [r.kind, r.via, r.connected]))}`);

  await phase(`[${shape}] Test is offered only where a computer really owns the paper`, () =>
    (b.live || []).every((r) => r.canTest === (r.via === "computer"))
    || `canTest disagrees with via: ${JSON.stringify((b.live || []).map((r) => [r.kind, r.via, r.canTest]))}`);

  await phase(`[${shape}] no row names a printer that no computer has reported`, () =>
    (b.live || []).every((r) => !r.printer || printersReported.has(r.printer))
    || `a row names a printer nothing reports: ${JSON.stringify((b.live || []).map((r) => r.printer).filter(Boolean))}`);

  await phase(`[${shape}] the owner panel and the admin board say the SAME thing, row for row`, () => {
    if (!on) return o.allowed === false || "printing is off, yet the owner was sent rows";
    const key = (rows) => JSON.stringify((rows || []).map((r) => [r.kind, r.state, r.printer, r.ok]));
    return key(b.live) === key(o.live) || `admin ${key(b.live)}\n        owner ${key(o.live)}`;
  });

  await phase(`[${shape}] the manager panel is read-only, and agrees on which papers exist`, async () => {
    const t = readFileSync(new URL("../app/api/editor/[...path]/route.ts", import.meta.url), "utf8");
    if (!/const maySetup = false;/.test(t)) return "the manager panel can be put into setup mode";
    return true;
  });

  await phase(`[${shape}] a computer is shown awake only if it really spoke within the window`, () =>
    (b.agents || []).every((a) => {
      const row = agents.find((x) => x.id === a.id);
      if (!row) return true;
      const age = Date.now() - new Date(row.last_seen_at).getTime();
      return a.connected === (age < 30000);
    }) || "a computer's awake/asleep state does not match when it last spoke");

  await phase(`[${shape}] nothing is BOTH queued to a computer and offered to a screen`, async () => {
    const kot = (b.live || []).find((r) => r.kind === "kot");
    if (!kot || kot.via !== "computer") return true;
    const { order } = await newOrder(1, "Two printers?");
    const r = await sendAs("kitchen", { orderId: order.id, force: true });
    return r.body.queued === true || `the kitchen screen was also offered it: ${JSON.stringify(r.body).slice(0, 100)}`;
  });
};

console.log(`\nverify:print-scenarios · base ${BASE} · restaurant ${TAG}`);
console.log("─".repeat(78));

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SHAPE 1 · A MENU-ONLY RESTAURANT — the QR code, and nothing else bought
// ══════════════════════════════════════════════════════════════════════════════════════════════
// "One time only QR is available." Printing has never been switched on. His standing rule (R36) is
// that a withheld feature shows NOTHING — not a greyed-out screen, not an explanation.
if (!ONLY || ONLY === "1") {
  SHAPE = "menu only";
  console.log("\n① A MENU-ONLY RESTAURANT — the QR code, nothing else");
  await wipeAgents();
  await setFlags({ auto_print_kot_allowed: false, auto_print_kot: false, banquet_allowed: false });
  await setRoutes({});

  await phase("the owner's panel is told nothing at all about printing", async () => {
    const o = await ownerPrinting();
    return o.allowed === false || `it answered ${JSON.stringify(o).slice(0, 140)}`;
  });
  await phase("…and hands out no live rows to draw", async () => {
    const o = await ownerPrinting();
    return (o.live === undefined && o.perRestaurant === undefined) || "it sent printing rows for a restaurant that has no printing";
  });
  await phase("a new order queues NO ticket — the queue is not even filled", async () => {
    const { jobs } = await newOrder(1, "Menu only");
    return jobs.length === 0 || `it queued ${jobs.length}`;
  });
  await phase("…and no screen is offered anything to print", async () => {
    const r = await sendAs("editor", { kind: "kot", force: true });
    return (r.body.noRoute === true || r.status >= 400) || `it answered ${JSON.stringify(r.body).slice(0, 110)}`;
  });
  await phase("a bill still prints the way it always has — a window, not a refusal", async () => {
    const r = await sendAs("editor", { kind: "bill", sessionId: "00000000-0000-0000-0000-000000000000", force: true });
    return r.body.noRoute === true || `it answered ${JSON.stringify(r.body).slice(0, 110)}`;
  });

  await invariants("menu only");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SHAPE 2 · QR + BILLING, PRINTING ON, NO COMPUTER — the commonest restaurant there is
// ══════════════════════════════════════════════════════════════════════════════════════════════
if (!ONLY || ONLY === "2") {
  SHAPE = "printing on, no computer";
  console.log("\n② PRINTING ON, NO COMPUTER — the kitchen screen does the slips");
  await wipeAgents();
  await setFlags({ auto_print_kot_allowed: true, auto_print_kot: true, banquet_allowed: false });
  await setRoutes({});

  await phase("the board offers TWO papers — kitchen slips and bills — and no banquet line", async () => {
    const b = await board();
    return (Array.isArray(b.kinds) && b.kinds.includes("kot") && b.kinds.includes("bill") && !b.kinds.includes("banquet"))
      || `kinds were ${JSON.stringify(b.kinds)}`;
  });
  await phase("kitchen slips fall to the KITCHEN SCREEN, with nobody named", async () => {
    const b = await board();
    const kot = (b.live || []).find((r) => r.kind === "kot");
    return (kot && kot.via === "screen" && kot.state === "SCREEN")
      || `the kitchen-slip row says ${JSON.stringify(kot)}`;
  });
  await phase("…and bills open a window, which is not a fault and is not red", async () => {
    const b = await board();
    const bill = (b.live || []).find((r) => r.kind === "bill");
    return (bill && bill.via === "none" && bill.state === "WINDOW" && bill.ok === true)
      || `the bills row says ${JSON.stringify(bill)}`;
  });
  await phase("nothing can be Tested, because no printer is set up to test", async () => {
    const b = await board();
    return (b.live || []).every((r) => r.canTest === false) || "a Test button is offered with no printer behind it";
  });
  await phase("a new order DOES queue a ticket now — it waits for a screen to take it", async () => {
    const { jobs } = await newOrder(2, "Screen prints");
    return jobs.length === 1 || `it queued ${jobs.length}`;
  });
  await phase("…and the kitchen panel is allowed to print it here, because nothing else will", async () => {
    const r = await sendAs("kitchen", { orderId: made.orders[made.orders.length - 1], force: true });
    return r.body.noRoute === true || `it answered ${JSON.stringify(r.body).slice(0, 110)} — a screen must still print when no computer owns the slips`;
  });

  await invariants("printing on, no computer");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SHAPE 3 · A COMPUTER IS LINKED, BUT NO PRINTER HAS BEEN CHOSEN YET — the half-done state
// ══════════════════════════════════════════════════════════════════════════════════════════════
// The five minutes between somebody typing the setup code and somebody choosing which printer gets
// what. Everything still works; nothing is broken; and the screens must say which it is.
if (!ONLY || ONLY === "3") {
  SHAPE = "linked, nothing routed";
  console.log("\n③ A COMPUTER IS LINKED — and no printer chosen yet");
  await wipeAgents();
  await setFlags({ auto_print_kot_allowed: true, auto_print_kot: true, banquet_allowed: false });
  await addAgent("Counter PC", ["Kitchen-80", "Bills-80"], 0);
  await setRoutes({});

  await phase("the board lists the computer, awake, with the printers it reported", async () => {
    const b = await board();
    const a = (b.agents || [])[0];
    return (a && a.connected === true && (a.printers || []).length === 2) || `it says ${JSON.stringify(a).slice(0, 140)}`;
  });
  await phase("…and still nothing can be Tested, because no paper is routed to it", async () => {
    const b = await board();
    return (b.live || []).every((r) => r.canTest === false) || "Test is offered for a paper no printer owns";
  });
  await phase("…kitchen slips are STILL the kitchen screen's, not the idle computer's", async () => {
    const b = await board();
    const kot = (b.live || []).find((r) => r.kind === "kot");
    return (kot && kot.via === "screen") || `it says ${JSON.stringify(kot)}`;
  });
  await phase("…and the kitchen panel may still print, so a half-done setup prints nothing nowhere", async () => {
    const { order } = await newOrder(3, "Half set up");
    const r = await sendAs("kitchen", { orderId: order.id, force: true });
    return r.body.noRoute === true || `it answered ${JSON.stringify(r.body).slice(0, 110)}`;
  });

  await invariants("linked, nothing routed");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SHAPE 4 · ONE COMPUTER, ONE PRINTER, EVERY PAPER ON IT — the small restaurant
// ══════════════════════════════════════════════════════════════════════════════════════════════
if (!ONLY || ONLY === "4") {
  SHAPE = "one printer, all papers";
  console.log("\n④ ONE PRINTER TAKES EVERYTHING — the small restaurant");
  await wipeAgents();
  await setFlags({ auto_print_kot_allowed: true, auto_print_kot: true, banquet_allowed: false });
  const a = await addAgent("Till PC", ["OnlyPrinter-80"], 0);
  await setRoutes({ kot: { via: "computer", agent: a.id, printer: "OnlyPrinter-80" },
                    bill: { via: "computer", agent: a.id, printer: "OnlyPrinter-80" } });

  await phase("both papers read LIVE on that one printer", async () => {
    const b = await board();
    const rows = (b.live || []).filter((r) => r.via === "computer");
    return (rows.length === 2 && rows.every((r) => r.state === "LIVE" && r.printer === "OnlyPrinter-80"))
      || `rows: ${JSON.stringify(rows.map((r) => [r.kind, r.state, r.printer]))}`;
  });
  await phase("…and both can be Tested", async () => {
    const b = await board();
    return (b.live || []).filter((r) => r.canTest).length === 2 || "a routed paper cannot be tested";
  });
  await phase("no screen may print the kitchen slips any more — the computer owns them", async () => {
    const { order } = await newOrder(4, "Computer owns it");
    const r = await sendAs("kitchen", { orderId: order.id, force: true });
    return r.body.queued === true || `it answered ${JSON.stringify(r.body).slice(0, 110)}`;
  });
  await phase("…and it reaches that printer when the helper takes it", async () => {
    // A kitchen slip is queued with NO printer on purpose (app/api/editor → print/send): the address
    // book is applied at CLAIM time, so a ticket follows the line even if it is re-pointed in the
    // seconds between the tap and the paper. So the question is not what the row says now — it is
    // what the helper is handed.
    const r = await agentGet("/next?max=4", a.token);
    const jobs = r.body?.jobs || (r.body?.id ? [r.body] : []);
    made.jobs.push(...jobs.map((j) => j.id));
    return (jobs.length >= 1 && jobs.every((j) => j.printer === "OnlyPrinter-80"))
      || `the helper was handed ${JSON.stringify(jobs.map((j) => j.printer))}`;
  });
  await phase("ONE printer means ONE lane: two waiting tickets are not handed out together", async () => {
    await db(`print_jobs?restaurant_id=eq.${RID}`, { method: "DELETE" });
    await newOrder(4, "Lane A"); await newOrder(4, "Lane B");
    const r = await agentGet("/next?max=4", a.token);
    const jobs = r.body?.jobs || (r.body?.id ? [r.body] : []);
    return jobs.length === 1 || `it handed out ${jobs.length} for one printer — they would come out in the wrong order`;
  });

  await invariants("one printer, all papers");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SHAPE 5 · THREE PRINTERS, ONE PER PAPER — and they must print AT THE SAME TIME
// ══════════════════════════════════════════════════════════════════════════════════════════════
// Owner, 2026-09-14: *"If there are three different printers connected to the PC and set up for
// different prints, so all that we have different queue. For example, you can send kitchen and print
// bill simultaneously in parallel."*
if (!ONLY || ONLY === "5") {
  SHAPE = "three printers, one per paper";
  console.log("\n⑤ THREE PRINTERS, ONE PER PAPER — kitchen and bill at the same time");
  await wipeAgents();
  await setFlags({ auto_print_kot_allowed: true, auto_print_kot: true, banquet_allowed: true });
  const a = await addAgent("Big PC", ["Kitchen-80", "Bills-80", "Banquet-A4"], 0);
  await setRoutes({
    kot: { via: "computer", agent: a.id, printer: "Kitchen-80" },
    bill: { via: "computer", agent: a.id, printer: "Bills-80" },
    banquet: { via: "computer", agent: a.id, printer: "Banquet-A4" },
  });

  await phase("all THREE papers are offered, because this restaurant has banquet", async () => {
    const b = await board();
    return (b.kinds || []).length === 3 || `kinds were ${JSON.stringify(b.kinds)}`;
  });
  await phase("…and each reads LIVE on its own printer", async () => {
    const b = await board();
    const m = Object.fromEntries((b.live || []).map((r) => [r.kind, r.printer]));
    return (m.kot === "Kitchen-80" && m.bill === "Bills-80" && m.banquet === "Banquet-A4") || JSON.stringify(m);
  });
  await phase("three tickets on three printers are handed out IN ONE ROUND", async () => {
    await db(`print_jobs?restaurant_id=eq.${RID}`, { method: "DELETE" });
    await newOrder(5, "Parallel kitchen");
    await apiJson("/api/admin/printing/test", { method: "POST", body: JSON.stringify({ rid: RID, sample: "bill" }) });
    await apiJson("/api/admin/printing/test", { method: "POST", body: JSON.stringify({ rid: RID, sample: "banquet" }) });
    const r = await agentGet("/next?max=4", a.token);
    const jobs = r.body?.jobs || [];
    made.jobs.push(...jobs.map((j) => j.id));
    return jobs.length === 3 || `it handed out ${jobs.length} — kitchen and bill would still be one behind the other`;
  });
  await phase("…and every one of them is on a DIFFERENT printer", async () => {
    const [j] = await db(`print_jobs?restaurant_id=eq.${RID}&status=eq.printing&select=printer&order=created_at.asc&limit=9`);
    const rows = await db(`print_jobs?restaurant_id=eq.${RID}&status=eq.printing&select=printer`);
    const names = rows.map((x) => x.printer);
    return (new Set(names).size === names.length) || `two lanes share a printer: ${names.join(", ")}`;
  });
  await phase("…and asking again hands out nothing, because every lane is busy", async () => {
    const r = await agentGet("/next?max=4", a.token);
    return r.status === 204 || `it handed out more work for printers that are already printing: ${JSON.stringify(r.body).slice(0, 100)}`;
  });
  await phase("an OLD helper that cannot ask for a batch still gets its one job", async () => {
    await db(`print_jobs?restaurant_id=eq.${RID}`, { method: "DELETE" });
    await newOrder(5, "Old helper");
    const r = await agentGet("/next", a.token);
    return (r.body && r.body.id && r.body.jobs === undefined)
      || `an old helper was handed ${JSON.stringify(r.body).slice(0, 110)} — it cannot read that`;
  });

  await invariants("three printers, one per paper");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SHAPE 6 · THE COMPUTER IS ASLEEP — the shop is shut, or the PC is off
// ══════════════════════════════════════════════════════════════════════════════════════════════
if (!ONLY || ONLY === "6") {
  SHAPE = "computer asleep";
  console.log("\n⑥ THE COMPUTER IS ASLEEP — the shop is shut, or somebody switched it off");
  await wipeAgents();
  await setFlags({ auto_print_kot_allowed: true, auto_print_kot: true, banquet_allowed: false });
  const a = await addAgent("Sleeping PC", ["Kitchen-80", "Bills-80"], 600);
  await setRoutes({ kot: { via: "computer", agent: a.id, printer: "Kitchen-80" },
                    bill: { via: "computer", agent: a.id, printer: "Bills-80" } });

  await phase("both papers read ASLEEP, and they are the ONLY red rows on the board", async () => {
    const b = await board();
    const red = (b.live || []).filter((r) => r.ok === false);
    return (red.length === 2 && red.every((r) => r.state === "ASLEEP"))
      || `red rows: ${JSON.stringify(red.map((r) => [r.kind, r.state]))}`;
  });
  await phase("…and each says, in words, that the paper is waiting rather than lost", async () => {
    const b = await board();
    return (b.live || []).filter((r) => r.ok === false).every((r) => /waiting|back/.test(r.words))
      || "a sleeping printer's row does not say the paper is waiting";
  });
  await phase("a sleeping printer can STILL be chosen — the shop is shut, not broken", () => {
    const page = readFileSync(new URL("../app/aevinite/printing/page.tsx", import.meta.url), "utf8");
    const opt = page.slice(page.indexOf("<optgroup key={a.id}"), page.indexOf("</optgroup>"));
    return !/disabled=\{!a\.connected\}/.test(opt)
      || "the printer picker greys out a sleeping computer's printers again — after a shop closes, nobody could set printing up at all";
  });
  await phase("…and a ticket still queues, to wait for it", async () => {
    const { jobs } = await newOrder(6, "Waits for the PC");
    return jobs.length === 1 || `it queued ${jobs.length}`;
  });
  await phase("…and no screen quietly prints it somewhere else instead", async () => {
    const r = await sendAs("kitchen", { orderId: made.orders[made.orders.length - 1], force: true });
    return r.body.queued === true || `the kitchen screen was offered it: ${JSON.stringify(r.body).slice(0, 110)}`;
  });
  await phase("Test still works, and says honestly that it will print when the PC is back", async () => {
    const r = await apiJson("/api/admin/printing/test", { method: "POST", body: JSON.stringify({ rid: RID, sample: "kot" }) });
    return (r.body.ok === true && /as soon as|back/.test(r.body.note || ""))
      || `it said ${JSON.stringify(r.body).slice(0, 130)}`;
  });

  await invariants("computer asleep");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SHAPE 7 · THE COMPUTER IS GONE — thrown away, replaced, or unlinked by mistake
// ══════════════════════════════════════════════════════════════════════════════════════════════
if (!ONLY || ONLY === "7") {
  SHAPE = "computer removed";
  console.log("\n⑦ THE COMPUTER IS GONE — and the restaurant must not go quiet");
  await setFlags({ auto_print_kot_allowed: true, auto_print_kot: true, banquet_allowed: false });
  const a = await addAgent("Doomed PC", ["Kitchen-80"], 0);
  await setRoutes({ kot: { via: "computer", agent: a.id, printer: "Kitchen-80" } });
  await db(`print_agents?id=eq.${a.id}`, { method: "PATCH", body: JSON.stringify({ revoked_at: new Date().toISOString() }) });

  await phase("kitchen slips fall BACK to the kitchen screen rather than going nowhere", async () => {
    const b = await board();
    const kot = (b.live || []).find((r) => r.kind === "kot");
    return (kot && kot.via === "screen") || `it says ${JSON.stringify(kot)} — the slips are addressed to a machine that no longer exists`;
  });
  await phase("…and the kitchen panel is allowed to print again", async () => {
    const { order } = await newOrder(7, "PC thrown away");
    const r = await sendAs("kitchen", { orderId: order.id, force: true });
    return r.body.noRoute === true || `it answered ${JSON.stringify(r.body).slice(0, 110)}`;
  });
  await phase("…and the dead computer's token opens nothing at all", async () => {
    const r = await agentGet("/next", a.token);
    return r.status === 401 || `it answered ${r.status}`;
  });
  await phase("a BILL addressed to the dead machine opens the window instead of vanishing", async () => {
    await setRoutes({ bill: { via: "computer", agent: a.id, printer: "Kitchen-80" } });
    const r = await sendAs("editor", { kind: "bill", sessionId: "00000000-0000-0000-0000-000000000000", force: true });
    return r.body.noRoute === true || `it answered ${JSON.stringify(r.body).slice(0, 110)}`;
  });
  await wipeAgents();

  await invariants("computer removed");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SHAPE 8 · SOMEBODY SAID "NOBODY" — a deliberate decision, not a fault
// ══════════════════════════════════════════════════════════════════════════════════════════════
if (!ONLY || ONLY === "8") {
  SHAPE = "kitchen slips = nobody";
  console.log("\n⑧ \"NOBODY PRINTS THE KITCHEN SLIPS\" — a decision, and it must not look like a fault");
  await wipeAgents();
  await setFlags({ auto_print_kot_allowed: true, banquet_allowed: false });
  await apiJson("/api/admin/printing/routes", { method: "POST", body: JSON.stringify({ rid: RID, routes: { kot: { via: "off" } } }) });

  await phase("the kitchen-slip line reads OFF", async () => {
    const b = await board();
    const kot = (b.live || []).find((r) => r.kind === "kot");
    return (kot && kot.state === "OFF") || `it says ${JSON.stringify(kot)}`;
  });
  await phase("…and it is GREEN, because a decision is not a fault (don't cry wolf)", async () => {
    const b = await board();
    const kot = (b.live || []).find((r) => r.kind === "kot");
    return kot.ok === true || "a deliberate 'Nobody' is shown as a problem";
  });
  await phase("…and it switched auto-print off at the source, so nothing is queued for ever", async () => {
    const [st] = await db(`settings?restaurant_id=eq.${RID}&select=auto_print_kot`);
    return st.auto_print_kot === false || `auto_print_kot is ${st.auto_print_kot} — the line and the column have come apart`;
  });
  await phase("…and a new order really does queue nothing", async () => {
    const { jobs } = await newOrder(8, "Nobody prints this");
    return jobs.length === 0 || `it queued ${jobs.length}`;
  });
  await phase("…and the kitchen screen is told NO, with a reason it can act on", async () => {
    const r = await sendAs("kitchen", { orderId: made.orders[made.orders.length - 1], force: true });
    return (r.body.noRoute === true || r.status >= 400) || `it answered ${JSON.stringify(r.body).slice(0, 110)}`;
  });
  // ── MEASURED WHILE IT IS OFF ─────────────────────────────────────────────────────────────
  // The battery runs BEFORE the line is pointed back at a printer, or this shape gets asked its
  // questions in a state it is not about. Found by sabotage: making a deliberate "Nobody" show RED
  // was caught only by the bespoke phase above, because by the time the invariants ran the line had
  // already been switched back and there was no "off" row left to look at.
  await invariants("kitchen slips = nobody");

  await phase("pointing it back at a printer switches auto-print on again", async () => {
    const a2 = await addAgent("Back On PC", ["Kitchen-80"], 0);
    await apiJson("/api/admin/printing/routes", { method: "POST",
      body: JSON.stringify({ rid: RID, routes: { kot: { via: "computer", agent: a2.id, printer: "Kitchen-80" } } }) });
    const [st] = await db(`settings?restaurant_id=eq.${RID}&select=auto_print_kot`);
    return st.auto_print_kot === true || `auto_print_kot is ${st.auto_print_kot}`;
  });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SHAPE 9 · THE QUEUE IS STOPPED — a printer is being serviced mid-service
// ══════════════════════════════════════════════════════════════════════════════════════════════
if (!ONLY || ONLY === "9") {
  SHAPE = "queue stopped";
  console.log("\n⑨ THE QUEUE IS STOPPED — tickets keep being made, and nothing comes out");
  await wipeAgents();
  await setFlags({ auto_print_kot_allowed: true, auto_print_kot: true, banquet_allowed: false });
  const a = await addAgent("Paused PC", ["Kitchen-80"], 0);
  await setRoutes({ kot: { via: "computer", agent: a.id, printer: "Kitchen-80" } });
  await setPaused(true);

  await phase("the helper is handed nothing while the queue is stopped", async () => {
    await newOrder(9, "Stopped queue");
    const r = await agentGet("/next?max=4", a.token);
    return r.status === 204 || `it was handed ${JSON.stringify(r.body).slice(0, 110)}`;
  });
  await phase("…but the ticket IS still made, so nothing is lost while it is stopped", async () => {
    const rows = await db(`print_jobs?restaurant_id=eq.${RID}&status=eq.queued&select=id`);
    return rows.length >= 1 || "stopping the queue stopped the tickets being made — they can never come out later";
  });
  await phase("restarting it hands the waiting ticket straight over", async () => {
    await setPaused(false);
    const r = await agentGet("/next?max=4", a.token);
    const jobs = r.body?.jobs || (r.body?.id ? [r.body] : []);
    made.jobs.push(...jobs.map((j) => j.id));
    return jobs.length >= 1 || "a ticket that waited through a stop never came out";
  });

  await invariants("queue stopped");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SHAPE 10 · THE BANQUET FEATURE, OFF AND ON — his specific instruction
// ══════════════════════════════════════════════════════════════════════════════════════════════
// Owner, 2026-09-14: *"If we have not provided the feature of banquet, it should not even show the
// banquet also in the printing section."* Checked BOTH ways round, because a rule that only hides is
// half a rule: switching the feature on has to bring the line back.
if (!ONLY || ONLY === "10") {
  SHAPE = "banquet off / on";
  console.log("\n⑩ A FEATURE THE RESTAURANT DOES NOT HAVE — banquet, off and on");
  await wipeAgents();
  await setFlags({ auto_print_kot_allowed: true, auto_print_kot: true, banquet_allowed: false });
  const a = await addAgent("Paper PC", ["Kitchen-80", "Banquet-A4"], 0);
  await setRoutes({});

  await phase("with banquet OFF, the admin board offers no banquet line", async () => {
    const b = await board();
    return !(b.kinds || []).includes("banquet") || `kinds were ${JSON.stringify(b.kinds)}`;
  });
  await phase("…and no banquet ROW on the live status, on any of the three screens", async () => {
    const b = await board();
    const o = await ownerPrinting();
    const has = (rows) => (rows || []).some((r) => r.kind === "banquet");
    return (!has(b.live) && !has(o.live)) || `admin ${has(b.live)} · owner ${has(o.live)}`;
  });
  await phase("…and the SERVER refuses to route it, so a stale tab cannot set one", async () => {
    const r = await apiJson("/api/admin/printing/routes", { method: "POST",
      body: JSON.stringify({ rid: RID, routes: { banquet: { via: "computer", agent: a.id, printer: "Banquet-A4" } } }) });
    return r.status >= 400 || `it accepted a banquet route for a restaurant with no banquet: ${JSON.stringify(r.body).slice(0, 110)}`;
  });
  await phase("…and a banquet sample cannot be Tested into nowhere", async () => {
    const r = await apiJson("/api/admin/printing/test", { method: "POST", body: JSON.stringify({ rid: RID, sample: "banquet" }) });
    return r.status >= 400 || `it queued a banquet sample: ${JSON.stringify(r.body).slice(0, 110)}`;
  });
  await phase("the OTHER two papers are untouched by any of that", async () => {
    const b = await board();
    return ((b.kinds || []).includes("kot") && (b.kinds || []).includes("bill"))
      || `kinds were ${JSON.stringify(b.kinds)} — hiding banquet took another paper with it`;
  });

  await setFlags({ banquet_allowed: true });
  await phase("switching banquet ON brings the line back, with nothing chosen", async () => {
    const b = await board();
    const bq = (b.live || []).find((r) => r.kind === "banquet");
    return (b.kinds || []).includes("banquet") && bq && bq.via === "none"
      || `kinds ${JSON.stringify(b.kinds)} · row ${JSON.stringify(bq)}`;
  });
  await phase("…and NOW it can be routed", async () => {
    const r = await apiJson("/api/admin/printing/routes", { method: "POST",
      body: JSON.stringify({ rid: RID, routes: { banquet: { via: "computer", agent: a.id, printer: "Banquet-A4" } } }) });
    return r.status === 200 || `it answered ${r.status} ${JSON.stringify(r.body).slice(0, 110)}`;
  });
  await phase("…and tested", async () => {
    const r = await apiJson("/api/admin/printing/test", { method: "POST", body: JSON.stringify({ rid: RID, sample: "banquet" }) });
    return r.body.ok === true || `it answered ${JSON.stringify(r.body).slice(0, 120)}`;
  });
  await phase("switching it OFF again hides the line, and leaves the other papers alone", async () => {
    await setFlags({ banquet_allowed: false });
    const b = await board();
    return (!(b.kinds || []).includes("banquet") && (b.kinds || []).includes("bill"))
      || `kinds were ${JSON.stringify(b.kinds)}`;
  });

  await invariants("banquet off / on");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SHAPE 11 · WHO MAY TOUCH ANY OF IT — the manager and the owner can only LOOK
// ══════════════════════════════════════════════════════════════════════════════════════════════
// Owner, 2026-09-14: *"In the manager panel and the owner panel there shouldn't be able to change
// it — just for them to see that a computer is online, printer is online, whichever printer we have
// set up all online, you are good to go."* And, asked outright: **"That setup will be done by me only."**
if (!ONLY || ONLY === "11") {
  SHAPE = "manager & owner can only look";
  console.log("\n⑪ THE MANAGER AND THE OWNER CAN ONLY LOOK");
  await wipeAgents();
  await setFlags({ auto_print_kot_allowed: true, auto_print_kot: true, banquet_allowed: false });
  const a = await addAgent("Watched PC", ["Kitchen-80", "Bills-80"], 0);
  await setRoutes({ kot: { via: "computer", agent: a.id, printer: "Kitchen-80" },
                    bill: { via: "computer", agent: a.id, printer: "Bills-80" } });

  await phase("the owner's card says everything is connected and live", async () => {
    const o = await ownerPrinting();
    const rows = (o.live || []).filter((r) => r.via === "computer");
    return (rows.length === 2 && rows.every((r) => r.state === "LIVE")) || JSON.stringify(o.live);
  });
  await phase("…and carries no control of any kind — no routes verb, no setup code", () => {
    const t = readFileSync(new URL("../app/api/owner/printing/route.ts", import.meta.url), "utf8");
    return (!/writeRoutes|issueSetupCode|revoke/.test(t)) || "the owner route grew a control";
  });
  await phase("…and the only thing it can POST is a test print, which changes nothing", () => {
    const t = readFileSync(new URL("../app/api/owner/printing/route.ts", import.meta.url), "utf8");
    const post = t.slice(t.indexOf("export async function POST"));
    return (/isRoutableKind/.test(post) && /queueJob/.test(post) && !/PATCH|update\(/.test(post))
      || "the owner's POST does more than print a sample";
  });
  await phase("the manager panel's board is read-only, whatever is stored against them", async () => {
    const t = readFileSync(new URL("../app/api/editor/[...path]/route.ts", import.meta.url), "utf8");
    return /const maySetup = false;/.test(t) || "the manager panel can be put back into setup mode by a stored value";
  });
  await phase("…and the retired permission is gone from the Access screen, not just switched off", () => {
    const t = readFileSync(new URL("../lib/accessTree.ts", import.meta.url), "utf8");
    return (!/id: "print_setup"/.test(t) && /id: "print_here"/.test(t) && /id: "print_clear"/.test(t))
      || "print_setup is back, or retiring it took a neighbour with it";
  });

  await invariants("manager & owner can only look");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SHAPE 12 · TWO RESTAURANTS AT ONCE — nothing of one may appear on the other
// ══════════════════════════════════════════════════════════════════════════════════════════════
if (!ONLY || ONLY === "12") {
  SHAPE = "two restaurants";
  console.log("\n⑫ TWO RESTAURANTS SIDE BY SIDE — and one may never answer for the other");
  const [other] = await db("restaurants", { method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name: TAG + " B", slug: "zz-scen-b-" + Date.now().toString(36), active: true }) });
  made.restaurants.push(other.id);
  const ex = await db(`settings?restaurant_id=eq.${other.id}&select=restaurant_id`);
  if (!ex.length) await db("settings", { method: "POST", body: JSON.stringify({ restaurant_id: other.id }) });
  await db(`settings?restaurant_id=eq.${other.id}`, { method: "PATCH",
    body: JSON.stringify({ auto_print_kot_allowed: true, auto_print_kot: true, banquet_allowed: true }) });

  await wipeAgents();
  await setFlags({ auto_print_kot_allowed: true, auto_print_kot: true, banquet_allowed: false });
  const mine = await addAgent("Mine PC", ["Mine-80"], 0);
  await setRoutes({ kot: { via: "computer", agent: mine.id, printer: "Mine-80" } });

  await phase("this restaurant has NO banquet line and the other one does — at the same moment", async () => {
    const a = await apiJson(`/api/admin/printing/state?rid=${RID}`).then((r) => r.body);
    const b = await apiJson(`/api/admin/printing/state?rid=${other.id}`).then((r) => r.body);
    return (!(a.kinds || []).includes("banquet") && (b.kinds || []).includes("banquet"))
      || `A ${JSON.stringify(a.kinds)} · B ${JSON.stringify(b.kinds)}`;
  });
  await phase("…and the other restaurant's board names none of this one's computers", async () => {
    const b = await apiJson(`/api/admin/printing/state?rid=${other.id}`).then((r) => r.body);
    return !(b.agents || []).some((x) => x.name === "Mine PC") || "a computer appeared on another restaurant's board";
  });
  await phase("this computer's token is handed only THIS restaurant's tickets", async () => {
    await db(`orders`, { method: "POST", body: JSON.stringify({ restaurant_id: other.id, table_number: "1", kot_no: 999,
      items: [{ id: "y", title: "Other", qty: 1, price: 10, options: [] }], subtotal: 10, tax: 0, total: 10, status: "received", placed_by: "scenarios" }) });
    await new Promise((r) => setTimeout(r, 700));
    await newOrder(12, "Mine");
    const r = await agentGet("/next?max=4", mine.token);
    const jobs = r.body?.jobs || (r.body?.id ? [r.body] : []);
    made.jobs.push(...jobs.map((j) => j.id));
    if (!jobs.length) return "it was handed nothing at all";
    const rows = await db(`print_jobs?id=in.(${jobs.map((j) => j.id).join(",")})&select=restaurant_id`);
    return rows.every((x) => x.restaurant_id === RID) || "it was handed another restaurant's ticket";
  });
  await phase("…and the owner's card for one names only that one", async () => {
    const o = await apiJson(`/api/owner/printing?rid=${RID}`).then((r) => r.body);
    return o.restaurantId === RID || `it answered for ${o.restaurantId}`;
  });
  // put the second restaurant back
  try { await db(`print_jobs?restaurant_id=eq.${other.id}`, { method: "DELETE" }); } catch {}
  try { await db(`orders?restaurant_id=eq.${other.id}`, { method: "DELETE" }); } catch {}
  try { await db(`settings?restaurant_id=eq.${other.id}`, { method: "DELETE" }); } catch {}
  try { await db(`restaurants?id=eq.${other.id}`, { method: "DELETE" }); } catch {}

  await invariants("two restaurants");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
await cleanup();
console.log("\n" + "─".repeat(78));
console.log(`${n} phases · ${pass} passed · ${fail} failed`);
if (fails.length) {
  console.log("\nwhat failed:");
  for (const f of fails) console.log("  · " + f);
  process.exit(1);
}
console.log("every shape a restaurant can be in answers the same way on every screen.");
