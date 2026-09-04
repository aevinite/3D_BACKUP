"use client";
// Admin · Recycle bin — things that were DELETED (soft-deleted) live here until the admin either
// brings them back or removes them for good. Two kinds: deleted RESTAURANTS (mig 128) and deleted
// OWNERS (mig 208).
//
// ── WHAT CHANGED ON 2026-08-20, AND WHY (owner) ────────────────────────────────────────────────
// Three of his instructions, in his words:
//
//  1. *"i wanna chnage the rule that you camn't permamnetly delete from recycle bin what i wanna do
//     is you can able to dlete from recycyle bin"* — the 90-day wait is GONE. Every row can be
//     removed for good the moment it is in the bin. The countdown chip became a plain "in the bin
//     for N days", which is a fact rather than a permission. Migration 342 removed the database's
//     half of the lock so the two can't disagree. What did NOT go with it: typing the exact name to
//     confirm, the offer to download a backup first, and the money — bills, invoices, payments and
//     credit notes survive a removal and stay readable in Bills (mig 309).
//
//  2. *"if the name is available in the resutrant and recycle and recycle want to restore so it say
//     like name already tke 2 option can show 1 opion close 2nd chnage name and restore"* — a
//     restaurant restore that collides on its web address used to RENAME ITSELF silently
//     (aangan → aangan-2) and mention it afterwards. Now it asks, with exactly the two ways out he
//     named, and nothing is written until he presses one. This is the same shape the owner rows
//     have used since mig 245.
//
//  3. *"when you click owner and resrurant in recycle bin you could able to see inside it my
//     clicking iindiviual able to vivit there panel too"* — every row OPENS. A restaurant shows
//     what is actually in it (menu, staff, tables, orders, unpaid tabs) and buttons into its
//     panels; an owner shows which restaurants they hold and a way into each one. The bin used to
//     be a name, a date and an irreversible button, which meant deciding blind.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAdminModal } from "@/components/admin/useAdminModal";
// istDate: the console's ONE reading of a date ("16 Aug 26"), pinned to Indian time.
import { openRestaurantPanel, istDate } from "@/components/admin/shared";

// `canPurge` used to be here and is GONE (T16 sweep #7, 2026-08-27). The route still answers it,
// always `true`, because migration 342 removed the 90-day lock — so it was a field that could only
// ever say yes, read by nothing, sitting on the type that describes a permanent delete. A dead
// permission flag beside a destructive action is the kind of thing a later reader wires back up.
// `daysHeld` stays: it is a FACT ("in the bin 12 days"), not a permission.
type Trashed = {
  id: string; slug: string; name: string;
  deletedAt: string; deletedBy: string | null; reason: string | null;
  daysHeld: number;
};

type OwnerTrashed = {
  id: string; username: string; name: string; restaurants: number;
  deletedAt: string; deletedBy: string | null; reason: string | null;
  daysHeld: number;
};

// ── ITEM 12 · THIS PAGE'S OWN DATE FORMAT IS GONE (owner picked it, 2026-09-04) ───────────────
// `fmtDate` was a private copy: it took the READER'S locale (so the same row read differently on a
// computer set to another country) and named no timezone at all (so a restaurant binned near
// midnight Indian time showed the day before, or after, depending on where you opened it). The
// console already exports ONE reading of a date — components/admin/shared.tsx → istDate — and
// Revenue, Customers and Billing all use it. Three copies of "how do we write a date" is how three
// screens come to write the same day differently, and it is exactly what that helper was made to
// stop. Same fall-back-to-the-raw-string behaviour for a date that cannot be parsed.
const fmtDate = istDate;
const heldFor = (days: number) => days <= 0 ? "In the bin since today" : `In the bin ${days} day${days === 1 ? "" : "s"}`;
/** A count that couldn't be read draws as "?" — never as a confident 0. This screen decides a
 *  permanent delete, so "0 orders" had better not mean "we didn't manage to ask". */
const num = (n: number | null | undefined) => (n === null || n === undefined ? "?" : String(n));

export default function RecycleBin() {
  const [list, setList] = useState<Trashed[] | null>(null);
  const [owners, setOwners] = useState<OwnerTrashed[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ownerMsg, setOwnerMsg] = useState<string | null>(null);
  // A restore that had to rename the restaurant says so here, and STAYS until dismissed — it means
  // the QR codes on the tables now point at the wrong address, which is not a toast-sized fact.
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMsg(null); setOwnerMsg(null);
    try {
      const j = await (await fetch("/api/admin/restaurants?deleted=1", { cache: "no-store" })).json();
      if (!j.error) { setList(j.trashed || []); }
      else { setMsg(j.error); setList([]); } // show the error + Retry, not a perpetual "Loading…" (audit 2026-07-08)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setList([]); }
    try {
      const j = await (await fetch("/api/admin/owners?deleted=1", { cache: "no-store" })).json();
      if (!j.error) { setOwners(j.trashed || []); }
      else { setOwnerMsg(j.error); setOwners([]); }
    } catch (e) { setOwnerMsg(e instanceof Error ? e.message : String(e)); setOwners([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <nav className="adm-crumbs" aria-label="Breadcrumb" style={{ marginBottom: 14 }}>
        <a href="/aevinite/restaurants">Restaurants</a>
        <i className="fas fa-chevron-right sep" aria-hidden="true" />
        <span className="cur">Recycle bin</span>
      </nav>
      <h1 className="adm-page-h">Recycle bin</h1>
      <p className="adm-page-sub">
        Deleted restaurants and owners wait here. <b>Restore</b> any of them at any time, or open one to see what is
        inside it first. Anything here can also be <b>removed for good</b> whenever you choose — there is no waiting period.
      </p>
      {/* WHAT "PERMANENTLY REMOVED" ACTUALLY MEANS, ON THE SCREEN THAT OFFERS IT (T20 sweep,
          2026-08-16). This page used to promise that removal erases "ALL its data (menu, orders,
          bills, staff)". Since migration 309 that is the opposite of what happens: the money is
          kept on purpose for the 6-8 year records retention. Saying so here — once, at the top —
          is what stops an admin answering a client's "is it all gone?" wrongly in either direction. */}
      <div className="adm-card" style={{ marginBottom: 16, display: "flex", gap: 11, alignItems: "flex-start" }}>
        <i className="fas fa-circle-info" style={{ color: "var(--accent)", marginTop: 2 }} aria-hidden="true" />
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--muted)" }}>
          <b style={{ color: "var(--text)" }}>Removing a restaurant does not erase its sales.</b> The menu, staff logins,
          settings, saved customers and activity log are deleted for good. The bills, invoices, payments,
          credit notes and the record of what was removed and why are <b style={{ color: "var(--text)" }}>kept</b> —
          the law expects them to be available for years, and they stay readable in <b style={{ color: "var(--text)" }}>Bills</b>.
        </p>
      </div>

      {notice && (
        <div className="adm-card" role="status" style={{ marginBottom: 14, borderColor: "var(--adm-warn)", background: "color-mix(in srgb, var(--adm-warn) 10%, var(--card))", display: "flex", gap: 11, alignItems: "flex-start" }}>
          <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-warn)", marginTop: 2 }} aria-hidden="true" />
          <span style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>{notice}</span>
          <button className="adm-btn" style={{ fontSize: 12 }} onClick={() => setNotice(null)}>Got it</button>
        </div>
      )}

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: "18px 0 8px" }}>Deleted restaurants</h2>
      <div className="adm-card">
        {msg && <div className="adm-empty" style={{ color: "var(--adm-danger)" }}>{msg} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></div>}
        {list === null ? (
          <div className="adm-empty">Loading…</div>
        ) : list.length === 0 ? (
          <div className="adm-empty">{msg ? "" : "No deleted restaurants."}</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {list.map((r) => <BinRow key={r.id} r={r} onChanged={load} onRenamed={setNotice} />)}
          </div>
        )}
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: "22px 0 8px" }}>Deleted owners</h2>
      <div className="adm-card">
        {ownerMsg && <div className="adm-empty" style={{ color: "var(--adm-danger)" }}>{ownerMsg} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></div>}
        {owners === null ? (
          <div className="adm-empty">Loading…</div>
        ) : owners.length === 0 ? (
          <div className="adm-empty">{ownerMsg ? "" : "No deleted owners."}</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {owners.map((o) => <OwnerBinRow key={o.id} o={o} onChanged={load} />)}
          </div>
        )}
      </div>
    </>
  );
}

// ── WHAT IS INSIDE A BINNED RESTAURANT ─────────────────────────────────────────────────────────
// Fetched ONCE, the first time the row is opened, and kept — reopening the same row costs nothing.
// The server answers in head-counts only (no rows), so this is a handful of numbers on the wire.
type BinInside = {
  restaurant: { id: string; name: string; slug: string; active: boolean; createdAt: string | null; deletedAt: string; deletedBy: string | null; reason: string | null; purged: boolean };
  owners: { id: string; name: string; binned: boolean }[];
  inside: {
    categories: number | null; dishes: number | null; staff: number | null;
    staffByRole: Record<string, number>; tables: number | null;
    panels: Record<string, boolean> | null;
    orders: number | null; sessions: number | null; savedCustomers: number | null;
    unpaidPayLaterBills: number | null; feedback: number | null;
  };
  settingsUnread?: boolean;
  unread?: string[];
};

// ── A BLOCKED TAB IS NOT A LOCKED DOOR (T16 sweep #7, 2026-08-27) ─────────────────────────────
// Every door on this page used to answer a blocked pop-up with "Your browser blocked that tab —
// allow pop-ups for this site and try again", written into `insideErr` — the same slot a failed
// count read uses, so the message arrived beside a "Retry" button that re-reads the COUNTS and
// does nothing about the panel. Two faults in one line. The owner ruled on this wording for the
// platform floor on 2026-08-20 ("admin has access to everything… it should take you to the
// restaurant"), and the floor now offers a way in. So does this: the act-as redirect is an
// ordinary navigation, so opening the panel in THIS tab needs no pop-up at all.
const hereHref = (rid: string, to: string, opts: { uid?: string; bin?: boolean } = {}) =>
  `/api/admin/act-as/go?rid=${encodeURIComponent(rid)}&to=${encodeURIComponent(to)}`
  + (opts.uid ? `&uid=${encodeURIComponent(opts.uid)}` : "")
  + (opts.bin ? "&bin=1" : "");

function BlockedHere({ href, label, onClose }: { href: string; label: string; onClose: () => void }) {
  return (
    <div role="status" style={{ padding: "10px 12px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.55,
      border: "1px solid color-mix(in srgb, var(--accent) 45%, transparent)", background: "color-mix(in srgb, var(--accent) 9%, transparent)" }}>
      <b>Your browser blocked the new tab.</b> Nothing else is in the way — you can open{" "}
      <b>{label}</b> right here instead.
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9 }}>
        <a className="adm-btn primary" href={href}>
          <i className="fas fa-arrow-right-to-bracket" style={{ marginRight: 7 }} aria-hidden="true" />Open {label} here
        </a>
        <button className="adm-btn" onClick={onClose}>Not now</button>
      </div>
    </div>
  );
}

// ONE DOOR PER PANEL (2026-09-03). There were TWO rows here that opened the same screen:
// "Manager" → /manager and "Menu editor" → /editor, which is the retired address that only
// redirects to /manager. So the recycle bin offered a binned restaurant's manager panel twice
// under two different names, and the second name ("Menu editor") described a TAB inside it
// rather than a screen of its own. The duplicate is gone; /editor itself stays, for old links.
const PANEL_DOORS: { to: string; label: string; icon: string }[] = [
  { to: "/manager", label: "Manager", icon: "fa-table-columns" },
  { to: "/kitchen", label: "Kitchen", icon: "fa-fire-burner" },
  { to: "/tablet", label: "Tablet", icon: "fa-tablet-screen-button" },
  { to: "/owner", label: "Owner", icon: "fa-crown" },
];

function InsideCounts({ d, onRetry, busy }: { d: BinInside; onRetry: () => void; busy: boolean }) {
  const i = d.inside;
  const cells: { k: string; v: string }[] = [
    { k: "Dishes", v: num(i.dishes) },
    { k: "Categories", v: num(i.categories) },
    { k: "Staff logins", v: num(i.staff) },
    { k: "Tables", v: num(i.tables) },
    { k: "Orders on record", v: num(i.orders) },
    { k: "Table sessions", v: num(i.sessions) },
    { k: "Saved customers", v: num(i.savedCustomers) },
    { k: "Unpaid pay-later bills", v: num(i.unpaidPayLaterBills) },
    { k: "Guest feedback", v: num(i.feedback) },
  ];
  const roles = Object.entries(i.staffByRole).filter(([, n]) => n > 0);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="adm-stats" style={{ marginBottom: 0 }}>
        {cells.map((c) => <div key={c.k} className="adm-stat"><div className="k">{c.k}</div><div className="v">{c.v}</div></div>)}
      </div>
      {roles.length > 0 && (
        <p className="adm-muted" style={{ margin: 0, fontSize: 12 }}>
          Staff: {roles.map(([r, n]) => `${n} ${r}`).join(" · ")}
        </p>
      )}
      {/* AN UNPAID TAB IS THE ONE FIGURE THAT SHOULD STOP A HAND. Removing the restaurant deletes the
          pay-later person book with it — the bills themselves survive, but who owed them does not. */}
      {!!i.unpaidPayLaterBills && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--adm-warn)" }}>
          <i className="fas fa-circle-exclamation" style={{ marginRight: 6 }} aria-hidden="true" />
          {i.unpaidPayLaterBills} pay-later bill{i.unpaidPayLaterBills === 1 ? " is" : "s are"} still unpaid here. The bills are kept, but
          removing this restaurant deletes the record of <b>who</b> owes them.
        </p>
      )}
      {/* AN INSTRUCTION THAT DID NOTHING (T20 sweep #8, 2026-09-04). This line used to end
          "— close and reopen this row to try again", and reopening the row refetched NOTHING:
          `toggleOpen` only reads when `inside` is still null, and a partly-unread answer IS an
          answer, so `inside` was set and the reopen was a no-op. The "?" stayed until the whole
          page was reloaded — on the screen that decides a permanent delete, where a "?" instead
          of a count is exactly the thing you must not act on. A button that really re-reads is
          the honest version of the sentence that was already there. */}
      {(d.unread?.length || d.settingsUnread) && (
        <p className="adm-muted" style={{ margin: 0, fontSize: 12, display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontStyle: "italic" }}>
            Some of these couldn&apos;t be read just now and show as &ldquo;?&rdquo;.
          </span>
          <button className="adm-btn" style={{ fontSize: 11.5, padding: "3px 9px" }} disabled={busy} onClick={onRetry}>
            <i className="fas fa-rotate-right" style={{ marginRight: 6 }} aria-hidden="true" />{busy ? "Reading…" : "Try again"}
          </button>
        </p>
      )}
      {d.owners.length > 0 && (
        <p className="adm-muted" style={{ margin: 0, fontSize: 12 }}>
          Owned by {d.owners.map((o) => o.name + (o.binned ? " (also in the bin)" : "")).join(", ")}
        </p>
      )}
    </div>
  );
}

function BinRow({ r, onChanged, onRenamed }: { r: Trashed; onChanged: () => void; onRenamed: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [wantBackup, setWantBackup] = useState(true);
  // Open the row → what is actually inside it. Fetched once and kept.
  const [open, setOpen] = useState(false);
  const [inside, setInside] = useState<BinInside | null>(null);
  const [insideErr, setInsideErr] = useState<string | null>(null);
  const [insideBusy, setInsideBusy] = useState(false);
  // A blocked new tab, kept apart from insideErr — see BlockedHere above.
  const [blocked, setBlocked] = useState<{ href: string; label: string } | null>(null);
  // Set when the server says its web address was taken while it sat here.
  const [clash, setClash] = useState<SlugClash | null>(null);
  const [clashErr, setClashErr] = useState<string | null>(null);
  const [pendingActivate, setPendingActivate] = useState(false);

  // ONE typing rule on this page (owner, 2026-08-16: "keep that rule, remove other one"). The
  // owner row below has always compared case-insensitively; this one demanded exact capitals, and
  // restaurant names here are stored shouting ("AANGAN GARDEN RESTAURANT"), so the strict one was
  // the one a person actually met — the button just stayed grey with nothing saying why.
  const nameMatches = confirmName.trim().toLowerCase() === r.name.trim().toLowerCase();

  const loadInside = useCallback(async () => {
    setInsideBusy(true); setInsideErr(null);
    try {
      const res = await fetch(`/api/admin/restaurants?bin_detail=${encodeURIComponent(r.id)}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't read what's inside.");
      setInside(d as BinInside);
    } catch (e) { setInsideErr(e instanceof Error ? e.message : String(e)); }
    setInsideBusy(false);
  }, [r.id]);

  // Reopening a row that came back COMPLETE costs nothing and re-reads nothing — that is the
  // "fetched once and kept" rule, and it stays. Reopening one that came back with a hole in it
  // now really does try again, which is what the line under the counts always claimed.
  const insideIncomplete = !!inside && !!(inside.unread?.length || inside.settingsUnread);
  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && (!inside || insideIncomplete) && !insideBusy) loadInside();
  };

  // resolve = undefined for the plain first attempt; the dialog re-calls with one.
  const restore = async (activate: boolean, resolve?: { name: string; slug: string }) => {
    setBusy(true); setErr(null); setClashErr(null);
    const dialogOpen = clash !== null;
    try {
      const res = await fetch("/api/admin/restaurants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore_restaurant", restaurant_id: r.id, activate, ...(resolve ? { resolve } : {}) }),
      });
      const d = await res.json();
      // A NAME CLASH IS A QUESTION, NOT AN ERROR (owner, 2026-08-20). Open the chooser rather than
      // dumping a red line on the row — and remember which Restore button was pressed, so the
      // answer restores it the same way (suspended, or live).
      if (res.status === 409 && d.conflict) {
        if (dialogOpen && resolve) setClashErr(`“/r/${d.conflict.slug}/menu” is taken as well — pick another.`);
        setPendingActivate(activate);
        setClash(d.conflict as SlugClash);
        setBusy(false); return;
      }
      // A refusal while the chooser is OPEN has to be shown INSIDE it — the row's error line sits
      // behind the overlay, so pressing the button would look like it did nothing. (The same rule
      // the owner chooser was fixed for on 2026-08-01: a tap must never vanish in silence.)
      if (!res.ok) {
        if (dialogOpen) { setClashErr(d.error || "Couldn't restore."); setBusy(false); return; }
        throw new Error(d.error || "Couldn't restore.");
      }
      // Says WHERE the old codes now go, not just that they need remaking — "its old address is
      // taken" is a fact about us; "scanning the old card opens a different restaurant" is the
      // thing that actually costs somebody a wrong order.
      if (d.renamed) onRenamed(`${r.name} is back as “${d.name}” at /r/${d.renamed}/menu. Its old address ${d.oldAddress || `/r/${r.slug}/menu`} now belongs to a different restaurant, so any QR codes still carrying it open THAT menu — reprint them.`);
      setClash(null); setClashErr(null);
      onChanged();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (dialogOpen) setClashErr(m); else setErr(m);
      setBusy(false);
    }
  };

  const downloadBackup = async (): Promise<boolean> => {
    // Stream the JSON backup to a file BEFORE we erase. If it fails, we abort the purge.
    try {
      const res = await fetch(`/api/admin/restaurants/export?rid=${encodeURIComponent(r.id)}`, { cache: "no-store" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Backup download failed."); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `backup-${r.slug}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      return true;
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); return false; }
  };

  const purge = async () => {
    if (!nameMatches) { setErr("Type the restaurant's exact name to confirm."); return; }
    setBusy(true); setErr(null);
    try {
      if (wantBackup) { const okBackup = await downloadBackup(); if (!okBackup) { setBusy(false); return; } }
      const res = await fetch("/api/admin/restaurants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "purge_restaurant", restaurant_id: r.id }),
      });
      const d = await res.json(); if (!res.ok) throw new Error(d.error || "Couldn't remove it.");
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  return (
    // data-restaurant: a stable hook so a checker can act on ONE named row rather than "the last
    // button on the page" — the same reason the owner rows below carry data-owner.
    <div data-restaurant={r.slug} style={{ border: "var(--border)", borderRadius: 12, padding: 14, background: "var(--bg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={toggleOpen} aria-expanded={open} className="adm-btn" title="See what's inside it"
          style={{ padding: "6px 9px", background: "transparent", border: "none" }}>
          <i className={`fas fa-chevron-${open ? "down" : "right"}`} aria-hidden="true" style={{ fontSize: 12, opacity: 0.65 }} />
        </button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{r.name}</div>
          <div className="adm-muted" style={{ fontSize: 12.5, fontFamily: "ui-monospace, monospace" }}>/r/{r.slug}/menu</div>
          <div className="adm-muted" style={{ fontSize: 12, marginTop: 4 }}>
            Deleted {fmtDate(r.deletedAt)}{r.deletedBy ? ` by ${r.deletedBy}` : ""}{r.reason ? ` · “${r.reason}”` : ""}
          </div>
        </div>
        <span className="adm-chip" style={{ background: "var(--muted2, rgba(120,120,120,0.18))", color: "var(--muted)" }}>
          {heldFor(r.daysHeld)}
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "var(--border)", display: "grid", gap: 12 }}>
          {insideBusy && <div className="adm-empty" style={{ padding: 8 }}>Reading what&apos;s inside…</div>}
          {insideErr && (
            <div style={{ color: "var(--adm-danger)", fontSize: 12.5 }}>
              {insideErr} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={loadInside}>Retry</button>
            </div>
          )}
          {inside && <InsideCounts d={inside} onRetry={loadInside} busy={insideBusy} />}
          {/* WALK INTO IT. It is still in the bin — its guest menu stays offline and its own staff
              still cannot sign in. This is the admin looking, which is exactly what he asked for. */}
          <div>
            <div className="adm-muted" style={{ fontSize: 12, marginBottom: 6 }}>
              Open its panels to see what is really in there. It stays in the recycle bin — its guest menu is still offline and its staff still can&apos;t sign in.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PANEL_DOORS.map((p) => (
                <button key={p.to} className="adm-btn" style={{ fontSize: 12 }}
                  onClick={async () => {
                    setBlocked(null);
                    const w = await openRestaurantPanel(r.id, p.to, undefined, true);
                    // Never claim "now viewing" when the popup was blocked (audit 2026-07-08) —
                    // and offer the same door in this tab rather than a browser-settings lecture.
                    if (!w) setBlocked({ href: hereHref(r.id, p.to, { bin: true }), label: p.label });
                  }}>
                  <i className={`fas ${p.icon}`} style={{ marginRight: 6 }} aria-hidden="true" />{p.label}
                </button>
              ))}
            </div>
            {blocked && <div style={{ marginTop: 10 }}><BlockedHere href={blocked.href} label={blocked.label} onClose={() => setBlocked(null)} /></div>}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <button className="adm-btn primary" disabled={busy} onClick={() => restore(false)} title="Bring it back, suspended (turn it live from the Restaurants page)">
          <i className="fas fa-rotate-left" style={{ marginRight: 7 }} aria-hidden="true" />Restore (suspended)
        </button>
        <button className="adm-btn" disabled={busy} onClick={() => restore(true)} title="Bring it back and make it live immediately">
          <i className="fas fa-play" style={{ marginRight: 7 }} aria-hidden="true" />Restore &amp; make live
        </button>
        <span style={{ flex: 1 }} />
        {/* NO LOCK, NO COUNTDOWN (owner, 2026-08-20). The confirm step below is what stops an
            accident now — and it is the same one that always did the real work. */}
        {!purgeOpen && (
          <button className="adm-btn danger" disabled={busy} onClick={() => { setPurgeOpen(true); setErr(null); }}>
            <i className="fas fa-fire" style={{ marginRight: 7 }} aria-hidden="true" />Delete permanently…
          </button>
        )}
      </div>

      {purgeOpen && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "var(--border)", display: "grid", gap: 10, maxWidth: 460 }}>
          {/* Says exactly what goes and exactly what stays — see the note at the top of this page. */}
          <p className="hint" style={{ margin: 0, color: "var(--adm-danger)" }}>
            This permanently deletes <b>{r.name}</b>&rsquo;s menu, staff logins, settings, saved customers and
            activity log. It cannot be undone and the restaurant can no longer be restored.
          </p>
          <p className="hint" style={{ margin: "-4px 0 0" }}>
            Its <b>bills, invoices, payments and the removals record are kept</b> and stay readable in Bills —
            those have to survive for the years the records rules expect.
          </p>
          {/* ── ITEM 11 · SILENCE HERE USED TO MEAN TWO DIFFERENT THINGS (owner, 2026-09-04) ──────
              This said nothing at all for BOTH "nobody owes anything" and "we could not ask" — and
              on the screen that erases a restaurant for good those are not the same fact. Worse,
              the whole confirm can be opened without ever expanding the row, so the commonest
              silence was simply that nothing had been read yet. Three states, three sentences, and
              only a real zero stays quiet. */}
          {!inside ? (
            <p className="hint" style={{ margin: "-4px 0 0", color: "var(--adm-warn)" }}>
              <i className="fas fa-circle-question" style={{ marginRight: 6 }} aria-hidden="true" />
              You haven&apos;t looked inside this one yet. Open the row above to see what is in there —
              including whether anyone still owes money on a tab.
            </p>
          ) : inside.inside.unpaidPayLaterBills === null || inside.inside.unpaidPayLaterBills === undefined ? (
            <p className="hint" style={{ margin: "-4px 0 0", color: "var(--adm-warn)" }}>
              <i className="fas fa-circle-question" style={{ marginRight: 6 }} aria-hidden="true" />
              Whether anyone still owes money here <b>could not be read</b> just now — it is not a zero.
              Use <b>Try again</b> on the row above before deciding.
            </p>
          ) : inside.inside.unpaidPayLaterBills > 0 ? (
            <p className="hint" style={{ margin: "-4px 0 0", color: "var(--adm-warn)" }}>
              <i className="fas fa-circle-exclamation" style={{ marginRight: 6 }} aria-hidden="true" />
              {inside.inside.unpaidPayLaterBills} pay-later bill{inside.inside.unpaidPayLaterBills === 1 ? "" : "s"} here {inside.inside.unpaidPayLaterBills === 1 ? "is" : "are"} still unpaid.
            </p>
          ) : null}
          <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={wantBackup} onChange={(e) => setWantBackup(e.target.checked)} disabled={busy} />
            Download a backup file of this restaurant&apos;s data first (recommended)
          </label>
          {wantBackup && (
            <p className="hint" style={{ margin: "-4px 0 0 26px", fontSize: 11.5, color: "var(--muted)" }}>
              <i className="fas fa-circle-info" style={{ marginRight: 6 }} aria-hidden="true" />
              This file includes customer names &amp; phone numbers (staff passwords are removed). Keep it private and delete it once the restaurant is rebuilt.
            </p>
          )}
          <label style={{ fontSize: 12.5 }}>
            Type <b style={{ fontFamily: "ui-monospace, monospace" }}>{r.name}</b> to confirm
            <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} disabled={busy} autoFocus placeholder={r.name}
              style={{ width: "100%", marginTop: 4, padding: "8px 11px", borderRadius: 8, border: nameMatches ? "1px solid var(--adm-danger)" : "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
          </label>
          {err && <span style={{ color: "var(--adm-danger)", fontSize: 12.5 }}>{err}</span>}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="adm-btn danger" disabled={busy || !nameMatches} onClick={purge}>
              <i className="fas fa-fire" style={{ marginRight: 7 }} aria-hidden="true" />{busy ? "Removing…" : "Permanently delete"}
            </button>
            <button className="adm-btn" disabled={busy} onClick={() => { setPurgeOpen(false); setConfirmName(""); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {err && !purgeOpen && <div style={{ color: "var(--adm-danger)", fontSize: 12.5, marginTop: 8 }}>{err}</div>}

      {clash && (
        <SlugClashDialog key={clash.holder.id} clash={clash} busy={busy} error={clashErr}
          onClose={() => { setClash(null); setClashErr(null); }}
          onResolve={(res) => restore(pendingActivate, res)} />
      )}
    </div>
  );
}

// ── The restaurant name chooser (owner, 2026-08-20) ────────────────────────────────────────────
// Exactly the two ways out he asked for: CLOSE, or CHANGE THE NAME AND RESTORE. There is
// deliberately no third option to rename the restaurant that currently holds the address — it is
// live and serving guests, and its QR codes are printed on real tables.
type SlugClash = {
  slug: string;
  restored: { id: string; name: string; slug: string };
  holder: { id: string; name: string; active: boolean };
  suggestedName: string;
  suggestedSlug: string;
  retry?: boolean;
  /** What renaming COSTS: the old address now belongs to the holder, so printed codes are wrong. */
  qrWarning?: string;
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

function SlugClashDialog({ clash, busy, error, onClose, onResolve }: {
  clash: SlugClash; busy: boolean; error: string | null; onClose: () => void; onResolve: (r: { name: string; slug: string }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useAdminModal(ref, "restaurant-name-clash", onClose);
  const [name, setName] = useState(clash.suggestedName);
  // The address FOLLOWS the name while he is typing, and stops following the moment he edits it
  // himself — otherwise the two fields fight and whichever he touched last wins by accident.
  const [slug, setSlug] = useState(clash.suggestedSlug);
  const [slugTouched, setSlugTouched] = useState(false);
  const onName = (v: string) => { setName(v); if (!slugTouched) setSlug(slugify(v)); };
  const nameOk = name.trim().replace(/\s+/g, " ").length >= 2;
  const slugOk = slug.trim().length >= 2;

  // PORTAL, not an inline overlay — this dialog renders from deep inside a bin ROW and an ancestor
  // there establishes a containing block, so `position: fixed` would anchor to the ROW. Target
  // `.adm`, NOT <body>: the whole admin palette is scoped to that element, so a body portal comes
  // out as a WHITE card in the dark console. (Both learned the hard way on the owner twin.)
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.querySelector<HTMLElement>(".adm") ?? document.body); }, []);
  if (!host) return null;

  return createPortal(
    <>
      <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000 }} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="rclash-title" style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div className="adm-card" style={{ pointerEvents: "auto", width: "min(94vw, 520px)", maxHeight: "90dvh", overflowY: "auto" }}>
          <h3 id="rclash-title" style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 800 }}>
            That name is already taken
          </h3>
          <p className="adm-muted" style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.5 }}>
            While <b>{clash.restored.name}</b> sat in the recycle bin, <b>{clash.holder.name}</b>
            {clash.holder.active ? "" : " (suspended)"} took its web address <b style={{ fontFamily: "ui-monospace, monospace" }}>/r/{clash.slug}/menu</b>.
            Two restaurants can&apos;t share one. Give the one coming back a different name, or close this and leave it in the bin.
          </p>

          {/* THE PRINTED CODES (owner, 2026-08-21). A QR code carries the ADDRESS, not the
              restaurant, so agreeing to this rename hands this restaurant's laminated table cards
              to the restaurant that took its address — a diner scanning the old card orders from
              somebody else's menu. It is not a reason to refuse the rename (the alternative is
              leaving a paying restaurant in the bin), but the admin has to be told BEFORE he agrees,
              because the only way back is reprinting. Amber, not red: nothing is broken yet. */}
          {clash.qrWarning && (
            <div style={{ margin: "0 0 12px", padding: "10px 12px", borderRadius: 9, fontSize: 12.5, lineHeight: 1.55,
              border: "1px solid color-mix(in srgb, #d4a574 45%, transparent)",
              background: "color-mix(in srgb, #d4a574 10%, transparent)" }}>
              <i className="fas fa-qrcode" style={{ marginRight: 7, color: "#d4a574" }} aria-hidden="true" />
              <b>Its old QR codes will point at the wrong restaurant.</b>{" "}
              <span className="adm-muted">{clash.qrWarning}</span>
            </div>
          )}

          {error && (
            <div role="alert" style={{ margin: "0 0 12px", padding: "9px 12px", borderRadius: 9, fontSize: 12.5,
              color: "var(--adm-danger)", border: "1px solid color-mix(in srgb, var(--adm-danger) 45%, transparent)",
              background: "color-mix(in srgb, var(--adm-danger) 12%, transparent)" }}>
              <i className="fas fa-circle-exclamation" style={{ marginRight: 7 }} aria-hidden="true" />{error}
            </div>
          )}

          <div style={{ border: "var(--border)", borderRadius: 10, padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>
              <i className="fas fa-pen" style={{ marginRight: 7, opacity: 0.8 }} aria-hidden="true" />
              Change its name and restore it
            </div>
            <label style={{ fontSize: 12.5 }}>
              New name
              <input value={name} onChange={(e) => onName(e.target.value)} disabled={busy} autoFocus
                aria-label="New name for the restaurant being restored"
                style={{ width: "100%", marginTop: 4, padding: "8px 11px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 12.5 }}>
              Its web address
              <input value={slug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} disabled={busy}
                aria-label="New web address for the restaurant being restored"
                style={{ width: "100%", marginTop: 4, padding: "8px 11px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, fontFamily: "ui-monospace, monospace" }} />
              <span className="adm-muted" style={{ display: "block", marginTop: 4, fontSize: 11.5 }}>
                Guests will reach it at <b style={{ fontFamily: "ui-monospace, monospace" }}>/r/{slug || "…"}/menu</b> — its old QR codes will need remaking.
              </span>
            </label>
            <button className="adm-btn primary" disabled={busy || !nameOk || !slugOk}
              onClick={() => onResolve({ name: name.trim().replace(/\s+/g, " "), slug })}>
              {busy ? "Restoring…" : "Change name & restore"}
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button className="adm-btn" disabled={busy} onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </>,
    host,
  );
}

// Deleted OWNER row (mig 208). Restore brings them back SUSPENDED (reactivate from
// the Owners list). Permanent removal releases their restaurants to a co-owner / "no owner" and
// is available at any time (owner, 2026-08-20). No data-backup step: an owner is just a login,
// its restaurants aren't erased.
type OwnerInside = {
  owner: { id: string; username: string; name: string; active: boolean; deletedAt: string; deletedBy: string | null; reason: string | null; createdAt: string | null; lastSeenAt: string | null };
  restaurants: { id: string; name: string; slug: string; active: boolean; binned: boolean; purged: boolean; primary: boolean }[];
};

function OwnerBinRow({ o, onChanged }: { o: OwnerTrashed; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [open, setOpen] = useState(false);
  const [inside, setInside] = useState<OwnerInside | null>(null);
  const [insideErr, setInsideErr] = useState<string | null>(null);
  const [insideBusy, setInsideBusy] = useState(false);
  // A blocked new tab, kept apart from insideErr — see BlockedHere above.
  const [blocked, setBlocked] = useState<{ href: string; label: string } | null>(null);
  // Set when the server says this name was taken while the owner sat in the bin —
  // the admin picks who keeps it, then we re-send the same restore with a resolve.
  const [clash, setClash] = useState<NameClash | null>(null);
  // Refusals that arrive WHILE the chooser is open — shown inside it, never behind it.
  const [clashErr, setClashErr] = useState<string | null>(null);

  const nameMatches = confirmName.trim().toLowerCase() === o.username.trim().toLowerCase();

  const loadInside = useCallback(async () => {
    setInsideBusy(true); setInsideErr(null);
    try {
      const res = await fetch(`/api/admin/owners?bin_detail=${encodeURIComponent(o.id)}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't read this owner's restaurants.");
      setInside(d as OwnerInside);
    } catch (e) { setInsideErr(e instanceof Error ? e.message : String(e)); }
    setInsideBusy(false);
  }, [o.id]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && !inside && !insideBusy) loadInside();
  };

  // resolve = undefined for the plain first attempt; the dialog re-calls with one.
  const restore = async (resolve?: Resolve) => {
    setBusy(true); setErr(null); setClashErr(null);
    const dialogOpen = clash !== null;
    try {
      const res = await fetch("/api/admin/owners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore_owner", owner_id: o.id, ...(resolve ? { resolve } : {}) }),
      });
      const d = await res.json();
      // A name clash isn't an error to dump on the page — it's a question. Open the
      // chooser instead, with the row un-busied so the dialog's buttons work.
      if (res.status === 409 && d.conflict) {
        // A SECOND clash (the admin typed a name that's also taken) must say so — the
        // dialog would otherwise just quietly swap in a different person's name.
        if (dialogOpen && resolve) setClashErr(`“${resolve.name.trim()}” is taken as well — here's who has it now.`);
        setClash(d.conflict as NameClash);
        setBusy(false); return;
      }
      // A refusal while the chooser is OPEN has to be shown INSIDE it. The row's error
      // line sits behind the overlay, so pressing the button looked like it did nothing
      // (probe, 2026-08-01) — precisely the "a tap must never vanish" rule.
      if (!res.ok) {
        if (dialogOpen) { setClashErr(d.error || "Couldn't restore."); setBusy(false); return; }
        throw new Error(d.error || "Couldn't restore.");
      }
      setClash(null); setClashErr(null);
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (dialogOpen) setClashErr(msg); else setErr(msg);
      setBusy(false);
    }
  };

  const purge = async () => {
    if (!nameMatches) { setErr("Type the owner's exact username to confirm."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/owners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "purge_owner", owner_id: o.id }),
      });
      const d = await res.json(); if (!res.ok) throw new Error(d.error || "Couldn't remove them.");
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  return (
    // data-owner: a stable hook so a checker can act on ONE named row (verify:recycle-name
    // used to click the last Restore button on the page, which could be a real account).
    <div data-owner={o.username} style={{ border: "var(--border)", borderRadius: 12, padding: 14, background: "var(--bg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={toggleOpen} aria-expanded={open} className="adm-btn" title="See their restaurants"
          style={{ padding: "6px 9px", background: "transparent", border: "none" }}>
          <i className={`fas fa-chevron-${open ? "down" : "right"}`} aria-hidden="true" style={{ fontSize: 12, opacity: 0.65 }} />
        </button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{o.name} <span className="adm-muted" style={{ fontWeight: 400, fontSize: 12.5 }}>@{o.username}</span></div>
          <div className="adm-muted" style={{ fontSize: 12.5 }}>{o.restaurants} restaurant{o.restaurants === 1 ? "" : "s"} still linked (returned on restore)</div>
          <div className="adm-muted" style={{ fontSize: 12, marginTop: 4 }}>
            Deleted {fmtDate(o.deletedAt)}{o.deletedBy ? ` by ${o.deletedBy}` : ""}{o.reason ? ` · “${o.reason}”` : ""}
          </div>
        </div>
        <span className="adm-chip" style={{ background: "var(--muted2, rgba(120,120,120,0.18))", color: "var(--muted)" }}>
          {heldFor(o.daysHeld)}
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "var(--border)", display: "grid", gap: 10 }}>
          {insideBusy && <div className="adm-empty" style={{ padding: 8 }}>Reading their restaurants…</div>}
          {insideErr && (
            <div style={{ color: "var(--adm-danger)", fontSize: 12.5 }}>
              {insideErr} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={loadInside}>Retry</button>
            </div>
          )}
          {/* Who they were, before deciding whether to bring them back. Already in the same answer
              as the restaurants below, so it costs nothing extra. */}
          {inside && (
            <p className="adm-muted" style={{ margin: 0, fontSize: 12 }}>
              Login <b style={{ fontFamily: "ui-monospace, monospace" }}>@{inside.owner.username}</b>
              {inside.owner.createdAt ? ` · joined ${fmtDate(inside.owner.createdAt)}` : ""}
              {inside.owner.lastSeenAt ? ` · last signed in ${fmtDate(inside.owner.lastSeenAt)}` : " · never signed in"}
              {inside.owner.active ? "" : " · was suspended"}
            </p>
          )}
          {inside && inside.restaurants.length === 0 && (
            <p className="adm-muted" style={{ margin: 0, fontSize: 12.5 }}>They hold no restaurants. Removing them for good affects nothing else.</p>
          )}
          {inside && inside.restaurants.map((rr) => (
            <div key={rr.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "var(--border)", borderRadius: 10, padding: 10 }}>
              <div style={{ flex: 1, minWidth: 170 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                  {rr.name}{rr.primary && <span title="Primary owner" style={{ marginLeft: 6, color: "var(--accent)" }}>★</span>}
                </div>
                <div className="adm-muted" style={{ fontSize: 11.5, fontFamily: "ui-monospace, monospace" }}>/r/{rr.slug}/menu</div>
              </div>
              <span className="adm-chip" style={{ fontSize: 11 }}>
                {rr.purged ? "Removed for good" : rr.binned ? "In the recycle bin" : rr.active ? "Live" : "Suspended"}
              </span>
              {/* VISIT THEIR PANEL — the "clicking individual able to visit there panel" ask. A
                  purged restaurant has no panels left, so it gets no button. */}
              {!rr.purged && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button className="adm-btn" style={{ fontSize: 11.5 }}
                    onClick={async () => {
                      setBlocked(null);
                      // uid = THIS owner, so the cockpit opens through their eyes (ownerScope
                      // re-checks the membership server-side on every call).
                      const w = await openRestaurantPanel(rr.id, "/owner", o.id, rr.binned);
                      if (!w) setBlocked({ href: hereHref(rr.id, "/owner", { uid: o.id, bin: rr.binned }), label: `${rr.name}'s owner panel` });
                    }}>
                    <i className="fas fa-crown" style={{ marginRight: 6 }} aria-hidden="true" />Their owner panel
                  </button>
                  <button className="adm-btn" style={{ fontSize: 11.5 }}
                    onClick={async () => {
                      setBlocked(null);
                      const w = await openRestaurantPanel(rr.id, "/manager", undefined, rr.binned);
                      if (!w) setBlocked({ href: hereHref(rr.id, "/manager", { bin: rr.binned }), label: `${rr.name}'s manager panel` });
                    }}>
                    <i className="fas fa-table-columns" style={{ marginRight: 6 }} aria-hidden="true" />Manager
                  </button>
                </div>
              )}
            </div>
          ))}
          {blocked && <BlockedHere href={blocked.href} label={blocked.label} onClose={() => setBlocked(null)} />}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <button className="adm-btn primary" disabled={busy} onClick={() => restore()} title="Bring the owner back, suspended (reactivate from the Owners list)">
          <i className="fas fa-rotate-left" style={{ marginRight: 7 }} aria-hidden="true" />Restore (suspended)
        </button>
        <span style={{ flex: 1 }} />
        {!purgeOpen && (
          <button className="adm-btn danger" disabled={busy} onClick={() => { setPurgeOpen(true); setErr(null); }}>
            <i className="fas fa-fire" style={{ marginRight: 7 }} aria-hidden="true" />Delete permanently…
          </button>
        )}
      </div>

      {purgeOpen && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "var(--border)", display: "grid", gap: 10, maxWidth: 460 }}>
          <p className="hint" style={{ margin: 0, color: "var(--adm-danger)" }}>
            This permanently deletes the owner login <b>{o.name}</b>. Their {o.restaurants} restaurant{o.restaurants === 1 ? "" : "s"} are handed to a co-owner or become “no owner” — the restaurants themselves are NOT deleted. This cannot be undone.
          </p>
          <label style={{ fontSize: 12.5 }}>
            Type <b style={{ fontFamily: "ui-monospace, monospace" }}>{o.username}</b> to confirm
            <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} disabled={busy} autoFocus placeholder={o.username}
              style={{ width: "100%", marginTop: 4, padding: "8px 11px", borderRadius: 8, border: nameMatches ? "1px solid var(--adm-danger)" : "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
          </label>
          {err && <span style={{ color: "var(--adm-danger)", fontSize: 12.5 }}>{err}</span>}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="adm-btn danger" disabled={busy || !nameMatches} onClick={purge}>
              <i className="fas fa-fire" style={{ marginRight: 7 }} aria-hidden="true" />{busy ? "Removing…" : "Permanently delete"}
            </button>
            <button className="adm-btn" disabled={busy} onClick={() => { setPurgeOpen(false); setConfirmName(""); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {err && !purgeOpen && <div style={{ color: "var(--adm-danger)", fontSize: 12.5, marginTop: 8 }}>{err}</div>}

      {clash && (
        // key: a SECOND conflict is a different person, so the dialog remounts and its
        // suggested names are rebuilt from the new pair instead of the stale first one.
        <NameClashDialog key={clash.existing.id} clash={clash} busy={busy} error={clashErr}
          onClose={() => { setClash(null); setClashErr(null); }}
          onResolve={(r) => restore(r)} />
      )}
    </div>
  );
}

// ── The owner name chooser (owner, 2026-08-01) ──────────────────────────────────
// A binned login no longer reserves its name (mig 245), so by restore time someone
// else may be called "rishi" too. Rather than failing — or silently renaming a real
// person's login — the admin says which one keeps the name. Every path renames
// somebody VISIBLY and states who; nothing happens until a button is pressed.
type NameClash = {
  username: string;
  restored: { id: string; name: string; username: string };
  existing: { id: string; name: string; username: string; role: string; active: boolean };
  canRenameExisting: boolean;
};
type Resolve = { mode: "rename_restored" | "rename_existing"; name: string };

function NameClashDialog({ clash, busy, error, onClose, onResolve }: {
  clash: NameClash; busy: boolean; error: string | null; onClose: () => void; onResolve: (r: Resolve) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useAdminModal(ref, "owner-name-clash", onClose);
  // Prefilled suggestions so the admin can just press a button; both are editable.
  // Suggestions are LOGIN names, so keep them plain to type — no brackets.
  const [restoredName, setRestoredName] = useState(`${clash.restored.name} old`);
  const [existingName, setExistingName] = useState(`${clash.existing.name} 2`);
  const tooShort = (s: string) => s.trim().replace(/\s+/g, " ").length < 2;

  // PORTAL, not an inline overlay. This dialog is rendered from deep inside a bin ROW,
  // and an ancestor there establishes a containing block, so `position: fixed` anchored
  // to the ROW instead of the screen: the box appeared level with its row and its second
  // choice was cut off below the fold.
  // Target `.adm`, NOT <body>: the whole admin palette (--card/--text/--border and the
  // data-skin=dark switch) is scoped to that element, so a body portal came out as a
  // WHITE card in the dark console. `.adm` has no transform/filter, so "fixed" still
  // means the viewport there.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.querySelector<HTMLElement>(".adm") ?? document.body); }, []);
  if (!host) return null;

  return createPortal(
    <>
      <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000 }} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="clash-title" style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div className="adm-card" style={{ pointerEvents: "auto", width: "min(94vw, 520px)", maxHeight: "90dvh", overflowY: "auto" }}>
        <h3 id="clash-title" style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 800 }}>
          The name “{clash.restored.name}” is taken
        </h3>
        <p className="adm-muted" style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.5 }}>
          While this owner sat in the recycle bin, <b>{clash.existing.name}</b>{clash.existing.active ? "" : " (suspended)"}{" "}
          took that name. Two logins can&apos;t share one, so choose who keeps it — the other one gets
          renamed, and you can see exactly what it becomes.
        </p>

        {error && (
          <div role="alert" style={{ margin: "0 0 12px", padding: "9px 12px", borderRadius: 9, fontSize: 12.5,
            color: "var(--adm-danger)", border: "1px solid color-mix(in srgb, var(--adm-danger) 45%, transparent)",
            background: "color-mix(in srgb, var(--adm-danger) 12%, transparent)" }}>
            <i className="fas fa-circle-exclamation" style={{ marginRight: 7 }} aria-hidden="true" />{error}
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ border: "var(--border)", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>
              <i className="fas fa-rotate-left" style={{ marginRight: 7, opacity: 0.8 }} aria-hidden="true" />
              Rename the one coming back
            </div>
            <p className="adm-muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
              <b>{clash.existing.name}</b> keeps the name. The restored owner comes back under this one:
            </p>
            <input value={restoredName} onChange={(e) => setRestoredName(e.target.value)} disabled={busy}
              aria-label="New name for the owner being restored"
              style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
            <button className="adm-btn primary" style={{ marginTop: 9 }} disabled={busy || tooShort(restoredName)}
              onClick={() => onResolve({ mode: "rename_restored", name: restoredName })}>
              {busy ? "Restoring…" : "Restore under this name"}
            </button>
          </div>

          {clash.canRenameExisting ? (
            <div style={{ border: "var(--border)", borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>
                <i className="fas fa-user-pen" style={{ marginRight: 7, opacity: 0.8 }} aria-hidden="true" />
                Rename the current owner instead
              </div>
              <p className="adm-muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                The owner coming back keeps <b>{clash.restored.name}</b>. Today&apos;s <b>{clash.existing.name}</b> is
                renamed to this, and signs in with the new name from then on:
              </p>
              <input value={existingName} onChange={(e) => setExistingName(e.target.value)} disabled={busy}
                aria-label="New name for the owner who currently has it"
                style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
              <button className="adm-btn" style={{ marginTop: 9 }} disabled={busy || tooShort(existingName)}
                onClick={() => onResolve({ mode: "rename_existing", name: existingName })}>
                {busy ? "Working…" : "Rename them & restore"}
              </button>
            </div>
          ) : (
            <p className="adm-muted" style={{ margin: 0, fontSize: 12 }}>
              <i className="fas fa-circle-info" style={{ marginRight: 6 }} aria-hidden="true" />
              That name belongs to a restaurant&apos;s <b>{clash.existing.role}</b> login, not an owner — rename it on
              that restaurant&apos;s Users page if it should be freed up.
            </p>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button className="adm-btn" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
        </div>
      </div>
    </>,
    host,
  );
}
