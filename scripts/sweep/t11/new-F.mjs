// ⬛ NEW — T11 of sweep #8 · BANK F · P65341–P65370
// THE WORDS BOTH PRINTING BOARDS RENDER — lib/printBoardWords.ts.
//
// Uncovered ground: this file exists BECAUSE the admin console and the manager panel were "two
// different products describing one machine" (owner, 2026-08-27), and it is the single point where
// that can regress. One missing entry is a blank label on a screen a restaurant is setting a
// printer up from, and a blank label is the thing nobody notices until a client asks.
import { row, read } from "./lib.mjs";
const W = read("lib/printBoardWords.ts");
const HELPERS = read("lib/printHelpers.ts");
const BOARD = read("lib/printBoard.ts");
const ADMIN = read("app/aevinite/printing/page.tsx");
const PANEL = read("public/panels/editor/app.js");
let n = 65341;
const id = () => "P" + n++;
const R = (what, fn) => row(id(), what, fn);
/** the keys of an exported Record literal, read out of the source */
const keysOf = (name) => {
  const i = W.indexOf(`export const ${name}`);
  if (i < 0) return null;
  const open = W.indexOf("{", i), close = W.indexOf("\n}", open);
  return [...W.slice(open, close).matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
};
const ROUTABLE = ["kot", "bill", "banquet"];

R("the step headings are declared in ONE place, and both boards read them from there", () =>
  (/export const STEPS/.test(W) && /STEPS/.test(ADMIN) && /STEPS/.test(BOARD))
  || "a board has gone back to holding its own headings — that is what made the two screens 'not identical'");
R("…and every step heading carries its own number, so no screen has to add one", () => {
  const i = W.indexOf("export const STEPS");
  const seg = W.slice(i, W.indexOf("} as const", i));
  const vals = [...seg.matchAll(/:\s*"([^"]*)"/g)].map((m) => m[1]);
  const numbered = vals.filter((v) => /^\d · /.test(v));
  return numbered.length >= 4 || `only ${numbered.length} of ${vals.length} carry a number: ${vals.join(" | ")}`;
});
R("…and no two step headings claim the same number", () => {
  const i = W.indexOf("export const STEPS");
  const seg = W.slice(i, W.indexOf("} as const", i));
  const nums = [...seg.matchAll(/:\s*"(\d) · /g)].map((m) => m[1]);
  const dup = nums.filter((x, k) => nums.indexOf(x) !== k);
  return dup.length === 0 || `two headings called ${[...new Set(dup)].join(",")}`;
});
R("…and none of them asks which MECHANISM to use (there is no such choice)", () => {
  const i = W.indexOf("export const STEPS");
  const seg = W.slice(i, W.indexOf("} as const", i));
  return !/How does the paper come out|A computer.*A screen|which way/i.test(seg)
    || "a step is asking the question the toggle used to ask, and the toggle was deleted";
});
for (const key of ["KIND_LABEL", "KIND_WHAT", "KIND_OFF_LABEL"]) {
  R(`${key} is declared, and is the only place those words live`, () => {
    const ks = keysOf(key);
    return (ks && ks.length > 0) || `${key} is gone or unreadable`;
  });
}
for (const kind of ROUTABLE) {
  R(`every routable paper has a NAME a restaurant would use — ${kind}`, () => {
    const i = W.indexOf("export const KIND_LABEL");
    const seg = W.slice(i, W.indexOf("};", i));
    const m = new RegExp(`${kind}:\\s*"([^"]*)"`).exec(seg);
    return (m && m[1].trim().length > 2 && !/kot/i.test(m[1])) || `${kind} reads "${m && m[1]}" — "kot" means nothing to anybody outside this codebase`;
  });
  R(`…and a sentence saying what it IS — ${kind}`, () => {
    const i = W.indexOf("export const KIND_WHAT");
    const seg = W.slice(i, W.indexOf("};", i));
    const m = new RegExp(`${kind}:\\s*"([^"]*)"`).exec(seg);
    return (m && m[1].trim().length > 20) || `${kind} reads "${m && m[1]}"`;
  });
  R(`…and its own words for "nobody prints this" — ${kind}`, () => {
    const i = W.indexOf("export const KIND_OFF_LABEL");
    if (i < 0) return "KIND_OFF_LABEL is gone";
    const seg = W.slice(i, W.indexOf("};", i));
    const m = new RegExp(`${kind}:\\s*"([^"]*)"`).exec(seg);
    // the third one may fall back to "Nobody" at the call site, and that is written down
    return (m && m[1].trim()) ? true : (/Nobody/.test(ADMIN) || `${kind} has no off-label and no fallback`);
  });
}
R("the routable kinds are exactly the three real documents", () => {
  const m = /export const ROUTABLE_KINDS = \[([^\]]*)\]/.exec(HELPERS);
  const got = m ? [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]) : [];
  return JSON.stringify(got) === JSON.stringify(ROUTABLE) || `they are ${got.join(",")} — three documents exist, so three lines exist`;
});
R("…and 'test' is a kind of JOB but never a routable one", () => {
  const all = /export const PRINT_KINDS = \[([^\]]*)\]/.exec(HELPERS);
  const kinds = all ? [...all[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]) : [];
  return (kinds.includes("test") && !ROUTABLE.includes("test")) || `PRINT_KINDS is ${kinds.join(",")}`;
});
R("…and 'label' (parcel stickers) has not come back — nothing ever queued one", () => {
  const all = /export const PRINT_KINDS = \[([^\]]*)\]/.exec(HELPERS);
  return !(all && /"label"/.test(all[1])) || "a fifth empty line is back in the address book";
});
R("the paper presets are declared once, and each carries millimetres", () => {
  const i = W.indexOf("PAPER_PRESETS");
  if (i < 0) return "PAPER_PRESETS is gone";
  const seg = W.slice(i, i + 1400);
  const withMm = (seg.match(/wMm:\s*[\d.]+/g) || []).length;
  return withMm >= 2 || `${withMm} preset(s) carry a width in millimetres`;
});
R("…and a preset a person can read the name of", () => {
  // The field is `label`, not `name` (`name` is the PaperSize's own media name). My first version
  // asked for the wrong key and reported readable presets as unreadable.
  const i = W.indexOf("PAPER_PRESETS");
  const seg = W.slice(i, i + 1400);
  const labels = [...seg.matchAll(/label:\s*"([^"]*)"/g)].map((m) => m[1]);
  const unreadable = labels.filter((l) => l.trim().length < 3 || /^[a-z0-9_]+$/.test(l));
  return (labels.length >= 4 && unreadable.length === 0)
    || `${labels.length} preset label(s); unreadable: ${unreadable.join(", ") || "none"}`;
});
R("…and the banquet line offers no roll preset, and says where its size really lives", () =>
  /PAPER_ELSEWHERE/.test(W) && /PAPER_ELSEWHERE/.test(BOARD) || "the banquet paper's real home is no longer named");
R("the board sends its words to BOTH screens from this one file", () => {
  const admin = /from "@\/lib\/printBoardWords"/.test(ADMIN);
  const board = /from "@\/lib\/printBoardWords"/.test(BOARD);
  return (admin && board) || `admin reads it: ${admin}; the shared board reads it: ${board}`;
});
R("…and the manager panel renders the board's words rather than its own", () =>
  /steps|labels|KIND_LABEL|board\./.test(PANEL) || "the manager panel has gone back to its own vocabulary");
R("no board word contains a machine token a person would not recognise", () => {
  const strings = [...W.matchAll(/:\s*"([^"]{4,})"/g)].map((m) => m[1]);
  const bad = strings.filter((s) => /\bkot\b|restaurant_id|print_jobs|auto_print|undefined|null/.test(s));
  return bad.length === 0 || `${bad.length}: ${bad.slice(0, 2).join(" | ")}`;
});
R("…and none of them is left empty", () => {
  const empties = [...W.matchAll(/^\s*([a-z_]+):\s*""/gm)].map((m) => m[1]);
  return empties.length === 0 || `empty: ${empties.join(", ")}`;
});
R("…and none of them names a control that was deleted", () => {
  // THE WORDS, not the prose. "both" is an ordinary English word — this file uses it in "they can
  // safely live on both sides" — and my first version read that as the retired third print target.
  // So the question is asked of the STRINGS the screens render, and of the retired control's real
  // names.
  const strings = [...W.matchAll(/:\s*"([^"]{3,})"/g)].map((m) => m[1]).join(" ｜ ");
  const bad = [];
  for (const g of ["kot_print_target", "Which screen prints the ticket", "the toggle below picks one",
    "the counter is the backup", "both — the counter"]) {
    if (strings.includes(g)) bad.push(g);
  }
  if (/\bboth\b/i.test(strings) && /counter|backup|screen prints/i.test(strings)) bad.push('a "both" print target');
  return bad.length === 0 || bad.join(", ");
});
R("paperLabel turns a size into something readable, and is shared", () =>
  /export (const|function) paperLabel/.test(W) && /paperLabel/.test(ADMIN) || "each screen formats a paper size its own way again");
R("the board's own state names how long is too long, once", () => {
  const uses = (BOARD.match(/STUCK_AFTER_MS/g) || []).length;
  return uses >= 1 && /afterMs/.test(BOARD) || "the threshold is not sent to the screens";
});
R("…and the pile-up count it sends is kitchen slips only, deliberately", () =>
  /waitingToPrint\(rid, "kot"\)/.test(BOARD) || "a bill waiting two seconds for somebody to press Print would read as a pile-up");
R("…and the board holds no gate of its own, because every caller already has one", () => {
  // Read the CODE for a gate, and the PROSE for the note. The note itself names tokenIsValid and
  // requireRole while explaining that the CALLERS hold them — which my first version read as the
  // board holding a gate.
  const stated = /holds no gate of its own/i.test(BOARD);
  const code = BOARD.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const gated = /\b(tokenIsValid|requireRole|managerCan)\s*\(/.test(code);
  return (stated && !gated) || `the note is there: ${stated}; the board itself gates: ${gated}`;
});
R("the board reads everything it needs in ONE set of queries", () => {
  const i = BOARD.indexOf("export async function printBoardState");
  const seg = BOARD.slice(i, BOARD.indexOf("\n}", i));
  return /Promise\.all/.test(seg) || "the board makes its reads one after another, on a poll";
});
R("…and every one of those reads is scoped and capped", () => {
  const i = BOARD.indexOf("export async function printBoardState");
  const seg = BOARD.slice(i, BOARD.indexOf("\n}", i));
  const froms = [...seg.matchAll(/sb\.from\("([a-z_]+)"\)/g)].map((m) => m[0]);
  const unscoped = froms.length && !/\.eq\("restaurant_id", rid\)/.test(seg);
  return !unscoped || "a board read is not scoped to the restaurant";
});
R("…and the 'this computer' answer comes from the device's own id, not from a name", () =>
  /agentForDevice/.test(BOARD) || "the board no longer answers 'is THIS computer set up?' from the device id");
