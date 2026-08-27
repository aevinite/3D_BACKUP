#!/usr/bin/env node
/**
 * verify-doc-counts — a number written into a rulebook must still be the number in the code.
 *
 * WHY THIS EXISTS (T29 sweep, 2026-08-22). `CLAUDE.md` is re-read before every request of every
 * session, and it carries hard counts: how many page routes there are, how many admin API routes,
 * how many admin-console pages, which Next and React are installed. Five of those had drifted, and
 * the same five numbers were copied into `README.md`, `docs/CLAUDE-DETAIL.md`, `docs/GUARD-MAP.md`
 * and `docs/SECURITY-CHECKLIST.md`, so every copy was wrong in the same way.
 *
 * That is not cosmetic. `CLAUDE.md`'s security section says "all N `/api/admin/*` routes check
 * `tokenIsValid`" and, in the same breath, that the route count must EQUAL the number that grep the
 * gate. It said 48 while there were 50 — so a session doing what the rule tells it to do counts 50,
 * reads 48, and concludes two admin routes are ungated. There are none: all 50 carry the gate. The
 * next hour goes on a hunt for a fault that does not exist, and if the session "fixes" it, it edits
 * working code. `verify:pointers` already checks that every PATH and every `npm run` in `CLAUDE.md`
 * resolves; nothing checked the NUMBERS.
 *
 * It also checks one thing that is not a number: every API route family on disk must be named
 * somewhere in `docs/CLAUDE-DETAIL.md`'s "Security gate" section. That section states outright that
 * its lists are COMPLETE and that "an API route absent from here must have a gate" — so a family
 * missing from it points a future audit at a route that is perfectly fine. Three were missing
 * (`maintenance`, `issue-media`, `print-agent`), all three correctly gated. The section's own text
 * records the same thing happening to `/api/guest/call-waiter`, which is why this half is automated.
 *
 * DELIBERATELY REPO-ONLY: no database, no login, no network, no `.env.local`, nothing outside this
 * checkout. That is what lets it run in `.github/workflows/checks.yml` on every push, in every
 * worktree, without a key. Read-only; it writes nothing and creates no rows.
 *
 *   node .github/scripts/verify-doc-counts.mjs
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const R = (p) => path.join(ROOT, p);
const read = (p) => readFileSync(R(p), "utf8");

let fails = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m, d) => { fails++; console.log("  ✗ " + m + (d ? "\n      " + d : "")); };

/* ── the truth, counted from the code ────────────────────────────────────────────────────── */
// execFileSync with an argument array: no shell, so nothing below can be re-read as a command.
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
const tracked = git("ls-files", "-z").split("\0").filter(Boolean);

const pageRoutes = tracked.filter((f) => /^app\/.*\/page\.tsx$|^app\/page\.tsx$/.test(f)).length;
const adminRoutes = tracked.filter((f) => /^app\/api\/admin\/.*route\.ts$/.test(f));
const adminGated = adminRoutes.filter((f) => /tokenIsValid/.test(read(f))).length;
const aeviPages = tracked.filter((f) => /^app\/aevinite\/.*page\.tsx$/.test(f)).length;
const ownerPages = tracked.filter((f) => /^app\/owner\/.*page\.tsx$/.test(f)).length;

const pkg = JSON.parse(read("package.json"));
const dep = (n) => String(pkg.dependencies?.[n] || pkg.devDependencies?.[n] || "").replace(/^[^0-9]*/, "");
const nextVer = dep("next");
const reactVer = dep("react");
const verifyCount = Object.keys(pkg.scripts).filter((k) => k.startsWith("verify:")).length;
const checkCount = Object.keys(pkg.scripts).filter((k) => /^(verify|test|check):/.test(k) || k === "test").length;

/* ── 1 · the numbers, wherever they are written ──────────────────────────────────────────── */
// Each rule: the file, a regex whose FIRST capture group is the number as written, the number it
// must equal, and what a reader does wrong when it is stale. The regex is deliberately anchored to
// the surrounding sentence, so re-wording the sentence fails LOUDLY here rather than silently
// switching the check off — which is how the last set of counts rotted.
const RULES = [
  ["CLAUDE.md", /- Next (\d+\.\d+\.\d+) App Router/, nextVer,
    "the stack line names the Next version a session will assume it is writing against"],
  ["CLAUDE.md", /App Router \(async params\), React (\d+\.\d+\.\d+)/, reactVer,
    "same, for React"],
  ["CLAUDE.md", /\*\*(\d+) page routes\*\* \(`find app -name page\.tsx/, String(pageRoutes),
    "the number the rule's own recount command returns"],
  ["CLAUDE.md", /all (\d+) `\/api\/admin\/\*` routes check `tokenIsValid`/, String(adminRoutes.length),
    "a session that recounts finds a different number and concludes some admin routes are ungated"],
  ["CLAUDE.md", /console \((\d+) pages, password-gated/, String(aeviPages),
    "the admin console's size, used to judge whether a page is missing"],
  ["CLAUDE.md", /`\/owner` \((\d+) pages\)/, String(ownerPages), "the owner panel's size"],

  ["README.md", /\| Admin console \| `\/aevinite\/…` \((\d+) pages\)/, String(aeviPages),
    "the human orientation page"],
  ["README.md", /layout and all (\d+) `\/api\/admin\/\*` handlers/, String(adminRoutes.length),
    "same claim as CLAUDE.md's, in the file a new person reads first"],
  ["README.md", /`\/owner\/…` \((\d+) pages\)/, String(ownerPages), "the owner panel's size"],
  ["README.md", /There are (\d+) `verify:\*` scripts in all/, String(verifyCount),
    "how many guards a person is told exist"],

  ["docs/CLAUDE-DETAIL.md", /- Next (\d+\.\d+\.\d+), App Router/, nextVer, "the unabridged stack line"],
  ["docs/CLAUDE-DETAIL.md", /async `params`\. React (\d+\.\d+\.\d+)\./, reactVer, "same, for React"],
  ["docs/CLAUDE-DETAIL.md", /every one of the (\d+) route files checks `tokenIsValid`/, String(adminRoutes.length),
    "the unabridged security-gate claim — the one an audit acts on"],
  ["docs/CLAUDE-DETAIL.md", /admin console \(`app\/aevinite\/`\), (\d+) pages/, String(aeviPages),
    "the app map"],
  ["docs/CLAUDE-DETAIL.md", /There are \*\*(\d+)\*\* `page\.tsx` routes, not four/, String(pageRoutes),
    "the line that exists to stop someone believing there are only four routes"],

  ["docs/GUARD-MAP.md", /There are \*\*(\d+)\*\* `verify:\*` \/ `test:\*` commands/, String(checkCount - 2),
    "how many guards the map claims to cover (verify:* plus test:*, excluding check:current and bare `test`)"],
  ["docs/GUARD-MAP.md", /## 7 · Admin console — `\/aevinite\/…` \((\d+) pages\)/, String(aeviPages),
    "which section a person looks under"],
  ["docs/GUARD-MAP.md", /## 6 · Owner panel — `\/owner\/…` \((\d+) pages\)/, String(ownerPages), "same"],

  ["docs/README.md", /which of the (\d+) checks covers it/, String(checkCount),
    "the sentence that sends a person to the guard map"],

  ["docs/SECURITY-CHECKLIST.md", /but the app has (\d+) page routes/, String(pageRoutes),
    "how many routes still need sweeping before the content policy can be enforced"],
];

for (const [file, re, want, why] of RULES) {
  if (!existsSync(R(file))) { bad(`${file} is missing`); continue; }
  const m = read(file).match(re);
  if (!m) {
    bad(`${file}: the sentence this check is anchored to has been re-worded`,
      `pattern: ${re}\n      Re-anchor it in .github/scripts/verify-doc-counts.mjs rather than deleting the rule — ` +
      `a silently-skipped check is how these numbers went stale in the first place.`);
    continue;
  }
  const got = m.slice(1).find(Boolean);
  if (got !== want) bad(`${file} says ${got}, the code says ${want}`, `${why}. Fix the document, not this guard.`);
}
if (!fails) ok(`${RULES.length} counts in 6 documents all match the code`);

/* ── 2 · the admin gate really is on every admin route ───────────────────────────────────── */
adminGated === adminRoutes.length
  ? ok(`all ${adminRoutes.length} \`/api/admin/*\` route files check the admin gate`)
  : bad(`${adminRoutes.length - adminGated} of ${adminRoutes.length} \`/api/admin/*\` route files do not mention \`tokenIsValid\``,
      adminRoutes.filter((f) => !/tokenIsValid/.test(read(f))).join("\n      "));

/* ── 3 · every API family is named in the security-gate section ──────────────────────────── */
{
  const DETAIL = "docs/CLAUDE-DETAIL.md";
  const doc = read(DETAIL);
  const start = doc.indexOf("## Security gate");
  const end = doc.indexOf("\n## ", start + 10);
  if (start < 0) bad(`${DETAIL} has no "## Security gate" section — the completeness promise has nowhere to live`);
  else {
    const section = doc.slice(start, end < 0 ? undefined : end);
    // One family per first path segment under app/api (or two, where the folder is a group).
    const families = [...new Set(tracked
      .filter((f) => /^app\/api\/.*route\.ts$/.test(f))
      .map((f) => f.slice("app/api/".length).split("/").filter((s) => !s.startsWith("[")).slice(0, 1)[0])
      .filter(Boolean))].sort();
    const missing = families.filter((f) => !section.includes(f));
    missing.length
      ? bad(`${DETAIL}'s "Security gate" section names no gate for ${missing.length} API family(ies): ${missing.join(", ")}`,
          `That section says its lists are COMPLETE and that "an API route absent from here must have a gate", so a\n      ` +
          `family missing from it sends the next audit at a route that is fine — or worse, invites someone to "add" a\n      ` +
          `gate to a door that already has a different one. Add it in the same commit that creates the route.`)
      : ok(`all ${families.length} API families are accounted for in the Security gate section`);
  }
}

/* ── 4 · the four documents that must not lose their load-bearing sentence ───────────────── */
for (const [file, needle, what] of [
  ["docs/KITCHEN-PRINT-SETUP.md", "offers nothing to download", "the by-hand-only printing decision (a downloaded script is blocked by macOS and Windows)"],
  ["docs/SECURITY-CHECKLIST.md", "## 4 · Log", "the log of every time the checklist was run"],
  ["docs/README.md", "⚠️ HISTORY — not a current specification", "the banner that separates a live rule from a retired one"],
  ["CLAUDE.md", "docs/REJECTED-IDEAS.md", "the pointer to what the owner has already refused"],
]) {
  existsSync(R(file)) && read(file).includes(needle)
    ? ok(`${file} still carries ${what}`)
    : bad(`${file} has lost ${what}`, `expected to find: "${needle}"`);
}

/* ── 6 · a live document may not name a code path that no longer exists ──────────────────
 * WHY (T29 sweep #7, 2026-08-27). `verify:pointers` resolves every path named in `CLAUDE.md`.
 * Nothing resolved the paths named in the OTHER rulebooks, and two were dead in the present
 * tense: `docs/CLAUDE-DETAIL.md` described an "admin-only floating switcher
 * (components/AdminSwitcher)" that was deleted in June 2026, and `docs/GUARD-MAP.md` sent anyone
 * editing the guest API to `app/api/menu`, which has never existed (it is `app/api/guest`).
 *
 * WHY IT IS AN EXPLICIT LIST AND NOT A CLEVER HEURISTIC, which is the part that matters. A path
 * scan cannot tell a dead pointer from a deliberate OBITUARY, and these documents are full of
 * sentences whose whole job is to name a deleted file and say "do not re-create it" — the
 * print-station launchers, the work-checker, `components/ui/`. Deleting those sentences would be a
 * real loss. The first draft of this check tried to read the surrounding prose for the word
 * "deleted"; it both missed a real obituary twelve lines further down AND would have waved through
 * the very AdminSwitcher sentence it exists to catch, because that paragraph happens to end
 * "...were deleted". So the rule is blunt on purpose: a path either resolves, or it is named here
 * with the reason it does not. A new dead path fails LOUDLY and a person decides which it is.
 */
{
  // path → why it is deliberately named although it is not in this checkout.
  const KNOWN_GONE = {
    ".claude/deploy.lock":            "exists only while a deploy holds it — that is the whole mechanism",
    ".claude/verify-everything.lock": "same: a pid lock that exists only while the suite is running",
    ".claude/work-checker-lessons.md":"the work-checker was retired 2026-08-13; the rule says never recreate it",
    "components/ui/":                 "never existed — the shadcn CLI is blocked on Tailwind 4 and the doc says so",
    "components/AdminSwitcher.tsx":   "deleted 2026-06-26 (commit 2b9d3933); the doc now says so in the same sentence",
    "public/print-station/*":         "deleted 2026-08-19 — nothing is offered as a download any more",
    "app/api/print-station/":         "deleted 2026-08-19, with the print-station launchers",
    "app/api/print-station/[file]/route.ts": "deleted 2026-08-19, with the print-station launchers",
    "lib/printStation.ts":            "deleted 2026-08-19, with the print-station launchers",
    "docs/FLOOR-TIMEOUT-WATCH.md":    "the floor-timeout watch was closed and retired 2026-08-05; the heading above it says so",
  };
  const LIVE = tracked
    .filter((f) => /^docs\/[^/]+\.md$/.test(f) || f === "CLAUDE.md" || f === "README.md" || f === "AGENTS.md")
    .filter((f) => !/⚠️\s*\*{0,2}HISTORY/.test(read(f).slice(0, 400)));
  const EXTS = ["", ".ts", ".tsx", ".mjs", ".js", ".json", ".sql", ".md", ".css", ".html"];
  const alive = (p) => {
    const clean = p.replace(/\/$/, "");
    if (EXTS.some((e) => existsSync(R(clean + e)))) return true;
    const segs = clean.split("/");
    const glob = segs.findIndex((s) => s.includes("*") || s.includes("["));
    if (glob > 0) return existsSync(R(segs.slice(0, glob).join("/")));   // the folder a glob lives in
    return false;
  };
  const PATH_RE = /`((?:app|lib|components|public|scripts|supabase|docs|tests|\.github|\.claude)\/[A-Za-z0-9_@./[\]*-]+)`/g;
  const dead = [];
  const usedAllowance = new Set();
  for (const f of LIVE) for (const m of read(f).matchAll(PATH_RE)) {
    const p = m[1].replace(/[.,;:]$/, "");
    if (alive(p)) continue;
    if (p in KNOWN_GONE) { usedAllowance.add(p); continue; }
    dead.push(`${f} → ${p}`);
  }
  dead.length
    ? bad(`${dead.length} live document(s) name a code path that is not in this checkout`,
        [...new Set(dead)].join("\n      ") +
        `\n      Either fix the path, or — if the thing really was deleted — say so in the same sentence AND add it\n      ` +
        `to KNOWN_GONE in this file with the reason. An obituary is worth keeping; a path written as though\n      ` +
        `it were still there sends the next session looking for a file that is not coming.`)
    : ok(`every code path named in a live rulebook resolves, or is a recorded deletion`);
  // A stale allowance is not a failure, but it is worth saying out loud.
  const unused = Object.keys(KNOWN_GONE).filter((p) => !usedAllowance.has(p));
  if (unused.length) ok(`(${unused.length} recorded deletion(s) no longer mentioned anywhere: ${unused.join(", ")})`);
}

console.log(fails
  ? `\n❌ verify-doc-counts — ${fails} problem(s). A number in a rulebook that no longer matches the code is a rule that misleads the next session.`
  : "\n✅ verify-doc-counts — every counted claim in the rulebooks matches the code");
process.exit(fails ? 1 : 0);
