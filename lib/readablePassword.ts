// lib/readablePassword.ts — the ONE way this app makes a password a person will read and type.
//
// It was copied into six routes (the restaurant builder, the handover sheet, the per-person reveal
// door, People, Owners and the owner panel's staff screen). Six copies of a rule are six places for it
// to drift — one day a copy grows a lookalike letter and a printed handover sheet reads two ways.
// Consolidated by sweep #10 T29 round 2, item 15 (owner, 2026-10-12: "do all this rest of the things").
//
// The alphabet has no l, o, 0 or 1, so nothing on a printed sheet or read down a phone can be heard
// two ways. 32 letters, so `byte % 32` is perfectly even (256 is a multiple of 32) — no letter is more
// likely than another. Ten of them is 32^10 ≈ 1.1 × 10^15 possibilities.
export const READABLE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function readablePassword(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let s = "";
  for (const b of bytes) s += READABLE_ALPHABET[b % READABLE_ALPHABET.length];
  return s;
}
