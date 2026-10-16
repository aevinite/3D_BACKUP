// Re-runs sweep #10 T17's thirteen mutation rows on app/owner/layout.tsx (P163630–P163639,
// P163875–P163877) on TODAY's file.
//
//   node scripts/sweep/t20s10/rerun-layout-mutations.mjs [--json=<file>]
//
// T17 named each break by LINE NUMBER (round 6, 2026-10-09). The file has changed since (item 28,
// 2026-10-11), so a line number no longer points at the same code. Each break is therefore re-located
// by the CODE it hit then — read out of the file as it was at e3626266 — and applied to the same
// statement today. Then the same two gates T17 used run: the type check, and verify:t25-doors. The file
// is restored byte for byte after every break, on success, on failure and on Ctrl-C.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { rel, ROOT } from "./lib.mjs";

const FILE = rel("app/owner/layout.tsx");
const ORIG = readFileSync(FILE, "utf8");
const restore = () => writeFileSync(FILE, ORIG);
process.on("SIGINT", () => { restore(); process.exit(130); });
process.on("SIGTERM", () => { restore(); process.exit(143); });

// [id, the statement it hit (a unique substring today), from, to, which occurrence on that line]
const BREAKS = [
  ["P163630", 'const initialSkin = skinCookie === "light"', "===", "!==", 0],
  ["P163631", 'const initialSkin = skinCookie === "light" || skinCookie === "dark" ? skinCookie : undefined;', "||", "&&", 0],
  ["P163632", "  if (acting && actingValid) {\n    const r = (await sb.from(\"restaurants\").select(\"name\").eq(\"id\", acting).limit(1)).data?.[0];\n    const adminEnts = await getOwnerEntitlements(acting);\n    // Admin act-as", "&&", "||", 0],
  ["P163633", "    if (acting && actingValid) {\n      const r =", "&&", "||", 0],
  ["P163634", 'const initialSkin = skinCookie === "light" || skinCookie === "dark" ? skinCookie : undefined;', "===", "!==", 1],
  ["P163635", 'if (u && u.role === "owner") ownedIds', "&&", "||", 0],
  ["P163636", 'if (!ownedIds.length) redirect(', "if (!", "if (", 0],
  ["P163637", '  if (u && u.role === "owner") {\n    if (!ownedIds', "===", "!==", 0],
  ["P163638", 'restaurantName={r?.name || "this restaurant"} initialSkin', "||", "&&", 0],
  ["P163639", 'dualAdmin = { adminEntitlements: adminEnts, restaurantName: r?.name || "this restaurant" }', "||", "&&", 0],
  ["P163875", 'if (u && u.role === "owner") ownedIds', "===", "!==", 0],
  ["P163876", '  if (u && u.role === "owner") {\n    if (!ownedIds', "&&", "||", 0],
  ["P163877", "if (e instanceof AuthDbError || e instanceof OwnedLookupFailed)", "||", "&&", 0],
];

const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout: 300000 });
const out = [];
try {
  for (const [id, anchor, from, to, nth] of BREAKS) {
    const at = ORIG.indexOf(anchor);
    if (at < 0 || ORIG.indexOf(anchor, at + 1) >= 0) { out.push({ id, pass: false, why: `anchor not found exactly once today: ${anchor.slice(0, 60)}` }); continue; }
    let k = at - 1;
    for (let i = 0; i <= nth; i++) { k = ORIG.indexOf(from, k + 1); if (k < 0 || k > at + anchor.length) break; }
    if (k < 0 || k > at + anchor.length) { out.push({ id, pass: false, why: `operator ${from} #${nth} not inside the anchor` }); continue; }
    writeFileSync(FILE, ORIG.slice(0, k) + to + ORIG.slice(k + from.length));
    const tc = run("npx", ["tsc", "-p", "tsconfig.typecheck.json"]);
    const doors = tc.status === 0 ? run("node", ["scripts/verify-t25-login-and-panel-apis.mjs"]) : null;
    restore();
    const by = tc.status !== 0 ? "typecheck (the break does not compile)" : doors.status !== 0
      ? `verify:t25-doors: ${(doors.stdout.match(/✗[^\n]*/) || [""])[0].slice(0, 160)}` : null;
    out.push({ id, pass: !!by, why: by ? `re-run 2026-10-16 (T20 s10) on today's file: caught by ${by}` : "SURVIVED — no gate went red" });
    console.log(`${by ? "✅" : "❌"} ${id} ${from}→${to} @ ${anchor.split("\n").pop().slice(0, 50)} — ${by || "SURVIVED"}`);
  }
} finally { restore(); }
if (readFileSync(FILE, "utf8") !== ORIG) { console.error("RESTORE FAILED"); process.exit(3); }
const j = process.argv.find((a) => a.startsWith("--json="));
if (j) { mkdirSync(dirname(j.slice(7)), { recursive: true }); writeFileSync(j.slice(7), JSON.stringify(out, null, 1)); }
console.log(`\n${out.filter((o) => o.pass).length}/${out.length} breaks caught; layout.tsx restored byte for byte`);
