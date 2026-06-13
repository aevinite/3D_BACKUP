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
import SessionOwner from "@/components/SessionOwner";
import SessionCartSync from "@/components/SessionCartSync";
import SessionStatusWidget from "@/components/SessionStatusWidget";

// Staff routes never get guest chrome.
const STAFF_PREFIXES = ["/admin", "/editor", "/kitchen", "/tablet", "/staff-login"];

export default function GuestChrome() {
  const pathname = usePathname() || "/";
  const isStaff = STAFF_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (isStaff) return null;
  return (
    <>
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
    </>
  );
}
