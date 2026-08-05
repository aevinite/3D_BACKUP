"use client";

// GuestNotFound — the dead-end screen for a GUEST-facing page that doesn't exist:
// a dish link that's been removed or mistyped, a restaurant that's been switched off,
// or a menu whose master switch is now off.
//
// WHY IT EXISTS (guest sweep, 2026-08-04). These pages used to fall through to the
// ROOT not-found, which is the PLATFORM's 404: it showed a diner the "Aevidine"
// wordmark four times and its only button, "Back to safety", pointed at "/" — which
// 307s to /login, the STAFF sign-in. So a customer who opened a shared or stale dish
// link was shown the software vendor's branding and then dumped on a staff password
// screen, with no route back to the menu they were on. That breaks the white-label rule
// AND leaves a real diner stranded mid-meal.
//
// The look deliberately MIRRORS the existing friendly page in app/q/[code]/page.tsx
// (the "This QR code isn't active" screen) rather than inventing a second style — that
// is already this codebase's established guest dead-end pattern, and it carries no
// platform branding.
//
// HONEST ABOUT THE WAY OUT: a missing DISH still has a working menu to go back to, but a
// switched-off restaurant does not, and this component can't know which case it is (a
// not-found boundary receives no params). So it ASKS: one small request to the menu-data
// endpoint, which is exactly the gate the menu page itself uses. Menu answers → offer it.
// Menu doesn't → say so plainly and point at a member of staff, instead of offering a
// button that 404s straight back here.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { DEFAULT_RESTAURANT_SLUG } from "@/lib/tenant";

export default function GuestNotFound() {
  const pathname = usePathname() || "";
  // /r/<slug>/... carries its restaurant in the path. The legacy /item/<slug> route IS
  // restaurant #1 by definition (same rule as lib/tenantStorage + restaurant-context).
  const m = pathname.match(/^\/r\/([^/]+)/);
  const slug = m ? decodeURIComponent(m[1]) : /^\/item(\/|$)/.test(pathname) ? DEFAULT_RESTAURANT_SLUG : null;

  // null = still asking · true = this restaurant's menu is live · false = it isn't.
  const [menuLive, setMenuLive] = useState<boolean | null>(null);
  useEffect(() => {
    if (!slug) { setMenuLive(false); return; }
    let alive = true;
    fetch(`/api/r/${encodeURIComponent(slug)}/menu-data`, { cache: "no-store" })
      .then((r) => { if (alive) setMenuLive(r.ok); })
      .catch(() => { if (alive) setMenuLive(false); }); // offline / unreachable → don't promise a menu
    return () => { alive = false; };
  }, [slug]);

  return (
    <main
      style={{
        minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, textAlign: "center",
        // The app's own font and tokens, NOT system-ui (visual sweep 2026-08-05): this was the one
        // guest screen drawn in a different typeface with no theme, so a diner who scanned a
        // blue- or pink-themed restaurant's QR landed on a system-font page in restaurant #1's
        // brown. A dead end still has to look like the restaurant they are sitting in.
        fontFamily: "'Inter', sans-serif", background: "var(--bg)", color: "var(--text)",
      }}
    >
      <div>
        <div style={{ fontSize: 44, marginBottom: 10 }} aria-hidden="true">🍽️</div>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>
          {menuLive === false ? "This menu isn’t available right now" : "We couldn’t find that page"}
        </h1>
        <p style={{ fontSize: 14, opacity: 0.75, margin: 0, maxWidth: 340 }}>
          {menuLive === false
            ? "Please ask a member of staff — they can bring you the menu or scan the current code for your table."
            : "That dish may have been taken off the menu, or the link was mistyped."}
        </p>
        {/* Only offered once we KNOW the menu answers, so this can never bounce a guest
            straight back to this same screen. */}
        {menuLive === true && slug && (
          <p style={{ margin: "18px 0 0" }}>
            <a
              href={`/r/${encodeURIComponent(slug)}/menu`}
              style={{ fontSize: 14, fontWeight: 700, textDecoration: "underline" }}
            >
              ← Back to the menu
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
