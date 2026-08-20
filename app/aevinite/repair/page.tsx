"use client";
// Admin · Repair — the one-stop "something's wrong, fix it" hub (redesigned 2026-07-22).
// Top-to-bottom it answers: what's broken right now? → jump into that panel OR hand it to
// Claude (now on the Mac / overnight) → what's queued → hands-on data tools → what Claude did.
//
// Live errors come from /api/admin/oplog?level=error (the same rows the dashboard's red button
// counts). Data surgery is backed by /api/admin/repair. Sending to Claude = /api/admin/fix-request
// (action_id bundles the error's context; mode picks instant vs the 02:30 robot). NO earnings shown.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/admin/toast";
import { useAdminModal } from "@/components/admin/useAdminModal";
import { adminFetch } from "@/lib/adminFetch";
import Dropdown from "@/components/admin/Dropdown";
import TicketCard, { type TicketLike } from "@/components/admin/TicketCard";
import { openRestaurantPanel, PANEL_COLOR, actLabel, timeAgo, type Action } from "@/components/admin/shared";
import { errorSig, errorGroupKey, errorHeadline } from "@/lib/errorSignature";

type Restaurant = { id: string; name: string };
type Session = { id: string; table_number: string; status: string; bill_no: number | null; invoice_no: number | null; invoice_voided: boolean };
type Order = { id: string; table_number: string; kot_no: number | null; status: string; payment_status: string; created_at: string; session_id: string | null };
type RepairData = { sessions: Session[]; orders: Order[] };
type FixRequest = { id: string; restaurant_id: string | null; created_at: string; source: string | null; mode?: string | null; summary: string; pr_url: string | null; err_key?: string | null };
type AgentRun = { id: string; kind: "live" | "nightly" | "audit"; title: string; status: "running" | "done" | "closed" | "failed"; report: string | null; started_at: string; ended_at: string | null };
// Complaints (staff/owner-raised tickets) — folded in from the old /aevinite/issues page.
type Issue = TicketLike & { restaurantName: string; restaurantSlug?: string; status: string };
// At-risk & onboarding — folded in from the old /aevinite/attention page.
type Risk = { id: string; name: string; slug: string; plan: string | null; reason: string };
type Onb = { id: string; name: string; slug: string; ageDays: number; reason: string };
type AttData = { atRisk: Risk[]; onboarding: Onb[]; generatedAt: string };
// Rate-limit hits (mig 205) — a configurable limit was reached; shown here with Fix/Change/Allow.
type RlHit = { id: string; restaurant_id: string; restaurant_name: string | null; key: string; subject: string; subject_label: string | null; hit_count: number; max_count: number; window_seconds: number; last_at: string };
// The rule behind a hit — only its key and human label are needed here (editing lives on the
// Rate limits page); it is what stops this screen printing a raw database key.
type RlRule = { key: string; label: string };
const rlPer = (s: number) => (s % 3600 === 0 ? `${s / 3600}h` : s % 60 === 0 ? `${s / 60} min` : `${s}s`);

type Op = "void_bill" | "delete_order" | "refire_order" | "unstick_table" | "edit_time";

const TICKET_FILTERS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

const uuid = () => (crypto as { randomUUID?: () => string }).randomUUID?.() || String(Date.now()) + Math.random();

const TOOLS: { op: Op; label: string; icon: string; desc: string; danger?: boolean }[] = [
  { op: "unstick_table", label: "Unstick a table", icon: "fa-wand-magic-sparkles", desc: "Force-close a jammed open/pending table so it's usable again." },
  { op: "refire_order", label: "Re-fire an order", icon: "fa-fire-burner", desc: "Send the same dishes to the kitchen again as a fresh order (new KOT)." },
  { op: "void_bill", label: "Void a bill", icon: "fa-file-circle-xmark", desc: "Reopen an invoiced bill for edits. The invoice number is kept on record." },
  { op: "edit_time", label: "Edit an order's time", icon: "fa-clock-rotate-left", desc: "Fix a wrong date/time on an order. Note: the business day flips at 5 AM." },
  // NOT "permanently" — this route soft-deletes (app/api/admin/repair/route.ts logs
  // "soft-deleted (tombstoned)"). Telling an admin the row is erased is both untrue and the
  // wrong mental model for the one behaviour the compliance case rests on (T15 sweep).
  { op: "delete_order", label: "Delete an order", icon: "fa-trash-can", desc: "Take a stuck order/bill off the floor and out of the reports. It stays in the records, tombstoned — not erased.", danger: true },
];

// Which staff panel an error came from → where "Go to that panel" opens, and a friendly name.
const PANEL_JUMP: Record<string, { route: string; label: string }> = {
  editor: { route: "/manager", label: "Manager panel" },
  manager: { route: "/manager", label: "Manager panel" },
  kitchen: { route: "/kitchen", label: "Kitchen panel" },
  tablet: { route: "/tablet", label: "Waiter tablet" },
  owner: { route: "/owner", label: "Owner panel" },
};
const PANEL_NAME: Record<string, string> = {
  editor: "Manager", manager: "Manager", kitchen: "Kitchen", tablet: "Tablet",
  owner: "Owner", admin: "Admin", guest: "Guest menu", menu: "Guest menu", db: "Database",
};

// Roll repeats of the SAME error into one row with a ×N badge, so a printer firing 8 times
// isn't 8 rows. Keyed by panel + restaurant + action + the NORMALISED message (mig 218), so the
// same bug carrying a different order id still counts as one problem instead of alarming twice.
// How many error REPORTS this board asks the server for. Named, because the page has to be able
// to say "there may be more" when the answer comes back exactly this long — a capped list that
// looks complete is how "19 problems open" quietly becomes a wrong number (T17 sweep, 2026-08-19).
const ERROR_FEED_LIMIT = 50;

type ErrGroup = { key: string; sample: Action; count: number; latest: string };
function groupErrors(rows: Action[]): ErrGroup[] {
  const map = new Map<string, ErrGroup>();
  for (const a of rows) {
    const key = errorGroupKey(a);
    const ex = map.get(key);
    if (ex) { ex.count++; if (a.created_at > ex.latest) ex.latest = a.created_at; }
    else map.set(key, { key, sample: a, count: 1, latest: a.created_at });
  }
  return Array.from(map.values()).sort((x, y) => y.latest.localeCompare(x.latest));
}

// A problem recorded as fixed (error_signatures, migs 218/219). This record NEVER hides an error —
// it only lets the page say "already fixed" and stops Fix-now opening a duplicate Claude session.
type ErrMemory = {
  id: string; restaurant_id: string | null; restaurant: string; panel: string; action: string;
  sig: string; fixed_at: string; fixed_by: string | null; pr_url: string | null; note: string | null;
};
// The memory covering a live problem tile, if any: same panel + action + signature, and either the
// same restaurant or a platform-wide (null) entry.
function memoryFor(g: ErrGroup, mem: ErrMemory[]): ErrMemory | null {
  const sig = errorSig(g.sample.detail);
  if (!sig) return null;
  const hits = mem.filter((m) => m.panel === g.sample.panel && m.action === g.sample.action && m.sig === sig);
  return hits.find((m) => m.restaurant_id === (g.sample.restaurant_id || null)) || hits.find((m) => m.restaurant_id === null) || null;
}

export default function AdminRepair() {
  const toast = useToast();
  const [rid, setRid] = useState("");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [data, setData] = useState<RepairData | null>(null);
  const [dataErr, setDataErr] = useState(false);
  const [tool, setTool] = useState<Op | null>(null);

  // Live problems (error-level log rows) + local view state.
  const [errors, setErrors] = useState<Action[]>([]);
  const [errLoading, setErrLoading] = useState(true);
  // Which of this page's feeds did NOT arrive on the last load. Empty string = it did.
  // Nothing on this page may draw a green all-clear for a list it could not read.
  const [problemsErr, setProblemsErr] = useState("");
  const [rlErr, setRlErr] = useState("");
  const [feedsFailed, setFeedsFailed] = useState<string[]>([]);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmResolve, setConfirmResolve] = useState<string>(""); // group key mid-confirm ("are you sure?")
  const [resolving, setResolving] = useState<Set<string>>(new Set());
  // Problems recorded as fixed (migs 218/219) + whether the reference list is open.
  const [memories, setMemories] = useState<ErrMemory[]>([]);
  const [showMemories, setShowMemories] = useState(false);

  // "Describe a problem" box + the queue + Claude session history.
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [requests, setRequests] = useState<FixRequest[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [openRun, setOpenRun] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Complaints (staff/owner tickets) — platform-wide, folded in from the old Tickets page.
  const router = useRouter();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issuesErr, setIssuesErr] = useState(false);
  const [ticketFilter, setTicketFilter] = useState("open");
  const [ticketBusy, setTicketBusy] = useState<string | null>(null);

  // At-risk & onboarding — platform-wide, folded in from the old At-risk page.
  const [att, setAtt] = useState<AttData | null>(null);
  const [attErr, setAttErr] = useState(false);

  // Rate-limit hits (mig 205) — a configurable limit was reached (all restaurants), plus the
  // rules themselves so a hit can be named the way the Rate limits page names it.
  const [rlHits, setRlHits] = useState<RlHit[]>([]);
  const [rlRules, setRlRules] = useState<RlRule[]>([]);
  const rlLabel = (key: string) =>
    rlRules.find((r) => r.key === key)?.label
    // Until the rules arrive (or for a key with no rule row), prettify rather than print the raw
    // database key — the same rule actLabel() follows for action codes.
    || key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

  useEffect(() => {
    (async () => {
      const r = await adminFetch<{ restaurants: Restaurant[] }>("/api/admin/restaurants");
      if (r.ok) setRestaurants(r.data.restaurants || []);
    })();
  }, []);

  // Hands-on tools need a restaurant's live tables/orders.
  const load = useCallback(async () => {
    if (!rid) { setData(null); return; }
    setData(null); setDataErr(false);
    const r = await adminFetch<RepairData>(`/api/admin/repair?restaurant_id=${rid}`);
    if (r.ok) setData(r.data); else setDataErr(true);
  }, [rid]);
  useEffect(() => { load(); }, [load]);

  // Everything that isn't restaurant-scoped: the live errors, the queue, the history. ONE
  // refresh function so the top Refresh button re-pulls all three (no background polling —
  // click-to-refresh keeps egress low, matching the rest of admin).
  const loadHub = useCallback(async () => {
    setErrLoading(true);
    // ?scope=all forces the platform-wide complaints view (an admin's act-as cookie would
    // otherwise silently collapse it to one restaurant — same fix the old Tickets page used).
    const [e, q, h, iss, at, rl, mem] = await Promise.all([
      // ?unresolved=1 — only errors nobody has cleared yet (mig 181 resolved_at). Resolving one
      // (or a landed fix, via the mig 183 trigger) drops it off this list; the full Logs page
      // still shows resolved rows. Without this the board could never be emptied.
      adminFetch<{ actions: Action[] }>(`/api/admin/oplog?level=error&limit=${ERROR_FEED_LIMIT}&unresolved=1`),
      adminFetch<{ requests: FixRequest[] }>("/api/admin/fix-request?status=open"),
      adminFetch<{ runs: AgentRun[] }>("/api/admin/agent-runs"),
      adminFetch<{ issues: Issue[] }>("/api/owner/issues?scope=all"),
      adminFetch<AttData>("/api/admin/attention"),
      // `rules` rides along so a hit can be shown by its REAL name. This row used to print
      // `h.key.replace(/_/g," ")` — "guest order" — while the Rate limits page showed the same
      // wall as "Guest orders (per table)". One limit, two names, and the raw one is a database
      // key on a person's screen, which is the thing actLabel() exists to prevent (T20, 2026-08-16).
      adminFetch<{ events: RlHit[]; rules: RlRule[] }>("/api/admin/rate-limits"),
      // Problems recorded as fixed (migs 218/219) — drives the "came back after the fix" label and
      // the read-only "Already fixed" reference list. Nothing here hides an error.
      adminFetch<{ memories: ErrMemory[] }>("/api/admin/error-memory"),
    ]);
    // A FAILED READ IS NOT AN ALL-CLEAR (T17 sweep, 2026-08-19). Five of these seven results were
    // used with a bare `if (x.ok)`, so a request that never arrived left its list empty — and an
    // empty list is drawn on this page as a GREEN "All clear — no unresolved problems" and a green
    // "No rate limits have been reached." At 9pm on a Saturday that is the worst sentence this
    // screen can say: the admin closes the tab believing the platform is quiet when the truth is
    // that the page could not ask. Every feed now records its failure by name, the green card is
    // replaced by a "couldn't load" line with Retry, and the pill above shows "—" instead of 0.
    const failed: string[] = [];
    if (e.ok) setErrors(e.data.actions || []); else failed.push("problems");
    if (q.ok) setRequests(q.data.requests || []); else failed.push("the Claude queue");
    if (h.ok) setRuns(h.data.runs || []); else failed.push("Claude's history");
    if (iss.ok) { setIssues(iss.data.issues || []); setIssuesErr(false); } else setIssuesErr(true);
    if (at.ok) { setAtt(at.data); setAttErr(false); } else setAttErr(true);
    if (rl.ok) { setRlHits(rl.data.events || []); setRlRules(rl.data.rules || []); } else failed.push("rate limits");
    if (mem.ok) setMemories(mem.data.memories || []); else failed.push("the already-fixed record");
    setProblemsErr(e.ok ? "" : (e.error || "Couldn't load the problem list."));
    setRlErr(rl.ok ? "" : (rl.error || "Couldn't load the rate-limit alerts."));
    setFeedsFailed(failed);
    setErrLoading(false);
  }, []);
  useEffect(() => { loadHub(); }, [loadHub]);

  const refreshAll = () => { setRefreshing(true); Promise.all([loadHub(), load()]).finally(() => setTimeout(() => setRefreshing(false), 500)); };

  // Two Claudes (owner 2026-07-22): 'instant' pops a terminal on the Mac now; 'overnight' waits
  // for the 02:30 robot. Used by both the describe box and the per-error buttons.
  const sendDescribed = async (mode: "instant" | "overnight") => {
    if (!note.trim()) { toast("Type what's happening first.", "err"); return; }
    setSending(true);
    const r = await adminFetch<{ ok: boolean }>("/api/admin/fix-request", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LFH-Action-Id": uuid() },
      body: JSON.stringify({ note: note.trim(), restaurant_id: rid || null, mode }),
    });
    setSending(false);
    if (r.ok) {
      setNote("");
      // Instant wording promises the whole loop (owner 2026-07-28): the popped session fixes it,
      // ships it live and clears the ticket itself — see scripts/live-fix-prompt.md steps 5-6.
      toast(mode === "instant" ? "Sent — a Claude window opens on the Mac within a minute, fixes it, puts it live, then clears this itself." : "Queued — the night robot takes it at 2:30 AM.");
      loadHub();
    } else toast(r.error || "Couldn't send that.", "err");
  };

  // Hand a specific error to Claude, bundling its surrounding log rows as context.
  const sendError = async (g: ErrGroup, mode: "instant" | "overnight") => {
    setSent((prev) => new Set(prev).add(g.key));
    const r = await adminFetch<{ ok: boolean }>("/api/admin/fix-request", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LFH-Action-Id": uuid() },
      body: JSON.stringify({ action_id: g.sample.id, restaurant_id: g.sample.restaurant_id || null, mode }),
    });
    if (r.ok) { toast(mode === "instant" ? "Sent to Claude — it fixes this, puts it live, and clears this tile itself." : "Queued for the 2:30 AM robot."); loadHub(); }
    else { toast(r.error || "Couldn't send that.", "err"); setSent((prev) => { const n = new Set(prev); n.delete(g.key); return n; }); }
  };

  // Mark a problem handled (owner 2026-07-24: a Resolve action, separate from Fix now/Overnight,
  // with an are-you-sure step). Persists via /api/admin/resolve-error (mig 181 resolved_at) for
  // the WHOLE ×N group, so it drops off the board here AND clears the dashboard red count — and
  // stays gone after a refresh (unlike the old local-only hide). Optimistic; reverts on failure.
  // Clears today's rows for the whole ×N group AND records that this problem was handled (migs
  // 218/219) — which only prevents a DUPLICATE Claude ticket for older occurrences. It never
  // silences a future error: if this happens again it lands on the board like any other problem.
  const resolveError = async (g: ErrGroup) => {
    setConfirmResolve("");
    setResolving((prev) => new Set(prev).add(g.key));
    setErrors((prev) => prev.filter((a) => errorGroupKey(a) !== g.key));
    const r = await adminFetch<{ ok: boolean }>("/api/admin/resolve-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action_id: g.sample.id }),
    });
    setResolving((prev) => { const n = new Set(prev); n.delete(g.key); return n; });
    if (r.ok) {
      toast(g.count > 1 ? `Resolved · cleared ${g.count} reports` : "Resolved");
      loadHub(); // pull the new record so the "already fixed" list stays honest
    } else { toast(r.error || "Couldn't resolve that.", "err"); loadHub(); }
  };

  // Forget a record, so Fix-now treats that problem as brand new again. (It was never hiding
  // anything — the record only answers "already fixed" when you press Fix-now on an old report.)
  const forgetMemory = async (m: ErrMemory) => {
    setMemories((prev) => prev.filter((x) => x.id !== m.id));
    const r = await adminFetch<{ ok: boolean }>(`/api/admin/error-memory?id=${m.id}`, { method: "DELETE" });
    if (r.ok) toast("Forgotten — Fix now will treat that problem as new again.");
    else { toast(r.error || "Couldn't undo that.", "err"); loadHub(); }
  };

  const jumpTo = (a: Action) => {
    const j = PANEL_JUMP[a.panel];
    if (j && a.restaurant_id) { openRestaurantPanel(a.restaurant_id, j.route); return; }
    if ((a.panel === "guest" || a.panel === "menu") && a.restaurant_slug) window.open(`/r/${a.restaurant_slug}/menu`, "_blank");
  };
  const jumpLabel = (a: Action): string | null => {
    if (PANEL_JUMP[a.panel] && a.restaurant_id) return `Go to ${PANEL_JUMP[a.panel].label}`;
    if ((a.panel === "guest" || a.panel === "menu") && a.restaurant_slug) return "Open guest menu";
    return null;
  };

  const dismissRequest = async (id: string) => {
    setRequests((prev) => prev.filter((x) => x.id !== id));
    const r = await adminFetch<{ ok: boolean }>("/api/admin/fix-request", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "dismissed" }),
    });
    if (!r.ok) { toast(r.error || "Couldn't update that.", "err"); loadHub(); }
  };

  // Rate-limit hit actions (mig 205). Allow = reset that subject's counter so a genuine customer
  // gets through now; Dismiss = clear the row; Fix = hand it to Claude. Optimistic removal.
  const rlAllow = async (h: RlHit) => {
    setRlHits((prev) => prev.filter((x) => x.id !== h.id));
    const r = await adminFetch<{ ok: boolean }>("/api/admin/rate-limits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "allow", event_id: h.id }),
    });
    if (r.ok) toast("Allowed — their counter is reset."); else { toast(r.error || "Couldn't allow.", "err"); loadHub(); }
  };
  const rlDismiss = async (h: RlHit) => {
    setRlHits((prev) => prev.filter((x) => x.id !== h.id));
    const r = await adminFetch<{ ok: boolean }>("/api/admin/rate-limits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss", event_id: h.id }),
    });
    if (!r.ok) { toast(r.error || "Couldn't dismiss.", "err"); loadHub(); }
  };
  const rlFix = async (h: RlHit) => {
    const r = await adminFetch<{ ok: boolean }>("/api/admin/fix-request", {
      method: "POST", headers: { "Content-Type": "application/json", "X-LFH-Action-Id": uuid() },
      body: JSON.stringify({ note: `Rate limit "${h.key}" reached by ${h.subject_label || h.subject}${h.restaurant_name ? ` at ${h.restaurant_name}` : ""} (${h.hit_count} in ${rlPer(h.window_seconds)}). Is this real abuse or is the limit too tight?`, restaurant_id: h.restaurant_id !== "00000000-0000-0000-0000-000000000000" ? h.restaurant_id : null, mode: "overnight" }),
    });
    if (r.ok) toast("Sent to Claude for the 2:30 AM robot."); else toast(r.error || "Couldn't send.", "err");
  };
  // Admin-login alert: "let them try again" — clear the short lockout on that device so a genuine
  // person (e.g. the owner forgot the password) can retry now. Marks the alert handled. (owner 2026-07-27)
  const rlClear = async (h: RlHit) => {
    setRlHits((prev) => prev.filter((x) => x.id !== h.id));
    const r = await adminFetch<{ ok: boolean }>("/api/admin/rate-limits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear", event_id: h.id }),
    });
    if (r.ok) toast("Cleared — that device can try the admin password again now."); else { toast(r.error || "Couldn't clear that.", "err"); loadHub(); }
  };
  // Block the device/IP behind an admin-login alert from reaching the admin panel (owner 2026-07-26).
  const rlBlock = async (h: RlHit) => {
    const r = await adminFetch<{ ok: boolean }>("/api/admin/rate-limits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "block", event_id: h.id }),
    });
    if (r.ok) { setRlHits((prev) => prev.filter((x) => x.id !== h.id)); toast("Blocked — that device can no longer reach the admin panel."); }
    else toast(r.error || "Couldn't block that.", "err");
  };

  // Resolve / reopen a complaint (admin is in scope for every restaurant). Optimistic flip.
  const setTicketStatus = async (id: string, status: "resolved" | "open") => {
    setTicketBusy(id);
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    // Through adminFetch like every other action here (T20 sweep, 2026-08-16). The bare fetch it
    // used before reverted the row on failure and said NOTHING, so a complaint you thought you had
    // resolved silently sprang back — the one action on this page that could fail in silence.
    const r = await adminFetch<{ ok: boolean }>("/api/owner/issues?scope=all", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setTicketBusy(null);
    if (!r.ok) { toast(r.error || "Couldn’t update that complaint.", "err"); loadHub(); }
  };
  // THE PICKER HAS TO MEAN THE WHOLE PAGE, OR THE BANNER IS A LIE (T17 sweep, 2026-08-19).
  // Choosing a restaurant put "Showing <name> only." at the top and then left the complaints and
  // the at-risk lists showing every restaurant on the stack — so a 9pm call about one client still
  // meant reading nine restaurants' complaints under a banner that said otherwise. Both feeds carry
  // the restaurant id already, so this is a filter over rows in hand: no extra request, no new data.
  const scopedIssues = rid ? issues.filter((i) => i.restaurant_id === rid) : issues;
  const openTickets = scopedIssues.filter((i) => i.status === "open").length;
  const shownTickets = useMemo(() => {
    const list = ticketFilter === "all" ? scopedIssues : scopedIssues.filter((i) => i.status === ticketFilter);
    return [...list].sort((a, b) =>
      a.status === b.status ? +new Date(b.created_at) - +new Date(a.created_at) : a.status === "open" ? -1 : 1);
  }, [scopedIssues, ticketFilter]);
  const atRisk = (att?.atRisk || []).filter((r) => !rid || r.id === rid);
  const onboarding = (att?.onboarding || []).filter((r) => !rid || r.id === rid);
  const attCount = atRisk.length + onboarding.length;

  const scopedName = restaurants.find((r) => r.id === rid)?.name || null;
  // ONE RESTAURANT PICKER FOR THE WHOLE PAGE (owner, 2026-08-16). It already existed, but only to
  // unlock the hands-on tools at the bottom — so choosing a restaurant appeared to do nothing to
  // the thing you were actually reading. A client rings about THEIR restaurant; there are nine on
  // this stack and the board was one flat list. It now narrows the problems and the limit hits too
  // (both act on rows already fetched — no extra request, no extra data).
  const groups = groupErrors(rid ? errors.filter((a) => (a.restaurant_id || "") === rid) : errors);
  const shownRlHits = rid ? rlHits.filter((h) => h.restaurant_id === rid) : rlHits;
  // A problem already handed to Claude must not offer "Fix now" again after a refresh (T20 sweep,
  // 2026-08-16). `sent` is only this page-load's memory, so a reload re-offered the button and a
  // second press filed a SECOND open ticket for the same error. `err_key` exists for exactly this
  // (mig 183) and nothing was reading it — and the server built it with a different formula from
  // the tile's own group key, so even a reader would not have matched. Both sides now use
  // errorGroupKey(), so the queue and the board describe a problem the same way.
  const queuedKeys = new Set(requests.map((q) => q.err_key).filter(Boolean) as string[]);
  const alreadyQueued = (g: ErrGroup) => sent.has(g.key) || queuedKeys.has(g.key);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 4 }}>Repair &amp; support</h1>
          <p className="adm-page-sub" style={{ margin: 0 }}>Everything that needs you — problems, complaints and at-risk restaurants — plus the tools to fix it by hand or hand to Claude.</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* THE PICKER LIVES AT THE TOP NOW (owner, 2026-08-16). It used to sit halfway down,
              under "Hands-on tools", and only unlocked those — so a 9pm call about ONE restaurant
              still meant reading every restaurant's errors, and choosing one looked like it did
              nothing. Same control, same state; it now scopes the whole page. */}
          <label className="adm-ret rp-pick">
            <i className="fas fa-store" aria-hidden="true" style={{ opacity: 0.7 }} /> Restaurant
            <select value={rid} onChange={(e) => setRid(e.target.value)} aria-label="Show problems and tools for one restaurant">
              <option value="">All restaurants</option>
              {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <button className="adm-btn" onClick={refreshAll} disabled={refreshing} title="Reload problems, complaints, at-risk, queue and history">
            <i className={`fas fa-rotate-right${refreshing ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
          </button>
        </div>
      </div>
      {rid && (
        <p className="adm-muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
          <i className="fas fa-filter" aria-hidden="true" style={{ marginRight: 6, opacity: 0.7 }} />
          Showing <b style={{ color: "var(--text)" }}>{scopedName}</b> only.{" "}
          <button className="rp-link" onClick={() => setRid("")}>Show every restaurant</button>
        </p>
      )}

      {/* Status strip — each live pill jumps to its section */}
      <div className="rp-strip">
        {/* ONE number for one thing. This pill once counted RAW error rows while the heading below
            counted GROUPS; it now counts what the board actually shows, with the raw total in the
            tooltip. Its WORDING was the second half of the same problem (T20 sweep, 2026-08-16):
            it said "(24h)" while the list underneath was every UNRESOLVED error whatever its age —
            live, that read "7 problems (24h)" over rows dated 3d, 7d, 8d and 9d ago, while the
            Dashboard's own 24h-bounded button sat quiet and grey. Both screens now mean the same
            thing by "a problem": one nobody has resolved. Nothing is hidden by age. */}
        <a className={`rp-pill${problemsErr ? "" : groups.length ? " alert" : " ok"}`} href="#problems"
          title={problemsErr
            ? "The problem list didn't load — this is not an all-clear"
            : errors.length > groups.length
            ? `Jump to problems — ${groups.length} problem${groups.length === 1 ? "" : "s"}, ${errors.length} reports in all (repeats are grouped)`
            : "Jump to problems"}>
          <i className={`fas ${problemsErr ? "fa-circle-question" : groups.length ? "fa-triangle-exclamation" : "fa-circle-check"}`} aria-hidden="true" />
          <span className="n">{errLoading ? "…" : problemsErr ? "—" : groups.length}</span><span>problem{groups.length === 1 && !problemsErr ? "" : "s"} open</span>
        </a>
        <a className={`rp-pill${shownRlHits.length ? " alert" : ""}`} href="#rate-limits" title="Jump to rate-limit hits">
          <i className="fas fa-gauge-high" aria-hidden="true" /><span className="n">{errLoading ? "…" : rlErr ? "—" : shownRlHits.length}</span><span>limit{shownRlHits.length === 1 && !rlErr ? "" : "s"} reached</span>
        </a>
        <a className={`rp-pill${openTickets ? " warn" : ""}`} href="#complaints" title="Jump to complaints">
          <i className="fas fa-flag" aria-hidden="true" /><span className="n">{openTickets}</span><span>open complaint{openTickets === 1 ? "" : "s"}</span>
        </a>
        <a className={`rp-pill${attCount ? " warn" : ""}`} href="#at-risk" title="Jump to at-risk restaurants">
          <i className="fas fa-heart-pulse" aria-hidden="true" /><span className="n">{att ? attCount : "…"}</span><span>need attention</span>
        </a>
        <div className="rp-pill">
          <i className="fas fa-robot" aria-hidden="true" /><span className="n">{requests.length}</span><span>waiting for Claude</span>
        </div>
        <div className="rp-pill">
          <i className="fas fa-screwdriver-wrench" aria-hidden="true" /><span className="n">{TOOLS.length}</span><span>hands-on tools</span>
        </div>
      </div>

      {/* One line naming EVERY feed that didn't arrive, so a quiet page is never mistaken for a
          quiet platform. It sits directly under the counts it makes untrustworthy. */}
      {!errLoading && feedsFailed.length > 0 && (
        <div className="rp-unread">
          <i className="fas fa-plug-circle-exclamation" aria-hidden="true" />
          <span>
            Couldn&rsquo;t read {feedsFailed.join(", ")} just now — <b>that is not an all-clear</b>, it means this page
            couldn&rsquo;t ask.
          </span>
          <button className="adm-btn" style={{ fontSize: 12, marginLeft: "auto" }} onClick={loadHub}>Retry</button>
        </div>
      )}

      {/* ── Problems right now ─────────────────────────────────────────── */}
      <div className="rp-sec-h" id="problems">
        <i className="fas fa-triangle-exclamation" aria-hidden="true" style={{ color: problemsErr ? "var(--adm-warn)" : groups.length ? "var(--adm-danger)" : "var(--muted)" }} />
        <h2>Problems right now</h2>
        {groups.length ? <span className="rp-chip danger">{groups.length}</span> : null}
        <span className="adm-muted" style={{ fontSize: 12, marginLeft: 2 }}>{scopedName ? scopedName : "all restaurants"} · not yet resolved</span>
      </div>

      {errLoading ? (
        <div className="adm-empty">Checking for problems…</div>
      ) : problemsErr ? (
        <div className="rp-unread">
          <i className="fas fa-triangle-exclamation" aria-hidden="true" />
          <span>{problemsErr} — so this is <b>unknown</b>, not clear.</span>
          <button className="adm-btn" style={{ fontSize: 12, marginLeft: "auto" }} onClick={loadHub}>Retry</button>
        </div>
      ) : groups.length === 0 ? (
        <div className="rp-clear"><i className="fas fa-circle-check" aria-hidden="true" /> All clear — no unresolved problems{scopedName ? ` at ${scopedName}` : ""}.</div>
      ) : (
        <div style={{ marginBottom: 6 }}>
          {groups.map((g) => {
            const a = g.sample;
            const color = PANEL_COLOR[a.panel] || "var(--adm-danger)";
            const title = actLabel(a.action);
            const jl = jumpLabel(a);
            const isOpen = expanded.has(g.key);
            const wasSent = alreadyQueued(g);
            // Was this problem fixed once before? Then it is BACK — the fix didn't hold, which
            // deserves the loudest label on the tile (migs 218/219).
            const mem = memoryFor(g, memories);
            const cameBack = !!mem && new Date(g.latest) > new Date(mem.fixed_at);
            return (
              <div key={g.key} className="rp-err">
                <span className="rp-err-bar" style={{ background: cameBack ? "var(--adm-danger)" : color }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                    <b style={{ fontSize: 13.5 }}>{title}</b>
                    {g.count > 1 ? <span className="rp-chip danger">×{g.count}</span> : null}
                    {cameBack ? (
                      <span className="rp-chip danger" title={`Recorded as fixed on ${new Date(mem!.fixed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}${mem!.pr_url ? ` (${mem!.pr_url})` : ""} — it has happened again, so that fix did not hold.`}>
                        <i className="fas fa-rotate-left" aria-hidden="true" style={{ marginRight: 4 }} />came back after the fix
                      </span>
                    ) : null}
                    <span className="rp-panel" style={{ ["--hue" as string]: color, borderColor: color }}>{PANEL_NAME[a.panel] || a.panel}</span>
                    {a.restaurant_name ? <span className="rp-rest"><i className="fas fa-store" aria-hidden="true" style={{ marginRight: 4, opacity: 0.6 }} />{a.restaurant_name}</span> : null}
                    <span className="adm-muted" style={{ fontSize: 11.5 }}>{timeAgo(g.latest)}{a.table_number ? ` · table ${a.table_number}` : ""}</span>
                  </div>
                  {cameBack ? (
                    <div className="adm-muted" style={{ fontSize: 11.5, marginBottom: 4 }}>
                      {`This was marked fixed on ${new Date(mem!.fixed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} and is happening again — the earlier fix didn't hold.`}
                    </div>
                  ) : null}
                  {a.detail ? (
                    // Closed, a gateway failure would put "<!DOCTYPE html> <!--[if lt IE 7]>…" on the
                    // one visible line and bury "502 Bad Gateway" a hundred characters in. Closed
                    // shows the readable line; OPEN still shows the captured text byte for byte.
                    <div className="rp-detail" style={{ maxHeight: isOpen ? 240 : 34 }}>{isOpen ? a.detail : errorHeadline(a.detail)}</div>
                  ) : <div className="adm-muted" style={{ fontSize: 12 }}>No further detail was recorded.</div>}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9, alignItems: "center" }}>
                    {jl ? (
                      <button className="adm-btn primary" style={{ fontSize: 12 }} onClick={() => jumpTo(a)} title="Open that panel for this restaurant to fix it by hand">
                        <i className="fas fa-arrow-up-right-from-square" aria-hidden="true" style={{ marginRight: 6 }} />{jl}
                      </button>
                    ) : null}
                    {wasSent ? (
                      <span className="adm-muted" style={{ fontSize: 12 }} title="This problem is already in the queue below — it will not be sent twice."><i className="fas fa-check" aria-hidden="true" style={{ color: "var(--adm-ok, #4caf82)", marginRight: 5 }} />Sent to Claude</span>
                    ) : (
                      <>
                        <button className="adm-btn" style={{ fontSize: 12 }} onClick={() => sendError(g, "instant")} title="A Claude window opens on the office Mac within a minute">
                          <i className="fas fa-bolt" aria-hidden="true" style={{ marginRight: 6, color: "var(--adm-accent, #e8a13c)" }} />Fix now
                        </button>
                        <button className="adm-btn" style={{ fontSize: 12 }} onClick={() => sendError(g, "overnight")} title="The 2:30 AM robot fixes it and leaves a morning report">
                          <i className="fas fa-moon" aria-hidden="true" style={{ marginRight: 6, opacity: 0.8 }} />Overnight
                        </button>
                      </>
                    )}
                    {a.detail && a.detail.length > 90 ? (
                      <button className="rp-link" onClick={() => setExpanded((p) => { const n = new Set(p); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>{isOpen ? "less" : "more"}</button>
                    ) : null}
                    {/* Resolve — the owner clears it himself (persists; whole ×N group). Two-step
                        are-you-sure so a mis-tap can't wipe a real problem off the board. */}
                    {confirmResolve === g.key ? (
                      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                        <span className="adm-muted">Mark resolved?</span>
                        <button className="adm-btn primary" style={{ fontSize: 12 }} onClick={() => resolveError(g)} title="I've handled this — clear it from the board. If it ever happens again it comes straight back.">
                          <i className="fas fa-check" aria-hidden="true" style={{ marginRight: 5 }} />Yes, resolve
                        </button>
                        <button className="adm-btn" style={{ fontSize: 12 }} onClick={() => setConfirmResolve("")}>Cancel</button>
                      </span>
                    ) : (
                      <button className="adm-btn" style={{ fontSize: 12, marginLeft: "auto" }} disabled={resolving.has(g.key)} onClick={() => setConfirmResolve(g.key)} title="I've handled this — clear it from the board (stays gone after refresh)">
                        <i className="fas fa-circle-check" aria-hidden="true" style={{ marginRight: 6, color: "var(--adm-ok, #4caf82)" }} />{resolving.has(g.key) ? "Resolving…" : "Resolve"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {errors.length >= ERROR_FEED_LIMIT && (
            <p className="adm-muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>
              <i className="fas fa-circle-info" aria-hidden="true" style={{ marginRight: 6, opacity: 0.7 }} />
              Showing the {ERROR_FEED_LIMIT} most recent reports — there may be older unresolved ones below this.
              Resolve some, or read the whole list in Audit &amp; logs.
            </p>
          )}
        </div>
      )}

      {/* ── Already fixed (migs 218/219) ────────────────────────────────────
          A plain record of problems that have been fixed, with the link to the fix. It hides
          NOTHING: if any of these happens again it appears in "Problems right now" above like
          any other error. Its only effect is that pressing Fix now on an OLD report of one
          answers "already fixed on <date>" instead of sending Claude to redo the work. */}
      {memories.length ? (
        <div style={{ marginBottom: 14 }}>
          <button className="rp-link" onClick={() => setShowMemories((v) => !v)} style={{ fontSize: 12.5 }}>
            <i className={`fas fa-chevron-${showMemories ? "down" : "right"}`} aria-hidden="true" style={{ marginRight: 6, fontSize: 10 }} />
            Already fixed ({memories.length}) — for reference; nothing here is hidden from the board
          </button>
          {showMemories ? (
            <div style={{ marginTop: 8 }}>
              {memories.map((m) => (
                <div key={m.id} className="rp-err" style={{ opacity: 0.85 }}>
                  <span className="rp-err-bar" style={{ background: "var(--adm-ok, #4caf82)" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                      <b style={{ fontSize: 13 }}>{actLabel(m.action)}</b>
                      <span className="rp-panel">{PANEL_NAME[m.panel] || m.panel}</span>
                      <span className="rp-rest"><i className="fas fa-store" aria-hidden="true" style={{ marginRight: 4, opacity: 0.6 }} />{m.restaurant}</span>
                      <span className="rp-chip ok">fixed</span>
                      <span className="adm-muted" style={{ fontSize: 11.5 }}>
                        fixed {timeAgo(m.fixed_at)}{m.fixed_by ? ` by ${m.fixed_by === "claude" ? "Claude" : "you"}` : ""}
                      </span>
                    </div>
                    {/* A signature is meant to be short, but rows written before errorSig learned
                        about gateway pages (mig 218) can still hold raw markup — same treatment. */}
                    <div className="rp-detail" style={{ maxHeight: 34 }}>{errorHeadline(m.sig)}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                      {m.pr_url ? (
                        <a className="rp-link" href={m.pr_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>see the fix</a>
                      ) : null}
                      <button className="adm-btn" style={{ fontSize: 12, marginLeft: "auto" }} onClick={() => forgetMemory(m)} title="Forget this record — Fix now will treat that problem as brand new again">
                        <i className="fas fa-eraser" aria-hidden="true" style={{ marginRight: 6, opacity: 0.85 }} />Forget this
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Rate limits reached (mig 205) ──────────────────────────────── */}
      <div className="rp-sec-h" id="rate-limits">
        {/* The icon must glow for what is ON SCREEN. It read `rlHits.length`, so picking one
            restaurant left a red gauge sitting beside the words "No rate limits have been
            reached." — an alarm for rows the admin cannot see (T17 sweep, 2026-08-19). */}
        <i className="fas fa-gauge-high" aria-hidden="true" style={{ color: rlErr ? "var(--adm-warn)" : shownRlHits.length ? "var(--adm-danger)" : "var(--muted)" }} />
        <h2>Rate limits reached</h2>
        {shownRlHits.length ? <span className="rp-chip danger">{shownRlHits.length}</span> : null}
        <span className="adm-muted" style={{ fontSize: 12, marginLeft: 2 }}>someone hit a wall · {scopedName || "all restaurants"}</span>
        <Link href="/aevinite/rate-limits" className="adm-btn" style={{ marginLeft: "auto", fontSize: 12 }}><i className="fas fa-sliders" aria-hidden="true" style={{ marginRight: 6 }} />Manage limits</Link>
      </div>
      {errLoading && shownRlHits.length === 0 ? (
        <div className="adm-empty">Checking…</div>
      ) : rlErr ? (
        <div className="rp-unread">
          <i className="fas fa-triangle-exclamation" aria-hidden="true" />
          <span>{rlErr} — so this is <b>unknown</b>, not clear.</span>
          <button className="adm-btn" style={{ fontSize: 12, marginLeft: "auto" }} onClick={loadHub}>Retry</button>
        </div>
      ) : shownRlHits.length === 0 ? (
        <div className="rp-clear"><i className="fas fa-circle-check" aria-hidden="true" /> No rate limits have been reached{scopedName ? ` at ${scopedName}` : ""}.</div>
      ) : (
        <div style={{ marginBottom: 6 }}>
          {shownRlHits.map((h) => (
            <div key={h.id} className="rp-err">
              <span className="rp-err-bar" style={{ background: "var(--adm-danger)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                  <b style={{ fontSize: 13.5 }}>{rlLabel(h.key)}</b>
                  <span className="rp-chip danger">{h.hit_count} / {h.max_count} per {rlPer(h.window_seconds)}</span>
                  {h.restaurant_name ? <span className="rp-rest"><i className="fas fa-store" aria-hidden="true" style={{ marginRight: 4, opacity: 0.6 }} />{h.restaurant_name}</span> : null}
                  <span className="adm-muted" style={{ fontSize: 11.5 }}>{timeAgo(h.last_at)}</span>
                </div>
                <div className="adm-muted" style={{ fontSize: 12.5 }}>Who: <b style={{ color: "var(--text)" }}>{h.subject_label || h.subject}</b></div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9, alignItems: "center" }}>
                  {h.key === "admin_login" ? (
                    // Admin-login alert: let a genuine person retry (clear the short lockout), or BLOCK the device.
                    <>
                      <button className="adm-btn primary" style={{ fontSize: 12 }} onClick={() => rlClear(h)} title="Genuine person — clear the short lockout so they can try the password again now">
                        <i className="fas fa-unlock" aria-hidden="true" style={{ marginRight: 6 }} />Let them try again
                      </button>
                      <button className="adm-btn danger" style={{ fontSize: 12 }} onClick={() => rlBlock(h)} title="Bar this device/IP from reaching the admin panel">
                        <i className="fas fa-ban" aria-hidden="true" style={{ marginRight: 6 }} />Block this device
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="adm-btn primary" style={{ fontSize: 12 }} onClick={() => rlAllow(h)} title="Real customer — reset their counter so they get through now">
                        <i className="fas fa-unlock" aria-hidden="true" style={{ marginRight: 6 }} />Allow
                      </button>
                      <Link className="adm-btn" style={{ fontSize: 12 }} href={`/aevinite/rate-limits#rule-${h.key}`} title="Change this limit">
                        <i className="fas fa-sliders" aria-hidden="true" style={{ marginRight: 6 }} />Change rate limit
                      </Link>
                      <button className="adm-btn" style={{ fontSize: 12 }} onClick={() => rlFix(h)} title="Hand it to Claude to investigate">
                        <i className="fas fa-robot" aria-hidden="true" style={{ marginRight: 6 }} />Fix
                      </button>
                    </>
                  )}
                  <button className="adm-btn" style={{ fontSize: 12, marginLeft: "auto" }} onClick={() => rlDismiss(h)} title="Clear from the board">Dismiss</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Complaints & issues (staff / owner raised) ─────────────────── */}
      <div className="rp-sec-h" id="complaints">
        <i className="fas fa-flag" aria-hidden="true" style={{ color: openTickets ? "var(--adm-accent, #e8a13c)" : "var(--muted)" }} />
        <h2>Complaints &amp; issues</h2>
        {openTickets ? <span className="rp-chip">{openTickets}</span> : null}
        <span className="adm-muted" style={{ fontSize: 12, marginLeft: 2 }}>raised by staff &amp; owners · {scopedName || "all restaurants"}</span>
        <div style={{ marginLeft: "auto" }}>
          <Dropdown value={ticketFilter} onChange={setTicketFilter} options={TICKET_FILTERS} ariaLabel="Filter complaints" minWidth={124} />
        </div>
      </div>
      {errLoading && issues.length === 0 ? (
        <div className="adm-empty">Loading complaints…</div>
      ) : issuesErr ? (
        <div className="adm-empty">Couldn&rsquo;t load complaints. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={loadHub}>Retry</button></div>
      ) : shownTickets.length === 0 ? (
        <div className="rp-clear"><i className="fas fa-circle-check" aria-hidden="true" /> {ticketFilter === "open" ? "No open complaints right now." : "Nothing here."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 6 }}>
          {shownTickets.map((i) => (
            <TicketCard key={i.id} issue={i} showRestaurant busy={ticketBusy === i.id}
              onOpenRestaurant={(slug) => { router.push(`/aevinite/restaurants?focus=${encodeURIComponent(slug)}`); window.dispatchEvent(new CustomEvent("adm:focus-restaurant", { detail: slug })); }}
              onSetStatus={(id, status) => setTicketStatus(id, status)} />
          ))}
        </div>
      )}

      {/* ── At-risk & onboarding (account health) ──────────────────────── */}
      <div className="rp-sec-h" id="at-risk">
        <i className="fas fa-heart-pulse" aria-hidden="true" style={{ color: attCount ? "var(--adm-danger)" : "var(--muted)" }} />
        <h2>At-risk &amp; onboarding</h2>
        {attCount ? <span className="rp-chip danger">{attCount}</span> : null}
        <span className="adm-muted" style={{ fontSize: 12, marginLeft: 2 }}>{scopedName ? `${scopedName} only` : "restaurants that need a nudge"}</span>
      </div>
      {attErr && (
        <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>Couldn&rsquo;t load account health. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={loadHub}>Retry</button></p>
      )}
      <div className="adm-card">
        <div className="cmd-sec" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>
          <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-danger)" }} aria-hidden="true" />
          Churn risk <span style={{ color: "var(--muted)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· paying but not ordering</span>
        </div>
        {!att ? <div className="adm-empty">{attErr ? "Couldn't load." : "Loading…"}</div> : atRisk.length === 0 ? (
          <div className="adm-empty"><i className="fas fa-circle-check" style={{ color: "var(--adm-ok, #4caf82)", marginRight: 7 }} aria-hidden="true" />Nothing at risk{scopedName ? ` at ${scopedName}` : " — every paying restaurant is ordering"}.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {atRisk.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 0", borderBottom: "var(--border)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--adm-danger)", flex: "0 0 auto" }} aria-hidden="true" />
                <b style={{ fontSize: 14 }}>{r.name}</b>
                {r.plan && <span className="adm-chip" style={{ fontSize: 11 }}>{r.plan}</span>}
                <span className="adm-muted" style={{ fontSize: 12.5 }}>{r.reason}</span>
                <a className="adm-btn" style={{ marginLeft: "auto" }} href={`/aevinite/restaurants?focus=${encodeURIComponent(r.slug)}`}>Manage <i className="fas fa-arrow-right" style={{ fontSize: 10, marginLeft: 4 }} aria-hidden="true" /></a>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="adm-card" style={{ marginTop: 12, marginBottom: 6 }}>
        <div className="cmd-sec" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>
          <i className="fas fa-seedling" style={{ color: "#60a5fa" }} aria-hidden="true" />
          Needs onboarding <span style={{ color: "var(--muted)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· new, no orders yet</span>
        </div>
        {!att ? <div className="adm-empty">{attErr ? "Couldn't load." : "Loading…"}</div> : onboarding.length === 0 ? (
          <div className="adm-empty">{scopedName ? `${scopedName} is not waiting on setup.` : "No stalled new restaurants — recent sign-ups are all ordering."}</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {onboarding.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 0", borderBottom: "var(--border)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: "#60a5fa", flex: "0 0 auto" }} aria-hidden="true" />
                <b style={{ fontSize: 14 }}>{r.name}</b>
                <span className="adm-muted" style={{ fontSize: 12.5 }}>{r.reason}</span>
                <a className="adm-btn" style={{ marginLeft: "auto" }} href={`/aevinite/restaurants?focus=${encodeURIComponent(r.slug)}`}>Set up <i className="fas fa-arrow-right" style={{ fontSize: 10, marginLeft: 4 }} aria-hidden="true" /></a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Report anything else ───────────────────────────────────────── */}
      <div className="rp-sec-h">
        <i className="fas fa-comment-dots" aria-hidden="true" style={{ color: "var(--muted)" }} />
        <h2>Report a problem</h2>
        <span className="adm-muted" style={{ fontSize: 12, marginLeft: 2 }}>for anything the list above didn&rsquo;t catch</span>
      </div>
      <div className="adm-card" style={{ marginBottom: 6 }}>
        <p className="adm-muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: "0 0 10px" }}>
          Describe what&rsquo;s going wrong in your own words — a printer, a button, a wrong total. {rid ? <>Tagged to <b>{scopedName}</b>.</> : <>Pick a restaurant at the top of this page to tag it, or leave it general.</>}
        </p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3}
          placeholder="e.g. The bill button on table 12 does nothing during rush; happens on the waiter tablet."
          style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13.5, resize: "vertical" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          <span className="adm-muted" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 5 }}>
            <i className="fas fa-bolt" aria-hidden="true" style={{ color: "var(--adm-accent, #e8a13c)" }} /> Now = a window on the Mac &nbsp;·&nbsp; <i className="fas fa-moon" aria-hidden="true" style={{ opacity: 0.8 }} /> Overnight = the 2:30 robot
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="adm-btn" disabled={sending} onClick={() => sendDescribed("overnight")} title="The night robot fixes it at 2:30 AM and leaves a morning report">
              <i className="fas fa-moon" aria-hidden="true" style={{ marginRight: 7, opacity: 0.8 }} />{sending ? "Sending…" : "Fix overnight"}
            </button>
            <button className="adm-btn primary" disabled={sending} onClick={() => sendDescribed("instant")} title="A Claude terminal opens on the office Mac within a minute">
              <i className="fas fa-bolt" aria-hidden="true" style={{ marginRight: 7 }} />{sending ? "Sending…" : "Fix NOW on the Mac"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Waiting for Claude ─────────────────────────────────────────── */}
      {requests.length > 0 && (
        <>
          <div className="rp-sec-h">
            <i className="fas fa-robot" aria-hidden="true" style={{ color: "var(--muted)" }} />
            <h2>Waiting for Claude</h2><span className="rp-chip">{requests.length}</span>
          </div>
          <div className="adm-card" style={{ marginBottom: 6 }}>
            {requests.map((q) => (
              <div key={q.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 0", borderBottom: "var(--border)", fontSize: 13 }}>
                <i className={`fas ${q.mode === "overnight" ? "fa-moon" : q.source === "error_row" ? "fa-triangle-exclamation" : "fa-bolt"}`} aria-hidden="true" title={q.mode === "overnight" ? "Waiting for the 2:30 AM robot" : "Instant — pops on the Mac"} style={{ marginTop: 2, opacity: 0.7 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.summary}</div>
                  <div className="adm-muted" style={{ fontSize: 11.5 }}>{new Date(q.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{q.pr_url ? <> · <a href={q.pr_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>fix ready →</a></> : ""}</div>
                </div>
                <button className="adm-btn" onClick={() => dismissRequest(q.id)} title="Dismiss" style={{ fontSize: 11.5, padding: "3px 9px" }}>Dismiss</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Hands-on tools ─────────────────────────────────────────────── */}
      <div className="rp-sec-h">
        <i className="fas fa-screwdriver-wrench" aria-hidden="true" style={{ color: "var(--muted)" }} />
        <h2>Hands-on tools</h2>
        <span className="adm-muted" style={{ fontSize: 12, marginLeft: 2 }}>fix a table or order yourself</span>
      </div>
      {/* The picker moved to the top of the page (see the note there); this says which restaurant
          the tools below will act on, so the section is never ambiguous about its target. */}
      <div className="adm-card" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <i className="fas fa-store" aria-hidden="true" style={{ opacity: 0.7 }} />
        <span style={{ flex: 1, fontSize: 13 }}>
          {rid ? <>These tools will act on <b>{scopedName}</b>.</> : <span className="adm-muted">Choose a restaurant at the top of this page to unlock the table &amp; order tools.</span>}
        </span>
        {rid && <button className="adm-btn" onClick={load}><i className="fas fa-rotate-right" aria-hidden="true" style={{ marginRight: 6 }} />Reload its tables</button>}
      </div>

      {!rid ? (
        <div className="adm-empty">Choose a restaurant at the top of the page to unlock its table &amp; order tools.</div>
      ) : dataErr ? (
        <div className="adm-empty">Couldn&rsquo;t load that restaurant. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></div>
      ) : data === null ? (
        <div className="adm-empty">Loading…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginBottom: 14 }}>
            {TOOLS.map((t) => (
              <button key={t.op} className="adm-card" onClick={() => setTool(t.op)}
                style={{ textAlign: "left", cursor: "pointer", border: t.danger ? "1px solid color-mix(in srgb, var(--adm-danger) 45%, transparent)" : undefined }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <i className={`fas ${t.icon}`} aria-hidden="true" style={{ fontSize: 18, color: t.danger ? "var(--adm-danger)" : "var(--adm-accent, #e8a13c)" }} />
                  <b>{t.label}</b>
                </div>
                <div className="adm-muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{t.desc}</div>
              </button>
            ))}
          </div>

          <div className="adm-card" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 14 }}>Other quick levers</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link className="adm-btn" href={`/aevinite/restaurants?focus=${rid}`}><i className="fas fa-toggle-on" aria-hidden="true" /> Feature switches</Link>
              <Link className="adm-btn" href="/aevinite/settings"><i className="fas fa-triangle-exclamation" aria-hidden="true" /> Maintenance mode</Link>
              <Link className="adm-btn" href={`/aevinite/logs?restaurant_id=${rid}`}><i className="fas fa-scroll" aria-hidden="true" /> Full activity log</Link>
            </div>
          </div>
        </>
      )}

      {/* ── Claude session history ─────────────────────────────────────── */}
      {runs.length > 0 && (
        <>
          <div className="rp-sec-h">
            <i className="fas fa-clock-rotate-left" aria-hidden="true" style={{ color: "var(--muted)" }} />
            <h2>Claude session history</h2><span className="rp-chip">{runs.length}</span>
          </div>
          <div className="adm-card" style={{ marginBottom: 8 }}>
            {runs.map((s) => {
              const mins = s.ended_at ? Math.max(1, Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000)) : null;
              const kindLabel = s.kind === "live" ? "LIVE" : s.kind === "nightly" ? "NIGHT" : "AUDIT";
              const statusInfo: Record<AgentRun["status"], { label: string; color: string }> = {
                running: { label: "working…", color: "var(--adm-accent, #e8a13c)" },
                done: { label: "finished", color: "var(--adm-ok, #4caf82)" },
                closed: { label: "window closed", color: "var(--muted)" },   // --adm-muted-fg was never declared, so this was always #9aa = 2.42:1 on the light console
                failed: { label: "failed", color: "var(--adm-danger)" },
              };
              const st = statusInfo[s.status];
              const isOpen = openRun === s.id;
              return (
                <div key={s.id} style={{ padding: "9px 0", borderBottom: "var(--border)", fontSize: 13 }}>
                  <button onClick={() => setOpenRun(isOpen ? "" : s.id)} aria-expanded={isOpen}
                    style={{ display: "flex", gap: 10, alignItems: "flex-start", width: "100%", background: "none", border: "none", padding: 0, color: "inherit", font: "inherit", textAlign: "left", cursor: s.report ? "pointer" : "default", minHeight: 40 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: "2px 6px", borderRadius: 5, marginTop: 1, background: "color-mix(in srgb, var(--adm-accent, #e8a13c) 18%, transparent)", color: "var(--adm-accent, #e8a13c)" }}>{kindLabel}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {/* A run started before readableError() landed carries the whole gateway page
                          as its TITLE, so this one line read "<!DOCTYPE html> <!--[if lt IE 7]>…".
                          Same treatment as the problem rows: a title is a label, never the
                          evidence — the full report is still printed verbatim below. */}
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{errorHeadline(s.title)}</span>
                      <span className="adm-muted" style={{ fontSize: 11.5 }}>
                        {new Date(s.started_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        {mins !== null ? <> · {mins} min</> : null} · <span style={{ color: st.color }}>{st.label}</span>
                        {s.report ? <> · {isOpen ? "hide" : "read what it did"}</> : null}
                      </span>
                    </span>
                    {s.report ? <i className={`fas fa-chevron-${isOpen ? "up" : "down"}`} aria-hidden="true" style={{ marginTop: 4, opacity: 0.5, fontSize: 11 }} /> : null}
                  </button>
                  {isOpen && s.report ? (
                    <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, lineHeight: 1.55, margin: "8px 0 0", padding: "10px 12px", borderRadius: 8, background: "color-mix(in srgb, var(--card) 60%, transparent)", border: "var(--border)", maxHeight: 320, overflowY: "auto", fontFamily: "inherit" }}>{s.report}</pre>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}

      {tool && data && (
        <RepairModal op={tool} rid={rid} scopeName={scopedName} data={data}
          onClose={() => setTool(null)}
          onDone={(msg) => { setTool(null); toast(msg); load(); }}
          onError={(msg) => toast(msg, "err")} />
      )}

      <style>{`
        .rp-strip{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 4px}
        .rp-pill{display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:12px;border:var(--border);background:var(--card);font-size:12.5px;color:var(--muted);text-decoration:none;transition:filter .14s,border-color .14s}
        a.rp-pill:hover{filter:brightness(1.06)}
        .rp-pill .n{font-size:18px;font-weight:800;color:var(--text)}
        .rp-pill.alert{background:color-mix(in srgb,var(--adm-danger) 13%,var(--card));border-color:color-mix(in srgb,var(--adm-danger) 45%,transparent);color:var(--adm-danger)}
        .rp-pill.alert .n{color:var(--adm-danger)}
        .rp-pill.warn{background:color-mix(in srgb,var(--adm-accent,#e8a13c) 12%,var(--card));border-color:color-mix(in srgb,var(--adm-accent,#e8a13c) 45%,transparent);color:var(--adm-accent,#e8a13c)}
        .rp-pill.warn .n{color:var(--adm-accent,#e8a13c)}
        .rp-pill.ok{border-color:color-mix(in srgb,var(--adm-ok,#4caf82) 40%,transparent)}
        .rp-sec-h{display:flex;align-items:center;gap:9px;margin:24px 0 11px;flex-wrap:wrap}
        .rp-sec-h h2{margin:0;font-size:16px}
        /* A SECTION HEADING MUST NOT PUSH ITS OWN CONTROL OFF THE SCREEN (T20 sweep, 2026-08-16).
           At 360px the "Complaints & issues" heading wrapped to two lines, its caption ("raised by
           staff & owners · all restaurants") took a third, and the filter beside them — pinned
           right with margin-left:auto — ended 18px past the edge of the content column. The column
           does not scroll sideways, so the control was CUT OFF, not merely off-view; the same
           happened to the "Manage limits" button. Letting the row wrap and forbidding any child
           from out-growing it is the whole fix. */
        .rp-sec-h > *{min-width:0;max-width:100%}
        @media (max-width: 620px){
          .rp-sec-h{gap:6px}
          /* On a phone the control drops onto its own line, full width, instead of being squeezed
             against the right edge. */
          .rp-sec-h > :last-child{margin-left:0!important;flex:1 1 100%}
        }
        /* The page-level restaurant picker: never wider than the column it sits in. */
        .rp-pick{max-width:100%;min-width:0}
        .rp-pick select{max-width:100%;min-width:0}
        .rp-chip{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--adm-accent,#e8a13c) 16%,transparent);color:var(--adm-accent,#e8a13c)}
        .rp-chip.danger{background:color-mix(in srgb,var(--adm-danger) 16%,transparent);color:var(--adm-danger)}
        .rp-clear{display:flex;align-items:center;gap:9px;padding:16px;border-radius:12px;border:1px solid color-mix(in srgb,var(--adm-ok,#4caf82) 35%,transparent);background:color-mix(in srgb,var(--adm-ok,#4caf82) 8%,var(--card));color:var(--text);font-size:13.5px}
        .rp-clear i{color:var(--adm-ok,#4caf82)}
        /* "I couldn't read this" — deliberately NOT the green all-clear and NOT the red alarm.
           Nothing is known to be wrong; the page simply could not ask. */
        .rp-unread{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:14px 16px;border-radius:12px;border:1px solid color-mix(in srgb,var(--adm-warn) 40%,transparent);background:color-mix(in srgb,var(--adm-warn) 8%,var(--card));color:var(--text);font-size:13.5px;margin-bottom:10px}
        .rp-unread i{color:var(--adm-warn)}
        .rp-unread > span{flex:1 1 200px;min-width:0}
        .rp-err{position:relative;display:flex;gap:12px;padding:13px 14px 13px 16px;border-radius:12px;border:var(--border);background:var(--card);margin-bottom:10px;overflow:hidden}
        .rp-err-bar{position:absolute;left:0;top:0;bottom:0;width:3px}
        .rp-panel{font-size:10.5px;font-weight:700;letter-spacing:.3px;padding:1px 7px;border-radius:6px;border:1px solid;background:transparent;text-transform:uppercase}
        .rp-rest{font-size:11.5px;color:var(--muted)}
        .rp-detail{font-size:12px;line-height:1.5;color:var(--muted);white-space:pre-wrap;word-break:break-word;overflow:hidden;transition:max-height .18s ease;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
        .rp-link{background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;padding:0 2px}
        .rp-x{margin-left:auto;background:none;border:none;color:var(--muted);opacity:.5;cursor:pointer;font-size:13px;padding:2px 6px;border-radius:6px}
        .rp-x:hover{opacity:1;background:color-mix(in srgb,var(--text) 8%,transparent)}
      `}</style>
    </>
  );
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}
// Convert a UTC ISO to the value a <input type="datetime-local"> expects. Uses the browser's
// local zone (the admin is on IST), which is the same zone new Date(inputValue) parses back in —
// so the round-trip is consistent.
function toLocalInput(iso: string) {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ""; }
}

function RepairModal({ op, rid, scopeName, data, onClose, onDone, onError }: {
  op: Op; rid: string; scopeName: string | null; data: RepairData;
  onClose: () => void; onDone: (msg: string) => void; onError: (msg: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useAdminModal(ref, `admin-repair-${op}`, onClose);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [targetId, setTargetId] = useState("");
  const [cancelOld, setCancelOld] = useState(true);
  const [when, setWhen] = useState("");

  const meta = TOOLS.find((t) => t.op === op)!;

  // Which targets this op offers.
  const invoicedSessions = data.sessions.filter((s) => s.invoice_no && !s.invoice_voided);
  const openSessions = data.sessions; // GET already returns only open/pending
  const orders = data.orders;

  // When an order is chosen for edit_time, prefill its current time.
  const onPickOrder = (id: string) => {
    setTargetId(id);
    if (op === "edit_time") {
      const o = orders.find((x) => x.id === id);
      if (o) setWhen(toLocalInput(o.created_at));
    }
  };

  const submit = async () => {
    if (!reason.trim()) { onError("Please type a reason."); return; }
    const payload: Record<string, unknown> = { op, restaurant_id: rid, reason: reason.trim() };
    if (op === "void_bill" || op === "unstick_table") {
      if (!targetId) { onError("Pick a table."); return; }
      payload.session_id = targetId;
    } else {
      if (!targetId) { onError("Pick an order."); return; }
      payload.order_id = targetId;
    }
    if (op === "refire_order") payload.cancel_old = cancelOld;
    if (op === "edit_time") {
      if (!when) { onError("Pick a date and time."); return; }
      const d = new Date(when); // parsed in the admin's local zone (IST)
      if (isNaN(d.getTime())) { onError("That date looks wrong."); return; }
      payload.created_at = d.toISOString();
    }
    setBusy(true);
    try {
      const r = await adminFetch<{ ok: boolean; kot_no?: number }>("/api/admin/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-LFH-Action-Id": uuid() },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        onDone(op === "refire_order" && r.data.kot_no ? `Re-fired — new KOT #${r.data.kot_no}.` : "Done.");
      } else {
        onError(r.error || "Couldn't do that just now.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000 }} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={meta.label} style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div className="adm-card" style={{ pointerEvents: "auto", width: "min(94vw, 500px)" }}>
          <h2 style={{ margin: "0 0 4px" }}>{meta.label}</h2>
          <p className="adm-muted" style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 14px" }}>{meta.desc}{scopeName ? <> · <b>{scopeName}</b></> : null}</p>

          {/* Target picker */}
          {op === "void_bill" ? (
            <Field label="Bill (invoiced tables)">
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="rp-select">
                <option value="">Choose a table…</option>
                {invoicedSessions.map((s) => <option key={s.id} value={s.id}>Table {s.table_number} · invoice #{s.invoice_no}</option>)}
              </select>
              {invoicedSessions.length === 0 && <Hint>No invoiced bills open right now.</Hint>}
            </Field>
          ) : op === "unstick_table" ? (
            <Field label="Table (open / pending)">
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="rp-select">
                <option value="">Choose a table…</option>
                {openSessions.map((s) => <option key={s.id} value={s.id}>Table {s.table_number} · {s.status}{s.invoice_no ? ` · invoice #${s.invoice_no}` : ""}</option>)}
              </select>
              {openSessions.length === 0 && <Hint>No open or pending tables right now.</Hint>}
            </Field>
          ) : (
            <Field label="Order">
              <select value={targetId} onChange={(e) => onPickOrder(e.target.value)} className="rp-select">
                <option value="">Choose an order…</option>
                {orders.map((o) => <option key={o.id} value={o.id}>Table {o.table_number} · KOT {o.kot_no ?? "—"} · {o.status} · {fmtTime(o.created_at)}</option>)}
              </select>
              {orders.length === 0 && <Hint>No recent orders for this restaurant.</Hint>}
            </Field>
          )}

          {op === "refire_order" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, margin: "2px 0 12px", cursor: "pointer" }}>
              <input type="checkbox" checked={cancelOld} onChange={(e) => setCancelOld(e.target.checked)} />
              Cancel the original broken order after re-firing
            </label>
          )}

          {op === "edit_time" && (
            <Field label="New date & time (your local time)">
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="rp-select" />
              <Hint>Moving an order past 5 AM shifts it to another day&rsquo;s reports.</Hint>
            </Field>
          )}

          {/* Reason — required on every op */}
          <Field label="Reason (required — this is saved to the log)">
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. printer jammed, KOT never reached kitchen" className="rp-select" />
          </Field>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 6 }}>
            <button className="adm-btn" disabled={busy} onClick={onClose}>Cancel</button>
            <button className={`adm-btn ${meta.danger ? "danger" : "primary"}`} disabled={busy} onClick={submit}>{busy ? "Working…" : meta.label}</button>
          </div>
        </div>
      </div>
      <style>{`.rp-select{width:100%;padding:8px 10px;border-radius:8px;border:var(--border);background:var(--card);color:var(--text);font-size:13.5px}`}</style>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 5, color: "var(--muted)" }}>{label}</div>
      {children}
    </div>
  );
}
function Hint({ children }: { children: React.ReactNode }) {
  return <div className="adm-muted" style={{ fontSize: 11.5, marginTop: 5 }}>{children}</div>;
}
