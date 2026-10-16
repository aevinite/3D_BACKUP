// scripts/sweep/t2s10/env.mjs — sweep #10 T2's DEV database client. Keys come from .env.local and are
// never printed. Refuses any project but the dev one, so a stray key can never point a check at AV live.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
if (!/wnsfcizclkbobwzcxqsf/.test(url || "")) throw new Error("t2s10/env.mjs: .env.local does not point at the DEV project — refusing");
export const sb = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
export const anon = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
export const BASE = process.env.T2_BASE || "http://localhost:4402";
export const FH = "00000000-0000-0000-0000-000000000001";
