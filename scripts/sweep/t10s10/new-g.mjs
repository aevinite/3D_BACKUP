// Block G — the item guards, one ledger row per line they print (P179001–P179044).
//   P179001–P179017  npm run verify:voided-stays   (item 1)
//   P179018–P179044  npm run verify:t10-writes     (items 2–11)
// The guard is run ONCE and its ✓/✗ lines are read in order; a guard that prints fewer lines than
// it used to fails the rows it no longer reaches, so a quietly-shrunk guard cannot pass here.
import { execFileSync } from "node:child_process";
import { check, ROOT } from "./lib.mjs";

const memo = new Map();
function lines(script) {
  if (!memo.has(script)) {
    let out;
    try { out = execFileSync("node", [script], { cwd: ROOT, stdio: "pipe", timeout: 300000 }).toString(); }
    catch (e) { out = String(e.stdout || ""); }
    memo.set(script, out.split("\n").filter((l) => /^\s+[✓✗] /.test(l)).map((l) => ({ ok: l.trim().startsWith("✓"), text: l.trim().slice(2) })));
  }
  return memo.get(script);
}
const block = (script, first, count, guard) => {
  for (let i = 0; i < count; i++) {
    check(`P${first + i}`, `${guard} line ${i + 1}`, `npm run ${guard} — the real route driven in memory`,
      () => { const L = lines(script)[i]; return L ? { ok: L.ok, note: L.text } : { ok: false, note: "the guard no longer prints this line" }; });
  }
};
block("scripts/verify-voided-stays-voided.mjs", 179001, 17, "verify:voided-stays");
block("scripts/verify-t10-manager-writes.mjs", 179018, 27, "verify:t10-writes");
