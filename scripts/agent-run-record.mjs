// Record an agent session in the agent_runs history table (mig 161) so the admin Repair page
// shows EVERY Claude run — pop-up terminals, the 02:30 repair robot, the panel audits.
//
//   node scripts/agent-run-record.mjs start <kind> "<title>"          → prints the new run id
//   node scripts/agent-run-record.mjs end <run-id> <status> [report-file]
//
// kind: live | nightly | audit · status: done | failed | closed. The report file (markdown the
// robot already writes to .claude/audits/) is uploaded capped at 8 KB. Reads .env.local next to
// this script's project root; prints ONLY the run id / "ok" — never a secret. Fails SOFT (exit 0
// with a message on stderr) so recording problems can never break the actual robot run.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) =>
  Object.fromEntries(
    t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
  );

try {
  const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
// Which database is this? (T10 sweep, 2026-08-12 — this script had no answer.)
// One shared allow-list, in scripts/sweep/devStacks.mjs, so it knows about BOTH dev stacks
// (backup-1 and the backup-2 failover) and never about the client one.
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "this writes agent run records");

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing supabase env");
  const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  const [mode, a, b, c] = process.argv.slice(2);
  if (mode === "start") {
    const kind = ["live", "nightly", "audit"].includes(a) ? a : "nightly";
    const res = await fetch(`${url}/rest/v1/agent_runs`, {
      method: "POST", headers: { ...H, Prefer: "return=representation" },
      body: JSON.stringify({ kind, title: String(b || "Agent run").slice(0, 200) }),
    });
    if (!res.ok) throw new Error(`insert HTTP ${res.status}`);
    console.log((await res.json())[0].id);
  } else if (mode === "end") {
    const status = ["done", "failed", "closed"].includes(b) ? b : "done";
    let report;
    if (c) { try { report = readFileSync(c, "utf8").slice(0, 8000); } catch { /* no report file = fine */ } }
    const res = await fetch(`${url}/rest/v1/agent_runs?id=eq.${a}`, {
      method: "PATCH", headers: H,
      body: JSON.stringify({ status, ended_at: new Date().toISOString(), ...(report ? { report } : {}) }),
    });
    if (!res.ok) throw new Error(`patch HTTP ${res.status}`);
    console.log("ok");
  } else {
    console.error("usage: start <kind> <title> | end <id> <status> [report-file]");
  }
} catch (e) {
  console.error(`agent-run-record failed soft: ${e.message}`);
  process.exit(0);
}
