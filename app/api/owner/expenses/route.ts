// /api/owner/expenses — the OWNER's own expense book (the `expenses` table, mig 221 §G).
//
// The same money the manager records under Inventory → 💸 Expenses, but as a first-class
// owner section: the owner opens ONE page and sees every rupee that left the business in a
// period, who wrote it down, the photo of the broken lamp, and the struck-out entries.
//
// WHO can call (lib/ownerScope):
//   • ADMIN super-user            → any restaurant (never entitlement-gated: admin = top power).
//   • OWNER (role=owner)          → only restaurants they own AND that still have the
//                                   admin-controlled "expenses" section (mig 133 ladder).
// Anyone else → 401.
//
//   GET  ?rid&from&to&category&refresh  → { restaurants, expenses, total, byCategory, … }
//   POST { action:"add" }               → record an expense (JSON, or multipart with a photo)
//   POST { action:"void", id, reason }  → strike one out. A reason is REQUIRED.
//
// APPEND-ONLY, DELIBERATELY (docs/COMPLIANCE-GUARDRAILS.md §3). There is no delete here and
// there must never be one: an expense is struck out with a reason, keeps its row, and stays
// VISIBLE in the list (line-through) — only the totals drop it. A tool that can make a
// recorded cost disappear without a trace is the tool that gets its makers summoned.
//
// Egress rules (docs/SAAS-EFFICIENCY-PLAYBOOK.md): every read is .eq("restaurant_id", rid)
// with an explicit column list and a .limit(); the list is served through the compute-on-view
// snapshot cache (lib/ownerCache) so a normal open is ONE row read, and only a changed
// fingerprint (or the Refresh button / a write) pays for a recompute.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope, type OwnerScope } from "@/lib/ownerScope";
import { entitledSubset } from "@/lib/ownerEntitlements";
import { cachedOwnerPayload, scopeKeyOf } from "@/lib/ownerCache";
import { withIdempotency } from "@/lib/idempotency";
import { expectClash, clashJson } from "@/lib/clash";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";
import { logAction } from "@/lib/oplog";
import { todayIST } from "@/lib/staffProfileShared";

export const dynamic = "force-dynamic";

const err = (m: string, status = 400, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: m, ...extra }, { status });
const ok = (body: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...body });

// The eight categories the CHECK constraint on expenses.category allows. Kept in step with
// migration 221 §G and with EXPENSE_CATS in /api/inventory — a ninth needs a migration first.
export const EXPENSE_CATEGORIES = [
  "breakage", "repair", "utilities", "cleaning", "supplies", "rent", "transport", "misc",
] as const;
const CATS = new Set<string>(EXPENSE_CATEGORIES);

const COLS = "id, category, title, amount, expense_date, note, photo_url, created_by, created_at, voided_at, void_reason, voided_by";
const PHOTO_BUCKET = "inv-media"; // the bucket the manager's expense photos already live in

const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const round2 = (n: number) => Math.round(n * 100) / 100;

// restaurants.name is a plain string on some rows and a JSONB of translations on others.
function restaurantName(name: unknown, slug: string): string {
  if (typeof name === "string" && name.trim()) return name;
  if (name && typeof name === "object") {
    const en = (name as Record<string, unknown>).en;
    if (typeof en === "string" && en.trim()) return en;
  }
  return slug;
}

// The restaurants this caller may reach. Admin-with-no-act-as ({all:true}) has no id list,
// so resolve one — the page needs a picker either way.
async function scopedIds(scope: OwnerScope): Promise<string[]> {
  if (!scope.all) return scope.ids;
  // Ordered by name so the admin's whole-platform view always defaults to the SAME
  // restaurant (an unordered select made the picker's default jump between opens).
  const r = await sb.from("restaurants").select("id").order("name").limit(500);
  return (r.data || []).map((x) => x.id as string);
}

// Narrow a real owner to the restaurants whose "expenses" section the admin still allows.
// Absent key = ON (lib/ownerEntitlements), so every restaurant has it until an admin says no.
// The ADMIN's own session is never gated — see the `admin` flag note in lib/ownerScope.
async function entitled(scope: OwnerScope, ids: string[]): Promise<string[] | null> {
  if (scope.all || scope.admin) return ids;
  const allowed = await entitledSubset(ids, "expenses");
  return allowed.length ? allowed : null;
}

// A write body is either plain JSON or multipart (a `payload` JSON field + a `photo` file) —
// the same contract the manager's expense form already uses.
async function readBody(req: NextRequest): Promise<{ body: Record<string, unknown>; photo: File | null }> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(String(fd.get("payload") || "{}")); } catch { /* → {} */ }
    const photo = fd.get("photo");
    return { body, photo: photo instanceof File ? photo : null };
  }
  return { body: (await req.json().catch(() => ({}))) as Record<string, unknown>, photo: null };
}

async function savePhoto(rid: string, file: File | null): Promise<string | null> {
  if (!file || !file.size) return null;
  if (file.size > 8 * 1024 * 1024) throw new Error("Photo too large (max 8 MB).");
  const ext = (file.type.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
  const path = `${rid}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const up = await sb.storage.from(PHOTO_BUCKET).upload(path, buf, { contentType: file.type || "image/jpeg", upsert: false });
  if (up.error) throw new Error(up.error.message);
  return sb.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Who to write into created_by / voided_by, in words the owner will recognise later.
async function actorOf(req: NextRequest): Promise<{ label: string; id: string | null }> {
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (u) return { label: `${u.name || u.username} (${u.role})`, id: u.id };
  return { label: "Aevidine admin", id: null };
}

// The period the page is looking at. `month=YYYY-MM` is the common case; an explicit
// from/to pair (inclusive, IST calendar dates) supports the custom range.
function periodOf(sp: URLSearchParams): { from: string; to: string; month: string | null } {
  const from = sp.get("from"), to = sp.get("to");
  if (isDate(from) && isDate(to) && from! <= to!) return { from: from!, to: to!, month: null };
  const month = /^\d{4}-\d{2}$/.test(sp.get("month") || "") ? sp.get("month")! : todayIST().slice(0, 7);
  const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
  return { from: `${month}-01`, to: last, month };
}

// ── GET · the list + its totals ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const scope = await ownerScope(req);
  if (!scope) return err("Not authorised.", 401);

  const ownIds = await scopedIds(scope);
  const allowed = await entitled(scope, ownIds);
  if (!allowed)
    return err("Expenses isn't enabled for your restaurant — contact Aevidine.", 403, { disabled: true });
  if (!allowed.length) return ok({ restaurants: [], rid: "", expenses: [], total: 0, byCategory: {} });

  // Expenses are per-restaurant (one kitchen's costs don't meaningfully sum with another's):
  // the page picks one and the picker lists the rest.
  const sp = req.nextUrl.searchParams;
  const asked = sp.get("rid") || "";
  if (asked && !allowed.includes(asked)) return err("Not your restaurant.", 403);
  const rid = asked || allowed[0];

  const rs = await sb.from("restaurants").select("id, name, slug").in("id", allowed).limit(200);
  const restaurants = (rs.data || []).map((r) => ({ id: r.id as string, name: restaurantName(r.name, r.slug as string) }));

  const { from, to, month } = periodOf(sp);
  const category = CATS.has(sp.get("category") || "") ? sp.get("category")! : "";
  const force = sp.get("refresh") === "1";

  // Change detector: the newest row's created_at plus the newest void stamp move on every
  // write that could alter this window, so an unchanged fingerprint means the stored
  // snapshot is still exact and the heavy read is skipped entirely.
  const fingerprint = async () => {
    const [created, voided] = await Promise.all([
      sb.from("expenses").select("created_at").eq("restaurant_id", rid)
        .order("created_at", { ascending: false }).limit(1),
      sb.from("expenses").select("voided_at").eq("restaurant_id", rid).not("voided_at", "is", null)
        .order("voided_at", { ascending: false }).limit(1),
    ]);
    return [(created.data || [])[0]?.created_at ?? "", (voided.data || [])[0]?.voided_at ?? ""].join("|");
  };

  try {
    const payload = await cachedOwnerPayload({
      key: `exp:v1:${scopeKeyOf(rid, false, [rid])}:${from}_${to}:${category || "all"}`,
      force,
      fingerprint,
      compute: async () => {
        let q = sb.from("expenses").select(COLS)
          .eq("restaurant_id", rid)
          .gte("expense_date", from).lte("expense_date", to)
          .order("expense_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(500);
        if (category) q = q.eq("category", category);
        const r = await q;
        if (r.error) throw new Error(r.error.message);
        const rows = (r.data || []) as Array<Record<string, unknown>>;

        // Voided rows stay in the LIST (never hidden) and out of every total.
        const byCategory: Record<string, number> = {};
        let total = 0, voidedTotal = 0, voidedCount = 0;
        for (const e of rows) {
          const amt = Number(e.amount) || 0;
          if (e.voided_at) { voidedTotal += amt; voidedCount++; continue; }
          byCategory[String(e.category)] = round2((byCategory[String(e.category)] || 0) + amt);
          total += amt;
        }
        const live = rows.length - voidedCount;
        return {
          rid, from, to, month, category,
          expenses: rows,
          total: round2(total),
          count: live,
          voidedTotal: round2(voidedTotal),
          voidedCount,
          average: live ? round2(total / live) : 0,
          byCategory,
          truncated: rows.length >= 500,
        };
      },
    });
    return NextResponse.json({ ...payload, restaurants });
  } catch (e) {
    return err(e instanceof Error ? e.message : "Couldn't load expenses.", 500);
  }
}

// ── POST · add one, or strike one out ─────────────────────────────────────────
// Wrapped with withIdempotency so a replayed offline write (X-LFH-Action-Id) runs AT MOST
// ONCE — a double-tap or a reconnect replay can never book the same cost twice.
async function handlePost(req: NextRequest): Promise<Response> {
  const scope = await ownerScope(req);
  if (!scope) return err("Not authorised.", 401);

  const { body, photo } = await readBody(req);
  const rid = String(body.rid || req.nextUrl.searchParams.get("rid") || "");
  if (!isUuid(rid)) return err("Pick a restaurant.");

  const ownIds = await scopedIds(scope);
  if (!ownIds.includes(rid)) return err("Not your restaurant.", 403);
  const allowed = await entitled(scope, [rid]);
  if (!allowed) return err("Expenses isn't enabled for your restaurant — contact Aevidine.", 403, { disabled: true });

  // "Did someone else change this while you had it open?" — the one shared gate
  // (CLAUDE.md → NO SILENT OVERWRITES). The void form sends what it was looking at
  // (voided_at: null), so a second person striking the same entry out first is REFUSED
  // with a plain message instead of quietly overwriting their reason.
  const clash = await expectClash(req, rid);
  if (clash) return clashJson(clash);

  const actor = await actorOf(req);
  const action = String(body.action || "add");

  try {
    if (action === "add") {
      const category = String(body.category || "");
      const title = String(body.title || "").trim().slice(0, 120);
      const amount = Number(body.amount);
      if (!CATS.has(category)) return err("Pick a category.");
      if (!title) return err("Say what it was (e.g. “Bar lamp broken”).");
      if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) return err("Enter a valid amount.");
      const expense_date = isDate(body.expense_date) ? String(body.expense_date) : todayIST();
      if (expense_date > todayIST()) return err("You can't record an expense for a future date.");

      const photo_url = await savePhoto(rid, photo);
      const ins = await sb.from("expenses").insert({
        restaurant_id: rid, category, title, amount: round2(amount), expense_date,
        note: body.note ? String(body.note).slice(0, 500) : null,
        photo_url, created_by: actor.label, created_by_id: actor.id,
      }).select("id").single();
      if (ins.error) return err(ins.error.message, 500);
      await logAction("owner", "expense_add", {
        restaurant_id: rid, actor: actor.label, actor_id: actor.id,
        detail: `${category}: ${title} — ₹${round2(amount)}`,
      });
      return ok({ id: ins.data.id });
    }

    if (action === "void") {
      // APPEND-ONLY: this is the ONLY way to take an entry out of the totals, it needs a
      // reason, and the row stays on screen struck through. Never add a delete here.
      const id = String(body.id || "");
      if (!isUuid(id)) return err("That entry no longer exists — refresh the page.");
      const reason = String(body.reason || "").trim();
      if (!reason) return err("A reason is required to strike out an entry.");
      const up = await sb.from("expenses")
        .update({ voided_at: new Date().toISOString(), void_reason: reason.slice(0, 300), voided_by: actor.label })
        .eq("restaurant_id", rid).eq("id", id).is("voided_at", null)
        .select("id, title");
      if (up.error) return err(up.error.message, 500);
      if (!up.data?.length) return err("Entry not found, or someone already struck it out.", 404);
      await logAction("owner", "expense_void", {
        restaurant_id: rid, actor: actor.label, actor_id: actor.id,
        detail: `${up.data[0].title}: ${reason}`,
      });
      return ok({ id });
    }

    return err("Unknown action.");
  } catch (e) {
    return err(e instanceof Error ? e.message : "Couldn't save that.", 500);
  }
}

export const POST = withIdempotency(handlePost, "owner");
