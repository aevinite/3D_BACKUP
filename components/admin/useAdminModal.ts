"use client";
// useAdminModal — the ONE line every admin pop-up should call. It wires up, in the right way,
// everything a modal needs so no future modal can get any of them wrong (audit 2026-07-07):
//   • phone hardware Back closes it (registers with the app back-stack) — CLAUDE.md rule;
//   • Escape closes it;
//   • focus moves INTO the dialog on open, Tab is trapped inside, and focus returns to
//     whatever was focused before when it closes (accessibility / keyboard users);
//   • the real scroll area behind it (.adm-main on desktop, .adm on mobile) is frozen so the
//     page doesn't scroll under your finger while the modal is open.
// Usage: give the dialog element a ref, then `useAdminModal(ref, "unique-id", onClose)`.
//
// `backLayer: false` — FOR A MODAL THAT IS ACTUALLY A PAGE (T13 handoff H3, 2026-08-19).
// lib/backStack.ts says it plainly in its own header: "Real PAGES already have their own address,
// so the browser handles their back for free — they need nothing here." Registering a layer for a
// page gives ONE visible sheet TWO back-steps, and the first press then does nothing at all.
// Measured before this existed, on the owner's /owner/staff/<id>: press 1 changed nothing, press 2
// returned to the roster. Every other caller of this hook is a true overlay opened over a page
// without navigating, so the default stays `true` and none of them change.
import { useEffect, useRef } from "react";
import { useBackClose } from "@/lib/backStack";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useAdminModal(
  dialogRef: React.RefObject<HTMLElement | null>,
  id: string,
  onClose: () => void,
  opts?: { backLayer?: boolean },
) {
  // Phone Back → close (self-contained; works without the guest root dialog). Skipped when this
  // "modal" is really a route: the browser's own history entry is already the back-step, and adding
  // ours on top is what made the first press dead. See the note above.
  useBackClose(id, opts?.backLayer !== false, onClose);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const el = dialogRef.current;
    const prevFocus = document.activeElement as HTMLElement | null;
    const focusables = () => (el ? Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)) : []);
    // Move focus into the dialog (first field, else the dialog itself).
    (focusables()[0] || el)?.focus?.();

    // Freeze the real scroll container(s) behind the modal, not just <body> (which isn't the
    // admin scrollport, so locking body alone did nothing).
    const ports = Array.from(document.querySelectorAll<HTMLElement>(".adm-main, .adm"));
    const prevOverflow = ports.map((p) => p.style.overflow);
    ports.forEach((p) => (p.style.overflow = "hidden"));
    const prevBody = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { closeRef.current(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      ports.forEach((p, i) => (p.style.overflow = prevOverflow[i]));
      document.body.style.overflow = prevBody;
      prevFocus?.focus?.();
    };
    // Run once for the modal's lifetime (it mounts when opened, unmounts when closed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
