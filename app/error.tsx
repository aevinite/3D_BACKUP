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
import { useEffect, useState } from "react";
import { panelFromPath, reportClientError } from "@/lib/errorReport";
import { canReloadForStaleCode, isStaleCodeError, reloadForStaleCode } from "@/lib/staleCode";

// ── "TRY AGAIN" MUST ASK THE SERVER AGAIN (sweep #10 T3 round 3, owner's item 31) ──────────────────
// The guest pages throw here when a SERVER-side read fails — the menu's settings read cancelled on the
// database's statement timeout is the one measured (error board: "Minified React error #441", React's
// production stand-in for "the server render threw", three times on 2026-10-12 while the dev database
// was paging). Next hands the boundary two functions: `reset` only re-draws what is already on the
// phone — the same failed server answer — and `retry` (Next 16) refreshes from the server first and then
// re-draws. The button called `reset`, so "Try again" could never recover a server failure: the diner
// had to reload by hand. It calls `retry` now.
//
// AND IT TRIES AGAIN BY ITSELF, GENTLY. A busy database is the restaurant's problem, not the diner's
// (CLAUDE.md: busy = offline, a rush slows the app and never takes it down). So a server-side failure
// (`digest` set — Next only stamps one on errors thrown on the server) is retried up to three times,
// about 4 s, 12 s and 30 s apart with jitter so a whole dining room does not come back in one wave,
// only while the page is on screen. Each attempt is one page request. After three, the button stays.
const AUTO_WAITS_MS = [4000, 12000, 30000];
const autoTries = { path: "", n: 0, at: 0 };   // per tab; forgotten once a path has been quiet for 2 min

export default function AppError({ error, reset, retry }: { error: Error & { digest?: string }; reset: () => void; retry?: () => void }) {
  const again = retry || reset;
  const [autoIn, setAutoIn] = useState<number | null>(null);   // seconds until the next automatic try
  // A diner whose tab was open across a deploy is asking for a JavaScript file that no longer
  // exists under that name. That is not a fault in the menu and `reset()` cannot cure it — it
  // re-renders the same tree and asks for the same dead file. One reload does cure it, so decide
  // here, during render, and show a quiet line rather than flashing a crash card at them.
  // See lib/staleCode.ts; the crash is still reported below, unchanged.
  const recovering = canReloadForStaleCode(error?.message);

  useEffect(() => {
    // Record WHERE it happened, exactly as global-error.tsx does — a guest-menu throw and an owner
    // page throw must not both file themselves as the same screen.
    const path = typeof window !== "undefined" ? window.location.pathname || "" : "";
    const digest = error?.digest ? ` #${error.digest}` : "";
    // Report FIRST: sendBeacon survives the unload, but only if it was handed the report before it.
    reportClientError(panelFromPath(path), error?.message || "page error", `${path}${digest}`);
    reloadForStaleCode(error?.message);
  }, [error]);

  useEffect(() => {
    if (!error?.digest || isStaleCodeError(error?.message) || typeof window === "undefined") return;
    const path = window.location.pathname || "";
    if (autoTries.path !== path || Date.now() - autoTries.at > 120000) { autoTries.path = path; autoTries.n = 0; }
    if (autoTries.n >= AUTO_WAITS_MS.length) { setAutoIn(null); return; }
    const wait = Math.round(AUTO_WAITS_MS[autoTries.n] * (0.85 + Math.random() * 0.3));
    let left = Math.ceil(wait / 1000); setAutoIn(left);
    let fired = false;
    const fire = () => {
      if (fired) return;
      if (document.visibilityState !== "visible") return;   // a hidden tab waits; it tries when shown again
      fired = true; autoTries.n++; autoTries.at = Date.now(); again();
    };
    const tick = setInterval(() => { left = Math.max(0, left - 1); setAutoIn(left); if (left === 0) fire(); }, 1000);
    const onShow = () => { if (left === 0) fire(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(tick); document.removeEventListener("visibilitychange", onShow); };
    // `again` is stable for the life of this boundary; the effect is about THIS error only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  if (recovering) {
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
          colorScheme: "light dark",
          background: "Canvas",
          color: "CanvasText",
        }}
      >
        <p style={{ fontSize: 14, opacity: 0.7, margin: 0 }}>Getting the latest version…</p>
      </main>
    );
  }

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
        {autoIn !== null && (
          <p style={{ fontSize: 13, opacity: 0.7, margin: "-8px 0 16px" }} aria-live="polite">
            {autoIn > 0 ? `Trying again by itself in ${autoIn}s…` : "Trying again…"}
          </p>
        )}
        <button
          // `retry()` refreshes from the server and re-draws (see the note above AppError); `reset()`
          // alone only re-draws. A file that no longer exists under its name needs a real reload.
          onClick={() => (isStaleCodeError(error?.message) ? window.location.reload() : again())}
          // The button wears the device's own two system colours, swapped — never a restaurant's.
          // It was #d4a574, restaurant #1's gold (app/globals.css --accent), so every restaurant's
          // diners met restaurant #1's colour on this screen; the boundary cannot know whose menu
          // failed, which is the whole reason it is unbranded (sweep #10 T1, item 5).
          style={{
            background: "CanvasText",
            color: "Canvas",
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
