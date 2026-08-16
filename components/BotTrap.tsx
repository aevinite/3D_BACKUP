"use client";
// components/BotTrap.tsx — the two invisible inputs that lib/botCheck.ts judges (2026-08-16).
//
// Drop <BotTrap /> inside a login <form> and read the two values back with botFields(formEl) —
// or, for a form that posts JSON rather than FormData, use the useBotTrap() hook.
//
// WHY A COMPONENT AND NOT TWO INLINE INPUTS: there are two login doors today (/login and
// /staff-login) and the panels add more over time. Two copies of "hide this field" CSS is how one
// of them ends up visible on a phone, and a VISIBLE trap field refuses real people — the exact
// failure this must never have. One component, one way to hide it.
//
// HOW IT IS HIDDEN, and why it is not `display:none`:
//   · Some form-filling scripts skip display:none fields (that is the well-known trick, so it is
//     the one that gets skipped). Positioning it off-screen keeps it in the layout as far as a
//     script can tell, while no person can see it.
//   · tabIndex={-1} means it cannot be reached with the Tab key, so a keyboard user never lands
//     in it.
//   · aria-hidden keeps it out of a screen reader entirely — someone using one must not be told
//     about a field they are not supposed to fill.
//   · autoComplete="off" + a name no password manager recognises keeps autofill out of it.
import { useEffect, useRef } from "react";
import { BOT_TRAP_FIELD, BOT_ELAPSED_FIELD } from "@/lib/botCheck";

const HIDDEN: React.CSSProperties = {
  position: "absolute",
  left: "-9999px",
  top: "auto",
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: "none",
};

/**
 * Renders the trap field and keeps the "form was open this long" field up to date.
 *
 * The elapsed field is written on submit-time read rather than on a timer, so it costs nothing
 * while the page sits open.
 */
export default function BotTrap() {
  const msRef = useRef<HTMLInputElement>(null);
  const mounted = useRef<number>(Date.now());

  useEffect(() => {
    mounted.current = Date.now();
    // Keep the value current without a render: a form left open for ten minutes should say so.
    const write = () => { if (msRef.current) msRef.current.value = String(Date.now() - mounted.current); };
    write();
    const id = setInterval(write, 500);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={HIDDEN} aria-hidden="true">
      <input
        type="text"
        name={BOT_TRAP_FIELD}
        defaultValue=""
        tabIndex={-1}
        autoComplete="off"
        // A real person never gets here, so nothing needs a label.
      />
      <input ref={msRef} type="text" name={BOT_ELAPSED_FIELD} defaultValue="0" tabIndex={-1} autoComplete="off" />
    </div>
  );
}

/** Read the two values out of a submitted <form> element, for a fetch that posts JSON. */
export function botFields(form: HTMLFormElement | null): { trap: string; elapsed: string } {
  if (!form) return { trap: "", elapsed: "" };
  const fd = new FormData(form);
  return {
    trap: String(fd.get(BOT_TRAP_FIELD) ?? ""),
    elapsed: String(fd.get(BOT_ELAPSED_FIELD) ?? ""),
  };
}
