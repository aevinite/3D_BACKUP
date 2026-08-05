"use client";
// Owner · one person's PROFILE. Everything about a human being in one place: who they are,
// their job, what they've been paid, what they may do, how they're doing, what they did.
// Owner ask 2026-07-29; data + rules live in /api/owner/staff (+ lib/staffProfile.ts) and
// migration 220. Gated by the "Staff profiles & pay" module — with it off, this page shows a
// calm "not enabled" card and the server refuses every write too.
//
// Two habits worth keeping:
//   • EVERY field saves on blur, on its own. Nothing here is compulsory (the owner explicitly
//     wanted a record he can fill a bit at a time), so there is no big Save button to forget
//     and a half-filled profile is a valid profile.
//   • A payment is NEVER edited or deleted — it's cancelled with a reason and stays visible,
//     struck through. Same discipline as bills.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useBackClose } from "@/lib/backStack";
import { asSuffix } from "@/lib/ownerPin";
// staffProfileShared (never lib/staffProfile) — the shared module is import-free, so this
// client page can use the field enums without dragging the service-role client into the browser.
import { PAY_KINDS, PAY_MODES, PAY_TYPES, EMPLOYMENT_TYPES, WEEK_DAYS } from "@/lib/staffProfileShared";

type Extra = { label: string; kind: "allowance" | "deduction"; amount: number };
type Staff = {
  id: string; username: string; role: string; name: string | null; phone: string | null;
  active: boolean; restaurant_id: string; last_seen_at: string | null; created_at: string;
  hasPin: boolean; permissions?: Record<string, string>;
  profile: Record<string, string | boolean>;
  joined_on: string | null; left_on: string | null; designation: string | null;
  employment_type: string | null; shift_label: string | null; weekly_off: string[] | null;
  pay_type?: string | null; pay_amount?: number | null; pay_day?: string | null;
  pay_mode?: string | null; pay_extras?: Extra[]; can_see_own_pay: boolean;
  in_payroll?: boolean; payroll_added_at?: string | null; payroll_added_by?: string | null;
  payHidden?: boolean;
  completeness: { filled: number; total: number; missing: string[] };
};
type Payment = {
  id: string; kind: string; amount: number; for_period: string | null; mode: string;
  paid_on: string; note: string | null; recorded_by: string | null; created_at: string;
  voided_at: string | null; void_reason: string | null; voided_by: string | null;
};
type Access = { moduleOn: boolean; canSeePay: boolean; canRecordPay: boolean; canEditProfile: boolean; canEditJobPay: boolean };
type Perf = {
  days_active: number; hours_active: number; actions: number; orders_punched: number;
  value_punched: number; tables_served: number; guests_served: number; discount_given: number;
  ratings: number; avg_rating: number | null; paid: number; last_seen: string | null;
} | null;
type LogRow = { id: string; action: string; detail: string | null; created_at: string; panel: string; table_number: string | null };

const money = (n: number | null | undefined) =>
  "₹" + Math.round(Number(n || 0)).toLocaleString("en-IN");
const dateIN = (d: string | null | undefined) =>
  !d ? "—" : new Date(d.length <= 10 ? d + "T00:00:00" : d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const monthIN = (d: string | null | undefined) =>
  !d ? "—" : new Date(d + "T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const ago = (d: string | null | undefined) => {
  if (!d) return "never";
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() || "").join("") || "?";
const KIND_LABEL: Record<string, string> = {
  salary: "Salary", advance: "Advance", bonus: "Bonus", overtime: "Overtime",
  reimbursement: "Reimbursement", deduction: "Advance recovered",
};
const EMP_LABEL: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", trial: "On trial", casual: "Casual / on-call" };
const PAYT_LABEL: Record<string, string> = { monthly: "Monthly salary", daily: "Daily wage", hourly: "Hourly", per_shift: "Per shift" };
const MODE_LABEL: Record<string, string> = { cash: "Cash", upi: "UPI", bank: "Bank transfer" };
// Per-user waiter caps — moved here from the roster so one person = one page.
const WAITER_CAPS: [string, string][] = [
  ["tablet_mark_paid", "Mark bill paid"], ["tablet_discount", "Give discount"],
  ["tablet_invoice", "Generate invoice"], ["tablet_take_orders", "Take orders"],
  ["tablet_parcel", "Parcel orders (counter)"], ["tablet_table_ops", "Table & KOT ops"],
];
const OVR_MODES: [string, string][] = [["default", "Default"], ["on", "On"], ["pin", "PIN"], ["off", "Off"]];
type Tab = "personal" | "job" | "pay" | "access" | "perf" | "activity";

// ── One "saves on blur" profile field ────────────────────────────────────────────────
// DECLARED AT MODULE SCOPE ON PURPOSE. It used to live inside the page component, which
// made it a BRAND-NEW component type on every render — so React unmounted and remounted
// every field whenever anything on the page changed state. These inputs are uncontrolled
// (`defaultValue`, saved on blur), and a remount throws the DOM value away: the owner
// typed into a field, the previous field's green "Saved" tick expired 1.6s later, the page
// re-rendered, and the half-typed text vanished with the cursor jumping out of the box.
// (Found by the 2026-08-04 owner-panel sweep; eslint react-hooks/static-components had been
// flagging all 15 fields.)
//
// Two details keep the old GOOD behaviour while losing the bug:
//   • `key` on the input is the SAVED value, so the field remounts only when that value
//     genuinely changes — which is what restores the old text if a save FAILS and
//     saveProfile() rolls the value back. Typing elsewhere never touches it.
//   • it is NOT disabled while a save is in flight. A disabled input loses focus in every
//     browser, so the old `busy` disable interrupted the very next field the owner started
//     typing in. Each field saves its own key and the server merges, so overlapping saves
//     are safe.
function ProfileField({ label, k, value, hint, type = "text", options, maxLength, self, canEdit, flash, onSave }: {
  label: string; k: string; value: string; hint?: string; type?: string;
  options?: [string, string][]; maxLength?: number; self?: boolean;
  canEdit: boolean; flash: string | null; onSave: (key: string, value: string) => void;
}) {
  return (
    <div className={`sp-f ${value ? "" : "empty"}`}>
      <label htmlFor={`f-${k}`}>{label}{self ? <span className="sp-self" title="They can also edit this from their own panel">•</span> : null}</label>
      {options ? (
        <select key={`${k}:${value}`} id={`f-${k}`} defaultValue={value} disabled={!canEdit} onChange={(e) => onSave(k, e.target.value)}>
          <option value="">not added</option>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : (
        <input key={`${k}:${value}`} id={`f-${k}`} type={type} defaultValue={value} placeholder="not added" maxLength={maxLength}
          disabled={!canEdit}
          inputMode={type === "tel" ? "tel" : type === "email" ? "email" : undefined}
          onBlur={(e) => onSave(k, e.target.value)} />
      )}
      {hint && <div className="sp-hint">{hint}</div>}
      {flash === k && <div className="sp-saved"><i className="fas fa-check" /> Saved</div>}
    </div>
  );
}

export default function StaffProfilePage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [summary, setSummary] = useState<{ thisMonth: number; thisYear: number; advanceOutstanding: number; lastPaidOn: string | null; entries: number } | null>(null);
  const [perf, setPerf] = useState<Perf>(null);
  const [restaurant, setRestaurant] = useState<{ name: string; accentColor: string; modules?: Record<string, boolean> } | null>(null);
  const [tab, setTab] = useState<Tab>("personal");
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);   // which field just saved
  const [busy, setBusy] = useState(false);
  const [logRows, setLogRows] = useState<LogRow[] | null>(null);
  // Waiter sections (mig 222): null until we've asked whether this restaurant uses them.
  const [sections, setSections] = useState<{ moduleOn: boolean; tableCount: number } | null>(null);
  const [secTables, setSecTables] = useState<number[]>([]);
  const [secBusy, setSecBusy] = useState(false);
  const [showPay, setShowPay] = useState(false);

  // Admin-in-one-restaurant scope pin — same as the roster, so an admin viewing restaurant A
  // in one tab and B in another stays in the right one.
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));
  const withScope = useCallback((p: string) =>
    scopePin ? `${p}${p.includes("?") ? "&" : "?"}scope=${scopePin}${asSuffix()}` : p, [scopePin]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(withScope(`/api/owner/staff?staff=${encodeURIComponent(id)}`), { cache: "no-store" }).then((x) => x.json());
      if (r.disabled || r.notEligible) { setNotEnabled(r.error || "Not available."); setLoading(false); return; }
      if (r.error) throw new Error(r.error);
      setNotEnabled(null);
      setStaff(r.staff); setAccess(r.payAccess); setRestaurant(r.restaurant);
      setPayments(r.payments || []); setSummary(r.summary || null); setPerf(r.performance || null);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [id, withScope]);
  useEffect(() => { load(); }, [load]);

  // ── Waiter sections (mig 222) ──────────────────────────────────────────────
  // Which tables this waiter's tablet shows. Served by the same endpoint the manager
  // panel's section editor uses, so there is ONE place that decides who may change a
  // section and one place that sanitises the numbers — this page just draws it.
  // Loaded only for a waiter, and only once we know which restaurant they belong to.
  useEffect(() => {
    if (!staff || staff.role !== "tablet" || !staff.restaurant_id) return;
    let dead = false;
    fetch(`/api/editor/table-sections?rid=${encodeURIComponent(staff.restaurant_id)}`, { cache: "no-store" })
      .then((x) => x.json())
      .then((j) => {
        if (dead || j.error) return;
        setSections({ moduleOn: !!j.moduleOn, tableCount: Number(j.tableCount) || 0 });
        // This person's own row comes back in the same call — no second request just to
        // learn the five numbers we're about to draw.
        const mine = (j.waiters || []).find((w: { id: string }) => w.id === staff.id);
        setSecTables(((mine?.assigned_tables || []) as unknown[]).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b));
      })
      // A manager/owner without the section power gets a 403 here — that's a normal
      // "you don't hand out sections" answer, so the card simply stays hidden.
      .catch(() => {});
    return () => { dead = true; };
  }, [staff]);

  async function saveSection(tables: number[]) {
    if (!staff) return;
    const before = secTables;
    setSecTables(tables); setSecBusy(true);
    try {
      const r = await fetch(`/api/editor/table-sections?rid=${encodeURIComponent(staff.restaurant_id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: staff.id, tables }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Save failed (${r.status})`);
      setSecTables((d.user?.assigned_tables || []).map(Number));
    } catch (e) {
      setSecTables(before);                       // never show a section that didn't save
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSecBusy(false); }
  }

  // The activity feed loads only when its tab is opened (it's a separate query).
  useEffect(() => {
    if (tab !== "activity" || logRows !== null || !staff) return;
    fetch(withScope(`/api/owner/oplog?actor=${encodeURIComponent(id)}&limit=60`), { cache: "no-store" })
      .then((x) => x.json()).then((j) => setLogRows(j.actions || [])).catch(() => setLogRows([]));
  }, [tab, logRows, staff, id, withScope]);

  // `expect` = "this is what the row said when I opened it" (T9 sweep, 2026-08-05). It becomes the
  // X-LFH-Expect header and lib/clash.ts → expectClash compares it against the row NOW; if someone
  // else changed it first the server refuses with 409 and says what it holds, instead of letting
  // this screen quietly win. components/admin/StaffProfile.tsx has done this since 2026-08-04 —
  // this page writes the SAME columns (including pay_amount) through /api/owner/staff and did not,
  // so a salary was protected through the admin's door and open through the owner's. Omit it and
  // nothing changes.
  async function call(
    body: Record<string, unknown>,
    method: "PATCH" | "POST" = "PATCH",
    expect?: { fields: Record<string, unknown> },
  ) {
    setBusy(true);
    try {
      const r = await fetch(withScope("/api/owner/staff"), {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(expect ? { "X-LFH-Expect": JSON.stringify({ table: "staff_users", id, fields: expect.fields }) } : {}),
        },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      // A refusal carries the plain sentence in `clash.plain` + what to do in `clash.todo`
      // (lib/clash.ts). Show THOSE, not the machine code — this is the message that stops the
      // person believing their number landed.
      if (!r.ok) {
        const c = d?.clash as { plain?: string; todo?: string } | undefined;
        throw new Error(c?.plain ? `${c.plain}${c.todo ? ` ${c.todo}` : ""}` : (d.error || `Request failed (${r.status})`));
      }
      return d;
    } finally { setBusy(false); }
  }

  // Save ONE personal field (on blur). Keeps the local value, updates completeness from the
  // server's answer so the ring is never a guess.
  async function saveProfile(key: string, value: string | boolean) {
    if (!staff) return;
    const before = staff.profile?.[key] ?? "";
    if (String(before) === String(value)) return;              // nothing changed → no request
    setStaff((s) => (s ? { ...s, profile: { ...s.profile, [key]: value } } : s));
    try {
      // One `profile.<key>` sub-key, not the whole jsonb — comparing the blob would fire on any
      // unrelated field someone else happened to fill in (lib/clash.ts supports the dotted form).
      const d = await call({ id, action: "set_profile", profile: { [key]: value } }, "PATCH",
        { fields: { [`profile.${key}`]: before } });
      setStaff((s) => (s ? { ...s, profile: d.profile, completeness: d.completeness } : s));
      setFlash(key); setTimeout(() => setFlash((f) => (f === key ? null : f)), 1600);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStaff((s) => (s ? { ...s, profile: { ...s.profile, [key]: before } } : s));
      load();                     // refuse or fail → show the truth, never our stale value
    }
  }
  async function saveJob(patch: Record<string, unknown>, key: string) {
    if (!staff) return;
    const before = { ...staff };
    // What these boxes held when the card was opened — the money fields included. Same `?? ""`
    // normalisation the admin profile uses, so an empty box and a null column compare equal.
    const was = Object.fromEntries(
      Object.keys(patch).map((k) => [k, (before as unknown as Record<string, unknown>)[k] ?? ""]),
    );
    setStaff((s) => (s ? { ...s, ...patch } as Staff : s));
    try {
      const d = await call({ id, action: "set_job", ...patch }, "PATCH", { fields: was });
      setStaff((s) => (s ? { ...s, completeness: d.completeness } : s));
      setFlash(key); setTimeout(() => setFlash((f) => (f === key ? null : f)), 1600);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setStaff(before); load(); }
  }
  async function setCap(key: string, v: string) {
    if (!staff) return;
    setStaff((s) => (s ? { ...s, permissions: { ...(s.permissions || {}), [key]: v } } : s));
    try {
      const d = await call({ id, action: "set_permissions", permissions: { [key]: v === "default" ? null : v } });
      setStaff((s) => (s ? { ...s, permissions: d.permissions || {} } : s));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); load(); }
  }
  async function voidPayment(p: Payment) {
    const reason = window.prompt(`Cancel this ${KIND_LABEL[p.kind] || p.kind} of ${money(p.amount)}?\n\nSay why (it stays on the record, struck through):`, "");
    if (reason === null) return;
    if (reason.trim().length < 3) { setErr("Say why you're cancelling this entry (a few words is enough)."); return; }
    try { await call({ action: "void_payment", staff_id: id, payment_id: p.id, reason }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  const who = staff?.name || staff?.username || "";
  const pr = staff?.profile || {};
  const canEdit = !!access?.canEditProfile;
  const canJob = !!access?.canEditJobPay;
  const seePay = !!access?.canSeePay;
  const pct = staff ? Math.round((staff.completeness.filled / Math.max(1, staff.completeness.total)) * 100) : 0;

  // What the pay setup implies each month (a guide only — nothing is ever paid automatically).
  const expected = useMemo(() => {
    if (!staff?.pay_amount || staff.pay_type !== "monthly") return null;
    const extras = (staff.pay_extras || []).reduce((t, x) => t + (x.kind === "deduction" ? -Number(x.amount || 0) : Number(x.amount || 0)), 0);
    return Number(staff.pay_amount) + extras;
  }, [staff]);

  if (loading) return <div className="adm-empty">Loading…</div>;
  if (notEnabled) return (
    <>
      <div className="own-bar"><div className="own-crumb"><Link href="/owner/staff">Team &amp; pay</Link><i className="fas fa-chevron-right" style={{ fontSize: 9, opacity: 0.5, margin: "0 6px" }} /><span className="cur">Profile</span></div></div>
      <div className="adm-card"><div className="adm-empty">{notEnabled}</div></div>
    </>
  );
  if (!staff) return (
    <>
      <div className="own-bar"><div className="own-crumb"><Link href="/owner/staff">Team &amp; pay</Link><i className="fas fa-chevron-right" style={{ fontSize: 9, opacity: 0.5, margin: "0 6px" }} /><span className="cur">Profile</span></div></div>
      <div className="adm-card"><div className="adm-empty">{err || "Couldn't open that person."}</div>
        <button className="sp-btn" onClick={() => load()}>Try again</button></div>
    </>
  );

  // The per-field props that don't change per field — spread into every <ProfileField>.
  // The COMPONENT itself lives at module scope (see ProfileField above); building this
  // little object per render is fine, because the component type stays identical and React
  // therefore updates the existing inputs instead of replacing them.
  const fp = { canEdit, flash, onSave: (key: string, value: string) => { void saveProfile(key, value); } };

  return (
    <>
      <div className="own-bar">
        <div className="own-crumb">
          <Link href={scopePin ? `/owner/staff?rid=${scopePin}` : "/owner/staff"}>Team &amp; pay</Link>
          <i className="fas fa-chevron-right" style={{ fontSize: 9, opacity: 0.5, margin: "0 6px" }} />
          <span className="cur">{who}</span>
        </div>
      </div>

      {err && (
        <div className="adm-card sp-err">
          <b>Something went wrong.</b> <span className="sp-mut">{err}</span>
          <button className="sp-x" onClick={() => setErr(null)}>dismiss</button>
        </div>
      )}

      <div className="adm-card" style={{ ["--rcol" as string]: restaurant?.accentColor || "var(--accent)" }}>
        {/* ── header ─────────────────────────────────────────────────────── */}
        <div className="sp-head">
          <span className="sp-av" data-role={staff.role}>{initials(who)}</span>
          <div style={{ minWidth: 0 }}>
            <h1 className="sp-name">{who}</h1>
            <div className="sp-sub">
              <span className="sp-badge" data-role={staff.role}>{staff.role === "tablet" ? "waiter" : staff.role}</span>
              <span className={`sp-chip ${staff.active ? "ok" : "dang"}`}>{staff.active ? "active" : "disabled"}</span>
              <span><i className="fas fa-at" /> {staff.username}</span>
              {staff.joined_on && <span><i className="fas fa-calendar-day" /> joined {dateIN(staff.joined_on)}</span>}
              {staff.left_on && <span className="sp-chip warn">left {dateIN(staff.left_on)}</span>}
              <span><i className="fas fa-signal" /> last seen {ago(staff.last_seen_at)}</span>
            </div>
          </div>
          <div className="sp-acts">
            {/* This page IS the profile; visiting the panel they work on is a separate action
                (owner 2026-07-29 — the two were easy to mix up). New tab, so this page stays. */}
            {(staff.role === "manager" || staff.role === "tablet") && (
              <a className="sp-btn" href={staff.role === "manager" ? "/manager" : "/tablet"} target="_blank" rel="noopener"
                title={`Open the ${staff.role === "manager" ? "manager" : "waiter"} panel — the screen ${who} works on`}>
                <i className="fas fa-up-right-from-square" /> Visit their panel
              </a>
            )}
            <button className="sp-btn" onClick={() => router.push(scopePin ? `/owner/staff?rid=${scopePin}` : "/owner/staff")}>
              <i className="fas fa-arrow-left" /> Back to team
            </button>
          </div>
        </div>

        {/* ── completeness ───────────────────────────────────────────────── */}
        <div className="sp-complete">
          <span className={`sp-ring ${pct < 100 ? "low" : ""}`} style={{ ["--p" as string]: String(pct) }}>
            <i>{pct}%</i>
          </span>
          <div style={{ minWidth: 0 }}>
            <b>{staff.completeness.filled} of {staff.completeness.total} details filled</b>
            <div className="sp-mut" style={{ fontSize: 12 }}>
              {staff.completeness.missing.length
                ? <>Nothing here is compulsory — fill what you know now, finish it whenever. Still missing: {staff.completeness.missing.join(", ")}.</>
                : <>This record is complete. </>}
            </div>
          </div>
        </div>

        {/* ── tabs ───────────────────────────────────────────────────────── */}
        <div className="sp-tabs" role="tablist">
          {([
            ["personal", "Personal", "fa-id-card", true],
            ["job", "Job & pay", "fa-briefcase", seePay],
            ["pay", "Payments", "fa-indian-rupee-sign", seePay],
            ["access", "Access", "fa-sliders", true],
            ["perf", "Performance", "fa-chart-line", !!perf],
            ["activity", "Activity", "fa-clock-rotate-left", true],
          ] as [Tab, string, string, boolean][]).filter((t) => t[3]).map(([k, label, icon]) => (
            <button key={k} role="tab" aria-selected={tab === k} className="sp-tab" onClick={() => setTab(k)}>
              <i className={`fas ${icon}`} /> {label}
              {k === "pay" && summary ? <span className="sp-count">{summary.entries}</span> : null}
            </button>
          ))}
        </div>

        {/* ── PERSONAL ───────────────────────────────────────────────────── */}
        {tab === "personal" && (
          <div className="sp-pane">
            <div className="sp-note">
              <i className="fas fa-floppy-disk" />
              <div><b>Saves as you type.</b> Each field saves on its own the moment you leave it — no Save button to forget.
                A <span className="sp-self">•</span> marks something they can also fill in from their own panel.
                {!canEdit && <> You can only look at this record; your owner hasn&apos;t given you profile editing.</>}</div>
            </div>
            <p className="sp-sect">Who they are</p>
            <div className="sp-grid">
              <ProfileField {...fp} label="Full name" k="full_name" value={String(pr.full_name || "")} self />
              <div className="sp-f"><label>Login username</label>
                <input value={staff.username} readOnly disabled />
                <div className="sp-hint">Change it from the team list (it&apos;s how they sign in).</div>
              </div>
              <div className={`sp-f ${staff.phone ? "" : "empty"}`}>
                <label htmlFor="f-phone">Phone (primary)<span className="sp-self" title="They can also edit this from their own panel">•</span></label>
                <input id="f-phone" defaultValue={staff.phone || ""} placeholder="not added" inputMode="tel" disabled={!canEdit || busy}
                  onBlur={async (e) => {
                    const v = e.target.value.trim();
                    if (v === (staff.phone || "")) return;
                    try { await call({ id, action: "edit", phone: v }, "PATCH", { fields: { phone: staff.phone ?? "" } }); setFlash("phone"); setTimeout(() => setFlash(null), 1600); await load(); }
                    catch (er) { setErr(er instanceof Error ? er.message : String(er)); await load(); }
                  }} />
                {flash === "phone" && <div className="sp-saved"><i className="fas fa-check" /> Saved</div>}
              </div>
              <ProfileField {...fp} label="Alternate phone" k="alt_phone" value={String(pr.alt_phone || "")} type="tel" self />
              <ProfileField {...fp} label="Email" k="email" value={String(pr.email || "")} type="email" self />
              <ProfileField {...fp} label="Date of birth" k="dob" value={String(pr.dob || "")} type="date" hint="Used later for a birthday reminder." self />
              <ProfileField {...fp} label="Blood group" k="blood_group" value={String(pr.blood_group || "")}
                options={["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"].map((x) => [x, x])} self />
              <ProfileField {...fp} label="Language they read" k="language" value={String(pr.language || "")}
                options={[["hi", "Hindi"], ["en", "English"], ["gu", "Gujarati"], ["mr", "Marathi"], ["ta", "Tamil"], ["other", "Other"]]} self />
            </div>

            <p className="sp-sect">Where they live</p>
            <div className="sp-grid">
              <div className={`sp-f wide ${pr.address ? "" : "empty"}`}>
                <label htmlFor="f-address">Address<span className="sp-self" title="They can also edit this from their own panel">•</span></label>
                <textarea id="f-address" rows={2} defaultValue={String(pr.address || "")} placeholder="not added"
                  disabled={!canEdit || busy} onBlur={(e) => saveProfile("address", e.target.value)} />
                {flash === "address" && <div className="sp-saved"><i className="fas fa-check" /> Saved</div>}
              </div>
              <ProfileField {...fp} label="City" k="city" value={String(pr.city || "")} self />
              <ProfileField {...fp} label="Pincode" k="pincode" value={String(pr.pincode || "")} maxLength={6} self />
            </div>

            <p className="sp-sect">In case of emergency</p>
            <div className="sp-grid">
              <ProfileField {...fp} label="Contact name" k="emg_name" value={String(pr.emg_name || "")} self />
              <ProfileField {...fp} label="Relation" k="emg_relation" value={String(pr.emg_relation || "")}
                options={[["Father", "Father"], ["Mother", "Mother"], ["Spouse", "Spouse"], ["Brother", "Brother"], ["Sister", "Sister"], ["Friend", "Friend"], ["Other", "Other"]]} self />
              <ProfileField {...fp} label="Their phone" k="emg_phone" value={String(pr.emg_phone || "")} type="tel" self />
            </div>

            <p className="sp-sect">ID on file</p>
            <div className="sp-note amber">
              <i className="fas fa-shield-halved" />
              <div><b>Only the last 4 digits are stored</b> — never the full Aadhaar/PAN number and no photo of the card.
                That keeps you clear of India&apos;s data-protection rules while still recording that you checked it.
                Staff cannot change these two fields; only you can.</div>
            </div>
            <div className="sp-grid">
              <ProfileField {...fp} label="ID type" k="id_type" value={String(pr.id_type || "")}
                options={[["Aadhaar", "Aadhaar"], ["PAN", "PAN"], ["Driving licence", "Driving licence"], ["Voter ID", "Voter ID"], ["Passport", "Passport"]]} />
              <ProfileField {...fp} label="Last 4 digits" k="id_last4" value={String(pr.id_last4 || "")} maxLength={4} />
              <div className="sp-f"><label>Verified</label>
                <button type="button" className={`sp-toggle ${pr.id_verified ? "on" : ""}`} disabled={!canEdit || busy}
                  onClick={() => saveProfile("id_verified", !pr.id_verified)}>
                  <i className={`fas ${pr.id_verified ? "fa-toggle-on" : "fa-toggle-off"}`} />
                  {pr.id_verified ? "I've seen this ID" : "Not checked yet"}
                </button>
              </div>
            </div>

            {canJob && (
              <>
                <p className="sp-sect">Your private note</p>
                <div className="sp-grid">
                  <div className="sp-f wide">
                    <label htmlFor="f-notes">Notes about this person <span className="sp-mut">· only you and Aevidine see this — never the staff member</span></label>
                    <textarea id="f-notes" rows={2} defaultValue={String(pr.notes || "")} placeholder="not added"
                      disabled={!canEdit || busy} onBlur={(e) => saveProfile("notes", e.target.value)} />
                    {flash === "notes" && <div className="sp-saved"><i className="fas fa-check" /> Saved</div>}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── NOT ON THE PAY LIST YET (mig 221) ───────────────────────────── */}
        {(tab === "job" || tab === "pay") && seePay && !staff.in_payroll && (
          <div className="sp-pane">
            <div className="sp-note amber">
              <i className="fas fa-user-plus" />
              <div><b>{who} isn&apos;t on the pay list.</b> Having a profile and being paid through
                Aevidine are two different things — you add each person deliberately. Until then they
                have no rate, no payments can be recorded for them, and they count for nothing in your
                reports or on your dashboard.</div>
            </div>
            {canJob && (
              <button className="sp-btn cta" disabled={busy} onClick={async () => {
                try { const d = await call({ id, action: "set_payroll", in_payroll: true });
                  setStaff((x) => (x ? { ...x, in_payroll: d.in_payroll } : x)); await load(); }
                catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
              }}>
                <i className="fas fa-plus" /> Add {who} to the pay list
              </button>
            )}
          </div>
        )}

        {/* ── JOB & PAY ──────────────────────────────────────────────────── */}
        {tab === "job" && seePay && staff.in_payroll && (
          <div className="sp-pane">
            <div className="sp-note amber">
              <i className="fas fa-lock" />
              <div><b>Only you and Aevidine support see this tab.</b> Managers can&apos;t — unless you switch on
                “See staff pay” in Team → Powers. {who} sees their own salary here in their panel
                {staff.can_see_own_pay ? "" : " (you've switched that off for them)"}.</div>
            </div>
            {!canJob && <div className="sp-note"><i className="fas fa-circle-info" /><div>Only the owner can change someone&apos;s job and pay.</div></div>}

            <p className="sp-sect">The job</p>
            <div className="sp-grid">
              <div className={`sp-f ${staff.joined_on ? "" : "empty"}`}><label htmlFor="j-joined">Joined on</label>
                <input id="j-joined" type="date" defaultValue={staff.joined_on || ""} disabled={!canJob || busy}
                  onBlur={(e) => saveJob({ joined_on: e.target.value }, "joined_on")} />
                {flash === "joined_on" && <div className="sp-saved"><i className="fas fa-check" /> Saved</div>}
              </div>
              <div className={`sp-f ${staff.designation ? "" : "empty"}`}><label htmlFor="j-desig">Designation</label>
                <input id="j-desig" defaultValue={staff.designation || ""} placeholder="e.g. Senior waiter" disabled={!canJob || busy}
                  onBlur={(e) => saveJob({ designation: e.target.value }, "designation")} />
                {flash === "designation" && <div className="sp-saved"><i className="fas fa-check" /> Saved</div>}
              </div>
              <div className={`sp-f ${staff.employment_type ? "" : "empty"}`}><label htmlFor="j-emp">Employment type</label>
                <select id="j-emp" defaultValue={staff.employment_type || ""} disabled={!canJob || busy}
                  onChange={(e) => saveJob({ employment_type: e.target.value }, "employment_type")}>
                  <option value="">not added</option>
                  {EMPLOYMENT_TYPES.map((v) => <option key={v} value={v}>{EMP_LABEL[v]}</option>)}
                </select>
              </div>
              <div className={`sp-f ${staff.shift_label ? "" : "empty"}`}><label htmlFor="j-shift">Shift</label>
                <input id="j-shift" defaultValue={staff.shift_label || ""} placeholder="e.g. Evening (5pm – 12am)" disabled={!canJob || busy}
                  onBlur={(e) => saveJob({ shift_label: e.target.value }, "shift_label")} />
                {flash === "shift_label" && <div className="sp-saved"><i className="fas fa-check" /> Saved</div>}
              </div>
              <div className="sp-f wide"><label>Weekly off</label>
                <div className="sp-days">
                  {WEEK_DAYS.map((d) => {
                    const on = (staff.weekly_off || []).includes(d);
                    return (
                      <button key={d} type="button" className={`sp-day ${on ? "on" : ""}`} disabled={!canJob || busy}
                        onClick={() => saveJob({ weekly_off: on ? (staff.weekly_off || []).filter((x) => x !== d) : [...(staff.weekly_off || []), d] }, "weekly_off")}>
                        {d[0].toUpperCase() + d.slice(1)}
                      </button>
                    );
                  })}
                </div>
                <div className="sp-hint">Used by the performance report and by payroll later.</div>
              </div>
              <div className={`sp-f ${staff.left_on ? "" : "empty"}`}><label htmlFor="j-left">Left on <span className="sp-mut">· only if they&apos;ve left</span></label>
                <input id="j-left" type="date" defaultValue={staff.left_on || ""} disabled={!canJob || busy}
                  onBlur={(e) => saveJob({ left_on: e.target.value }, "left_on")} />
                <div className="sp-hint">Keeps their record and past payments; stops counting them in monthly cost.</div>
              </div>
            </div>

            <p className="sp-sect">How they&apos;re paid</p>
            <div className="sp-grid">
              <div className={`sp-f ${staff.pay_type ? "" : "empty"}`}><label htmlFor="p-type">Pay type</label>
                <select id="p-type" defaultValue={staff.pay_type || ""} disabled={!canJob || busy}
                  onChange={(e) => saveJob({ pay_type: e.target.value }, "pay_type")}>
                  <option value="">not added</option>
                  {PAY_TYPES.map((v) => <option key={v} value={v}>{PAYT_LABEL[v]}</option>)}
                </select>
              </div>
              <div className={`sp-f ${staff.pay_amount ? "" : "empty"}`}><label htmlFor="p-amt">Amount (₹)</label>
                <input id="p-amt" defaultValue={staff.pay_amount ? String(staff.pay_amount) : ""} placeholder="not added" inputMode="numeric"
                  disabled={!canJob || busy} onBlur={(e) => saveJob({ pay_amount: e.target.value }, "pay_amount")} />
                {flash === "pay_amount" && <div className="sp-saved"><i className="fas fa-check" /> Saved</div>}
              </div>
              <div className={`sp-f ${staff.pay_day ? "" : "empty"}`}><label htmlFor="p-day">Pay day</label>
                <input id="p-day" defaultValue={staff.pay_day || ""} placeholder="e.g. 1st of the month" disabled={!canJob || busy}
                  onBlur={(e) => saveJob({ pay_day: e.target.value }, "pay_day")} />
              </div>
              <div className={`sp-f ${staff.pay_mode ? "" : "empty"}`}><label htmlFor="p-mode">Usual mode</label>
                <select id="p-mode" defaultValue={staff.pay_mode || ""} disabled={!canJob || busy}
                  onChange={(e) => saveJob({ pay_mode: e.target.value }, "pay_mode")}>
                  <option value="">not added</option>
                  {PAY_MODES.map((v) => <option key={v} value={v}>{MODE_LABEL[v]}</option>)}
                </select>
              </div>
              <ProfileField {...fp} label="UPI ID" k="upi_id" value={String(pr.upi_id || "")} self />
              <ProfileField {...fp} label="Bank account · last 4" k="bank_last4" value={String(pr.bank_last4 || "")} maxLength={4} self />
            </div>

            <p className="sp-sect">Regular additions &amp; cuts <span className="sp-mut">— optional, every cycle</span></p>
            <div className="sp-rows">
              {(staff.pay_extras || []).map((x, i) => (
                <div className="sp-row" key={`${x.label}-${i}`}>
                  <b>{x.label}</b>
                  <span className="sp-mut">{x.kind === "deduction" ? "deducted" : "added"} every cycle</span>
                  <span className="sp-rt">
                    <b style={{ color: x.kind === "deduction" ? "var(--adm-danger)" : "var(--adm-ok)" }}>
                      {x.kind === "deduction" ? "− " : "+ "}{money(x.amount)}
                    </b>
                    {canJob && (
                      <button className="sp-mini danger" disabled={busy}
                        onClick={() => saveJob({ pay_extras: (staff.pay_extras || []).filter((_, j) => j !== i) }, "pay_extras")}>
                        Remove
                      </button>
                    )}
                  </span>
                </div>
              ))}
              {canJob && (
                <form className="sp-row add" onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget as HTMLFormElement);
                  const label = String(f.get("label") || "").trim();
                  const amount = Number(String(f.get("amount") || "").replace(/[^\d.]/g, ""));
                  if (!label || !amount) { setErr("Give the allowance a name and an amount."); return; }
                  saveJob({ pay_extras: [...(staff.pay_extras || []), { label, kind: String(f.get("kind")) === "deduction" ? "deduction" : "allowance", amount }] }, "pay_extras");
                  (e.currentTarget as HTMLFormElement).reset();
                }}>
                  <input name="label" placeholder="e.g. Travel allowance" maxLength={60} />
                  <select name="kind" defaultValue="allowance"><option value="allowance">Add</option><option value="deduction">Deduct</option></select>
                  <input name="amount" placeholder="₹ amount" inputMode="numeric" />
                  <button className="sp-btn" type="submit" disabled={busy}><i className="fas fa-plus" /> Add</button>
                </form>
              )}
            </div>

            {canJob && (
              <div className="sp-note" style={{ marginTop: 14 }}>
                <i className="fas fa-user-minus" />
                <div>
                  On the pay list{staff.payroll_added_by ? <> — added by {staff.payroll_added_by}</> : null}.{" "}
                  <button className="sp-mini danger" disabled={busy} onClick={async () => {
                    if (!confirm(`Remove ${who} from the pay list?\n\nPast payments stay on the record, but they stop counting as an expense and no new payments can be recorded.`)) return;
                    try { await call({ id, action: "set_payroll", in_payroll: false }); await load(); }
                    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
                  }}>Remove from pay list</button>
                </div>
              </div>
            )}
            {expected !== null && (
              <div className="sp-complete" style={{ marginTop: 12 }}>
                <i className="fas fa-calculator" style={{ fontSize: 18, color: "var(--accent)" }} />
                <div><b>Expected each month: {money(expected)}</b>
                  <div className="sp-mut" style={{ fontSize: 12 }}>
                    {money(staff.pay_amount)} salary{(staff.pay_extras || []).map((x) => ` ${x.kind === "deduction" ? "−" : "+"} ${money(x.amount)} ${x.label.toLowerCase()}`).join("")}.
                    A guide only — nothing is ever paid automatically.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PAYMENTS ───────────────────────────────────────────────────── */}
        {tab === "pay" && seePay && staff.in_payroll && (
          <div className="sp-pane">
            <div className="sp-kpis">
              <div className="sp-kpi"><div className="k">Paid this month</div><div className="v ok">{money(summary?.thisMonth)}</div>
                <div className="s">{expected !== null ? `expected ${money(expected)}` : "no monthly rate set"}</div></div>
              <div className="sp-kpi"><div className="k">Still due this month</div>
                <div className="v warn">{expected !== null ? money(Math.max(0, expected - (summary?.thisMonth || 0))) : "—"}</div>
                <div className="s">as on {dateIN(new Date().toISOString().slice(0, 10))}</div></div>
              <div className="sp-kpi"><div className="k">Advance outstanding</div>
                <div className={`v ${summary?.advanceOutstanding ? "warn" : ""}`}>{money(summary?.advanceOutstanding)}</div>
                <div className="s">{summary?.advanceOutstanding ? "record an “Advance recovered” entry to clear it" : "nothing pending"}</div></div>
              <div className="sp-kpi"><div className="k">Paid this year</div><div className="v">{money(summary?.thisYear)}</div>
                <div className="s">last paid {dateIN(summary?.lastPaidOn)}</div></div>
            </div>

            {access?.canRecordPay && (
              <div className="sp-bar">
                <button className="sp-btn cta" onClick={() => setShowPay(true)}><i className="fas fa-plus" /> Record a payment</button>
                <span className="sp-mut" style={{ fontSize: 12 }}>Logs money you handed over. Nothing leaves any account — this is a record.</span>
              </div>
            )}

            {payments.length === 0 ? (
              <div className="adm-empty">No payments recorded yet — record the first one when you pay {who}.</div>
            ) : (
              <div className="sp-table-wrap">
                <table className="sp-table">
                  <thead><tr><th>Paid on</th><th>For</th><th>Type</th><th>Mode</th><th className="num">Amount</th><th>Recorded by</th><th /></tr></thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className={p.voided_at ? "void" : ""}>
                        <td>{dateIN(p.paid_on)}</td>
                        <td>{p.for_period ? monthIN(p.for_period) : <span className="sp-mut">—</span>}</td>
                        <td><span className={`sp-chip ${p.voided_at ? "dang" : p.kind === "advance" ? "warn" : p.kind === "deduction" ? "" : "ok"}`}>
                          {p.voided_at ? "cancelled" : KIND_LABEL[p.kind] || p.kind}</span></td>
                        <td>{MODE_LABEL[p.mode] || p.mode}</td>
                        <td className="num">{p.kind === "deduction" ? "− " : ""}{money(p.amount)}</td>
                        <td className="sp-mut">{p.recorded_by || "—"}</td>
                        <td className="num">
                          {p.voided_at
                            ? <span className="sp-mut" title={`cancelled by ${p.voided_by || "—"}`} style={{ fontSize: 11 }}>{p.void_reason}</span>
                            : access?.canRecordPay
                              ? <button className="sp-mini danger" disabled={busy} onClick={() => voidPayment(p)}>Cancel</button>
                              : null}
                        </td>
                      </tr>
                    ))}
                    {payments.some((p) => p.note) && null}
                  </tbody>
                </table>
              </div>
            )}

            <div className="sp-note amber" style={{ marginTop: 12 }}>
              <i className="fas fa-clock-rotate-left" />
              <div><b>A payment is never silently erased.</b> A wrong entry is cancelled with a reason and stays
                visible, struck through — so the record always adds up and nobody can quietly rewrite what a
                person was paid.</div>
            </div>
            <div className="sp-note" style={{ marginTop: 8 }}>
              <i className="fas fa-file-invoice" />
              <div>Everything here also lands in <b>Reports → Team &amp; pay</b>: the day it was paid shows in
                your day book as money out, and the month it was for shows as salary cost.</div>
            </div>
          </div>
        )}

        {/* ── ACCESS ─────────────────────────────────────────────────────── */}
        {tab === "access" && (
          <div className="sp-pane">
            <p className="sp-sect">Their login</p>
            <div className="sp-rows">
              <div className="sp-row"><b>Role</b><span className="sp-mut">{staff.role === "tablet" ? "waiter" : staff.role}</span>
                <span className="sp-rt sp-mut" style={{ fontSize: 12 }}>Change it from the team list — it signs them out.</span></div>
              <div className="sp-row"><b>PIN</b><span className="sp-mut">{staff.hasPin ? "set by them" : "not set yet"}</span></div>
              {canJob && (
                <div className="sp-row"><b>Can see their own pay</b>
                  <span className="sp-mut">salary + payment history, in their own panel</span>
                  <span className="sp-rt">
                    <button className={`sp-toggle ${staff.can_see_own_pay ? "on" : ""}`} disabled={busy}
                      onClick={async () => {
                        try { const d = await call({ id, action: "set_own_pay", can_see_own_pay: !staff.can_see_own_pay });
                          setStaff((s) => (s ? { ...s, can_see_own_pay: d.can_see_own_pay } : s)); }
                        catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
                      }}>
                      <i className={`fas ${staff.can_see_own_pay ? "fa-toggle-on" : "fa-toggle-off"}`} />
                      {staff.can_see_own_pay ? "Yes" : "No"}
                    </button>
                  </span>
                </div>
              )}
            </div>

            {staff.role === "tablet" && canJob && (
              <>
                <p className="sp-sect">What this waiter may do <span className="sp-mut">— Default follows the restaurant setting</span></p>
                <div className="sp-rows">
                  {WAITER_CAPS.map(([key, label]) => {
                    const cur = staff.permissions?.[key] || "default";
                    return (
                      <div className="sp-row" key={key}>
                        <b>{label}</b>
                        <span className="sp-rt">
                          <span className="sp-seg">
                            {OVR_MODES.map(([v, ml]) => (
                              <button key={v} className={cur === v ? "on" : ""} disabled={busy} onClick={() => setCap(key, v)}>{ml}</button>
                            ))}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Waiter sections (mig 222): which tables this person's tablet shows. Only for
                waiters, and only when the restaurant actually has sections switched on —
                otherwise it's a control that changes nothing, which is worse than absent. */}
            {staff.role === "tablet" && sections?.moduleOn && (
              <>
                <p className="sp-sect">Tables this waiter serves <span className="sp-mut">— their tablet shows only these</span></p>
                {secTables.length === 0 && (
                  <div className="sp-note" style={{ marginBottom: 10 }}>
                    <i className="fas fa-triangle-exclamation" />
                    <div>No tables yet — <b>this waiter&apos;s tablet is empty</b> until you tick some below.</div>
                  </div>
                )}
                <div className="sp-tsec">
                  {Array.from({ length: sections.tableCount }, (_, k) => k + 1).map((i) => {
                    const on = secTables.includes(i);
                    return (
                      <button key={i} className={on ? "on" : ""} disabled={secBusy}
                        title={on ? `Tap to take table ${i} away` : `Tap to give table ${i}`}
                        onClick={() => saveSection(on ? secTables.filter((x) => x !== i) : [...secTables, i].sort((a, b) => a - b))}>
                        {on ? "✓ " : ""}T{i}
                      </button>
                    );
                  })}
                </div>
                <div className="sp-row" style={{ marginTop: 8 }}>
                  <span className="sp-mut">{secTables.length} of {sections.tableCount} tables</span>
                  <span className="sp-rt">
                    <button className="sp-btn" disabled={secBusy}
                      onClick={() => saveSection(Array.from({ length: sections.tableCount }, (_, k) => k + 1))}>All</button>
                    <button className="sp-btn" disabled={secBusy} onClick={() => saveSection([])}>None</button>
                  </span>
                </div>
                <div className="sp-note" style={{ marginTop: 10 }}>
                  <i className="fas fa-table-cells-large" />
                  <div>The whole floor at once — including any table <b>nobody</b> is serving — is in the manager panel under <b>Settings → Tables</b>.</div>
                </div>
              </>
            )}

            {/* This used to link to Team → Powers. That tab was removed in the access rebuild
                (2026-07-31) — permissions are set once, by Aevidine, so the link went nowhere.
                Say who to ask instead of offering a door that isn't there. */}
            <div className="sp-note" style={{ marginTop: 12 }}>
              <i className="fas fa-users-gear" />
              <div>What <b>all</b> your managers may do — including whether they can see staff pay — is set by
                Aevidine. Ask us to change it and it applies to every manager here straight away.</div>
            </div>
          </div>
        )}

        {/* ── PERFORMANCE ────────────────────────────────────────────────── */}
        {tab === "perf" && perf && (
          <div className="sp-pane">
            <div className="sp-kpis">
              <div className="sp-kpi"><div className="k">Days worked</div><div className="v">{perf.days_active}</div><div className="s">this month, from sign-ins</div></div>
              <div className="sp-kpi"><div className="k">Hours on shift</div><div className="v">{Number(perf.hours_active || 0).toFixed(1)}</div><div className="s">first to last action each day</div></div>
              <div className="sp-kpi"><div className="k">Orders punched</div><div className="v">{perf.orders_punched}</div><div className="s">{perf.tables_served} tables · {perf.guests_served} sittings</div></div>
              <div className="sp-kpi"><div className="k">Value punched</div><div className="v ok">{money(perf.value_punched)}</div><div className="s">{money(perf.discount_given)} given as discount</div></div>
              <div className="sp-kpi"><div className="k">Guest rating</div><div className="v">{perf.avg_rating ? `${perf.avg_rating}★` : "—"}</div><div className="s">{perf.ratings} guests rated their orders</div></div>
              {seePay && <div className="sp-kpi"><div className="k">Paid this month</div><div className="v">{money(perf.paid)}</div><div className="s">from the pay ledger</div></div>}
            </div>
            {perf.days_active === 0 && perf.orders_punched === 0 && (
              <div className="adm-empty">Nothing recorded for {who} this month yet. Numbers appear as they sign in and punch orders.</div>
            )}
            <div className="sp-note">
              <i className="fas fa-circle-info" />
              <div><b>Where these come from.</b> Sign-ins and actions give days and hours; orders they punched give
                the counts and value; guest star-ratings on those orders give the rating. Work done before
                29 Jul 2026 isn&apos;t attributed to a person — the app didn&apos;t record who until then.
                Compare the whole team in <a href="/owner/reports">Reports → Team performance</a>.</div>
            </div>
          </div>
        )}

        {/* ── ACTIVITY ───────────────────────────────────────────────────── */}
        {tab === "activity" && (
          <div className="sp-pane">
            <p className="sp-sect">What {who} did <span className="sp-mut">— newest first, from your activity log</span></p>
            {logRows === null ? <div className="adm-empty">Loading…</div>
              : logRows.length === 0 ? <div className="adm-empty">Nothing recorded for {who} yet.</div>
                : (
                  <div className="sp-rows">
                    {logRows.map((l) => (
                      <div className="sp-row" key={l.id}>
                        <b>{l.action.replace(/_/g, " ")}</b>
                        <span className="sp-mut" style={{ minWidth: 0 }}>{l.detail || ""}{l.table_number ? ` · table ${l.table_number}` : ""}</span>
                        <span className="sp-rt sp-mut" style={{ fontSize: 12 }} title={new Date(l.created_at).toLocaleString("en-IN")}>{ago(l.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
          </div>
        )}
      </div>

      {/* ── record-a-payment sheet ──────────────────────────────────────── */}
      {showPay && (
        <RecordPayment
          who={who} busy={busy} expected={expected}
          onClose={() => setShowPay(false)}
          onSave={async (b) => {
            await call({ action: "record_payment", staff_id: id, ...b }, "POST");
            setShowPay(false); await load();
          }}
          onError={(m) => setErr(m)}
        />
      )}

      {/* global: these styles must also reach the <F> field component below —
          styled-jsx scopes per component, so a scoped block left its inputs unstyled. */}
      <style jsx global>{`
        .sp-err { border-color: var(--adm-danger); margin-bottom: 14px; }
        .sp-mut { color: var(--muted); font-weight: 500; }
        .sp-x { margin-left: auto; background: none; border: none; color: var(--muted); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; }
        .sp-head { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
        .sp-av { width: 60px; height: 60px; border-radius: 16px; display: grid; place-items: center; flex: 0 0 auto; font-weight: 800; font-size: 21px; background: var(--rcol, var(--accent)); color: #05231a; }
        .sp-av[data-role="tablet"] { background: #fbbf24; color: #2a1c00; }
        .sp-av[data-role="manager"] { background: #60a5fa; color: #06182f; }
        .sp-name { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -.01em; }
        .sp-sub { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; font-size: 12.5px; color: var(--muted); margin-top: 4px; }
        .sp-badge { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; padding: 3px 8px; border-radius: 999px; background: rgba(128,128,128,.18); color: var(--muted); }
        .sp-badge[data-role="manager"] { background: color-mix(in srgb, #60a5fa 22%, transparent); color: #93c5fd; }
        .sp-badge[data-role="tablet"] { background: color-mix(in srgb, #fbbf24 22%, transparent); color: #fcd34d; }
        .sp-chip { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .02em; padding: 3px 9px; border-radius: 999px; background: var(--muted2); color: var(--muted); }
        .sp-chip.ok { background: color-mix(in srgb, var(--adm-ok) 16%, transparent); color: var(--adm-ok); }
        .sp-chip.warn { background: color-mix(in srgb, var(--adm-warn) 16%, transparent); color: var(--adm-warn); }
        .sp-chip.dang { background: color-mix(in srgb, var(--adm-danger) 16%, transparent); color: var(--adm-danger); }
        .sp-acts { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
        .sp-complete { display: flex; align-items: center; gap: 12px; margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, var(--fg, #888) 4%, transparent); border: var(--border); flex-wrap: wrap; }
        .sp-ring { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; flex: 0 0 auto; background: conic-gradient(var(--accent) calc(var(--p) * 1%), var(--muted2) 0); }
        .sp-ring.low { background: conic-gradient(var(--adm-warn) calc(var(--p) * 1%), var(--muted2) 0); }
        .sp-ring i { width: 30px; height: 30px; border-radius: 50%; background: var(--card); display: grid; place-items: center; font-style: normal; font-size: 9.5px; font-weight: 800; color: var(--muted); }
        .sp-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin: 16px 0 0; border-bottom: var(--border); }
        .sp-tab { min-height: 40px; padding: 0 13px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
        .sp-tab[aria-selected="true"] { color: var(--text, inherit); border-bottom-color: var(--accent); }
        .sp-count { min-width: 18px; padding: 0 5px; border-radius: 6px; background: var(--muted2); font-size: 10.5px; }
        .sp-pane { padding-top: 14px; }
        .sp-sect { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 18px 0 10px; }
        .sp-sect:first-child { margin-top: 0; }
        .sp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
        .sp-f { min-width: 0; }
        .sp-f.wide { grid-column: 1 / -1; }
        .sp-f label { display: block; font-size: 11.5px; font-weight: 700; color: var(--muted); margin-bottom: 5px; }
        .sp-f input, .sp-f select, .sp-f textarea { width: 100%; background: var(--bg); border: var(--border); color: var(--text, inherit); border-radius: 9px; min-height: 42px; padding: 9px 11px; font: inherit; font-size: 13px; }
        .sp-f textarea { min-height: 60px; resize: vertical; }
        .sp-f input:focus, .sp-f select:focus, .sp-f textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
        .sp-f.empty input, .sp-f.empty select, .sp-f.empty textarea { border-style: dashed; }
        .sp-f input:disabled, .sp-f select:disabled, .sp-f textarea:disabled { opacity: .7; }
        .sp-hint { font-size: 11px; color: var(--muted); margin-top: 4px; }
        .sp-self { color: var(--accent); font-weight: 800; margin-left: 4px; cursor: help; }
        .sp-saved { font-size: 11px; color: var(--adm-ok); font-weight: 700; margin-top: 4px; }
        .sp-note { display: flex; gap: 9px; padding: 11px 12px; border-radius: 10px; font-size: 12.5px; background: color-mix(in srgb, var(--accent) 9%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent); margin-bottom: 12px; }
        .sp-note.amber { background: color-mix(in srgb, var(--adm-warn) 10%, transparent); border-color: color-mix(in srgb, var(--adm-warn) 30%, transparent); }
        .sp-note i { margin-top: 2px; }
        .sp-note a { text-decoration: underline; }
        .sp-rows { display: flex; flex-direction: column; gap: 1px; border-radius: 10px; overflow: hidden; border: var(--border); }
        .sp-row { display: flex; align-items: center; gap: 10px; padding: 11px 12px; background: color-mix(in srgb, var(--fg, #888) 3%, transparent); flex-wrap: wrap; }
        .sp-row b { font-weight: 700; font-size: 13px; }
        .sp-rt { margin-left: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .sp-row.add { gap: 8px; }
        .sp-row.add input, .sp-row.add select { flex: 1 1 130px; min-height: 36px; padding: 6px 10px; border-radius: 8px; border: var(--border); background: var(--bg); color: var(--text, inherit); font: inherit; font-size: 12.5px; }
        .sp-btn { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 13px; border-radius: 9px; border: var(--border); background: var(--card); color: var(--text, inherit); font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
        .sp-btn:hover:not(:disabled) { border-color: var(--accent); }
        .sp-btn.cta { background: var(--own-cta, var(--accent)); border-color: transparent; color: #fff; }
        .sp-btn:disabled { opacity: .6; cursor: default; }
        .sp-mini { font: inherit; font-size: 11.5px; font-weight: 700; padding: 5px 9px; border-radius: 7px; border: var(--border); background: var(--card); color: var(--text, inherit); cursor: pointer; }
        .sp-mini.danger:hover:not(:disabled) { border-color: var(--adm-danger); color: var(--adm-danger); }
        .sp-toggle { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 12px; border-radius: 9px; border: var(--border); background: var(--card); color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
        .sp-toggle.on { color: var(--adm-ok); border-color: color-mix(in srgb, var(--adm-ok) 45%, transparent); background: color-mix(in srgb, var(--adm-ok) 10%, transparent); }
        .sp-toggle i { font-size: 17px; }
        .sp-days { display: flex; gap: 6px; flex-wrap: wrap; }
        .sp-day { min-height: 36px; min-width: 46px; border-radius: 9px; border: var(--border); background: var(--bg); color: var(--muted); font: inherit; font-size: 11.5px; font-weight: 800; cursor: pointer; }
        .sp-day.on { background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: var(--accent); color: var(--adm-ok); }
        .sp-seg { display: inline-flex; gap: 2px; background: var(--bg); border: var(--border); border-radius: 9px; padding: 2px; }
        .sp-seg button { min-height: 30px; padding: 0 10px; border: 0; border-radius: 7px; background: transparent; color: var(--muted); font: inherit; font-size: 11.5px; font-weight: 800; cursor: pointer; }
        .sp-seg button.on { background: var(--accent); color: #04160f; }
        /* Waiter sections (mig 222): the table chips. Same visual language as .sp-day —
           a grid of small toggles — so the page keeps one way of saying "pick some". */
        .sp-tsec { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px; max-height: 210px; overflow-y: auto; padding-right: 4px; }
        .sp-tsec button { min-height: 38px; border-radius: 9px; border: var(--border); background: var(--bg); color: var(--muted); font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; }
        .sp-tsec button.on { background: color-mix(in srgb, var(--accent) 16%, transparent); border-color: var(--accent); color: var(--adm-ok); }
        .sp-tsec button:disabled { opacity: .6; cursor: default; }
        .sp-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 12px; }
        .sp-kpi { background: color-mix(in srgb, var(--fg, #888) 4%, transparent); border: var(--border); border-radius: 12px; padding: 11px 12px; }
        .sp-kpi .k { font-size: 10.5px; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
        .sp-kpi .v { font-size: 21px; font-weight: 800; margin-top: 3px; letter-spacing: -.01em; }
        .sp-kpi .v.ok { color: var(--adm-ok); } .sp-kpi .v.warn { color: var(--adm-warn); }
        .sp-kpi .s { font-size: 11px; color: var(--muted); margin-top: 2px; }
        .sp-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
        .sp-table-wrap { overflow-x: auto; border: var(--border); border-radius: 10px; }
        .sp-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .sp-table th { text-align: left; font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); padding: 9px 10px; border-bottom: var(--border); white-space: nowrap; }
        .sp-table td { padding: 10px; border-bottom: var(--border); white-space: nowrap; }
        .sp-table tr:last-child td { border-bottom: 0; }
        .sp-table .num { text-align: right; font-variant-numeric: tabular-nums; }
        .sp-table tr.void td { text-decoration: line-through; color: var(--muted); }
        .sp-table tr.void td:last-child { text-decoration: none; }
        @media (max-width: 560px) {
          .sp-acts { margin-left: 0; width: 100%; }
          .sp-tabs { gap: 0; }
          .sp-tab { padding: 0 10px; font-size: 12px; }
        }
      `}</style>
    </>
  );
}

// ── the record-a-payment sheet ────────────────────────────────────────────────
// Its own component so the form state can't leak into the page, and so the whole thing
// unmounts (clearing every field) when it closes.
function RecordPayment({ who, busy, expected, onClose, onSave, onError }: {
  who: string; busy: boolean; expected: number | null;
  onClose: () => void;
  onSave: (b: Record<string, unknown>) => Promise<void>;
  onError: (m: string) => void;
}) {
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  // Escape closes it — the same "always give me a way out" habit as every other sheet.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  // …and so does the PHONE's hardware Back. This sheet only ever handled Escape, so on a
  // phone Back left the page with a half-filled money form still open (project rule: every
  // popup registers a back layer; found 2026-08-04). The sheet is only rendered while open,
  // so `true` is the right "is it open" answer here.
  useBackClose("owner-record-payment", true, onClose);
  const [saving, setSaving] = useState(false);

  return (
    <div className="rp-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rp-sheet" role="dialog" aria-modal="true" aria-label={`Record a payment for ${who}`}>
        <h3>Record a payment</h3>
        <p className="rp-sub">For {who}. This only records money you handed over — nothing leaves any account.</p>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const amount = String(f.get("amount") || "").trim();
          if (!amount) { onError("Enter an amount."); return; }
          setSaving(true);
          try {
            await onSave({
              kind: f.get("kind"), amount, mode: f.get("mode"), paid_on: f.get("paid_on"),
              for_period: f.get("tie") === "none" ? "" : f.get("for_period"), note: f.get("note"),
            });
          } catch (er) { onError(er instanceof Error ? er.message : String(er)); }
          finally { setSaving(false); }
        }}>
          <div className="rp-grid">
            <div className="rp-f"><label htmlFor="rp-amt">Amount (₹)</label>
              <input ref={ref} id="rp-amt" name="amount" inputMode="numeric" placeholder={expected ? String(expected) : "0"} required /></div>
            <div className="rp-f"><label htmlFor="rp-kind">What is it for?</label>
              <select id="rp-kind" name="kind" defaultValue="salary">
                {PAY_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select></div>
            <div className="rp-f"><label htmlFor="rp-tie">Tie it to a month?</label>
              <select id="rp-tie" name="tie" defaultValue="month">
                <option value="month">Yes — pick the month</option>
                <option value="none">No — not for a particular month</option>
              </select></div>
            <div className="rp-f"><label htmlFor="rp-period">Which month</label>
              <input id="rp-period" name="for_period" type="month" defaultValue={thisMonth} /></div>
            <div className="rp-f"><label htmlFor="rp-mode">Paid how</label>
              <select id="rp-mode" name="mode" defaultValue="cash">
                {PAY_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </select></div>
            <div className="rp-f"><label htmlFor="rp-date">Paid on</label>
              <input id="rp-date" name="paid_on" type="date" defaultValue={today} max={today} /></div>
            <div className="rp-f wide"><label htmlFor="rp-note">Note <span className="rp-mut">· optional</span></label>
              <input id="rp-note" name="note" placeholder="e.g. balance of July" maxLength={200} /></div>
          </div>
          <div className="rp-note">
            <i className="fas fa-user-check" />
            <div>Stamped with your name and today&apos;s time, and added to your activity log. Wrong entry later?
              Cancel it with a reason — it stays visible, struck through.</div>
          </div>
          <div className="rp-foot">
            <button type="button" className="rp-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="rp-btn cta" disabled={busy || saving}>
              <i className="fas fa-check" /> {saving ? "Saving…" : "Save payment"}
            </button>
          </div>
        </form>
      </div>
      <style jsx global>{`
        .rp-back { position: fixed; inset: 0; background: rgba(2,4,8,.55); display: grid; place-items: center; z-index: 90; padding: 16px; }
        .rp-sheet { width: min(560px, 100%); max-height: 90vh; overflow: auto; background: var(--card); border: var(--border); border-radius: 16px; padding: 16px; }
        .rp-sheet h3 { margin: 0 0 3px; font-size: 16px; }
        .rp-sub { margin: 0 0 12px; font-size: 12.5px; color: var(--muted); }
        .rp-mut { color: var(--muted); font-weight: 500; }
        .rp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
        .rp-f.wide { grid-column: 1 / -1; }
        .rp-f label { display: block; font-size: 11.5px; font-weight: 700; color: var(--muted); margin-bottom: 5px; }
        .rp-f input, .rp-f select { width: 100%; background: var(--bg); border: var(--border); color: var(--text, inherit); border-radius: 9px; min-height: 42px; padding: 9px 11px; font: inherit; font-size: 13px; }
        .rp-note { display: flex; gap: 9px; padding: 11px 12px; border-radius: 10px; font-size: 12px; background: color-mix(in srgb, var(--accent) 9%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent); margin-top: 12px; }
        .rp-foot { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
        .rp-btn { min-height: 40px; padding: 0 14px; border-radius: 9px; border: var(--border); background: var(--card); color: var(--text, inherit); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
        .rp-btn.cta { background: var(--own-cta, var(--accent)); border-color: transparent; color: #fff; }
        .rp-btn:disabled { opacity: .6; cursor: default; }
      `}</style>
    </div>
  );
}
