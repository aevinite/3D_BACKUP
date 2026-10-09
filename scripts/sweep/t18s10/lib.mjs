// scripts/sweep/t18s10/lib.mjs — shared core for sweep #10 · terminal 18 (the access & permission model).
//
// Two jobs:
//   1. load(<lib>) bundles one of the territory's TypeScript libraries with esbuild (the same way
//      `npm run verify:access` does) and imports it. The database client and the three neighbours
//      that would reach a network (`supabaseAdmin`, `staffAuth`, `tableTags`, `./menu`) are swapped
//      for in-memory stand-ins driven through `globalThis.__t18`, so the PURE logic of every file can
//      be exercised with nothing written anywhere. `loadReal()` bundles with the real client, for the
//      read-only database checks in db.mjs.
//   2. a tiny check runner: chk(id, file, check, how, fn) → one ledger row. A check returns true,
//      a string (the note; ✅), or throws / returns false (❌). skip(...) records ⏭ with its reason.
import { build } from "esbuild";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CACHE = join(ROOT, "node_modules", ".cache", "t18s10");
mkdirSync(CACHE, { recursive: true });

export const src = (rel) => readFileSync(join(ROOT, rel), "utf8");

// In-memory stand-ins. Each reads its behaviour from globalThis.__t18 at CALL time, so one bundle
// serves every scenario a check sets up.
const STUBS = {
  "@/lib/supabaseAdmin": `export const supabaseAdmin = new Proxy({}, { get: (_, k) => (...a) => globalThis.__t18.sb[k](...a) });`,
  "@/lib/staffAuth": `export const AUTH_COOKIE = "lfh_staff_auth"; export async function tokenIsValid(t) { return globalThis.__t18.tokenOk(t); }`,
  "@/lib/tableTags": `export async function payrollLadder(rid) { return { effective: globalThis.__t18.payroll(rid) }; }`,
  "./menu": `export async function getSettings(rid) { return globalThis.__t18.getSettings(rid); } export function invalidateSettings(rid) { globalThis.__t18.invalidated.push(rid); }`,
  // lib/tenant.ts builds a real client at import; features.ts only needs this one constant from it.
  "./tenant": `export const DEFAULT_RESTAURANT_ID = "00000000-0000-0000-0000-000000000001";`,
};

const stubPlugin = (keep = []) => ({
  name: "t18-stubs",
  setup(b) {
    for (const spec of Object.keys(STUBS)) {
      if (keep.includes(spec)) continue;
      const filter = new RegExp("^" + spec.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "$");
      b.onResolve({ filter }, () => ({ path: spec, namespace: "t18stub" }));
    }
    b.onLoad({ filter: /.*/, namespace: "t18stub" }, (a) => ({ contents: STUBS[a.path], loader: "js" }));
  },
});

const loaded = new Map();
/** Bundle lib/<name>.ts with the stand-ins and import it. */
export async function load(name, { keep = [] } = {}) {
  const key = name + "|" + keep.join(",");
  if (loaded.has(key)) return loaded.get(key);
  const out = join(CACHE, `${name.replace(/\W/g, "_")}${keep.length ? "-real" : ""}.mjs`);
  await build({
    entryPoints: [join(ROOT, "lib", `${name}.ts`)], bundle: true, platform: "node", format: "esm",
    outfile: out, alias: { "@": ROOT }, logLevel: "error", plugins: [stubPlugin(keep)],
    external: ["react", "next", "next/*", "@supabase/*"],
  });
  const mod = await import(pathToFileURL(out).href + `?t=${Date.now()}`);
  loaded.set(key, mod);
  return mod;
}

/** A recording stand-in for a supabase client: every chained call is captured, the terminal await
 *  answers `reply(captured)`. Lets a check assert WHICH table, columns and filters a read used. */
export function fakeClient(reply) {
  const calls = [];
  const from = (table) => {
    const q = { table, ops: [] };
    calls.push(q);
    const chain = new Proxy({}, {
      get(_, k) {
        if (k === "then") return (res, rej) => Promise.resolve(reply(q)).then(res, rej);
        return (...a) => { q.ops.push([k, ...a]); return chain; };
      },
    });
    return chain;
  };
  return { calls, from };
}

// ── the runner ──────────────────────────────────────────────────────────────────────────────
export const results = [];
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
export async function chk(id, file, check, how, fn) {
  let result = "✅", note = "";
  try {
    const r = await fn();
    if (r === false) { result = "❌"; note = "returned false"; }
    else if (typeof r === "string") note = r;
  } catch (e) { result = "❌"; note = String(e?.message || e).slice(0, 400); }
  results.push({ id, file, check, how, result, note });
}
export function skip(id, file, check, how, why) { results.push({ id, file, check, how, result: "⏭", note: why }); }
export function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
export const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg || "not equal"}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

/** Write the results as ledger rows (markdown) + JSON, and print a summary. */
export function report(tag) {
  const dir = join(ROOT, "node_modules", ".cache", "t18s10");
  writeFileSync(join(dir, `${tag}.json`), JSON.stringify(results, null, 1));
  const md = results.map((r) => `| ${r.id} | \`${r.file}\` — ${esc(r.check)} | ${esc(r.how)} | ${r.result} | ${esc(r.note)} |`).join("\n");
  writeFileSync(join(dir, `${tag}.md`), md + "\n");
  const n = (k) => results.filter((r) => r.result === k).length;
  console.log(`${tag}: ${results.length} rows · ✅ ${n("✅")} · ❌ ${n("❌")} · ⏭ ${n("⏭")}`);
  for (const r of results.filter((x) => x.result === "❌")) console.log(`  ❌ ${r.id} ${r.check} — ${r.note}`);
  return { pass: n("✅"), fail: n("❌"), skip: n("⏭") };
}
