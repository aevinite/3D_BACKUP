// lib/aggregators.ts — the DORMANT seam for real Zomato/Swiggy integration.
//
// Today there are no API keys and the `aggregators` feature flag is OFF, so this
// is a no-op: the platform panel runs entirely on test orders. When the restaurant
// is onboarded as a POS-integration partner and keys land in env + the flag flips
// on, the inbound webhook below starts ingesting real orders and `notifyAggregator`
// starts pushing status back — with NO further UI changes.
//
// Zomato/Swiggy are PUSH integrations: they POST orders to our webhook (order-relay)
// and we POST status back (confirm/preparing/ready). We never poll them.

import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { platformLadder } from "@/lib/tableTags";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
// Constant-time compare + the hashing helper, the SAME two the admin login door uses (lib/staffAuth).
import { safeEqual, sha256hex } from "@/lib/staffAuth";

export type AggSource = "zomato" | "swiggy";

// Is the backend-only `aggregators` flag turned on? (settings.features JSONB, default false —
// flipped by hand in the DB, never in any UI.)
//
// ── IT USED TO READ RESTAURANT #1's ROW FOR EVERYBODY (owner-approved, 2026-08-21, T25 sweep) ────
//
// The old body was `.select("features").eq("id", "site")`. `settings.id` is the PRE-multi-tenant
// single-row primary key from migration 003 ("a single row (id = 'site')"), and it is still there —
// measured on the dev database, `id='site'` IS restaurant #1's row. So the platform-wide gate on the
// one door an outside company POSTs through was My Little French House's own feature flag, and
// nothing else in this app reads `settings` that way any more.
//
// Two things were wrong with it, and only the second one bites:
//   · it is the wrong SHAPE — every other switch in the product is keyed on `restaurant_id`;
//   · on a stack where restaurant #1 does not exist — a deployment trimmed down to one client's
//     restaurant, which is the exact case lib/ownerHome.ts was written for — that row is absent, so
//     this answered `false` for ever and the integration could never be switched on at all. The
//     reason would have been extremely hard to find, because nothing on any screen mentions it.
//
// SO IT IS PER-RESTAURANT NOW, and the no-argument form is honestly what it always meant to be:
//
//   aggregatorsEnabled(rid)  → does THAT restaurant accept platform orders?
//   aggregatorsEnabled()     → does ANY restaurant? — the platform gate the webhook route uses
//                              before it knows which restaurant the payload is for.
//
// THE GATE IS NOT WEAKENED BY THIS, and that matters more than the tidiness. The route's early check
// is only the outermost of four: `verifyWebhook` still needs the shared secret (and refuses when none
// is configured), `resolveWebhookRestaurant` still refuses rather than guesses which restaurant, and
// `ingestIncoming` below still re-checks that restaurant's Platform ladder AND that the individual
// channel is switched on. Answering "yes" here for a restaurant that is not this one therefore opens
// nothing — the per-restaurant checks are the ones that decide.
//
// It is also NOT MORE EXPENSIVE. The no-argument form is a rows-free COUNT with the filter pushed
// into Postgres (`features->>aggregators`), not a read of every restaurant's settings — verified
// against the dev database, where the filter found exactly the 7 restaurants a row-by-row read found
// for a flag that IS on. One head request on a public path, same as before, and cached below.
//
// Fails CLOSED on a read error, exactly as it did.
const AGG_TTL_MS = 30_000;
let aggAny: { at: number; on: boolean } | null = null;

const aggOn = (features: unknown): boolean =>
  (features as Record<string, unknown> | null | undefined)?.aggregators === true;

export async function aggregatorsEnabled(restaurantId?: string): Promise<boolean> {
  try {
    if (restaurantId) {
      const r = await sb.from("settings").select("features").eq("restaurant_id", restaurantId).maybeSingle();
      if (r.error) return false;
      return aggOn(r.data?.features);
    }
    // The platform gate: is intake on for ANY restaurant? Cached briefly — this sits on a public
    // endpoint, and a flag flipped by hand in the database is not something anyone flips twice in a
    // minute. A restaurant that has just been switched on starts being accepted within the TTL.
    if (aggAny && Date.now() - aggAny.at < AGG_TTL_MS) return aggAny.on;
    const r = await sb.from("settings").select("restaurant_id", { count: "exact", head: true })
      .eq("features->>aggregators", "true");
    if (r.error) return false;                     // never cache a failure
    const on = (r.count || 0) > 0;
    aggAny = { at: Date.now(), on };
    return on;
  } catch {
    return false;
  }
}

/** Test hook: forget the cached platform answer (nothing in the app calls this). */
export function _resetAggregatorsCache(): void { aggAny = null; }

// Per-source API config from env. All absent today → every provider is "dormant".
function providerEnv(source: AggSource) {
  if (source === "zomato") return { key: process.env.ZOMATO_API_KEY, url: process.env.ZOMATO_API_URL, secret: process.env.ZOMATO_WEBHOOK_SECRET };
  return { key: process.env.SWIGGY_API_KEY, url: process.env.SWIGGY_API_URL, secret: process.env.SWIGGY_WEBHOOK_SECRET };
}

// Verify an inbound webhook: the caller must present the shared secret in the X-Webhook-Secret
// header, compared in constant time.
//
// ── TWO CHANGES (T9 sweep, 2026-08-06) ──────────────────────────────────────────────────────────
// 1. NO SECRET NOW MEANS "REFUSE", NOT "ACCEPT". This used to `return true` when no secret was
//    configured, on the reasoning that the feature flag alone keeps things dormant. But the flag and
//    the secret are INDEPENDENT: `aggregators` is a backend-only switch flipped by hand in the DB
//    (that is how it is designed to be turned on), so whoever flips it before setting the env var got
//    a live order-ingesting endpoint that accepted every inbound payload — and nothing anywhere tied
//    the two together. A dormant integration should refuse, not welcome. Answering false here makes
//    the route's existing 401 the honest reply, and the setup order can no longer be got wrong.
// 2. CONSTANT-TIME COMPARE. `headerSecret === secret` was the last plain secret comparison left in
//    this area; /api/staff-login was moved onto `safeEqual` on 2026-08-05 for exactly this reason
//    ("the one comparison against the real typed password was the only one still using a plain
//    `!==`"). Both sides are hashed first so the compare is fixed-length, which is what safeEqual
//    needs — the same shape staff-login uses.
export async function verifyWebhook(source: AggSource, headerSecret: string | null): Promise<boolean> {
  const { secret } = providerEnv(source);
  if (!secret || !headerSecret) return false;
  return safeEqual(await sha256hex(headerSecret), await sha256hex(secret));
}

// Map a platform's raw order payload onto our platform-order shape. The real field
// names differ per platform; this is a forgiving best-effort that the real
// integration will tighten once we see live payloads.
export function normalizeIncoming(source: AggSource, payload: Record<string, any>) {
  const externalId = String(payload.order_id ?? payload.id ?? payload.orderId ?? `${source}-${Date.now()}`);
  const customer = payload.customer_name ?? payload.customer?.name ?? payload.customerName ?? null;
  const phone = payload.customer_phone ?? payload.customer?.phone ?? payload.phoneNumber ?? null;
  const rawItems: any[] = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems.map((it) => ({
    title: it.title ?? it.name ?? "Item",
    qty: Number(it.qty ?? it.quantity ?? 1) || 1,
    price: Number(it.price ?? it.unit_price ?? 0) || 0,
  }));
  const total = Number(payload.total ?? payload.totalAmount ?? items.reduce((s, i) => s + i.price * i.qty, 0)) || 0;
  return { externalId, customer, phone, items, total };
}

// Insert a normalized inbound order via the same RPC the test button uses. Gated (mig 209)
// by the target restaurant's Platform module AND that this channel is turned on — an off
// restaurant/channel can never receive real app orders. (restaurantId defaults to #1, matching
// the RPC's default, until the webhook resolves the tenant from the payload.)
// ── WHICH RESTAURANT DID THIS WEBHOOK ARRIVE FOR? (T9 finding F11, 2026-08-12) ────────────────────
//
// Until now: nobody asked. `ingestIncoming` defaulted its `restaurantId` argument to restaurant #1
// and the webhook route never passed one, so every Zomato/Swiggy order on a multi-restaurant stack
// would have landed on the first restaurant's floor and in its books. Dormant (the `aggregators`
// flag is off) is the only reason it never bit.
//
// The platform identifies the outlet the order is for; we store OUR side of that mapping alongside
// the channel's on/off and key, as `platform_channels.<source>.outlet`. The admin sets it when the
// integration is onboarded — one field, in the screen that already holds the key.
//
// THE RULE IS: RESOLVE, OR REFUSE. There is deliberately no fallback to a default restaurant,
// because the failure mode of guessing is somebody else's order (and somebody else's money) on your
// floor, which is both unrecoverable and invisible. A refusal is a 404 the aggregator can act on.
//
// The ONE convenience: if the payload names no outlet at all and exactly ONE restaurant on the whole
// platform has that channel switched on, there is nothing to be ambiguous about, so that restaurant
// is used. Two or more, and it refuses — because at that point a guess is a coin toss.
const OUTLET_FIELDS = ["outlet_id", "outletId", "restaurant_id", "restaurantId", "store_id", "storeId", "merchant_id", "merchantId"];

export function outletIdFrom(payload: Record<string, unknown>): string {
  for (const f of OUTLET_FIELDS) {
    const v = payload?.[f];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  // Some platforms nest it under the outlet/store object.
  for (const holder of ["outlet", "store", "restaurant", "merchant"]) {
    const o = payload?.[holder];
    if (o && typeof o === "object") {
      const v = (o as Record<string, unknown>).id ?? (o as Record<string, unknown>).code;
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
  }
  return "";
}

export async function resolveWebhookRestaurant(
  source: AggSource,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const outlet = outletIdFrom(payload);
  // Every restaurant with this channel switched ON. Small: it is an opt-in integration.
  const r = await sb.from("settings").select("restaurant_id, platform_channels");
  if (r.error) {
    console.error("[aggregators] could not read channel mappings:", r.error.message);
    return null;                       // couldn't check → refuse, never guess
  }
  const live = ((r.data || []) as { restaurant_id: string; platform_channels: Record<string, { on?: boolean; outlet?: string }> | null }[])
    .filter((row) => row.platform_channels?.[source]?.on === true);

  if (outlet) {
    const matches = live.filter((row) => String(row.platform_channels?.[source]?.outlet ?? "") === outlet);
    // Exactly one, or nothing. Two restaurants claiming the same outlet id is a configuration
    // mistake, and picking one of them at random is the very thing this function exists to stop.
    if (matches.length === 1) return matches[0].restaurant_id;
    if (matches.length > 1) {
      console.error(`[aggregators] ${matches.length} restaurants claim ${source} outlet "${outlet}" — refusing to guess`);
    }
    return null;
  }

  if (live.length === 1) return live[0].restaurant_id;
  if (live.length > 1) {
    console.error(`[aggregators] ${source} order carried no outlet id and ${live.length} restaurants have the channel on — refusing to guess`);
  }
  return null;
}

export async function ingestIncoming(source: AggSource, payload: Record<string, any>, restaurantId: string = DEFAULT_RESTAURANT_ID) {
  if (!(await platformLadder(restaurantId)).effective) throw new Error("platform disabled for this restaurant");
  const chRow = (await sb.from("settings").select("platform_channels").eq("restaurant_id", restaurantId).maybeSingle()).data as
    { platform_channels?: Record<string, { on?: boolean }> } | null;
  if (chRow?.platform_channels?.[source]?.on !== true) throw new Error(`${source} channel is off for this restaurant`);
  const n = normalizeIncoming(source, payload);
  const { data, error } = await sb.rpc("lfh_platform_insert", {
    p_source: source, p_external_id: n.externalId, p_customer: n.customer, p_phone: n.phone, p_items: n.items, p_total: n.total, p_restaurant_id: restaurantId,
  });
  if (error) {
    // A RETRIED WEBHOOK IS NOT AN ERROR — IT IS THE SAME ORDER (T9 sweep, 2026-08-05).
    //
    // `lfh_platform_insert` is a plain INSERT with no conflict handling, and
    // aggregator_orders has UNIQUE (restaurant_id, source, external_id) (mig 079). So the
    // constraint DOES stop a duplicate order reaching the kitchen — that part was already
    // safe. What was wrong is the ANSWER: a 23505 threw, the route turned it into a 500, and
    // every aggregator treats 5xx as "not delivered, retry". Zomato/Swiggy would therefore
    // retry an order we already have, forever, and never get told we have it. Worse, the raw
    // Postgres text ("duplicate key value violates unique constraint …") went out in the
    // response body — our schema, handed to a third party.
    //
    // This is the same rule our own panels already run on (lib/idempotency.ts): a duplicate
    // is answered with the ORIGINAL result, not an error. So look the existing row up and
    // return it, and the route replies 200 with its id — which is what stops the retry loop.
    if ((error as { code?: string }).code === "23505") {
      const existing = await sb.from("aggregator_orders")
        .select("id, external_id, status")
        .eq("restaurant_id", restaurantId).eq("source", source).eq("external_id", n.externalId)
        .maybeSingle();
      if (existing.data) return { ...existing.data, duplicate: true } as Record<string, unknown>;
    }
    // Anything else: log the detail on our side, hand the caller a plain sentence. An external
    // caller never receives a database message.
    console.error(`[aggregators] ${source} ingest failed:`, error.message);
    throw new Error("Couldn't record that order — please retry.");
  }
  return Array.isArray(data) ? data[0] : data;
}

// Push a status change back to the platform. No-op while the provider has no keys
// (today). Best-effort: a notify failure must never break the local status update.
export async function notifyAggregator(source: string, externalId: string | null | undefined, status: string): Promise<void> {
  if (source !== "zomato" && source !== "swiggy") return; // takeaway has no upstream
  const { key, url } = providerEnv(source);
  if (!key || !url || !externalId) return; // dormant — nothing to notify yet
  const MAP: Record<string, string> = { accepted: "confirm", preparing: "preparing", ready: "ready", handed_over: "dispatched", cancelled: "reject" };
  const verb = MAP[status];
  if (!verb) return;
  try {
    await fetch(`${url.replace(/\/$/, "")}/orders/${encodeURIComponent(externalId)}/${verb}`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: "{}",
    });
  } catch { /* best-effort: the local status already moved */ }
}
