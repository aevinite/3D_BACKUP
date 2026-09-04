"use client";
// Owner · Pay Later — the khata liability view: who owes money across the owner's
// restaurant(s), each person's open bills, and how much pay-later money was collected
// today / this month (by collection day). READ-ONLY; collecting happens in the manager
// panel. Scoped + module-gated server-side (see /api/owner/khata). 60s backstop refresh
// paused while hidden (egress rule); a search filters the loaded list client-side.
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
import { inr } from "@/components/admin/shared";
// From lib/partialRead, NOT lib/ownerScope: this is a "use client" file, and ownerScope reaches
// lib/supabaseAdmin (service-role, server-only). Importing it here shipped that module to the browser
// and crashed this page with "supabaseKey is required." (2026-08-06).
import { partialNote } from "@/lib/partialRead";
import { asSuffix } from "@/lib/ownerPin";
// ── A NUMBER YOU ARE ABOUT TO RING IS SPACED SO IT CAN BE READ ALOUD (sweep 8 · T16, 2026-09-04) ─
// This screen printed a guest's mobile as one ten-digit run — MEASURED on the phone he tests:
// `9876500077`, sitting directly under a Customers list that showed `90000 00007`. Pay Later is the
// screen you open when you are about to phone the person who owes you money, so it is the one that
// most needs the number grouped. Same helper, one place: lib/phoneText.ts (zero imports, so it is
// safe in this "use client" file, exactly like lib/searchText and lib/partialRead beside it).
import { showPhone } from "@/lib/phoneText";

const IST = "Asia/Kolkata";
type Bill = { bill_no: number | null; table_number: string | null; khata_at: string; amount: number };
type Person = {
  id: string; restaurant_id: string; restaurantName: string; name: string; phone: string | null;
  note: string | null; outstanding: number; billCount: number; oldestKhataAt: string; bills: Bill[];
};
// `collectedMonth` / `collectedToday` are `number | null` (T9 improvement 2, 2026-08-06): NULL means
// that figure could not be read, and the key is named in the payload's `partial` list. It is NOT a
// zero — showing "₹0 collected today" for a read that failed is a claim about the till.
type Summary = { totalOutstanding: number; peopleCount: number; billCount: number; collectedMonth: number | null; collectedToday: number | null };

// ── A DATE WE CANNOT READ SHOWS A DASH, NEVER "Invalid Date" OR "oldest NaN days" ────────────────
// (sweep 7 · T14 round 2, 2026-08-31.) `new Date("nope")` gives NaN and both of these printed it
// straight out — measured: a row read "oldest NaN days" and its bill line read "Invalid Date". Not
// reachable from real data (the route only returns rows whose `khata_at` is set), but a credit book
// is the last screen that should ever look broken, and the guard is one function.
const ok = (iso: string) => Number.isFinite(new Date(iso).getTime());
const fmt = (iso: string) => (ok(iso) ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST }) : "—");
const ageDays = (iso: string) => {
  if (!ok(iso)) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`;
};

// ── AN OLD TAB IS THE ONE THAT GETS FORGOTTEN (sweep 6 · T14, 2026-08-18) ────────────────────────
// The list is ordered by how much is owed, which is right — but it means a ₹120 tab from three
// months ago sits quietly at the bottom under a ₹4,000 one from Tuesday, and a credit book is how a
// small restaurant loses money without noticing. Age now carries its own colour past 30 and 60 days.
// The WORDS do not change ("oldest 92 days"), so the colour adds emphasis rather than carrying the
// meaning on its own, and a fresh tab looks exactly as it always did.
const OldestTab = ({ iso }: { iso: string }) => {
  const d = ok(iso) ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0;
  const tone = d >= 60 ? "var(--adm-danger, #e5484d)" : d >= 30 ? "var(--adm-warn, #c98a2b)" : null;
  return (
    <span style={tone ? { color: tone, fontWeight: 700 } : undefined}
      title={tone ? "This tab has been open a long time" : undefined}>
      oldest {ageDays(iso)}
    </span>
  );
};

export default function OwnerKhata() {
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));

  const [customers, setCustomers] = useState<Person[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  // Which figures the server could NOT read this time (T9 improvement 2). Cleared on every load, so
  // a passing blip disappears from the screen the moment it stops happening.
  const [partial, setPartial] = useState<string[]>([]);
  // The tiles above always count EVERY open bill (mig 309's aggregate); the list below is bounded to
  // the biggest 500 people. On a book that long the page has to say so, or an owner reads the list
  // as the whole book and concludes people are missing (T7 finding F13).
  const [shown, setShown] = useState<{ of: number; showing: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const multi = new Set((customers || []).map((c) => c.restaurant_id)).size > 1;

  const load = useCallback(async () => {
    try {
      const qs = scopePin ? `?scope=${scopePin}${asSuffix()}` : "";
      const j = await (await fetch(`/api/owner/khata${qs}`, { cache: "no-store" })).json();
      if (j.error) throw new Error(j.error);
      setCustomers(j.customers || []); setSummary(j.summary || null); setErr(null);
      setPartial(Array.isArray(j.partial) ? j.partial : []);
      setShown(j.listCapped ? { of: j.summary?.peopleCount || 0, showing: Number(j.peopleShown) || 0 } : null);
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
      {/* REJECTED (owner, 2026-08-18): do NOT make this page hide itself, grey itself out or say
          "Pay Later isn't enabled" when the module reads off. Built once as sweep-6 item 4 and taken
          straight back out on his word — *"if the feature is on by me, it will stay on"*. The page
          shows the book; it never decides whether Pay Later exists. `/api/owner/khata` does send
          `moduleOff`, and it stays deliberately unread here. docs/REJECTED-IDEAS.md → R34. */}
      <h1 className="adm-page-h">Pay Later</h1>
      <p className="adm-page-sub">Money guests still owe on a tab, and how much you&apos;ve collected. Staff collect a tab from the manager panel; this is your live view of what&apos;s outstanding.</p>

      {/* ── THE FOUR FIGURES LINE UP, EVEN WHEN A LABEL WRAPS (sweep 8 · T16, 2026-09-04) ──────────
          Same fault the guest record already had fixed as sweep 7 · T14 item 10, on the tiles this
          time. "Collected this month" is the longest of the four labels, so on a phone it wraps to
          two lines and pushes its own number down. MEASURED at 360px: "Collected today"'s ₹0 sat at
          y=261 and "Collected this month"'s ₹0 at y=275 — 14px apart, on the row the eye reads
          across. The boxes were always the same height (they are grid cells); it was the NUMBERS
          that did not line up. Each tile is now a column with the label on top and the number
          pinned to the bottom, so the figures share a baseline whether a label wraps or not.
          Inline on these four tiles only — `.adm-stats` is shared with half the panel. */}
      <div className="adm-stats" style={{ marginBottom: 14, alignItems: "stretch" }}>
        <div className="adm-stat" style={{ display: "flex", flexDirection: "column" }}><div className="k">Outstanding now</div><div className="v" style={{ marginTop: "auto" }}>{summary ? inr(summary.totalOutstanding) : "…"}</div></div>
        <div className="adm-stat" style={{ display: "flex", flexDirection: "column" }}><div className="k">People who owe</div><div className="v" style={{ marginTop: "auto" }}>{summary ? summary.peopleCount.toLocaleString("en-IN") : "…"}</div></div>
        {/* A figure that could NOT be read shows a dash, not ₹0 — and the note below says which
            one and offers Refresh. `inr(0)` and "we didn't read it" must never look the same. */}
        <div className="adm-stat" style={{ display: "flex", flexDirection: "column" }}><div className="k">Collected today</div><div className="v" style={{ marginTop: "auto" }}>{!summary ? "…" : summary.collectedToday === null ? "—" : inr(summary.collectedToday)}</div></div>
        <div className="adm-stat" style={{ display: "flex", flexDirection: "column" }}><div className="k">Collected this month</div><div className="v" style={{ marginTop: "auto" }}>{!summary ? "…" : summary.collectedMonth === null ? "—" : inr(summary.collectedMonth)}</div></div>
      </div>

      {/* Not a warning — a plain statement of what the list holds, so the tiles above and the rows
          below can never seem to contradict each other. */}
      {shown && (
        <p className="adm-page-sub" style={{ marginTop: -6, marginBottom: 14 }}>
          Showing the {shown.showing.toLocaleString("en-IN")} people who owe the most, of{" "}
          {shown.of.toLocaleString("en-IN")}. The figures above count everyone.
        </p>
      )}

      {partial.length > 0 && (
        <div className="adm-card" style={{ marginBottom: 14, borderColor: "var(--adm-warn)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-warn)" }} aria-hidden="true" />
          <span style={{ flex: 1, minWidth: 200 }}>{partialNote(partial)}</span>
          <button className="adm-btn" onClick={() => load()}><i className="fas fa-rotate" aria-hidden="true" /> Try again</button>
        </div>
      )}

      <div className="adm-card">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          {/* REJECTED (owner, 2026-08-18): no "oldest first" ordering control here. Offered as sweep-6
              item 13 and refused — *"We don't need the thirteenth one."* The book stays ordered by how
              much is owed. (It could not have been done honestly from this screen anyway: the list is
              bounded to the biggest 500 debts, so "oldest" of that slice is not the oldest on the book
              — the order would have to move into `lfh_khata_outstanding`.) The age colouring on each
              row is the part that IS wanted. docs/REJECTED-IDEAS.md → R35. */}
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

        {/* ── A READ THAT FAILED IS NOT AN EMPTY BOOK (sweep 7 · T14 round 2, 2026-08-31) ──────────────────
            The loading branch was guarded — `customers === null && !err` — but the EMPTY branch below it was
            not, so a failed first load fell straight through to it. Measured: with the route answering 500,
            Pay Later showed the red "Couldn't load" card AND, underneath it, **"No one owes anything right
            now."** That is a claim about money made from no data, on the one screen whose whole job is to
            say who owes what; Customers did the same with "No customers yet".
            The sister screen already had this right — Feedback & complaints says "this is a loading error,
            not 'no ratings'" — so this is the same sentence, in the same shape, on the two that lacked it. */}
        {customers === null && !err ? (
          <div className="adm-empty">Loading Pay Later…</div>
        ) : customers === null ? (
          <div className="adm-empty" style={{ color: "var(--adm-danger)" }}>
            Couldn&apos;t read the credit book — this is a loading error, not &ldquo;nobody owes anything.&rdquo;{" "}
            <button className="adm-btn" style={{ marginLeft: 6 }} onClick={() => load()}>Try again</button>
          </div>
        ) : rows.length === 0 ? (
          // A SEARCH THAT FOUND NOBODY MUST SAY WHERE IT LOOKED (sweep 6 · T14, 2026-08-18). This box
          // filters the list already on the page, and that list is the biggest `shown.showing` debts
          // — so on a long book "No one matches that search" was a claim about the whole book that
          // this screen had no way of making. An owner reading it would conclude the person had
          // already paid. Only shown when the list really is capped; on an ordinary book the old
          // sentence is the true one and is what still appears.
          <div className="adm-empty">
            {!q
              ? "No one owes anything right now. Parked (pay-later) bills show up here until they're collected."
              : shown
                ? `No one matches that search among the ${shown.showing.toLocaleString("en-IN")} people who owe the most. There are ${shown.of.toLocaleString("en-IN")} people on the book in all.`
                : "No one matches that search."}
          </div>
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
                      {c.phone ? showPhone(c.phone) : "no mobile"}{c.note ? ` · ${c.note}` : ""}
                      {multi ? <> · <span className="adm-chip">{c.restaurantName}</span></> : null}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    <div style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{inr(c.outstanding)}</div>
                    <div className="adm-muted" style={{ fontSize: 11.5 }}>
                      {c.billCount} bill{c.billCount === 1 ? "" : "s"} · <OldestTab iso={c.oldestKhataAt} />
                    </div>
                  </div>
                </button>
                {open.has(c.id) && (
                  <div style={{ borderTop: "1px solid var(--border-c,#e5e7eb)", padding: "6px 14px 12px 38px" }}>
                    {c.bills.map((b, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", fontSize: 13,
                        borderBottom: i < c.bills.length - 1 ? "1px solid color-mix(in srgb, var(--border-c,#e5e7eb) 55%, transparent)" : "0" }}>
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
