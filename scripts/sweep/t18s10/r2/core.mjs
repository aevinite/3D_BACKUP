// scripts/sweep/t18s10/r2/core.mjs — the check runner for sweep #10 T18 round 2.
//
// One check = one ledger row. Ids are handed out in a FIXED order (block by block, check by check),
// first from the rest of this terminal's own block (P187504–P188000), then from the block claimed on
// main before a row was written (P165001–P165999). The same code gives the same ids every run, which is
// what lets a mutation run say WHICH row caught a break.
//
// Flags: --bail (stop at the first ❌ — mutation runs) · --quiet (no per-row output) · --only=<blocks>.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../..", import.meta.url)).replace(/\/$/, "");
export const BAIL = process.argv.includes("--bail");
export const QUIET = process.argv.includes("--quiet");
export const src = (rel) => readFileSync(join(ROOT, rel), "utf8");

const RANGES = [[187504, 188000], [165001, 165999]];
let cursor = 0;
function nextId() {
  let k = cursor++;
  for (const [a, b] of RANGES) { const size = b - a + 1; if (k < size) return `P${a + k}`; k -= size; }
  throw new Error("t18 r2: the id blocks are exhausted — STOP (S10-RULES rule 0)");
}
export const results = [];
export class Bail extends Error {}

/** chk(file, check, how, fn) — fn returns true/undefined (✅), a string note (✅), or throws (❌). */
export async function chk(file, check, how, fn) {
  const id = nextId();
  let result = "✅", note = "";
  globalThis.__t18 = { calls: [], reply: () => ({ data: null, error: null }) };
  try {
    const r = await fn();
    if (r === false) { result = "❌"; note = "returned false"; }
    else if (typeof r === "string") note = r;
  } catch (e) { result = "❌"; note = String(e?.message || e).slice(0, 500); }
  results.push({ id, file, check, how, result, note });
  if (!QUIET) console.log(`${result} ${id} ${file} — ${check}${result === "❌" ? ` :: ${note}` : ""}`);
  if (result === "❌" && BAIL) { console.log(`❌ ${id} ${check}`); throw new Bail(id); }
}
export const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
export const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m ? m + ": " : ""}got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
export const throws = (fn, re, m) => { try { fn(); } catch (e) { if (re && !re.test(String(e.message))) throw new Error(`${m || "threw"} the wrong words: ${e.message}`); return; } throw new Error(`${m || "expected a refusal"} — none came`); };
export const rejects = async (fn, re, m) => { try { await fn(); } catch (e) { if (re && !re.test(String(e.message))) throw new Error(`${m || "threw"} the wrong words: ${e.message}`); return; } throw new Error(`${m || "expected a refusal"} — none came`); };

/** A database answer for the in-memory client: reply(q) decides per query. */
export function db(reply) { globalThis.__t18.reply = reply; globalThis.__t18.calls = []; return globalThis.__t18.calls; }
export const calls = () => globalThis.__t18.calls;
