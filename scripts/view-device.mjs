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
import { chromium } from "playwright";

const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ") || true])
);
const device = args.device === "tablet" ? "tablet" : "phone";
const role = args.role || "guest";
const slug = args.slug || "french-house";

const BASE = "http://localhost:4000";
// French-House diag logins (see test-staff-logins memory). Swap for other restaurants.
const LOGIN = {
  tablet:  { user: "diagt1",       pass: "diag-t1-2026",      route: "/tablet"  },
  manager: { user: "diagm1",       pass: "diag-mgr-2026",     route: "/manager" },
  kitchen: { user: "diagkitchen",  pass: "diag-kitchen-2026", route: "/kitchen" },
  owner:   { user: "diago1",       pass: "diag-o1-2026",      route: "/owner"   },
};

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
  const l = LOGIN[role];
  if (!l) { console.error("unknown role:", role); process.exit(1); }
  const res = await ctx.request.post(`${BASE}/api/panel-login`, {
    headers: { "content-type": "application/json" },
    data: { username: l.user, password: l.pass },
  });
  console.log(`LOGIN ${role}:`, res.status());
  route = args.route || l.route;
}

const page = await ctx.newPage();
await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 30000 });
console.log(`Chrome open: ${device} view of ${route} (${VP.width}x${VP.height}). Close the window when done.`);

browser.on("disconnected", () => process.exit(0));
await new Promise(() => {});
