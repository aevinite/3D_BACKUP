"use client";
// Root global error boundary. Catches an error thrown in the ROOT layout itself (the one place
// app/aevinite/error.tsx and other per-section boundaries can't reach). Next requires it to
// render its own <html>/<body>. It records the crash in the Everything Log and shows a minimal
// recoverable page. Kept dependency-free (inline styles) since the app's CSS may not have loaded.
import { useEffect } from "react";
import { panelFromPath, reportClientError } from "@/lib/errorReport";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Record WHICH page crashed, not just "menu". This boundary is the root one, so it also
    // catches owner/staff-panel crashes; hardcoding "menu" filed them under the guest menu and
    // left no clue where to look (owner-dashboard crashes showed as "menu screen error").
    // Same idea as naming the endpoint on a server route_error.
    const path = window.location.pathname || "";
    const digest = error?.digest ? ` #${error.digest}` : "";
    reportClientError(panelFromPath(path), error?.message || "root error", `${path}${digest}`);
  }, [error]);

  return (
    <html>
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#0b0b0c", color: "#f4f4f5", margin: 0 }}>
        <div style={{ maxWidth: 460, margin: "18vh auto", textAlign: "center", padding: "0 20px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden="true">⚠️</div>
          <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>Something went wrong</h2>
          <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 20 }}>
            The page hit an unexpected error. Please try again.
          </p>
          <button
            onClick={() => reset()}
            style={{ background: "#d4a574", color: "#1a1a1a", border: 0, borderRadius: 10, padding: "10px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
