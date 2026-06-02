"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// The ONE notification for the whole app — a little café "order ticket" with
// torn top/bottom edges. Every notice (dish added, waiter called, order placed,
// order status, 3D ready, errors) goes through `lfh:toast`:
//
//   window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
//     message: string,            // main line (required)
//     subtitle?: string,          // small caps line under it
//     kicker?: string,            // tiny caps header — the ACTION label, not a brand
//                                 //   ("service" / "your order" / "3d preview" …)
//     variant?: "success"|"error"|"info",  // tints the mark (default success)
//     icon?: string,              // emoji to use as the mark instead of ✓/✕
//     href?: string,              // makes the whole ticket tappable (e.g. 3D view)
//   }}}));
//
// The kicker replaces the old fixed "Little French House" brand line: each kind
// of notice now carries its own short label so the ticket reads like a receipt
// stub for THAT action. If no kicker is given we fall back to a sensible one by
// variant, so a bare { message: "Espresso added" } still looks right.

// A toast can be one of three flavours, which decides its colour and symbol.
type Variant = "success" | "error" | "info";
// The full set of details we keep for one toast currently on screen.
interface ToastData {
  id: number;       // a unique number so React can track each ticket
  kicker: string;   // the tiny header line (the action label)
  title: string;    // the main message
  subtitle: string; // the small line under the title
  variant: Variant; // success / error / info
  mark: string;     // the symbol shown (✓, ✕, • or a custom emoji)
  href?: string;    // optional link — if set, tapping the ticket navigates
}

// When a caller doesn't name the action, pick a neutral café-receipt header.
const KICKER_FALLBACK: Record<Variant, string> = {
  success: "your order",
  info: "note",
  error: "heads up",
};

// Derive a clean title + small-caps subtitle from a bare "X added"/"X updated".
// e.g. "Espresso added" becomes title "Espresso" + subtitle "added to order".
function splitMessage(message: string, subtitle?: string): { title: string; subtitle: string } {
  // If the caller already gave a subtitle, just use what they passed.
  if (subtitle != null) return { title: message, subtitle };
  // Otherwise look for the "... added" pattern and split it nicely.
  const added = message.match(/^(.*?)\s+added$/i);
  if (added) return { title: added[1], subtitle: "added to order" };
  // Same idea for the "... updated" pattern.
  const updated = message.match(/^(.*?)\s+updated$/i);
  if (updated) return { title: updated[1], subtitle: "updated" };
  // No pattern matched — show the message as-is with no subtitle.
  return { title: message, subtitle: "" };
}

// The default symbol for each flavour of toast.
const MARK: Record<Variant, string> = { success: "✓", error: "✕", info: "•" };

// The single notification host for the whole app. It listens for "lfh:toast"
// events from anywhere, keeps the most recent few on screen, and removes each
// one after a short time. Mounted once globally.
export default function ToastHost() {
  // The toasts currently showing.
  const [toasts, setToasts] = useState<ToastData[]>([]);
  // Next.js navigation helper, used when a tappable toast is clicked.
  const router = useRouter();

  // Start listening for toast events when mounted; stop when unmounted.
  useEffect(() => {
    // A running number so each toast gets a unique id.
    let counter = 0;
    // Runs every time some part of the app fires an "lfh:toast" event.
    const onToast = (e: Event) => {
      // Read the details bundled with the event; ignore if there's no message.
      const d = (e as CustomEvent).detail || {};
      if (!d.message) return;
      // Normalise the variant to one of our three allowed values.
      const variant: Variant =
        d.variant === "error" ? "error" : d.variant === "info" ? "info" : "success";
      // Work out the title/subtitle and the little header label.
      const { title, subtitle } = splitMessage(String(d.message), d.subtitle);
      const kicker = d.kicker ? String(d.kicker) : KICKER_FALLBACK[variant];
      const id = ++counter;
      // Add the new toast, keeping only the last 3 on screen (slice(-3)).
      setToasts((t) => [...t, { id, kicker, title, subtitle, variant, mark: d.icon || MARK[variant], href: d.href }].slice(-3));
      // How long it stays: tappable links linger longest, errors a bit longer
      // than normal, everything else briefest.
      const ttl = d.href ? 6000 : variant === "error" ? 4400 : 3200;
      // After that delay, remove this toast by its id.
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
    };
    window.addEventListener("lfh:toast", onToast);
    return () => window.removeEventListener("lfh:toast", onToast);
  }, []);

  // If there are no toasts right now, draw nothing.
  if (!toasts.length) return null;

  return (
    // The stacked list of tickets. aria-live="polite" lets screen readers
    // announce new toasts without interrupting.
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {/* Draw one "order ticket" for each active toast */}
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast-ticket toast-print toast-${t.variant} ${t.href ? "toast-tappable" : ""}`}
          onClick={() => {
            // If this toast carries a link, go there when tapped...
            if (t.href) router.push(t.href);
            // ...and either way, dismiss it once clicked.
            setToasts((s) => s.filter((x) => x.id !== t.id));
          }}
        >
          {/* The tiny header label (e.g. "your order", "3d preview") */}
          <div className="toast-kicker">{t.kicker}</div>
          {/* A dashed divider line, like a torn receipt edge */}
          <div className="toast-rule" aria-hidden="true" />
          <div className="toast-body">
            {/* The symbol (✓ / ✕ / • / emoji) and the main message */}
            <span className="toast-mark">{t.mark}</span>
            <span className="toast-title">{t.title}</span>
          </div>
          {/* The small subtitle line, only if we have one */}
          {t.subtitle && <div className="toast-sub">{t.subtitle}</div>}
          <div className="toast-rule" aria-hidden="true" />
          {/* The footer: a "tap to view" hint for links, or a friendly "merci" */}
          <div className="toast-foot">{t.href ? "tap to view →" : "· merci ·"}</div>
        </button>
      ))}
    </div>
  );
}
