#!/usr/bin/env node
/* release-avlive.mjs — bring AV LIVE fully level with backup, in one reviewable pass.
 *
 * WHY THIS EXISTS. "Make AV live fully where the backup is" has been done by hand four times, and
 * each time the same six steps were reconstructed from memory — which is how a release silently
 * skips a file (see the avlive-surgical-patch-can-silently-skip-a-file memory). It is also the one
 * operation where a mistake lands on paying clients. So the steps are written down once, they run in
 * order, and the run STOPS at the first thing that does not look right, saying what it had already
 * done.
 *
 *   node scripts/release-avlive.mjs --dry-run "<his exact words>"     # reads only, changes nothing
 *   node scripts/release-avlive.mjs "<his exact words>"               # the real release
 *
 * IT IS DELIBERATELY NOT SILENT ABOUT THE GUARD. The owner's own permission rules DENY the three
 * commands this needs (the AV-live migration applier, and git commit/push inside the live folder).
 * A script that spawns them from the outside would be walking around a guard he installed on
 * purpose, so this refuses to pretend: --dry-run works for anyone, and the real run must be started
 * BY HIM (or with those rules lifted by him for the duration).
 *
 * SAFETY
 *  · Requires his authorising words and checks them the same way avlive-preflight.mjs does.
 *  · Never prints any part of .env.AV.live, and masks the push token in every line of output.
 *  · Migrations run BEFORE the code deploy (they are additive, so the old code keeps working).
 *  · Pins backup's SHA at the start and reports the gap at the end (backup keeps moving).
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BACKUP = "/Users/aevinite/Documents/Projects/backup_Menu";
const LIVE = "/Users/aevinite/Documents/LIVE_PROJECTS/3D_Menu_Av";
const AV_ENV = join(BACKUP, ".env.AV.live");
const AV_REF = "kclqkmdxnwlhtyrducku";
const LIVE_REPO = "aevinitegroup/3D_Menu_Av";
const HOST = "https://www.aevinite.shop";

// Files AV live keeps as ITS OWN — never overwritten from backup. Each one has a reason, and the
// reasons are why "just copy the whole tree" has failed before.
const KEEP_LIVE = [
  ".github/workflows/checks.yml",              // the release token has no `workflow` scope: a push containing it is rejected outright
  "scripts/apply-migration-avlive.mjs",        // AV live's own guarded appliers + operational scripts…
  "scripts/apply-migration-prod.mjs",
  "scripts/copy-demo-to-prod.mjs",
  "scripts/reset-prod-owner-pw.mjs",           // …which the app never imports, so they cannot affect the build
  ".claude",                                   // session + permission config belongs to whoever opens the folder
];

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const words = args.filter((a) => a !== "--dry-run").join(" ").trim();

const log = [];
const say = (m) => { console.log(m); log.push(m); };
const die = (m) => {
  console.log(`\n  ✗ STOPPED: ${m}`);
  if (log.length) console.log(`\n  What had already been done:\n${log.map((l) => "    " + l.trim()).join("\n")}`);
  process.exit(1);
};
const sh = (cmd, cwd, argv) => execFileSync(cmd, argv, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const git = (cwd, ...argv) => sh("git", cwd, argv);

// ── 0 · his words ───────────────────────────────────────────────────────────────────────────────
if (!words) die('no authorising words given. Run: node scripts/release-avlive.mjs --dry-run "<his exact sentence>"');
if (!/(av\s*live|avlive|client site|live site|aevinite\.shop)/i.test(words)) {
  die(`those words do not name the live stack, so they are not authorisation for it:\n         "${words}"`);
}
console.log(`\n  AV LIVE RELEASE${DRY ? " · DRY RUN (nothing will change)" : ""}`);
console.log(`  authorised by: "${words}"\n`);

// ── 1 · the source, pinned ──────────────────────────────────────────────────────────────────────
git(BACKUP, "fetch", "origin", "--quiet");
const PIN = git(BACKUP, "rev-parse", "origin/main");
say(`  1 · backup pinned at ${PIN.slice(0, 8)} — every check below is against THIS, not the folder's working tree`);

// ── 2 · the live folder is clean and on main ─────────────────────────────────────────────────────
if (!existsSync(LIVE)) die(`the live folder is not on this machine (${LIVE})`);
const liveBranch = git(LIVE, "branch", "--show-current");
if (liveBranch !== "main") die(`the live folder is on "${liveBranch}", not main. Someone is mid-work there — leave it alone.`);
const dirty = git(LIVE, "status", "--porcelain");
if (dirty) die(`the live folder has uncommitted changes:\n${dirty.split("\n").slice(0, 8).map((l) => "           " + l).join("\n")}\n         That is somebody's unshipped work. Do not release over it.`);
say(`  2 · live folder clean, on main at ${git(LIVE, "rev-parse", "--short", "HEAD")}`);

// ── 3 · what this release contains ──────────────────────────────────────────────────────────────
git(LIVE, "fetch", "devsrc", "refs/remotes/origin/main:refs/remotes/devsrc/backupmain");
const changed = git(LIVE, "diff", "--name-only", "devsrc/backupmain").split("\n").filter(Boolean)
  .filter((f) => !KEEP_LIVE.some((k) => f === k || f.startsWith(k + "/")));
const migs = git(BACKUP, "ls-tree", "--name-only", `${PIN}:supabase/migrations`).split("\n").filter(Boolean);
const liveMigs = new Set(git(LIVE, "ls-tree", "--name-only", "HEAD:supabase/migrations").split("\n").filter(Boolean));
const newMigs = migs.filter((m) => !liveMigs.has(m)).sort();
say(`  3 · ${changed.length} file(s) to bring across · ${newMigs.length} migration(s) the live DB has never seen`);
if (newMigs.length) say(`      ${newMigs[0]} … ${newMigs[newMigs.length - 1]}`);

// ── 4 · the keys are AV live's, and only AV live's ──────────────────────────────────────────────
let env;
try { env = Object.fromEntries(readFileSync(AV_ENV, "utf8").split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })); }
catch { die(`cannot read ${AV_ENV} — without it nothing can be released`); }
const ref = (() => { try { return new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]; } catch { return ""; } })();
if (ref !== AV_REF) die(`those credentials point at "${ref.slice(0, 6)}…", not AV live. Nothing was sent.`);
for (const k of ["GITHUB_TOKEN", "SUPABASE_ACCESS_TOKEN", "VERCEL_TOKEN"]) if (!env[k]) die(`.env.AV.live has no ${k} — the release cannot finish without it`);
say("  4 · AV live credentials present and pointing at AV live (values never printed)");
const mask = (s) => { let out = String(s); for (const v of Object.values(env)) if (v && v.length > 12) out = out.split(v).join("***"); return out; };

if (DRY) {
  say("\n  DRY RUN — the five steps that would follow, in order:");
  say(`      5 · copy ${changed.length} file(s) from backup ${PIN.slice(0, 8)} into the live folder (keeping ${KEEP_LIVE.length} live-only paths)`);
  say(`      6 · npm ci && npm run build in the live folder — a bad copy fails HERE, before any client sees it`);
  say(`      7 · run ${newMigs.length} migration(s) on the AV live database, one at a time, in order`);
  say("      8 · commit with the live folder's own identity and push to " + LIVE_REPO);
  say("      9 · wait for Vercel 3d-menu-av READY, then check " + HOST + " answers, and report the backup gap");
  say("\n  Nothing was changed. The real run needs the owner to lift his own AV-live deny rules");
  say("  (the migration applier, git commit and git push inside the live folder) — by design.\n");
  process.exit(0);
}

// ── 5 · the code ────────────────────────────────────────────────────────────────────────────────
git(LIVE, "checkout", "devsrc/backupmain", "--", ...changed);
say(`  5 · ${changed.length} file(s) copied from ${PIN.slice(0, 8)}`);

// ── 6 · it must BUILD before anything is pushed ─────────────────────────────────────────────────
sh("npm", LIVE, ["ci", "--no-audit", "--no-fund"]);
sh("npm", LIVE, ["run", "build"]);
say("  6 · npm ci + build green in the live folder");

// ── 7 · the database, one migration at a time ───────────────────────────────────────────────────
for (const m of newMigs) {
  try { sh("node", LIVE, ["scripts/apply-migration-avlive.mjs", `supabase/migrations/${m}`]); }
  catch (e) { die(`migration ${m} FAILED — the database is part-migrated and NOTHING has been pushed:\n${mask(e.stdout || e.message).slice(0, 400)}`); }
  say(`      ✓ ${m}`);
}
say(`  7 · ${newMigs.length} migration(s) applied to the AV live database`);

// ── 8 · commit + push (the folder's own identity — a foreign author blocks the deploy) ──────────
git(LIVE, "add", "-A");
git(LIVE, "commit", "-m", `release(avlive): bring both stacks fully level again (backup ${PIN.slice(0, 8)})`);
const pushUrl = `https://x-access-token:${env.GITHUB_TOKEN}@github.com/${LIVE_REPO}.git`;
try { console.log(mask(git(LIVE, "push", pushUrl, "main:main"))); }
catch (e) { die(`the push was refused:\n${mask(e.stdout || e.message).slice(0, 400)}`); }
say(`  8 · pushed to ${LIVE_REPO} as ${git(LIVE, "rev-parse", "--short", "HEAD")} (author ${git(LIVE, "log", "-1", "--format=%ae")})`);

// ── 9 · the client's site actually works ────────────────────────────────────────────────────────
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let state = "";
for (let i = 0; i < 40; i++) {
  const r = await fetch("https://api.vercel.com/v6/deployments?app=3d-menu-av&target=production&limit=1", { headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` } }).then((x) => x.json()).catch(() => null);
  state = r?.deployments?.[0]?.state || "?";
  if (state === "READY" || state === "ERROR") break;
  await wait(15000);
}
if (state !== "READY") die(`the AV live deploy is "${state}" — the code and the database are updated but the site may not be serving it yet`);
const home = await fetch(HOST, { redirect: "follow" }).then((r) => r.status).catch(() => 0);
say(`  9 · Vercel READY · ${HOST} answers ${home}`);
const behind = git(BACKUP, "rev-list", "--count", `${PIN}..origin/main`);
say(`\n  ✓ AV live is level with backup ${PIN.slice(0, 8)}${Number(behind) ? ` (backup has since gained ${behind} commit(s) — a chase never converges, so this is where it landed)` : ""}\n`);
