// CustomerGreeter — the returning-guest "Welcome back" touch (Customer CRM, mig 211).
//
// On the guest menu, once per browser SESSION, we ask the server if THIS device was
// linked to a consented customer on a past visit (lfh_greet_device). If so, we show a
// small, dismissible toast greeting them by NAME. The RPC never returns the phone.
//
// Egress-safe: ONE tiny anon RPC per guest session, sessionStorage-guarded so a reload
// or navigating between dishes never re-asks. Self-gating — a restaurant not using the
// CRM (or an unknown device) just gets { known:false } and nothing renders. Renders null.
"use client";

import { useEffect } from "react";
import { useRestaurantId } from "@/lib/restaurant-context";
import { greetDevice } from "@/lib/session";

export default function CustomerGreeter() {
  const restaurantId = useRestaurantId();

  useEffect(() => {
    if (!restaurantId) return;
    const key = `lfh_greeted_${restaurantId}`;
    try { if (sessionStorage.getItem(key)) return; } catch { /* private mode */ }

    let cancelled = false;
    // Small delay so the greeting doesn't fight the intro/splash for attention.
    const t = window.setTimeout(async () => {
      try {
        const r = await greetDevice(restaurantId);
        try { sessionStorage.setItem(key, "1"); } catch { /* ignore */ }
        if (cancelled || !r || r.known !== true) return;
        const name = typeof r.name === "string" ? r.name.trim() : "";
        if (!name) return;
        const visits = typeof r.visits === "number" ? r.visits : 0;
        window.dispatchEvent(new CustomEvent("lfh:toast", {
          detail: {
            message: `Welcome back, ${name} 👋`,
            subtitle: visits >= 2 ? `great to see you again` : undefined,
            kicker: "hello",
            icon: "✨",
            variant: "success",
          },
        }));
      } catch { /* greeting is best-effort; never block the menu */ }
    }, 1800);

    return () => { cancelled = true; window.clearTimeout(t); };
  }, [restaurantId]);

  return null;
}
