// Bank E · lib/printHelpers.ts — the address book (which computer prints which paper), the claim, and
// the "is it working right now" rows three screens share. Real exports, in-memory database, two
// restaurants.
import { createHash } from "node:crypto";
import { load, chk, assert, eq } from "./lib.mjs";
import { memDb } from "./memdb.mjs";

const F = "lib/printHelpers.ts";
const H = "node: the real export, bundled, against an in-memory database with two restaurants";
const h = await load(F);
const RA = "rest-a", RB = "rest-b";
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const sha = (s) => createHash("sha256").update(s).digest("hex");
const settings = (rid, routes = {}, more = {}) => ({ restaurant_id: rid, auto_print_kot: true, auto_print_kot_allowed: true, modules: { printing: { routes, ...(more.printing || {}) } }, ...more.row });
const agent = (o) => ({ restaurant_id: RA, name: "PC", fingerprint: null, seen_fingerprints: null, printers: [{ name: "POS80" }, { name: "Bills" }], last_seen_at: ago(3000), revoked_at: null, created_at: ago(9e6), token_hash: "x", ...o });
const use = (init, extra = {}) => { const db = memDb(init); globalThis.__t15 = { sb: db, ladders: () => ({ banquet: { effective: extra.banquet !== false } }) }; return db; };

// ── tokens ──────────────────────────────────────────────────────────────────────────────────
await chk("P184231", F, "a minted printing token starts lfhp_ and carries 24 random bytes", H, () => { const t = h.mintAgentToken(); assert(/^lfhp_[A-Za-z0-9_-]{32}$/.test(t.token), t.token); eq(t.hash, sha(t.token)); });
await chk("P184232", F, "…two mints are never the same", H, () => { const s = new Set(Array.from({ length: 200 }, () => h.mintAgentToken().token)); eq(s.size, 200); });
await chk("P184233", F, "agentByToken finds a computer by the HASH of its token", H, async () => {
  const t = h.mintAgentToken(); use({ print_agents: [agent({ id: "a1", token_hash: t.hash })] }); eq((await h.agentByToken(t.token)).id, "a1");
});
await chk("P184234", F, "…an unlinked (revoked) computer's token answers nothing", H, async () => {
  const t = h.mintAgentToken(); use({ print_agents: [agent({ id: "a1", token_hash: t.hash, revoked_at: ago(1) })] }); eq(await h.agentByToken(t.token), null);
});
await chk("P184235", F, "…a token under 20 characters is refused without a database read", H, async () => { const db = use({ print_agents: [] }); eq(await h.agentByToken("short"), null); eq(db.log.length, 0); });
await chk("P184236", F, "…its read names its columns and never returns token_hash", H, async () => {
  const t = h.mintAgentToken(); const db = use({ print_agents: [agent({ id: "a1", token_hash: t.hash })] }); const a = await h.agentByToken(t.token);
  assert(!("token_hash" in a), "token_hash came back"); const sel = db.log[0].ops.find(([k]) => k === "select")[1]; assert(!/\*|token_hash/.test(sel), sel);
});
await chk("P184237", F, "createAgent stores only the hash and hands the token back once", H, async () => {
  const db = use({ print_agents: [] }); const r = await h.createAgent(RA, "Front"); eq(db.tables.print_agents[0].token_hash, sha(r.token)); assert(!JSON.stringify(db.tables.print_agents[0]).includes(r.token));
});
await chk("P184238", F, "…an empty name becomes 'New computer'; a long one is cut to 60", H, async () => {
  const db = use({ print_agents: [] }); await h.createAgent(RA, "  "); await h.createAgent(RA, "N".repeat(200)); eq(db.tables.print_agents.map((a) => a.name.length), [12, 60]); eq(db.tables.print_agents[0].name, "New computer");
});
await chk("P184239", F, "…a clashing name is a plain sentence, never a database word", H, async () => {
  const db = memDb({ print_agents: [{ id: "x", restaurant_id: RA, name: "Front" }] }, { unique: { print_agents: [["restaurant_id", "name"]] } }); globalThis.__t15 = { sb: db };
  eq((await h.createAgent(RA, "Front")).error, "There is already a computer with that name.");
});

// ── helloAgent ──────────────────────────────────────────────────────────────────────────────
await chk("P184240", F, "hello stamps 'seen now' and remembers the printers the machine reports", H, async () => {
  const db = use({ print_agents: [agent({ id: "a1", last_seen_at: null })] }); await h.helloAgent({ ...db.tables.print_agents[0] }, { printers: [{ name: "New1" }] });
  assert(db.tables.print_agents[0].last_seen_at); eq(db.tables.print_agents[0].printers.map((p) => p.name), ["New1"]);
});
await chk("P184241", F, "…an empty printer list does NOT wipe the remembered printers", H, async () => {
  const db = use({ print_agents: [agent({ id: "a1" })] }); await h.helloAgent({ ...db.tables.print_agents[0], printers: [] }, { printers: [] }); eq(db.tables.print_agents[0].printers.length, 2);
});
await chk("P184242", F, "…the first fingerprint is kept; a second one is a clash the board shows", H, async () => {
  const db = use({ print_agents: [agent({ id: "a1", fingerprint: "fp1" })] }); const r = await h.helloAgent({ ...db.tables.print_agents[0] }, { fingerprint: "fp2" });
  eq(r.clash, true); eq(db.tables.print_agents[0].fingerprint, "fp1"); eq(db.tables.print_agents[0].seen_fingerprints.sort(), ["fp1", "fp2"]);
});
await chk("P184243", F, "…the same machine saying hello again is not a clash", H, async () => { const db = use({ print_agents: [agent({ id: "a1", fingerprint: "fp1" })] }); eq((await h.helloAgent({ ...db.tables.print_agents[0] }, { fingerprint: "fp1" })).clash, false); });
await chk("P184244", F, "…a reported printer state is kept only when it is one of the four words", H, async () => {
  const db = use({ print_agents: [agent({ id: "a1" })] }); await h.helloAgent({ ...db.tables.print_agents[0] }, { printers: [{ name: "A", state: "ready" }, { name: "B", state: "on fire" }] });
  eq(db.tables.print_agents[0].printers.map((p) => p.state ?? null), ["ready", null]);
});
await chk("P184245", F, "touchAgent writes 'seen now' at most once every ten seconds", H, async () => {
  const db = use({ print_agents: [agent({ id: "a1", last_seen_at: ago(2000) })] }); await h.touchAgent(db.tables.print_agents[0]); eq(db.log.length, 0);
  db.tables.print_agents[0].last_seen_at = ago(15_000); await h.touchAgent({ ...db.tables.print_agents[0] }); eq(db.log.length, 1);
});
await chk("P184246", F, "…and that write is scoped to the computer's own restaurant", H, async () => {
  const db = use({ print_agents: [agent({ id: "a1", last_seen_at: ago(60_000) })] }); await h.touchAgent({ id: "a1", restaurant_id: RB, last_seen_at: ago(60_000) });
  assert(Date.now() - Date.parse(db.tables.print_agents[0].last_seen_at) > 50_000, "a row was touched through the wrong restaurant");
});

// ── agentsView ──────────────────────────────────────────────────────────────────────────────
await chk("P184247", F, "agentsView lists this restaurant's linked computers, oldest first", H, async () => {
  use({ print_agents: [agent({ id: "b", created_at: ago(1000) }), agent({ id: "a", created_at: ago(9000) }), agent({ id: "x", restaurant_id: RB }), agent({ id: "r", revoked_at: ago(1) })] });
  eq((await h.agentsView(RA)).map((a) => a.id), ["a", "b"]);
});
await chk("P184248", F, "…'connected' means heard from within thirty seconds", H, async () => {
  use({ print_agents: [agent({ id: "a", last_seen_at: ago(10_000) }), agent({ id: "b", last_seen_at: ago(45_000) }), agent({ id: "c", last_seen_at: null })] });
  eq((await h.agentsView(RA)).map((a) => a.connected), [true, false, false]);
});
await chk("P184249", F, "…a computer never heard from has secondsAgo null, not 0", H, async () => { use({ print_agents: [agent({ id: "c", last_seen_at: null })] }); eq((await h.agentsView(RA))[0].secondsAgo, null); });
await chk("P184250", F, "…a code used on two machines is flagged on the board", H, async () => { use({ print_agents: [agent({ id: "a", seen_fingerprints: ["x", "y"] })] }); eq((await h.agentsView(RA))[0].fingerprintClash, true); });
await chk("P184251", F, "…the list is capped at 200 rows", H, async () => { const db = use({ print_agents: [] }); await h.agentsView(RA); eq(db.log[0].ops.find(([k]) => k === "limit")[1], 200); });
await chk("P184252", F, "agentForDevice finds the computer the issuing screen owns, and nobody else's", H, async () => {
  use({ print_agents: [agent({ id: "a", owner_device: "dev1" }), agent({ id: "b", owner_device: "dev2", restaurant_id: RB })] });
  eq((await h.agentForDevice(RA, "dev1")).id, "a"); eq(await h.agentForDevice(RA, "dev2"), null); eq(await h.agentForDevice(RA, ""), null);
});

// ── readRoutes / readRoutesChecked ──────────────────────────────────────────────────────────
await chk("P184253", F, "readRoutes answers all four kinds, empty where nothing is set", H, async () => { use({ settings: [settings(RA, {})] }); eq(Object.keys(await h.readRoutes(RA)).sort(), ["banquet", "bill", "kot", "test"]); });
await chk("P184254", F, "…a stored computer line reads back as via 'computer'", H, async () => { use({ settings: [settings(RA, { bill: { agent: "a", printer: "Bills" } })] }); eq((await h.readRoutes(RA)).bill.via, "computer"); });
await chk("P184255", F, "…'off' and 'screen' read back as themselves", H, async () => {
  use({ settings: [settings(RA, { kot: { via: "off" }, bill: { via: "screen", panel: "manager" } })] }); const r = await h.readRoutes(RA); eq([r.kot.via, r.bill.via, r.bill.panel], ["off", "screen", "manager"]);
});
await chk("P184256", F, "…an unknown panel name is dropped, never trusted", H, async () => { use({ settings: [settings(RA, { kot: { via: "screen", panel: "boss" } })] }); eq((await h.readRoutes(RA)).kot.panel, null); });
await chk("P184257", F, "…a FAILED read is told apart from 'nothing set up' (failed:true), so nothing is saved over it", H, async () => {
  globalThis.__t15 = { sb: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "timeout" } }) }) }) }) } };
  const orig = console.error; console.error = () => {}; try { eq((await h.readRoutesChecked(RA)).failed, true); } finally { console.error = orig; }
});
await chk("P184258", F, "…another restaurant's routes are never read", H, async () => { use({ settings: [settings(RB, { bill: { agent: "a", printer: "P" } })] }); eq((await h.readRoutes(RA)).bill.agent, null); });

// ── writeRoutes ─────────────────────────────────────────────────────────────────────────────
const W = (routes = {}, agents = [agent({ id: "a1" })]) => use({ settings: [settings(RA, routes), settings(RB, { bill: { agent: "zz", printer: "Theirs" } })], print_agents: agents,
  staff_users: [{ id: "u-k", restaurant_id: RA, name: "Cook", role: "kitchen", active: true }, { id: "u-m", restaurant_id: RA, name: "Mina", role: "manager", active: true },
    { id: "u-off", restaurant_id: RA, name: "Gone", role: "manager", active: false }, { id: "u-b", restaurant_id: RB, name: "Other", role: "manager", active: true }] });
const saved = (db, rid = RA) => db.tables.settings.find((s) => s.restaurant_id === rid).modules.printing.routes;
await chk("P184259", F, "writeRoutes points a paper at one of this restaurant's computers and one of ITS printers", H, async () => {
  const db = W(); const r = await h.writeRoutes(RA, { bill: { agent: "a1", printer: "Bills" } }); assert(!("error" in r)); eq([saved(db).bill.agent, saved(db).bill.printer, saved(db).bill.via], ["a1", "Bills", "computer"]);
});
await chk("P184260", F, "…a computer that is not this restaurant's is refused", H, async () => {
  const db = W({}, [agent({ id: "a1" }), agent({ id: "theirs", restaurant_id: RB })]); eq((await h.writeRoutes(RA, { bill: { agent: "theirs", printer: "POS80" } })).error, "That computer is not one of this restaurant's.");
  eq(saved(db).bill, undefined);
});
await chk("P184261", F, "…a printer the computer never reported is refused, by name", H, async () => { W(); assert(/has no printer called "Ghost"/.test((await h.writeRoutes(RA, { bill: { agent: "a1", printer: "Ghost" } })).error)); });
await chk("P184262", F, "…an UNLINKED computer cannot be chosen", H, async () => { W({}, [agent({ id: "a1", revoked_at: ago(1) })]); assert("error" in await h.writeRoutes(RA, { bill: { agent: "a1", printer: "Bills" } })); });
await chk("P184263", F, "…half a line (a computer and no printer) is refused with one sentence", H, async () => { W(); eq((await h.writeRoutes(RA, { bill: { agent: "a1" } })).error, "Pick both a computer and one of its printers."); });
await chk("P184264", F, "…a kind of paper that does not exist is refused", H, async () => { W(); assert(/no such kind of paper/.test((await h.writeRoutes(RA, { menu: null })).error)); });
await chk("P184265", F, "…'off' is saved as a decision (nobody prints it)", H, async () => { const db = W(); await h.writeRoutes(RA, { kot: { via: "off" } }); eq(saved(db).kot, { via: "off", agent: null, printer: null }); });
await chk("P184266", F, "…null clears a line back to 'not decided'", H, async () => { const db = W({ bill: { agent: "a1", printer: "Bills" } }); await h.writeRoutes(RA, { bill: null }); eq(saved(db).bill, { agent: null, printer: null }); });
await chk("P184267", F, "…a screen line needs a real panel name", H, async () => { W(); assert(/Pick which screen prints it/.test((await h.writeRoutes(RA, { kot: { via: "screen", panel: "boss" } })).error)); });
await chk("P184268", F, "…a screen line for a PERSON must be one of this restaurant's staff", H, async () => { W(); eq((await h.writeRoutes(RA, { kot: { via: "screen", panel: "manager", person: "u-b" } })).error, "That person is not one of this restaurant's staff."); });
await chk("P184269", F, "…a switched-off person cannot be the printer", H, async () => { W(); assert(/switched off/.test((await h.writeRoutes(RA, { kot: { via: "screen", panel: "manager", person: "u-off" } })).error)); });
await chk("P184270", F, "…a person whose role cannot stand at that panel is refused (a cook is not the manager panel)", H, async () => { W(); assert(/is a kitchen, so their screen is not the manager panel/.test((await h.writeRoutes(RA, { kot: { via: "screen", panel: "manager", person: "u-k" } })).error)); });
await chk("P184271", F, "…a fitting person is saved with their name remembered for the screens", H, async () => {
  const db = W(); await h.writeRoutes(RA, { kot: { via: "screen", panel: "manager", person: "u-m" } }); eq([saved(db).kot.person, saved(db).kot.personName], ["u-m", "Mina"]);
});
await chk("P184272", F, "…writing one line leaves the other lines exactly as they were", H, async () => {
  const db = W({ kot: { via: "off" }, bill: { agent: "a1", printer: "Bills" } }); await h.writeRoutes(RA, { banquet: { via: "off" } }); eq([saved(db).kot.via, saved(db).bill.printer], ["off", "Bills"]);
});
await chk("P184273", F, "…and never another restaurant's address book", H, async () => { const db = W(); await h.writeRoutes(RA, { bill: { via: "off" } }); eq(saved(db, RB).bill, { agent: "zz", printer: "Theirs" }); });
await chk("P184274", F, "…other module settings in the same bag survive a routes save", H, async () => {
  const db = W(); db.tables.settings[0].modules.loyalty = { on: true }; db.tables.settings[0].modules.printing.paused = true;
  await h.writeRoutes(RA, { bill: { via: "off" } }); eq(db.tables.settings[0].modules.loyalty, { on: true }); eq(db.tables.settings[0].modules.printing.paused, true);
});
await chk("P184275", F, "FIRST SAVE WINS: a line somebody else changed since the board loaded is refused, and says so", H, async () => {
  const db = W({ bill: { agent: "a1", printer: "Bills" } }); const r = await h.writeRoutes(RA, { bill: { via: "off" } }, { bill: { agent: null, printer: null } });
  eq(r.clash, true); assert(/Somebody else changed this line/.test(r.error)); eq(saved(db).bill.printer, "Bills");
});
await chk("P184276", F, "…an unchanged line is saved even though another line moved (only the lines being written are compared)", H, async () => {
  const db = W({ bill: { agent: "a1", printer: "Bills" }, kot: { via: "off" } });
  const r = await h.writeRoutes(RA, { bill: { via: "off" } }, { bill: { agent: "a1", printer: "Bills", via: "computer" } }); assert(!("error" in r), JSON.stringify(r)); eq(saved(db).bill.via, "off");
});
await chk("P184277", F, "…a save that sends no 'was' is never refused as a clash (older callers keep working)", H, async () => { W({ bill: { agent: "a1", printer: "Bills" } }); assert(!("error" in await h.writeRoutes(RA, { bill: { via: "off" } }))); });
await chk("P184278", F, "…a restaurant with no settings row is told so instead of 'saved'", H, async () => {
  use({ settings: [], print_agents: [agent({ id: "a1" })] }); assert(/no settings yet/.test((await h.writeRoutes(RA, { bill: { via: "off" } })).error));
});

// ── claimSome / claimNext ───────────────────────────────────────────────────────────────────
const pj = (o) => ({ restaurant_id: RA, status: "queued", attempts: 0, reprint: false, claimed_at: null, created_at: ago(5000), payload: {}, agent_id: null, printer: null, ...o });
const C = (routes, jobs, s = {}) => use({ settings: [settings(RA, routes, s)], print_jobs: jobs, print_agents: [] });
const A1 = agent({ id: "a1", name: "Front PC" });
await chk("P184279", F, "claimSome hands a computer the papers routed to it, and records it as the printer", H, async () => {
  const db = C({ bill: { agent: "a1", printer: "Bills" } }, [pj({ id: "b1", kind: "bill" })]); const r = await h.claimSome(RA, A1, { max: 4 });
  eq(r.map((x) => [x.id, x.printer]), [["b1", "Bills"]]); const j = db.tables.print_jobs[0]; eq([j.status, j.agent_id, j.printed_by], ["printing", "a1", "Front PC"]);
});
await chk("P184280", F, "…never a paper routed to a different computer", H, async () => { C({ bill: { agent: "a2", printer: "Bills" } }, [pj({ id: "b1", kind: "bill" })]); eq((await h.claimSome(RA, A1, { max: 4 })).length, 0); });
await chk("P184281", F, "…a job queued FOR this computer (a test page) is handed over even with no route", H, async () => {
  C({}, [pj({ id: "t1", kind: "test", agent_id: "a1", printer: "POS80" })]); eq((await h.claimSome(RA, A1, { max: 4 })).map((x) => x.printer), ["POS80"]);
});
await chk("P184282", F, "…never another restaurant's job, whatever its route says", H, async () => {
  C({ bill: { agent: "a1", printer: "Bills" } }, [pj({ id: "x", kind: "bill", restaurant_id: RB })]); eq((await h.claimSome(RA, A1, { max: 4 })).length, 0);
});
await chk("P184283", F, "…at most two jobs per printer in one batch, so a bill never queues behind four slips on another printer", H, async () => {
  C({ kot: { agent: "a1", printer: "POS80" }, bill: { agent: "a1", printer: "Bills" } },
    [1, 2, 3, 4].map((i) => pj({ id: "k" + i, kind: "kot", created_at: ago(10_000 - i) })).concat([pj({ id: "b1", kind: "bill", created_at: ago(100) })]));
  const r = await h.claimSome(RA, A1, { max: 4 }); eq(r.filter((x) => x.printer === "POS80").length, 2); assert(r.some((x) => x.id === "b1"), "the bill waited behind the slips");
});
await chk("P184284", F, "…max is clamped to 1–4 whatever the helper asks for", H, async () => {
  C({ bill: { agent: "a1", printer: "Bills" }, kot: { agent: "a1", printer: "POS80" }, banquet: { agent: "a1", printer: "Wide" } }, Array.from({ length: 12 }, (_, i) => pj({ id: "j" + i, kind: ["kot", "bill", "banquet"][i % 3], created_at: ago(9000 - i) })));
  eq((await h.claimSome(RA, A1, { max: 99 })).length, 4);
});
await chk("P184285", F, "…kitchen slips are held back when automatic slip printing is off — bills still come out", H, async () => {
  C({ kot: { agent: "a1", printer: "POS80" }, bill: { agent: "a1", printer: "Bills" } }, [pj({ id: "k", kind: "kot" }), pj({ id: "b", kind: "bill" })], { row: { auto_print_kot: false } });
  eq((await h.claimSome(RA, A1, { max: 4 })).map((x) => x.id), ["b"]);
});
await chk("P184286", F, "…a job another computer has just claimed is not taken (claimed under two minutes ago)", H, async () => {
  C({ bill: { agent: "a1", printer: "Bills" } }, [pj({ id: "b", kind: "bill", status: "printing", claimed_at: ago(10_000), agent_id: "a2" })]); eq((await h.claimSome(RA, A1, { max: 4 })).length, 0);
});
await chk("P184287", F, "…two computers racing for one job: exactly one wins", H, async () => {
  C({ bill: { agent: "a1", printer: "Bills" } }, [pj({ id: "b", kind: "bill" })]); const [x, y] = await Promise.all([h.claimSome(RA, A1, { max: 1 }), h.claimSome(RA, A1, { max: 1 })]); eq(x.length + y.length, 1);
});
await chk("P184288", F, "…oldest first", H, async () => {
  C({ bill: { agent: "a1", printer: "Bills" } }, [pj({ id: "new", kind: "bill", created_at: ago(1000) }), pj({ id: "old", kind: "bill", created_at: ago(9000) })]); eq((await h.claimNext(RA, A1)).id, "old");
});
await chk("P184289", F, "…an unknown kind sitting in the queue is skipped, not handed to a printer", H, async () => { C({}, [pj({ id: "w", kind: "weird", agent_id: "a1", printer: "POS80" })]); eq((await h.claimSome(RA, A1, { max: 4 })).length, 0); });

// ── queueJob / syncKotSwitch / waiting ──────────────────────────────────────────────────────
await chk("P184290", F, "queueJob queues a paper for the computer its route names", H, async () => {
  const db = use({ settings: [settings(RA, { bill: { agent: "a1", printer: "Bills" } })], print_jobs: [] }); const r = await h.queueJob(RA, "bill", { sessionId: "s" });
  assert(r.id); const j = db.tables.print_jobs[0]; eq([j.restaurant_id, j.agent_id, j.printer, j.status], [RA, "a1", "Bills", "queued"]);
});
await chk("P184291", F, "…a paper switched 'off' is not queued; with no route it says no-route", H, async () => {
  use({ settings: [settings(RA, { kot: { via: "off" } })], print_jobs: [] }); eq((await h.queueJob(RA, "kot", {})).error, "switched-off"); eq((await h.queueJob(RA, "bill", {})).error, "no-route");
});
await chk("P184292", F, "syncKotSwitch never switches slips ON for a restaurant the admin has not allowed", H, async () => {
  const db = use({ settings: [{ restaurant_id: RA, auto_print_kot: false, auto_print_kot_allowed: false }] }); await h.syncKotSwitch(RA, true); eq(db.tables.settings[0].auto_print_kot, false);
});
await chk("P184293", F, "…and writes nothing when it is already right (no audit noise)", H, async () => {
  const db = use({ settings: [{ restaurant_id: RA, auto_print_kot: true, auto_print_kot_allowed: true }] }); await h.syncKotSwitch(RA, true); eq(db.log.filter((s) => s.ops.some(([k]) => k === "update")).length, 0);
});
await chk("P184294", F, "waitingCount counts queued+printing for this restaurant, and a failed count is null, never 0", H, async () => {
  use({ print_jobs: [pj({ id: "1" }), pj({ id: "2", status: "printing" }), pj({ id: "3", restaurant_id: RB })] }); eq(await h.waitingCount(RA), 2);
  globalThis.__t15 = { sb: { from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ count: null, error: { message: "x" } }) }) }) }) } };
  const o = console.error; console.error = () => {}; try { eq(await h.waitingCount(RA), null); } finally { console.error = o; }
});
await chk("P184295", F, "waitingByPrinter splits the queue per printer, worst first", H, async () => {
  use({ settings: [settings(RA, { kot: { agent: "a1", printer: "POS80" } })], print_jobs: [pj({ id: "1", kind: "kot", created_at: ago(5000) }), pj({ id: "2", kind: "bill", printer: "Bills", created_at: ago(90_000) })] });
  eq((await h.waitingByPrinter(RA)).map((x) => x.printer), ["Bills", "POS80"]);
});

// ── resolveTarget (through targetFor) / screenMayPrint / paperStatus ────────────────────────
const T = (routes, agents = [A1]) => use({ settings: [settings(RA, routes)], print_agents: agents });
await chk("P184296", F, "a kitchen slip with nobody named falls to the KITCHEN SCREEN (no mode, mig 372)", H, async () => { T({}); eq((await h.targetFor(RA, "kot")).kind, "screen"); eq((await h.targetFor(RA, "kot")).panel, "kitchen"); });
await chk("P184297", F, "…a bill with nobody named is the ordinary print window ('none')", H, async () => { T({}); eq((await h.targetFor(RA, "bill")).kind, "none"); });
await chk("P184298", F, "…a line pointing at an UNLINKED computer falls back the same way (a removed machine does not count)", H, async () => {
  T({ kot: { agent: "gone", printer: "POS80" }, bill: { agent: "gone", printer: "Bills" } }); eq((await h.targetFor(RA, "kot")).kind, "screen"); eq((await h.targetFor(RA, "bill")).kind, "none");
});
await chk("P184299", F, "screenMayPrint: a computer's paper is refused on every screen; 'off' is refused everywhere", H, () => {
  eq(h.screenMayPrint({ kind: "computer" }, { panel: "kitchen" }).why, "computer"); eq(h.screenMayPrint({ kind: "off" }, { panel: "kitchen" }).why, "off");
});
await chk("P184300", F, "…a person's line is refused on anybody else's screen, and allowed on theirs", H, () => {
  const t = { kind: "screen", panel: "manager", person: "u-m", personName: "Mina", device: null };
  eq(h.screenMayPrint(t, { panel: "manager", personId: "u-x" }).why, "other_person"); eq(h.screenMayPrint(t, { panel: "kitchen", personId: "u-m" }).why, "other_panel"); eq(h.screenMayPrint(t, { panel: "manager", personId: "u-m" }).ok, true);
});
await chk("P184301", F, "paperStatus: a computer that is answering reads LIVE; a sleeping one ASLEEP with what that means", H, async () => {
  use({ settings: [settings(RA, { bill: { agent: "a1", printer: "Bills" }, kot: { agent: "a2", printer: "POS80" } })], print_agents: [A1, agent({ id: "a2", name: "Back PC", last_seen_at: ago(600_000) })] });
  const s = await h.paperStatus(RA); const by = Object.fromEntries(s.map((r) => [r.kind, r]));
  eq([by.bill.state, by.kot.state], ["LIVE", "ASLEEP"]); assert(/waiting, and prints the moment it is back/.test(by.kot.words), by.kot.words);
});
await chk("P184302", F, "…a stopped queue reads STOPPED on every row, and no Test is offered", H, async () => {
  use({ settings: [settings(RA, { bill: { agent: "a1", printer: "Bills" } }, { printing: { paused: true } })], print_agents: [A1] });
  const s = await h.paperStatus(RA); assert(s.every((r) => r.state === "STOPPED" && !r.canTest), JSON.stringify(s.map((r) => r.state)));
});
await chk("P184303", F, "…banquet is not even listed for a restaurant that has not been given banquets", H, async () => {
  globalThis.__t15 = { sb: memDb({ settings: [settings(RA, {})], print_agents: [] }), ladders: () => ({ banquet: { effective: false } }) };
  eq((await h.paperStatus(RA)).map((r) => r.kind), ["kot", "bill"]);
});
await chk("P184304", F, "…kitchen slips on a computer while automatic slip printing is OFF read STOPPED, and say bills are unaffected", H, async () => {
  use({ settings: [settings(RA, { kot: { agent: "a1", printer: "POS80" } }, { row: { auto_print_kot: false } })], print_agents: [A1] });
  const k = (await h.paperStatus(RA)).find((r) => r.kind === "kot"); eq(k.state, "STOPPED"); assert(/Bills and banquet sheets are unaffected/.test(k.words));
});
await chk("P184305", F, "printingRunning: a failed read is 'on' (fail-open — a blip must not stop a restaurant's paper)", H, async () => {
  globalThis.__t15 = { sb: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }) }) } };
  const o = console.error; console.error = () => {}; try { eq(await h.printingRunning(RA), { on: true, why: null, kot: true }); } finally { console.error = o; }
});
await chk("P184306", F, "paperFor: the route's pinned paper wins; otherwise the machine's own report for that printer", H, () => {
  const ag = { printers: [{ name: "POS80", paper: { wMm: 80, hMm: 297 } }] };
  eq(h.paperFor({ paper: { wMm: 58, hMm: 200 } }, ag, "POS80"), { wMm: 58, hMm: 200 }); eq(h.paperFor({}, ag, "POS80"), { wMm: 80, hMm: 297 }); eq(h.paperFor({}, ag, "Other"), null);
});
await chk("P184307", F, "panelForRole: cook → kitchen, waiter → tablet, everyone else → manager", H, () => {
  eq(["kitchen", "waiter", "tablet", "manager", "owner", "", null].map(h.panelForRole), ["kitchen", "tablet", "tablet", "manager", "manager", "manager", "manager"]);
});
await chk("P184308", F, "isPrintKind / isRoutableKind: 'test' prints but is never routable", H, () => { eq([h.isPrintKind("test"), h.isRoutableKind("test"), h.isRoutableKind("bill"), h.isPrintKind("menu")], [true, false, true, false]); });
