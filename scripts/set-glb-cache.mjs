// Checks that every 3D model the app actually serves carries
// "public, max-age=31536000, immutable", and re-uploads any that does not.
//
// Idempotent — safe to re-run any time. Only re-uploads files whose header is wrong.
//
// IT WAS CHECKING THE WRONG FOUR FILES (found and fixed by the T10 sweep, 2026-08-12).
// It only ever read public/content/menu.json (which no longer exists) and
// public/content/items/*/config.json — legacy demo content holding two dishes with RELATIVE
// paths (/models/croissant_small.glb). `fetch` cannot resolve a relative path, so every
// `prebuild` printed four errors:
//
//     [cache] found 4 unique GLB URL(s).
//     [cache]   HEAD failed for croissant_small.glb: Failed to parse URL from /models/…
//     [cache] scanned: 4, wrong: 0, fixed: 0, still wrong: 0
//
// Four errors and then "wrong: 0" — a check that reported success having checked nothing, on
// every single build, for long enough that nobody read the output any more. Meanwhile the real
// dishes' GLBs live on Supabase Storage and are named in the DATABASE
// (menu_items.model_small_url / model_optimized_url), which this script never looked at. A model
// uploaded without the immutable header would make the 3D viewer re-download it on every
// navigation — precisely the regression verify:cache exists to catch — and the build-time check
// that should have caught it first was looking somewhere else.
//
// Now: the URLs come from the database when credentials are present, the two local demo models are
// reported as "served by Next, not Storage" instead of as failures, and the summary says how many
// were really CHECKED so it can never claim a clean bill of health for an empty list.
//
// Usage (manual, to actually re-upload):
//   SUPABASE_URL=https://<dev-project-ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<key>  node scripts/set-glb-cache.mjs
//   # the dev project ref is in .env.local — NEVER commit or echo a key
//
// With no env vars it runs CHECK-ONLY, which is why `prebuild` can call it: a developer without the
// service-role key still gets a build. package.json also appends `|| exit 0` so a network blip can
// never fail a deploy.

import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TARGET = "public, max-age=31536000, immutable";
const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FIX_MODE = Boolean(SUPABASE_URL && KEY);

const log = (...a) => console.log("[cache]", ...a);
const warn = (...a) => console.warn("[cache]", ...a);

// The env this needs to read the database. NEXT_PUBLIC_* are present in every Vercel build and in
// .env.local, and the menu is publicly readable, so the anon key is enough to LIST the models —
// only the re-upload needs the service role. Read .env.local by hand rather than depending on a
// loader, because `prebuild` runs before anything has been wired up.
function envFromLocalFile() {
  const out = {};
  try {
    const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch { /* no .env.local (a CI runner, a fresh clone) — the DB half is simply skipped */ }
  return out;
}

// THE REAL SOURCE OF TRUTH: the models the app serves are the ones named on menu_items. Reading a
// legacy JSON file could never see them, which is the whole bug this replaces.
async function urlsFromDatabase() {
  const env = { ...envFromLocalFile(), ...process.env };
  const base = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    warn("no Supabase url/key in the environment — cannot list the models the app really serves.");
    warn("  (set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY, or run with .env.local present)");
    return { urls: [], reachedDb: false };
  }
  const urls = new Set();
  try {
    // Scoped read, column list, and a limit — the egress rule applies to build scripts too.
    const r = await fetch(
      `${base}/rest/v1/menu_items?select=model_small_url,model_optimized_url` +
        `&or=(model_small_url.not.is.null,model_optimized_url.not.is.null)&limit=2000`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!r.ok) {
      warn(`could not read menu_items (${r.status}) — skipping the database half.`);
      return { urls: [], reachedDb: false };
    }
    for (const row of await r.json()) {
      if (row.model_small_url) urls.add(row.model_small_url);
      if (row.model_optimized_url) urls.add(row.model_optimized_url);
    }
  } catch (e) {
    warn("could not read menu_items:", e.message);
    return { urls: [], reachedDb: false };
  }
  return { urls: [...urls], reachedDb: true };
}

async function discoverUrls() {
  const urls = new Set();

  try {
    const itemsDir = "public/content/items";
    const folders = await readdir(itemsDir, { withFileTypes: true });
    for (const f of folders) {
      if (!f.isDirectory()) continue;
      try {
        const c = JSON.parse(
          await readFile(join(itemsDir, f.name, "config.json"), "utf8")
        );
        if (c.modelUrl) urls.add(c.modelUrl);
        if (c.smallUrl) urls.add(c.smallUrl);
        if (c.optimizedUrl) urls.add(c.optimizedUrl);
      } catch {}
    }
  } catch {}

  return [...urls].filter((u) => /\.glb($|\?)/i.test(u));
}

function isCorrect(header) {
  if (!header) return false;
  const h = header.toLowerCase();
  return h.includes("max-age=31536000") && h.includes("immutable");
}

function parseSupabasePath(url) {
  const m = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+?)(\?|$)/);
  if (!m) return null;
  return { bucket: m[1], path: m[2] };
}

// IMPORTANT: Use GET with Range: bytes=0-0, NOT HEAD.
// Supabase Storage returns Cache-Control: no-cache on HEAD requests even
// when the GET response has the correct immutable header. Reading the GET
// response is the only honest way to verify the cache header that real
// browsers will see. Range: bytes=0-0 keeps the body to one byte.
async function check(url) {
  const r = await fetch(url, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
  });
  return {
    ok: r.ok,
    cacheControl: r.headers.get("cache-control") || "",
    contentLength: r.headers.get("content-length") || "?",
  };
}

async function fix(url) {
  const parsed = parseSupabasePath(url);
  if (!parsed) {
    warn("  not a Supabase storage URL, skipping:", url);
    return false;
  }
  const dl = await fetch(url);
  if (!dl.ok) {
    warn(`  download failed: ${dl.status}`);
    return false;
  }
  const bytes = await dl.arrayBuffer();

  const target = `${SUPABASE_URL}/storage/v1/object/${parsed.bucket}/${parsed.path}`;
  const up = await fetch(target, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "model/gltf-binary",
      "Cache-Control": TARGET,
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!up.ok) {
    warn(`  re-upload failed: ${up.status} ${await up.text()}`);
    return false;
  }
  return true;
}

const fromFiles = await discoverUrls();
const { urls: fromDb, reachedDb } = await urlsFromDatabase();

// A relative path is served by Next out of public/, so its cache header comes from vercel.json —
// not from Supabase Storage, and not from anything this script can set. Saying so is honest; trying
// to fetch it and printing a parse error was not.
// This applies to BOTH sources. The database is the source of truth for WHICH models exist, but a
// menu_items row can perfectly well name a local path — every model on the dev stack does today
// (the two demo dishes ship inside public/models/). Splitting only the file-sourced list left the
// database's local paths to be fetched and fail, which is the same four parse errors in a new coat.
const isRemote = (u) => /^https?:\/\//i.test(u);
const all = [...new Set([...fromDb, ...fromFiles])];
const local = all.filter((u) => !isRemote(u));
const urls = all.filter(isRemote);

if (local.length) {
  log(`${local.length} model(s) are served by this app out of public/, not by Storage — their headers come from vercel.json, so they are not this script's to set:`);
  for (const u of local) log(`  local  ${u}`);
}
if (urls.length === 0) {
  // NEVER print a clean bill of health for an empty list — that is exactly how this script spent
  // weeks reporting "wrong: 0" while checking nothing at all.
  const dbState = reachedDb
    ? (fromDb.length ? `read OK, ${fromDb.length} model row(s), all served locally` : "read OK, no model rows")
    : "NOT read";
  log(`nothing to check: 0 Storage-hosted GLB URL(s) found (database ${dbState}).`);
  if (!reachedDb) log("this is INCONCLUSIVE, not a pass — the models live in the database and it was not readable.");
  process.exit(0);
}

log(`found ${urls.length} Storage-hosted GLB URL(s)${reachedDb ? ` (${fromDb.length} from the database)` : ""}.`);
log(FIX_MODE ? "running in FIX mode." : "running in CHECK-ONLY mode (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to fix).");

let wrong = 0;
let fixed = 0;
let stillWrong = 0;
let unreadable = 0;

for (const url of urls) {
  const short = url.split("/").pop();
  let res;
  try {
    res = await check(url);
  } catch (e) {
    warn(`  could not read ${short}: ${e.message}`);
    unreadable++;
    continue;
  }
  if (isCorrect(res.cacheControl)) {
    log(`OK     ${short}  (cache-control: ${res.cacheControl})`);
    continue;
  }
  wrong++;
  log(`WRONG  ${short}  (cache-control: ${res.cacheControl || "(none)"})`);
  if (!FIX_MODE) continue;

  try {
    log(`  fixing ${short}...`);
    const ok = await fix(url);
    if (!ok) {
      stillWrong++;
      continue;
    }
    const verify = await check(url);
    if (isCorrect(verify.cacheControl)) {
      log(`  OK     ${short}  (now: ${verify.cacheControl})`);
      fixed++;
    } else {
      stillWrong++;
      warn(`  Supabase still reports: ${verify.cacheControl}`);
    }
  } catch (e) {
    stillWrong++;
    warn(`  fix failed: ${e.message}`);
  }
}

log("---");
const checked = urls.length - unreadable;
log(`checked: ${checked} of ${urls.length}, wrong: ${wrong}, fixed: ${fixed}, still wrong: ${stillWrong}` +
  (unreadable ? `, UNREADABLE: ${unreadable}` : "") + (local.length ? `, local (not ours): ${local.length}` : ""));
if (unreadable) log(`${unreadable} model(s) could not be read, so this run is INCONCLUSIVE for them — do not read it as a pass.`);

if (!FIX_MODE && wrong > 0) {
  log(
    "to fix, run: $env:SUPABASE_URL='...'; $env:SUPABASE_SERVICE_ROLE_KEY='...'; npm run cache-models"
  );
}

process.exit(stillWrong > 0 ? 1 : 0);
