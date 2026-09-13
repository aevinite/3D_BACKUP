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
/**
 * The steps, in the order a person walks them.
 *
 * The LAST one is numbered by the caller, not here: choosing "a computer" adds a step (the machine,
 * then its printers) that choosing "a screen" does not, so the log is step 5 one way and step 4 the
 * other. Hard-coding "4 ·" put two cards called 4 on the same screen (2026-08-29).
 */
// FOUR STEPS, AND NONE OF THEM IS A CHOICE OF MECHANISM (owner, 2026-08-31 — *"we don't need
// toggle"*). Step 2 used to be "How does the paper come out?", the two big buttons. There is nothing
// to ask: a computer prints if one is set up, and the kitchen screen prints the slips when none is.
// So the steps are now the things a person actually DOES, in the order they do them.
//
// ── AND THE ADMIN BOARD NOW SHOWS ONE WAY AT A TIME (owner, 2026-09-13) ───────────────────────
// *"on top of printer there should be 2 menu — one for screen printing by chrome kiosk and one for
// helper, and they should have colour of red or green according to they are on and off."*
// Step 2 is that pair of cards. It is NOT the old mechanism toggle coming back and it stores
// nothing: both ways can read GREEN at the same time (a computer on the bills, the kitchen screen
// on the slips), because each card only REPORTS what the paper lines already decided. What it
// changes is which setup is on screen underneath — the "you only see the option you have selected"
// half of his 2026-08-28 ask, which survived the toggle being deleted.
//
// Numbers 3 and 4 therefore appear TWICE across the two ways, never on screen together. The
// manager's own board (public/panels/editor/app.js) is still one stacked list and hard-codes its
// own numbers, so it is untouched by this.
//
// ── AND THEN THE NUMBERS CAME OFF (owner, 2026-09-13, second pass) ────────────────────────────
// *"I want proper menu change on very top… I want menu at top, completely different menu."* The two
// ways are now a MENU above everything, so the cards under it are that one way's setup and nothing
// else — two cards deep, not a numbered walk through five. A number that restarts inside each tab
// teaches nothing, and a number that runs 1→5 across two tabs is wrong on one of them.
//
// `one` and `four` are still NUMBERED and still shared: the MANAGER's board (public/panels/editor/
// app.js) is one stacked list and hard-codes the rest of its own numbers, so it is untouched by
// this. Guarded — verify:print-helper asserts the panel prints `1 · Is printing switched on`.
export const STEPS = {
  one:   "1 · Is printing switched on",
  two:   "The computer that prints",
  three: "Which printer gets which paper",
  four:  "What has printed",
  // The kitchen screen needs no switching on, so its card is a statement and a file, not a step
  // with a decision in it.
  screen: "Whose screen prints the kitchen slips",
} as const;

/**
 * THE TWO WAYS PAPER COMES OUT, in the words a person would use — the top of the admin board.
 *
 * One sentence each, and neither is "better": a restaurant with a printer plugged into a back-office
 * PC wants the helper; a restaurant with one screen in the kitchen and no spare machine wants the
 * screen. The ON/OFF colour beside each is DERIVED from the paper lines (never stored), so nothing
 * here can disagree with what actually prints — that was the whole reason the stored mode was
 * deleted in the first place.
 */
export const WAYS = {
  computer: {
    title: "A computer prints",
    tag: "the helper",
    what: "A small helper program on the computer the printer is plugged into. It prints by itself — no window opens, nobody has to be signed in, and each kind of paper can have its own printer.",
    onWhat: "A computer is named for the paper below, so that machine prints it.",
    offWhat: "No computer is named for any paper yet.",
  },
  screen: {
    title: "A screen prints",
    tag: "Chrome, out of the way",
    what: "The restaurant's own Chrome, opened out of the way with silent printing switched on. Nothing is installed, and it only ever prints the kitchen slips.",
    onWhat: "The kitchen slips come out of a screen.",
    offWhat: "No screen is printing the kitchen slips.",
  },
} as const;

export type WayId = keyof typeof WAYS;

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
/**
 * What "the helper does NOT take this one" means, per paper — in the words the owner used on
 * 2026-08-29: *"if only KOT selected, other other two will print normally by tabbing on it."*
 *
 * They are not the same sentence, and that is the point. A bill or a banquet sheet has somebody
 * standing there who pressed Print, so "normal" means the window opens for them. A kitchen slip has
 * nobody — it prints because an order arrived — so the only other answer is that it does not print
 * by itself at all.
 */
export const KIND_OFF_LABEL: Record<string, string> = {
  kot: "Nobody — kitchen slips do not print by themselves",
  bill: "Normal — a window opens when somebody taps Print",
  banquet: "Normal — a window opens when somebody taps Print",
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

/**
 * The paper sizes a given kind can ACTUALLY be told to use — and for the banquet sheet there are
 * none, which is the honest answer rather than a missing one.
 *
 * A kitchen slip and a bill are laid out TO the width they are given: `withPaper` sets the page size
 * and narrows and centres the column on the print head, so every size in the list does something.
 *
 * A banquet sheet is not. `banquetDocHtml` draws it at exactly two sizes, A4 or A5, and it chooses
 * between them from the RESTAURANT'S OWN setting — `settings.banquet_paper_size`, set on the Banquet
 * screen next to the margins and the signature line. Because it declares that page size itself,
 * `withPaper` returns it untouched. So the paper dropdown on the Banquet line of the Printing screen
 * reached no code at all: whatever was chosen, the sheet came out at whatever the Banquet screen
 * said. Found by the printing sweep, 2026-08-29 — the sweep asked for A6 and measured an A5 sheet.
 *
 * Two places to set one thing, one of them a no-op, is worse than one place. So the Printing screen
 * stops asking, and says where the answer lives instead. Do not "restore" this dropdown without
 * first making the document able to obey it.
 */
export const papersFor = (kind: string) => (kind === "banquet" ? [] : PAPER_PRESETS);

/** Shown where the paper dropdown used to be, for the kind that has no paper to choose here. */
export const PAPER_ELSEWHERE: Record<string, string> = {
  banquet: "The banquet sheet's size (A4 or A5) is set on the Banquet screen, with its margins — not here.",
};

export const paperLabel = (p?: PaperSize | null) => (p ? `${p.wMm} × ${p.hMm} mm` : "as the printer says");

/** WHO PRINTS THIS PAPER — one question, three answers, and that is the whole address book now.
 *  It replaces six controls a line (two shape buttons, a computer, a printer, a paper size, and two
 *  more for the backup) with one segmented switch and whatever that answer needs. */
export const WHO_CHOICES = [
  { id: "computer", label: "A computer" },
  { id: "screen", label: "A screen (a person)" },
  { id: "off", label: "Nobody" },
] as const;


// ── HOW LONG, AND WHEN — the two time sentences every printing screen prints ──────────────────
//
// Owner, 2026-09-13, looking at a board that said "Nothing has come out for 4 hours" over a list of
// slips he thought were three or four days old: *"it tells 4hr maybe it's been 3,4 day and all it
// only show time."* Both halves of that were real faults:
//
//  1. THE AGE STOPPED AT HOURS. Every copy of the wording ended `Math.round(ms / 3600000) + " hours"`,
//     so a queue stuck since Tuesday read "76 hours" — a number nobody converts in their head — and
//     a board read at a glance looks like a morning's backlog rather than a dead printer.
//  2. THE LOG SHOWED A CLOCK AND NO DAY. "07:14 am" is the same nine characters whether the ticket
//     is from this morning or last week, so the one table you read to answer "when did this stop"
//     could not tell those apart. A time with no day is not a timestamp.
//
// Declared HERE because this file has no imports — the server, the admin console (a client
// component) and anything else on the TS side share these exact words. The two panel files
// (public/panels/editor/app.js, public/panels/kitchen/app.js) are plain browser scripts that cannot
// import, so they carry their own copies of the same shape; if you change the thresholds here,
// change them there in the same commit, and keep this file named in their comments.
const IST = "Asia/Kolkata";

/**
 * HOW LONG SOMETHING HAS BEEN WAITING, in a sentence: "under a minute", "14 minutes", "4 hours",
 * "3 days". Never a bare hour count past a day — the day is what makes a person act.
 */
export function waitedWords(ms: number | null | undefined): string {
  const n = Number(ms || 0);
  if (!n || n < 0) return "";
  if (n < 60_000) return "under a minute";
  if (n < 3_600_000) return `${Math.round(n / 60_000)} minutes`;
  if (n < 86_400_000) return `${Math.round(n / 3_600_000)} hours`;
  const d = Math.round(n / 86_400_000);
  return d === 1 ? "a whole day" : `${d} days`;
}

/** The same fact where there is only room for a few characters (the all-restaurants list). */
export function waitedShort(ms: number | null | undefined): string {
  const n = Number(ms || 0);
  if (!n || n < 0) return "";
  if (n < 60_000) return "under a minute";
  if (n < 3_600_000) return `${Math.round(n / 60_000)} min`;
  if (n < 86_400_000) return `${Math.round(n / 3_600_000)}h`;
  return `${Math.round(n / 86_400_000)}d`;
}

/**
 * WHEN A JOB HAPPENED — a clock for today, a DAY as well for anything older.
 *
 * Always Asia/Kolkata, like the bill, the kitchen ticket and the banquet sheet (the fault fixed on
 * this log on 2026-09-04): the restaurant's day is the only day that means anything, and the
 * reader's laptop may be anywhere. The day boundary is compared in that zone too — comparing
 * against the browser's midnight is how a 1 am ticket ends up labelled "Yesterday" in Mumbai.
 */
export function whenWords(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: IST });
  // en-CA is YYYY-MM-DD, which sorts and compares as a plain string — the calendar day in IST.
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: IST });
  const that = day(d), today = day(now);
  if (that === today) return time;
  if (that === day(new Date(now.getTime() - 86_400_000))) return `Yesterday · ${time}`;
  const sameYear = that.slice(0, 4) === today.slice(0, 4);
  return `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: IST })} · ${time}`;
}
