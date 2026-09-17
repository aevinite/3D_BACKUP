// T33 sweep #9 — read-only SQL against the DEV Supabase project only.
//
// Transport is `curl`, not fetch, on purpose. Five sweep terminals share this one management
// endpoint and the network to it was measured at 4–9s to connect during this run; Node's undici
// gives up at a fixed 10s and tries IPv6 first, so a fetch here fails while curl succeeds. That is
// a BUSY endpoint, not a broken one — this project's own rule is "busy is treated like offline,
// both ways": a generous deadline plus jittered backoff, never a fixed fast retry.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
export const REF = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (REF !== "wnsfcizclkbobwzcxqsf") { console.error(`refusing: expected the dev project, got ${REF}`); process.exit(2); }

const sleep = (ms) => { const t = Date.now() + ms; while (Date.now() < t) { /* spin: no timers needed */ } };

export function q(sql) {
  let last = "";
  for (let i = 0; i < 6; i++) {
    try {
      const out = execFileSync("curl", ["-4", "-s", "--max-time", "120",
        "-X", "POST", `https://api.supabase.com/v1/projects/${REF}/database/query`,
        "-H", `Authorization: Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        "-H", "Content-Type: application/json",
        "--data-binary", "@-"],
        { input: JSON.stringify({ query: sql, read_only: true }), encoding: "utf8", maxBuffer: 1 << 28 });
      const j = JSON.parse(out);
      if (!Array.isArray(j)) throw new Error(typeof j === "object" ? JSON.stringify(j).slice(0, 300) : String(out).slice(0, 300));
      return j;
    } catch (e) {
      last = String(e.message || e).slice(0, 300);
      if (/syntax error|does not exist|permission denied/i.test(last)) throw new Error(last);
      sleep(Math.round((2 ** i) * 700 * (0.6 + Math.random() * 0.8)));
    }
  }
  throw new Error(`the dev database could not be read after 6 tries: ${last}`);
}
export const one = (sql) => q(sql)[0];
