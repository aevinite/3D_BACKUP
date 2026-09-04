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
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/admin/toast";
import { useAdminModal } from "@/components/admin/useAdminModal";
import { adminFetch } from "@/lib/adminFetch";
import Dropdown from "@/components/admin/Dropdown";
import TicketCard, { type TicketLike } from "@/components/admin/TicketCard";
import { openRestaurantPanel, PANEL_COLOR, actLabel, timeAgo, useActiveAutoRefresh, type Action } from "@/components/admin/shared";
import { errorSig, errorGroupKey, errorHeadline } from "@/lib/errorSignature";
// Every error LINE on this board reads as English; the exact text stays one tap away, because it
// is what Fix now hands Claude (owner, 2026-09-02). Run TITLES above still use errorHeadline —
// a title is not an error message, and putting it through the translator would wrap a perfectly
// good "Owner panel nightly audit" in "the app reported this in its own words".
import { plainHeadline, plainProblem, RATE_LABELS } from "@/lib/plainError";
// An alert / lever lands on the control that ends the problem (owner, 2026-09-02).
import { jumpUrl } from "@/lib/adminJump";

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
// ── A LIMIT WITH NO NUMBERS MUST NOT PRINT ZERO ONES (item 1, 2026-09-04) ────────────────────────
// Not every wall on this board has an editable ceiling. The ADMIN password wall deliberately has
// none — the Rate limits page says so in its own words and refuses to offer it as a rule row — so
// `rate_limit_events` carries `max_count: 0, window_seconds: 0` for those hits. The chip printed
// them straight through, and `rlPer(0)` answers "0h" because 0 divides by 3600 cleanly, so the one
// live alert on this platform read:
//
//     Admin login    3 / 0 per 0h
//
// which is not a smaller number than the real one, it is a meaningless one — the same class as a
// NaN or an [object Object] reaching a person's screen. A hit with no configured ceiling now states
// the only fact it actually has: how many attempts there were.
const rlChip = (h: { hit_count: number; max_count: number; window_seconds: number }) =>
  h.max_count > 0 && h.window_seconds > 0
    ? `${h.hit_count} / ${h.max_count} per ${rlPer(h.window_seconds)}`
    : `${h.hit_count} attempt${h.hit_count === 1 ? "" : "s"}`;

type Op = "void_bill" | "delete_order" | "refire_order" | "unstick_table" | "edit_time";

const TICKET_FILTERS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

const uuid = () => (crypto as { randomUUID?: () => string }).randomUUID?.() || String(Date.now()) + Math.random();

// How long "Remind me later" waits. Hours, because that is what the server takes (mig 344) — the
// labels are what a person reads. Kept short and few: a list of ten durations is a decision, and
// this control exists to be pressed without thinking about it.
const LATER_CHOICES: { hours: number; label: string; long: string }[] = [
  { hours: 4, label: "in 4 hours", long: "Back in 4 hours" },
  { hours: 24, label: "tomorrow", long: "Back tomorrow" },
  { hours: 24 * 7, label: "next week", long: "Back next week" },
];

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

// ── WHY A "NIGHT" JOB CAN CARRY A DAYTIME CLOCK ──────────────────────────────────────────────────
//
// Owner, 2026-09-02: "why night audit is going on in afternoon".
//
// It is not scheduled in the afternoon. The three LaunchAgents on the Mac are set to 02:30
// (nightly repair), 04:00 (tablet audit) and 06:00 (owner audit) IST, and twelve days of launchd
// logs show every run starting within a couple of minutes of those times — with ONE exception,
// 1 Sept, where the repair run and the owner audit both started at 09:27am in the same second.
//
// That is macOS, not the app. launchd runs a job it MISSED as soon as the machine next wakes, so a
// night with the lid shut produces a "nightly" run stamped whenever he opened the laptop. Two jobs
// missing the same night therefore fire together, which is exactly the 09:27 pair.
//
// The second cause is longer runs: an audit that starts at 06:00 and takes three and a half hours
// (24 Aug did: 06:03 → 09:34) is genuinely still working late in the morning, and the row only
// ever showed the START, so it read as a 6am job either way.
//
// So the row now says which of the two it is, in plain words. NOTHING IS PREVENTED: a catch-up run
// is still a real audit and still worth having, and refusing it would mean no audit at all on the
// days he sleeps with the lid closed. This is the label that was missing, not a new rule.
//
// THE WINDOW is 00:00–07:59 local. It is deliberately wider than the latest schedule (06:00): a
// run that starts at 06:00 and takes an hour is a normal night run, and calling that "late" would
// put a warning on most rows — which is how a warning stops being read (the same lesson the
// System health page learned twice; see its "quiet panels" and "complaints" notes).
const NIGHT_WINDOW_END_HOUR = 8;
/** The scheduled hour of each night job, for the "it was due at…" half of the sentence. */
const SCHEDULED: Record<string, string> = { nightly: "2:30 am", audit: "6:00 am" };
// ── ONE CLOCK ON THE WHOLE ROW (item 9, 2026-09-04) ─────────────────────────────────────────────
// Everything else on this board prints its time with an explicit `timeZone: "Asia/Kolkata"` — the
// restaurants' own clock, deliberately not the laptop's, so the console reads the same wherever it
// is opened. This function did neither: it decided whether a run was "late" from `getHours()` and
// printed its two times with no zone, both of which follow whatever the machine happens to be set
// to. On the office Mac (IST) the answers agree, so nothing is wrong on his screen today. Opened
// anywhere else the row would print "02:30 am" from the line above and "Started 22:00, not
// overnight" from this one — two clocks, one row, and the second contradicting the first.
// So the zone is stated here too, and the hour that decides "late" is read in the SAME zone as the
// sentence that reports it.
const IST = "Asia/Kolkata";
const istTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: IST, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const istClock = (d: Date) => d.toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit" });
/** The hour (0–23) and the calendar day, read in the restaurants' own zone rather than the laptop's. */
function istParts(d: Date): { hour: number; day: string } {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", hour12: false, day: "2-digit", month: "2-digit", year: "numeric" });
  const parts = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { hour: Number(parts.hour), day: `${parts.year}-${parts.month}-${parts.day}` };
}
function lateNightRun(s: AgentRun): string {
  if (s.kind === "live") return "";       // a live fix is started by hand, whenever he asks for it
  const start = new Date(s.started_at);
  const startIst = istParts(start);
  const due = SCHEDULED[s.kind] || "the night";
  if (startIst.hour >= NIGHT_WINDOW_END_HOUR) {
    return `Started ${istClock(start)}, not overnight — it was due at ${due} and the Mac was asleep, so macOS ran it when you next woke it.`;
  }
  // Started on time, but was it still going once the day began? Only worth saying when it really
  // ran past the window — a 40-minute 6am audit is not news.
  if (s.ended_at) {
    const end = new Date(s.ended_at);
    const endIst = istParts(end);
    if (endIst.hour >= NIGHT_WINDOW_END_HOUR && endIst.day === startIst.day) {
      return `Started on time but ran until ${istClock(end)} — so it was still working during the morning.`;
    }
  } else if (s.status === "running" && Date.now() - start.getTime() > 2 * 3600_000) {
    return "Started overnight and is STILL running — over two hours. It may be stuck.";
  }
  return "";
}

export default function AdminRepair() {
  const toast = useToast();
  // ?focus=<restaurant id> — the restaurant this board should open on. Sent by the "Fix now"
  // button on Audit & logs (owner, 2026-09-02), so arriving here keeps the restaurant he was
  // already filtered to instead of resetting to all nine. Read from the URL on the FIRST render
  // via useState's initialiser rather than in an effect: an effect runs after the first paint, so
  // the board would flash every restaurant's problems and then narrow — and the ONE thing an
  // admin must not misread on this screen is whose problem he is looking at. Validated as a uuid;
  // anything else is ignored, so a hand-typed or stale link falls back to "every restaurant"
  // rather than filtering to a restaurant that does not exist and showing an empty board.
  //
  // Read with useSearchParams, NOT off `window`. A `typeof window === "undefined"` branch inside a
  // render makes the server and the client disagree, and React does not patch an attribute
  // mismatch — its exact words are "This won't be patched up." The sibling reader on
  // app/aevinite/logs/page.tsx did precisely that and shipped a screen whose filter strip said
  // "All" over a list of nothing but errors (found in the browser, 2026-09-02). Here it would have
  // been the restaurant picker: narrowed data under a picker reading "All restaurants".
  const search = useSearchParams();
  const [rid, setRid] = useState(() => {
    const f = search.get("focus") || "";
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(f) ? f : "";
  });
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
  // ── THE "ALL" ACTIONS (owner, 2026-08-20) ───────────────────────────────────────────────────
  // "there should be a resolved all option. Also there should be fixed all option. Also, like all
  // option should be for everything." Nineteen tiles, eight of them the same three manager faults,
  // and every one needing its own two-step Resolve is how a board stops being read.
  //
  // `bulk` names the one bulk action in flight (so its own button says what it is doing and the
  // others stay put); `confirmBulk` is the are-you-sure step, which every one of these gets —
  // clearing a whole board on a mis-tap is worse than clearing one tile on a mis-tap.
  const [bulk, setBulk] = useState<"" | "resolve" | "later" | "claude" | "limits" | "tickets" | "memories">("");
  const [confirmBulk, setConfirmBulk] = useState<"" | "resolve" | "later" | "claude" | "limits" | "tickets" | "memories">("");
  const [bulkNote, setBulkNote] = useState(""); // progress while N requests go out, e.g. "7 of 19"
  // Which tile's "Later ▾" menu is open, and how many problems are currently waiting out of sight.
  // The COUNT matters as much as the feature: a wait that isn't stated is just a quieter mute.
  const [laterFor, setLaterFor] = useState("");
  const [waiting, setWaiting] = useState<number | null>(null);
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
  // ── ONE NAME FOR ONE LIMIT (item 11, 2026-09-04) ─────────────────────────────────────────────
  // The rule row wins, because that is the name the admin edits on the Rate limits page. Behind it
  // sits RATE_LABELS in lib/plainError.ts — that file’s own header calls it "THE ONE LIST", and
  // the phone alert and the diary line both read it. This screen did not: it fell back to
  // prettifying the raw key, which is a SECOND opinion about the same name and exactly the drift
  // the list exists to prevent. It only bites a key with no rule row — `admin_login` is one,
  // deliberately, because the admin password wall has no editable numbers — and today the two
  // answers happen to agree ("Admin login"), so nothing on screen changes. The next key added
  // without a rule row is where a guess and a name diverge. The prettifier stays last, so an
  // unknown key is still never printed raw.
  const rlLabel = (key: string) =>
    rlRules.find((r) => r.key === key)?.label
    || RATE_LABELS[key]
    || key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

  useEffect(() => {
    (async () => {
      const r = await adminFetch<{ restaurants: Restaurant[] }>("/api/admin/restaurants");
      if (!r.ok) return;
      const list = r.data.restaurants || [];
      setRestaurants(list);
      // A ?focus= id that names no restaurant this admin can see (a stale bookmark, a restaurant
      // since removed) falls back to "every restaurant". Otherwise the picker would sit blank and
      // the board would draw an empty, all-clear-looking page for a restaurant that isn't there —
      // and an empty board on this screen reads as "nothing is wrong", which is the one wrong
      // thing it can say.
      setRid((cur) => (cur && !list.some((x) => x.id === cur) ? "" : cur));
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
      adminFetch<{ actions: Action[]; waiting: number | null }>(`/api/admin/oplog?level=error&limit=${ERROR_FEED_LIMIT}&unresolved=1`),
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
    if (e.ok) { setErrors(e.data.actions || []); setWaiting(e.data.waiting ?? null); } else { failed.push("problems"); setWaiting(null); }
    if (q.ok) setRequests(q.data.requests || []); else failed.push("the Claude queue");
    if (h.ok) setRuns(h.data.runs || []); else failed.push("Claude's history");
    // THE STRIP HAS TO FAIL THE WAY THE SECTIONS DO (T17 sweep #7, 2026-08-27). These two were the
    // only feeds whose failure never reached the counts at the top: with the complaints list
    // unreachable the pill read a confident "0 open complaints", and "need attention" sat on the
    // still-loading "…" for ever — two inches from the "problems open" pill, which correctly said
    // "—". Watched happen with both routes made to fail. Same rule as every other feed here: a
    // failed read is not an all-clear, and it is named in the line under the strip.
    if (iss.ok) { setIssues(iss.data.issues || []); setIssuesErr(false); } else { setIssuesErr(true); failed.push("complaints"); }
    if (at.ok) { setAtt(at.data); setAttErr(false); } else { setAttErr(true); failed.push("account health"); }
    if (rl.ok) { setRlHits(rl.data.events || []); setRlRules(rl.data.rules || []); } else failed.push("rate limits");
    if (mem.ok) setMemories(mem.data.memories || []); else failed.push("the already-fixed record");
    setProblemsErr(e.ok ? "" : (e.error || "Couldn't load the problem list."));
    setRlErr(rl.ok ? "" : (rl.error || "Couldn't load the rate-limit alerts."));
    setFeedsFailed(failed);
    setErrLoading(false);
  }, []);
  useEffect(() => { loadHub(); }, [loadHub]);

  // ── "REMIND ME LATER" HAS TO ACTUALLY COME BACK (item 19, owner 2026-09-04) ──────────────────
  //
  // His words: "I do solve later. So after four hours, it doesn't show. So make sure of that thing."
  //
  // The SERVER was right all along, and it was worth proving before changing anything: with one
  // report's wait moved into the past on the dev database, /api/admin/oplog?unresolved=1 hands it
  // straight back, stops counting it as waiting, and the row was restored to exactly what it was.
  // Hidden while waiting ✓, counted while waiting ✓, comes back once passed ✓.
  //
  // What was missing is that NOTHING ON THIS PAGE EVER ASKED AGAIN. The board is deliberately
  // click-to-refresh — no polling at all — so the one screen that honours a wait was also the one
  // screen that could not notice it ending. Press "in 4 hours", leave the tab open, and four hours
  // later you are looking at a four-hour-old answer: the problem IS back, and the board still says
  // "All clear". The feature's whole promise is "it comes back by itself", and on a board left open
  // that promise was false.
  //
  // ── WHY THIS IS ONE REQUEST AND NOT SEVEN ───────────────────────────────────────────────────
  // loadHub() fires SEVEN feeds. Putting that on a timer to answer one question would be exactly
  // the whole-board refetch this project's cost rules exist to prevent. Only ONE feed can change
  // because a wait expired — the problems feed — and the waiting COUNT rides on that same answer,
  // so the line under the strip stays right too. Everything else (the queue, the history,
  // complaints, account health, limits, the fixed record) still moves only on arrival or on the
  // Refresh button, which is unchanged and still re-pulls all seven.
  //
  // 120s, not 60: the waits are four hours, a day and a week, so being two minutes late is
  // nothing, and the shared helper is visible-only + idle-aware + jittered + wake-on-return — a
  // board nobody is looking at costs zero, and coming back to a parked tab refreshes at once.
  const loadProblems = useCallback(async () => {
    const e = await adminFetch<{ actions: Action[]; waiting: number | null }>(`/api/admin/oplog?level=error&limit=${ERROR_FEED_LIMIT}&unresolved=1`);
    if (e.ok) {
      setErrors(e.data.actions || []);
      setWaiting(e.data.waiting ?? null);
      setProblemsErr("");
      // Only THIS feed's name may be added or cleared here. A quiet background refresh must never
      // erase the fact that another feed failed on the last full load.
      setFeedsFailed((prev) => prev.filter((x) => x !== "problems"));
    } else {
      setWaiting(null);
      setProblemsErr(e.error || "Couldn't load the problem list.");
      setFeedsFailed((prev) => (prev.includes("problems") ? prev : [...prev, "problems"]));
    }
  }, []);
  useActiveAutoRefresh(loadProblems, 120000);

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

  // ── "Remind me later" — the third answer this board never had (mig 344) ──────────────────────
  // The only two used to be "mark it resolved" — which writes a record saying you handled something
  // you have not, and tells Fix-now the problem is already fixed — or leave it red for ever, which
  // is how four fortnight-old tiles teach you to stop looking. A wait leaves the problem OPEN: it
  // comes back by itself, the full Audit & logs list never stopped showing it, and a fresh
  // occurrence writes a fresh row that carries no wait at all.
  const snoozeError = async (g: ErrGroup, hours: number, label: string) => {
    setLaterFor("");
    setResolving((prev) => new Set(prev).add(g.key));
    setErrors((prev) => prev.filter((a) => errorGroupKey(a) !== g.key));
    const r = await adminFetch<{ ok: boolean; snoozed?: number }>("/api/admin/resolve-error", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action_id: g.sample.id, snooze_hours: hours }),
    });
    setResolving((prev) => { const n = new Set(prev); n.delete(g.key); return n; });
    if (r.ok) toast(`Back on the board ${label} — still open, just not now.`);
    else toast(r.error || "Couldn't set that reminder.", "err");
    loadHub();
  };

  // ── EVERY "ALL" ACTION ──────────────────────────────────────────────────────────────────────
  // All of them are scoped exactly the way the page is: the restaurant picker at the top narrows
  // what you can SEE, so it must narrow what "all" MEANS — a button that quietly acts on nine
  // restaurants under a banner reading "Showing French House only" is the fault this page was
  // already fixed for once.
  const resolveAllProblems = async () => {
    setConfirmBulk(""); setBulk("resolve");
    const r = await adminFetch<{ ok: boolean; resolved: number }>("/api/admin/resolve-error", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true, ...(rid ? { restaurant_id: rid } : {}) }),
    });
    setBulk("");
    if (r.ok) toast(`Cleared ${r.data.resolved} report${r.data.resolved === 1 ? "" : "s"} from the board. Anything that happens again comes straight back.`);
    else toast(r.error || "Couldn't clear the board.", "err");
    loadHub();
  };

  const snoozeAllProblems = async (hours: number, label: string) => {
    setConfirmBulk(""); setBulk("later");
    const r = await adminFetch<{ ok: boolean; snoozed: number }>("/api/admin/resolve-error", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true, snooze_hours: hours, ...(rid ? { restaurant_id: rid } : {}) }),
    });
    setBulk("");
    if (r.ok) toast(`${r.data.snoozed} report${r.data.snoozed === 1 ? "" : "s"} will be back ${label}. None of them is marked fixed.`);
    else toast(r.error || "Couldn't set those reminders.", "err");
    loadHub();
  };

  // "Fix all" is OVERNIGHT, and says so on the button. `instant` opens a Claude window on the Mac
  // per request — nineteen tiles would be nineteen windows, which is not a feature. The 2:30 robot
  // takes a whole queue in one run and leaves one morning report, which is what a bulk send means.
  // One request per problem GROUP, three at a time: each carries its own error context and its own
  // err_key, so the queue can still match a ticket to its tile (mig 183) and a re-press cannot file
  // a duplicate. Anything already queued is skipped rather than sent twice.
  const sendAllToClaude = async () => {
    setConfirmBulk(""); setBulk("claude");
    const todo = groups.filter((g) => !alreadyQueued(g));
    let done = 0, failedN = 0;
    setBulkNote(`0 of ${todo.length}`);
    // Mark them all as sent up front so the buttons settle immediately; a failure below un-marks.
    setSent((prev) => { const n = new Set(prev); todo.forEach((g) => n.add(g.key)); return n; });
    const queue = [...todo];
    const worker = async () => {
      for (;;) {
        const g = queue.shift();
        if (!g) return;
        const r = await adminFetch<{ ok: boolean }>("/api/admin/fix-request", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-LFH-Action-Id": uuid() },
          body: JSON.stringify({ action_id: g.sample.id, restaurant_id: g.sample.restaurant_id || null, mode: "overnight" }),
        });
        if (r.ok) done++;
        else { failedN++; setSent((prev) => { const n = new Set(prev); n.delete(g.key); return n; }); }
        setBulkNote(`${done + failedN} of ${todo.length}`);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setBulk(""); setBulkNote("");
    toast(failedN
      ? `Queued ${done} for the 2:30 AM robot — ${failedN} wouldn't send. Try those again.`
      : `Queued ${done} problem${done === 1 ? "" : "s"} for the 2:30 AM robot. It leaves one report in the morning.`,
      failedN ? "err" : undefined);
    loadHub();
  };

  // Clear every limit-reached ALERT on screen. Dismiss only — no limit is changed, nobody is let
  // through and nobody is blocked; those three decide something about one person and are
  // deliberately not offered in bulk (see the server note next to `dismiss_all`).
  const dismissAllLimits = async () => {
    setConfirmBulk(""); setBulk("limits");
    const r = await adminFetch<{ ok: boolean; dismissed: number }>("/api/admin/rate-limits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss_all", ...(rid ? { restaurant_id: rid } : {}) }),
    });
    setBulk("");
    if (r.ok) toast(`Cleared ${r.data.dismissed} alert${r.data.dismissed === 1 ? "" : "s"}. No limit changed.`);
    else toast(r.error || "Couldn't clear those alerts.", "err");
    loadHub();
  };

  // Resolve every OPEN complaint on screen. One request each on purpose: the endpoint checks the
  // restaurant for every row and writes its own audit line per complaint, which is exactly the
  // record you want later — a single bulk line would say "resolved 9" and name none of them.
  const resolveAllTickets = async () => {
    setConfirmBulk(""); setBulk("tickets");
    const todo = scopedIssues.filter((i) => i.status === "open");
    let done = 0, failedN = 0;
    setBulkNote(`0 of ${todo.length}`);
    setIssues((prev) => prev.map((i) => (todo.some((t) => t.id === i.id) ? { ...i, status: "resolved" } : i)));
    const queue = [...todo];
    const worker = async () => {
      for (;;) {
        const it = queue.shift();
        if (!it) return;
        const r = await adminFetch<{ ok: boolean }>("/api/owner/issues?scope=all", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: it.id, status: "resolved" }),
        });
        if (r.ok) done++; else failedN++;
        setBulkNote(`${done + failedN} of ${todo.length}`);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setBulk(""); setBulkNote("");
    toast(failedN ? `Resolved ${done} — ${failedN} wouldn't save.` : `Resolved ${done} complaint${done === 1 ? "" : "s"}.`, failedN ? "err" : undefined);
    loadHub();
  };

  // Forget a record, so Fix-now treats that problem as brand new again. (It was never hiding
  // anything — the record only answers "already fixed" when you press Fix-now on an old report.)
  // FORGET ALL (owner, 2026-08-21 — "do it", after asking what it meant). The bulk twin of "Forget
  // this". Worth stating what it costs, because the first reason I gave for withholding it was
  // wrong: it does NOT throw away links to fixes (no record on this platform has one — they were all
  // written by pressing Resolve). What it does cost is the red "came back after the fix" badge on a
  // recurrence, which is the only thing that says a problem is a REPEAT and an earlier fix did not
  // hold. So the confirm says that, in those words, instead of a bare "are you sure?".
  const forgetAllMemories = async () => {
    setConfirmBulk(""); setBulk("memories");
    const r = await adminFetch<{ ok: boolean; forgotten: number }>(
      `/api/admin/error-memory?all=1${rid ? `&restaurant_id=${rid}` : ""}`, { method: "DELETE" });
    setBulk("");
    if (r.ok) toast(`Forgot ${r.data.forgotten} record${r.data.forgotten === 1 ? "" : "s"}. Nothing was hidden or deleted from the board — Fix now will just look at those problems afresh.`);
    else toast(r.error || "Couldn't clear those records.", "err");
    loadHub();
  };

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
      // The SAME sentence the chip shows (item 1) — a ticket that says "3 in 0h" describes a
      // limit that does not exist, and it is the one line Claude reads first.
      body: JSON.stringify({ note: `Rate limit "${h.key}" reached by ${h.subject_label || h.subject}${h.restaurant_name ? ` at ${h.restaurant_name}` : ""} (${rlChip(h)}). Is this real abuse or is the limit too tight?`, restaurant_id: h.restaurant_id !== "00000000-0000-0000-0000-000000000000" ? h.restaurant_id : null, mode: "overnight" }),
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
  // ── AND THE "ALREADY FIXED" LIST TOO (T17 sweep #7, 2026-08-27) ─────────────────────────────
  // This list was the last thing on the page the picker did not reach. With one restaurant chosen
  // it still showed every restaurant's records, its heading counted all of them and said they were
  // "for <that restaurant>", and "Forget all" — which sends the restaurant id — then forgot only
  // that restaurant's and reported a smaller number than the line above it claimed. The DELETE
  // route's own note says the button "can never clear more than the list it sits under shows";
  // this is what makes that true. Same set as the server's scope: this restaurant's records plus
  // the platform-wide ones that also cover it. A client filter over rows already in hand — no
  // extra request, so choosing a restaurant still fires nothing.
  const scopedMemories = rid ? memories.filter((m) => m.restaurant_id === rid || m.restaurant_id === null) : memories;
  const atRisk = (att?.atRisk || []).filter((r) => !rid || r.id === rid);
  const onboarding = (att?.onboarding || []).filter((r) => !rid || r.id === rid);
  const attCount = atRisk.length + onboarding.length;

  const scopedName = restaurants.find((r) => r.id === rid)?.name || null;
  // ── EVERY BULK CONFIRM SAYS WHOSE (owner, 2026-08-27) ────────────────────────────────────────
  // The buttons were already scoped correctly — the picker narrows what you SEE and every "all"
  // request carries the same restaurant, or none. What they did not do was SAY so at the moment
  // it matters: the confirm read "Mark all 6 as handled?" whether that meant one restaurant or
  // nine. The lead sentence above the row says it, but a confirm is the last thing you read
  // before it happens, and it should not make you look up to check.
  const scopePhrase = scopedName ? `at ${scopedName}` : "across every restaurant";
  // ONE RESTAURANT PICKER FOR THE WHOLE PAGE (owner, 2026-08-16). It already existed, but only to
  // unlock the hands-on tools at the bottom — so choosing a restaurant appeared to do nothing to
  // the thing you were actually reading. A client rings about THEIR restaurant; there are nine on
  // this stack and the board was one flat list. It now narrows the problems and the limit hits too
  // (both act on rows already fetched — no extra request, no extra data).
  const groups = groupErrors(rid ? errors.filter((a) => (a.restaurant_id || "") === rid) : errors);
  // ── WHAT THE PICKER IS HOLDING BACK (item 15, owner 2026-09-04) ─────────────────────────────
  // Measured on this platform: 24 of the 27 open reports carry NO restaurant at all — they are
  // platform-wide crashes, and hiding them under a one-restaurant view is correct, because they
  // genuinely are not that restaurant's. What was not correct was going GREEN and saying nothing:
  // "All clear — no unresolved problems at Demo Bistro" is true, and it is also not the whole
  // picture when two dozen reports are sitting one control away.
  // The queue section below has done this properly for a while ("2 more are queued at other
  // restaurants"); this is the problem board learning the same manners. A count over rows already
  // in hand — no extra request, so choosing a restaurant still fires nothing.
  const hiddenByPicker = rid ? groupErrors(errors).length - groups.length : 0;
  const shownRlHits = rid ? rlHits.filter((h) => h.restaurant_id === rid) : rlHits;
  // A problem already handed to Claude must not offer "Fix now" again after a refresh (T20 sweep,
  // 2026-08-16). `sent` is only this page-load's memory, so a reload re-offered the button and a
  // second press filed a SECOND open ticket for the same error. `err_key` exists for exactly this
  // (mig 183) and nothing was reading it — and the server built it with a different formula from
  // the tile's own group key, so even a reader would not have matched. Both sides now use
  // errorGroupKey(), so the queue and the board describe a problem the same way.
  // ── AND THE QUEUE (T17 sweep #7, 2026-08-27) ────────────────────────────────────────────────
  // The last list on this page the picker did not reach. A ticket carries the restaurant it was
  // filed for, so choosing one narrows the queue like everything else — and, unlike the other
  // lists, what is left out is SAID rather than silently dropped: a queue is work in flight, and
  // "there are two more, at other restaurants" is the thing you would want to know before
  // assuming nothing is being worked on. A ticket filed with no restaurant (a platform-wide
  // report from the box below) belongs to the all-restaurants view only, which is the same rule
  // the problem board follows.
  const scopedRequests = rid ? requests.filter((q) => q.restaurant_id === rid) : requests;
  const requestsElsewhere = requests.length - scopedRequests.length;
  // NOTE: `queuedKeys` deliberately stays UNSCOPED. It answers "has this problem already been
  // sent?", and the answer is yes whichever restaurant is on screen — scoping it would re-offer
  // "Fix now" for a ticket that already exists and file it a second time.
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
        {/* "—", never a reassuring 0 and never an eternal "…", when the feed behind the number did
            not arrive — the same rule the two pills above already follow. */}
        <a className={`rp-pill${!issuesErr && openTickets ? " warn" : ""}`} href="#complaints"
          title={issuesErr ? "The complaints list didn't load — this is not an all-clear" : "Jump to complaints"}>
          <i className={`fas ${issuesErr ? "fa-circle-question" : "fa-flag"}`} aria-hidden="true" /><span className="n">{errLoading ? "…" : issuesErr ? "—" : openTickets}</span><span>open complaint{openTickets === 1 && !issuesErr ? "" : "s"}</span>
        </a>
        <a className={`rp-pill${!attErr && attCount ? " warn" : ""}`} href="#at-risk"
          title={attErr ? "Account health didn't load — this is not an all-clear" : "Jump to at-risk restaurants"}>
          <i className={`fas ${attErr ? "fa-circle-question" : "fa-heart-pulse"}`} aria-hidden="true" /><span className="n">{attErr ? "—" : att ? attCount : "…"}</span><span>need{!attErr && att && attCount === 1 ? "s" : ""} attention</span>
        </a>
        <div className="rp-pill" title={requestsElsewhere > 0 ? `${requestsElsewhere} more ${requestsElsewhere === 1 ? "is" : "are"} queued at other restaurants` : undefined}>
          <i className="fas fa-robot" aria-hidden="true" /><span className="n">{scopedRequests.length}</span><span>waiting for Claude</span>
          {requestsElsewhere > 0 ? <span style={{ opacity: 0.75 }}>· +{requestsElsewhere} elsewhere</span> : null}
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

      {/* ── The board's "all" row (owner, 2026-08-20) ────────────────────────────────────────────
          Three answers for the whole board, the same three each tile has. Every one asks first —
          on a mis-tap, one tile is a nuisance and nineteen is a lost afternoon — and every one is
          scoped by the picker above, so the button can never act on nine restaurants under a
          banner that says one. */}
      {!errLoading && !problemsErr && groups.length > 0 && (
        <div className="rp-bulk">
          <i className="fas fa-layer-group" aria-hidden="true" style={{ opacity: 0.65 }} />
          <span className="rp-bulk-lead">
            All {groups.length} problem{groups.length === 1 ? "" : "s"}{scopedName ? <> at <b>{scopedName}</b></> : " on this board"} at once:
          </span>

          {confirmBulk === "resolve" ? (
            <span className="rp-bulk-ask">
              {/* ── AND THE ONES THAT ARE WAITING (item 8, 2026-09-04) ──────────────────────────
                  "Resolve all" sends { all: true } and the server clears every unresolved error
                  report in scope — INCLUDING the ones set to come back later, which are not on
                  this board and are counted a few lines up as "still open, not fixed". So the
                  confirm promised 10, the toast afterwards reported a larger number, and a problem
                  he had deliberately PARKED came back marked handled.
                  The button is not changed: clearing a whole board after a fix landed is exactly
                  what it is for, and quietly skipping the parked ones would be its own surprise.
                  What it did not do was SAY so at the moment it matters — the same rule the scope
                  phrase in this very sentence was added for. `waiting` is the server’s own
                  platform-wide count, so it is worded the way the line above words it. */}
              <span>
                Mark all {groups.length} {scopePhrase} as handled?
                {waiting ? ` That also clears ${waiting} report${waiting === 1 ? "" : "s"} set to come back later${scopedName ? " (across all restaurants)" : ""}.` : ""}
              </span>
              <button className="adm-btn primary" onClick={resolveAllProblems}>Yes, clear the board</button>
              <button className="adm-btn" onClick={() => setConfirmBulk("")}>Cancel</button>
            </span>
          ) : confirmBulk === "claude" ? (
            <span className="rp-bulk-ask">
              <span>Send all {groups.filter((g) => !alreadyQueued(g)).length} {scopePhrase} to the 2:30 AM robot?</span>
              <button className="adm-btn primary" onClick={sendAllToClaude}>Yes, queue them</button>
              <button className="adm-btn" onClick={() => setConfirmBulk("")}>Cancel</button>
            </span>
          ) : confirmBulk === "later" ? (
            <span className="rp-bulk-ask">
              <span>Bring all {groups.length} {scopePhrase} back…</span>
              {LATER_CHOICES.map((c) => (
                <button key={c.hours} className="adm-btn" onClick={() => snoozeAllProblems(c.hours, c.label)}>{c.label}</button>
              ))}
              <button className="adm-btn" onClick={() => setConfirmBulk("")}>Cancel</button>
            </span>
          ) : (
            <span className="rp-bulk-btns">
              <button className="adm-btn" disabled={!!bulk} onClick={() => setConfirmBulk("resolve")}
                title={`Clear every problem ${scopePhrase}. I've handled all of these — anything that happens again comes straight back.`}>
                <i className="fas fa-circle-check" aria-hidden="true" style={{ marginRight: 6, color: "var(--adm-ok, #4caf82)" }} />
                {bulk === "resolve" ? "Clearing…" : "Resolve all"}
              </button>
              <button className="adm-btn" disabled={!!bulk || groups.every((g) => alreadyQueued(g))} onClick={() => setConfirmBulk("claude")}
                title="Queue every one of these for the 2:30 AM robot — it takes the whole list in one run and leaves one morning report. Not 'now': instant opens a Claude window per problem.">
                <i className="fas fa-moon" aria-hidden="true" style={{ marginRight: 6, opacity: 0.8 }} />
                {bulk === "claude" ? `Sending ${bulkNote}…` : "Fix all overnight"}
              </button>
              <button className="adm-btn" disabled={!!bulk} onClick={() => setConfirmBulk("later")}
                title="Not now — hide them until later, then show them again. Nothing is marked fixed.">
                <i className="fas fa-clock" aria-hidden="true" style={{ marginRight: 6, opacity: 0.8 }} />
                {bulk === "later" ? "Setting…" : "Remind me later"}
              </button>
            </span>
          )}
        </div>
      )}

      {/* A WAIT THAT ISN'T STATED IS JUST A QUIETER MUTE. Snoozed problems leave the board and the
          console's red count, so the number of them has to be on screen — otherwise "3 problems
          open" stops meaning "3 problems exist", which is the exact fault the capped-list line
          further down was added for. `null` = we couldn't read the count, so we say nothing. */}
      {!errLoading && !problemsErr && !!waiting && (
        <p className="adm-muted" style={{ fontSize: 12.5, margin: "0 0 10px", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <i className="fas fa-clock" aria-hidden="true" style={{ opacity: 0.7 }} />
          {/* THE PICKER HAS TO MEAN THIS SENTENCE TOO (T17 sweep #7, 2026-08-27). The board asks for
              its problems unscoped and narrows them here, so the server's waiting COUNT is always
              platform-wide — and this line printed it verbatim under the banner reading "Showing My
              Little French House only.". Measured: 8 shown, 7 actually French House's. Scoping the
              request would cost an extra round-trip on every pick, which this page deliberately
              does not do, so the number stays honest by saying whose it is. */}
          <span>
            <b style={{ color: "var(--text)" }}>{waiting}</b> report{waiting === 1 ? "" : "s"}{scopedName ? " across all restaurants" : ""}{waiting === 1 ? " is" : " are"} set to come back later — still open, not fixed, and
            listed in <Link href="/aevinite/logs" style={{ color: "var(--accent)" }}>Audit &amp; logs</Link> the whole time.
            {/* SAY THAT THE BOARD WATCHES FOR IT (item 19). The sentence promised the tile would
                come back by itself, and until now nothing on this page ever asked again — so on a
                tab left open it never did. It does now, so the promise is worth printing. */}
            {" "}This page checks for {waiting === 1 ? "it" : "them"} every couple of minutes while you&rsquo;re here.
          </span>
        </p>
      )}

      {errLoading ? (
        <div className="adm-empty">Checking for problems…</div>
      ) : problemsErr ? (
        <div className="rp-unread">
          <i className="fas fa-triangle-exclamation" aria-hidden="true" />
          <span>{problemsErr} — so this is <b>unknown</b>, not clear.</span>
          <button className="adm-btn" style={{ fontSize: 12, marginLeft: "auto" }} onClick={loadHub}>Retry</button>
        </div>
      ) : groups.length === 0 ? (
        <div className="rp-clear" style={{ display: "block" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <i className="fas fa-circle-check" aria-hidden="true" /> All clear — no unresolved problems{scopedName ? ` at ${scopedName}` : ""}.
          </div>
          {/* A GREEN BOARD MUST NOT BE THE WHOLE STORY WHEN IT IS ONLY PART OF IT (item 15). */}
          {hiddenByPicker > 0 && (
            <div className="adm-muted" style={{ fontSize: 12.5, marginTop: 8, paddingLeft: 26, lineHeight: 1.55 }}>
              {hiddenByPicker} other problem{hiddenByPicker === 1 ? " is" : "s are"} open, none of them tied to a restaurant — they are platform-wide.{" "}
              <button className="rp-link" onClick={() => setRid("")}>Show every restaurant</button>
            </div>
          )}
        </div>
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
                    {a.restaurant_name ? <span className="rp-rest"><i className="fas fa-store" aria-hidden="true" style={{ marginRight: 5, fontSize: 9.5 }} />{a.restaurant_name}</span> : null}
                    <span className="adm-muted" style={{ fontSize: 11.5 }}>{timeAgo(g.latest)}{a.table_number ? ` · table ${a.table_number}` : ""}</span>
                  </div>
                  {cameBack ? (
                    <div className="adm-muted" style={{ fontSize: 11.5, marginBottom: 4 }}>
                      {`This was marked fixed on ${new Date(mem!.fixed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} and is happening again — the earlier fix didn't hold.`}
                    </div>
                  ) : null}
                  {a.detail ? (
                    // CLOSED = the plain sentence, one line: what a person would have experienced,
                    // where, on which browser (owner, 2026-09-02 — "it should be in the human
                    // language"). It used to print the browser's own words, so the one visible line
                    // read "Failed to execute 'removeChild' on 'Node'…", and a gateway failure put
                    // "<!DOCTYPE html> <!--[if lt IE 7]>…" there and buried "502 Bad Gateway" a
                    // hundred characters in.
                    //
                    // OPEN = the plain sentence AND the captured text byte for byte. The exact text
                    // is what Fix now hands Claude and what the ×N grouping is computed from, so it
                    // stays one tap away and unaltered — the plain line is added above it, never
                    // instead of it.
                    <div className="rp-detail" style={{ maxHeight: isOpen ? 240 : 34 }}>
                      {plainHeadline(a.detail)}
                      {isOpen && plainProblem(a.detail).translated ? (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(148,163,184,0.16)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5, opacity: 0.72, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {a.detail}
                        </div>
                      ) : null}
                    </div>
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
                      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {/* NOT NOW, WITHOUT LYING ABOUT IT (mig 344). Resolve says "I handled this"
                            and writes a record that tells Fix-now the problem is fixed; leaving it
                            red for a fortnight is how a board stops being read. This is the third
                            answer: the tile goes away and comes back by itself, still open. */}
                        {laterFor === g.key ? (
                          <>
                            <span className="adm-muted" style={{ fontSize: 12 }}>Back…</span>
                            {LATER_CHOICES.map((c) => (
                              <button key={c.hours} className="adm-btn" style={{ fontSize: 12 }} onClick={() => snoozeError(g, c.hours, c.label)}>{c.label}</button>
                            ))}
                            <button className="adm-btn" style={{ fontSize: 12 }} onClick={() => setLaterFor("")}>Cancel</button>
                          </>
                        ) : (
                          <button className="adm-btn" style={{ fontSize: 12 }} disabled={resolving.has(g.key)} onClick={() => setLaterFor(g.key)}
                            title="Not now — hide this until later, then show it again. It stays OPEN and nothing is marked fixed.">
                            <i className="fas fa-clock" aria-hidden="true" style={{ marginRight: 6, opacity: 0.8 }} />Later
                          </button>
                        )}
                        <button className="adm-btn" style={{ fontSize: 12 }} disabled={resolving.has(g.key)} onClick={() => setConfirmResolve(g.key)} title="I've handled this — clear it from the board (stays gone after refresh)">
                          <i className="fas fa-circle-check" aria-hidden="true" style={{ marginRight: 6, color: "var(--adm-ok, #4caf82)" }} />{resolving.has(g.key) ? "Resolving…" : "Resolve"}
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {/* Not only on an empty board: with two tiles shown and twenty-four hidden, "2" is just
              as misleading as "0". Same sentence, under the list (item 15). */}
          {hiddenByPicker > 0 && (
            <p className="adm-muted" style={{ fontSize: 12.5, margin: "2px 0 8px", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              <i className="fas fa-filter" aria-hidden="true" style={{ opacity: 0.7 }} />
              <span>
                {hiddenByPicker} more problem{hiddenByPicker === 1 ? " is" : "s are"} open but tied to no restaurant, so {hiddenByPicker === 1 ? "it is" : "they are"} not shown here.{" "}
                <button className="rp-link" onClick={() => setRid("")}>Show every restaurant</button>
              </span>
            </p>
          )}
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
      {scopedMemories.length ? (
        <div style={{ marginBottom: 14 }}>
          <button className="rp-link" onClick={() => setShowMemories((v) => !v)} style={{ fontSize: 12.5 }}>
            <i className={`fas fa-chevron-${showMemories ? "down" : "right"}`} aria-hidden="true" style={{ marginRight: 6, fontSize: 10 }} />
            Already fixed ({scopedMemories.length}) — for reference; nothing here is hidden from the board
          </button>
          {showMemories ? (
            <div style={{ marginTop: 8 }}>
              {/* The "all" for this list too (owner, 2026-08-21). It sits INSIDE the fold, not on the
                  collapsed line: you should have read what you are forgetting before you forget it. */}
              <div className="rp-bulk" style={{ marginBottom: 10 }}>
                <i className="fas fa-eraser" aria-hidden="true" style={{ opacity: 0.65 }} />
                <span className="rp-bulk-lead">
                  All {scopedMemories.length} record{scopedMemories.length === 1 ? "" : "s"}{scopedName ? <> for <b>{scopedName}</b></> : ""} at once:
                </span>
                {confirmBulk === "memories" ? (
                  <span className="rp-bulk-ask">
                    <span>Forget all {scopedMemories.length} records {scopePhrase}?</span>
                    <button className="adm-btn primary" onClick={forgetAllMemories}>Yes, forget them</button>
                    <button className="adm-btn" onClick={() => setConfirmBulk("")}>Cancel</button>
                  </span>
                ) : (
                  <button className="adm-btn" disabled={!!bulk} onClick={() => setConfirmBulk("memories")}
                    title="Forget every record here. Nothing is hidden and no problem is deleted — Fix now will simply look at these afresh, and a recurrence will stop being labelled 'came back after the fix'.">
                    <i className="fas fa-eraser" aria-hidden="true" style={{ marginRight: 6, opacity: 0.85 }} />
                    {bulk === "memories" ? "Forgetting…" : "Forget all"}
                  </button>
                )}
              </div>
              {/* What it costs, said once, above the list — not buried in a tooltip. */}
              {confirmBulk === "memories" && (
                <p className="adm-muted" style={{ fontSize: 12.5, lineHeight: 1.55, margin: "-2px 0 10px" }}>
                  <i className="fas fa-circle-info" aria-hidden="true" style={{ marginRight: 6, opacity: 0.7 }} />
                  No problem is hidden or deleted by this — anything that happens again lands on the board as normal.
                  Two things change: <b>Fix now</b> will send Claude to look at these problems again instead of answering
                  &ldquo;already fixed&rdquo;, and a recurrence will no longer wear the red <b>came back after the fix</b> badge
                  that says an earlier fix didn&rsquo;t hold.
                </p>
              )}
              {scopedMemories.map((m) => (
                <div key={m.id} className="rp-err" style={{ opacity: 0.85 }}>
                  <span className="rp-err-bar" style={{ background: "var(--adm-ok, #4caf82)" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                      <b style={{ fontSize: 13 }}>{actLabel(m.action)}</b>
                      <span className="rp-panel">{PANEL_NAME[m.panel] || m.panel}</span>
                      <span className="rp-rest"><i className="fas fa-store" aria-hidden="true" style={{ marginRight: 5, fontSize: 9.5 }} />{m.restaurant}</span>
                      <span className="rp-chip ok">fixed</span>
                      <span className="adm-muted" style={{ fontSize: 11.5 }}>
                        fixed {timeAgo(m.fixed_at)}{m.fixed_by ? ` by ${m.fixed_by === "claude" ? "Claude" : "you"}` : ""}
                      </span>
                    </div>
                    {/* A signature is meant to be short, but rows written before errorSig learned
                        about gateway pages (mig 218) can still hold raw markup — same treatment.
                        Said in plain English like every other error line (owner, 2026-09-02): a
                        FIXED row is exactly where a machine sentence is least useful, because the
                        thing it describes is already dealt with. */}
                    <div className="rp-detail" style={{ maxHeight: 34 }}>{plainHeadline(m.sig)}</div>
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
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* DISMISS ALL, and only dismiss. It clears ALERTS — no limit is changed, nobody is let
              through, nobody is blocked. Those three each decide something about one person, and a
              one-tap "do it to everyone" is how a limit stops protecting anything. */}
          {shownRlHits.length > 0 && (confirmBulk === "limits" ? (
            <span className="rp-bulk-ask">
              <span>Clear all {shownRlHits.length} alerts {scopePhrase}?</span>
              <button className="adm-btn primary" style={{ fontSize: 12 }} onClick={dismissAllLimits}>Yes, clear</button>
              <button className="adm-btn" style={{ fontSize: 12 }} onClick={() => setConfirmBulk("")}>Cancel</button>
            </span>
          ) : (
            <button className="adm-btn" style={{ fontSize: 12 }} disabled={!!bulk} onClick={() => setConfirmBulk("limits")}
              title="Clear every one of these alerts. No limit is changed and nobody is let through or blocked.">
              <i className="fas fa-broom" aria-hidden="true" style={{ marginRight: 6, opacity: 0.8 }} />{bulk === "limits" ? "Clearing…" : "Dismiss all"}
            </button>
          ))}
          <Link href="/aevinite/rate-limits" className="adm-btn" style={{ fontSize: 12 }}><i className="fas fa-sliders" aria-hidden="true" style={{ marginRight: 6 }} />Manage limits</Link>
        </span>
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
                  <span className="rp-chip danger">{rlChip(h)}</span>
                  {h.restaurant_name ? <span className="rp-rest"><i className="fas fa-store" aria-hidden="true" style={{ marginRight: 5, fontSize: 9.5 }} />{h.restaurant_name}</span> : null}
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
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {openTickets > 0 && (confirmBulk === "tickets" ? (
            <span className="rp-bulk-ask">
              <span>Resolve all {openTickets} complaints {scopePhrase}?</span>
              <button className="adm-btn primary" style={{ fontSize: 12 }} onClick={resolveAllTickets}>Yes, resolve</button>
              <button className="adm-btn" style={{ fontSize: 12 }} onClick={() => setConfirmBulk("")}>Cancel</button>
            </span>
          ) : (
            <button className="adm-btn" style={{ fontSize: 12 }} disabled={!!bulk} onClick={() => setConfirmBulk("tickets")}
              title="Mark every open complaint here as resolved. Each one is recorded separately, so the log still names them.">
              <i className="fas fa-circle-check" aria-hidden="true" style={{ marginRight: 6, color: "var(--adm-ok, #4caf82)" }} />
              {bulk === "tickets" ? `Resolving ${bulkNote}…` : "Resolve all"}
            </button>
          ))}
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
        {/* fontFamily: "inherit" — a <textarea> falls back to the browser's monospace unless it is
            told otherwise, and every other input on this console is the console's own face. So the
            one box on the page where he types a SENTENCE ("the bill button on table 12 does
            nothing during rush") was the only thing on the screen dressed as a code editor, right
            under a hint asking for his own words. Measured: computed font-family was "monospace"
            while the page was Inter (item 5, 2026-09-04). */}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3}
          placeholder="e.g. The bill button on table 12 does nothing during rush; happens on the waiter tablet."
          style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.5, resize: "vertical" }} />
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
      {(scopedRequests.length > 0 || requestsElsewhere > 0) && (
        <>
          <div className="rp-sec-h">
            <i className="fas fa-robot" aria-hidden="true" style={{ color: "var(--muted)" }} />
            <h2>Waiting for Claude</h2>
            {scopedRequests.length ? <span className="rp-chip">{scopedRequests.length}</span> : null}
            <span className="adm-muted" style={{ fontSize: 12, marginLeft: 2 }}>{scopedName || "all restaurants"}</span>
          </div>
          {/* WHAT IS LEFT OUT IS SAID, not silently dropped. Everywhere else on this page a
              narrowed list simply shows less; a QUEUE is different, because "nothing is waiting"
              is a conclusion you would act on. */}
          {requestsElsewhere > 0 && (
            <p className="adm-muted" style={{ fontSize: 12.5, margin: "-4px 0 8px" }}>
              <i className="fas fa-circle-info" aria-hidden="true" style={{ marginRight: 6, opacity: 0.7 }} />
              {requestsElsewhere} more {requestsElsewhere === 1 ? "is" : "are"} queued at other restaurants.{" "}
              <button className="rp-link" onClick={() => setRid("")}>Show every restaurant</button>
            </p>
          )}
          {scopedRequests.length === 0 ? (
            <div className="adm-empty">Nothing is queued for {scopedName}.</div>
          ) : (
          <div className="adm-card" style={{ marginBottom: 6 }}>
            {scopedRequests.map((q) => (
              <div key={q.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 0", borderBottom: "var(--border)", fontSize: 13 }}>
                <i className={`fas ${q.mode === "overnight" ? "fa-moon" : q.source === "error_row" ? "fa-triangle-exclamation" : "fa-bolt"}`} aria-hidden="true" title={q.mode === "overnight" ? "Waiting for the 2:30 AM robot" : "Instant — pops on the Mac"} style={{ marginTop: 2, opacity: 0.7 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.summary}</div>
                  <div className="adm-muted" style={{ fontSize: 11.5 }}>{istTime(q.created_at)}{q.pr_url ? <> · <a href={q.pr_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>fix ready →</a></> : ""}</div>
                </div>
                <button className="adm-btn" onClick={() => dismissRequest(q.id)} title="Dismiss" style={{ fontSize: 11.5, padding: "3px 9px" }}>Dismiss</button>
              </div>
            ))}
          </div>
          )}
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

      {/* THE SAME SENTENCE, TWICE, ONE UNDER THE OTHER (item 7, 2026-09-04). The scope card above
          already says "Choose a restaurant at the top of this page to unlock the table & order
          tools." — and this empty state said it again in almost the same words, so the section
          opened by telling him the same thing twice and reading like a stutter. The card is the
          one that stays: it is the row that also names the chosen restaurant once there IS one,
          so it can never be blank. */}
      {!rid ? null : dataErr ? (
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
              {/* THIS LEVER WENT NOWHERE USEFUL (found 2026-09-02, making every alert land on its
                  control). It pointed at /aevinite/settings — and maintenance stopped living there
                  when it became per-restaurant (audit 2026-07-08). All that page has now is a
                  read-only row saying "Guest-menu maintenance · per restaurant", so the button
                  named the setting and then took him to a sentence telling him it was somewhere
                  else. A restaurant is already chosen here (these levers only render once one is),
                  so it goes to THAT restaurant's switch and rings it. */}
              <Link className="adm-btn" href={jumpUrl({ path: "/aevinite/restaurants", restaurantId: rid, section: "status", control: "maintenance" })}><i className="fas fa-triangle-exclamation" aria-hidden="true" /> Maintenance mode</Link>
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
          {/* ── HOW THE SCHEDULED RUNS ARE ACTUALLY DOING ────────────────────────────────────────
              Found 2026-09-02 while answering "why is the night audit running in the afternoon":
              the owner audit had FAILED on 8 of its last 12 nights, and nothing anywhere said so.
              Every row carried its own red "failed", which is the same fault as a list of nine
              restaurants with no total — you can only see it by reading and counting, and nobody
              reads a history list to audit its own reliability.

              A pattern, not a single run: one failure overnight is normal (the dev server did not
              come up, the port was busy). Half of them failing means the scheduled job is broken
              and every night since has been wasted. Drawn only when it IS a pattern, so a healthy
              stretch adds nothing to the page. */}
          {(() => {
            const scheduled = runs.filter((r) => r.kind !== "live");
            const recent = scheduled.slice(0, 12);
            const failedRuns = recent.filter((r) => r.status === "failed");
            const failed = failedRuns.length;
            if (recent.length < 4 || failed * 2 < recent.length) return null;
            // ── DON'T SEND HIM TO A DOOR THAT ISN'T THERE (item 2, 2026-09-04) ──────────────────
            // This ended with "Open any red row below and read what it did to see where it
            // stopped." Measured on this platform: 7 of the last 12 failed and SIX of those seven
            // saved no report at all — a run that dies before it can write one is exactly the run
            // that fails, so the emptiest rows are the ones this sentence points at. Following the
            // instruction meant pressing six rows that answered with nothing.
            //
            // So the sentence now says which half is readable. When none of them is, it says that
            // plainly instead of naming a control that does not exist — the same rule as every
            // other alert on this board: name the door, or say there isn't one.
            const withReport = failedRuns.filter((r) => r.report).length;
            return (
              <div className="adm-card" style={{ marginBottom: 8, borderColor: "var(--adm-warn)", background: "color-mix(in srgb, var(--adm-warn) 8%, var(--card))" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, lineHeight: 1.55 }}>
                  <i className="fas fa-triangle-exclamation" aria-hidden="true" style={{ color: "var(--adm-warn)", marginTop: 2 }} />
                  <div>
                    <b>{failed} of the last {recent.length} scheduled runs failed.</b>{" "}
                    <span className="adm-muted">
                      These are the overnight jobs on your Mac. When they fail, nothing looked at the
                      app that night — so problems that would have been found and fixed are still
                      there.{" "}
                      {withReport === 0
                        ? "None of them saved a report, which usually means the run died before it could start — the jobs themselves are what need a look."
                        : withReport === failed
                        ? "Open any red row below and read what it did to see where it stopped."
                        : `${withReport} of the ${failed} saved a report — open ${withReport === 1 ? "that one" : "those"} to see where it stopped. The rest died before they could write one.`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}
          <div className="adm-card" style={{ marginBottom: 8 }}>
            {runs.map((s) => {
              const mins = s.ended_at ? Math.max(1, Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000)) : null;
              const kindLabel = s.kind === "live" ? "LIVE" : s.kind === "nightly" ? "NIGHT" : "AUDIT";
              const late = lateNightRun(s);
              const statusInfo: Record<AgentRun["status"], { label: string; color: string }> = {
                running: { label: "working…", color: "var(--adm-accent, #e8a13c)" },
                done: { label: "finished", color: "var(--adm-ok, #4caf82)" },
                closed: { label: "window closed", color: "var(--muted)" },   // --adm-muted-fg was never declared, so this was always #9aa = 2.42:1 on the light console
                failed: { label: "failed", color: "var(--adm-danger)" },
              };
              const st = statusInfo[s.status];
              const isOpen = openRun === s.id;
              // ── A ROW WITH NOTHING TO OPEN IS NOT A BUTTON (item 3, 2026-09-04) ──────────────
              // Every row in this list was a real <button> that set `openRun` and announced
              // `aria-expanded`, whether or not there was a report to expand. On this platform that
              // is 22 of the 30 rows: pressing one moved state, changed nothing on screen, and told
              // a screen reader the row had just expanded — into nothing. It is the "a tap never
              // vanishes" rule in its quietest form: the tap did not fail, it succeeded at doing
              // nothing, and there is no way to tell that apart from a broken button.
              //
              // A row that CAN open is exactly what it was. A row that cannot is plain markup and
              // says so, which is the one thing the old row never did — and it is the row the
              // failure banner above points at, because a run that dies early is the run that
              // saves no report.
              const rowBody = (
                <>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: "2px 6px", borderRadius: 5, marginTop: 1, background: "color-mix(in srgb, var(--adm-accent, #e8a13c) 18%, transparent)", color: "var(--adm-accent, #e8a13c)" }}>{kindLabel}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {/* A run started before readableError() landed carries the whole gateway page
                        as its TITLE, so this one line read "<!DOCTYPE html> <!--[if lt IE 7]>…".
                        Same treatment as the problem rows: a title is a label, never the
                        evidence — the full report is still printed verbatim below. */}
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{errorHeadline(s.title)}</span>
                    <span className="adm-muted" style={{ fontSize: 11.5 }}>
                      {istTime(s.started_at)}
                      {mins !== null ? <> · {mins} min</> : null} · <span style={{ color: st.color }}>{st.label}</span>
                      {s.report ? <> · {isOpen ? "hide" : "read what it did"}</> : null}
                    </span>
                    {/* WHY IS A NIGHT JOB STAMPED IN THE MORNING? (owner, 2026-09-02: "why night
                        audit is going on in afternoon"). The schedules are right — 2:30am, 4am,
                        6am — but macOS runs a MISSED scheduled job the moment the Mac next
                        wakes, so a night the laptop was shut produces a "nightly" run stamped
                        09:27am. On 1 Sept both the repair run and the owner audit fired in the
                        same second at 09:27 for exactly that reason.
                        The row showed the true time and no explanation, so the only reading
                        available was "the night job is running in the daytime". It now says
                        which of the two it is, in words. */}
                    {late ? (
                      <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 2, color: "var(--adm-warn)" }}>
                        <i className="fas fa-moon" aria-hidden="true" style={{ marginRight: 5, fontSize: 10 }} />{late}
                      </span>
                    ) : null}
                    {/* NOTHING TO OPEN, SAID OUT LOUD. Only for a run that ENDED — a run still
                        working has not had the chance to write one yet, and calling that "no
                        report" would be an invented fault. */}
                    {!s.report && s.ended_at ? (
                      <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 2, fontStyle: "italic" }}>
                        No report was saved{s.status === "failed" ? " — it stopped before it could write one." : "."}
                      </span>
                    ) : null}
                  </span>
                </>
              );
              return (
                <div key={s.id} style={{ padding: "9px 0", borderBottom: "var(--border)", fontSize: 13 }}>
                  {s.report ? (
                    <button onClick={() => setOpenRun(isOpen ? "" : s.id)} aria-expanded={isOpen}
                      style={{ display: "flex", gap: 10, alignItems: "flex-start", width: "100%", background: "none", border: "none", padding: 0, color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer", minHeight: 40 }}>
                      {rowBody}
                      <i className={`fas fa-chevron-${isOpen ? "up" : "down"}`} aria-hidden="true" style={{ marginTop: 4, opacity: 0.5, fontSize: 11 }} />
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", width: "100%", minHeight: 40 }}>{rowBody}</div>
                  )}
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
        /* THE RESTAURANT NAME IS THE MAIN THING ON A TICKET (owner, 2026-08-27: "in the ticket it
           should show in maybe some different colour, the restaurant name because that's the main
           thing"). It was 11.5px in --muted, the same grey as the timestamp beside it — so on a
           board carrying nine restaurants, the one fact that tells you WHOSE problem this is was
           the quietest thing on the row.
           It is now a pill in the console's own accent. Deliberately NOT red, amber or green:
           those three already mean severity here, and a restaurant is an identity, not a status —
           a red name on a red tile would compete with the alarm instead of answering it. --accent
           is a declared token with its own value per skin (gold on dark, tan on light), so this
           needs no hard-coded hex and cannot go low-contrast when the console is light. */
        .rp-rest{display:inline-flex;align-items:center;font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:999px;
                 color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent);
                 border:1px solid color-mix(in srgb,var(--accent) 32%,transparent);
                 max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        /* THE SENTENCE IS NOT CODE ANY MORE (item 4, 2026-09-04). This class was monospaced when
           the line it held WAS the raw error text, and that was right. Since 2026-09-02 the closed
           line is plainHeadline() — "Part of the app didn't finish downloading, so the screen
           couldn't open." — and the owner's word for that change was that it "should be in the
           human language". A human sentence in a code face says the opposite of that in the one
           place he actually reads. The captured text still gets the code face: the open block
           below sets its own fontFamily inline, and the "Already fixed" rows use this class for a
           sentence too. Nothing is hidden either way — only the typeface moved. */
        .rp-detail{font-size:12.5px;line-height:1.55;color:var(--muted);white-space:pre-wrap;word-break:break-word;overflow:hidden;transition:max-height .18s ease}
        .rp-link{background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;padding:0 2px}
        .rp-x{margin-left:auto;background:none;border:none;color:var(--muted);opacity:.5;cursor:pointer;font-size:13px;padding:2px 6px;border-radius:6px}
        .rp-x:hover{opacity:1;background:color-mix(in srgb,var(--text) 8%,transparent)}
        /* The "do this to all of them" row. Neutral, not amber and not red: nothing here is a
           warning — it is a shortcut for work you were going to do one tile at a time. */
        .rp-bulk{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 14px;border-radius:12px;border:var(--border);background:color-mix(in srgb,var(--text) 3%,var(--card));margin-bottom:10px;font-size:13px}
        .rp-bulk-lead{flex:1 1 180px;min-width:0;color:var(--muted)}
        .rp-bulk-lead b{color:var(--text)}
        .rp-bulk-btns,.rp-bulk-ask{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}
        .rp-bulk-ask > span{font-size:12.5px;color:var(--text);font-weight:600}
        .rp-bulk .adm-btn{font-size:12px}
        /* On a phone the lead sentence takes its own line so the buttons aren't crushed to one
           word each — the same treatment .rp-sec-h already gets above. */
        @media (max-width:560px){
          .rp-bulk-lead{flex:1 1 100%}
          .rp-bulk-btns,.rp-bulk-ask{flex:1 1 100%}
        }
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
