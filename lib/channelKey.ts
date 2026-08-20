// lib/channelKey.ts — ONE rule for storing, keeping and clearing a delivery channel's API key.
//
// ── WHY THIS FILE EXISTS (owner-approved 2026-08-20, T20 sweep item 12) ────────────────────────
// `settings.platform_channels` is a JSONB map — one cell per channel (swiggy, zomato, …) holding
// `{ on, key }`. TWO admin routes wrote that same column with OPPOSITE conventions for the same
// value:
//
//   · app/api/admin/restaurants/access-tree        → `null` clears the key, `""` LEAVES IT ALONE
//   · app/api/admin/restaurants/platform-channels  → `""`  clears the key, `null` was ignored
//
// Each route matched its own caller, so nothing was broken on any screen today — which is exactly
// why it was reported as a decision rather than a fault. But it is the same trap as "one column,
// two field names" (T17 finding F4, 13 August): the next screen to touch this column has a 50/50
// chance of picking the convention that silently destroys a stored credential.
//
// THE CONVENTION THAT WINS, and why it is the access-tree one:
//
//   absent / undefined  → leave the stored key exactly as it is.
//   ""  (empty string)  → leave the stored key exactly as it is.
//   null                → CLEAR it. This is the only way to remove a key.
//   a non-empty string  → replace it with that (trimmed, capped).
//
// The load-bearing line is `"" = leave alone`. These keys are WRITE-ONLY by design: the browser
// sends a key and only ever gets a masked hint back ("••••1234"), so the field a person sees is
// always blank. Under the other convention, saving that form without retyping the key would wipe a
// working credential — a channel silently stops accepting orders and nothing on screen says why.
// A blank write-only field can never be a deliberate instruction to delete. Clearing has to be an
// action of its own, and `null` is it.
//
// The legacy `api_key` field is dropped on EVERY write here. Migration 209 documents `key`; a
// restaurant that ended up with both copies converges on one the next time either route saves.

/** One channel's stored cell. Unknown keys are preserved — this only ever touches the credential. */
export type ChannelCell = Record<string, unknown>;

/** The longest key we will store. Real provider keys are far shorter; this only stops abuse. */
export const CHANNEL_KEY_MAX = 500;

/**
 * Apply an incoming credential value to one channel cell, by the one convention above.
 * Returns a NEW cell — callers merge it back themselves, so nothing is mutated under them.
 *
 * @param cell  the channel's currently stored cell (may be undefined for a channel never set up).
 * @param value what the request sent for its key: undefined | "" | null | string.
 */
export function applyChannelKey(cell: ChannelCell | undefined, value: unknown): ChannelCell {
  const cur: ChannelCell = { ...(cell || {}) };

  // absent → nothing about the key changes, not even the legacy field. A request that never
  // mentioned the credential must not rewrite it.
  if (value === undefined) return cur;

  // null → the deliberate clear. Both the current field and the legacy one go.
  if (value === null) {
    const { api_key: _legacy, key: _key, ...rest } = cur;
    return rest;
  }

  const next = String(value).trim();
  // "" → the form was saved without retyping a write-only field. Leave the stored key standing.
  if (!next) return cur;

  // A real value replaces it, and takes the legacy copy with it.
  const { api_key: _legacy, ...keep } = cur;
  return { ...keep, key: next.slice(0, CHANNEL_KEY_MAX) };
}

/** Did this request actually ASK for the key to change? Used for the audit line and for deciding
 *  whether a write is worth making at all. */
export function channelKeyAction(value: unknown): "none" | "clear" | "set" {
  if (value === undefined) return "none";
  if (value === null) return "clear";
  return String(value).trim() ? "set" : "none";
}
