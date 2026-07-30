"use client";
// ONE honest "Copy" button for the admin pages.
//
// Two things a copy button must never do:
//   1. CRASH. `navigator.clipboard?.writeText(x)` with no catch is an unhandled promise
//      rejection the moment the browser refuses — which is exactly what raised a red
//      "Failed to execute 'writeText' on 'Clipboard': Write permission denied" row in the
//      Everything Log (2026-07-29, same flaw the inventory order-list had in #543).
//   2. LIE. The reveal it sits next to is a ONE-TIME password. Saying nothing when the copy
//      silently failed means the admin pastes whatever was on the clipboard before into a
//      staff account and locks that person out of their panel.
//
// Why a copy can fail even though the button looks fine: `navigator.clipboard` exists only
// in a SECURE context (https or localhost), so an admin opening the panel on a plain-http
// LAN address (http://192.168.x.x:4000 — how staff tablets reach it) has no clipboard API at
// all; and even where it exists the browser can deny the write when the document isn't
// focused. So: try the API, fall back to the legacy textarea copy (which does work on plain
// http), and if BOTH fail, say so and let them select the text by hand — it's on screen
// right next to this button.
import { useEffect, useRef, useState } from "react";

// Returns true ONLY when the text really reached the clipboard, so callers can be truthful.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* denied / not focused / no permission — try the legacy path below */
  }
  try {
    // Off-screen textarea + execCommand("copy"): deprecated, but it's the only path that
    // works without a secure context, and it's what inventory.js already falls back to.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand?.("copy") ?? false;
    ta.remove();
    return !!ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  text, className, style, label = "Copy",
}: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<number | null>(null);
  // Don't leave a timer running into an unmounted component (the reveal banner closes).
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const onClick = async () => {
    const ok = await copyText(text);
    setState(ok ? "ok" : "fail");
    if (timer.current) window.clearTimeout(timer.current);
    // A failure stays up much longer than a success — it's an instruction, not a tick.
    timer.current = window.setTimeout(() => setState("idle"), ok ? 1600 : 7000);
  };

  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={onClick}
      aria-live="polite"
      title={state === "fail" ? "Your browser blocked the clipboard — select the text and copy it by hand" : "Copy to clipboard"}
    >
      {state === "ok" ? "Copied ✓" : state === "fail" ? "Couldn't copy — select it by hand" : label}
    </button>
  );
}
