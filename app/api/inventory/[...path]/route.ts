// Inventory + expense-book API (mig 221, Stage 1). One catch-all handler, same shape
// as /api/editor: manager-or-above cookie gate → panel restaurant scope → per-power
// enforcement server-side (hiding a button is never the only guard).
//
// Consumers: the manager panel's Inventory tab (public/panels/editor/inventory.js)
// and the owner panel's ops screens. Owner-report AGGREGATES live separately under
// /api/owner/inventory (snapshot-cached); this file is the operational surface.
//
// Egress rules (docs/SAAS-EFFICIENCY-PLAYBOOK.md): every select is scoped
// .eq("restaurant_id", rid) with an explicit column list and a limit; balances are
// read from the materialised inv_items columns, never by summing inv_movements. No
// polling — the tab fetches on open and after its own writes.
//
// Ledger discipline (docs/research/pos-inventory/00-MASTER-SYNTHESIS.md §1.3/1.4):
// every stock change goes through lfh_inv_post_movement() with a caller-built
// dedupe key, so an offline replay or double-tap can never move stock twice; voids
// post REVERSING movements — nothing is ever edited in place or deleted.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { withIdempotency } from "@/lib/idempotency";
import { logAction } from "@/lib/oplog";
import { requireRole, type StaffUser } from "@/lib/userAuth";
import { panelRestaurantId } from "@/lib/panelScope";
import { inventoryLadder } from "@/lib/tableTags";
import { powerEntitlementKey } from "@/lib/ownerEntitlements";

export const dynamic = "force-dynamic";

const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
const ok = (body: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...body });

// IST calendar date (all inventory documents live on the business calendar).
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

// ── auth + power gates (the editor route's managerCan, scoped to this module) ──
async function gate(req: NextRequest): Promise<{ user: StaffUser | null } | NextResponse> {
  const g = await requireRole(req, "manager");
  if (!g.ok) {
    return g.transient
      ? NextResponse.json({ error: "Server can't reach the database — retrying." }, { status: 503 })
      : NextResponse.json({ error: "Not authorised — please log in." }, { status: 401 });
  }
  return { user: g.user };
}

// The module rung: any REAL user (owner or manager) needs inventory_* effective for
// this restaurant; the admin super-user passes for X-ray honesty (same rule as the
// platform/parcel gate in the editor route).
async function moduleOn(g: { user: StaffUser | null }, rid: string): Promise<boolean> {
  if (!g.user) return true;
  return (await inventoryLadder(rid)).effective;
}

// inv_stock / inv_expenses — absent manager grant = OFF (money-adjacent; the owner
// hands these over deliberately). Owner always passes; per-person override wins over
// the restaurant-wide grant but never over the admin cap.
async function invCan(g: { user: StaffUser | null }, rid: string, flag: "inv_stock" | "inv_expenses"): Promise<boolean> {
  const u = g.user;
  if (!u || u.role === "owner") return true;
  const r = (await sb.from("restaurants").select("manager_permissions, owner_entitlements").eq("id", rid).maybeSingle()).data as
    { manager_permissions?: Record<string, boolean>; owner_entitlements?: Record<string, boolean> } | null;
  if (r?.owner_entitlements?.[powerEntitlementKey(flag)] === false) return false;
  const ov = u.permissions?.[flag];
  if (ov === "on" || ov === "pin") return true;
  if (ov === "off") return false;
  return !!r?.manager_permissions?.[flag];
}
const denied = (what: string) => err(`Your owner hasn't given managers permission to ${what}.`, 403);
const actorOf = (g: { user: StaffUser | null }) =>
  g.user ? `${g.user.name || g.user.username} (${g.user.role})` : "admin";

// ── photo upload (bill / slip / waste / expense) → the public inv-media bucket ──
const INV_BUCKET = "inv-media";
async function savePhoto(rid: string, file: File | null): Promise<string | null> {
  if (!file || !file.size) return null;
  if (file.size > 8 * 1024 * 1024) throw new Error("Photo too large (max 8 MB).");
  const ext = (file.type.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
  const path = `${rid}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const up = await sb.storage.from(INV_BUCKET).upload(path, buf, { contentType: file.type || "image/jpeg", upsert: false });
  if (up.error) throw new Error(up.error.message);
  return sb.storage.from(INV_BUCKET).getPublicUrl(path).data.publicUrl;
}

// A write body is either plain JSON, or multipart (photo file + a `payload` JSON field).
async function readBody(req: NextRequest): Promise<{ body: Record<string, unknown>; photo: File | null }> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(String(fd.get("payload") || "{}")); } catch { /* -> {} */ }
    const photo = fd.get("photo");
    return { body, photo: photo instanceof File ? photo : null };
  }
  return { body: (await req.json().catch(() => ({}))) as Record<string, unknown>, photo: null };
}

// The one stock write path. Returns the movement id, or null on a dedupe replay.
async function postMovement(p: {
  rid: string; item: string; qty: number; kind: string; dedupe: string;
  unitCost?: number | null; reason?: string | null; refType?: string | null; refId?: string | null; by?: string | null;
}): Promise<number | null> {
  const r = await sb.rpc("lfh_inv_post_movement", {
    p_restaurant: p.rid, p_item: p.item, p_qty_base: p.qty, p_kind: p.kind, p_dedupe: p.dedupe,
    p_unit_cost: p.unitCost ?? null, p_reason: p.reason ?? null,
    p_ref_type: p.refType ?? null, p_ref_id: p.refId ?? null, p_created_by: p.by ?? null,
  });
  if (r.error) throw new Error(r.error.message);
  return (r.data as number | null) ?? null;
}

// Column lists (explicit everywhere — never select * on these paths).
const ITEM_COLS = "id, name, category, storage_area, track_level, base_uom, purchase_uom, purchase_factor, par_qty, min_qty, qty_base, avg_cost, last_rate, default_vendor_id, active, recipe_batch_base";
const PURCHASE_COLS = "id, kind, vendor_id, vendor_name, bill_no, bill_date, photo_url, subtotal, tax, total, note, created_by, created_at, voided_at, void_reason";
const EXPENSE_COLS = "id, category, title, amount, expense_date, note, photo_url, created_by, created_at, voided_at, void_reason, voided_by";
const WASTE_COLS = "id, item_id, qty_base, reason, note, photo_url, unit_cost_snap, waste_date, created_by, created_at, voided_at";

const VALID_UOMS = new Set(["g", "ml", "pc"]);
const EXPENSE_CATS = new Set(["breakage", "repair", "utilities", "cleaning", "supplies", "rent", "transport", "misc"]);
const WASTE_REASONS = new Set(["spoiled", "burnt", "spilled", "expired", "staff_meal", "complimentary", "other"]);

// ═════════════════════════════════════ GET ═════════════════════════════════════
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const g = await gate(req);
  if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  if (!rid) return err("No restaurant scope.", 400);
  if (!(await moduleOn(g, rid))) return err("Inventory isn't enabled for this restaurant.", 403);
  const path = (await ctx.params).path || [];
  const q = req.nextUrl.searchParams;

  try {
    // whoami — the manager UI asks once per open which buttons to draw. Server-side
    // gates above re-check every write, so this is display truth only.
    if (path[0] === "whoami") {
      const [canStock, canExp] = await Promise.all([invCan(g, rid, "inv_stock"), invCan(g, rid, "inv_expenses")]);
      return ok({ role: g.user?.role || "admin", can: { stock: canStock, expenses: canExp } });
    }

    if (path[0] === "items") {
      const inactive = q.get("all") === "1";
      let sel = sb.from("inv_items").select(ITEM_COLS).eq("restaurant_id", rid)
        .order("category").order("name").limit(500);
      if (!inactive) sel = sel.eq("active", true);
      const r = await sel;
      if (r.error) return err(r.error.message, 500);
      return ok({ items: r.data });
    }

    if (path[0] === "vendors") {
      const r = await sb.from("inv_vendors").select("id, name, phone, gstin, note, active")
        .eq("restaurant_id", rid).eq("active", true).order("name").limit(200);
      if (r.error) return err(r.error.message, 500);
      return ok({ vendors: r.data });
    }

    if (path[0] === "purchases" && !path[1]) {
      const lim = Math.min(Math.max(num(q.get("limit")) || 30, 1), 100);
      const r = await sb.from("inv_purchases").select(PURCHASE_COLS).eq("restaurant_id", rid)
        .order("created_at", { ascending: false }).limit(lim);
      if (r.error) return err(r.error.message, 500);
      return ok({ purchases: r.data });
    }
    if (path[0] === "purchases" && path[1]) {
      const [p, lines] = await Promise.all([
        sb.from("inv_purchases").select(PURCHASE_COLS).eq("restaurant_id", rid).eq("id", path[1]).maybeSingle(),
        sb.from("inv_purchase_lines").select("id, item_id, qty_purchase, qty_base, rate, amount")
          .eq("restaurant_id", rid).eq("purchase_id", path[1]).limit(200),
      ]);
      if (p.error || !p.data) return err("Purchase not found.", 404);
      return ok({ purchase: p.data, lines: lines.data || [] });
    }

    if (path[0] === "counts" && !path[1]) {
      const r = await sb.from("inv_counts").select("id, status, count_date, note, created_by, created_at, submitted_at")
        .eq("restaurant_id", rid).order("created_at", { ascending: false }).limit(30);
      if (r.error) return err(r.error.message, 500);
      return ok({ counts: r.data });
    }
    if (path[0] === "counts" && path[1]) {
      const [c, lines] = await Promise.all([
        sb.from("inv_counts").select("id, status, count_date, note, created_by, created_at, submitted_at")
          .eq("restaurant_id", rid).eq("id", path[1]).maybeSingle(),
        sb.from("inv_count_lines").select("id, item_id, counted_base, system_base, unit_cost_snap")
          .eq("restaurant_id", rid).eq("count_id", path[1]).limit(600),
      ]);
      if (c.error || !c.data) return err("Count not found.", 404);
      return ok({ count: c.data, lines: lines.data || [] });
    }

    if (path[0] === "waste") {
      const days = Math.min(Math.max(num(q.get("days")) || 30, 1), 90);
      const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
      const r = await sb.from("inv_waste_entries").select(WASTE_COLS).eq("restaurant_id", rid)
        .gte("waste_date", from).order("created_at", { ascending: false }).limit(200);
      if (r.error) return err(r.error.message, 500);
      return ok({ waste: r.data });
    }

    if (path[0] === "expenses") {
      // month=YYYY-MM (defaults to the current IST month). Voided rows stay visible
      // (struck through in the UI) — totals exclude them.
      const month = /^\d{4}-\d{2}$/.test(q.get("month") || "") ? q.get("month")! : istToday().slice(0, 7);
      const from = `${month}-01`;
      const to = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
      const r = await sb.from("expenses").select(EXPENSE_COLS).eq("restaurant_id", rid)
        .gte("expense_date", from).lte("expense_date", to)
        .order("expense_date", { ascending: false }).order("created_at", { ascending: false }).limit(300);
      if (r.error) return err(r.error.message, 500);
      const totals: Record<string, number> = {};
      let total = 0;
      for (const e of r.data || []) {
        if (e.voided_at) continue;
        totals[e.category] = (totals[e.category] || 0) + Number(e.amount);
        total += Number(e.amount);
      }
      return ok({ month, expenses: r.data, totals, total: Math.round(total * 100) / 100 });
    }

    // The hook: "what to order today" — par-based suggestions in purchase units.
    if (path[0] === "order-list") {
      const r = await sb.from("inv_items")
        .select("id, name, category, purchase_uom, purchase_factor, par_qty, min_qty, qty_base, last_rate, default_vendor_id")
        .eq("restaurant_id", rid).eq("active", true).not("par_qty", "is", null).limit(500);
      if (r.error) return err(r.error.message, 500);
      const list = (r.data || [])
        .filter((i) => Number(i.qty_base) < Number(i.par_qty))
        .map((i) => {
          const needBase = Number(i.par_qty) - Number(i.qty_base);
          const buy = Math.ceil((needBase / Number(i.purchase_factor)) * 10) / 10; // 1 decimal, round UP
          return { ...i, suggest: buy, urgent: i.min_qty != null && Number(i.qty_base) <= Number(i.min_qty) };
        })
        .sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.name.localeCompare(b.name));
      return ok({ list });
    }

    // Data-hygiene worklist: negative stock = almost always an un-entered purchase.
    if (path[0] === "negative") {
      const r = await sb.from("inv_items").select("id, name, category, base_uom, qty_base, purchase_uom, purchase_factor")
        .eq("restaurant_id", rid).eq("active", true).lt("qty_base", 0).limit(100);
      if (r.error) return err(r.error.message, 500);
      return ok({ items: r.data });
    }

    // ── Stage 2: recipes / usage reads ────────────────────────────────────────
    // All dishes + every dish recipe line in two scoped selects. Costs are computed
    // client-side from the already-loaded item avg_costs (no extra reads).
    if (path[0] === "recipes" && !path[1]) {
      const [dishes, lines] = await Promise.all([
        sb.from("menu_items").select("slug, title, price").eq("restaurant_id", rid).order("title").limit(500),
        sb.from("inv_recipe_lines").select("owner_type, owner_key, item_id, qty_base")
          .eq("restaurant_id", rid).limit(3000),
      ]);
      if (dishes.error) return err(dishes.error.message, 500);
      // A failed lines read must be an ERROR, never an empty list — otherwise every
      // dish renders "no recipe" and a well-meaning Save would wipe the real lines.
      if (lines.error) return err(lines.error.message, 500);
      return ok({
        dishes: (dishes.data || []).map((d) => ({
          slug: d.slug,
          title: typeof d.title === "object" && d.title ? ((d.title as Record<string, string>).en || Object.values(d.title as Record<string, string>)[0]) : String(d.title || d.slug),
          price: Number(d.price) || 0,
        })),
        lines: lines.data || [],
      });
    }

    // Usage / variance: one SQL aggregate per window (never sum the ledger client-side).
    if (path[0] === "usage") {
      const days = Math.min(Math.max(num(q.get("days")) || 7, 1), 90);
      const from = new Date(Date.now() - days * 86400_000).toISOString();
      const r = await sb.rpc("lfh_inv_usage_report", { p_restaurant: rid, p_from: from, p_to: new Date().toISOString() });
      if (r.error) return err(r.error.message, 500);
      return ok({ days, rows: r.data || [] });
    }

    // Per-item ledger (the "Item Activity" view) — newest 50 movements.
    if (path[0] === "movements") {
      const item = q.get("item") || "";
      if (!item) return err("item required");
      const r = await sb.from("inv_movements").select("id, qty_base, kind, reason, ref_type, ref_id, unit_cost, created_by, created_at")
        .eq("restaurant_id", rid).eq("item_id", item).order("id", { ascending: false }).limit(50);
      if (r.error) return err(r.error.message, 500);
      return ok({ movements: r.data });
    }

    return err("Unknown inventory path.", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : "Inventory read failed.", 500);
  }
}

// ═════════════════════════════════════ POST ════════════════════════════════════
export const POST = withIdempotency(async (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => {
  const g = await gate(req);
  if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  if (!rid) return err("No restaurant scope.", 400);
  if (!(await moduleOn(g, rid))) return err("Inventory isn't enabled for this restaurant.", 403);
  const path = (await ctx.params).path || [];
  const actor = actorOf(g);
  const actorId = g.user?.id || null;

  try {
    // ── expenses: the broken-lamp flow ─────────────────────────────────────────
    if (path[0] === "expenses" && !path[1]) {
      if (!(await invCan(g, rid, "inv_expenses"))) return denied("record expenses");
      const { body, photo } = await readBody(req);
      const category = String(body.category || "");
      const title = String(body.title || "").trim().slice(0, 120);
      const amount = num(body.amount);
      if (!EXPENSE_CATS.has(category)) return err("Pick a category.");
      if (!title) return err("Say what it was (e.g. “Bar lamp broken”).");
      if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) return err("Enter a valid amount.");
      const photo_url = await savePhoto(rid, photo);
      const ins = await sb.from("expenses").insert({
        restaurant_id: rid, category, title, amount,
        expense_date: isDate(body.expense_date) ? body.expense_date : istToday(),
        note: body.note ? String(body.note).slice(0, 500) : null,
        photo_url, created_by: actor, created_by_id: actorId,
      }).select("id").single();
      if (ins.error) return err(ins.error.message, 500);
      await logAction("manager", "expense_add", { restaurant_id: rid, actor, actor_id: actorId, detail: `${category}: ${title} — ₹${amount}` });
      return ok({ id: ins.data.id });
    }
    if (path[0] === "expenses" && path[1] && path[2] === "void") {
      if (!(await invCan(g, rid, "inv_expenses"))) return denied("record expenses");
      const { body } = await readBody(req);
      const reason = String(body.reason || "").trim();
      if (!reason) return err("A reason is required to strike out an entry.");
      const up = await sb.from("expenses").update({ voided_at: new Date().toISOString(), void_reason: reason.slice(0, 300), voided_by: actor })
        .eq("restaurant_id", rid).eq("id", path[1]).is("voided_at", null).select("id, title");
      if (up.error) return err(up.error.message, 500);
      if (!up.data?.length) return err("Entry not found or already struck out.", 404);
      await logAction("manager", "expense_void", { restaurant_id: rid, actor, actor_id: actorId, detail: `${up.data[0].title}: ${reason}` });
      return ok();
    }

    // Everything below is the stock register.
    if (!(await invCan(g, rid, "inv_stock"))) return denied("manage stock");

    // ── Stage 2: recipe writes + prep production ──────────────────────────────
    // Replace a dish's (or prep item's) ingredient list in one go. Lines are validated
    // against THIS restaurant's items; a prep recipe may not contain itself.
    if (path[0] === "recipes" && (path[1] === "dish" || path[1] === "prep") && path[2]) {
      const ownerType = path[1];
      const ownerKey = decodeURIComponent(path[2]);
      const { body } = await readBody(req);
      // Server-side last-wins dedupe by item_id: a payload with the same ingredient
      // twice must never reach the delete-then-insert (the UNIQUE index would fail the
      // insert AFTER the old lines were deleted — a wiped recipe). Never trust the UI.
      const byItem = new Map<string, number>();
      for (const l of Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : []) {
        const id = String(l.item_id || "");
        const qty = num(l.qty_base);
        if (!id || !Number.isFinite(qty) || qty <= 0) return err("Bad recipe line.");
        byItem.set(id, qty);
      }
      if (byItem.size > 60) return err("Too many ingredients (max 60).");
      const ids = [...byItem.keys()];
      if (ids.includes(ownerKey)) return err("A prep recipe can't contain itself.");
      let batch: number | null = null;
      if (ownerType === "dish") {
        const dish = await sb.from("menu_items").select("slug").eq("restaurant_id", rid).eq("slug", ownerKey).maybeSingle();
        if (!dish.data) return err("Dish not found.", 404);
      } else {
        const prep = await sb.from("inv_items").select("id").eq("restaurant_id", rid).eq("id", ownerKey).maybeSingle();
        if (!prep.data) return err("Prep ingredient not found.", 404);
        batch = num(body.batch_base);
        if (!Number.isFinite(batch) || batch <= 0) return err("Say how much one batch makes.");
      }
      if (ids.length) {
        const found = await sb.from("inv_items").select("id").eq("restaurant_id", rid).in("id", ids).limit(100);
        if ((found.data || []).length !== ids.length) return err("A line refers to an unknown ingredient.");
      }
      // All validation passed — only now write anything (no partial saves).
      if (ownerType === "prep") {
        await sb.from("inv_items").update({ recipe_batch_base: batch, updated_at: new Date().toISOString() })
          .eq("restaurant_id", rid).eq("id", ownerKey);
      }
      const lines = ids.map((id) => ({ restaurant_id: rid, owner_type: ownerType, owner_key: ownerKey, item_id: id, qty_base: byItem.get(id)! }));
      const del = await sb.from("inv_recipe_lines").delete().eq("restaurant_id", rid).eq("owner_type", ownerType).eq("owner_key", ownerKey);
      if (del.error) return err(del.error.message, 500);
      if (lines.length) {
        const ins = await sb.from("inv_recipe_lines").insert(lines);
        if (ins.error) return err(ins.error.message, 500);
      }
      await logAction("manager", "inv_recipe_save", { restaurant_id: rid, actor, actor_id: actorId, detail: `${ownerType} ${ownerKey}: ${lines.length} ingredients` });
      return ok({ lines: lines.length });
    }

    // Make a batch of a prep item: consume its recipe's ingredients (scaled), add the
    // produced quantity to stock at the batch's real cost. Keys ride the request's
    // idempotency id, so a replay can never brew the batch twice.
    if (path[0] === "production") {
      const { body } = await readBody(req);
      const itemId = String(body.item_id || "");
      const madeBase = num(body.qty_base);
      if (!itemId || !Number.isFinite(madeBase) || madeBase <= 0) return err("How much did you make?");
      const it = await sb.from("inv_items").select("id, name, recipe_batch_base").eq("restaurant_id", rid).eq("id", itemId).maybeSingle();
      if (!it.data) return err("Ingredient not found.", 404);
      if (!it.data.recipe_batch_base) return err("This ingredient has no prep recipe yet.");
      const lines = await sb.from("inv_recipe_lines").select("item_id, qty_base")
        .eq("restaurant_id", rid).eq("owner_type", "prep").eq("owner_key", itemId).limit(100);
      if (!lines.data?.length) return err("This ingredient has no prep recipe yet.");
      const scale = madeBase / Number(it.data.recipe_batch_base);
      const costs = await sb.from("inv_items").select("id, avg_cost").eq("restaurant_id", rid)
        .in("id", lines.data.map((l) => l.item_id)).limit(100);
      const costOf = new Map((costs.data || []).map((c) => [c.id, Number(c.avg_cost)]));
      const prodId = req.headers.get("x-lfh-action-id") || crypto.randomUUID();
      let batchCost = 0;
      for (const l of lines.data) {
        const use = Number(l.qty_base) * scale;
        batchCost += use * (costOf.get(l.item_id) || 0);
        await postMovement({ rid, item: l.item_id, qty: -use, kind: "production", dedupe: `prod:${prodId}:in:${l.item_id}`, refType: "production", refId: prodId, by: actor });
      }
      await postMovement({
        rid, item: itemId, qty: madeBase, kind: "production", dedupe: `prod:${prodId}:out`,
        unitCost: madeBase > 0 ? batchCost / madeBase : 0, refType: "production", refId: prodId, by: actor,
      });
      await logAction("manager", "inv_production", { restaurant_id: rid, actor, actor_id: actorId, detail: `${it.data.name}: batch of ${madeBase} (₹${Math.round(batchCost * 100) / 100})` });
      return ok({ cost: Math.round(batchCost * 100) / 100 });
    }

    // ── items ──────────────────────────────────────────────────────────────────
    if (path[0] === "items" && !path[1]) {
      const { body } = await readBody(req);
      const name = String(body.name || "").trim().slice(0, 80);
      if (!name) return err("The ingredient needs a name.");
      const base_uom = VALID_UOMS.has(String(body.base_uom)) ? String(body.base_uom) : "g";
      const purchase_factor = num(body.purchase_factor);
      if (!Number.isFinite(purchase_factor) || purchase_factor <= 0) return err("How many base units is one purchase unit?");
      const ins = await sb.from("inv_items").insert({
        restaurant_id: rid, name,
        category: String(body.category || "general").slice(0, 40),
        storage_area: body.storage_area ? String(body.storage_area).slice(0, 40) : null,
        track_level: ["FULL", "COUNT_ONLY", "EXPENSE"].includes(String(body.track_level)) ? body.track_level : "FULL",
        base_uom, purchase_uom: String(body.purchase_uom || "kg").slice(0, 12), purchase_factor,
        par_qty: Number.isFinite(num(body.par_qty)) ? num(body.par_qty) : null,
        min_qty: Number.isFinite(num(body.min_qty)) ? num(body.min_qty) : null,
        last_rate: Number.isFinite(num(body.last_rate)) ? num(body.last_rate) : null,
        default_vendor_id: body.default_vendor_id || null,
        created_by: actor,
      }).select("id").single();
      if (ins.error) return err(ins.error.code === "23505" ? "An ingredient with this name already exists." : ins.error.message, 500);
      // Optional opening stock in BASE units — posted as a proper movement so the
      // ledger explains the balance from day one.
      const opening = num(body.opening_qty);
      if (Number.isFinite(opening) && opening > 0) {
        const openCost = Number.isFinite(num(body.last_rate)) && purchase_factor > 0 ? num(body.last_rate) / purchase_factor : 0;
        await postMovement({ rid, item: ins.data.id, qty: opening, kind: "opening", dedupe: `open:${ins.data.id}`, unitCost: openCost, refType: "item", refId: ins.data.id, by: actor });
      }
      return ok({ id: ins.data.id });
    }
    if (path[0] === "items" && path[1]) {
      const { body } = await readBody(req);
      const patch: Record<string, unknown> = {};
      if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
      if (typeof body.category === "string") patch.category = body.category.slice(0, 40);
      if ("storage_area" in body) patch.storage_area = body.storage_area ? String(body.storage_area).slice(0, 40) : null;
      if (["FULL", "COUNT_ONLY", "EXPENSE"].includes(String(body.track_level))) patch.track_level = body.track_level;
      if (typeof body.purchase_uom === "string" && body.purchase_uom) patch.purchase_uom = String(body.purchase_uom).slice(0, 12);
      if (Number.isFinite(num(body.purchase_factor)) && num(body.purchase_factor) > 0) patch.purchase_factor = num(body.purchase_factor);
      if ("par_qty" in body) patch.par_qty = Number.isFinite(num(body.par_qty)) ? num(body.par_qty) : null;
      if ("min_qty" in body) patch.min_qty = Number.isFinite(num(body.min_qty)) ? num(body.min_qty) : null;
      if ("default_vendor_id" in body) patch.default_vendor_id = body.default_vendor_id || null;
      if (typeof body.active === "boolean") patch.active = body.active;
      // base_uom is the ledger's unit — changing it after movements exist would silently
      // re-scale history, so it's only editable while the item has never moved.
      if (VALID_UOMS.has(String(body.base_uom))) {
        const moved = await sb.from("inv_movements").select("id").eq("restaurant_id", rid).eq("item_id", path[1]).limit(1);
        if (moved.data?.length) {
          const cur = await sb.from("inv_items").select("base_uom").eq("restaurant_id", rid).eq("id", path[1]).maybeSingle();
          if (cur.data && cur.data.base_uom !== body.base_uom)
            return err("This ingredient already has stock history — its base unit can't change. Make a new ingredient instead.");
        } else patch.base_uom = body.base_uom;
      }
      if (!Object.keys(patch).length) return err("Nothing to update.");
      patch.updated_at = new Date().toISOString();
      const up = await sb.from("inv_items").update(patch).eq("restaurant_id", rid).eq("id", path[1]).select("id");
      if (up.error) return err(up.error.code === "23505" ? "An ingredient with this name already exists." : up.error.message, 500);
      if (!up.data?.length) return err("Ingredient not found.", 404);
      return ok();
    }

    // ── vendors ────────────────────────────────────────────────────────────────
    if (path[0] === "vendors" && !path[1]) {
      const { body } = await readBody(req);
      const name = String(body.name || "").trim().slice(0, 80);
      if (!name) return err("The supplier needs a name.");
      const ins = await sb.from("inv_vendors").insert({
        restaurant_id: rid, name, phone: body.phone ? String(body.phone).slice(0, 20) : null,
        gstin: body.gstin ? String(body.gstin).slice(0, 20) : null, note: body.note ? String(body.note).slice(0, 300) : null,
      }).select("id").single();
      if (ins.error) return err(ins.error.message, 500);
      return ok({ id: ins.data.id });
    }
    if (path[0] === "vendors" && path[1]) {
      const { body } = await readBody(req);
      const patch: Record<string, unknown> = {};
      if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
      if ("phone" in body) patch.phone = body.phone ? String(body.phone).slice(0, 20) : null;
      if ("gstin" in body) patch.gstin = body.gstin ? String(body.gstin).slice(0, 20) : null;
      if ("note" in body) patch.note = body.note ? String(body.note).slice(0, 300) : null;
      if (typeof body.active === "boolean") patch.active = body.active;
      if (!Object.keys(patch).length) return err("Nothing to update.");
      const up = await sb.from("inv_vendors").update(patch).eq("restaurant_id", rid).eq("id", path[1]).select("id");
      if (up.error) return err(up.error.message, 500);
      if (!up.data?.length) return err("Supplier not found.", 404);
      return ok();
    }

    // ── purchases: vendor bill OR the 60-second cash market buy ────────────────
    if (path[0] === "purchases" && !path[1]) {
      const { body, photo } = await readBody(req);
      const kind = body.kind === "cash" ? "cash" : "bill";
      const rawLines = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : [];
      if (!rawLines.length || rawLines.length > 100) return err("Add at least one line (max 100).");
      // Resolve every line's item in ONE scoped select.
      const ids = [...new Set(rawLines.map((l) => String(l.item_id || "")))].filter(Boolean);
      const items = await sb.from("inv_items").select("id, name, purchase_factor, track_level")
        .eq("restaurant_id", rid).in("id", ids).limit(100);
      if (items.error) return err(items.error.message, 500);
      const byId = new Map((items.data || []).map((i) => [i.id, i]));
      let subtotal = 0;
      const lines = rawLines.map((l) => {
        const it = byId.get(String(l.item_id));
        if (!it) throw new Error("A line refers to an unknown ingredient.");
        const qty = num(l.qty_purchase); const rate = num(l.rate);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Quantity missing for ${it.name}.`);
        if (!Number.isFinite(rate) || rate < 0) throw new Error(`Rate missing for ${it.name}.`);
        const amount = Math.round(qty * rate * 100) / 100;
        subtotal += amount;
        return { item_id: it.id, qty_purchase: qty, qty_base: qty * Number(it.purchase_factor), rate, amount, factor: Number(it.purchase_factor), track: it.track_level };
      });
      const tax = Number.isFinite(num(body.tax)) && num(body.tax) >= 0 ? num(body.tax) : 0;
      subtotal = Math.round(subtotal * 100) / 100;
      const photo_url = await savePhoto(rid, photo);
      const vendor_name = body.vendor_name ? String(body.vendor_name).slice(0, 80) : null;
      const ins = await sb.from("inv_purchases").insert({
        restaurant_id: rid, kind, vendor_id: body.vendor_id || null, vendor_name,
        bill_no: body.bill_no ? String(body.bill_no).slice(0, 40) : null,
        bill_date: isDate(body.bill_date) ? body.bill_date : istToday(),
        photo_url, subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100,
        note: body.note ? String(body.note).slice(0, 500) : null,
        created_by: actor, created_by_id: actorId,
      }).select("id").single();
      if (ins.error) return err(ins.error.message, 500);
      const pid = ins.data.id as string;
      const li = await sb.from("inv_purchase_lines").insert(lines.map((l) => ({
        purchase_id: pid, restaurant_id: rid, item_id: l.item_id,
        qty_purchase: l.qty_purchase, qty_base: l.qty_base, rate: l.rate, amount: l.amount,
      }))).select("id, item_id");
      if (li.error) return err(li.error.message, 500);
      // Stock in + WAC + last_rate, one movement per line, keyed on the LINE id so a
      // retry of this handler (idempotency header lost, network replay) can't double-post.
      for (const row of li.data || []) {
        const l = lines.find((x) => x.item_id === row.item_id)!;
        if (l.track === "EXPENSE") continue; // spend-only items never hold stock
        await postMovement({
          rid, item: l.item_id, qty: l.qty_base, kind: "purchase", dedupe: `pur:${pid}:${row.id}`,
          unitCost: l.factor > 0 ? l.rate / l.factor : 0, refType: "purchase", refId: pid, by: actor,
        });
        await sb.from("inv_items").update({ last_rate: l.rate, updated_at: new Date().toISOString() })
          .eq("restaurant_id", rid).eq("id", l.item_id);
      }
      await logAction("manager", "inv_purchase", { restaurant_id: rid, actor, actor_id: actorId, detail: `${kind === "cash" ? "Cash buy" : `Bill${vendor_name ? ` — ${vendor_name}` : ""}`}: ₹${subtotal + tax} (${lines.length} items)` });
      return ok({ id: pid });
    }
    if (path[0] === "purchases" && path[1] && path[2] === "void") {
      const { body } = await readBody(req);
      const reason = String(body.reason || "").trim();
      if (!reason) return err("A reason is required to void a purchase.");
      const up = await sb.from("inv_purchases").update({ voided_at: new Date().toISOString(), void_reason: reason.slice(0, 300), voided_by: actor })
        .eq("restaurant_id", rid).eq("id", path[1]).is("voided_at", null).select("id");
      if (up.error) return err(up.error.message, 500);
      if (!up.data?.length) return err("Purchase not found or already voided.", 404);
      // Reverse each line — keyed on the line id, so a re-run reverses nothing twice.
      const lines = await sb.from("inv_purchase_lines").select("id, item_id, qty_base")
        .eq("restaurant_id", rid).eq("purchase_id", path[1]).limit(200);
      for (const l of lines.data || []) {
        await postMovement({ rid, item: l.item_id, qty: -Number(l.qty_base), kind: "purchase_void", dedupe: `purvoid:${path[1]}:${l.id}`, reason, refType: "purchase", refId: path[1], by: actor });
      }
      await logAction("manager", "inv_purchase_void", { restaurant_id: rid, actor, actor_id: actorId, detail: reason });
      return ok();
    }

    // ── counts: draft → save lines → submit ────────────────────────────────────
    if (path[0] === "counts" && !path[1]) {
      const { body } = await readBody(req);
      const ins = await sb.from("inv_counts").insert({
        restaurant_id: rid, note: body.note ? String(body.note).slice(0, 300) : null,
        created_by: actor, created_by_id: actorId,
      }).select("id").single();
      if (ins.error) return err(ins.error.message, 500);
      return ok({ id: ins.data.id });
    }
    if (path[0] === "counts" && path[1] && path[2] === "line") {
      const { body } = await readBody(req);
      const itemId = String(body.item_id || "");
      const counted = num(body.counted_base);
      if (!itemId || !Number.isFinite(counted) || counted < 0) return err("Bad count line.");
      const c = await sb.from("inv_counts").select("id, status").eq("restaurant_id", rid).eq("id", path[1]).maybeSingle();
      if (!c.data || c.data.status !== "draft") return err("This count is no longer open.", 409);
      const it = await sb.from("inv_items").select("qty_base, avg_cost").eq("restaurant_id", rid).eq("id", itemId).maybeSingle();
      if (!it.data) return err("Ingredient not found.", 404);
      // One row per (count, item): re-saving replaces the line (the counter corrected
      // themselves mid-count). system/cost snapshots freeze at line-save time.
      const upsert = await sb.from("inv_count_lines").upsert({
        count_id: path[1], restaurant_id: rid, item_id: itemId,
        counted_base: counted, system_base: Number(it.data.qty_base), unit_cost_snap: Number(it.data.avg_cost),
      }, { onConflict: "count_id,item_id" }).select("id");
      if (upsert.error) return err(upsert.error.message, 500);
      return ok();
    }
    if (path[0] === "counts" && path[1] && path[2] === "submit") {
      const c = await sb.from("inv_counts").select("id, status").eq("restaurant_id", rid).eq("id", path[1]).maybeSingle();
      if (!c.data) return err("Count not found.", 404);
      if (c.data.status !== "draft") return err("This count was already submitted.", 409);
      const lines = await sb.from("inv_count_lines").select("item_id, counted_base")
        .eq("restaurant_id", rid).eq("count_id", path[1]).limit(600);
      if (lines.error) return err(lines.error.message, 500);
      if (!lines.data?.length) return err("Count at least one item before submitting.");
      let adjusted = 0;
      for (const l of lines.data) {
        // Adjust against the LIVE balance at submit (sales/purchases during the count
        // stay correct); the movement is valued at the item's current average cost.
        const live = await sb.from("inv_items").select("qty_base").eq("restaurant_id", rid).eq("id", l.item_id).maybeSingle();
        const delta = Number(l.counted_base) - Number(live.data?.qty_base ?? 0);
        if (Math.abs(delta) < 0.0001) continue;
        const posted = await postMovement({ rid, item: l.item_id, qty: delta, kind: "count_adjust", dedupe: `cnt:${path[1]}:${l.item_id}`, reason: "physical count", refType: "count", refId: path[1], by: actor });
        if (posted !== null) adjusted++;
      }
      await sb.from("inv_counts").update({ status: "submitted", submitted_at: new Date().toISOString(), submitted_by: actor })
        .eq("restaurant_id", rid).eq("id", path[1]);
      await logAction("manager", "inv_count_submit", { restaurant_id: rid, actor, actor_id: actorId, detail: `${lines.data.length} items counted, ${adjusted} adjusted` });
      return ok({ adjusted });
    }
    if (path[0] === "counts" && path[1] && path[2] === "discard") {
      const up = await sb.from("inv_counts").update({ status: "discarded" })
        .eq("restaurant_id", rid).eq("id", path[1]).eq("status", "draft").select("id");
      if (!up.data?.length) return err("Only an open draft can be discarded.", 409);
      return ok();
    }

    // ── waste ──────────────────────────────────────────────────────────────────
    if (path[0] === "waste" && !path[1]) {
      const { body, photo } = await readBody(req);
      const itemId = String(body.item_id || "");
      const qty = num(body.qty_base);
      const reason = String(body.reason || "");
      if (!itemId || !Number.isFinite(qty) || qty <= 0) return err("Pick an ingredient and quantity.");
      if (!WASTE_REASONS.has(reason)) return err("Pick a reason.");
      const it = await sb.from("inv_items").select("id, avg_cost").eq("restaurant_id", rid).eq("id", itemId).maybeSingle();
      if (!it.data) return err("Ingredient not found.", 404);
      const photo_url = await savePhoto(rid, photo);
      const ins = await sb.from("inv_waste_entries").insert({
        restaurant_id: rid, item_id: itemId, qty_base: qty, reason,
        note: body.note ? String(body.note).slice(0, 300) : null, photo_url,
        unit_cost_snap: Number(it.data.avg_cost), created_by: actor, created_by_id: actorId,
      }).select("id").single();
      if (ins.error) return err(ins.error.message, 500);
      await postMovement({ rid, item: itemId, qty: -qty, kind: "waste", dedupe: `waste:${ins.data.id}`, reason, refType: "waste", refId: ins.data.id, by: actor });
      await logAction("manager", "inv_waste", { restaurant_id: rid, actor, actor_id: actorId, detail: `${reason} — ₹${Math.round(qty * Number(it.data.avg_cost) * 100) / 100}` });
      return ok({ id: ins.data.id });
    }
    if (path[0] === "waste" && path[1] && path[2] === "void") {
      const { body } = await readBody(req);
      const reason = String(body.reason || "").trim();
      if (!reason) return err("A reason is required.");
      const up = await sb.from("inv_waste_entries").update({ voided_at: new Date().toISOString(), void_reason: reason.slice(0, 300), voided_by: actor })
        .eq("restaurant_id", rid).eq("id", path[1]).is("voided_at", null).select("id, item_id, qty_base");
      if (up.error) return err(up.error.message, 500);
      if (!up.data?.length) return err("Entry not found or already struck out.", 404);
      const w = up.data[0];
      await postMovement({ rid, item: w.item_id, qty: Number(w.qty_base), kind: "waste_void", dedupe: `wastevoid:${path[1]}`, reason, refType: "waste", refId: path[1], by: actor });
      return ok();
    }

    return err("Unknown inventory path.", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : "Inventory write failed.", 500);
  }
}, "inventory");
