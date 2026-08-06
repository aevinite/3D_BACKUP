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
import dynamic from "next/dynamic";

// PERF (2026-07-09): load every guest widget LAZILY (next/dynamic, client-only).
// They all render nothing until an effect/interaction fires (RealtimeProvider →
// null + effects, SessionGate → !open → null, BanGate → !banned → null, cart/
// toasts start closed), so deferring them is invisible on the guest menu. The win:
// their JS (incl. supabase-js via RealtimeProvider) stays OUT of the shared bundle,
// so the STAFF PANELS (/tablet, /kitchen, /manager, …) — which render null here —
// no longer DOWNLOAD ~200KB+ of guest-app code they never use. That download was the
// bulk of the slow panel open on mobile (the DB call is only ~0.9s). Guest routes
// fetch these small chunks right after hydration, the same moment they activated before.
const RealtimeProvider   = dynamic(() => import("@/components/RealtimeProvider"),   { ssr: false });
const ModelToastHost     = dynamic(() => import("@/components/ModelToastHost"),     { ssr: false });
const OrderConfirmModal  = dynamic(() => import("@/components/OrderConfirmModal"),  { ssr: false });
const OrderTracker       = dynamic(() => import("@/components/OrderTracker"),       { ssr: false });
const MiniCart           = dynamic(() => import("@/components/MiniCart"),           { ssr: false });
const CartPanel          = dynamic(() => import("@/components/CartPanel"),          { ssr: false });
const ToastHost          = dynamic(() => import("@/components/ToastHost"),          { ssr: false });
const SessionGate        = dynamic(() => import("@/components/SessionGate"),        { ssr: false });
const SessionOwner       = dynamic(() => import("@/components/SessionOwner"),       { ssr: false });
const SessionCartSync    = dynamic(() => import("@/components/SessionCartSync"),    { ssr: false });
const SessionStatusWidget = dynamic(() => import("@/components/SessionStatusWidget"), { ssr: false });
const BackQuitDialog     = dynamic(() => import("@/components/BackQuitDialog"),     { ssr: false });
const PointerCaptureGuard = dynamic(() => import("@/components/PointerCaptureGuard"), { ssr: false });
const BanGate            = dynamic(() => import("@/components/BanGate"),            { ssr: false });
const CustomerGreeter    = dynamic(() => import("@/components/CustomerGreeter"),    { ssr: false });
// The diner's view of orders saved on their own phone while offline (T1 improvement 12). Renders
// nothing at all until the guest outbox has something in it, so it costs a guest with a working
// connection nothing beyond its own small chunk.
const GuestOutboxChip    = dynamic(() => import("@/components/GuestOutboxChip"),    { ssr: false });

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
      <CustomerGreeter />
      <GuestOutboxChip />
    </>
  );
}
