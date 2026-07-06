// GuestChrome — the always-on GUEST widgets (cart, dining-session, toasts, 3D
// toast host). These belong ONLY to the customer-facing pages (menu / item /
// viewer). They must NOT run on the staff panels (admin/editor/kitchen/tablet/
// login): on those pages the dining-session machinery was wrongly auto-opening
// tables and showing a guest "Hosting Table N" card over the admin floor.
//
// So we gate them by route here, in one client component, instead of mounting
// them globally in the layout. A staff path renders nothing; everything else
// gets the full guest chrome exactly as before.
"use client";

import { usePathname } from "next/navigation";
import ModelToastHost from "@/components/ModelToastHost";
import OrderConfirmModal from "@/components/OrderConfirmModal";
import OrderTracker from "@/components/OrderTracker";
import MiniCart from "@/components/MiniCart";
import CartPanel from "@/components/CartPanel";
import ToastHost from "@/components/ToastHost";
import SessionGate from "@/components/SessionGate";
import RealtimeProvider from "@/components/RealtimeProvider";
import SessionOwner from "@/components/SessionOwner";
import SessionCartSync from "@/components/SessionCartSync";
import SessionStatusWidget from "@/components/SessionStatusWidget";
import BackQuitDialog from "@/components/BackQuitDialog";
import PointerCaptureGuard from "@/components/PointerCaptureGuard";
import BanGate from "@/components/BanGate";

// Staff routes never get guest chrome. Two shapes must both be caught:
//  - the flat admin routes (/manager, /kitchen, /tablet, /login, …), and
//  - the PER-RESTAURANT panels /r/<slug>/manager|kitchen|tablet|login|owner.
// The old list only had the flat ones, so when the panels moved under /r/<slug>/
// the guest cart + dining-session machinery started mounting on top of the staff
// panels + login again (the exact bug this file exists to prevent). Matching the
// staff SEGMENT wherever it appears fixes it for good, even as routes grow.
// (Audit fix 2026-07-06.)
const STAFF_SEGMENTS = ["aevinite", "admin", "manager", "editor", "kitchen", "tablet", "staff-login", "login", "owner"];
// Matches: /<seg>...  OR  /r/<slug>/<seg>...  (seg at path end or followed by "/")
const STAFF_RE = new RegExp(
  `^(?:/r/[^/]+)?/(?:${STAFF_SEGMENTS.join("|")})(?:/|$)`
);

export default function GuestChrome() {
  const pathname = usePathname() || "/";
  const isStaff = STAFF_RE.test(pathname);
  if (isStaff) return null;
  return (
    <>
      <RealtimeProvider />
      <ModelToastHost />
      <OrderConfirmModal />
      <OrderTracker />
      <MiniCart />
      <CartPanel />
      <ToastHost />
      <SessionGate />
      <SessionOwner />
      <SessionCartSync />
      <SessionStatusWidget />
      <BackQuitDialog />
      <PointerCaptureGuard />
      <BanGate />
    </>
  );
}
