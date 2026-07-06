// /api/admin/restaurants/logo — upload / remove ONE restaurant's logo IMAGE.
// POST   multipart/form-data { restaurant_id, file } → store in the public `branding`
//        bucket, write restaurants.logo_url, return the public URL.
// DELETE ?restaurant_id=… → clear logo_url (best-effort leaves the object; harmless).
// Admin-gated (STAFF cookie), service-role storage writes. Image type + ≤1MB enforced.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";
const ok = (d: any, s = 200) => NextResponse.json(d, { status: s });
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
// SVG deliberately EXCLUDED (bug L5, 2026-07-05): an SVG can carry <script> that runs
// when its public storage URL is opened directly, so we only accept raster formats.
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
// restaurants.id is a uuid column — reject anything that isn't one up front, so a
// malformed id can't write an orphan storage object before the DB update fails.
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Remove every object under a restaurant's logo folder so old/replaced logos don't
// pile up in Storage (each upload writes a fresh timestamped name). Best-effort —
// a cleanup miss never blocks the upload/remove itself.
async function purgeLogos(rid: string): Promise<void> {
  const { data } = await sb.storage.from("branding").list(rid);
  const paths = (data || []).map((f) => `${rid}/${f.name}`);
  if (paths.length) await sb.storage.from("branding").remove(paths);
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const form = await req.formData().catch(() => null);
  const rid = String(form?.get("restaurant_id") || "");
  const file = form?.get("file");
  if (!isUuid(rid)) return bad("Invalid restaurant_id.");
  if (!(file instanceof File)) return bad("Missing file.");
  const ext = EXT[file.type];
  if (!ext) return bad("Logo must be a PNG, JPG or WEBP image.");
  if (file.size > 1048576) return bad("Logo must be 1 MB or smaller.");
  await purgeLogos(rid); // drop any previous logo so Storage keeps just the current one
  const path = `${rid}/logo-${Date.now()}.${ext}`;
  const buf = new Uint8Array(await file.arrayBuffer());
  const up = await sb.storage.from("branding").upload(path, buf, { contentType: file.type, upsert: true });
  if (up.error) return bad(up.error.message, 500);
  const url = sb.storage.from("branding").getPublicUrl(path).data.publicUrl;
  const { error } = await sb.from("restaurants").update({ logo_url: url }).eq("id", rid);
  if (error) return bad(error.message, 500);
  await logAction("admin", "restaurant_logo", { actor: "admin", restaurant_id: rid, detail: "uploaded logo" });
  return ok({ ok: true, logo_url: url });
}

export async function DELETE(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const rid = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!isUuid(rid)) return bad("Invalid restaurant_id.");
  const { error } = await sb.from("restaurants").update({ logo_url: null }).eq("id", rid);
  if (error) return bad(error.message, 500);
  await purgeLogos(rid); // also delete the stored file(s), not just the DB link
  await logAction("admin", "restaurant_logo", { actor: "admin", restaurant_id: rid, detail: "removed logo" });
  return ok({ ok: true });
}
