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
 * A READABLE one-line version of an error detail, for the collapsed row on the Repair board.
 *
 * When a gateway or proxy fails it answers with an entire HTML page, so the detail we captured
 * starts "GET summary — <!DOCTYPE html> <!--[if lt IE 7]> …". Collapsed to one line that told the
 * owner nothing except that markup was involved — the useful part ("502 Bad Gateway") sits a
 * hundred characters further in.
 *
 * This HIDES NOTHING: it is only what the CLOSED row shows, the open row still prints the captured
 * text byte for byte, and nothing about which errors are recorded or alarmed changes. Unlike
 * errorSig this keeps the real case and the real numbers, because a person reads it.
 */
export function errorHeadline(detail: string | null | undefined): string {
  const s = String(detail ?? "");
  if (!looksLikeHtmlPage(s)) return s;
  // Whatever came before the markup is ours and worth keeping ("GET summary — "). Split there, and
  // strip tags from the MARKUP ONLY: stripping the whole string printed the prefix twice.
  const at = s.search(/<!DOCTYPE\s+html|<html[\s>]/i);
  const prefix = (at > 0 ? s.slice(0, at) : "").trim();
  const markup = at >= 0 ? s.slice(at) : s;
  const title = markup.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  const stripped = markup.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const body = title || stripped.slice(0, 120) || "an HTML error page";
  return `${prefix ? `${prefix} ` : ""}${body} (an HTML error page — open it to read the whole thing)`;
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
