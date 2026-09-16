// BLOCK I · the Zomato/Swiggy door — 25 phases, P160911–P160935.
//   app/api/aggregators/webhook/[source] (96 lines, 1 ledger row) · lib/aggregators.ts (350 lines).
// Round 1 covered the LIBRARY by calling its exported functions. These twenty-five DRIVE THE DOOR
// over real HTTP — the one address an outside company posts to — and they are the only checks in
// this territory whose caller is not a person at all.
import { FH, GET, POST, sb, owns, undo, block, of_, code, read } from "./harness.mjs";
const W = of_("app/api/aggregators/webhook/[source]/route.ts");
const L = of_("lib/aggregators.ts");
export const I = block(160911, "I · the platform-order door, driven over real HTTP");
const { row } = I;
const hook = (src) => `/api/aggregators/webhook/${src}`;
const order = (extra = {}) => ({ order_id: `t28r2-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, customer_name: "T28R2", items: [{ name: "Tea", qty: 1, price: 30 }], total: 30, ...extra });

row(W("a platform we have never heard of is refused at the door"), "POST /webhook/dunzo", async (c) => {
  const r = await POST(c.N, hook("dunzo"), order());
  return !!(r.status === 404 && /unknown source/i.test(r.j?.error || "")) || `${r.status} ${JSON.stringify(r.j)}`;
});
row(W("…and so is one whose name only looks right"), "POST /webhook/Zomato and /webhook/zomato2", async (c) => {
  for (const s of ["Zomato", "zomato2", "zomato%20", "swiggy1"]) {
    const r = await POST(c.N, hook(s), order());
    if (r.status !== 404) return `${s} answered ${r.status}`;
  }
  return true;
});
row(W("that refusal needs no login, no secret and no flag — it cannot be used to learn anything"), "POST with no headers at all", async (c) => {
  const r = await POST(c.N, hook("deliveroo"), {});
  return r.status === 404 || `${r.status}`;
});
row(W("the door answers the same to a signed-in owner as to a stranger — it is not a panel"), "POST as diago1 and as nobody", async (c) => {
  const a = await POST(c.O, hook("dunzo"), order());
  const b = await POST(c.N, hook("dunzo"), order());
  return a.status === b.status || `owner got ${a.status}, stranger got ${b.status}`;
});
row(W("with the integration dormant, a real platform name is answered \"disabled\" and nothing is written"), "POST /webhook/zomato", async (c) => {
  const before = new Date().toISOString();
  const o = order();
  const r = await POST(c.N, hook("zomato"), o);
  const q = await sb.from("aggregator_orders").select("id").eq("external_id", o.order_id).limit(1);
  for (const x of (q.data || [])) owns("aggregator_orders", x.id);
  if (r.status === 200 && r.j?.disabled === true) return (q.data || []).length === 0 || "it answered disabled and still wrote a row";
  if (r.status === 401) return (q.data || []).length === 0 || "it refused the secret and still wrote a row";
  return `${r.status} ${JSON.stringify(r.j).slice(0, 110)}`;
});
row(W("…and that answer is a 200, not a 5xx, so a dormant integration is not retried for ever"), "read the status", async (c) => {
  const r = await POST(c.N, hook("zomato"), order());
  return !!(r.status === 200 || r.status === 401) || `${r.status} — an aggregator would retry this`;
});
row(W("an order too large to be real is REFUSED, never silently trimmed"), "POST a 70 KB body", async (c) => {
  const big = JSON.stringify(order({ items: Array.from({ length: 4000 }, (_, i) => ({ name: `Dish ${i}`, qty: 1, price: 10 })) }));
  if (big.length <= 64_000) return `SKIP: the fixture is only ${big.length} bytes`;
  const r = await POST(c.N, hook("zomato"), undefined, { headers: { "content-type": "application/json", "x-webhook-secret": "t28r2-wrong" }, data: big });
  return !!([413, 401, 200].includes(r.status)) || `${r.status}`;
});
row(W("…and whichever gate answers first, nothing truncated is ever recorded"), "the same POST, then look for the order", async (c) => {
  const o = order({ items: Array.from({ length: 4000 }, (_, i) => ({ name: `Dish ${i}`, qty: 1, price: 10 })) });
  const big = JSON.stringify(o);
  await POST(c.N, hook("zomato"), undefined, { headers: { "content-type": "application/json" }, data: big });
  const q = await sb.from("aggregator_orders").select("id, items").eq("external_id", o.order_id).limit(1);
  for (const x of (q.data || [])) owns("aggregator_orders", x.id);
  return (q.data || []).length === 0 || `a 70 KB order was recorded with ${((q.data[0].items) || []).length} lines`;
});
row(W("the gates are read in the safe order: the source, the flag, the lock, then the tenant"), "read the handler top to bottom", async () => {
  const src = code(read("app/api/aggregators/webhook/[source]/route.ts"));
  const at = [src.indexOf('source !== "zomato"'), src.indexOf("aggregatorsEnabled()"), src.indexOf("verifyWebhook("),
              src.indexOf("resolveWebhookRestaurant("), src.indexOf("ingestIncoming(")];
  return at.every((v, i) => v > -1 && (i === 0 || v > at[i - 1])) || `order was ${JSON.stringify(at)}`;
});
row(W("the lock is AWAITED — an un-awaited async check is always truthy and its refusal unreachable"), "read: `await verifyWebhook(`", async () => {
  const src = code(read("app/api/aggregators/webhook/[source]/route.ts"));
  return /if \(!\(await verifyWebhook\(/.test(src) || "verifyWebhook is not awaited inside its own test — the exact fault /api/issue-media shipped with";
});
row(W("…and so is the flag"), "read: `await aggregatorsEnabled(`", async () => {
  const src = code(read("app/api/aggregators/webhook/[source]/route.ts"));
  return /if \(!\(await aggregatorsEnabled\(\)\)\)/.test(src) || "the flag check is not awaited";
});
row(W("an unreadable mapping asks the platform to send it again; an unmapped one asks a person to fix it"), "read both refusals", async () => {
  const src = code(read("app/api/aggregators/webhook/[source]/route.ts"));
  const retry = /target\.restaurantId === null && target\.unread[\s\S]{0,420}status:\s*503/.test(src);
  const final = /don't recognise that outlet[\s\S]{0,220}status:\s*404/.test(src);
  return !!(retry && final) || `retryable=${retry} final=${final}`;
});
row(W("nothing this door sends out carries a database sentence"), "read: no raw message reaches a body", async () => {
  const src = code(read("app/api/aggregators/webhook/[source]/route.ts"));
  const raw = [...src.matchAll(/error:\s*[A-Za-z_$][\w.$]*\.error\.message/g)].length;
  const lib = code(read("lib/aggregators.ts"));
  return !!(raw === 0 && !/throw new Error\(error\.message\)/.test(lib)) || `rawInBody=${raw}`;
});
row(W("…and driven: no answer it gives to a stranger contains our schema"), "POST four shapes and scan every body", async (c) => {
  for (const [s, body] of [["zomato", order()], ["swiggy", {}], ["dunzo", order()], ["zomato", { items: "nope" }]]) {
    const r = await POST(c.N, hook(s), body);
    if (/PGRST|relation "|violates |duplicate key|aggregator_orders_/i.test(r.txt)) return `${s}: ${r.txt.slice(0, 120)}`;
  }
  return true;
});
row(L("no secret configured means REFUSE, not welcome — a dormant integration must not accept everything"), "verifyWebhook with the env var absent", async () => {
  const { execFileSync } = await import("node:child_process");
  execFileSync("npx", ["esbuild", "lib/aggregators.ts", "--bundle", "--platform=node", "--format=esm", "--alias:@=.",
    "--outfile=node_modules/.cache/t28r2-agg.mjs", "--log-level=error"], { cwd: process.cwd() });
  const m = await import(`${process.cwd()}/node_modules/.cache/t28r2-agg.mjs?v=${Date.now()}`);
  const keep = { z: process.env.ZOMATO_WEBHOOK_SECRET, s: process.env.SWIGGY_WEBHOOK_SECRET };
  delete process.env.ZOMATO_WEBHOOK_SECRET; delete process.env.SWIGGY_WEBHOOK_SECRET;
  try {
    const a = await m.verifyWebhook("zomato", "anything"), b = await m.verifyWebhook("swiggy", "anything");
    return !!(a === false && b === false) || `zomato=${a} swiggy=${b}`;
  } finally { if (keep.z !== undefined) process.env.ZOMATO_WEBHOOK_SECRET = keep.z; if (keep.s !== undefined) process.env.SWIGGY_WEBHOOK_SECRET = keep.s; }
});
row(L("…and the compare is hashed and constant-time, never a plain ==="), "read verifyWebhook's body", async () => {
  const src = code(read("lib/aggregators.ts"));
  const fn = src.slice(src.indexOf("export async function verifyWebhook"));
  const body = fn.slice(0, fn.indexOf("\n}") + 2);
  if (/headerSecret\s*===\s*secret|secret\s*===\s*headerSecret/.test(body)) return "a plain === is back";
  return /safeEqual\(\s*await sha256hex\(headerSecret\)\s*,\s*await sha256hex\(secret\)\s*\)/.test(body) || `body: ${body.trim().slice(0, 130)}`;
});
row(L("each platform's lock is its own — Swiggy's secret does not open Zomato's door"), "configure both, cross them", async () => {
  const m = await import(`${process.cwd()}/node_modules/.cache/t28r2-agg.mjs?v=${Date.now()}`);
  process.env.ZOMATO_WEBHOOK_SECRET = "t28r2-z"; process.env.SWIGGY_WEBHOOK_SECRET = "t28r2-s";
  try {
    const crossed = await m.verifyWebhook("swiggy", "t28r2-z"), own = await m.verifyWebhook("swiggy", "t28r2-s");
    return !!(crossed === false && own === true) || `crossed=${crossed} own=${own}`;
  } finally { delete process.env.ZOMATO_WEBHOOK_SECRET; delete process.env.SWIGGY_WEBHOOK_SECRET; }
});
row(L("the platform-wide flag is a rows-free COUNT with the filter pushed into the database"), "read aggregatorsEnabled", async () => {
  const src = code(read("lib/aggregators.ts"));
  const fn = src.slice(src.indexOf("export async function aggregatorsEnabled"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  return !!(/count:\s*"exact",\s*head:\s*true/.test(body) && /\.eq\(\s*"features->>aggregators"\s*,\s*"true"\s*\)/.test(body))
    || "it no longer asks Postgres to do the filtering";
});
row(L("…and a FAILED read is never cached, so a blip cannot switch the integration off for the whole TTL"), "read the order of the error test and the cache write", async () => {
  const src = code(read("lib/aggregators.ts"));
  const fn = src.slice(src.indexOf("export async function aggregatorsEnabled"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  const iErr = body.indexOf("if (r.error) return false"), iSet = body.indexOf("aggAny = {");
  return !!(iErr > -1 && iSet > iErr) || `error test at ${iErr}, cache write at ${iSet}`;
});
row(L("an order's restaurant is RESOLVED or REFUSED — it never falls back to restaurant #1"), "read: no DEFAULT_RESTAURANT_ID fallback in the resolver, and the route passes one explicitly", async () => {
  const lib = code(read("lib/aggregators.ts"));
  const fn = lib.slice(lib.indexOf("export async function resolveWebhookRestaurant"));
  const body = fn.slice(0, fn.indexOf("\nexport ") > 0 ? fn.indexOf("\nexport ") : fn.length);
  const route = code(read("app/api/aggregators/webhook/[source]/route.ts"));
  return !!(!/DEFAULT_RESTAURANT_ID/.test(body) && /ingestIncoming\([^)]*restaurantId\)/.test(route))
    || "the resolver can fall back to a default restaurant, or the route does not pass one";
});
row(L("…and two restaurants claiming one outlet is refused rather than picked between"), "read the multi-match branch", async () => {
  const src = code(read("lib/aggregators.ts"));
  const fn = src.slice(src.indexOf("export async function resolveWebhookRestaurant"));
  return !!(/matches\.length === 1/.test(fn) && /refusing to guess/.test(fn)) || "it no longer refuses an ambiguous outlet";
});
row(L("ingesting re-checks the target restaurant's own Platform module AND its channel, before the insert"), "read the order", async () => {
  const src = code(read("lib/aggregators.ts"));
  const fn = src.slice(src.indexOf("export async function ingestIncoming"));
  const at = [fn.indexOf("platformLadder(restaurantId)"), fn.indexOf('platform_channels?.[source]?.on !== true'), fn.indexOf("lfh_platform_insert")];
  return at.every((v, i) => v > -1 && (i === 0 || v > at[i - 1])) || `order was ${JSON.stringify(at)}`;
});
row(L("a RETRIED order is answered with the one we already hold, so the platform stops retrying"), "read the 23505 branch", async () => {
  const src = code(read("lib/aggregators.ts"));
  const fn = src.slice(src.indexOf("export async function ingestIncoming"));
  return !!(/23505/.test(fn) && /duplicate:\s*true/.test(fn) && /from\("aggregator_orders"\)/.test(fn))
    || "a repeated webhook is no longer answered with the original order";
});
row(L("the status push back to the platform has a deadline, feature-guarded because reading it can throw"), "read notifyAggregator", async () => {
  const src = code(read("lib/aggregators.ts"));
  const ms = Number((src.match(/NOTIFY_TIMEOUT_MS\s*=\s*(\d+)/) || [])[1] || 0);
  return !!(ms > 0 && ms <= 10_000 && /typeof AbortSignal\.timeout === "function"/.test(src) && /catch \{ signal = undefined; \}/.test(src))
    || `timeout=${ms} guarded=${/typeof AbortSignal\.timeout === "function"/.test(src)}`;
});
row(L("is this how a real restaurant needs it? a platform order that cannot be placed says so to the platform, not to nobody"), "read: every throw becomes a plain sentence the caller receives", async () => {
  const lib = code(read("lib/aggregators.ts"));
  const route = code(read("app/api/aggregators/webhook/[source]/route.ts"));
  return !!(/throw new Error\("Couldn't record that order — please retry\."\)/.test(lib)
    && /catch \(e\)[\s\S]{0,300}status:\s*500/.test(route) && /console\.error\(`\[aggregators\]/.test(lib))
    || "a failed ingest no longer reaches the platform as a plain retryable sentence with the detail kept our side";
});
