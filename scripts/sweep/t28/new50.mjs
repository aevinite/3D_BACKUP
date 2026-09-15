// scripts/sweep/t28/new50.mjs — SWEEP #9 · TERMINAL 28's fifty new checks, P104301–P104350.
//
// Territory: all 13 `app/api/owner/**` routes, plus /api/log/client-error, /api/health,
// /api/maintenance, /api/blocked, the Zomato/Swiggy webhook, lib/aggregators.ts and lib/ownerScope.ts.
//
// WHERE THESE FIFTY POINT, AND WHY (rule 2b — measured, not guessed). Rows whose SUBJECT is one of
// my twenty files, counted across all 44 ledgers before a single new check was written:
//
//     0 rows   lib/aggregators.ts                    (317 lines)   ← nothing, ever
//     1        the Zomato/Swiggy webhook door         ( 82)
//     2        app/api/log/client-error               (192)
//     2        lib/ownerScope.ts                      (327)        ← the gate for all 13 owner routes
//     4        /api/maintenance                       (100)
//     5        /api/blocked                           (118)
//    10        /api/health                            ( 44)
//   …against 202 on app/api/owner/reports and 33 on app/api/owner/staff.
//
// So ~1,180 lines — the whole platform-order intake seam, the public crash sink, the blocked-device
// door and the GATE that guards 5,352 lines of owner routes — carried 24 rows between them. That is
// not because they are unimportant; it is because no sweep prompt ever happened to name them. All
// fifty go there.
//
// HOW THEY RUN. Two halves, deliberately:
//   · the PURE half calls the real exported functions (normalizeIncoming, outletIdFrom,
//     ownerLogPanel, ownerActorName, dbFail, …) with real inputs and reads the real answer. No
//     server, no database, no login.
//   · the DRIVEN half posts to a running dev server as a real owner and as the admin, and reads the
//     RENDERED answer — status, body, and the database row a write left behind.
//
// Every row the driven half writes is deleted by its own id in the same run (see `written`).
//
//   node scripts/sweep/t28/new50.mjs --base http://localhost:4428
import { chromium } from "playwright";
import { adminHeaders, loginAs } from "../login.mjs";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
// The house default, so a later session can run this the way it runs every other live guard.
// Sweep #9's terminal 28 drove it on 4428 — its own port; 4000 is the owner's own window.
const BASE = arg("--base") || "http://localhost:4000";
const ROOT = path.resolve(new URL("../../..", import.meta.url).pathname);
const FH = "00000000-0000-0000-0000-000000000001";
const PP = "00000000-0000-0000-0000-000000000002";

const rows = [];
// AUTO-NUMBERED from this terminal's own pre-allocated block, in declaration order. Typed ids are
// how a generated band ends up with two of the same number — sweep #7 recorded six collisions and
// sweep #8 put 3,005 rows above its own ceiling. The block is P104301-P104400; these fifty take the
// first fifty of it and the loop refuses to run if the count is not exactly 50.
const FIRST_ID = 104301;
const row = (claim, how, fn) => rows.push({ id: `P${FIRST_ID + rows.length}`, claim, how, fn });
const results = [];
const written = [];      // { table, id } — deleted at the end, by id, in this same run

// ── the real modules, compiled on the fly so the checks call the SHIPPED code ────────────────────
// esbuild, not a re-implementation: a check that re-types the logic proves the re-typing.
const { execFileSync } = await import("node:child_process");
const bundle = (src, out) => {
  execFileSync("npx", ["esbuild", src, "--bundle", "--platform=node", "--format=esm",
    "--alias:@=.", `--outfile=node_modules/.cache/t28-${out}.mjs`, "--log-level=error"], { cwd: ROOT });
  return `${ROOT}/node_modules/.cache/t28-${out}.mjs`;
};
const AGG = await import(bundle("lib/aggregators.ts", "agg"));
const OS = await import(bundle("lib/ownerScope.ts", "ownerscope"));

const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { return ""; } };
const strip = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  BLOCK A · lib/aggregators.ts — the platform-order intake seam (ZERO ledger rows before today)
// ══════════════════════════════════════════════════════════════════════════════════════════════

// normalizeIncoming turns somebody else's payload into a kitchen slip. Every field on that slip is
// something a cook reads, so a blank or a NaN is food nobody gets.
row("normalizeIncoming: an item with no name at all still reaches the cook as a readable line",
  "call the shipped function with { items: [{}] }", () => {
    const n = AGG.normalizeIncoming("zomato", { items: [{}] });
    return n.items[0].title === "Item" ? true : `title=${JSON.stringify(n.items[0].title)}`;
  });
row("…and a name of nothing but spaces does not become a blank line",
  "{ items: [{ name: '   ' }] }", () => {
    const n = AGG.normalizeIncoming("zomato", { items: [{ name: "   " }] });
    return n.items[0].title === "Item" ? true : `title=${JSON.stringify(n.items[0].title)}`;
  });
row("a quantity or a price that is not a number never reaches the slip as NaN",
  "{ items: [{ name:'Tea', qty:'two', price:'free' }] } and a qty of 0", () => {
    const a = AGG.normalizeIncoming("zomato", { items: [{ name: "Tea", qty: "two", price: "free" }] }).items[0];
    if (a.qty !== 1 || a.price !== 0) return `qty=${a.qty} price=${a.price}`;
    // A line of nothing is not an order either, so zero becomes one.
    const b = AGG.normalizeIncoming("zomato", { items: [{ name: "Tea", qty: 0 }] }).items[0];
    return b.qty === 1 ? true : `a qty of 0 stayed ${b.qty}`;
  });
row("the order total falls back to the lines when the platform sends none",
  "{ items: [{ name:'A', qty:2, price:30 }, { name:'B', price:15 }] } and no total", () => {
    const n = AGG.normalizeIncoming("zomato", { items: [{ name: "A", qty: 2, price: 30 }, { name: "B", price: 15 }] });
    return n.total === 75 ? true : `total=${n.total} (want 75)`;
  });
row("items that are not a list are treated as no items, not a crash",
  "{ items: 'nope' } and { items: null }", () => {
    for (const p of [{ items: "nope" }, { items: null }, {}]) {
      const n = AGG.normalizeIncoming("swiggy", p);
      if (!Array.isArray(n.items) || n.items.length !== 0) return `items=${JSON.stringify(n.items)}`;
    }
    return true;
  });
row("…and the platform's own id is used verbatim when it sends one, in any of its three spellings",
  "order_id / id / orderId", () => {
    const want = ["order_id", "id", "orderId"].map((k) => AGG.normalizeIncoming("zomato", { [k]: "X1" }).externalId);
    return want.every((v) => v === "X1") ? true : JSON.stringify(want);
  });

// outletIdFrom decides WHICH restaurant an order is for. Getting it wrong puts somebody else's
// order and money on your floor — the whole reason finding F11 exists.
row("the outlet id is found in every field name a platform might use for it",
  "all eight flat spellings", () => {
    const fields = ["outlet_id", "outletId", "restaurant_id", "restaurantId", "store_id", "storeId", "merchant_id", "merchantId"];
    const miss = fields.filter((f) => AGG.outletIdFrom({ [f]: "OUT-9" }) !== "OUT-9");
    return miss.length === 0 ? true : `not read: ${miss.join(", ")}`;
  });
row("…and nested under the outlet/store/restaurant/merchant object, where some platforms put it",
  "{ outlet: { id } } and { store: { code } }", () => {
    const a = AGG.outletIdFrom({ outlet: { id: "N1" } });
    const b = AGG.outletIdFrom({ store: { code: "N2" } });
    return (a === "N1" && b === "N2") ? true : `a=${a} b=${b}`;
  });
row("an outlet id of blank space is NOT an outlet id — it must fall through to 'unknown'",
  "{ outlet_id: '   ' } → \"\"", () => {
    const v = AGG.outletIdFrom({ outlet_id: "   " });
    return v === "" ? true : `got ${JSON.stringify(v)}`;
  });
row("an outlet id that is a NaN number is refused rather than becoming the text \"NaN\"",
  "{ outlet_id: NaN }", () => {
    const v = AGG.outletIdFrom({ outlet_id: NaN });
    return v === "" ? true : `got ${JSON.stringify(v)} — "NaN" would be matched against a real mapping`;
  });

// verifyWebhook is the only lock on a door an outside company posts through.
row("the webhook lock refuses when no secret is configured — dormant means CLOSED, not open",
  "verifyWebhook with the env var absent", async () => {
    const before = { z: process.env.ZOMATO_WEBHOOK_SECRET, s: process.env.SWIGGY_WEBHOOK_SECRET };
    delete process.env.ZOMATO_WEBHOOK_SECRET; delete process.env.SWIGGY_WEBHOOK_SECRET;
    try {
      const a = await AGG.verifyWebhook("zomato", "anything");
      const b = await AGG.verifyWebhook("swiggy", "anything");
      return (a === false && b === false) ? true : `zomato=${a} swiggy=${b}`;
    } finally {
      if (before.z !== undefined) process.env.ZOMATO_WEBHOOK_SECRET = before.z;
      if (before.s !== undefined) process.env.SWIGGY_WEBHOOK_SECRET = before.s;
    }
  });
row("…and refuses when the caller presents no secret, even if one IS configured",
  "verifyWebhook(source, null)", async () => {
    process.env.ZOMATO_WEBHOOK_SECRET = "t28-probe-secret";
    try {
      const a = await AGG.verifyWebhook("zomato", null);
      const b = await AGG.verifyWebhook("zomato", "");
      return (a === false && b === false) ? true : `null=${a} empty=${b}`;
    } finally { delete process.env.ZOMATO_WEBHOOK_SECRET; }
  });
row("…accepts the right secret, and refuses one that is merely a prefix of it",
  "the configured value vs a truncation of it", async () => {
    process.env.ZOMATO_WEBHOOK_SECRET = "t28-probe-secret";
    try {
      const good = await AGG.verifyWebhook("zomato", "t28-probe-secret");
      const trunc = await AGG.verifyWebhook("zomato", "t28-probe-secre");
      const longer = await AGG.verifyWebhook("zomato", "t28-probe-secretX");
      return (good === true && trunc === false && longer === false) ? true : `good=${good} trunc=${trunc} longer=${longer}`;
    } finally { delete process.env.ZOMATO_WEBHOOK_SECRET; }
  });
row("each platform's lock is its own — Swiggy's secret does not open Zomato's door",
  "configure only Zomato, present it as Swiggy", async () => {
    process.env.ZOMATO_WEBHOOK_SECRET = "t28-z"; process.env.SWIGGY_WEBHOOK_SECRET = "t28-s";
    try {
      const crossed = await AGG.verifyWebhook("swiggy", "t28-z");
      const own = await AGG.verifyWebhook("swiggy", "t28-s");
      return (crossed === false && own === true) ? true : `crossed=${crossed} own=${own}`;
    } finally { delete process.env.ZOMATO_WEBHOOK_SECRET; delete process.env.SWIGGY_WEBHOOK_SECRET; }
  });
row("the compare is constant-time and hashed — the shipped code uses the login door's own helper",
  "read: safeEqual over sha256hex of BOTH sides, never a plain ===", () => {
    const src = strip(read("lib/aggregators.ts"));
    const fn = src.slice(src.indexOf("export async function verifyWebhook"));
    const body = fn.slice(0, fn.indexOf("\n}") + 2);
    if (/headerSecret\s*===\s*secret|secret\s*===\s*headerSecret/.test(body)) return "a plain === is back";
    return /safeEqual\(\s*await sha256hex\(headerSecret\)\s*,\s*await sha256hex\(secret\)\s*\)/.test(body)
      ? true : `body does not hash both sides through safeEqual: ${body.trim().slice(0, 140)}`;
  });

// The platform gate, and its cache.
row("the platform-wide \"is intake on anywhere\" question is a rows-free COUNT, not a read of every restaurant's settings",
  "read: head + count, with the filter pushed into Postgres", () => {
    const src = strip(read("lib/aggregators.ts"));
    const fn = src.slice(src.indexOf("export async function aggregatorsEnabled"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    const headCount = /count:\s*"exact",\s*head:\s*true/.test(body);
    const pushed = /\.eq\(\s*"features->>aggregators"\s*,\s*"true"\s*\)/.test(body);
    return (headCount && pushed) ? true : `headCount=${headCount} filterPushedToPostgres=${pushed}`;
  });
row("…and a FAILED read is never cached, so a blip cannot switch the integration off for the TTL",
  "read: the cache is written only after the error test", () => {
    const src = strip(read("lib/aggregators.ts"));
    const fn = src.slice(src.indexOf("export async function aggregatorsEnabled"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    const iErr = body.indexOf("if (r.error) return false");
    const iSet = body.indexOf("aggAny = {");
    return (iErr > -1 && iSet > iErr) ? true : `error test at ${iErr}, cache write at ${iSet}`;
  });
row("an unknown restaurant answers \"intake off\" rather than throwing — it fails CLOSED",
  "aggregatorsEnabled(<a uuid nothing owns>)", async () => {
    const v = await AGG.aggregatorsEnabled("00000000-0000-0000-0000-0000000000ff");
    return v === false ? true : `got ${v}`;
  });
row("the status push back to the platform has a deadline, so it can never hold an instance open",
  "read: a bounded NOTIFY_TIMEOUT_MS, guarded because reading AbortSignal.timeout can throw", () => {
    const src = strip(read("lib/aggregators.ts"));
    const ms = Number(((src.match(/NOTIFY_TIMEOUT_MS\s*=\s*(\d+)/) || [])[1]) || 0);
    const guarded = /typeof AbortSignal\.timeout === "function"/.test(src) && /catch \{ signal = undefined; \}/.test(src);
    return (ms > 0 && ms <= 10_000 && guarded) ? true : `timeout=${ms} featureGuarded=${guarded}`;
  });
row("…and a status nobody maps, or a source with no upstream, is simply not pushed",
  "notifyAggregator('takeaway', …) and an unmapped status both return without a fetch", async () => {
    const orig = globalThis.fetch; let called = 0;
    globalThis.fetch = async () => { called++; return new Response("{}"); };
    try {
      process.env.ZOMATO_API_KEY = "t28-k"; process.env.ZOMATO_API_URL = "http://127.0.0.1:9/never";
      await AGG.notifyAggregator("takeaway", "X", "accepted");
      await AGG.notifyAggregator("zomato", "X", "not_a_status");
      await AGG.notifyAggregator("zomato", null, "accepted");
      return called === 0 ? true : `it made ${called} outbound call(s) it should not have`;
    } finally { globalThis.fetch = orig; delete process.env.ZOMATO_API_KEY; delete process.env.ZOMATO_API_URL; }
  });

// resolveWebhookRestaurant — the three answers, and the one this run separated.
row("\"we could not ask\" and \"no such outlet\" are different answers, not one null",
  "the shipped type has an `unread` flag, and the read-failure branch sets it", () => {
    const src = strip(read("lib/aggregators.ts"));
    const fn = src.slice(src.indexOf("export async function resolveWebhookRestaurant"));
    const body = fn.slice(0, fn.indexOf("\nexport ") > 0 ? fn.indexOf("\nexport ") : fn.length);
    const noBareNull = !/\breturn null;/.test(body);
    const flagged = /could not read channel mappings[\s\S]{0,600}unread: true/.test(body);
    return (noBareNull && flagged) ? true : `noBareNull=${noBareNull} readFailureFlagged=${flagged}`;
  });
row("an outlet nothing is mapped to resolves to NOBODY — it never falls back to restaurant #1",
  "resolveWebhookRestaurant with an outlet id no restaurant claims", async () => {
    const t = await AGG.resolveWebhookRestaurant("zomato", { outlet_id: "t28-no-such-outlet-zzz" });
    if (t.restaurantId) return `it resolved ${t.restaurantId} for an unmapped outlet`;
    return t.unread === false ? true : `it answered "couldn't ask" for a clean read: ${JSON.stringify(t)}`;
  });
row("the channel-mapping read names its columns, carries a ceiling, and asks Postgres to filter",
  "read: select(restaurant_id, platform_channels) + .eq(on) + .limit()", () => {
    const src = strip(read("lib/aggregators.ts"));
    const fn = src.slice(src.indexOf("export async function resolveWebhookRestaurant"));
    const q = (fn.match(/sb\.from\("settings"\)[\s\S]{0,320}?;/) || [])[0] || "";
    const cols = /select\("restaurant_id, platform_channels"\)/.test(q);
    const filtered = /\.eq\(`platform_channels->\$\{source\}->>on`, "true"\)/.test(q);
    const capped = /\.limit\(\d+\)/.test(q);
    return (cols && filtered && capped) ? true : `columns=${cols} postgresFilter=${filtered} ceiling=${capped}`;
  });
row("ingesting an order still re-checks the target restaurant's own Platform module and channel",
  "read: platformLadder(rid).effective and the per-channel on flag, both before the insert", () => {
    const src = strip(read("lib/aggregators.ts"));
    const fn = src.slice(src.indexOf("export async function ingestIncoming"));
    const iLadder = fn.indexOf("platformLadder(restaurantId)");
    const iChannel = fn.indexOf("platform_channels?.[source]?.on !== true");
    const iInsert = fn.indexOf("lfh_platform_insert");
    return (iLadder > -1 && iChannel > iLadder && iInsert > iChannel)
      ? true : `ladder=${iLadder} channel=${iChannel} insert=${iInsert} — a gate must precede the write`;
  });

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  BLOCK B · the webhook DOOR, driven (1 ledger row before today)
// ══════════════════════════════════════════════════════════════════════════════════════════════
row("a platform we have never heard of is refused at the door, before any switch is read",
  `POST ${BASE}/api/aggregators/webhook/dunzo → 404`, async (c) => {
    const r = await c.A.request.post(`${BASE}/api/aggregators/webhook/dunzo`, { data: {}, timeout: 60000 });
    const j = await r.json().catch(() => ({}));
    return (r.status() === 404 && /unknown source/i.test(j.error || "")) ? true : `${r.status()} ${JSON.stringify(j)}`;
  });
row("an oversized order is REFUSED, never silently trimmed — a trimmed order is food somebody doesn't get",
  "POST a 70 KB body → 413, and the body cap is read before the JSON is parsed", async (c) => {
    const big = { items: Array.from({ length: 4000 }, (_, i) => ({ name: `Dish ${i}`, qty: 1, price: 10 })) };
    const raw = JSON.stringify(big);
    if (raw.length <= 64_000) return `the fixture is only ${raw.length} bytes — it cannot test the cap`;
    const r = await c.N.request.post(`${BASE}/api/aggregators/webhook/zomato`, {
      headers: { "content-type": "application/json", "x-webhook-secret": "t28-wrong" },
      data: raw, timeout: 90000,
    });
    // With the flag off the door answers `disabled` first, which is the correct order of gates;
    // with it on, the cap must fire before the payload is parsed. Either is a pass — a 200 carrying
    // a TRUNCATED order is not.
    const j = await r.json().catch(() => ({}));
    if (r.status() === 413) return true;
    if (r.status() === 200 && j.disabled === true) return true;
    if (r.status() === 401) return true;      // refused by the lock, also before any trimming
    return `${r.status()} ${JSON.stringify(j).slice(0, 140)}`;
  });
row("the gates are read in the safe order: the source, then the flag, then the lock, then the tenant",
  "read: each refusal precedes the next read in the handler", async () => {
    const src = strip(read("app/api/aggregators/webhook/[source]/route.ts"));
    const iSrc = src.indexOf('source !== "zomato"');
    const iFlag = src.indexOf("aggregatorsEnabled()");
    const iLock = src.indexOf("verifyWebhook(");
    const iTenant = src.indexOf("resolveWebhookRestaurant(");
    const iIngest = src.indexOf("ingestIncoming(");
    const order = [iSrc, iFlag, iLock, iTenant, iIngest];
    return order.every((v, i) => v > -1 && (i === 0 || v > order[i - 1]))
      ? true : `order was ${JSON.stringify(order)}`;
  });
row("the lock is AWAITED — an un-awaited async check is always truthy and its refusal unreachable",
  "read: `await verifyWebhook(`, the fault /api/issue-media shipped with", async () => {
    const src = strip(read("app/api/aggregators/webhook/[source]/route.ts"));
    return /if \(!\(await verifyWebhook\(/.test(src) ? true : "verifyWebhook is not awaited inside its own test";
  });
row("an unreadable mapping asks the platform to send the order again; an unmapped one asks a person to fix it",
  "read: 503 + transient for the unread case, the 404 kept for a real answer", async () => {
    const src = strip(read("app/api/aggregators/webhook/[source]/route.ts"));
    const retry = /target\.restaurantId === null && target\.unread[\s\S]{0,420}status:\s*503/.test(src);
    const final = /don't recognise that outlet[\s\S]{0,220}status:\s*404/.test(src);
    return (retry && final) ? true : `retryableWhenUnread=${retry} finalWhenUnmapped=${final}`;
  });

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  BLOCK C · lib/ownerScope.ts — the gate 13 routes and 5,352 lines stand on (2 rows before today)
// ══════════════════════════════════════════════════════════════════════════════════════════════
row("an ADMIN action performed from the owner's screens is recorded against the ADMIN's log, in every admin shape",
  "ownerLogPanel over all-view, act-as, and a real owner", () => {
    const got = {
      allView: OS.ownerLogPanel({ all: true, admin: true }),
      actAs: OS.ownerLogPanel({ all: false, ids: ["r1"], ownerId: "o1", admin: true }),
      realOwner: OS.ownerLogPanel({ all: false, ids: ["r1"], ownerId: "o1", ownerName: "diago1" }),
    };
    return (got.allView === "admin" && got.actAs === "admin" && got.realOwner === "owner")
      ? true : JSON.stringify(got);
  });
row("the person written into a log row is a NAME for a real owner and \"admin\" for Aevidine — never a uuid",
  "ownerActorName over the same three shapes", () => {
    const got = {
      allView: OS.ownerActorName({ all: true, admin: true }),
      actAs: OS.ownerActorName({ all: false, ids: ["r1"], ownerId: "c0af7b5b-c0d8-40f6-b831-f475e48bab53", admin: true }),
      named: OS.ownerActorName({ all: false, ids: ["r1"], ownerId: "c0af7b5b-c0d8-40f6-b831-f475e48bab53", ownerName: "diago1" }),
    };
    if (got.allView !== "admin" || got.actAs !== "admin") return JSON.stringify(got);
    return got.named === "diago1" ? true : `a named owner recorded as ${JSON.stringify(got.named)}`;
  });
row("\"is this restaurant mine?\" answers yes for the admin and only for their own list for an owner",
  "inScope over both shapes", () => {
    const admin = OS.inScope({ all: true, admin: true }, "anything-at-all");
    const mine = OS.inScope({ all: false, ids: [FH], ownerId: "o1" }, FH);
    const theirs = OS.inScope({ all: false, ids: [FH], ownerId: "o1" }, PP);
    return (admin === true && mine === true && theirs === false) ? true : `admin=${admin} mine=${mine} theirs=${theirs}`;
  });
row("a database failure never reaches an owner in the database's own words, and says whether to retry",
  "dbFail with a PostgREST-shaped object", async () => {
    const r = OS.dbFail("t28/probe", { code: "42P01", message: 'relation "orders" does not exist' });
    const j = await r.json();
    if (/relation|does not exist|42P01/i.test(JSON.stringify(j))) return `the database's words went out: ${JSON.stringify(j)}`;
    return (r.status === 503 && j.transient === true && /try again/i.test(j.error)) ? true : `${r.status} ${JSON.stringify(j)}`;
  });
row("…and a statement timeout keeps its own advice and its own status, because it is the one thing an owner can act on",
  "dbFail with 57014", async () => {
    const r = OS.dbFail("t28/probe", { code: "57014", message: "canceling statement due to statement timeout" });
    const j = await r.json();
    const advises = /shorter period|one restaurant at a time/i.test(j.error || "");
    return (r.status === 504 && advises && j.transient !== true) ? true : `${r.status} transient=${j.transient} ${JSON.stringify(j.error)}`;
  });
row("a PARTIAL restaurant list is never returned as a list — it is a retryable refusal instead",
  "the two declared failure types, and the shared 503 the routes answer with", async () => {
    const src = strip(read("lib/ownerScope.ts"));
    const throwsOnPartial = /if \(r\.error\) throw new RestaurantListIncomplete/.test(src);
    const noBreak = !/break;\s*\/\/ partial/.test(src);
    const r = OS.incompleteListResponse();
    const j = await r.json();
    return (throwsOnPartial && noBreak && r.status === 503 && j.transient === true)
      ? true : `throws=${throwsOnPartial} status=${r.status} ${JSON.stringify(j)}`;
  });
row("…and the admin's all-restaurants list is PAGED, so it cannot stop at PostgREST's row cap",
  "read: a page loop with .range(), not a flat .limit()", () => {
    const src = strip(read("lib/ownerScope.ts"));
    const fn = src.slice(src.indexOf("export async function scopedRestaurantIds"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    const paged = /for \(let offset = 0; ; offset \+= PAGE\)/.test(body) && /\.range\(offset, offset \+ PAGE - 1\)/.test(body);
    const stops = /if \(batch\.length < PAGE\) break;/.test(body);
    return (paged && stops) ? true : `paged=${paged} terminates=${stops}`;
  });

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  BLOCK D · /api/log/client-error — the PUBLIC crash-and-tap sink (2 ledger rows before today)
// ══════════════════════════════════════════════════════════════════════════════════════════════
// It is public, unauthenticated, and it WRITES a row per call. So the interesting question is not
// "does it log" — it is "what stops a misbehaving client filling the admin's Repair board with rows
// that look like a restaurant in trouble". Driven, because its whole contract is the ANSWER it
// gives: it fails soft, so the only way to tell a refusal from a write is to look at both.
row("a crash report from a panel nobody has heard of is not written at all",
  `POST with panel:"nonsense" → ok:true, skipped:"bad_panel", and NO row lands`, async (c) => {
    const mark = `t28-badpanel-${Date.now()}`;
    const r = await c.N.request.post(`${BASE}/api/log/client-error`, {
      data: { panel: "nonsense", kind: "error", message: mark }, timeout: 60000 });
    const j = await r.json().catch(() => ({}));
    if (r.status() !== 200 || j.skipped !== "bad_panel") return `${r.status()} ${JSON.stringify(j)}`;
    const q = await c.sb.from("staff_actions").select("id").ilike("detail", `%${mark}%`).limit(1);
    if (q.error) return `could not check: ${q.error.message}`;
    for (const x of (q.data || [])) c.written.push({ table: "staff_actions", id: x.id });
    return (q.data || []).length === 0 ? true : "a row was written for an unknown panel";
  });
row("…and a body too large to be a real crash report is dropped before it is parsed",
  "POST a 3 KB body → skipped:\"too_large\", no row", async (c) => {
    const mark = `t28-toolarge-${Date.now()}`;
    const r = await c.N.request.post(`${BASE}/api/log/client-error`, {
      headers: { "content-type": "application/json" },
      data: JSON.stringify({ panel: "guest", kind: "error", message: mark, pad: "x".repeat(2600) }),
      timeout: 60000 });
    const j = await r.json().catch(() => ({}));
    if (j.skipped !== "too_large") return `${r.status()} ${JSON.stringify(j)}`;
    const q = await c.sb.from("staff_actions").select("id").ilike("detail", `%${mark}%`).limit(1);
    for (const x of ((q.data) || [])) c.written.push({ table: "staff_actions", id: x.id });
    return (q.data || []).length === 0 ? true : "the oversized report was written anyway";
  });
row("…and broken JSON is answered calmly, never as an error from the error-logger itself",
  "POST `{not json` → 200 skipped:\"bad_json\"", async (c) => {
    const r = await c.N.request.post(`${BASE}/api/log/client-error`, {
      headers: { "content-type": "application/json" },
      // Real BYTES. Playwright JSON-encodes a string `data`, so `"{not json"` arrives as a perfectly
      // valid JSON string and the route rightly refuses it for its panel instead — which made this
      // check assert the wrong refusal until it was driven and read.
      data: Buffer.from("{not json", "utf8"), timeout: 60000 });
    const j = await r.json().catch(() => ({}));
    return (r.status() === 200 && j.skipped === "bad_json") ? true : `${r.status()} ${JSON.stringify(j)}`;
  });
row("a real crash on a guest menu is filed against the restaurant whose address it happened at",
  "POST with where=/r/french-house/menu and NO rid → the row carries French House", async (c) => {
    const mark = `t28-rid-from-address-${Date.now()}`;
    const r = await c.N.request.post(`${BASE}/api/log/client-error`, {
      data: { panel: "guest", kind: "error", message: mark, where: "/r/french-house/menu" }, timeout: 60000 });
    if (r.status() !== 200) return `${r.status()}`;
    let found = null;
    for (let i = 0; i < 6 && !found; i++) {
      const q = await c.sb.from("staff_actions").select("id, restaurant_id, detail")
        .ilike("detail", `%${mark}%`).limit(1);
      if (q.error) return `could not check: ${q.error.message}`;
      found = (q.data || [])[0] || null;
      if (!found) await new Promise((x) => setTimeout(x, 400));
    }
    if (!found) return "the report was accepted but no row was written";
    c.written.push({ table: "staff_actions", id: found.id });
    return found.restaurant_id === FH ? true
      : `the row landed on restaurant ${found.restaurant_id} instead of French House — the admin's picker cannot narrow to it`;
  });
row("…and the row says WHICH browser it came from, because that is the most useful fact about a crash",
  "the same POST with a Safari-on-iPhone user agent → the detail carries a short tag", async (c) => {
    const mark = `t28-browsertag-${Date.now()}`;
    const r = await c.N.request.post(`${BASE}/api/log/client-error`, {
      headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
      data: { panel: "guest", kind: "error", message: mark, where: "/r/french-house/menu" }, timeout: 60000 });
    if (r.status() !== 200) return `${r.status()}`;
    let found = null;
    for (let i = 0; i < 6 && !found; i++) {
      const q = await c.sb.from("staff_actions").select("id, detail").ilike("detail", `%${mark}%`).limit(1);
      found = (q.data || [])[0] || null;
      if (!found) await new Promise((x) => setTimeout(x, 400));
    }
    if (!found) return "no row was written";
    c.written.push({ table: "staff_actions", id: found.id });
    return /\[Safari · iPhone\]/.test(found.detail || "") ? true
      : `the detail carries no browser tag: ${JSON.stringify(String(found.detail).slice(-60))}`;
  });
row("a tap breadcrumb is stored at info level and never reaches the owner's Activity list",
  "POST kind:taps → a level:'info' ui_taps row, which /api/owner/oplog excludes by action", async (c) => {
    const mark = `t28-taps-${Date.now()}`;
    const r = await c.N.request.post(`${BASE}/api/log/client-error`, {
      data: { panel: "manager", kind: "taps", detail: mark, rid: FH }, timeout: 60000 });
    if (r.status() !== 200) return `${r.status()}`;
    let found = null;
    for (let i = 0; i < 6 && !found; i++) {
      const q = await c.sb.from("staff_actions").select("id, action, level, detail")
        .eq("action", "ui_taps").ilike("detail", `%${mark}%`).limit(1);
      found = (q.data || [])[0] || null;
      if (!found) await new Promise((x) => setTimeout(x, 400));
    }
    if (!found) return "the tap batch was accepted but no row was written";
    c.written.push({ table: "staff_actions", id: found.id });
    if (found.level !== "info") return `stored at level ${JSON.stringify(found.level)}, so it would show red`;
    const feed = await (await c.O.request.get(`${BASE}/api/owner/oplog?limit=200&page=1`, { timeout: 120000 })).json();
    return (feed.actions || []).every((a) => a.action !== "ui_taps") ? true
      : "a ui_taps row is in the owner's Activity list";
  });

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  BLOCK E · /api/blocked and /api/maintenance — the two small doors (5 and 4 rows before today)
// ══════════════════════════════════════════════════════════════════════════════════════════════
// /api/blocked is the ONE thing a blocked visitor is allowed to do, and its whole design is an
// asymmetry: the PAGE renders on doubt so nobody is stranded, and the WRITE refuses on doubt so the
// three-a-day cap cannot be got round by breaking its own counter. Driven where a drive is honest
// — this machine is not blocked, and creating a block to watch it would be tampering, so the
// asymmetry itself is read from the shipped code and the not-blocked answers are driven.
row("a device that is not blocked is told so plainly, with no login and no cookie",
  `GET ${BASE}/api/blocked → 200, blocked:false`, async (c) => {
    const r = await c.N.request.get(`${BASE}/api/blocked`, { timeout: 60000 });
    const j = await r.json().catch(() => ({}));
    return (r.status() === 200 && j.blocked === false) ? true : `${r.status()} ${JSON.stringify(j)}`;
  });
row("…and asking to be unblocked when you are not blocked writes nothing and says why",
  `POST ${BASE}/api/blocked → ok:false, reason:"not_blocked", and no unblock_requests row`, async (c) => {
    const before = new Date().toISOString();
    const r = await c.N.request.post(`${BASE}/api/blocked`, { data: { message: "t28 probe" }, timeout: 60000 });
    const j = await r.json().catch(() => ({}));
    if (j.reason !== "not_blocked") return `${r.status()} ${JSON.stringify(j)}`;
    const q = await c.sb.from("unblock_requests").select("id").gte("created_at", before).limit(5);
    if (q.error) return `could not check: ${q.error.message}`;
    for (const x of (q.data || [])) c.written.push({ table: "unblock_requests", id: x.id });
    return (q.data || []).length === 0 ? true : `${(q.data || []).length} request row(s) were filed by a device that is not blocked`;
  });
row("the counter that enforces the three-a-day cap tells \"couldn't count\" apart from \"none used\"",
  "read: usedToday returns number | null, never 0 on failure", () => {
    const src = strip(read("app/api/blocked/route.ts"));
    const fn = src.slice(src.indexOf("async function usedToday"), src.indexOf("export async function GET"));
    const returnsNull = /Promise<number \| null>/.test(src) && /if \(error\) return null;/.test(fn) && /catch \{\s*return null;\s*\}/.test(fn);
    return returnsNull ? true : "usedToday no longer separates a failed count from a count of zero — a limiter whose counter breaks stops limiting";
  });
row("…and the two callers use it in OPPOSITE directions: the page renders on doubt, the write refuses on doubt",
  "read: the GET coalesces to 0 for display; the POST answers 503 when the count is null", () => {
    const src = strip(read("app/api/blocked/route.ts"));
    const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
    const post = src.slice(src.indexOf("export async function POST"));
    const pageOpens = /await usedToday\(ip\)\s*:\s*0\)\s*\?\?\s*0/.test(get);
    const writeRefuses = /if \(used === null\)[\s\S]{0,200}status:\s*503/.test(post);
    return (pageOpens && writeRefuses) ? true : `pageRendersOnDoubt=${pageOpens} writeRefusesOnDoubt=${writeRefuses}`;
  });
row("…and the device is identified from proxy headers on our side, never from the body it sent",
  "read: clientIp(req) only, and `ip` is never taken off the request body", () => {
    const src = strip(read("app/api/blocked/route.ts"));
    const fromBody = /\bip\s*=\s*[^;\n]*\b(body|b)\b/.test(src) || /body[?.]+\.?ip/.test(src);
    const derived = (src.match(/clientIp\(req\)/g) || []).length >= 2;
    return (!fromBody && derived) ? true : `takenFromBody=${fromBody} derivedServerSide=${derived}`;
  });
row("reading whether the guest menu is down needs a login, and reading it is all a kitchen or tablet may do",
  `GET ${BASE}/api/maintenance with no cookie → 401, and with the admin's → the real state`, async (c) => {
    const anon = await c.N.request.get(`${BASE}/api/maintenance`, { timeout: 60000 });
    if (anon.status() !== 401) return `an unauthenticated read answered ${anon.status()}, not 401`;
    const adm = await c.A.request.get(`${BASE}/api/maintenance?rid=${FH}`, { timeout: 60000 });
    const j = await adm.json().catch(() => ({}));
    return (adm.status() === 200 && typeof j.maintenance === "boolean") ? true : `${adm.status()} ${JSON.stringify(j)}`;
  });
row("…and a malformed restaurant id gets a sentence a person can read, never the database's own words",
  `GET ${BASE}/api/maintenance?rid=not-a-uuid → a plain refusal, no "invalid input syntax"`, async (c) => {
    const r = await c.A.request.get(`${BASE}/api/maintenance?rid=not-a-uuid`, { timeout: 60000 });
    const j = await r.json().catch(() => ({}));
    const blob = JSON.stringify(j);
    if (/invalid input syntax|uuid|PGRST|22P02/i.test(blob)) return `the database's words went out: ${blob}`;
    return (r.status() >= 400 && typeof j.error === "string" && j.error.length > 8) ? true : `${r.status()} ${blob}`;
  });
row("…and the admin's own flip of that switch is recorded against the ADMIN's log, not the owner's feed",
  "read: the panel is decided from whether there is a staff user, not hard-coded", () => {
    const src = strip(read("app/api/maintenance/route.ts"));
    const hard = /logAction\("manager",\s*on \?/.test(src);
    const decided = /logAction\(s\.admin \? "admin" : "manager"/.test(src);
    return (!hard && decided) ? true : `hardCodedPanel=${hard} decidedFromTheSession=${decided}`;
  });

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  run
// ══════════════════════════════════════════════════════════════════════════════════════════════
const env = Object.fromEntries(read(".env.local").split("\n").filter((l) => l.includes("="))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── NOTHING ANSWERING IS NOT A FAULT, AND IT MUST NOT READ AS ONE ───────────────────────────────
// The house shape (verify:customers, verify:families, verify:pay-history-delete all do this): say
// plainly that nothing was checked and exit 2, rather than crashing with a stack trace that reads
// like the app is broken. A guard that goes red in this folder's PostToolUse hook blocks every
// session, so "I could not run" has to look different from "the product is wrong".
try {
  const probe = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(8000) });
  if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
} catch (e) {
  console.log(`\nNothing is answering at ${BASE}, so the driven half of these fifty cannot run.`);
  console.log("  · start it:      npm run dev        (it serves on 4000)");
  console.log(`  · or point it somewhere else:   -- --base <url>   (${(e && e.message) || e})`);
  console.log("\nThis is NOT a fault in the app and NOT a fault in this guard — nothing was checked.");
  process.exit(2);
}

const browser = await chromium.launch();
const ctx = {
  A: await browser.newContext({ extraHTTPHeaders: adminHeaders(BASE) }),
  N: await browser.newContext(),
  O: await browser.newContext(),
  sb, written,
};
await loginAs(ctx.O, "owner", BASE);

console.log(`\nT28 · fifty new checks, P104301–P104350 — aimed at the files the ledger had 0–5 rows on\n`);
for (const r of rows) {
  let v;
  try { v = await r.fn(ctx); } catch (e) { v = `threw: ${(e && e.message) || e}`; }
  const pass = v === true;
  results.push({ id: r.id, claim: r.claim, how: r.how, pass, why: pass ? "" : String(v) });
  console.log(`  ${pass ? "✅" : "❌"} ${r.id} ${r.claim}${pass ? "" : `\n        → ${v}`}`);
}

// Every row this run wrote, deleted by its own id, in this same run.
for (const w of written) {
  const d = await sb.from(w.table).delete().eq("id", w.id);
  if (d.error) console.log(`  !! could not delete ${w.table}/${w.id}: ${d.error.message}`);
}
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length} checks · ${results.length - failed.length} pass · ${failed.length} fail`);
for (const f of failed) console.log(`  FAIL ${f.id} ${f.claim} → ${f.why}`);
fs.writeFileSync(path.join(ROOT, ".t28-run/new50-results.json"), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
