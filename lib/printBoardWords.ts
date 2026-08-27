// lib/printBoardWords.ts — the WORDS of the printing board, and nothing else.
//
// Split out of lib/printBoard.ts so the admin console (a client component) and the server can import
// the SAME sentences. printBoard.ts pulls in the service-role client; a "use client" page that
// imported it would drag the server key's module into the browser bundle. Words have no dependencies,
// so they can safely live on both sides — which is the only way "the two screens say the same thing"
// stays true as the text changes.
/** The paper a printer is loaded with, in millimetres.
 *
 *  It is DECLARED here rather than in lib/printHelpers.ts, and that is not an accident: this file
 *  must have no imports at all, because the admin console is a "use client" component and anything
 *  it imports lands in the browser bundle. printHelpers reaches the service-role client, so one
 *  `import type` from it was enough to make verify:static refuse the whole page. printHelpers
 *  re-exports this type, so every file that already imports PaperSize from printHelpers is
 *  untouched. */
export type PaperSize = { name?: string; wMm: number; hMm: number };

/** The four questions, in the order a person asks them. Both screens print these verbatim as their
 *  card headings — that is the whole point of them living in one file. */
export const STEPS = {
  one:   "1 · Is printing switched on",
  two:   "2 · The computers that can print",
  three: "3 · Which printer gets which paper",
  four:  "4 · What has printed",
} as const;

/** The restaurant's words, never ours. "kot" means nothing to anybody outside this codebase. */
export const KIND_LABEL: Record<string, string> = {
  kot: "Kitchen slips", bill: "Bills", banquet: "Banquet sheets", test: "Test page",
};

export const KIND_WHAT: Record<string, string> = {
  kot: "One slip per order, printed by itself the moment a waiter sends it. This is the one that must never wait.",
  bill: "What the guest is handed when they pay. Printed when somebody presses Print.",
  banquet: "The big event sheet — usually a paper printer, not a till roll.",
  test: "A page with today's date on it, to prove a printer works.",
};

/** THE THIRD ANSWER, worded honestly per kind — because "nobody prints it" means two different
 *  things. A kitchen slip is printed BY ITSELF, so switching it off really is "no slip comes out".
 *  A bill is printed by a person pressing a button, so switching the route off does not stop the
 *  bill: it stops a PRINTER doing it silently, and the ordinary print window opens instead. Saying
 *  "nobody" on the bill line would be a lie, and a screen that lies once is never trusted again. */
export const KIND_OFF_LABEL: Record<string, string> = {
  kot: "Nobody — do not print kitchen slips",
  bill: "Whoever presses Print (a window opens)",
  banquet: "Whoever presses Print (a window opens)",
};

/** Common sheets, so nobody has to know that A6 is 105 × 148. "As the printer says" is first because
 *  it is right almost always: the machine reads its own paper out of its own driver. */
export const PAPER_PRESETS: { id: string; label: string; paper: PaperSize | null }[] = [
  { id: "auto", label: "As the printer says", paper: null },
  { id: "roll80", label: "80mm till roll", paper: { wMm: 79.7, hMm: 64.2 } },
  { id: "roll58", label: "58mm till roll", paper: { wMm: 57.8, hMm: 64.2 } },
  { id: "a4", label: "A4 · 210 × 297", paper: { wMm: 210, hMm: 297 } },
  { id: "a5", label: "A5 · 148 × 210 (half of A4)", paper: { wMm: 148, hMm: 210 } },
  { id: "a6", label: "A6 · 105 × 148 (quarter of A4)", paper: { wMm: 105, hMm: 148 } },
];

export const paperLabel = (p?: PaperSize | null) => (p ? `${p.wMm} × ${p.hMm} mm` : "as the printer says");

/** WHO PRINTS THIS PAPER — one question, three answers, and that is the whole address book now.
 *  It replaces six controls a line (two shape buttons, a computer, a printer, a paper size, and two
 *  more for the backup) with one segmented switch and whatever that answer needs. */
export const WHO_CHOICES = [
  { id: "computer", label: "A computer" },
  { id: "screen", label: "A screen (a person)" },
  { id: "off", label: "Nobody" },
] as const;

