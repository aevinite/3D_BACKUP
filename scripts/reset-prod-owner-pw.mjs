// One-off: (re)set the PROD demo owner's password to a known value with a fresh
// pbkdf2 hash in the exact format lib/userAuth expects, so owner login works live.
// Targets PROD via the MAIN repo's .env.local; aborts if that ref == sandbox.
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const W = "/Users/aevinite/Documents/Projects/backup_Menu/.claude/worktrees/feat+saas-multitenant/.env.local";
const MAIN = "/Users/aevinite/Documents/Projects/backup_Menu/.env.local";
const parse = (p) => Object.fromEntries(readFileSync(p,"utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const me = parse(MAIN), we = parse(W);
const refOf = (u)=>new URL(u).hostname.split(".")[0];
if (refOf(me.NEXT_PUBLIC_SUPABASE_URL) === refOf(we.NEXT_PUBLIC_SUPABASE_URL)) throw new Error("ABORT: prod ref == sandbox ref");

const PASSWORD = "owner12345";
function hashSecret(plain) {
  const salt = crypto.randomBytes(16);
  const h = crypto.pbkdf2Sync(plain, salt, 120_000, 32, "sha256");
  return `pbkdf2$120000$${salt.toString("base64url")}$${h.toString("base64url")}`;
}
const fresh = hashSecret(PASSWORD);

const p = createClient(me.NEXT_PUBLIC_SUPABASE_URL, me.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { error, count } = await p.from("staff_users")
  .update({ password_hash: fresh, token_version: 0, failed_count: 0, locked_until: null, active: true }, { count: "exact" })
  .eq("username", "owner").eq("role", "owner");
if (error) throw new Error(error.message);
console.log("updated owner rows:", count);

// Re-verify the stored hash matches PASSWORD.
const { data } = await p.from("staff_users").select("password_hash").eq("username","owner").eq("role","owner").single();
const parts = data.password_hash.split("$");
const got = crypto.pbkdf2Sync(PASSWORD, Buffer.from(parts[2],"base64url"), parseInt(parts[1]), 32, "sha256").toString("base64url");
console.log("prod owner pw now =", PASSWORD, "→ verifies?", got === parts[3]);
