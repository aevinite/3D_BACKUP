// scripts/sweep/t15s10/env.mjs — sweep #10 terminal 15: the shared plumbing for its checks.
// Reads .env.local without ever printing a value; hands back a service client for READ-ONLY lookups
// and for deleting, by id, the rows this run itself made.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const read = (p) => readFileSync(join(ROOT, p), "utf8");
export const env = Object.fromEntries(
  read(".env.local").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
let _sb = null;
export const sb = async () => {
  if (_sb) return _sb;
  const { createClient } = await import("@supabase/supabase-js");
  _sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return _sb;
};
export const BASE = process.env.T15_BASE || "http://localhost:4415";

// ONE sign-in per role for the whole run, through the shared helper (it caches on disk for 15 min,
// so a re-run signs in zero times). Hands back a Cookie header for plain fetch() calls.
let _browser = null;
const _cookie = new Map();
export async function cookieFor(role) {
  if (_cookie.has(role)) return _cookie.get(role);
  const { chromium } = await import("playwright");
  const { loginAs } = await import("../login.mjs");
  _browser ||= await chromium.launch();
  const ctx = await _browser.newContext();
  await loginAs(ctx, role, BASE);
  const header = (await ctx.cookies(BASE)).map((c) => `${c.name}=${c.value}`).join("; ");
  await ctx.close();
  _cookie.set(role, header);
  return header;
}
export async function closeBrowser() { if (_browser) { await _browser.close(); _browser = null; } }
