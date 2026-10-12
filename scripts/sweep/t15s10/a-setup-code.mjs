// Bank A · lib/printSetupCode.ts — NEW GROUND (landed 2026-09-13, 0 ledger rows by subject before this run).
// The real exported functions, bundled, run against an in-memory database: nothing is written anywhere.
import { createHash } from "node:crypto";
import { load, chk, assert, eq, src, codeOnly } from "./lib.mjs";
import { memDb } from "./memdb.mjs";

const F = "lib/printSetupCode.ts";
const H = "node: the real export, bundled, against an in-memory database";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const RA = "rest-a", RB = "rest-b";
const m = await load(F);
const withDb = (db) => { globalThis.__t15 = { sb: db }; return db; };
const fresh = (extra = {}) => withDb(memDb({
  print_setup_codes: [], print_agents: [], restaurants: [{ id: RA, name: "Alpha Cafe" }, { id: RB, name: "Beta Bar" }], ...extra,
}, { unique: { print_setup_codes: [["code_hash"]], print_agents: [["restaurant_id", "name"]] } }));
const later = (ms) => new Date(Date.now() + ms).toISOString();
const STAMP = "abc1234";
const code0 = (db, rid = RA, over = {}) => {
  const c = "K7MP2X";
  db.tables.print_setup_codes.push({ id: "c-" + rid, restaurant_id: rid, code_hash: sha(c), claimed_at: null,
    expires_at: later(5 * 60_000), issued_device: "dev-1", issued_by: "user-1", ...over });
  return c;
};

// ── normaliseCode / prettyCode ──────────────────────────────────────────────────────────────
await chk("P184001", F, "normaliseCode upper-cases what a phone keyboard sends in lower case", H, () => eq(m.normaliseCode("k7mp2x"), "K7MP2X"));
await chk("P184002", F, "normaliseCode drops the space the screen shows between the two groups", H, () => eq(m.normaliseCode("K7M P2X"), "K7MP2X"));
await chk("P184003", F, "normaliseCode drops a dash somebody remembers seeing", H, () => eq(m.normaliseCode("K7M-P2X"), "K7MP2X"));
await chk("P184004", F, "normaliseCode drops an underscore and a middle dot", H, () => eq(m.normaliseCode("K7M_P2X·"), "K7MP2X"));
await chk("P184005", F, "normaliseCode never throws on null / undefined / a number", H, () => { eq(m.normaliseCode(null), ""); eq(m.normaliseCode(undefined), ""); eq(m.normaliseCode(123456), "123456"); });
await chk("P184006", F, "normaliseCode caps a pasted essay at 12 characters before any lookup", H, () => eq(m.normaliseCode("A".repeat(500)).length, 12));
await chk("P184007", F, "prettyCode shows two groups of three, the way the card prints it", H, () => eq(m.prettyCode("K7MP2X"), "K7M P2X"));
await chk("P184008", F, "a code read off prettyCode and typed back normalises to itself", H, () => eq(m.normaliseCode(m.prettyCode("ABC234")), "ABC234"));
await chk("P184009", F, "the life of a code is the owner's own number: ten minutes", H, () => eq(m.SETUP_CODE_TTL_MS, 600000));

// ── issueSetupCode ──────────────────────────────────────────────────────────────────────────
await chk("P184010", F, "issueSetupCode hands back a six-character code and its pretty form", H, async () => {
  fresh(); const r = await m.issueSetupCode(RA, { kind: "admin" });
  assert(!("error" in r), JSON.stringify(r)); assert(/^[A-Z2-9]{6}$/.test(r.code), r.code); eq(r.pretty, m.prettyCode(r.code));
});
await chk("P184011", F, "…every character of 200 issued codes comes from the no-look-alike alphabet (no 0 O 1 I L)", H, async () => {
  fresh(); for (let i = 0; i < 200; i++) { const r = await m.issueSetupCode(i % 2 ? RA : RB, { kind: "admin" }); assert(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/.test(r.code), r.code); }
});
await chk("P184012", F, "…the database never holds the code itself — only its sha-256", H, async () => {
  const db = fresh(); const r = await m.issueSetupCode(RA, { kind: "admin" });
  const row = db.tables.print_setup_codes[0];
  eq(row.code_hash, sha(r.code)); assert(!JSON.stringify(row).includes(r.code), "plaintext stored");
});
await chk("P184013", F, "…and expires_at is ten minutes from now, not more", H, async () => {
  const db = fresh(); const t0 = Date.now(); await m.issueSetupCode(RA, { kind: "admin" });
  const d = Date.parse(db.tables.print_setup_codes[0].expires_at) - t0; assert(d > 590_000 && d <= 601_000, `${d}ms`);
});
await chk("P184014", F, "…the reply's expiresInMs equals the stored life", H, async () => { fresh(); eq((await m.issueSetupCode(RA, { kind: "admin" })).expiresInMs, 600000); });
await chk("P184015", F, "a second press kills the first live code for that restaurant (one live code each)", H, async () => {
  const db = fresh(); await m.issueSetupCode(RA, { kind: "admin" }); const b = await m.issueSetupCode(RA, { kind: "admin" });
  const live = db.tables.print_setup_codes.filter((r) => r.restaurant_id === RA);
  eq(live.length, 1); eq(live[0].code_hash, sha(b.code));
});
await chk("P184016", F, "…and pressing it for restaurant A never touches restaurant B's live code", H, async () => {
  const db = fresh(); const b = await m.issueSetupCode(RB, { kind: "admin" }); await m.issueSetupCode(RA, { kind: "admin" });
  const rb = db.tables.print_setup_codes.filter((r) => r.restaurant_id === RB); eq(rb.length, 1); eq(rb[0].code_hash, sha(b.code));
});
await chk("P184017", F, "…a code already USED is not deleted by a new press (the record of the join stays)", H, async () => {
  const db = fresh(); db.tables.print_setup_codes.push({ id: "used", restaurant_id: RA, code_hash: "h", claimed_at: new Date().toISOString(), expires_at: later(60_000) });
  await m.issueSetupCode(RA, { kind: "admin" }); assert(db.tables.print_setup_codes.some((r) => r.id === "used"), "the used row was deleted");
});
await chk("P184018", F, "dead rows older than a minute past expiry are pruned on every issue, so the table stays small", H, async () => {
  const db = fresh(); db.tables.print_setup_codes.push({ id: "old", restaurant_id: RB, code_hash: "o", claimed_at: null, expires_at: later(-5 * 60_000) });
  await m.issueSetupCode(RA, { kind: "admin" }); assert(!db.tables.print_setup_codes.some((r) => r.id === "old"), "an expired row survived");
});
await chk("P184019", F, "…but a row that expired SECONDS ago survives the prune (the minute of grace)", H, async () => {
  const db = fresh(); db.tables.print_setup_codes.push({ id: "just", restaurant_id: RB, code_hash: "j", claimed_at: null, expires_at: later(-10_000) });
  await m.issueSetupCode(RA, { kind: "admin" }); assert(db.tables.print_setup_codes.some((r) => r.id === "just"), "pruned too early");
});
await chk("P184020", F, "who issued it is recorded — kind, person and device", H, async () => {
  const db = fresh(); await m.issueSetupCode(RA, { kind: "staff", userId: "u-9", deviceId: "dev-9" });
  const r = db.tables.print_setup_codes[0]; eq([r.issued_by_kind, r.issued_by, r.issued_device], ["staff", "u-9", "dev-9"]);
});
await chk("P184021", F, "…a device id is capped at 120 characters", H, async () => {
  const db = fresh(); await m.issueSetupCode(RA, { kind: "staff", deviceId: "d".repeat(500) }); eq(db.tables.print_setup_codes[0].issued_device.length, 120);
});
await chk("P184022", F, "a hash collision (23505) is retried, not shown to the person as a failure", H, async () => {
  const db = fresh(); let n = 0; const real = db.from;
  db.from = (t) => { const c = real(t); if (t !== "print_setup_codes") return c;
    return new Proxy(c, { get(o, k) { if (k === "insert") return (...a) => { n++; return n === 1 ? { select: () => ({ maybeSingle: async () => ({ data: null, error: { code: "23505" } }) }) } : o.insert(...a); }; return o[k]; } }); };
  const r = await m.issueSetupCode(RA, { kind: "admin" }); assert(!("error" in r), "a collision was shown as an error"); eq(n, 2);
});
await chk("P184023", F, "…any OTHER insert failure is one plain sentence, never a database word", H, async () => {
  const db = fresh(); const real = db.from;
  db.from = (t) => { const c = real(t); if (t !== "print_setup_codes") return c;
    return new Proxy(c, { get(o, k) { if (k === "insert") return () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { code: "42501", message: "permission denied for table print_setup_codes" } }) }) }); return o[k]; } }); };
  const r = await m.issueSetupCode(RA, { kind: "admin" }); assert("error" in r); assert(!/permission|table|42501/i.test(r.error), r.error);
});

// ── liveCodeState ───────────────────────────────────────────────────────────────────────────
await chk("P184024", F, "liveCodeState says a code is live and until when — and never the code", H, async () => {
  const db = fresh(); const r = await m.issueSetupCode(RA, { kind: "admin" }); const s = await m.liveCodeState(RA);
  eq(s.live, true); eq(s.expiresAt, db.tables.print_setup_codes[0].expires_at); assert(!JSON.stringify(s).includes(r.code) && !JSON.stringify(s).includes(sha(r.code)), "the code or its hash reached the board");
});
await chk("P184025", F, "…its read names its columns and never selects code_hash", H, async () => {
  const db = fresh(); await m.liveCodeState(RA); const q = db.log.find((x) => x.table === "print_setup_codes");
  const sel = q.ops.find(([k]) => k === "select")[1]; assert(!/code_hash|\*/.test(sel), sel);
});
await chk("P184026", F, "…another restaurant's live code is invisible to it", H, async () => { fresh(); await m.issueSetupCode(RB, { kind: "admin" }); eq((await m.liveCodeState(RA)).live, false); });
await chk("P184027", F, "…an expired code reads as not live", H, async () => { const db = fresh(); code0(db, RA, { expires_at: later(-1000) }); eq((await m.liveCodeState(RA)).live, false); });
await chk("P184028", F, "…a spent code reads as not live", H, async () => { const db = fresh(); code0(db, RA, { claimed_at: new Date().toISOString() }); eq((await m.liveCodeState(RA)).live, false); });
await chk("P184029", F, "…and it carries the 'an old helper file tried this code' moment for the board (mig 381)", H, async () => {
  const db = fresh(); code0(db, RA, { refused_old_file_at: "2026-10-12T00:00:00Z" }); eq((await m.liveCodeState(RA)).oldFileAt, "2026-10-12T00:00:00Z");
});

// ── claimSetupCode: every wrong answer is the same answer ───────────────────────────────────
const M = { hostname: "Front PC", helper: STAMP, printers: [{ name: "POS80" }] };
await chk("P184030", F, "a code that is not six letters is refused WITHOUT touching the database", H, async () => {
  const db = fresh(); const r = await m.claimSetupCode("12", M); eq([r.ok, r.reason], [false, "bad"]); eq(db.log.length, 0);
});
await chk("P184031", F, "…a code with a look-alike character (0, O, 1, I) is refused the same way, no lookup", H, async () => {
  const db = fresh(); for (const c of ["K7MP2O", "K7MP20", "K7MP21", "K7MP2I"]) eq((await m.claimSetupCode(c, M)).reason, "bad"); eq(db.log.length, 0);
});
await chk("P184032", F, "an unknown code gets the one wrong-code sentence", H, async () => {
  fresh(); const r = await m.claimSetupCode("ZZZZZZ", M); eq(r.ok, false); assert(/not right, or it has run out/.test(r.error), r.error);
});
await chk("P184033", F, "…a spent code reads, word for word, like an unknown one", H, async () => {
  const db = fresh(); const c = code0(db, RA, { claimed_at: new Date().toISOString() });
  eq((await m.claimSetupCode(c, M)).error, (await m.claimSetupCode("ZZZZZZ", M)).error);
});
await chk("P184034", F, "…an expired code reads, word for word, like an unknown one", H, async () => {
  const db = fresh(); const c = code0(db, RA, { expires_at: later(-1000) });
  eq((await m.claimSetupCode(c, M)).error, (await m.claimSetupCode("ZZZZZZ", M)).error);
});
await chk("P184035", F, "an unstamped (pre-2026-09-13) helper with a WRONG code is told 'wrong code', not 'old file'", H, async () => {
  fresh(); const r = await m.claimSetupCode("ZZZZZZ", { hostname: "x" }); eq(r.reason, "bad");
});
await chk("P184036", F, "an unstamped helper with a GOOD code is told its file is out of date — and the code is NOT spent", H, async () => {
  const db = fresh(); const c = code0(db); const r = await m.claimSetupCode(c, { hostname: "x" });
  eq(r.reason, "oldfile"); eq(db.tables.print_setup_codes[0].claimed_at, null); eq(db.tables.print_agents.length, 0);
});
await chk("P184037", F, "…and the board is told so (refused_old_file_at is stamped on that code only)", H, async () => {
  const db = fresh(); const c = code0(db); code0(db, RB); db.tables.print_setup_codes[1].code_hash = "other";
  await m.claimSetupCode(c, { hostname: "x" });
  assert(db.tables.print_setup_codes[0].refused_old_file_at, "not stamped"); assert(!db.tables.print_setup_codes[1].refused_old_file_at, "stamped another restaurant's code");
});
await chk("P184038", F, "…the same code then works the moment the current file is used", H, async () => {
  const db = fresh(); const c = code0(db); await m.claimSetupCode(c, { hostname: "x" }); const r = await m.claimSetupCode(c, M); eq(r.ok, true);
});
await chk("P184039", F, "the space and lower case a person types are accepted on the claim too", H, async () => {
  const db = fresh(); code0(db); const r = await m.claimSetupCode("k7m p2x", M); eq(r.ok, true);
});

// ── claimSetupCode: a good code ─────────────────────────────────────────────────────────────
await chk("P184040", F, "a good code makes ONE computer, in the code's restaurant, and hands back a token", H, async () => {
  const db = fresh(); const c = code0(db, RB); const r = await m.claimSetupCode(c, M);
  eq(r.ok, true); eq(db.tables.print_agents.length, 1); eq(db.tables.print_agents[0].restaurant_id, RB); assert(/^lfhp_/.test(r.token), r.token);
});
await chk("P184041", F, "…the token is stored only as its hash", H, async () => {
  const db = fresh(); const c = code0(db); const r = await m.claimSetupCode(c, M); const a = db.tables.print_agents[0];
  eq(a.token_hash, sha(r.token)); assert(!JSON.stringify(a).includes(r.token), "token stored in the clear");
});
await chk("P184042", F, "…the machine has no say in which restaurant it joins (a restaurant_id in its body is ignored)", H, async () => {
  const db = fresh(); const c = code0(db, RA); await m.claimSetupCode(c, { ...M, restaurant_id: RB, rid: RB }); eq(db.tables.print_agents[0].restaurant_id, RA);
});
await chk("P184043", F, "…the code is spent: a second claim with it is the wrong-code answer", H, async () => {
  const db = fresh(); const c = code0(db); await m.claimSetupCode(c, M); const r = await m.claimSetupCode(c, M); eq(r.ok, false); eq(db.tables.print_agents.length, 1);
});
await chk("P184044", F, "…the spent row records which host claimed it and which computer it made", H, async () => {
  const db = fresh(); const c = code0(db); const r = await m.claimSetupCode(c, M); const row = db.tables.print_setup_codes[0];
  eq(row.claimed_host, "Front PC"); eq(row.agent_id, r.agentId); assert(row.claimed_at, "no claimed_at");
});
await chk("P184045", F, "…the computer is named after the machine's own hostname — nobody types a name", H, async () => {
  const db = fresh(); const c = code0(db); const r = await m.claimSetupCode(c, M); eq(r.name, "Front PC"); eq(db.tables.print_agents[0].name, "Front PC");
});
await chk("P184046", F, "…a machine that reports no hostname is 'This computer', not refused", H, async () => {
  const db = fresh(); const c = code0(db); const r = await m.claimSetupCode(c, { helper: STAMP }); eq(r.name, "This computer");
});
await chk("P184047", F, "…a second machine with the SAME hostname is told apart as '(2)', never refused", H, async () => {
  const db = fresh(); code0(db); await m.claimSetupCode("K7MP2X", M);
  db.tables.print_setup_codes.push({ id: "c2", restaurant_id: RA, code_hash: sha("ABC234"), claimed_at: null, expires_at: later(60_000) });
  const r = await m.claimSetupCode("ABC234", M); eq(r.ok, true); eq(r.name, "Front PC (2)");
});
await chk("P184048", F, "…an UNLINKED computer's name still counts, so re-linking the same PC is suffixed, not a uniqueness error", H, async () => {
  const db = fresh(); db.tables.print_agents.push({ id: "old", restaurant_id: RA, name: "Front PC", revoked_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), created_at: later(-86400000) });
  code0(db); const r = await m.claimSetupCode("K7MP2X", M); eq(r.ok, true); eq(r.name, "Front PC (2)");
});
await chk("P184049", F, "…the same name in ANOTHER restaurant does not push this one to '(2)'", H, async () => {
  const db = fresh(); db.tables.print_agents.push({ id: "b1", restaurant_id: RB, name: "Front PC", revoked_at: null, last_seen_at: new Date().toISOString(), created_at: later(-86400000) });
  code0(db, RA); eq((await m.claimSetupCode("K7MP2X", M)).name, "Front PC");
});
await chk("P184050", F, "a setup that never finished (never said hello, older than ten minutes) gives its name back", H, async () => {
  const db = fresh(); db.tables.print_agents.push({ id: "ghost", restaurant_id: RA, name: "Front PC", revoked_at: null, last_seen_at: null, created_at: later(-20 * 60_000) });
  code0(db); const r = await m.claimSetupCode("K7MP2X", M); eq(r.name, "Front PC");
  const g = db.tables.print_agents.find((x) => x.id === "ghost"); assert(g.revoked_at && /never started/.test(g.name), JSON.stringify(g));
});
await chk("P184051", F, "…a computer that DID say hello is never treated as a ghost", H, async () => {
  const db = fresh(); db.tables.print_agents.push({ id: "real", restaurant_id: RA, name: "Front PC", revoked_at: null, last_seen_at: later(-60 * 60_000), created_at: later(-20 * 60_000) });
  code0(db); const r = await m.claimSetupCode("K7MP2X", M); eq(r.name, "Front PC (2)"); eq(db.tables.print_agents.find((x) => x.id === "real").revoked_at, null);
});
await chk("P184052", F, "…a row inside its first ten minutes is never treated as a ghost (it may be mid-setup)", H, async () => {
  const db = fresh(); db.tables.print_agents.push({ id: "young", restaurant_id: RA, name: "Front PC", revoked_at: null, last_seen_at: null, created_at: later(-2 * 60_000) });
  code0(db); eq((await m.claimSetupCode("K7MP2X", M)).name, "Front PC (2)");
});
await chk("P184053", F, "…ANOTHER restaurant's ghost with the same name is left exactly as it was", H, async () => {
  const db = fresh(); db.tables.print_agents.push({ id: "bghost", restaurant_id: RB, name: "Front PC", revoked_at: null, last_seen_at: null, created_at: later(-20 * 60_000) });
  code0(db, RA); await m.claimSetupCode("K7MP2X", M); const g = db.tables.print_agents.find((x) => x.id === "bghost"); eq([g.name, g.revoked_at], ["Front PC", null]);
});
await chk("P184054", F, "the computer remembers the device and person that issued the code (mig 367 — its own panel finds it)", H, async () => {
  const db = fresh(); code0(db); await m.claimSetupCode("K7MP2X", M); const a = db.tables.print_agents[0]; eq([a.owner_device, a.owner_user], ["dev-1", "user-1"]);
});
await chk("P184055", F, "…including the computer that lost a same-name race and was retried as '(2)' (item 4)", H, async () => {
  const db = fresh(); code0(db); const real = db.from; let first = true;
  db.from = (t) => { const c = real(t); if (t !== "print_agents") return c;
    return new Proxy(c, { get(o, k) { if (k === "insert" && first) { first = false; return () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { code: "23505" } }) }) }); } return o[k]; } }); };
  const r = await m.claimSetupCode("K7MP2X", M); eq(r.name, "Front PC (2)"); eq(db.tables.print_agents[0].owner_device, "dev-1");
});
await chk("P184056", F, "if the computer cannot be made, the code is handed BACK rather than burned", H, async () => {
  const db = fresh(); code0(db); const real = db.from;
  db.from = (t) => { const c = real(t); if (t !== "print_agents") return c;
    return new Proxy(c, { get(o, k) { if (k === "insert") return () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { code: "08006" } }) }) }); return o[k]; } }); };
  const r = await m.claimSetupCode("K7MP2X", M); eq([r.ok, r.reason], [false, "failed"]); eq(db.tables.print_setup_codes[0].claimed_at, null);
});
await chk("P184057", F, "the printers the machine reports travel onto the computer at once (the dropdowns are full on first reload)", H, async () => {
  const db = fresh(); code0(db); await m.claimSetupCode("K7MP2X", { ...M, printers: [{ name: "POS80", paper: { wMm: 80, hMm: 297 } }, "Kitchen"] });
  eq(db.tables.print_agents[0].printers.map((p) => p.name), ["POS80", "Kitchen"]);
});
await chk("P184058", F, "…a reported list is capped at 40 printers", H, async () => {
  const db = fresh(); code0(db); await m.claimSetupCode("K7MP2X", { ...M, printers: Array.from({ length: 300 }, (_, i) => ({ name: "P" + i })) });
  eq(db.tables.print_agents[0].printers.length, 40);
});
await chk("P184059", F, "…an impossible paper size (0 mm, 9 m) is dropped, a real one kept", H, async () => {
  const db = fresh(); code0(db); await m.claimSetupCode("K7MP2X", { ...M, printers: [{ name: "A", paper: { wMm: 0, hMm: 0 } }, { name: "B", paper: { wMm: 80, hMm: 9000 } }, { name: "C", paper: { wMm: 58, hMm: 200 } }] });
  const p = db.tables.print_agents[0].printers; eq([!!p[0].paper, !!p[1].paper, !!p[2].paper], [false, false, true]);
});
await chk("P184060", F, "…quotes, commas, backslashes and control characters are cleaned out of a hostname and printer names", H, async () => {
  const db = fresh(); code0(db); const r = await m.claimSetupCode("K7MP2X", { helper: STAMP, hostname: 'PC"one,\\two\u0007', printers: [{ name: "Ki'tch,en\n" }] });
  assert(!/["',\\\u0007]/.test(r.name), r.name); assert(!/["',\n]/.test(db.tables.print_agents[0].printers[0].name), db.tables.print_agents[0].printers[0].name);
});
// One more read of the file itself, to close the bank: the module still states the four promises.
await chk("P184061", F, "the four promises the header makes (restaurant decided first · not a login · ten minutes, one use · hashed) each still have their code", "read the file, comments stripped, for the code behind each promise", () => {
  const c = codeOnly(src(F));
  assert(/restaurant_id: restaurantId/.test(c) && /code_hash: hash\(code\)/.test(c) && /SETUP_CODE_TTL_MS/.test(c) && /\.is\("claimed_at", null\)/.test(c), "a promise lost its code");
});
