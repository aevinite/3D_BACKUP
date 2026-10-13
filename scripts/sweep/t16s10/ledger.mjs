// scripts/sweep/t16s10/ledger.mjs — write .claude/sweep/LEDGER/T16-S10.md from the NEW suites' results.
//   node scripts/sweep/t16s10/ledger.mjs <new-results.json> [<more.json> …]
// Every row names its SUBJECT FILE in the check column (S10-RULES rule 3), and only ids from this
// terminal's block (P185001–P186000) are written.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const rows = new Map();
for (const f of process.argv.slice(2)) for (const r of JSON.parse(readFileSync(f, "utf8"))) {
  const n = Number(String(r.id).slice(1));
  if (n < 185001 || n > 186000) continue;
  rows.set(r.id, r);
}
const list = [...rows.values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
const cell = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const file = (f) => (f.includes("/") ? f : `public/panels/${f}`);
const n = (m) => list.filter((r) => r.mark === m).length;
const out = [];
out.push(`# T16 · SWEEP #10 — SHARED PANEL PLUMBING · new checks \`P185001\`–\`P186000\``);
out.push("");
out.push("**Territory:** the small `public/panels/*.js` scripts every staff panel loads (outbox, offline, netretry, realtime, connbadge, errlog, theme, fitnums, backstack, undobar, guestbell, myprofile, maint, issue-raise, swipehint, swreg, shrinkimg, auditsort + `.d.ts`, `vendor/chart.umd.min.js`) and the three deliberately-public endpoints `/api/health`, `/api/log/client-error`, `/api/maintenance`.");
out.push("");
out.push(`**${list.length} new checks: ${n("✅")} ✅ · ${n("❌")} ❌ · ${n("⏭")} ⏭** — run 2026-10-12 on worktree \`wt-s10-t16\`, dev server port 4416, after this branch's ten fixes. Before this file, the same terminal re-ran **2,709 existing rows in place** across 25 ledgers (stamp \`↻ S10-T16 re-run 2026-10-12\`).`);
out.push("");
out.push("**Aimed by measurement.** Rows per file by subject before planning: `shrinkimg.js` **0**, `netretry.js` **2**, `chart.umd.min.js` 2, `/api/health` 8, `/api/maintenance` 16, `/api/log/client-error` 26 — against `outbox.js` 136. So the first two suites drive the two never-checked files and the three endpoints; the rest drive the states the happy path never visits (a fake socket and a fast-forwarded clock for realtime, every sentence of the offline bar), the real panels at desktop / Samsung A35 / iPad in both skins, keyboard and Back, the login and data-separation questions read inline, and a lock on each of the ten fixes.");
out.push("");
out.push("**How to re-run any row:**");
out.push("");
out.push("    node scripts/sweep/t16s10/run.mjs --suite new-a,new-b,new-c,new-e          # no app needed except new-c's harness page");
out.push("    npm run dev -- -p 4416   # then:");
out.push("    T16_BASE=http://localhost:4416 node scripts/sweep/t16s10/run.mjs --suite new-d --browser-close");
out.push("    node scripts/sweep/t16s10/run.mjs --suite new-a --only P185040");
out.push("");
out.push("Never: a signed-out call to a running app (\"nobody\" is a stubbed identity in `routes.mjs`), a swapped id, a write to the database (panel writes are answered by the test; the endpoints run in memory).");
out.push("");
out.push("| id | check | how to verify | result | note |");
out.push("|----|-------|---------------|--------|------|");
for (const r of list) out.push(`| ${r.id} | \`${file(r.file)}\` — ${cell(r.what)} | ${cell(r.how)} | ${r.mark} | ${cell(r.note).slice(0, 260)} |`);
out.push("");
writeFileSync(join(ROOT, ".claude/sweep/LEDGER/T16-S10.md"), out.join("\n"));
console.log(`T16-S10.md: ${list.length} rows (${n("✅")} ✅ · ${n("❌")} ❌ · ${n("⏭")} ⏭)`);
