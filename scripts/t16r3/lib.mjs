// scripts/t16r3/lib.mjs — the ROUND-3 test of the shared panel plumbing (sweep #10 T16, 2026-10-16).
//
// Planned from scratch at the owner's word ("don't use the previous one, replan the whole thing"):
// nothing here imports the earlier suites. Every family runs the REAL shipped files in a real browser
// against a tiny local server of its own (./server.mjs) — no app, no dev database, no login — so it
// can never add load, set off one of the app's own limits, or write a row; and it can run in WebKit
// and Firefox as well as Chromium. Checks are numbered per family: R3-A-001, R3-B-014 …
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
/** The shipped file, or — in a mutation run — the broken copy standing in for it (T16_MUT / T16_MUT_REL). */
export function panelFile(f) {
  const rel = "public/panels/" + f;
  if (process.env.T16_MUT && process.env.T16_MUT_REL === rel) return readFileSync(process.env.T16_MUT, "utf8");
  return readFileSync(join(ROOT, rel), "utf8");
}

// ── a small seeded random generator (mulberry32), so every failure names a seed that replays it ──
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (arr) => arr[Math.floor(next() * arr.length)], bool: (p = 0.5) => next() < p };
}

// ── the registry ──────────────────────────────────────────────────────────────────────────────
const checks = [];
const counters = {};
/** C(family, subject, what, fn) — fn returns true/false, { ok, note }, or "skip: why". */
export function C(family, subject, what, fn) {
  counters[family] = (counters[family] || 0) + 1;
  checks.push({ id: `R3-${family}-${String(counters[family]).padStart(3, "0")}`, family, subject, what, fn });
}
export const ok = (cond, note) => ({ ok: !!cond, note: note == null ? "" : String(note) });

export async function runChecks({ only = null, families = null, quiet = false, bail = false } = {}) {
  const rows = [];
  for (const c of checks) {
    if (families && !families.has(c.family)) continue;
    if (only && !only.has(c.id)) continue;
    const t0 = Date.now();
    let res, note = "";
    try { res = await c.fn(); } catch (e) { const m = String((e && e.message) || e); if (m.startsWith("skip:")) res = m; else { res = false; note = "threw: " + m.slice(0, 240); } }
    let mark;
    if (typeof res === "string" && res.startsWith("skip:")) { mark = "⏭"; note = res.slice(5).trim(); }
    else if (res && typeof res === "object" && "ok" in res) { mark = res.ok ? "✅" : "❌"; note = res.note || note; }
    else mark = res ? "✅" : "❌";
    rows.push({ id: c.id, family: c.family, subject: c.subject, what: c.what, mark, note: String(note).replace(/\s+/g, " ").slice(0, 300), ms: Date.now() - t0 });
    if (!quiet && mark !== "✅") console.log(`  ${mark} ${c.id}  ${c.subject} — ${c.what}${note ? ` — ${String(note).slice(0, 240)}` : ""}`);
    if (process.env.R3_PROGRESS) console.log(`  ${mark} ${c.id} ${Date.now() - t0}ms`);
    if (bail && mark === "❌") { console.log(`❌ ${c.id}`); break; }
  }
  return rows;
}
