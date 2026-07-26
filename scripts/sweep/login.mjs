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

export const DIAG_LOGINS = {
  manager: { username: "diagm1", password: "diag-mgr-2026", route: "/manager" },
  owner: { username: "diago1", password: "diag-o1-2026", route: "/owner" },
  kitchen: { username: "diagkitchen", password: "diag-kitchen-2026", route: "/kitchen" },
  tablet: { username: "diagt1", password: "diag-t1-2026", route: "/tablet" },
};

// role: a DIAG_LOGINS key, or pass `creds` = { username, password, route } for the
// diag users of a non-#1 restaurant. Returns the panel route to open.
export async function loginAs(context, role, base = "http://localhost:4000", creds) {
  const l = creds || DIAG_LOGINS[role];
  if (!l) throw new Error(`loginAs: unknown role "${role}" and no creds given`);
  const res = await context.request.post(`${base}/api/panel-login`, {
    headers: { "content-type": "application/json" },
    data: { username: l.username, password: l.password },
  });
  if (!res.ok()) {
    throw new Error(`loginAs: panel-login as ${l.username} → HTTP ${res.status()}`);
  }
  return l.route;
}
