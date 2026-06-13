// kitchen/server.js — the KITCHEN PANEL's tiny web server (the "KDS").
//
// Same shape as editor/server.js but radically smaller: the kitchen only needs
// to SEE incoming orders and advance their cooking status, plus mark dishes
// sold-out ("86 board"). Runs on port 4002 (KITCHEN_PORT to change), reads
// secrets from real env vars or ../.env.local, and locks itself with a login
// page when KITCHEN_PASSWORD is set (so it can be hosted publicly later).

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
const KITCHEN_PASSWORD = env.KITCHEN_PASSWORD; // optional lock (recommended when hosted)
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("\n  ✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (env vars or ../.env.local)\n");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const app = express();
app.use(express.json({ limit: "2mb" }));

// --- the same cookie login as the editor, only active when a password is set ---
if (KITCHEN_PASSWORD) {
  const COOKIE = "kitchen_auth";
  const TOKEN = crypto.createHash("sha256").update(KITCHEN_PASSWORD).digest("hex");
  const readCookie = (req, name) => {
    for (const part of (req.headers.cookie || "").split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === name) return v.join("=");
    }
    return null;
  };
  const loginPage = (bad) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kitchen — sign in</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0b1220;font-family:system-ui;color:#dbe7ff}
.card{background:#111a2e;border:1px solid #1f2c49;border-radius:16px;padding:28px;width:min(92vw,360px)}
h1{font-size:18px;margin:0 0 14px}input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2a3a5f;background:#0b1220;color:#dbe7ff;font-size:15px}
button{margin-top:12px;width:100%;padding:12px;border-radius:10px;border:0;background:#3b82f6;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
.bad{color:#f87171;font-size:13px;margin-top:8px}</style>
<form class="card" method="POST" action="/login"><h1>🍳 Kitchen panel</h1>
<input type="password" name="password" placeholder="Password" autofocus>
${bad ? '<div class="bad">Wrong password — try again.</div>' : ""}
<button>Enter the kitchen</button></form>`;
  app.use(express.urlencoded({ extended: false }));
  app.get("/login", (req, res) => {
    if (readCookie(req, COOKIE) === TOKEN) return res.redirect("/");
    res.type("html").send(loginPage(req.query.bad === "1"));
  });
  app.post("/login", (req, res) => {
    if ((req.body && req.body.password) === KITCHEN_PASSWORD) {
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

// Small helper: throw if a Supabase call failed, else hand back its rows.
const must = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(500).json({ error: e.message }));

// ── GET /api/board — everything the kitchen screen needs, in one call ───────
// Today's live orders (not archived), their per-dish rows, and the dish list
// (for the 86/sold-out board).
app.get("/api/board", wrap(async (req, res) => {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const [orders, items, dishes] = await Promise.all([
    supabase.from("orders").select("*").gte("created_at", since.toISOString()).eq("archived", false).order("created_at", { ascending: true }),
    // Bound order_items to TODAY too — without this it fetched every item row
    // ever, so the board got slower every day it ran.
    supabase.from("order_items").select("*").gte("created_at", since.toISOString()).order("created_at", { ascending: true }),
    supabase.from("menu_items").select("id,title,category,tags").order("category"),
  ]);
  res.json({ orders: must(orders), items: must(items), dishes: must(dishes) });
}));

// ── accept a whole order: everything not yet served jumps to "preparing" ────
// (identical behaviour to the editor's accept, so the two panels never drift)
app.post("/api/orders/:id/accept", wrap(async (req, res) => {
  const cur = must(await supabase.from("orders").select("items").eq("id", req.params.id).single());
  const items = Array.isArray(cur.items) ? cur.items.map((i) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
  must(await supabase.from("orders").update({ items, status: "preparing" }).eq("id", req.params.id).select());
  await supabase.from("order_items").update({ status: "preparing" }).eq("order_id", req.params.id).eq("status", "received");
  res.json(must(await supabase.from("orders").select("*").eq("id", req.params.id).single()));
}));

// ── the whole order is READY: every dish to "served", order complete ─────────
app.post("/api/orders/:id/ready", wrap(async (req, res) => {
  const cur = must(await supabase.from("orders").select("items").eq("id", req.params.id).single());
  const items = Array.isArray(cur.items) ? cur.items.map((i) => ({ ...i, status: "served" })) : [];
  must(await supabase.from("orders").update({ items, status: "served" }).eq("id", req.params.id).select());
  await supabase.from("order_items").update({ status: "served", served_at: new Date().toISOString() }).eq("order_id", req.params.id);
  res.json(must(await supabase.from("orders").select("*").eq("id", req.params.id).single()));
}));

// ── one DISH is ready (or back to cooking): same rollup as the editor ────────
app.post("/api/items/:id/status", wrap(async (req, res) => {
  const status = req.body && req.body.status;
  if (!["received", "preparing", "served"].includes(status)) return res.status(400).json({ error: "invalid status" });
  const patch = { status };
  if (status === "served") patch.served_at = new Date().toISOString();
  const updated = must(await supabase.from("order_items").update(patch).eq("id", req.params.id).select());
  const item = updated[0];
  // Roll the change up to the parent order so every screen (incl. the guest's
  // tracker) shows the right overall status.
  if (item && item.order_id) {
    const rows = must(await supabase.from("order_items").select("status").eq("order_id", item.order_id));
    const served = rows.filter((r) => r.status === "served").length;
    const anyActive = rows.some((r) => r.status === "preparing" || r.status === "served");
    const overall = served === rows.length && rows.length > 0 ? "served" : anyActive ? "preparing" : "received";
    await supabase.from("orders").update({ status: overall }).eq("id", item.order_id);
  }
  res.json(item || null);
}));

// ── the 86 board: kitchen marks a dish sold-out / available again ────────────
// Sold-out is the 'sold-out' TAG on the dish (the same thing the editor and the
// server-side pricing check use), so every app reacts instantly.
app.post("/api/dishes/:id/sold-out", wrap(async (req, res) => {
  const value = !!(req.body && req.body.value === true);
  const cur = must(await supabase.from("menu_items").select("tags").eq("id", req.params.id).single());
  const tags = Array.isArray(cur.tags) ? cur.tags.filter((t) => t !== "sold-out") : [];
  if (value) tags.push("sold-out");
  const row = must(await supabase.from("menu_items").update({ tags }).eq("id", req.params.id).select());
  res.json(row[0] || null);
}));

// Serve the kitchen screen itself (the ui/ folder).
app.use(express.static(path.join(__dirname, "ui")));

const PORT = Number(env.KITCHEN_PORT) || 4002;
app.listen(PORT, () => {
  console.log(`\n  🍳 Kitchen panel → http://localhost:${PORT}`);
  // Loud reminder: this server holds the service-role key, so it MUST be locked
  // before it's reachable from anywhere but this machine.
  console.log(KITCHEN_PASSWORD ? "     🔒 password-locked" : "     🔓 OPEN (no KITCHEN_PASSWORD) — fine locally, NEVER deploy it like this\n");
});
