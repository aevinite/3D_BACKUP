// Shared helpers for sweep #9, terminal 5 (guest chrome, offline, every language,
// and every remaining shared component). Static reading only — no server, no database.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(new URL("../../../", import.meta.url).pathname);

const cache = new Map();
export function src(rel) {
  if (!cache.has(rel)) {
    const p = join(ROOT, rel);
    cache.set(rel, existsSync(p) ? readFileSync(p, "utf8") : null);
  }
  return cache.get(rel);
}
export function has(rel) { return src(rel) !== null; }

// Strip comments so a claim is never "proved" by a note ABOUT the thing.
// Line comments FIRST, then block comments — a `/*` sitting inside a `//` line
// otherwise swallows everything down to the next `*/` (sweep-#8 lesson).
export function stripComments(s) {
  if (!s) return "";
  const out = [];
  for (const line of s.split("\n")) {
    let i = -1, inS = null;
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      if (inS) { if (c === "\\") k++; else if (c === inS) inS = null; continue; }
      if (c === '"' || c === "'" || c === "`") { inS = c; continue; }
      if (c === "/" && line[k + 1] === "/") { i = k; break; }
    }
    out.push(i >= 0 ? line.slice(0, i) : line);
  }
  return out.join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
}
export function code(rel) { return stripComments(src(rel)); }

export function walk(dir, filter, acc = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return acc;
  for (const e of readdirSync(abs)) {
    const rel = join(dir, e);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, filter, acc);
    else if (filter(rel)) acc.push(rel);
  }
  return acc;
}

export function grepRepo(re, dirs = ["app", "components", "lib", "public"]) {
  const hits = [];
  for (const d of dirs) {
    for (const f of walk(d, (r) => /\.(tsx?|mjs|js|css|html|json)$/.test(r))) {
      if (f.includes("node_modules")) continue;
      const s = src(f);
      if (s && re.test(s)) hits.push(f);
    }
  }
  return hits;
}

export function makeRunner(title) {
  let ok = 0, bad = 0, skip = 0;
  const fails = [];
  const pending = [];
  const results = [];
  const only = (() => {
    const i = process.argv.indexOf("--only");
    return i > 0 && process.argv[i + 1] ? new Set(process.argv[i + 1].split(",")) : null;
  })();
  // Async-aware BOTH WAYS. A live check returns a promise, a static one does not. An earlier
  // version awaited inside check(), and the sync callers then reached done() before a single
  // row had been counted — it printed "0 rows", which is the worst possible failure for a
  // suite whose whole job is to notice things. So every call is queued and done() waits.
  function record(id, what, r) {
    if (r === true) { ok++; results.push(`${id} ✅`); return; }
    if (typeof r === "string" && (r === "skip" || r.startsWith("SKIP:"))) {
      skip++;
      const why = r.replace(/^SKIP:\s*/, "");
      results.push(`${id} ⏭ ${why}`);
      console.log(`⏭ ${id}  ${what}  — ${why}`);
      return;
    }
    bad++; fails.push(id); results.push(`${id} ❌ ${r}`);
    console.log(`❌ ${id}  ${what}  — ${r}`);
  }
  function check(id, what, fn) {
    if (only && !only.has(id)) return Promise.resolve();
    let r;
    try { r = fn(); } catch (e) { r = "threw: " + (e && e.message); }
    if (r && typeof r.then === "function") {
      const pr = r.then((v) => record(id, what, v), (e) => record(id, what, "threw: " + (e && e.message)));
      pending.push(pr);
      return pr;
    }
    record(id, what, r);
    return Promise.resolve();
  }
  async function done() {
    await Promise.all(pending);
    console.log(`${title}: ${ok} ✅ · ${bad} ❌ · ${skip} ⏭  (${ok + bad + skip} rows)`);
    if (fails.length) console.log("   red: " + fails.join(", "));
    // A machine-readable list, so the ledger stamper takes its ids from what actually RAN
    // rather than from a list typed by hand.
    if (process.env.T5_IDS) {
      const { appendFileSync } = await import("node:fs");
      appendFileSync(process.env.T5_IDS, results.join("\n") + "\n");
    }
    process.exit(bad ? 1 : 0);
  }
  return { check, done };
}
