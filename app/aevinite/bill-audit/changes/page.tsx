"use client";
// Admin · Bills → Change log — the chronological trail of every bill CHANGE across all
// restaurants (deleted / reverted / closed-unpaid / discounted / moved / invoice voided),
// from the activity log. Emphasises removals & reverts (tamper-risk). This is the secondary
// view; the primary "Bills" ledger (one row per bill, by state) lives at /aevinite/bill-audit.
import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveAutoRefresh, timeAgo, actLabel } from "@/components/admin/shared";
import { SkelList } from "@/components/admin/Skeleton";

type Row = { id: string; action: string; restaurantName: string; table: string | null; actor: string; detail: string | null; at: string; risk: boolean };
type Rest = { id: string; name: string };
type Data = {
  rows: Row[]; restaurants: Rest[]; generatedAt: string;
  page: number; per: number;
  // null on any read that did not ASK for the totals (a page hop), and also null if the count
  // itself failed. Never 0 — on this screen "I don't know" and "none" must not look alike.
  total: number | null; pages: number | null; riskCount: number | null;
  retentionDays: number;
};
// What survives a page hop: the totals are asked for once per filter, not once per page.
type Meta = { total: number; pages: number; riskCount: number | null };

// EVERY ACTION THE ENDPOINT CAN SEND HAS A LABEL HERE, AND THE FALLBACK IS ENGLISH (T18 sweep,
// 2026-08-20). `order_cancel` and `order_uncancel` are both in the endpoint's BILL_ACTIONS — and
// order_cancel is in its RISK set — but neither was in this map, and the fallback was
// `{ t: r.action }`, i.e. the raw database word. Measured live: 500 rows on screen, 29 of them
// reading "order_cancel" in the Change column, flagged red and counted in "226 bill removals /
// reverts worth a glance". Cancelling a bill is the one route out of a sale that the restaurant is
// allowed (compliance §3.0), so it is exactly the row a person reads most carefully here. The
// sibling Bills page already fell through to the shared actLabel() and says why in its own comment:
// it "never prints a raw code". This one does the same now, so a future action added to the
// endpoint can never surface as an identifier again.
const ACT: Record<string, { t: string; risk: boolean }> = {
  order_delete: { t: "Bill deleted", risk: true },
  orders_delete: { t: "Bills cleared", risk: true },
  bill_restore: { t: "Bill restored", risk: false },
  payment_revert: { t: "Payment reverted", risk: true },
  close_unpaid: { t: "Closed unpaid", risk: true },
  order_discount: { t: "Discount applied", risk: false },
  order_move: { t: "Order moved", risk: false },
  table_shift: { t: "Table moved", risk: false },
  invoice_void: { t: "Invoice voided (reopened)", risk: true },
  order_cancel: { t: "Bill cancelled", risk: true },
  order_uncancel: { t: "Cancel undone", risk: false },
  table_restart: { t: "Table restarted", risk: false },
  table_close: { t: "Table closed", risk: false },
  repair_void_bill: { t: "Bill voided (repair)", risk: true },
  repair_delete_order: { t: "Order deleted (repair)", risk: true },
  repair_edit_time: { t: "Order time edited (repair)", risk: true },
  repair_refire_order: { t: "Order re-fired (repair)", risk: false },
};

export default function AdminBillChanges() {
  const [d, setD] = useState<Data | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [type, setType] = useState<"all" | "risk">("all");
  const [rid, setRid] = useState<string>("");
  const [page, setPage] = useState(1);
  const [jump, setJump] = useState("");

  // THE TOTALS ARE ASKED FOR ONCE PER FILTER, NOT ONCE PER PAGE (the egress rule). An exact count
  // is a scan of everything matching the filter; turning a page cannot have changed it, so a page
  // hop reads one indexed range and nothing else. `count=1` goes out when the filter changes, when
  // Refresh is pressed, and on the 60s refresh of page 1 — where new rows actually land.
  // The filter this page's totals belong to. Kept in a ref rather than state because it decides
  // what THIS read asks for; as state it would be one render behind and the first page after a
  // filter change would show the old filter's page numbers.
  const sigRef = useRef("");
  const load = useCallback(async (force?: boolean) => {
    setLoading(true); setErr(null);
    try {
      const sig = `${type}|${rid}`;
      // Ask for the totals when the filter has changed (they belonged to the old one), when sitting
      // on the newest page (where new rows land), or when Refresh was pressed. Never on a plain
      // hop to page 7 of the same list.
      const withCount = force === true || sig !== sigRef.current || page === 1;
      sigRef.current = sig;
      const qs = new URLSearchParams();
      if (type === "risk") qs.set("type", "risk");
      if (rid) qs.set("restaurant_id", rid);
      qs.set("page", String(page));
      if (withCount) qs.set("count", "1");
      const res = await fetch("/api/admin/bill-audit?" + qs.toString(), { cache: "no-store" });
      const j = (await res.json()) as Data & { error?: string };
      if (!res.ok) throw new Error(j.error || "Couldn't load.");
      setD(j);
      // Only overwrite what we know when the answer actually carried it. A failed count sends null,
      // and null must not wipe a total we already have — the page numbers would vanish mid-read.
      if (j.total != null && j.pages != null) setMeta({ total: j.total, pages: j.pages, riskCount: j.riskCount });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [type, rid, page]);

  // A filter change starts again at the newest page, and forgets a total that belonged to the old
  // filter. Without this the pager would keep offering page 14 of a list that now has two pages.
  const refilter = (fn: () => void) => { setPage(1); setMeta(null); fn(); };

  // `load` is the only dependency, and it changes exactly when the filter or the page does — so
  // this runs when it should with no exhaustive-deps exception to explain away.
  useEffect(() => { load(); }, [load]);
  // The newest page keeps itself current; a deeper page refreshes its rows without re-counting.
  useActiveAutoRefresh(load, 60000);

  const pages = meta?.pages ?? null;
  const total = meta?.total ?? null;
  // A REPLY WITH A FIELD MISSING MUST NOT COST THE WHOLE SCREEN (T18 second 500, 2026-08-31).
  // `d` being present was taken as `d.rows` being present, so a body without it threw on `.length`
  // and the error boundary replaced the entire page — heading and all — with the generic
  // "Something went wrong" card. Its sibling screens degrade in place. Not reachable through
  // today's endpoint; this is about surviving a partial answer at all.
  const rows = d?.rows ?? [];
  const firstShown = d ? (d.page - 1) * d.per + 1 : 0;
  const lastShown = d ? firstShown + rows.length - 1 : 0;
  const go = (p: number) => setPage(Math.max(1, pages ? Math.min(pages, p) : p));
  const goJump = () => {
    const n = parseInt(jump, 10);
    if (Number.isFinite(n) && n >= 1) go(n);
    setJump("");
  };

  return (
    <>
      {/* NO SIDEWAYS SCROLL, ANYWHERE (owner, 2026-08-31 — item 8). This was a six-column grid held
          at minWidth 720 inside an overflowX:auto box, so on a 360px phone the heading read "TABLI"
          and Who did it / Why / When all sat off the right edge, with nothing saying they were
          there. On a log whose whole job is answering "who did this, and when", "when" being the
          invisible column is the wrong one to lose. Its sibling — the Bills ledger next door — was
          rebuilt to fold for exactly this reason, on his standing rule that there should not be
          horizontal scrolling anywhere; this one had been left behind.
          Below 760px the row folds onto three lines using named grid areas, the same technique and
          the same breakpoint the Bills row uses, so the two screens behave alike. The desktop grid
          is exactly the one it was. The column heads are hidden when folded, because a heading row
          cannot describe a shape that is no longer a table — each value carries its own label
          instead. */}
      <style>{`
        .chg-row { display: grid; grid-template-columns: 150px 1.1fr 60px 0.9fr 1.4fr 84px; min-width: 720px; }
        @media (max-width: 760px) {
          .chg-wrap { overflow-x: visible; }
          .chg-row { min-width: 0; grid-template-columns: minmax(0,1fr) auto;
                     grid-template-areas: "change when" "rest tbl" "by why"; gap: 3px 10px; padding: 10px 12px; }
          .chg-row.head { display: none; }
          .chg-row > .c-change { grid-area: change }
          .chg-row > .c-when   { grid-area: when }
          .chg-row > .c-rest   { grid-area: rest; min-width: 0 }
          .chg-row > .c-tbl    { grid-area: tbl; text-align: right }
          .chg-row > .c-by     { grid-area: by; min-width: 0 }
          .chg-row > .c-why    { grid-area: why; min-width: 0; text-align: right }
          /* The heads are gone, so each value says what it is. ::before rather than markup, so the
             desktop table keeps exactly the DOM (and the screen-reader reading order) it had. */
          /* A row with no reason recorded should not spend a line saying so — on the desktop table
             the "—" holds a column open, but folded it is just a dash floating beside another. */
          .chg-row > .c-why[data-empty] { display: none }
          .chg-row > .c-by::before  { content: "by "; opacity: .65 }
          .chg-row > .c-tbl::before { content: "table "; opacity: .65 }
        }
      `}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Bills · Change log</h1>
          <p className="adm-page-sub" style={{ marginTop: 4 }}>Every bill change across all restaurants — deleted, reverted, closed-unpaid, discounted, moved. Read-only from the activity log.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="adm-btn" href="/aevinite/bill-audit" style={{ textDecoration: "none" }}>
            <i className="fas fa-arrow-left" style={{ marginRight: 7 }} aria-hidden="true" />Back to Bills
          </a>
          <button className="adm-btn" disabled={loading} onClick={() => load(true)}>
            <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
          </button>
        </div>
      </div>

      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={() => load(true)}>Retry</button></p>}

      {/* THE BANNER COUNTS THE WHOLE FILTER, NOT THE PAGE. It used to count the removals among the
          500 rows that happened to be loaded, under the words "in this view" — which was true while
          the view WAS everything and became a lie the moment the list was paged. The server counts
          it now, over every matching row, and says so. A count that could not be read says exactly
          that instead of "no removals": a silent zero here is the failure mode that matters most. */}
      {d && (() => {
        const rc = meta?.riskCount ?? null;
        const danger = rc != null && rc > 0;
        return (
          <div className="adm-card" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, borderColor: danger ? "var(--adm-danger)" : undefined }}>
            <i className={`fas ${danger ? "fa-triangle-exclamation" : rc == null ? "fa-circle-question" : "fa-shield-halved"}`} style={{ color: danger ? "var(--adm-danger)" : rc == null ? "var(--muted)" : "var(--adm-ok)" }} aria-hidden="true" />
            <span style={{ fontSize: 13 }}>
              {rc == null ? "Couldn't count the removals and reverts just now — the list below is still complete."
                : danger ? <><b>{rc.toLocaleString("en-IN")}</b> bill removal{rc === 1 ? "" : "s"}/revert{rc === 1 ? "" : "s"} in this whole log — worth a glance.</>
                : "No bill removals or reverts in this whole log."}
            </span>
          </div>
        );
      })()}

      <div className="adm-card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {(["all", "risk"] as const).map((k) => (
          <button key={k} className="adm-chip" onClick={() => refilter(() => setType(k))}
            style={{ cursor: "pointer", padding: "7px 12px", border: type === k ? "1px solid var(--accent)" : "var(--border)", background: type === k ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent", color: type === k ? "var(--accent)" : "var(--muted)", fontWeight: type === k ? 700 : 500 }}>
            {k === "all" ? "All changes" : "At-risk only (deletions & reverts)"}
          </button>
        ))}
        <select aria-label="Restaurant" value={rid} onChange={(e) => refilter(() => setRid(e.target.value))} style={{ marginLeft: "auto", padding: "8px 10px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }}>
          <option value="">All restaurants</option>
          {(d?.restaurants || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
        {!d ? (err ? <div className="adm-empty">Couldn&apos;t load.</div> : <SkelList rows={5} label="Loading changes" />) : rows.length === 0 ? (
          <div className="adm-empty">No bill changes recorded in this view.</div>
        ) : (
          <div className="adm-logwrap chg-wrap" style={{ border: 0 }}>
            <div className="adm-logrow head chg-row">
              <span className="c-change">Change</span><span className="c-rest">Restaurant</span><span className="c-tbl">Table</span>
              <span className="c-by">By</span><span className="c-why">Reason</span><span className="c-when" style={{ textAlign: "right" }}>When</span>
            </div>
            {rows.map((r) => {
              // No entry → the shared plain-words map, then Sentence Case. Never the raw code.
              const a = ACT[r.action] || { t: actLabel(r.action), risk: r.risk };
              return (
                <div key={r.id} className="adm-logrow chg-row" style={{ alignItems: "center" }}>
                  <span className="c-change" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: a.risk ? "var(--adm-danger)" : "var(--muted)", flex: "0 0 auto" }} aria-hidden="true" />
                    <span style={{ fontWeight: 600, color: a.risk ? "var(--adm-danger)" : "var(--text)", fontSize: 12.5 }}>{a.t}</span>
                  </span>
                  <span className="c-rest" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.restaurantName}</span>
                  <span className="c-tbl adm-muted">{r.table ? `#${r.table}` : "—"}</span>
                  <span className="c-by adm-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.actor}</span>
                  {/* `data-empty` so the FOLDED layout can drop a reason that says nothing. The desktop table
                      keeps its "—", because there a column has to hold its place. */}
                  <span className="c-why adm-muted" data-empty={r.detail ? undefined : ""} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.detail || undefined}>{r.detail || "—"}</span>
                  <span className="c-when adm-muted" style={{ textAlign: "right" }} title={r.at}>{timeAgo(r.at)}</span>
                </div>
              );
            })}
            {/* EVERY CHANGE IS REACHABLE, PAGE BY PAGE (owner, 2026-08-20: "I want all logs to be
                shown … page wise … there will be last page number … you can type the page number").
                This screen used to read the newest 500 and stop, and the note here said so and
                offered to narrow the filter — which is not the same as being able to look. The log
                is bounded by retention (mig 158 prunes at 30 days), so "all of it" is a finite thing
                and the last page is a real number. */}
            <Pager page={d.page} pages={pages} total={total} per={d.per}
              from={firstShown} to={lastShown} retentionDays={d.retentionDays}
              busy={loading} onGo={go} jump={jump} setJump={setJump} onJump={goJump} />
          </div>
        )}
      </div>
    </>
  );
}

// ── THE PAGER ────────────────────────────────────────────────────────────────────────────────
// Numbered pages with the last one always shown, and a box to type one into (owner, 2026-08-20:
// "there will be a Pages that you can go and there will be last page number … you can type their
// page number"). Deliberately plain: buttons and one number field, no library, no dropdown of two
// thousand options.
//
// WHY THE LAST PAGE IS THE POINT. On a tamper log, "how far back does this go" is half the
// question. A Next button alone answers it only by being pressed twenty-three times.
//
// A WINDOW, so a 23-page log does not print 23 buttons: the first page, the last page, and the
// current one with ONE neighbour either side — five numbers at most. Measured at 360px: two
// neighbours each side made the pager wrap onto three rows and take a third of the screen, and
// ← Prev / Next → already step by one, so the extra buttons bought nothing. The gaps become "…",
// and a gap is NOT a button: a person who wants page 12 of 40 types it, which is what the box is
// for.
function pageWindow(page: number, pages: number): (number | "gap")[] {
  const near = new Set<number>([1, pages, page, page - 1, page + 1]);
  const list = [...near].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  list.forEach((n, i) => {
    if (i > 0 && n - (list[i - 1] as number) > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

function Pager({ page, pages, total, per, from, to, retentionDays, busy, onGo, jump, setJump, onJump }: {
  page: number; pages: number | null; total: number | null; per: number;
  from: number; to: number; retentionDays: number; busy: boolean;
  onGo: (p: number) => void; jump: string; setJump: (s: string) => void; onJump: () => void;
}) {
  const n = (x: number) => x.toLocaleString("en-IN");
  // With no total (the count could not be read) the numbers are not invented: Prev/Next still work,
  // and the line says what it does know — which page you are on and how many rows are on it.
  const last = pages ?? null;
  const atEnd = last != null ? page >= last : to - from + 1 < per;
  return (
    // TWO ROWS, ALWAYS: the sentence, then the controls. Sharing one flex row made the desktop
    // pager wrap half its numbers onto a second line the moment the sentence grew, which looks like
    // a mistake rather than a layout.
    <div className="chg-pager" style={{ borderTop: "1px solid var(--border-c, #e5e7eb)", padding: "12px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <span className="adm-muted" style={{ fontSize: 11.5, textAlign: "center" }}>
        {total != null
          ? <>Showing <b>{n(from)}–{n(to)}</b> of {n(total)} change{total === 1 ? "" : "s"}</>
          : <>Showing {n(from)}–{n(to)}</>}
        {" · "}nothing here is older than {retentionDays} days — older changes are removed automatically
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
      <button className="adm-btn" disabled={busy || page <= 1} onClick={() => onGo(page - 1)} aria-label="Previous page"
        style={{ padding: "6px 10px", fontSize: 12 }}>← Prev</button>

      {last != null && pageWindow(page, last).map((p, i) => p === "gap"
        ? <span key={`g${i}`} className="adm-muted" style={{ fontSize: 12, padding: "0 2px" }} aria-hidden="true">…</span>
        : (
          <button key={p} className="adm-btn" disabled={busy} onClick={() => onGo(p)}
            aria-label={`Page ${p}`} aria-current={p === page ? "page" : undefined}
            style={{
              padding: "6px 10px", fontSize: 12, minWidth: 34,
              borderColor: p === page ? "var(--accent)" : undefined,
              color: p === page ? "var(--accent)" : undefined,
              fontWeight: p === page ? 800 : 500,
              background: p === page ? "color-mix(in srgb, var(--accent) 16%, transparent)" : undefined,
            }}>{n(p)}</button>
        ))}

      <button className="adm-btn" disabled={busy || atEnd} onClick={() => onGo(page + 1)} aria-label="Next page"
        style={{ padding: "6px 10px", fontSize: 12 }}>Next →</button>

      {/* Type a page. A form, so Enter submits it the way Enter is supposed to — and so the button
          beside it is the same action rather than a second one to keep in step. */}
      <form onSubmit={(e) => { e.preventDefault(); onJump(); }} style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 6 }}>
        <label className="adm-muted" style={{ fontSize: 11.5 }} htmlFor="chg-jump">Go to page</label>
        <input id="chg-jump" type="number" min={1} max={last ?? undefined} value={jump} inputMode="numeric"
          onChange={(e) => setJump(e.target.value)} placeholder={last != null ? `1–${last}` : "1"}
          style={{ width: 78, padding: "6px 8px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12 }} />
        <button className="adm-btn" type="submit" disabled={busy || !jump.trim()} style={{ padding: "6px 10px", fontSize: 12 }}>Go</button>
      </form>
      </div>
    </div>
  );
}
