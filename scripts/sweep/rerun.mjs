// scripts/sweep/rerun.mjs — AFTER A FAILURE, PRINT THE ONE COMMAND THAT RE-RUNS JUST THAT.
//
// WHY (sweep #6 / T28 asked for it; built sweep #7 / T28, 2026-08-28).
//
// A guard that has just listed six failures leaves a person with a question it could have answered:
// "how do I re-check only those six?" The honest answer is usually a long command with a base URL
// and a range in it, and nobody remembers the shape of it — so they re-run the whole suite instead,
// wait several minutes, and read the same six failures again.
//
// DELIBERATELY NOT ADDED TO ALL 110 GUARDS. For a guard you ran yourself, the command is the one you
// just typed; printing it back is noise, and editing 110 working files to add noise is a change I
// would not make. It is worth it in exactly two places, and both are here:
//
//   · a RUNNER, which ran the guard on your behalf — you did not type its command and it knows
//     which parts failed (verify-everything.mjs, and its --only);
//   · a guard with SUB-PARTS, where re-running one phase out of five hundred is the whole point
//     (verify-printing-sweep.mjs, and its --from/--to).
//
// Any other guard can opt in with one line if it grows sub-parts:
//
//     import { rerunLine } from "./sweep/rerun.mjs";
//     console.log(rerunLine("verify:my-guard", { base: BASE, only: failedNumbers }));

/** Collapse [3,4,5,9,11,12] → "3-5,9,11-12" — the shape --only and --from/--to already accept. */
export function asRanges(nums) {
  const xs = [...new Set(nums.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < xs.length;) {
    let j = i;
    while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
    out.push(i === j ? `${xs[i]}` : `${xs[i]}-${xs[j]}`);
    i = j + 1;
  }
  return out.join(",");
}

/**
 * The command that re-runs only what just failed.
 *
 * `base` is included ONLY when it is not the default — a person on port 4000 does not need to be
 * told to pass port 4000, and a line with nothing optional in it is the one people actually copy.
 */
export function rerunLine(npmKey, { base, only, from, to, extra } = {}) {
  const args = [];
  if (base && !/localhost:4000\/?$/.test(base)) args.push(`--base ${base.replace(/\/$/, "")}`);
  if (only && only.length) args.push(`--only ${Array.isArray(only) ? asRanges(only) : only}`);
  if (from != null) args.push(`--from ${from}`);
  if (to != null) args.push(`--to ${to}`);
  if (extra) args.push(extra);
  return `  re-run just this:  npm run ${npmKey}${args.length ? " -- " + args.join(" ") : ""}`;
}
