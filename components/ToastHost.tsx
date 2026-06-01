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

type Variant = "success" | "error" | "info";
interface ToastData {
  id: number;
  kicker: string;
  title: string;
  subtitle: string;
  variant: Variant;
  mark: string;
  href?: string;
}

// When a caller doesn't name the action, pick a neutral café-receipt header.
const KICKER_FALLBACK: Record<Variant, string> = {
  success: "your order",
  info: "note",
  error: "heads up",
};

// Derive a clean title + small-caps subtitle from a bare "X added"/"X updated".
function splitMessage(message: string, subtitle?: string): { title: string; subtitle: string } {
  if (subtitle != null) return { title: message, subtitle };
  const added = message.match(/^(.*?)\s+added$/i);
  if (added) return { title: added[1], subtitle: "added to order" };
  const updated = message.match(/^(.*?)\s+updated$/i);
  if (updated) return { title: updated[1], subtitle: "updated" };
  return { title: message, subtitle: "" };
}

const MARK: Record<Variant, string> = { success: "✓", error: "✕", info: "•" };

export default function ToastHost() {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const router = useRouter();

  useEffect(() => {
    let counter = 0;
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (!d.message) return;
      const variant: Variant =
        d.variant === "error" ? "error" : d.variant === "info" ? "info" : "success";
      const { title, subtitle } = splitMessage(String(d.message), d.subtitle);
      const kicker = d.kicker ? String(d.kicker) : KICKER_FALLBACK[variant];
      const id = ++counter;
      setToasts((t) => [...t, { id, kicker, title, subtitle, variant, mark: d.icon || MARK[variant], href: d.href }].slice(-3));
      const ttl = d.href ? 6000 : variant === "error" ? 4400 : 3200;
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
    };
    window.addEventListener("lfh:toast", onToast);
    return () => window.removeEventListener("lfh:toast", onToast);
  }, []);

  if (!toasts.length) return null;

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast-ticket toast-print toast-${t.variant} ${t.href ? "toast-tappable" : ""}`}
          onClick={() => {
            if (t.href) router.push(t.href);
            setToasts((s) => s.filter((x) => x.id !== t.id));
          }}
        >
          <div className="toast-kicker">{t.kicker}</div>
          <div className="toast-rule" aria-hidden="true" />
          <div className="toast-body">
            <span className="toast-mark">{t.mark}</span>
            <span className="toast-title">{t.title}</span>
          </div>
          {t.subtitle && <div className="toast-sub">{t.subtitle}</div>}
          <div className="toast-rule" aria-hidden="true" />
          <div className="toast-foot">{t.href ? "tap to view →" : "· merci ·"}</div>
        </button>
      ))}
    </div>
  );
}
