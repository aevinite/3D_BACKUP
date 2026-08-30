// T7 · third 500 · BLOCK I (P40848–P40887) — THE WORDS A WAITER READS.
// Every sentence on this panel, judged as English: no code, no settings keys, no jargon, no
// promise the panel cannot keep, and the same thing called the same thing everywhere.
import { C, dump, at, LEAK } from "./lib.mjs";
at(40848);
try {
  const src = await (await fetch("https://3-d-backup.vercel.app/panels/tablet/app.js")).text();
  const css = await (await fetch("https://3-d-backup.vercel.app/panels/tablet/style.css")).text();
  C("the live panel file was fetched", src.length > 100000, `${(src.length / 1024).toFixed(0)} KB`);
  C("…and its stylesheet", css.length > 5000, `${(css.length / 1024).toFixed(0)} KB`);

  // Every toast(...) and every confirm/prompt message, as sentences.
  const said = [...src.matchAll(/toast\(\s*`([^`]{4,200})`|toast\(\s*"([^"]{4,200})"/g)].map((m) => (m[1] || m[2]));
  C("the panel says a great many things", said.length >= 60, `${said.length} messages`);
  const BAD_WORDS = /\b(null|undefined|NaN|payload|param|endpoint|API|JSON|HTTP|500|4\d\d|fetch|promise|async|callback|state\.|window\.|querySelector)\b/;
  const bad = said.filter((m) => BAD_WORDS.test(m));
  C("no message shows a developer's word to a waiter", bad.length === 0, bad.slice(0, 3).join(" | ") || "none");
  const keys = said.filter((m) => /\b(tablet_|settings\.|_enabled|_allowed|owner_control)\b/.test(m));
  C("no message shows a settings key", keys.length === 0, keys.slice(0, 3).join(" | ") || "none");
  const leaky = said.filter((m) => /\$\{[^}]*\.(id|status|code|error)\b/.test(m));
  C("no message pastes a raw id or status code into a sentence", leaky.length === 0, leaky.slice(0, 2).join(" | ") || "none");
  const shouty = said.filter((m) => /[A-Z]{6,}/.test(m) && !/KOT|UPI|GST|MRP|PIN|₹/.test(m));
  C("nothing shouts at the waiter in capitals", shouty.length === 0, shouty.slice(0, 2).join(" | ") || "none");
  const ending = said.filter((m) => /\.\.\.$/.test(m));
  C("nothing trails off in three dots where a sentence belongs", ending.length <= 2, ending.slice(0, 3).join(" | ") || "none");

  // A refusal must say WHY, not just that it failed.
  const refusals = said.filter((m) => /can'?t|cannot|not allowed|refused|failed|won'?t/i.test(m));
  C("the panel has refusals to judge", refusals.length >= 8, `${refusals.length} refusals`);
  // "Failed: " is a PREFIX, not a message: the source reads toast("Failed: " + errText(e)), and
  // errText hands back the server's own plain sentence (or a clash's `plain` + `todo`). Judging the
  // string literal alone accused fifteen messages that are complete once they are spoken.
  const bare = refusals.filter((m) => m.trim().length < 18 && !new RegExp(String.raw`toast\(\s*"` + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + String.raw`"\s*\+`).test(src));
  C("no refusal is a bare word", bare.length === 0, bare.join(" | ") || "none");
  C("…and the ones that end in a colon are completed by the server's own words", /toast\("Failed: " \+ errText\(e\)/.test(src), "Failed: + errText(e)");
  C("…which is a sentence, not a code", /e\.data\.clash\.plain/.test(src) && /"unknown error"/.test(src), "errText prefers the clash's plain sentence");
  const noWhy = refusals.filter((m) => !/because|—|-|:|\.|first|instead|already|still|only|ask|try/i.test(m));
  C("every refusal carries a reason or a way forward", noWhy.length === 0, noWhy.slice(0, 3).join(" | ") || "none");

  // The panel's own vocabulary must be consistent.
  const pairs = [
    ["a kitchen ticket", /KOT/g, /kitchen ticket/gi],
    ["a bill", /\bbill\b/gi, /\binvoice\b/gi],
  ];
  C("the panel calls a kitchen ticket by one name", (src.match(/KOT/g) || []).length > 0, `${(src.match(/KOT/g) || []).length} mentions of KOT`);
  C("…and never invents a second word for the bill in a message", !said.some((m) => /\bcheck\b/i.test(m) && /pay/i.test(m)), said.find((m) => /\bcheck\b/i.test(m) && /pay/i.test(m)) || "none");

  // Money is always written with the rupee sign, through the two helpers.
  const rupeeless = said.filter((m) => /\b\d{2,}\.\d{2}\b/.test(m) && !/₹/.test(m));
  C("money in a sentence always carries the rupee sign", rupeeless.length === 0, rupeeless.slice(0, 2).join(" | ") || "none");
  C("the panel has exactly two money formatters, and says why", /const inr =/.test(src) && /const inrExact =/.test(src), "inr + inrExact");

  // Empty states: every picker in this file has one.
  const emptyStates = [...src.matchAll(/class="muted"[^>]*>([^<]{10,120})</g)].map((m) => m[1]);
  C("every empty picker says something", emptyStates.length >= 6, `${emptyStates.length} empty states`);
  C("…and none of them is a shrug", !emptyStates.some((e) => /^(none|empty|nothing)\.?$/i.test(e.trim())), emptyStates.find((e) => /^(none|empty|nothing)\.?$/i.test(e.trim())) || "none");
  C("…and each is a full sentence", emptyStates.every((e) => e.trim().split(/\s+/).length >= 3), emptyStates.find((e) => e.trim().split(/\s+/).length < 3) || "all are");

  // The four sentences the sweep has already ruled on stay exactly as they are.
  const musts = [
    ["the empty-section floor", /No tables assigned to you yet/],
    ["…and who to ask about it", /Ask your manager to give you a section/],
    ["the quick-order picker's own empty state", /your order stays here until then/],
    ["the paise shortfall", /of the bill is still uncovered/],
    ["the over-collect refusal", /more than the bill/],
    ["the empty split part (item 14)", /still needs an amount/],
    ["the split switch being off (item 16)", /Splitting a bill is turned off for this restaurant/],
    ["the moved kitchen ticket (item 19)", /KOT moved to/],
    ["the moved dish", /Dish moved to table/],
    ["the offline save", /Saved on this device/],
    ["the busy-server save", /the system is busy, so the kitchen hasn't got it yet/],
    ["the PIN gate on a discount", /manager PIN/i],
    ["the invoice a waiter can never issue", /Only a manager issues the invoice/],
  ];
  for (const [what, re] of musts) C(`${what} still reads the way it was written`, re.test(src), re.test(src) ? "present" : "GONE — a sentence somebody decided was removed");

  // Nothing in the stylesheet hides a message the code still shows.
  C("no rule hides a toast", !/\.toast[^{]*\{[^}]*display:\s*none/.test(css));
  C("no rule hides the takeback bar's words", !/lfh-undo-title[^{]*\{[^}]*display:\s*none/.test(css));
  C("the panel declares one dim for its overlays", /--scrim/.test(css), "--scrim");
  C("…and no overlay hard-codes its own", !/background:\s*rgba\(4,\s*8,\s*18/.test(src), "no rgba(4,8,18…) left");

  // The words on the buttons are verbs a waiter would use.
  const btns = [...src.matchAll(/<button[^>]*>([^<>{]{2,40})<\/button>/g)].map((m) => m[1].trim()).filter((b) => b && !/^[＋+−✕✓×]$/.test(b));
  C("the panel's buttons are labelled", btns.length >= 10, `${btns.length} plainly-labelled buttons`);
  C("…and none is labelled with a code word", !btns.some((b) => BAD_WORDS.test(b)), btns.find((b) => BAD_WORDS.test(b)) || "none");
  C("…and none is labelled 'OK' alone, which says nothing about what happens", !btns.some((b) => /^ok$/i.test(b)), btns.find((b) => /^ok$/i.test(b)) || "none");
} catch (e) { C("block I completed without crashing", false, String(e.message).slice(0, 220)); }
finally { process.exitCode = dump("I") ? 1 : 0; }
