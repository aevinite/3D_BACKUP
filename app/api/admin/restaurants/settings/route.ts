// Admin per-restaurant operational settings (owner 2026-07-26): the restaurant-detail
// "Settings" tab reads & writes billing, dining-session and table settings here, plus
// the permanent per-table QR codes (mig 210). The form fields are same-to-same with the
// manager panel's Settings sections; the manager copies get removed once the owner
// approves this tab live — until then both panels write the same settings columns.
//
// Sanitize rules mirror the manager save path (app/api/editor settings POST) so the two
// panels can never write different shapes into the same columns. Admin-gated (middleware
// protects /api/admin/*), service role, every read/write scoped by restaurant_id.
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { cleanClonedSettings } from "@/lib/settingsClone";
import { clampPerRow } from "@/lib/floorLayout";
import { cleanBanquetFields } from "@/lib/banquetFields";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Explicit column list — this route never reads or writes anything outside it.
const SETTINGS_COLS = [
  "tax_label", "restaurant_name", "restaurant_address", "restaurant_phone", "gstin",
  "invoice_prefix", "bill_footer", "tax_components", "tax_rate",
  // GST and prices (mig 270). What a typed menu price MEANS, whether a single dish may differ
  // from that, and what an MRP line declares underneath. Admin-only — there is no owner or
  // manager control for any of the three, by the owner's instruction (2026-08-04).
  "price_tax_mode", "item_tax_modes_allowed", "mrp_tax_treatment",
  "bill_customer_required", "bill_customer_print",
  "sessions_enabled", "require_location", "require_otp", "geo_lat", "geo_lng", "geo_radius_m",
  "table_count", "table_seats", "table_names", "floor_per_row",
  // Banquet bill (mig 237): WHAT this restaurant is asked to fill in, its own bill-number
  // series, and WHICH paper it prints on. Admin-owned — the manager/owner save path strips
  // these (owner 2026-07-31: the info-format option lives in the admin panel).
  "banquet_fields", "banquet_bill_prefix", "banquet_bill_style", "banquet_bill_next",
  "banquet_tax_components",
  "banquet_paper", "banquet_paper_size", "banquet_paper_top", "banquet_paper_bot",
  "banquet_paper_side", "banquet_paper_foot", "banquet_paper_sign", "banquet_paper_fill",
  "floor_layout_mode",
  // WHICH screen may print a kitchen ticket (mig 336): kitchen | counter | both. Admin-owned for the
  // same reason the KOT entitlement above it is — the manager panel's Kitchen-printing section is
  // hidden from everyone there by the owner's 2026-07-31 decision.
  "kot_print_target",
] as const;
const SELECT = SETTINGS_COLS.join(", ");

type Patch = Record<string, unknown>;

// Whitelist sanitizer: only known keys survive, each cleaned the same way the manager
// save path cleans it. Returns the cleaned patch (empty object = nothing to save).
function sanitize(body: Patch): Patch {
  const out: Patch = {};
  const str = (k: string, max: number, blankNull = true) => {
    if (!(k in body)) return;
    const v = String(body[k] ?? "").trim().slice(0, max);
    out[k] = v || (blankNull ? null : "");
  };
  str("restaurant_name", 80);
  str("restaurant_address", 200);
  str("restaurant_phone", 30);
  str("gstin", 20);
  str("invoice_prefix", 12);
  str("bill_footer", 200);
  str("tax_label", 20);
  if ("tax_components" in body) {
    const raw = Array.isArray(body.tax_components) ? body.tax_components : [];
    out.tax_components = raw
      .map((c) => ({
        label: String((c as Patch)?.label || "").trim().slice(0, 24),
        rate: Math.round((Number((c as Patch)?.rate) || 0) * 100) / 100,
      }))
      .filter((c) => c.label && c.rate > 0 && c.rate <= 100)
      .slice(0, 6);
  }
  if ("tax_rate" in body) {
    const v = parseFloat(String(body.tax_rate));
    out.tax_rate = Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
  }
  // ── GST and prices (mig 270) ──────────────────────────────────────────────
  // Both columns carry a CHECK constraint, so an unexpected value would be refused by the
  // database with a 500 the admin can do nothing about. Fall back to the SAFE default instead
  // — 'excl' is today's behaviour (GST on top) and 'none' declares no tax on an MRP line, so a
  // typo can never quietly move a restaurant onto a different tax posture or print a tax line
  // a composition-scheme restaurant may not show.
  if ("price_tax_mode" in body) {
    const v = String(body.price_tax_mode ?? "");
    out.price_tax_mode = v === "incl" || v === "composition" ? v : "excl";
  }
  if ("mrp_tax_treatment" in body) {
    out.mrp_tax_treatment = String(body.mrp_tax_treatment ?? "") === "inclusive" ? "inclusive" : "none";
  }
  // Customer on the bill (mig 227): asking for the guest's mobile + name, and printing
  // those two lines, are separate switches — see the (i) note in the admin card.
  // item_tax_modes_allowed rides the same boolean loop — it is the master switch for per-dish
  // tax modes and is a real boolean column (NOT NULL DEFAULT false), never a tri-state.
  for (const k of ["sessions_enabled", "require_location", "require_otp", "bill_customer_required", "bill_customer_print", "item_tax_modes_allowed"]) {
    if (k in body) out[k] = body[k] === true || body[k] === "true";
  }
  for (const k of ["geo_lat", "geo_lng"]) {
    if (k in body) { const v = parseFloat(String(body[k])); out[k] = Number.isFinite(v) ? v : null; }
  }
  if ("geo_radius_m" in body) {
    const n = Math.round(Number(body.geo_radius_m));
    out.geo_radius_m = Number.isFinite(n) ? Math.min(Math.max(n, 20), 5000) : 250;
  }
  if ("table_count" in body) {
    const n = Math.round(Number(body.table_count));
    out.table_count = Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 12;
  }
  if ("floor_per_row" in body) out.floor_per_row = clampPerRow(body.floor_per_row);
  // Only the two modes the panel can draw (mig 242 has the same CHECK) — a typo must not be able
  // to take a restaurant's floor away.
  if ("floor_layout_mode" in body) out.floor_layout_mode = body.floor_layout_mode === "custom" ? "custom" : "classic";
  // Only the three the queue understands (mig 336 has the same CHECK constraint). Anything else
  // falls back to 'kitchen' — the setup every restaurant starts on — rather than to an error, so a
  // stale panel can never take a restaurant's printing away.
  if ("kot_print_target" in body) {
    const t = String(body.kot_print_target || "kitchen");
    out.kot_print_target = ["kitchen", "counter", "both"].includes(t) ? t : "kitchen";
  }
  if ("table_seats" in body) {
    const raw = body.table_seats;
    const clean: Record<string, number> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw)) {
        const tn = parseInt(k, 10);
        const n = Math.round(Number(v));
        if (Number.isFinite(tn) && tn >= 1 && Number.isFinite(n)) clean[String(tn)] = Math.min(Math.max(n, 1), 30);
      }
    }
    out.table_seats = clean;
  }
  if ("table_names" in body) {
    const raw = body.table_names;
    const clean: Record<string, string> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw)) {
        const tn = parseInt(k, 10);
        const name = String(v ?? "").trim().slice(0, 24);
        if (Number.isFinite(tn) && tn >= 1 && name) clean[String(tn)] = name;
      }
    }
    out.table_names = clean;
  }
  // auto_table_action is deliberately NOT writable any more (owner, 2026-08-02). No screen
  // offers it and no code reads it — a table is ended by a person tapping ✓ Close. The column
  // stays for old rows; mig 254 forces every one of them to 'off'.
  // ── banquet bill (mig 237) ────────────────────────────────────────────────
  // The field list is cleaned against lib/banquetFields.ts, so an unknown key can
  // never reach the DB and the SQL side (which filters every stored value by this
  // same list) can always be trusted.
  if ("banquet_fields" in body) out.banquet_fields = cleanBanquetFields(body.banquet_fields);
  // A banquet's own tax lines (mig 239) — empty means "use the restaurant's normal tax".
  // Same shape and same clamps as tax_components, so the two can never drift.
  if ("banquet_tax_components" in body) {
    const raw = Array.isArray(body.banquet_tax_components) ? body.banquet_tax_components : [];
    out.banquet_tax_components = raw
      .map((c) => ({ label: String((c as Patch)?.label || "").trim().slice(0, 24), rate: Math.round((Number((c as Patch)?.rate) || 0) * 100) / 100 }))
      .filter((c) => c.label && c.rate > 0 && c.rate <= 100)
      .slice(0, 6);
  }
  if ("banquet_bill_prefix" in body) {
    out.banquet_bill_prefix = String(body.banquet_bill_prefix || "BQB").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "BQB";
  }
  if ("banquet_bill_style" in body) {
    const v = String(body.banquet_bill_style || "fy");
    out.banquet_bill_style = ["fy", "date", "plain"].includes(v) ? v : "fy";
  }
  // banquet_bill_next is handled in POST (it is refused once bills exist), not here.
  if ("banquet_paper" in body) out.banquet_paper = body.banquet_paper === "pad" ? "pad" : "plain";
  if ("banquet_paper_size" in body) out.banquet_paper_size = body.banquet_paper_size === "a4" ? "a4" : "a5";
  const mm = (k: string, lo: number, hi: number, dflt: number) => {
    if (!(k in body)) return;
    const n = Math.round(Number(body[k]));
    out[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  mm("banquet_paper_top", 0, 80, 33);
  mm("banquet_paper_bot", 0, 50, 14);
  mm("banquet_paper_side", 2, 25, 6);
  for (const k of ["banquet_paper_foot", "banquet_paper_sign", "banquet_paper_fill"]) {
    if (k in body) out[k] = body[k] === true || body[k] === "true";
  }
  return out;
}

// ── permanent per-table QR codes (mig 210) ─────────────────────────────────
// Unambiguous alphabet (no 0/O/1/I/L). 8 chars ≈ 1.1 × 10¹² combinations — a typed
// or guessed variation lands on "invalid code", never on a neighbouring table.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(randomBytes(8)).map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");

// Make sure tables 1..count each have a code; returns { "<table>": "<code>" }.
async function ensureCodes(rid: string, count: number): Promise<Record<string, string> | { error: string }> {
  const cur = await sb.from("table_qr_codes").select("table_number, code").eq("restaurant_id", rid).limit(500);
  if (cur.error) return { error: cur.error.message };
  const map: Record<string, string> = {};
  for (const r of cur.data || []) map[String(r.table_number)] = r.code;
  const missing: { restaurant_id: string; table_number: number; code: string }[] = [];
  for (let t = 1; t <= count; t++) if (!map[String(t)]) missing.push({ restaurant_id: rid, table_number: t, code: newCode() });
  if (missing.length) {
    // Global-unique code column: on the (astronomically rare) collision, re-mint and retry.
    for (let attempt = 0; attempt < 3; attempt++) {
      const ins = await sb.from("table_qr_codes").insert(missing);
      if (!ins.error) break;
      if (!/duplicate|unique/i.test(ins.error.message)) return { error: ins.error.message };
      for (const m of missing) m.code = newCode();
      if (attempt === 2) return { error: "couldn't mint unique codes — try again" };
    }
    for (const m of missing) map[String(m.table_number)] = m.code;
  }
  const scoped: Record<string, string> = {};
  for (let t = 1; t <= count; t++) if (map[String(t)]) scoped[String(t)] = map[String(t)];
  return scoped;
}

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rid = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!isUuid(rid)) return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });
  const [row, rest] = await Promise.all([
    sb.from("settings").select(SELECT).eq("restaurant_id", rid).maybeSingle(),
    sb.from("restaurants").select("slug, name").eq("id", rid).maybeSingle(),
  ]);
  if (row.error) return adminFail("this restaurant's settings", row.error, { action: "load" });
  if (rest.error) return adminFail("this restaurant's settings", rest.error, { action: "load" });
  if (!rest.data) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });
  const settings = (row.data as unknown as Patch) || {};
  const count = Math.min(Math.max(Math.round(Number(settings.table_count)) || 12, 1), 500);
  const codes = await ensureCodes(rid, count);
  // ensureCodes hands back the database's own words; they belong in `detail` and the log, not in the
  // console's red toast (lib/adminFail). Its one non-database message ("couldn't mint unique codes")
  // is already a sentence, and adminFail passes it through the same way.
  if ("error" in codes) return adminFail("this restaurant's table QR codes", { message: codes.error }, { action: "load" });
  return NextResponse.json({ settings, slug: rest.data.slug, codes });
}

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Patch;
  const rid = body?.restaurant_id;
  if (!isUuid(rid)) return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });

  // ↻ New code for ONE table — the old printed QR stops working immediately.
  if (body.action === "regen_code") {
    const table = Math.round(Number(body.table));
    if (!Number.isFinite(table) || table < 1 || table > 500)
      return NextResponse.json({ error: "invalid table" }, { status: 400 });
    for (let attempt = 0; attempt < 3; attempt++) {
      const up = await sb.from("table_qr_codes")
        .upsert({ restaurant_id: rid, table_number: table, code: newCode() }, { onConflict: "restaurant_id,table_number" })
        .select("code").maybeSingle();
      if (!up.error) {
        await logAction("admin", "table_qr_regen", { detail: `table ${table} got a new QR code`, restaurant_id: rid });
        return NextResponse.json({ table, code: up.data?.code });
      }
      if (!/duplicate|unique/i.test(up.error.message))
        return adminFail("this restaurant's settings", up.error, { action: "save" });
    }
    return NextResponse.json({ error: "couldn't mint a unique code — try again" }, { status: 500 });
  }

  // Settings save — whitelist-sanitized patch of changed fields only.
  const patch = sanitize(body);
  // The banquet counter (mig 237): settable while the restaurant has issued NO banquet
  // bill — that is the whole point of letting them line the series up with what their
  // accountant already files. After the first bill it is refused OUT LOUD (never
  // silently dropped), because a counter that can move backwards is the part an audit
  // actually checks.
  if ("banquet_bill_next" in body) {
    const n = Math.round(Number(body.banquet_bill_next));
    const [issued, cur] = await Promise.all([
      sb.from("banquet_bills").select("id", { count: "exact", head: true }).eq("restaurant_id", rid),
      sb.from("settings").select("banquet_bill_next").eq("restaurant_id", rid).maybeSingle(),
    ]);
    // ── A LOCK MUST NOT OPEN BECAUSE A COUNT FAILED (T20 sweep, 2026-08-19) ──────────────────────
    // Neither read's `.error` was inspected. `issued.count` is null on a failed count, so
    // `Number(null) || 0` came out 0 — "no banquet bills have been issued" — and the refusal below
    // never fired. A passing database hiccup was therefore enough to let the starting number of a
    // live bill series be moved after bills had already gone out on it, which is precisely the thing
    // an audit checks and the reason this refusal exists at all.
    //
    // Same rule as every other gate in this codebase: refuse on doubt. A person can try again in a
    // second; a renumbered series cannot be untangled. (`cur` matters for the same reason — a failed
    // read made `current` 1, so a request setting it to 1 would have read as "no change" and slipped
    // past the comparison.)
    if (issued.error || cur.error) {
      return adminFail("this restaurant's banquet bill numbering", issued.error || cur.error, { action: "save" });
    }
    const already = Number(issued.count) || 0;
    const current = Number(cur.data?.banquet_bill_next) || 1;
    if (already > 0 && Number.isFinite(n) && n !== current) {
      return NextResponse.json({
        error: `${already} banquet ${already === 1 ? "bill has" : "bills have"} already been issued, so the starting number can't be changed. The prefix and the style can.`,
      }, { status: 409 });
    }
    if (Number.isFinite(n)) patch.banquet_bill_next = Math.min(Math.max(n, 1), 99_999_999);
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to save" }, { status: 400 });
  const rest = await sb.from("restaurants").select("id, slug").eq("id", rid).maybeSingle();
  if (rest.error) return adminFail("this restaurant's settings", rest.error, { action: "save" });
  if (!rest.data) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });

  const cur = await sb.from("settings").select("id").eq("restaurant_id", rid).maybeSingle();
  if (cur.error) return adminFail("this restaurant's settings", cur.error, { action: "save" });

  let saved;
  if (cur.data) {
    saved = await sb.from("settings").update(patch).eq("restaurant_id", rid).select(SELECT).maybeSingle();
  } else {
    // No settings row yet → clone #1 as a template so every NOT NULL column is satisfied
    // (same pattern as the quick-features route), then apply the patch on top.
    const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RESTAURANT_ID).maybeSingle();
    const base = cleanClonedSettings(template.data);
    saved = await sb.from("settings")
  // THE SETTINGS ROW IS KEYED BY THE RESTAURANT'S OWN ID, NOT ITS SLUG (T20 sweep, 2026-08-19).
  // `settings.id` is that table's PRIMARY KEY (mig 003). Migration 319 frees a restaurant's slug the
  // moment it goes to the recycle bin — but a binned restaurant KEEPS its settings row, so a slug can
  // be free in `restaurants` and still taken in `settings`. Keyed by slug, the upsert below (whose
  // conflict target is restaurant_id, not id) would then hit `settings_pkey` and hand the admin a raw
  // "duplicate key value violates unique constraint" for flipping a switch. The uuid cannot collide,
  // and nothing anywhere looks a settings row up by slug — every read is `.eq("restaurant_id", …)`
  // except the four legacy `id='site'` reads, which are restaurant #1's own row.
  //
  // The create route and the quick-features route were both given this on 2026-08-16 and these were
  // left on the old key. Unreachable today (every restaurant on both stacks has a settings row, so
  // this clone branch never runs) — closed now because the symptom is a database sentence on his
  // screen, and it is invisible until the day it happens.
      .upsert({ ...base, id: rid, restaurant_id: rid, ...patch }, { onConflict: "restaurant_id" })
      .select(SELECT).maybeSingle();
  }
  if (saved.error) return adminFail("this restaurant's settings", saved.error, { action: "save" });
  await logAction("admin", "restaurant_settings", {
    detail: `updated ${Object.keys(patch).join(", ")}`.slice(0, 180), restaurant_id: rid,
  });
  return NextResponse.json({ settings: saved.data });
}
