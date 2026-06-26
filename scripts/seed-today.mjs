// Seed realistic TODAY-dated demo orders so the "Today" range populates on every
// dashboard/report. Usage:
//   node scripts/seed-today.mjs <path-to-.env.local> [--skip-default]
// --skip-default omits restaurant #1 (the live French House) — use it for PROD.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envPath = process.argv[2] || ".env.local";
const skipDefault = process.argv.includes("--skip-default");
const env = readFileSync(envPath, "utf8");
const get = (k) => ((env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1] || "").trim();
const url = get("NEXT_PUBLIC_SUPABASE_URL") || get("SUPABASE_URL");
const ref = (url.match(/https:\/\/([a-z0-9]+)\.supabase/) || [])[1] || "";
const DEFAULT_RID = "00000000-0000-0000-0000-000000000001";
const sb = createClient(url, get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

(async () => {
  console.log("target ref:", ref.slice(0, 4) + "…" + ref.slice(-3), skipDefault ? "(skipping #1)" : "(all restaurants)");
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const randToday = () => new Date(start.getTime() + Math.random() * (now.getTime() - start.getTime())).toISOString();

  const R = (await sb.from("restaurants").select("id, slug, name")).data || [];
  let totalIns = 0;
  for (const r of R) {
    if (skipDefault && r.id === DEFAULT_RID) { console.log("  – skip", r.slug, "(live #1)"); continue; }
    // Idempotency: don't double-seed today.
    const existing = (await sb.from("orders").select("id").eq("restaurant_id", r.id).eq("discount_note", "today-seed").gte("created_at", start.toISOString()).limit(1)).data || [];
    if (existing.length) { console.log("  – skip", r.slug, "(already has today-seed)"); continue; }

    const menu = (await sb.from("menu_items").select("slug, title, price").eq("restaurant_id", r.id).limit(60)).data || [];
    if (!menu.length) { console.log("  ✗", r.slug, "no menu items"); continue; }
    const n = rnd(7, 12);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const items = [];
      const lines = rnd(1, 3);
      let subtotal = 0;
      for (let j = 0; j < lines; j++) {
        const m = pick(menu);
        const qty = rnd(1, 3);
        const price = Number(String(m.price).replace(/[^0-9.]/g, "")) || rnd(120, 600);
        items.push({ qty, slug: m.slug, price, title: m.title });
        subtotal += price * qty;
      }
      // Mostly served+paid; a couple live/unpaid; one cancelled.
      let status = "served", payment_status = "paid";
      if (i === 0) { status = "cancelled"; payment_status = "unpaid"; }
      else if (i <= 2) { status = pick(["new", "preparing"]); payment_status = "unpaid"; }
      rows.push({
        restaurant_id: r.id, table_number: rnd(1, 14), items,
        subtotal, tax: Math.round(subtotal * 0.05 * 100) / 100, total: subtotal,
        allergies: [], status, payment_status, archived: status === "served",
        discount: 0, discount_note: "today-seed", kot_no: rnd(1, 200), created_at: randToday(),
      });
    }
    const ins = await sb.from("orders").insert(rows);
    if (ins.error) console.log("  ✗", r.slug, ins.error.message);
    else { totalIns += rows.length; console.log("  ✓", r.slug.padEnd(15), rows.length, "orders today"); }
  }
  console.log("DONE · inserted", totalIns, "today orders");
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
