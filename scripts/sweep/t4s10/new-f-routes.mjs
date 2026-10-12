// Block F — the four routes this territory owns, CALLED in memory with the real Next request/response
// objects and a stand-in database (P173329…): /api/blocked (the blocked visitor's one action),
// /api/issue-media (staff photo / voice-note upload), /api/r/<slug>/menu-data (the guest menu bundle)
// and /api/rt-config (the panels' live-socket config).
import { check, band, load, FILES, W, resetWorld, OPTIONAL, nextServer, rd } from "./lib.mjs";
const HOW = "STUB — the real route called in memory (real NextRequest), stand-in database";
band(173329);
const { NextRequest } = nextServer();
const RID = "bbbbbbbb-0000-4000-8000-000000000002";
const R2 = "cccccccc-0000-4000-8000-000000000003";
const L = async (rel, o = {}) => { resetWorld(); return load(rel, o); };
const reqOf = (url, { method = "GET", headers = {}, body, cookies = {} } = {}) => {
  const h = new Headers(headers);
  const ck = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "); if (ck) h.set("cookie", ck);
  return new NextRequest("http://localhost:4404" + url, { method, headers: h, body });
};
const json = async (res) => { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } };
const BL = FILES.blocked, IM = FILES.media, MD = FILES.menuData, RT = FILES.rt;
// ── /api/blocked ──
const blockedWorld = ({ blocked = true, used = 0, usedErr = false, pending = [], pendingErr = false, insertErr = false } = {}) => {
  W.from.login_throttle = { data: blocked ? [{ locked_until: new Date(Date.now() + 5 * 365 * 864e5).toISOString() }] : [], error: null };
  W.from.unblock_requests = (st) => {
    if (st.op === "insert") return insertErr ? { data: null, error: { message: "insert failed" } } : { data: { id: "u1" }, error: null };
    if (st.count) return usedErr ? { data: null, error: { message: "count failed" }, count: null } : { data: null, error: null, count: used };
    return pendingErr ? { data: null, error: { message: "read failed" } } : { data: pending, error: null };
  };
};
let ipN = 10;
const ip = () => `203.0.113.${ipN++}`;
check(BL, "GET, a device that is not blocked → told so plainly, with no login, and the request rows are never read", HOW, async () => {
  const r = await L(BL); blockedWorld({ blocked: false }); const res = await r.GET(reqOf("/api/blocked", { headers: { "x-forwarded-for": ip() } })); const j = await json(res);
  return { ok: res.status === 200 && j.blocked === false && j.remaining === 3 && j.pending === false && !W.fromLog.some((x) => x.table === "unblock_requests"), note: JSON.stringify(j) };
});
check(BL, "GET, a blocked device → blocked, how many of today's 3 it has used, and whether one is waiting", HOW, async () => {
  const r = await L(BL); blockedWorld({ used: 1, pending: [{ id: "p" }] }); const j = await json(await r.GET(reqOf("/api/blocked", { headers: { "x-forwarded-for": ip() } })));
  return { ok: j.blocked === true && j.usedToday === 1 && j.remaining === 2 && j.pending === true && !("pendingUnknown" in j), note: JSON.stringify(j) };
});
check(BL, "…the throttle it checks is the ADMIN key for THIS device's address (admin:<ip>)", HOW, async () => {
  const r = await L(BL); blockedWorld(); const a = ip(); await r.GET(reqOf("/api/blocked", { headers: { "x-forwarded-for": `${a}, 10.0.0.1` } }));
  const st = W.fromLog.find((x) => x.table === "login_throttle"); return st.filters.some((f) => f.col === "key" && f.val === `admin:${a}`);
});
check(BL, "…the count is this address only, over the last 24 hours", HOW, async () => {
  const r = await L(BL); blockedWorld(); const a = ip(); await r.GET(reqOf("/api/blocked", { headers: { "x-forwarded-for": a } }));
  const st = W.fromLog.find((x) => x.table === "unblock_requests" && x.cols === "id" && x.filters.some((f) => f.kind === "gte"));
  const since = st && st.filters.find((f) => f.kind === "gte"); return !!st && st.filters.some((f) => f.col === "ip" && f.val === a) && Math.abs(Date.now() - 864e5 - Date.parse(since.val)) < 60000;
});
check(BL, "…a count that could not be read still RENDERS the page (0 used) — the page fails open on purpose", HOW, async () => {
  const r = await L(BL); blockedWorld({ usedErr: true }); const res = await r.GET(reqOf("/api/blocked", { headers: { "x-forwarded-for": ip() } })); const j = await json(res); return res.status === 200 && j.usedToday === 0 && j.remaining === 3;
});
check(BL, "…a 'have you asked already?' read that failed answers pendingUnknown — never 'you haven't asked'", HOW, async () => {
  const r = await L(BL); blockedWorld({ pendingErr: true }); const j = await json(await r.GET(reqOf("/api/blocked", { headers: { "x-forwarded-for": ip() } }))); return j.pending === false && j.pendingUnknown === true;
});
check(BL, "…the public read has a ceiling: past 20 a minute it degrades to the same page shape, not an error", HOW, async () => {
  const r = await L(BL); blockedWorld(); const a = ip(); let last;
  for (let i = 0; i < 21; i++) last = await r.GET(reqOf("/api/blocked", { headers: { "x-forwarded-for": a } })); const j = await json(last);
  return { ok: last.status === 200 && j.blocked === true && j.throttled === true && j.remaining === 3, note: JSON.stringify(j) };
});
check(BL, "POST while NOT blocked → 'not_blocked' and nothing is written (the page reloads to the login form)", HOW, async () => {
  const r = await L(BL); blockedWorld({ blocked: false }); const j = await json(await r.POST(reqOf("/api/blocked", { method: "POST", headers: { "x-forwarded-for": ip() }, body: "{}" })));
  return j.ok === false && j.reason === "not_blocked" && !W.fromLog.some((x) => x.op === "insert");
});
check(BL, "…a count that could not be read REFUSES the write (503, temporary) — the limiter never stops limiting", HOW, async () => {
  const r = await L(BL); blockedWorld({ usedErr: true }); const res = await r.POST(reqOf("/api/blocked", { method: "POST", headers: { "x-forwarded-for": ip() }, body: "{}" })); const j = await json(res);
  return res.status === 503 && j.reason === "try_later" && j.transient === true && !W.fromLog.some((x) => x.op === "insert");
});
check(BL, "…the 4th request in a day is refused 'limit' and nothing is written", HOW, async () => {
  const r = await L(BL); blockedWorld({ used: 3 }); const j = await json(await r.POST(reqOf("/api/blocked", { method: "POST", headers: { "x-forwarded-for": ip() }, body: "{}" })));
  return j.ok === false && j.reason === "limit" && j.remaining === 0 && !W.fromLog.some((x) => x.op === "insert");
});
check(BL, "…a request that goes in is filed under the address WE derived, never one named in the body", HOW, async () => {
  const r = await L(BL); blockedWorld({ used: 1 }); const a = ip(); const j = await json(await r.POST(reqOf("/api/blocked", { method: "POST", headers: { "x-forwarded-for": a }, body: JSON.stringify({ ip: "1.1.1.1", key: "admin:1.1.1.1", message: "please" }) })));
  const ins = W.fromLog.find((x) => x.op === "insert"); return { ok: j.ok === true && j.remaining === 1 && ins.patch.ip === a && ins.patch.key === `admin:${a}` && ins.patch.status === "open", note: JSON.stringify(ins.patch) };
});
check(BL, "…the note is trimmed and capped at 200 characters; anything not text is dropped", HOW, async () => {
  const r = await L(BL); blockedWorld(); const a = ip(); await r.POST(reqOf("/api/blocked", { method: "POST", headers: { "x-forwarded-for": a }, body: JSON.stringify({ message: "  " + "m".repeat(300) + "  " }) }));
  const m1 = W.fromLog.find((x) => x.op === "insert").patch.message; resetWorld(); blockedWorld(); await r.POST(reqOf("/api/blocked", { method: "POST", headers: { "x-forwarded-for": ip() }, body: JSON.stringify({ message: { evil: 1 } }) }));
  return m1.length === 200 && m1[0] === "m" && W.fromLog.find((x) => x.op === "insert").patch.message === null;
});
check(BL, "…a body that is not JSON still files the request (the note is optional)", HOW, async () => {
  const r = await L(BL); blockedWorld(); const j = await json(await r.POST(reqOf("/api/blocked", { method: "POST", headers: { "x-forwarded-for": ip() }, body: "not json" }))); return j.ok === true;
});
check(BL, "…a write that fails says so (500 save_failed) rather than claiming it was sent", HOW, async () => {
  const r = await L(BL); blockedWorld({ insertErr: true }); const res = await r.POST(reqOf("/api/blocked", { method: "POST", headers: { "x-forwarded-for": ip() }, body: "{}" })); const j = await json(res); return res.status === 500 && j.reason === "save_failed" && j.ok === false;
});
check(BL, "…and nothing on this route sends a phone alert — these requests are scroll-only, by his call", HOW, async () => {
  const r = await L(BL); blockedWorld(); await r.POST(reqOf("/api/blocked", { method: "POST", headers: { "x-forwarded-for": ip() }, body: "{}" })); return !W.fromLog.some((x) => /alert|push|notification/.test(x.table)) && !W.rpcLog.length;
});
// ── /api/issue-media ──
const fd = (parts) => { const f = new FormData(); for (const [k, v] of Object.entries(parts)) f.append(k, v); return f; };
const png = () => new File([new Uint8Array([137, 80, 78, 71])], "p.png", { type: "image/png" });
const up = (r, url, form, cookies) => r.POST(reqOf(url, { method: "POST", body: form, cookies }));
check(IM, "a request with neither a staff login nor the admin cookie is refused 401, with a sentence", HOW, async () => {
  const r = await L(IM); const res = await up(r, "/api/issue-media", fd({ file: png(), kind: "image" }), {}); const j = await json(res); return res.status === 401 && /please log in/.test(j.error) && !(W.misc.log || []).some((x) => x.k === "store");
});
check(IM, "…a staff lookup that hit a database flap answers 503 busy (X-LFH-Busy), never 'please log in'", HOW, async () => {
  const r = await L(IM); W.auth.dbError = true; const res = await up(r, "/api/issue-media", fd({ file: png(), kind: "image" }), { lfh_user: "tok" }); const j = await json(res);
  return res.status === 503 && j.busy === true && res.headers.get("X-LFH-Busy") === "1";
});
check(IM, "…a signed-in cook uploads for THEIR OWN restaurant — a ?rid= in the address cannot move them", HOW, async () => {
  const r = await L(IM); W.auth.user = { id: "c1", role: "kitchen", restaurant_id: RID }; const res = await up(r, "/api/issue-media?rid=" + R2, fd({ file: png(), kind: "image" }), { lfh_user: "tok" });
  const st = (W.misc.log || []).find((x) => x.k === "store"); return res.status === 200 && st.v.rid === RID;
});
check(IM, "…the admin, and only the admin, may name the restaurant with ?rid=", HOW, async () => {
  const r = await L(IM); W.auth.admin = true; const res = await up(r, "/api/issue-media?rid=" + R2, fd({ file: png(), kind: "image" }), { lfh_staff: "adm" });
  const st = (W.misc.log || []).find((x) => x.k === "store"); return res.status === 200 && st.v.rid === R2;
});
check(IM, "…the admin with no restaurant pinned is told 'No restaurant scope' (R48 — kept as written)", HOW, async () => {
  const r = await L(IM); W.auth.admin = true; const res = await up(r, "/api/issue-media", fd({ file: png(), kind: "image" }), { lfh_staff: "adm" }); const j = await json(res); return res.status === 400 && /^No restaurant scope/.test(j.error);
});
check(IM, "…a request with no file is refused 'Missing file.'", HOW, async () => { const r = await L(IM); W.auth.user = { role: "tablet", restaurant_id: RID }; const res = await up(r, "/api/issue-media", fd({ kind: "image" }), { lfh_user: "t" }); return res.status === 400 && (await json(res)).error === "Missing file."; });
check(IM, "…an attachment kind that is neither photo nor voice note is refused", HOW, async () => { const r = await L(IM); W.auth.user = { role: "tablet", restaurant_id: RID }; const res = await up(r, "/api/issue-media", fd({ file: png(), kind: "video" }), { lfh_user: "t" }); return res.status === 400 && (await json(res)).error === "Unknown attachment kind."; });
check(IM, "…the function's OWN refusal of a file keeps its sentence and its 400", HOW, async () => {
  const r = await L(IM); W.auth.user = { role: "tablet", restaurant_id: RID }; W.misc.storeThrows = "Photo must be 5 MB or smaller."; const res = await up(r, "/api/issue-media", fd({ file: png(), kind: "image" }), { lfh_user: "t" });
  return res.status === 400 && (await json(res)).error === "Photo must be 5 MB or smaller.";
});
check(IM, "…a STORAGE failure is not the storage service's words on a cook's screen (item 6) — 503 busy, a plain sentence", HOW, async () => {
  const r = await L(IM); W.auth.user = { role: "kitchen", restaurant_id: RID }; W.misc.storeThrows = "new row violates row-level security policy"; const res = await up(r, "/api/issue-media", fd({ file: png(), kind: "audio" }), { lfh_user: "t" }); const j = await json(res);
  return { ok: res.status === 503 && res.headers.get("X-LFH-Busy") === "1" && !/row-level|policy/.test(j.error) && /voice note couldn't be uploaded/.test(j.error), note: j.error };
});
check(IM, "…a good upload answers ok with the stored link and the kind", HOW, async () => {
  const r = await L(IM); W.auth.user = { role: "manager", restaurant_id: RID }; const j = await json(await up(r, "/api/issue-media", fd({ file: png(), kind: "image" }), { lfh_user: "t" })); return j.ok === true && /issue-media/.test(j.url) && j.kind === "image";
});
check(IM, "…a body that is not a form at all is answered 'Missing file.', not a crash", HOW, async () => {
  const r = await L(IM); W.auth.user = { role: "manager", restaurant_id: RID }; const res = await r.POST(reqOf("/api/issue-media", { method: "POST", body: "{}", headers: { "content-type": "application/json" }, cookies: { lfh_user: "t" } })); return res.status === 400 && (await json(res)).error === "Missing file.";
});
// ── /api/r/<slug>/menu-data ──
const MDL = async () => L(MD, { extra: OPTIONAL });
const mdGet = (r, slug = "aangan", headers = {}) => r.GET(reqOf(`/api/r/${slug}/menu-data`, { headers }), { params: Promise.resolve({ restaurant: slug }) });
const okRest = { id: RID, slug: "aangan", active: true, name: "Aangan" };
const okSettings = { data: { menu_enabled: true }, error: null };
check(MD, "a restaurant read that FAILED answers 503 + transient (try again) — never 'not found'", HOW, async () => { const r = await MDL(); W.misc.restaurant = "throw"; const res = await mdGet(r); const j = await json(res); return res.status === 503 && j.transient === true && res.headers.get("cache-control") === "no-store"; });
check(MD, "…a slug nobody owns is 404 'not found', and nothing else is read", HOW, async () => { const r = await MDL(); W.misc.restaurant = null; const res = await mdGet(r); return res.status === 404 && (await json(res)).error === "not found" && !(W.misc.log || []).some((x) => x.k === "bundle"); });
check(MD, "…a switched-off (inactive) restaurant is 404 too, the same gate as the page", HOW, async () => { const r = await MDL(); W.misc.restaurant = { ...okRest, active: false }; return (await mdGet(r)).status === 404; });
check(MD, "…a settings read that FAILED answers 503, never 'the menu is off'", HOW, async () => { const r = await MDL(); W.misc.restaurant = okRest; W.rpc.lfh_guest_settings = { data: null, error: { message: "timeout" } }; return (await mdGet(r)).status === 503; });
check(MD, "…the Menu master switch OFF refuses the DATA too, not only the screen", HOW, async () => { const r = await MDL(); W.misc.restaurant = okRest; W.rpc.lfh_guest_settings = { data: { menu_enabled: false }, error: null }; return (await mdGet(r)).status === 404 && !(W.misc.log || []).some((x) => x.k === "bundle"); });
check(MD, "…the switch is read for the RESOLVED restaurant id, never for the slug", HOW, async () => { const r = await MDL(); W.misc.restaurant = okRest; W.rpc.lfh_guest_settings = okSettings; await mdGet(r); return W.rpcLog.find((x) => x.fn === "lfh_guest_settings").args.p_restaurant_id === RID; });
check(MD, "…a bundle read that FAILED answers 503 with a sentence — our schema stays in the log", HOW, async () => { const r = await MDL(); W.misc.restaurant = okRest; W.rpc.lfh_guest_settings = okSettings; W.misc.bundleThrows = true; const res = await mdGet(r); const j = await json(res); return res.status === 503 && /please try again/.test(j.error) && !/read failed/.test(j.error); });
check(MD, "…a good read answers exactly { items, categories }, JSON, no-store, with an ETag", HOW, async () => {
  const r = await MDL(); W.misc.restaurant = okRest; W.rpc.lfh_guest_settings = okSettings; const res = await mdGet(r); const j = await json(res);
  return { ok: res.status === 200 && Object.keys(j).sort().join() === "categories,items" && res.headers.get("cache-control") === "no-store" && /^"m[A-Za-z0-9_-]{22}"$/.test(res.headers.get("etag") || "") && /json/.test(res.headers.get("content-type")), note: res.headers.get("etag") };
});
check(MD, "…the bundle is the RESOLVED restaurant's", HOW, async () => { const r = await MDL(); W.misc.restaurant = okRest; W.rpc.lfh_guest_settings = okSettings; await mdGet(r); return (W.misc.log || []).find((x) => x.k === "bundle").v === RID; });
check(MD, "…a phone already holding this version gets 304 with NO body (the 60-second net costs ~nothing)", HOW, async () => {
  const r = await MDL(); W.misc.restaurant = okRest; W.rpc.lfh_guest_settings = okSettings; const tag = (await mdGet(r)).headers.get("etag"); const res = await mdGet(r, "aangan", { "if-none-match": tag });
  return res.status === 304 && (await res.text()) === "" && res.headers.get("etag") === tag && res.headers.get("cache-control") === "no-store";
});
check(MD, "…a proxy-weakened W/\"…\" tag and a list of tags are both understood", HOW, async () => {
  const r = await MDL(); W.misc.restaurant = okRest; W.rpc.lfh_guest_settings = okSettings; const tag = (await mdGet(r)).headers.get("etag");
  const a = await mdGet(r, "aangan", { "if-none-match": "W/" + tag }); const b = await mdGet(r, "aangan", { "if-none-match": `"other", ${tag}` }); return a.status === 304 && b.status === 304;
});
check(MD, "…an OLD version gets the full new menu (the tag changes when anything a guest sees changes)", HOW, async () => {
  const r = await MDL(); W.misc.restaurant = okRest; W.rpc.lfh_guest_settings = okSettings; const tag = (await mdGet(r)).headers.get("etag");
  W.misc.bundle = { items: [{ id: "d2", title: "New dish" }], categories: [] }; const res = await mdGet(r, "aangan", { "if-none-match": tag }); return res.status === 200 && res.headers.get("etag") !== tag;
});
check(MD, "…two restaurants' bundles never share a tag (one restaurant's hash can't match another's)", HOW, async () => {
  const r = await MDL(); W.rpc.lfh_guest_settings = okSettings; W.misc.restaurant = okRest; W.misc.bundle = { items: [{ id: "a" }], categories: [] }; const t1 = (await mdGet(r)).headers.get("etag");
  W.misc.restaurant = { ...okRest, id: R2, slug: "spice-route" }; W.misc.bundle = { items: [{ id: "b" }], categories: [] }; const t2 = (await mdGet(r, "spice-route")).headers.get("etag"); return t1 !== t2;
});
// ── /api/rt-config ──
// The act-as cookie's real name, read from lib/panelScope.ts (Node cannot import the .ts file itself).
const ACT = (rd("lib/panelScope.ts").match(/ADMIN_ACT_COOKIE = "([^"]+)"/) || [])[1];
const rtGet = (r, url = "/api/rt-config", cookies = {}) => r.GET(reqOf(url, { cookies }));
check(RT, "signed out → the two PUBLIC values and restaurant #1, no-store", HOW, async () => {
  const r = await L(RT); const res = await rtGet(r); const j = await json(res); return res.status === 200 && Object.keys(j).sort().join() === "anonKey,restaurantId,url" && j.restaurantId === "00000000-0000-0000-0000-000000000001" && res.headers.get("cache-control") === "no-store";
});
check(RT, "…the key it hands out is the PUBLIC one, never the service-role key", HOW, async () => { const r = await L(RT); const j = await json(await rtGet(r)); return j.anonKey === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && j.anonKey !== process.env.SUPABASE_SERVICE_ROLE_KEY; });
check(RT, "…signed out, a ?rid= cannot move it", HOW, async () => { const r = await L(RT); const j = await json(await rtGet(r, "/api/rt-config?rid=" + R2)); return j.restaurantId === "00000000-0000-0000-0000-000000000001"; });
check(RT, "a staff member ALWAYS gets their own restaurant — a ?rid= or an act-as cookie cannot move them", HOW, async () => {
  const r = await L(RT); W.auth.user = { role: "manager", restaurant_id: RID }; const j = await json(await rtGet(r, "/api/rt-config?rid=" + R2, { lfh_user: "t", [ACT]: R2 })); return j.restaurantId === RID;
});
check(RT, "the admin: the per-tab ?rid= pin wins over the browser-wide act-as cookie", HOW, async () => {
  const r = await L(RT); W.auth.admin = true; const ck = ACT; const j = await json(await rtGet(r, "/api/rt-config?rid=" + R2, { lfh_staff: "a", [ck]: RID })); return j.restaurantId === R2;
});
check(RT, "…and with no pin, the act-as cookie decides", HOW, async () => {
  const r = await L(RT); W.auth.admin = true; const ck = ACT; const j = await json(await rtGet(r, "/api/rt-config", { lfh_staff: "a", [ck]: RID })); return { ok: j.restaurantId === RID, note: ck };
});
check(RT, "a staff lookup that hit a database flap answers 503 rt_busy (comes back by itself) — and names NO restaurant rather than guessing", HOW, async () => {
  const r = await L(RT); W.auth.dbError = true; const res = await rtGet(r, "/api/rt-config", { lfh_user: "t" }); const j = await json(res);
  return res.status === 503 && j.reason === "rt_busy" && j.retryable === true && j.selfFixable === false && !("restaurantId" in j) && res.headers.get("cache-control") === "no-store";
});
check(RT, "live updates not configured on this server → 503 rt_unconfigured (call Aevidine), not 200 with empty strings", HOW, async () => {
  const keep = process.env.NEXT_PUBLIC_SUPABASE_URL; const r = await L(RT); delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  try { const res = await rtGet(r); const j = await json(res); return res.status === 503 && j.reason === "rt_unconfigured" && j.unconfigured === true && j.selfFixable === false && !!j.restaurantId; } finally { process.env.NEXT_PUBLIC_SUPABASE_URL = keep; }
});
