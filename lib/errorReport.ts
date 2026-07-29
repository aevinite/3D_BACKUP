// Browser-side helper to drop a React render error into the Everything Log (in addition to
// Sentry). Used by the app's error boundaries. Fire-and-forget; safe on the server (no-ops).

// The panels the log recognises (mirrors the PANELS whitelist in
// app/api/log/client-error/route.ts — a value outside it is silently dropped there).
export type ErrorPanel = "menu" | "admin" | "owner" | "manager" | "kitchen" | "tablet";

// Which surface a crashing page belongs to, from its address. The root boundary catches a
// crash on ANY page, so without this every crash — owner dashboard included — was filed as
// a "menu screen error" and the Repair log pointed at the wrong panel.
export function panelFromPath(pathname: string): ErrorPanel {
  // Panels are reachable BOTH bare (/owner) and per-restaurant (/r/<slug>/owner), so drop a
  // leading /r/<slug> first — otherwise every tenant-scoped panel crash reads as "menu".
  const p = pathname.replace(/^\/r\/[^/]+/, "");
  if (p.startsWith("/aevinite")) return "admin";
  if (p.startsWith("/owner")) return "owner";
  if (p.startsWith("/manager")) return "manager";
  if (p.startsWith("/kitchen")) return "kitchen";
  if (p.startsWith("/tablet")) return "tablet";
  return "menu";
}

export function reportClientError(panel: ErrorPanel, message: string, where?: string): void {
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
