// mediaLinks.ts — a supplier's bill and a staff member's voice note stop being public files.
//
// WHAT WAS WRONG (2026-08-04 API sweep, finding F23)
//   Both upload helpers finished with `getPublicUrl(path)` and stored that permanent public link in
//   the database:
//       lib/issues.ts                      → issue-media   (photos + voice notes of floor problems)
//       app/api/inventory/[...path]/route  → inv-media      (purchase bills, waste, expense slips)
//   A public bucket serves a file to anyone who has the address, with no login check at all. The only
//   thing standing in the way was not knowing the URL — and those URLs travel: through the panels,
//   the issues list, the owner's reports, anything that copies a link, and every saved offline copy
//   of an API response. A restaurant's supplier bills carry vendor names and amounts.
//
// WHY THIS FILE INSTEAD OF CHANGING EVERY SCREEN
//   Sixteen places render these fields. Signing at the RENDER site would mean touching all sixteen
//   (and the panels are plain JS with no shared fetch). So the signing happens one layer earlier, in
//   the API routes that already return the row: the stored value is turned into a fresh short-lived
//   link on the way OUT. Every screen keeps receiving a URL in the same field and needs no change.
//
// BACKWARDS COMPATIBLE, BOTH DIRECTIONS — this is the part that makes it safe to deploy:
//   · Rows written BEFORE this hold a full public URL. `pathOf()` recovers the object path from it,
//     so old rows sign correctly too. Nothing needs migrating.
//   · A signed link works on a bucket that is STILL PUBLIC. So this code can ship first and behave
//     identically, and the buckets can be flipped private afterwards (mig 276) once it is live.
//     Flipping first would have broken every existing image the moment it ran.
//   · If signing fails for any reason we return the value UNCHANGED rather than nothing — a bill
//     photo that still loads is better than a broken thumbnail, and the bucket flip is what actually
//     enforces privacy.
//
// EXPIRY. Four hours. Long enough that the offline layer (which keeps saved API responses for ~2h)
// never shows a dead image, short enough that a link someone forwarded stops working the same day.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

/** The two buckets that hold a restaurant's private paperwork. Logos and staff photos are NOT here:
 *  a logo is shown to guests on the menu and must stay public. */
export const PRIVATE_BUCKETS = ["inv-media", "issue-media"] as const;
export type PrivateBucket = (typeof PRIVATE_BUCKETS)[number];

const TTL_SECONDS = 4 * 60 * 60;

/**
 * The object path inside `bucket`, from either a bare path ("<rid>/123-ab.jpg") or a full public URL
 * written before this change (".../storage/v1/object/public/inv-media/<rid>/123-ab.jpg").
 * Returns null for anything that isn't in this bucket (an external link a person pasted, say) so it
 * is passed through untouched.
 */
export function pathOf(bucket: PrivateBucket, stored: string): string | null {
  const v = (stored || "").trim();
  if (!v) return null;
  if (!v.includes("://")) return v.replace(/^\/+/, ""); // already a path
  const marker = `/object/public/${bucket}/`;
  const at = v.indexOf(marker);
  if (at >= 0) return v.slice(at + marker.length).split("?")[0];
  const signed = `/object/sign/${bucket}/`;                // already-signed URL → re-sign it fresh
  const s = v.indexOf(signed);
  if (s >= 0) return v.slice(s + signed.length).split("?")[0];
  return null;
}

/** One short-lived link, or the original value if it can't be signed (see the note above). */
export async function signOne(bucket: PrivateBucket, stored: string | null | undefined): Promise<string | null> {
  if (!stored) return stored ?? null;
  const path = pathOf(bucket, String(stored));
  if (!path) return String(stored);
  try {
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, TTL_SECONDS);
    return error || !data?.signedUrl ? String(stored) : data.signedUrl;
  } catch {
    return String(stored);
  }
}

/**
 * Sign the named fields on every row, in ONE pass, mutating a COPY. Signing is a local HMAC in
 * supabase-js (no network call per link), so a list of 300 rows costs microseconds — but the calls
 * are still batched with Promise.all so nothing serialises.
 *
 * Usage at the end of a route, right before the response:
 *     const out = await signRows("inv-media", rows, ["photo_url"]);
 */
export async function signRows<T extends Record<string, unknown>>(
  bucket: PrivateBucket,
  rows: T[] | null | undefined,
  fields: string[],
): Promise<T[]> {
  const list = rows || [];
  if (!list.length) return list as T[];
  return Promise.all(list.map(async (row) => {
    let copy: T | null = null;                      // only clone a row that actually has media
    for (const f of fields) {
      const v = row?.[f];
      if (typeof v !== "string" || !v) continue;
      const signed = await signOne(bucket, v);
      if (signed === v) continue;
      copy = copy ?? ({ ...row } as T);
      (copy as Record<string, unknown>)[f] = signed;
    }
    return copy ?? row;
  }));
}
