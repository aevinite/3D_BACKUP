// tablet/server.js — the WAITER TABLET's web server (the "captain app").
//
// Same skeleton as the kitchen panel: tiny Express app + service-role Supabase.
// The tablet shows the live floor and lets a waiter TAKE AN ORDER FOR A TABLE
// (when guests call them over to order manually). Orders placed here go through
// lfh_staff_place_order — the SAME server-side pricing as guest orders, so a
// tablet order can never carry tampered or stale prices. Port 4003.

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const out = {};
  Object.assign(out, process.env);
  const file = path.join(__dirname, "..", ".env.local");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && out[m[1]] === undefined) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}
const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const TABLET_PASSWORD = env.TABLET_PASSWORD; // optional lock (recommended when hosted)
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("\n  ✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (env vars or ../.env.local)\n");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const app = express();
app.use(express.json({ limit: "2mb" }));

// --- the same cookie login as the other panels, active only with a password ---
if (TABLET_PASSWORD) {
  const COOKIE = "tablet_auth";
  const TOKEN = crypto.createHash("sha256").update(TABLET_PASSWORD).digest("hex");
  const readCookie = (req, name) => {
    for (const part of (req.headers.cookie || "").split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === name) return v.join("=");
    }
    return null;
  };
  const loginPage = (bad) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Waiter tablet — sign in</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0b1220;font-family:system-ui;color:#dbe7ff}
.card{background:#111a2e;border:1px solid #1f2c49;border-radius:16px;padding:28px;width:min(92vw,360px)}
h1{font-size:18px;margin:0 0 14px}input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2a3a5f;background:#0b1220;color:#dbe7ff;font-size:15px}
button{margin-top:12px;width:100%;padding:12px;border-radius:10px;border:0;background:#3b82f6;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
.bad{color:#f87171;font-size:13px;margin-top:8px}</style>
<form class="card" method="POST" action="/login"><h1>🧑‍🍳 Waiter tablet</h1>
<input type="password" name="password" placeholder="Password" autofocus>
${bad ? '<div class="bad">Wrong password — try again.</div>' : ""}
<button>Open the floor</button></form>`;
  app.use(express.urlencoded({ extended: false }));
  app.get("/login", (req, res) => {
    if (readCookie(req, COOKIE) === TOKEN) return res.redirect("/");
    res.type("html").send(loginPage(req.query.bad === "1"));
  });
  app.post("/login", (req, res) => {
    if ((req.body && req.body.password) === TABLET_PASSWORD) {
      res.set("Set-Cookie", `${COOKIE}=${TOKEN}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
      return res.redirect("/");
    }
    res.redirect("/login?bad=1");
  });
  app.use((req, res, next) => {
    if (readCookie(req, COOKIE) === TOKEN) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "unauthorized" });
    res.redirect("/login");
  });
}

const must = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(500).json({ error: e.message }));

// ── GET /api/state — one call with everything the tablet needs ──────────────
app.get("/api/state", wrap(async (req, res) => {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const [settings, sessions, members, orders, calls, dishes, categories] = await Promise.all([
    supabase.from("settings").select("*").eq("id", "site").maybeSingle(),
    supabase.from("sessions").select("*").neq("status", "closed"),
    supabase.from("session_members").select("*").eq("removed", false),
    supabase.from("orders").select("*").gte("created_at", since.toISOString()).eq("archived", false).order("created_at"),
    supabase.from("waiter_calls").select("*").eq("resolved", false),
    supabase.from("menu_items").select("id,title,price,category,tags,veg").order("category"),
    supabase.from("categories").select("slug,name,icon,sort_order,active").order("sort_order"),
  ]);
  res.json({
    settings: must(settings), sessions: must(sessions), members: must(members),
    orders: must(orders), calls: must(calls), dishes: must(dishes), categories: must(categories),
  });
}));

// ── the waiter places an order FOR a table ───────────────────────────────────
// Server-side priced via lfh_staff_place_order (service-role only RPC): the
// tablet sends dish ids + quantities, never prices.
app.post("/api/order", wrap(async (req, res) => {
  const { table, items, allergies, note } = req.body || {};
  const t = String(table || "").trim();
  if (!/^\d+$/.test(t)) return res.status(400).json({ error: "valid table required" });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items required" });
  const { data, error } = await supabase.rpc("lfh_staff_place_order", {
    p_table: t, p_items: items, p_allergies: Array.isArray(allergies) ? allergies : [], p_note: note || null,
  });
  if (error) throw new Error(error.message);
  res.json(data);
}));

// ── quick floor actions the waiter needs in the moment ──────────────────────
app.post("/api/calls/:id/attend", wrap(async (req, res) => {
  const row = must(await supabase.from("waiter_calls").update({ resolved: true }).eq("id", req.params.id).select());
  res.json(row[0] || null);
}));
app.post("/api/members/:id/approve", wrap(async (req, res) => {
  const row = must(await supabase.from("session_members").update({ approved: true }).eq("id", req.params.id).select());
  res.json(row[0] || null);
}));
app.post("/api/sessions/open", wrap(async (req, res) => {
  const t = String((req.body && req.body.table) || "").trim();
  if (!/^\d+$/.test(t)) return res.status(400).json({ error: "valid table required" });
  const existing = must(await supabase.from("sessions").select("id").eq("table_number", t).neq("status", "closed").limit(1));
  if (existing.length) return res.json(existing[0]);
  const row = must(await supabase.from("sessions").insert({ table_number: t, status: "open", opened_by: "waiter", opened_at: new Date().toISOString() }).select());
  res.json(row[0] || null);
}));

app.use(express.static(path.join(__dirname, "ui")));

const PORT = Number(env.TABLET_PORT) || 4003;
app.listen(PORT, () => console.log(`\n  🧑‍🍳 Waiter tablet → http://localhost:${PORT}\n`));
