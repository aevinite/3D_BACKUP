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
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DIAG_LOGINS = {
  manager: { username: "diagm1", password: "diag-mgr-2026", route: "/manager" },
  owner: { username: "diago1", password: "diag-o1-2026", route: "/owner" },
  kitchen: { username: "diagkitchen", password: "diag-kitchen-2026", route: "/kitchen" },
  tablet: { username: "diagt1", password: "diag-t1-2026", route: "/tablet" },
  // ── AN OWNER WHO OWNS TWO RESTAURANTS (owner, 2026-08-29) ────────────────────────────────────
  // Roughly a third of the owner dashboard exists ONLY for an owner with more than one restaurant:
  // the estate table and its ten columns, the side drawer, the "top performer / needs attention"
  // banner, the stacked daily bars, the restaurant picker, and the top-bar switcher's re-scope on
  // Dashboard / Reports / Manager mode / Audit & logs. `owner` above owns ONE, so every sweep so
  // far has READ that code and none has DRIVEN it — the T12 ledger says so in P21092, honestly, and
  // that is exactly the gap that let two faults sit for months.
  //
  // Member of My Little French House AND Pizza Palace, via restaurant_owners (mig 097). It is a
  // membership only: no data of its own, nothing seeded, nothing owned exclusively, so it changes
  // no figure any other lane measures. Deliberately NOT Aangan, which stays the read-only control.
  ownerMulti: { username: "diagmulti", password: "diag-multi-2026", route: "/owner" },
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

// ── the SAME cache, shared between PROCESSES ────────────────────────────────────────────────
//
// The in-process Map above fixed "N browser contexts = N logins". It does nothing for "N
// PROCESSES = N logins", which is the shape of a parallel sweep: six lanes of the 500-phase
// suite running at once, each signing in as diagm1, is six attempts against a limit of five per
// five minutes — so the fleet would trip the wall and ping the owner's phone about himself.
//
// So the session is also parked in ONE small file in the OS temp directory (never the repo, and
// never printed). A lane that starts later finds a fresh session and makes ZERO login requests.
// Two lanes starting in the same instant can still both miss and both sign in — that is 2, not 6,
// and stays comfortably under the limit.
const SESSION_FILE = join(tmpdir(), "lfh-sweep-sessions.json");
const SESSION_TTL_MS = 15 * 60 * 1000;
// How many REAL sign-in requests this process has made. Exported so a test can prove the
// caching instead of assuming it — "it should be cached" is how the limit got tripped twice.
let realLogins = 0;
export const loginRequestCount = () => realLogins;
function readDiskSessions() {
  try { return JSON.parse(readFileSync(SESSION_FILE, "utf8")); } catch { return {}; }
}
function writeDiskSession(key, entry) {
  try {
    const all = readDiskSessions();
    all[key] = entry;
    // Write-then-rename so a lane reading this file can never catch it half-written.
    const tmp = `${SESSION_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all));
    renameSync(tmp, SESSION_FILE);
  } catch { /* a cache that cannot be written is not a failure; we just sign in again */ }
}

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
  const shared = readDiskSessions()[key];
  if (shared && Array.isArray(shared.cookies) && shared.cookies.length && Date.now() - (shared.at || 0) < SESSION_TTL_MS) {
    sessionCache.set(key, { cookies: shared.cookies, route: shared.route });
    await context.addCookies(shared.cookies);
    return shared.route;
  }

  // ── A SESSION PAST ITS TTL IS NOT A DEAD SESSION — TRY IT BEFORE SPENDING A LOGIN ────────────
  // (T13 of sweep #8, 2026-09-05 — the owner picked it as his item 10.)
  //
  // The 15-minute TTL above is this file's guess at how long a session lasts. The real cookie
  // lives far longer, so a sweep that runs for an hour across a dozen separate scripts threw away
  // a perfectly good session three or four times and signed in again for no reason. That is what
  // tripped the app's own limit during this very sweep: five sign-ins in five minutes answers 429,
  // and on a stack with alerts switched on the owner is messaged about his own test tooling.
  //
  // So an EXPIRED entry is now tested rather than discarded: replay its cookies and ask the panel
  // route whether it still answers. A GET is not rate-limited and costs nothing anyone notices;
  // a sign-in is the expensive, alarming thing. If it still works we re-stamp it and make ZERO
  // login requests.
  if (shared && Array.isArray(shared.cookies) && shared.cookies.length) {
    try {
      await context.addCookies(shared.cookies);
      const probe = await context.request.get(`${base}${shared.route || l.route}`, { maxRedirects: 0, timeout: 30000 });
      const signedIn = probe.status() === 200;
      if (signedIn) {
        sessionCache.set(key, { cookies: shared.cookies, route: shared.route || l.route });
        writeDiskSession(key, { cookies: shared.cookies, route: shared.route || l.route, at: Date.now() });
        return shared.route || l.route;
      }
    } catch { /* the probe failing just means we fall through and sign in properly */ }
  }

  // ── AND IF WE DO HAVE TO SIGN IN, NEVER WALK INTO THE WALL TWICE ─────────────────────────────
  // The limit is five attempts per five minutes. Answering a 429 by throwing meant the lane died
  // AND the attempt still counted; two lanes doing that in a row is how a whole sweep ends up
  // locked out. Wait the window out and try once more — honouring Retry-After when the server
  // sends one — and say plainly in the error which it was, so a real wrong-password never gets
  // mistaken for a limit.
  const attempt = () => context.request.post(`${base}/api/panel-login`, {
    headers: { "content-type": "application/json" },
    data: { username: l.username, password: l.password },
  });
  realLogins++;
  let res = await attempt();
  if (res.status() === 429) {
    const after = Number(res.headers()["retry-after"]);
    const waitMs = Math.min(Math.max(Number.isFinite(after) ? after * 1000 : 60_000, 5_000), 5 * 60_000);
    console.warn(`[loginAs] ${l.username}: the app's sign-in limit answered 429. Waiting ${Math.round(waitMs / 1000)}s ` +
      `rather than hammering it — this is our own tooling being too eager, not a fault in the app.`);
    await new Promise((r) => setTimeout(r, waitMs));
    realLogins++;
    res = await attempt();
  }
  if (!res.ok()) {
    throw new Error(res.status() === 429
      ? `loginAs: panel-login as ${l.username} is still rate-limited after waiting. Some other lane is ` +
        `signing in in a loop — find it rather than raising the limit.`
      : `loginAs: panel-login as ${l.username} → HTTP ${res.status()}`);
  }
  // Cache the resulting cookies, re-pointed at `base` so any context can accept them.
  const cookies = (await context.cookies()).map((c) => ({ name: c.name, value: c.value, url: base }));
  if (cookies.length) {
    sessionCache.set(key, { cookies, route: l.route });
    writeDiskSession(key, { cookies, route: l.route, at: Date.now() });
  }
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
