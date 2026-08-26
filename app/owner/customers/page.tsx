"use client";
// Owner · Customers — the guest list built from the `customers` table (name, phone,
// first/last seen), scoped server-side to the owner's restaurants and gated by the
// admin-controlled "customers" entitlement. READ-ONLY and money-free. A 60s backstop
// refresh (paused while hidden) keeps it fresh without a faster poll (egress rule).
// ── `--border` IS A WHOLE BORDER, NOT A COLOUR (sweep 6 · T14, 2026-08-18) ───────────────────────
// `app/globals.css` declares `--border: 1px solid #1d2430`. So every `1px solid var(--border)` in
// this file expanded to `1px solid 1px solid #1d2430`, which is not a valid declaration — the
// browser threw the whole line away. MEASURED, not guessed: the computed value of the customers
// table's row separator was `0px none`, the ratings bar's track computed to `rgba(0,0,0,0)`, and the
// "empty" half of a star row computed to the SAME amber as the filled half.
// That last one is the one that mattered: every rating on the Feedback screen drew FIVE GOLD STARS,
// so a 1★ complaint and a 5★ compliment looked identical. No text check could ever have caught it —
// the `aria-label` said "1 out of 5" the whole time, which is exactly why it survived every sweep.
// `--border-c` is the declared COLOUR (`#1d2430` dark, `#e5e8ee` light). Use that where a colour is
// wanted, and the bare `var(--border)` shorthand where a whole border is wanted.
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/owner/AnimatedNumber";
import { nfmt } from "@/components/owner/reports/kit";
import { asSuffix } from "@/lib/ownerPin";
import { useBackClose } from "@/lib/backStack";
// Client-safe by design (lib/partialRead has zero imports) — see the header of that file for why it
// is not lib/ownerScope. Pay Later has shown this note since August; this screen never did.
import { partialNote } from "@/lib/partialRead";

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

// One summary figure. When it names a `seg` it is a real button that puts the list on that
// segment — and it says so, both to a screen reader (aria-pressed) and to the eye (the pointer,
// a soft outline while it is the active one). Without a `seg` it is exactly the tile it always was.
function Tile({ label, value, loading, seg, on, pick }: {
  label: string; value?: number; loading: boolean;
  seg?: string; on?: string; pick?: (s: string) => void;
}) {
  const body = (
    <>
      <div className="k">{label}</div>
      <div className="v"><AnimatedNumber value={value ?? 0} loading={loading} format={nfmt} /></div>
    </>
  );
  if (!seg || !pick) return <div className="adm-stat">{body}</div>;
  const active = on === seg;
  return (
    <button type="button" className="adm-stat" aria-pressed={active}
      title={`Show ${label.toLowerCase()}`}
      onClick={() => pick(seg)}
      style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit",
        outline: active ? "2px solid var(--accent, #16a34a)" : undefined, outlineOffset: -2 }}>
      {body}
    </button>
  );
}

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
  // ── WHICH FIGURE COULD NOT BE READ, SAID OUT LOUD (sweep 6 · T14, 2026-08-18) ───────────────────
  // The route reports `partial: ["restaurantNames"]` when the brand lookup failed. Nothing here read
  // it, so every row's restaurant chip simply showed "—" and an owner with three restaurants was
  // left staring at a list that had stopped telling him whose guests they were, with no reason
  // given and nothing to press. Cleared on every load, so a passing blip disappears by itself.
  const [partial, setPartial] = useState<string[]>([]);
  // ── ON A PHONE THE LIST IS CARDS, NOT AN EIGHT-COLUMN TABLE (owner, 2026-08-18) ─────────────────
  // "We can do the eleventh one, but it will be showing in a customer tab only where all the history
  // of, like, number and all that data has been stored at that tab only."
  // So the phone list carries only what identifies a guest — name, number, how many visits, whether
  // they are a regular or blocked — and the DATES move into that guest's own record, which is one
  // tap away and is where their whole history already lives. Before this, four of the eight columns
  // (first visit, last visit, the chip and the erase button) sat off the right edge behind a
  // sideways scroll nobody signposted. Measured with matchMedia rather than a CSS breakpoint because
  // every style on this page is inline; the list only renders after the first load, so there is no
  // wrong-shape flash to see.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setNarrow(mq.matches);
    sync(); mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
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
      setPartial(Array.isArray(j.partial) ? j.partial : []);
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
  // ── CLOSING IT WHILE IT LOADS HAS TO WORK (sweep 6 · T14, 2026-08-18) ──────────────────────────
  // The drawer is on screen from the moment the row is tapped (`detail || detailBusy`), but every
  // way of closing it only cleared `detail`. So during the second or two the record is loading —
  // which on a phone on a restaurant's wifi is the whole of the interaction — Escape, the ✕, the
  // backdrop and the phone's own Back all did NOTHING VISIBLE, and then the record opened anyway,
  // on top of the owner who had just asked for it to go away. Watched happen on 2026-08-18: pressing
  // Escape right after the tap left the drawer up. That is a tap vanishing in silence, which this
  // project does not allow.
  // The same counter fixes a second, quieter fault: tapping guest A and then guest B raced the two
  // replies, so a slow A could land last and show A's bills under B's name. Every request carries
  // its sequence number and only the current one is allowed to render.
  const detailSeq = useRef(0);
  const closeDetail = useCallback(() => {
    detailSeq.current += 1;      // whatever is in flight is now nobody's business
    setDetail(null);
    setDetailBusy(false);
  }, []);
  const openDetail = useCallback(async (phone: string) => {
    const mine = ++detailSeq.current;
    setDetailBusy(true);
    try {
      const qs = [scopePin ? `scope=${scopePin}${asSuffix()}` : "", `phone=${encodeURIComponent(phone)}`].filter(Boolean).join("&");
      const j = await (await fetch(`/api/owner/customers?${qs}`, { cache: "no-store" })).json();
      if (mine !== detailSeq.current) return;          // closed, or another guest was opened
      if (j.error) throw new Error(j.error);
      setDetail(j.detail || null);
    } catch (e) { if (mine === detailSeq.current) setErr(e instanceof Error ? e.message : String(e)); }
    finally { if (mine === detailSeq.current) setDetailBusy(false); }
  }, [scopePin]);
  useEffect(() => {
    if (!detail && !detailBusy) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDetail(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, detailBusy, closeDetail]);
  // …and the PHONE's hardware Back closes it too. Escape alone only helps on a desktop:
  // without a back-stack layer the guest record stayed open and Back navigated off the page
  // instead (project rule: every popup registers the moment it's built; found 2026-08-04).
  useBackClose("owner-customer-detail", !!detail || detailBusy, closeDetail);

  const rows = customers || [];

  // ── THE LINE UNDER THE LIST HAS TO BE ABOUT THE LIST YOU ARE LOOKING AT (sweep 7 · T14) ─────────
  // It read `summary.total > summary.shown`, and `summary.total` is the head-count of EVERY guest in
  // scope — it knows nothing about which group tab is open. So on "Blocked", with both blocked
  // guests on screen, it said *"Showing the 2 most-recent of 26. Search to find an older guest."*
  // Measured on French House 2026-08-27: Regulars 13 of 13 and Blocked 2 of 2 both carried it. An
  // owner reads that as "24 more blocked guests are hidden from me", goes looking, and finds nothing.
  // Every group has an exact head-count already in the reply, so each one can be asked its own
  // question: Everyone → total · Regulars → visits ≥ 2 · Blocked → blocked · First-timers →
  // total − regulars (both are head-counts over the same scope, so the subtraction is exact).
  // The tiles ride the 5-minute snapshot while the list is live, so a stale tile can read LOWER than
  // the rows on screen — hence `> rows.length`, never `!==`: the line appears only when there really
  // is something past the end.
  const LIST_PAGE = 300;   // /api/owner/customers → .limit(300)
  const segTotal = !summary ? null
    : seg === "regulars" ? summary.returning
    : seg === "blocked" ? summary.blocked
    : seg === "new" ? Math.max(0, summary.total - summary.returning)
    : summary.total;
  const segNoun = seg === "regulars" ? " regulars" : seg === "blocked" ? " blocked" : seg === "new" ? " first-timers" : "";
  // One footer, rendered by both the phone list and the desktop table, so the two cannot drift.
  // A plain function, not a component: a component declared inside render is a new type on every
  // render (React remounts it, and `react-hooks/static-components` fails the lint on it).
  const listFoot = (gap: number) => {
    if (search.trim()) return (
      <div className="adm-muted" style={{ fontSize: 12, marginTop: gap }}>
        {rows.length} match{rows.length === 1 ? "" : "es"} for “{search.trim()}”.
      </div>
    );
    // Nothing is hidden unless the read actually HIT the cap — and the tiles ride a 5-minute
    // snapshot while the list is live, so without this a tile one guest ahead of the list would
    // print the line on a page that is showing everybody.
    if (rows.length < LIST_PAGE || segTotal === null || segTotal <= rows.length) return null;
    return (
      <div className="adm-muted" style={{ fontSize: 12, marginTop: gap }}>
        Showing the {rows.length} most-recent of {segTotal.toLocaleString("en-IN")}{segNoun}. Search to find an older guest.
      </div>
    );
  };

  return (
    <>
      <h1 className="adm-page-h">Customers</h1>
      <p className="adm-page-sub">The guests who&apos;ve dined with you — when they first came, when they were last in, and who keeps coming back.</p>

      {disabled ? (
        <div className="adm-card"><div className="adm-empty">Customers isn&apos;t enabled for your restaurant — contact Aevidine.</div></div>
      ) : (
        <>
          {/* ── Summary tiles — and three of them are the filter (owner, 2026-08-18) ──────────────
              "We can do the twelfth one also." Tapping a figure shows you the people behind it.
              ONLY where the tile's number and the segment's number are THE SAME QUESTION, because a
              tile that opens a list with a different count in it is worse than a tile you can't tap:
                · Total customers  ⇄ Everyone   — both the whole scope
                · Regulars         ⇄ Regulars   — both "visits ≥ 2"
                · Blocked          ⇄ Blocked    — both "blocked = true"
                · New (last 30 days) has NO segment: it counts who FIRST CAME in 30 days, while
                  "First-timers" counts who has been once. Different people, different number. It
                  stays a plain figure until the list can be asked that question server-side. */}
          <div className="adm-stats" style={{ marginBottom: 14 }}>
            <Tile label="Total customers" value={summary?.total} loading={!summary} seg="all" on={seg} pick={setSeg} />
            <Tile label="Regulars (came back)" value={summary?.returning} loading={!summary} seg="regulars" on={seg} pick={setSeg} />
            <Tile label="New (last 30 days)" value={summary?.newThisMonth} loading={!summary} />
            <Tile label="Blocked" value={summary?.blocked} loading={!summary} seg="blocked" on={seg} pick={setSeg} />
          </div>

          {partial.length > 0 && (
            <div className="adm-card" style={{ marginBottom: 14, borderColor: "var(--adm-warn)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-warn)" }} aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 200 }}>{partialNote(partial)}</span>
              <button className="adm-btn" onClick={() => load()}><i className="fas fa-rotate" aria-hidden="true" /> Try again</button>
            </div>
          )}

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
            ) : narrow ? (
              <div style={{ display: "grid", gap: 8 }}>
                {rows.map((c) => (
                  <div key={`${c.restaurant_id}:${c.phone}`}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px",
                      border: "1px solid var(--border-c,#e5e7eb)", borderRadius: 13, opacity: c.blocked ? 0.65 : 1 }}>
                    <button type="button" onClick={() => openDetail(c.phone)}
                      aria-label={`Open ${c.name || "this guest"}'s record`}
                      style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: 0,
                        color: "inherit", font: "inherit", padding: 0, cursor: "pointer" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                        <b style={{ fontSize: 14.5 }}>{c.name || <span className="adm-muted">Guest</span>}</b>
                        {c.consent && <i className="fas fa-circle-check" title="Consented to be saved" aria-label="consented"
                          style={{ fontSize: 10.5, color: "var(--adm-ok,#16a34a)" }} />}
                        {c.blocked ? <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-danger,#e5484d) 16%, transparent)", color: "var(--adm-danger,#e5484d)" }}>blocked</span>
                          : c.returning ? <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-ok,#16a34a) 16%, transparent)", color: "var(--adm-ok,#16a34a)" }}>regular</span>
                          : <span className="adm-chip">new</span>}
                      </div>
                      <div className="adm-muted" style={{ fontSize: 12.5, marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontFamily: "ui-monospace, monospace" }}>{showPhone(c.phone)}</span>
                        <span>· {c.visits ?? 0} visit{(c.visits ?? 0) === 1 ? "" : "s"}</span>
                        {rests.length > 1 && <span className="adm-chip" style={{ textTransform: "none", fontWeight: 700, background: "var(--muted2)", color: "var(--text)" }}>{c.restaurantName}</span>}
                      </div>
                      {/* The dates are NOT here on purpose — they live in the record this opens. */}
                      <div className="adm-muted" style={{ fontSize: 11.5, marginTop: 3 }}>Tap for their visits, dates and bills</div>
                    </button>
                    <button className="adm-btn cust-erase" title="Erase this customer (permanent)" aria-label={`Erase ${c.name || c.phone}`}
                      disabled={erasing === `${c.restaurant_id}:${c.phone}`}
                      onClick={(e) => { e.stopPropagation(); erase(c); }}
                      style={{ flex: "none", padding: "9px 11px", fontSize: 13, color: "var(--muted)", background: "transparent",
                        border: "1px solid transparent", minWidth: 40, minHeight: 40 }}>
                      {erasing === `${c.restaurant_id}:${c.phone}` ? "…" : <i className="fas fa-trash-can" aria-hidden="true" />}
                    </button>
                  </div>
                ))}
                {listFoot(2)}
              </div>
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
                        style={{ borderTop: "1px solid var(--border-c,#e5e7eb)", opacity: c.blocked ? 0.65 : 1, cursor: "pointer" }}>
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
                    the line would be misleading (audit 2026-07-09). Show a plain match count instead.
                    The group tab narrows it further; see `segTotal` above. */}
                {listFoot(10)}
              </div>
            )}
          </div>

          {/* ── one guest's record: visits, spend and their bills here ────────────── */}
          {(detail || detailBusy) && (
            <div onClick={closeDetail} role="dialog" aria-modal="true" aria-label="Customer record"
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", backdropFilter: "blur(3px)", zIndex: 80, display: "flex", justifyContent: "flex-end" }}>
              <div onClick={(e) => e.stopPropagation()} className="adm-card"
                style={{ width: "min(460px, 100%)", height: "100%", borderRadius: 0, overflow: "auto", padding: 22 }}>
                {/* A ✕ while it loads too — the drawer is already on screen, so it needs a visible
                    way out that does not depend on knowing about Escape or the phone's Back. */}
                {!detail ? (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div className="adm-empty" style={{ flex: 1 }}>Loading…</div>
                    <button className="adm-btn" style={{ padding: "6px 11px" }} onClick={closeDetail} aria-label="Close">✕</button>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <div>
                        <h2 style={{ fontSize: 19, margin: 0 }}>{detail.rows[0]?.name || "Guest"}</h2>
                        <div className="adm-muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
                          {detail.phone && detail.phone.length === 10 ? `${detail.phone.slice(0, 5)} ${detail.phone.slice(5)}` : detail.phone}
                        </div>
                      </div>
                      <button className="adm-btn" style={{ marginLeft: "auto", padding: "6px 11px" }} onClick={closeDetail} aria-label="Close">✕</button>
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
                          {/* First AND last visit live here now — on a phone the list no longer
                              carries the dates, so this record has to be complete on its own. */}
                          <span className="adm-muted" style={{ marginLeft: "auto", fontSize: 12, textAlign: "right" }}>
                            {r.visits} visit{r.visits === 1 ? "" : "s"}<br />
                            first {fmt(r.first_seen_at)} · last {fmt(r.last_seen_at)}
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
