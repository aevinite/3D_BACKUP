// Throwaway E2E: prove the realtime websocket delivers the NEW breadcrumbs.
// Subscribes (anon, like the browser) to rt:menu + rt:ops, then makes real writes
// (service role) and asserts each breadcrumb arrives. Prints only non-secret data.
//   node scripts/verify-realtime.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function parseEnv(t) { const o = {}; for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, ""); } return o; }
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const anon = createClient(URL, ANON, { realtime: { params: { eventsPerSecond: 10 } } });
const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });

const got = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listen(topic) {
  return new Promise((resolve) => {
    anon.channel("rt:" + topic)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "realtime_events", filter: "topic=eq." + topic },
        (p) => got.push({ topic, kind: p.new.kind, at: Date.now() }))
      .subscribe((s) => { if (s === "SUBSCRIBED") resolve(); });
  });
}

// Run a write, then wait for its breadcrumb. Clears the buffer FIRST and uses a
// strict post-write window so we never match a leftover event from a prior step.
async function expectBreadcrumb(topic, kind, label, write) {
  got.length = 0;            // drop anything from earlier steps
  const start = Date.now();
  await write();
  while (Date.now() - start < 5000) {
    const hit = got.find((e) => e.topic === topic && e.kind === kind && e.at >= start);
    if (hit) { console.log(`✓ ${label}: received ${topic}/${kind} in ${hit.at - start}ms`); return true; }
    await sleep(50);
  }
  console.log(`✗ ${label}: NO ${topic}/${kind} breadcrumb within 5s`);
  return false;
}

await Promise.all([listen("menu"), listen("ops")]);
console.log("subscribed to rt:menu + rt:ops\n");

const results = [];

// 1) menu_items edit → menu/menu_item (write a real column back to itself)
{ const { data } = await svc.from("menu_items").select("id,title").limit(1).single();
  results.push(await expectBreadcrumb("menu", "menu_item", "dish edit",
    () => svc.from("menu_items").update({ title: data.title }).eq("id", data.id))); }

// 2) settings edit → menu/settings
{ results.push(await expectBreadcrumb("menu", "settings", "feature/settings toggle",
    () => svc.from("settings").update({ updated_at: new Date().toISOString() }).eq("id", "site"))); }

// 3) categories edit → menu/category (flip active to a DISTINCT value, then restore)
{ const { data } = await svc.from("categories").select("slug,active").limit(1).single();
  results.push(await expectBreadcrumb("menu", "category", "category edit",
    () => svc.from("categories").update({ active: !data.active }).eq("slug", data.slug)));
  await svc.from("categories").update({ active: data.active }).eq("slug", data.slug); // restore
}

// 4) auto_approve toggle on a throwaway session → ops/session (THE FIX)
{ const tnum = "9931";
  await svc.from("sessions").delete().eq("table_number", tnum); // clean slate
  const { data: s, error } = await svc.from("sessions").insert({ table_number: tnum, status: "open", auto_approve: true }).select("id").single();
  if (error) { console.log("  (session insert failed: " + error.message + ")"); }
  results.push(await expectBreadcrumb("ops", "session", "auto_approve toggle",
    () => svc.from("sessions").update({ auto_approve: false }).eq("id", s.id)));
  await svc.from("sessions").delete().eq("id", s.id); // cleanup
}

// 5) staff_actions insert → ops/action (drives the admin activity feed)
{ results.push(await expectBreadcrumb("ops", "action", "staff action (oplog)",
    () => svc.from("staff_actions").insert({ panel: "admin", action: "rt_selftest", detail: "verify-realtime" })));
  await svc.from("staff_actions").delete().eq("action", "rt_selftest"); // cleanup
}

await anon.removeAllChannels();
const pass = results.every(Boolean);
console.log("\n" + (pass ? "ALL PASS" : "SOME FAILED"));
process.exit(pass ? 0 : 1);
