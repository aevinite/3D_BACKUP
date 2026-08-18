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
import { execSync, execFileSync } from "node:child_process";

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

// ── 3b. NO PANEL SCRIPT IS LOADED TWICE ─────────────────────────────────────────
// A duplicated <script src> re-runs the file, so every top-level `const` is declared twice and the
// browser throws "Identifier 'X' has already been declared" — the panel dies on load. It happened
// on 2026-08-01: resolving a rebase conflict in index.html kept BOTH sides of the app.js tag. The
// conflict-marker check above passed (the markers were gone), the HTML was valid, and the panel was
// broken — so the shape to check is the duplication itself.
for (const panel of (wantPanels ? ["editor", "kitchen", "tablet"] : [])) {
  const file = `public/panels/${panel}/index.html`;
  let html;
  try { html = fs.readFileSync(file, "utf8"); } catch { continue; }
  const live = html.replace(/<!--[\s\S]*?-->/g, "");
  const srcs = [...live.matchAll(/<script src="([^"?]+)/g)].map((m) => m[1]);
  const dupes = [...new Set(srcs.filter((s, i) => srcs.indexOf(s) !== i))];
  dupes.length === 0
    ? ok(`${file}: no script is loaded twice`)
    : bad(`${file}: ${dupes.length} script(s) loaded TWICE — every top-level const is redeclared and the panel throws on load`, dupes.join("  "));
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

// ── 4. EVERY PANEL SCRIPT MUST STILL PARSE ────────────────────────────────────────────────
//
// The worst failure a staff panel can have is not a wrong pixel — it is a SyntaxError, because
// the browser then runs none of the file and the panel renders NOTHING. It happened while
// writing this very check (2026-08-01): a code comment inside the runtime-injected CSS used
// backticks around a class name, which ended the template literal that holds the stylesheet, and
// /manager came up blank. Nothing caught it — this guard checked HTML comments, the tap guard
// checked handler shapes, and both were happy with a file that could not load.
//
// One `node --check` per panel file, ~15ms each, and it is impossible to argue with the verdict.
{
  const panelFiles = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js")) panelFiles.push(p);
    }
  };
  walk("public/panels");
  const broken = [];
  for (const f of panelFiles) {
    try { execSync(`node --check ${JSON.stringify(f)}`, { stdio: "pipe" }); }
    catch (e) {
      const msg = String((e.stderr || e.stdout || e.message) || "").split("\n").filter(Boolean).slice(0, 3).join(" · ");
      broken.push(`${f}: ${msg}`);
    }
  }
  if (broken.length === 0) ok(`${panelFiles.length} panel script(s) parse (a syntax error renders the panel EMPTY)`);
  else bad(`${broken.length} panel script(s) will not load at all — the panel renders blank`, broken.join("\n         "));
}

// ── 6. no panel asset may be cached under a stale version ───────────────────────────────────────
// Same family as the rest of this file: invisible in the source, catastrophic on a screen. A panel
// asset whose ?v= no longer matches its content leaves browsers on the OLD file for up to 24h
// (vercel.json allows stale-while-revalidate=86400) — two manager devices reported a crash in code
// that no longer existed because of exactly this. The version is the file's content hash, so this
// is a pure equality check, and the fix is one command.
if (!HOOK || !touched || /public\/panels\//.test(touched)) {
  try {
    execSync("node scripts/verify-panel-cache.mjs", { encoding: "utf8", stdio: "pipe" });
    ok("every panel asset's ?v= matches its content (no browser left on a stale file)");
  } catch (e) {
    const out = String((e && (e.stdout || e.message)) || "");
    const first = out.split("\n").filter((l) => l.includes("content says")).slice(0, 3).join("\n     ");
    bad("a panel asset is cached under a version that no longer matches the file — run: npm run verify:panel-cache -- --fix",
      first || out.slice(0, 200));
  }
}

// ── 7. NO BACKTICK IN A /* … */ COMMENT IN A PANEL FILE ───────────────────────────────────
//
// I made the same mistake THREE times on 2026-08-01: a class name wrapped in backticks inside a
// /* … */ comment in the panels' runtime-injected stylesheet. That stylesheet is a JS template
// literal, so the backtick ENDS the string. Once the file then failed to parse (/manager rendered
// EMPTY), once it parsed as valid-but-wrong JS ("ReferenceError: col is not defined", floor drew no
// tiles), once it broke a different template two thousand lines away.
//
// A first attempt to detect it precisely ("a comment containing a backtick INSIDE a template
// literal") was wrong and accused 43 innocent comments: inside a template literal `//` is ordinary
// text, and every URL contains one, so the scan lost its place. So the rule here is deliberately
// blunt instead of clever: in a panel script, a BLOCK comment may not contain a backtick at all.
// Every CSS-in-template comment is a block comment, so this covers the whole failure mode with no
// state to track and nothing to get wrong. The two pre-existing block comments that quoted code in
// backticks were rewritten with plain quotes, so there is no exceptions list to keep in step.
{
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p); else if (e.name.endsWith(".js")) files.push(p);
    }
  };
  walk("public/panels");
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/\/\*[\s\S]*?\*\//g)) {
      if (!m[0].includes("`")) continue;
      const line = src.slice(0, m.index).split("\n").length;
      offenders.push(`${f}:${line}  ${m[0].replace(/\s+/g, " ").slice(0, 70)}…`);
    }
  }
  if (offenders.length === 0) ok(`${files.length} panel script(s): no backtick inside a /* … */ comment`);
  else bad(
    `${offenders.length} block comment(s) in a panel script contain a backtick — inside the injected stylesheet that ENDS the template literal and takes the panel down`,
    offenders.join("\n         ") + "\n         Quote code with 'single quotes' or nothing at all.",
  );
}

// ── 7b. THE SAME FAULT, IN REACT'S styled-jsx ─────────────────────────────────────────────
//
// The check above walks public/panels only, and the identical mistake is available in every React
// component that carries a `<style jsx>{` … `}</style>` block: that stylesheet is ALSO a template
// literal, so one backtick in a CSS comment inside it ends the string and the file stops parsing.
// I did exactly that on 2026-08-04 while fixing the connection popover — quoted a CSS property
// name in backticks inside a /* … */ comment. `tsc --noEmit` passed (it forgives it) and the
// TURBOPACK build failed with "Expected '</', got 'ident'", which names a line but not the cause.
// Same blunt rule as above, scoped to the style block so ordinary JSDoc elsewhere is untouched.
{
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx")) files.push(p);
    }
  };
  walk("components");
  walk("app");
  const offenders = [];
  let styleBlocks = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    // Each <style jsx>{` … `}</style> body. Non-greedy up to the closing tag, so a file with
    // several style blocks is checked block by block.
    for (const blk of src.matchAll(/<style[^>]*jsx[^>]*>\{`([\s\S]*?)`\}\s*<\/style>/g)) {
      styleBlocks++;
      for (const c of blk[1].matchAll(/\/\*[\s\S]*?\*\//g)) {
        if (!c[0].includes("`")) continue;
        const line = src.slice(0, blk.index + c.index).split("\n").length;
        offenders.push(`${f}:${line}  ${c[0].replace(/\s+/g, " ").slice(0, 70)}…`);
      }
    }
  }
  if (offenders.length === 0) ok(`${styleBlocks} styled-jsx block(s): no backtick inside a /* … */ comment`);
  else bad(
    `${offenders.length} CSS comment(s) inside a styled-jsx block contain a backtick — that ENDS the template literal and the component stops compiling`,
    offenders.join("\n         ") + "\n         Quote code with 'single quotes' or nothing at all.",
  );
}

// ── 8. THE EMBED'S SKIN HAS EXACTLY ONE WRITER ────────────────────────────────────────────
//
// Owner, 2026-08-03: "I changed the colour to white, then I go to parcel and it shifts to dark."
// The owner panel hosts the staff panel in an iframe three times over (Manager mode, Menu,
// Inventory) and the cockpit's light/dark toggle arrives by postMessage — so the LIVE skin can
// differ from the `?skin=` the frame was born with. setTab() re-applied `"skin-" + MENU_SKIN`,
// the birth value, and only ever ADDED it: the body ended up wearing skin-light AND skin-dark
// at once, and since the two CSS blocks have equal specificity the later one (dark) won. Any
// tab change threw the white theme away.
//
// The rule that fixes it is small and easy to undo by accident, so it is pinned here: every
// skin class change goes through applyEmbedSkin(), which clears the other class first and
// tracks CUR_SKIN. Nothing outside it may name MENU_SKIN as a class, and nothing may add a
// skin class without removing its opposite.
{
  const f = "public/panels/editor/app.js";
  if ((!HOOK || !touched || touched.endsWith("app.js")) && fs.existsSync(f)) {
    const src = fs.readFileSync(f, "utf8");
    const strays = [...src.matchAll(/\.add\([^)]*"skin-"\s*\+\s*MENU_SKIN/g)];
    const adders = [...src.matchAll(/\.add\("skin-"\s*\+\s*[A-Za-z_$][\w$]*\)/g)];
    const hasWriter = /function applyEmbedSkin\(/.test(src) && /\.remove\("skin-light",\s*"skin-dark"\)/.test(src);
    if (strays.length) {
      bad(`${strays.length} place(s) re-apply the BIRTH skin ("skin-" + MENU_SKIN) — that is the bug that turned the owner's white manager screen dark on every tab change`,
        'Call applyEmbedSkin(CUR_SKIN) instead — it clears the opposite class first.');
    } else if (!hasWriter) {
      bad("applyEmbedSkin() (the single writer of the embed's skin classes) is gone — a skin class added without removing its opposite leaves the body wearing both, and dark wins");
    } else if (adders.length > 1) {
      bad(`${adders.length} places add a skin class directly — there must be exactly one (inside applyEmbedSkin)`,
        "Route the others through applyEmbedSkin() so the opposite class is always cleared.");
    } else ok("the owner-embed skin has exactly one writer (a tab change cannot undo light mode)");
  }
}

// ── 9. WHY THERE IS NO STATIC CHECK FOR THE RUNTIME SHAPE OF THAT FAULT ───────────────────
//
// I made that mistake twice on 2026-08-01 (a class name in backticks inside a /* … */ comment in
// the panels' runtime-injected CSS, which is a template literal — the backtick ENDS the string).
// The first time the rest of the file failed to parse and /manager rendered EMPTY; check 4 above
// catches that. The second time the remainder happened to be VALID JavaScript, so it loaded and
// then threw "ReferenceError: col is not defined" — and the floor drew no tiles.
//
// I tried to add a scanner for "a comment containing a backtick inside a template literal" and it
// was WRONG: inside a template literal `//` is ordinary text (every URL contains one), so treating
// it as a comment threw the scan out of step and it accused 43 innocent comments. A guard that
// cries wolf is worse than no guard — it trains you to ignore it — so it is deliberately not here.
//
// What actually catches this class of fault is RUNTIME, and it already exists: run
//   node scripts/verify-no-fatal-ui.mjs --base http://localhost:4937
// against the LOCAL server before deploying (not only against the deploy afterwards). It loads
// each panel, reads the rendered text and fails on a console error or an empty screen — which is
// exactly what both incidents produced.
// ── 9. A PANEL STYLESHEET MUST NOT CONTAIN STRAY TEXT ─────────────────────────────────────
//
// 2026-08-03: editing a long CSS comment left its second half OUTSIDE the comment — five lines
// of prose sitting in the stylesheet, ending in a lone `*/`. Nothing looked broken: the file
// loaded, the page rendered, and every other check passed. But a CSS parser recovering from
// that error DISCARDS the rule that follows it, and the rule that followed was the one that
// hides the "Take order" wording on a small tile. The symptom was a tile drawing text it had
// no room for — three sizes away from where the mistake was made — and I only found it after
// four rounds of measuring the wrong thing.
//
// The check is the same shape as the HTML-comment one above: strip every WELL-FORMED block
// comment, and if a comment delimiter survives, a comment is unbalanced and whatever follows
// it is being thrown away.
for (const panel of (wantPanels ? ["editor", "kitchen", "tablet"] : [])) {
  const file = `public/panels/${panel}/style.css`;
  let css;
  try { css = fs.readFileSync(file, "utf8"); } catch { continue; }
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = stripped.search(/\*\/|\/\*/);
  if (at >= 0) {
    bad(`${file}: a CSS comment is unbalanced — the rule after it is silently DISCARDED by the parser`,
      `…${stripped.slice(Math.max(0, at - 120), at + 4).replace(/\s+/g, " ")}`);
  } else ok(`${file}: comments balanced (no rule is silently dropped)`);
}

// ── 10. NO HAND-WRITTEN -webkit-backdrop-filter ───────────────────────────────────────────
//
// CLAUDE.md has warned about this since the day it cost a long debugging round: write
// `backdrop-filter` as ONE unprefixed line, because the Tailwind-4 / Lightning-CSS build
// auto-prefixes it — and if you hand-add the -webkit- line yourself, the build DROPS the
// unprefixed property entirely. The result is frosted glass that works on Safari and is
// silently flat on Chrome/Android, which is invisible to anyone testing on an iPhone.
//
// It came back anyway, in FIVE rules, and was only caught by fetching the deployed stylesheet
// and diffing it against the source (2026-08-04 sweep; fixed in ff60f389). A rule that is
// documented, has bitten twice, and is one grep to check should not rely on memory.
{
  const files = ["app/globals.css"];
  try {
    for (const d of fs.readdirSync("public/panels", { withFileTypes: true })) {
      if (d.isDirectory() && fs.existsSync(`public/panels/${d.name}/style.css`)) files.push(`public/panels/${d.name}/style.css`);
    }
  } catch { /* no panels → just globals */ }
  const offenders = [];
  for (const f of files) {
    let src; try { src = fs.readFileSync(f, "utf8"); } catch { continue; }
    // Only the app's own Tailwind-built stylesheet is affected. The panel stylesheets are
    // served as STATIC files (no Lightning CSS), so a prefix there is harmless — but they are
    // listed so the message can say which is which rather than pretending they are the same.
    src.split("\n").forEach((line, i) => {
      if (!/-webkit-backdrop-filter/.test(line)) return;
      if (f !== "app/globals.css") return;      // static file: prefix is fine
      offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 80)}`);
    });
  }
  if (offenders.length === 0) ok("no hand-written -webkit-backdrop-filter in app/globals.css (the build adds it; adding it yourself DELETES the blur on Chrome/Android)");
  else bad(
    `${offenders.length} rule(s) hand-add -webkit-backdrop-filter — the Tailwind-4 build then DROPS the unprefixed property, so the frosted glass is GONE on Chrome/Android while still working on Safari`,
    offenders.join("\n         ") + "\n         Delete the -webkit- line and keep ONE unprefixed `backdrop-filter`. See CLAUDE.md → What \"blur\" means.",
  );
}

// ── 11. app/globals.css COMMENTS MUST BALANCE TOO ─────────────────────────────────────────
// Check 9 does this for the PANEL stylesheets, because that is where it happened. The guest
// app's stylesheet is 4,400+ lines and fails exactly the same way: a CSS parser recovering
// from an unterminated comment DISCARDS the rule that follows, so a style just stops applying
// with no error anywhere.
{
  const f = "app/globals.css";
  let src = null;
  try { src = fs.readFileSync(f, "utf8"); } catch { /* absent → skip */ }
  if (src != null) {
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "");
    if (stripped.includes("*/") || stripped.includes("/*")) {
      const at = Math.max(stripped.indexOf("*/"), stripped.indexOf("/*"));
      bad(`${f}: a /* … */ comment is UNBALANCED — the CSS rule after it is silently discarded`,
        `…${stripped.slice(Math.max(0, at - 90), at + 6).replace(/\s+/g, " ")}`);
    } else ok(`${f}: comments balanced (no rule is silently thrown away)`);
  }
}

// ── 12. A PANEL STYLESHEET MUST NOT USE A BARE env(safe-area-inset-*) ────────────────────
// The panels are served INSIDE an iframe, and env() does not resolve there — it reads 0. That
// is why components/PanelFrame.tsx measures the device's real insets and pushes them in as
// --safe-t / --safe-b, and why every panel stylesheet defines
// `--sab: max(env(safe-area-inset-bottom, 0px), var(--safe-b, 0px))`.
// Two rules in the editor's inventory popup used the bare env() and therefore had NO bottom
// inset at all: the sticky save/confirm row of a stock count sat under the phone's home bar
// (2026-08-04 sweep). Using --sat/--sab works either way, so there is no reason to write env()
// directly below the definition itself.
{
  const offenders = [];
  try {
    for (const d of fs.readdirSync("public/panels", { withFileTypes: true })) {
      if (!d.isDirectory() || !fs.existsSync(`public/panels/${d.name}/style.css`)) continue;
      const f = `public/panels/${d.name}/style.css`;
      fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (!/env\(safe-area-inset-/.test(line)) return;
        if (/--sa[tblr]\s*:|--safe-[tblr]/.test(line)) return;      // the definitions themselves
        offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
  } catch { /* no panels → nothing to check */ }
  if (offenders.length === 0) ok("no panel stylesheet reads a bare env(safe-area-inset-*) (it is always 0 inside the iframe)");
  else bad(
    `${offenders.length} panel rule(s) use a bare env(safe-area-inset-*) — inside the panel iframe that is ALWAYS 0, so the padding does nothing and the content sits under the phone's home bar`,
    offenders.join("\n         ") + "\n         Use var(--sab) / var(--sat) — PanelFrame.tsx pushes the device's real insets in under those names.",
  );
}

// ── 13. A NEW STAFF-ONLY DB FUNCTION MUST REVOKE PUBLIC EXECUTE ───────────────────────────
//
// CLAUDE.md: "GOTCHA: new Postgres functions are PUBLIC-executable by default. Every staff-only
// function MUST get REVOKE ... FROM PUBLIC, anon, authenticated + GRANT ... TO service_role
// (see migration 038 — the verify run caught anon calling a staff RPC)."
//
// 106 of the migrations do it, so the habit is kept — but NOTHING checked it, and the one time
// it was missed it was caught by luck. This is the cheapest possible check: a migration that
// CREATEs a staff function must REVOKE in the same file. Only NEW files (not yet on origin/main)
// are judged, for the same reason the migration-number check works that way — the history is
// what it is, and the useful moment to say so is before the merge.
if (!HOOK || !touched || /supabase\/migrations\//.test(touched)) {
  let files = [];
  try { files = fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")); } catch { /* none */ }
  let shipped = null;
  try {
    shipped = new Set(execSync("git ls-tree -r origin/main --name-only supabase/migrations/ 2>/dev/null || true", { encoding: "utf8" })
      .split("\n").map((p) => p.split("/").pop()).filter(Boolean));
  } catch { /* no origin/main */ }
  // A function name a GUEST is meant to call. These are public by design (the diner has no
  // login), so requiring a REVOKE on them would be wrong — and crying wolf is how a guard
  // gets ignored.
  const GUEST_OK = /(^|_)(lfh_place_order|lfh_leave_feedback|lfh_join|lfh_get_|lfh_table_|lfh_request_code|lfh_verify_|lfh_set_member_name|lfh_call_waiter|lfh_menu)/i;
  const offenders = [];
  for (const f of files) {
    if (shipped && shipped.size && shipped.has(f)) continue;         // already history
    let sql = "";
    try { sql = fs.readFileSync(`supabase/migrations/${f}`, "utf8"); } catch { continue; }
    const created = [...sql.matchAll(/create\s+(or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)/gi)].map((m) => m[2]);
    if (!created.length) continue;
    const staffFns = [...new Set(created)].filter((n) => !GUEST_OK.test(n));
    if (!staffFns.length) continue;
    if (/revoke[\s\S]{0,200}?(public|anon|authenticated)/i.test(sql)) continue;   // does it
    offenders.push(`${f} — creates ${staffFns.slice(0, 3).join(", ")}${staffFns.length > 3 ? ` (+${staffFns.length - 3})` : ""} with no REVOKE`);
  }
  if (offenders.length === 0) ok("every NEW migration that creates a staff-only function also revokes public execute");
  else bad(
    `${offenders.length} new migration(s) create a staff-only function without revoking public execute — a new Postgres function is PUBLIC-executable by default`,
    offenders.join("\n         ") + "\n         Add: REVOKE ALL ON FUNCTION <fn> FROM PUBLIC, anon, authenticated;\n              GRANT EXECUTE ON FUNCTION <fn> TO service_role;   (see migration 038)",
  );
}

// ── 14. NOTHING UNSERVEABLE MAY SIT IN public/ ────────────────────────────────────────────
//
// Everything under public/ is on the internet. On 2026-08-05
// https://3-d-backup.vercel.app/mockups/index.html answered 200 — three internal design mockups
// of the manager and tables screens, reachable by anyone with the URL. Nothing linked them, so
// nothing noticed; they had been there since they were built. A mockup that LOOKS like the app is
// the worst possible thing to hand a confused person who found it, and the same slot would happily
// hold a scratch page, an export, or a copy of a panel someone was comparing against.
//
// So the allow-list is the four HTML files the product actually serves. Anything else fails, and
// the fix is to move it to docs/ (which .vercelignore keeps out of the deploy entirely).
{
  const ALLOWED = new Set([
    "public/offline.html",                  // the offline screen the service worker shows
    "public/panels/editor/index.html",      // the manager panel
    "public/panels/kitchen/index.html",     // the kitchen screen
    "public/panels/tablet/index.html",      // the waiter panel
  ]);
  const found = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.html?$/i.test(e.name)) found.push(p);
    }
  };
  walk("public");
  const strays = found.filter((p) => !ALLOWED.has(p));
  if (strays.length === 0) ok(`public/ serves only the ${ALLOWED.size} HTML files it is supposed to`);
  else bad(
    `${strays.length} HTML file(s) under public/ are PUBLICLY REACHABLE and are not part of the product`,
    strays.join("\n         ") + "\n         Everything in public/ is on the internet. Move it to docs/ (kept out of the deploy\n         by .vercelignore), or add it to ALLOWED here with the reason it must be served.",
  );
}

// ── 14. NO FILE IS STORED WITH WINDOWS LINE ENDINGS WHILE .gitattributes SAYS eol=lf ─────────
// WHY (T10 sweep, 2026-08-12). `.gitattributes` was added to end this exact problem — its own
// header explains that a byte-level write to a CRLF file rewrites EVERY line, so a one-line change
// arrives as a whole-file diff that hides what actually changed. But adding the attribute does not
// convert what is already stored, and nobody ran the renormalise, so 44 tracked files still sat in
// git with CRLF while their attribute said LF: app/globals.css, lib/staffAuth.ts, six
// components/Session*.tsx, ~28 migrations. Every one of them was a whole-file diff waiting to
// happen, and the header's own "67 files were CRLF" had already drifted to 46 — i.e. it HAD been
// happening, silently, file by file.
//
// They were renormalised in that sweep. This is what stops the next one arriving: `git ls-files
// --eol` reports how a file is stored (i/…) next to the attribute that is meant to govern it, and
// the two disagreeing is the whole bug. The deliberate CRLF files (public/panels/**/*.css|js) carry
// `-text`, so they say i/-text and are correctly invisible to this.
{
  let rows = "";
  try {
    rows = execFileSync("git", ["ls-files", "--eol"], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 1 << 26 });
  } catch { rows = ""; }        // not a git checkout — skip rather than fail the run
  if (rows) {
    const offenders = rows
      .split("\n")
      .filter((l) => /^i\/(crlf|mixed)\b/.test(l) && !/attr\/-text/.test(l))
      .map((l) => l.split("\t").pop().trim());
    if (offenders.length === 0) ok("no file is stored with Windows line endings against its own eol=lf rule");
    else bad(
      `${offenders.length} tracked file(s) are STORED with Windows line endings while .gitattributes says eol=lf`,
      offenders.slice(0, 12).join("\n         ") +
        (offenders.length > 12 ? `\n         …and ${offenders.length - 12} more` : "") +
        "\n         The next edit to any of these arrives as a whole-file diff that hides the real change." +
        "\n         Fix: git add --renormalize -- <files>   (index only; the bytes on disk are untouched)" +
        "\n         If a file is DELIBERATELY CRLF, give it `-text` in .gitattributes instead.",
    );
  }
}

// ── 15. THE RAIL'S UNREAD COUNT MAY NOT BE PLACED WITH `transform` ────────────────────────────
// WHY (owner, 2026-08-18: "when there is notification it hides emoji and show 1"). The collapsed
// left rail put its red count on the icon with `transform: translate(12px,-12px)`. That can never
// hold: `.tab-badge` also runs the `badgePulse` animation, whose keyframes set `transform: scale(…)`
// — and an animation beats a normal declaration, so the translate was discarded on the first frame
// and the pill fell back onto its static spot, directly over the emoji. The section then showed a
// red "1" and NO icon, which is exactly the thing the icons are there for.
// So the count is anchored with top/right, which `transform` cannot fight, and the pulse keeps
// `transform` to itself. Re-introducing a transform here silently brings the fault back, so it is
// a static check rather than a comment nobody reads.
{
  const f = "public/panels/editor/style.css";
  const css = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  if (css) {
    const rule = css.match(/body\.nav-rail:not\(\.nav-rail-open\)\s+\.tab-badge\s*\{[^}]*\}/);
    if (!rule) bad("the collapsed rail has no rule placing .tab-badge — the unread count would sit wherever the row happens to put it", `expected a \`body.nav-rail:not(.nav-rail-open) .tab-badge\` block in ${f}`);
    else if (/transform\s*:/.test(rule[0])) bad("the collapsed rail's unread count is placed with `transform` — badgePulse's own transform overrides it and the pill lands on top of the emoji", `${f}\n         Anchor it with top/right instead (that is what makes the icon stay visible).`);
    else if (!/top\s*:/.test(rule[0]) || !/right\s*:/.test(rule[0])) bad("the collapsed rail's unread count is not anchored to the icon's top-right corner", `${f}\n         The rule needs both \`top:\` and \`right:\` or the count drifts back over the emoji.`);
    else ok("the rail's unread count is anchored top-right of the icon, not placed with transform");
    // The hover peek is the other half of the same screen: names appear without a click, and the
    // page underneath must not move — so .layout keeps the COLLAPSED width. If someone widens the
    // rail on hover by changing --rail-w instead, every hover reflows the floor.
    if (!/\.tabs:hover\s*\{[^}]*width:\s*var\(--rail-w-open\)/.test(css)) bad("hovering the collapsed rail no longer opens it to full width", `${f}\n         Owner, 2026-08-18: hovering the side must show the section names.`);
    else if (!/@media \(hover: hover\) and \(pointer: fine\)/.test(css)) bad("the rail's hover peek is not fenced to real mice", `${f}\n         On a touch screen :hover latches after a tap and the tablet keeps a half-open rail.`);
    else ok("hovering the collapsed rail opens it, and only on a device with a real mouse");
  }
}

if (fail) {
  console.error("UI integrity guard refused this edit — it would put code on someone's screen:\n" + out.join("\n"));
  console.error("\n(The two faults this guards against BOTH shipped today: a script tag inside an HTML\n comment that printed '-->' in the manager's header, and a conflict marker committed into\n CLAUDE.md. Fix the above, then re-run: node scripts/verify-ui-integrity.mjs)");
  process.exit(HOOK ? 2 : 1);
}
if (!HOOK) console.log("\nAll checks passed — nothing that would print code on someone's screen.");
process.exit(0);
