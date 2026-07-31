// verify-floor-share.mjs — keeps the floor's shared read honest.
//
// WHY THIS EXISTS
//   The manager and waiter panels share ONE whole-floor database read between devices
//   (lib/floorSummary.ts) because ~1,800 statements × a dozen simultaneous polls is what
//   crossed the statement timeout and put pings on the owner's phone (2026-07-31).
//   Sharing is only safe because of three properties, and every one of them is easy for a
//   later change to break WITHOUT any test going red:
//
//     1. A WRITE MUST DROP THE SNAPSHOT. Otherwise a device that changes something and
//        reloads is handed a floor computed before its own action — a waiter marks a table
//        paid and watches the tile flick back. Add a new write handler, forget the one line,
//        and that bug is live again with no symptom in any existing test.
//     2. A TARGETED ?table= REFETCH MUST NEVER BE SHARED. That is the path that makes a tile
//        update the instant its order lands.
//     3. THE WINDOW MUST STAY SMALL. Widening 1.5s to 30s "for performance" would make the
//        floor visibly stale.
//
//   Static checks, no server or database needed. Run against another checkout with
//   --repo <path> (used to check AV live without adding a file to that repo).
//   Usage: node scripts/verify-floor-share.mjs [--repo /path/to/repo]
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const ROOT = args.includes("--repo")
  ? args[args.indexOf("--repo") + 1]
  : join(dirname(fileURLToPath(import.meta.url)), "..");

const MAX_WINDOW_MS = 3000;          // a shared floor older than this is a stale floor
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};
const read = (rel) => {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

console.log(`\nFLOOR SHARE CHECK — ${ROOT}\n`);

const mod = read("lib/floorSummary.ts");
check("lib/floorSummary.ts exists", !!mod);
if (mod) {
  check("it exports both halves (share + invalidate)",
    /export async function sharedFloorSummary/.test(mod) && /export function invalidateFloor/.test(mod));
  const win = Number((mod.match(/WINDOW_MS\s*=\s*(\d+)/) || [])[1] || 0);
  check(`the shared window stays small (<= ${MAX_WINDOW_MS}ms)`, win > 0 && win <= MAX_WINDOW_MS, `${win}ms`);
  check("a failed computation is never handed to the next caller",
    /catch[\s\S]{0,120}inflight\.delete/.test(mod));
}

// Both panel routes: share the WHOLE-floor read only, and invalidate on every write.
const ROUTES = [
  { file: "app/api/editor/[...path]/route.ts", panel: "manager", impls: ["postImpl", "patchImpl", "deleteImpl"] },
  { file: "app/api/tablet/[...path]/route.ts", panel: "waiter", impls: ["postImpl"] },
];
for (const r of ROUTES) {
  const src = read(r.file);
  if (!src) { check(`${r.panel} route found`, false, r.file); continue; }

  check(`${r.panel}: whole-floor read is shared`, src.includes("sharedFloorSummary(`floor:${rid}`"));
  // the ternary is what keeps a targeted refetch OUT of the shared path
  check(`${r.panel}: a targeted ?table= refetch is NOT shared`,
    /const \{ data, error \} = tbl\s*\n\s*\? await sb\.rpc\("lfh_table_view_summary", \{ p_restaurant_id: rid, p_table: tbl \}\)/.test(src));

  // EVERY write handler must drop the snapshot. Find each impl's body and look inside it.
  for (const impl of r.impls) {
    const start = src.indexOf(`async function ${impl}(`);
    if (start < 0) { check(`${r.panel}: ${impl} found`, false); continue; }
    const nextImpl = r.impls
      .map((o) => (o === impl ? -1 : src.indexOf(`async function ${o}(`)))
      .filter((i) => i > start)
      .sort((a, b) => a - b)[0];
    const body = src.slice(start, nextImpl > 0 ? nextImpl : start + 40000);
    check(`${r.panel}: ${impl} drops the floor snapshot`, /invalidateFloor\(rid\)/.test(body),
      /invalidateFloor\(rid\)/.test(body) ? "" : "a write here would let a device read a floor older than its own action");
  }
}

const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
if (bad.length) {
  console.log("\nWhat to do:");
  console.log("  · a missing invalidateFloor(rid) → add it right after that handler resolves `rid`");
  console.log("  · a shared ?table= refetch → keep the `tbl ? …live… : …shared…` shape");
  console.log("  · a widened window → the floor is a live screen; keep it ~1.5s\n");
  process.exit(1);
}
console.log("✅ PASS — the shared floor read can't hand a device a stale tile\n");
