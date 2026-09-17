// scripts/shrink-help-shots.mjs — make a WebP twin of every admin help screenshot.
//
// WHY (owner, 2026-09-17: "compress all images"). `public/admin-help/` holds 51 real captures of
// the app, shown in the admin console's ⓘ help sheet (components/AccessTree.tsx) — 5.1 MB of PNG,
// ~150 KB each. A UI screenshot is flat colour and text, which WebP stores far better than PNG: the
// same picture, at the same pixel size, comes out 75-90% smaller with no visible difference in the
// sheet (it is displayed ~476 px wide inside a 520 px card).
//
// It writes a `.webp` NEXT TO each `.png` and deletes nothing. The sheet asks for the WebP and
// falls back to the PNG if it is missing (one `onError` swap), so a help picture can never
// disappear because of this — the worst case is the old, heavier file.
//
// The encoder is the browser this repo already drives for its screenshots (Playwright/Chrome), so
// nothing new is installed: the PNG is drawn to a canvas and exported as WebP — the same two lines
// public/panels/shrinkimg.js runs in a manager's browser when a dish photo is uploaded.
//
//   node scripts/shrink-help-shots.mjs          # write any missing/stale .webp
//   node scripts/shrink-help-shots.mjs --force  # re-encode all of them
//
// RE-RUN IT AFTER scripts/shot-access-help.mjs — that tool writes PNGs; this is what makes them
// light. A capture with no twin still shows (the PNG fallback), it just costs more.
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "public", "admin-help");
const FORCE = process.argv.includes("--force");
const QUALITY = 0.85;

const pngs = readdirSync(DIR).filter((f) => f.endsWith(".png") && !f.startsWith("_raw-"));
const todo = pngs.filter((f) => {
  const webp = join(DIR, f.replace(/\.png$/, ".webp"));
  if (FORCE || !existsSync(webp)) return true;
  // Stale = the PNG is newer than its twin (a fresh capture landed).
  return statSync(join(DIR, f)).mtimeMs > statSync(webp).mtimeMs;
});

if (!todo.length) {
  console.log(`✓ every one of the ${pngs.length} help shots already has an up-to-date .webp twin`);
  process.exit(0);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
// A blank page on the file's own origin is not needed: the image is passed IN as a data URL, so
// the canvas is never tainted and nothing is fetched over the network.
let before = 0, after = 0, failed = 0, wrote = 0;
for (const f of todo) {
  const src = join(DIR, f);
  const buf = readFileSync(src);
  const dataUrl = "data:image/png;base64," + buf.toString("base64");
  const out = await page.evaluate(async ({ url, q }) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = c.toDataURL("image/webp", q);
    return d.startsWith("data:image/webp") ? d.split(",")[1] : null;
  }, { url: dataUrl, q: QUALITY });
  if (!out) { console.log(`  ✗ ${f} — this browser would not encode WebP; the PNG stays in use`); failed++; continue; }
  const webpBuf = Buffer.from(out, "base64");
  // Never write a twin that is BIGGER than the original — then the PNG is simply the better file.
  if (webpBuf.length >= buf.length) { console.log(`  · ${f} — PNG is already smaller, left alone`); continue; }
  writeFileSync(join(DIR, f.replace(/\.png$/, ".webp")), webpBuf);
  before += buf.length;
  after += webpBuf.length;
  wrote++;
  console.log(`  ✓ ${f.padEnd(26)} ${(buf.length / 1024).toFixed(0).padStart(4)} KB → ${(webpBuf.length / 1024).toFixed(0).padStart(4)} KB`);
}
await browser.close();
const pct = before ? Math.round((1 - after / before) * 100) : 0;
// COUNT WHAT WAS WRITTEN, not what was attempted — a PNG that was already smaller is left alone
// and must not be reported as a conversion.
console.log(`\n${wrote} converted · ${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB (${pct}% smaller). The PNGs stay as the fallback.`);
