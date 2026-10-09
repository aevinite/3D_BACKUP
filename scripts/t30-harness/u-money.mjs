// lib/money.ts and lib/money.mjs — every branch.
import { suite } from "./lib.mjs";
const t = suite("lib/money.ts", 168751, 70);
const M = await import("@/lib/money.ts");
const J = await import("@/lib/money.mjs");
for (const [v, want] of [[0, "₹0"], [0.4, "₹0"], [0.6, "₹1"], [999, "₹999"], [999.5, "₹1k"], [1000, "₹1k"], [1449, "₹1.4k"], [99949, "₹99.9k"], [99950, "₹1L"], [100000, "₹1L"], [150000, "₹1.5L"], [9949999, "₹99.5L"], [9950000, "₹99.5L"], [9999999, "₹1Cr"], [10000000, "₹1Cr"], [123456789, "₹12.3Cr"], [-850, "−₹850"], [-1500, "−₹1.5k"], [-12000000, "−₹1.2Cr"]]) {
  t(`compactINR(${v}) → "${want}"`, M.compactINR(v) === want, M.compactINR(v));
}
t("compactINR of NaN / Infinity / -Infinity / null / undefined / '' / 'abc' → '₹0'", [NaN, Infinity, -Infinity, null, undefined, "", "abc"].every((v) => M.compactINR(v) === "₹0"));
t("compactINR of a numeric string reads the number", M.compactINR("250000") === "₹2.5L");
t("compactINR uses a real minus sign (−), never a hyphen", M.compactINR(-5).startsWith("−₹"));
t("roundTicks: an empty / reversed / non-finite domain → []", [[5, 5], [10, 5], [NaN, 1], [0, Infinity], [-Infinity, 0]].every(([a, b]) => M.roundTicks(a, b).length === 0));
t("roundTicks(0, 100) → 0, 20, 40, 60, 80, 100 (the first round step that fits five gaps)", M.roundTicks(0, 100).join() === "0,20,40,60,80,100", M.roundTicks(0, 100).join());
t("roundTicks(0, 7.1e5) → round lakhs inside the domain (never the ragged 7.1L)", M.roundTicks(0, 710000).join() === "0,200000,400000,600000", M.roundTicks(0, 710000).join());
t("roundTicks(0.1, 0.3) has no float dust", M.roundTicks(0.1, 0.3).every((x) => String(x).length <= 4), M.roundTicks(0.1, 0.3).join());
t("roundTicks with target 2 still gives an axis of ≥ 2 ticks or nothing", (() => { const r = M.roundTicks(0, 1000, 2); return r.length === 0 || r.length >= 2; })());
t("roundTicks with a domain too narrow for two round ticks → [] (no lonely tick)", M.roundTicks(1.01, 1.02, 5).length === 0 || M.roundTicks(1.01, 1.02, 5).length >= 2);
t("roundTicks for a negative domain is ascending and inside it", (() => { const r = M.roundTicks(-500, -100); return r.length >= 2 && r.every((x, i) => x >= -500 && x <= -100 && (i === 0 || x > r[i - 1])); })());
t("roundTicks falls back to 10 × magnitude when no step fits the target (target 1)", (() => { const r = M.roundTicks(0, 100, 1); return r.length === 0 || r.length >= 2; })());
t("niceUsd: .00 / .50 / .99 endings", J.niceUsd(4.1) === 4 && J.niceUsd(4.29) === 4.5 && J.niceUsd(4.8) === 4.99 && J.niceUsd(4.95) === 4.99 && J.niceUsd(4.24) === 4 && J.niceUsd(4.25) === 4.5 && J.niceUsd(4.74) === 4.5 && J.niceUsd(4.75) === 4.99);
t("niceUsd: within 0.07 of .99 snaps to .99 (4.93 → 4.99)", J.niceUsd(4.93) === 4.99);
t("niceUsd: a numeric string reads as the number; junk / Infinity → 0", J.niceUsd("2.29") === 2.5 && J.niceUsd("x") === 0 && J.niceUsd(Infinity) === 0 && J.niceUsd(null) === 0);
t("snapToStep: rounds to the nearest step, killing float dust", J.snapToStep(5.979999, 0.01) === 5.98 && J.snapToStep(545, 10) === 550 && J.snapToStep(0.1 + 0.2, 0.1) === 0.3);
t("snapToStep: bad value or bad step → 0", J.snapToStep(NaN, 1) === 0 && J.snapToStep(5, 0) === 0 && J.snapToStep(5, -1) === 0 && J.snapToStep(5, NaN) === 0 && J.snapToStep(Infinity, 1) === 0);
t("displayAmount: USD × rate snapped to the currency step (6.5 × 84 → ₹550)", J.displayAmount(6.5, 84, 10) === 550 && J.displayAmount("6.5", 84, 10) === 550);
t("displayAmount: junk USD → 0", J.displayAmount("x", 84, 10) === 0 && J.displayAmount(undefined, 84, 10) === 0);
t("minorRound: ₹27.5 → ₹28; $0.275 → $0.28", J.minorRound(27.5, 1) === 28 && J.minorRound(0.275, 0.01) === 0.28);
t("roundTicks(0, 150, 1): no listed step fits one gap → it falls back to 10 × the magnitude (0, 100)", M.roundTicks(0, 150, 1).join() === "0,100", M.roundTicks(0, 150, 1).join());
t("roundTicks(0.5, 1.4, 1): only ONE round tick fits → [] (a single tick is not an axis)", M.roundTicks(0.5, 1.4, 1).length === 0, M.roundTicks(0.5, 1.4, 1).join());
t("roundTicks never draws more ticks than target + 1, for small targets too (target 2, 3 over 1,800 domains)", (() => { for (let lo = -500; lo <= 500; lo += 37) for (const span of [0.03, 0.9, 7, 45, 150, 999, 1.2e4, 7.1e5]) for (const tg of [2, 3]) if (M.roundTicks(lo, lo + span, tg).length > tg + 1) return false; return true; })());
t("roundTicks(-500, -499.97, 2) → exactly -500, -499.98", M.roundTicks(-500, -499.97, 2).join() === "-500,-499.98", M.roundTicks(-500, -499.97, 2).join());
