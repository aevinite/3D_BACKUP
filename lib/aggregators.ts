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

export type AggSource = "zomato" | "swiggy";

// Is the backend-only `aggregators` flag turned on? (settings.features JSONB,
// default false — flipped by hand in the DB, never in any UI.)
export async function aggregatorsEnabled(): Promise<boolean> {
  try {
    const r = await sb.from("settings").select("features").eq("id", "site").maybeSingle();
    return !!((r.data?.features as Record<string, unknown> | undefined)?.aggregators === true);
  } catch {
    return false;
  }
}

// Per-source API config from env. All absent today → every provider is "dormant".
function providerEnv(source: AggSource) {
  if (source === "zomato") return { key: process.env.ZOMATO_API_KEY, url: process.env.ZOMATO_API_URL, secret: process.env.ZOMATO_WEBHOOK_SECRET };
  return { key: process.env.SWIGGY_API_KEY, url: process.env.SWIGGY_API_URL, secret: process.env.SWIGGY_WEBHOOK_SECRET };
}

// Verify an inbound webhook. With no shared secret configured (today), we only
// require the feature flag — there are no real senders yet. Once a secret is set,
// the caller must present it in the X-Webhook-Secret header.
export function verifyWebhook(source: AggSource, headerSecret: string | null): boolean {
  const { secret } = providerEnv(source);
  if (!secret) return true; // dev/dormant: no secret set yet
  return !!headerSecret && headerSecret === secret;
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
