// errorMemory — a plain record of problems that were FIXED (error_signatures, migs 218 + 219).
//
// IT NEVER HIDES ANYTHING. That is the whole point (owner 2026-07-28: "don't do anything that's
// gonna break or hide something from me"). Nothing here is consulted when an error is logged, so
// every error is still written and still alarms exactly as it did before this table existed. Its
// ONE job: when someone presses "Fix now" on an occurrence that happened BEFORE its fix, answer
// "that's already fixed on <date>, here's the PR" instead of opening a second Claude session to
// redo work that's already done. The red tile stays on the board either way.
//
// Every function is fail-open: if the table can't be read we behave as if there were no record.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { errorSig } from "@/lib/errorSignature";

export type ErrorMemory = {
  id: string;
  fixed_at: string;
  fixed_by: string | null;
  pr_url: string | null;
  note: string | null;
};

type Key = { panel: string; action: string; detail: string | null | undefined; restaurantId?: string | null };

/**
 * The fix recorded for this problem, or null if none. A record saved with NO restaurant (a
 * platform-wide bug) covers every restaurant; a restaurant-scoped one wins when both exist.
 */
export async function lookupErrorMemory(key: Key): Promise<ErrorMemory | null> {
  const sig = errorSig(key.detail);
  if (!sig) return null;
  try {
    const r = await sb.from("error_signatures")
      .select("id, restaurant_id, fixed_at, fixed_by, pr_url, note")
      .eq("panel", key.panel).eq("action", key.action).eq("sig", sig)
      .limit(5);
    if (r.error || !r.data?.length) return null;
    const rows = r.data as (ErrorMemory & { restaurant_id: string | null })[];
    const scoped = key.restaurantId ? rows.find((x) => x.restaurant_id === key.restaurantId) : null;
    return scoped || rows.find((x) => x.restaurant_id === null) || null;
  } catch {
    return null;
  }
}

/**
 * Did this occurrence happen AFTER the recorded fix? Then the fix didn't hold — it is a fresh
 * problem, it alarms normally, and a new Fix-now request is allowed (carrying the failed attempt
 * so nobody rebuilds it blind).
 */
export function isRegression(mem: ErrorMemory | null, occurredAt: string | Date = new Date()): boolean {
  if (!mem) return false;
  return new Date(occurredAt).getTime() > new Date(mem.fixed_at).getTime();
}

/**
 * Record that a problem was fixed. Called when a Claude ticket is closed as fixed, or the owner
 * marks a problem handled. Re-recording refreshes the date and keeps the newest PR link.
 */
export async function rememberErrorHandled(args: {
  panel: string;
  action: string;
  detail: string | null | undefined;
  restaurantId?: string | null;
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
      p_by: args.by,
      p_pr_url: args.prUrl ?? null,
      p_note: args.note ? String(args.note).slice(0, 300) : null,
    });
    return { ok: !r.error, sig };
  } catch {
    return { ok: false, sig };
  }
}

/** Forget a record, so Fix-now treats the problem as brand new again. */
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
  q = args.restaurantId
    ? q.or(`restaurant_id.eq.${args.restaurantId},restaurant_id.is.null`)
    : q.is("restaurant_id", null);
  const r = await q.select("id");
  return r.error ? 0 : (r.data?.length ?? 0);
}
