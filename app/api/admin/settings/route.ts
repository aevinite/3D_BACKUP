// /api/admin/settings — read/write a small, ALLOW-LISTED set of restaurant
// settings the admin Settings page edits (currently the two log-retention windows).
// Admin-gated. Only whitelisted keys are accepted, so this can never be used to
// flip arbitrary settings. Mirrors the clamp the manager's settings save uses.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
import { logAction, deviceIdFrom } from "@/lib/oplog";

export const dynamic = "force-dynamic";

// Capped at 1 MONTH (30 days) — the owner's platform-wide "max save lock" (2026-07-09). 7 days
// is the lighter option; never longer than a month, to keep the log tables small.
const clampDays = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 30) : 30;
};

// THE AUDIT'S WINDOW IS IN YEARS, AND IT IS A DIFFERENT QUESTION (owner, 2026-08-12).
// The activity log is a working diary — huge, disposable, capped at a month. The AUDIT is the money
// trail: every removal with its reason, its person and its amount, and it is what answers "where did
// bill #217 go?" years later. It is also tiny — a few hundred rows a year. So it gets its own
// setting, measured in YEARS, with the owner's own five options.
// Snapped to the offered set rather than merely clamped: a stored 4 would render as a phantom option
// on the screen, which is the exact fault the oplog default was fixed for (see the GET below).
const AUDIT_YEAR_OPTS = [1, 3, 5, 7, 10];
const clampYears = (v: unknown) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 10;
  // nearest offered value, ties going to the LONGER window — never silently shorten the trail
  return AUDIT_YEAR_OPTS.reduce((best, o) =>
    Math.abs(o - n) < Math.abs(best - n) || (Math.abs(o - n) === Math.abs(best - n) && o > best) ? o : best, 10);
};

// Which stack this deployment is serving, named by the Supabase project it talks to. The two refs
// are recorded in CLAUDE.md and are not secret (they are the public host of each project); the KEYS
// are never touched here. An unrecognised ref answers "Unknown" rather than guessing — a wrong
// confident answer on this row is the whole fault being fixed.
function describeStack(): { name: string; live: boolean; ref: string } {
  const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https?:\/\/([a-z0-9]+)\.supabase\./i)?.[1] || "";
  if (ref === "kclqkmdxnwlhtyrducku") return { name: "Live — paying clients", live: true, ref };
  if (ref === "wnsfcizclkbobwzcxqsf") return { name: "Backup / test", live: false, ref };
  return { name: "Unknown", live: false, ref };
}

// ── THE LOCK (owner, 2026-08-21) ─────────────────────────────────────────────────────────────
// His answer to "should the 1-month cap be enforced?" was neither yes nor no: *"make sure admin
// can do only lock for mangaer and ever admin do will be visible to manager"*. So the admin does
// not silently cap anybody — the admin LOCKS, and the lock is something the restaurant can SEE.
//
// Stored in app_config (mig 186), not in `settings`: it is one platform-wide fact, and `settings`
// already carries 110 columns with one row per restaurant — writing the same boolean into every
// row would make a single truth into N truths that can drift.
const LOCK_KEY = "log_retention_lock";
type RetentionLock = { locked: boolean; at: string | null };
async function readLock(): Promise<RetentionLock> {
  const r = await sb.from("app_config").select("value").eq("key", LOCK_KEY).maybeSingle();
  // A missing row means "never locked" — the honest default, and NOT an error the screen should
  // show: a platform that has never used the lock is the normal state.
  if (r.error || !r.data) return { locked: false, at: null };
  const v = (r.data.value || {}) as Record<string, unknown>;
  return { locked: v.locked === true, at: typeof v.at === "string" ? v.at : null };
}

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await sb.from("settings").select("oplog_retention_days, custlog_retention_days, audit_retention_years").eq("id", "site").limit(1);
  if (r.error) return adminFail("the log-retention settings", r.error, { action: "load" });
  const s = r.data?.[0] || {};
  return NextResponse.json({
    // Default to the 30-day MAX (clampDays cap), not 90 — an unconfigured row used to report
    // 90, which the UI then rendered as a phantom "90 days" option above its own "1-month
    // maximum" that couldn't be reselected once changed (audit 2026-07-23).
    oplog_retention_days: s.oplog_retention_days ?? 30,
    custlog_retention_days: s.custlog_retention_days ?? 30,
    // The LONGEST window is the default (mig 311) — above the top of the 6-8 year records range in
    // docs/COMPLIANCE-GUARDRAILS.md §3, so nothing is ever removed unless a person shortens it.
    audit_retention_years: s.audit_retention_years ?? 10,
    auditYearOptions: AUDIT_YEAR_OPTS,
    // WHICH STACK AM I LOOKING AT? (T20 sweep, 2026-08-16.) The Settings page printed a hard-coded
    // "Environment · Production" in green, on every deployment — so on the backup stack the one
    // screen a person opens to check where they are said the wrong thing. Answered from the
    // database this deployment is actually pointed at, which is the thing that decides whose data
    // you are about to change. No key or URL is returned — only the short project ref and a name.
    environment: describeStack(),
    // The manager panel reads the same fact through its own whoami, so the two screens can never
    // disagree about whether a restaurant may change this.
    retentionLock: await readLock(),
  });
}

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {}
  // "One setting for all" (owner 2026-07-09): the admin's retention window applies to EVERY
  // restaurant — a true platform-wide policy, no per-restaurant divergence (and no coupling to
  // restaurant #1's id='site' row). Capped at 1 month by clampDays.
  const patch: Record<string, unknown> = {};
  for (const k of ["oplog_retention_days", "custlog_retention_days"]) {
    if (k in body) patch[k] = clampDays(body[k]);
  }
  if ("audit_retention_years" in body) patch.audit_retention_years = clampYears(body.audit_retention_years);

  // THE LOCK IS ITS OWN WRITE, and it goes to app_config rather than into `patch` — so turning the
  // lock on never rewrites 100 restaurants' retention numbers as a side effect. It is also audited
  // separately below, because "the admin froze this for everyone" is a different event from "the
  // admin changed the window", and a reader of the trail must be able to tell them apart.
  let lockWrote: RetentionLock | null = null;
  if ("retention_lock" in body) {
    const locked = body.retention_lock === true || body.retention_lock === "true";
    const at = new Date().toISOString();
    const w = await sb.from("app_config").upsert({ key: LOCK_KEY, value: { locked, at } }, { onConflict: "key" });
    if (w.error) return adminFail("the log-retention lock", w.error, { action: "save" });
    lockWrote = { locked, at };
  }

  if (!Object.keys(patch).length && !lockWrote) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  if (!Object.keys(patch).length && lockWrote) {
    await logAction("admin", "retention_change", {
      device_id: deviceIdFrom(req),
      detail: lockWrote.locked
        ? "log retention LOCKED for every restaurant — a manager or owner can see the window but not change it"
        : "log retention UNLOCKED — each restaurant may choose its own window again",
    });
    return NextResponse.json({ ok: true, retentionLock: lockWrote });
  }
  // Every settings row carries a restaurant_id (id='site' is #1's row) → this writes them all.
  const r = await sb.from("settings").update(patch).not("restaurant_id", "is", null);
  if (r.error) return adminFail("the log-retention settings", r.error, { action: "save" });
  // HOW LONG THE AUDIT TRAIL LIVES IS ITSELF AUDITED (sweep 2026-08-04). This is the one setting that
  // decides how long the operation log survives, it applies to EVERY restaurant, and it recorded
  // nothing — so shortening the trail from 30 days to 1 was indistinguishable from a trail that was
  // never written. Every neighbouring admin write already logs itself; this was the gap.
  // HOW LONG THE TRAIL LIVES IS ITSELF AUDITED — and the audit's window says YEARS, not "days",
  // because a line reading "audit retention years 3 days" is worse than no line at all.
  await logAction("admin", "retention_change", {
    device_id: deviceIdFrom(req),
    detail: `retention set for ALL restaurants — ${Object.entries(patch).map(([k, v]) => {
      const unit = k === "audit_retention_years" ? (Number(v) === 1 ? "year" : "years") : (Number(v) === 1 ? "day" : "days");
      return `${k.replace(/_years$/, "").replace(/_days$/, "").replace(/_/g, " ")} ${v} ${unit}`;
    }).join(", ")}`
      + (lockWrote ? (lockWrote.locked
        ? " — and LOCKED, so no restaurant may change it"
        : " — and UNLOCKED, so each restaurant may choose again") : ""),
  });
  return NextResponse.json({ ok: true, ...(lockWrote ? { retentionLock: lockWrote } : {}) });
}
