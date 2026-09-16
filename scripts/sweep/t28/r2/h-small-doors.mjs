// BLOCK H · the four small public doors — 40 phases, P160871–P160910.
//   /api/health (44 lines, 10 rows) · /api/maintenance (128, 4) · /api/blocked (142, 5) ·
//   /api/log/client-error (241, 2)
// Between them: 555 lines carrying 21 ledger rows. Three of the four are PUBLIC and two of them
// WRITE, which is the whole reason they deserve forty.
import { FH, PP, GHOST, GET, POST, sb, owns, undo, block, of_, code, read } from "./harness.mjs";
export const H = block(160871, "H · health · maintenance · blocked · the crash sink");
const { row } = H;
const HE = of_("app/api/health/route.ts"), MA = of_("app/api/maintenance/route.ts"),
      BL = of_("app/api/blocked/route.ts"), CE = of_("app/api/log/client-error/route.ts");
const mark = (p) => `t28r2-${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
// ── THIS BLOCK WAS TRIPPING THE APP'S OWN FLOOD CAP, WHICH IS THE PRODUCT BEING RIGHT ───────────
// `/api/log/client-error` allows five error reports per device per ten minutes — deliberately, so a
// misbehaving client cannot fill the admin's Repair board with rows that look like a restaurant in
// trouble. Nine of these checks post one report each from the same cookie-less caller, so the sixth
// onwards answered `skipped: "rate_limited"` and wrote nothing, and four checks reported "no row was
// written" as though the route were broken. It was not: it was refusing me, correctly.
//
// So each report is read and then DELETED BY ITS OWN ID immediately, which is what this suite owes
// the database anyway — and it drops the count the cap is measured against, so the next check starts
// from zero instead of queueing behind its siblings. Nothing about the cap is loosened or bypassed:
// it is measured over rows that exist, and these rows genuinely stop existing.
const findRow = async (m, action = "client_error", { keep = false } = {}) => {
  for (let i = 0; i < 8; i++) {
    const q = await sb.from("staff_actions").select("id, panel, action, level, detail, restaurant_id, device_id")
      .eq("action", action).ilike("detail", `%${m}%`).limit(1);
    const r = (q.data || [])[0];
    if (r) {
      if (keep) owns("staff_actions", r.id);
      else await sb.from("staff_actions").delete().eq("id", r.id);
      return r;
    }
    await new Promise((x) => setTimeout(x, 350));
  }
  return null;
};
/** The cap counts rows that EXIST, so a check that cannot find its own row still clears the way. */
const clearMine = async () => {
  const q = await sb.from("staff_actions").select("id").eq("action", "client_error").ilike("detail", "%t28r2-%").limit(20);
  for (const x of (q.data || [])) await sb.from("staff_actions").delete().eq("id", x.id);
};

// ══ /api/health ════════════════════════════════════════════════════════════════════════════════
row(HE("it answers ok with no login of any kind — an outside watchdog has no cookie"), "GET with no cookie", async (c) => {
  const r = await GET(c.N, "/api/health");
  return !!(r.status === 200 && r.j.ok === true) || `${r.status} ${r.txt.slice(0, 80)}`;
});
row(HE("…and it must never be cached, or a watchdog would read a stale verdict for ever"), "read the Cache-Control header", async (c) => {
  const r = await GET(c.N, "/api/health");
  return /no-store/.test(r.headers["cache-control"] || "") || `cache-control=${JSON.stringify(r.headers["cache-control"])}`;
});
row(HE("it answers nothing but the verdict — no counts, no names, no tenant data"), "read the whole body", async (c) => {
  const r = await GET(c.N, "/api/health");
  return Object.keys(r.j || {}).every((k) => k === "ok" || k === "db") || `it answered ${JSON.stringify(r.j)}`;
});
row(HE("it really touches the database — it is a connection probe, not a ping"), "read: one bounded row read, no count", async () => {
  const src = code(read("app/api/health/route.ts"));
  return !!(/from\("restaurants"\)\.select\("id"\)\.limit\(1\)/.test(src) && !/count:\s*"exact"/.test(src) && !/head:\s*true/.test(src))
    || "it no longer reads exactly one row, or it has grown a count";
});
row(HE("the deeper health page stays deleted — he asked for it removed"), "no /api/health/deep route exists", async (c) => {
  const r = await GET(c.N, "/api/health/deep");
  return r.status === 404 || `it answered ${r.status} — R18 says this route stays gone`;
});
row(HE("…and this one has not grown storage or config checks instead, which is the same idea in a different place"), "read: nothing but the restaurants probe", async () => {
  const src = code(read("app/api/health/route.ts"));
  const reads = (src.match(/sb\s*\.\s*(from|rpc|storage)\(/g) || []).length;
  return reads === 1 || `it now makes ${reads} reads; R18 says keep it to the one`;
});
// ══ /api/maintenance ═══════════════════════════════════════════════════════════════════════════
row(MA("reading whether the guest menu is down needs a login"), "GET with no cookie", async (c) => {
  const r = await GET(c.N, "/api/maintenance");
  return r.status === 401 || `${r.status}`;
});
row(MA("…and the admin can read it for any restaurant it names"), "GET ?rid=<FH> as the admin", async (c) => {
  const r = await GET(c.A, `/api/maintenance?rid=${FH}`);
  return !!(r.status === 200 && typeof r.j.maintenance === "boolean") || `${r.status} ${JSON.stringify(r.j)}`;
});
row(MA("…and a manager can read their own"), "GET as diagm1", async (c) => {
  const r = await GET(c.G, "/api/maintenance");
  return !!(r.status === 200 && typeof r.j.maintenance === "boolean") || `${r.status} ${JSON.stringify(r.j).slice(0, 90)}`;
});
row(MA("a malformed restaurant id gets a sentence a person can read, never the database's words"), "GET ?rid=not-a-uuid as the admin", async (c) => {
  const r = await GET(c.A, "/api/maintenance?rid=not-a-uuid");
  return !/invalid input syntax|uuid|PGRST|22P02/i.test(JSON.stringify(r.j)) || JSON.stringify(r.j).slice(0, 120);
});
row(MA("taking the menu down is refused unless the admin has switched that power on for this restaurant"), "POST as diagm1", async (c) => {
  const cur = (await sb.from("settings").select("service_mode").eq("restaurant_id", FH).maybeSingle()).data;
  const r = await POST(c.G, "/api/maintenance", { on: cur?.service_mode === true });
  const after = (await sb.from("settings").select("service_mode").eq("restaurant_id", FH).maybeSingle()).data;
  if (after?.service_mode !== cur?.service_mode) return `the guest menu's state CHANGED during a no-op probe`;
  return !!(r.status === 200 || (r.status === 403 && /isn't switched on for you/i.test(r.j?.error || "")))
    || `${r.status} ${r.j?.error}`;
});
row(MA("the ADMIN'S own flip is recorded against the ADMIN's log, out of the owner's feed"), "POST as the admin act-as, read the row", async (c) => {
  const cur = (await sb.from("settings").select("service_mode").eq("restaurant_id", FH).maybeSingle()).data;
  const before = new Date().toISOString();
  const r = await POST(c.A, `/api/maintenance?rid=${FH}`, { on: cur?.service_mode === true });
  const after = (await sb.from("settings").select("service_mode").eq("restaurant_id", FH).maybeSingle()).data;
  if (after?.service_mode !== cur?.service_mode) return `the guest menu's state CHANGED during a no-op probe`;
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  let a = null;
  for (let i = 0; i < 8 && !a; i++) {
    const q = await sb.from("staff_actions").select("id, panel, actor").in("action", ["maintenance_on", "maintenance_off"]).gte("created_at", before).limit(1);
    a = (q.data || [])[0] || null; if (!a) await new Promise((x) => setTimeout(x, 350));
  }
  if (a) owns("staff_actions", a.id);
  if (!a) return "the admin flipped it and nothing was recorded";
  return a.panel === "admin" || `panel=${a.panel} actor=${a.actor} — it would show in the owner's own feed`;
});
row(MA("…and that row never reaches the owner's Activity list"), "GET /api/owner/oplog and look for it", async (c) => {
  const r = await GET(c.O, "/api/owner/oplog?limit=200");
  const leak = (r.j.actions || []).filter((x) => /maintenance_(on|off)/.test(x.action) && /admin/i.test(String(x.actor || "")));
  return leak.length === 0 || `${leak.length} admin maintenance row(s) in the owner's feed`;
});
row(MA("a write that matches no row is NOT reported as a write"), "read: a zero-row update answers 409 and logs nothing", async () => {
  const src = code(read("app/api/maintenance/route.ts"));
  const post = src.slice(src.indexOf("export async function POST"));
  const iGuard = post.indexOf("if (!r.data?.length)");
  const iLog = post.indexOf("logAction(");
  return !!(iGuard > -1 && iLog > iGuard && /status:\s*409/.test(post.slice(iGuard, iLog)))
    || `the zero-row guard is at ${iGuard} and the log at ${iLog}`;
});
// ══ /api/blocked ═══════════════════════════════════════════════════════════════════════════════
row(BL("a device that is not blocked is told so, with no login"), "GET with no cookie", async (c) => {
  const r = await GET(c.N, "/api/blocked");
  return !!(r.status === 200 && r.j.blocked === false) || `${r.status} ${JSON.stringify(r.j)}`;
});
row(BL("…and `pending` is a plain boolean, with no unknown flag on a healthy answer"), "read pending and pendingUnknown", async (c) => {
  const r = await GET(c.N, "/api/blocked");
  return !!(typeof r.j.pending === "boolean" && !("pendingUnknown" in r.j)) || JSON.stringify(r.j);
});
row(BL("asking to be unblocked when you are not blocked writes nothing"), "POST and count unblock_requests", async (c) => {
  const before = new Date().toISOString();
  const r = await POST(c.N, "/api/blocked", { message: "t28r2 probe" });
  const q = await sb.from("unblock_requests").select("id").gte("created_at", before).limit(5);
  for (const x of (q.data || [])) owns("unblock_requests", x.id);
  return !!(r.j?.reason === "not_blocked" && (q.data || []).length === 0)
    || `${r.status} reason=${r.j?.reason} rows=${(q.data || []).length}`;
});
row(BL("the device is identified from proxy headers on our side, never from the body"), "POST a body that tries to name another ip", async (c) => {
  const before = new Date().toISOString();
  await POST(c.N, "/api/blocked", { ip: "1.2.3.4", key: "admin:1.2.3.4", message: "t28r2" });
  const q = await sb.from("unblock_requests").select("id, ip").gte("created_at", before).limit(5);
  for (const x of (q.data || [])) owns("unblock_requests", x.id);
  const spoofed = (q.data || []).filter((x) => x.ip === "1.2.3.4");
  return spoofed.length === 0 || `${spoofed.length} row(s) filed under an address from the body`;
});
row(BL("the counter tells \"we could not count\" apart from \"none used\""), "read: usedToday answers number | null", async () => {
  const src = code(read("app/api/blocked/route.ts"));
  const fn = src.slice(src.indexOf("async function usedToday"), src.indexOf("export async function GET"));
  return !!(/Promise<number \| null>/.test(src) && /if \(error\) return null;/.test(fn)) || "a failed count is back to reading as zero";
});
row(BL("…and the page renders on doubt while the WRITE refuses on doubt"), "read both callers", async () => {
  const src = code(read("app/api/blocked/route.ts"));
  const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
  const post = src.slice(src.indexOf("export async function POST"));
  return !!(/await usedToday\(ip\)\s*:\s*0\)\s*\?\?\s*0/.test(get) && /if \(used === null\)[\s\S]{0,200}status:\s*503/.test(post))
    || "the page/write asymmetry has gone";
});
row(BL("…and \"we could not look\" is answered as pendingUnknown, never as \"you haven't asked\""), "read the pending branch", async () => {
  const src = code(read("app/api/blocked/route.ts"));
  return !!(/let pending: boolean \| null = false;/.test(src) && /pendingUnknown: true/.test(src))
    || "a failed pending read is back to answering false";
});
row(BL("the public read has a ceiling of its own, and degrades to the same page rather than an error"), "read the memory cap", async () => {
  const src = code(read("app/api/blocked/route.ts"));
  return !!(/withinMemoryCap\(`blocked:get:/.test(src) && /throttled: true/.test(src) && /remaining: MAX_PER_DAY/.test(src))
    || "the throttled answer no longer keeps the page usable";
});
row(BL("it never pings the phone or the bell — these requests are scroll-only, by his call"), "read: no alert is sent", async () => {
  const src = code(read("app/api/blocked/route.ts"));
  return !/sendOwnerAlert|notifyOwner|alertText/.test(src) || "an unblock request now rings somebody";
});

// ══ /api/log/client-error ══════════════════════════════════════════════════════════════════════
row(CE("a crash report is accepted with no login, because a crashing page has no session to offer"), "POST with no cookie", async (c) => {
  await clearMine();
  const m = mark("accept");
  const r = await POST(c.N, "/api/log/client-error", { panel: "guest", kind: "error", message: m, where: "/r/french-house/menu" });
  const row0 = await findRow(m);
  return !!(r.status === 200 && row0) || `${r.status} row=${!!row0}`;
});
row(CE("…and it is stored at error level, so it shows red on the Repair board"), "read the row's level", async (c) => {
  const m = mark("level");
  await POST(c.N, "/api/log/client-error", { panel: "guest", kind: "error", message: m, where: "/r/french-house/menu" });
  const row0 = await findRow(m);
  if (!row0) return "no row was written";
  return row0.level === "error" || `level=${row0.level}`;
});
row(CE("a panel nobody has heard of is not written at all"), "POST panel:nonsense", async (c) => {
  const m = mark("badpanel");
  const r = await POST(c.N, "/api/log/client-error", { panel: "nonsense", kind: "error", message: m });
  const q = await sb.from("staff_actions").select("id").ilike("detail", `%${m}%`).limit(1);
  for (const x of (q.data || [])) owns("staff_actions", x.id);
  return !!(r.j?.skipped === "bad_panel" && !(q.data || []).length) || `${r.status} ${JSON.stringify(r.j)} rows=${(q.data || []).length}`;
});
row(CE("a body too large to be a real report is dropped before it is parsed"), "POST 3 KB", async (c) => {
  const m = mark("big");
  const r = await POST(c.N, "/api/log/client-error", undefined, {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({ panel: "guest", kind: "error", message: m, pad: "x".repeat(2600) }) });
  const q = await sb.from("staff_actions").select("id").ilike("detail", `%${m}%`).limit(1);
  for (const x of (q.data || [])) owns("staff_actions", x.id);
  return !!(r.j?.skipped === "too_large" && !(q.data || []).length) || `${JSON.stringify(r.j)} rows=${(q.data || []).length}`;
});
row(CE("broken JSON is answered calmly — never an error from the error-logger itself"), "POST raw bytes", async (c) => {
  const r = await POST(c.N, "/api/log/client-error", undefined, { headers: { "content-type": "application/json" }, data: Buffer.from("{not json", "utf8") });
  return !!(r.status === 200 && r.j?.skipped === "bad_json") || `${r.status} ${JSON.stringify(r.j)}`;
});
row(CE("a crash on a guest menu is filed against the restaurant whose address it happened at"), "POST where=/r/french-house/menu with no rid", async (c) => {
  const m = mark("addr");
  await POST(c.N, "/api/log/client-error", { panel: "guest", kind: "error", message: m, where: "/r/french-house/menu" });
  const row0 = await findRow(m);
  if (!row0) return "no row was written";
  return row0.restaurant_id === FH || `filed under ${row0.restaurant_id}`;
});
row(CE("…and a claim the address CONTRADICTS loses to the address"), "POST where=french-house with rid=<Pizza Palace>", async (c) => {
  const m = mark("contra");
  await POST(c.N, "/api/log/client-error", { panel: "guest", kind: "error", message: m, where: "/r/french-house/menu", rid: PP });
  const row0 = await findRow(m);
  if (!row0) return "no row was written";
  return row0.restaurant_id === FH || `a claim of Pizza Palace was kept over a French House address (${row0.restaurant_id})`;
});
row(CE("…and a PANEL report keeps its own tag, because its address names no restaurant"), "POST where=/manager with rid", async (c) => {
  const m = mark("panel");
  await POST(c.N, "/api/log/client-error", { panel: "manager", kind: "error", message: m, where: "/manager", rid: PP });
  const row0 = await findRow(m);
  if (!row0) return "no row was written";
  return row0.restaurant_id === PP || `filed under ${row0.restaurant_id} instead of the panel's own claim`;
});
row(CE("…and a rid that is not a uuid is simply ignored, not stored"), "POST rid=not-a-uuid", async (c) => {
  const m = mark("badrid");
  await POST(c.N, "/api/log/client-error", { panel: "manager", kind: "error", message: m, where: "/manager", rid: "not-a-uuid" });
  const row0 = await findRow(m);
  if (!row0) return "no row was written";
  return row0.restaurant_id === null || `it stored ${JSON.stringify(row0.restaurant_id)}`;
});
row(CE("the row says which BROWSER it came from, in four words"), "POST with a Safari-on-iPhone agent", async (c) => {
  const m = mark("browser");
  await POST(c.N, "/api/log/client-error", { panel: "guest", kind: "error", message: m, where: "/r/french-house/menu" },
    { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "content-type": "application/json" } });
  const row0 = await findRow(m);
  if (!row0) return "no row was written";
  return /\[Safari · iPhone\]/.test(row0.detail || "") || `detail ends: ${String(row0.detail).slice(-70)}`;
});
row(CE("…and the whole 150-character user agent is NOT stored"), "the same row", async (c) => {
  const m = mark("ualen");
  await POST(c.N, "/api/log/client-error", { panel: "guest", kind: "error", message: m, where: "/r/french-house/menu" },
    { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0", "content-type": "application/json" } });
  const row0 = await findRow(m);
  if (!row0) return "no row was written";
  return !!(String(row0.detail).length <= 500 && !/AppleWebKit/.test(String(row0.detail))) || `detail is ${String(row0.detail).length} chars`;
});
row(CE("a tap breadcrumb is stored at INFO level, so it never shows red"), "POST kind:taps", async (c) => {
  const m = mark("taps");
  const r = await POST(c.N, "/api/log/client-error", { panel: "manager", kind: "taps", detail: m, rid: FH });
  const row0 = await findRow(m, "ui_taps");
  if (!row0) return `no row written (${r.status} ${JSON.stringify(r.j)})`;
  return row0.level === "info" || `level=${row0.level}`;
});
row(CE("…and an EMPTY tap batch is not written at all"), "POST kind:taps with no detail", async (c) => {
  const r = await POST(c.N, "/api/log/client-error", { panel: "manager", kind: "taps", detail: "" });
  return r.j?.skipped === "empty" || `${r.status} ${JSON.stringify(r.j)}`;
});
row(CE("…and a tap breadcrumb never reaches the owner's Activity list"), "GET /api/owner/oplog", async (c) => {
  const r = await GET(c.O, "/api/owner/oplog?limit=200");
  const bad = (r.j.actions || []).filter((a) => a.action === "ui_taps");
  return bad.length === 0 || `${bad.length} tap row(s) in the owner's feed`;
});
row(CE("both halves have a ceiling, and a cookie-less caller is counted too"), "read: the caps and the key", async () => {
  const src = code(read("app/api/log/client-error/route.ts"));
  return !!(/MAX_ERRORS_PER_DEVICE_10MIN/.test(src) && /MAX_TAPS_PER_DEVICE_10MIN/.test(src)
    && (src.match(/recentActionCount\(capKey/g) || []).length >= 2 && /capKeyFor\(req\)/.test(src))
    || "one half of this public endpoint has lost its ceiling";
});
row(CE("every failure answers ok, so a misbehaving client can never error-storm the database"), "POST four broken shapes", async (c) => {
  for (const [label, opts] of [["no body", { data: Buffer.from("", "utf8") }],
    ["a bare string", { data: Buffer.from('"hello"', "utf8") }],
    ["an array", { data: Buffer.from("[1,2,3]", "utf8") }],
    ["a number", { data: Buffer.from("42", "utf8") }]]) {
    const r = await POST(c.N, "/api/log/client-error", undefined, { headers: { "content-type": "application/json" }, ...opts });
    if (r.status !== 200) return `${label} answered ${r.status}`;
  }
  return true;
});
row(CE("is this how a real restaurant needs it? a crash on the guest menu reaches the board with the restaurant, the screen and the browser on it"), "POST one real-shaped report and read all three", async (c) => {
  const m = mark("full");
  await POST(c.N, "/api/log/client-error", { panel: "guest", kind: "error", message: `TypeError: ${m}`, where: "/r/french-house/menu" },
    { headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14; SM-A356E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36", "content-type": "application/json" } });
  const row0 = await findRow(m);
  if (!row0) return "no row was written";
  return !!(row0.restaurant_id === FH && /french-house/.test(row0.detail) && /\[Chrome · Android\]/.test(row0.detail))
    || `rid=${row0.restaurant_id} detail=${String(row0.detail).slice(0, 120)}`;
});
