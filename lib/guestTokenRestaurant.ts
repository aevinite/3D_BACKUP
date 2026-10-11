// lib/guestTokenRestaurant.ts — WHICH RESTAURANT A DINER'S TABLE-SESSION TOKEN BELONGS TO.
//
// The three guest doors (app/api/guest/{place-order,call-waiter,leave}) each drop the restaurant's
// shared floor snapshot after a write landed (lib/floorSummary.ts invalidateFloor), and they need the
// restaurant to do it. The phone sends one — but a request saved on a phone by an older build may
// not, and the database functions answer `{ok:true}` without it. A session token maps to exactly one
// restaurant, so this settles it.
//
// ONE COPY (sweep #10 T3 round 2, item 7). It lived as a private `ridFromToken` in place-order and
// again, line for line, in call-waiter — and the third door, leave, had none at all, so an old saved
// "I've left" never dropped the snapshot and a manager reloading inside the shared 1.5s window could
// still see the diner sitting there. Two copies of one helper drift; three would have been worse.
//
// Two single-row, column-listed, capped reads, and only ever called when the cheaper answers (the
// RPC's own reply, the phone's field) came back empty. Best-effort: a failed lookup answers "" and
// must never cost the diner what they were doing.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function restaurantOfToken(token: string | undefined): Promise<string> {
  if (!token) return "";
  try {
    const m = await sb.from("session_members").select("session_id").eq("token", token).limit(1).maybeSingle();
    const sid = m.data?.session_id;
    if (!sid) return "";
    const s = await sb.from("sessions").select("restaurant_id").eq("id", sid).limit(1).maybeSingle();
    const rid = s.data?.restaurant_id;
    return isUuid(rid) ? String(rid) : "";
  } catch { return ""; }   // best-effort: a failed lookup must never cost the diner their order
}
