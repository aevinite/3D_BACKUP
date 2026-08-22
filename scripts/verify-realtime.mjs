// verify:realtime — does a real change actually REACH a panel over the websocket?
//
// Subscribes the way a browser does (anon key) to rt:menu + rt:ops + rt:audit, makes real writes
// with the service key, and asserts each breadcrumb arrives. Prints only non-secret data.
//   node scripts/verify-realtime.mjs
//
// ── WHAT WENT WRONG WITH THIS GUARD, AND WHY EACH FIX IS HERE (T30 sweep, 2026-08-22) ──────────
// Its own step-5 comment already said the thing that then happened to it: "A guard that is
// permanently red is a guard people learn to skip." It was red, and it CRASHED, for five reasons:
//
//  1 · IT ASSERTED ON THE FIRST WRITE AFTER SUBSCRIBING and lost the replication warm-up race, so
//      step 1 reported "NO menu/menu_item breadcrumb within 5s" on behaviour that is CORRECT.
//      Proved by counting rows instead of trusting the socket: French House's menu_item breadcrumbs
//      went 8 → 9 across the very write the socket missed. Steps 2 and 3 passed in 209ms and 473ms
//      because by then the stream was warm. → warmUp() below writes once and discards, BEFORE the
//      first assertion, and every assertion now retries once rather than failing on a single miss.
//
//  2 · IT CRASHED AT STEP 4 AND SO NEVER RAN STEP 5 AT ALL. (A database terminal fixed THIS half
//      independently on main — commit 7b706bfc, "all 25 tables stop guessing the restaurant" — by
//      adding restaurant_id to the insert. Checked its version before keeping this one: the crash is
//      gone there, and all four unscoped writes below, plus the warm-up race, are still present.) `public.sessions.restaurant_id` is
//      NOT NULL with no default; the insert supplied neither it nor a scope, the error was logged
//      but not returned, and the next line did `s.id` on null → TypeError. So the guard's real
//      coverage was one step smaller than it claimed and nothing said so. → the insert supplies
//      every NOT-NULL column that has no default (`restaurant_id`, `table_number` — everything
//      else defaults), and a failed insert REPORTS and moves on instead of throwing.
//      Worth writing down: `information_schema.columns` without a `table_schema` filter also
//      returns Supabase's own `auth.sessions`, which is where `user_id NOT NULL` comes from. It is
//      not a column of OUR table, and adding it to the insert makes PostgREST answer "Could not
//      find the 'user_id' column of 'sessions' in the schema cache". Always filter the schema.
//
//  3 · ITS SESSION CLEANUP WAS UNSCOPED: `.delete().eq("table_number", tnum)` removed that table's
//      session in EVERY restaurant. The sweep rules are explicit — never a broad
//      delete-whatever-is-there filter; delete the exact rows you inserted, by id.
//
//  4 · ITS CATEGORY STEP WROTE TO EVERY RESTAURANT SHARING A SLUG. `.update({active}).eq("slug",
//      slug)` with no restaurant filter: on the dev database the slug `drinks` is shared by SEVEN
//      restaurants, one of which is Aangan — the read-only control the whole access-defaults check
//      depends on. It restored on the next line, but the run then died at (2), so a kill in that
//      window left a real category switched off. That is the exact scar the sweep rules open with:
//      "a guard once died with a restaurant's Menu switch off and real scans got a 404 for an hour."
//
//  5 · ITS DISH STEP PICKED ITS ROW WITH AN UNSCOPED, UNORDERED `.limit(1)`, so which restaurant it
//      wrote to was luck of the query plan.
//
// THE RULE THIS FILE NOW FOLLOWS: every read and every write is scoped to FRENCH_HOUSE, every
// change is restored, and the restore runs even if the process is killed — the same contract
// docs/QA-500-PHASES.md states for the big suite ("restores on the way out, even when killed").
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function parseEnv(t) { const o = {}; for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, ""); } return o; }
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

// The ONE restaurant this guard is allowed to write to. Aangan and every other tenant are read-only
// here; nothing below selects a row without naming this id.
const FRENCH_HOUSE = "00000000-0000-0000-0000-000000000001";
// A table number no real floor uses, so a stray row from a killed run can never collide with service.
const TEST_TABLE = "ZZ-rt-selftest";

const anon = createClient(URL_, ANON, { realtime: { params: { eventsPerSecond: 10 } } });
const svc = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const got = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── RESTORE ALWAYS, EVEN IF KILLED ─────────────────────────────────────────────────────────────
// Every step that changes a row registers how to put it back. A guard that leaves a restaurant
// half-configured is worse than no guard.
const undo = [];
let restoring = false;
async function restoreAll(why) {
  if (restoring) return; restoring = true;
  if (undo.length) console.log(`\n↩︎ restoring ${undo.length} change(s)${why ? " (" + why + ")" : ""}…`);
  for (const fn of undo.reverse()) { try { await fn(); } catch (e) { console.error("  restore FAILED:", e?.message || e); } }
  undo.length = 0;
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await restoreAll(sig); process.exit(130); });
process.on("uncaughtException", async (e) => { console.error("\nunexpected failure:", e?.message || e); await restoreAll("crash"); process.exit(1); });
process.on("unhandledRejection", async (e) => { console.error("\nunexpected failure:", e?.message || e); await restoreAll("crash"); process.exit(1); });

function listen(topic) {
  return new Promise((resolve) => {
    anon.channel("rt:" + topic)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "realtime_events", filter: "topic=eq." + topic },
        (p) => got.push({ topic, kind: p.new.kind, at: Date.now() }))
      .subscribe((s) => { if (s === "SUBSCRIBED") resolve(); });
  });
}

// Run a write, then wait for its breadcrumb. Clears the buffer FIRST and uses a strict post-write
// window so we never match a leftover event from a prior step. RETRIES ONCE: a single miss on a
// stream that has only just come up is not evidence the product is wrong — a miss on both is.
async function expectBreadcrumb(topic, kind, label, write, { attempts = 2, windowMs = 6000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    got.length = 0;
    const start = Date.now();
    await write();
    while (Date.now() - start < windowMs) {
      const hit = got.find((e) => e.topic === topic && e.kind === kind && e.at >= start);
      if (hit) { console.log(`✓ ${label}: received ${topic}/${kind} in ${hit.at - start}ms${attempt > 1 ? ` (attempt ${attempt})` : ""}`); return true; }
      await sleep(50);
    }
    if (attempt < attempts) console.log(`  … ${label}: nothing yet, retrying once (the stream may still be warming up)`);
  }
  console.log(`✗ ${label}: NO ${topic}/${kind} breadcrumb after ${attempts} attempts`);
  return false;
}

await Promise.all([listen("menu"), listen("ops"), listen("audit")]);
console.log("subscribed to rt:menu + rt:ops + rt:audit");

// ── WARM UP BEFORE ASSERTING ANYTHING ──────────────────────────────────────────────────────────
// `SUBSCRIBED` means the channel is joined, NOT that the replication stream is delivering yet.
// One throwaway write, result discarded, so step 1 is not the one that pays for the warm-up.
async function warmUp() {
  const { data } = await svc.from("settings").select("restaurant_id").eq("restaurant_id", FRENCH_HOUSE).maybeSingle();
  if (!data) { console.log("  (no settings row for the test restaurant — skipping warm-up)"); return; }
  const start = Date.now();
  await svc.from("settings").update({ updated_at: new Date().toISOString() }).eq("restaurant_id", FRENCH_HOUSE);
  while (Date.now() - start < 6000) { if (got.length) break; await sleep(50); }
  got.length = 0;
  console.log(`stream warm after ${Date.now() - start}ms\n`);
}
await warmUp();

const results = [];

// 1) a dish edit → menu/menu_item. A CHANGED value, then restored — the same shape step 3 uses,
//    and what a real menu edit actually is.
{
  const { data: dish, error } = await svc.from("menu_items")
    .select("id, title").eq("restaurant_id", FRENCH_HOUSE).order("id").limit(1).maybeSingle();
  if (error || !dish) {
    console.log("✗ dish edit: could not read a dish for the test restaurant —", error?.message || "no rows");
    results.push(false);
  } else {
    const original = dish.title;
    undo.push(() => svc.from("menu_items").update({ title: original }).eq("id", dish.id).eq("restaurant_id", FRENCH_HOUSE));
    results.push(await expectBreadcrumb("menu", "menu_item", "dish edit",
      () => svc.from("menu_items").update({ title: original + " ·" }).eq("id", dish.id).eq("restaurant_id", FRENCH_HOUSE)));
    await svc.from("menu_items").update({ title: original }).eq("id", dish.id).eq("restaurant_id", FRENCH_HOUSE);
    undo.pop();
  }
}

// 2) a settings edit → menu/settings
{
  results.push(await expectBreadcrumb("menu", "settings", "feature/settings toggle",
    () => svc.from("settings").update({ updated_at: new Date().toISOString() }).eq("restaurant_id", FRENCH_HOUSE)));
}

// 3) a category switch → menu/category. Scoped to ONE restaurant: `categories` is keyed
//    (restaurant_id, slug), and several tenants share a slug.
{
  const { data: cat, error } = await svc.from("categories")
    .select("slug, active").eq("restaurant_id", FRENCH_HOUSE).order("slug").limit(1).maybeSingle();
  if (error || !cat) {
    console.log("✗ category edit: could not read a category for the test restaurant —", error?.message || "no rows");
    results.push(false);
  } else {
    const was = cat.active;
    const put = () => svc.from("categories").update({ active: was }).eq("restaurant_id", FRENCH_HOUSE).eq("slug", cat.slug);
    undo.push(put);
    results.push(await expectBreadcrumb("menu", "category", "category edit",
      () => svc.from("categories").update({ active: !was }).eq("restaurant_id", FRENCH_HOUSE).eq("slug", cat.slug)));
    await put();
    undo.pop();
  }
}

// 4) an auto_approve toggle on a throwaway session → ops/session.
//    Supplies every NOT-NULL column that has no default (restaurant_id, table_number) and deletes BY ID.
{
  // A stray row from a previously-killed run — scoped to this restaurant and this test table only.
  await svc.from("sessions").delete().eq("restaurant_id", FRENCH_HOUSE).eq("table_number", TEST_TABLE);
  const { data: s, error } = await svc.from("sessions")
    .insert({ restaurant_id: FRENCH_HOUSE, table_number: TEST_TABLE, status: "open", auto_approve: true })
    .select("id").maybeSingle();
  if (error || !s) {
    console.log("✗ auto_approve toggle: could not create the throwaway session —", error?.message || "no row returned");
    results.push(false);
  } else {
    const drop = () => svc.from("sessions").delete().eq("id", s.id);
    undo.push(drop);
    results.push(await expectBreadcrumb("ops", "session", "auto_approve toggle",
      () => svc.from("sessions").update({ auto_approve: false }).eq("id", s.id)));
    await drop();
    undo.pop();
  }
}

// 5) a staff action → AUDIT/action (this drives the admin activity feed).
//    It was `ops` until migration 267 gave the oplog its own topic so it stops waking every staff
//    panel on the ops firehose. lib/useRealtime.ts knows the topic and components/admin/shared.tsx
//    subscribes to it. THIS STEP NEVER RAN BEFORE — step 4 threw first.
{
  let rowId = null;
  const drop = () => (rowId ? svc.from("staff_actions").delete().eq("id", rowId) : Promise.resolve());
  undo.push(drop);
  results.push(await expectBreadcrumb("audit", "action", "staff action (oplog)", async () => {
    const { data } = await svc.from("staff_actions")
      .insert({ panel: "admin", action: "rt_selftest", detail: "verify-realtime", restaurant_id: FRENCH_HOUSE })
      .select("id").maybeSingle();
    rowId = data?.id ?? null;
  }));
  await drop();
  undo.pop();
}

await restoreAll();
await anon.removeAllChannels();
const pass = results.every(Boolean);
console.log("\n" + (pass ? `ALL PASS — ${results.length} breadcrumbs delivered` : `SOME FAILED — ${results.filter(Boolean).length}/${results.length} delivered`));
process.exit(pass ? 0 : 1);
