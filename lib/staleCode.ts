// staleCode — "part of the app didn't arrive": recover from it instead of crashing on it.
//
// WHAT THIS IS. The app is served as many small JavaScript files ("chunks") whose names carry a
// content hash — `/_next/static/chunks/1g1jwpgiikpwc.js`. A deploy gives every changed file a NEW
// name and removes the old one. A tab that was already open is still holding the OLD names, so the
// moment it lazily imports one it asks the server for a file that no longer exists, and Turbopack
// throws:
//
//   Failed to load chunk /_next/static/chunks/1g1jwpgiikpwc.js from module 64893
//
// WHY IT NEEDED FIXING (Fix-NOW ticket 2026-09-12). That throw reaches a React error boundary, so
// the person was shown "Something went wrong" — and the boundary's own "Try again" button calls
// `reset()`, which re-renders the SAME tree and asks for the SAME dead filename. It could never
// work for this one error, so the only real way out was for the person to know to reload by hand.
// `lib/plainError.ts` has said so in words for weeks ("Reloading the page fixes it"); nothing ever
// did it. It was the most common error row on the board, on every panel at once, because a deploy
// hits every open tab.
//
// NOTHING IS HIDDEN. The crash is still reported to the Everything Log exactly as before, with the
// same text, so the row, its grouping and its count are unchanged — the reporter uses `sendBeacon`,
// which is specified to survive the unload, so the report still lands even though we reload out
// from under it. The only thing that changes is that the person gets a working screen instead of a
// dead end. (Suppressing an error is a standing no — owner 2026-07-28. This suppresses nothing.)
//
// THREE THINGS KEEP IT FROM BECOMING A RELOAD LOOP:
//   · ONE automatic reload per tab per minute. A loop would repeat within a second or two, so the
//     second failure falls straight through to the normal error card and is shown, not retried.
//   · Only when the browser says it is online. Offline, a reload cannot fetch the missing file, so
//     retrying would just churn; the offline layer's own screens are the right answer there.
//   · A module-level latch as well as the stored stamp, so React's development double-render and
//     two boundaries firing at once still produce exactly one reload.
//
// KNOWN LIMIT, stated rather than papered over: the service worker answers a navigation from its
// saved copy of the page when the network stalls for more than 6s (`NAV_TIMEOUT_MS` in
// `public/sw.js`). If the connection is stalling at the exact moment of the reload, the reload can
// be answered with the same out-of-date page and fail again — at which point the cooldown stops us
// and the person sees the error card, exactly as they do today. Nothing gets worse; that one case
// is just not made better.

// The shapes every engine uses for "a piece of the app failed to arrive". Kept in step with the two
// matching rules in `lib/plainError.ts` (the sibling that turns the same messages into English) —
// `scripts/verify-plain-logs.mjs` asserts the two agree so they cannot drift apart. Deliberately
// NOT imported from there: these boundaries load on the guest menu, and the translator is far too
// much code to put in a diner's bundle for one regular expression.
const STALE_CODE = [
  // Turbopack (Next 16) and webpack: "Failed to load chunk …", "Loading chunk 42 failed.",
  // "ChunkLoadError: …".
  /^(?:Loading chunk|Failed to load chunk|ChunkLoadError)/i,
  // Native ES modules — Chrome/Firefox wording, and Safari's ("Importing a module script failed").
  /^Failed to (?:fetch|load) dynamically imported module/i,
  /\berror loading dynamically imported module\b/i,
  /\bimporting a module script failed\b/i,
];

/** Does this message mean the app's own code failed to arrive, rather than the app being wrong? */
export function isStaleCodeError(message: string | null | undefined): boolean {
  const s = String(message ?? "").trim();
  if (!s) return false;
  return STALE_CODE.some((re) => re.test(s));
}

const STAMP = "lfh.staleCodeReload";
const COOLDOWN_MS = 60_000;

// Set the instant we commit to reloading. `location.reload()` does not stop this tick, so without
// it two boundaries unmounting together could each fire one.
let reloading = false;

/** When this tab last reloaded itself out of a missing-code crash; 0 if it never has. */
function lastReloadAt(): number {
  try {
    const raw = window.sessionStorage.getItem(STAMP);
    const at = raw ? Number(raw) : 0;
    // A stamp from the future (a clock that moved) must not lock recovery out for ever.
    return Number.isFinite(at) && at > 0 && at <= Date.now() ? at : 0;
  } catch {
    // Private browsing can refuse sessionStorage. Without a stamp we cannot promise "only once",
    // so treat it as "already tried" and never auto-reload — a stuck screen the person can reload
    // by hand beats a tab that reloads for ever.
    return Date.now();
  }
}

/**
 * Would an automatic reload help, right now?
 *
 * PURE — no writes, no side effects — so an error boundary can call it during render to decide
 * whether to paint a quiet "getting the latest version" line instead of flashing "Something went
 * wrong" for the moment before the reload lands.
 */
export function canReloadForStaleCode(message: string | null | undefined): boolean {
  if (typeof window === "undefined") return false;
  if (!isStaleCodeError(message)) return false;
  // `onLine === false` is the only value that means anything; `true` merely means "there is a
  // network interface", which is why it is never treated as proof of a working connection.
  if (window.navigator?.onLine === false) return false;
  if (reloading) return true; // already committed — keep rendering the quiet line, not the card
  return Date.now() - lastReloadAt() >= COOLDOWN_MS;
}

/**
 * Take the one automatic reload, if it is allowed. Returns true if a reload is under way.
 *
 * Call it AFTER the crash has been reported: `reportClientError` uses `navigator.sendBeacon`, which
 * survives the unload, but the ordering still has to be right — a report that was never handed to
 * the browser cannot be delivered by it.
 */
export function reloadForStaleCode(message: string | null | undefined): boolean {
  if (reloading) return true;
  if (!canReloadForStaleCode(message)) return false;
  reloading = true;
  try {
    window.sessionStorage.setItem(STAMP, String(Date.now()));
  } catch {
    // Refused storage means we cannot guarantee "only once". Don't reload at all rather than risk
    // a loop — canReloadForStaleCode already returns false in that case, so this is belt and braces.
    reloading = false;
    return false;
  }
  window.location.reload();
  return true;
}
