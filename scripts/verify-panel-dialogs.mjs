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
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

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
  const allowed = f === "myprofile.js" ? 1 : 0;
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

// ── 6 · maint.js is still CRLF ───────────────────────────────────────────────────────────────
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
