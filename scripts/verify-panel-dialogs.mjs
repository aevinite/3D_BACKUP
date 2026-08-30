// verify-panel-dialogs.mjs — a staff panel never asks with the BROWSER's own dialog.
//
//   npm run verify:panel-dialogs
//
// WHY THIS EXISTS (T9, second sweep of #7, 2026-08-30). maint.js — the settings drawer EVERY staff
// panel loads — asked "Take the guest menu OFFLINE?" with confirm(), and reported a refusal with
// alert(). myprofile.js used alert() for the two messages that matter most on that screen ("saved
// on this device only" and "not saved").
//
// A staff device is the one place those cannot be trusted. A kiosk browser, an embedded webview,
// and Chrome after somebody ticks "prevent this page from creating additional dialogs" all answer
// confirm() with false and return from alert() having shown nothing at all. Driven headless with
// dialogs suppressed: a manager tapped "🟢 Take guest menu offline", NOTHING was sent, the button
// did not move, and there was not one word on screen saying why — a tap vanishing in silence,
// which is the rule this product does not break. Two more reasons the panel's own card wins:
// a native dialog freezes the page's whole thread (the write queue stops draining while it is up),
// and the phone's BACK button cannot close it, because backstack never sees it.
//
// So these files ask through LFH_ASK (maint.js), which is a card in the panel, on the panel's own
// scrim, registered with the back-button manager. This guard fails if a native dialog comes back.
//
// It is STATIC: no database, no login, no browser, no dev server.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The checkout to scan: the first argument that really IS one, so `-- --base http://…` (which every
// sweep lane passes to every guard) cannot turn into a folder name. Same shape as the other guards.
const arg = process.argv.slice(2).find((a) => !a.startsWith("-"));
const ROOT = arg && existsSync(join(arg, "package.json")) ? arg : join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "public/panels");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m, d) => { fails++; console.log(`  FAIL ${m}`); if (d) console.log(`         ${d}`); };

if (!existsSync(DIR)) {
  console.log(`verify:panel-dialogs — ${DIR} is not here; nothing to check.`);
  process.exit(0);
}

// Comments are not code. Several of these files describe the old behaviour in prose (deliberately —
// an obituary is how the next person learns why it changed), and a guard that reads a sentence as a
// line of source is a guard that invents a failure.
// LINE COMMENTS FIRST, THEN BLOCK COMMENTS (T9 third sweep, 2026-08-31).
//
// Stripping block comments first looks harmless until a LINE comment contains the characters that
// open one. editor/inventory.js line 3 reads
//
//     // Talks to /api/inventory/* (power-enforced server-side; whoami here is display truth).
//
// and that `/*` was paired with the next `*/` anywhere below it — swallowing 190 lines of real
// code, including every write, the queue guard and the request deadline. Nothing failed loudly:
// the checks simply stopped seeing the code they were about, which is a guard passing for the
// wrong reason. Removing `// …` first (protecting `://` so a URL survives) means no such opener
// is left by the time block comments are removed.
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const FILES = readdirSync(DIR).filter((f) => f.endsWith(".js")).sort();

// ── 1 · no file every panel loads may raise a browser dialog ─────────────────────────────────
// `window.confirm(` and a bare `confirm(` both count; a property named .confirm on an object of
// ours does not (LFH_ASK.confirm is the replacement, and matching it would fail on the fix).
const DIALOG = /(?:^|[^.\w$])(?:window\s*\.\s*)?(alert|confirm|prompt)\s*\(/g;
for (const f of FILES) {
  const code = strip(readFileSync(join(DIR, f), "utf8"));
  const hits = [...code.matchAll(DIALOG)].map((m) => m[1]);
  // ONE deliberate fallback is allowed, and only in myprofile.js: it is reached solely when
  // LFH_ASK is not on the page at all, and having nothing at all there would be worse than a
  // browser dialog. It is inside tell(), which tries the panel's own card first.
  const allowed = f === "myprofile.js" ? 1 : 0;   // (editor/inventory.js is checked in its own block below)
  if (hits.length <= allowed) ok(`${f} asks in the panel, not with a browser dialog${allowed && hits.length ? " (one last-resort fallback, as designed)" : ""}`);
  else bad(`${f} raises ${hits.length} browser dialog(s)`, `${hits.join(", ")} — a device that suppresses them answers confirm() false and shows alert() to nobody`);
}

// ── 2 · the replacement is actually there, and is a real overlay ─────────────────────────────
const maint = existsSync(join(DIR, "maint.js")) ? readFileSync(join(DIR, "maint.js"), "utf8") : "";
const mcode = strip(maint);
for (const [needle, what] of [
  [/window\.LFH_ASK\s*=/, "maint.js publishes LFH_ASK, so every panel that loads the drawer has it"],
  [/confirm:\s*function|confirm\s*\(/, "LFH_ASK can ask a yes/no question"],
  [/say:\s*function/, "LFH_ASK can state something that went wrong"],
  [/LFH_BACK\.layer\(\s*["']lfh-ask["']/, "the question is registered with the back-button manager, so the phone's BACK closes it"],
  [/lfh-ask-yes/, "the Yes button carries the class that gives it a finger-sized target"],
  [/lfh-ask-no/, "…and so does Cancel — it is one of two answers, not a footnote"],
  [/min-height:46px/, "both answers are at least the 44px the owner set for this panel's controls"],
]) {
  if (needle.test(mcode) || needle.test(maint)) ok(what);
  else bad(`maint.js: ${what} — not found`, String(needle));
}

// ── 3 · Cancel is never the same as Yes ──────────────────────────────────────────────────────
// The scrim tap and the BACK press both resolve a QUESTION as false. If either were ever changed
// to resolve true, a manager brushing the screen would take the guest menu offline.
const askBlock = (mcode.match(/function askLayer[\s\S]*?\n  \}/) || [""])[0];
if (/finish\(kind === "ask" \? false : true\)/.test(askBlock)) {
  const n = (askBlock.match(/finish\(kind === "ask" \? false : true\)/g) || []).length;
  ok(`a question is answered NO by the scrim and by BACK (${n} exit path(s)), never yes`);
} else bad("maint.js: the scrim / BACK exits do not resolve a question as No", "a stray tap must never be read as Yes");

// ── 4 · the guest-menu switch and the sign-out escape really go through it ───────────────────
for (const [needle, what] of [
  [/LFH_ASK\.confirm\([\s\S]{0,200}guest menu/i, "the guest-menu switch asks through the panel's own card"],
  [/LFH_ASK\.say\([\s\S]{0,160}has NOT changed/, "a refusal from the server is shown, so nobody walks away believing it changed"],
  [/LFH_ASK\.confirm\([\s\S]{0,200}signed out/i, "the \"Not you? Sign out\" escape asks through it too"],
]) {
  if (needle.test(mcode)) ok(what);
  else bad(`maint.js: ${what} — not found`, String(needle).slice(0, 80));
}

// ── 5 · myprofile's two messages reach a person ──────────────────────────────────────────────
const mp = existsSync(join(DIR, "myprofile.js")) ? strip(readFileSync(join(DIR, "myprofile.js"), "utf8")) : "";
for (const [needle, what] of [
  [/function tell\(/, "myprofile.js has one place that decides how it speaks"],
  [/window\.LFH_ASK[\s\S]{0,80}\.say\(/, "…and it uses the panel's own card when it is there"],
  [/tell\([\s\S]{0,90}sync when you're back online/, "\"saved on this device only\" goes through it"],
  [/tell\([\s\S]{0,90}Couldn't save/, "…and so does \"couldn't save\""],
]) {
  if (needle.test(mp)) ok(what);
  else bad(`myprofile.js: ${what} — not found`, String(needle).slice(0, 80));
}

// ── 6 · THE STOCK SHEET ASKS FOR ITS REASONS IN THE PANEL (T9 third sweep, 2026-08-31) ──────
// Four browser dialogs were still in editor/inventory.js after the 2026-08-30 pass fixed one:
// THREE prompt()s asking why a purchase or a waste line is being struck out, and one confirm()
// before throwing a draft count away. prompt() answers NULL on a device that hides dialogs and
// confirm() answers FALSE — both without showing anything — and every one of those call sites
// reads `if (!answer) return;`. So the manager tapped Void and NOTHING happened and nothing was
// said: a silent vanished tap, and on an action whose whole point is being explainable later,
// because the reason is kept on record.
//
// Both chains now live in one place each (askWhy / askYesNo), with the browser's own dialog as the
// genuine last resort. Two copies of a fallback order is how they drift, so the older "add another
// line" chain was folded into the same helper rather than left beside it.
{
  const inv = existsSync(join(DIR, "editor/inventory.js")) ? strip(readFileSync(join(DIR, "editor/inventory.js"), "utf8")) : "";
  if (!inv) console.log("  ok   editor/inventory.js not in this checkout — skipping");
  else {
    const bare = [...inv.replace(/window\.(prompt|confirm)/g, "SAFE_$1")
      .matchAll(/(?:^|[^.\w$])(alert|confirm|prompt)\s*\(/g)].map((m) => m[1]);
    if (bare.length === 0) ok("editor/inventory.js raises no bare browser dialog");
    else bad(`editor/inventory.js raises ${bare.length} bare browser dialog(s)`,
      `${bare.join(", ")} — on a device that hides them, prompt() answers null and confirm() answers false, and every call site here returns on a falsy answer: the tap vanishes`);
    for (const [re, what] of [
      [/async function askWhy/, "one place decides how it asks for a REASON"],
      [/async function askYesNo/, "…and one place decides how it asks a yes/no question"],
      [/window\.LFH_ASK && window\.LFH_ASK\.text/, "the reason card is tried before the browser's prompt"],
      [/window\.LFH_ASK && window\.LFH_ASK\.confirm/, "…and the panel's card before the browser's confirm"],
    ]) {
      if (re.test(inv)) ok(`editor/inventory.js: ${what}`);
      else bad(`editor/inventory.js: ${what} — not found`, String(re).slice(0, 70));
    }
    const whys = (inv.match(/await askWhy\(/g) || []).length;
    const yesNos = (inv.match(/await askYesNo\(/g) || []).length;
    if (whys >= 3) ok(`all ${whys} "why is this being struck out" questions go through the one helper`);
    else bad(`only ${whys} of the 3 reason questions go through askWhy()`, "a fourth prompt() would be the fault coming back");
    if (yesNos >= 2) ok(`…and all ${yesNos} yes/no questions go through the other`);
    else bad(`only ${yesNos} of the 2 yes/no questions go through askYesNo()`, "");
    const firstAsk = Math.min(...["LFH_ASK"].map((n) => { const i = inv.indexOf(n); return i < 0 ? Infinity : i; }));
    const firstNative = Math.min(...["window.prompt", "window.confirm"].map((n) => { const i = inv.indexOf(n); return i < 0 ? Infinity : i; }));
    if (firstAsk < firstNative) ok("…and the browser's own dialogs are genuinely the LAST resort");
    else bad("editor/inventory.js falls back to the browser before trying the panel's card", "order of the chain");
  }
}

// ── 7 · the card that asks for a sentence ───────────────────────────────────────────────────
for (const [needle, what] of [
  [/text:\s*askText/, "LFH_ASK can ask for a REASON, not only yes/no"],
  [/function askText\(/, "…and it is a card in the panel, like the other two"],
  [/LFH_BACK\.layer\(\s*["']lfh-ask-text["']/, "…registered with the back-button manager, so BACK closes it"],
  [/go\.removeAttribute\("disabled"\)/, "…with Save refused until something is typed, said BEFORE the tap"],
  [/finish\(null\)/, "…and Cancel, the scrim and BACK all answer \"no reason\", never an empty one"],
]) {
  if (needle.test(mcode) || needle.test(maint)) ok(what);
  else bad(`maint.js: ${what} — not found`, String(needle).slice(0, 70));
}

// ── 8 · the stock sheet's one question prefers a real dialog over the browser's ─────────────
// editor/inventory.js asks "this ingredient is already on this bill — add another line?" It always
// preferred the editor's own confirmDialog(), and fell back to window.confirm — which on a device
// that suppresses dialogs answers NO without showing anything, so the manager was told "Not added"
// every time and had no way to put a second line on the bill at all. A visible refusal rather than
// a silent one, but still a dead end. LFH_ASK now sits between the two.
{
  const inv = existsSync(join(DIR, "editor/inventory.js")) ? strip(readFileSync(join(DIR, "editor/inventory.js"), "utf8")) : "";
  if (!inv) console.log("  ok   editor/inventory.js not in this checkout — skipping");
  else if (/window\.LFH_ASK && window\.LFH_ASK\.confirm/.test(inv)) ok("editor/inventory.js tries the panel's own card before the browser's dialog");
  else bad("editor/inventory.js falls straight back to window.confirm", "on a device that hides dialogs the answer is always No, and a second line can never be added");
}

// ── 9 · maint.js is still CRLF ───────────────────────────────────────────────────────────────
// This file is the one CRLF file in the folder. A whole-file rewrite that "tidies" it turns a
// six-line change into a 900-line diff nobody can review; it has happened twice in this repo.
{
  const raw = existsSync(join(DIR, "maint.js")) ? readFileSync(join(DIR, "maint.js")) : Buffer.alloc(0);
  const crlf = (raw.toString("binary").match(/\r\n/g) || []).length;
  const lf = (raw.toString("binary").match(/\n/g) || []).length;
  if (crlf > 0 && crlf === lf) ok(`maint.js still has its CRLF line endings (${crlf} lines)`);
  else bad("maint.js line endings changed", `${crlf} CRLF of ${lf} lines — expected every line CRLF`);
}

console.log(fails ? `\nverify:panel-dialogs — ${fails} FAILED` : "\nverify:panel-dialogs — all good");
process.exit(fails ? 1 : 0);
