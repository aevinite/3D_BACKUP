// lib/dialogFocus.ts — a popup that a keyboard or a screen reader can use (sweep #10 T3, round 4, item 46).
//
// Measured on the bell popup, the dish popup and the bill (2026-10-16): opening one left the focus on the
// page behind it, Tab walked straight out into the menu underneath (24–31 of 31 presses), and Escape closed
// it but dropped the focus on the page instead of the button that opened it. For a diner on a laptop
// keyboard, or with VoiceOver / TalkBack, the popup was open and they were still "on" the menu.
//
// useDialogFocus(ref, open) — while `open`:
//   · the popup's own box takes the focus (NOT its first field: on a phone that would pop the keyboard up
//     every time the bell opens), so the next Tab lands on its first control and a screen reader starts there;
//   · Tab and Shift+Tab cycle inside it;
//   · on close, the focus goes back to whatever had it before — the bell, the Customize button, the basket.
import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const box = ref.current;
    if (!box) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (!box.hasAttribute("tabindex")) box.setAttribute("tabindex", "-1");
    const frame = requestAnimationFrame(() => { if (!box.contains(document.activeElement)) box.focus({ preventScroll: true }); });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !box.isConnected) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!items.length) { e.preventDefault(); box.focus({ preventScroll: true }); return; }
      const first = items[0], last = items[items.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === first || at === box || !box.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !box.contains(at))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      // hand the focus back only if it is still in the popup or was lost with it — never steal it from
      // something the diner moved to on purpose
      const at = document.activeElement;
      if (opener && opener.isConnected && (!at || at === document.body || box.contains(at))) opener.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
