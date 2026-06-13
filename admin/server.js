// admin/server.js — the ADMIN PANEL: the owner's master control room.
//
// It is the ONE place that holds every key and every power. It runs LOCALLY
// (port 4004) and embeds the other four panels (guest menu, editor, kitchen,
// tablet) so the owner can flip between them from one top switcher — click a
// panel to open it, click it again to come back to the admin home. The admin
// home is a cockpit: live status of all panels, the maintenance switch (takes
// the guest menu offline), and the key numbers. Deep management (menu, orders,
// floor, dashboard, customers, features) lives in the embedded Editor.
//
// SaaS note: single restaurant, no login for now (owner's call). It is still
// password-lockable (ADMIN_PASSWORD) for the day it's hosted.

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

// --- secrets: real env vars first, ../.env.local fills the gaps (local dev) ---
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
const ADMIN_PASSWORD = env.ADMIN_PASSWORD; // optional lock (recommended if ever hosted)
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("\n  ✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (env vars or ../.env.local)\n");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Where the four panels live. The admin embeds these and pings them for health.
const PANELS = {
  menu:    { label: "Menu",    url: env.MENU_URL    || "http://localhost:4000/menu", ping: env.MENU_URL    || "http://localhost:4000/menu" },
  editor:  { label: "Editor",  url: env.EDITOR_URL  || "http://localhost:4001",      ping: env.EDITOR_URL  || "http://localhost:4001" },
  kitchen: { label: "Kitchen", url: env.KITCHEN_URL || "http://localhost:4002",      ping: env.KITCHEN_URL || "http://localhost:4002" },
  tablet:  { label: "Tablet",  url: env.TABLET_URL  || "http://localhost:4003",      ping: env.TABLET_URL  || "http://localhost:4003" },
};

const app = express();
app.use(express.json({ limit: "1mb" }));

// --- optional cookie login (same shape as the other panels; off when no password) ---
if (ADMIN_PASSWORD) {
  const COOKIE = "admin_auth";
  const TOKEN = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest("hex");
  const readCookie = (req, name) => {
    for (const part of (req.headers.cookie || "").split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === name) return v.join("=");
    }
    return null;
  };
  const loginPage = (bad) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin — sign in</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0b1220;font-family:system-ui;color:#dbe7ff}
.card{background:#111a2e;border:1px solid #1f2c49;border-radius:16px;padding:28px;width:min(92vw,360px)}
h1{font-size:18px;margin:0 0 14px}input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2a3a5f;background:#0b1220;color:#dbe7ff;font-size:15px}
button{margin-top:12px;width:100%;padding:12px;border-radius:10px;border:0;background:#3b82f6;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
.bad{color:#f87171;font-size:13px;margin-top:8px}</style>
<form class="card" method="POST" action="/login"><h1>🛠️ Admin control room</h1>
<input type="password" name="password" placeholder="Password" autofocus>
${bad ? '<div class="bad">Wrong password — try again.</div>' : ""}
<button>Enter</button></form>`;
  app.use(express.urlencoded({ extended: false }));
  app.get("/login", (req, res) => { if (readCookie(req, COOKIE) === TOKEN) return res.redirect("/"); res.type("html").send(loginPage(req.query.bad === "1")); });
  app.post("/login", (req, res) => {
    if ((req.body && req.body.password) === ADMIN_PASSWORD) {
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

// Expose the panel URLs to the browser so the switcher iframes the right places.
app.get("/api/panels", wrap(async (req, res) => {
  // Server-side health ping (the browser can't cheaply check cross-origin).
  const ping = async (url) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      return r.ok || r.status === 401 || r.status === 302; // up (even if locked/redirecting)
    } catch { return false; }
  };
  const out = {};
  await Promise.all(Object.entries(PANELS).map(async ([k, p]) => {
    out[k] = { label: p.label, url: p.url, up: await ping(p.ping) };
  }));
  res.json(out);
}));

// The cockpit numbers: maintenance state, open tables, active orders, today's
// revenue, table count, feature switches — one call, aggregated server-side.
app.get("/api/overview", wrap(async (req, res) => {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const [settingsQ, sessionsQ, ordersQ] = await Promise.all([
    supabase.from("settings").select("*").eq("id", "site").maybeSingle(),
    supabase.from("sessions").select("id,status").eq("status", "open"),
    supabase.from("orders").select("status,payment_status,total,discount,archived,created_at").gte("created_at", since.toISOString()),
  ]);
  const settings = must(settingsQ) || {};
  const openTables = (must(sessionsQ) || []).length;
  const orders = must(ordersQ) || [];
  const active = orders.filter((o) => !o.archived && (o.status === "received" || o.status === "preparing")).length;
  const revenue = orders
    .filter((o) => o.status !== "cancelled" && o.payment_status === "paid")
    .reduce((s, o) => s + (Number(o.total) || 0) - (Number(o.discount) || 0), 0);
  const unpaid = orders.filter((o) => o.status !== "cancelled" && o.payment_status !== "paid" && !o.archived).length;
  res.json({
    maintenance: settings.service_mode === true,
    sessionsEnabled: settings.sessions_enabled === true,
    tableCount: Number(settings.table_count) || 0,
    features: settings.features || {},
    openTables, activeOrders: active, unpaidOrders: unpaid,
    revenueToday: Math.round(revenue * 100) / 100,
    ordersToday: orders.length,
  });
}));

// Maintenance switch: flips settings.service_mode, which the guest menu watches
// (AppShell) and instantly swaps in the "we'll be right back" screen.
app.post("/api/maintenance", wrap(async (req, res) => {
  const on = !!(req.body && req.body.on === true);
  const row = must(await supabase.from("settings").update({ service_mode: on }).eq("id", "site").select());
  res.json({ maintenance: (row[0] || {}).service_mode === true });
}));

app.use(express.static(path.join(__dirname, "ui")));

const PORT = Number(env.ADMIN_PORT) || 4004;
app.listen(PORT, () => {
  console.log(`\n  🛠️  Admin control room → http://localhost:${PORT}`);
  console.log(ADMIN_PASSWORD ? "     🔒 password-locked" : "     🔓 OPEN (no ADMIN_PASSWORD) — fine locally, NEVER deploy it like this\n");
});
