// Mutation-test survivors that are EQUIVALENT — proven here by running the real function and the
// broken copy side by side over a large input grid and finding no input where they answer differently.
// (Skipped while mutate.mjs itself is running, because then the "original" is already broken.)
import { suite } from "./lib.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./hooks.mjs";
import { tmpdir } from "node:os";
const t = suite("scripts/t30-harness (equivalent mutants)", 168841, 30);
if (!process.env.T30_MUTATING) {
  const dir = join(tmpdir(), "t30-equiv"); mkdirSync(dir, { recursive: true }); // not under node_modules: Node will not strip types there
  let k = 0;
  const twin = async (file, line, from, to) => {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    // Found by its TEXT (round 3): the line number is only a hint — an edit higher up the file moved
    // every taxFiling line by twelve and crashed this suite. The text must be on exactly one line.
    const has = (i) => lines[i].replace(/\/\/.*$/, "").includes(from);
    if (!has(line - 1)) { const hits = lines.map((_, i) => i).filter(has); if (hits.length !== 1) throw new Error(`${file}: "${from}" is on ${hits.length} lines`); line = hits[0] + 1; }
    twin.at = line;
    const L = lines[line - 1]; const at = L.replace(/\/\/.*$/, "").indexOf(from);
    lines[line - 1] = L.slice(0, at) + to + L.slice(at + from.length);
    const out = join(dir, `m${k++}-${file.split("/").pop()}`); writeFileSync(out, lines.join("\n"));
    return import(pathToFileURL(out).href + `?v=${k}`);
  };
  const orig = { money: await import("@/lib/money.ts"), mjs: await import("@/lib/money.mjs"), tf: await import("@/lib/taxFiling.ts") };
  const grid = []; for (let v = -2.2e7; v <= 2.2e7; v += 997.3) grid.push(v); for (const b of [1e3, 1e5, 1e7]) for (let d = -3; d <= 3; d += 0.005) grid.push(b + d, -(b + d));
  const sameAll = (f, g, inputs) => { for (const x of inputs) { const a = JSON.stringify(f(...x)), b = JSON.stringify(g(...x)); if (a !== b) return `differs at ${JSON.stringify(x)}: ${a} vs ${b}`; } return true; };
  for (const [line, from, to, name] of [[54, "a >= CRORE", "a > CRORE", "≥ crore → > crore"], [56, "a >= LAKH", "a > LAKH", "≥ lakh → > lakh"], [58, "a >= THOUSAND", "a > THOUSAND", "≥ thousand → > thousand"]]) {
    const m = await twin("lib/money.ts", line, from, to); const r = sameAll(orig.money.compactINR, m.compactINR, grid.map((v) => [v]));
    t(`lib/money.ts:${line} (${name}) is equivalent — the next branch promotes the exact boundary to the same label (${grid.length} inputs incl. ±3 around each boundary in ₹0.005 steps)`, r === true, r);
  }
  const tickIn = []; for (let lo = -500; lo <= 500; lo += 37) for (let span of [0, 0.03, 0.9, 7, 45, 100, 150, 999, 1.2e4, 7.1e5, 3.3e7]) for (const tg of [1, 2, 3, 5, 6, 8]) tickIn.push([lo, lo + span, tg]);
  tickIn.push([NaN, 5, 5], [0, NaN, 5], [5, 5, 5], [6, 5, 5], [-Infinity, 1, 5], [0, Infinity, 5]);
  for (const [line, from, to, name] of [[78, "!Number.isFinite(min) || !Number.isFinite(max)", "!Number.isFinite(min) && !Number.isFinite(max)", "first || → &&"], [78, "!Number.isFinite(max) || max <= min", "!Number.isFinite(max) && max <= min", "second || → &&"], [78, "max <= min", "max < min", "<= → <"], [85, "t <= max + step", "t < max + step", "<= → < on the last tick"]]) {
    const m = await twin("lib/money.ts", line, from, to); const r = sameAll(orig.money.roundTicks, m.roundTicks, tickIn);
    t(`lib/money.ts:${line} (${name}) is equivalent — roundTicks answers the same on ${tickIn.length} domains, incl. empty / reversed / infinite ones`, r === true, r);
  }
  { const m = await twin("lib/money.mjs", 19, "< 0.07", "<= 0.07"); const ins = []; for (let c = 0; c <= 100000; c++) ins.push([c / 100]); ins.push([4.92], [3.92], ["7.92"]);
    const r = sameAll(orig.mjs.niceUsd, m.niceUsd, ins); t(`lib/money.mjs:19 (< 0.07 → <= 0.07) is equivalent — at the exact .92 boundary both paths give .99 (${ins.length} prices, every cent to $1,000)`, r === true, r); }
  const allocIn = []; let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 20000; i++) allocIn.push([Math.round((rnd() - 0.3) * 1e5), Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => (rnd() < 0.2 ? 0 : Math.round(rnd() * 1000) / 10))]);
  for (const [line, from, to, name] of [[66, "left > 0 && k < order.length", "left > 0 || k < order.length", "&& → || (the second loop undoes the overshoot)"], [66, "k < order.length", "k <= order.length", "< → <= (the leftover is always fewer than the rows)"], [68, "k >= 0", "k > 0", ">= → > (the loop never runs: the leftover is never negative)"], [68, "order.length - 1", "order.length + 1", "− 1 → + 1 (same: the loop never runs)"]]) {
    const m = await twin("lib/taxFiling.ts", line, from, to); const r = sameAll(orig.tf.allocateWhole, m.allocateWhole, allocIn);
    t(`lib/taxFiling.ts:${twin.at} (${name}) is equivalent on 20,000 random splits`, r === true, r);
  }
  { const m = await twin("lib/taxFiling.ts", 151, "?? 0", "?? 1"); const ins = allocIn.slice(0, 3000).map(([, w]) => [w.map((x) => ({ t: x })), [{ label: "C", rate: 2.5 }, { label: "S", rate: 2.5 }], (r) => r.t]);
    const r = sameAll(orig.tf.buildFiling, m.buildFiling, ins); t(`lib/taxFiling.ts:${twin.at} (?? 0 → ?? 1) is equivalent — every row carries a part for every line, so the fallback is never used (3,000 filings)`, r === true, r); }
  { const D = await import("@/lib/discountCap.ts"); const m = await twin("lib/discountCap.ts", 48, "> capPct + 0.01", ">= capPct + 0.01"); const ins = []; for (let base = 1; base <= 20000; base += 37) for (let a = 0; a <= base; a += Math.max(1, Math.floor(base / 113))) for (const cap of [0, 5, 10, 50, 100]) ins.push([a, base, cap]);
    const r = sameAll(D.overDiscountCap, m.overDiscountCap, ins);
    t(`lib/discountCap.ts:48 (> → >= at cap + 0.01%) answers the same on ${ins.length} whole-rupee discounts — the boundary is a hundredth of a percent that no whole-rupee discount lands on`, r === true, r); }
}
// the clash gate's defensive checks: fuzz the SAME 3,000 odd headers through the real gate and through
// each broken copy, against the same in-memory world, and compare every answer.
if (!process.env.T30_MUTATING) {
  const { W, world } = await import("./sb.mjs");
  const { req } = await import("./lib.mjs");
  const C0 = await import("@/lib/clash.ts");
  const dir2 = (await import("node:os")).tmpdir();
  let n2 = 0;
  const twin2 = async (file, line, from, to) => {
    const lines = readFileSync(join(root, file), "utf8").split("\n"); const L = lines[line - 1]; const at = L.indexOf(from);
    if (at < 0) throw new Error(`${file}:${line} no longer contains ${from}`);
    lines[line - 1] = L.slice(0, at) + to + L.slice(at + from.length);
    const out = join(dir2, "t30-equiv", `c${n2++}-${file.split("/").pop()}`); writeFileSync(out, lines.join("\n"));
    return import(pathToFileURL(out).href + `?c=${n2}`);
  };
  let seed2 = 77; const rnd = () => (seed2 = (seed2 * 1103515245 + 12345) % 2147483648) / 2147483648; const pk = (a) => a[Math.floor(rnd() * a.length)];
  const vals = [null, 0, 1, "", "x", "mild", true, false, [], ["nuts"], {}, { en: "a" }, 5.5, "i1", "c1", "tom"];
  const headers = Array.from({ length: 3000 }, () => {
    const shape = pk(["obj", "obj", "obj", "num", "str", "arr", "null", "bad"]);
    if (shape === "num") return "5"; if (shape === "str") return '"x"'; if (shape === "arr") return "[1]"; if (shape === "null") return "null"; if (shape === "bad") return "{x";
    const o = {}; if (rnd() < 0.9) o.table = pk(["order_items", "inv_count_lines", "settings", "nope", "", 5]);
    if (rnd() < 0.7) o.id = pk(["i1", "nope", "", "rid-A", 0]);
    if (rnd() < 0.4) o.where = pk([{ count_id: "c1", item_id: "tom" }, { count_id: "c1" }, ["c1"], "c1", null, { count_id: "", item_id: "tom" }]);
    if (rnd() < 0.9) o.fields = pk([{ note: pk(vals) }, { qty: pk(vals), note: "mild" }, { counted_base: pk(vals) }, "note", 7, null, [], { "a b": 1 }, { table_count: pk(vals) }]);
    return JSON.stringify(o);
  });
  const fix = { order_items: [{ id: "i1", restaurant_id: "rid-A", note: "mild", qty: 2 }], inv_count_lines: [{ id: "L1", restaurant_id: "rid-A", count_id: "c1", item_id: "tom", counted_base: 4 }], settings: [{ restaurant_id: "rid-A", table_count: 12 }] };
  const answers = async (mod, failMode) => { const out = []; for (const h of headers) { world(fix); if (failMode) W.FAIL["order_items:select"] = failMode; let a; try { a = JSON.stringify(await mod.expectClash(req({ "x-lfh-expect": h }), "rid-A")); } catch (e) { a = "THREW " + e.message; } out.push(a); } return out; };
  const base0 = await answers(C0), baseNoData = await answers(C0, "nodata");
  for (const [line, from, to, name, mode] of [[156, "!parsed || typeof parsed", "!parsed && typeof parsed", "first || → &&"], [156, 'typeof parsed !== "object" || Array.isArray(parsed)', 'typeof parsed !== "object" && Array.isArray(parsed)', "second || → &&"], [173, 'typeof w !== "object" || Array.isArray(w)', 'typeof w !== "object" && Array.isArray(w)', "second || → &&"], [215, "res.error || !res.data", "res.error && !res.data", "|| → && (a read with no row and no error)", "nodata"]]) {
    const m = await twin2("lib/clash.ts", line, from, to); const got = await answers(m, mode); const ref = mode ? baseNoData : base0;
    const diff = got.findIndex((g, i) => g !== ref[i]);
    t(`lib/clash.ts:${line} (${name}) is equivalent — the gate answers the same for 3,000 odd expectations (a later check refuses each shape anyway)`, diff < 0, diff < 0 ? "" : `differs on ${headers[diff]}: ${ref[diff]} vs ${got[diff]}`);
  }
  { const m = await twin2("lib/clash.ts", 353, "names && typeof names", "names || typeof names"); let same = true, at = "";
    for (const tn of [null, undefined, "Patio", 5, [], {}, { "5": "Patio" }, { "5": "  " }, { "9": "Bar" }, true]) {
      const run = async (mod) => { world({ sessions: [{ id: "s", restaurant_id: "rid-A", table_number: "5", status: "open", created_at: new Date(Date.now() - 5000).toISOString() }], settings: [{ restaurant_id: "rid-A", table_names: tn }] });
        return JSON.stringify(await mod.replayClash(req({ "x-lfh-replay": "1", "x-lfh-queued-at": new Date(Date.now() - 60000).toISOString() }), "rid-A", "tables", "5", "pay", {})); };
      const a = await run(C0), b = await run(m); if (a !== b) { same = false; at = JSON.stringify(tn); break; } }
    t("lib/clash.ts:353 (names && → ||) is equivalent — every odd table_names shape still reads the same sentence (a throw is caught and falls back to 'Table N')", same, at); }
}
