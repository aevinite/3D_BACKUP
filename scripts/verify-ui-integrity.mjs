// verify-ui-integrity.mjs — static guards for the faults that reach a person's SCREEN.
//
//   node scripts/verify-ui-integrity.mjs
//
// WHY. Two faults got in front of the owner today, and neither could have been caught by the
// checks that were running, because the source was valid and the data was fine:
//
//   · A <script> tag was inserted INSIDE an HTML comment. The comment then ended early and the
//     manager's top bar DISPLAYED "…the pill was inserted at the far LEFT of the topbar. -->".
//   · A merge-conflict marker was committed into CLAUDE.md (a string edit assumed LF endings and
//     silently did nothing), and that file was then copied into the shared folder.
//
// Both are instant to detect and both are catastrophic to ship, so they get a static guard that
// runs in milliseconds — no browser, no network. The live counterpart (rendered text, UI that
// contradicts itself) is scripts/verify-no-fatal-ui.mjs, which runs against a DEPLOYED site.
import fs from "node:fs";
import { execSync } from "node:child_process";

// HOOK MODE (--hook): the harness pipes the tool call in on stdin after every edit. Stay silent
// when clean; exit 2 with an explanation to refuse the edit. Same contract as the sibling guards
// (verify-tap-guard.mjs, verify-test-safety.mjs) so they can share one hook.
const HOOK = process.argv.includes("--hook");
let touched = null;
if (HOOK) {
  try {
    const raw = fs.readFileSync(0, "utf8");
    const j = JSON.parse(raw || "{}");
    touched = (j.tool_input && (j.tool_input.file_path || j.tool_input.path)) || null;
  } catch { /* unreadable input → run everything, better than skipping */ }
}
// Which checks are worth running for THIS edit. Conflict markers can land in any file, so that
// one always runs; the panel checks only matter when a panel's HTML changed.
const wantPanels = !HOOK || !touched || /public\/panels\/[^/]+\/index\.html$/.test(touched);

const out = [];
let fail = 0;
const ok = (m) => { if (!HOOK) console.log(`  ok   ${m}`); };
const bad = (m, extra) => { fail++; out.push(`  FAIL ${m}${extra ? `\n         ${extra}` : ""}`); };

// ── 1. no merge-conflict markers in anything tracked ────────────────────────────
try {
  const out = execSync(`git grep -nE "^(<<<<<<< |=======$|>>>>>>> )" -- . || true`, { encoding: "utf8" });
  const hits = out.split("\n").filter(Boolean)
    // this file necessarily mentions the markers in its own comments
    .filter((l) => !l.startsWith("scripts/verify-ui-integrity.mjs:"));
  hits.length === 0
    ? ok("no merge-conflict markers in any tracked file")
    : bad(`${hits.length} merge-conflict marker line(s) COMMITTED`, hits.slice(0, 4).join("\n         "));
} catch (e) {
  bad("could not scan for conflict markers", String((e && e.message) || e));
}

// ── 2. every panel's HTML comments are balanced ─────────────────────────────────
// Strip every well-formed comment; a surviving "-->" means one was left open, and everything
// after it renders as visible text.
for (const panel of (wantPanels ? ["editor", "kitchen", "tablet"] : [])) {
  const file = `public/panels/${panel}/index.html`;
  let html;
  try { html = fs.readFileSync(file, "utf8"); } catch { console.log(`  skip ${file} (absent)`); continue; }
  const stripped = html.replace(/<!--[\s\S]*?-->/g, "");
  if (stripped.includes("-->")) {
    const at = stripped.indexOf("-->");
    bad(`${file}: an HTML comment is left OPEN — the text after it will show on screen`,
      `…${stripped.slice(Math.max(0, at - 90), at + 5).replace(/\s+/g, " ")}`);
  } else ok(`${file}: comments balanced (nothing leaks into the header)`);
}

// ── 3. no panel script is COMMENTED OUT ─────────────────────────────────────────
// The other half of the same mistake: a tag inserted INSIDE a comment leaves the comment
// perfectly balanced, so nothing looks wrong — the script just never runs, and the feature is
// silently absent. (My first attempt at a guard here used "are the tags clustered together",
// which false-positived on the legitimate theme.js in <head>. Count them instead.)
for (const panel of (wantPanels ? ["editor", "kitchen", "tablet"] : [])) {
  const file = `public/panels/${panel}/index.html`;
  let html;
  try { html = fs.readFileSync(file, "utf8"); } catch { continue; }
  const count = (t) => (t.match(/<script src="\/panels\//g) || []).length;
  const raw = count(html);
  const live = count(html.replace(/<!--[\s\S]*?-->/g, ""));
  raw === live
    ? ok(`${file}: all ${live} panel scripts are live (none stranded inside a comment)`)
    : bad(`${file}: ${raw - live} panel script(s) are INSIDE A COMMENT — they never run, so that feature is silently missing`);
}

// ── 4. no throwaway scripts committed ───────────────────────────────────────────
// Same family as the others: `git add -A` swept five `_probe.mjs`-style files I had written for
// one-off debugging into a commit, and they reached main. Harmless, but litter — the rule is that
// temp files get deleted, never committed.
if (!HOOK || !touched || /(^|\/)_[^/]*\.(mjs|js|ts)$/.test(touched)) {
  try {
    const tracked = execSync("git ls-files || true", { encoding: "utf8" }).split("\n")
      .filter((p) => /(^|\/)_[^/]*\.(mjs|js|ts|json|md|png)$/.test(p));
    tracked.length === 0
      ? ok("no throwaway _* scripts are committed")
      : bad(`${tracked.length} throwaway file(s) are COMMITTED — delete them`, tracked.slice(0, 6).join("  "));
  } catch { /* not a git repo → skip */ }
}

// ── 5. no two migrations share a number ─────────────────────────────────────────
// Not a screen fault, but the same shape of mistake and it belongs on the instant guard: two
// sessions each take "the next free number", both rebase cleanly (the FILENAMES differ, so git
// sees no conflict and `git diff --stat` looks innocent), and main ends up with two migrations
// numbered the same — after which "which one ran first?" is unanswerable. It has now happened
// twice: mig 236 renumbered from 235, and mig 238 from 237. verify:db-parity already checks this
// but it reads both databases and takes minutes, so in practice it gets run early and not again
// after the final rebase — which is exactly when the collision appears. Here it costs no network
// and runs on every migration edit.
if (!HOOK || !touched || /supabase\/migrations\//.test(touched)) {
  let files = [];
  try { files = fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")); } catch { /* no folder → skip */ }
  const byNumber = new Map();
  for (const f of files) {
    const m = /^(\d+)/.exec(f);
    if (!m) continue;
    const n = m[1].padStart(3, "0");
    byNumber.set(n, [...(byNumber.get(n) || []), f]);
  }
  const clashes = [...byNumber.entries()].filter(([, list]) => list.length > 1);
  // 18 numbers were already doubled before anyone checked (057…229). verify:db-parity keeps a
  // hand-written list of those; copying it here would just be a second list to keep in step. A
  // collision is NEW exactly when one of its files is not on main yet — which is also precisely
  // the window where saying so is useful, because after the merge it is too late to renumber.
  let shipped = null;
  try {
    shipped = new Set(execSync("git ls-tree -r origin/main --name-only supabase/migrations/ 2>/dev/null || true", { encoding: "utf8" })
      .split("\n").map((p) => p.split("/").pop()).filter(Boolean));
  } catch { /* no origin/main to compare against → fall through */ }
  const fresh = shipped && shipped.size
    ? clashes.filter(([, list]) => list.some((f) => !shipped.has(f)))
    : [];
  if (!shipped || !shipped.size) {
    ok(`${files.length} migrations (no origin/main to compare against, so new-collision check skipped)`);
  } else if (fresh.length === 0) {
    ok(`${files.length} migrations, no NEW duplicated number (${clashes.length} already on main)`);
  } else {
    bad(
      `${fresh.length} migration number(s) duplicated by a file that is NOT on main yet — renumber yours to the next free number`,
      fresh.map(([n, list]) => `${n}: ${list.map((f) => (shipped.has(f) ? `${f} (on main)` : `${f} (YOURS)`)).join("  +  ")}`).join("\n     "),
    );
  }
}

if (fail) {
  console.error("UI integrity guard refused this edit — it would put code on someone's screen:\n" + out.join("\n"));
  console.error("\n(The two faults this guards against BOTH shipped today: a script tag inside an HTML\n comment that printed '-->' in the manager's header, and a conflict marker committed into\n CLAUDE.md. Fix the above, then re-run: node scripts/verify-ui-integrity.mjs)");
  process.exit(HOOK ? 2 : 1);
}
if (!HOOK) console.log("\nAll checks passed — nothing that would print code on someone's screen.");
process.exit(0);
