"use client";
// Admin · Bills — the real bill LEDGER across all restaurants ("Pro Ledger" design).
// One row per bill (a session + its orders), bucketed by state: running / settled /
// pay-later / on-house / closed-unpaid / deleted. Amounts SHOWN (owner's oversight view).
// Expand a bill → detail + INVOICE HISTORY (generate/void/re-issue timeline, mig 189) +
// the change trail + delete/restore. Deleted bills are never erased — tombstoned + restorable.
// From /api/admin/bills. Change log at /aevinite/bill-audit/changes.
import { useCallback, useEffect, useState } from "react";
import { useActiveAutoRefresh, timeAgo, inr, actLabel } from "@/components/admin/shared";
import { SkelList } from "@/components/admin/Skeleton";

type BillState = "running" | "settled" | "khata" | "onhouse" | "cancelled" | "deleted";
type Bill = {
  sessionId: string; billNo: number | null; invoiceNo: number | null; invoiceVoided: boolean;
  restaurantId: string | null; restaurantName: string; table: string | null; state: BillState;
  amount: number; paid: number; orderCount: number; invoiceGens: number;
  openedAt: string | null; closedAt: string | null; at: string | null; createdAt: string | null;
  deletedAt: string | null; deletedBy: string | null; deleteReason: string | null;
  // Closed-unpaid bills only: was the food made? (owner 2026-08-20 — see the tile's own note.)
  loss?: "yes" | "no" | "unknown" | null;
};
type Rest = { id: string; name: string };
type Data = {
  bills: Bill[]; counts: Record<string, number>; total: number; restaurants: Rest[]; generatedAt: string;
  // deletedTotal is the REAL database count of deleted bills (not "how many are on this page") —
  // the chip used to be able to say 0 while deleted bills existed. nextBefore is the paging
  // cursor: null once there is nothing older to fetch.
  deletedTotal?: number; nextBefore?: string | null;
  // The Deleted bucket holds THREE different events; these split it. null means the split could not
  // be read, and the tile falls back to its old single sentence rather than inventing a zero.
  deletedEmptied?: number | null; deletedByPerson?: number | null;
};
type TrailEvent = { action: string; actor: string | null; detail: string | null; at: string };
type InvEvent = { event: string; no: number | null; reason: string | null; actor: string | null; at: string };
type CNote = { no: number; amount: number; reason: string | null; actor: string | null; at: string };
type Expanded = { trail: TrailEvent[]; invoiceHistory: InvEvent[]; creditNotes: CNote[] } | "loading";

// `tone` is drawn as TEXT (the state label, its icon, the stat card). On the LIGHT console these
// mid-tones on white measured 2.15-2.28:1, so every place that paints one passes it as --hue and
// the .hue-ink rule in globals.css darkens the text per skin.
const META: Record<BillState, { label: string; tone: string; icon: IconName }> = {
  running:   { label: "Running",       tone: "#22c55e", icon: "running" },
  settled:   { label: "Settled",       tone: "#3b82f6", icon: "settled" },
  khata:     { label: "Pay-later",     tone: "#a855f7", icon: "khata" },
  onhouse:   { label: "On the house",  tone: "#14b8a6", icon: "onhouse" },
  cancelled: { label: "Closed unpaid", tone: "#f59e0b", icon: "cancelled" },
  deleted:   { label: "Deleted",       tone: "#ef4444", icon: "deleted" },
};
const ORDER: BillState[] = ["running", "settled", "khata", "onhouse", "cancelled", "deleted"];
// Grouped the Indian way, like every other count in this territory.
const nf0 = (n: number) => (Number(n) || 0).toLocaleString("en-IN");

// Bill-context wording, deliberately narrower than the shared map (this page is ONE bill's
// trail, so "Invoice voided" reads better than the generic "Reopened the bill"). Anything not
// listed falls through to the shared actLabel(), which never prints a raw code.
const ACT_LABEL: Record<string, string> = {
  order_delete: "Bill/order deleted", orders_delete: "Bills cleared", bill_restore: "Bill restored",
  order_discount: "Discount applied", bill_discount: "Bill discount", payment_revert: "Payment reverted",
  bill_paid: "Marked paid", bill_split: "Split bill", on_the_house: "On the house", khata_park: "Parked to pay-later",
  invoice_generate: "Invoice generated", invoice_void: "Invoice voided", close_unpaid: "Closed unpaid",
  table_close: "Table closed", table_restart: "Table restarted", order_move: "Order moved", table_shift: "Table moved",
};

// ── inline vector icons (no emoji — UI/UX rule) ──────────────────────────────
type IconName = "running" | "settled" | "khata" | "onhouse" | "cancelled" | "deleted" | "chev" | "invoice" | "reopen" | "restore" | "trash" | "refresh" | "log";
function Ico({ n, s = 15 }: { n: IconName; s?: number }) {
  const p: Record<IconName, React.ReactNode> = {
    running: <><circle cx="12" cy="12" r="9" /><path d="M10 8l6 4-6 4V8z" /></>,
    settled: <><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></>,
    khata: <><path d="M4 5a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2z" /><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H18" /></>,
    onhouse: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M5 12v9h14v-9M12 8S11 3 8.5 3 6 6 8 8m4 0s1-5 3.5-5S18 6 16 8" /></>,
    cancelled: <><circle cx="12" cy="12" r="9" /><path d="M6 6l12 12" /></>,
    deleted: <><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></>,
    chev: <path d="M6 9l6 6 6-6" />,
    invoice: <><path d="M6 2h9l5 5v15H6z" /><path d="M15 2v5h5M9 13h6M9 17h6M9 9h2" /></>,
    reopen: <><path d="M9 14l-4-4 4-4" /><path d="M5 10h9a5 5 0 0 1 5 5v2" /></>,
    restore: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></>,
    refresh: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
    log: <><path d="M4 6h16M4 12h16M4 18h10" /></>,
  };
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }} aria-hidden="true">{p[n]}</svg>;
}

const CSS = `
.blz .blz-stat{transition:border-color .16s ease,transform .16s ease}
.blz-chip{display:inline-flex;align-items:center;gap:7px;padding:8px 12px;border-radius:10px;font-size:12.5px;font-weight:600;cursor:pointer;transition:all .16s ease;border:1px solid var(--border);background:var(--adm-surface,var(--bg));color:var(--muted)}
.blz-chip:hover{color:var(--text);border-color:var(--muted)}
.blz-row{transition:background .14s ease}
.blz-row:hover{background:color-mix(in srgb, var(--accent) 6%, transparent)}
/* THE ROW'S SHAPE LIVES HERE SO IT CAN REFLOW (T18 sweep, 2026-08-20).
   It used to be an inline 6-column grid with minWidth:640 inside a card styled overflow:hidden, so
   on a phone the card reported scrollWidth 640 / clientWidth 330 and simply CUT the right-hand
   columns off with no way to reach them. Measured at 360x780 in both skins: state and bill number
   visible; table, AMOUNT, time and chevron all outside the viewport. The amount is the whole point
   of this screen. A sideways scroll is not the answer — he has ruled that out ("there shouldn't be
   horizontal scroll anywhere") — so below 760px the row becomes three short lines instead. The
   desktop grid is exactly the one it was. */
.blz-rowgrid{display:grid;grid-template-columns:148px 1.3fr 60px 116px 92px 24px;gap:12px;align-items:center;min-width:640px}
.blz-rowgrid > .c-amt,.blz-rowgrid > .c-when{text-align:right}
.blz-rowgrid > .c-chev{justify-self:end}
@media (max-width:760px){
  .blz-rowgrid{min-width:0;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"state amt" "who when" "tbl chev";gap:4px 10px;row-gap:5px}
  .blz-rowgrid > .c-state{grid-area:state}
  .blz-rowgrid > .c-who{grid-area:who;min-width:0}
  .blz-rowgrid > .c-tbl{grid-area:tbl}
  .blz-rowgrid > .c-amt{grid-area:amt}
  .blz-rowgrid > .c-when{grid-area:when}
  .blz-rowgrid > .c-chev{grid-area:chev}
}
.blz-chev{transition:transform .2s ease}
.blz-row.open .blz-chev{transform:rotate(180deg)}
.blz-act{transition:all .15s ease}
.blz-act:hover{border-color:var(--muted)}
@keyframes blzspin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.blz *{transition:none!important;animation:none!important}}
`;

export default function AdminBills() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rid, setRid] = useState("");
  const [state, setState] = useState<BillState | "">("");
  const [open, setOpen] = useState<string | null>(null);
  const [exp, setExp] = useState<Record<string, Expanded>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Reaching BACK. The list used to be "the newest 200 sessions, then filtered" — so a bill
  // deleted yesterday could not be found at all. A date window, a search and a Load-more cursor
  // are what make "admin can see it and reopen it at any time" true (owner, 2026-08-04).
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [qLive, setQLive] = useState("");   // what is typed; `q` is what has been submitted
  const [more, setMore] = useState<Bill[]>([]);   // pages after the first
  const [moreBusy, setMoreBusy] = useState(false);
  // THE SERVER OWNS THE CURSOR (2026-08-06) — see the note at loadMore. This holds whatever the last
  // page handed back, so paging never re-derives a boundary from the rows on screen.
  const [cursor, setCursor] = useState<string | null>(null);

  const qsFor = useCallback((extra?: Record<string, string>) => {
    const p = new URLSearchParams();
    if (rid) p.set("restaurant_id", rid);
    if (state) p.set("state", state);
    // BOTH ENDS OF THE WINDOW ARE PINNED TO IST (T18 sweep, 2026-08-20). The end already was; the
    // start was sent as a bare `YYYY-MM-DD`, which `new Date()` reads as UTC midnight — 05:30 IST.
    // So the window opened five and a half hours late, right across the late-night trade, and the
    // two ends disagreed: a bill taken at 03:56 IST on the 19th is AFTER "to: 18 Aug" (23:59:59 IST
    // on the 18th) and BEFORE "from: 19 Aug" (05:30 IST), so a single-day search on either day could
    // not find it at all. Measured on the backup database: "From 19 Aug, To 19 Aug" returned 30
    // bills of the 181 taken that IST day — 151 unreachable, including #373/#374/#375 at 03:55 IST.
    // That is the exact opposite of this screen's stated job ("the admin must be able to reach a
    // deleted bill at any time"), so the start now says which midnight it means, like the end does.
    if (from) p.set("from", from + "T00:00:00.000+05:30");
    // An end DATE means the whole of that day, not midnight at its start — otherwise picking
    // "to: today" hides everything taken today, the exact off-by-one the report window rule warns about.
    if (to) p.set("to", to + "T23:59:59.999+05:30");
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(extra || {})) p.set(k, v);
    return p.toString();
  }, [rid, state, from, to, q]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/admin/bills?" + qsFor(), { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't load.");
      setD(j); setMore([]);              // a new filter starts a fresh first page
      setCursor(j?.nextBefore ?? null);  // …and a fresh cursor with it
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [qsFor]);
  useEffect(() => { load(); }, [load]);
  // Auto-refresh only while looking at the FIRST page. Refreshing under someone who has paged
  // back through months would throw their place away — the thing they came here to do.
  const pagedIn = more.length > 0;
  const autoRefresh = useCallback(() => { if (!pagedIn) load(); }, [pagedIn, load]);
  useActiveAutoRefresh(autoRefresh, 60000);

  // USE THE SERVER'S CURSOR — never one re-derived from the rows on screen (2026-08-06).
  // This read `more[last].at`, i.e. `closed_at ?? created_at`, while the endpoint pages on
  // `created_at`. For a settled bill closed_at is later than created_at, so "Load more" asked for a
  // boundary the rows already shown satisfied: it re-listed bills, and where a session had been open
  // for days before closing it returned the SAME page forever, so older bills were unreachable.
  // The endpoint now returns the created_at it actually sorted by; we just carry it back.
  const nextBefore = cursor;
  const loadMore = async () => {
    if (!nextBefore || moreBusy) return;
    setMoreBusy(true);
    try {
      const res = await fetch("/api/admin/bills?" + qsFor({ before: nextBefore }), { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't load more.");
      setMore((m) => [...m, ...((j.bills || []) as Bill[])]);
      // Advance to the next page's cursor, and stop when the server says there is no more.
      setCursor((j?.nextBefore as string | null) ?? null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setMoreBusy(false); }
  };

  const expand = async (b: Bill) => {
    const next = open === b.sessionId ? null : b.sessionId;
    setOpen(next);
    if (next && !exp[b.sessionId]) {
      setExp((t) => ({ ...t, [b.sessionId]: "loading" }));
      try {
        const res = await fetch("/api/admin/bills?trail=" + b.sessionId, { cache: "no-store" });
        const j = await res.json();
        setExp((t) => ({ ...t, [b.sessionId]: { trail: j.trail || [], invoiceHistory: j.invoiceHistory || [], creditNotes: j.creditNotes || [] } }));
      } catch { setExp((t) => ({ ...t, [b.sessionId]: { trail: [], invoiceHistory: [], creditNotes: [] } })); }
    }
  };

  const act = async (b: Bill, action: "delete" | "restore") => {
    let reason = "";
    if (action === "delete") {
      const r = window.prompt(`Delete bill${b.billNo ? ` #${b.billNo}` : ""} (${b.restaurantName})?\n\nThe bill is NOT erased — it stays here marked deleted and can be restored.\n\nReason (required):`, "");
      if (r === null) return;
      reason = r.trim();
      if (!reason) { alert("A reason is required to delete a bill."); return; }
    } else if (!window.confirm(`Restore bill${b.billNo ? ` #${b.billNo}` : ""} (${b.restaurantName})? It returns to the ledger as a normal record.`)) return;
    setBusy(b.sessionId);
    try {
      const res = await fetch("/api/admin/bills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, sessionId: b.sessionId, reason }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Action failed.");
      setExp((t) => { const c = { ...t }; delete c[b.sessionId]; return c; });
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  // Issue a CREDIT NOTE (post-settlement correction) — the bill is never changed; a new
  // immutable credit document is recorded against it (mig 194).
  const issueCredit = async (b: Bill) => {
    const amtStr = window.prompt(`Issue a credit note against bill${b.billNo ? ` #${b.billNo}` : ""} (${b.restaurantName})?\n\nThe bill is NOT changed — a new credit note is recorded against it. Bill total is ${inr(b.amount)}.\n\nCredit amount (₹):`, "");
    if (amtStr === null) return;
    const amount = Math.round(parseFloat(amtStr) * 100) / 100;
    if (!amount || amount <= 0) { alert("Enter a valid credit amount."); return; }
    const reason = window.prompt("Reason for this credit note (required):", "");
    if (reason === null) return;
    if (!reason.trim()) { alert("A reason is required to issue a credit note."); return; }
    setBusy(b.sessionId);
    try {
      // ONE id for this credit note, so a lost reply that gets retried cannot record it twice.
      // Generated here rather than inside a request helper: a fresh id per attempt would make the
      // server treat the second send as a brand-new credit note, which is the very thing to stop.
      const actionId = (globalThis.crypto?.randomUUID?.() as string) || `credit-${b.sessionId}-${amount}-${Date.now()}`;
      const res = await fetch("/api/admin/bills", { method: "POST", headers: { "Content-Type": "application/json", "X-LFH-Action-Id": actionId }, body: JSON.stringify({ action: "credit_note", sessionId: b.sessionId, amount, reason: reason.trim() }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to issue credit note.");
      const r2 = await fetch("/api/admin/bills?trail=" + b.sessionId, { cache: "no-store" });
      const j2 = await r2.json();
      setExp((t) => ({ ...t, [b.sessionId]: { trail: j2.trail || [], invoiceHistory: j2.invoiceHistory || [], creditNotes: j2.creditNotes || [] } }));
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const counts = d?.counts || {};
  // TWO KINDS OF NUMBER LIVE HERE, AND THEY MUST NOT BE ADDED TOGETHER (T20 sweep, 2026-08-16).
  // running / settled / pay-later / on-house / closed-unpaid can only be worked out by rolling a
  // session up with its orders, so they count what is ON THIS PAGE. "deleted" is a real column and
  // carries the TRUE database total. The All chip used to sum all six — live that read "All 718"
  // above 170 rows, a number that describes nothing. It now counts the rows actually loaded, and
  // every tile says which of the two kinds it is.
  // Everything on screen = the first page plus whatever "Load more" has fetched.
  const rows: Bill[] = [...(d?.bills || []), ...more];
  const settledPaid = rows.filter((b) => b.state === "settled").reduce((s, b) => s + b.paid, 0);
  // TWO KINDS OF CLOSED-UNPAID BILL, AND THEY ARE NOT THE SAME MORNING (owner, 2026-08-20):
  // "we have 2 option in close out also — one with the food was made, to count as loss; one is food
  // was not made and cancelled, so no loss detected." The tile beside this one has always said
  // "₹441 collected"; this one said "31 · walk-outs / cancels" and no money at all, so 31 walk-outs
  // at ₹80 looked exactly like 31 at ₹900.
  //
  // The server answers each bill from the order's own status (cooked = a walk-out) or from the
  // "was the food made?" answer mig 340 records on a cancellation — see lossOfClosedUnpaid. A bill
  // nobody has answered stays UNANSWERED and is shown as its own figure: on this database all 538
  // cancellations predate the question, and turning that into a confident "₹0 lost" would be the
  // screen inventing a fact on behalf of the person checking it.
  const unpaidRows = rows.filter((b) => b.state === "cancelled");
  const unpaidBy = (k: "yes" | "no" | "unknown") =>
    unpaidRows.filter((b) => (b.loss || "unknown") === k).reduce((s, b) => s + b.amount, 0);
  const lostMade = unpaidBy("yes"), lostNone = unpaidBy("no"), lostUnknown = unpaidBy("unknown");

  return (
    <div className="blz">
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Bills</h1>
          <p className="adm-page-sub" style={{ marginTop: 4 }}>Every bill across all restaurants, by state. Deleted bills are never erased — they stay here, tombstoned, and you can restore them. Amounts shown for oversight.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="adm-btn" href="/aevinite/bill-audit/changes" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 7 }} title="Chronological change log"><Ico n="log" s={14} />Change log</a>
          <button className="adm-btn" disabled={loading} onClick={load} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span style={{ display: "inline-flex", animation: loading ? "blzspin 1s linear infinite" : undefined }}><Ico n="refresh" s={14} /></span>Refresh
          </button>
        </div>
      </div>

      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></p>}

      {/* Summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, margin: "18px 0" }}>
        <Stat icon="running" tone="#22c55e" k="Open now" v={counts.running || 0} sub="tables still running · on this page" calculating={!d} />
        <Stat icon="settled" tone="#3b82f6" k="Settled" v={counts.settled || 0} sub={`${inr(settledPaid)} collected · on this page`} calculating={!d} />
        <Stat icon="cancelled" tone="#f59e0b" k="Closed unpaid" v={counts.cancelled || 0} calculating={!d}
          sub={<>
            {inr(lostMade)} food was made · {inr(lostNone)} never made
            {lostUnknown > 0 && <> · {inr(lostUnknown)} not answered</>}
            <br />walk-outs / cancels · on this page
          </>} />
        {/* THREE EVENTS, NOT ONE (owner, 2026-08-31 — he asked why this screen has a "Deleted"
            bucket at all when a bill can never be deleted). The count was right and the word was
            doing too much work. Measured on backup: 2,956 tombstoned bills, of which **16** had a
            person's name against them. 1,752 carry migration 291's own words, "every order on this
            bill was deleted" — the DATABASE closing a bill out because its last dish came off, one
            at a time; nobody deleted the bill. The rest have neither a person nor a reason, which is
            precisely the fingerprint mig 291's header describes: scripts writing `deleted_at`
            straight through the service role, not the product.
            The headline stays the true total, because compliance §3.0 wants every tombstone counted
            and the capability itself is his own (R27: "The Aevidine admin console keeps a soft delete
            for support work"). What stops is the tile presenting three things as one number. Nothing
            is renamed and no policy is decided here — the split comes from columns already stored. */}
        {/* "every one, all time" is a PLATFORM-WIDE claim, so an unknown count must not be shown as 0.
            `counts.deleted` is the true database count (the route overwrites the page-derived value
            with it), but on a reply that arrives without it, `|| 0` asserted "no bill has ever been
            deleted" on the one screen whose job is proving that no sale went missing. A real 0 still
            shows 0; only a missing number now shows "…". */}
        <Stat icon="deleted" tone="#ef4444" k="Deleted" v={typeof counts.deleted === "number" ? counts.deleted : "…"} calculating={!d}
          sub={d?.deletedByPerson == null || d?.deletedEmptied == null
            ? "restorable · every one, all time"
            : <>
                {nf0(d.deletedByPerson)} removed by a person · {nf0(d.deletedEmptied)} closed out when the last dish came off
                {(d.deletedTotal ?? 0) - d.deletedByPerson - d.deletedEmptied > 0
                  ? <> · {nf0((d.deletedTotal ?? 0) - d.deletedByPerson - d.deletedEmptied)} with nobody recorded</> : null}
                <br />restorable · every one, all time
              </>} />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {/* A REAL EM DASH, NOT `\u2014` (T22 sweep, 2026-09-06). A JSX string ATTRIBUTE is not a
            JavaScript string literal — it carries no backslash escapes — so this tooltip printed the
            six characters `\u2014` to anyone who hovered the All chip. The two `{"\u2014"}` below are
            inside expressions, where the escape IS processed, which is why only this one leaked. */}
        <button className="blz-chip" onClick={() => setState("")} style={chip(state === "")} title="Every bill loaded on this page — use the dates or the search to reach older ones">All <span style={{ opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>{d ? rows.length : "\u2014"}</span></button>
        {ORDER.map((k) => (
          <button key={k} className="blz-chip" onClick={() => setState(k)} style={chip(state === k, META[k].tone)}>
            <span className="hue-ink" style={{ ["--hue" as string]: META[k].tone, display: "inline-flex" }}><Ico n={META[k].icon} s={14} /></span>
            {META[k].label} <span style={{ opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>{d ? (counts[k] || 0) : "\u2014"}</span>
          </button>
        ))}
        <select aria-label="Restaurant" value={rid} onChange={(e) => { setRid(e.target.value); setOpen(null); }} style={{ marginLeft: "auto", padding: "9px 12px", borderRadius: 10, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }}>
          <option value="">All restaurants</option>
          {(d?.restaurants || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      {/* REACHING BACK — a date window and a search, so a bill from any day can be found and put
          back. Without these the screen only ever showed the newest page, and a bill deleted
          yesterday was already unreachable (owner, 2026-08-04). */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <form
          onSubmit={(e) => { e.preventDefault(); setQ(qLive.trim()); setOpen(null); }}
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
        >
          <input
            value={qLive} onChange={(e) => setQLive(e.target.value)} maxLength={40}
            placeholder="Find a bill — bill no, invoice no, or table"
            aria-label="Find a bill by its bill number, invoice number or table"
            style={{ padding: "9px 12px", borderRadius: 10, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, minWidth: 260 }}
          />
          <button className="adm-btn" type="submit">Find</button>
          {(q || from || to) && (
            <button className="adm-btn" type="button" onClick={() => { setQ(""); setQLive(""); setFrom(""); setTo(""); setOpen(null); }}>Clear</button>
          )}
        </form>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
          From
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOpen(null); }}
            style={{ padding: "8px 10px", borderRadius: 10, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
          to
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOpen(null); }}
            style={{ padding: "8px 10px", borderRadius: 10, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
        </label>
        {typeof d?.deletedTotal === "number" && d.deletedTotal > 0 && state !== "deleted" && (
          <button className="adm-btn" onClick={() => { setState("deleted"); setOpen(null); }}
            style={{ color: "#ef4444", borderColor: "color-mix(in srgb, #ef4444 40%, transparent)" }}>
            Show all {d.deletedTotal} deleted {d.deletedTotal === 1 ? "bill" : "bills"}
          </button>
        )}
      </div>

      <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
        {!d ? (err ? <div className="adm-empty">Couldn&apos;t load.</div> : <SkelList rows={5} label="Loading bills" />) : rows.length === 0 ? (
          <div className="adm-empty">
            {q || from || to
              ? "No bill matches that search or date range."
              : state === "deleted" ? "No bills have been deleted."
              // "NONE ON THIS PAGE" AND "NONE AT ALL" MUST NOT READ THE SAME (T18 sweep #7, item 2).
              // Five of the six state buckets can only be worked out by rolling a session up with
              // its orders, so the endpoint narrows them AFTER reading a page of sessions — the
              // route says so in its own comment. When that page happens to hold none of the chosen
              // state the list is empty even though older pages have plenty, and this said "No bills
              // in this view." full stop. Measured on backup: Running, Settled, Pay-later and On the
              // house all came back empty on the newest page while the server was still handing back
              // a cursor, and a settled bill (#644, My Little French House, ₹441) was sitting three
              // pages further back — unreachable, because the Load-older footer below is only drawn
              // when there is at least one row. On the screen whose stated job is proving no sale
              // quietly vanished, "the newest bills hold none" was being shown as "there are none".
              : nextBefore
                ? (state ? `No “${META[state as BillState].label}” bills on this page — there are older ones.`
                         : "No bills on this page — there are older ones.")
                : "No bills in this view."}
          </div>
        )
          : rows.map((b) => {
            // A STATE THIS SCREEN HAS NEVER HEARD OF COSTS ONE ROW, NOT THE PAGE (T18 second 500,
            // 2026-08-31). `META[b.state]` was read straight into `m.icon` and `m.tone`, so a bill
            // whose state is missing or new threw on the first property and the error boundary
            // replaced the whole ledger — every other bill on the page with it. The same shape as
            // item 12 on Platform revenue and the Change log, on a third screen. A new bucket added
            // to lib/billLedger tomorrow would do it too, which is the case that matters: the
            // ledger's job is showing every bill, and an unknown one must be VISIBLE and plainly
            // labelled rather than fatal.
            const m = META[b.state] || { label: String(b.state || "Unknown"), tone: "#8b94a7", icon: "chev" as IconName };
            const isOpen = open === b.sessionId;
            const del = b.state === "deleted";
            return (
              <div key={b.sessionId} style={{ borderBottom: "1px solid var(--adm-line, rgba(255,255,255,0.06))", background: del ? "color-mix(in srgb, #ef4444 8%, transparent)" : undefined }}>
                <button onClick={() => expand(b)} className={`blz-row blz-rowgrid${isOpen ? " open" : ""}`} style={{ width: "100%", padding: "12px 16px", background: "transparent", border: 0, cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
                  <span className="hue-ink c-state" style={{ display: "inline-flex", alignItems: "center", gap: 7, ["--hue" as string]: m.tone, fontWeight: 700, fontSize: 12.5 }}><Ico n={m.icon} s={15} />{m.label}</span>
                  <span className="c-who" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <b style={{ fontVariantNumeric: "tabular-nums" }}>{b.billNo != null ? `#${b.billNo}` : "—"}</b>
                    <span style={{ color: "var(--muted)", margin: "0 6px" }}>·</span>
                    <span style={{ color: "var(--muted)" }}>{b.restaurantName}</span>
                    {b.invoiceGens > 1 && <span title={`Invoice re-issued ${b.invoiceGens} times`} style={{ marginLeft: 8, fontSize: 10.5, padding: "2px 7px", borderRadius: 6, fontWeight: 700, background: "color-mix(in srgb, #f59e0b 18%, transparent)", ["--hue" as string]: "#f59e0b" }} className="hue-ink">re-issued ×{b.invoiceGens}</span>}
                    {b.invoiceVoided && <span title="Invoice currently voided (reopened)" style={{ marginLeft: 8, fontSize: 10.5, padding: "2px 7px", borderRadius: 6, fontWeight: 700, background: "color-mix(in srgb, #f59e0b 14%, transparent)", ["--hue" as string]: "#f59e0b", display: "inline-flex", alignItems: "center", gap: 4 }} className="hue-ink"><Ico n="reopen" s={11} />reopened</span>}
                  </span>
                  <span className="c-tbl" style={{ color: "var(--muted)", fontSize: 12.5 }}>{b.table ? `T${b.table}` : "—"}</span>
                  <span className="c-amt" style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", textDecoration: del ? "line-through" : undefined, opacity: del ? 0.7 : 1 }}>{inr(b.amount)}</span>
                  {/* THE TIME SHOWN IS THE TIME THIS LIST IS SORTED BY — they must be the same instant, or the
                      column reads as broken. The endpoint orders sessions by `created_at` and pages with a
                      `created_at` cursor, but this column used to print `at` (= closed_at ?? created_at). A bill
                      opened yesterday and settled today then sat by its opening time while showing its settling
                      time, so scanning down the ledger you met "2 days ago" ABOVE "1 day ago" — 4 such pairs on a
                      192-row page when this was measured. Both moments are still on the row: "Opened" and
                      "Closed" are spelled out in full, in IST, in the panel below. */}
                  <span className="c-when" style={{ color: "var(--muted)", fontSize: 12, fontVariantNumeric: "tabular-nums" }} title={b.createdAt ? `Opened ${new Date(b.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}${b.closedAt ? ` · closed ${new Date(b.closedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` : ""}` : undefined}>{b.createdAt ? timeAgo(b.createdAt) : b.at ? timeAgo(b.at) : "—"}</span>
                  <span className="blz-chev c-chev" style={{ color: "var(--muted)", display: "inline-flex" }}><Ico n="chev" s={14} /></span>
                </button>

                {isOpen && (
                  <div style={{ padding: "2px 18px 18px", background: "color-mix(in srgb, var(--accent) 4%, transparent)" }}>
                    {del && (
                      <div style={{ display: "flex", gap: 11, padding: "12px 14px", borderRadius: 11, border: "1px solid var(--adm-danger)", background: "color-mix(in srgb, #ef4444 12%, transparent)", margin: "12px 0" }}>
                        <span style={{ color: "var(--adm-danger)", flex: "0 0 auto", marginTop: 1 }}><Ico n="trash" s={16} /></span>
                        <div style={{ fontSize: 13 }}>
                          {/* WHICH of the three this bill was, in words, from what the record says.
                              "This bill was deleted" read the same for a person's act, for the
                              database closing out an emptied bill, and for a row a script wrote —
                              and 2,940 of the 2,956 on this database are not the first one. */}
                          {b.deleteReason === "every order on this bill was deleted" ? (
                            <>
                              <b style={{ color: "var(--adm-danger)" }}>This bill closed itself out</b> — every dish on it was
                              removed, one at a time, so nothing was left on the bill{b.deletedAt ? ` · ${new Date(b.deletedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` : ""}.
                              <div style={{ marginTop: 3, opacity: 0.7 }}>Nobody deleted the bill. Look at what happened to it below to see who took the dishes off.</div>
                            </>
                          ) : !b.deletedBy && !b.deleteReason ? (
                            <>
                              <b style={{ color: "var(--adm-danger)" }}>This bill is marked deleted with nobody recorded</b>
                              {b.deletedAt ? ` · ${new Date(b.deletedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` : ""}.
                              <div style={{ marginTop: 3, opacity: 0.7 }}>No person and no reason were stored, so it did not come through the panels — a script wrote it straight to the database.</div>
                            </>
                          ) : (
                            <>
                              <b style={{ color: "var(--adm-danger)" }}>This bill was deleted</b>{b.deletedBy ? ` by ${b.deletedBy}` : ""}{b.deletedAt ? ` · ${new Date(b.deletedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` : ""}.
                              {b.deleteReason ? <div style={{ marginTop: 3 }}>Reason: <i>{b.deleteReason}</i></div> : <div style={{ marginTop: 3, opacity: 0.7 }}>No reason recorded.</div>}
                            </>
                          )}
                          <div style={{ marginTop: 3, opacity: 0.7 }}>Kept in full for tax/audit — you can restore it.</div>
                        </div>
                      </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, margin: "14px 0" }}>
                      <Field k="Bill no" v={b.billNo != null ? `#${b.billNo}` : "—"} />
                      <Field k="Invoice no" v={b.invoiceNo != null ? `#${b.invoiceNo}${b.invoiceVoided ? " (voided)" : ""}` : "—"} />
                      <Field k="Restaurant" v={b.restaurantName} />
                      <Field k="Table" v={b.table ? `T${b.table}` : "—"} />
                      <Field k="Total" v={inr(b.amount)} />
                      <Field k="Collected" v={inr(b.paid)} />
                      <Field k="Orders" v={String(b.orderCount)} />
                      <Field k="Opened" v={b.openedAt ? new Date(b.openedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"} />
                      <Field k="Closed" v={b.closedAt ? new Date(b.closedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"} />
                      {/* Only on a bill that closed with nothing collected — the question does not
                          apply to one that was paid, parked or comped. This is the same answer the
                          tile totals up, per bill, so a person can find WHICH bill the money is in
                          rather than trusting the tile. "Not answered yet" is a real state and says
                          where it is answered (mig 340's P3: the Audit screen). */}
                      {b.state === "cancelled" && (
                        <Field k="Was the food made?" v={
                          b.loss === "yes" ? "Yes — counts as a loss"
                            : b.loss === "no" ? "No — never made, no loss"
                            : "Not answered yet — answer it in Audit"} />
                      )}
                    </div>

                    <SecHead icon="invoice" label="Invoice history" />
                    <InvoiceHistory e={exp[b.sessionId]} gens={b.invoiceGens} />

                    <SecHead icon="reopen" label="Credit notes" />
                    <CreditNotes e={exp[b.sessionId]} />

                    <SecHead icon="log" label="What happened to this bill" />
                    <Trail e={exp[b.sessionId]} openedAt={b.openedAt} rest={b.restaurantName} />

                    <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {del ? (
                        <button className="adm-btn blz-act" disabled={busy === b.sessionId} onClick={() => act(b, "restore")} style={{ borderColor: "#22c55e", color: "#22c55e", display: "inline-flex", alignItems: "center", gap: 7 }}>
                          <Ico n="restore" s={14} />{busy === b.sessionId ? "Restoring…" : "Restore bill"}
                        </button>
                      ) : (
                        <button className="adm-btn blz-act" disabled={busy === b.sessionId} onClick={() => act(b, "delete")} style={{ borderColor: "var(--adm-danger)", color: "var(--adm-danger)", display: "inline-flex", alignItems: "center", gap: 7 }}>
                          <Ico n="trash" s={14} />{busy === b.sessionId ? "Deleting…" : "Delete bill"}
                        </button>
                      )}
                      {!del && (
                        <button className="adm-btn blz-act" disabled={busy === b.sessionId} onClick={() => issueCredit(b)} style={{ display: "inline-flex", alignItems: "center", gap: 7 }} title="Record a refund/correction without changing the settled bill">
                          <Ico n="reopen" s={14} />Issue credit note
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

        {/* Walking further back. Present whenever the server says there is an older page, so the
            admin is never silently stopped at the newest one.
            AND THAT INCLUDES A PAGE THAT CAME BACK EMPTY (T18 sweep #7, item 2). This was gated on
            `rows.length > 0`, which is the one case where the way onward matters most: the five
            derived state buckets are narrowed after the page is read, so choosing Settled on a
            newest page that holds none left the admin looking at "No bills in this view." with no
            button to press — while the cursor to the next page was right there in the reply. */}
        {d && nextBefore && (
          <div style={{ padding: "14px 16px", textAlign: "center", borderTop: "1px solid var(--adm-line, rgba(255,255,255,0.06))" }}>
            <button className="adm-btn" onClick={loadMore} disabled={moreBusy}>
              {moreBusy ? "Loading…" : "Load older bills"}
            </button>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
              {rows.length > 0
                ? <>Showing {rows.length} — there are older ones. Use the dates or the search to jump straight to a bill.</>
                : <>Keep going back, or use the dates and the search to jump straight to a bill.</>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// A TILE MUST NOT STATE A NUMBER IT DOES NOT HAVE YET (2026-08-05). The list below already showed
// a skeleton while loading, but these four read `counts.x || 0`, so for the first seconds the screen
// asserted "0 tables still running / ₹0 collected / 0 Deleted" — indistinguishable from a day with
// no sales at all, on the one screen whose stated job is spotting a sale that has gone missing. The
// sibling Live-floor page already had this: app/aevinite/floor/page.tsx passes `calculating`.
// `sub` is a ReactNode, not a string: the Closed-unpaid tile says two things (what the food-made
// half is worth and what the never-made half is worth) and needs its own line break to stay legible
// at 150px, the narrowest this grid ever draws a tile.
function Stat({ icon, tone, k, v, sub, calculating }: { icon: IconName; tone: string; k: string; v: number | string; sub: React.ReactNode; calculating?: boolean }) {
  return (
    <div className="adm-card blz-stat" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <span className="hue-ink" style={{ ["--hue" as string]: tone, display: "inline-flex" }}><Ico n={icon} s={14} /></span><span className="hue-ink" style={{ ["--hue" as string]: tone }}>{k}</span>
      </div>
      <div className="fit-num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.5px", fontVariantNumeric: "tabular-nums", opacity: calculating ? 0.45 : 1 }}>
        {calculating ? "—" : v}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{calculating ? "counting\u2026" : sub}</div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return <div><div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{k}</div><div style={{ fontSize: 13.5, fontWeight: 600 }}>{v}</div></div>;
}

function SecHead({ icon, label }: { icon: IconName; label: string }) {
  return <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", margin: "16px 0 8px", display: "flex", alignItems: "center", gap: 7 }}><Ico n={icon} s={13} />{label}</div>;
}

function InvoiceHistory({ e, gens }: { e: Expanded | undefined; gens: number }) {
  if (e === "loading" || e === undefined) return <div style={{ color: "var(--muted)", fontSize: 12.5 }}>Loading…</div>;
  const inv = e.invoiceHistory;
  if (!inv.length) return <div style={{ color: "var(--muted)", fontSize: 12.5 }}>Invoice not generated for this bill.</div>;
  return (
    <>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>Generated <b style={{ color: "var(--text)" }}>{gens}</b> time{gens === 1 ? "" : "s"}{gens > 1 ? " — re-issued after a void." : "."}</div>
      <div style={{ position: "relative", paddingLeft: 22 }}>
        <div style={{ position: "absolute", left: 6, top: 6, bottom: 6, width: 2, background: "var(--adm-line, rgba(255,255,255,.1))" }} />
        {inv.map((ev, i) => {
          const voided = ev.event === "void";
          const col = voided ? "#f59e0b" : "#3b82f6";
          return (
            <div key={i} style={{ position: "relative", padding: "6px 0", fontSize: 12.5 }}>
              <span style={{ position: "absolute", left: -19, top: 9, width: 11, height: 11, borderRadius: 99, background: col, border: "2px solid var(--bg)" }} />
              <div style={{ fontWeight: 600 }}>{voided ? `Invoice #${ev.no} voided (reopened)` : `Invoice #${ev.no} generated`}</div>
              <div style={{ color: "var(--muted)", fontSize: 11.5 }}>{new Date(ev.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}{ev.actor ? ` · ${ev.actor}` : ""}{ev.reason ? <> — <i>{ev.reason}</i></> : ""}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function CreditNotes({ e }: { e: Expanded | undefined }) {
  if (e === "loading" || e === undefined) return <div style={{ color: "var(--muted)", fontSize: 12.5 }}>Loading…</div>;
  const cn = e.creditNotes;
  if (!cn.length) return <div style={{ color: "var(--muted)", fontSize: 12.5 }}>No credit notes on this bill.</div>;
  const total = cn.reduce((s, c) => s + c.amount, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {cn.map((c, i) => (
        <div key={i} style={{ display: "flex", gap: 10, fontSize: 12.5, alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, minWidth: 150, fontVariantNumeric: "tabular-nums" }}>Credit note #{c.no} · {inr(c.amount)}</span>
          <span style={{ color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.reason || ""}{c.actor ? ` · ${c.actor}` : ""}</span>
          <span style={{ color: "var(--muted)", fontSize: 11.5 }} title={c.at}>{timeAgo(c.at)}</span>
        </div>
      ))}
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Total credited: <b style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{inr(total)}</b></div>
    </div>
  );
}

function Trail({ e, openedAt, rest }: { e: Expanded | undefined; openedAt: string | null; rest: string }) {
  if (e === "loading" || e === undefined) return <div style={{ color: "var(--muted)", fontSize: 12.5 }}>Loading trail…</div>;
  const t = e.trail;
  if (!t.length) return <div style={{ color: "var(--muted)", fontSize: 12.5 }}>No recorded changes for this bill.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {t.map((ev, i) => (
        <div key={i} style={{ display: "flex", gap: 10, fontSize: 12.5, alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, minWidth: 150 }}>{ACT_LABEL[ev.action] || actLabel(ev.action)}</span>
          <span style={{ color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.detail || ""}{ev.actor ? ` · ${ev.actor}` : ""}</span>
          <span style={{ color: "var(--muted)", fontSize: 11.5 }} title={ev.at}>{timeAgo(ev.at)}</span>
        </div>
      ))}
    </div>
  );
}

function chip(active: boolean, tone?: string): React.CSSProperties {
  // No inline `color` on the active chip — it would outrank the per-skin rules in globals.css. The
  // tone travels as --hue instead; .blz-chip picks it up and the light skin darkens it. ("Closed
  // unpaid" was 2.15:1 on the light console, 2026-08-06.)
  return active
    ? { border: `1px solid ${tone || "var(--accent)"}`,
        background: `color-mix(in srgb, ${tone || "var(--accent)"} 18%, transparent)`,
        ["--hue" as string]: tone || "var(--accent)", fontWeight: 700 }
    : { border: "var(--border)", background: "transparent", color: "var(--muted)", fontWeight: 600 };
}
