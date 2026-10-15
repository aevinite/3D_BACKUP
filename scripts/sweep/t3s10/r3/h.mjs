// scripts/sweep/t3s10/r3/h.mjs — the round-3 harness: a check list, a runner, and real-file loading.
//
// ROUND 3 (owner, 2026-10-15): "do a full bug test … replan whole test. Don't use the previous one."
// So this is a NEW suite, organised by WHAT CAN GO WRONG rather than by file:
//   A  coverage — every line and branch of the territory's code files is run by something (./cover.mjs)
//   B  the saved-work queue against a reference MODEL, thousands of random sequences
//   C  the four guest doors against random bodies
//   D  the order-status rules, exhaustively for small lists
//   E  the bell's send and the settings read (lib/menu.ts parts this territory calls)
//   M  mutation — hundreds of small breaks, each must turn something red (./mutate.mjs)
//   L  live: screens × states × skins × widths, failure injection, journeys, the idle phone (./live-*.mjs)
// Check ids are R3-<area><n>. They are NOT ledger rows: terminal 3's id block (P172001–P173000) is spent
// and the next-free-id line is not this terminal's to touch, so these report in chat and in
// .claude/sweep/T3-S10-findings.md, and are re-runnable from here.
//
// IN MEMORY ONLY for everything except ./live-*.mjs: nothing here opens a socket — the server's
// database is ../stubs/sb.mjs and the phone's network is ../phone.mjs's scripted fetch.
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const rd = (rel) => readFileSync(join(ROOT, rel), "utf8");
// The browser client reads these at import; the phone's fetch answers whatever it asks.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://stub.supabase.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "stub-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "stub-service-key";

let gen = 0;
/** A FRESH instance of a real repo file (its module-level state starts empty). */
export async function real(rel) { return import(pathToFileURL(join(ROOT, rel)).href + `?r3=${++gen}`); }

const CHECKS = [];
export function check(id, area, what, fn) { CHECKS.push({ id, area, what, fn }); }
export const CODE_FILES = [
  "app/api/guest/call-waiter/route.ts", "app/api/guest/leave/route.ts", "app/api/guest/limit-hit/route.ts",
  "app/api/guest/place-order/route.ts", "lib/guestOutbox.ts", "lib/orderStatus.ts", "lib/guestTokenRestaurant.ts",
];

/** Seeded random numbers, so a failing sequence can be replayed exactly. */
export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); }

export async function runAll({ areas = null, bail = false, quiet = false, only = null } = {}) {
  const sel = CHECKS.filter((c) => (!areas || areas.includes(c.area)) && (!only || only.includes(c.id)));
  let ok = 0, bad = 0, skip = 0; const fails = []; const t0 = Date.now();
  for (const c of sel) {
    let r; try { r = await c.fn(); } catch (e) { r = { ok: false, note: `threw: ${String(e?.stack || e).split("\n").slice(0, 2).join(" | ").slice(0, 220)}` }; }
    if (typeof r === "string" && r.startsWith("skip:")) { skip++; if (!quiet) console.log(`⏭ ${c.id}  ${c.what} — ${r.slice(5).trim()}`); continue; }
    const pass = typeof r === "object" && r ? !!r.ok : !!r; const note = typeof r === "object" && r ? r.note || "" : "";
    if (pass) { ok++; if (!quiet) console.log(`✅ ${c.id}  ${c.what}${note ? `   — ${note}` : ""}`); }
    else { bad++; fails.push({ ...c, note }); console.log(`❌ ${c.id}  ${c.what}${note ? `   — ${note}` : ""}`); if (bail) break; }
  }
  console.log(`\nROUND 3 · ${sel.length} checks · ${ok} ✅ · ${bad} ❌ · ${skip} ⏭ · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { ok, bad, skip, fails, total: sel.length };
}
