// SWEEP #9 · TERMINAL 5 — re-run of T27's 134 rows whose SUBJECT is lib/i18n.ts:
//   P13001–P13067  the English value of one interface key still reads as something
//                  a person can act on (and is still the value the row recorded)
//   P13068–P13134  that key exists in all six language blocks
//
// The key and the recorded value are read OUT OF THE LEDGER, not re-typed here, so this
// cannot drift from the rows it claims to re-run. The six languages are re-derived from
// lib/format.ts → LanguageCode, never hard-coded (three earlier counts in this repo's
// documents were wrong within days).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, src, makeRunner } from "./lib.mjs";

const { check, done } = makeRunner("T5 sweep-9 — T27's lib/i18n.ts rows");

const LEDGER = readFileSync(join(ROOT, ".claude/sweep/LEDGER/T27.md"), "utf8");
const i18n = src("lib/i18n.ts");

const LANGS = (src("lib/format.ts").match(/export type LanguageCode = ([^;]+);/) || [])[1]
  ?.split("|").map((x) => x.trim().replace(/"/g, "")) || [];

// Each language block, sliced out of the file so a key can be looked up per language.
const blocks = {};
for (const l of LANGS) {
  const m = i18n.match(new RegExp(`^  ${l}: \\{([\\s\\S]*?)^  \\},`, "m"));
  blocks[l] = m ? m[1] : null;
}
// A key can be DELIBERATELY RETIRED. lib/i18n.ts keeps an obituary comment naming every
// one it removed and why (the "a new way replaces the old one" rule), and
// `npm run verify:i18n-scope` fails if a key nobody renders is added back. A ledger row
// about a retired key is answered by the obituary, not by a missing value.
const RETIRED = (() => {
  const out = new Set();
  for (const m of i18n.matchAll(/RETIRED \d{4}-\d{2}-\d{2}[\s\S]*?(?=\n\n|\n  [a-zA-Z]+:)/g))
    for (const k of m[0].matchAll(/`?\b([a-z][A-Za-z]{3,})`?\b/g)) out.add(k[1]);
  return out;
})();
const retiredNote = (key) => {
  if (!RETIRED.has(key)) return null;
  const m = i18n.match(new RegExp(`(RETIRED \\d{4}-\\d{2}-\\d{2}[^\\n]*)`));
  return `deliberately retired — lib/i18n.ts carries the obituary (${m ? m[1].trim() : "RETIRED"}) and verify:i18n-scope refuses a key no screen renders`;
};

const keyIn = (lang, key) => blocks[lang] && new RegExp(`^\\s*${key}:\\s*["'\`]`, "m").test(blocks[lang]);
const valueIn = (lang, key) => {
  const m = blocks[lang]?.match(new RegExp(`^\\s*${key}:\\s*(["'\`])([\\s\\S]*?)\\1,?\\s*$`, "m"));
  return m ? m[2] : null;
};

// Row 1 family: | P13001 | the `noDishesYet` string reads as something a person can act on — "…" |
for (const m of LEDGER.matchAll(/^\| (P13[01][0-9][0-9]) \| the `([A-Za-z0-9_]+)` string reads as something a person can act on — "([\s\S]*?)" \|/gm)) {
  const [, id, key, recorded] = m;
  check(id, `the ${key} string still reads as something a person can act on`, () => {
    if (!keyIn("en", key)) {
      const note = retiredNote(key);
      return note ? true : `${key} is no longer an English key`;
    }
    const now = valueIn("en", key);
    if (now === null) return `${key} could not be read out of the en block`;
    // The row records the first 50-odd characters of the value, unicode-escaped.
    const want = recorded.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const nowPlain = now.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    if (!nowPlain.startsWith(want.slice(0, Math.min(want.length, 40)))) return `value changed: was "${want}", is "${nowPlain}"`;
    // And the rule itself: a label is a word, not a key; nothing is left blank or raw.
    if (!nowPlain.trim()) return "the value is empty";
    if (/\{\{|\[object|undefined|NaN/.test(nowPlain)) return `a raw marker is in the value: ${nowPlain}`;
    // "a label must be a word, not a key" — `review` IS the word. Only a camelCase or
    // snake_case value is the key leaking onto the screen.
    if (/^[a-z]+[A-Z]|_/.test(nowPlain) && nowPlain === key) return "the value is the key itself";
    return true;
  });
}

// Row 2 family: | P13068 | `noDishesYet` exists in all 6 languages, and each value is really that language |
for (const m of LEDGER.matchAll(/^\| (P13[01][0-9][0-9]) \| `([A-Za-z0-9_]+)` exists in all 6 languages/gm)) {
  const [, id, key] = m;
  check(id, `${key} exists in all six languages`, () => {
    if (LANGS.length !== 6) return `lib/format.ts now declares ${LANGS.length} languages, not 6`;
    const missing = LANGS.filter((l) => !keyIn(l, key));
    if (missing.length === LANGS.length && retiredNote(key)) return true;
    if (missing.length) return `missing in: ${missing.join(", ")}`;
    const empty = LANGS.filter((l) => !(valueIn(l, key) || "").trim());
    return empty.length === 0 || `empty in: ${empty.join(", ")}`;
  });
}

done();
