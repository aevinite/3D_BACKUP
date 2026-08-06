"use client";
// app/error.tsx — the error boundary the GUEST tree never had (T9 sweep, 2026-08-06).
//
// WHY IT EXISTS. `lib/tenant.getRestaurantBySlug` and `lib/menu.getSettings` both THROW on a failed
// read, on purpose — lib/tenant.ts spells out the reasoning: *"'something went wrong, try again' is
// honest and a 404 is not."* The API route was brought into line on 2026-08-05 (menu-data wraps both
// calls and answers 503 + `transient`). The three guest PAGES that call the same two helpers —
// app/r/[restaurant]/menu, app/q/[code], app/r/[restaurant]/item/[slug] — never caught anything, and
// there was no `error.tsx` anywhere in the tree for them to fall into. The only boundaries in the
// repo were app/global-error.tsx (root-LAYOUT scope, per Next's contract) and app/aevinite/error.tsx.
//
// So a diner scanning a printed table QR during a database blip could be shown Next's default
// server-exception page for a restaurant that exists and is open. `/q/<code>` is the hottest guest
// entry point there is.
//
// DELIBERATELY UNBRANDED. A boundary cannot know which restaurant failed to resolve — that lookup is
// the thing that just threw. So this is quiet and neutral rather than wearing restaurant #1's colours
// on someone else's menu (the recurring branding-leak fault). It matches the tone of the /q/<code>
// "this QR code isn't active" card, which is the other page a diner meets when something is wrong.
//
// Kept dependency-free (inline styles) for the same reason global-error.tsx is: if the failure
// happened during render, the app's CSS may not be there. It respects the theme attribute the boot
// script stamps on <html>, so it is readable in both skins.
import { useEffect } from "react";
import { panelFromPath, reportClientError } from "@/lib/errorReport";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Record WHERE it happened, exactly as global-error.tsx does — a guest-menu throw and an owner
    // page throw must not both file themselves as the same screen.
    const path = typeof window !== "undefined" ? window.location.pathname || "" : "";
    const digest = error?.digest ? ` #${error.digest}` : "";
    reportClientError(panelFromPath(path), error?.message || "page error", `${path}${digest}`);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
        // `color-scheme: light dark` lets the two system colours below follow the device, so this
        // never renders black-on-black or white-on-white whichever skin the guest is in.
        colorScheme: "light dark",
        background: "Canvas",
        color: "CanvasText",
      }}
    >
      <div style={{ maxWidth: 360 }}>
        <div style={{ fontSize: 44, marginBottom: 10 }} aria-hidden="true">
          🍽️
        </div>
        <h1 style={{ fontSize: 20, margin: "0 0 8px", fontWeight: 600 }}>We couldn&rsquo;t load this just now</h1>
        <p style={{ fontSize: 14, opacity: 0.75, margin: "0 0 20px", lineHeight: 1.5 }}>
          Something went wrong on our side — it&rsquo;s not your connection. Please try again in a moment.
        </p>
        <button
          onClick={() => reset()}
          style={{
            background: "#d4a574",
            color: "#1a1a1a",
            border: 0,
            borderRadius: 10,
            padding: "11px 22px",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
