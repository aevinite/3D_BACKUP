"use client";
// Admin · Customers — every guest on the platform, in one list, each row tagged with the
// restaurant they belong to (owner, 2026-07-30). Built from the app's own admin components
// (.adm-card / .adm-stat / .adm-chip / .adm-input) so it wears the admin skin in both
// light and dark without a single new colour.
//
// MONEY-FREE ON PURPOSE. The admin panel never shows a restaurant's earnings, so this page
// shows counts, dates and which restaurant — never spend. Money for a guest lives in the
// OWNER's Customers page, for their own restaurants.
//
// Egress: the server pages 50 rows at a time, searches and filters in the database, and the
// per-restaurant spread is ONE grouped read (mig 228). A 60s backstop refresh, paused while
// the tab is hidden.
import { useCallback, useEffect, useRef, useState } from "react";
import { SkelList } from "@/components/admin/Skeleton";
import { useAdminModal } from "@/components/admin/useAdminModal";
// The console's own "how long ago" — minutes, not days. See the note at the "counted" stamp below.
import { timeAgo, istDate, IST } from "@/components/admin/shared";


type Customer = {
  restaurant_id: string; restaurantName: string; phone: string; name: string | null;
  blocked: boolean; visits: number; consent: boolean;
  first_seen_at: string; last_seen_at: string; returning: boolean;
};
type Summary = { total: number; regulars: number; blocked: number; newThisMonth: number; matched: number; page: number; pageSize: number };
type Spread = { id: string; name: string; count: number; regulars: number };
type Detail = {
  phone: string; name: string | null; totalVisits: number; blockedAnywhere: boolean;
  restaurants: Array<{ restaurant_id: string; restaurantName: string; visits: number; blocked: boolean; consent: boolean; first_seen_at: string; last_seen_at: string; name: string | null }>;
};

const SEGMENTS = [
  { k: "all", label: "Everyone" },
  { k: "regulars", label: "Regulars" },
  { k: "new", label: "First-timers" },
  { k: "blocked", label: "Blocked" },
] as const;

// dfmt was this page's own copy of "4 Jul 27". It is `istDate` in components/admin/shared.tsx now —
// Platform revenue needed the same format for its Next-due column, and two copies of a date format
// is how two screens come to write the same day differently (T18 sweep #7, item 6).
const dfmt = istDate;
const ago = (iso: string | null) => {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400e3);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  if (d < 365) return `${Math.round(d / 30)} mo ago`;
  return `${Math.round(d / 365)} yr ago`;
};
const nfmt = (n: number) => (n || 0).toLocaleString("en-IN");
const showPhone = (p: string) => (p && p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p || "—");

export default function AdminCustomers() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [spread, setSpread] = useState<Spread[]>([]);
  const [spreadTotal, setSpreadTotal] = useState(0);   // how many restaurants HAVE guests, not how many bars fit
  const [rests, setRests] = useState<Array<{ id: string; name: string }>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [rid, setRid] = useState("");
  const [seg, setSeg] = useState<string>("all");
  const [sort, setSort] = useState<"last_seen_at" | "visits">("last_seen_at");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);   // when the tiles were counted

  const q = useRef({ search, rid, seg, sort, page });
  q.current = { search, rid, seg, sort, page };

  // ONLY THE NEWEST ANSWER MAY LAND (sweep #8 T23, 2026-09-06).
  //
  // This list is asked for again on every keystroke (debounced 320ms), on every filter, segment,
  // sort and page change, on the 60-second backstop and on every return to the tab — so several
  // requests are in flight routinely, each for DIFFERENT rows. Nothing sequenced them, so whichever
  // REPLY arrived last won, regardless of what the screen was asking for.
  //
  // Measured on this page before this guard, at 1280x900 with the "9" reply held back 3 seconds:
  // typing "9" and then "zzzzzzzz" showed the right answer ("Nobody matches") for a moment, and
  // then FIFTY guests appeared under a search box reading "zzzzzzzz". Nothing on screen said the
  // table was answering an older question. The same coin-flip decides which page of a paged list
  // you get after two quick taps of Next.
  //
  // The identical fault was found and fixed on Platform analytics (T18, 2026-08-20 — a 30-day
  // label over the 7-day number); this is its sibling screen, and it is the same remedy: a
  // monotonic token, not an AbortController, because the losing request may well be warming the
  // snapshot cache for another tab — we let it finish and simply refuse to WRITE its reply.
  const reqSeq = useRef(0);

  const load = useCallback(async (opts?: { force?: boolean }) => {
    const mine = ++reqSeq.current;
    try {
      const { search: s, rid: r, seg: g, sort: so, page: p } = q.current;
      const qs = new URLSearchParams();
      if (opts?.force) qs.set("refresh", "1");
      if (s.trim()) qs.set("q", s.trim());
      if (r) qs.set("restaurant_id", r);
      if (g !== "all") qs.set("seg", g);
      if (so !== "last_seen_at") qs.set("sort", so);
      if (p) qs.set("page", String(p));
      const j = await (await fetch(`/api/admin/customers?${qs}`, { cache: "no-store" })).json();
      if (mine !== reqSeq.current) return;          // a newer question is being asked — drop this
      if (j.error) throw new Error(j.error);
      setCustomers(j.customers || []);
      setSummary(j.summary || null);
      setSpread(j.spread || []);
      setSpreadTotal(Number(j.spreadTotal) || (j.spread || []).length);
      setCachedAt(j.cachedAt || null);
      if (j.restaurants) setRests(j.restaurants);
      setErr(null);
    } catch (e) {
      // A stale FAILURE is just as wrong as a stale list: it would put "Couldn't load" over rows
      // that loaded perfectly well a moment later.
      if (mine !== reqSeq.current) return;
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // First load immediate; typing is debounced. One effect for both, so mounting doesn't
  // fire two requests back to back.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; load(); return; }
    const t = setTimeout(load, 320);
    return () => clearTimeout(t);
  }, [search, rid, seg, sort, page, load]);

  // 60s backstop, paused while hidden (egress rule).
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!t) t = setInterval(() => { if (!document.hidden) load(); }, 60_000); };
    const stop = () => { if (t) { clearInterval(t); t = null; } };
    const onVis = () => { if (document.hidden) stop(); else { load(); start(); } };
    start(); document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  // The drawer: one number's whole story across every restaurant it appears in — the
  // cross-restaurant view only the admin gets. Escape closes it.
  const openDetail = useCallback(async (phone: string) => {
    setDetailBusy(true);
    try {
      const j = await (await fetch(`/api/admin/customers?phone=${encodeURIComponent(phone)}`, { cache: "no-store" })).json();
      if (j.error) throw new Error(j.error);
      setDetail(j.detail || null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setDetailBusy(false); }
  }, []);
  // ONE LINE, NOT FOUR HAND-ROLLED ONES (T18 sweep, 2026-08-20). This drawer was the only overlay
  // in the admin console that did not call useAdminModal — the hook whose own header says it exists
  // so "no future modal can get any of them wrong". It hand-rolled an Escape listener and stopped
  // there, so it got none of the other three. Measured at 360x780 before this: pressing the phone's
  // hardware BACK left the Customers page entirely (about:blank) instead of closing the drawer;
  // focus never entered the drawer, so a keyboard user was still tabbing the table behind it; and
  // the page scrolled under a finger while the drawer was open. The sibling OwnerChooser on the
  // Dashboard has had the hook since 2026-07-25. Rendered below in <CustomerDrawer/> because the
  // hook needs a ref to a mounted dialog, which means the dialog has to be its own component.

  const rows = customers || [];
  const maxSpread = Math.max(1, ...spread.map((s) => s.count));
  const shownFrom = (summary?.page ?? 0) * (summary?.pageSize ?? 50) + 1;
  const shownTo = Math.min((summary?.matched ?? 0), shownFrom + rows.length - 1);
  const hasMore = (summary?.matched ?? 0) > shownTo;

  const reset = (fn: () => void) => { setPage(0); fn(); };

  return (
    <>
      {/* A focusable row with no visible focus ring is worse than one that cannot be reached at
          all — the person tabbing has no idea where they are. `:focus-visible` only, so a mouse
          click never paints it, and the ring is drawn INSIDE the row (outline-offset: -2px)
          because a table row's outline would otherwise be clipped by the scrolling wrapper. The
          accent token is the same one every other focus ring in the console uses. */}
      <style>{`
        tr.cust-row:focus-visible {
          outline: 2px solid var(--accent, #6366f1);
          outline-offset: -2px;
          background: color-mix(in srgb, var(--accent, #6366f1) 8%, transparent);
        }
      `}</style>
      <h1 className="adm-page-h">Customers</h1>
      <p className="adm-page-sub">
        Every guest across every restaurant, and which restaurant they belong to. Counts and dates only —
        a restaurant&apos;s takings stay in their own owner panel.
      </p>

      <div className="adm-stats">
        <div className="adm-stat"><div className="ic"><i className="fas fa-users" aria-hidden="true" /></div>
          <div className="k">{rid ? "Guests here" : "Guests platform-wide"}</div><div className="v">{nfmt(summary?.total ?? 0)}</div></div>
        <div className="adm-stat"><div className="ic"><i className="fas fa-repeat" aria-hidden="true" /></div>
          <div className="k">Came back (2+ visits)</div><div className="v">{nfmt(summary?.regulars ?? 0)}</div>
          {summary && summary.total > 0 && <div className="k" style={{ marginTop: 2 }}>{Math.round((summary.regulars / summary.total) * 100)}% of guests</div>}</div>
        <div className="adm-stat"><div className="ic"><i className="fas fa-user-plus" aria-hidden="true" /></div>
          <div className="k">New in 30 days</div><div className="v">{nfmt(summary?.newThisMonth ?? 0)}</div></div>
        <div className="adm-stat"><div className="ic"><i className="fas fa-ban" aria-hidden="true" /></div>
          <div className="k">Blocked</div><div className="v">{nfmt(summary?.blocked ?? 0)}</div></div>
      </div>

      {spread.length > 1 && (
        <div className="adm-card" style={{ marginBottom: 14 }}>
          <h2>Where the guests are</h2>
          {/* A LIST THAT QUIETLY ENDS IS A LIST HE CANNOT ADD UP (owner, 2026-08-31 — item 9). The
              server caps the bars at 8; below that the card said nothing either way, so a ninth
              restaurant with guests was dropped with no sign of it. Says so only when something IS
              hidden — the same wording and the same rule as the busiest-restaurants card on
              Platform analytics. */}
          <p className="hint">
            How many saved guests each restaurant has. Tap one to filter the list.
            {spreadTotal > spread.length
              ? ` Showing the ${spread.length} with the most guests, of ${spreadTotal} restaurants that have any.`
              : ""}
          </p>
          <div style={{ display: "grid", gap: 7 }}>
            {spread.map((s) => (
              <button key={s.id} type="button" onClick={() => reset(() => setRid(rid === s.id ? "" : s.id))}
                style={{
                  display: "grid", gridTemplateColumns: "minmax(90px, 150px) 1fr 74px", gap: 10, alignItems: "center",
                  background: rid === s.id ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
                  border: rid === s.id ? "1px solid color-mix(in srgb, var(--accent) 45%, transparent)" : "1px solid transparent",
                  borderRadius: 10, padding: "6px 8px", cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit",
                }}>
                <span style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                <span style={{ height: 9, borderRadius: 6, background: "var(--muted2)", overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${Math.max(3, Math.round((s.count / maxSpread) * 100))}%`, background: "var(--accent-grad, var(--accent))", borderRadius: 6 }} />
                </span>
                <span className="adm-muted" style={{ fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  <b style={{ color: "var(--text)" }}>{nfmt(s.count)}</b> · {nfmt(s.regulars)} reg
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="adm-card">
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <input className="adm-input" style={{ flex: 1, minWidth: 190 }} placeholder="Search name or mobile…"
            value={search} onChange={(e) => reset(() => setSearch(e.target.value))} aria-label="Search customers" />
          <select className="adm-input" value={rid} onChange={(e) => reset(() => setRid(e.target.value))} aria-label="Restaurant"
            style={{ maxWidth: 210 }}>
            <option value="">All restaurants</option>
            {rests.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="own-range" role="tablist" aria-label="Segment">
            {SEGMENTS.map((s) => (
              <button key={s.k} role="tab" aria-selected={seg === s.k} className={seg === s.k ? "on" : ""}
                onClick={() => reset(() => setSeg(s.k))}>{s.label}</button>
            ))}
          </div>
          <div className="own-range" role="tablist" aria-label="Sort">
            <button role="tab" aria-selected={sort === "last_seen_at"} className={sort === "last_seen_at" ? "on" : ""}
              onClick={() => reset(() => setSort("last_seen_at"))}>Recent</button>
            <button role="tab" aria-selected={sort === "visits"} className={sort === "visits" ? "on" : ""}
              onClick={() => reset(() => setSort("visits"))}>Most visits</button>
          </div>
          <button className="adm-btn" onClick={() => load({ force: true })} title="Recount the tiles from live data">
            <i className="fas fa-rotate" aria-hidden="true" /> Refresh
          </button>
          {/* THE STAMP HAS TO BE ABLE TO SAY A TIME (T18 sweep #7, item 4). This used the page's own
              `ago()`, which answers in DAYS because it was written for a guest's last visit — its
              first branch is `if (d <= 0) return "today"`. The tiles behind it are a snapshot the
              cache treats as fresh for five minutes and the page re-reads every sixty seconds, so
              this line could only ever read "counted today", on every open, forever. Platform
              analytics and Platform revenue both say "updated just now" / "updated 4m ago" from the
              shared `timeAgo`, with the exact IST time on hover; this is the same stamp, so it is
              now the same helper. */}
          {cachedAt && (
            <span className="adm-muted" style={{ fontSize: 11.5 }}
              title={new Date(cachedAt).toLocaleString("en-IN", { timeZone: IST })}>
              counted {timeAgo(cachedAt)}
            </span>
          )}
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
          <div className="adm-empty">
            {search.trim() ? `Nobody matches “${search.trim()}”.` : seg !== "all" ? "Nobody in this group yet." : "No guests saved yet. They appear the moment a bill is made out to a name and number."}
          </div>
        ) : (
          <div style={{ overflow: "auto" }}>
            <table className="adm-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, color: "var(--muted)" }}>
                  <th style={{ padding: "8px 10px" }}>Guest</th>
                  <th style={{ padding: "8px 10px" }}>Restaurant</th>
                  <th style={{ padding: "8px 10px", textAlign: "center" }}>Visits</th>
                  <th style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>First seen</th>
                  <th style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>Last seen</th>
                  <th style={{ padding: "8px 10px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  // THE ROW OPENS FROM THE KEYBOARD TOO (owner, 2026-08-20). This is the only door
                  // into a guest's cross-restaurant record — "Meera has eaten at 3 of our
                  // restaurants" — and it was reachable with a mouse and nothing else: no tab stop,
                  // no Enter, and a screen reader announced a plain table cell. `role="button"` on
                  // a <tr> would throw away the row/column semantics that make the table readable,
                  // so the row keeps being a row and simply becomes focusable and answers the two
                  // keys that mean "open this": Enter and Space. Space is preventDefault-ed or the
                  // page scrolls underneath the drawer as it opens.
                  <tr key={`${c.restaurant_id}:${c.phone}`}
                    onClick={() => openDetail(c.phone)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      openDetail(c.phone);
                    }}
                    className="cust-row"
                    aria-label={`Open the record for ${c.name || "this guest"}, ${showPhone(c.phone)}`}
                    style={{ borderTop: "1px solid var(--border-c, #e5e7eb)", opacity: c.blocked ? 0.6 : 1, cursor: "pointer" }}
                    title="See this guest's full record">
                    <td style={{ padding: "9px 10px" }}>
                      <div style={{ fontWeight: 700 }}>
                        {c.name || <span className="adm-muted">Guest</span>}
                        {c.consent && <i className="fas fa-circle-check" title="Agreed to be saved" style={{ marginLeft: 6, fontSize: 10.5, color: "var(--adm-ok,#16a34a)" }} />}
                      </div>
                      <div className="adm-muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{showPhone(c.phone)}</div>
                    </td>
                    <td style={{ padding: "9px 10px" }}><span className="adm-chip" style={{ textTransform: "none", fontWeight: 700, background: "var(--muted2)", color: "var(--text)" }}>{c.restaurantName}</span></td>
                    <td style={{ padding: "9px 10px", textAlign: "center", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{c.visits ?? 0}</td>
                    <td style={{ padding: "9px 10px", whiteSpace: "nowrap", fontSize: 12.5 }}>{dfmt(c.first_seen_at)}</td>
                    <td style={{ padding: "9px 10px", whiteSpace: "nowrap", fontSize: 12.5 }}>
                      {dfmt(c.last_seen_at)}<div className="adm-muted" style={{ fontSize: 11.5 }}>{ago(c.last_seen_at)}</div>
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      {c.blocked ? <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-danger,#e5484d) 16%, transparent)", color: "var(--adm-danger,#e5484d)" }}>blocked</span>
                        : c.returning ? <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-ok,#16a34a) 16%, transparent)", color: "var(--adm-ok,#16a34a)" }}>regular</span>
                        : <span className="adm-chip" style={{ background: "var(--muted2)", color: "var(--muted)" }}>first visit</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <span className="adm-muted" style={{ fontSize: 12 }}>
                {summary ? `Showing ${nfmt(shownFrom)}–${nfmt(shownTo)} of ${nfmt(summary.matched)}` : ""}
              </span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button className="adm-btn" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Back</button>
                <button className="adm-btn" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next →</button>
              </span>
            </div>
          </div>
        )}
      </div>

      {(detail || detailBusy) && <CustomerDrawer detail={detail} onClose={() => setDetail(null)} />}

    </>
  );
}

// The guest's own record: every restaurant this number has eaten at — the cross-restaurant view
// only the admin gets. Its own component so `useAdminModal` has a mounted dialog to hold: that one
// call gives it the phone Back button, Escape, focus moving in and back out, Tab trapped inside,
// and the scroll port behind it frozen (T18 sweep, 2026-08-20 — it had only Escape before).
function CustomerDrawer({ detail, onClose }: { detail: Detail | null; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  useAdminModal(cardRef, "admin-customer-detail", onClose);
  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label="Customer record"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", backdropFilter: "blur(3px)", zIndex: 80, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} ref={cardRef} tabIndex={-1} className="adm-card"
        style={{ width: "min(460px, 100%)", height: "100%", borderRadius: 0, overflow: "auto", padding: 22 }}>
        {!detail ? <SkelList rows={4} label="Loading customer" /> : (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div>
                <h2 style={{ fontSize: 19 }}>{detail.name || "Guest"}</h2>
                <div className="adm-muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>{showPhone(detail.phone)}</div>
              </div>
              <button className="adm-btn" style={{ marginLeft: "auto", padding: "6px 11px" }} onClick={onClose} aria-label="Close">✕</button>
            </div>

            <div className="adm-stats" style={{ marginTop: 16, marginBottom: 14, gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}>
              <div className="adm-stat" style={{ padding: "12px 14px" }}><div className="k">Visits</div><div className="v" style={{ fontSize: 21 }}>{nfmt(detail.totalVisits)}</div></div>
              <div className="adm-stat" style={{ padding: "12px 14px" }}><div className="k">Restaurants</div><div className="v" style={{ fontSize: 21 }}>{detail.restaurants.length}</div></div>
              <div className="adm-stat" style={{ padding: "12px 14px" }}><div className="k">Status</div>
                <div className="v" style={{ fontSize: 15, marginTop: 7 }}>{detail.blockedAnywhere ? "Blocked somewhere" : "Fine"}</div></div>
            </div>

            {detail.restaurants.length > 1 && (
              <p className="hint" style={{ margin: "0 0 10px" }}>
                This number eats at <b>{detail.restaurants.length}</b> of our restaurants — a picture only you can see here;
                each owner only ever sees their own row.
              </p>
            )}

            <div style={{ display: "grid", gap: 9 }}>
              {detail.restaurants.map((r) => (
                <div key={r.restaurant_id} style={{ border: "var(--border)", borderRadius: 12, padding: "11px 13px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <b style={{ fontSize: 13.5 }}>{r.restaurantName}</b>
                    {r.blocked && <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-danger,#e5484d) 16%, transparent)", color: "var(--adm-danger,#e5484d)" }}>blocked</span>}
                    <span className="adm-muted" style={{ marginLeft: "auto", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{r.visits} visit{r.visits === 1 ? "" : "s"}</span>
                  </div>
                  <div className="adm-muted" style={{ fontSize: 12, marginTop: 5 }}>
                    Known as <b style={{ color: "var(--text)" }}>{r.name || "Guest"}</b> · first {dfmt(r.first_seen_at)} · last {dfmt(r.last_seen_at)} ({ago(r.last_seen_at)})
                  </div>
                </div>
              ))}
            </div>

            <p className="hint" style={{ marginTop: 16 }}>
              Erasing a guest is the owner&apos;s call, from their own Customers page — it wipes the record,
              the visit history and any linked devices for that restaurant.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
