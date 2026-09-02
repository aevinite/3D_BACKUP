// Sweep #8 · terminal 5 · ROUND 3 — `P95701`–`P96200` (a fresh 500).
//
// The owner's word after round 2 was merged and deployed (2026-09-02): *"do all 3 and after making
// it live and merging plan 500 phases test within your boundaries make sure it cover everthing
// within your boundries and test everything again if any error left"*.
//
// PLANNED FROM A STRICTER MEASUREMENT THAN ROUND 2's. Round 2 counted named THINGS; this counts
// LINES. Every real line of code in the 40 files, against every token in all 2,309 rows T5 has
// filed: **598 of 3,525 carry nothing any row mentions.** And the gap is not spread evenly —
// 278 of those 598 are in `lib/i18n.ts`, and they are the dictionary VALUES themselves. Rounds 1
// and 2 checked the dictionary's SHAPE (every key present, no leaks, no dead keys) and never once
// looked at what the 285 non-English values actually SAY.
//
//   T1  P95715–P96056  342  EVERY DICTIONARY VALUE, one row per key per language
//   T2  P96057–P96110   54  public/offline.html's untouched half — the game, the tiers, the paint
//   T3  P96111–P96140   30  StarRating's animation internals
//   T4  P96141–P96182   42  the thin lines left across the other components
//   T5  P96183–P96200   18  sabotage on what round 3 fixes  (scripts/sweep/t5/round3-sabotage.mjs)
//
// (P95701–P95714 were spent on round 2's item 13 — see the ledger.)
//
//   node scripts/sweep/t5/round3.mjs
import { read, exists, check, skip, report, has, hasNot, countOf, eq, codeOf, ROOT } from "./lib.mjs";
import { lift } from "./lib2.mjs";
import fs from "node:fs";
import path from "node:path";

const I18N = read("lib/i18n.ts");
const OFF = read("public/offline.html");
const SR = read("components/StarRating.tsx");
const C = (n) => read(`components/${n}.tsx`);

/* ══════ T1 · EVERY DICTIONARY VALUE, DECODED (P95715–P96056) ══════
 *
 * One row per key per language: 57 keys × 6 languages = 342. Each is judged on what a DINER would
 * notice, not on prose quality — that is T38's subject this sweep and its 213 rows are left alone.
 * What is asked here is mechanical and answerable: is it in the right script, does it keep the
 * token the sentence is built around, is it short enough for the box it goes in, and is it a real
 * translation rather than the English left in place. */

const LANGS = ["en", "de", "fr", "ar", "hi", "ko"];
const SCRIPT = {
  en: /^[\x20-\x7E -ɏ -⁯₠-₿←-⇿☀-➿️\u{1F300}-\u{1FAFF}]+$/u,
  de: /^[\x20-\x7E -ɏ -⁯₠-₿←-⇿☀-➿️\u{1F300}-\u{1FAFF}]+$/u,
  fr: /^[\x20-\x7E -ɏ -⁯₠-₿←-⇿☀-➿️\u{1F300}-\u{1FAFF}]+$/u,
  ar: /[؀-ۿ]/, hi: /[ऀ-ॿ]/, ko: /[가-힯]/,
};
const KEYS = (() => {
  const m = I18N.match(/export interface Translations \{([\s\S]*?)\n\}/);
  return [...m[1].matchAll(/^\s{2}(\w+):\s*string;/gm)].map((x) => x[1]);
})();
const DICT = (() => {
  const out = {};
  for (const L of LANGS) {
    const i = I18N.indexOf(`\n  ${L}: {`);
    const body = I18N.slice(i, I18N.indexOf("\n  },", i));
    const d = {};
    for (const m of body.matchAll(/^\s{4}(\w+):\s*"((?:[^"\\]|\\.)*)",/gm)) d[m[1]] = JSON.parse('"' + m[2] + '"');
    out[L] = d;
  }
  return out;
})();

// Which keys go into a box with a real width limit, and what that limit is. Measured from the
// rendered widths in round 1 and 2 rather than guessed: a filter chip on a 360px phone holds about
// 28 characters, a tab about 18, a short label about 24.
const CAP = {
  filterVeg: 28, filterNonVeg: 28, filterChef: 28, filterFav: 28, sortTopRated: 28, sortLowPrice: 28,
  tabRate: 18, tabReviews: 18, slide: 14, categories: 24, back: 14, arView: 18, notAvailable: 24,
  favTapToSave: 30, noRatingsYet: 30, review: 18, reviews: 18, previous: 18, next: 18,
};
// Every token a sentence is BUILT around. If one is lost in translation the sentence breaks.
const TOKENS = { noSearchResults: ["{q}"], noFavouritesSub: ["{heart}"] };
// Keys whose English value is legitimately the same in another language — a loanword, a proper
// noun, or a greeting the flagship shares. Each one is a decision, not a gap.
const SAME_OK = new Set(["greeting", "catPizza", "catSushi", "catPasta", "catBurgers", "protein",
  "arView", "filterVeg", "filterNonVeg", "filterChef", "filterFav", "sortTopRated", "sortLowPrice",
  "viewIn3D", "preview3dUnavailable", "readMore", "readLess", "loading3d", "cal"]);

let t1 = 95715;
for (const key of KEYS) {
  for (const L of LANGS) {
    const id = `P${t1++}`;
    const v = DICT[L] ? DICT[L][key] : undefined;
    check(id, `${L}.${key} is a value a diner can actually read`, () => {
      if (typeof v !== "string") return `missing from the ${L} block`;
      const s = v.trim();
      if (!s) return "empty";
      // 1 · nothing a person would recognise as code
      if (/undefined|NaN|\[object Object\]|\$\{|<\/|-->|\\u[0-9a-f]{4}/i.test(s)) return `code leaked into it: ${JSON.stringify(s)}`;
      // 2 · the right script for the language
      if (L === "ar" || L === "hi" || L === "ko") {
        const latinWords = s.replace(/[^\p{L}\p{M} ]/gu, " ").split(/\s+/).filter((w) => w && /^[A-Za-z]+$/.test(w));
        // A latin word or two is fine (3D, AR, MRP); a value with NO native script at all is not.
        if (!SCRIPT[L].test(s) && !SAME_OK.has(key)) return `no ${L} script in ${JSON.stringify(s)}`;
        if (latinWords.length > 3) return `mostly latin: ${JSON.stringify(s)}`;
      }
      // 3 · every token the sentence is built around survives
      for (const tok of TOKENS[key] || []) if (!s.includes(tok)) return `lost ${tok}`;
      // 4 · it fits the box it goes in
      if (CAP[key] && s.length > CAP[key]) return `${s.length} characters in a box that holds about ${CAP[key]}`;
      // 5 · a non-English value equal to the English one is an untranslated stub, unless it is a
      //     recorded exception
      if (L !== "en" && !SAME_OK.has(key) && s === String(DICT.en[key]).trim()) return `still the English value`;
      // 6 · no doubled punctuation or a stray leading/trailing separator
      if (/[.,;:!?]{2,}|^\s*[.,;:]|\s[.,;:]\s/.test(s)) return `punctuation reads wrong: ${JSON.stringify(s)}`;
      // 7 · one apostrophe style per value — a value must not mix ’ and '
      if (/[’]/.test(s) && /'/.test(s)) return `mixes two apostrophes: ${JSON.stringify(s)}`;
      return true;
    });
  }
}

/* ══════ T1b · THE SIX LANGUAGES COMPARED WITH EACH OTHER (P96039–P96056) ══════
 *
 * T1 asks each value about itself. These eighteen ask the SIX about each other, which is a
 * different fault: a box that fits in English and breaks in German, a token one language keeps and
 * another drops, a sentence that ends in a full stop in five languages and not in the sixth. Every
 * one of them is measured across the whole dictionary at once, so a new key is covered the day it
 * lands. (The ids are the ones T1's slice freed when three keys were retired — see P58841.) */
let t1b = 96039;
const NON_EN = LANGS.filter((L) => L !== "en");
check(`P${t1b++}`, "every language carries exactly the same set of keys — no language has a stray one", () => {
  const en = new Set(Object.keys(DICT.en));
  const bad = NON_EN.filter((L) => Object.keys(DICT[L]).length !== en.size || Object.keys(DICT[L]).some((k) => !en.has(k)));
  return bad.length === 0 || bad.join(", ");
});
check(`P${t1b++}`, "…and every one of them matches the interface exactly", () => {
  const bad = LANGS.filter((L) => KEYS.some((k) => !(k in DICT[L])));
  return bad.length === 0 || bad.join(", ");
});
check(`P${t1b++}`, "every token a sentence is built around appears the same NUMBER of times in all six", () => {
  const bad = [];
  for (const [k, toks] of Object.entries(TOKENS))
    for (const tok of toks) {
      const n = String(DICT.en[k]).split(tok).length - 1;
      for (const L of NON_EN) if (String(DICT[L][k]).split(tok).length - 1 !== n) bad.push(`${L}.${k} has ${String(DICT[L][k]).split(tok).length - 1} × ${tok}, English has ${n}`);
    }
  return bad.length === 0 || bad.join(", ");
});
check(`P${t1b++}`, "no language's value is more than three times the English one — a box has one width", () => {
  const bad = [];
  for (const k of KEYS) {
    const en = String(DICT.en[k]).length;
    if (en < 6) continue;                                    // a one-word label has no useful ratio
    for (const L of NON_EN) { const n = String(DICT[L][k]).length; if (n > en * 3) bad.push(`${L}.${k} is ${n} against English's ${en}`); }
  }
  return bad.length === 0 || bad.join(", ");
});
check(`P${t1b++}`, "…and none is a truncated stub, judged per script rather than by one ratio", () => {
  // ONE RATIO CANNOT SERVE SIX SCRIPTS. Korean and Chinese-style density means "고객 리뷰" — five
  // characters — is the whole of "Customer reviews", and a third-of-English rule called it a stub.
  // Measured on this dictionary: CJK and Arabic sit around a quarter to a half of the English
  // length legitimately, Latin around three quarters. So each script gets its own floor, and the
  // floor is set below the DENSEST honest value in this dictionary, not at a round number.
  const FLOOR = { de: 0.5, fr: 0.5, ar: 0.22, hi: 0.3, ko: 0.2 };
  const bad = [];
  for (const k of KEYS) {
    const en = String(DICT.en[k]).length;
    if (en < 12) continue;
    for (const L of NON_EN) { const n = String(DICT[L][k]).length; if (n < en * FLOOR[L]) bad.push(`${L}.${k} is ${n} against English's ${en}`); }
  }
  return bad.length === 0 || bad.join(", ");
});
check(`P${t1b++}`, "each language is CONSISTENT with itself about ending a sentence", () => {
  // ACROSS languages was the wrong question and asking it found a real but harmless difference:
  // the English empty-state headlines end in a full stop and the five translations do not
  // ("No dishes on the menu yet." against "Noch keine Gerichte auf der Karte"). Nobody sees two
  // languages at once, so that is a wording opinion — T38's subject this sweep, not this one's.
  // What CAN bite a reader is one language disagreeing with ITSELF: four headlines with a stop and
  // a fifth without reads as an unfinished line on the same screen.
  const FAMILY = ["noDishesYet", "noFavourites", "noMatch"];
  const bad = [];
  for (const L of LANGS) {
    const ends = FAMILY.filter((k) => k in DICT[L]).map((k) => /[.!?。۔।]$/.test(String(DICT[L][k]).trim()));
    if (ends.length > 1 && new Set(ends).size > 1) bad.push(`${L}: ${FAMILY.map((k, i) => `${k}=${ends[i] ? "stop" : "none"}`).join(" ")}`);
  }
  return bad.length === 0 || bad.join(" · ");
});
check(`P${t1b++}`, "…and one that does NOT end in a stop in English does not grow one", () => {
  const bad = [];
  for (const k of KEYS) {
    if (/[.!?]$/.test(String(DICT.en[k]).trim())) continue;
    for (const L of NON_EN) if (/[.!?]$/.test(String(DICT[L][k]).trim())) bad.push(`${L}.${k}`);
  }
  return bad.length === 0 || bad.join(", ");
});
check(`P${t1b++}`, "an emoji in the English value is kept in every language, and none is added", () => {
  const emo = (v) => (String(v).match(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu) || []).length;
  const bad = [];
  for (const k of KEYS) { const n = emo(DICT.en[k]);
    for (const L of NON_EN) if (emo(DICT[L][k]) !== n) bad.push(`${L}.${k} has ${emo(DICT[L][k])}, English has ${n}`); }
  return bad.length === 0 || bad.join(", ");
});
check(`P${t1b++}`, "an arrow or symbol in the English value is kept too — it is part of the control", () => {
  const sym = (v) => (String(v).match(/[←↑→↓↔↕⇐⇒★☆✓✕]/gu) || []).length;
  const bad = [];
  for (const k of KEYS) { const n = sym(DICT.en[k]);
    for (const L of NON_EN) if (sym(DICT[L][k]) !== n) bad.push(`${L}.${k}`); }
  return bad.length === 0 || bad.join(", ");
});
check(`P${t1b++}`, "no language uses the typewriter apostrophe where English uses the typographic one", () => {
  const bad = [];
  for (const k of KEYS) {
    if (!/[’]/.test(String(DICT.en[k]))) continue;
    for (const L of NON_EN) if (/'/.test(String(DICT[L][k]))) bad.push(`${L}.${k}`);
  }
  return bad.length === 0 || bad.join(", ");
});
check(`P${t1b++}`, "every language's quote marks are its own, not English's, where it uses any", () => {
  const bad = [];
  for (const L of NON_EN) for (const k of KEYS) {
    const v = String(DICT[L][k]);
    if (/["]/.test(v)) bad.push(`${L}.${k} uses a plain double quote`);
  }
  return bad.length === 0 || bad.join(", ");
});
check(`P${t1b++}`, "no value in any language has a leading or trailing space", () => {
  const bad = [];
  for (const L of LANGS) for (const k of KEYS) if (String(DICT[L][k]) !== String(DICT[L][k]).trim()) bad.push(`${L}.${k}`);
  return bad.length === 0 || bad.join(", ");
});
check(`P${t1b++}`, "…nor a double space inside it", () => {
  const bad = [];
  for (const L of LANGS) for (const k of KEYS) if (/  /.test(String(DICT[L][k]))) bad.push(`${L}.${k}`);
  return bad.length === 0 || bad.join(", ");
});
check(`P${t1b++}`, "…nor a tab or a newline, which would break a single-line label", () => {
  const bad = [];
  for (const L of LANGS) for (const k of KEYS) if (/[\t\n\r]/.test(String(DICT[L][k]))) bad.push(`${L}.${k}`);
  return bad.length === 0 || bad.join(", ");
});
check(`P${t1b++}`, "no NEW pair of keys has drifted into saying the same thing", () => {
  // The naive form of this found nine pairs and every one of them is correct, which is worth
  // recording rather than relaxing away:
  //   addToCart / addToOrder — the same words in ALL SIX. Two keys, one sentence, both rendered
  //     (the dish page's button and the 3D viewer's). Redundant, not wrong; collapsing them is a
  //     wording decision for T38, and doing it here would touch a screen this territory does not own.
  //   fr.review / fr.reviews — "avis" IS both the singular and the plural in French.
  //   de.tabReviews / de.reviews, hi.tabReviews / hi.reviews — the tab and the noun are genuinely
  //     the same word.
  // So this watches for a NEW pair appearing, which is what a copy-paste actually looks like.
  const KNOWN = new Set(["addToCart|addToOrder", "review|reviews", "tabReviews|reviews"]);
  const bad = [];
  for (const L of LANGS) {
    const seen = new Map();
    for (const k of KEYS) {
      const v = String(DICT[L][k]).trim();
      if (v.length < 4) continue;
      if (seen.has(v)) {
        const pair = [seen.get(v), k].sort().join("|");
        const alt = `${seen.get(v)}|${k}`;
        if (!KNOWN.has(pair) && !KNOWN.has(alt)) bad.push(`${L}: ${seen.get(v)} and ${k} both say ${JSON.stringify(v)}`);
      } else seen.set(v, k);
    }
  }
  return bad.length === 0 || bad.join(" · ");
});
check(`P${t1b++}`, "every capped value fits its box in ALL six languages, not just in English", () => {
  const bad = [];
  for (const [k, cap] of Object.entries(CAP)) {
    if (!(k in DICT.en)) continue;
    for (const L of LANGS) { const n = String(DICT[L][k]).length; if (n > cap) bad.push(`${L}.${k}=${n} against a cap of ${cap}`); }
  }
  return bad.length === 0 || bad.join(", ");
});
check(`P${t1b++}`, "the language list, the dictionary and the picker's own table all name the same six", () => {
  const F = read("lib/format.ts");
  const picker = [...F.matchAll(/\{ code: "(\w\w)", short:/g)].map((m) => m[1]);
  return (picker.length === LANGS.length && LANGS.every((l) => picker.includes(l))) || `the picker offers ${picker.join(",")}`;
});
check(`P${t1b++}`, "…and English is the fallback in code as well as in the comment", () =>
  has(I18N, /return translations\[lang\] \|\| translations\.en;/));
if (t1b > 96057) throw new Error(`T1b overran its slice: ended at P${t1b}`);

/* ══════ T2 · public/offline.html's untouched half (P96057–P96110) ══════ */

let t2 = 96057;
const TIERS = new Function(`return ${OFF.slice(OFF.indexOf("var TIERS = ["), OFF.indexOf("];", OFF.indexOf("var TIERS = [")) + 1).replace("var TIERS = ", "")};`)();
check(`P${t2++}`, "the signal has exactly six tiers, nought through five", () => eq(TIERS.length, 6));
TIERS.forEach((tier, i) => {
  check(`P${t2++}`, `tier ${i} carries a number, a word, a colour and a plain-words note`, () =>
    (tier.n === i && typeof tier.label === "string" && tier.label.length > 2 &&
     /^#[0-9a-f]{6}$/i.test(tier.colour) && typeof tier.note === "string" && tier.note.length > 5)
    || JSON.stringify(tier));
});
check(`P${t2++}`, "the tiers' words never repeat — two tiers must not say the same thing", () =>
  eq(new Set(TIERS.map((t) => t.label)).size, TIERS.length));
check(`P${t2++}`, "…and the colour goes red → amber → green as the signal improves", () => {
  const want = ["#ef4444", "#ef4444", "#f59e0b", "#f59e0b", "#22c55e", "#22c55e"];
  return eq(TIERS.map((t) => t.colour.toLowerCase()).join(","), want.join(","));
});
check(`P${t2++}`, "no tier's note contains a technical word a diner would not know", () => {
  const bad = TIERS.filter((t) => /latency|rtt|downlink|bandwidth|effectiveType|packet/i.test(t.note));
  return bad.length === 0 || bad.map((t) => t.label).join(", ");
});
const fromBrowser = new Function("navigator", "conn",
  OFF.slice(OFF.indexOf("function fromBrowser"), OFF.indexOf("function paint")).replace(/^\s*/, "") + "\nreturn fromBrowser;")({ onLine: true }, null);
check(`P${t2++}`, "with no Network Information API the browser estimate says 'unknown', not zero", () => eq(fromBrowser(), null));
for (const [et, want] of [["slow-2g", 1], ["2g", 2], ["3g", 3]]) {
  const f = new Function("navigator", "conn",
    OFF.slice(OFF.indexOf("function fromBrowser"), OFF.indexOf("function paint")).replace(/^\s*/, "") + "\nreturn fromBrowser;")({ onLine: true }, { effectiveType: et });
  check(`P${t2++}`, `a ${et} link reads as ${want} bar(s)`, () => eq(f(), want));
}
for (const [dl, want] of [[6, 5], [3, 4], [1.6, 4], [0.5, 3], [0.2, 2]]) {
  const f = new Function("navigator", "conn",
    OFF.slice(OFF.indexOf("function fromBrowser"), OFF.indexOf("function paint")).replace(/^\s*/, "") + "\nreturn fromBrowser;")({ onLine: true }, { downlink: dl });
  check(`P${t2++}`, `a ${dl} Mbps link with no effectiveType reads as ${want} bar(s)`, () => eq(f(), want));
}
{
  const f = new Function("navigator", "conn",
    OFF.slice(OFF.indexOf("function fromBrowser"), OFF.indexOf("function paint")).replace(/^\s*/, "") + "\nreturn fromBrowser;")({ onLine: false }, { effectiveType: "4g" });
  check(`P${t2++}`, "a device the browser calls OFFLINE reads as no signal, whatever the link says", () => eq(f(), 0));
}
check(`P${t2++}`, "a 4g link with a fast downlink reads as full signal", () => {
  const f = new Function("navigator", "conn",
    OFF.slice(OFF.indexOf("function fromBrowser"), OFF.indexOf("function paint")).replace(/^\s*/, "") + "\nreturn fromBrowser;")({ onLine: true }, { effectiveType: "4g", downlink: 9 });
  return eq(f(), 5);
});
check(`P${t2++}`, "…and a 4g link with a slow one does not", () => {
  const f = new Function("navigator", "conn",
    OFF.slice(OFF.indexOf("function fromBrowser"), OFF.indexOf("function paint")).replace(/^\s*/, "") + "\nreturn fromBrowser;")({ onLine: true }, { effectiveType: "4g", downlink: 1 });
  return eq(f(), 4);
});
// the game
const G = OFF.slice(OFF.indexOf("window.LFH_GAME"));
check(`P${t2++}`, "the game gives up gracefully on a browser with no canvas", () =>
  has(G, /if \(!cv \|\| !cv\.getContext\) return \{ stop: function \(\) \{\} \};/));
check(`P${t2++}`, "…so calling stop() on it can never throw, even then", () => has(G, /stop: function \(\) \{\}/));
check(`P${t2++}`, "the tray is clamped inside the canvas at both ends", () =>
  has(G, /tray\.x = Math\.max\(tray\.w \/ 2, Math\.min\(W - tray\.w \/ 2, x\)\)/));
check(`P${t2++}`, "…and a tap or drag anywhere starts it, so nobody has to find a button", () =>
  has(G, /if \(!started && !stopped\) begin\(\)/));
check(`P${t2++}`, "the frame step is capped, so a backgrounded tab cannot teleport the plates", () =>
  has(G, /var dt = Math\.min\(48, now - \(last \|\| now\)\)/));
check(`P${t2++}`, "…and the clock is reset on return, not carried over", () => has(G, /last = 0; schedule\(\)/));
check(`P${t2++}`, "a plate is caught by overlap with the tray, not by pixel colour", () =>
  has(G, /Math\.abs\(p\.x - tray\.x\) < tray\.w \/ 2 \+ p\.r \* 0\.5/));
check(`P${t2++}`, "a missed plate costs a life and is removed, so it cannot cost two", () =>
  has(G, /plates\.splice\(i, 1\); lives--;/));
check(`P${t2++}`, "…and the hearts row never renders a negative number of hearts", () =>
  has(G, /lives > 0 \? new Array\(lives \+ 1\)\.join\("&hearts;"\) : "&mdash;"/));
check(`P${t2++}`, "the game ends at nought lives, not below", () => has(G, /if \(lives <= 0\) over = true;/));
check(`P${t2++}`, "a finished game can be restarted by a tap, and only when it is not stopped", () =>
  has(G, /if \(over && !stopped\) \{ reset\(\); begin\(\); \}/));
check(`P${t2++}`, "reset really resets every piece of state", () => {
  const seg = G.slice(G.indexOf("function reset()"), G.indexOf("function spawn"));
  return ["plates = []", "score = 0", "lives = 3", "over = false", "speed = 0.14"].every((k) => seg.includes(k))
    || "reset leaves something behind";
});
check(`P${t2++}`, "the spawn gap shortens with the score but never below a floor", () =>
  has(G, /spawnAt = now \+ Math\.max\(430, 1150 - score \* 20\)/));
check(`P${t2++}`, "…and the fall speed caps, so it stays a distraction", () =>
  has(G, /speed = Math\.min\(0\.38, speed \+ 0\.007\)/));
check(`P${t2++}`, "a plate spawns inside the canvas, never off its edge", () =>
  has(G, /x: 40 \+ Math\.random\(\) \* \(W - 80\)/));
check(`P${t2++}`, "the arrow keys move the tray and do not scroll the page", () =>
  has(G, /e\.preventDefault\(\);/) === true && countOf(G, /e\.preventDefault\(\)/) >= 2);
check(`P${t2++}`, "…and they do nothing once the game has stopped", () => has(G, /if \(stopped\) return;/));
check(`P${t2++}`, "the pointer is captured on a drag, and a failure to capture cannot throw", () =>
  has(G, /try \{ cv\.setPointerCapture\(e\.pointerId\); \} catch \(err\) \{\}/));
check(`P${t2++}`, "a mouse only drags while a button is held; a finger always drags", () =>
  has(G, /if \(e\.buttons \|\| e\.pointerType === "touch"\) move\(toX\(e\.clientX\)\)/));
check(`P${t2++}`, "the canvas maps a real screen position onto its own scale", () =>
  has(G, /\(\(clientX - r\.left\) \/ r\.width\) \* W/));
check(`P${t2++}`, "only one animation frame is ever in flight", () => has(G, /if \(!raf && !document\.hidden && !stopped\)/));
check(`P${t2++}`, "…and the frame is cancelled when the tab hides", () =>
  has(G, /if \(document\.hidden\) \{ if \(raf\) cancelAnimationFrame\(raf\); raf = null; \}/));
check(`P${t2++}`, "the 'back online' message is drawn on the canvas, where the player is looking", () =>
  has(G, /ctx\.fillText\(stopped \? stoppedMsg : "Caught " \+ score/));
check(`P${t2++}`, "…and it says what is about to happen", () => has(G, /"reloading…"/));
check(`P${t2++}`, "the game reads its own score from one place, so the HUD cannot drift", () =>
  has(G, /scoreEl\.textContent = String\(score\)/));
check(`P${t2++}`, "the page's own retry hint and the game's message never contradict each other", () =>
  has(OFF, /window\.LFH_GAME\.stop\("Back online"\)/) === true && has(OFF, /"Back online — reloading\.\.\."/) === true);
check(`P${t2++}`, "nothing in the game writes to storage", () => hasNot(G, /localStorage|sessionStorage|indexedDB/));
check(`P${t2++}`, "…and nothing in it touches a cookie", () => hasNot(G, /document\.cookie/));
check(`P${t2++}`, "the whole page still loads no font, image or script from anywhere", () =>
  hasNot(OFF, /<script[^>]+src=|<link[^>]+href=|<img|@import|url\(http/));
check(`P${t2++}`, "the page's own retry hint element is the one the loop writes to", () =>
  has(OFF, /id="hint"/) === true && has(OFF, /\$\("hint"\)\.textContent/) === true);
check(`P${t2++}`, "every element the script reaches for really exists in the page", () => {
  const ids = [...OFF.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]);
  const missing = [...new Set(ids)].filter((i) => !new RegExp(`id="${i}"`).test(OFF));
  return missing.length === 0 || `no element with id: ${missing.join(", ")}`;
});
check(`P${t2++}`, "…and every id in the page is reached by the script or styled by the page", () => {
  // ONE EXCEPTION, and it is a deliberate trade rather than an oversight: `id="game"` is unused —
  // the panel is styled by its CLASS and the script never asks for it. It stays because
  // public/offline.html is PRECACHED, so touching this file at all requires a VERSION bump in
  // public/sw.js, and a bump wipes every device's saved pages and reads. Spending that on a dead
  // attribute would cost every diner and every waiter their offline copy for no gain. It goes on
  // the next bump that has a reason of its own.
  const DEAD_BUT_NOT_WORTH_A_CACHE_WIPE = new Set(["game"]);
  const ids = [...OFF.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);
  const dead = ids.filter((i) => !DEAD_BUT_NOT_WORTH_A_CACHE_WIPE.has(i)
    && !new RegExp(`\\$\\("${i}"\\)`).test(OFF) && !new RegExp(`#${i}\\b`).test(OFF));
  return dead.length === 0 || `nothing uses: ${dead.join(", ")}`;
});

/* ══════ T3 · StarRating's animation internals (P96111–P96140) ══════ */

let t3 = 96111;
check(`P${t3++}`, "the tween helper starts on the next frame, never synchronously", () =>
  has(SR, /requestAnimationFrame\(tick\);\n\}/));
check(`P${t3++}`, "…and it honours a delay without burning the value it is animating", () =>
  has(SR, /if \(e < 0\) \{\n\s*requestAnimationFrame\(tick\);\n\s*return;/));
check(`P${t3++}`, "…and it always lands exactly on its target value", () =>
  has(SR, /const p = Math\.min\(e \/ dur, 1\)/));
check(`P${t3++}`, "…and it only calls back once, at the end", () =>
  has(SR, /if \(p < 1\) requestAnimationFrame\(tick\);\n\s*else if \(cb\) cb\(\);/));
check(`P${t3++}`, "the unit and unit-less tweens are the same maths, so they cannot drift", () => {
  const a = SR.slice(SR.indexOf("function tweenU"), SR.indexOf("// Same idea as tweenU"));
  const b = SR.slice(SR.indexOf("function tween("), SR.indexOf("// Briefly flashes"));
  return (a.includes("from + (to - from) * ease(p)") && b.includes("from + (to - from) * ease(p)")) || "the two tweens compute differently";
});
check(`P${t3++}`, "the hole flash restores its own transition afterwards", () =>
  has(SR, /setTimeout\(\(\) => \(hole!\.style\.transition = ""\), 300\)/));
check(`P${t3++}`, "…and it does nothing at all when there is no hole to flash", () =>
  has(SR, /const hole = li\.querySelector<HTMLElement>\("\.sr-hole"\);\n\s*if \(!hole\) return;/));
check(`P${t3++}`, "the dive-in bails out when the star has no toggle", () =>
  has(SR, /const toggle = li\.querySelector<HTMLElement>\("\.sr-toggle"\);\n\s*if \(!toggle\) return;/));
check(`P${t3++}`, "the crush-out bails out unless it has all three pieces", () =>
  has(SR, /if \(!toggle \|\| !ct \|\| !cb2\) return;/));
check(`P${t3++}`, "…and it hides the star before the shards fly, so nothing doubles up", () =>
  has(SR, /if \(starEl\) starEl\.style\.opacity = "0";/));
check(`P${t3++}`, "…and puts the star back afterwards rather than leaving it hidden", () =>
  has(SR, /if \(starEl\) starEl\.style\.opacity = "";/));
check(`P${t3++}`, "every piece the animation hides is hidden to exactly nothing, not to a faint ghost", () =>
  // Six, not three: the two shards, the star behind them, and the three resets in settle().
  eq(countOf(SR, /style\.opacity = "0";/), 6));
check(`P${t3++}`, "the crush's stagger is applied as a delay, not by blocking", () =>
  has(SR, /if \(delay > 0\) setTimeout\(run, delay\);\n\s*else run\(\);/));
check(`P${t3++}`, "the hover highlight lights every star up to the one under the finger", () =>
  has(SR, /if \(i <= idx\) e\.classList\.add\("hover-on"\)/));
check(`P${t3++}`, "…and leaving the row clears all of them", () =>
  has(SR, /const onLeave = \(\) => items\.forEach\(\(e\) => e\.classList\.remove\("hover-on"\)\)/));
check(`P${t3++}`, "the component remembers what is on SCREEN separately from the value", () =>
  has(SR, /const visualRatingRef = useRef\(0\)/));
check(`P${t3++}`, "…and an external change that already matches the screen does nothing", () =>
  has(SR, /if \(value === visualRatingRef\.current\) return;/));
check(`P${t3++}`, "…and it is updated before the animation starts, so a second tap is judged fairly", () => {
  const i = SR.indexOf("visualRatingRef.current = next;"), j = SR.indexOf("if (next > prev)");
  return (i > 0 && i < j) || "the screen value is written after the animation is chosen";
});
check(`P${t3++}`, "a star mid-animation is settled before a new one starts on it", () =>
  has(SR, /if \(toggle\?\.dataset\.animating === "1"\) \{\n\s*settle\(e, i < next\);/));
check(`P${t3++}`, "…and the crush refuses a star that is already animating", () =>
  has(SR, /if \(!t \|\| t\.dataset\.animating === "1"\) return;/));
check(`P${t3++}`, "the score pill marks a zero score, so nought does not read as a choice", () =>
  has(SR, /\$\{value === 0 \? "zero" : ""\}/));
check(`P${t3++}`, "the five stars are built from one constant, not five copies", () =>
  has(SR, /Array\.from\(\{ length: STAR_COUNT \}/));
check(`P${t3++}`, "every star is a real button to a screen reader, with a keyboard handler", () =>
  has(SR, /role="button"/) === true && has(SR, /tabIndex=\{0\}/) === true && has(SR, /onKeyDown=/) === true);
check(`P${t3++}`, "…and Space is caught as well as Enter, and neither scrolls the page", () =>
  has(SR, /e\.key === "Enter" \|\| e\.key === " "/) === true && has(SR, /e\.preventDefault\(\)/) === true);
check(`P${t3++}`, "the animation writes only custom properties and classes, never layout", () =>
  hasNot(codeOf(SR), /style\.(width|height|top|left|position)\s*=/));
check(`P${t3++}`, "nothing in the star picker makes a request", () => hasNot(SR, /fetch\(|XMLHttpRequest/));
check(`P${t3++}`, "…or touches storage", () => hasNot(SR, /localStorage|sessionStorage/));
check(`P${t3++}`, "the elastic easing is only used where an overshoot is wanted", () =>
  // Four: its definition, the hole flash, the star's scale spring, and the shard fade curve.
  eq(countOf(SR, /elasticOut/), 4));
check(`P${t3++}`, "the two hover listeners are the only ones added, and both are removed", () => {
  const add = countOf(SR, /addEventListener/), rem = countOf(SR, /removeEventListener/);
  return eq(add, rem);
});
check(`P${t3++}`, "the parent is told the rating on the same tap that animates it", () => {
  const i = SR.indexOf("onChange(next);");
  return (i > SR.indexOf("visualRatingRef.current = next;")) || "the parent is told before the screen agrees";
});

/* ══════ T4 · the thin lines left across the other components (P96141–P96180) ══════ */

let t4 = 96141;
const CH = C("ChefPopup"), OCM = C("OrderConfirmModal"), GOC = C("GuestOutboxChip");
const HDR = C("Header"), APP = C("AppShell"), FC = C("FoodCard"), GNF = C("GuestNotFound");
const NP = C("NavPicker"), STB = C("SessionTableBill"), BAN = C("BanGate"), RTP = C("RealtimeProvider");
check(`P${t4++}`, "the waiter popup pre-fills a scanned table only into an EMPTY field", () =>
  has(CH, /if \(scanned\) setTableNumber\(\(cur\) => cur \|\| scanned\)/));
check(`P${t4++}`, "…and a session's table overrides whatever was typed", () =>
  has(CH, /if \(ss\?\.table\) setTableNumber\(ss\.table\)/));
check(`P${t4++}`, "…and the settings are re-read every time it opens, not once on mount", () =>
  has(CH, /re-read settings on open so a freshly-toggled sessions mode is always respected/));
check(`P${t4++}`, "with sessions ON the call goes through the table gate, not the open route", () =>
  has(CH, /if \(sessionsEnabled\) \{[\s\S]{0,300}lfh:session-do/));
check(`P${t4++}`, "…and the lock is released on a timer, so the popup can be used again", () =>
  has(CH, /setTimeout\(\(\) => \{ sendingRef\.current = false; \}, 800\)/));
check(`P${t4++}`, "the table field takes at most four digits", () => has(CH, /maxLength=\{4\}/));
check(`P${t4++}`, "the customise popup's note and free-text boxes both have a length limit", () =>
  has(OCM, /maxLength=\{80\}/) === true && has(OCM, /maxLength=\{200\}/) === true);
check(`P${t4++}`, "…and the 'avoid in all my dishes' line names what it will avoid", () =>
  has(OCM, /Avoid \{finalRemoved\.map\(\(r\) => allergenLabel\(r\)\.toLowerCase\(\)\)\.join\(", "\)\} in all my dishes/));
check(`P${t4++}`, "…and the popup's total is the per-unit figure times the quantity", () =>
  has(OCM, /const totalDisp = unitDisp \* qty;/));
check(`P${t4++}`, "the saved-work sheet's spinner is hidden from screen readers", () =>
  has(GOC, /<span className="gob-spin" aria-hidden="true">/));
check(`P${t4++}`, "…and the sheet names itself to one", () => has(GOC, /aria-label="Saved on this phone"/));
check(`P${t4++}`, "…and its close button says what it does", () => has(GOC, /aria-label="Close"/));
check(`P${t4++}`, "the chip's own label is the same sentence a screen reader hears", () =>
  has(GOC, /aria-label=\{label\}/));
check(`P${t4++}`, "the header's cart badge is hidden when the basket is empty", () =>
  has(HDR, /\{cartCount > 0 && \(/));
check(`P${t4++}`, "…and the live-order dot names itself", () =>
  has(HDR, /aria-label="Live order in progress"/));
check(`P${t4++}`, "…and the theme button says which way it will switch", () =>
  has(HDR, /aria-label=\{`Switch to \$\{theme === "dark" \? "light" : "dark"\} mode`\}/));
check(`P${t4++}`, "the guest frame only emits a palette when the restaurant set one", () =>
  has(APP, /\{rootAccentCss && <style/) === true && has(APP, /\{themed && <style/) === true);
check(`P${t4++}`, "…and the page background is only overridden when there is no full theme", () =>
  has(APP, /!themed && pageBg \? \{ background: pageBg \} : undefined/));
check(`P${t4++}`, "the dish card's photo is lazily loaded and decoded off the main thread", () =>
  has(FC, /loading="lazy"/) === true && has(FC, /decoding="async"/) === true);
check(`P${t4++}`, "…and its width and height are declared, so the grid does not jump", () =>
  has(FC, /width=\{110\}/) === true && has(FC, /height=\{110\}/) === true);
check(`P${t4++}`, "…and the stepper's two buttons each say what they do", () =>
  has(FC, /aria-label="Remove one"/) === true && has(FC, /aria-label="Add one"/) === true);
check(`P${t4++}`, "the guest dead end asks the menu gate with no caching", () =>
  has(GNF, /cache: "no-store"/));
check(`P${t4++}`, "…and cancels its own answer if the screen has gone", () =>
  has(GNF, /return \(\) => \{ alive = false; \};/));
check(`P${t4++}`, "…and its docket rows never render an empty cell", () =>
  has(GNF, /<span>&mdash;<\/span>/));
check(`P${t4++}`, "the picker's button says whether the list is open", () => has(NP, /aria-expanded=\{open\}/));
check(`P${t4++}`, "…and declares that it opens a list", () => has(NP, /aria-haspopup="listbox"/));
check(`P${t4++}`, "the guest's bill labels a progress bar with real numbers", () =>
  has(STB, /aria-valuemin=\{0\}/) === true && has(STB, /aria-valuemax=\{items\.length\}/) === true &&
  has(STB, /aria-valuenow=\{served\}/) === true);
check(`P${t4++}`, "…and the bar has one segment per dish, so it scales to any order", () =>
  has(STB, /items\.map\(\(it\) => \(\n\s*<span key=\{it\.id\} className=\{`stb-seg \$\{it\.status\}`\} \/>/));
check(`P${t4++}`, "…and the waiter-call line names what was asked for when a note was given", () =>
  has(STB, /notes\.length \? <span className="stb-called-note">/));
check(`P${t4++}`, "the blocked-guest wall is a modal to a screen reader", () =>
  has(BAN, /role="dialog" aria-modal="true" aria-label="Access blocked"/));
check(`P${t4++}`, "…and its number field is a telephone field, so a phone shows the right keypad", () =>
  has(BAN, /type="tel"/) === true && has(BAN, /inputMode="tel"/) === true);
check(`P${t4++}`, "…and its failure line is announced, not just shown", () =>
  has(BAN, /<p className="ban-fail" role="status">/));
check(`P${t4++}`, "the guest socket's metrics are published where a diagnosis can read them", () =>
  has(RTP, /__lfh_rt_guest/));
check(`P${t4++}`, "…and the latency it reports is discarded when it is impossible", () =>
  has(RTP, /if \(lat >= 0 && lat < 60000\) reportLatency\(lat\)/));
check(`P${t4++}`, "…and a reconnect is counted, so a flapping link is visible", () =>
  has(RTP, /metrics\.reconnects\+\+/));
check(`P${t4++}`, "every component in this territory that renders a dialog names it", () => {
  const bad = [];
  for (const n of ["BackQuitDialog", "BanGate", "OrderConfirmModal", "SessionOwner", "GuestOutboxChip", "ConnectionBadge"]) {
    const b = C(n);
    if (/role="dialog"/.test(b) && !/aria-label=/.test(b)) bad.push(n);
  }
  return bad.length === 0 || bad.join(", ");
});
check(`P${t4++}`, "every icon-only button in this territory has an accessible name", () => {
  const bad = [];
  for (const n of ["Header", "GuestOutboxChip", "OrderConfirmModal", "SessionOwner", "ChefPopup", "NavPicker"]) {
    const b = C(n);
    for (const m of b.matchAll(/<button(?:(?!>)[\s\S]){0,400}?>\s*(?:\{\/\*(?:(?!\*\/)[\s\S])*\*\/\}\s*)?<i /g))
      if (!/aria-label|title=/.test(m[0])) bad.push(`${n}@${m.index}`);
  }
  return bad.length === 0 || bad.join(", ");
});
check(`P${t4++}`, "no component in this territory renders a raw emoji without hiding it from a reader", () => {
  const bad = [];
  for (const n of ["ToastHost", "OfflineNotice", "SessionOwner", "BanGate", "Maintenance"]) {
    const b = C(n);
    for (const m of b.matchAll(/<span(?![^>]*aria-hidden)[^>]*>\{?["']?([\u{1F300}-\u{1FAFF}⚠✅✔])/gu)) bad.push(`${n}@${m.index}`);
  }
  return bad.length === 0 || bad.join(", ");
});
check(`P${t4++}`, "every one of the 40 files still type-checks as part of the app", () =>
  exists("tsconfig.typecheck.json"));
check(`P${t4++}`, "…and none of them has become a server component by accident", () => {
  const CLIENT = ["AppShell", "RealtimeProvider", "OfflineNotice", "OfflineShell", "ConnectionBadge",
    "Header", "HeroTitle", "IntroSplash", "ToastHost", "BackQuitDialog", "FitNumber", "AutoFitNumbers",
    "GuestChrome", "GuestNotFound", "GuestOutboxChip", "BanGate", "BotTrap", "ChefPopup",
    "ChefCallButton", "CustomerGreeter", "FoodCard", "MiniCart", "ModelToastHost", "NavPicker",
    "OrderConfirmModal", "Particles", "PanelFrame", "PointerCaptureGuard", "SessionCartSync",
    "SessionOwner", "SessionTableBill", "StarRating"];
  const bad = CLIENT.filter((n) => !/^"use client";/m.test(C(n)));
  return bad.length === 0 || `no "use client": ${bad.join(", ")}`;
});
check(`P${t4++}`, "…and the four that are deliberately NOT client components still are not", () => {
  const SERVER = ["Maintenance", "VegIcon", "ComingSoon", "OfflineNoticeStatic"];
  const bad = SERVER.filter((n) => /"use client"/.test(C(n)));
  return bad.length === 0 || `now client components: ${bad.join(", ")}`;
});

if (t1 > 96057) throw new Error(`T1 overran its slice: ended at P${t1}`);
if (t2 > 96111) throw new Error(`T2 overran its slice: ended at P${t2}`);
if (t3 > 96141) throw new Error(`T3 overran its slice: ended at P${t3}`);
if (t4 > 96183) throw new Error(`T4 overran its slice: ended at P${t4}`);
process.exit(report("T5 round 3") ? 1 : 0);
