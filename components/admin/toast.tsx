"use client";
// One shared toast for the whole admin panel, so every page reports success/failure the same
// way instead of each hand-rolling its own (audit 2026-07-07). Mounted once in the admin
// layout; any page calls `const toast = useToast(); toast("Saved")` or `toast("Failed","err")`.
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "ok" | "err";
type Item = { id: number; msg: string; kind: Kind };
type ToastFn = (msg: string, kind?: Kind) => void;

const ToastCtx = createContext<ToastFn>(() => {});
export function useToast(): ToastFn { return useContext(ToastCtx); }

export function AdminToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  // THE FILL TOKENS, NOT THE TEXT TOKENS (sweep #10 T39 item 38). --adm-ok / --adm-danger are the
  // bright TEXT colours of the dark skin (#34d399 / #f87171); under white ink they made every admin
  // toast 1.9:1 (green) or 2.8:1 (red). The -fill tokens carry white at 5.0:1 and 4.9:1 — the same
  // answer the buttons got (item 28 and 2026-08-29). verify:css-tokens holds both.
  const toast = useCallback<ToastFn>((msg, kind = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div aria-live="polite" style={{ position: "fixed", left: "50%", bottom: "calc(24px + env(safe-area-inset-bottom, 0px))", transform: "translateX(-50%)", zIndex: 2000, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none", maxWidth: "calc(100vw - 24px)" }}>
        {items.map((t) => (
          <div key={t.id} role="status" style={{ background: t.kind === "err" ? "var(--adm-danger-fill, #d92d20)" : "var(--adm-ok-fill, #15803d)", color: "#fff", padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, boxShadow: "0 6px 24px rgba(0,0,0,0.25)" }}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
