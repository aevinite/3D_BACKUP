// lib/staffProfileShared.ts — the PURE half of the staff-profile rules: which roles have a
// profile, which fields exist, who may edit which of them, completeness, and every input
// sanitiser. No imports, so it is safe in a BROWSER bundle as well as on the server.
//
// WHY THIS FILE IS SEPARATE (bug caught while verifying, 2026-07-29): the owner's profile PAGE
// is a client component and needs the field lists + enums. Importing them from lib/staffProfile
// dragged in lib/tableTags → lib/supabaseAdmin (the SERVICE-ROLE client) and the page died with
// "supabaseKey is required". Server-only helpers therefore live in lib/staffProfile.ts and
// nothing a client renders may import that file.
// ── Which roles get a profile ────────────────────────────────────────────────
// KITCHEN IS DELIBERATELY EXCLUDED (owner, 2026-07-29: "for the kitchen, we don't need this
// thing"). Their KDS stays a cooking display; they keep their login, their PIN and their
// action log, they just have no profile or pay record. Flip this one list if that changes.
// REJECTED (owner, 2026-07-29 · re-confirmed 2026-08-05 and 2026-08-07): kitchen is NOT on this list
// and must not be added. "Kitchen panel will not have profile or stuff like that. I have already told
// this." Asked and answered three times — see docs/REJECTED-IDEAS.md → R7.
export const PROFILE_ROLES = ["owner", "manager", "tablet"] as const;
export const hasProfile = (role: string) => (PROFILE_ROLES as readonly string[]).includes(role);

// ── The three manager powers this feature adds ───────────────────────────────
export const POWER_SEE_PAY = "see_staff_pay";
export const POWER_RECORD_PAY = "record_staff_payment";
export const POWER_EDIT_PROFILE = "edit_staff_profiles";
// Powers whose ABSENT grant means ON. Both are low-risk floor needs (fix a phone number;
// hand over a cash advance on a Sunday) and the MODULE itself is off by default, so nothing
// is exposed until an admin deliberately enables the feature. Seeing everyone's SALARY is
// not on this list — absent means off there, and the owner must grant it deliberately.
export const ABSENT_ON_PAY_POWERS: ReadonlySet<string> = new Set([POWER_RECORD_PAY, POWER_EDIT_PROFILE]);

// ── Personal details (stored in staff_users.profile jsonb) ───────────────────
// Owner/admin may set all of these.
export const PROFILE_FIELDS = [
  "full_name", "alt_phone", "email", "dob", "blood_group", "language",
  "address", "city", "pincode",
  "emg_name", "emg_relation", "emg_phone",
  "id_type", "id_last4", "id_verified",
  "upi_id", "bank_last4",
  "notes",
] as const;
// What the PERSON may change about themselves. Not their ID-on-file (the owner is the one
// who verifies it), and not `notes` (that's the owner's private note about them).
export const SELF_PROFILE_FIELDS = [
  "full_name", "alt_phone", "email", "dob", "blood_group", "language",
  "address", "city", "pincode",
  "emg_name", "emg_relation", "emg_phone",
  "upi_id", "bank_last4",
] as const;

// ── Job & pay (real columns — owner/admin only, never the manager) ───────────
export const JOB_COLUMNS = [
  "joined_on", "left_on", "designation", "employment_type",
  "shift_label", "weekly_off",
] as const;
export const PAY_COLUMNS = ["pay_type", "pay_amount", "pay_day", "pay_mode", "pay_extras"] as const;

export const PAY_TYPES = ["monthly", "daily", "hourly", "per_shift"] as const;
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "trial", "casual"] as const;
export const PAY_MODES = ["cash", "upi", "bank"] as const;
export const PAY_KINDS = ["salary", "advance", "bonus", "overtime", "reimbursement", "deduction"] as const;
export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export type PayKind = (typeof PAY_KINDS)[number];
export const isPayKind = (v: unknown): v is PayKind => typeof v === "string" && (PAY_KINDS as readonly string[]).includes(v);

// Money that MOVED (a deduction is a book entry recovering an earlier advance, not a payout).
export const isPayout = (kind: string) => kind !== "deduction";

// ── Completeness ─────────────────────────────────────────────────────────────
// The "8 of 14 details filled" number. Two counts, because a waiter can't fill their own
// salary: `filled/total` is the owner's view of the whole record, `selfFilled/selfTotal`
// only the parts the person themselves is asked for.
type StaffLike = {
  phone?: string | null;
  profile?: Record<string, unknown> | null;
  joined_on?: string | null;
  designation?: string | null;
  employment_type?: string | null;
  shift_label?: string | null;
  pay_type?: string | null;
  pay_amount?: number | string | null;
};
const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

export function completeness(s: StaffLike): { filled: number; total: number; selfFilled: number; selfTotal: number; missing: string[] } {
  const p = (s.profile || {}) as Record<string, unknown>;
  // [label, filled?, countsForSelf]
  const checks: [string, boolean, boolean][] = [
    ["phone number", has(s.phone), true],
    ["full name", has(p.full_name), true],
    ["date of birth", has(p.dob), true],
    ["email", has(p.email), true],
    ["address", has(p.address), true],
    ["city", has(p.city), true],
    ["emergency contact name", has(p.emg_name), true],
    ["emergency contact phone", has(p.emg_phone), true],
    ["ID on file", has(p.id_type) && has(p.id_last4), false],
    ["joining date", has(s.joined_on), false],
    ["designation", has(s.designation), false],
    ["employment type", has(s.employment_type), false],
    ["shift", has(s.shift_label), false],
    ["pay setup", has(s.pay_type) && has(s.pay_amount), false],
  ];
  return {
    filled: checks.filter((c) => c[1]).length,
    total: checks.length,
    selfFilled: checks.filter((c) => c[2] && c[1]).length,
    selfTotal: checks.filter((c) => c[2]).length,
    missing: checks.filter((c) => !c[1]).map((c) => c[0]),
  };
}

// ── Sanitisers (every write goes through these; nothing else reaches the DB) ──
const str = (v: unknown, max = 200): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const digits = (v: unknown, n: number): string | null => {
  const s = String(v ?? "").replace(/\D/g, "");
  return s ? s.slice(0, n) : null;
};
const isoDate = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // accept YYYY-MM-DD only (the UI sends that); anything else is dropped rather than guessed
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** Merge a PARTIAL personal-details patch onto an existing profile jsonb. Unknown keys are
 *  dropped; `null`/"" clears a field (that's how "I filled this by mistake" undoes itself). */
export function mergeProfilePatch(
  current: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(current || {}) };
  for (const k of allowed) {
    if (!(k in patch)) continue;
    const raw = patch[k];
    let v: unknown;
    if (k === "id_verified") v = raw === true;
    else if (k === "id_last4" || k === "bank_last4") v = digits(raw, 4);
    else if (k === "dob") v = isoDate(raw);
    else if (k === "address" || k === "notes") v = str(raw, 500);
    else v = str(raw, 200);
    if (v === null || v === false) delete out[k]; else out[k] = v;
  }
  return out;
}

export type JobPatch = Record<string, unknown>;

/** Build a validated column patch for the job/pay block. Returns {} for an empty patch and
 *  throws a plain Error (message is user-safe) on a bad value, so the route can 400 it. */
export function jobPatchFrom(body: Record<string, unknown>): JobPatch {
  const out: JobPatch = {};
  if ("joined_on" in body) out.joined_on = isoDate(body.joined_on);
  if ("left_on" in body) out.left_on = isoDate(body.left_on);
  if ("designation" in body) out.designation = str(body.designation, 80);
  if ("shift_label" in body) out.shift_label = str(body.shift_label, 80);
  if ("pay_day" in body) out.pay_day = str(body.pay_day, 40);
  if ("employment_type" in body) {
    const v = str(body.employment_type, 20);
    if (v && !(EMPLOYMENT_TYPES as readonly string[]).includes(v)) throw new Error("Unknown employment type.");
    out.employment_type = v;
  }
  if ("pay_type" in body) {
    const v = str(body.pay_type, 20);
    if (v && !(PAY_TYPES as readonly string[]).includes(v)) throw new Error("Unknown pay type.");
    out.pay_type = v;
  }
  if ("pay_mode" in body) {
    const v = str(body.pay_mode, 10);
    if (v && !(PAY_MODES as readonly string[]).includes(v)) throw new Error("Unknown payment mode.");
    out.pay_mode = v;
  }
  if ("pay_amount" in body) {
    const raw = body.pay_amount;
    if (raw === null || raw === undefined || String(raw).trim() === "") out.pay_amount = null;
    else {
      const n = Number(String(raw).replace(/[,\s₹]/g, ""));
      if (!Number.isFinite(n) || n < 0) throw new Error("Pay amount must be a number.");
      if (n > 99_999_999) throw new Error("That pay amount looks wrong — it's too large.");
      out.pay_amount = Math.round(n * 100) / 100;
    }
  }
  if ("weekly_off" in body) {
    const arr = Array.isArray(body.weekly_off) ? body.weekly_off : [];
    const days = [...new Set(arr.map((d) => String(d).toLowerCase().slice(0, 3)))].filter((d) =>
      (WEEK_DAYS as readonly string[]).includes(d));
    out.weekly_off = days.length ? days : null;
  }
  if ("pay_extras" in body) {
    const arr = Array.isArray(body.pay_extras) ? body.pay_extras : [];
    out.pay_extras = arr.slice(0, 12).map((x) => {
      const o = (x || {}) as Record<string, unknown>;
      const amt = Number(String(o.amount ?? "").replace(/[,\s₹]/g, ""));
      if (!Number.isFinite(amt) || amt < 0) throw new Error("An allowance/deduction amount must be a number.");
      return {
        label: str(o.label, 60) || "Extra",
        kind: o.kind === "deduction" ? "deduction" : "allowance",
        amount: Math.round(amt * 100) / 100,
      };
    });
  }
  return out;
}

/** What a recorded payment may contain. Throws a user-safe Error on bad input. */
export function paymentFrom(body: Record<string, unknown>): {
  kind: PayKind; amount: number; for_period: string | null; mode: string; paid_on: string; note: string | null;
} {
  const kind = String(body.kind ?? "salary");
  if (!isPayKind(kind)) throw new Error("Unknown payment type.");
  const amount = Number(String(body.amount ?? "").replace(/[,\s₹]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount greater than zero.");
  if (amount > 99_999_999) throw new Error("That amount looks wrong — it's too large.");
  const mode = String(body.mode ?? "cash");
  if (!(PAY_MODES as readonly string[]).includes(mode)) throw new Error("Unknown payment mode.");
  // for_period is normalised to the FIRST day of the month it is for, so the monthly cost
  // view groups cleanly however the UI sends it.
  let period: string | null = null;
  const rawP = String(body.for_period ?? "").trim();
  if (rawP) {
    const m = /^(\d{4})-(\d{2})/.exec(rawP);
    if (!m) throw new Error("That pay period isn't a valid month.");
    period = `${m[1]}-${m[2]}-01`;
  }
  const paid_on = isoDate(body.paid_on) || todayIST();
  // A payment can be back-dated (you paid yesterday, you type it today) but not FUTURE-dated:
  // a payment that hasn't happened yet would silently inflate "paid this month".
  if (paid_on > todayIST()) throw new Error("You can't record a payment for a future date.");
  return { kind, amount: Math.round(amount * 100) / 100, for_period: period, mode, paid_on, note: str(body.note, 200) };
}

/** Today in the restaurant's timezone (IST) as YYYY-MM-DD — the app's business day. */
export function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** The IST CALENDAR DATE of an ISO instant, as YYYY-MM-DD.
 *  `paid_on` is a plain date in IST business terms, but a report window arrives as an ISO
 *  instant — and 00:00 IST is 18:30 UTC the PREVIOUS day, so `iso.slice(0, 10)` hands the
 *  query the wrong day. That made a "30 days" pay report include a 31st day and show
 *  ₹1,04,000 where only ₹71,000 was paid in the window (found in the 2026-07-30 sweep). */
export function istDateOf(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return todayIST();
  return new Date(t + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

