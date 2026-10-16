// lib/digits.ts — a digit is a digit, in any script (sweep #10 T3, round 4, item 43).
//
// A phone's number pad does not always type 0–9. An iPhone set to an Arabic region types ٠١٢٣, Gboard with
// "native digits" on types ०१२३ in Hindi and ૦૧૨૩ in Gujarati, and a Japanese/Chinese keyboard can type
// full-width ０１２３. The guest's table boxes used to keep only `/\d/` — which in JavaScript is 0–9 and
// nothing else — so on such a phone every key the diner pressed was thrown away and the box stayed empty:
// no error, no number, no way to order or call a waiter.
//
// toAsciiDigits() turns every decimal digit Unicode knows (category Nd) into its 0–9 twin. Unicode encodes
// each script's digits as one unbroken run of ten, zero first, and lays runs end to end, so a digit's value
// is its distance from the start of its stretch of digits, mod 10 — no table of scripts to keep up to date.
const ND = /\p{Nd}/u;
export function toAsciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (d) => {
    const cp = d.codePointAt(0) as number;
    if (cp >= 0x30 && cp <= 0x39) return d;
    let start = cp;
    while (start > 0 && ND.test(String.fromCodePoint(start - 1))) start--;
    return String((cp - start) % 10);
  });
}

/** What a table box keeps of what was typed: its digits, written 0–9. */
export const keepDigits = (s: string): string => toAsciiDigits(s).replace(/\D/g, "");
