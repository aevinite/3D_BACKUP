// scripts/sweep/t20s10/lib.mjs — sweep #10, terminal 20: the owner's home dashboard.
//
// Every check names the FILE it is about (the measuring loop in S10-RULES.md rule 3 counts rows by
// the subject file, and a row that names only a function is invisible to it). Results are written
// as JSON per band; `build-ledger.mjs` turns them into LEDGER/T20-S10.md, so the result column can
// never claim something no check produced.
//
// Ids are LITERAL and passed by the caller — never handed out by a counter — so inserting a check
// can never renumber the ones after it (sweep #8 T13's scar, written up in T13-S8.md).
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..", "..");
export const rel = (p) => join(ROOT, p);
export const src = (p) => {
  const f = rel(p);
  if (!existsSync(f)) throw new Error(`source missing: ${p}`);
  const t = readFileSync(f, "utf8");
  if (!t.length) throw new Error(`source empty: ${p}`);
  return t;
};

export const BLOCK = [189001, 190000];
export const results = [];
const seen = new Set();
let only = null;
export function setOnly(list) { only = list && list.length ? new Set(list) : null; }

/** chk(id, file, what, how, fn) — fn returns true (pass), a string (fail + reason), or throws (fail). */
export async function chk(id, file, what, how, fn) {
  if (only && !only.has(id)) return;
  const n = Number(String(id).slice(1));
  if (!/^P\d+$/.test(id) || n < BLOCK[0] || n > BLOCK[1]) throw new Error(`${id} is outside T20's block`);
  if (seen.has(id)) throw new Error(`${id} used twice`);
  seen.add(id);
  let r;
  try { r = await fn(); } catch (e) { r = `threw: ${e && e.message ? e.message : String(e)}`; }
  const pass = r === true;
  results.push({ id, file, what, how, pass, why: pass ? "" : typeof r === "string" ? r : `returned ${JSON.stringify(r)}` });
}
/** An honest skip, with what a later session should do. */
export function skip(id, file, what, how, why) {
  if (only && !only.has(id)) return;
  seen.add(id);
  results.push({ id, file, what, how, pass: null, why });
}

export function report(band, { expect } = {}) {
  const pass = results.filter((r) => r.pass === true).length;
  const fail = results.filter((r) => r.pass === false);
  const sk = results.filter((r) => r.pass === null);
  console.log(`\n${band}: ${pass} passed · ${fail.length} failed · ${sk.length} skipped (${results.length} rows)`);
  for (const f of fail) console.log(`  ❌ ${f.id} [${f.file}] ${f.what}\n       ${f.why}`);
  for (const s of sk) console.log(`  ⏭  ${s.id} [${s.file}] ${s.what}\n       ${s.why}`);
  if (!only && expect && results.length !== expect) {
    console.log(`HARNESS FAULT: ${results.length} rows ran, ${expect} expected — a band that shrinks silently prints "all clean".`);
    process.exitCode = 2;
  }
  const out = process.argv.find((a) => a.startsWith("--json="));
  if (out) { mkdirSync(dirname(out.slice(7)), { recursive: true }); writeFileSync(out.slice(7), JSON.stringify(results, null, 1)); }
  if (fail.length && !process.exitCode) process.exitCode = 1;
  return { pass, fail: fail.length, skipped: sk.length };
}

/** `--k value` or `--k=value` — both spellings, because both are in use in this folder's batch scripts. */
export const arg = (k, d) => {
  const eq = process.argv.find((a) => a.startsWith(`--${k}=`));
  if (eq) return eq.slice(k.length + 3);
  const i = process.argv.indexOf(`--${k}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
export const BASE = arg("base", "http://localhost:4420").replace(/\/$/, "");
/** Visible-text faults a person would see: an unfilled template, a JS value leaking as words. */
export const junk = (t) => (String(t).match(/\bundefined\b|\bNaN\b|\[object Object\]|\$\{|\bnull\b|Infinity/g) || []);
