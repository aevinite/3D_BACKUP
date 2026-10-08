// lib/sentryPrivacy.ts — what an error report may carry OUT of this app, and what it may not.
//
// WHY THIS EXISTS (sweep #10, T17, item 1, 2026-10-08). All three Sentry setups said
// `sendDefaultPii: true`, which in @sentry/nextjs 10.x switches on EVERY collection category with no
// filter on the error path: `requestDataIntegration` copies the incoming request's headers wholesale
// into `event.request.headers` and parses the cookie header into `event.request.cookies`. So every
// server error that happened during a signed-in request shipped, to an outside service:
//   · `lfh_user`        — the staff sign-in cookie (a working 7-day session),
//   · `lfh_staff_auth`  — the admin console cookie (a working session until ADMIN_PASSWORD changes),
//   · `lfh_reveal`      — the "passwords uncovered" unlock (lib/revealGate.ts),
//   · `x-lfh-agent` / `Authorization` — the print helper's own token (app/api/print-agent),
//   · `x-webhook-secret` — a delivery platform's shared secret (app/api/aggregators/webhook).
// Read in node_modules/@sentry/core/build/cjs/integrations/requestdata.js → extractNormalizedRequestData:
// the cookie header is only dropped when `cookies` collection is OFF, and no other header is filtered.
// The project's rule is that a secret never reaches a log line; an error report IS a log line, kept
// somewhere we do not control.
//
// WHAT IS KEPT, deliberately: the person's IP and ordinary headers (user agent, referer, our own
// x-lfh-* bookkeeping headers) — that is what the old comments said the switch was for ("attach request
// headers + user IP so errors are easier to debug"), and it still works.
//
// TWO LAYERS, because either alone has a hole:
//   1. `SENTRY_DATA_COLLECTION` stops cookies and request bodies being COLLECTED at all (a typed
//      password is a request body). Set as `dataCollection`, which replaces the deprecated
//      `sendDefaultPii` and overrides it if both are present.
//   2. `scrubSentryEvent` runs on every event, transaction and span before it is sent, and blanks any
//      header or span attribute whose NAME says it is a credential — the SDK's own name list misses
//      `lfh_user` and `x-lfh-agent`, so we do not lean on it.
// `npm run verify:sentry-privacy` runs this function against a real-shaped event and reads all three
// config files.
//
// In plain words: when the app reports a crash to the error-tracking service, it no longer staples the
// person's sign-in pass to the report.

export const REDACTED = "[removed by lib/sentryPrivacy]";

/** A header / cookie / attribute name that carries a credential. Matched case-insensitively, anywhere
 *  in the name. `user-agent` is not a credential and is spared explicitly. */
const SECRET_NAME = /cookie|authorization|auth|token|secret|password|passwd|session|api[-_]?key|lfh[-_]agent|lfh[-_]user|lfh[-_]reveal|lfh[-_]staff/i;
export function isSecretName(name: string): boolean {
  const n = String(name || "");
  if (/^user[-_]agent$/i.test(n)) return false;
  return SECRET_NAME.test(n);
}

/** Collection settings for every Sentry.init in this app. */
// Typed loosely on purpose: this file imports nothing, so the guard can run it straight under node.
export const SENTRY_DATA_COLLECTION: { userInfo: boolean; cookies: false; httpBodies: never[]; databaseQueryData: boolean } = {
  userInfo: true,          // the IP the old `sendDefaultPii` was switched on for
  cookies: false,          // never — they ARE the sessions
  httpBodies: [],          // never — a sign-in body is a typed password
  databaseQueryData: false, // query values can hold names, phones, bill amounts
};

function scrubRecord(rec: unknown): void {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return;
  const r = rec as Record<string, unknown>;
  for (const k of Object.keys(r)) if (isSecretName(k)) r[k] = REDACTED;
}

/**
 * Blank every credential an event could be carrying. Mutates and returns the same object, which is
 * the shape Sentry's `beforeSend` / `beforeSendTransaction` / `beforeSendSpan` hooks expect. Never
 * throws — a report that cannot be cleaned is still better sent clean-as-possible than crashed on.
 */
export function scrubSentryEvent<E>(event: E): E {
  try {
    const e = event as unknown as Record<string, any>;
    if (e && e.request && typeof e.request === "object") {
      delete e.request.cookies;
      delete e.request.data;
      scrubRecord(e.request.headers);
    }
    // A span (beforeSendSpan) carries its attributes on `data`; a transaction carries them on every
    // span and on its trace context. Attribute names look like `http.request.header.cookie.lfh_user`.
    scrubRecord(e?.data);
    scrubRecord(e?.contexts?.trace?.data);
    if (Array.isArray(e?.spans)) for (const s of e.spans) scrubRecord(s?.data);
  } catch { /* never let the cleaner be the thing that fails */ }
  return event;
}
