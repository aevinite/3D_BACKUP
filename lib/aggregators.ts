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

// Insert a normalized inbound order via the same RPC the test button uses.
export async function ingestIncoming(source: AggSource, payload: Record<string, any>) {
  const n = normalizeIncoming(source, payload);
  const { data, error } = await sb.rpc("lfh_platform_insert", {
    p_source: source, p_external_id: n.externalId, p_customer: n.customer, p_phone: n.phone, p_items: n.items, p_total: n.total,
  });
  if (error) throw new Error(error.message);
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
