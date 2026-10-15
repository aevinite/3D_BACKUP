// scripts/sweep/t4s10/lib.mjs — the shared harness for sweep #10, terminal 4 (THE TABLE SESSION —
// a table shows only its own party: who owns a table, joining, closing, the guest gates, and the
// guest's live channel config).
//
// Territory (24 files): app/api/{blocked,issue-media,rt-config}/route.ts · app/api/r/[restaurant]/menu-data
// · components/{BanGate,BotTrap,SessionCartSync,SessionGate,SessionOwner,SessionStatusWidget,SessionTableBill}
// · lib/{botCheck,channelKey,guestDevice,guestName,openSession,restaurant-context,session,sessionClose,
// table,tableAssign,tableConnection,tableMerge,tenantStorage}.
//
// FOUR sources, and every row's `how` column starts with the one it used:
//   · SRC  — the file as it is on disk (comments stripped where the rule is about code, never prose)
//   · STUB — the REAL file bundled with esbuild and CALLED in memory, with the database / browser
//            stood in for (./stubs/*). Nothing opens a socket.
//   · LIVE — this terminal's own production build on port 4404 (never 4000), driven like a diner.
//   · DB   — one read-only, scoped, limited statement against the dev database.
//
// Never: a swapped id, a write to Aangan's switches, a repeat of a rate-limited action to "see the wall".
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Node's own fetch, captured before any block stands in for it (blocks C and D replace globalThis.fetch
// to watch the guest beacon) — the live block must talk to the real server.
export const REAL_FETCH = globalThis.fetch;
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const rd = (rel) => readFileSync(join(ROOT, rel), "utf8");
// Line comments first, then block comments — the order this repo learned the hard way.
export function strip(src) {
  const noLine = src.split("\n").map((l) => {
    let q = null, esc = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; continue; }
      if (c === "/" && l[i + 1] === "/") return l.slice(0, i);
    }
    return l;
  }).join("\n");
  return noLine.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}
export const count = (t, re) => (t.match(re) || []).length;

export const FILES = {
  blocked: "app/api/blocked/route.ts",
  media: "app/api/issue-media/route.ts",
  menuData: "app/api/r/[restaurant]/menu-data/route.ts",
  rt: "app/api/rt-config/route.ts",
  ban: "components/BanGate.tsx",
  trap: "components/BotTrap.tsx",
  cartSync: "components/SessionCartSync.tsx",
  gate: "components/SessionGate.tsx",
  owner: "components/SessionOwner.tsx",
  card: "components/SessionStatusWidget.tsx",
  tbill: "components/SessionTableBill.tsx",
  bot: "lib/botCheck.ts",
  chan: "lib/channelKey.ts",
  gdev: "lib/guestDevice.ts",
  gname: "lib/guestName.ts",
  open: "lib/openSession.ts",
  ctx: "lib/restaurant-context.tsx",
  sess: "lib/session.ts",
  close: "lib/sessionClose.ts",
  table: "lib/table.ts",
  assign: "lib/tableAssign.ts",
  conn: "lib/tableConnection.ts",
  merge: "lib/tableMerge.ts",
  ts: "lib/tenantStorage.ts",
};
// ROUND 2 (2026-10-15): a deliberate-break run names ONE file and a broken copy of it —
// T4_MUT_FILE=<repo-relative file> T4_MUT_SRC=<absolute path of the copy>. Every load of that file (bundle,
// screen lab, or a read of its source) then gets the copy, so a check is judged against the break.
export const MUT = process.env.T4_MUT_FILE ? { file: process.env.T4_MUT_FILE, src: readFileSync(process.env.T4_MUT_SRC, "utf8") } : null;
export const srcOf = (rel) => (MUT && MUT.file === rel ? MUT.src : rd(rel));
export const SRC = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, srcOf(f)]));
export const CODE = Object.fromEntries(Object.entries(SRC).map(([k, t]) => [k, strip(t)]));

/** The brace-matched body of the first declaration starting with `head`. Throws when it has moved. */
export function bodyOf(text, head) {
  const i = text.indexOf(head);
  if (i < 0) throw new Error(`t4s10: landmark not found — ${head}. Re-derive it; never let a check read an empty slice.`);
  const open = text.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === "{") depth++;
    else if (text[j] === "}") { depth--; if (depth === 0) return text.slice(i, j + 1); }
  }
  throw new Error(`t4s10: unbalanced body after ${head}`);
}

// ── THE ID BLOCK — P173001…P174000, sweep #10 terminal 4's alone ──────────────────────────────
export const ID_FLOOR = 173001, ID_CEILING = 174000;
const defs = [];
let nextN = null;
/** Give the next id in a band. Bands are set per block file with band(start). */
export function band(start) { nextN = start; }
export function nid() { if (nextN == null) throw new Error("t4s10: band() not set"); const id = `P${nextN}`; nextN++; return id; }
/** check(file, what, how, fn) — `file` is the SUBJECT (a FILES value); `fn` returns true/false, {ok,note}, or "skip: …". */
export const check = (file, what, how, fn) => defs.push({ id: nid(), file, what, how, fn });

export async function runAll({ ledger = false, quiet = false, only = null, file = null, kinds = null, bail = false } = {}) {
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
    if (file && d.file !== file) continue;                                   // --file=<subject>
    if (kinds && !kinds.some((k) => String(d.how).startsWith(k))) continue;  // --kinds=STUB,LAB
    let res, note = "";
    try { res = await d.fn(); } catch (e) { res = false; note = `threw: ${(e && e.message) || e}`.slice(0, 220); }
    let mark;
    if (typeof res === "string" && res.startsWith("skip:")) { mark = "⏭"; note = res.slice(5).trim(); }
    else if (res && typeof res === "object") { mark = res.ok ? "✅" : "❌"; note = res.note || note; }
    else mark = res ? "✅" : "❌";
    rows.push({ ...d, mark, note });
    if (bail && mark === "❌") { console.log(`❌ ${d.id}  ${d.what}`); return rows; }   // --bail: first red ends the run
    if (!ledger && (!quiet || mark === "❌")) console.log(`${mark} ${d.id}  ${d.what}${note ? `   — ${note}` : ""}`);
  }
  const esc = (x) => String(x).replace(/\|/g, "¦").replace(/\n/g, " ");
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
// esbuild's API (not its CLI) because the stand-ins have to replace RELATIVE imports too
// (lib/session.ts imports "./supabase"), which `--alias` refuses.
const require_ = createRequire(import.meta.url);
const CACHE = join(ROOT, "node_modules/.cache");
const STUB = (n) => join(ROOT, "scripts/sweep/t4s10/stubs", n);
// repo module (no extension) → stand-in. Anything not listed is bundled for real.
export const STANDINS = {
  "lib/supabaseAdmin": STUB("sb.mjs"),
  "lib/supabase": STUB("supabase.mjs"),
  "lib/oplog": STUB("misc.mjs"),
  "lib/removalAudit": STUB("misc.mjs"),
  "lib/userAuth": STUB("auth.mjs"),
  "lib/staffAuth": STUB("auth.mjs"),
  "lib/issues": STUB("misc.mjs"),
  "lib/menuDataServer": STUB("misc.mjs"),
  "lib/tableOfAction": STUB("misc.mjs"),
};
/** Opt-in stand-ins a block names in load(…, { extra }) — the real file is the default. */
export const OPTIONAL = { "lib/tenant": STUB("tenant.mjs") };
function resolveRepo(spec, resolveDir) {
  let abs = null;
  if (spec.startsWith("@/")) abs = join(ROOT, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) abs = join(resolveDir, spec);
  if (!abs) return null;
  return abs.replace(/\.(tsx?|mjs|js)$/, "");
}
const extFor = (absNoExt) => {
  for (const e of [".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"]) { try { readFileSync(absNoExt + e); return absNoExt + e; } catch {} }
  return null;
};
/** Bundle one repo file with stand-ins and return a FRESH module (module state starts empty). */
export async function load(rel, { real = [], extra = {}, tag = "" } = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:9/stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "stub-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "stub-service-key";
  mkdirSync(CACHE, { recursive: true });
  const stem = `t4s10-${(rel + tag).replace(/[^A-Za-z0-9]+/g, "_")}`;
  const map = { ...STANDINS, ...extra };
  for (const r of real) delete map[r];
  const esbuild = (await import("esbuild")).default;
  const COVER = process.env.T4_COVER === "1";
  const built = await esbuild.build({
    entryPoints: [join(ROOT, rel)], bundle: true, platform: "node", format: "cjs", outfile: join(CACHE, stem + ".cjs"), logLevel: "silent",
    write: false, ...(COVER ? { sourcemap: "inline", sourcesContent: false } : {}),
    jsx: "automatic", loader: { ".js": "jsx" },
    external: ["next/server", "next/cache", "next/headers", "next/navigation", "react", "react/jsx-runtime", "react-dom"],
    plugins: [{ name: "t4s10-standins", setup(b) {
      b.onResolve({ filter: /^(@\/|\.\.?\/)/ }, (a) => {
        const abs = resolveRepo(a.path, a.resolveDir);
        if (!abs) return undefined;
        const key = abs.startsWith(ROOT + "/") ? abs.slice(ROOT.length + 1) : null;
        if (key && map[key]) return { path: map[key] };
        if (a.path.startsWith("@/")) { const f = extFor(abs); return f ? { path: f } : undefined; }
        return undefined;
      });
      // the deliberate-break copy stands in for its file, wherever it is imported from
      if (MUT) b.onLoad({ filter: /\.(tsx?|mjs|js)$/ }, (a) => {
        if (a.path !== join(ROOT, MUT.file)) return undefined;
        return { contents: MUT.src, loader: a.path.endsWith(".tsx") ? "tsx" : a.path.endsWith(".ts") ? "ts" : "js", resolveDir: dirname(a.path) };
      });
    } }],
  });
  // A content-hashed name: the same file bundled two ways (different stand-ins) must not share one path,
  // or a coverage record would be mapped through the wrong bundle's source map.
  const text = built.outputFiles[0].text;
  const out = join(CACHE, `${stem}-${createHash("sha1").update(text).digest("hex").slice(0, 10)}.cjs`);
  writeFileSync(out, text);
  delete require_.cache[out];
  return require_(out);
}
export const req = require_;
export const nextServer = () => require_("next/server");
/** The stand-in world shared by every bundle (each bundle carries its own copy of the stubs, so the
 *  state they read lives on globalThis, here). */
export const W = (globalThis.__t4s10 ||= { rpc: {}, rpcLog: [], from: {}, fromLog: [], auth: {}, misc: {} });
export function resetWorld() { W.rpc = {}; W.rpcLog = []; W.from = {}; W.fromLog = []; W.auth = {}; W.misc = {}; }
