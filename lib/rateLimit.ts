// Server-side rate limiting (migration 205). One call → lfh_rate_check counts a fixed window in
// the DB and returns whether this attempt is allowed. When a limit is reached it also records an
// event that surfaces in the admin Problems section (Fix / Change-limit / Allow).
//
// FAIL-OPEN by design: a limiter glitch (DB blip, missing rule) must NEVER lock out real users —
// same principle as the offline idempotency guard. Enforcement RPCs (guest orders) call
// lfh_rate_check directly in SQL; route handlers use rateAllowed() below.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendOwnerAlert, alertText } from "@/lib/alerts";

export type RateKey =
  | "guest_order" | "staff_login" | "admin_login" | "manager_pin"
  | "waiter_call" | "join_session" | "otp_request" | "password_change";

// Friendly names for the phone ping (the DB rule labels aren't loaded here).
const RATE_LABELS: Record<string, string> = {
  guest_order: "Guest orders", staff_login: "Staff / owner login", admin_login: "Admin login",
  manager_pin: "Manager PIN", waiter_call: "Waiter calls", join_session: "Join table", otp_request: "OTP requests",
  // mig 277 — the "change my password" box, the one credential check that had no wall.
  password_change: "Change-password attempts",
};

// How long the window was, in words ("5 min", "60 sec") — for the alert text only.
function perWords(secs?: number | null): string {
  if (!secs || secs <= 0) return "";
  return secs % 60 === 0 ? `${secs / 60} min` : `${secs} sec`;
}

// Phone ping (ntfy/Telegram) when a rate limit is reached — same channel as complaints. The owner
// only got a bell entry before, no phone alert (2026-07-27). Dedupe rides on sendOwnerAlert's 15-min
// grouping keyed per (limit, subject), so the same person hitting the same wall pings once, not
// fifty times. No-ops when no alert channel is configured. Best-effort — never throws, never blocks.
//
// DELIVERED SILENTLY (owner 2026-07-29): a limit being reached breaks nothing — the person just
// waits — so it must arrive quietly (no sound, no vibration) while staying fully visible in the
// notification list, the bell and the Problems page. Nothing is hidden or dropped.
// The text names WHO, WHICH RESTAURANT, WHICH KIND of login and HOW MANY tries, because "ravi
// reached the limit" alone didn't say whose restaurant or whether it was a manager, a kitchen
// screen, a waiter tablet or an owner (owner 2026-07-29).
async function notifyRateHit(
  key: string, subject: string, label: string | null, hits?: number,
  extra?: { max?: number | null; windowSeconds?: number | null; device?: string | null; restaurant?: string | null },
): Promise<void> {
  try {
    const friendly = RATE_LABELS[key] || key.replace(/_/g, " ");
    const who = label || subject;
    const per = perWords(extra?.windowSeconds);
    // Don't repeat the restaurant on its own line when the "who" line already names it.
    const where = extra?.restaurant && !who.includes(extra.restaurant) ? extra.restaurant : null;
    const tries = hits && hits > 0
      ? `${hits}${per ? ` in ${per}` : ""}${extra?.max ? ` (limit ${extra.max})` : ""}`
      : per ? `limit is per ${per}` : null;
    // The admin-login alert is warn-only (mig 208) — nobody is ever locked out by it, so don't
    // promise a wait that isn't real.
    const note = key === "admin_login"
      ? "Nobody is locked out — this is just a heads-up."
      : per ? `They can try again after ${per}.` : "They can try again shortly.";
    // "Limit reached: Staff / owner login" is already the title, so it is NOT repeated here.
    const body = alertText([
      ["Who", who],
      ["Where", where],
      ["Tries", tries],
      ["Device", extra?.device ? extra.device.slice(0, 10) : null],
    ], note);
    // SILENT applies to EXACTLY ONE alert in the whole app (owner 2026-07-29, final): the
    // staff/owner LOGIN limit. Nothing is broken when a staff login wall is hit — the person just
    // waits a few minutes — and it's the one that kept waking him during testing. Every other ping
    // is audible, including the other limits (guest orders, manager PIN, waiter calls, join table,
    // OTP) and the admin-login warning: those can mean real trouble on the floor.
    await sendOwnerAlert(body, `ratelimit:${key}:${subject}`, {
      silent: key === "staff_login",
      title: `Limit reached: ${friendly}`,
    });
  } catch { /* alerts are best-effort */ }
}

// One restaurant's name, for the alert text. Wall-hit path only (one row, two columns).
const RID0 = "00000000-0000-0000-0000-000000000000";
async function restaurantNameOf(rid?: string | null): Promise<string | null> {
  if (!rid || rid === RID0) return null;
  try {
    const { data } = await supabaseAdmin.from("restaurants").select("name").eq("id", rid).limit(1);
    return (data?.[0]?.name as string) ?? null;
  } catch { return null; }
}

// The open event row for this (limit, subject) — gives the REAL try count + the rule's numbers,
// which lfh_rate_check itself only answers true/false about. Read ONLY on the rare wall-hit path
// (scoped, explicit columns, one row). Returns null on any problem.
//
// SCOPED TO ONE RESTAURANT (2026-08-21). `rate_limit_events` is unique on
// (restaurant_id, key, subject) — mig 205 — and lfh_rate_check writes the row under
// coalesce(p_rid, RID0). Reading it back on (key, subject) alone therefore answered for whichever
// restaurant last hit that same wall, and the caller then WROTE this restaurant's `subject_label`
// onto that row. Every subject a TypeScript caller sends today already carries its own restaurant
// (`rid:name`, `rid:device`, or a globally-unique user id), so nothing moves — but the guest limits
// already use a bare `table:5` subject in SQL, so the first TS caller to copy that shape would have
// had one restaurant's admin reading another restaurant's staff on the Limits page. Naming the
// restaurant here closes it before that happens.
async function openEventStats(key: string, subject: string, rid?: string | null): Promise<
  { id: string; hit_count: number; max_count: number; window_seconds: number } | null
> {
  try {
    const { data } = await supabaseAdmin.from("rate_limit_events")
      .select("id, hit_count, max_count, window_seconds")
      .eq("key", key).eq("subject", subject).eq("status", "open")
      .eq("restaurant_id", rid || RID0)
      .order("last_at", { ascending: false }).limit(1);
    return (data?.[0] as { id: string; hit_count: number; max_count: number; window_seconds: number }) ?? null;
  } catch { return null; }
}

// Guest SQL-inline path (guest_order / waiter_call / join_session): the limit is enforced entirely
// in Postgres and no TS caller sees the hit, so the guest client fires a lightweight beacon. Here we
// confirm a REAL open event exists (service role) before pinging, and the ping's content comes only
// from that DB row — so a client beacon can never fabricate an alert for a limit that wasn't hit.
export async function pingLatestGuestLimit(key: RateKey, rid: string | null): Promise<void> {
  try {
    let q = supabaseAdmin.from("rate_limit_events")
      .select("key, subject, subject_label, hit_count, max_count, window_seconds")
      .eq("key", key).eq("status", "open")
      .gte("last_at", new Date(Date.now() - 2 * 60 * 1000).toISOString())
      .order("last_at", { ascending: false }).limit(1);
    if (rid && rid !== RID0) q = q.eq("restaurant_id", rid);
    const { data } = await q;
    const e = data?.[0];
    if (!e) return; // no genuine recent event → no ping
    await notifyRateHit(e.key, e.subject, e.subject_label ?? null, e.hit_count,
      { max: e.max_count ?? null, windowSeconds: e.window_seconds ?? null });
  } catch { /* best-effort */ }
}

/**
 * True = allowed, false = blocked (an "open" event was recorded). Never throws.
 *
 * `opts.describe` is an OPTIONAL "who is this really?" lookup, called ONLY when the wall is hit
 * (never on a normal request), so the pre-check stays a single RPC with no extra reads. Whatever
 * it returns becomes the event's label — so the richer wording reaches the phone ping AND the
 * bell AND the Problems/limits pages from one place.
 */
export async function rateAllowed(
  key: RateKey,
  subject: string,
  opts?: {
    restaurantId?: string | null;
    label?: string | null;
    device?: string | null;
    describe?: () => Promise<string | null>;
  },
): Promise<boolean> {
  const subj = (subject || "").trim();
  if (!subj) return true;
  try {
    const { data, error } = await supabaseAdmin.rpc("lfh_rate_check", {
      p_rid: opts?.restaurantId ?? null,
      p_key: key,
      p_subject: subj.slice(0, 200),
      p_label: opts?.label ? opts.label.slice(0, 200) : null,
    });
    if (error) return true; // fail-open
    const allowed = data !== false;
    if (!allowed) {
      // A wall was hit (rare) → now it's worth spending two small reads to say WHO and WHERE.
      const subjKey = subj.slice(0, 200);
      const [detail, ev, restName] = await Promise.all([
        opts?.describe ? opts.describe().catch(() => null) : Promise.resolve(null),
        openEventStats(key, subjKey, opts?.restaurantId ?? null),
        restaurantNameOf(opts?.restaurantId ?? null),
      ]);
      const rich = detail || opts?.label || null;
      // Store the richer line on the event so the bell / Problems / limits pages read the same
      // detail the phone got, without any schema change.
      if (detail && ev?.id) {
        try {
          await supabaseAdmin.from("rate_limit_events")
            .update({ subject_label: detail.slice(0, 200) }).eq("id", ev.id);
        } catch { /* wording only */ }
      }
      await notifyRateHit(key, subjKey, rich, ev?.hit_count, {
        max: ev?.max_count ?? null, windowSeconds: ev?.window_seconds ?? null,
        device: opts?.device ?? null, restaurant: restName,
      });
    }
    return allowed;
  } catch {
    return true; // fail-open
  }
}

/**
 * A login SUCCEEDED → wipe that person's login counter (and close any wall they'd already hit).
 *
 * Why (owner 2026-07-29): the counter used to tick on EVERY attempt, right or wrong. So six normal
 * sign-ins in five minutes locked the person out and pinged the owner's phone — which is exactly
 * what real service looks like on a SHARED waiter tablet (staff signing in and out all shift), and
 * what our own testing looks like too. A login limit is there to stop repeated WRONG passwords, so
 * proving you know the password must reset it — the same way `staff_users.failed_count` and the
 * admin `login_throttle` already reset themselves on success.
 *
 * Wrong-password bursts are untouched: they never reach here, so they still count and still wall.
 * Best-effort and silent — a failure here can only mean a stale counter, never a broken login.
 *
 * `rid` is OPTIONAL and narrows the reset to ONE restaurant (2026-08-21). Both tables are unique on
 * (restaurant_id, key, subject), so clearing on (key, subject) alone clears every restaurant that
 * shares that pair — and marks their open walls "signed in successfully" when nobody there did.
 * Today's callers all send a subject that already names its own restaurant, so passing nothing keeps
 * exactly the behaviour they have; a caller that knows the restaurant should say so, and then the
 * wall it clears is provably its own.
 */
export async function rateResetOnSuccess(key: RateKey, subject: string, rid?: string | null): Promise<void> {
  const subj = (subject || "").trim().slice(0, 200);
  if (!subj) return;
  // Only narrow when the caller actually named a restaurant. Defaulting to RID0 instead would stop
  // clearing the walls of every caller that DOES pass one — the opposite failure, and a worse one.
  const scope = <T extends { eq(c: string, v: unknown): T }>(q: T): T =>
    (rid ? q.eq("restaurant_id", rid) : q);
  try {
    await scope(supabaseAdmin.from("rate_limit_counters").delete().eq("key", key).eq("subject", subj));
    // Any wall they hit earlier is now history, not a live problem — mark it handled rather than
    // deleting it, so the record of what happened stays in the admin's list.
    await scope(supabaseAdmin.from("rate_limit_events")
      .update({ status: "allowed", resolved_at: new Date().toISOString(), resolved_by: "auto · signed in successfully" })
      .eq("key", key).eq("subject", subj).eq("status", "open"));
  } catch { /* a stale counter is harmless; never break a login */ }
}

/** Normalise a login name so "  Ravi " and "ravi" share one counter. */
export function subjectFor(name: string): string {
  return (name || "").trim().toLowerCase().slice(0, 120);
}

// Record a WARN-ONLY security event (no counter, no block) — used by the admin-login "N wrong
// tries" alert so the admin gets a notification + Problems entry without ever being locked out.
// Surfaces in the bell + Problems (both already read rate_limit_events). Best-effort.
export async function recordAlert(key: string, subject: string, label: string, hitCount: number): Promise<void> {
  try {
    await supabaseAdmin.rpc("lfh_rate_alert", { p_key: key, p_subject: subject.slice(0, 200), p_label: label.slice(0, 200), p_hit: hitCount });
    await notifyRateHit(key, subject.slice(0, 200), label, hitCount); // phone ping (grouped 15 min per ip)
  } catch { /* best-effort — never break login */ }
}
