// /api/admin/users/photo — a person's PHOTO on their staff profile. Optional by design:
// most restaurants won't add one, and a profile with no photo shows their initial instead.
//
//   POST   multipart/form-data { id, file } → stored in the public `branding` bucket under
//          staff/<user id>/, the URL written to staff_users.profile.photo_url, URL returned.
//   DELETE ?id=…  → removes the stored object and clears the URL.
//
// Admin-gated (staff cookie), service-role storage writes. Modelled on the restaurant-logo
// route, including its two hard-won rules: no SVG (an SVG served from public storage can run
// script when its URL is opened directly), and never write storage before the row is known.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";
// Plain words for the console; the database's own words stay in the body + the log (lib/adminFail).
import { adminFail } from "@/lib/adminFail";

export const dynamic = "force-dynamic";
const ok = (d: any, s = 200) => NextResponse.json(d, { status: s });
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const BUCKET = "branding";
const folder = (id: string) => `staff/${id}`;

/** Drop every earlier photo for this person so storage keeps just the current one. */
async function purge(id: string): Promise<void> {
  const { data } = await sb.storage.from(BUCKET).list(folder(id));
  const paths = (data || []).map((f) => `${folder(id)}/${f.name}`);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
}

/** Write photo_url into the person's profile jsonb without touching anything else in it. */
async function setUrl(id: string, url: string | null, current: Record<string, unknown> | null) {
  const next = { ...(current || {}) } as Record<string, unknown>;
  if (url) next.photo_url = url; else delete next.photo_url;
  return sb.from("staff_users").update({ profile: next }).eq("id", id);
}

/** The one read both handlers start from. A blip must not read as "User not found." — a 404 that
 *  nothing retries, on the button a person has just pressed with a file picked (T27 sweep #9,
 *  2026-09-15; the same correction /api/admin/users' PATCH and DELETE were given in sweep #7). */
async function personOr(id: string): Promise<{ row: { id: string; username: string; profile: unknown; restaurant_id: string | null } } | { res: NextResponse }> {
  const q = await sb.from("staff_users").select("id, username, profile, restaurant_id").eq("id", id).maybeSingle();
  if (q.error) return { res: adminFail("this person", q.error, { action: "load" }) };
  if (!q.data) return { res: bad("User not found.", 404) };
  return { row: q.data as { id: string; username: string; profile: unknown; restaurant_id: string | null } };
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const form = await req.formData().catch(() => null);
  const id = String(form?.get("id") || "");
  const file = form?.get("file");
  if (!isUuid(id)) return bad("Invalid user id.");
  if (!(file instanceof File)) return bad("Missing file.");
  const ext = EXT[file.type];
  if (!ext) return bad("The photo must be a PNG, JPG or WEBP image.");
  if (file.size > 2 * 1048576) return bad("The photo must be 2 MB or smaller.");
  const found = await personOr(id);
  if ("res" in found) return found.res;
  const person = found.row;

  await purge(id);
  const path = `${folder(id)}/photo-${Date.now()}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: true });
  // Plain sentence to the screen, raw text to `detail` + the log — see lib/adminFail.
  if (up.error) return adminFail("this photo", up.error, { action: "save" });
  const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const wr = await setUrl(id, url, person.profile as Record<string, unknown>);
  if (wr.error) return bad("The photo uploaded but didn't save — please try again.", 500);
  await logAction("admin", "user_set_photo", { actor: "admin", restaurant_id: person.restaurant_id, detail: `photo added for "${person.username}"` });
  return ok({ ok: true, url });
}

export async function DELETE(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!isUuid(id)) return bad("Invalid user id.");
  const found = await personOr(id);
  if ("res" in found) return found.res;
  const person = found.row;
  // ── WAS THERE A PHOTO AT ALL? (T27 sweep #9, 2026-09-15) ──────────────────────────────────────
  // This handler's own header says it is "Modelled on the restaurant-logo route, including its two
  // hard-won rules". It kept both — and missed the THIRD one that route learned afterwards, on
  // 2026-09-01: "never log and report a change that didn't happen". Removing the photo from someone
  // who never had one answered a bare `{ok:true}`, the console said the photo was removed, and it
  // wrote **"photo removed for <name>"** into the Activity log for a removal that did not happen.
  //
  // Found by RUNNING it, side by side with its sibling, on a French House manager with no photo: the
  // logo route answered `{"ok":true,"removed":false,"message":"There was no logo to remove."}` and
  // wrote nothing; this one answered `{"ok":true}` and wrote the line. (The test row was removed by
  // its own id in the same run.)
  //
  // Not an error — pressing Remove on a person with no photo is a reasonable thing to do. It just
  // must not claim to have removed one. The answer is decided by what was THERE, not by whether the
  // write ran: clearing an absent key succeeds and changes nothing, which is the case that slipped
  // through. The stored files are still swept, because an orphan object with no row pointing at it
  // is exactly the state this cleanup is for.
  const hadPhoto = !!(person.profile as { photo_url?: unknown } | null)?.photo_url;
  if (!hadPhoto) {
    await purge(id);
    return ok({ ok: true, removed: false, message: "There was no photo to remove." });
  }
  await purge(id);
  const wr = await setUrl(id, null, person.profile as Record<string, unknown>);
  if (wr.error) return bad("Couldn't remove the photo — please try again.", 500);
  await logAction("admin", "user_set_photo", { actor: "admin", restaurant_id: person.restaurant_id, detail: `photo removed for "${person.username}"` });
  return ok({ ok: true, removed: true });
}
