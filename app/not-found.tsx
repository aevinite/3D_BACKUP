// Branded 404 — shown for any unmatched route (e.g. /signup). A full-screen,
// Aevidine-branded "wrong page" screen in the Apple-glass look, layered above the
// always-on guest chrome so it reads as a clean dedicated page.
//
// ── A DINER WHO LANDS HERE IS SENT TO THE MENU, NOT TO A STAFF PASSWORD SCREEN ──────────────────
// Owner, 2026-08-26: *"yes for this guest should be redirected to menu if you make it like that if
// possible and if written login or aevinite then only locate to there"*.
//
// The real address of a menu is /r/<slug>/menu. Drop the "/r/" — by editing a shared link, or
// retyping one — and you get THIS page: the software company's branding, and one button that leads
// to the staff sign-in. A guest mid-meal is shown the vendor's 404 and then asked for a password.
//
// So the first path segment is checked against the live restaurants, and if it names one the
// visitor is sent straight to that restaurant's menu. /french-house/menu, /french-house and
// /FRENCH-HOUSE/item/latte all now land on the French House menu.
//
// The check is ONE HEAD request to the menu-data endpoint — the same gate the menu page itself
// uses, so a switched-off restaurant or one whose Menu feature is off correctly does NOT resolve.
// HEAD, not GET, so the reply carries no body: a menu is ~24KB and none of it is wanted here, only
// the yes/no. It runs on this page only, which nobody reaches on purpose.
//
// The staff sign-in is offered ONLY when the address itself says staff — that is the second half of
// his instruction. Anything else that resolves to no restaurant gets the honest guest advice
// instead, in the same words the dead-QR-code page uses.
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

// The words that mean "this person was heading somewhere staff-only". `/login` and `/aevinite` are
// the two he named; the four panels are the same kind of address and would be just as wrong to
// answer with a guest menu.
const STAFF_WORDS = /(^|\/)(login|staff-login|aevinite|admin|manager|editor|kitchen|tablet|owner)(\/|$)/i;

export default function NotFound() {
  const pathname = usePathname() || "";
  const router = useRouter();
  // null = still asking · "staff" · "guest" (no restaurant found) — a redirect never renders.
  const [kind, setKind] = useState<"staff" | "guest" | null>(null);

  useEffect(() => {
    if (STAFF_WORDS.test(pathname)) { setKind("staff"); return; }
    const seg = pathname.split("/").filter(Boolean)[0];
    // A slug is lower-case by construction, but a mistyped or chat-capitalised link is exactly the
    // case this exists for, so fold it — getRestaurantBySlug does the same.
    const slug = seg ? decodeURIComponent(seg).toLowerCase() : "";
    if (!slug || !/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) { setKind("guest"); return; }
    let alive = true;
    fetch(`/api/r/${encodeURIComponent(slug)}/menu-data`, { method: "HEAD", cache: "no-store" })
      .then((r) => {
        if (!alive) return;
        // `replace`, not `push`: the address they typed was never a real page, so it must not sit
        // in their history waiting for the back button to return them to this same dead end.
        if (r.ok) router.replace(`/r/${slug}/menu`);
        else setKind("guest");
      })
      .catch(() => { if (alive) setKind("guest"); }); // offline → don't promise a menu we can't reach
    return () => { alive = false; };
  }, [pathname, router]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", padding: 24,
        background:
          "radial-gradient(820px 520px at 12% -8%, rgba(99,102,241,0.20), transparent 60%)," +
          "radial-gradient(720px 520px at 100% 0%, rgba(56,189,248,0.16), transparent 55%)," +
          "radial-gradient(760px 640px at 50% 120%, rgba(168,85,247,0.13), transparent 55%), #e7ebf3",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif", color: "#1d1d1f",
      }}
    >
      <div
        style={{
          width: "min(94vw, 460px)", textAlign: "center", padding: "42px 34px", borderRadius: 24,
          background: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.75)",
          backdropFilter: "blur(24px) saturate(180%)", WebkitBackdropFilter: "blur(24px) saturate(180%)",
          boxShadow: "0 24px 64px rgba(31,41,80,0.16)",
        }}
      >
        <div style={{ fontSize: 30, color: "#4f46e5", letterSpacing: "0.04em" }}>✦</div>
        <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "0.02em", marginTop: 4 }}>Aevidine</div>
        <div style={{ fontSize: 66, fontWeight: 800, letterSpacing: "-0.03em", margin: "16px 0 2px", color: "#4f46e5" }}>404</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px" }}>You took a wrong turn</h1>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: "#6e6e73", margin: "0 0 24px" }}>
          {kind === "guest"
            // The same words the dead-QR-code page uses, because it is the same situation: we cannot
            // tell which restaurant they meant, so the person who can is standing right there.
            ? "This page doesn’t exist. If you’re at a table, please scan the QR code on your table again — or ask a member of staff."
            : <>This page doesn&apos;t exist — it may have moved, or the link was mistyped.</>}
        </p>
        {/* The global `a { color: inherit !important }` (keeps guest links from turning
            blue) would force this button's text dark — a stronger class beats it. */}
        <style>{`.nf-cta,.nf-cta:visited,.nf-cta:hover,.nf-cta:active{color:#fff !important;text-decoration:none !important}`}</style>
        {/* Offered ONLY when the address itself said staff. A diner is never handed a password
            screen, and while we are still asking (kind === null) nothing is offered at all — a
            button that appears and then changes where it goes is worse than one that waits. */}
        {kind === "staff" && (
          <Link
            href="/login"
            className="nf-cta"
            style={{ display: "inline-block", padding: "12px 24px", borderRadius: 12, background: "#4f46e5", color: "#fff", fontWeight: 700, fontSize: 14, textDecoration: "none" }}
          >
            ← Back to sign in
          </Link>
        )}
      </div>
    </div>
  );
}
