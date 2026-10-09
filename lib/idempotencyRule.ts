// idempotencyRule.ts — "did this action actually change anything?"
//
// Kept in its OWN file, with no imports at all, for two reasons: it is a pure decision that
// nothing else in lib/idempotency.ts needs to be near, and it can therefore be executed directly
// by scripts/verify-order-retry.mjs. A guard that has to re-implement the rule it checks proves
// nothing about the rule that ships.
//
// WHY THE RULE EXISTS. "Remembered" means every later request under the same action id is
// answered with the stored reply WITHOUT running the handler — exactly right for a real change
// (never place the order twice) and exactly wrong for a REFUSAL, which changed nothing and whose
// cause the person may have just fixed.
//
// A 4xx was always released. The hole was a handler that reports a refusal INSIDE a 200 body,
// which is how every guest order RPC answers: `{ ok:false, reason:'sold_out' | 'rate_limited' |
// 'session_closed' }`. That was stored as done, so a diner's next tap on the SAME basket never
// reached the kitchen — it replayed the old refusal, for as long as the basket was unchanged.
// Over the ordering limit was the cruel one: wait a minute, tap again, same failure forever.
//
// So the test is BOTH: a non-error status AND a body that doesn't say it refused. The staff
// panels were only ever safe here by accident — they happen to use err(…, 400).
export function didSomething(status: number, body: unknown): boolean {
  if (status >= 400) return false;
  if (body && typeof body === "object" && (body as { ok?: unknown }).ok === false) return false;
  return true;
}

/** The same question about a STORED result, for healing rows written before this rule existed. */
export function storedIsRefusal(stored: unknown): boolean {
  return !!stored && typeof stored === "object" && (stored as { ok?: unknown }).ok === false;
}

// ── A SECRET IS NEVER KEPT AS A STORED REPLY (sweep #10 T30, item 7, 2026-10-09) ──────────────────
// lib/idempotency.ts stores a completed action's JSON reply so a duplicate can be answered with it.
// Three of the routes it wraps answer with a PASSWORD — the admin console's Show password and
// Reset password, and the owner's staff reset — so every one of those taps wrote the plaintext
// password into action_idempotency.result, where it sat until the opportunistic prune came round
// (measured on the dev database: 27 stored replies carried one). A stored reply exists to repeat an
// order id or a count, never a credential, so anything keyed like a secret is dropped before it is
// kept — and dropped again on the way out, for rows written before this rule existed.
const SECRET_KEY = /pass(?:word|code)|^pass$|secret|token|(?:^|_)pin(?:$|_|s$)|(?:^|_)otp(?:$|_)|api_?key|setup_?code|private_?key/i;

/** The reply with every secret-looking field removed, at any depth (arrays included). */
export function withoutSecrets(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== "object") return v;
  if (depth > 8) return null;          // a reply is never this deep; refuse to keep what we cannot read
  if (Array.isArray(v)) return v.map((x) => withoutSecrets(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = withoutSecrets(x, depth + 1);
  }
  return out;
}
