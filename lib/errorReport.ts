// Browser-side helper to drop a React render error into the Everything Log (in addition to
// Sentry). Used by the app's error boundaries. Fire-and-forget; safe on the server (no-ops).
export function reportClientError(panel: "menu" | "admin" | "owner", message: string, where?: string): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({ kind: "error", panel, message: String(message || "error").slice(0, 300), where: String(where || "").slice(0, 120) });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/log/client-error", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/log/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* never throw from the reporter */
  }
}
