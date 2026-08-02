"use client";
// Owner · Expenses — the owner's own expense book.
//
// Every rupee that left the business in a period: what it was, which bucket it falls in,
// who wrote it down, the photo of the broken lamp, and the entries that were struck out.
// Until now this book only existed inside the manager panel's Inventory tab; this is the
// owner's first-class page for it, and it does NOT need the inventory module.
//
// APPEND-ONLY BY DESIGN (docs/COMPLIANCE-GUARDRAILS.md §3): there is no delete button and
// there must never be one. An entry is STRUCK OUT with a reason, stays on screen with a line
// through it, and only leaves the totals. Hiding a recorded cost without a trace is exactly
// the behaviour that gets a billing tool's makers summoned.
//
// Data + writes go through /api/owner/expenses, which is scoped server-side to the
// restaurants this caller owns and gated by the admin's "expenses" section entitlement —
// the UI never has to police that itself. Reads come from the compute-on-view snapshot
// cache, so a normal open is one row read; ↻ Refresh (and every write) forces a live value.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBackClose } from "@/lib/backStack";
import { asSuffix } from "@/lib/ownerPin";
import { todayIST } from "@/lib/staffProfileShared";

const GREEN = "#34d399";
const IST = "Asia/Kolkata";

// The eight buckets the database's CHECK constraint allows (mig 221 §G). A ninth needs a
// migration first — this list is deliberately not open-ended.
const CATEGORIES: { key: string; label: string; icon: string; color: string }[] = [
  { key: "breakage", label: "Breakage", icon: "🔨", color: "#f87171" },
  { key: "repair", label: "Repair", icon: "🛠️", color: "#fb923c" },
  { key: "utilities", label: "Utilities", icon: "💡", color: "#fbbf24" },
  { key: "cleaning", label: "Cleaning", icon: "🧹", color: "#4ade80" },
  { key: "supplies", label: "Supplies", icon: "📦", color: "#34d399" },
  { key: "rent", label: "Rent", icon: "🏠", color: "#60a5fa" },
  { key: "transport", label: "Transport", icon: "🛵", color: "#a78bfa" },
  { key: "misc", label: "Other", icon: "🧾", color: "#94a3b8" },
];
const CAT = new Map(CATEGORIES.map((c) => [c.key, c]));
const catOf = (k: string) => CAT.get(k) || { key: k, label: k, icon: "🧾", color: "#94a3b8" };

type ExpenseRow = {
  id: string; category: string; title: string; amount: number; expense_date: string;
  note: string | null; photo_url: string | null; created_by: string | null; created_at: string;
  voided_at: string | null; void_reason: string | null; voided_by: string | null;
};
type Payload = {
  rid: string; from: string; to: string; month: string | null; category: string;
  restaurants: { id: string; name: string }[];
  expenses: ExpenseRow[]; total: number; count: number;
  voidedTotal: number; voidedCount: number; average: number;
  byCategory: Record<string, number>; truncated: boolean;
  cachedAt?: string; disabled?: boolean; error?: string;
};

const inr = (n: number) => "₹" + (Math.round(Number(n || 0) * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const monthLabel = (m: string) => new Date(m + "-01T00:00:00").toLocaleString("en-IN", { month: "long", year: "numeric" });
const dayLabel = (d: string) => {
  const t = todayIST();
  if (d === t) return "Today";
  const y = new Date(new Date(t + "T00:00:00Z").getTime() - 86_400_000).toISOString().slice(0, 10);
  if (d === y) return "Yesterday";
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};
const agoLabel = (iso?: string) => {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? "updated just now" : m < 60 ? `updated ${m} min ago` : `updated ${Math.round(m / 60)} h ago`;
};
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: IST });

export default function OwnerExpensesPage() {
  // Admin-in-one-restaurant scope pin (bug C1) — rides on every API call, exactly as the
  // other owner pages do, so two admin tabs on two restaurants never repaint each other.
  //
  // READ AFTER MOUNT, never in a useState initializer. The server never sees ?rid=, so
  // seeding from window.location on the client made the FIRST client render diverge from
  // the server — and here that difference was a `disabled` attribute, so React kept the
  // server's version and the "Add expense" button stayed dead forever (caught in the
  // browser pass, not by any type check; same trap OwnerShell documents for its nav links).
  const [rid, setRid] = useState<string>("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const pin = new URLSearchParams(window.location.search).get("rid");
    if (pin) setRid(pin);
    setReady(true);
  }, []);
  const [month, setMonth] = useState(() => todayIST().slice(0, 7));
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [category, setCategory] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notEnabled, setNotEnabled] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [voidRow, setVoidRow] = useState<ExpenseRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Which fetch is the current one (latest-wins guard — see load()).
  const seqRef = useRef(0);

  const period = useMemo(
    () => (custom ? `from=${custom.from}&to=${custom.to}` : `month=${month}`),
    [custom, month]);
  const periodTitle = custom
    ? `${dayLabel(custom.from)} → ${dayLabel(custom.to)}`
    : monthLabel(month);

  const load = useCallback(async (force?: boolean) => {
    if (!ready) return; // wait for the per-tab pin, so we don't fetch the wrong restaurant first
    // LATEST WINS. Changing the two custom-date inputs fires two loads a keystroke apart;
    // without this the SLOWER, older one landed last and painted August's figures under a
    // "1 Jul → 31 Jul" heading (caught in the browser pass — the numbers were real, just
    // for the wrong window, which is exactly the kind of fault a green test suite misses).
    const seq = ++seqRef.current;
    setBusy(true);
    try {
      const qs = new URLSearchParams(period);
      if (rid) qs.set("rid", rid);
      if (category) qs.set("category", category);
      if (force) qs.set("refresh", "1");
      const j: Payload = await (await fetch(`/api/owner/expenses?${qs.toString()}${asSuffix()}`, { cache: "no-store" })).json();
      if (seq !== seqRef.current) return; // a newer request is already in flight — drop this answer
      // A 403 "not switched on" is a legitimate state, not an error — calm card, not red banner.
      if (j.disabled) { setNotEnabled(j.error || "Expenses isn't enabled for your restaurant."); setData(null); return; }
      if (j.error) throw new Error(j.error);
      setNotEnabled(null); setData(j); setErr(null);
      if (!rid && j.rid) setRid(j.rid);
    } catch (e) { if (seq === seqRef.current) setErr(e instanceof Error ? e.message : String(e)); }
    finally { if (seq === seqRef.current) setBusy(false); }
  }, [period, rid, category, ready]);

  useEffect(() => { load(); }, [load]);

  // Clear the little green "saved" line after a few seconds.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const shiftMonth = (dir: number) => {
    setCustom(null);
    const [y, m] = month.split("-").map(Number);
    setMonth(new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 7));
  };
  const atLatestMonth = !custom && month >= todayIST().slice(0, 7);

  // Newest first, grouped by the day the money was spent.
  const days = useMemo(() => {
    const out: { date: string; rows: ExpenseRow[]; total: number }[] = [];
    for (const e of data?.expenses || []) {
      let g = out[out.length - 1];
      if (!g || g.date !== e.expense_date) { g = { date: e.expense_date, rows: [], total: 0 }; out.push(g); }
      g.rows.push(e);
      if (!e.voided_at) g.total += Number(e.amount) || 0;
    }
    return out;
  }, [data]);

  const cats = useMemo(() => {
    const entries = Object.entries(data?.byCategory || {}).sort((a, b) => b[1] - a[1]);
    const max = entries.length ? entries[0][1] : 0;
    return entries.map(([k, v]) => ({ ...catOf(k), amount: v, share: max > 0 ? v / max : 0 }));
  }, [data]);

  const restaurants = data?.restaurants || [];

  return (
    <div className="adm-page owx-exp">
      <div className="exp-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="adm-page-h">Expenses</h1>
          <p className="adm-page-sub" style={{ margin: 0 }}>
            Money that left the business — breakages, repairs, bills, rent. Entries are never deleted:
            a wrong one is struck out with a reason and stays on the page.
          </p>
        </div>
        <div className="exp-head-actions">
          {restaurants.length > 1 && (
            <select className="adm-input" aria-label="Restaurant" value={rid}
              onChange={(e) => { setRid(e.target.value); setData(null); }}>
              {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <button className="adm-btn primary" onClick={() => setAddOpen(true)} disabled={!rid}
            title={rid ? "Record something you paid for" : "Loading your restaurant…"}>
            <i className="fas fa-plus" aria-hidden="true" /> Add expense
          </button>
        </div>
      </div>

      {notEnabled ? (
        <div className="adm-card">
          <h2>Not switched on</h2>
          <p className="hint">{notEnabled} Ask Aevidine to turn the Expenses section on for your restaurant.</p>
        </div>
      ) : (
        <>
          {/* Period picker */}
          <div className="exp-period">
            {/* The three month controls are ONE unit: on a 360px phone a wrapping label
                used to push the ›-button under itself and the two overlapped. */}
            <span className="exp-nav">
              <button className="adm-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
              <b className="exp-period-lbl">{periodTitle}</b>
              <button className="adm-btn" onClick={() => shiftMonth(1)} aria-label="Next month" disabled={atLatestMonth}>›</button>
            </span>
            <button className={`adm-btn${custom ? " on" : ""}`} onClick={() =>
              setCustom(custom ? null : { from: `${month}-01`, to: todayIST() })}>
              {custom ? "Whole month" : "Custom range"}
            </button>
            {custom && (
              <span className="exp-dates">
                <label>From <input className="adm-input" type="date" max={todayIST()} value={custom.from}
                  onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
                <label>To <input className="adm-input" type="date" max={todayIST()} value={custom.to}
                  onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span className="adm-muted exp-ago">{agoLabel(data?.cachedAt)}</span>
            <button className="adm-btn" onClick={() => load(true)} disabled={busy} title="Get the live figures now">
              <i className="fas fa-rotate" aria-hidden="true" /> Refresh
            </button>
          </div>

          {flash && <div className="exp-flash" role="status">{flash}</div>}

          {err && (
            <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 14 }}>
              <b>Couldn&apos;t load.</b>{" "}
              <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span>{" "}
              <button className="adm-btn" style={{ marginLeft: 6 }} onClick={() => load()}>Try again</button>
            </div>
          )}

          <div className="adm-stats">
            <div className="adm-stat"><div className="k">Spent in this period</div><div className="v">{data ? inr(data.total) : "…"}</div></div>
            <div className="adm-stat"><div className="k">Entries</div><div className="v">{data ? data.count.toLocaleString("en-IN") : "…"}</div></div>
            <div className="adm-stat"><div className="k">Average entry</div><div className="v">{data ? inr(data.average) : "…"}</div></div>
            <div className="adm-stat">
              <div className="k">Struck out</div>
              <div className="v">{data ? inr(data.voidedTotal) : "…"}</div>
              <div className="adm-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                {data ? `${data.voidedCount} entr${data.voidedCount === 1 ? "y" : "ies"} · not counted above` : ""}
              </div>
            </div>
          </div>

          {/* Where it went — a share list, not a chart: one bucket is a number, not a graph. */}
          <div className="adm-card" style={{ marginBottom: 14 }}>
            <h2>Where it went</h2>
            <p className="hint">
              {cats.length === 0
                ? "Nothing recorded in this period yet."
                : `${cats.length} categor${cats.length === 1 ? "y" : "ies"} used${data && data.total ? ` · ${inr(data.total)} in total` : ""}.`}
            </p>
            <div className="exp-catfilter">
              <button className={`exp-catchip${category === "" ? " on" : ""}`} onClick={() => setCategory("")}>All</button>
              {CATEGORIES.map((c) => (
                <button key={c.key} className={`exp-catchip${category === c.key ? " on" : ""}`}
                  onClick={() => setCategory(category === c.key ? "" : c.key)}>
                  <span aria-hidden="true">{c.icon}</span> {c.label}
                </button>
              ))}
            </div>
            {cats.length > 0 && (
              <div className="exp-bars">
                {cats.map((c) => (
                  <div key={c.key} className="exp-bar">
                    <span className="nm"><span aria-hidden="true">{c.icon}</span> {c.label}</span>
                    <span className="track"><span className="fill" style={{ width: `${Math.max(3, c.share * 100)}%`, background: c.color }} /></span>
                    <b className="amt">{inr(c.amount)}</b>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* The book itself */}
          <div className="adm-card">
            <h2>The book</h2>
            <p className="hint">Newest first. A struck-out entry stays here with its reason — it just leaves the totals.</p>
            {!data && !err && <div className="adm-empty">Loading expenses…</div>}
            {data && days.length === 0 && (
              <div className="adm-empty">
                {category ? `Nothing under ${catOf(category).label} in ${periodTitle}.` : `No expenses recorded in ${periodTitle}.`}
              </div>
            )}
            {days.map((g) => (
              <div key={g.date} className="exp-day">
                <div className="exp-dayhead">
                  <b>{dayLabel(g.date)}</b>
                  <span className="adm-muted">{inr(g.total)}</span>
                </div>
                {g.rows.map((e) => {
                  const c = catOf(e.category);
                  return (
                    <div key={e.id} className={`exp-row${e.voided_at ? " voided" : ""}`}>
                      <span className="ic" style={{ background: `color-mix(in srgb, ${c.color} 22%, transparent)` }} aria-hidden="true">{c.icon}</span>
                      <div className="mid">
                        <div className="ttl">{e.title}</div>
                        <div className="sub adm-muted">
                          {c.label}
                          {e.created_by ? ` · by ${e.created_by}` : ""}
                          {e.note ? ` · ${e.note}` : ""}
                        </div>
                        {e.voided_at && (
                          <div className="struck">
                            Struck out {stamp(e.voided_at)}{e.voided_by ? ` by ${e.voided_by}` : ""} — {e.void_reason || "no reason recorded"}
                          </div>
                        )}
                      </div>
                      {e.photo_url && (
                        <a href={e.photo_url} target="_blank" rel="noopener noreferrer" className="ph" title="Open the photo">
                          <img src={e.photo_url} alt={`Photo for ${e.title}`} />
                        </a>
                      )}
                      <b className="amt">{inr(e.amount)}</b>
                      {!e.voided_at && (
                        <button className="adm-btn strike" onClick={() => setVoidRow(e)}>Strike out</button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {data?.truncated && (
              <p className="adm-muted" style={{ fontSize: 12, marginTop: 12 }}>
                Showing the newest 500 entries for this period — narrow the dates or pick a category to see the rest.
              </p>
            )}
          </div>
        </>
      )}

      {addOpen && (
        <AddExpense rid={rid} onClose={() => setAddOpen(false)}
          onSaved={(what) => { setAddOpen(false); setFlash(what); load(true); }} />
      )}
      {voidRow && (
        <VoidExpense rid={rid} row={voidRow} onClose={() => setVoidRow(null)}
          onDone={(what) => { setVoidRow(null); setFlash(what); load(true); }} />
      )}

      <style jsx>{`
        .exp-head { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 16px; }
        .exp-head-actions { display: flex; gap: 8px; align-items: center; margin-left: auto; flex-wrap: wrap; }
        .exp-period { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
        .exp-nav { display: inline-flex; gap: 8px; align-items: center; flex: none; }
        .exp-period-lbl { min-width: 150px; text-align: center; font-size: 14px; white-space: nowrap; }
        .exp-period :global(.adm-btn.on) { border-color: ${GREEN}; color: var(--text); background: color-mix(in srgb, ${GREEN} 16%, transparent); }
        .exp-dates { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .exp-dates label { display: flex; gap: 6px; align-items: center; font-size: 12px; font-weight: 700; color: var(--muted); }
        .exp-dates :global(input) { padding: 7px 9px; font-size: 12.5px; color-scheme: light dark; }
        .exp-ago { font-size: 12px; }
        .exp-flash { margin-bottom: 12px; padding: 9px 13px; border-radius: 10px; font-size: 13px; font-weight: 700;
          background: color-mix(in srgb, ${GREEN} 15%, transparent); border: 1px solid color-mix(in srgb, ${GREEN} 45%, transparent); color: var(--text); }

        .exp-catfilter { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 4px; }
        .exp-catchip { background: var(--bg); border: var(--border); border-radius: 999px; padding: 6px 12px;
          font: inherit; font-size: 12px; font-weight: 700; color: var(--muted); cursor: pointer; }
        .exp-catchip.on { background: color-mix(in srgb, ${GREEN} 18%, transparent); border-color: ${GREEN}; color: var(--text); }

        .exp-bars { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
        .exp-bar { display: grid; grid-template-columns: minmax(96px, 130px) 1fr auto; gap: 10px; align-items: center; font-size: 13px; }
        .exp-bar .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
        .exp-bar .track { height: 10px; border-radius: 999px; background: color-mix(in srgb, var(--muted) 18%, transparent); overflow: hidden; }
        .exp-bar .fill { display: block; height: 100%; border-radius: 999px; }
        .exp-bar .amt { font-variant-numeric: tabular-nums; white-space: nowrap; }

        .exp-day { margin-top: 14px; }
        .exp-dayhead { display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
          font-size: 12.5px; padding: 6px 0; border-bottom: 1px solid color-mix(in srgb, var(--muted) 28%, transparent); }
        .exp-row { display: grid; grid-template-columns: 34px 1fr auto auto auto; gap: 10px; align-items: center; padding: 10px 0;
          border-bottom: 1px solid color-mix(in srgb, var(--muted) 15%, transparent); }
        .exp-row.voided { opacity: .62; }
        .exp-row.voided .ttl, .exp-row.voided .amt { text-decoration: line-through; }
        .exp-row .ic { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-size: 15px; }
        .exp-row .mid { min-width: 0; }
        .exp-row .ttl { font-weight: 700; font-size: 13.5px; overflow-wrap: anywhere; }
        .exp-row .sub { font-size: 12px; margin-top: 2px; overflow-wrap: anywhere; }
        .exp-row .struck { font-size: 11.5px; margin-top: 3px; font-weight: 700; color: var(--adm-danger, #dc2626); overflow-wrap: anywhere; }
        .exp-row .ph img { width: 40px; height: 40px; object-fit: cover; border-radius: 9px; display: block; }
        .exp-row .amt { font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 14px; }
        .exp-row :global(.adm-btn.strike) { padding: 6px 10px; font-size: 12px; }

        @media (max-width: 620px) {
          .exp-head-actions { margin-left: 0; width: 100%; }
          .exp-head-actions :global(select) { flex: 1; min-width: 0; }
          .exp-nav { width: 100%; }
          .exp-period-lbl { min-width: 0; flex: 1; font-size: 13.5px; }
          .exp-ago { width: 100%; order: 9; }
          .exp-row { grid-template-columns: 30px 1fr auto; row-gap: 6px; }
          .exp-row .ph { grid-column: 2; }
          .exp-row :global(.adm-btn.strike) { grid-column: 3; }
          .exp-bar { grid-template-columns: 1fr auto; }
          .exp-bar .track { grid-column: 1 / -1; }
        }
      `}</style>
    </div>
  );
}

// ── Add expense ───────────────────────────────────────────────────────────────
// A modal, so it registers with the back-button manager: on a phone the hardware BACK
// closes the form instead of leaving the panel (CLAUDE.md → Mobile hardware BACK button).
function AddExpense({ rid, onClose, onSaved }: { rid: string; onClose: () => void; onSaved: (msg: string) => void }) {
  useBackClose("owner-expense-add", true, onClose);
  const [category, setCategory] = useState("misc");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => todayIST());
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  // Synchronous re-entry guard: a fast double-tap must not book the cost twice before
  // React has flushed the disabled state (the action id makes the server refuse a
  // duplicate too, so this is belt AND braces).
  const sending = useRef(false);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const amt = Number(amount);
  const valid = !!rid && !!title.trim() && Number.isFinite(amt) && amt >= 0 && !!date && date <= todayIST();

  const save = async () => {
    // Never swallow a tap in silence (CLAUDE.md): a refusal always says why.
    if (sending.current || busy) return;
    if (!valid) { setErr(!title.trim() ? "Say what it was." : !Number.isFinite(amt) || amt < 0 ? "Enter a valid amount." : "Pick a date that isn't in the future."); return; }
    sending.current = true; setBusy(true); setErr(null);
    try {
      const payload = { action: "add", rid, category, title: title.trim(), amount: amt, expense_date: date, note: note.trim() || null };
      const headers: Record<string, string> = { "X-LFH-Action-Id": crypto.randomUUID() };
      let body: BodyInit;
      if (photo) {
        const fd = new FormData();
        fd.append("payload", JSON.stringify(payload));
        fd.append("photo", photo);
        body = fd;                                   // let the browser set the multipart boundary
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(payload);
      }
      const r = await fetch(`/api/owner/expenses?${new URLSearchParams({ rid })}${asSuffix()}`, { method: "POST", headers, body });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.clash?.plain || d.error || `Couldn't save (${r.status})`);
      onSaved(`Recorded “${title.trim()}” — ${inr(amt)}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { sending.current = false; setBusy(false); }
  };

  return (
    <div className="expm-wrap" role="dialog" aria-modal="true" aria-label="Add an expense">
      <div className="expm-back" onClick={() => !busy && onClose()} aria-hidden="true" />
      <div className="expm">
        <header>
          <div><h3>Add an expense</h3><p>This goes straight into the book. It can be struck out later, never deleted.</p></div>
          <button className="x" onClick={onClose} aria-label="Close" disabled={busy}>✕</button>
        </header>

        <label className="fl">What kind?</label>
        <div className="cats">
          {CATEGORIES.map((c) => (
            <button key={c.key} type="button" className={category === c.key ? "on" : ""} onClick={() => setCategory(c.key)}>
              <span aria-hidden="true">{c.icon}</span> {c.label}
            </button>
          ))}
        </div>

        <label className="fl" htmlFor="exp-title">What was it?</label>
        <input id="exp-title" ref={titleRef} className="adm-input w" placeholder="e.g. Bar lamp broken"
          value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />

        <div className="two">
          <div>
            <label className="fl" htmlFor="exp-amt">How much?</label>
            <input id="exp-amt" className="adm-input w" type="number" inputMode="decimal" min={0} step="0.01"
              placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="fl" htmlFor="exp-date">When?</label>
            <input id="exp-date" className="adm-input w" type="date" max={todayIST()}
              value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <label className="fl" htmlFor="exp-note">Note <span className="opt">(optional)</span></label>
        <input id="exp-note" className="adm-input w" placeholder="Anything the bill doesn't say"
          value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />

        <label className="fl" htmlFor="exp-photo">Photo <span className="opt">(optional — the broken thing, or the receipt)</span></label>
        <input id="exp-photo" className="adm-input w" type="file" accept="image/*"
          onChange={(e) => setPhoto(e.target.files?.[0] || null)} />

        {err && <div className="ferr" role="alert">{err}</div>}

        <footer>
          <span className="adm-muted" style={{ fontSize: 11.5, fontWeight: 600 }}>Saved against this restaurant, with your name.</span>
          <span className="btns">
            <button className="adm-btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="adm-btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save expense"}</button>
          </span>
        </footer>
      </div>
      <style jsx>{`
        .expm-wrap { position: fixed; inset: 0; z-index: 130; display: grid; place-items: center; padding: 12px; }
        .expm-back { position: absolute; inset: 0; background: rgba(5,8,14,.55); backdrop-filter: blur(2px); }
        .expm { position: relative; width: min(520px, 96vw); max-height: 92vh; overflow: auto; background: var(--card);
          border: var(--border); border-radius: 16px; box-shadow: 0 24px 70px rgba(0,0,0,.45); padding: 18px 20px; }
        .expm header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
        .expm h3 { margin: 0; font-size: 16px; }
        .expm header p { margin: 4px 0 0; font-size: 12px; color: var(--muted); line-height: 1.5; }
        .expm .x { background: var(--bg); border: var(--border); color: var(--text); width: 30px; height: 30px; border-radius: 9px; font-size: 13px; cursor: pointer; flex: none; }
        .fl { display: block; font-size: 12px; font-weight: 800; color: var(--muted); margin: 12px 0 5px; }
        .fl .opt { font-weight: 600; text-transform: none; }
        .expm :global(.adm-input.w) { width: 100%; }
        .cats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
        .cats button { background: var(--bg); border: var(--border); border-radius: 9px; padding: 8px 4px; font: inherit;
          font-size: 11.5px; font-weight: 700; color: var(--muted); cursor: pointer; }
        .cats button.on { background: color-mix(in srgb, ${GREEN} 18%, transparent); border-color: ${GREEN}; color: var(--text); }
        .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .ferr { margin-top: 12px; padding: 9px 12px; border-radius: 9px; font-size: 12.5px; font-weight: 700; color: #fff;
          background: var(--adm-danger, #dc2626); }
        .expm footer { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
        .btns { display: inline-flex; gap: 8px; }
        @media (max-width: 480px) {
          .cats { grid-template-columns: repeat(2, 1fr); }
          .expm { padding: 14px; }
          .expm footer { justify-content: stretch; }
          .btns { width: 100%; }
          .btns :global(.adm-btn) { flex: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Strike one out ────────────────────────────────────────────────────────────
// A reason is REQUIRED — that is the whole point of an append-only book. The call sends
// `expect: { void_reason: null }` so if someone else struck this out first, the server
// refuses and tells this person what it now says (first save wins, CLAUDE.md).
function VoidExpense({ rid, row, onClose, onDone }: {
  rid: string; row: ExpenseRow; onClose: () => void; onDone: (msg: string) => void;
}) {
  useBackClose("owner-expense-void", true, onClose);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  useEffect(() => { ref.current?.focus(); }, []);

  const strike = async () => {
    if (sending.current || busy) return;
    if (!reason.trim()) { setErr("Say why — the reason is kept with the entry."); return; }
    sending.current = true; setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/owner/expenses?${new URLSearchParams({ rid })}${asSuffix()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LFH-Action-Id": crypto.randomUUID(),
          // What this screen was looking at, so a second person can't silently overwrite
          // the first person's reason (lib/clash.ts → expectClash).
          "X-LFH-Expect": JSON.stringify({ table: "expenses", id: row.id, fields: { void_reason: null }, label: "this expense" }),
        },
        body: JSON.stringify({ action: "void", rid, id: row.id, reason: reason.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.clash?.plain || d.error || `Couldn't strike it out (${r.status})`);
      onDone(`Struck out “${row.title}”.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { sending.current = false; setBusy(false); }
  };

  return (
    <div className="expv-wrap" role="dialog" aria-modal="true" aria-label="Strike out an expense">
      <div className="expv-back" onClick={() => !busy && onClose()} aria-hidden="true" />
      <div className="expv">
        <h3>Strike out this expense?</h3>
        <p className="sub">
          <b>{row.title}</b> — {inr(row.amount)} on {dayLabel(row.expense_date)}.
        </p>
        <p className="sub">
          It stays in the book with a line through it and this reason beside it, and drops out of the totals.
          Nothing is deleted.
        </p>
        <label className="fl" htmlFor="exp-void-reason">Why?</label>
        <input id="exp-void-reason" ref={ref} className="adm-input w" maxLength={300}
          placeholder="e.g. entered twice by mistake" value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") strike(); }} />
        {err && <div className="ferr" role="alert">{err}</div>}
        <footer>
          <button className="adm-btn" onClick={onClose} disabled={busy}>Keep it</button>
          <button className="adm-btn danger" onClick={strike} disabled={busy}>{busy ? "Striking out…" : "Strike out"}</button>
        </footer>
      </div>
      <style jsx>{`
        .expv-wrap { position: fixed; inset: 0; z-index: 140; display: grid; place-items: center; padding: 12px; }
        .expv-back { position: absolute; inset: 0; background: rgba(5,8,14,.55); backdrop-filter: blur(2px); }
        .expv { position: relative; width: min(440px, 96vw); background: var(--card); border: var(--border);
          border-radius: 16px; box-shadow: 0 24px 70px rgba(0,0,0,.45); padding: 18px 20px; }
        .expv h3 { margin: 0 0 8px; font-size: 16px; }
        .sub { margin: 0 0 8px; font-size: 12.5px; color: var(--muted); line-height: 1.5; }
        .sub b { color: var(--text); }
        .fl { display: block; font-size: 12px; font-weight: 800; color: var(--muted); margin: 12px 0 5px; }
        .expv :global(.adm-input.w) { width: 100%; }
        .ferr { margin-top: 12px; padding: 9px 12px; border-radius: 9px; font-size: 12.5px; font-weight: 700; color: #fff;
          background: var(--adm-danger, #dc2626); }
        footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
        @media (max-width: 420px) { footer :global(.adm-btn) { flex: 1; } }
      `}</style>
    </div>
  );
}
