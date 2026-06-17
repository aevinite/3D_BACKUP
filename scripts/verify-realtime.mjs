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

async function waitFor(topic, kind, label) {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const hit = got.find((e) => e.topic === topic && e.kind === kind && e.at >= start - 50);
    if (hit) { console.log(`✓ ${label}: received ${topic}/${kind} in ${hit.at - start}ms`); return true; }
    await sleep(100);
  }
  console.log(`✗ ${label}: NO ${topic}/${kind} breadcrumb within 5s`);
  return false;
}

await Promise.all([listen("menu"), listen("ops")]);
console.log("subscribed to rt:menu + rt:ops\n");

const results = [];

// 1) menu_items edit → menu/menu_item (write a real column back to itself)
{ const { data } = await svc.from("menu_items").select("id,title").limit(1).single();
  const { error } = await svc.from("menu_items").update({ title: data.title }).eq("id", data.id);
  if (error) console.log("  (menu_items update failed: " + error.message + ")");
  results.push(await waitFor("menu", "menu_item", "dish edit")); }

// 2) settings edit → menu/settings
{ await svc.from("settings").update({ updated_at: new Date().toISOString() }).eq("id", "site");
  results.push(await waitFor("menu", "settings", "feature/settings toggle")); }

// 3) categories edit → menu/category
{ const { data } = await svc.from("categories").select("slug").limit(1).single();
  await svc.from("categories").update({ sort_order: data ? undefined : 0 }).eq("slug", data.slug);
  // touch a harmless column to force an UPDATE row event
  await svc.from("categories").update({ active: true }).eq("slug", data.slug);
  results.push(await waitFor("menu", "category", "category edit")); }

// 4) auto_approve toggle on a throwaway session → ops/session (THE FIX)
{ const tnum = "9931";
  await svc.from("sessions").delete().eq("table_number", tnum); // clean slate
  const { data: s, error } = await svc.from("sessions").insert({ table_number: tnum, status: "open", auto_approve: true }).select("id").single();
  if (error) { console.log("  (session insert failed: " + error.message + ")"); }
  await sleep(400);
  got.length = 0; // ignore the insert breadcrumb; we want the auto_approve UPDATE
  await svc.from("sessions").update({ auto_approve: false }).eq("id", s.id);
  results.push(await waitFor("ops", "session", "auto_approve toggle"));
  await svc.from("sessions").delete().eq("id", s.id); // cleanup
}

await anon.removeAllChannels();
const pass = results.every(Boolean);
console.log("\n" + (pass ? "ALL PASS" : "SOME FAILED"));
process.exit(pass ? 0 : 1);
