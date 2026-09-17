// T33 round 2 — ONE id allocator for all four blocks.
//
// WHY THIS EXISTS. Each block used to start at a hard-coded id, so the moment one block produced a
// row more or a row fewer — which happens whenever the TERRITORY changes, since B and C are
// generated per function and per file — every later block's start had to be nudged by hand, and a
// missed nudge is an id collision. That happened twice in one afternoon: once when migration 396
// added a file (block C grew by one) and once when migration 397 split a realtime probe in two.
//
// Ids now come from this allocator in the order the blocks run. The bands are this terminal's OWN:
// round 1's unspent remainder, then its pre-allocated round-2 block from LEDGER/INDEX.md. Nothing
// is ever claimed from the *Next free ID* line — the half of the rule that registry has recorded
// nine collisions over.
const BANDS = [
  [104851, 104900],   // round 1's remainder, contiguous and unspent
  [152001, 153000],   // T33's pre-allocated round-2 block
];
let band = 0, cur = BANDS[0][0];
export function nextId() {
  while (band < BANDS.length && cur > BANDS[band][1]) { band++; cur = band < BANDS.length ? BANDS[band][0] : cur; }
  if (band >= BANDS.length) throw new Error("T33 has exhausted BOTH of its own id bands — STOP and say so in the report; do not take another terminal's range");
  return `P${cur++}`;
}
export const spent = () => {
  const out = [];
  let b = 0, c = BANDS[0][0];
  for (;;) {
    if (b > band || (b === band && c >= cur)) break;
    out.push(c);
    c++;
    if (c > BANDS[b][1]) { b++; if (b >= BANDS.length) break; c = BANDS[b][0]; }
  }
  return out;
};
