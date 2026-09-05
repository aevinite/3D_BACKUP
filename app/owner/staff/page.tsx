"use client";
// Owner · Staff & powers. Per restaurant the owner owns: add / disable / reset / remove staff.
// Data + writes go through /api/owner/staff, scoped server-side to exactly the restaurants this
// caller owns — the UI never has to police that itself.
//
// FLIPPING MANAGER POWERS IS NOT HERE ANY MORE. The access rebuild (2026-07-31) retired the old
// ladder: "Only the admin holds permissions. The owner panel and the manager panel configure none"
// (docs/ACCESS-MODEL.md) — the admin writes those flags through /api/admin/restaurants/access-tree.
// This comment used to point at /api/owner/manager-permissions, which no screen had called since
// that rebuild; the route was still live and was deleted in the T9 sweep (2026-08-05), so
// access-tree is genuinely the single writer the docs claim it is.
//
// This /owner/staff route is OWNER/ADMIN-only — the owner layout bounces anyone else to
// /login. A manager granted "manage_staff" manages staff from the EDITOR panel, which
// reuses this same API (they can't change the power toggles — those stay owner-only).
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { asSuffix, asValue } from "@/lib/ownerPin";

type Perms = Record<string, boolean>;
type Restaurant = { id: string; name: string; slug: string; accentColor: string; managerPermissions: Perms; ownerEntitlements?: Perms; modules?: Record<string, boolean>; payAccess?: PayAccess; tableCount?: number };
type Staff = { id: string; username: string; role: string; name: string | null; phone: string | null; active: boolean; restaurant_id: string; hasPin: boolean; last_seen_at?: string | null; permissions?: Record<string, string>;
  // Profiles & pay (mig 220). profileEligible is false for KITCHEN (no profile, owner's call)
  // and for any restaurant without the module — the row then shows account actions only.
  profileEligible?: boolean; completeness?: { filled: number; total: number } | null;
  joined_on?: string | null; designation?: string | null;
  pay_type?: string | null; pay_amount?: number | null;
  paidThisMonth?: number; advanceOutstanding?: number; lastPaidOn?: string | null; payHidden?: boolean;
  // Set by /api/owner/staff when this month's pay summary couldn't be read. The figures are then
  // ABSENT rather than 0 — `money(undefined)` prints "₹0", so the row must say so in words instead
  // of naming an amount nobody read (T9 sweep, 2026-08-06).
  payUnread?: boolean;
  in_payroll?: boolean };
type PayAccess = { moduleOn: boolean; canSeePay: boolean; canRecordPay: boolean; canEditProfile: boolean; canEditJobPay: boolean };

// Why a message is on screen — see `errKind` below. Kept a plain union so the banner can never be
// headed by a string somebody typed twice.
type ErrKind = "clash" | "refused" | "fault";
const ERR_HEAD: Record<ErrKind, string> = {
  clash: "Someone got there first.",
  refused: "That didn't go through.",
  fault: "Something went wrong.",
};
/** An error that remembers whether it was a refusal or a real failure. */
class CallError extends Error {
  kind: ErrKind;
  constructor(message: string, kind: ErrKind) { super(message); this.kind = kind; }
}

// WAITER_CAPS + OVR_MODES lived here — a private copy of the waiter permission list. Deleted
// 2026-08-04 with the controls that used them: lib/staffCaps.ts is the one list now, and the admin
// Access screen is the one screen. Do not reintroduce a role's permission list in a panel.

const ROLES = ["manager", "kitchen", "tablet"];
const money = (n: number | null | undefined) => "\u20b9" + Math.round(Number(n || 0)).toLocaleString("en-IN");

export default function OwnerStaffPage() {
  const router = useRouter();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [actor, setActor] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  // WHY the message exists, so the banner can be headed honestly (owner, 2026-08-18).
  //   clash   — someone else got there first. The system worked; nothing is broken.
  //   refused — we said no to what was typed (name too short, username taken, pay history).
  //   fault   — it genuinely failed (no internet, the server fell over).
  // Before this, all three were headed "Something went wrong.", which called the first two a
  // fault. That mattered more once the clash sentence actually started reaching the screen.
  const [errKind, setErrKind] = useState<ErrKind>("fault");
  const [loading, setLoading] = useState(true);
  const [reveal, setReveal] = useState<{ name: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [notEnabled, setNotEnabled] = useState<string | null>(null); // calm "section off" state, not an error
  // ── A SECTION YOU DO NOT HAVE SIMPLY IS NOT THERE (owner, 2026-08-31, extended 2026-09-01) ────
  // *"it will not even show that option… it will not only show 'unable to access', that there is a
  //  feature which contains inventory."* That is R36 from the page side: *"owner can't know which
  // option are not given to them, only admin should know that."*
  // The sidebar already hides a withheld section from a real owner (`OwnerShell` →
  // `if (!on && (!adminViewing || simulated)) return null`). This page did not — reached by a typed
  // URL or an old bookmark it printed "Staff management isn't enabled for your
  // restaurant — contact Aevidine", which names a
  // section he has not been given and tells him who to ask for it. The card is DELETED, not
  // restyled (the standing "a new way replaces the old one" rule), and he goes back to his
  // dashboard. `replace`, not `push`, so Back does not bounce him straight into it again.
  // The ADMIN never lands here: the route only answers `disabled` for a REAL owner, so the X-ray
  // view still opens every section — its nav says so outright.
  // Done on his say-so of 2026-09-01 ("okay, give me permission") after T14 shipped the same change
  // on Customers, Feedback & complaints, Inventory and Manager mode. Six screens, one rule.
  useEffect(() => { if (notEnabled) router.replace("/owner"); }, [notEnabled, router]);
  // What the owner typed into "Find someone" — a view filter over the list already loaded, never a query.
  const [q, setQ] = useState("");
  const pwRef = useRef<HTMLInputElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const errRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  // Waiter sections: which tables the person being added will serve, and which restaurant's
  // Add form is currently showing the waiter role. A waiter must be given at least one table
  // (owner 2026-07-30), so the Add button stays disabled until one is picked.
  const [newRole, setNewRole] = useState<Record<string, string>>({});
  const [newTables, setNewTables] = useState<Record<string, number[]>>({});
  // Bumped only to force a re-render so a controlled <select> snaps back to the real value
  // when the owner cancels a role change (otherwise the native picker keeps the chosen row).
  const [, forceRerender] = useState(0);
  // Inline rename / edit-phone editor: which row is open + its draft values.
  const [editing, setEditing] = useState<{ id: string; name: string; phone: string } | null>(null);
  // THE `tab` STATE IS GONE (sweep #8 T15, 2026-09-04). It was declared as `"team" | "powers"`,
  // initialised to "team" by a function that could return nothing else, never given a setter, and
  // read by exactly one `{tab === "team" && …}` that was therefore always true. The comment above it
  // described the two-view page in the present tense — "the PEOPLE … and the POWERS … ?tab=powers
  // deep-links the second one" — over its own one-line obituary, so the file both promised a Powers
  // view and admitted it had been removed, in adjacent lines. Nothing reads `?tab` anywhere in the
  // product. The Powers tab left in the access rebuild (owner, 2026-07-31: "only admin will have all
  // this permission"); its CSS was deleted 2026-08-19 and its controls 2026-08-04. This is the last
  // of it — "a new way replaces the old one", finished rather than left half-standing.
  // Synchronous re-entry guard so a fast double-click on "Add" can't fire twice before
  // React flushes the disabled state (the exact race that showed a raw duplicate-key error).
  const addingRef = useRef(false);
  // Admin-in-one-restaurant scope pin (bug C1) — mirrors app/owner/page.tsx & reports.
  // Rides on EVERY call as ?scope= so an admin viewing restaurant A in one tab and B
  // in another sees each tab's OWN restaurant, not the whole platform / the other tab's
  // (before, Staff ignored the pin: admin saw every restaurant regardless). Null for a
  // real owner (server scopes them by membership and ignores the param anyway).
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));
  // Same pin, but for a PAGE link (the profile route) rather than an API call.
  //
  // IT CARRIES ?as= TOO (T19 sweep, 2026-08-14). Every API call this page makes already appends
  // the chosen-owner pin through `withScope` → `asSuffix()`, but the PROFILE LINK didn't — so
  // opening a person dropped it, and the profile page (which reads `as` from its own URL, see
  // app/owner/staff/[id]/page.tsx) then asked the server without it. One screen, two ideas of
  // whose cockpit this is. Built from parts rather than a template so a pin that arrives alone
  // still rides along.
  const withRid = useCallback((p: string) => {
    const as = asValue();
    const q = [
      scopePin ? `rid=${encodeURIComponent(scopePin)}` : "",
      as ? `as=${encodeURIComponent(as)}` : "",
    ].filter(Boolean).join("&");
    return q ? `${p}?${q}` : p;
  }, [scopePin]);
  const withScope = useCallback(
    (p: string) => (scopePin ? `${p}${p.includes("?") ? "&" : "?"}scope=${scopePin}${asSuffix()}` : p),
    [scopePin]);
  // THE ?focus= DEEP LINK WAS DELETED HERE (T19 sweep, 2026-08-14). It read `?focus=<flag>` and
  // scrolled to `[data-perm-key="<flag>"]`, pulsing it — a hand-off from the X-ray "open the
  // setting that controls this" row. No element on this page has carried `data-perm-key` since
  // the Powers tab went in the access rebuild (the attribute is rendered in exactly one place in
  // the product now: the manager panel's per-person dropdown), and nothing links ?focus= here
  // either — components/owner/OwnerShell.tsx routes that row to /aevinite/access?focus=…, which
  // is where the switch actually lives. A handler that can never fire is a promise the next
  // reader would believe.

  // ONE door for every message on this page, so the heading always matches the reason.
  // `say` is for something we refuse ourselves (a name too short); `fail` is for a thrown error,
  // which knows its own kind — a network throw has no kind at all, and that really is a fault.
  // THE SAME REFUSAL, A SECOND TIME, WAS NOT BROUGHT BACK ONTO THE SCREEN (T13 sweep, 2026-08-27 —
  // measured). `setErr("…taken at this restaurant…")` with the string already in state is a no-op:
  // React sees the same value, does not re-render, and the scroll-into-view effect below — which
  // depends on `err` — never runs. On a 360×780 phone the first refused Add scrolled the banner to
  // y = 194 (visible); tapping Add again with the same name left it at y = -1190, off the top of the
  // screen, with the owner's typing still in the boxes and nothing appearing to happen. Exactly the
  // fault that effect was added to fix, for every attempt after the first.
  // So the message carries a counter that always moves, and the effect watches that too. A tap must
  // never vanish in silence, and "you already know" is not an answer to the second tap.
  const [errAt, setErrAt] = useState(0);
  const say = useCallback((msg: string, kind: ErrKind = "refused") => { setErrKind(kind); setErr(msg); setErrAt((n) => n + 1); }, []);
  const fail = useCallback((e: unknown) => {
    const kind: ErrKind = e instanceof CallError ? e.kind : "fault";
    setErrKind(kind);
    setErr(e instanceof Error ? e.message : String(e));
    setErrAt((n) => n + 1);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch(withScope("/api/owner/staff"), { cache: "no-store" }).then((x) => x.json());
      // A 403 "not enabled" is a legitimate state, NOT an error — show a calm card, not the
      // red "Something went wrong" banner (audit 2026-07-07).
      if (r.disabled) { setNotEnabled(r.error || "Staff management isn't enabled for your restaurant — contact Aevidine."); return; }
      if (r.error) throw new Error(r.error);
      setNotEnabled(null);
      setRestaurants(r.restaurants || []); setStaff(r.staff || []); setActor(r.actor || ""); setErr(null);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [withScope, fail]);
  useEffect(() => { load(); }, [load]);

  // When a new one-time password appears, bring the reveal card into view (it renders at the
  // TOP of a possibly-long page) and select it — an owner low on the page used to never see
  // it, and it can't be shown again (audit 2026-07-07).
  useEffect(() => {
    if (!reveal) return;
    revealRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => { pwRef.current?.focus(); pwRef.current?.select(); }, 250);
    return () => clearTimeout(t);
  }, [reveal]);

  // THE SAME ARGUMENT, FOR THE MESSAGE THAT SAYS NO (T13 sweep, 2026-08-17 — measured).
  //
  // The effect above exists because "an owner low on the page used to never see it". Every
  // refusal on this page renders in the SAME place — a banner at the very top — and nothing
  // brought that one into view. Measured on a 360×780 phone: submitting the Add form at the
  // bottom of the roster put the banner at y = -951px. So an owner who typed a 4-letter
  // password, or tried to remove someone the pay ledger protects, tapped the button and watched
  // absolutely nothing happen: their typing still in the boxes, no message anywhere on screen.
  // "A tap must never vanish in silence" (CLAUDE.md) — a refusal the person cannot see is the
  // same as no refusal at all.
  // `errAt` is in the dependency list on purpose — see the note on it above. Without it, only the
  // FIRST of a run of identical refusals reaches the screen.
  useEffect(() => {
    if (!err) return;
    errRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [err, errAt]);

  const canEditPowers = actor === "owner" || actor === "admin";


  async function call(path: string, init: RequestInit): Promise<any> {
    setBusy(true);
    try {
      const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } });
      const d = await r.json().catch(() => ({}));
      // A first-save-wins refusal (409) carries its plain sentence in `clash` — show that rather
      // than a bare code, so the person knows their value did NOT land (T9 sweep, 2026-08-05).
      if (!r.ok) {
        const c = d?.clash as { plain?: string; todo?: string } | undefined;
        // A clash says so itself; a 4xx is us refusing; a 5xx (or an unreadable reply) is a fault.
        if (c?.plain) throw new CallError(`${c.plain}${c.todo ? ` ${c.todo}` : ""}`, "clash");
        throw new CallError(d.error || `Request failed (${r.status})`, r.status >= 500 ? "fault" : "refused");
      }
      return d;
    } finally { setBusy(false); }
  }

  // Per-user override for a waiter's tablet cap (Default/On/PIN/Off). Server (GAP-B) refuses a
  // grant beyond the restaurant's ceiling; the UI also greys those, so this only ever sends valid ones.
  // Add / remove someone from the PAY LIST (mig 221). Having a profile is not the same as
  // being paid through the app: only people on this list get a rate, can be paid, and count
  // as an expense in the reports and on the dashboard.
  async function setPayroll(s2: Staff, on: boolean) {
    if (!on && !confirm(`Remove ${s2.name || s2.username} from the pay list?\n\nTheir past payments stay on the record, but they'll stop counting as an expense and you won't be able to record new payments for them.`)) return;
    try {
      await call(withScope("/api/owner/staff"), { method: "PATCH", body: JSON.stringify({ id: s2.id, action: "set_payroll", in_payroll: on }) });
      await load();
    } catch (e) { fail(e); }
  }

  async function addStaff(rid: string, form: HTMLFormElement) {
    if (addingRef.current) return; // block a second immediate submit (double-click)
    addingRef.current = true;
    try {
      const fd = new FormData(form);
      const name = String(fd.get("name") || "").trim();
      const role = String(fd.get("role") || "manager");
      const password = String(fd.get("password") || "").trim();
      if (name.length < 2) { say("Name must be at least 2 characters."); return; }
      // Optional details typed on the same form. Only non-empty ones are sent, so a bare
      // add is exactly the request it always was.
      const opt: Record<string, unknown> = {};
      const put = (k: string, v: FormDataEntryValue | null) => { const x = String(v ?? "").trim(); if (x) opt[k] = x; };
      put("phone", fd.get("phone"));
      put("designation", fd.get("designation"));
      put("joined_on", fd.get("joined_on"));
      put("pay_type", fd.get("pay_type"));
      put("pay_amount", fd.get("pay_amount"));
      const fullName = String(fd.get("full_name") || "").trim();
      if (fullName) opt.profile = { full_name: fullName };
      const tables = role === "tablet" ? (newTables[rid] || []) : undefined;
      if (role === "tablet" && !tables!.length) { say("Pick at least one table for this waiter."); return; }
      const d = await call(withScope("/api/owner/staff"), { method: "POST", body: JSON.stringify({ name, role, password: password || undefined, restaurant_id: rid, tables, ...opt }) });
      setReveal({ name: d.name, password: d.password }); setCopied(false);
      form.reset();
      setNewRole((m) => ({ ...m, [rid]: "manager" }));
      setNewTables((m) => ({ ...m, [rid]: [] }));
      await load();
    } catch (e) { fail(e); }
    finally { addingRef.current = false; }
  }

  // Copy the one-time password. Confirms with "Copied!"; on a non-secure origin (no
  // navigator.clipboard) it falls back to selecting the field so it's never silently lost.
  async function copyPw(pw: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pw);
        setCopied(true); setTimeout(() => setCopied(false), 1800); return;
      }
    } catch { /* fall through to manual-select fallback */ }
    const el = pwRef.current;
    if (el) {
      el.focus(); el.select();
      try { document.execCommand?.("copy"); } catch { /* selection still lets them Ctrl/Cmd-C */ }
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    }
  }

  async function saveEdit(s: Staff) {
    if (!editing || editing.id !== s.id) return;
    const name = editing.name.trim(); const phone = editing.phone.trim();
    if (name.length < 2) { say("Name must be at least 2 characters."); return; }
    try {
      // What the row said when this inline editor opened — so a second person renaming the same
      // person is refused instead of silently overwritten (T9 sweep, 2026-08-05).
      await call(withScope("/api/owner/staff"), {
        method: "PATCH",
        headers: { "X-LFH-Expect": JSON.stringify({ table: "staff_users", id: s.id, fields: { name: s.name ?? "", phone: s.phone ?? "" } }) },
        body: JSON.stringify({ id: s.id, action: "edit", name, phone }),
      });
      setEditing(null); await load();
    } catch (e) {
      // THE LOSER OF A CLASH WAS NEVER ACTUALLY TOLD (T13 sweep, 2026-08-17 — watched happen).
      //
      // This read `setErr(msg); await load();`. The refusal really does arrive correctly — the
      // server answers 409 with `clash.plain` ("Someone else changed the name while you had it
      // open — it now says …") and `call()` throws exactly that sentence. But `load()` ends its
      // success path with `setErr(null)`, so the reload fired one line later ERASED the message
      // before a single frame was painted with it. Measured: 409 + plain sentence on the wire,
      // and zero error banners in the DOM afterwards.
      //
      // That is the whole rule defeated, not a cosmetic slip: "first save wins, and the loser is
      // told" (CLAUDE.md item 11). What the owner saw instead was the row quietly showing someone
      // else's name, their own typing still sitting in the box, and no explanation anywhere — the
      // exact silent overwrite the expectation header exists to make impossible.
      // `verify:owner-clash` reported green throughout, because a text scan can only see that the
      // sentence is READ from the response; it cannot see it being cleared afterwards.
      //
      // So: refresh FIRST (the row must show the value that really landed), then say why. The
      // editor deliberately stays open with the draft in it, which is what `clash.todo` tells them
      // to do — "look at what it says now and redo yours if it's still right".
      await load();
      fail(e);
    }
  }

  async function resetPw(s: Staff) {
    if (!confirm(`Reset ${s.name || s.username}'s password? Their current login stops working.`)) return;
    try {
      const d = await call(withScope("/api/owner/staff"), { method: "PATCH", body: JSON.stringify({ id: s.id, action: "reset_password" }) });
      setReveal({ name: s.name || s.username, password: d.password }); setCopied(false);
    } catch (e) { fail(e); }
  }
  async function setActive(s: Staff, active: boolean) {
    // Disabling bumps their token → instant logout mid-shift, so confirm first (a mis-click
    // used to kick a working staffer off with no prompt). Re-enabling is harmless, no confirm.
    if (!active && !confirm(`Disable ${s.name || s.username}? They'll be logged out immediately and can't sign in until re-enabled.`)) return;
    try { await call(withScope("/api/owner/staff"), { method: "PATCH", body: JSON.stringify({ id: s.id, action: "set_active", active }) }); await load(); }
    catch (e) { fail(e); }
  }
  async function setRole(s: Staff, role: string) {
    if (role === s.role) return;
    // A role change bumps their token → instant logout mid-shift (exactly like Disable),
    // so warn first. Before, changing the role — or a mis-tap on the mobile select wheel —
    // silently booted a working staffer with no prompt (audit 2026-07-09). On cancel, force a
    // re-render so the controlled <select> snaps back to their real role.
    if (!confirm(`Change ${s.name || s.username} from ${s.role} to ${role}? They'll be logged out and must sign in again with their new ${role} access.`)) {
      forceRerender((n) => n + 1);
      return;
    }
    try { await call(withScope("/api/owner/staff"), { method: "PATCH", body: JSON.stringify({ id: s.id, action: "set_role", role }) }); await load(); }
    catch (e) { fail(e); }
  }
  async function del(s: Staff) {
    if (!confirm(`Remove ${s.name || s.username} for good? This can't be undone.`)) return;
    try { await call(withScope(`/api/owner/staff?id=${encodeURIComponent(s.id)}`), { method: "DELETE" }); await load(); }
    catch (e) { fail(e); }
  }

  return (
    <>
      {/* "Team", not "Staff & powers" (T19 sweep, 2026-08-14). The POWERS tab left in the access
          rebuild of 2026-07-31 and the sidebar label was corrected for exactly this reason on
          2026-08-05 — "the sidebar promised a screen that no longer exists" — but this crumb kept
          the old name for every restaurant WITHOUT the payroll module, which is the only branch
          that still rendered it. "& pay" stays where pay genuinely exists. */}
      <div className="own-bar"><div className="own-crumb"><span className="cur">{restaurants.some((r) => r.modules?.payroll) ? "Team & pay" : "Team"}</span></div></div>

      {/* People first, toggles second — the roster is what an owner opens this page for. */}
      {/* The POWERS tab was removed in the access rebuild (owner, 2026-07-31: "only admin
          will have all this permission"). What a manager may do is set once, by the admin, in
          Access & permissions → Default set for user → Manager. This page is the roster. */}
      <div className="ost-tabs" role="tablist">
        <button role="tab" aria-selected className="ost-tab">
          <i className="fas fa-users" /> Team
          <span className="ost-tcount">{staff.filter((s) => s.active).length}</span>
        </button>
        {/* FIND A PERSON (owner, 2026-08-18). Seven people needs no search; forty does, and a
            restaurant that size is exactly where scrolling to the right row costs real time
            mid-service. It filters EVERY restaurant card at once (a multi-restaurant owner would
            otherwise have to search each one), matches name, login, phone and role, and never
            hides the Add form — you can still add someone while a search is on. Nothing is
            fetched: this is the list already on screen. */}
        {staff.length > 0 && (
          <label className="ost-find">
            <i className="fas fa-magnifying-glass" aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Find someone — name, phone or role" aria-label="Find someone on your team" />
            {q && <button type="button" className="ost-x" onClick={() => setQ("")}>clear</button>}
          </label>
        )}
      </div>

      {err && (
        <div className="adm-card" ref={errRef} role="status" aria-live="polite"
          style={{ borderColor: errKind === "clash" ? "var(--adm-warn)" : "var(--adm-danger)", marginBottom: 14 }}>
          {/* THE HEADING TELLS THE TRUTH ABOUT WHAT HAPPENED (owner, 2026-08-18). All three used to
              read "Something went wrong.", which framed the system working correctly as a fault —
              "someone else changed this while you had it open" is not something going wrong, and
              neither is "that username is taken". It mattered more once that first sentence
              actually started reaching the screen. A clash is amber, not danger red: nothing is
              broken and nothing was lost, the other person simply got there first. */}
          <b>{ERR_HEAD[errKind]}</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span>
          {/* The server now answers 503 "please try again" when it couldn't READ your setup
              (instead of wrongly saying the feature is off), so this banner needs a retry. */}
          <button className="ost-mini" style={{ marginLeft: 10 }} disabled={busy}
            onClick={() => { setErr(null); setLoading(true); load(); }}>Try again</button>
          <button className="ost-x" onClick={() => setErr(null)}>dismiss</button>
        </div>
      )}

      {reveal && (
        <div className="adm-card ost-reveal" ref={revealRef}>
          <div><b>New password for {reveal.name}</b><div className="adm-muted" style={{ fontSize: 12.5 }}>Copy it now — it can&apos;t be shown again.</div></div>
          <input ref={pwRef} className="ost-pw" readOnly value={reveal.password} onFocus={(e) => e.currentTarget.select()} aria-label="One-time password" />
          <button className="ost-btn" onClick={() => copyPw(reveal.password)}>{copied ? "Copied!" : "Copy"}</button>
          <button className="ost-x" onClick={() => { setReveal(null); setCopied(false); }}>Done</button>
        </div>
      )}

      {loading && <div className="adm-empty">Loading…</div>}
      {/* The card that used to say which section he had not been given is gone (R36) — he is
          on his way back to the dashboard by the time this renders. */}
      {!loading && !notEnabled && restaurants.length === 0 && <div className="adm-empty">No restaurants are assigned to you yet. Ask the admin to assign one.</div>}

      {!notEnabled && restaurants.map((r) => {
        const all = staff.filter((s) => s.restaurant_id === r.id);
        // The search matches what the row SHOWS (the badge says "waiter", so "waiter" must find one)
        // as well as the stored login and the phone number.
        const needle = q.trim().toLowerCase();
        const team = needle
          ? all.filter((s) => [s.name || "", s.username, s.phone || "", s.role, s.role === "tablet" ? "waiter" : ""]
              .join(" ").toLowerCase().includes(needle))
          : all;
        // WORKING PEOPLE FIRST, DISABLED ONES UNDER THEIR OWN HEADING (owner, 2026-08-18).
        // A disabled login sat wherever creation order happened to put it, so on a roster with a
        // few of them the people actually on shift were interleaved with people who cannot sign
        // in. They are still on the same card and still one tap from Enable — they are just no
        // longer mixed into the list you read during service. Order within each group is
        // unchanged (the server sends oldest first).
        const working = team.filter((s) => s.active);
        const disabled = team.filter((s) => !s.active);
        // ONE row, rendered for both groups. Extracted rather than duplicated: this block is a
        // hundred lines long, and two copies of it is exactly how twin surfaces drift apart.
        const personRow = (s: Staff) => (
                  <div key={s.id} className={`ost-row ${s.active ? "" : "off"}`}>
                    <div className="ost-who">
                      <span className="ost-rolebadge" data-role={s.role}>{s.role === "tablet" ? "waiter" : s.role}</span>
                      <span className="ost-pn">{s.name || s.username}</span>
                      {s.phone && <span className="adm-muted" style={{ fontSize: 11.5 }}>{s.phone}</span>}
                      {!s.active && <span className="ost-disabled">disabled</span>}
                      {/* How complete their record is, and where their money stands. Kitchen rows
                          show neither — they have no profile (owner's call 2026-07-29). */}
                      {/* WHY A KITCHEN ROW IS SHORTER (owner asked for this on 2026-08-19). A kitchen
                          login has no profile, no completeness bar and no pay — his own ruling, made
                          three times (docs/REJECTED-IDEAS.md R7) and right. But on screen it just
                          looked like a row with things MISSING rather than a row that is complete as
                          designed, so every sweep re-asked the question and so would he.
                          Worded so it can never read as a promise of one later: it states what a
                          kitchen login IS for, not what it lacks. Never turn this into a link, a
                          button, or a "coming soon" — that is the thing he has refused three times. */}
                      {!s.profileEligible && s.role === "kitchen" && (
                        <span className="ost-nokitchen" title="Kitchen logins sign in to the kitchen screen to see and print tickets. There is no profile or pay record for them.">
                          kitchen screen only — no profile
                        </span>
                      )}
                      {s.profileEligible && s.completeness && (
                        <a className="ost-prog" href={withRid(`/owner/staff/${s.id}`)}
                           title={`${s.completeness.filled} of ${s.completeness.total} details filled — open their profile`}>
                          <span className={`ost-bar ${s.completeness.filled < s.completeness.total ? "part" : ""}`}>
                            <i style={{ width: `${Math.round((s.completeness.filled / Math.max(1, s.completeness.total)) * 100)}%` }} />
                          </span>
                          <span className="adm-muted" style={{ fontSize: 11 }}>
                            {s.completeness.filled === s.completeness.total ? "complete" : `${s.completeness.filled} of ${s.completeness.total} filled`}
                          </span>
                        </a>
                      )}
                      {/* Pay only exists for people ON the pay list. Off-list people show a
                          plain invitation instead of a misleading "pay not set". */}
                      {s.profileEligible && !s.payHidden && !s.in_payroll && (
                        canEditPowers
                          ? <button className="ost-mini paylist" disabled={busy} onClick={() => setPayroll(s, true)}
                              title="Put this person on the pay list so you can set a rate and record payments">
                              <i className="fas fa-plus" /> Add to pay list
                            </button>
                          : <span className="ost-nopay">not on the pay list</span>
                      )}
                      {s.profileEligible && !s.payHidden && s.in_payroll && (s.pay_amount ? (
                        <span className="adm-muted" style={{ fontSize: 11.5 }}>
                          {money(s.pay_amount)}{s.pay_type === "monthly" ? "/mo" : s.pay_type === "daily" ? "/day" : s.pay_type === "hourly" ? "/hr" : ""}
                          {/* The RATE above is stored on the person, so it is always readable. What
                              needed reading is this month's PAYMENTS — say so rather than print ₹0. */}
                          {s.payUnread ? (
                            <span style={{ color: "var(--adm-warn)" }}>{" · "}couldn&rsquo;t read this month&rsquo;s pay — refresh</span>
                          ) : (
                            <>
                              {" · "}<b style={{ color: s.paidThisMonth ? "var(--adm-ok)" : "var(--muted)" }}>{money(s.paidThisMonth)}</b> paid this month
                              {s.advanceOutstanding ? <span style={{ color: "var(--adm-warn)" }}> · {money(s.advanceOutstanding)} advance</span> : null}
                            </>
                          )}
                        </span>
                      ) : <span className="ost-nopay">on pay list · rate not set</span>)}
                    </div>
                    <div className="ost-actions">
                      {s.profileEligible && (
                        <a className="ost-mini open" href={withRid(`/owner/staff/${s.id}`)}>
                          <i className="fas fa-id-card" /> Open profile
                        </a>
                      )}
                      {/* Two DIFFERENT things, kept apart (owner 2026-07-29): "Open profile" is the
                          person's record; this opens the PANEL, in a new tab so you don't lose your
                          place in the roster. It says "the panel", not "their panel": a person-pinned
                          view (?as=) only works for Aevidine support (lib/viewAsPerson re-checks the
                          admin cookie), so for an owner this opens it with THEIR OWN access. It
                          promised the staff member's own view until 2026-08-05 and never gave it. */}
                      {(s.role === "manager" || s.role === "tablet") && (
                        <a className="ost-mini" href={s.role === "manager" ? "/manager" : "/tablet"} target="_blank" rel="noopener"
                          title={`Opens the ${s.role === "manager" ? "manager" : "waiter"} panel with your own access — not ${s.name || s.username}'s view of it`}>
                          <i className="fas fa-up-right-from-square" /> Open {s.role === "manager" ? "manager" : "waiter"} panel
                        </a>
                      )}
                      <select className="ost-mini" value={s.role} disabled={busy} onChange={(e) => setRole(s, e.target.value)} aria-label="Role">
                        {/* "waiter", not the storage word "tablet" — the badge on the left of this very
                            row says WAITER, and the Add form below already translated it. */}
                        {ROLES.map((ro) => <option key={ro} value={ro}>{ro === "tablet" ? "waiter" : ro}</option>)}
                      </select>
                      <button className="ost-mini" disabled={busy} onClick={() => setEditing(editing?.id === s.id ? null : { id: s.id, name: s.name || s.username, phone: s.phone || "" })}>Rename / edit phone</button>
                      <button className="ost-mini" disabled={busy} onClick={() => resetPw(s)}>Reset password</button>
                      <button className="ost-mini" disabled={busy} onClick={() => setActive(s, !s.active)}>{s.active ? "Disable" : "Enable"}</button>
                      <button className="ost-mini danger" disabled={busy} onClick={() => del(s)}>Remove</button>
                    </div>
                    {editing?.id === s.id && (
                      <div className="ost-editrow">
                        <input className="ost-in" value={editing.name} autoFocus placeholder="Username (their login)" autoComplete="off" maxLength={80}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                        <input className="ost-in" value={editing.phone} placeholder="Phone (optional)" autoComplete="off" maxLength={20}
                          onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
                        <button className="ost-btn" disabled={busy} onClick={() => saveEdit(s)}>Save</button>
                        <button className="ost-mini" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                        {/* ── THE ONE EDIT ON THIS ROW THAT STOPS SOMEONE SIGNING IN, AND IT SAID NOTHING
                            (sweep #8 T15, 2026-09-04) ────────────────────────────────────────────────
                            The first box IS the login. `/api/owner/staff` → action `edit` runs the typed
                            value through normalizeLoginName and writes BOTH `name` and `username`, and
                            its own comment says why that matters: "a rename means the name that person
                            has always typed no longer works". It even logs a `staff_rename` row with
                            both names, precisely so "my login stopped working" has an answer.
                            Every other control on this row that costs somebody their access says so
                            before it happens — Reset password ("Their current login stops working"),
                            Disable ("logged out immediately"), the role picker ("logged out and must
                            sign in again"). This one, which does the same thing, was a bare pair of
                            boxes and a Save button. And it is quieter than all of them: no token bump,
                            so the person stays signed in and only discovers it at their NEXT sign-in,
                            hours later, with nothing connecting the two.
                            A confirm() would be wrong here — the same editor edits the phone number,
                            which is harmless and frequent, and a dialog on every phone edit is the
                            noise that gets dialogs dismissed unread. So the warning appears only while
                            the name has actually been changed, and it names both sides of the change. */}
                        {editing.name.trim() && editing.name.trim() !== (s.name || s.username) && (
                          <div className="ost-renamewarn">
                            This is their <b>login name</b>: after saving they sign in as{" "}
                            <b>{editing.name.trim()}</b>, and <b>{s.username}</b> stops working. Tell them before they next sign in.
                          </div>
                        )}
                      </div>
                    )}
                    {/* PER-USER WAITER PERMISSIONS WERE REMOVED FROM HERE (owner, 2026-08-04).
                        Nine tri-state controls used to sit on this row — mark paid, discount,
                        invoice, take orders, parcel, table ops, table type, khata, banquet — written
                        straight to staff_users.permissions from a PRIVATE list in this file.
                        Three things were wrong with that, and they are the whole reason it is gone:
                          • "Only the admin holds permissions" (CLAUDE.md / docs/ACCESS-MODEL.md):
                            the owner panel configures none. This was the last screen that did.
                          • Eight of its nine keys had no row on the Access screen at all, so it was
                            a second, larger permission list quietly disagreeing with the canonical
                            one (lib/staffCaps) — a waiter's per-person list is ONE row there.
                          • It broke two of the screen's own rules: a capability the admin hadn't
                            enabled rendered greyed at 0.45 opacity ("no greyed-out ghosts"), and the
                            whole block was hidden whenever the payroll module was ON — so switching
                            payroll on made the only way to grant these disappear.
                        Waiter permissions now live in exactly one place, for every restaurant:
                        /aevinite → Access & permissions → Waiter (and its Per-person tab). */}
                  </div>
        );
        return (
          <div key={r.id} className="adm-card ost-card" style={{ ["--rcol" as string]: r.accentColor }}>
            <span className="ost-accent" aria-hidden="true" />
            <div className="ost-head">
              <div><div className="ost-name">{r.name}</div><div className="adm-muted" style={{ fontSize: 12 }}>
                {r.slug} · {needle ? `${team.length} of ${all.length} shown` : `${all.length} staff`}
              </div></div>
            </div>


            {/* ── The roster. There is no second view; see the note where `tab` used to live. ── */}
            {/* A HEADING WITH NOTHING UNDER IT SAYS NOTHING (T13 sweep, 2026-08-27 — read the
                screenshot). Search for someone who is DISABLED and every match lands in the group
                below, so this read: "Team", then blank, then "Disabled · 1 — cannot sign in". The
                person WAS found and the header said "1 of 2 shown", but the first thing the owner's
                eye meets is their own search under a heading with no one beneath it, which reads as
                "not found" until they carry on down the card. So when a search has matched only
                people who cannot sign in, say that in the gap instead of leaving it empty. */}
            <div className="ost-section-t" style={{ marginTop: 16 }}>Team</div>
            <div className="ost-team">
              {team.length === 0 && (
                <div className="adm-empty" style={{ padding: "10px 0" }}>
                  {needle ? `Nobody here matches “${q.trim()}”.` : "No staff yet — add the first below."}
                </div>
              )}
              {team.length > 0 && working.length === 0 && (
                <div className="adm-empty" style={{ padding: "10px 0" }}>
                  {needle
                    ? `Nobody working matches “${q.trim()}” — the ${disabled.length === 1 ? "match" : "matches"} below cannot sign in.`
                    : "Nobody here can sign in right now — everyone is disabled, below."}
                </div>
              )}
              {working.map(personRow)}
            </div>
            {disabled.length > 0 && (
              <>
                {/* Their own heading, so the list you read during service is only people who can
                    actually sign in. Still the same card, still one tap from Enable. */}
                <div className="ost-section-t ost-offhead">
                  Disabled <span className="adm-muted">· {disabled.length} — cannot sign in</span>
                </div>
                <div className="ost-team">{disabled.map(personRow)}</div>
              </>
            )}

            {/* Add staff */}
            <form className="ost-add" onSubmit={(e) => { e.preventDefault(); addStaff(r.id, e.currentTarget); }}>
              <input className="ost-in" name="name" placeholder="Username (their login)" autoComplete="off" maxLength={80} required />
              <select className="ost-in" name="role" defaultValue="manager"
                onChange={(e) => setNewRole((m) => ({ ...m, [r.id]: e.target.value }))}>
                {ROLES.map((ro) => <option key={ro} value={ro}>{ro === "tablet" ? "waiter" : ro}</option>)}
              </select>
              {/* THE MINIMUM IS STATED WHERE IT IS TYPED (T13 sweep, 2026-08-17). The server has
                  always refused a password under 6 characters, and this field said only
                  "blank = auto" — so the owner learned the rule from a red banner after a round
                  trip, which on a phone renders above the fold (fixed separately). The sibling
                  field on /owner/settings already says "min 6 characters"; this one now agrees.
                  `minLength` is not violated by an empty value, so "blank = auto" still works. */}
              <input className="ost-in" name="password" placeholder="Password (blank = auto, min 6)" autoComplete="off" minLength={6} />
              {/* PHONE IS NOT A PAY DETAIL (T19 sweep, 2026-08-14). It used to live inside the
                  payroll-gated "Add their details now" block below, so at a restaurant without
                  the pay module the owner had to add the person FIRST and then reopen the row
                  with "Rename / edit phone" to type the number they were already holding. The
                  roster shows a phone on every row and offers that edit button either way, so
                  the value was always wanted — just unreachable at the one moment it is in
                  someone's hand. The server has always accepted `phone` on create regardless of
                  the module. Full name / designation / joining date stay in the block: those
                  really are the profile feature. */}
              {/* maxLength matches the server's own `.slice(0, 20)` (T13 sweep, 2026-08-17). Without
                  it a longer number — two numbers in one box, or an extension — was accepted by the
                  form and then quietly cut short on save, so the roster showed a phone number that
                  was not the one the owner typed and nothing said so. The username field next to it
                  has always mirrored its server limit (80) for exactly this reason. */}
              <input className="ost-in" name="phone" placeholder="Phone (optional)" autoComplete="off" inputMode="tel" maxLength={20} />
              <button className="ost-btn" type="submit"
                disabled={busy || (newRole[r.id] === "tablet" && !(newTables[r.id] || []).length)}
                title={newRole[r.id] === "tablet" && !(newTables[r.id] || []).length ? "Pick at least one table for this waiter first" : ""}>
                <i className="fas fa-user-plus" /> Add
              </button>
              {/* Waiter sections: a waiter's tablet shows ONLY the tables picked here, so the
                  choice is made as they're created. "Select all" is the whole floor in one tap. */}
              {newRole[r.id] === "tablet" && !r.tableCount && (
                // AN EMPTY GRID IS NOT AN INSTRUCTION (T13 sweep, 2026-08-17 — reproduced by
                // forcing the floor size to 0). `tableCount` comes from one `settings.table_count`
                // read on the server, and that read's error is not inspected there, so a blip
                // answers 0. The picker then drew a box with NOTHING in it, "0 of 0 picked", and
                // the line "Pick at least one table" — telling the owner to do the one thing the
                // screen was not offering, with the Add button disabled for good and no way to
                // learn why. Say what actually happened instead. (The column itself is NOT NULL
                // DEFAULT 12 and the admin clamps it to 1–500, so a genuinely tableless
                // restaurant is not a normal state — which is exactly why the honest sentence
                // matters more than a picker.)  🔗 see the HANDOFF for the server-side read.
                <div className="ost-tables">
                  <div className="ost-tables-warn">
                    We couldn&apos;t read how many tables {r.name} has, so there is nothing to pick yet.
                    Try again in a moment — if it stays empty, contact Aevidine: a waiter can only be
                    given a section once the floor is set up.
                  </div>
                </div>
              )}
              {newRole[r.id] === "tablet" && !!r.tableCount && (
                <div className="ost-tables">
                  <div className="ost-tables-head">
                    <b>Tables this waiter will serve</b>
                    <button type="button" className="ost-btn sm" onClick={() => setNewTables((m) => ({ ...m, [r.id]: Array.from({ length: r.tableCount || 0 }, (_, k) => k + 1) }))}>Select all</button>
                    <button type="button" className="ost-btn sm" onClick={() => setNewTables((m) => ({ ...m, [r.id]: [] }))}>Clear</button>
                    <span className="adm-muted">{(newTables[r.id] || []).length} of {r.tableCount || 0} picked</span>
                  </div>
                  <div className="ost-tgrid">
                    {Array.from({ length: r.tableCount || 0 }, (_, k) => k + 1).map((i) => {
                      const on = (newTables[r.id] || []).includes(i);
                      return (
                        <button key={i} type="button" className={on ? "on" : ""}
                          onClick={() => setNewTables((m) => {
                            const cur = m[r.id] || [];
                            return { ...m, [r.id]: on ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b) };
                          })}>{on ? "\u2713 " : ""}T{i}</button>
                      );
                    })}
                  </div>
                  {!(newTables[r.id] || []).length && (
                    <div className="ost-tables-warn">Pick at least one table — their tablet shows only the tables you give them.</div>
                  )}
                </div>
              )}
              {/* Fill the person in right away — or skip it entirely and finish their profile
                  later. Every field here is optional; the server ignores the job/pay ones for a
                  kitchen login and for a manager who may not set pay. */}
              {r.modules?.payroll && (
                <details className="ost-more">
                  <summary>Add their details now <span className="adm-muted">· optional, you can do this later</span></summary>
                  <div className="ost-moregrid">
                    {/* No phone input here — it moved up to the always-visible Add row (one field,
                        one name, so a form with payroll ON can't submit two `phone` values). */}
                    <input className="ost-in" name="full_name" placeholder="Full name" autoComplete="off" maxLength={80} />
                    <input className="ost-in" name="designation" placeholder="Designation (e.g. Senior waiter)" autoComplete="off" maxLength={80} />
                    <label className="ost-lbl">Joined on<input className="ost-in" name="joined_on" type="date" /></label>
                    {r.payAccess?.canEditJobPay && <>
                      <select className="ost-in" name="pay_type" defaultValue="">
                        <option value="">Pay type…</option>
                        <option value="monthly">Monthly salary</option>
                        <option value="daily">Daily wage</option>
                        <option value="hourly">Hourly</option>
                        <option value="per_shift">Per shift</option>
                      </select>
                      <input className="ost-in" name="pay_amount" placeholder="Amount (\u20b9)" autoComplete="off" inputMode="numeric" />
                    </>}
                  </div>
                </details>
              )}
            </form>
          </div>
        );
      })}

      <style jsx>{`
        .ost-card { position: relative; overflow: hidden; padding-left: 22px; margin-bottom: 14px; }
        .ost-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--rcol, var(--accent)); }
        .ost-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
        .ost-name { font-size: 17px; font-weight: 800; }
        .ost-section-t { font-size: 12.5px; font-weight: 800; margin-bottom: 8px; }
        /* THE POWERS-TAB CSS WAS DELETED HERE (2026-08-19). Twelve rules — ost-perms, ost-perm and
           its states, reach-chip and its states, reach-legend, plus their reduced-motion rule —
           styled the nine tri-state permission controls and their reach badges. The controls went
           with the access rebuild (owner, 2026-07-31: "only admin will have all this permission")
           and the last of them on 2026-08-04; the CSS outlived them by four months, matching no
           element on this page. Three sweeps re-found it and each correctly decided it harmed
           nobody — which is exactly how dead code survives. If a permission control ever belongs on
           an owner screen again that is a decision, not a restyle: the switches live on
           /aevinite → Access and permissions. Guarded by verify:owner-panel section 11. */
        /* (The comment that used to sit here described the reach badges — part of the same
           Powers-tab block deleted above. It outlived its rules and was left standing over the
           .ost-tabs rule, so it read as an explanation of the tab strip. Removed 2026-08-27: after
           deleting a feature, check the tense of every comment left behind, not only the code.) */
        .ost-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 14px; border-bottom: var(--border); }
        .ost-tab { min-height: 40px; padding: 0 14px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--muted); font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
        .ost-tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
        .ost-tcount { min-width: 18px; padding: 0 5px; border-radius: 6px; background: var(--muted2); font-size: 10.5px; }
        /* Find someone — sits at the right end of the tab strip on a wide screen and drops onto its
           own full-width line on a phone (the tab strip already wraps). 40px tall, like the tab. */
        .ost-find { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; min-height: 40px;
          padding: 0 11px; border: var(--border); border-radius: 10px; background: var(--card); color: var(--muted); font-size: 12.5px; }
        .ost-find:focus-within { border-color: var(--accent); }
        .ost-find input { font: inherit; font-size: 13px; border: 0; outline: none; background: none; color: var(--fg, inherit); min-width: 0; width: 210px; }
        .ost-find input::-webkit-search-cancel-button { filter: grayscale(1); opacity: .6; }
        .ost-find .ost-x { margin-left: 0; }
        @media (max-width: 560px) {
          .ost-find { margin-left: 0; flex-basis: 100%; margin-bottom: 8px; }
          .ost-find input { width: auto; flex: 1 1 auto; }
        }
        /* The disabled group's heading. Amber-muted rather than red: these people are not a problem,
           they are simply not working right now. */
        .ost-offhead { margin-top: 14px; color: var(--muted); }
        .ost-prog { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
        .ost-bar { display: block; width: 74px; height: 6px; border-radius: 99px; background: var(--muted2); overflow: hidden; }
        .ost-bar i { display: block; height: 100%; background: var(--adm-ok, #34d399); }
        .ost-bar.part i { background: var(--adm-warn, #fbbf24); }
        /* --adm-warn, not --own-cta: --own-cta is the amber a CTA is FILLED with (white text sits on
           it), and it is the same value in both console skins — so used as INK it measured 3.68:1 on
           the dark card. --adm-warn is the amber that flips per skin: bright on the dark card, amber
           one step deeper on the light one. The border keeps the CTA amber. (T26, 2026-08-22.) */
        .ost-mini.paylist { color: var(--adm-warn, var(--accent)); border-color: color-mix(in srgb, var(--own-cta, var(--accent)) 45%, transparent); }
        .ost-nopay { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .02em; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--adm-warn) 16%, transparent); color: var(--adm-warn); }
        .ost-mini.open { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
        .ost-mini.open:hover { border-color: var(--accent); }
        .ost-team { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
        .ost-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border-radius: 9px; background: color-mix(in srgb, var(--fg, #888) 4%, transparent); }
        .ost-row.off { opacity: .6; }
        .ost-who { display: flex; align-items: center; gap: 9px; min-width: 0; flex-wrap: wrap; }
        .ost-pn { font-weight: 700; font-size: 13.5px; }
        .ost-rolebadge { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; padding: 3px 8px; border-radius: 999px; background: rgba(128,128,128,.18); color: var(--muted); }
        .ost-rolebadge[data-role="manager"] { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
        /* The owner console's light --accent (#059669) on an 18% wash of itself was 2.92:1
           (2026-08-06). Darker, same hue; the wash stays. */
        :global([data-skin="light"]) .ost-rolebadge[data-role="manager"] { color: color-mix(in srgb, var(--accent) 62%, #000); }
        /* …and the PLAIN badge (kitchen, waiter). It reads --muted on a flat grey chip, which measured
           3.81:1 on the light console — the manager one beside it was given a light value and this one
           was not, so on one row two badges of the same shape read differently. Gray-600, the next
           step in the same family the console already uses. (T26 sweep, 2026-08-22.) */
        :global([data-skin="light"]) .ost-rolebadge { color: #4b5563; }
        .ost-disabled { font-size: 10.5px; color: var(--adm-danger, #c0392b); font-weight: 700; }
        /* Quiet, not a warning: nothing is wrong with a kitchen login. Muted text, no chip, no colour
           that reads as a problem — it is a fact about the row, the same weight as a phone number. */
        .ost-nokitchen { font-size: 11.5px; color: var(--muted); }
        .ost-actions { display: flex; flex-wrap: wrap; gap: 6px; flex-basis: 100%; margin-top: 8px; }
        .ost-editrow { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: var(--border); }
        /* Amber, not red: nothing is wrong and nothing is lost — it is a consequence the owner has to
           know before they press Save. Full width so it sits UNDER the boxes rather than squeezing
           them, and it reads at 360px without the row growing when it is absent. */
        .ost-renamewarn { flex-basis: 100%; margin-top: 2px; font-size: 12px; line-height: 1.45; color: var(--adm-warn); }
        .ost-mini { font: inherit; font-size: 11.5px; font-weight: 700; padding: 5px 9px; border-radius: 7px; border: var(--border); background: var(--card); color: var(--fg, inherit); cursor: pointer; }
        .ost-mini:hover:not(:disabled) { border-color: var(--accent); }
        /* DANGER IS VISIBLE WITHOUT A MOUSE (2026-08-05). This was :hover-only, so on the owner's
           phone "Remove" looked exactly like "Disable" sitting next to it — and Remove is the one
           that cannot be undone. Colour it always; deepen it on hover. */
        .ost-mini.danger { border-color: color-mix(in srgb, var(--adm-danger, #c0392b) 45%, transparent); color: var(--adm-danger, #c0392b); }
        .ost-mini.danger:hover:not(:disabled) { border-color: var(--adm-danger, #c0392b); background: color-mix(in srgb, var(--adm-danger, #c0392b) 10%, transparent); }
        .ost-add { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 12px; border-top: var(--border); }
        /* Waiter sections: the table picker inside the Add form. Full width so it sits under
           the name/role/password row rather than squeezing them. */
        .ost-tables { flex: 1 1 100%; border: var(--border); border-radius: 12px; padding: 11px 12px; background: color-mix(in srgb, var(--fg, #888) 4%, transparent); }
        .ost-tables-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 9px; font-size: 13px; }
        .ost-tables-head .adm-muted { margin-left: auto; font-size: 12px; }
        .ost-btn.sm { min-height: 30px; padding: 0 10px; font-size: 12px; }
        .ost-tgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); gap: 6px; max-height: 190px; overflow-y: auto; padding-right: 4px; }
        .ost-tgrid button { min-height: 36px; border-radius: 9px; border: var(--border); background: var(--bg); color: var(--muted); font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; }
        .ost-tgrid button.on { background: color-mix(in srgb, var(--accent) 16%, transparent); border-color: var(--accent); color: var(--adm-ok); }
        .ost-tables-warn { margin-top: 9px; font-size: 12.5px; font-weight: 700; color: var(--adm-bad, #ef4444); }
        .ost-more { flex-basis: 100%; margin-top: 4px; }
        .ost-more summary { cursor: pointer; font-size: 12px; font-weight: 700; color: var(--muted); padding: 4px 0; }
        .ost-moregrid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
        .ost-lbl { display: flex; flex-direction: column; gap: 3px; font-size: 11px; font-weight: 700; color: var(--muted); flex: 1 1 150px; }
        .ost-in { font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 8px; border: var(--border); background: var(--card); color: var(--fg, inherit); flex: 1 1 150px; }
        /* --accent-on, not #fff — white on the console's light emerald measured 2.54:1 on the
           roster's "Add" button (T11 re-run, 2026-08-05). */
        .ost-btn { font: inherit; font-size: 13px; font-weight: 700; padding: 8px 14px; border-radius: 8px; border: none; background: var(--accent); color: var(--accent-on, #fff); cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
        .ost-btn:disabled { opacity: .6; cursor: default; }
        .ost-reveal { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; border-color: var(--adm-ok, #2e7d32); }
        .ost-pw { font-family: ui-monospace, monospace; font-size: 15px; font-weight: 700; padding: 6px 12px; border-radius: 8px; border: none; color: var(--fg, inherit); background: color-mix(in srgb, var(--accent) 12%, transparent); letter-spacing: .04em; min-width: 130px; }
        .ost-x { margin-left: auto; background: none; border: none; color: var(--muted); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; }
        /* On a phone the 5-control action cluster was wrapping messily mid-row. Drop the
           actions onto their own full-width line under the name and let each button grow to
           share the width evenly — cleaner + bigger tap targets (audit 2026-07-07). */
        @media (max-width: 560px) {
          .ost-row { align-items: flex-start; }
          .ost-actions { flex-basis: 100%; margin-top: 8px; }
          .ost-actions .ost-mini, .ost-actions select { flex: 1 1 auto; text-align: center; }
          /* 36px ON A PHONE (owner asked for this on 2026-08-19). Measured 26–28px before, in both
             skins — tappable, and full-width, but SHORTER than every other target in this very file
             (the table tiles are 36, the tab is 40) and one of them is Remove, which cannot be
             undone. 36 matches the table tiles rather than inventing a number, and it is the
             smallest change that clears them: the row grows by about 10px per action line, which is
             one extra line of scrolling per three people, not a redesign. Padding stays put so the
             labels do not move; min-height does the work. */
          .ost-actions .ost-mini, .ost-actions select { min-height: 36px; }
          /* The inline rename editor is on the same row and had the same problem. */
          .ost-editrow .ost-in, .ost-editrow .ost-btn, .ost-editrow .ost-mini { min-height: 36px; }
        }
      `}</style>
    </>
  );
}
