"use client";

// BackQuitDialog — the LAST step of the back button. When the guest is on the menu
// with nothing open and presses back, instead of silently leaving the site we show
// a "Leave this site? [Stay] [Leave]" dialog (owner-chosen 2026-06-19).
//
// HOW IT CATCHES THE BACK PRESS: while on the menu we keep one tagged "exit-guard"
// history entry on top. The first back press pops it; our handler then re-arms the
// guard (so we stay put) and shows the dialog. Coming BACK to the menu from a
// sub-page (item / 3D) lands ON the guard, which we recognise and ignore — so that
// case just shows the menu, never the dialog.
//
// HONEST LIMIT: a website cannot force the browser to quit. "Leave" steps back past
// the app's first page — going to wherever the guest came from, or closing a tab
// that was opened fresh from a QR link. That's a browser rule, not a bug.

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { setRootBackHandler } from "@/lib/backStack";

// The guest "home" — where the exit guard applies. Sub-pages (/item, /view) have a
// real previous page, so their back goes to the menu on its own.
// EVERY real menu now lives at /r/<slug>/menu (the bare /menu just 307-redirects
// there), so the guard MUST match the tenant route or it never arms and the back
// button quits the site in one press — the exact owner hard-rule violation fixed
// 2026-07-05 (bug G1). Match /r/<slug>/menu exactly, NOT its /item|/view children.
//
// /q/<code> IS A MENU TOO, and it is the one a real diner actually opens: it's the
// address behind every printed table sticker (mig 210). It was missing here, so on
// the QR-scanned menu the guard never armed and ONE back press left the site — bug G1
// all over again, on the primary entry point (found by the guest sweep 2026-08-04,
// measured on a live table code: /r/<slug>/menu armed, /q/<code> did not).
const HOME_PATHS = ["/", "/menu"];
const TENANT_MENU = /^\/r\/[^/]+\/menu\/?$/;
const QR_MENU = /^\/q\/[^/]+\/?$/;
function isHomePath(p: string) {
  return HOME_PATHS.includes(p) || TENANT_MENU.test(p) || QR_MENU.test(p);
}

type GuardState = (History["state"] & { __lfhExitGuard?: boolean }) | null;

export default function BackQuitDialog() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const isHome = isHomePath(pathname);

  // Keep the exit-guard entry on top whenever we're on the menu. The check stops us
  // ever stacking two guards (e.g. React Strict-Mode double-invoke, or returning to
  // the menu where the guard is already the current entry).
  useEffect(() => {
    if (typeof window === "undefined" || !isHome) return;
    if (!(history.state as GuardState)?.__lfhExitGuard) {
      history.pushState({ ...(history.state as object), __lfhExitGuard: true }, "");
    }
  }, [isHome, pathname]);

  // Tell the manager what to do on a back press with no popups open.
  useEffect(() => {
    const handler = () => {
      // Sitting ON the guard = we just came back to the menu from a sub-page. The
      // menu is already showing — do nothing.
      if ((history.state as GuardState)?.__lfhExitGuard) return;
      // Only the menu/home is guarded. Elsewhere a real navigation already ran.
      if (!isHomePath(location.pathname)) return;
      // The guard was popped → the guest is trying to leave the menu. Re-arm it so
      // we stay put, then show the Leave dialog.
      history.pushState({ ...(history.state as object), __lfhExitGuard: true }, "");
      setOpen(true);
    };
    setRootBackHandler(handler);
    return () => setRootBackHandler(null);
  }, []);

  const stay = useCallback(() => setOpen(false), []);
  const leave = useCallback(() => {
    setOpen(false);
    // Step back past the re-armed guard AND the menu entry → leaves the app (prior
    // site, or closes a freshly-opened QR tab). Can't force-quit a browser; this is
    // the closest a web page can do.
    history.go(-2);
  }, []);

  if (!open) return null;

  return (
    <>
      {/* Dimmed backdrop — tapping it is the same as "Stay". */}
      <div className="overlay active" onClick={stay} />
      <div
        className="popup active"
        role="dialog"
        aria-modal="true"
        aria-label="Leave this site?"
        style={{ maxWidth: 360, textAlign: "center" }}
      >
        <i className="fas fa-door-open" style={{ fontSize: 42, color: "var(--accent)" }} aria-hidden />
        <h2 style={{ fontFamily: "Playfair Display", color: "var(--text)", margin: "16px 0 8px", fontSize: 22, fontWeight: 700 }}>
          Leave this site?
        </h2>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 18px" }}>
          You&apos;ll come right back to where you left off if you stay.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={stay}
            style={{
              flex: 1, padding: "12px 16px", borderRadius: 12, cursor: "pointer",
              fontSize: 15, fontWeight: 700, fontFamily: "inherit",
              background: "var(--accent)", color: "#fff", border: "none",
            }}
          >
            Stay
          </button>
          <button
            type="button"
            onClick={leave}
            style={{
              flex: 1, padding: "12px 16px", borderRadius: 12, cursor: "pointer",
              fontSize: 15, fontWeight: 700, fontFamily: "inherit",
              background: "transparent", color: "var(--muted)",
              border: "1px solid var(--border, rgba(0,0,0,.15))",
            }}
          >
            Leave
          </button>
        </div>
      </div>
    </>
  );
}
