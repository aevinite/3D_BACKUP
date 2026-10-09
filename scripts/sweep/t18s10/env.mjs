// scripts/sweep/t18s10/env.mjs — the DEV database client for terminal 18's read-only checks, and the
// two restaurants every live check names. Keys are read from .env.local and never printed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { ROOT } from "./lib.mjs";

const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
// The dev project only — refuse anything else so a stray key can never point this at AV live.
if (!/wnsfcizclkbobwzcxqsf/.test(url || "")) throw new Error("env.mjs: .env.local does not point at the DEV project — refusing");
export const sb = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// The real lib/supabaseAdmin (bundled for the read-only checks) reads these from the process.
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) if (env[k] && !process.env[k]) process.env[k] = env[k];
export const BASE = process.env.T18_BASE || "http://localhost:4418";
export async function restaurantBySlug(slug) {
  const r = await sb.from("restaurants").select("id, slug, name").eq("slug", slug).maybeSingle();
  if (r.error || !r.data) throw new Error(`no restaurant ${slug}`);
  return r.data;
}
