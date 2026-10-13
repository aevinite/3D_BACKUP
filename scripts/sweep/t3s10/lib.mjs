// scripts/sweep/t3s10/lib.mjs — the shared harness for sweep #10, terminal 3 (ORDERING: the basket,
// placing an order, calling staff, rating).
//
// Territory (14 files): app/api/guest/{call-waiter,leave,limit-hit,place-order}/route.ts ·
// components/{CartPanel,ChefCallButton,ChefPopup,GuestOutboxChip,MiniCart,OrderConfirmModal,
// OrderTracker,StarRating}.tsx · lib/guestOutbox.ts · lib/orderStatus.ts.
//
// FOUR sources, and every row's `how` column starts with the one it used:
//   · SRC  — the file as it is on disk (comments stripped where the rule is about code, never prose)
//   · STUB — the REAL file bundled with esbuild and CALLED in memory. For the saved-work queue that
//            means a fake phone (storage, IndexedDB, timers, network — ./phone.mjs); for the four
//            guest routes it means stand-ins for the database (./stubs/*). Nothing opens a socket.
//   · LIVE — this terminal's own built app on port 4403 (never 4000), driven like a diner would.
//   · DB   — one read-only, scoped, limited statement against the dev database.
//
// Never: a swapped id, a write to Aangan, a repeat of a rate-limited action to "see the wall".
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const rd = (rel) => readFileSync(join(ROOT, rel), "utf8");
export const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'`\\])\/\/[^\n"'`]*$/gm, "$1");
export const count = (t, re) => (t.match(re) || []).length;

export const FILES = {
  callWaiter: "app/api/guest/call-waiter/route.ts",
  leave: "app/api/guest/leave/route.ts",
  limitHit: "app/api/guest/limit-hit/route.ts",
  placeOrder: "app/api/guest/place-order/route.ts",
  cart: "components/CartPanel.tsx",
  bell: "components/ChefCallButton.tsx",
  chef: "components/ChefPopup.tsx",
  chip: "components/GuestOutboxChip.tsx",
  mini: "components/MiniCart.tsx",
  confirm: "components/OrderConfirmModal.tsx",
  tracker: "components/OrderTracker.tsx",
  stars: "components/StarRating.tsx",
  outbox: "lib/guestOutbox.ts",
  status: "lib/orderStatus.ts",
  // added to the territory in round 2 (item 7): the one shared "which restaurant is this token" helper
  tokenRid: "lib/guestTokenRestaurant.ts",
};
export const SRC = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, rd(f)]));
export const CODE = Object.fromEntries(Object.entries(SRC).map(([k, t]) => [k, strip(t)]));

/** The text of one top-level declaration in a file, up to the next top-level declaration. */
export function decl(text, head) {
  const i = text.indexOf(head);
  if (i < 0) throw new Error(`t3s10: landmark not found — ${head}. Re-derive it; never let a check read an empty slice.`);
  const rest = text.slice(i);
  const m = rest.slice(1).search(/\n(?:export |async function |function |const [A-Za-z_]+ = |type |interface )/);
  return m < 0 ? rest : rest.slice(0, m + 1);
}

// ── THE ID BLOCK — P172001…P173000, sweep #10 terminal 3's alone ──────────────────────────────
export const ID_FLOOR = 172001, ID_CEILING = 173000;
const defs = [];
/** check(id, file, what, how, fn) — `fn` returns true/false, {ok,note}, or "skip: …". `file` is the SUBJECT. */
export const check = (id, file, what, how, fn) => defs.push({ id, file, what, how, fn });

export async function runAll({ ledger = false, quiet = false, only = null } = {}) {
  const seen = new Set();
  for (const d of defs) {
    if (seen.has(d.id)) throw new Error(`duplicate id ${d.id}`);
    seen.add(d.id);
    const n = Number(String(d.id).slice(1));
    if (!(n >= ID_FLOOR && n <= ID_CEILING)) throw new Error(`${d.id} is outside this terminal's block`);
    if (!Object.values(FILES).includes(d.file)) throw new Error(`${d.id} names ${d.file}, which is not in this territory`);
  }
  const rows = [];
  for (const d of defs) {
    if (only && !only.includes(d.id)) continue;
    let res, note = "";
    try { res = await d.fn(); } catch (e) { res = false; note = `threw: ${(e && e.message) || e}`.slice(0, 200); }
    let mark;
    if (typeof res === "string" && res.startsWith("skip:")) { mark = "⏭"; note = res.slice(5).trim(); }
    else if (res && typeof res === "object") { mark = res.ok ? "✅" : "❌"; note = res.note || note; }
    else mark = res ? "✅" : "❌";
    rows.push({ ...d, mark, note });
    if (!ledger && (!quiet || mark === "❌")) console.log(`${mark} ${d.id}  ${d.what}${note ? `   — ${note}` : ""}`);
  }
  // Every run also leaves its results as data, so a ledger can be written from the run that was
  // actually looked at instead of from a second one (round 2).
  try { const { writeFileSync } = await import("node:fs"); writeFileSync(join(CACHE, "t3s10-last.json"), JSON.stringify(rows, (k, v) => (k === "fn" ? undefined : v))); } catch { /* best-effort */ }
  const esc = (x) => String(x).replace(/\|/g, "\\|").replace(/\n/g, " ");
  if (ledger) {
    for (const r of rows) console.log(`| ${r.id} | \`${r.file}\` — ${esc(r.what)} | ${esc(r.how)} | ${r.mark} | ${esc(r.note)} |`);
  } else {
    const bad = rows.filter((r) => r.mark === "❌"), sk = rows.filter((r) => r.mark === "⏭");
    console.log(`\n${rows.length} checks · ${rows.length - bad.length - sk.length} ✅ · ${bad.length} ❌ · ${sk.length} ⏭`);
    if (bad.length) { console.log("failures:"); for (const b of bad) console.log(`  ${b.id}  ${b.what}${b.note ? ` — ${b.note}` : ""}`); }
  }
  return rows;
}

// ── STUB: the real files, bundled ───────────────────────────────────────────────────────────────
const require_ = createRequire(import.meta.url);
const CACHE = join(ROOT, "node_modules/.cache");
const STUBS = "./scripts/sweep/t3s10/stubs";
const ROUTE_ALIASES = ["--alias:@=.",
  `--alias:@/lib/supabaseAdmin=${STUBS}/sb.mjs`,
  `--alias:@/lib/floorSummary=${STUBS}/floor.mjs`,
  `--alias:@/lib/planTable=${STUBS}/plan.mjs`,
  `--alias:@/lib/clash=${STUBS}/clash.mjs`,
  `--alias:@/lib/rateLimit=${STUBS}/rate.mjs`,
  "--external:next/server", "--external:next/cache", "--external:next/headers"];
const CLIENT_ALIASES = ["--alias:@=.", `--alias:react=${STUBS}/react.mjs`];
const outs = new Map();
/** Bundle one repo file and return the path of the built CommonJS file. */
export function built(rel, kind = "route") {
  const key = rel + "|" + kind;
  if (outs.has(key)) return outs.get(key);
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:9/stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "stub-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "stub-service-key";
  mkdirSync(CACHE, { recursive: true });
  const out = join(CACHE, `t3s10-${kind}-${rel.replace(/[^A-Za-z0-9]+/g, "_")}.cjs`);
  execFileSync("npx", ["esbuild", rel, "--bundle", "--platform=node", "--format=cjs",
    ...(kind === "route" ? ROUTE_ALIASES : CLIENT_ALIASES), `--outfile=${out}`, "--log-level=error"], { cwd: ROOT });
  outs.set(key, out);
  return out;
}
/** A FRESH copy of a bundled module — module-level state (the queue, the cap windows) starts empty. */
export function fresh(rel, kind = "route") {
  const out = built(rel, kind);
  delete require_.cache[out];
  return require_(out);
}
export const requireRepo = (p) => require_(join(ROOT, p));
export const nextServer = () => require_("next/server");
