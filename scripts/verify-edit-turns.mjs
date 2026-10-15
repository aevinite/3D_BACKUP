// verify-edit-turns.mjs — "two saves of one thing take turns" (sweep #10 T12 round 2, item 10; mig 422).
//
//   node scripts/verify-edit-turns.mjs          # static + the database half (dev stack only)
//   node scripts/verify-edit-turns.mjs --static # the code half only
//
// WHY. lib/clash.ts's expectClash READS a row and compares it with what the screen was editing from; the
// handler WRITES later. Two saves of the same row in the same instant both passed and the later one
// silently replaced the earlier — the "first save wins, loser told" rule broken exactly when it matters.
// The fix is a short TURN per row (migration 422's lfh_edit_turn_take / _release), taken by
// expectClashInTurn() and given back by releaseEditTurnAfter() around the route handler.
//
// THIS GUARD HOLDS BOTH HALVES:
//   1. every panel dispatcher compares through expectClashInTurn, and every route export whose handler
//      does so is wrapped in releaseEditTurnAfter — a turn taken and never released would make the next
//      person editing that row wait for the 8-second expiry;
//   2. on the DEV database: a second token cannot take a held turn, the holder's release frees it, and a
//      stranger's release cannot. The probe uses its own key and deletes it before it exits.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };
const fails = [];
let passed = 0;
const check = (name, ok, why) => { if (ok) { passed++; console.log("  ✅ " + name); } else { fails.push(name); console.log("  ❌ " + name + (why ? " — " + why : "")); } };

console.log("1. the code: every panel dispatcher waits its turn and gives it back");
const ROUTES = {
  "app/api/tablet/[...path]/route.ts": ["POST"],
  "app/api/editor/[...path]/route.ts": ["POST", "PATCH"],
  "app/api/kitchen/[...path]/route.ts": ["POST"],
  "app/api/inventory/[...path]/route.ts": ["POST"],
};
for (const [file, exps] of Object.entries(ROUTES)) {
  const src = read(file);
  const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  check(`${file}: compares through expectClashInTurn (never the bare expectClash)`,
    /await expectClashInTurn\(req, rid\)/.test(code) && !/await expectClash\(req, rid\)/.test(code));
  for (const e of exps) {
    const line = (code.match(new RegExp(`export const ${e} = [^\\n]+`)) || [""])[0];
    check(`${file}: ${e} is wrapped in releaseEditTurnAfter`, /releaseEditTurnAfter\(/.test(line), line.trim() || "export not found");
  }
}
const lib = read("lib/clash.ts");
check("lib/clash.ts: a failed or missing turn table FAILS OPEN (the save is compared, never refused for it)",
  /if \(res\.error\) return;/.test(lib) && /if \(Date\.now\(\) >= until\) return;/.test(lib));
check("lib/clash.ts: the release runs in a finally, whatever the handler returned or threw",
  /try \{ return await fn\(req, \.\.\.rest\); \}\s*finally \{ await releaseEditTurn\(req\); \}/.test(lib));
const mig = read("supabase/migrations/422_two_saves_of_one_thing_take_turns.sql").replace(/--[^\n]*/g, "");
check("migration 422: both functions are service_role-only and the table has RLS on with no public grant",
  /REVOKE ALL ON FUNCTION public\.lfh_edit_turn_take[^;]+FROM PUBLIC, anon, authenticated/.test(mig)
  && /REVOKE ALL ON FUNCTION public\.lfh_edit_turn_release[^;]+FROM PUBLIC, anon, authenticated/.test(mig)
  && /GRANT EXECUTE ON FUNCTION public\.lfh_edit_turn_take[^;]+TO service_role/.test(mig)
  && /ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON TABLE public\.edit_turns FROM PUBLIC, anon, authenticated/.test(mig)
  && !/CREATE POLICY/i.test(mig));

if (!process.argv.includes("--static")) {
  console.log("\n2. the database: one turn at a time, released only by its holder (dev stack)");
  const env = (() => { const t = read(".env.local"); const g = (k) => (t.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, ""); return { url: g("NEXT_PUBLIC_SUPABASE_URL"), key: g("SUPABASE_SERVICE_ROLE_KEY") }; })();
  if (!env.url || !env.key) console.log("  (no .env.local keys — the database half was not run)");
  else {
    const { refuseUnlessDevTestDb } = await import("./sweep/devStacks.mjs");
    refuseUnlessDevTestDb(env.url, "this probes the edit-turn functions");
    const rpc = async (fn, args) => {
      const r = await fetch(`${env.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
      const t = await r.text(); if (!r.ok) throw new Error(`${fn} ${r.status} ${t.slice(0, 120)}`); return t ? JSON.parse(t) : null;
    };
    const RID = "00000000-0000-0000-0000-000000000001";
    const key = `verify-edit-turns:${randomUUID()}`, a = randomUUID(), b = randomUUID();
    try {
      check("the first save takes the turn", (await rpc("lfh_edit_turn_take", { p_key: key, p_rid: RID, p_token: a, p_ttl_ms: 8000 })) === true);
      check("a second save of the same row cannot take it while it is held", (await rpc("lfh_edit_turn_take", { p_key: key, p_rid: RID, p_token: b, p_ttl_ms: 8000 })) === false);
      await rpc("lfh_edit_turn_release", { p_key: key, p_token: b });
      check("a release by someone who does not hold it frees nothing", (await rpc("lfh_edit_turn_take", { p_key: key, p_rid: RID, p_token: b, p_ttl_ms: 8000 })) === false);
      await rpc("lfh_edit_turn_release", { p_key: key, p_token: a });
      check("once the holder releases it, the next save takes it", (await rpc("lfh_edit_turn_take", { p_key: key, p_rid: RID, p_token: b, p_ttl_ms: 8000 })) === true);
    } finally {
      await rpc("lfh_edit_turn_release", { p_key: key, p_token: b }).catch(() => {});
      await rpc("lfh_edit_turn_release", { p_key: key, p_token: a }).catch(() => {});
    }
  }
}
console.log(fails.length ? `\n❌ edit turns: ${passed} passed, ${fails.length} failed` : `\n✅ edit turns: all ${passed} checks passed — two saves of one thing take turns`);
process.exit(fails.length ? 1 : 0);
