// Scans menu.json + every public/content/items/*/config.json for GLB URLs,
// checks each URL's Cache-Control header, and re-uploads anything that does
// not already have "public, max-age=31536000, immutable".
//
// Idempotent — safe to re-run any time. Only re-uploads files whose header
// is wrong.
//
// Usage (manual):
//   $env:SUPABASE_URL = "https://klnohzowlmbumvvzddya.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "ey..."   # NEVER commit this key
//   node scripts/set-glb-cache.mjs
//
// Without env vars set, the script runs in CHECK-ONLY mode: it reports any
// files with the wrong header but does not modify anything. This makes it
// safe to wire into `prebuild` so deploys do not break for developers who
// don't have the service-role key.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const TARGET = "public, max-age=31536000, immutable";
const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FIX_MODE = Boolean(SUPABASE_URL && KEY);

const log = (...a) => console.log("[cache]", ...a);
const warn = (...a) => console.warn("[cache]", ...a);

async function discoverUrls() {
  const urls = new Set();

  try {
    const menu = JSON.parse(
      await readFile("public/content/menu.json", "utf8")
    );
    for (const it of menu.items || []) {
      if (it.modelSmallUrl) urls.add(it.modelSmallUrl);
      if (it.modelOptimizedUrl) urls.add(it.modelOptimizedUrl);
    }
  } catch (e) {
    warn("could not read menu.json:", e.message);
  }

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

const urls = await discoverUrls();
if (urls.length === 0) {
  log("no GLB URLs found in menu.json or config files.");
  process.exit(0);
}

log(`found ${urls.length} unique GLB URL(s).`);
log(FIX_MODE ? "running in FIX mode." : "running in CHECK-ONLY mode (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to fix).");

let wrong = 0;
let fixed = 0;
let stillWrong = 0;

for (const url of urls) {
  const short = url.split("/").pop();
  let res;
  try {
    res = await check(url);
  } catch (e) {
    warn(`  HEAD failed for ${short}: ${e.message}`);
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
log(`scanned: ${urls.length}, wrong: ${wrong}, fixed: ${fixed}, still wrong: ${stillWrong}`);

if (!FIX_MODE && wrong > 0) {
  log(
    "to fix, run: $env:SUPABASE_URL='...'; $env:SUPABASE_SERVICE_ROLE_KEY='...'; npm run cache-models"
  );
}

process.exit(stillWrong > 0 ? 1 : 0);
