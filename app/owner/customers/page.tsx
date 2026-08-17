"use client";
// Owner · Customers — the guest list built from the `customers` table (name, phone,
// first/last seen), scoped server-side to the owner's restaurants and gated by the
// admin-controlled "customers" entitlement. READ-ONLY and money-free. A 60s backstop
// refresh (paused while hidden) keeps it fresh without a faster poll (egress rule).
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/owner/AnimatedNumber";
import { nfmt } from "@/components/owner/reports/kit";
import { asSuffix } from "@/lib/ownerPin";
import { useBackClose } from "@/lib/backStack";

const IST = "Asia/Kolkata";
type Customer = {
  restaurant_id: string; restaurantName: string; phone: string; name: string | null;
  blocked: boolean; visits: number; consent: boolean; first_seen_at: string; last_seen_at: string; returning: boolean;
};
type Summary = { total: number; returning: number; newThisMonth: number; blocked: number; shown: number };
// One guest's record: their bills here + the lifetime figures (mig 228). Money is the
// OWNER's own takings, which is why it appears on this page and not the admin's.
type Bill = { session_id: string; restaurant_id: string; bill_no: number | null; invoice_no: number | null; table_number: string | null; at: string; name: string | null; total: number };
type Detail = {
  phone: string; bills: Bill[]; bill_count: number; lifetime: number; avg_bill: number;
  first_bill: string | null; last_bill: string | null;
  rows: Array<Customer>;
};

// 10 digits read as "97376 38206" — easier to read back to a guest than one long run.
const showPhone = (p: string) => (p && p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p || "—");
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST });

export default function OwnerCustomers() {
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));

  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [rid, setRid] = useState("");                       // one of MY restaurants
  const [seg, setSeg] = useState("all");                    // all | regulars | new | blocked
  const [sort, setSort] = useState<"last_seen_at" | "visits">("last_seen_at");
  const [rests, setRests] = useState<Array<{ id: string; name: string }>>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const filt = useRef({ search, rid, seg, sort }); filt.current = { search, rid, seg, sort };
  const searchRef = useRef(search); searchRef.current = search;

  // ── REFRESH HAS TO MEAN REFRESH (sweep 6 · T14, 2026-08-18) ─────────────────────────────────────
  // The four tiles are AGGREGATES and ride the compute-on-view snapshot cache, whose change-detector
  // is `MAX(last_seen_at)` over `customers` (mig 229). That detector cannot see a guest being ADDED
  // with an older date or being ERASED — the maximum does not move — so the cache says "nothing
  // changed", bumps its timestamp and serves the OLD counts. Measured on 2026-08-18: the list showed
  // 24 guests while "Total customers" still read 23, and it stayed 23.
  // The route has always accepted `?refresh=1` to recompute live (the standing rule is "Refresh
  // forces live"), and this page was the one owner screen that never sent it — its Refresh button
  // re-read the LIST and left the tiles exactly as stale as before. Now `load(true)` forces the
  // recount, which is what the button says it does, and an erase forces one too so the guest the
  // owner just removed stops being counted.
  const load = useCallback(async (force?: boolean) => {
    try {
      const { search: sv, rid: rv, seg: gv, sort: sov } = filt.current;
      const s = sv.trim();
      const qs = [
        scopePin ? `scope=${scopePin}${asSuffix()}` : "",
        s ? `q=${encodeURIComponent(s)}` : "",
        rv ? `restaurant_id=${rv}` : "",
        gv !== "all" ? `seg=${gv}` : "",
        sov !== "last_seen_at" ? `sort=${sov}` : "",
        force ? "refresh=1" : "",
      ].filter(Boolean).join("&");
      const j = await (await fetch(`/api/owner/customers${qs ? `?${qs}` : ""}`, { cache: "no-store" })).json();
      if (j.disabled) { setDisabled(true); return; }
      if (j.error) throw new Error(j.error);
      setCustomers(j.customers || []); setSummary(j.summary || null); setErr(null);
      if (j.restaurants) setRests(j.restaurants);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [scopePin]);

  // First load is immediate; later reloads (as the owner types) are debounced. A single
  // effect handles both so mount doesn't fire TWO back-to-back requests (audit 2026-07-09).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; load(); return; }
    const t = setTimeout(() => load(), 350);
    return () => clearTimeout(t);
  }, [search, rid, seg, sort, load]);

  // 60s backstop refresh, paused while the tab is hidden (egress-safe).
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!t) t = setInterval(() => { if (!document.hidden) load(); }, 60_000); };
    const stop = () => { if (t) { clearInterval(t); t = null; } };
    const onVis = () => { if (document.hidden) stop(); else { load(); start(); } };
    start(); document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  // DPDP right-to-erasure: permanently remove a customer's record + visit history +
  // device links. Native confirm keeps it simple (no overlay to register with the
  // back-button manager). Scoped + entitlement-checked again server-side.
  const [erasing, setErasing] = useState<string | null>(null);
  const erase = useCallback(async (c: Customer) => {
    const label = c.name || c.phone || "this customer";
    // SAY WHAT SURVIVES, NOT JUST WHAT GOES (2026-08-11, T7 improvement I6). The erase correctly
    // leaves the SALES alone — a bill has to be kept for years (docs/COMPLIANCE-GUARDRAILS.md §3),
    // and the name + number were copied onto each bill when it was issued (mig 227), so they are
    // still on those bills afterwards. The button did not say so, which left an owner unable to
    // answer a guest honestly about what had actually been removed.
    if (!window.confirm(
      `Erase ${label}?\n\n`
      + `Deleted for good: their name, number, visit history and any linked devices. This can't be undone.\n\n`
      + `Kept: bills they were already named on. A bill can't be changed once it's issued — the law `
      + `requires it to be kept — so their name and number stay on those bills.`
    )) return;
    const key = `${c.restaurant_id}:${c.phone}`;
    setErasing(key);
    try {
      const r = await fetch(`/api/owner/customers${asSuffix() ? `?${asSuffix().replace(/^&/, "")}` : ""}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurant_id: c.restaurant_id, phone: c.phone }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "Couldn't erase.");
      setCustomers((prev) => (prev || []).filter((x) => !(x.restaurant_id === c.restaurant_id && x.phone === c.phone)));
      // …and recount, LIVE. Without this the guest disappears from the list while "Total customers"
      // keeps counting them — see the note on `load` above for why the snapshot cannot notice a
      // deletion on its own.
      await load(true);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setErasing(null); }
  }, [load]);

  // One guest's record: their bills here, what they've spent, and the lifetime figures.
  // Money is fine on the OWNER's page — these are their own takings. Escape closes it.
  const openDetail = useCallback(async (phone: string) => {
    setDetailBusy(true);
    try {
      const qs = [scopePin ? `scope=${scopePin}${asSuffix()}` : "", `phone=${encodeURIComponent(phone)}`].filter(Boolean).join("&");
      const j = await (await fetch(`/api/owner/customers?${qs}`, { cache: "no-store" })).json();
      if (j.error) throw new Error(j.error);
      setDetail(j.detail || null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setDetailBusy(false); }
  }, [scopePin]);
  useEffect(() => {
    if (!detail && !detailBusy) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDetail(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, detailBusy]);
  // …and the PHONE's hardware Back closes it too. Escape alone only helps on a desktop:
  // without a back-stack layer the guest record stayed open and Back navigated off the page
  // instead (project rule: every popup registers the moment it's built; found 2026-08-04).
  useBackClose("owner-customer-detail", !!detail || detailBusy, () => setDetail(null));

  const rows = customers || [];

  return (
    <>
      <h1 className="adm-page-h">Customers</h1>
      <p className="adm-page-sub">The guests who&apos;ve dined with you — when they first came, when they were last in, and who keeps coming back.</p>

      {disabled ? (
        <div className="adm-card"><div className="adm-empty">Customers isn&apos;t enabled for your restaurant — contact Aevidine.</div></div>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="adm-stats" style={{ marginBottom: 14 }}>
            <div className="adm-stat"><div className="k">Total customers</div><div className="v"><AnimatedNumber value={summary?.total ?? 0} loading={!summary} format={nfmt} /></div></div>
            <div className="adm-stat"><div className="k">Regulars (came back)</div><div className="v"><AnimatedNumber value={summary?.returning ?? 0} loading={!summary} format={nfmt} /></div></div>
            <div className="adm-stat"><div className="k">New (last 30 days)</div><div className="v"><AnimatedNumber value={summary?.newThisMonth ?? 0} loading={!summary} format={nfmt} /></div></div>
            <div className="adm-stat"><div className="k">Blocked</div><div className="v"><AnimatedNumber value={summary?.blocked ?? 0} loading={!summary} format={nfmt} /></div></div>
          </div>

          <div className="adm-card">
            <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <input className="adm-input" style={{ flex: 1, minWidth: 180 }} placeholder="Search by name or mobile…"
                value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
              {rests.length > 1 && (
                <select className="adm-input" value={rid} onChange={(e) => setRid(e.target.value)} aria-label="Restaurant" style={{ maxWidth: 200 }}>
                  <option value="">All my restaurants</option>
                  {rests.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              )}
              <div className="own-range" role="tablist" aria-label="Group">
                {[["all", "Everyone"], ["regulars", "Regulars"], ["new", "First-timers"], ["blocked", "Blocked"]].map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={seg === k} className={seg === k ? "on" : ""} onClick={() => setSeg(k)}>{label}</button>
                ))}
              </div>
              <div className="own-range" role="tablist" aria-label="Sort">
                <button role="tab" aria-selected={sort === "last_seen_at"} className={sort === "last_seen_at" ? "on" : ""} onClick={() => setSort("last_seen_at")}>Recent</button>
                <button role="tab" aria-selected={sort === "visits"} className={sort === "visits" ? "on" : ""} onClick={() => setSort("visits")}>Most visits</button>
              </div>
              {/* Refresh means "count them again now", not "re-read the same snapshot". */}
              <button className="adm-btn" onClick={() => load(true)}><i className="fas fa-rotate" aria-hidden="true" /> Refresh</button>
            </div>

            {err && (
              <div className="adm-card" style={{ borderColor: "var(--adm-danger)", margin: "0 0 12px" }}>
                <b>Couldn&apos;t load.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span>{" "}
                <button className="adm-btn" style={{ marginLeft: 6 }} onClick={() => load()}>Try again</button>
              </div>
            )}

            {customers === null && !err ? (
              <div className="adm-empty">Loading customers…</div>
            ) : rows.length === 0 ? (
              <div className="adm-empty">{search ? "No customers match that search." : "No customers yet. They appear here once guests dine in and share a name/phone."}</div>
            ) : (
              <div className="adm-tablewrap" style={{ overflow: "auto" }}>
                <table className="adm-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", fontSize: 12, color: "var(--muted)" }}>
                      <th style={{ padding: "8px 10px" }}>Name</th>
                      <th style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>Phone</th>
                      <th style={{ padding: "8px 10px", textAlign: "center" }}>Visits</th>
                      <th style={{ padding: "8px 10px" }}>Restaurant</th>
                      <th style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>First visit</th>
                      <th style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>Last visit</th>
                      <th style={{ padding: "8px 10px" }}></th>
                      <th style={{ padding: "8px 10px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={`${c.restaurant_id}:${c.phone}`} onClick={() => openDetail(c.phone)}
                        title="See this guest's visits and what they've spent"
                        style={{ borderTop: "1px solid var(--border,#e5e7eb)", opacity: c.blocked ? 0.65 : 1, cursor: "pointer" }}>
                        <td style={{ padding: "9px 10px", fontWeight: 700 }}>
                          {c.name || <span className="adm-muted">Guest</span>}
                          {c.consent && <i className="fas fa-circle-check" title="Consented to be saved" aria-label="consented" style={{ marginLeft: 6, fontSize: 11, color: "var(--adm-ok,#16a34a)" }} />}
                        </td>
                        <td style={{ padding: "9px 10px", whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}>{showPhone(c.phone)}</td>
                        <td style={{ padding: "9px 10px", textAlign: "center", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{c.visits ?? 0}</td>
                        <td style={{ padding: "9px 10px" }}><span className="adm-chip" style={{ textTransform: "none", fontWeight: 700, background: "var(--muted2)", color: "var(--text)" }}>{c.restaurantName}</span></td>
                        <td style={{ padding: "9px 10px", whiteSpace: "nowrap", fontSize: 12.5 }}>{fmt(c.first_seen_at)}</td>
                        <td style={{ padding: "9px 10px", whiteSpace: "nowrap", fontSize: 12.5 }}>{fmt(c.last_seen_at)}</td>
                        <td style={{ padding: "9px 10px" }}>
                          {c.blocked ? <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-danger,#e5484d) 16%, transparent)", color: "var(--adm-danger,#e5484d)" }}>blocked</span>
                            : c.returning ? <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-ok,#16a34a) 16%, transparent)", color: "var(--adm-ok,#16a34a)" }}>regular</span>
                            : <span className="adm-chip">new</span>}
                        </td>
                        <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                          {/* Erasing is permanent, so it stays available but quiet — muted
                              until you point at it, and it never competes with the row itself. */}
                          <button className="adm-btn cust-erase" title="Erase this customer (permanent)" aria-label={`Erase ${c.name || c.phone}`}
                            disabled={erasing === `${c.restaurant_id}:${c.phone}`}
                            onClick={(e) => { e.stopPropagation(); erase(c); }}
                            style={{ padding: "4px 9px", fontSize: 12, color: "var(--muted)", background: "transparent", border: "1px solid transparent" }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--adm-danger,#e5484d)"; e.currentTarget.style.borderColor = "color-mix(in srgb, var(--adm-danger,#e5484d) 45%, transparent)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted)"; e.currentTarget.style.borderColor = "transparent"; }}>
                            {erasing === `${c.restaurant_id}:${c.phone}` ? "…" : <i className="fas fa-trash-can" aria-hidden="true" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Only the UNFILTERED list is "the N most-recent of TOTAL" — during a search the
                    rows are matches, not the most-recent, and total is the whole-list head-count, so
                    the line would be misleading (audit 2026-07-09). Show a plain match count instead. */}
                {search ? (
                  <div className="adm-muted" style={{ fontSize: 12, marginTop: 10 }}>
                    {rows.length} match{rows.length === 1 ? "" : "es"} for “{search.trim()}”.
                  </div>
                ) : summary && summary.total > summary.shown ? (
                  <div className="adm-muted" style={{ fontSize: 12, marginTop: 10 }}>
                    Showing the {summary.shown} most-recent of {summary.total.toLocaleString("en-IN")}. Search to find an older guest.
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* ── one guest's record: visits, spend and their bills here ────────────── */}
          {(detail || detailBusy) && (
            <div onClick={() => setDetail(null)} role="dialog" aria-modal="true" aria-label="Customer record"
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", backdropFilter: "blur(3px)", zIndex: 80, display: "flex", justifyContent: "flex-end" }}>
              <div onClick={(e) => e.stopPropagation()} className="adm-card"
                style={{ width: "min(460px, 100%)", height: "100%", borderRadius: 0, overflow: "auto", padding: 22 }}>
                {!detail ? <div className="adm-empty">Loading…</div> : (
                  <>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <div>
                        <h2 style={{ fontSize: 19, margin: 0 }}>{detail.rows[0]?.name || "Guest"}</h2>
                        <div className="adm-muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
                          {detail.phone && detail.phone.length === 10 ? `${detail.phone.slice(0, 5)} ${detail.phone.slice(5)}` : detail.phone}
                        </div>
                      </div>
                      <button className="adm-btn" style={{ marginLeft: "auto", padding: "6px 11px" }} onClick={() => setDetail(null)} aria-label="Close">✕</button>
                    </div>

                    <div className="adm-stats" style={{ marginTop: 16, marginBottom: 14, gridTemplateColumns: "repeat(auto-fit, minmax(108px, 1fr))" }}>
                      <div className="adm-stat" style={{ padding: "12px 14px" }}><div className="k">Bills</div>
                        <div className="v" style={{ fontSize: 21 }}>{nfmt(detail.bill_count)}</div></div>
                      <div className="adm-stat" style={{ padding: "12px 14px" }}><div className="k">Spent with you</div>
                        <div className="v" style={{ fontSize: 21 }}>₹{nfmt(Math.round(detail.lifetime))}</div></div>
                      <div className="adm-stat" style={{ padding: "12px 14px" }}><div className="k">Average bill</div>
                        <div className="v" style={{ fontSize: 21 }}>₹{nfmt(Math.round(detail.avg_bill))}</div></div>
                    </div>

                    {detail.rows.length > 1 && (
                      <p className="hint" style={{ margin: "0 0 10px" }}>
                        This number has eaten at <b>{detail.rows.length}</b> of your restaurants.
                      </p>
                    )}
                    <div style={{ display: "grid", gap: 7, marginBottom: 16 }}>
                      {detail.rows.map((r) => (
                        <div key={r.restaurant_id} style={{ border: "var(--border)", borderRadius: 11, padding: "9px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <b style={{ fontSize: 13 }}>{r.restaurantName}</b>
                          {r.blocked && <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-danger,#e5484d) 16%, transparent)", color: "var(--adm-danger,#e5484d)" }}>blocked</span>}
                          <span className="adm-muted" style={{ marginLeft: "auto", fontSize: 12 }}>
                            {r.visits} visit{r.visits === 1 ? "" : "s"} · since {fmt(r.first_seen_at)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)", margin: "0 0 8px" }}>Their bills</h3>
                    {!detail.bills.length ? (
                      <div className="adm-empty" style={{ padding: 14 }}>
                        No bills carry this number yet. Bills start recording the guest&apos;s name and mobile
                        once the mobile is asked for at billing.
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 6 }}>
                        {detail.bills.map((b) => (
                          <div key={b.session_id} style={{ display: "flex", alignItems: "baseline", gap: 9, borderBottom: "1px solid var(--border-c,#e5e7eb)", padding: "7px 2px" }}>
                            <span style={{ fontWeight: 700, fontSize: 13 }}>{b.bill_no != null ? `#${b.bill_no}` : "—"}</span>
                            <span className="adm-muted" style={{ fontSize: 12 }}>{b.table_number ? `Table ${b.table_number}` : ""}</span>
                            <span className="adm-muted" style={{ fontSize: 12, marginLeft: "auto" }}>{fmt(b.at)}</span>
                            <b style={{ fontVariantNumeric: "tabular-nums", minWidth: 66, textAlign: "right" }}>₹{nfmt(Math.round(b.total))}</b>
                          </div>
                        ))}
                        {detail.bill_count > detail.bills.length && (
                          <div className="adm-muted" style={{ fontSize: 12, marginTop: 6 }}>
                            Showing their {detail.bills.length} most recent of {nfmt(detail.bill_count)} bills.
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
