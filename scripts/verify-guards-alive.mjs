// verify-guards-alive.mjs — CAN EVERY GUARD IN THIS FOLDER STILL RUN AT ALL?
//
// WHY THIS EXISTS (sweep #6 / T28, 2026-08-22). A guard that cannot run looks exactly like a guard
// nobody happened to run, and both look nothing like a red. The whole point of `verify:*` is that a
// regression cannot reach the owner's screen unnoticed — so a dead guard is worse than no guard,
// because it is a promise of cover that is not there. Three real cases, all found in one afternoon:
//
//   · `verify:cache` — the 3D no-re-fetch guard CLAUDE.md tells everyone to run — was DEAD FOR A
//     MONTH because it waited for something MenuView had deliberately stopped doing.
//   · `verify:edge-cases` ran NONE of its 14 checks for weeks. Ten `page.goto("${BASE}/menu")` calls
//     were in DOUBLE quotes, so Chrome was handed the literal address `${BASE}/menu` and the script
//     died on "Cannot navigate to invalid URL" before its first assertion. Almost certainly a bulk
//     find-and-replace of an old port that never converted the quotes.
//   · `verify:families` was calling http://localhost:4003 — one of the four panel servers that became
//     a single app on 2026-06-13 — so it died on ECONNREFUSED for over two months.
//
// Every check here is cheap and static: no database, no browser, no network. It is meant to run as a
// hook on any edit under scripts/ or tests/.
//
//   node scripts/verify-guards-alive.mjs
//   node scripts/verify-guards-alive.mjs --hook     # silent unless something is broken
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = process.argv.includes("--hook");
const fails = [];
const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok }); if (!ok) fails.push(`${name}\n      ${detail}`); };
const read = (rel) => { try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return ""; } };

// Every .mjs / .ts under scripts/ and tests/, at any depth.
const scriptFiles = [];
(function walk(rel) {
  for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    const p = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(p);
    else if (/\.(mjs|ts)$/.test(e.name)) scriptFiles.push(p);
  }
})("scripts");
if (existsSync(join(ROOT, "tests"))) for (const n of readdirSync(join(ROOT, "tests"))) if (/\.(mjs|ts)$/.test(n)) scriptFiles.push(`tests/${n}`);

// Lines that are pure comment — a rule quoted in prose must never fail its own guard.
const codeLines = (src) => src.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => !/^\s*(\/\/|\*|\/\*)/.test(l));

// ── 1 · A TEMPLATE PLACEHOLDER IN A NON-TEMPLATE STRING ──────────────────────────────────────────
// `"${BASE}/menu"` is not a mistake a reader notices and not one any type-check catches: it is a
// perfectly valid string that happens to contain a dollar and a brace. At runtime it becomes an
// address, a table name or a URL nobody can resolve, and the guard dies on its first use of it.
//
// This needs a real scan, not a line grep: almost every guard here builds SQL inside a BACKTICK
// template that spans several lines, and each of those lines looks like `'${RID}'` on its own. So
// walk the file once, tracking comments, backtick templates (and the expressions nested inside them),
// and only then look at what is left inside a straight or single quote.
function quotedStrings(src) {
  const out = [];
  let i = 0, line = 1;
  const tick = [];                       // one entry per open `…`; the number is ${} nesting depth
  const inTemplateText = () => tick.length && tick[tick.length - 1] === 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    // TEMPLATE TEXT FIRST, and this ORDER is the whole trick. Checking for "//" before this branch
    // made `fetch(`https://api…/${REF}/query`)` look like a line comment — the scan then swallowed the
    // rest of the line INCLUDING the closing backtick, and every quote for the next hundred lines was
    // read as if it were outside a template. That produced pages of false alarms on files that were
    // perfectly fine, which is the one thing a guard must never do.
    if (inTemplateText()) {
      if (c === "\\") { if (src[i + 1] === "\n") line++; i += 2; continue; }   // \` and friends
      if (c === "\n") { line++; i++; continue; }
      if (c === "`") { tick.pop(); i++; continue; }
      if (c === "$" && n === "{") { tick[tick.length - 1]++; i += 2; continue; }
      i++; continue;
    }
    if (c === "\n") { line++; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; } i += 2; continue; }
    if (c === "`") { tick.push(0); i++; continue; }
    if (c === "}" && tick.length && tick[tick.length - 1] > 0) { tick[tick.length - 1]--; i++; continue; }
    if (c === '"' || c === "'") {
      const q = c, start = line; let body = ""; i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") { body += src[i] + (src[i + 1] || ""); i += 2; continue; }
        if (src[i] === "\n") break;            // an unterminated quote — the parse check says so
        body += src[i++];
      }
      i++;
      out.push({ line: start, quote: q, body, at: i - body.length - 2 });
      continue;
    }
    i++;
  }
  return out;
}

{
  // WHAT TO FLAG, PRECISELY. A `${…}` inside a non-template string is NOT automatically wrong: a guard
  // legitimately searches product source for the literal text of a template (verify-admin-money looks
  // for the JSX string "Orders · ${windowText}"), and several hand a whole function body to
  // page.evaluate as a string. Flagging those would be a guard that cries wolf, and a guard that cries
  // wolf gets switched off — which is how this whole class of fault survived in the first place.
  //
  // The shape that is always a bug is a placeholder handed straight to something that RESOLVES it: a
  // navigation, a fetch, a request. That is exactly what happened twice, and it is unambiguous.
  const RESOLVES = /\b(goto|fetch|navigate|request|newPage|openPage|route)\s*\(\s*$/;
  const bad = [];
  for (const f of scriptFiles) {
    const src = read(f);
    for (const { line, quote, body, at } of quotedStrings(src)) {
      if (!/\$\{[A-Za-z_$][^}]*\}/.test(body)) continue;
      if (!RESOLVES.test(src.slice(Math.max(0, at - 60), at))) continue;
      bad.push(`${f}:${line} — ${quote}${body.slice(0, 60)}${quote}`);
    }
  }
  check("no script hands a ${…} placeholder to something that has to resolve it (a double-quoted template is just a string)",
    bad.length === 0,
    bad.join("\n      ") + "\n      Use backticks. This is what killed verify:edge-cases: ten page.goto calls asking Chrome for a literal address with a dollar-brace in it.");
}

// ── 2 · A PORT THAT STOPPED EXISTING ─────────────────────────────────────────────────────────────
// The four panel servers became ONE app on 2026-06-13. 4001/4002/4003 answer nothing, and a script
// still calling one of them dies on ECONNREFUSED with nothing said about why.
{
  const bad = [];
  for (const f of scriptFiles) {
    for (const [ln, line] of codeLines(read(f))) {
      const m = line.match(/localhost:(400[1-3])\b/);
      if (m) bad.push(`${f}:${ln} — port ${m[1]} (the panels have been routes in the ONE app since 2026-06-13)`);
    }
  }
  check("no script calls one of the retired panel servers (:4001 / :4002 / :4003)", bad.length === 0, bad.join("\n      "));
}

// ── 3 · A FILE A SCRIPT NAMES MUST EXIST ─────────────────────────────────────────────────────────
// Most guards read product source by path and fall back to "" on a miss, which turns every check
// about that file into a silent pass. Naming a path that has moved is the verify:cache fault exactly.
{
  const RX = /["'`]((?:app|lib|components|public|supabase|tests|scripts|\.github)\/[A-Za-z0-9_.\/\[\]@-]+\.(?:tsx?|jsx?|mjs|css|sql|md|json|html|js|yml|sh))["'`]/g;
  const bad = [];
  for (const f of scriptFiles) {
    const seen = new Set();
    for (const [ln, line] of codeLines(read(f))) {
      for (const m of line.matchAll(RX)) {
        const rel = m[1];
        if (seen.has(rel)) continue;
        seen.add(rel);
        if (!existsSync(join(ROOT, rel))) bad.push(`${f}:${ln} — names ${rel}, which does not exist`);
      }
    }
  }
  check("every repo file a script names by path still exists (a missing file reads as empty, and every check about it passes)",
    bad.length === 0, bad.join("\n      ") + "\n      Either fix the path or delete the check — do not leave a check that can only pass.");
}

// ── 4 · EVERY verify:* ENTRY RUNS A FILE THAT IS THERE, AND EVERY GUARD HAS AN ENTRY ─────────────
{
  const pkg = JSON.parse(read("package.json") || "{}");
  const entries = Object.entries(pkg.scripts || {}).filter(([k]) => k.startsWith("verify:"));
  const missing = [];
  const named = new Set();
  for (const [k, cmd] of entries) {
    for (const m of String(cmd).matchAll(/scripts\/[A-Za-z0-9_.\/-]+\.(?:mjs|ts)/g)) {
      named.add(m[0]);
      if (!existsSync(join(ROOT, m[0]))) missing.push(`${k} → ${m[0]}`);
    }
  }
  check("every verify:* entry points at a script that exists", missing.length === 0, missing.join("\n      "));

  // A guard file with no entry is one nobody will ever type. It is not automatically wrong — a guard
  // can be called BY another guard — so being named inside another script counts too.
  const allScriptText = scriptFiles.map((f) => read(f)).join("\n");
  const orphans = scriptFiles
    .filter((f) => /^scripts\/verify-[^/]+\.(mjs|ts)$/.test(f))
    .filter((f) => !named.has(f) && !allScriptText.includes(f.replace("scripts/", "")));
  check("every scripts/verify-*.mjs is reachable — it has a verify:* entry, or another guard runs it",
    orphans.length === 0,
    orphans.join("\n      ") + "\n      A guard nobody can type is a guard nobody runs. Give it an entry in package.json or delete it.");
}

// ── 5 · IT PARSES ────────────────────────────────────────────────────────────────────────────────
// A syntax error in a guard is a guard that reports nothing, and `npm run lint` does not catch every
// shape of it (a top-level-await file, an .mjs with a stray brace). One cheap parse per file.
{
  const bad = [];
  for (const f of scriptFiles) {
    if (f.endsWith(".ts")) continue;                       // typecheck owns those
    try { execFileSync(process.execPath, ["--check", join(ROOT, f)], { stdio: "pipe" }); }
    catch (e) { bad.push(`${f} — ${String(e.stderr || e.message).split("\n").find((l) => /Error|error/.test(l)) || "does not parse"}`); }
  }
  check("every script under scripts/ and tests/ parses", bad.length === 0, bad.join("\n      "));
}

// ── 6 · A GUARD THAT DRIVES THE APP SAYS SO WHEN NOTHING IS RUNNING ─────────────────────────────
// "Could not run" and "ran and found a fault" must not look the same. Any guard that navigates a
// browser or fetches a page has to do the appUp preflight, so it exits 2 with a plain sentence
// instead of a stack trace. A guard whose LIVE half is optional (it prints "skipped — pass --base")
// is exempt: it really can run without a server.
{
  const bad = [];
  for (const f of scriptFiles) {
    if (!/^scripts\/verify-/.test(f)) continue;
    const src = read(f);
    // A guard "drives the app" if it opens a browser OR fetches the app's own base — the second half
    // was missing, and that is how verify:cancel-made ran for weeks answering only "THREW: fetch
    // failed / 1 check(s) FAILED": it defaulted to a port nothing serves and its npm entry passed no
    // --base, so the plain command could never work and never said why. (sweep #6 / T28)
    const drivesBrowser = /\.goto\(|frameLocator\(|newContext\(/.test(src);
    const fetchesBase = /fetch\(\s*`\$\{BASE\}|fetch\(\s*BASE\s*\+|fetch\(\s*`\$\{B\}/.test(src);
    if (!drivesBrowser && !fetchesBase) continue;
    if (/requireAppUp|requireUp/.test(src)) continue;                          // has the preflight
    if (/SKIPPED \(pass --base|skipped the live checks|static only/i.test(src)) continue; // optional live half
    // verify-everything.mjs is the RUNNER, not a guard: it prints the base it resolved and WHERE it
    // came from on every single run, refuses to start while another run holds its lock, and checks it
    // is pointed at a dev database before it writes anything. It cannot be mistaken for a silent skip.
    if (f === "scripts/verify-everything.mjs") continue;
    // A guard that STARTS ITS OWN server (a tiny stub on a port it owns, so it can answer slowly, or
    // 5xx, or not at all) has nothing to preflight — it is the thing that brings the server up.
    if (/createServer\(/.test(src)) continue;
    // verify-owner-clash reads the panel's SOURCE and only opens a browser when --base is given; with
    // no base it says so and does the static half. That is a real skip, not a silent one.
    if (/^const BASE = arg\("--base"\);$/m.test(src)) continue;
    bad.push(f);
  }
  check("every guard that drives the app — a browser OR a fetch of its base — does the app-up preflight (exit 2 + a plain sentence, never a stack trace)",
    bad.length === 0,
    bad.join("\n      ") + "\n      Add:  import { requireUp } from \"./sweep/appUp.mjs\";  then  await requireUp(BASE, \"what it drives\");");
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────
if (!HOOK) {
  console.log(`\nARE THE GUARDS ALIVE? — ${scriptFiles.length} script(s) under scripts/ and tests/\n`);
  for (const c of checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}`);
}
if (fails.length) {
  console.error(`\n${fails.length} of ${checks.length} checks FAILED:\n\n  · ${fails.join("\n\n  · ")}\n`);
  console.error("A guard that cannot run looks exactly like a guard nobody ran, and neither looks like a red.\n");
  process.exit(HOOK ? 2 : 1);
}
if (!HOOK) console.log(`\n✅ all ${checks.length} checks passed — every guard in this folder can still run, and none can pass by accident.\n`);
