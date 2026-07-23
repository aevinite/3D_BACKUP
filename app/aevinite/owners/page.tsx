"use client";
// /aevinite/owners — manage OWNER accounts platform-wide. One owner can own
// 1..N restaurants: create the login ONCE, then attach/detach restaurants as
// chips (the old way — a dropdown buried inside each restaurant card — still
// works and stays in sync; both write the restaurant_owners join table).
// Data + writes: /api/admin/owners (admin-cookie gated, service-role).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminModal } from "@/components/admin/useAdminModal";

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
  const [reveal, setReveal] = useState<{ name: string; password: string; warn?: string } | null>(null);
  // Which owner's attach-picker is open (chips + a small inline list, no modal).
  const [attachFor, setAttachFor] = useState<string | null>(null);
  // Which owner's DETAIL view is open (click anywhere on a card): profile,
  // full activity trail, "their screen" jump, and the permanent-delete zone.
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const detailOwner = owners.find((o) => o.id === detailFor) || null;
  const [busy, setBusy] = useState(false);
  // Search filters owner cards by owner name, their login, or any restaurant they own
  // (helpful once there are many owners — admin audit 2026-07-07).
  const [query, setQuery] = useState("");

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
  const filteredOwners = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return owners;
    return owners.filter((o) =>
      o.name.toLowerCase().includes(q) ||
      o.username.toLowerCase().includes(q) ||
      o.restaurants.some((r) => r.name.toLowerCase().includes(q)));
  }, [owners, query]);
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

      {owners.length > 6 && (
        <div style={{ position: "relative", margin: "12px 0 4px" }}>
          <i className="fas fa-magnifying-glass" aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 13 }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search owners by name, login, or restaurant…"
            aria-label="Search owners" style={{ ...field, paddingLeft: 34 }} />
        </div>
      )}

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
          {reveal.warn && <div style={{ fontSize: 12, color: "#fcd34d", marginTop: 8 }}>{reveal.warn}</div>}
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
          <span style={{ fontSize: 13, color: "#fcd34d" }}><i className="fas fa-triangle-exclamation" style={{ marginRight: 7 }} aria-hidden="true" />No owner assigned:</span>
          {unowned.map((r) => <span key={r.id} style={{ ...chip, borderColor: "#b45309" }}><span style={{ ...dot, background: chipColor(r.id) }} />{r.name}</span>)}
          <span style={{ fontSize: 12, color: "var(--muted)" }}>— attach them to an owner below.</span>
        </div>
      )}

      {/* Owner cards */}
      {loading ? <div style={{ color: "var(--muted)" }}>Loading…</div> : owners.length === 0 ? (
        <div style={{ ...card, color: "var(--muted)" }}>No owners yet — create your first one.</div>
      ) : filteredOwners.length === 0 ? (
        <div style={{ ...card, color: "var(--muted)" }}>No owners match “{query}”.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 12 }}>
          {filteredOwners.map((o) => {
            const openAttach = attachFor === o.id;
            const attachable = rests.filter((r) => !o.restaurants.some((x) => x.id === r.id));
            return (
              /* The WHOLE card is clickable → owner detail (activity, created-when,
                 delete zone). Inner buttons stopPropagation so they keep working. */
              <div key={o.id} role="button" tabIndex={0} onClick={() => setDetailFor(o.id)}
                onKeyDown={(e) => { if (e.key === "Enter") setDetailFor(o.id); }}
                style={{ ...card, opacity: o.active ? 1 : 0.55, display: "flex", flexDirection: "column", gap: 11, cursor: "pointer" }}>
                <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
                  <div aria-hidden style={{ width: 40, height: 40, borderRadius: 11, background: `${chipColor(o.id)}33`, color: chipColor(o.id), display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15 }}>
                    {o.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}{!o.active && <span style={{ fontSize: 11, color: "#fca5a5", fontWeight: 600 }}> · suspended</span>}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>seen {seen(o.lastSeenAt)}</div>
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
                        onClick={(e) => { e.stopPropagation(); if (confirm(`Detach "${r.name}" from ${o.name}? They immediately stop seeing its numbers.`)) act(async () => { await patch({ owner_id: o.id, action: "detach", restaurant_id: r.id }); }); }}><i className="fas fa-xmark" aria-hidden="true" /></button>
                    </span>
                  ))}
                  {o.restaurants.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>no restaurants yet</span>}
                  {o.active && (
                    <button style={{ ...chip, borderStyle: "dashed", color: "#60a5fa", cursor: "pointer", background: "transparent", padding: "7px 11px" }} disabled={busy}
                      onClick={(e) => { e.stopPropagation(); setAttachFor(openAttach ? null : o.id); }}><i className="fas fa-plus" style={{ marginRight: 5, fontSize: 10 }} aria-hidden="true" />Attach</button>
                  )}
                </div>

                {/* Inline attach picker */}
                {openAttach && (
                  <div style={{ border: "var(--border)", borderRadius: 10, maxHeight: 180, overflowY: "auto" }}>
                    {attachable.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: "var(--muted)" }}>They already own every restaurant.</div>}
                    {attachable.map((r) => (
                      <button key={r.id} disabled={busy} style={{ display: "flex", gap: 9, alignItems: "center", width: "100%", padding: "9px 12px", background: "transparent", border: 0, borderTop: "var(--border)", color: "var(--text)", fontSize: 13, cursor: "pointer", textAlign: "left" }}
                        onClick={(e) => { e.stopPropagation(); setAttachFor(null); act(async () => { await patch({ owner_id: o.id, action: "attach", restaurant_id: r.id }); }); }}>
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
                      href={`/api/admin/act-as/go?rid=${encodeURIComponent(o.restaurants[0].id)}&to=/owner`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><i className="fas fa-eye" style={ic} aria-hidden="true" />View their panel</a>
                  )}
                  <button style={actBtn} disabled={busy}
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Set a NEW password for ${o.name}? They'll be logged out everywhere.`)) act(async () => { const j = await patch({ owner_id: o.id, action: "reset_password" }); setReveal({ name: o.name, password: j.password }); }); }}><i className="fas fa-key" style={ic} aria-hidden="true" />Reset password</button>
                  <button style={{ ...actBtn, color: o.active ? "#fca5a5" : "#86efac" }} disabled={busy}
                    onClick={(e) => { e.stopPropagation(); if (confirm(o.active ? `Suspend ${o.name}? They're logged out immediately and can't sign in.` : `Restore ${o.name}'s access?`)) act(async () => { await patch({ owner_id: o.id, action: "set_active", active: !o.active }); }); }}>
                    <i className={`fas ${o.active ? "fa-ban" : "fa-rotate-left"}`} style={ic} aria-hidden="true" />{o.active ? "Suspend" : "Restore"}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateOwnerModal rests={rests}
          onClose={() => setShowCreate(false)}
          onCreated={(name, password, attachErrors) => { setShowCreate(false); setReveal({ name, password, warn: attachErrors && attachErrors.length ? `Heads-up: ${attachErrors.length} restaurant(s) couldn't be attached — add them from the owner's card.` : undefined }); load(); }} />
      )}

      {detailOwner && (
        <OwnerDetailModal owner={detailOwner} rests={rests}
          onClose={() => setDetailFor(null)}
          onChanged={load}
          onDeleted={() => { setDetailFor(null); load(); }}
          onPatch={patch} />
      )}
    </>
  );
}

const kLb: React.CSSProperties = { fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" };
const kV: React.CSSProperties = { fontSize: 22, fontWeight: 800, marginTop: 4 };
const chip: React.CSSProperties = { display: "inline-flex", gap: 6, alignItems: "center", border: "var(--border)", borderRadius: 999, padding: "3.5px 10px", fontSize: 12, color: "var(--text)", fontWeight: 600 };
const dot: React.CSSProperties = { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 };
// Detach/remove (×) — padded to a ~29px finger-friendly hit area (was ~12px, too
// small to tap on a phone; admin mobile audit 2026-07-07). marginRight offsets the
// padding so the chip doesn't grow much on the trailing edge.
const xBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", border: 0, color: "var(--muted)", cursor: "pointer", fontSize: 13, padding: 8, marginRight: -6, borderRadius: 8, lineHeight: 1 };
const actBtn: React.CSSProperties = { flex: "1 1 auto", border: "var(--border)", background: "var(--bg)", borderRadius: 9, padding: "7px 8px", fontSize: 12, fontWeight: 700, color: "var(--text)", cursor: "pointer", textAlign: "center" };
// Leading-icon spacing for the action buttons (icons replace the old emojis).
const ic: React.CSSProperties = { marginRight: 6, fontSize: 11 };

// ── Create-owner modal: name + optional password + multi-select restaurants ──
function CreateOwnerModal({ rests, onClose, onCreated }: {
  rests: Rest[]; onClose: () => void; onCreated: (name: string, password: string, attachErrors?: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Synchronous re-entry guard — a fast double-click (or Enter-hold) fires create() twice
  // before the async `busy` state disables the button, which minted TWO owners / raced the
  // name-taken check (audit 2026-07-07). A ref flips instantly, in the same tick.
  const creatingRef = useRef(false);
  // One line: phone Back + Escape close it, focus is trapped inside, and the page behind
  // is frozen while it's open.
  const dialogRef = useRef<HTMLDivElement>(null);
  useAdminModal(dialogRef, "admin-new-owner", onClose);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (creatingRef.current) return;
    creatingRef.current = true;
    setErr(""); setBusy(true);
    try {
      const r = await fetch("/api/admin/owners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_owner", name, password: pw, restaurant_ids: Array.from(picked) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || "Could not create owner."); return; }
      onCreated(j.name, j.password, j.attachErrors);
    } catch { setErr("Network error."); }
    finally { setBusy(false); creatingRef.current = false; }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000 }} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="New owner" style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <form onSubmit={create} style={{ ...card, pointerEvents: "auto", width: "min(96vw, 440px)", maxHeight: "90vh", overflowY: "auto", display: "grid", gap: 13 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>New owner</div>
          {err ? <div style={{ fontSize: 12.5, color: "#fca5a5" }}>{err}</div> : null}
          <label style={label}>Username <span style={{ color: "var(--muted)" }}>· this is their login</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rakesh Patel" style={field} autoFocus required />
          </label>
          <label style={label}>Password (blank = auto-generated, shown once)
            <div style={{ position: "relative" }}>
              <input type={showPw ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="leave blank to generate" autoComplete="new-password" style={{ ...field, paddingRight: 44 }} />
              <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? "Hide password" : "Show password"} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "transparent", border: 0, color: "var(--muted)", cursor: "pointer", fontSize: 16, padding: 6 }}>
                {showPw ? "🙈" : "👁️"}
              </button>
            </div>
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
                    <span aria-hidden style={{ width: 17, height: 17, borderRadius: 5, border: on ? 0 : "1.5px solid var(--muted)", background: on ? "#22c55e" : "transparent", color: "#052e16", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 900, flexShrink: 0 }}>{on ? <i className="fas fa-check" /> : null}</span>
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

// ─────────────────────────────────────────────────────────────────────────────
// Owner DETAIL modal (owner rule 2026-07-06: "the owner thing should be
// clickable"). One focused place per owner: who they are + when the account was
// created, their full activity trail (their logins/actions AND what the admin
// did to them), a jump to "their screen" (act-as), and the permanent-delete
// zone — which only unlocks AFTER the account is suspended, and can't be undone.
// Activity is fetched ONCE per open (no polling).
// ─────────────────────────────────────────────────────────────────────────────
type ActivityRow = { id: string; panel: string; action: string; actor: string | null; detail: string | null; restaurant: string | null; at: string };

const PANEL_COLOR: Record<string, string> = { owner: "#34d399", admin: "#60a5fa", manager: "#d4a574", kitchen: "#7ec88a", tablet: "#a78bfa", editor: "#d4a574" };

function OwnerDetailModal({ owner, rests, onClose, onChanged, onDeleted, onPatch }: {
  owner: Owner; rests: Rest[]; onClose: () => void; onChanged: () => void; onDeleted: () => void;
  onPatch: (payload: object) => Promise<any>;
}) {
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [created, setCreated] = useState<string | null>(owner.createdAt || null);
  const [mErr, setMErr] = useState("");
  const [busy, setBusy] = useState(false);
  // Show the one-time reset password INSIDE this modal — the page-level banner
  // renders behind the modal overlay, so the admin couldn't see/copy it (audit 2026-07-08).
  const [pwReveal, setPwReveal] = useState<string | null>(null);
  // Add-restaurant picker (inline, no nested modal). The list is driven by the
  // live `owner` prop, so after attach/detach → onChanged reloads → this recomputes.
  const [showAttach, setShowAttach] = useState(false);
  const attachable = rests.filter((r) => !owner.restaurants.some((x) => x.id === r.id));
  const dialogRef = useRef<HTMLDivElement>(null);
  useAdminModal(dialogRef, "admin-owner-detail", onClose);

  useEffect(() => {
    let dead = false;
    fetch(`/api/admin/owners?id=${encodeURIComponent(owner.id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (dead) return; setActivity(j.activity || []); if (j.owner?.createdAt) setCreated(j.owner.createdAt); })
      .catch(() => { if (!dead) setActivity([]); });
    return () => { dead = true; };
  }, [owner.id]);

  const run = async (fn: () => Promise<void>) => {
    setMErr(""); setBusy(true);
    try { await fn(); onChanged(); } catch (e: any) { setMErr(e.message || "Action failed."); }
    finally { setBusy(false); }
  };

  const attachRestaurant = (rid: string) => { setShowAttach(false); run(async () => { await onPatch({ owner_id: owner.id, action: "attach", restaurant_id: rid }); }); };
  const detachRestaurant = (r: OwnedRest) => {
    if (!confirm(`Remove "${r.name}" from ${owner.name}? They immediately stop seeing its numbers.`)) return;
    run(async () => { await onPatch({ owner_id: owner.id, action: "detach", restaurant_id: r.id }); });
  };

  // Permanent delete: suspend-first is enforced server-side too; the typed-name
  // confirm makes "gone forever" a deliberate act, not a slip.
  async function deleteForever() {
    if (!confirm(`Delete ${owner.name} FOREVER?\n\nThis cannot be undone — no restore, no recycle bin. Their restaurants fall back to a co-owner or to "no owner". The activity log is kept.`)) return;
    const typed = prompt(`Type their username (${owner.username}) to confirm the permanent delete:`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== owner.username.toLowerCase()) { setMErr("Username didn't match — nothing was deleted."); return; }
    setMErr(""); setBusy(true);
    try {
      const r = await fetch(`/api/admin/owners?id=${encodeURIComponent(owner.id)}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Delete failed.");
      onDeleted();
    } catch (e: any) { setMErr(e.message || "Delete failed."); setBusy(false); }
  }

  const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000 }} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Owner ${owner.name}`} style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div style={{ ...card, pointerEvents: "auto", width: "min(96vw, 560px)", maxHeight: "92vh", overflowY: "auto", padding: 0 }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: "var(--border)", position: "sticky", top: 0, background: "var(--card)", borderRadius: "14px 14px 0 0", zIndex: 1 }}>
            <div aria-hidden style={{ width: 42, height: 42, borderRadius: 11, background: `${chipColor(owner.id)}33`, color: chipColor(owner.id), display: "grid", placeItems: "center", fontWeight: 800, fontSize: 16 }}>
              {owner.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {owner.name}{!owner.active && <span style={{ fontSize: 11, color: "#fca5a5", fontWeight: 600 }}> · suspended</span>}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                created {created ? new Date(created).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"} · seen {seen(owner.lastSeenAt)}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: 0, color: "var(--muted)", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 6 }}><i className="fas fa-xmark" aria-hidden="true" /></button>
          </div>

          <div style={{ padding: 18, display: "grid", gap: 14 }}>
            {mErr ? <div style={{ ...card, padding: 12, borderColor: "#7f1d1d", color: "#fca5a5" }}>{mErr}</div> : null}

            {/* Quick actions — "their screen" first, that's the owner's ask */}
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {owner.restaurants.length > 0 && (
                <a style={{ ...actBtn, textDecoration: "none", color: "#60a5fa" }} title="Open their owner panel exactly as they see it (no password, invisible to them)"
                  href={`/api/admin/act-as/go?rid=${encodeURIComponent(owner.restaurants[0].id)}&to=/owner`} target="_blank" rel="noreferrer"><i className="fas fa-eye" style={ic} aria-hidden="true" />Open their screen</a>
              )}
              <button style={actBtn} disabled={busy}
                onClick={() => { if (confirm(`Set a NEW password for ${owner.name}? They'll be logged out everywhere.`)) run(async () => { const j = await onPatch({ owner_id: owner.id, action: "reset_password" }); setPwReveal(j.password); }); }}><i className="fas fa-key" style={ic} aria-hidden="true" />Reset password</button>
              <button style={actBtn} disabled={busy}
                onClick={() => { const nn = prompt(`New username for ${owner.name} (this is their login):`, owner.name); if (nn && nn.trim() && nn.trim() !== owner.name) run(async () => { await onPatch({ owner_id: owner.id, action: "rename", name: nn.trim() }); }); }}><i className="fas fa-pen" style={ic} aria-hidden="true" />Rename</button>
              <button style={{ ...actBtn, color: owner.active ? "#fca5a5" : "#86efac" }} disabled={busy}
                onClick={() => { if (confirm(owner.active ? `Suspend ${owner.name}? They're logged out immediately and can't sign in.` : `Restore ${owner.name}'s access?`)) run(async () => { await onPatch({ owner_id: owner.id, action: "set_active", active: !owner.active }); }); }}>
                <i className={`fas ${owner.active ? "fa-ban" : "fa-rotate-left"}`} style={ic} aria-hidden="true" />{owner.active ? "Suspend" : "Restore"}</button>
            </div>

            {/* One-time reset password — shown HERE inside the modal so it's actually
                visible/copyable (the page-level banner sits behind the modal overlay,
                audit 2026-07-08). */}
            {pwReveal ? (
              <div style={{ ...card, padding: 12, borderColor: "#166534", background: "rgba(22,101,52,.08)" }}>
                <div style={{ fontSize: 12.5, color: "#86efac" }}>New password for <b>{owner.name}</b> — copy it now, it won&apos;t be shown again:</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                  <code style={{ fontSize: 17, background: "var(--bg)", padding: "8px 12px", borderRadius: 8, letterSpacing: 1 }}>{pwReveal}</code>
                  <button style={btn("#3b82f6")} onClick={() => navigator.clipboard?.writeText(pwReveal)}>Copy</button>
                  <button style={btn("#374151")} onClick={() => setPwReveal(null)}>Done</button>
                </div>
              </div>
            ) : null}

            {/* Restaurants — fully managed HERE (add + remove), owner request 2026-07-06.
                Each chip has a remove (×); "Add restaurant" opens an inline picker. */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", flex: 1 }}>Owns {owner.restaurants.length} restaurant{owner.restaurants.length === 1 ? "" : "s"}</div>
                <button style={{ ...chip, borderStyle: "dashed", color: "#60a5fa", cursor: "pointer", background: "transparent", padding: "7px 11px" }} disabled={busy}
                  onClick={() => setShowAttach((s) => !s)}>
                  <i className={`fas ${showAttach ? "fa-xmark" : "fa-plus"}`} style={{ fontSize: 10 }} aria-hidden="true" />{showAttach ? "Close" : "Add restaurant"}</button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {owner.restaurants.map((r) => (
                  <span key={r.id} style={chip} title={r.primary ? "Primary owner of this restaurant" : undefined}>
                    {r.primary && <i className="fas fa-star" style={{ fontSize: 9, color: "#fbbf24" }} aria-hidden="true" />}
                    <span style={{ ...dot, background: chipColor(r.id) }} />{r.name}
                    <button aria-label={`Remove ${r.name}`} disabled={busy} style={xBtn} onClick={() => detachRestaurant(r)}><i className="fas fa-xmark" aria-hidden="true" /></button>
                  </span>
                ))}
                {owner.restaurants.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>none yet — add one below</span>}
              </div>

              {/* Add-restaurant picker */}
              {showAttach && (
                <div style={{ border: "var(--border)", borderRadius: 10, maxHeight: 200, overflowY: "auto", marginTop: 8 }}>
                  {attachable.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: "var(--muted)" }}>They already own every restaurant.</div>}
                  {attachable.map((r) => (
                    <button key={r.id} disabled={busy} style={{ display: "flex", gap: 9, alignItems: "center", width: "100%", padding: "9px 12px", background: "transparent", border: 0, borderTop: "var(--border)", color: "var(--text)", fontSize: 13, cursor: "pointer", textAlign: "left" }}
                      onClick={() => attachRestaurant(r.id)}>
                      <i className="fas fa-plus" style={{ fontSize: 10, color: "#60a5fa" }} aria-hidden="true" />
                      <span style={{ ...dot, background: chipColor(r.id) }} />
                      <span style={{ flex: 1 }}>{r.name}</span>
                      <span style={{ fontSize: 11, color: r.hasOwner ? "var(--muted)" : "#fcd34d" }}>{r.hasOwner ? "co-own" : "no owner yet"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Activity trail */}
            <div>
              <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 7 }}>Activity — what they did &amp; what was done to them</div>
              <div style={{ border: "var(--border)", borderRadius: 10, maxHeight: 300, overflowY: "auto" }}>
                {activity === null && <div style={{ padding: 12, fontSize: 12.5, color: "var(--muted)" }}>Loading activity…</div>}
                {activity?.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: "var(--muted)" }}>No recorded activity yet.</div>}
                {activity?.map((a) => (
                  <div key={a.id} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "8px 12px", borderTop: "var(--border)", fontSize: 12.5 }}>
                    <span style={{ flexShrink: 0, marginTop: 3, width: 7, height: 7, borderRadius: "50%", background: PANEL_COLOR[a.panel] || "#9ca3af" }} title={a.panel} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontWeight: 700 }}>{a.action.replace(/_/g, " ")}</span>
                      {a.actor ? <span style={{ color: "var(--muted)" }}> · by {a.actor}</span> : null}
                      {a.restaurant ? <span style={{ color: "var(--muted)" }}> · {a.restaurant}</span> : null}
                      {a.detail ? <div style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.detail}>{a.detail}</div> : null}
                    </div>
                    <span style={{ flexShrink: 0, color: "var(--muted)", fontSize: 11 }} title={a.at}>{when(a.at)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Danger zone — delete unlocks ONLY after suspension, and is forever. */}
            <div style={{ ...card, padding: 14, borderColor: "#7f1d1d", background: "rgba(127,29,29,.06)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fca5a5", marginBottom: 6 }}>Danger zone</div>
              {owner.active ? (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  To delete this owner forever, <b>suspend them first</b> (the reversible step). Once deleted there is NO restore.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                    This owner is suspended. Deleting is <b>permanent</b> — no restore, ever. Their restaurants fall to a co-owner or become &ldquo;no owner&rdquo;; the activity log above is kept for the record.
                  </div>
                  <button style={btn("#991b1b")} disabled={busy} onClick={deleteForever}><i className="fas fa-trash-can" style={ic} aria-hidden="true" />Delete forever</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
