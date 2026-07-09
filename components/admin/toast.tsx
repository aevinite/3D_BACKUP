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
  const toast = useCallback<ToastFn>((msg, kind = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div aria-live="polite" style={{ position: "fixed", left: "50%", bottom: "calc(24px + env(safe-area-inset-bottom, 0px))", transform: "translateX(-50%)", zIndex: 2000, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
        {items.map((t) => (
          <div key={t.id} role="status" style={{ background: t.kind === "err" ? "var(--adm-danger, #e5484d)" : "var(--adm-ok, #2e9e6b)", color: "#fff", padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, boxShadow: "0 6px 24px rgba(0,0,0,0.25)" }}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
