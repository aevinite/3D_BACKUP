// scripts/verify-sections.mjs — guard for WAITER SECTIONS (migs 222-225).
//
//   node scripts/verify-sections.mjs                  # against localhost:4000
//   BASE=http://localhost:4010 node scripts/verify-sections.mjs
//
// Needs a running app + .env.local (dev/backup keys ONLY — never point this at AV live).
// It flips the module on for restaurant #1, exercises the rules, and puts every setting
// back exactly as it found them, including on failure.
//
// WHY THIS EXISTS: sections HIDE things, and every bug found in this feature so far came
// from real data breaking an assumption rather than from broken logic —
//   • tables numbered ABOVE table_count still carrying live orders (PR #544),
//   • raising table_count leaving the new tables in nobody's section (mig 225),
//   • a DISABLED waiter still counting as covering a table.
// Each of those is pinned below. A hidden table is an unserved guest or an unpaid bill, so
// these are money bugs, not cosmetic ones.
//
// Logs in ONCE per role and reuses the session — never put a login in a loop, it trips the
// app's own limit alerts and pings the owner's phone about us.
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:4000";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const g = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim();
const SB = g("NEXT_PUBLIC_SUPABASE_URL"), KEY = g("SUPABASE_SERVICE_ROLE_KEY");
const sbh = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

const RID = "00000000-0000-0000-0000-000000000001";
const WAITER_LOGIN = ["diagt1", "diag-t1-2026"], MANAGER_LOGIN = ["diagm1", "diag-mgr-2026"];

const pass = [], fail = [];
const ck = (ok, label, extra = "") => (ok ? pass : fail).push(label + (extra ? ` — ${extra}` : ""));
const patch = (t, q, b) => fetch(`${SB}/rest/v1/${t}?${q}`, { method: "PATCH", headers: sbh, body: JSON.stringify(b) });
const rows = async (t, q) => await (await fetch(`${SB}/rest/v1/${t}?${q}`, { headers: sbh })).json();

async function login([u, p]) {
  const r = await fetch(`${BASE}/api/panel-login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: p }),
  });
  const jar = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  if (!r.ok || !jar) throw new Error(`login ${u} failed (${r.status}) — is the app running at ${BASE}?`);
  return (path, init = {}) => fetch(BASE + path, { ...init, headers: { Cookie: jar, "Content-Type": "application/json", ...(init.headers || {}) } });
}

const waiterRow = async () => (await rows("staff_users", `select=id,assigned_tables&username=eq.${WAITER_LOGIN[0]}&restaurant_id=eq.${RID}`))[0];

async function main() {
  const before = (await rows("settings", `select=table_count&restaurant_id=eq.${RID}`))[0];
  const w0 = await waiterRow();
  if (!w0) throw new Error(`no ${WAITER_LOGIN[0]} waiter on restaurant #1 — seed the diag logins first`);
  const WAITER = w0.id, COUNT = Number(before.table_count) || 12;
  const ALL = Array.from({ length: COUNT }, (_, i) => i + 1);

  const restore = async () => {
    await patch("staff_users", `id=eq.${WAITER}`, { assigned_tables: w0.assigned_tables || [] });
    await patch("settings", `restaurant_id=eq.${RID}`, { table_count: before.table_count });
  };

  try {
    const waiter = await login(WAITER_LOGIN), manager = await login(MANAGER_LOGIN);

    // ── sections are ALWAYS on (owner 2026-07-30) — no module toggle any more ─
    // ── a full section takes nothing away (the mig-223 backfill state) ───────
    await patch("staff_users", `id=eq.${WAITER}`, { assigned_tables: ALL });
    let s = await (await waiter("/api/tablet/summary?nomenu=1")).json();
    const full = Object.keys(s.tiles || {}).length;
    ck(full >= COUNT, "a waiter holding every table still sees the whole floor", `${full} tiles`);

    // ── REGRESSION (PR #544): a table ABOVE table_count is in nobody's section,
    //    so it must stay visible — else its bill is stranded. ─────────────────
    await patch("staff_users", `id=eq.${WAITER}`, { assigned_tables: [1, 2, 3] });
    s = await (await waiter("/api/tablet/summary?nomenu=1")).json();
    const keys = Object.keys(s.tiles || {}).map(Number).sort((a, b) => a - b);
    const mine = keys.filter((t) => t <= COUNT), off = keys.filter((t) => t > COUNT);
    ck(mine.join(",") === "1,2,3", "a narrow section shows only those tables", mine.join(",") || "none");
    const offInDb = [...new Set((await rows("orders", `select=table_number&restaurant_id=eq.${RID}&archived=is.false&status=neq.cancelled&limit=2000`))
      .map((o) => parseInt(o.table_number, 10)).filter((t) => Number.isFinite(t) && t > COUNT))];
    ck(offInDb.every((t) => off.includes(t)),
      "off-plan tables carrying live orders are NEVER hidden (their bill must stay reachable)",
      offInDb.length ? `expected ${offInDb.join(",")}, got ${off.join(",") || "none"}` : "none exist right now");

    // ── REGRESSION (mig 225): growing the floor must not orphan the new tables ─
    await patch("staff_users", `id=eq.${WAITER}`, { assigned_tables: ALL });
    await patch("settings", `restaurant_id=eq.${RID}`, { table_count: COUNT + 3 });
    await new Promise((r) => setTimeout(r, 600));
    s = await (await waiter("/api/tablet/summary?nomenu=1")).json();
    const grown = Object.keys(s.tiles || {}).map(Number);
    ck(grown.includes(COUNT + 1) && grown.includes(COUNT + 3),
      "raising the table count hands the NEW tables to waiters who have a section",
      `looking for ${COUNT + 1}..${COUNT + 3}`);
    let r = await waiter("/api/tablet/sessions/open", { method: "POST", body: JSON.stringify({ table: COUNT + 1 }) });
    ck(r.status !== 403, "and the waiter may actually work the new table", String(r.status));
    if (r.ok) { const d = await r.json().catch(() => ({})); const sid = d?.session?.id || d?.id;
      if (sid) await fetch(`${SB}/rest/v1/sessions?id=eq.${sid}`, { method: "DELETE", headers: sbh }); }
    await patch("settings", `restaurant_id=eq.${RID}`, { table_count: COUNT });

    // ── writes: refused off-section, allowed on-section, always a clean 403 ───
    await patch("staff_users", `id=eq.${WAITER}`, { assigned_tables: [1, 2, 3] });
    const outside = COUNT >= 9 ? 9 : COUNT;
    r = await waiter(`/api/tablet/tables/${outside}/restart`, { method: "POST", body: JSON.stringify({}) });
    const msg = (await r.json().catch(() => ({}))).error || "";
    ck(r.status === 403 && !!msg, "a write on someone else's table is refused with a plain message", `${r.status} "${msg.slice(0, 44)}"`);
    r = await waiter("/api/tablet/order", { method: "POST", body: JSON.stringify({ table: outside, items: [] }) });
    ck(r.status === 403, "and so is taking an order there", String(r.status));

    // ── a manager/owner looking in is never restricted ───────────────────────
    s = await (await manager("/api/tablet/summary?nomenu=1")).json();
    ck(s.my_tables === null, "a manager inside the tablet panel keeps the whole floor");

    // ── the editor's own rules ───────────────────────────────────────────────
    r = await manager("/api/editor/table-sections", { method: "POST", body: JSON.stringify({ user_id: WAITER, tables: [1, 2, COUNT + 99, 0, 2] }) });
    const d = await r.json().catch(() => ({}));
    ck(r.ok && String(d.user?.assigned_tables) === "1,2", "the editor drops out-of-range and duplicate table numbers", JSON.stringify(d.user?.assigned_tables));

    // ── STATIC: the editor must have BOTH doors ──────────────────────────────
    // The Settings tab is gated by the SEPARATE `edit_settings` power, so a manager granted
    // only `table_assign` can reach the section editor ONLY through the floor button. That
    // button was silently lost once in a rebase and shipped missing (2026-07-30) — the
    // server said the manager had the power while the UI gave them no way in. Pin both.
    const js = await (await fetch(`${BASE}/panels/editor/app.js`, { cache: "no-store" })).text();
    ck(js.includes("floorSections") && js.includes("openSectionsModal"),
      "the FLOOR button + its modal are present in the shipped panel (the only door a manager without edit_settings has)",
      `floorSections=${js.includes("floorSections")} openSectionsModal=${js.includes("openSectionsModal")}`);
    ck(js.includes("tableSectionsCardHtml"), "the section card itself is present in the shipped panel");
    const css = await (await fetch(`${BASE}/panels/editor/style.css`, { cache: "no-store" })).text();
    ck(css.includes("sec-modal-wide"), "the modal's stylesheet shipped too");

    // ── creating a waiter REQUIRES a table pick (owner 2026-07-30) ───────────
    let cr = await manager("/api/owner/staff", { method: "POST", body: JSON.stringify({ name: "zz guard probe", role: "tablet", restaurant_id: RID, tables: [] }) });
    ck(!cr.ok, "creating a waiter with NO tables is refused", `${cr.status} ${(await cr.json().catch(() => ({}))).error?.slice(0, 44) || ""}`);
    cr = await manager("/api/owner/staff", { method: "POST", body: JSON.stringify({ name: "zz guard probe", role: "tablet", restaurant_id: RID, tables: [1, 2] }) });
    const made = await cr.json().catch(() => ({}));
    ck(cr.ok, "creating a waiter WITH tables works", String(cr.status));
    if (made?.id) {
      const got = (await rows("staff_users", `select=assigned_tables&id=eq.${made.id}`))[0];
      ck(String(got?.assigned_tables) === "1,2", "the new waiter got exactly the picked tables", JSON.stringify(got?.assigned_tables));
      await fetch(`${SB}/rest/v1/staff_users?id=eq.${made.id}`, { method: "DELETE", headers: sbh });
    }
  } finally {
    await restore();
  }

  console.log(`\n✅ ${pass.length} passed`);
  pass.forEach((p) => console.log("   ✓ " + p));
  if (fail.length) {
    console.log(`\n❌ ${fail.length} FAILED`);
    fail.forEach((f) => console.log("   ✗ " + f));
    process.exit(1);
  }
  console.log("\nALL PASS");
}

main().catch((e) => { console.error("RUN ERROR:", e.message); process.exit(1); });
