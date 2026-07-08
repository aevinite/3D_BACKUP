// Next's helper that bounces a visitor straight to another address.
import { redirect } from "next/navigation";

// This is the home page (the website root, "/"). It is NOT a guest entry point:
// guests reach a restaurant through its own QR link (/r/<slug>/menu). The bare
// domain is the platform/staff entry, so we forward it to the neutral staff login
// instead of defaulting to one restaurant's menu (owner 2026-07-08 — the root used
// to open French House's menu, which hard-wired restaurant #1). This is fully
// dynamic: no restaurant is assumed, so it stays correct as more are added.
export default function HomePage() {
  redirect("/staff-login");
}
