// scripts/sweep/t3s10/r4/h4.mjs — round 4's check registry (its own, so a round-4 run reports as round 4).
export { ROOT, rd, real, rng } from "../r3/h.mjs";
const CHECKS = [];
export function check(id, area, what, fn) { CHECKS.push({ id, area, what, fn }); }
export const count = () => CHECKS.length;
export async function runAll({ areas = null, only = null, quiet = false, bail = false } = {}) {
  const sel = CHECKS.filter((c) => (!areas || areas.includes(c.area)) && (!only || only.includes(c.id)));
  let ok = 0, bad = 0, skip = 0; const fails = []; const t0 = Date.now();
  for (const c of sel) {
    let r; try { r = await c.fn(); } catch (e) { r = { ok: false, note: `threw: ${String(e?.stack || e).split("\n").slice(0, 2).join(" | ").slice(0, 240)}` }; }
    if (typeof r === "string" && r.startsWith("skip:")) { skip++; console.log(`⏭ ${c.id}  ${c.what} — ${r.slice(5).trim()}`); continue; }
    const pass = typeof r === "object" && r ? !!r.ok : !!r; const note = typeof r === "object" && r ? r.note || "" : "";
    if (pass) { ok++; if (!quiet) console.log(`✅ ${c.id}  ${c.what}${note ? `   — ${note}` : ""}`); }
    else { bad++; fails.push({ ...c, note }); console.log(`❌ ${c.id}  ${c.what}${note ? `   — ${note}` : ""}`); if (bail) break; }
  }
  console.log(`\nROUND 4 · ${sel.length} checks · ${ok} ✅ · ${bad} ❌ · ${skip} ⏭ · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { ok, bad, skip, fails, total: sel.length };
}
