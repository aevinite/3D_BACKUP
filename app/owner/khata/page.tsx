"use client";
// Owner · Pay Later — the khata liability view: who owes money across the owner's
// restaurant(s), each person's open bills, and how much pay-later money was collected
// today / this month (by collection day). READ-ONLY; collecting happens in the manager
// panel. Scoped + module-gated server-side (see /api/owner/khata). 60s backstop refresh
// paused while hidden (egress rule); a search filters the loaded list client-side.
import { useCallback, useEffect, useRef, useState } from "react";
import { inr } from "@/components/admin/shared";

const IST = "Asia/Kolkata";
type Bill = { bill_no: number | null; table_number: string | null; khata_at: string; amount: number };
type Person = {
  id: string; restaurant_id: string; restaurantName: string; name: string; phone: string | null;
  note: string | null; outstanding: number; billCount: number; oldestKhataAt: string; bills: Bill[];
};
type Summary = { totalOutstanding: number; peopleCount: number; billCount: number; collectedMonth: number; collectedToday: number };

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
const ageDays = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`;
};

export default function OwnerKhata() {
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));

  const [customers, setCustomers] = useState<Person[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const multi = new Set((customers || []).map((c) => c.restaurant_id)).size > 1;

  const load = useCallback(async () => {
    try {
      const qs = scopePin ? `?scope=${scopePin}` : "";
      const j = await (await fetch(`/api/owner/khata${qs}`, { cache: "no-store" })).json();
      if (j.error) throw new Error(j.error);
      setCustomers(j.customers || []); setSummary(j.summary || null); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [scopePin]);

  useEffect(() => { load(); }, [load]);
  // 60s backstop refresh, paused while hidden (egress-safe).
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!t) t = setInterval(() => { if (!document.hidden) load(); }, 60_000); };
    const stop = () => { if (t) { clearInterval(t); t = null; } };
    const onVis = () => { if (document.hidden) stop(); else { load(); start(); } };
    start(); document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const q = search.trim().toLowerCase();
  const rows = (customers || []).filter((c) =>
    !q || (c.name || "").toLowerCase().includes(q) || (c.phone || "").toLowerCase().includes(q));
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <>
      <h1 className="adm-page-h">Pay Later</h1>
      <p className="adm-page-sub">Money guests still owe on a tab, and how much you&apos;ve collected. Staff collect a tab from the manager panel; this is your live view of what&apos;s outstanding.</p>

      <div className="adm-stats" style={{ marginBottom: 14 }}>
        <div className="adm-stat"><div className="k">Outstanding now</div><div className="v">{summary ? inr(summary.totalOutstanding) : "…"}</div></div>
        <div className="adm-stat"><div className="k">People who owe</div><div className="v">{summary ? summary.peopleCount.toLocaleString("en-IN") : "…"}</div></div>
        <div className="adm-stat"><div className="k">Collected today</div><div className="v">{summary ? inr(summary.collectedToday) : "…"}</div></div>
        <div className="adm-stat"><div className="k">Collected this month</div><div className="v">{summary ? inr(summary.collectedMonth) : "…"}</div></div>
      </div>

      <div className="adm-card">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <input className="adm-input" style={{ flex: 1, minWidth: 200 }} placeholder="Search by name or phone…"
            value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search people who owe" />
          <button className="adm-btn" onClick={() => load()}><i className="fas fa-rotate" aria-hidden="true" /> Refresh</button>
        </div>

        {err && (
          <div className="adm-card" style={{ borderColor: "var(--adm-danger)", margin: "0 0 12px" }}>
            <b>Couldn&apos;t load.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span>{" "}
            <button className="adm-btn" style={{ marginLeft: 6 }} onClick={() => load()}>Try again</button>
          </div>
        )}

        {customers === null && !err ? (
          <div className="adm-empty">Loading Pay Later…</div>
        ) : rows.length === 0 ? (
          <div className="adm-empty">{q ? "No one matches that search." : "No one owes anything right now. Parked (pay-later) bills show up here until they're collected."}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((c) => (
              <div key={c.id} className="adm-card" style={{ margin: 0, padding: 0, overflow: "hidden" }}>
                <button onClick={() => toggle(c.id)} aria-expanded={open.has(c.id)}
                  style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
                    background: "transparent", border: 0, color: "inherit", padding: "12px 14px", cursor: "pointer" }}>
                  <i className={`fas fa-chevron-${open.has(c.id) ? "down" : "right"}`} aria-hidden="true" style={{ fontSize: 12, opacity: 0.6 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                    <div className="adm-muted" style={{ fontSize: 12.5 }}>
                      {c.phone || "no mobile"}{c.note ? ` · ${c.note}` : ""}
                      {multi ? <> · <span className="adm-chip">{c.restaurantName}</span></> : null}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    <div style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{inr(c.outstanding)}</div>
                    <div className="adm-muted" style={{ fontSize: 11.5 }}>{c.billCount} bill{c.billCount === 1 ? "" : "s"} · oldest {ageDays(c.oldestKhataAt)}</div>
                  </div>
                </button>
                {open.has(c.id) && (
                  <div style={{ borderTop: "1px solid var(--border,#e5e7eb)", padding: "6px 14px 12px 38px" }}>
                    {c.bills.map((b, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", fontSize: 13,
                        borderBottom: i < c.bills.length - 1 ? "1px solid color-mix(in srgb, var(--border,#e5e7eb) 55%, transparent)" : "0" }}>
                        <span style={{ flex: 1 }} className="adm-muted">
                          {b.bill_no != null ? <b style={{ color: "var(--text,inherit)" }}>#{b.bill_no}</b> : "Bill"}{" · "}{fmt(b.khata_at)}{" · T"}{b.table_number || "?"}
                        </span>
                        <b style={{ fontVariantNumeric: "tabular-nums" }}>{inr(b.amount)}</b>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
