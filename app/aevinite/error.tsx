"use client";
// Error boundary for the whole /aevinite admin section. If ANY admin page throws
// while rendering (a missing field, a bad shape from an API, etc.) this shows a
// friendly, recoverable box instead of blanking the screen to Next's raw error
// page. Added after the System Health page white-screened when the DB was down
// (admin audit 2026-07-06); this is the defence-in-depth net behind that fix.
import { useEffect } from "react";
import { reportClientError } from "@/lib/errorReport";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface it in the console for debugging; no user secrets are logged.
    console.error("[admin] page error:", error);
    // Also record it in the Everything Log so it shows red in Admin → Logs — with the exact
    // admin page it happened on, so the log line is actionable ("… @ /aevinite/rate-limits").
    const digest = error?.digest ? ` #${error.digest}` : "";
    reportClientError("admin", error?.message || "admin page error", `${window.location.pathname}${digest}`);
  }, [error]);

  return (
    <div className="adm-card" style={{ maxWidth: 560, margin: "40px auto", textAlign: "center" }}>
      <div style={{ fontSize: 34, marginBottom: 10 }} aria-hidden="true">⚠️</div>
      <h2 style={{ margin: "0 0 6px" }}>Something went wrong on this screen</h2>
      <p className="adm-muted" style={{ fontSize: 14, marginBottom: 16 }}>
        This page hit an unexpected error and stopped loading. Your data is safe — nothing was changed.
        Try again, and if it keeps happening, reload the page.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <button className="adm-btn primary" onClick={() => reset()}>
          <i className="fas fa-rotate-right" style={{ marginRight: 6 }} aria-hidden="true" />Try again
        </button>
        <a className="adm-btn" href="/aevinite">Back to dashboard</a>
      </div>
    </div>
  );
}
