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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which restaurant this crash belongs to, if the page already knows — never a new request.
 *
 * WHY THIS WAS MISSING MATTERS (T17 follow-up, 2026-08-20). This reporter sent no restaurant at
 * all, so every crash caught by a React error boundary landed on the Repair board with nothing
 * against it — and the admin's restaurant picker, which exists so a 9pm call about one client can
 * narrow the whole page, silently hid exactly those rows. The static panels have always tagged the
 * tenant (public/panels/errlog.js → LFH_RT.getRid()); the Next.js boundaries never did.
 *
 * Two free sources, in order of trust:
 *   · ?rid= / ?scope= — the admin's per-tab drill-in pin, already on the address.
 *   · LFH_RT.getRid() — the panel's own tenant, learned from /api/rt-config.
 * A guest menu at /r/<slug>/… has neither, and does not need one: the SERVER reads the slug off the
 * address it is sent (app/api/log/client-error/route.ts → ridFromAddress).
 */
function knownRid(): string | null {
  try {
    const q = new URLSearchParams(window.location.search);
    for (const k of ["rid", "scope"]) {
      const v = q.get(k) || "";
      if (UUID.test(v)) return v;
    }
    const rt = (window as unknown as { LFH_RT?: { getRid?: () => string } }).LFH_RT;
    const fromPanel = rt?.getRid?.() || "";
    if (UUID.test(fromPanel)) return fromPanel;
  } catch { /* the report matters more than its label */ }
  return null;
}

export function reportClientError(panel: ErrorPanel, message: string, where?: string): void {
  if (typeof window === "undefined") return;
  try {
    const rid = knownRid();
    const body = JSON.stringify({
      kind: "error", panel,
      message: String(message || "error").slice(0, 300),
      where: String(where || "").slice(0, 120),
      ...(rid ? { rid } : {}),
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/log/client-error", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/log/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* never throw from the reporter */
  }
}
