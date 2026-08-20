// verify-owner-scope-503.mjs — every /api/owner/* handler answers a scope it COULD NOT READ
// with a retryable 503, never an unhandled 500.
//
// WHY THIS EXISTS (T20 sweep, 2026-08-19)
//   lib/ownerScope.ts throws `OwnerScopeUnavailable` when the admin act-as widen read fails. That
//   throw is deliberate and load-bearing: the alternative — returning a PARTIAL scope — would
//   silently hide restaurants an owner owns (T9 finding F22). The same change wrote
//   `ownerScopeOr503()` to turn the throw into "Couldn't load your restaurants just now — please
//   try again." with `transient: true`.
//
//   It had ZERO callers. All twelve owner routes called `ownerScope()` bare, so on that path Next
//   answered a blank 500 with nothing for the client to retry — on every owner screen. The helper
//   existing is not the same as the helper being wired in, and nothing noticed for a week.
//
//   So this guard checks the PROPERTY, not a line: a route that resolves an owner scope must either
//   go through `ownerScopeOr503`, or catch `OwnerScopeUnavailable` itself, or have its own resolver
//   that answers a 503 of its own (app/api/owner/staff/route.ts does — see its `transient()`).
//
// Static, no server or database. Run against another checkout with --repo <path>.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const ROOT = args.includes("--repo") ? args[args.indexOf("--repo") + 1]
  : join(dirname(fileURLToPath(import.meta.url)), "..");

let fails = 0;
const check = (name, pass, detail = "") => {
  if (!pass) fails++;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};
const read = (rel) => { const p = join(ROOT, rel); return existsSync(p) ? readFileSync(p, "utf8") : null; };

console.log(`\nOWNER SCOPE · A SCOPE WE COULD NOT READ IS RETRYABLE — ${ROOT}\n`);

// 1 · the helper still exists and still answers 503 + transient.
const lib = read("lib/ownerScope.ts");
check("lib/ownerScope.ts exists", !!lib);
if (lib) {
  check("it still throws OwnerScopeUnavailable rather than returning a partial scope",
    /throw new OwnerScopeUnavailable\(\)/.test(lib),
    "a partial scope silently hides restaurants an owner owns — that is why this throws");
  const helper = lib.slice(lib.indexOf("export async function ownerScopeOr503"), lib.indexOf("export async function ownerScope("));
  check("ownerScopeOr503 answers 503 with `transient: true`",
    /status:\s*503/.test(helper) && /transient:\s*true/.test(helper));
  check("ownerScopeOr503 still answers 401 for a real \"not you\"", /status:\s*401/.test(helper));
}

// 2 · EVERY owner route is covered. Discovered by walking, never a hardcoded list.
const dir = "app/api/owner";
const walk = (d, out = []) => {
  for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
    const rel = `${d}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (e.name === "route.ts") out.push(rel);
  }
  return out;
};
const routes = existsSync(join(ROOT, dir)) ? walk(dir).sort() : [];
check("app/api/owner could be walked, so this really looks at every route", routes.length >= 10,
  `${routes.length} route file(s)`);

// A route that has its OWN resolver is fine as long as that resolver answers a retryable 503.
// Named with its reason, the same way verify-floor-share justifies its EXEMPT list.
const OWN_RESOLVER = [
  { file: "app/api/owner/staff/route.ts",
    reason: "has its own scope() (it also serves a MANAGER, which ownerScope does not) and answers transient() 503 on every failed read",
    needs: /const transient = \(\) =>[\s\S]{0,200}status:\s*503/ },
];

for (const rel of routes) {
  const src = read(rel);
  if (!src) { check(`${rel} readable`, false); continue; }
  const own = OWN_RESOLVER.find((o) => o.file === rel);
  if (own) {
    check(`${rel} — its own resolver answers a retryable 503`, own.needs.test(src), own.reason);
    check(`${rel} — and it does not ALSO call ownerScope() bare`, !/await ownerScope\(req\)/.test(src));
    continue;
  }
  const bare = (src.match(/await ownerScope\(req\)/g) || []).length;
  const wired = /ownerScopeOr503\(req\)/.test(src);
  const catches = /OwnerScopeUnavailable/.test(src);
  check(`${rel} — resolves the scope through ownerScopeOr503 (or catches OwnerScopeUnavailable)`,
    wired || catches,
    wired || catches ? "" : "a failed scope read would reach Next as an unhandled 500 with nothing to retry");
  check(`${rel} — no handler still calls ownerScope(req) bare`, bare === 0,
    bare ? `${bare} bare call(s) left — each is an unhandled 500 on the widen-read failure path` : "");
}

// 3 · the 503 must not be swallowed into a 401. A route that returns `sc.resp` only when it is a
// 401 would have re-created the bug in a new shape.
for (const rel of routes) {
  const src = read(rel);
  if (!src || !/ownerScopeOr503/.test(src)) continue;
  const swallows = /sc\.resp\s*&&\s*sc\.resp\.status\s*===\s*401/.test(src);
  check(`${rel} — the 503 is never filtered out and the 401 kept`, !swallows,
    swallows ? "this returns ONLY the 401 and drops the retryable answer" : "");
}

console.log(`\n${fails ? `FAILED — ${fails} check(s)` : "PASS — every owner route answers an unreadable scope with a retryable 503"}\n`);
process.exit(fails ? 1 : 0);
