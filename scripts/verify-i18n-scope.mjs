#!/usr/bin/env node
// verify:i18n-scope — what IS and ISN'T translated in this product, on purpose.
//
// WHY THIS FILE EXISTS
// Twice now a sweep has "found" that dish names and descriptions don't translate and written it
// up as a defect (guest sweep 2026-08-04, wording sweep T15 2026-08-05). It is not a defect — the
// owner decided it, out loud, on 2026-08-05: categories and filters translate, dishes do not, and
// when we want dish search in another language we add `searchAlias` rather than translate titles.
//
// A decision nobody wrote down gets re-litigated every few weeks, so this script writes it down
// in the one place a future session is forced to look: a guard that fails if the decision is
// silently reversed, and a printed statement of the decision when it passes.
//
// It also protects the OTHER half — the things that MUST stay translated. Those are real bugs
// when they regress (a Hindi guest reading an English empty state), so they are asserted, not
// assumed.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failed++; console.log(`  FAIL ${m}`); };

// ── 1 · the decision is written down where the code lives ───────────────────
{
  const menu = read("lib/menu.ts");
  if (/DELIBERATE: DISH NAMES AND DESCRIPTIONS ARE NOT TRANSLATED/.test(menu))
    ok("lib/menu.ts states the dish-translation decision, so a sweep reads it before reporting it");
  else
    fail("the dish-translation decision has been deleted from lib/menu.ts — without it this gets " +
         "re-reported as a bug every sweep. Restore the comment or, if the decision CHANGED, " +
         "update this guard in the same commit");
}

// ── 2 · categories and filters DO translate — that half is load-bearing ─────
{
  const menu = read("lib/menu.ts");
  if (/export function localized\(/.test(menu)) ok("localized() still exists for the labels that DO translate");
  else fail("localized() is gone — categories and filters would stop translating");

  const view = read("components/MenuView.tsx");
  if (/localized\(/.test(view)) ok("the guest menu still runs its category labels through localized()");
  else fail("MenuView no longer calls localized() — category names would render as raw objects or English");
}

// ── 3 · the guest's own UI strings stay in the dictionary ───────────────────
// These were hardcoded English on a screen that was otherwise rendering Hindi (T15). They are the
// moment a guest most needs words, so a regression here is a real fault, not a preference.
{
  const i18n = read("lib/i18n.ts");
  const MUST = ["noDishesYet", "noFavourites", "noMatch", "noSearchResults", "notAvailable"];
  const missing = MUST.filter((k) => !new RegExp(`\\b${k}:`).test(i18n));
  if (missing.length) fail(`the dictionary lost guest-facing keys: ${missing.join(", ")}`);
  else ok(`all ${MUST.length} guest empty-state / sold-out keys are still in the dictionary`);

  // every language block must carry every key — a missing one renders `undefined`
  const iface = i18n.slice(i18n.indexOf("export interface Translations"), i18n.indexOf("const translations"));
  const keys = [...iface.matchAll(/^\s{2}(\w+):\s*string;/gm)].map((m) => m[1]);
  const body = i18n.slice(i18n.indexOf("const translations"));
  let short = [];
  for (const lang of ["en", "de", "fr", "ar", "hi", "ko"]) {
    const m = body.match(new RegExp(`\\n  ${lang}: \\{([\\s\\S]*?)\\n  \\},`));
    if (!m) { short.push(`${lang} (block missing)`); continue; }
    const have = new Set([...m[1].matchAll(/(\w+):\s*"/g)].map((x) => x[1]));
    const miss = keys.filter((k) => !have.has(k));
    if (miss.length) short.push(`${lang} (${miss.length}: ${miss.slice(0, 4).join(", ")})`);
  }
  if (short.length) fail(`a language block is missing keys — those strings render as \`undefined\`: ${short.join(" · ")}`);
  else ok(`all 6 languages carry all ${keys.length} dictionary keys`);

  // …AND A KEY THAT IS PRESENT CAN STILL BE UNTRANSLATED. Carrying every key only proves nothing
  // renders `undefined`; it says nothing about whether the VALUE was ever translated. `de.prepTime`
  // was the literal English word "Prep" — on a dish card whose every other word was German — and it
  // sat there through two previous sweeps because the completeness check above was green (T4,
  // 2026-08-17).
  //
  // A general "is this English?" test is not possible and would fire on every correct loanword
  // (Pizza, Sushi, Protein, Burger…). So this is a NAMED LIST: the values that were found copied
  // verbatim from the English block into a language that does not use them. Add a row when a sweep
  // finds another one; never relax one to make a run green.
  const COPIED_FROM_ENGLISH = [
    { lang: "de", key: "prepTime", wrong: "Prep", why: "the German dish card read an English abbreviation" },
  ];
  const stillCopied = COPIED_FROM_ENGLISH.filter(({ lang, key, wrong }) => {
    const m = body.match(new RegExp(`\\n  ${lang}: \\{([\\s\\S]*?)\\n  \\},`));
    if (!m) return false;
    return new RegExp(`${key}:\\s*"${wrong}"`).test(m[1]);
  });
  if (stillCopied.length)
    fail(`a value was copied back from English into another language: ${stillCopied
      .map((c) => `${c.lang}.${c.key} = "${c.wrong}" (${c.why})`).join(" · ")}`);
  else ok(`no dictionary value is a known English leftover (${COPIED_FROM_ENGLISH.length} watched)`);

  // ── the language read must survive a device that refuses storage ──────────────
  // `localStorage` is not always a readable property: a browser set to block all site data throws
  // SecurityError from the getter itself. This read sits inside a useEffect, so a throw there takes
  // the whole React tree down — measured on a production build with storage blocked (T4, 2026-08-17):
  // the guest menu rendered "Something went wrong" and zero dishes, for a diner who had simply
  // turned cookies off. Every other reader of this key in the app already wraps it.
  // Read the CODE, not the prose. The fix's own comment has to name `localStorage.getItem` to
  // explain what must not come back — and a guard that trips on its own documentation just teaches
  // the next person to delete the documentation. (Same lesson as the `.split("")` check above.)
  const codeOnly = i18n.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const langReads = [...codeOnly.matchAll(/localStorage\.getItem\(/g)];
  const guarded = /const readLang\s*=\s*\(\)[\s\S]{0,240}?try\s*\{[\s\S]{0,160}?localStorage\.getItem\(/.test(codeOnly);
  if (langReads.length === 0) {
    ok("lib/i18n.ts reads no storage directly");
  } else if (guarded && langReads.length === 1) {
    ok("the saved-language read is wrapped, so a device that blocks storage still gets a menu");
  } else {
    fail("lib/i18n.ts reads localStorage without a try/catch. A browser set to block all site data " +
         "throws from the localStorage getter itself, and this read is inside a useEffect — the throw " +
         "takes the whole guest menu down and the diner gets an error screen instead of the menu. " +
         "Route every read through the wrapped readLang() helper.");
  }
}

// ── 4 · never split text by code unit again ─────────────────────────────────
// `.split("")` cuts UTF-16 units, which tears a Devanagari vowel sign off its consonant and
// renders it on a dotted placeholder circle. It shipped on the guest hero and NO text-based check
// could see it (innerText was correct). splitGraphemes() exists so it cannot come back.
{
  const files = ["components/HeroTitle.tsx", "components/IntroSplash.tsx"];
  // Match the CODE SHAPE (`.split("").map(`), not the words. The fix's own comments name
  // `.split("")` to say what not to do — including inside a {/* JSX comment */}, which no
  // line-prefix filter catches — and a guard that trips on its own documentation just teaches
  // the next person to delete the documentation.
  const offenders = files.filter((f) => /\.split\(""\)\s*\.\s*map\s*\(/.test(read(f)));
  if (offenders.length)
    fail(`${offenders.join(", ")} splits text by code unit again — that breaks Devanagari/Arabic ` +
         `into dotted placeholder circles and innerText will NOT show it. Use splitGraphemes().`);
  else ok("the animated title/wordmark split by grapheme, so non-Latin scripts stay intact");

  if (/export function splitGraphemes/.test(read("lib/brandText.ts")))
    ok("splitGraphemes() is still there for anything else that animates per letter");
  else fail("splitGraphemes() was removed from lib/brandText.ts");
}

console.log("");
if (failed) {
  console.log(`${failed} check(s) failed — see above.`);
  process.exit(1);
}
console.log("All checks passed.");
console.log("Recorded decision (owner, 2026-08-05): CATEGORIES and FILTERS translate; DISH names");
console.log("and descriptions do NOT, and that is intentional. A guest can find a category in");
console.log("their language but not a dish. When we want that, add `searchAlias` — do not");
console.log("translate titles. Please do not re-report this as a bug.");
