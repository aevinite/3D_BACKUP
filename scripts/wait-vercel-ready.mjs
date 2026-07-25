// Poll Vercel until the newest 3-d-backup deployment is READY (or ERROR/timeout). Prints only
// state + short sha/message — NEVER the token. Also prints the production alias when READY.
// Exit 0 = READY, 1 = error/timeout. Run: node scripts/wait-vercel-ready.mjs
import fs from "fs";
const env = fs.readFileSync(".env.local", "utf8");
const g = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""; };
const TOK = g("VERCEL_TOKEN") || g("VERCEL_API_TOKEN");
if (!TOK) { console.log("no VERCEL_TOKEN"); process.exit(1); }
const H = { Authorization: "Bearer " + TOK };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEADLINE = Date.now() + 14 * 60 * 1000;
let last = "";
while (Date.now() < DEADLINE) {
  const r = await fetch("https://api.vercel.com/v6/deployments?app=3-d-backup&limit=1", { headers: H });
  const j = await r.json();
  const d = (j.deployments || [])[0];
  if (!d) { console.log("no deployments"); process.exit(1); }
  const line = `${new Date().toISOString().slice(11, 19)}  ${d.state}  ${(d.meta?.githubCommitSha || "").slice(0, 7)}  ${(d.meta?.githubCommitMessage || "").slice(0, 44)}`;
  if (line.slice(9) !== last) { console.log(line); last = line.slice(9); }
  if (d.state === "READY") {
    // fetch the production alias for the verify base
    const dr = await fetch(`https://api.vercel.com/v13/deployments/${d.uid}`, { headers: H });
    const dj = await dr.json();
    const alias = (dj.alias || []).find((a) => !/vercel\.app$/.test(a)) || (dj.alias || [])[0] || dj.url;
    console.log("READY_URL=https://" + String(alias).replace(/^https?:\/\//, ""));
    process.exit(0);
  }
  if (d.state === "ERROR" || d.state === "CANCELED") { console.log("deploy " + d.state); process.exit(1); }
  await sleep(20000);
}
console.log("timeout waiting for READY");
process.exit(1);
