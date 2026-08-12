// GET /api/health/deep — "WHICH part is broken?", for the outside watchdog.
//
// ── WHY THIS IS A SECOND ADDRESS AND NOT MORE WORK IN /api/health (improvement I13, owner
//    2026-08-12: "do it if it's actually good") ────────────────────────────────────────────────────
//
// `/api/health` is pinged every 5 minutes, forever, and was deliberately trimmed to ONE bounded row
// read on 2026-08-06 — it used to ask Postgres to tally the whole `restaurants` table on every ping,
// which is work repeated 288 times a day to answer a question nobody asked. Piling storage checks
// onto it would make exactly that mistake again. So the cheap "are we alive?" probe stays as it is,
// and anything that costs more lives here, on its own slower schedule.
//
// ── WHAT IT ACTUALLY CLOSES, honestly ────────────────────────────────────────────────────────────
//
// The existing probe only ever checks the DATABASE. Two real failures are invisible to it:
//
//  1. STORAGE. Three buckets: `branding` (restaurant logos + staff photos), `issue-media` (complaint
//     photos and voice notes) and `inv-media` (expense slips, purchase bills). If storage fails while
//     the database is fine, the old probe says "ok" while logos vanish and nobody can attach a photo
//     to a complaint.
//     Worth being straight about the size of this: the 3D dish models are served from `public/models`
//     by the app itself, and the menu, ordering, the kitchen and billing never touch storage. So a
//     storage outage DEGRADES the app, it does not take it down — and because storage and the
//     database are the same provider, a total provider outage is already caught by the cheap probe.
//     A storage-only failure is the narrow case this catches.
//
//  2. CONFIGURATION — and this is the half that makes the endpoint worth having. If
//     NEXT_PUBLIC_SUPABASE_URL / ANON_KEY go missing from the deployment (a bad env edit, a variable
//     dropped on a new environment), every panel silently loses live updates: the board stops moving,
//     no error is shown, and the only way anyone finds out is a manager saying "the kitchen screen
//     isn't updating". Nothing alerts on that today — `/api/rt-config` reports it, but only when a
//     panel happens to ask. This checks it directly, every hour, and tells the watchdog.
//
// ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────────────────────────
//
// No counts, no tenant data, no secrets, no error text. Each part answers a boolean and a plain
// sentence. It reveals only which subsystems exist, which the route list in docs/CLAUDE-DETAIL.md
// already documents — and a watchdog needs it without a cookie, so it is deliberately public, like
// `/api/health` itself.
import { NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Results are held for a minute.
 *
 * A watchdog on a free plan polls every 5 minutes, which is fine — but nothing stops a person, a
 * second monitor, or a misconfigured job hitting this far harder, and each call does real work
 * against storage. The cache makes the cost of being hammered the same as the cost of being polled.
 * A minute is short enough that a genuine outage is still noticed on the next scheduled ping.
 */
const CACHE_MS = 60_000;
let cached: { at: number; body: DeepHealth } | null = null;

type Part = { ok: boolean; note: string };
type DeepHealth = {
  ok: boolean;
  checkedAt: string;
  parts: {
    database: Part;
    storage: Part;
    liveUpdates: Part;
  };
  /** The one sentence a phone alert should show. Empty when everything is fine. */
  summary: string;
};

/** Can we read from the database at all? Same question the cheap probe asks, so the parts line up. */
async function checkDatabase(): Promise<Part> {
  try {
    const { error } = await sb.from("restaurants").select("id").limit(1);
    return error
      ? { ok: false, note: "The database isn't answering. Ordering, billing and the kitchen are all affected." }
      : { ok: true, note: "Answering normally." };
  } catch {
    return { ok: false, note: "The database isn't answering. Ordering, billing and the kitchen are all affected." };
  }
}

/** The buckets this app genuinely stops working properly without. */
const REQUIRED_BUCKETS = ["branding", "issue-media", "inv-media"] as const;

/**
 * Is file storage reachable, AND are the buckets we depend on still there?
 *
 * ── THE FIRST VERSION OF THIS WAS A GREEN LIGHT THAT COULD NOT GO RED ────────────────────────────
 * It called `.list()` on one bucket and treated "no error" as healthy. Testing it by pointing at
 * `this-bucket-does-not-exist` returned **no error and an empty list**, so the check reported
 * "Answering normally" for a bucket that was not there. A monitor that cannot fail is worse than no
 * monitor: it converts "nobody is watching" into "somebody is watching, and they say it's fine".
 *
 * `listBuckets()` is the call that actually answers both halves:
 *   · the storage service is up and our credentials work for it → otherwise it errors;
 *   · the buckets still exist → otherwise they are missing from the list.
 * The second half catches a real and quiet failure mode — a bucket renamed, deleted, or never
 * created on a fresh environment — which no amount of "can I reach storage?" would ever notice.
 */
async function checkStorage(): Promise<Part> {
  const down = "File storage isn't answering — logos and photo attachments won't load. Ordering and billing are unaffected.";
  try {
    const { data, error } = await sb.storage.listBuckets();
    if (error || !data) return { ok: false, note: down };
    const have = new Set(data.map((b) => b.name));
    const missing = REQUIRED_BUCKETS.filter((b) => !have.has(b));
    if (missing.length) {
      return {
        ok: false,
        // Named, because "storage is down" and "one folder is missing" need different responses.
        note: `File storage is up, but ${missing.length === 1 ? "a folder is" : "some folders are"} missing (${missing.join(", ")}). Photos saved there won't load, and new ones can't be uploaded.`,
      };
    }
    return { ok: true, note: "Answering normally." };
  } catch {
    return { ok: false, note: down };
  }
}

/**
 * Are the two PUBLIC values every panel needs to open a live connection actually set?
 *
 * This is a pure environment read — no network — so it is free, and it is the check most likely to
 * catch a real problem, because it fires the moment a deploy goes out with a variable missing rather
 * than when somebody notices the board has stopped moving.
 */
function checkLiveUpdates(): Part {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return url && key
    ? { ok: true, note: "Configured." }
    : { ok: false, note: "Live updates aren't configured on this deployment — every panel will stop refreshing on its own, silently. Check the environment variables." };
}

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(cached.body, {
      status: cached.body.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store", "X-Health-Cache": "hit" },
    });
  }

  // Run them together — they are independent, and the slowest one decides the response time.
  const [database, storage] = await Promise.all([checkDatabase(), checkStorage()]);
  const liveUpdates = checkLiveUpdates();
  const parts = { database, storage, liveUpdates };

  // The alert sentence names the broken parts in the order they matter to a restaurant: if the
  // database is down nothing else is worth mentioning, because nothing else works either.
  const broken = (Object.entries(parts) as [keyof typeof parts, Part][]).filter(([, p]) => !p.ok);
  const summary = broken.length
    ? (database.ok
        ? broken.map(([, p]) => p.note).join(" ")
        : database.note)
    : "";

  const body: DeepHealth = { ok: broken.length === 0, checkedAt: new Date().toISOString(), parts, summary };
  cached = { at: Date.now(), body };

  // 503 when ANY part is down, because that is the only thing a watchdog reads. The body says which.
  return NextResponse.json(body, {
    status: body.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Health-Cache": "miss" },
  });
}
