// errorSignature — "is this the SAME problem we already dealt with?" (owner 2026-07-28, mig 218)
//
// The Repair console used to compare error messages character-for-character, so the same bug with
// a different order id in the text counted as a brand-new problem and alarmed again. This turns a
// raw message into a stable KEY by removing the parts that change between occurrences:
//
//   "invalid input syntax for type uuid: \"7f3a…\""      → "invalid input syntax for type uuid: <id>"
//   "<html><title>414 Request-URI Too Large</title>…"    → "414 request-uri too large"
//   "order 12345 not found"                              → "order <n> not found"
//
// Used by logError (should this occurrence alarm?), the Send-to-Claude guard (is this already
// fixed?) and the Repair page (group + label tiles). ONE definition so the three can't drift —
// that drift is what let the same problem look "new" to one surface and "known" to another.
//
// readableError() (below) is the sibling that fixes what is STORED and SHOWN, not just what is
// compared — see its own note.

/**
 * Turn a raw error message into something a person can read, without losing the signal.
 *
 * A gateway in front of the database (Cloudflare, in Supabase's case) answers a failed request
 * with a whole HTML PAGE rather than JSON, and supabase-js passes that page straight through as
 * `error.message`. So a database wobble was recorded — and pushed to the owner's phone, and used
 * as the title of the "Fix NOW" ticket — as hundreds of characters of markup beginning
 * `<!DOCTYPE html> <!--[if lt IE 7]>…`, which says nothing to anybody (2026-07-31: that is exactly
 * what the owner was shown for a Supabase 522).
 *
 * Everything such a page actually TELLS us is its <title> — "supabase.co | 522: Connection timed
 * out". The rest is Cloudflare boilerplate, so keeping the title keeps the whole signal; nothing
 * is hidden. Any message that is NOT an error page comes back untouched.
 */
export function readableError(msg: string | null | undefined): string {
  const s = String(msg ?? "");
  if (!/<html[\s>]/i.test(s) && !/<!doctype\s+html/i.test(s) && !/<title>/i.test(s)) return s;
  const title = s.match(/<title>([^<]*)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  // No <title> (a bare proxy page) → strip the tags so we still say something, never raw markup.
  const stripped = s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const what = title || stripped;
  const lead = "the server replied with an error page instead of data";
  return what ? `${lead}: "${what}"` : lead;
}

/**
 * The browser's own decoration on an error message, which says nothing about WHICH bug it is.
 *
 * ONE FAULT WAS SITTING ON THE REPAIR BOARD AS TWO TILES (T17 follow-up, 2026-08-20). The same
 * line of code, reported by two paths, arrives written two different ways:
 *
 *   window.onerror        → "Uncaught ReferenceError: PRINT_SETUP_URL is not defined"
 *   a caught error's .message → "PRINT_SETUP_URL is not defined"
 *
 * Character-for-character those differ, so the board counted them as two separate problems (one of
 * them ×8), the admin had to resolve both, and Fix-now could open two Claude sessions for one line.
 * `Uncaught`, `(in promise)` and the error CLASS are all added by the reporter, not by the bug: the
 * message text is what identifies it. Two different classes carrying the identical message text
 * cannot both be true of one line, so folding the class in loses nothing.
 *
 * Deliberately narrow: only a leading `<Something>Error:` is dropped, so a message that merely
 * MENTIONS an error type mid-sentence is untouched.
 */
const BROWSER_PREFIX = /^\s*(?:uncaught\s+)?(?:\(in\s+promise\)\s*:?\s*)?(?:[a-z]*error|domexception)\s*:\s*/i;

/** Strip the reporter's decoration, repeatedly (Safari sends "Uncaught (in promise) TypeError: …"). */
function stripBrowserPrefix(s: string): string {
  let out = s;
  // Bounded: two passes is enough for every shape seen, and a loop can't run away on a hostile string.
  for (let i = 0; i < 2; i++) {
    const next = out.replace(BROWSER_PREFIX, "");
    if (next === out) break;
    out = next;
  }
  // "Uncaught" on its own (no class) still has to go, e.g. "Uncaught SyntaxError" handled above,
  // but Firefox also sends a bare "uncaught exception: …".
  return out.replace(/^\s*uncaught(\s+exception)?\s*:?\s*/i, "").trim() || s.trim();
}

/** Normalise an error message into a comparable signature. Empty message → "" (never matches). */
export function errorSig(detail: string | null | undefined): string {
  let s = String(detail ?? "");
  if (!s.trim()) return "";

  // A proxy/gateway error arrives as a whole HTML page (Cloudflare's 414/502 pages, for example).
  // The <title> is the only stable part — the rest is markup and a request id.
  const looksHtml = /<html[\s>]/i.test(s) || /<title>/i.test(s);
  if (looksHtml) {
    const title = s.match(/<title>([^<]*)<\/title>/i)?.[1];
    // Fall back to stripping tags when there's no title, so we never key on raw markup.
    s = (title || s.replace(/<[^>]*>/g, " ")).trim();
  }

  // Drop the reporter's decoration BEFORE anything else, so "Uncaught ReferenceError: x is not
  // defined" and "x is not defined" become one problem instead of two tiles (see BROWSER_PREFIX).
  s = stripBrowserPrefix(s);

  // ONE FAULT IS ONE TILE WHICHEVER BROWSER REPORTED IT. /api/log/client-error stamps a short
  // browser tag on the end of the detail — " [Safari · iPhone]" — because without it a
  // Safari-only crash cannot be told from a Chrome one (two problems on the board were
  // unchaseable for exactly that reason). It must not reach the SIGNATURE: the browser is a fact
  // about the report, not about which bug it is, and leaving it in would split one fault into one
  // tile per browser — undoing the merge above with a different cause.
  s = s.replace(/\s*\[[^[\]]{0,40}\]\s*$/, "");

  return s
    .replace(/\s+/g, " ")                                                   // collapse newlines/indent
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>") // uuids
    .replace(/\b\d[\d.,:]*\b/g, "<n>")                                      // numbers, money, times
    .replace(/["'`]/g, "")                                                  // quoting varies by driver
    .trim()
    .toLowerCase()
    .slice(0, 160);                                                         // long tails add nothing
}

/** Does this error detail carry a whole HTML page rather than a message? */
export function looksLikeHtmlPage(detail: string | null | undefined): boolean {
  const s = String(detail ?? "");
  return /<!DOCTYPE\s+html/i.test(s) || /<html[\s>]/i.test(s);
}

/**
 * What the CLOSED row on the Repair board shows.
 *
 * readableError() above fixes this at the source, so rows recorded from now on are already
 * readable. This is the DISPLAY side, and it is still needed for two reasons: rows recorded
 * BEFORE that fix are in the database with the markup in them, and a closed row is one line of
 * 34px — so it also says the full text is one press away.
 *
 * It does no parsing of its own: the "what does this page actually say" part is readableError's
 * job, called here on the markup only. Two copies of that logic would drift, and this file exists
 * because drift is the bug.
 *
 * HIDES NOTHING: the open row still prints the captured text byte for byte, and what gets
 * recorded, grouped or alarmed is untouched.
 */
export function errorHeadline(detail: string | null | undefined): string {
  const s = String(detail ?? "");
  if (!looksLikeHtmlPage(s)) return s;
  // Whatever came before the markup is OURS and names the failing request ("GET summary — "), so
  // split there and hand only the markup to readableError.
  const at = s.search(/<!DOCTYPE\s+html|<html[\s>]/i);
  const prefix = (at > 0 ? s.slice(0, at) : "").trim();
  const markup = at >= 0 ? s.slice(at) : s;
  return `${prefix ? `${prefix} ` : ""}${readableError(markup)} — open it to read the whole page`;
}

/**
 * The visual group key the Repair page shows as one tile (panel + restaurant + action + signature).
 * Kept here next to errorSig so the tile the owner acts on and the memory row we write always
 * describe the same problem.
 */
export function errorGroupKey(row: {
  panel: string;
  restaurant_id?: string | null;
  action: string;
  detail?: string | null;
}): string {
  return `${row.panel}|${row.restaurant_id || ""}|${row.action}|${errorSig(row.detail)}`;
}
