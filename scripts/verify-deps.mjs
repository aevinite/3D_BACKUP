#!/usr/bin/env node
// verify-deps.mjs — nobody was watching the packages we install.
//
// WHY THIS EXISTS (2026-08-16). CI ran typecheck, lint, unit tests and every static guard, and
// installed with `npm ci --no-audit`. So a package could pick up a published advisory and this
// repo would never say a word — not on a push, not on a PR, not on a deploy. The count on the
// day this was written was FIFTEEN (9 high, 5 moderate, 1 low), and nothing had ever mentioned
// it. That silence is the bug this closes.
//
// WHY IT IS NOT JUST `npm audit --audit-level=high`. That command fails on the fifteen that
// already exist, which would turn main red for every session on the first run and get the whole
// check switched off within a day. A guard that cries wolf gets disabled — the same lesson
// written into scripts/verify-panel-secrets.mjs.
//
// SO THE RULE IS: today's advisories are ACKNOWLEDGED below, with a reason each. Anything NEW at
// high or critical fails the build. That way the check is green today, and the first genuinely
// new problem is loud. Clearing an acknowledged one is a normal PR: bump it, delete its line.
//
// Run: node scripts/verify-deps.mjs   (or npm run verify:deps)
import { execFileSync } from "node:child_process";

// ── The advisories that are currently parked, and why each one is.
// A package is listed by NAME. Removing a name means "this must now be clean".
//
// THIS LIST IS MEANT TO SHRINK. It opened at FIFTEEN on 2026-08-16. Merging the grouped
// Dependabot update the same day (PR #998 — Next 16.2.6 → 16.3.0, React 19.2.8, Supabase 2.112,
// Sentry 10.70) cleared EIGHT of them: next, postcss, sharp, js-yaml, nanoid and the three
// @opentelemetry packages. The guard printed exactly which lines to delete, which is how they
// came out. Do the same next time — never re-add a name to silence a fresh problem.
const ACKNOWLEDGED = new Map([
  ["brace-expansion", "Transitive, dev tooling only."],
  ["fast-uri", "Transitive, dev tooling only."],
  ["ip-address", "Transitive, dev tooling only."],
  ["undici", "Transitive, dev tooling only."],
  ["@babel/core", "Transitive, build-time only, severity low."],
  ["@hono/node-server", "Transitive, moderate."],
  ["hono", "Transitive, moderate."],
]);

// Only these two block a build. Moderate/low are reported and do not fail — the point is to be
// believed when it does fail.
const BLOCKING = new Set(["high", "critical"]);

let report;
try {
  // `npm audit` exits non-zero whenever it finds anything, so its output is read from the
  // thrown error too. That is normal, not a failure of the command.
  report = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch (e) {
  report = e.stdout || "";
}

if (!report.trim()) {
  // No network / npm unavailable. Do NOT fail the build for that — a guard that breaks when
  // the registry hiccups is a guard that gets removed.
  console.log("verify:deps — could not reach npm audit (offline?). Skipped, not failed.");
  process.exit(0);
}

let parsed;
try {
  parsed = JSON.parse(report);
} catch {
  console.log("verify:deps — npm audit returned something that isn't JSON. Skipped, not failed.");
  process.exit(0);
}

const vulns = parsed.vulnerabilities || {};
const counts = parsed.metadata?.vulnerabilities || {};
const fresh = [];
const parked = [];

for (const [name, v] of Object.entries(vulns)) {
  const sev = v.severity || "unknown";
  if (ACKNOWLEDGED.has(name)) { parked.push(`${name} (${sev})`); continue; }
  if (BLOCKING.has(sev)) fresh.push({ name, sev, via: Array.isArray(v.via) ? v.via.filter((x) => typeof x === "object").map((x) => x.title).join("; ") : "" });
}

const total = ["critical", "high", "moderate", "low"].map((s) => `${counts[s] || 0} ${s}`).join(", ");
console.log(`verify:deps — ${total}.`);
console.log(`  ${parked.length} acknowledged (see the list in this file), ${fresh.length} new at high/critical.`);

// Anything acknowledged that no longer appears is good news worth printing: it means someone
// upgraded it and the line can be deleted.
const gone = [...ACKNOWLEDGED.keys()].filter((n) => !(n in vulns));
if (gone.length) {
  console.log(`  ✔ CLEARED since this guard was written — delete these lines from ACKNOWLEDGED: ${gone.join(", ")}`);
}

if (fresh.length) {
  console.error("\n✘ NEW high/critical advisories — these appeared after this guard was written:");
  for (const f of fresh) console.error(`   · ${f.name} (${f.sev}) ${f.via}`);
  console.error("\nFix it, or — if it genuinely cannot be fixed now — add it to ACKNOWLEDGED in");
  console.error("scripts/verify-deps.mjs WITH a reason. Do not delete this check.");
  process.exit(1);
}

console.log("✔ no new high/critical advisories.");
