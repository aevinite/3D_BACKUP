// Next's helper that bounces a visitor straight to another address.
import { redirect } from "next/navigation";

// This is the home page (the website root, "/"). It is NOT a guest entry point:
// guests reach a restaurant through its own QR link (/r/<slug>/menu). The bare
// domain is the platform/staff entry, so we forward it to the shared STAFF login
// (/login) — the one username+password door that routes manager / kitchen /
// tablet / owner to their own panel by role. NOT /staff-login (that's the admin
// password page → /aevinite). Owner 2026-07-08: the root must land on the staff
// sign-in, not the admin gate. Fully dynamic: no restaurant is assumed.
export default function HomePage() {
  redirect("/login");
}
