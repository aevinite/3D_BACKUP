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
  const backToRoster = useCallback(() => {
    router.push(rid ? `/owner/staff?rid=${encodeURIComponent(rid)}` : "/owner/staff");
  }, [router, rid]);

  if (!id) return <div className="adm-empty">No person named.</div>;
  return <StaffProfile userId={id} host={host} onClose={backToRoster} />;
}
