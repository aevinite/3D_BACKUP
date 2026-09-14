// Stamps this run's re-run result onto the ledger rows terminal 5 re-executed, IN PLACE,
// in the file each row lives in. Only the rows this terminal owns are touched — a row about
// a file another terminal owns is left exactly as it is.
//
//   node scripts/sweep/t5s9/stamp.mjs --ids <file>   # one id per line, with its result
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const DATE = "2026-09-14";
const arg = process.argv[process.argv.indexOf("--ids") + 1];
const want = new Map();
for (const line of readFileSync(arg, "utf8").split("\n")) {
  const m = line.trim().match(/^(P\d+)\s+(✅|❌|⏭)\s*(.*)$/u);
  if (m) want.set(m[1], { mark: m[2], note: m[3] });
}

const FILES = readFileSync(join(ROOT, ".claude/sweep/t5s9-ledger-files.txt"), "utf8").trim().split("\n");
let stamped = 0, missing = [...want.keys()];
for (const f of FILES) {
  const p = join(ROOT, ".claude/sweep/LEDGER", f);
  const out = readFileSync(p, "utf8").split("\n").map((line) => {
    const m = line.match(/^\| (P\d+) \|/);
    if (!m || !want.has(m[1])) return line;
    const { mark, note } = want.get(m[1]);
    // The last column is the note. A row's own text can contain an escaped pipe (`\|`), so
    // find the final UNESCAPED pipe and insert before it — stampers have torn rows apart
    // by splitting naively on "|".
    let end = -1;
    for (let i = line.length - 1; i > 0; i--) if (line[i] === "|" && line[i - 1] !== "\\") { end = i; break; }
    if (end < 0) return line;
    missing = missing.filter((x) => x !== m[1]);
    stamped++;
    const stamp = ` · re-run ${DATE} (sweep 9, T5) ${mark}${note ? " — " + note : ""}`;
    return line.slice(0, end).replace(/\s+$/, "") + stamp + " " + line.slice(end);
  });
  writeFileSync(p, out.join("\n"));
}
console.log(`stamped ${stamped} rows · ${missing.length} ids not found${missing.length ? ": " + missing.slice(0, 12).join(", ") : ""}`);
