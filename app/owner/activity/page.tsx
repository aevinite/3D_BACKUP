"use client";
// Owner · Audit & logs (owner, 2026-08-02 — was "Activity"). Two views in one page:
//
//   • AUDIT (removals) — everything taken out of the system across your restaurant(s):
//     a cancelled KOT, a deleted bill, a dish off an order or off the menu, with the
//     reason and the person (deletion_audit, mig 251). The DEFAULT view: it is the one
//     an owner comes here to answer ("who took that off, and why?").
//   • ACTIVITY LOG — everything your staff did: orders accepted/served, tables opened/
//     closed, bills settled, discounts, and (for a tablet action) which manager's PIN
//     unlocked it. Click ANY row for the full organized detail — the same popup the
//     admin and manager panels use.
//
// Each view is a sub-option on the Access screen (Owner's menu → Audit & logs), so a
// view the admin switched off is ABSENT here — and its endpoint refuses too (the
// server answers 403 + disabled:true; hiding is never the only guard).
//
// Scoped server-side by ownerScope (only this owner's restaurants; money is NOT hidden —
// it's your own data). A 60s backstop refresh (paused while the tab is hidden) keeps new
// rows appearing without a manual Refresh; no faster poll (egress rule).
import { useCallback, useEffect, useState } from "react";
import { actLabel, panelChipStyle, panelLabel, timeAgo, inr, formatActionDetail, isManagerPinRow, useActiveAutoRefresh, type Action } from "@/components/admin/shared";
import { LogDetailModal } from "@/components/admin/LogDetailModal";
import { RemovalDetailModal, KIND_LABEL, KIND_ICON } from "@/components/admin/RemovalDetail";
import { asValue } from "@/lib/ownerPin";
import { trailOf } from "@/lib/logTrail";
// The sort orders, the type chips and the search, shared with the manager panel and the admin
// console (see the file's header for why it lives in /panels).
import AUDITSORT from "@/public/panels/auditsort.js";

// One row of the Removals record — same wording as the manager panel's Removals screen
// (AUDIT_KIND / REMOVAL_REASONS in public/panels/editor/app.js), so the two panels never
// describe the same row differently.
type Removal = {
  id: number; at: string; kind: string; reason_code: string | null; reason_note: string | null;
  actor: string | null; actor_role: string | null; table_number: string | null;
  bill_no: number | null; invoice_no: string | null; kot_no: number | null;
  item_title: string | null; qty: number | null; amount: string | number | null;
  restaurant_id: string | null; restaurant_name: string | null;
};
// The words + glyph come from the removal-detail card this list opens, so a row and its card can
// never say two different things about the same event (T15 sweep). Shape kept as [icon, label]
// so the render below is unchanged.
const REMOVAL_KIND: Record<string, [string, string]> = Object.fromEntries(
  Object.keys(KIND_LABEL).map((k) => [k, [KIND_ICON[k] || "•", KIND_LABEL[k]] as [string, string]]),
);
const REMOVAL_REASON: Record<string, string> = {
  mistake: "By mistake",
  guest_changed: "Guest changed their mind",
  wrong_table: "Wrong table",
  sold_out: "Not available / sold out",
  kitchen_error: "Kitchen error",
  other: "Other reason",
};

export default function OwnerAuditLogs() {
  // Admin-in-one-restaurant scope pin (?rid=) — rides on every call as ?scope= so a second
  // tab's shared act-as cookie can't repoint this one. Null for a real owner.
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));

  // Which view is showing. "audit" is the default; if the server says that view is switched
  // off for this owner (403 + disabled), the page falls over to the other one on its own.
  const [view, setView] = useState<"audit" | "activity">("audit");
  const [audDisabled, setAudDisabled] = useState(false);
  const [actDisabled, setActDisabled] = useState(false);

  // ── Audit (removals) state ────────────────────────────────────────────────
  const [removals, setRemovals] = useState<Removal[] | null>(null);
  const [removalId, setRemovalId] = useState<number | null>(null);   // which removal is open in full
  const [audErr, setAudErr] = useState<string | null>(null);
  const [audQ, setAudQ] = useState("");
  // `risk` (money / record / data) comes from the database with each count — see the strip below.
  const [audCounts, setAudCounts] = useState<{ kind: string; n: number; amount: number; risk?: string }[] | null>(null);
  // WHICH TYPE, held HERE rather than inside the view: it goes to the server (so a chip counting
  // every page filters every page, not just this one) and it must reset the paging when it changes.
  const [audKind, setAudKind] = useState("");
  // Narrowing to a type restarts at page 1: staying on page 5 of "everything" shows nothing once the
  // set is smaller, which reads as "no records of that kind" and is simply the wrong page.
  const pickAudKind = (k: string) => { setAudKind(k); setAudPage(1); };
  // Removals paging, same shape and same reasoning as the Activity log's (owner, 2026-08-12).
  const [audPage, setAudPage] = useState(1);
  const [audPages, setAudPages] = useState(1);
  const [audTotal, setAudTotal] = useState(0);

  // ── Activity state ────────────────────────────────────────────────────────
  const [rows, setRows] = useState<Action[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // ── PAGING (owner, 2026-08-12: "make it like pages, you can go to page 2 from bottom") ─────────
  // The log showed the newest 200 and stopped, so "what happened last Saturday?" had no answer on
  // the one screen built to answer it. 200 a page is the owner's own number.
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [level, setLevel] = useState<"" | "error" | "warn" | "info">("");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [detailRow, setDetailRow] = useState<Action | null>(null);
  useEffect(() => { const t = setTimeout(() => setQDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  // Changing the filter or the search starts again at page 1. Without this you keep whatever page
  // you were on, and a narrower result set that only HAS two pages answers page 5 with nothing —
  // which reads as "no activity" rather than "you are past the end".
  useEffect(() => { setPage(1); }, [qDebounced, level]);

  // ── WHICH RESTAURANT THIS RECORD IS ABOUT (owner, 2026-08-18, approving the sweep's 🟡 3) ─────
  // Picking a restaurant in the cockpit's top switcher used to throw a multi-restaurant owner OUT of
  // this page and onto the dashboard, while Reports and Manager mode re-scope in place. Now this page
  // listens on the same channel Reports does, so the record narrows where he is standing.
  //   `pickRid` is the FILTER; `scopePin` stays the admin's authorisation pin and is a separate
  // thing (it travels as `scope=`). "" means every restaurant this owner has, which is the default
  // for EVERYONE — and that is a deliberate change from sending `rid = scopePin` on an admin tab.
  // Two reasons, both checked:
  //   · lib/ownerScope resolves an admin pin to ALL the restaurants that restaurant's OWNER owns,
  //     "so the admin's owner-cockpit view matches the real owner's". Sending `rid = pin` narrowed
  //     THIS page to one restaurant while the dashboard next door showed the whole estate.
  //   · With the pill now mirroring the scope, a filter nobody chose made the pill disagree with the
  //     list under it: measured on arrival — pill "All restaurants" over rows from one restaurant.
  // A real owner is unaffected: they have no pin, so they never sent `rid` and always saw everything.
  const [pickRid, setPickRid] = useState<string>("");
  const [pickName, setPickName] = useState<string>("");
  useEffect(() => {
    const onScope = (e: Event) => {
      const d = (e as CustomEvent<{ rid: string | null; name?: string }>).detail;
      setPickRid(d?.rid ?? "");
      setPickName(d?.rid ? (d?.name ?? "") : "");
      // A narrower record has fewer pages, so page 5 of everything would answer with nothing —
      // the same reason picking a type resets the paging.
      setAudPage(1); setPage(1);
    };
    window.addEventListener("lfh:owner-scope", onScope);
    return () => window.removeEventListener("lfh:owner-scope", onScope);
  }, []);
  // Tell the cockpit bar which restaurant is on screen, the way the dashboard and Reports do, so the
  // top pill stops disagreeing with the list under it. Emitted on the next frame as well, because
  // child effects run before the shell's listener is attached on a hard load (the OwnerManagerMode
  // lesson, same day).
  useEffect(() => {
    const emit = (tail: string[]) => window.dispatchEvent(new CustomEvent("lfh:owner-crumb", { detail: { tail } }));
    const tail = pickName ? [pickName] : [];
    emit(tail);
    const again = requestAnimationFrame(() => emit(tail));
    return () => { cancelAnimationFrame(again); emit([]); };
  }, [pickName]);

  const scopeParams = useCallback(() => {
    const params = new URLSearchParams();
    // scope = the admin act-as auth pin (per-tab, can't be hijacked); rid = the narrowing
    // filter so a single selected restaurant shows ONLY its own rows (mirrors the Reports
    // page, which sends both). Without rid the server falls back to the owner's full set, and
    // both endpoints honour `rid` only for a restaurant already inside the caller's scope — so it
    // can narrow and never widen.
    if (scopePin) { params.set("scope", scopePin); const a = asValue(); if (a) params.set("as", a); }
    if (pickRid) params.set("rid", pickRid);
    return params;
  }, [scopePin, pickRid]);

  const loadAudit = useCallback(async () => {
    const p = scopeParams();
    if (audPage > 1) p.set("page", String(audPage));
    if (audKind) p.set("kind", audKind);
    const qs = p.toString();
    try {
      const j = await (await fetch(`/api/owner/audit${qs ? "?" + qs : ""}`, { cache: "no-store" })).json();
      if (j.disabled) { setAudDisabled(true); setView((v) => (v === "audit" ? "activity" : v)); return; }
      if (j.error) throw new Error(j.error);
      setRemovals(j.removals || []); setAudErr(null);
      // Counted in the database when the server can (mig 311) — absent means "count the page
      // and say so", never a fabricated total on the record that proves nothing vanished.
      setAudCounts(Array.isArray(j.kindCounts) ? j.kindCounts : null);
      setAudPages(Math.max(1, Number(j.pages) || 1));
      setAudTotal(Number(j.total) || 0);
    } catch (e) { setAudErr(e instanceof Error ? e.message : String(e)); }
  }, [scopeParams, audPage, audKind]);

  const loadActivity = useCallback(async () => {
    const params = scopeParams();
    if (level) params.set("level", level);
    if (qDebounced.trim()) params.set("q", qDebounced.trim());
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    try {
      const j = await (await fetch(`/api/owner/oplog${qs ? "?" + qs : ""}`, { cache: "no-store" })).json();
      if (j.disabled) { setActDisabled(true); setView((v) => (v === "activity" ? "audit" : v)); return; }
      if (j.error) throw new Error(j.error);
      setRows(j.actions || []); setErr(null);
      // Paging (owner, 2026-08-12). The server sends the total and the page count so the footer can
      // say "page 2 of 9" rather than a bare Next that gives no sense of how much is back there.
      setPages(Math.max(1, Number(j.pages) || 1));
      setTotal(Number(j.total) || 0);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [scopeParams, level, qDebounced, page]);

  // Both views load once up front — that is also how the page learns which views this
  // owner even HAS (a disabled answer hides its chip). Two small, capped reads.
  useEffect(() => { setRemovals(null); loadAudit(); }, [loadAudit]);
  useEffect(() => { setRows(null); loadActivity(); }, [loadActivity]);

  // 60s backstop refresh of the view on screen — through the console's OWN shared hook, so this
  // page behaves like every other owner screen (T12 sweep, 2026-08-17).
  //
  // It used to hand-roll a plain setInterval. That paused while the tab was HIDDEN, which is the
  // important half, but it kept firing forever while the tab sat visible and unattended — an owner
  // who leaves Audit & logs open through a service pays ~480 reads for a screen nobody is looking
  // at. `useActiveAutoRefresh` adds the two things the hand-rolled version lacked: it stops after
  // two minutes without a pointer, key or scroll and refreshes the instant he comes back, and it
  // jitters each tick by ±20% so ten devices that opened at the start of a shift stop asking the
  // database on the same beat. Same 60s floor, same "never faster" rule.
  const refreshView = useCallback(() => { if (view === "audit") loadAudit(); else loadActivity(); }, [view, loadAudit, loadActivity]);
  useActiveAutoRefresh(refreshView, 60_000);

  const bothOff = audDisabled && actDisabled;

  return (
    <>
      <h1 className="adm-page-h">Audit &amp; logs</h1>
      <p className="adm-page-sub">What was removed and why — and everything your staff did, line by line.</p>

      {/* View switch — only the views this restaurant's Access settings allow are offered. */}
      {!bothOff && (
        <div className="own-range" style={{ marginBottom: 12 }}>
          {!audDisabled && <button className={view === "audit" ? "on" : ""} onClick={() => setView("audit")}>🗑 Audit · removals</button>}
          {!actDisabled && <button className={view === "activity" ? "on" : ""} onClick={() => setView("activity")}>📜 Activity log</button>}
        </div>
      )}

      {bothOff ? (
        <div className="adm-card"><div className="adm-empty">Audit &amp; logs isn&rsquo;t enabled for your restaurant — contact Aevidine.</div></div>
      ) : view === "audit" && !audDisabled ? (
        <AuditView removals={removals} err={audErr} q={audQ} setQ={setAudQ} counts={audCounts} kind={audKind} setKind={pickAudKind} onReload={loadAudit} onOpenRemoval={setRemovalId}
          page={audPage} pages={audPages} total={audTotal} onPage={setAudPage} scopeName={pickName} />
      ) : (
        <ActivityView rows={rows} err={err} level={level} setLevel={setLevel} q={q} setQ={setQ} onReload={loadActivity} onOpen={setDetailRow}
          page={page} pages={pages} total={total} onPage={setPage} scopeName={pickName} />
      )}

      {detailRow && <LogDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
      {/* Click a removal → the whole story: which KOT, every item on it, the totals, the time and
          day, who did it. The owner SEES everything and changes nothing — /api/owner/audit is
          GET-only and always answers canRestore:false (owner rule, 2026-08-04). */}
      {removalId != null && (
        <RemovalDetailModal id={removalId} base="/api/owner/audit" onClose={() => setRemovalId(null)} />
      )}
    </>
  );
}

// ── Audit (removals) ─────────────────────────────────────────────────────────
function AuditView({ removals, err, q, setQ, counts, kind, setKind, onReload, onOpenRemoval, page, pages, total, onPage, scopeName }: {
  removals: Removal[] | null; err: string | null; q: string; setQ: (v: string) => void;
  /** Per-type counts over EVERY page, from the database. Null = count the page and say so. */
  counts: { kind: string; n: number; amount: number; risk?: string }[] | null;
  /** The chosen type. Owned by the page because it travels to the SERVER (a chip that counts every
   *  page must filter every page) and it resets the paging. */
  kind: string; setKind: (k: string) => void;
  onReload: () => void;
  onOpenRemoval: (id: number) => void;
  // Paging (owner, 2026-08-12) — the same strip the Activity log uses, so the two halves of this
  // page behave identically.
  page: number; pages: number; total: number; onPage: (p: number) => void;
  /** The restaurant this record is narrowed to, or "" for all of them. Only used to say WHOSE
   *  record is empty — "nothing has been removed yet" reads as "nowhere, ever" when the switcher
   *  has quietly narrowed the page to one restaurant (owner, 2026-08-18). */
  scopeName: string;
}) {
  // SORT + FILTER BY TYPE (owner, 2026-08-11: "make something like sort thing where everything can
  // be sorted, like what is list of what"). Both come from /panels/auditsort.js — the SAME module the
  // manager panel and the admin console use — so the one record cannot answer three different ways.
  // All of it runs on rows already in hand: the feed is capped server-side, so re-sorting or picking
  // a type costs no request and no egress.
  const [sort, setSort] = useState(AUDITSORT.DEFAULT_SORT);

  // Chips are built from the WHOLE feed, not the filtered slice — a chip's count must not change
  // when you tap it, and a type must stay reachable once you have narrowed to another one.
  const chips = AUDITSORT.kindCountsFrom(removals || [], counts, KIND_LABEL, KIND_ICON);
  // A type that vanished from the feed (a stale chip after Refresh) must not leave the list empty
  // with no way back — fall back to All.
  const activeKind = kind;
  // The SERVER already narrowed to `kind` — passing it again here would be harmless but it would also
  // hide a mismatch between the two, so the client only searches and sorts.
  const list = AUDITSORT.view(removals || [], { q, sort, kindLabel: KIND_LABEL, reasonLabel: REMOVAL_REASON });
  // What the visible rows come to in money — the figure an owner is really after when they pick
  // "Deleted bills". Only shown when there is money on them at all (a dish off the menu has none).
  const shownMoney = AUDITSORT.sumAmount(list);
  // ── DID MONEY ACTUALLY MOVE? (owner, 2026-08-13: "it should also show whole risk like money wise
  // and all that, how much money is there which reverted and all everything") ────────────────────
  // Two numbers were sitting side by side meaning completely different things: 268 cancelled KOTs
  // carrying ₹128,887 (nothing was ever charged for them) next to 10 deleted bills carrying ₹24,528
  // (money that WAS charged and is now off the list). Adding those together is meaningless, and
  // showing them in one flat feed invites exactly that.
  // So the record is split by RISK, and the split comes from the database (lfh_audit_risk, fed
  // through lfh_audit_kind_counts) — never re-decided here, or this screen and the manager's would
  // start disagreeing. `record` rows still show their value; they are just not called money lost.
  const riskTotals = (counts || []).reduce(
    (a, c) => {
      const r = (c as { risk?: string }).risk || AUDITSORT.riskOf(c.kind);
      const bucket = r === "money" ? a.money : r === "data" ? a.data : a.record;
      bucket.times += c.n; bucket.amount += c.amount;
      return a;
    },
    { money: { times: 0, amount: 0 }, record: { times: 0, amount: 0 }, data: { times: 0, amount: 0 } },
  );
  const hasRisk = !!counts && (riskTotals.money.times + riskTotals.record.times + riskTotals.data.times) > 0;
  const cols = "1.4fr 1fr auto";

  return (
    <div className="adm-card">
      {/* MONEY vs RECORD — the first thing to read, because it is the only one worth being angry
          about. Counts and amounts come from the server over the WHOLE record, not this page. */}
      {hasRisk && (
        <div className="own-range" style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <span
            title="Money the restaurant did not collect: discounts, on-the-house, payments reverted, bills taken off the list, and what changed when a bill was reopened."
            style={{ padding: "6px 10px", borderRadius: 999, border: "var(--border)", background: "var(--card)", fontSize: 12.5, fontWeight: 700 }}
          >
            💸 Money moved · {inr(riskTotals.money.amount)}
            <span className="adm-muted" style={{ fontWeight: 500 }}> · {riskTotals.money.times.toLocaleString("en-IN")} {riskTotals.money.times === 1 ? "time" : "times"}</span>
          </span>
          <span
            title="The record changed but no money did: a KOT cancelled before anything was charged, a dish off a live order, a menu edit, a bill reopened or put back, a note or allergy changed after settling. The value is shown so you can see the size of it — it is not money lost."
            style={{ padding: "6px 10px", borderRadius: 999, border: "var(--border)", background: "var(--card)", fontSize: 12.5 }}
          >
            📝 Record only · {riskTotals.record.times.toLocaleString("en-IN")} {riskTotals.record.times === 1 ? "change" : "changes"}
            {riskTotals.record.amount > 0 ? <span className="adm-muted"> · {inr(riskTotals.record.amount)} of food, never charged</span> : null}
          </span>
          {riskTotals.data.times > 0 && (
            <span
              title="A guest's personal details erased on request. Not money, and it cannot be undone."
              style={{ padding: "6px 10px", borderRadius: 999, border: "var(--border)", background: "var(--card)", fontSize: 12.5 }}
            >
              🧹 Guest data erased · {riskTotals.data.times.toLocaleString("en-IN")}
            </span>
          )}
        </div>
      )}
      {/* WHAT IS THE LIST OF WHAT — one chip per type present, with its count. Only types that
          actually have rows are offered, so there is never a "0" chip to tap. */}
      {chips.length > 1 && (
        <div className="own-range aud-chips" style={{ marginBottom: 10, flexWrap: "wrap" }}>
          <button className={activeKind === "" ? "on" : ""} onClick={() => setKind("")}>
            All <i>{(counts ? counts.reduce((a, c) => a + c.n, 0) : (removals || []).length).toLocaleString("en-IN")}</i>
          </button>
          {chips.map((c) => (
            <button key={c.kind} className={activeKind === c.kind ? "on" : ""} onClick={() => setKind(c.kind)}
              title={`Show only: ${c.label}`}>
              <span aria-hidden="true">{c.icon}</span> {c.label} <i>{c.count}</i>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a KOT, bill, table, dish, person or reason…"
          aria-label="Search the removals record"
          style={{ flex: "1 1 200px", minWidth: 160, padding: "7px 10px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13 }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <span className="adm-muted">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort the removals record"
            style={{ padding: "7px 8px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13 }}>
            {AUDITSORT.SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <button className="adm-btn" onClick={onReload}><i className="fas fa-rotate" aria-hidden="true" /> Refresh</button>
      </div>

      {/* What is on screen, in one line — so picking "Deleted bills" answers "how much?" too.
          ── AND IT SAYS WHICH SLICE IT IS TOTALLING (T12 sweep, 2026-08-17) ──────────────────────
          The record is paged server-side, so `list` is ONE page. Measured live: 426 removals on
          the record and this line read "200 records · ₹91,337 in total" — three money figures on
          one screen (₹35,998 moved, ₹1,83,895 record-only, ₹91,337 here) and only the middle one
          silently described page 1 while calling itself a total. The Activity half beside it has
          always said "Counts are for this page of N entries"; this half never did, and it is the
          half that carries money. So: name the page when there is more than one, and say "on this
          page" rather than "in total". The risk strip above still covers the WHOLE record — it is
          counted in the database. */}
      {list.length > 0 && (
        <p className="adm-muted" style={{ margin: "0 0 10px", fontSize: 12 }}>
          {list.length.toLocaleString("en-IN")} {list.length === 1 ? "record" : "records"}
          {pages > 1 ? ` on this page of ${total.toLocaleString("en-IN")}` : ""}
          {activeKind ? ` · ${KIND_LABEL[activeKind] || activeKind}` : ""}
          {shownMoney > 0 ? ` · ${inr(shownMoney)}${pages > 1 ? " on this page" : " in total"}` : ""}
        </p>
      )}

      {err && removals === null ? (
        <div className="adm-empty" style={{ color: "var(--adm-danger)" }}>
          Couldn&apos;t load the removals record — this is a loading error, not &ldquo;nothing was removed.&rdquo;{" "}
          <button className="adm-btn" style={{ marginLeft: 6 }} onClick={onReload}>Try again</button>
        </div>
      ) : removals === null ? (
        <div className="adm-empty">Loading…</div>
      ) : list.length === 0 ? (
        /* Three different empty states, because "nothing matches" and "nothing has happened" are
           different facts — and a narrowed type has a way back out of it. */
        <div className="adm-empty">
          {q.trim()
            ? "Nothing matches that."
            : activeKind
              ? <>Nothing of that kind. <button className="adm-btn" style={{ marginLeft: 6 }} onClick={() => setKind("")}>Show all</button></>
              : scopeName
                ? `Nothing has been removed at ${scopeName} — pick another restaurant above, or All restaurants, to see the rest.`
                : "Nothing has been removed yet — this list fills itself as it happens."}
        </div>
      ) : (
        <div className="adm-logwrap aud-stack">
          <div className="adm-logrow head" style={{ gridTemplateColumns: cols }}><div>What was removed</div><div>Why · by whom</div><div>When</div></div>
          {list.map((r) => {
            const [ico, label] = REMOVAL_KIND[r.kind] || ["•", r.kind];
            const bits = [
              r.table_number ? `Table ${r.table_number}` : "",
              r.kot_no != null ? `KOT #${r.kot_no}` : "",
              r.bill_no != null ? `Bill #${r.bill_no}` : "",
              r.invoice_no ? `Invoice ${r.invoice_no}` : "",
              r.item_title ? `${r.item_title}${(r.qty || 0) > 1 ? ` ×${r.qty}` : ""}` : "",
              r.amount != null ? inr(parseFloat(String(r.amount)) || 0) : "",
            ].filter(Boolean).join(" · ");
            const reason = [r.reason_code ? REMOVAL_REASON[r.reason_code] || r.reason_code : "", r.reason_note || ""].filter(Boolean).join(" — ") || "no reason recorded";
            return (
              <div
                key={r.id} className="adm-logrow" style={{ gridTemplateColumns: cols, cursor: "pointer" }}
                role="button" tabIndex={0}
                title="See exactly what was removed"
                onClick={() => onOpenRemoval(r.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenRemoval(r.id); } }}
              >
                <div style={{ minWidth: 0 }}>
                  <span aria-hidden="true" style={{ marginRight: 6 }}>{ico}</span>
                  <b>{label}</b>
                  {bits ? <span className="adm-muted"> · {bits}</span> : null}
                  {r.restaurant_name ? <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><i className="fas fa-store" style={{ fontSize: 9, marginRight: 4, opacity: 0.7 }} aria-hidden="true" />{r.restaurant_name}</span> : null}
                </div>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13 }}>{reason}</span>
                  <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 1 }}>{r.actor || "—"}{r.actor_role ? ` · ${r.actor_role}` : ""}</span>
                </div>
                <div className="adm-when">{timeAgo(r.at)}</div>
              </div>
            );
          })}
          {/* The search + type filter above narrow only the PAGE you are on, so the strip stays put:
              you sort and filter within a page, and page through the record itself. */}
          <Pager page={page} pages={pages} total={total} onGo={onPage} />
        </div>
      )}
    </div>
  );
}

// ── Activity log (severity chips, search, paging, click for the full trail) ──
function ActivityView({ rows, err, level, setLevel, q, setQ, onReload, onOpen, page, pages, total, onPage, scopeName }: {
  rows: Action[] | null; err: string | null;
  level: "" | "error" | "warn" | "info"; setLevel: (v: "" | "error" | "warn" | "info") => void;
  q: string; setQ: (v: string) => void; onReload: () => void; onOpen: (a: Action) => void;
  // Paging (owner, 2026-08-12) — the list owns the strip, the page state lives with the fetch.
  page: number; pages: number; total: number; onPage: (p: number) => void;
  /** The restaurant this feed is narrowed to, or "" — see the note on AuditView's copy. */
  scopeName: string;
}) {
  // PHONE LAYOUT COMES FROM `aud-stack` (globals.css), and this list is the one that never opted
  // into it. Without that class `.adm-logrow` keeps its `min-width: 540px` on a narrow screen and
  // the wrapper scrolls sideways — so the trail, which is the whole point of the row, sat off the
  // right edge reading "My Little French House · Sign-in & s…" on the A35. The Removals list beside
  // it has had the class since it was written. The stacked rule carries `!important` precisely
  // because this template is an inline style, so nothing needs computing here.
  const cols = "88px 1fr auto";
  // ── SORT + TYPE, THE SAME WAY THE REMOVALS RECORD DOES IT (owner, 2026-08-14) ─────────────────
  // "you can able to sort in activity log such as from printer and all that." The Audit got chips
  // and a sort on 2026-08-11 and this feed — the bigger one — never did, so the only way to find
  // the printer's rows was to know a word that happens to appear in them. Both controls come from
  // /panels/auditsort.js, the SAME module the Audit uses and the same one the manager panel and the
  // admin console read, so one grouping answers on all three screens.
  const [group, setGroup] = useState("");
  const [sort, setSort] = useState(AUDITSORT.ACTIVITY_DEFAULT_SORT);
  // Chips are built from the WHOLE page of rows, never the filtered slice — a chip's count must not
  // change when you tap it.
  const chips = AUDITSORT.activityCounts(rows || []);
  // A group that vanished after a reload (its rows aged off this page) must not leave the list
  // silently empty: fall back to All, exactly as the admin's Audit does with a stale kind.
  const activeGroup = group && chips.some((c: { group: string }) => c.group === group) ? group : "";
  // ── AND THE RESULT IS WHAT GETS RENDERED (T12 sweep, 2026-08-17) ──────────────────────────────
  // This line existed from the day the controls were built and nothing ever read it: the list below
  // mapped `rows`, the raw page, so the group chips and the sort select were DEAD. Measured live:
  // tapping "🔑 Sign-in & access 31" lit the chip and left all 200 rows, same first row, same last
  // row; switching the sort to "Oldest first" changed nothing. eslint had been reporting `list` as
  // an unused variable the whole time — the same shape as the dead latest-active-week machinery
  // documented in app/owner/page.tsx. The owner asked for exactly this on 2026-08-14 ("you can
  // able to sort in activity log such as from printer and all that"). The search box was never
  // dead: `q` also travels to the server in loadActivity.
  // Cast at the call site, exactly as app/aevinite/logs/page.tsx does with the same helper: the
  // shared module types its rows loosely (`id: string | number`) because the manager panel feeds it
  // numeric ids, and it returns the very objects it was given.
  const list = rows === null ? null : (AUDITSORT.activityView(rows, { q, group: activeGroup, sort }) as Action[]);
  return (
    <div className="adm-card">
      {/* Severity filter + search + refresh */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div className="own-range" style={{ margin: 0 }}>
          <button className={level === "" ? "on" : ""} onClick={() => setLevel("")}>All</button>
          {/* No "Errors" filter here: raw app/system faults (level='error') are technical
              support signals, not for the owner — they're excluded server-side in
              /api/owner/oplog and surface only on the admin side (owner 2026-07-26). */}
          <button className={level === "warn" ? "on" : ""} onClick={() => setLevel("warn")}>Notable</button>
          <button className={level === "info" ? "on" : ""} onClick={() => setLevel("info")}>Info</button>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search action or detail…"
          aria-label="Search the activity log"
          style={{ flex: "1 1 200px", minWidth: 160, padding: "7px 10px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13 }}
        />
        <button className="adm-btn" onClick={onReload}><i className="fas fa-rotate" aria-hidden="true" /> Refresh</button>
      </div>

      {/* WHAT KIND OF THING HAPPENED — one chip per group, with its count. Only groups that have
          rows get a chip, so nobody is offered "Printer 0" to tap. */}
      {chips.length > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <div className="own-range" style={{ margin: 0, flexWrap: "wrap" }}>
            <button className={activeGroup === "" ? "on" : ""} onClick={() => setGroup("")}>All types</button>
            {chips.map((c: { group: string; count: number; label: string; icon: string }) => (
              <button key={c.group} className={activeGroup === c.group ? "on" : ""} onClick={() => setGroup(c.group)}
                title={`${c.label} — ${c.count} on this page`}>
                <span aria-hidden="true">{c.icon}</span> {c.label} <span style={{ opacity: 0.65 }}>{c.count}</span>
              </button>
            ))}
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort the activity log"
            style={{ marginLeft: "auto", padding: "6px 9px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 12.5 }}>
            {AUDITSORT.ACTIVITY_SORTS.map((s: { id: string; label: string }) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {/* HONEST ABOUT WHAT THE COUNTS COVER. The feed is paged server-side, so these numbers
              describe THIS page — saying so is the difference between a helpful number and one that
              reads as authoritative and isn't (the same care the Audit's chips take). */}
          {pages > 1 && <span className="adm-muted" style={{ fontSize: 11.5, width: "100%" }}>Counts are for this page of {total.toLocaleString("en-IN")} entries.</span>}
        </div>
      )}

      {err && rows === null ? (
        <div className="adm-empty" style={{ color: "var(--adm-danger)" }}>
          Couldn&apos;t load your activity — this is a loading error, not &ldquo;nothing happened.&rdquo;{" "}
          <button className="adm-btn" style={{ marginLeft: 6 }} onClick={onReload}>Try again</button>
        </div>
      ) : rows === null ? (
        <div className="adm-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="adm-empty">{scopeName
          ? `No staff activity at ${scopeName} yet — pick another restaurant above, or All restaurants, to see the rest.`
          : "No staff activity yet — it appears here as your team works."}</div>
      ) : !list || list.length === 0 ? (
        /* Narrowed to nothing. "Nothing of that kind" and "nothing has happened" are different
           facts, and a narrowed type needs a way back out of it — the same three-state treatment
           the removals half has had since it was written. */
        <div className="adm-empty">
          {activeGroup
            ? <>Nothing of that kind on this page. <button className="adm-btn" style={{ marginLeft: 6 }} onClick={() => setGroup("")}>Show all types</button></>
            : "Nothing matches that."}
        </div>
      ) : (
        <div className="adm-logwrap aud-stack">
          <div className="adm-logrow head" style={{ gridTemplateColumns: cols }}><div>Panel</div><div>Action</div><div>When</div></div>
          {list.map((a) => {
            const isErr = a.level === "error";
            const isWarn = a.level === "warn";
            const isResolved = isErr && !!a.resolved_at;
            const showRed = isErr && !isResolved;
            const det = isErr ? (a.detail || "") : formatActionDetail(a.action, a.detail);
            // A non-empty actor on a tablet row = the manager whose PIN unlocked it (except
            // the person's own login/profile actions).
            const isPin = isManagerPinRow(a);
            const pinShared = isPin && String(a.actor).includes(" / ");
            return (
              <div
                key={a.id}
                className="adm-logrow"
                role="button"
                tabIndex={0}
                onClick={() => onOpen(a)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(a); } }}
                style={{
                  gridTemplateColumns: cols,
                  cursor: "pointer",
                  background: showRed ? "color-mix(in srgb, var(--adm-danger) 12%, transparent)" : isWarn ? "color-mix(in srgb, var(--adm-warn) 8%, transparent)" : undefined,
                  borderLeft: showRed ? "3px solid var(--adm-danger)" : isWarn ? "3px solid var(--adm-warn)" : "3px solid transparent",
                  opacity: isResolved ? 0.62 : 1,
                }}
              >
                <div><span className="adm-chip" style={panelChipStyle(a.panel)}>{panelLabel(a.panel)}</span></div>
                <div style={{ minWidth: 0 }}>
                  <span style={{ color: showRed ? "var(--adm-danger)" : undefined, fontWeight: isErr ? 600 : undefined, textDecoration: isResolved ? "line-through" : undefined }}>{actLabel(a.action)}</span>
                  {isPin
                    ? <span className="adm-chip" title={pinShared ? "PIN shared by these managers — any could have entered it" : "Unlocked by this manager's PIN"}
                        style={{ marginLeft: 6, fontWeight: 700, background: pinShared ? "color-mix(in srgb, var(--adm-warn) 20%, transparent)" : "color-mix(in srgb, #d4af37 20%, transparent)", ["--hue" as string]: pinShared ? "var(--adm-warn)" : "#d4af37" }}>🔑 {a.actor}</span>
                    : a.actor ? <span className="adm-muted"> · {a.actor}</span> : ""}
                  {a.table_number && (isPin || !a.actor) ? <span className="adm-muted"> · Table {a.table_number}</span> : ""}
                  {det ? <span className="adm-muted"> · {det.length > 60 ? det.slice(0, 60) + "…" : det}</span> : null}
                  {/* ── THE TRAIL, ON THE ROW ITSELF (owner, 2026-08-12) ──────────────────────
                      "in short it will show, but when you go in detail it will actually show the
                      log." So the second line is the SHORT form — which restaurant, which area of
                      which panel, and what it was done to — and the popup has the full path.
                      Before this the row's second line was the restaurant name alone, which told
                      a single-restaurant owner nothing at all. */}
                  {(() => {
                    const t = trailOf(a);
                    return (
                      // IT MUST WRAP, NOT BE CHOPPED. The first build used nowrap + ellipsis, and on
                      // a 360px phone the line read "My Little French House · Sign–" — the trail is
                      // the whole point of this row, and it was the part being thrown away. Wrapping
                      // to at most two lines keeps every row a predictable height while letting the
                      // screen and the table number survive on a narrow screen (seen on the A35).
                      <span
                        className="adm-muted"
                        style={{
                          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                          overflow: "hidden", fontSize: 11.5, marginTop: 2, lineHeight: 1.35, wordBreak: "break-word",
                        }}
                      >
                        {a.restaurant_name ? <><i className="fas fa-store" style={{ fontSize: 9, marginRight: 4, opacity: 0.7 }} aria-hidden="true" />{a.restaurant_name}<span style={{ opacity: 0.45 }}> · </span></> : null}
                        <span style={{ opacity: 0.85 }}>{t.area}</span>
                        <span style={{ opacity: 0.45 }}> › </span>
                        <span style={{ fontWeight: 600, opacity: 0.95 }}>{t.screen}</span>
                        {t.target ? <><span style={{ opacity: 0.45 }}> · </span><span style={{ fontWeight: 600 }}>{t.target}</span></> : null}
                      </span>
                    );
                  })()}
                </div>
                <div className="adm-when">{timeAgo(a.created_at)}</div>
              </div>
            );
          })}
          <Pager page={page} pages={pages} total={total} onGo={onPage} />
        </div>
      )}
    </div>
  );
}

/**
 * The page strip under a long list (owner, 2026-08-12).
 *
 * Deliberately shows the TOTAL as well as the page numbers: "1,240 entries · page 2 of 7" tells the
 * owner how much history is actually there, which a bare ‹ › pair never does. Long runs are elided
 * (1 … 4 5 6 … 62) so the strip stays one line on a phone.
 */
function Pager({ page, pages, total, onGo }: { page: number; pages: number; total: number; onGo: (p: number) => void }) {
  if (pages <= 1) return null;
  const go = (p: number) => {
    onGo(Math.min(Math.max(1, p), pages));
    // Back to the top: paging keeps the scroll position otherwise, so page 2 opens half way down.
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  // Which numbers to draw: always the first and last, plus a window around the current page.
  const nums: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  const btn = (active: boolean): React.CSSProperties => ({
    minWidth: 34, height: 32, padding: "0 9px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${active ? "var(--adm-accent, #d4af37)" : "rgba(148,163,184,0.25)"}`,
    background: active ? "color-mix(in srgb, var(--adm-accent, #d4af37) 18%, transparent)" : "transparent",
    color: active ? "var(--adm-accent, #d4af37)" : "var(--text, #e7edf3)",
    fontWeight: active ? 800 : 600, fontSize: 13,
  });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "14px 10px 4px", borderTop: "1px solid rgba(148,163,184,0.14)", marginTop: 6 }}>
      <span className="adm-muted" style={{ fontSize: 12, marginRight: "auto" }}>
        {total.toLocaleString("en-IN")} {total === 1 ? "entry" : "entries"} · page {page} of {pages}
      </span>
      <button className="adm-btn" style={btn(false)} disabled={page <= 1} onClick={() => go(page - 1)} aria-label="Previous page">‹</button>
      {nums.map((n, i) => n === "…"
        ? <span key={`gap${i}`} className="adm-muted" style={{ padding: "0 2px" }}>…</span>
        : <button key={n} style={btn(n === page)} onClick={() => go(n)} aria-current={n === page ? "page" : undefined}>{n}</button>)}
      <button className="adm-btn" style={btn(false)} disabled={page >= pages} onClick={() => go(page + 1)} aria-label="Next page">›</button>
    </div>
  );
}
