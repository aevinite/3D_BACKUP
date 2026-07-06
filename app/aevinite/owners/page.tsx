"use client";
// /aevinite/owners — manage OWNER accounts platform-wide. One owner can own
// 1..N restaurants: create the login ONCE, then attach/detach restaurants as
// chips (the old way — a dropdown buried inside each restaurant card — still
// works and stays in sync; both write the restaurant_owners join table).
// Data + writes: /api/admin/owners (admin-cookie gated, service-role).
import { useCallback, useEffect, useMemo, useState } from "react";

type OwnedRest = { id: string; slug: string; name: string; active: boolean; primary: boolean };
type Owner = {
  id: string; username: string; name: string; active: boolean;
  lastSeenAt: string | null; createdAt: string; restaurants: OwnedRest[];
};
type Rest = { id: string; slug: string; name: string; active: boolean; hasOwner: boolean };

// Same visual tokens as /aevinite/users so the two people-pages feel like siblings.
const card: React.CSSProperties = { background: "var(--card)", border: "var(--border)", borderRadius: 14, padding: 18 };
const field: React.CSSProperties = { boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, width: "100%" };
const btn = (bg: string): React.CSSProperties => ({ padding: "9px 13px", borderRadius: 9, border: 0, background: bg, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" });
const label: React.CSSProperties = { display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" };

// A stable accent per restaurant so its chip is recognisable across owners.
const CHIP_COLORS = ["#34d399", "#60a5fa", "#a78bfa", "#fb923c", "#f472b6", "#22d3ee", "#fbbf24", "#a3e635", "#f87171", "#818cf8", "#2dd4bf", "#e879f9"];
const chipColor = (id: string) => {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CHIP_COLORS[h % CHIP_COLORS.length];
};
const seen = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} h ago`;
  return `${Math.floor(m / 1440)} d ago`;
};

export default function AdminOwners() {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [rests, setRests] = useState<Rest[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  // One-time password reveal (after create or reset) — shown until dismissed.
  const [reveal, setReveal] = useState<{ name: string; password: string } | null>(null);
  // Which owner's attach-picker is open (chips + a small inline list, no modal).
  const [attachFor, setAttachFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch("/api/admin/owners", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Failed to load."); return; }
      setOwners(j.owners || []);
      setRests(j.restaurants || []);
    } catch { setErr("Network error."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function patch(payload: object): Promise<any> {
    const r = await fetch("/api/admin/owners", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Action failed.");
    return j;
  }
  const act = async (fn: () => Promise<void>) => {
    setErr(""); setBusy(true);
    try { await fn(); await load(); } catch (e: any) { setErr(e.message || "Action failed."); }
    finally { setBusy(false); }
  };

  const unowned = useMemo(() => rests.filter((r) => !r.hasOwner && r.active), [rests]);
  const kpis = useMemo(() => ({
    owners: owners.filter((o) => o.active).length,
    covered: rests.filter((r) => r.hasOwner).length,
    total: rests.length,
    multi: owners.filter((o) => o.restaurants.length > 1).length,
    suspended: owners.filter((o) => !o.active).length,
  }), [owners, rests]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 className="adm-page-h">Owners</h1>
          <p className="adm-page-sub">One owner account can own <b>1 or many</b> restaurants. Create the owner once, then attach restaurants as chips — their panel automatically shows everything they own.</p>
        </div>
        <button style={btn("#3b82f6")} onClick={() => setShowCreate(true)}>+ New owner</button>
      </div>

      {err ? <div style={{ ...card, borderColor: "#7f1d1d", color: "#fca5a5", marginBottom: 14, padding: 12 }}>{err}</div> : null}

      {/* One-time password reveal (create / reset) */}
      {reveal ? (
        <div style={{ ...card, borderColor: "#166534", marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: "#86efac" }}>Password for <b>{reveal.name}</b> — copy it now, it won&apos;t be shown again:</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <code style={{ fontSize: 18, background: "var(--bg)", padding: "8px 12px", borderRadius: 8, letterSpacing: 1 }}>{reveal.password}</code>
            <button style={btn("#3b82f6")} onClick={() => navigator.clipboard?.writeText(reveal.password)}>Copy</button>
            <button style={btn("#374151")} onClick={() => setReveal(null)}>Done</button>
          </div>
        </div>
      ) : null}

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
        <div style={{ ...card, padding: 14 }}><div style={kLb}>Active owners</div><div style={kV}>{loading ? "…" : kpis.owners}</div></div>
        <div style={{ ...card, padding: 14 }}><div style={kLb}>Restaurants covered</div><div style={kV}>{loading ? "…" : `${kpis.covered} / ${kpis.total}`}</div></div>
        <div style={{ ...card, padding: 14 }}><div style={kLb}>Multi-restaurant owners</div><div style={kV}>{loading ? "…" : kpis.multi}</div></div>
        <div style={{ ...card, padding: 14 }}><div style={kLb}>Suspended</div><div style={kV}>{loading ? "…" : kpis.suspended}</div></div>
      </div>

      {/* No-owner warning — an unowned ACTIVE restaurant has an unreachable owner panel */}
      {unowned.length > 0 && (
        <div style={{ ...card, padding: 12, marginBottom: 14, borderColor: "#b45309", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "#fcd34d" }}>⚠ No owner assigned:</span>
          {unowned.map((r) => <span key={r.id} style={{ ...chip, borderColor: "#b45309" }}><span style={{ ...dot, background: chipColor(r.id) }} />{r.name}</span>)}
          <span style={{ fontSize: 12, color: "var(--muted)" }}>— attach them to an owner below.</span>
        </div>
      )}

      {/* Owner cards */}
      {loading ? <div style={{ color: "var(--muted)" }}>Loading…</div> : owners.length === 0 ? (
        <div style={{ ...card, color: "var(--muted)" }}>No owners yet — create your first one.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 12 }}>
          {owners.map((o) => {
            const openAttach = attachFor === o.id;
            const attachable = rests.filter((r) => !o.restaurants.some((x) => x.id === r.id));
            return (
              <div key={o.id} style={{ ...card, opacity: o.active ? 1 : 0.55, display: "flex", flexDirection: "column", gap: 11 }}>
                <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
                  <div aria-hidden style={{ width: 40, height: 40, borderRadius: 11, background: `${chipColor(o.id)}33`, color: chipColor(o.id), display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15 }}>
                    {o.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}{!o.active && <span style={{ fontSize: 11, color: "#fca5a5", fontWeight: 600 }}> · suspended</span>}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>signs in as “{o.username}” · seen {seen(o.lastSeenAt)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: "#60a5fa", lineHeight: 1 }}>{o.restaurants.length}</div>
                    <div style={{ fontSize: 9.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em" }}>restaurant{o.restaurants.length === 1 ? "" : "s"}</div>
                  </div>
                </div>

                {/* Restaurant chips: × detaches, + opens the attach picker */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {o.restaurants.map((r) => (
                    <span key={r.id} style={chip} title={r.primary ? "Primary owner of this restaurant" : undefined}>
                      <span style={{ ...dot, background: chipColor(r.id) }} />{r.name}
                      <button aria-label={`Detach ${r.name}`} disabled={busy} style={xBtn}
                        onClick={() => { if (confirm(`Detach "${r.name}" from ${o.name}? They immediately stop seeing its numbers.`)) act(async () => { await patch({ owner_id: o.id, action: "detach", restaurant_id: r.id }); }); }}>×</button>
                    </span>
                  ))}
                  {o.restaurants.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>no restaurants yet</span>}
                  {o.active && (
                    <button style={{ ...chip, borderStyle: "dashed", color: "#60a5fa", cursor: "pointer", background: "transparent" }} disabled={busy}
                      onClick={() => setAttachFor(openAttach ? null : o.id)}>+ Attach</button>
                  )}
                </div>

                {/* Inline attach picker */}
                {openAttach && (
                  <div style={{ border: "var(--border)", borderRadius: 10, maxHeight: 180, overflowY: "auto" }}>
                    {attachable.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: "var(--muted)" }}>They already own every restaurant.</div>}
                    {attachable.map((r) => (
                      <button key={r.id} disabled={busy} style={{ display: "flex", gap: 9, alignItems: "center", width: "100%", padding: "9px 12px", background: "transparent", border: 0, borderTop: "var(--border)", color: "var(--text)", fontSize: 13, cursor: "pointer", textAlign: "left" }}
                        onClick={() => { setAttachFor(null); act(async () => { await patch({ owner_id: o.id, action: "attach", restaurant_id: r.id }); }); }}>
                        <span style={{ ...dot, background: chipColor(r.id) }} />
                        <span style={{ flex: 1 }}>{r.name}</span>
                        <span style={{ fontSize: 11, color: r.hasOwner ? "var(--muted)" : "#fcd34d" }}>{r.hasOwner ? "co-own" : "no owner yet"}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 7, borderTop: "var(--border)", paddingTop: 11, flexWrap: "wrap" }}>
                  {o.restaurants.length > 0 && (
                    <a style={{ ...actBtn, textDecoration: "none" }} title="Open their owner panel exactly as they see it (no password, invisible to them)"
                      href={`/api/admin/act-as/go?rid=${encodeURIComponent(o.restaurants[0].id)}&to=/owner`} target="_blank" rel="noreferrer">👁 View their panel</a>
                  )}
                  <button style={actBtn} disabled={busy}
                    onClick={() => { if (confirm(`Set a NEW password for ${o.name}? They'll be logged out everywhere.`)) act(async () => { const j = await patch({ owner_id: o.id, action: "reset_password" }); setReveal({ name: o.name, password: j.password }); }); }}>🔑 Reset password</button>
                  <button style={{ ...actBtn, color: o.active ? "#fca5a5" : "#86efac" }} disabled={busy}
                    onClick={() => { if (confirm(o.active ? `Suspend ${o.name}? They're logged out immediately and can't sign in.` : `Restore ${o.name}'s access?`)) act(async () => { await patch({ owner_id: o.id, action: "set_active", active: !o.active }); }); }}>
                    {o.active ? "⛔ Suspend" : "↩ Restore"}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateOwnerModal rests={rests}
          onClose={() => setShowCreate(false)}
          onCreated={(name, password) => { setShowCreate(false); setReveal({ name, password }); load(); }} />
      )}
    </>
  );
}

const kLb: React.CSSProperties = { fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" };
const kV: React.CSSProperties = { fontSize: 22, fontWeight: 800, marginTop: 4 };
const chip: React.CSSProperties = { display: "inline-flex", gap: 6, alignItems: "center", border: "var(--border)", borderRadius: 999, padding: "3.5px 10px", fontSize: 12, color: "var(--text)", fontWeight: 600 };
const dot: React.CSSProperties = { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 };
const xBtn: React.CSSProperties = { background: "transparent", border: 0, color: "var(--muted)", cursor: "pointer", fontSize: 13, padding: "0 0 0 2px", lineHeight: 1 };
const actBtn: React.CSSProperties = { flex: "1 1 auto", border: "var(--border)", background: "var(--bg)", borderRadius: 9, padding: "7px 8px", fontSize: 12, fontWeight: 700, color: "var(--text)", cursor: "pointer", textAlign: "center" };

// ── Create-owner modal: name + optional password + multi-select restaurants ──
function CreateOwnerModal({ rests, onClose, onCreated }: {
  rests: Rest[]; onClose: () => void; onCreated: (name: string, password: string) => void;
}) {
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await fetch("/api/admin/owners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_owner", name, password: pw, restaurant_ids: Array.from(picked) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || "Could not create owner."); return; }
      onCreated(j.name, j.password);
    } catch { setErr("Network error."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000 }} />
      <div role="dialog" aria-modal="true" aria-label="New owner" style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <form onSubmit={create} style={{ ...card, pointerEvents: "auto", width: "min(96vw, 440px)", maxHeight: "90vh", overflowY: "auto", display: "grid", gap: 13 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>New owner</div>
          {err ? <div style={{ fontSize: 12.5, color: "#fca5a5" }}>{err}</div> : null}
          <label style={label}>Owner name <span style={{ color: "var(--muted)" }}>· this is their login</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rakesh Patel" style={field} autoFocus required />
          </label>
          <label style={label}>Password (blank = auto-generated, shown once)
            <input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="leave blank to generate" autoComplete="new-password" style={field} />
          </label>
          <div style={label as React.CSSProperties}>
            Assign restaurants (pick 1 or many — you can change this any time)
            <div style={{ border: "var(--border)", borderRadius: 10, maxHeight: 220, overflowY: "auto", marginTop: 4 }}>
              {rests.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: "var(--muted)" }}>No restaurants yet.</div>}
              {rests.map((r) => {
                const on = picked.has(r.id);
                return (
                  <button type="button" key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", padding: "9px 12px", background: "transparent", border: 0, borderTop: "var(--border)", color: "var(--text)", fontSize: 13.5, cursor: "pointer", textAlign: "left" }}
                    onClick={() => setPicked((s) => { const n = new Set(s); if (on) n.delete(r.id); else n.add(r.id); return n; })}>
                    <span aria-hidden style={{ width: 17, height: 17, borderRadius: 5, border: on ? 0 : "1.5px solid var(--muted)", background: on ? "#22c55e" : "transparent", color: "#052e16", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 900, flexShrink: 0 }}>{on ? "✓" : ""}</span>
                    <span style={{ ...dot, background: chipColor(r.id) }} />
                    <span style={{ flex: 1 }}>{r.name}</span>
                    <span style={{ fontSize: 11, color: r.hasOwner ? "var(--muted)" : "#fcd34d" }}>{r.hasOwner ? "has an owner" : "no owner yet"}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={busy} style={{ ...btn("#22c55e"), flex: 1, opacity: busy ? 0.6 : 1 }}>{busy ? "Creating…" : "Create owner & show password"}</button>
            <button type="button" style={btn("#374151")} onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </>
  );
}
