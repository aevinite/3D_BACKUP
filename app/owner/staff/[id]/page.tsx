"use client";
// Owner · one person — THE SHARED PROFILE, not a second screen (2026-08-06).
//
// This route used to be a ~1160-line six-tab page of its own: the "second shape"
// docs/STAFF-PROFILE.md forbids ("do not invent a second one"), with its own hand-written
// permission list that had already drifted from lib/staffCaps — three waiter rows missing
// (table types, khata, banquet), khata greyed by the wrong module, and NO manager rows at all, so
// an owner could not see what their own manager was allowed to do.
//
// It is now a thin mount point: the same component Aevidine opens, pointed at the owner's own
// endpoint (components/owner/ownerProfileHost). One layout, one permission list, one vocabulary —
// so a person's record can never again say two different things depending on who opened it.
//
// The profile is a full-screen sheet with its own ✕ and its own phone-Back handling, so this page
// deliberately renders nothing else: closing goes back to the roster it was opened from.
import { useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import StaffProfile from "@/components/admin/StaffProfile";
import { ownerProfileHost } from "@/components/owner/ownerProfileHost";

export default function OwnerPersonPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const sp = useSearchParams();
  const id = String(params?.id || "");
  // The admin-in-one-restaurant pin (?rid=) and the chosen-owner pin (?as=) ride along on every
  // call, exactly as the roster does — an admin viewing restaurant A in one tab and B in another
  // stays in the right one.
  const rid = sp.get("rid");
  const as = sp.get("as");
  const host = useMemo(() => ownerProfileHost(id, rid, as), [id, rid, as]);
  // BOTH PINS COME BACK, NOT JUST ONE (T13 sweep, 2026-08-17 — watched happen).
  //
  // This route already reads `as` above, and the roster's link out to it was fixed to CARRY `as` in
  // the T19 sweep (2026-08-14, see the long note in app/owner/staff/page.tsx → withRid). The way
  // BACK still built its URL from `rid` alone, so the pin survived the trip out and was thrown away
  // on the trip home: an Aevidine tab opened for a restaurant's SECOND owner
  // (/owner?rid=R&as=<ownerId>) landed on /owner/staff?rid=R after closing a person, and the roster
  // — which resolves the owner from `as` — silently switched to the PRIMARY owner's estate. Same
  // tab, same task, a different person's team, with nothing on screen saying so.
  // Measured before the fix: closing from `?rid=…&as=…` returned a URL with no `as` at all.
  //
  // Built from parts, like withRid, so a pin that arrives on its own still rides along.
  const backToRoster = useCallback(() => {
    const q = [
      rid ? `rid=${encodeURIComponent(rid)}` : "",
      as ? `as=${encodeURIComponent(as)}` : "",
    ].filter(Boolean).join("&");
    // REPLACE, not push (T13 handoff H3, 2026-08-19). A person's profile is a detour off the
    // roster, so closing it should REMOVE the detour rather than stack another entry on top: with
    // `push`, tapping ✕ and then pressing Back re-opened the profile you had just closed. The
    // phone's Back button no longer comes through here at all — the profile stopped registering a
    // back layer (see components/owner/ownerProfileHost.ts → pageHosted), so Back pops this route's
    // own history entry and the browser returns to the roster natively, on the FIRST press.
    router.replace(q ? `/owner/staff?${q}` : "/owner/staff");
  }, [router, rid, as]);

  if (!id) return <div className="adm-empty">No person named.</div>;
  return <StaffProfile userId={id} host={host} onClose={backToRoster} />;
}
