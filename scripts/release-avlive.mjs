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
// --resume: the copy already landed and something LATER failed (the first real run died on a stale
// generated type file in the live .next). Instead of the clean-tree check it proves the working tree
// already equals backup's pinned tree in every code path — which is a stronger statement than "clean",
// not a weaker one — and carries on from the build.
const RESUME = args.includes("--resume");
const words = args.filter((a) => a !== "--dry-run" && a !== "--resume").join(" ").trim();

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
if (dirty && RESUME) {
  say("  2 · --resume: the live folder carries uncommitted changes, as expected (the copy already landed)");
} else if (dirty) die(`the live folder has uncommitted changes:\n${dirty.split("\n").slice(0, 8).map((l) => "           " + l).join("\n")}\n         That is somebody's unshipped work. Do not release over it.`);
else say(`  2 · live folder clean, on main at ${git(LIVE, "rev-parse", "--short", "HEAD")}`);

// ── 3 · what this release contains ──────────────────────────────────────────────────────────────
git(LIVE, "fetch", "devsrc", "refs/remotes/origin/main:refs/remotes/devsrc/backupmain");
// A "changed" file is one of THREE things, and the first release attempt treated them all as one:
//   · in backup and in live, different            → copy it
//   · in backup only                              → copy it (git checkout creates it)
//   · in LIVE only                                → git rm it, because `git checkout <ref> -- <path>`
//                                                   FAILS on a path the ref does not have, and it fails
//                                                   for the whole batch — which is exactly what stopped
//                                                   the first run (the live repo carries a 185-file
//                                                   competitor-research folder backup has never had).
// Splitting them is what makes "replicate the whole thing" actually mean it: extras go away too.
const inBackup = new Set(git(BACKUP, "ls-tree", "-r", "--name-only", PIN).split("\n").filter(Boolean));
const allChanged = git(LIVE, "diff", "--name-only", "devsrc/backupmain").split("\n").filter(Boolean)
  .filter((f) => !KEEP_LIVE.some((k) => f === k || f.startsWith(k + "/")));
const changed = allChanged.filter((f) => inBackup.has(f));
// A live-only file is only DELETED if it sits in a path the app is built from. Inside those, an extra
// file can shadow a route, get bundled, or be imported by mistake — so "level with backup" has to mean
// it is gone. Outside them it is somebody's document (the live repo carries 185 files of competitor
// research and a handoff PDF): deleting those buys nothing, risks losing work nobody asked me to
// touch, and buries the real change in 186 deletions. They stay, and this says so.
const CODE_PATHS = ["app/", "components/", "lib/", "public/", "scripts/", "supabase/", "tests/", ".github/", "middleware.ts", "next.config.ts", "package.json", "tsconfig.json"];
const isCode = (f) => CODE_PATHS.some((c) => (c.endsWith("/") ? f.startsWith(c) : f === c));
const liveOnly = allChanged.filter((f) => !inBackup.has(f));
const removed = liveOnly.filter(isCode);
const leftAlone = liveOnly.filter((f) => !isCode(f));
const migs = git(BACKUP, "ls-tree", "--name-only", `${PIN}:supabase/migrations`).split("\n").filter(Boolean);
const liveMigs = new Set(git(LIVE, "ls-tree", "--name-only", "HEAD:supabase/migrations").split("\n").filter(Boolean));
const newMigs = migs.filter((m) => !liveMigs.has(m)).sort();
say(`  3 · ${changed.length} file(s) to bring across · ${removed.length} live-only code file(s) to remove · ${newMigs.length} migration(s) the live DB has never seen`);
if (leftAlone.length) say(`      ${leftAlone.length} live-only file(s) OUTSIDE the code paths are left exactly as they are (research, documents) — nothing asked for them to go`);
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
  say(`      5 · copy ${changed.length} file(s) from backup ${PIN.slice(0, 8)} and delete ${removed.length} the live repo has that backup does not (keeping ${KEEP_LIVE.length} paths on purpose)`);
  if (removed.length) say(`          e.g. ${removed.slice(0, 3).join(" · ")}${removed.length > 3 ? " …" : ""}`);
  say(`      6 · npm ci && npm run build in the live folder — a bad copy fails HERE, before any client sees it`);
  say(`      7 · run ${newMigs.length} migration(s) on the AV live database, one at a time, in order`);
  say("      8 · commit with the live folder's own identity and push to " + LIVE_REPO);
  say("      9 · wait for Vercel 3d-menu-av READY, then check " + HOST + " answers, and report the backup gap");
  say("\n  Nothing was changed. The real run needs the owner to lift his own AV-live deny rules");
  say("  (the migration applier, git commit and git push inside the live folder) — by design.\n");
  process.exit(0);
}

// ── 5 · the code ────────────────────────────────────────────────────────────────────────────────
if (RESUME) {
  // …minus the paths AV live keeps ON PURPOSE, which differ by design and always will (the first
  // --resume run flagged all five of them as "the copy did not land", which was the check being
  // wrong, not the release).
  const still = git(LIVE, "diff", "--name-only", "devsrc/backupmain").split("\n").filter(Boolean)
    .filter(isCode)
    .filter((f) => !KEEP_LIVE.some((k) => f === k || f.startsWith(k + "/")));
  if (still.length) die(`--resume, but ${still.length} code file(s) still differ from backup ${PIN.slice(0, 8)} — the copy did NOT land. Start again without --resume from a clean live folder:\n           ${still.slice(0, 5).join("\n           ")}`);
  say("  5 · skipped — every code file already equals backup " + PIN.slice(0, 8) + " (that is what --resume checks)");
} else {
// In batches: a single command with several thousand pathspecs hits the OS argument limit.
const batches = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
for (const b of batches(changed, 200)) git(LIVE, "checkout", "devsrc/backupmain", "--", ...b);
for (const b of batches(removed, 200)) git(LIVE, "rm", "-q", "--ignore-unmatch", "-r", "--", ...b);
say(`  5 · ${changed.length} file(s) copied from ${PIN.slice(0, 8)}, ${removed.length} live-only file(s) removed`);
}

// ── 6 · it must BUILD before anything is pushed ─────────────────────────────────────────────────
// THE BUILD STARTS FROM NOTHING. `.next` holds GENERATED route types, and after a big copy they can
// name a route that no longer exists — which is how the first real run of this script died:
//   .next/dev/types/validator.ts: Cannot find module '../../../app/api/admin/overview/route.js'
// Nothing was wrong with the release; the leftovers were describing the old tree.
sh("rm", LIVE, ["-rf", ".next"]);
sh("npm", LIVE, ["ci", "--no-audit", "--no-fund"]);
// THE BUILD IS A COMPILE CHECK, AND IT NEEDS *SOME* SUPABASE URL TO RUN.
// The live folder holds no .env file at all (checked: none), so Next cannot even collect page data —
// it stops at /api/admin/act-as with "supabaseUrl is required". Vercel builds this repo itself, from
// git, with the AV-live project's own environment; nothing built here is ever served. So the check
// runs with the DEV public values, which answers the only question being asked — does this tree
// compile — while keeping AV live's keys out of a build entirely. `.next` is then deleted, so a
// `npm start` in that folder can never serve a bundle pointed at the dev database.
const devEnv = Object.fromEntries(readFileSync(join(BACKUP, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
execFileSync("npm", ["run", "build"], {
  cwd: LIVE, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: devEnv.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: devEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: devEnv.SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD: devEnv.ADMIN_PASSWORD || "build-check" },
});
sh("rm", LIVE, ["-rf", ".next"]);
say("  6 · clean npm ci + build green in the live folder (compile check only — its output is deleted, Vercel builds from git)");

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
// WAIT FOR *THIS* COMMIT, NOT "THE LATEST READY ONE" (found on the first real release, 2026-08-19).
// The old check asked for the newest production deployment and accepted READY — and the newest one
// was still the PREVIOUS release, sitting READY, because Vercel had not started this build yet. So it
// announced a finished release while the client's site was still serving the old code, which is the
// most expensive kind of wrong report. It now follows the SHA it just pushed.
const pushed = git(LIVE, "rev-parse", "HEAD");
let state = "", seen = false;
for (let i = 0; i < 60; i++) {
  const r = await fetch("https://api.vercel.com/v6/deployments?app=3d-menu-av&limit=6", { headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` } }).then((x) => x.json()).catch(() => null);
  const mine = (r?.deployments || []).find((d) => (d?.meta?.githubCommitSha || "").startsWith(pushed.slice(0, 8)));
  if (mine) { seen = true; state = mine.state; if (state === "READY" || state === "ERROR" || state === "CANCELED") break; }
  await wait(15000);
}
if (!seen) die(`Vercel never showed a deployment for ${pushed.slice(0, 8)} — the code and the database are updated, but nothing is building. Check the project's git connection.`);
if (state !== "READY") die(`the deploy of ${pushed.slice(0, 8)} is "${state}" — the code and the database are updated but the site is still serving the previous release`);
const home = await fetch(HOST, { redirect: "follow" }).then((r) => r.status).catch(() => 0);
// One asset that only exists in THIS release, fetched cache-busted: "the host answers 200" was true
// while the whole previous release was being served, so it proves nothing on its own.
const proof = await fetch(`${HOST}/print-setup.html?rel=${pushed.slice(0, 8)}`, { redirect: "follow" }).then((r) => r.status).catch(() => 0);
say(`  9 · ${pushed.slice(0, 8)} READY · ${HOST} answers ${home} · this release's own page answers ${proof}`);
if (proof !== 200) say("      ⚠ the new page did not answer 200 — panel assets are cached for up to a day (stale-while-revalidate), so re-check with a ?v= before concluding anything");
const behind = git(BACKUP, "rev-list", "--count", `${PIN}..origin/main`);
say(`\n  ✓ AV live is level with backup ${PIN.slice(0, 8)}${Number(behind) ? ` (backup has since gained ${behind} commit(s) — a chase never converges, so this is where it landed)` : ""}\n`);
