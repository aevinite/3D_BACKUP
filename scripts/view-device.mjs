// scripts/view-device.mjs — open a VISIBLE Chrome window of the local app, emulated
// as a phone (Samsung Galaxy A35) or a tablet, logged in as the right role.
//
// ONLY run this when the owner explicitly says "check phone / phone view / view on
// phone" (or the tablet equivalent). Do NOT run it automatically — it opens a real
// window and is meant to be on-demand.
//
// Usage (from repo root, dev server already on :4000):
//   node scripts/view-device.mjs                       # phone + guest menu (French House)
//   node scripts/view-device.mjs --role tablet         # phone-size waiter /tablet panel
//   node scripts/view-device.mjs --device tablet --role tablet   # iPad-size /tablet
//   node scripts/view-device.mjs --role manager --slug pizza-palace
//
// Flags:
//   --device phone|tablet   default phone (A35 360x780 dpr3). tablet = iPad 1194x834 dpr2.
//   --role   guest|tablet|manager|kitchen|owner   default guest (no login needed).
//   --slug   restaurant slug for the guest menu (default french-house).
//   --route  optional explicit path override (e.g. /menu).
//   --base   optional server to open (default http://localhost:4000). Use this when the work
//            is on a worktree's own dev server (e.g. --base http://localhost:8001) — without
//            it the window shows the shared folder's app and looks like nothing changed.
import { chromium } from "playwright";
import { loginAs, DIAG_LOGINS } from "./sweep/login.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ") || true])
);
const device = args.device === "tablet" ? "tablet" : "phone";
const role = args.role || "guest";
const slug = args.slug || "french-house";

// --base lets this point at a second dev server (a preview on another port) instead of
// the everyday :4000. The diag logins themselves live in ONE place now — scripts/sweep/
// login.mjs — whose loginAs() caches the session on disk, so opening several of these
// windows costs ONE sign-in rather than one each (staff login is rate-limited to 5 per
// 5 minutes, and reaching that wall pings the owner's phone about himself).
const BASE = (typeof args.base === "string" && args.base) || "http://localhost:4000";

const VP = device === "tablet"
  ? { width: 1194, height: 834, dpr: 2 }   // iPad-ish landscape
  : { width: 360,  height: 780, dpr: 3 };  // Samsung Galaxy A35

const browser = await chromium.launch({
  channel: "chrome", headless: false, devtools: true,
  args: [`--window-size=${VP.width + 60},${VP.height + 120}`],
});
const ctx = await browser.newContext({
  viewport: { width: VP.width, height: VP.height },
  deviceScaleFactor: VP.dpr, isMobile: device === "phone", hasTouch: true,
  userAgent: device === "phone"
    ? "Mozilla/5.0 (Linux; Android 14; SM-A356B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"
    : undefined,
});

let route = args.route || `/r/${slug}/menu?table=5`;
if (role !== "guest") {
  // Log in as the real role FIRST — an admin cookie shows the admin console +
  // orange "ADMIN VIEW" bar instead of the true staff view.
  if (!DIAG_LOGINS[role]) { console.error("unknown role:", role); process.exit(1); }
  const panelRoute = await loginAs(ctx, role, BASE);
  route = args.route || panelRoute;
}

const page = await ctx.newPage();
await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 30000 });
console.log(`Chrome open: ${device} view of ${route} (${VP.width}x${VP.height}). Close the window when done.`);

browser.on("disconnected", () => process.exit(0));
await new Promise(() => {});
