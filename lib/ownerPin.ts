"use client";
// asSuffix — the per-TAB "which owner" pin for the owner cockpit.
//
// When the ADMIN opens an owner panel for a restaurant that has SEVERAL owners, the
// dashboard chooser (and the Owners page) send them to /owner?rid=<R>&as=<ownerId>.
// `rid` scopes to the restaurant (existing bug-C1 per-tab pin); `as` names WHICH of
// that restaurant's owners to show — otherwise ownerScope silently resolves the
// primary/first owner and the chooser choice would be ignored (owner ask 2026-07-25).
//
// Every /api/owner/* call and every intra-cockpit link appends this suffix so the
// choice rides along per-tab (never a shared cookie — that would repaint a second
// admin tab, the exact C1 bug). Empty for a real logged-in owner and for an admin who
// didn't pick a specific owner → nothing changes.
export function asSuffix(): string {
  const a = asValue();
  return a ? `&as=${encodeURIComponent(a)}` : "";
}
// Raw value, for call sites that build the query with URLSearchParams.set instead of a
// template string (e.g. the Activity page). Null when there's no chosen-owner pin.
export function asValue(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("as");
}
