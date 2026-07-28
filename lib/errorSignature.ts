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
