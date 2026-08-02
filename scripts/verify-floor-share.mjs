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
//     4. THE SHARED RESULT IS READ-ONLY. Every caller inside the window holds the SAME
//        object, so editing it edits what the next device is handed. This one bit us for
//        real (2026-08-02): the tablet narrowed the floor to a waiter's section IN PLACE,
//        and for 1.5s afterwards the MANAGER's floor — and every other waiter's — came back
//        with that one waiter's three tiles out of three hundred, the rest looking free.
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

  // A targeted ?table= refetch must NOT go through the shared path — that is what makes a tile
  // update the instant its order lands. This used to be asserted by matching the exact source line,
  // which broke the moment the read was legitimately refactored (adding the transient-read retry did
  // it) — a guard that fails on a correct change teaches people to edit the guard, which is how a
  // guard dies. So test the PROPERTY instead: isolate the `tbl ?` branch and require that it asks
  // for this one table and does not share.
  const tern = src.match(/const \{ data, error \} = tbl\s*([\s\S]{0,600}?);\n/);
  const targetedBranch = tern ? tern[1].split(/\n\s*:/)[0] : "";
  check(`${r.panel}: a targeted ?table= refetch is NOT shared`,
    !!targetedBranch && /p_table:\s*tbl/.test(targetedBranch) && !/sharedFloorSummary/.test(targetedBranch),
    targetedBranch ? undefined : "could not find the `const { data, error } = tbl ? … : …` read");

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

// PROPERTY 4 — a restricted reader must narrow a COPY, never the shared object.
// narrowSummary() mutates what it is given, so the value handed to it may not be the one
// sharedFloorSummary returned. The tablet is the only narrowing caller today; if another
// panel starts narrowing, add it here.
{
  const src = read("app/api/tablet/[...path]/route.ts");
  if (!src) check("waiter route found", false);
  else {
    const narrowed = /narrowSummary\(\s*([A-Za-z_$][\w$]*)/.exec(src);
    const target = narrowed ? narrowed[1] : "";
    // What is that variable assigned from? A copy (structuredClone / a spread) is safe;
    // the raw shared result is not.
    const assign = target
      ? new RegExp(`const\\s+${target}\\s*=([^;]+);`).exec(src)
      : null;
    const rhs = assign ? assign[1] : "";
    const copies = /structuredClone|JSON\.parse\(JSON\.stringify|\{\s*\.\.\./.test(rhs);
    check("waiter: the narrowed floor is a COPY, not the shared object", !!target && copies,
      copies ? `${target} = ${rhs.trim().slice(0, 60)}` :
        "narrowing the shared snapshot in place serves ONE waiter's section to every other device for 1.5s");
  }
}
// And the helper must say so, so the next person reads it before mutating.
{
  const mod = read("lib/floorSummary.ts") || "";
  check("lib/floorSummary.ts warns that its result is shared by reference",
    /READ-ONLY|read-only|BY REFERENCE|by reference/.test(mod),
    "the warning is the only thing standing between a future caller and the same bug");
}

const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
if (bad.length) {
  console.log("\nWhat to do:");
  console.log("  · a missing invalidateFloor(rid) → add it right after that handler resolves `rid`");
  console.log("  · a shared ?table= refetch → keep the `tbl ? …live… : …shared…` shape");
  console.log("  · a widened window → the floor is a live screen; keep it ~1.5s");
  console.log("  · narrowing in place → `const summary = limit ? structuredClone(shared) : shared;`\n");
  process.exit(1);
}
console.log("✅ PASS — the shared floor read can't hand a device a stale tile\n");
