"use client";
// FloorLayoutPreview — "how will the floor actually LOOK at this many tables per row?"
// (owner, 2026-07-30: "a preview button … which will let me scroll the thing like phone
// brightness and it will show me on manager panel table view how it will look").
//
// The important design decision: this is NOT a drawing of the manager panel. It embeds the
// REAL manager panel (?floorpreview=1 → live floor, chrome stripped, tiles inert) and the
// slider posts the number into it. So what the admin judges IS the thing that ships — a
// hand-made mock would be free to be wrong, and the moment it drifted from the panel this
// screen would start lying.
//
// Cost: exactly one panel load per open (the iframe). Dragging the slider sends postMessage
// only — no request, no refetch, no DB write — so the whole drag from 2 to 12 costs nothing.
// Nothing is saved until "Use this number", which just hands the value to the parent form.
import { useEffect, useRef, useState } from "react";
import { FLOOR_PER_ROW_MAX, FLOOR_PER_ROW_MIN, clampPerRow } from "@/lib/floorLayout";
import { useAdminModal } from "./useAdminModal";

// The phone width the owner actually tests on (Samsung A35), so "check it on a phone" is
// one click rather than a guess.
const PHONE_W = 360;

export default function FloorLayoutPreview({
  restaurant, value, onPick, onClose,
}: {
  restaurant: { id: string; name: string };
  value: number;
  onPick: (n: number) => void;
  onClose: () => void;
}) {
  const [n, setN] = useState(() => clampPerRow(value));
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [ready, setReady] = useState(false);
  // How many columns the embedded panel ACTUALLY produced. Usually === n, but the grid
  // drops columns rather than shrink a tile past readable, so on a narrower screen the
  // answer is smaller. Showing it is the honest thing: otherwise setting 11 and seeing 8
  // looks like the setting is broken, when it's the guard rail doing its job.
  const [fits, setFits] = useState<number | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Phone Back, Escape, focus trap, scroll lock — all of it, one line.
  useAdminModal(dialogRef, "floor-layout-preview", onClose);

  // Push the number into the panel on every change (and once the panel finishes loading,
  // which may land after the first change).
  useEffect(() => {
    if (!ready) return;
    frameRef.current?.contentWindow?.postMessage(
      { type: "lfh:floor-per-row", perRow: n }, window.location.origin,
    );
  }, [n, ready]);

  // Read the resulting column count back out of the panel (same origin, so this is a plain
  // DOM read — no extra message plumbing). Delayed a frame so the grid has re-laid out.
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => {
      try {
        const grid = frameRef.current?.contentDocument?.querySelector(".ftile-grid");
        const cols = grid ? getComputedStyle(grid).gridTemplateColumns : "";
        const count = cols && cols !== "none" ? cols.split(/\s+/).filter(Boolean).length : 0;
        setFits(count || null);
      } catch { setFits(null); }
    }, 180);
    return () => clearTimeout(id);
  }, [n, ready, device]);

  // ← / → nudge by one even when the slider itself isn't focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setN((v) => Math.max(FLOOR_PER_ROW_MIN, v - 1));
      if (e.key === "ArrowRight") setN((v) => Math.min(FLOOR_PER_ROW_MAX, v + 1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Embed the panel's own iframe src, exactly as components/PanelFrame does — NOT /manager.
  // /manager's layout gate requires the admin to have "opened" a restaurant (the act-as
  // cookie), and setting that cookie just to draw a preview would silently switch which
  // restaurant every other admin panel tab is acting as. The static panel file needs no
  // such cookie, and nothing is weakened by skipping it: every /api/editor call the panel
  // makes is still authorized server-side from the admin cookie + this ?rid= (panelScope).
  const src = `/panels/editor/index.html?rid=${encodeURIComponent(restaurant.id)}&floorpreview=1`;
  const pct = ((n - FLOOR_PER_ROW_MIN) / (FLOOR_PER_ROW_MAX - FLOOR_PER_ROW_MIN)) * 100;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1200, background: "rgba(8,10,14,.72)",
        backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef} role="dialog" aria-modal="true" aria-label="Preview tables per row" tabIndex={-1}
        style={{
          width: "min(1180px, 100%)", height: "min(880px, 100%)", display: "flex", flexDirection: "column",
          background: "var(--panel, #fff)", border: "var(--border)", borderRadius: 18, overflow: "hidden",
          boxShadow: "0 30px 80px -20px rgba(0,0,0,.6)",
        }}
      >
        {/* ── head ─────────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "var(--border)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Tables per row · live preview</div>
            <div className="hint" style={{ fontSize: 12 }}>
              This is {restaurant.name}&rsquo;s real floor. Drag the slider — nothing saves until you press Use this number.
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: 10, background: "var(--bg)", border: "var(--border)" }}>
            {(["desktop", "phone"] as const).map((d) => (
              <button
                key={d} className="adm-btn" onClick={() => setDevice(d)}
                aria-pressed={device === d}
                style={{
                  padding: "5px 12px", fontSize: 12.5, borderRadius: 8, border: "none",
                  background: device === d ? "var(--panel)" : "transparent",
                  boxShadow: device === d ? "0 1px 4px rgba(0,0,0,.18)" : "none",
                  fontWeight: device === d ? 800 : 600,
                }}
              >{d === "desktop" ? "🖥 Desktop" : "📱 Phone"}</button>
            ))}
          </div>
          <button className="adm-btn" onClick={onClose} aria-label="Close preview" style={{ padding: "6px 11px" }}>✕</button>
        </div>

        {/* ── the slider: one thick track, like a phone brightness control ──── */}
        <div style={{ padding: "16px 18px 6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
              {/* Visual track. The real <input type=range> sits on top of it, invisible, so
                  the control keeps full keyboard + screen-reader behaviour for free. */}
              <div style={{
                height: 46, borderRadius: 14, overflow: "hidden", background: "var(--bg)",
                border: "var(--border)", position: "relative",
              }}>
                <div style={{
                  position: "absolute", inset: 0, width: `${pct}%`,
                  background: "linear-gradient(90deg, color-mix(in srgb, var(--accent, #b8863b) 62%, transparent), var(--accent, #b8863b))",
                  transition: "width .09s linear",
                }} />
                {/* Tick per whole number, so it's obvious the slider snaps to counts. */}
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", pointerEvents: "none" }}>
                  {Array.from({ length: FLOOR_PER_ROW_MAX - FLOOR_PER_ROW_MIN + 1 }, (_, i) => i + FLOOR_PER_ROW_MIN).map((k) => (
                    <div key={k} style={{ flex: 1, textAlign: "center", fontSize: 11, fontWeight: 800, opacity: k === n ? 0 : 0.32 }}>{k}</div>
                  ))}
                </div>
                <div style={{
                  position: "absolute", inset: 0, display: "grid", placeItems: "center",
                  fontWeight: 800, fontSize: 15, pointerEvents: "none",
                  textShadow: "0 1px 3px rgba(0,0,0,.35)", color: pct > 46 ? "#fff" : "var(--text)",
                }}>
                  {n} per row
                  {fits != null && fits !== n && (
                    <span style={{ fontWeight: 700, fontSize: 12.5, opacity: 0.9, marginLeft: 8 }}>
                      · this screen fits {fits}
                    </span>
                  )}
                </div>
              </div>
              <input
                type="range" min={FLOOR_PER_ROW_MIN} max={FLOOR_PER_ROW_MAX} step={1} value={n}
                onChange={(e) => setN(clampPerRow(e.target.value))}
                aria-label="Tables per row"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", margin: 0, opacity: 0, cursor: "ew-resize" }}
              />
            </div>
            <button className="adm-btn primary" onClick={() => { onPick(n); onClose(); }} style={{ whiteSpace: "nowrap" }}>
              Use this number
            </button>
          </div>
          <p className="hint" style={{ fontSize: 11.5, marginTop: 7 }}>
            {device === "phone"
              ? `A phone is only ${PHONE_W}px wide, so it fits what it can and ignores the rest — that is deliberate, and it is why a big number here can never break the floor on a phone.`
              : "Fewer per row = bigger boxes. A narrow window or an open side panel shows fewer than this rather than shrinking the boxes past readable."}
          </p>
        </div>

        {/* ── the real panel ───────────────────────────────────────────────── */}
        <div style={{
          flex: 1, minHeight: 0, margin: "6px 14px 14px", borderRadius: 14, overflow: "hidden",
          border: "var(--border)", background: "var(--bg)", display: "grid", placeItems: "start center",
        }}>
          <iframe
            ref={frameRef} src={src} title="Manager floor preview" onLoad={() => setReady(true)}
            style={{
              width: device === "phone" ? PHONE_W : "100%", height: "100%", border: "none",
              display: "block", background: "transparent",
              boxShadow: device === "phone" ? "0 0 0 1px var(--line, rgba(0,0,0,.12))" : "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}
