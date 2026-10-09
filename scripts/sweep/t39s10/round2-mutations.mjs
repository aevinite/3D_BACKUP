// scripts/sweep/t39s10/round2-mutations.mjs — sweep #10 T39 round 2, Band J: break each rule this
// round and the last one added, ON PURPOSE, in a THROWAWAY copy of the repo, and require the guard
// that owns the rule to go RED. A guard that stays green with its subject broken is a guard that can
// only fail one way (the T6 lesson). Every break is undone before the next one runs.
//
//   node scripts/sweep/t39s10/round2-mutations.mjs --root <throwaway worktree> --out <rows.json>
//
// NEVER point --root at a working copy anyone uses: it edits files there. It refuses the shared folder.
import { readFileSync, writeFileSync, unlinkSync, existsSync, copyFileSync, renameSync, readdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

const argv = process.argv.slice(2);
const ROOT = argv[argv.indexOf("--root") + 1];
const OUT = argv[argv.indexOf("--out") + 1];
if (!ROOT || !OUT) { console.error("--root and --out are required"); process.exit(2); }
if (/\/backup_Menu\/?$/.test(ROOT)) { console.error("refusing: never mutate the shared folder"); process.exit(2); }
const P = (f) => join(ROOT, f);
const read = (f) => readFileSync(P(f), "utf8");
const write = (f, s) => writeFileSync(P(f), s);
const restore = (...files) => { for (const f of files) execFileSync("git", ["checkout", "--", f], { cwd: ROOT }); };
const run = (cmd, args, extraEnv = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout: 900000, env: { ...process.env, ...extraEnv }, maxBuffer: 1 << 26 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
const rows = [];
const M = async (file, check, how, fn) => {
  let ok = false, note = "";
  try { const r = await fn(); ok = r.ok; note = r.note || ""; } catch (e) { ok = false; note = "the break could not be applied: " + String(e.message).slice(0, 140); }
  rows.push({ band: "J", file, check, how, result: ok ? "✅" : "❌", note: String(note).slice(0, 220) });
  console.log(`${ok ? "✅" : "❌"} ${check} — ${String(note).slice(0, 120)}`);
};
const red = (r, want) => ({ ok: r.code !== 0 && (!want || want.test(r.out)), note: `exit ${r.code}${want ? (want.test(r.out) ? " · names the fault" : " · did NOT name the fault") : ""}` });
const sub = (f, from, to) => { const s = read(f); if (!s.includes(from)) throw new Error(`${f}: text to break not found`); write(f, s.replace(from, to)); };

// every guard green BEFORE any break — otherwise a red below proves nothing
for (const [cmd, args, label] of [
  ["node", ["scripts/verify-migration-numbers.mjs", "--quiet"], "verify:migration-numbers"],
  ["node", [".github/scripts/verify-root-config.mjs"], "verify-root-config"],
  ["node", ["scripts/verify-installed-packages.mjs"], "verify:installed-packages"],
  ["node", ["scripts/verify-test-safety.mjs"], "verify:test-safety"],
  ["node", ["scripts/verify-owner-territory-s7.mjs"], "verify:owner-s7"],
  ["node", ["scripts/verify-css-tokens.mjs"], "verify:css-tokens"],
  ["node", ["scripts/verify-panel-cache.mjs"], "verify:panel-cache"],
  ["node", ["scripts/verify-ledger-index.mjs"], "verify:ledger-index"],
  ["node", [".github/scripts/verify-doc-counts.mjs"], "verify-doc-counts"],
]) {
  const r = run(cmd, args);
  rows.push({ band: "J", file: args[0], check: `${label} is green on the unbroken copy (so a red below means the break, not noise)`, how: `${cmd} ${args.join(" ")}`, result: r.code === 0 ? "✅" : "❌", note: `exit ${r.code}` });
  console.log(`${r.code === 0 ? "✅" : "❌"} baseline ${label} exit ${r.code}`);
}

const MIG = "supabase/migrations";
const migs = readdirSync(P(MIG)).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
const last = migs[migs.length - 1], lastN = Number(last.slice(0, 3));
await M(MIG, "a second migration under an existing number turns verify:migration-numbers red", "copy the newest file under its own number", () => {
  const dup = `${MIG}/${String(lastN).padStart(3, "0")}_zz_planted_collision.sql`;
  copyFileSync(P(`${MIG}/${last}`), P(dup));
  try { return red(run("node", ["scripts/verify-migration-numbers.mjs", "--quiet"]), /duplicate migration number/); } finally { unlinkSync(P(dup)); }
});
await M(MIG, "a hole in the migration sequence turns verify:migration-numbers red", "move the newest file two numbers up", () => {
  const moved = `${MIG}/${String(lastN + 2).padStart(3, "0")}${last.slice(3)}`;
  renameSync(P(`${MIG}/${last}`), P(moved));
  try { return red(run("node", ["scripts/verify-migration-numbers.mjs", "--quiet"]), /MISSING from the sequence/); } finally { renameSync(P(moved), P(`${MIG}/${last}`)); }
});
await M(".github/workflows/checks.yml", "CI testing on a different Node major from the site turns verify-root-config red", "node-version 24 → 22", () => {
  sub(".github/workflows/checks.yml", "node-version: 24", "node-version: 22");
  try { return red(run("node", [".github/scripts/verify-root-config.mjs"]), /Node versions disagree/); } finally { restore(".github/workflows/checks.yml"); }
});
const cap = Number((read("package.json").match(/--max-warnings=(\d+)/) || [])[1]);
await M("package.json", "removing the lint warning cap turns verify-root-config red", "lint: eslint (no cap)", () => {
  sub("package.json", `"lint": "eslint --max-warnings=${cap}"`, `"lint": "eslint"`);
  try { return red(run("node", [".github/scripts/verify-root-config.mjs"]), /no warning cap/); } finally { restore("package.json"); }
});
await M("package.json", "RAISING the lint warning cap turns verify-root-config red (it may only go down)", "cap → 99999", () => {
  sub("package.json", `--max-warnings=${cap}`, "--max-warnings=99999");
  try { return red(run("node", [".github/scripts/verify-root-config.mjs"]), /raised it/); } finally { restore("package.json"); }
});
await M("scripts/verify-installed-packages.mjs", "a package installed at a version package.json does not allow turns verify:installed-packages red", "playwright range ^1.63.0 → ^1.64.0", () => {
  sub("package.json", `"playwright": "^1.63.0"`, `"playwright": "^1.64.0"`);
  try { return red(run("node", ["scripts/verify-installed-packages.mjs"]), /invalid/); } finally { restore("package.json"); }
});
await M("scripts/stress-tenant.mjs", "a load-test script without the dev-only lock turns verify:test-safety §16 red", "drop the refuseUnlessDevTestDb call", () => {
  sub("scripts/stress-tenant.mjs", "refuseUnlessDevTestDb(URL_, ", "void (URL_, ");
  try { return red(run("node", ["scripts/verify-test-safety.mjs"]), /every load-test script refuses/); } finally { restore("scripts/stress-tenant.mjs"); }
});
// The planted text is ASSEMBLED, so this file never carries the shapes it plants (verify:test-safety
// reads every script, this one included).
const T = "or" + "ders";
for (const [style, body] of [
  ["the REST helper", `await db("${T}", { method: "POST", body: "{}" });\nawait db(\`${T}?id=eq.1\`, { method: "PATCH", body: JSON.stringify({ ${"deleted" + "_at"}: "x" }) });\n`],
  ["supabase-js", `await sb.from("${T}").insert({ restaurant_id: "x" });\nawait sb.from("${T}").update({ ${"deleted" + "_at"}: "x" }).eq("id", 1);\n`],
]) {
  await M("scripts/verify-test-safety.mjs", `a test that inserts orders and only soft-deletes them (${style}) turns verify:test-safety §17 red`, "plant such a script", () => {
    const f = "scripts/" + "verify-zz-" + "mutation-fixture.mjs";   // assembled: a planted file, never a real path
    write(f, "// planted by round2-mutations.mjs — removed straight after\n" + body);
    try { return red(run("node", ["scripts/verify-test-safety.mjs"]), /CANCELS them/); } finally { unlinkSync(P(f)); }
  });
}
await M("scripts/verify-test-safety.mjs", "a script carrying its own copy of the password vault turns verify:test-safety §15 red", "plant the vault salt string", () => {
  const f = "scripts/" + "verify-zz-" + "vault-copy.mjs";   // assembled, as above
  write(f, `// planted\nconst SALT = "${["aevidine", "credential", "vault", "v2"].join(".")}";\n`);
  try { return red(run("node", ["scripts/verify-test-safety.mjs"]), /password vault/); } finally { unlinkSync(P(f)); }
});
await M("app/owner/settings/page.tsx", "putting back the printing refresh that ran with no card turns verify:owner-s7 P21201b red", "showsPrinting = !!printing", () => {
  sub("app/owner/settings/page.tsx", "const showsPrinting = !!printing && !!(data?.printing && data.printing.length);", "const showsPrinting = !!printing;");
  try { return red(run("node", ["scripts/verify-owner-territory-s7.mjs"]), /P21201b/); } finally { restore("app/owner/settings/page.tsx"); }
});
await M("app/globals.css", "an admin token read but never declared turns verify:css-tokens red", "plant var(--adm-zz-undeclared)", () => {
  write("app/globals.css", read("app/globals.css") + "\n.adm .zz-mutation { color: var(--adm-zz-undeclared); }\n");
  try { return red(run("node", ["scripts/verify-css-tokens.mjs"])); } finally { restore("app/globals.css"); }
});
await M("public/panels/editor/style.css", "a panel file changed without its ?v= hash turns verify:panel-cache red", "append a rule to the manager panel's stylesheet", () => {
  write("public/panels/editor/style.css", read("public/panels/editor/style.css") + "\n/* zz mutation */\n");
  try { return red(run("node", ["scripts/verify-panel-cache.mjs"]), /hash|stale|--fix/i); } finally { restore("public/panels/editor/style.css"); }
});
await M(".claude/sweep/LEDGER/T39-S10.md", "an id written twice in the ledger turns verify:ledger-index red", "repeat the row P208001", () => {
  const f = ".claude/sweep/LEDGER/T39-S10.md"; const s = read(f);
  const row = s.split("\n").find((l) => l.startsWith("| P208001 |"));
  write(f, s + row + "\n");
  try { return red(run("node", ["scripts/verify-ledger-index.mjs"])); } finally { restore(f); }
});
await M("README.md", "a rulebook count that no longer matches the code turns verify-doc-counts red", "README guard count +1", () => {
  const s = read("README.md"); const m = s.match(/There are (\d+) `verify:\*`/);
  write("README.md", s.replace(m[0], `There are ${Number(m[1]) + 1} \`verify:*\``));
  try { return red(run("node", [".github/scripts/verify-doc-counts.mjs"]), /README/); } finally { restore("README.md"); }
});
await M("scripts/verify-static.mjs", "a guard listed in verify:static that has gone missing makes verify:static red (loud, not skipped)", "delete scripts/verify-installed-packages.mjs", () => {
  const f = "scripts/verify-installed-packages.mjs"; const keep = read(f); unlinkSync(P(f));
  try { return red(run("node", ["scripts/verify-static.mjs", "--quiet"]), /verify-installed-packages/); } finally { write(f, keep); }
});
await M("public/panels/kitchen/app.js", "a browser confirm() planted in the kitchen screen turns verify:static red", "append window.confirm(...)", () => {
  write("public/panels/kitchen/app.js", read("public/panels/kitchen/app.js") + '\nfunction zzMut(){ if (window.confirm("sure?")) return 1; }\n');
  try { return red(run("node", ["scripts/verify-static.mjs", "--quiet"]), /confirm/); } finally { restore("public/panels/kitchen/app.js"); }
});
await M("eslint.config.mjs", "dropping the scripts' shorthand allowance puts lint back over its cap (the cap is real)", "delete the scripts/** override", () => {
  const s = read("eslint.config.mjs"); const a = s.indexOf("  {\n    // THE TEST SCRIPTS' OWN SHORTHAND"); const b = s.indexOf("]);", a);
  if (a < 0) throw new Error("override not found");
  write("eslint.config.mjs", s.slice(0, a) + s.slice(b));
  try { return red(run("npm", ["run", "-s", "lint"]), /too many warnings/i); } finally { restore("eslint.config.mjs"); }
});
await M("scripts/verify-table-ownership.mjs", "one unused value added to a test script puts lint over its cap", "plant `const zzUnused = 1;`", () => {
  write("scripts/verify-table-ownership.mjs", read("scripts/verify-table-ownership.mjs") + "\nconst zzUnused = 1;\n");
  try { return red(run("npm", ["run", "-s", "lint"]), /too many warnings/i); } finally { restore("scripts/verify-table-ownership.mjs"); }
});
await M("scripts/stress-tenant.mjs", "stress-tenant refuses the client database before any request", "--url <the client project>", () =>
  red(run("node", ["scripts/stress-tenant.mjs", "--url", "https://kclqkmdxnwlhtyrducku.supabase.co", "--site", "http://localhost:4439"], { LFH_ANON: "x", LFH_COOKIE: "y" }), /refusing/));
await M("scripts/stress-tenant.mjs", "stress-tenant refuses the client site", "--site https://aevinite.shop", () =>
  red(run("node", ["scripts/stress-tenant.mjs", "--url", "https://wnsfcizclkbobwzcxqsf.supabase.co", "--site", "https://aevinite.shop"], { LFH_ANON: "x", LFH_COOKIE: "y" }), /refusing/));
await M("scripts/sweep/t39s10/run-all.mjs", "the run-everything tool refuses the client site", "--base https://aevinite.shop", () =>
  red(run("node", ["scripts/sweep/t39s10/run-all.mjs", "--base", "https://aevinite.shop", "--out", "/tmp/zz-runall-refuse"]), /refusing/));
await M("scripts/sweep/t39s10/run-all.mjs", "the run-everything tool records the client-stack reader as SKIPPED, never runs it", "--only verify:db-parity", () => {
  const out = `/tmp/zz-runall-skip-${Date.now()}`;
  const r = run("node", ["scripts/sweep/t39s10/run-all.mjs", "--base", "http://localhost:4439", "--out", out, "--only", "verify:db-parity"]);
  const tsv = existsSync(`${out}/results.tsv`) ? readFileSync(`${out}/results.tsv`, "utf8") : "";
  return { ok: r.code === 0 && /verify:db-parity\tSKIP/.test(tsv), note: /SKIP/.test(tsv) ? "recorded SKIP with its reason" : "not recorded as SKIP" };
});
await M("scripts/sweep/t39s10/round2-mutations.mjs", "this tool refuses to break files in the shared folder", "--root …/backup_Menu", () =>
  red(run("node", ["scripts/sweep/t39s10/round2-mutations.mjs", "--root", "/Users/aevinite/Documents/Projects/backup_Menu", "--out", "/tmp/zz"]), /refusing/));

// ── WITH THE APP RUNNING (--live <base>): the rules this round moved from "sent" to "read" ──────
// verify:staff-accounts reads its four refusals from the code (item 53); verify:guest reads the Back
// rule (item 54). The app at <base> runs the REAL code; the guard reads THIS copy's files, so a break
// here is seen by the guard and never served to anyone.
const LIVE = argv.includes("--live") ? argv[argv.indexOf("--live") + 1] : "";
if (LIVE) {
  const live = (args) => run("npm", ["run", "-s", ...args, "--", "--base", LIVE]);
  for (const [file, from, to, what, want] of [
    ["app/api/admin/users/route.ts", 'return bad("unauthorized", 401);', 'return bad("unauthorized", 403);', "the admin 'add staff' refusal answering 403 instead of 401", /add staff/],
    ["app/api/panel-login/route.ts", "status: r.transient || r.unavailable ? 503 : 401", "status: r.transient || r.unavailable ? 503 : 400", "a wrong password answered 400 instead of 401", /wrong password is refused/],
    ["lib/userAuth.ts", "const MAX_FAILS = 5;", "const MAX_FAILS = 6;", "the lock after 6 wrong tries instead of 5", /locks after 5/],
    ["app/api/kitchen/[...path]/route.ts", "async function postImpl(req: NextRequest, ctx: Ctx) {\n", "async function postImpl(req: NextRequest, ctx: Ctx) {\n  const zzEarly = 1;\n", "a kitchen handler that does something before its sign-in gate", /kitchen sign-in/],
  ]) {
    await M(file, `verify:staff-accounts goes red on ${what}`, `break ${file}, run the guard (it reads this copy)`, () => {
      sub(file, from, to);
      try { return red(live(["verify:staff-accounts"]), want); } finally { restore(file); }
    });
  }
  await M("components/MenuView.tsx", "verify:guest P15611 goes red when the menu stops remembering where the dish sat (item 54)", "drop `off` from the saved value", () => {
    sub("components/MenuView.tsx", "JSON.stringify({ y: Math.round(el.scrollTop), id, off })", "JSON.stringify({ y: Math.round(el.scrollTop), id })");
    try { return red(live(["verify:guest"]), /P15611/); } finally { restore("components/MenuView.tsx"); }
  });
}

// nothing left broken: the copy matches its commit again
const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ".", ":!node_modules", ":!.env.local"], { cwd: ROOT, encoding: "utf8" }).trim();
rows.push({ band: "J", file: "(the throwaway copy)", check: "every break was undone — the copy matches its commit again", how: "git status --porcelain", result: dirty ? "❌" : "✅", note: dirty.slice(0, 200) || "clean" });
writeFileSync(OUT, JSON.stringify(rows, null, 1));
console.log(JSON.stringify({ J: rows.length, bad: rows.filter((r) => r.result === "❌").length }));
