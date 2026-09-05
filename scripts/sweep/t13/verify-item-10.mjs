// Item 10: an EXPIRED cached session must be TESTED and reused, not thrown away for a fresh
// sign-in — which is what tripped the app's own limit during sweep #8.
//
// This has to run the second half in a SEPARATE PROCESS. The first version did not, and proved
// nothing: `loginAs` keeps an in-process Map that hits before the disk is ever consulted, so the
// new stale-probe branch was never reached and the test passed without exercising it. A fresh
// process is exactly the shape a long sweep has — a dozen scripts, each starting cold.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loginAs, loginRequestCount } from "../login.mjs";

const BASE = "http://localhost:4313";
const FILE = join(tmpdir(), "lfh-sweep-sessions.json");

if (process.argv[2] === "--child") {
  // one cold process: sign in (or reuse), then say what it cost and whether it works
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const route = await loginAs(ctx, "owner", BASE);
  const pg = await ctx.newPage();
  await pg.goto(BASE + route, { waitUntil: "networkidle", timeout: 180000 });
  await pg.waitForTimeout(2600);
  const tiles = await pg.locator(".ow2-kpi").count();
  const onLogin = /\/login/.test(new URL(pg.url()).pathname);
  console.log(JSON.stringify({ logins: loginRequestCount(), tiles, onLogin, route }));
  await b.close();
  process.exit(0);
}

// warm it honestly
const b = await chromium.launch();
await loginAs(await b.newContext(), "owner", BASE);
await b.close();
console.log("cache warmed; this process made", loginRequestCount(), "real sign-in request(s)");

// age EVERY stored entry well past the 15-minute TTL — the state a long sweep reaches
const all = JSON.parse(readFileSync(FILE, "utf8"));
for (const k of Object.keys(all)) all[k].at = Date.now() - 60 * 60 * 1000;
writeFileSync(FILE, JSON.stringify(all));
const agedAt = JSON.parse(readFileSync(FILE, "utf8"));
const key = Object.keys(agedAt).find((k) => k.includes("4313") && k.includes("diago1"));
console.log("aged the stored session to 1 hour old (TTL is 15 min)");

// a COLD process must now reuse it rather than spend a sign-in
const out = JSON.parse(execFileSync(process.execPath, [new URL(import.meta.url).pathname, "--child"], { encoding: "utf8", timeout: 600000 }).trim().split("\n").pop());
console.log("cold process → sign-in requests:", out.logins, out.logins === 0 ? "✅ reused the expired session" : "❌ signed in again");
console.log("cold process → really signed in:", !out.onLogin && out.tiles === 5 ? `✅ ${out.tiles} tiles on ${out.route}` : `❌ onLogin=${out.onLogin} tiles=${out.tiles}`);

// and it must have RE-STAMPED the entry, so the next lane finds it fresh
const after = JSON.parse(readFileSync(FILE, "utf8"));
const ageS = Math.round((Date.now() - (after[key]?.at || 0)) / 1000);
console.log("stored session age after the cold run:", ageS, "s", ageS < 300 ? "✅ re-stamped" : "❌ still stale");
