// lib/issues.ts — one place for raising an issue + storing its attachments, shared
// by the three staff panels (manager/kitchen/tablet) and the /api/issue-media route.
//
// An issue can carry a PHOTO and/or a VOICE NOTE (mig 150). Media is uploaded first
// (multipart → public `issue-media` bucket → URL), then the issue row is inserted
// with those URLs. Service-role only; callers gate the request themselves.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export const ISSUE_BUCKET = "issue-media";

// Allowed attachment types + their file extensions. Images: raster only (an SVG can
// carry a <script> that runs when its public URL is opened — same reason the logo
// route rejects SVG). Audio: the formats MediaRecorder produces across browsers
// (Chrome→webm, Safari→mp4) plus common uploads, in case we ever allow file audio.
const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const AUDIO_EXT: Record<string, string> = {
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a", "audio/aac": "aac",
};
const IMAGE_MAX = 5 * 1024 * 1024; // 5 MB — a phone photo, still small enough to load in a ticket card
const AUDIO_MAX = 8 * 1024 * 1024; // 8 MB — a couple of minutes of compressed voice

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export type MediaKind = "image" | "audio";

// Store ONE attachment for a restaurant's issue and return its public URL. Throws a
// plain Error with a user-friendly message on any validation/upload failure so the
// route can surface it as a 400/500. Path is per-restaurant + timestamp + random →
// unguessable, and grouped by restaurant so a restaurant delete can purge its folder.
export async function storeIssueMedia(rid: string, file: File, kind: MediaKind): Promise<string> {
  if (!isUuid(rid)) throw new Error("Invalid restaurant.");
  const table = kind === "image" ? IMAGE_EXT : AUDIO_EXT;
  const ext = table[file.type];
  if (!ext) {
    throw new Error(kind === "image" ? "Photo must be a PNG, JPG or WEBP image." : "Voice note format not supported.");
  }
  if (file.size > (kind === "image" ? IMAGE_MAX : AUDIO_MAX)) {
    throw new Error(kind === "image" ? "Photo must be 5 MB or smaller." : "Voice note must be 8 MB or smaller.");
  }
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${rid}/${kind}-${Date.now()}-${rand}.${ext}`;
  const buf = new Uint8Array(await file.arrayBuffer());
  const up = await sb.storage.from(ISSUE_BUCKET).upload(path, buf, { contentType: file.type, upsert: false });
  if (up.error) throw new Error(up.error.message);
  return sb.storage.from(ISSUE_BUCKET).getPublicUrl(path).data.publicUrl;
}

export type RaiseIssueInput = {
  rid: string;
  subject: string;
  body?: string | null;
  raisedBy: string;
  raisedRole: string;
  imageUrl?: string | null;
  audioUrl?: string | null;
};

// Insert one issue row. Subject/body are capped (a direct API call could otherwise
// store huge blobs that re-load on every issues-list fetch — audit 2026-07-07).
// Only accepts media URLs that live in OUR bucket, so a caller can't stash an
// arbitrary external link (which would then render as an <img>/<audio> in a panel).
export async function raiseIssue(input: RaiseIssueInput): Promise<void> {
  const subject = String(input.subject || "").trim().slice(0, 200);
  if (!subject) throw new Error("Please add a subject.");
  const clean = (u: string | null | undefined) =>
    typeof u === "string" && u.includes(`/${ISSUE_BUCKET}/`) ? u.slice(0, 1000) : null;
  const ins = await sb.from("issues").insert({
    restaurant_id: input.rid,
    subject,
    body: String(input.body || "").trim().slice(0, 4000) || null,
    raised_by: input.raisedBy,
    raised_role: input.raisedRole,
    image_url: clean(input.imageUrl),
    audio_url: clean(input.audioUrl),
  });
  if (ins.error) throw new Error(ins.error.message);
}
