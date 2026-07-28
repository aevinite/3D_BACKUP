// errorMemory — reads/writes the "already dealt with" memory (error_signatures, mig 218).
//
// The rules, in the owner's words (2026-07-28): "once you fix that error, that should not pop up
// again — the same one", and an unnecessary error "should not pop up only". So:
//
//   • state 'fixed'   → occurrences from BEFORE the fix are silent (already answered). An
//                       occurrence AFTER the fix is a REGRESSION: it stays loud, because fixed
//                       has to mean gone. We count it so the Repair page can say "came back".
//   • state 'ignored' → the owner said this isn't a real problem: always silent, still logged.
//
// Every function here is FAIL-OPEN: if the memory table can't be read we behave exactly like
// before it existed (the error alarms). Losing an alarm is worse than showing a duplicate.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { errorSig } from "@/lib/errorSignature";

export type ErrorMemory = {
  id: string;
  state: "fixed" | "ignored";
  fixed_at: string;
  fixed_by: string | null;
  pr_url: string | null;
  note: string | null;
  recurrences: number;
};

type Key = { panel: string; action: string; detail: string | null | undefined; restaurantId?: string | null };

/**
 * The memory for this problem, or null when we've never dealt with it. A signature saved with NO
 * restaurant (a platform-wide bug) covers every restaurant; a restaurant-scoped one wins when both
 * exist, so one tenant's "not a problem" can never mute another tenant's real alarm.
 */
export async function lookupErrorMemory(key: Key): Promise<ErrorMemory | null> {
  const sig = errorSig(key.detail);
  if (!sig) return null;
  try {
    const r = await sb.from("error_signatures")
      .select("id, restaurant_id, state, fixed_at, fixed_by, pr_url, note, recurrences")
      .eq("panel", key.panel).eq("action", key.action).eq("sig", sig)
      .limit(5);
    if (r.error || !r.data?.length) return null;
    const rows = r.data as (ErrorMemory & { restaurant_id: string | null })[];
    const scoped = key.restaurantId ? rows.find((x) => x.restaurant_id === key.restaurantId) : null;
    const global = rows.find((x) => x.restaurant_id === null);
    return scoped || global || null;
  } catch {
    return null; // fail open — alarm as normal
  }
}

/** Was this occurrence AFTER the fix? (i.e. the fix did not hold). */
export function isRegression(mem: ErrorMemory | null, occurredAt: string | Date = new Date()): boolean {
  if (!mem || mem.state !== "fixed") return false;
  return new Date(occurredAt).getTime() > new Date(mem.fixed_at).getTime();
}

/** Bump the seen-counter so the Repair page can show "×N since the fix". Best-effort. */
export async function noteRecurrence(memId: string, seenAt: string = new Date().toISOString()): Promise<void> {
  try {
    await sb.rpc("lfh_bump_error_signature", { p_id: memId, p_seen: seenAt });
  } catch {
    /* counter only — never let it affect the request */
  }
}

/**
 * Remember that a problem was handled. Called when the owner resolves an error group, marks it
 * "not a problem", or a Claude fix request is closed as fixed. Re-recording an existing signature
 * refreshes fixed_at and ZEROES the recurrence count — a new fix deserves a clean slate, otherwise
 * an old failed attempt's counter would make the new fix look broken from day one.
 */
export async function rememberErrorHandled(args: {
  panel: string;
  action: string;
  detail: string | null | undefined;
  restaurantId?: string | null;
  state: "fixed" | "ignored";
  by: "owner" | "claude";
  prUrl?: string | null;
  note?: string | null;
}): Promise<{ ok: boolean; sig: string }> {
  const sig = errorSig(args.detail);
  if (!sig) return { ok: false, sig };
  try {
    const r = await sb.rpc("lfh_remember_error_signature", {
      p_restaurant_id: args.restaurantId ?? null,
      p_panel: args.panel,
      p_action: args.action,
      p_sig: sig,
      p_state: args.state,
      p_by: args.by,
      p_pr_url: args.prUrl ?? null,
      p_note: args.note ? String(args.note).slice(0, 300) : null,
    });
    return { ok: !r.error, sig };
  } catch {
    return { ok: false, sig };
  }
}

/** Forget a signature — the Repair page's "show this again". Returns how many memories went. */
export async function forgetErrorSignature(args: {
  panel: string;
  action: string;
  detail: string | null | undefined;
  restaurantId?: string | null;
}): Promise<number> {
  const sig = errorSig(args.detail);
  if (!sig) return 0;
  let q = sb.from("error_signatures").delete()
    .eq("panel", args.panel).eq("action", args.action).eq("sig", sig);
  // Only drop the memory that actually covers this row: the restaurant's own, or the global one.
  q = args.restaurantId
    ? q.or(`restaurant_id.eq.${args.restaurantId},restaurant_id.is.null`)
    : q.is("restaurant_id", null);
  const r = await q.select("id");
  return r.error ? 0 : (r.data?.length ?? 0);
}
