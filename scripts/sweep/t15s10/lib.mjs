// scripts/sweep/t15s10/lib.mjs — sweep #10 · terminal 15 (the print queue and the print helper).
//
// The same two jobs as the other sweep-#10 harnesses (t18s10 is the model):
//   1. load(<lib>) bundles one of the territory's TypeScript files with esbuild and imports it. By
//      default `@/lib/supabaseAdmin` is swapped for a RECORDING stand-in (globalThis.__t15.sb), so a
//      check can assert which table, which columns and which filters a function uses, and what it
//      does with an answer, with nothing written anywhere. loadReal() keeps the real client, for the
//      read-only lookups in the live banks.
//   2. a runner: chk(id, file, check, how, fn) → one ledger row. A check returns true or a string
//      (the note; ✅), or throws / returns false (❌). skip(...) records ⏭ with what a later session
//      must do.
//
// IDS ARE WRITTEN IN EACH ROW, never counted out at run time. sweep #8 T11's harness numbered its
// rows by position, so deleting one row in September silently renumbered every row after it and the
// whole harness has refused to run since (bank J "ended at P101233, not P101234"). A row here keeps
// its id for ever, whatever is added or removed around it.
import { build } from "esbuild";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CACHE = join(ROOT, "node_modules", ".cache", "t15s10");
mkdirSync(CACHE, { recursive: true });
export const src = (rel) => readFileSync(join(ROOT, rel), "utf8");
/** Code with comments removed — LINE comments first, then BLOCK (the order is the bug that hid 190
 *  lines from two shipped guards; see verify-print-helper's `code`). Keeps `://` in URLs. */
export const codeOnly = (s) => String(s)
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const STUBS = {
  "@/lib/supabaseAdmin": `export const supabaseAdmin = new Proxy({}, { get: (_, k) => (...a) => globalThis.__t15.sb[k](...a) });`,
  "@/lib/alerts": `export async function sendOwnerAlert(...a) { (globalThis.__t15.alerts ||= []).push(a); }`,
  "@/lib/tableTags": `export async function allModuleLadders(rid) { return globalThis.__t15.ladders ? globalThis.__t15.ladders(rid) : {}; }`,
};
const stubPlugin = (keep = []) => ({
  name: "t15-stubs",
  setup(b) {
    for (const spec of Object.keys(STUBS)) {
      if (keep.includes(spec)) continue;
      const filter = new RegExp("^" + spec.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "$");
      b.onResolve({ filter }, () => ({ path: spec, namespace: "t15stub" }));
    }
    b.onLoad({ filter: /.*/, namespace: "t15stub" }, (a) => ({ contents: STUBS[a.path], loader: "js" }));
  },
});
const loaded = new Map();
export async function load(rel, { keep = [] } = {}) {
  const key = rel + "|" + keep.join(",");
  if (loaded.has(key)) return loaded.get(key);
  const out = join(CACHE, `${rel.replace(/\W/g, "_")}${keep.length ? "-real" : ""}.mjs`);
  await build({
    entryPoints: [join(ROOT, rel)], bundle: true, platform: "node", format: "esm",
    outfile: out, alias: { "@": ROOT }, logLevel: "error", plugins: [stubPlugin(keep)],
    external: ["react", "next", "next/*", "@supabase/*"],
  });
  const mod = await import(pathToFileURL(out).href + `?t=${Date.now()}`);
  loaded.set(key, mod);
  return mod;
}

/** A recording stand-in for a supabase client. Every chained call is captured; awaiting the chain
 *  answers reply(captured). `calls` is the list of statements, in order. */
export function fakeClient(reply = () => ({ data: null, error: null })) {
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
export const has = (q, op, ...args) => q.ops.some(([k, ...a]) => k === op && args.every((x, i) => JSON.stringify(a[i]) === JSON.stringify(x)));
export const opOf = (q, op) => q.ops.find(([k]) => k === op);

// ── the runner ────────────────────────────────────────────────────────────────────────────────
export const results = [];
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const ONLY = (() => { const i = process.argv.indexOf("--ids"); return i > 0 ? new Set(process.argv[i + 1].split(",")) : null; })();
export async function chk(id, file, check, how, fn) {
  if (ONLY && !ONLY.has(id)) return;
  let result = "✅", note = "";
  try {
    const r = await fn();
    if (r === false) { result = "❌"; note = "returned false"; }
    else if (typeof r === "string") note = r;
  } catch (e) { result = "❌"; note = String(e?.message || e).slice(0, 400); }
  results.push({ id, file, check, how, result, note });
}
export function skip(id, file, check, how, why) {
  if (ONLY && !ONLY.has(id)) return;
  results.push({ id, file, check, how, result: "⏭", note: why });
}
export function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
export const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg || "not equal"}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

const finishers = [];
export const onFinish = (fn) => finishers.push(fn);
export async function runFinishers() {
  for (const f of finishers.splice(0)) { try { await f(); } catch (e) { console.log("  ⚠ a cleanup step failed: " + (e?.message || e)); } }
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { runFinishers().finally(() => process.exit(130)); });

export function report(tag, { anyIds = false } = {}) {
  const ids = results.map((r) => r.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) { console.log(`${tag}: DUPLICATE ids ${[...new Set(dup)].join(", ")}`); process.exitCode = 2; }
  // NEW rows must come from T15's block; the re-run of OLDER rows (rerun.mjs) keeps each row's own id.
  const bad = anyIds ? [] : ids.filter((x) => { const n = Number(x.slice(1)); return !(n >= 184001 && n <= 185000); });
  if (bad.length) { console.log(`${tag}: ids outside the T15 block: ${bad.join(", ")}`); process.exitCode = 2; }
  writeFileSync(join(CACHE, `${tag}.json`), JSON.stringify(results, null, 1));
  const md = results.map((r) => `| ${r.id} | \`${r.file}\` — ${esc(r.check)} | ${esc(r.how)} | ${r.result} | ${esc(r.note)} |`).join("\n");
  writeFileSync(join(CACHE, `${tag}.md`), md + "\n");
  const n = (k) => results.filter((r) => r.result === k).length;
  console.log(`${tag}: ${results.length} rows · ✅ ${n("✅")} · ❌ ${n("❌")} · ⏭ ${n("⏭")}`);
  for (const r of results.filter((x) => x.result === "❌")) console.log(`  ❌ ${r.id} ${r.check} — ${r.note}`);
  return { pass: n("✅"), fail: n("❌"), skip: n("⏭") };
}
export const CACHE_DIR = CACHE;
