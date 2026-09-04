// scripts/sweep/t18r2/fixture.mjs — the fixtures for T18's round 2, and the promise that every one
// of them is deleted by its own id in the same run.
//
// WHY THIS FILE EXISTS AT ALL. Round 1 could only READ the write paths on the Repair board: it
// drove each action as far as its are-you-sure step and pressed Cancel, because performing a real
// Resolve on a live error row destroys a row another terminal may be re-running. Round 2 performs
// them for real — on rows THIS RUN CREATED, carrying a tag no other lane uses, and deletes exactly
// those ids afterwards.
//
// The rules this obeys, from .claude/sweep/S8-RULES.md §4:
//   · every row written is deleted BY ITS OWN ID, in the same run — never "clean up whatever is
//     there", which is how a sweep eats another terminal's fixture;
//   · anything flipped is restored in a `finally` AND on SIGINT/SIGTERM — this sweep's own scar is
//     verify:realtime, which switched a category off across seven restaurants and then died two
//     steps later;
//   · French House is the write target. AANGAN IS NEVER WRITTEN TO — it is the read-only control at
//     factory defaults, and its differences from French House are the point, not a fault.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const _req = createRequire(new URL("../../../package.json", import.meta.url));
const { createClient } = _req("@supabase/supabase-js");

const ROOT = new URL("../../../", import.meta.url).pathname;
const env = Object.fromEntries(readFileSync(ROOT + ".env.local", "utf8")
  .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));

// The dev/test allow-list, again, at the one place that can write. A fixture file is exactly where
// a wrong key does the most damage.
const DEV_REFS = ["wnsfcizclkbobwzcxqsf", "jhhqzexlpzzwoqnzrgje"];
if (!DEV_REFS.some((r) => (env.NEXT_PUBLIC_SUPABASE_URL || "").includes(r))) {
  console.error("\nrefusing: T18 round 2's fixtures may only run against a dev/test database.\n" +
    `  allowed   ${DEV_REFS.join(", ")}\n`);
  process.exit(1);
}

export const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
export const ADMIN_PASSWORD = env.ADMIN_PASSWORD || "";

/** French House. Aangan is the read-only control and is never written to here. */
export const FRENCH_HOUSE = "00000000-0000-0000-0000-000000000001";
export const AANGAN = "6c6fadb6-da23-4ab3-9f90-d164773f60b3";

/** One tag per run, so a row this run made can never be confused with anybody else's. */
export const RUN = `ZZ-T18R2-${Date.now().toString(36)}`;
/** The action code every fixture row carries. Deliberately unlike any real action. */
export const PROBE_ACTION = "zz_t18r2_probe";

const created = { staff_actions: [], rate_limit_events: [], issues: [] };
const restores = [];

/** Remember a row so it is deleted by id later. */
export const own = (table, id) => { created[table].push(id); return id; };
/** Remember something to put back exactly as it was. */
export const onCleanup = (fn) => { restores.push(fn); };

/**
 * N error reports that look real enough for the board to group them, and are unmistakably ours.
 * The order id changes per row on purpose: errorSig() normalises ids out, so these stay ONE ×N
 * tile — which is the thing round 1 could only assert by reading the code.
 */
export async function makeErrors(n, { panel = "manager", restaurantId = FRENCH_HOUSE, sig = "probe", detail } = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({
    panel, action: PROBE_ACTION, level: "error", restaurant_id: restaurantId,
    detail: detail || `${RUN} ${sig}: the till drawer would not open for order ${1000 + i}`,
    actor: "t18r2",
  }));
  const { data, error } = await sb.from("staff_actions").insert(rows).select("id");
  if (error) throw new Error(`fixture insert failed: ${error.message}`);
  data.forEach((r) => own("staff_actions", r.id));
  return data.map((r) => r.id);
}

/** A limit-reached alert with REAL numbers, so the chip's normal shape can be read on screen. */
export async function makeLimitHit({ key = "guest_order", max = 5, windowSeconds = 3600, hits = 7 } = {}) {
  const { data, error } = await sb.from("rate_limit_events").insert({
    restaurant_id: FRENCH_HOUSE, key, subject: `${RUN}-table-9`, subject_label: `${RUN} · table 9`,
    hit_count: hits, max_count: max, window_seconds: windowSeconds, status: "open",
  }).select("id").maybeSingle();
  if (error) throw new Error(`fixture insert failed: ${error.message}`);
  return own("rate_limit_events", data.id);
}

/** A staff-raised complaint. */
export async function makeIssue({ status = "open", subject } = {}) {
  const { data, error } = await sb.from("issues").insert({
    restaurant_id: FRENCH_HOUSE, raised_by: "t18r2", raised_role: "manager",
    subject: subject || `${RUN} the walk-in cooler is warm again`, body: `${RUN} fixture`, status,
  }).select("id").maybeSingle();
  if (error) throw new Error(`fixture insert failed: ${error.message}`);
  return own("issues", data.id);
}

/**
 * ── THE MISTAKE THIS FUNCTION EXISTS TO PREVENT (2026-09-05) ──────────────────────────────────
 *
 * Round 2's first full run pressed "Resolve all" on the real board. That button does exactly what
 * it says — it resolves EVERY open problem in scope — so it cleared the platform's own 27 error
 * reports, not just the four fixtures this run had made. They were put back by id (resolved_at →
 * null) and the board was verified back to its real state, 11 tiles and "10 problems open". But
 * the rule it broke is the one that matters most in a shared folder: a sweep may write rows it
 * owns and must never TOUCH rows it does not.
 *
 * "Every row you write, you delete by its own id" is not enough for a bulk action, because a bulk
 * action's scope is the SCREEN's, not the fixture's. So a bulk test may only ever run against a
 * restaurant that has nothing of its own to lose.
 *
 * This finds such a restaurant, or refuses. It is the precondition, not a suggestion: without it
 * the test cannot honestly run, and "⏭ no quiet restaurant" is the right answer.
 */
export async function findQuietRestaurant() {
  const { data: rests, error } = await sb.from("restaurants")
    .select("id, name").is("deleted_at", null).eq("active", true).limit(50);
  if (error) throw new Error(`could not list restaurants: ${error.message}`);
  for (const r of rests || []) {
    if (r.id === AANGAN) continue;                     // the read-only control, never a write target
    const { count, error: e } = await sb.from("staff_actions")
      .select("id", { count: "exact", head: true })
      .eq("level", "error").eq("restaurant_id", r.id).is("resolved_at", null);
    if (e) continue;
    if ((count || 0) === 0) return r;                  // nothing of its own to lose
  }
  return null;
}

/**
 * A last line of defence: refuse to let a bulk test proceed against a restaurant that has error
 * rows this run did not make. Called immediately before the press, not just when choosing.
 */
export async function assertOnlyOurs(restaurantId) {
  const { data, error } = await sb.from("staff_actions")
    .select("id, detail, action").eq("level", "error").eq("restaurant_id", restaurantId).is("resolved_at", null).limit(200);
  if (error) throw new Error(`could not check that restaurant: ${error.message}`);
  const foreign = (data || []).filter((r) => !(r.action === PROBE_ACTION || /zz-t18r2/i.test(r.detail || "")));
  if (foreign.length) throw new Error(`REFUSING a bulk press: ${foreign.length} error report(s) there are not this run's. A bulk action's scope is the SCREEN's, not the fixture's.`);
  return true;
}

/** Read one of our rows back, to prove a write actually landed. */
export const readAction = async (id) => (await sb.from("staff_actions")
  .select("id, resolved_at, snoozed_until, level").eq("id", id).maybeSingle()).data;
export const readIssue = async (id) => (await sb.from("issues")
  .select("id, status, resolved_at").eq("id", id).maybeSingle()).data;
export const readLimit = async (id) => (await sb.from("rate_limit_events")
  .select("id, status, hit_count").eq("id", id).maybeSingle()).data;

/**
 * Delete every row this run made, by id, and undo everything it flipped. Safe to call twice.
 * Reports what it did, because a cleanup nobody can see is a cleanup nobody can trust.
 */
let cleaned = false;
export async function cleanup({ quiet = false } = {}) {
  if (cleaned) return [];
  cleaned = true;
  const report = [];
  for (const fn of restores.reverse()) { try { await fn(); } catch (e) { report.push(`restore failed: ${e.message}`); } }
  for (const [table, ids] of Object.entries(created)) {
    if (!ids.length) continue;
    const { error } = await sb.from(table).delete().in("id", ids);
    if (error) { report.push(`DELETE FAILED on ${table} (${ids.length}): ${error.message}`); continue; }
    // Proof, not hope: read back and confirm they are gone.
    const { count } = await sb.from(table).select("id", { count: "exact", head: true }).in("id", ids);
    report.push(`${table}: ${ids.length} row(s) deleted by id${count ? ` — ⚠ ${count} STILL PRESENT` : ", 0 remaining"}`);
  }
  // Nothing this run caused can outlive it either: a real Resolve writes an error_signatures
  // record keyed by OUR detail, and the routes write their own audit lines carrying our tag.
  try {
    // ilike, NOT like. errorSig() LOWERCASES the signature it stores, and Postgres `like` is
    // case-sensitive — so a cleanup keyed on the run tag as typed matched nothing and quietly left
    // its records behind. Caught by one of this round's own phases failing for the WRONG reason:
    // the record WAS written; my query could not see it. A cleanup that cannot find what it made
    // is worse than no cleanup, because it reports success.
    const { count: sigN } = await sb.from("error_signatures").delete({ count: "exact" }).ilike("sig", `%${RUN}%`);
    if (sigN) report.push(`error_signatures: ${sigN} record(s) our probes caused, deleted by our own tag`);
  } catch { /* table may be empty or absent */ }
  const { count: logN } = await sb.from("staff_actions").delete({ count: "exact" }).ilike("detail", `%${RUN}%`);
  if (logN) report.push(`staff_actions: ${logN} extra row(s) carrying our tag (audit lines the routes wrote), deleted`);
  if (!quiet) { console.log("\n── cleanup ──"); report.forEach((r) => console.log("  " + r)); }
  return report;
}

// A crash must never leave a fixture behind. This is the exact scar S8-RULES §4 names.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await cleanup(); process.exit(130); });
process.on("uncaughtException", async (e) => { console.error("\nuncaught: " + (e && e.message)); await cleanup(); process.exit(1); });
process.on("unhandledRejection", async (e) => { console.error("\nunhandled: " + (e && e.message)); await cleanup(); process.exit(1); });
