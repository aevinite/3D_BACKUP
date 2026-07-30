// scripts/sweep/login.mjs — shared login helper for /bug-test sweeps.
//
// Signs an EXISTING Playwright BrowserContext in as a per-restaurant diag staff user
// via POST /api/panel-login (the same dev-only diag users committed in
// scripts/view-device.mjs / shot-access-help.mjs — see test-staff-logins memory).
// Taking the context as an argument keeps this file dependency-free, so it works from
// a worktree before `npm install` and lets callers pick the engine (chromium/webkit).
//
//   import { chromium } from "playwright";
//   import { loginAs, DIAG_LOGINS } from "./scripts/sweep/login.mjs";
//   const browser = await chromium.launch();
//   const ctx = await browser.newContext();
//   const route = await loginAs(ctx, "manager", "http://localhost:4101");
//   const page = await ctx.newPage();
//   await page.goto("http://localhost:4101" + route);

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const DIAG_LOGINS = {
  manager: { username: "diagm1", password: "diag-mgr-2026", route: "/manager" },
  owner: { username: "diago1", password: "diag-o1-2026", route: "/owner" },
  kitchen: { username: "diagkitchen", password: "diag-kitchen-2026", route: "/kitchen" },
  tablet: { username: "diagt1", password: "diag-t1-2026", route: "/tablet" },
};

// role: a DIAG_LOGINS key, or pass `creds` = { username, password, route } for the
// diag users of a non-#1 restaurant. Returns the panel route to open.
// ONE login per (role, base) per process — reused for every later context.
//
// WHY THIS CACHE EXISTS (owner, 2026-07-29 + 2026-07-30): staff login is rate-limited to 5 per
// 5 minutes, and reaching that wall sends a "limit reached" alert to the owner's PHONE. Our own
// tooling was the thing setting it off: a sweep that opens several browser contexts called
// loginAs() once per context, so one run could burn five logins in a few seconds and ping him
// about himself. Noise is how a real alert gets ignored, so this is a correctness bug in the
// test tooling, not a finding. The cookies are identical for the same role, so we sign in once
// and ADD the cookies to every later context instead of asking the server again.
const sessionCache = new Map(); // `${base}|${username}` -> { cookies, route }

export async function loginAs(context, role, base = "http://localhost:4000", creds) {
  const l = creds || DIAG_LOGINS[role];
  if (!l) throw new Error(`loginAs: unknown role "${role}" and no creds given`);
  const key = `${base}|${l.username}`;

  const cached = sessionCache.get(key);
  if (cached) {
    // Replay the existing session into this context — zero extra login requests.
    await context.addCookies(cached.cookies);
    return cached.route;
  }

  const res = await context.request.post(`${base}/api/panel-login`, {
    headers: { "content-type": "application/json" },
    data: { username: l.username, password: l.password },
  });
  if (!res.ok()) {
    throw new Error(`loginAs: panel-login as ${l.username} → HTTP ${res.status()}`);
  }
  // Cache the resulting cookies, re-pointed at `base` so any context can accept them.
  const cookies = (await context.cookies()).map((c) => ({ name: c.name, value: c.value, url: base }));
  if (cookies.length) sessionCache.set(key, { cookies, route: l.route });
  return l.route;
}

// For the ADMIN gate: never POST a password at all.
//
// The gate (lib/staffAuth.ts) accepts a cookie holding sha256(ADMIN_PASSWORD), so a test can
// present that directly and make ZERO login requests — no failed-login rows, no IP throttle, no
// alert, ever. This exists because the alternative bit us: posting to /api/staff-login as JSON
// silently fails (the route reads FORM data), so three "checks" became three WRONG-PASSWORD
// attempts and raised a limit event about the owner's own admin panel (2026-07-30).
//
//   import { adminCookie, adminHeaders } from "./scripts/sweep/login.mjs";
//   const ctx = await browser.newContext({ extraHTTPHeaders: adminHeaders() });
export function adminCookie(base = "http://localhost:4000") {
  const pw = process.env.ADMIN_PASSWORD || readEnvAdminPassword();
  if (!pw) throw new Error("adminCookie: ADMIN_PASSWORD not found in the environment or .env.local");
  const value = createHash("sha256").update(pw).digest("hex");
  return { name: "lfh_staff_auth", value, url: base };
}
export function adminHeaders(base = "http://localhost:4000") {
  const c = adminCookie(base);
  return { Cookie: `${c.name}=${c.value}` };
}
function readEnvAdminPassword() {
  try {
    const txt = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    const m = txt.match(/^ADMIN_PASSWORD=(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}
