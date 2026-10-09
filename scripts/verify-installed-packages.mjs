// verify-installed-packages.mjs — the packages INSTALLED in this folder are the ones package.json and
// package-lock.json name (sweep #10 T39 item 69, 2026-10-09).
//
// WHY. Dependabot's routine bump (#1441, merged 2026-10-08) moved @sentry/nextjs to 10.76, Supabase to
// 2.117 and Playwright to 1.63 in package.json and the lock — and nobody re-installed the shared
// folder. Its node_modules stayed on 10.73 / 2.115 / 1.62, so localhost:4000 (where the owner looks),
// and every worktree cloned from it, ran code the deployed site does not. CI could never see it: CI
// installs from the lock every time. Only a check that runs on THIS machine can, so this lives in
// verify:static, where it costs about a second and needs no network.
//
// Fix it with:  npm ci   (in the folder this complains about)
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let out = "", ok = true;
try { out = execFileSync("npm", ["ls", "--depth=0"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }); }
catch (e) { ok = false; out = String(e.stdout || "") + String(e.stderr || ""); }
const bad = out.split("\n").filter((l) => /\b(invalid|missing|extraneous)\b|UNMET/.test(l)).map((l) => l.replace(/^[\s│├└─┬]+/, "").trim());
if (!ok || bad.length) {
  console.log(`✗ verify:installed-packages — ${bad.length || "some"} package(s) in node_modules are not the versions package.json/package-lock.json name:`);
  for (const l of bad.slice(0, 20)) console.log("    " + l);
  console.log("\n  This folder is running different code from the deployed site. Fix: npm ci");
  process.exit(1);
}
console.log("✓ verify:installed-packages — every package installed here is the version the lock names");
