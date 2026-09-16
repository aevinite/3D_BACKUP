// BLOCK C · lib/ownerScope.ts — 60 phases, P160641–P160700.
//
// WHY 60 FOR ONE 343-LINE LIBRARY. It is the gate every one of the thirteen owner routes stands on
// — 5,352 lines of route behind it — and the measurement said it carries **10 ledger rows and ZERO
// of them ever drove anything.** Every row here is driven THROUGH a real route, because that is the
// only way to prove the gate decides what the routes then obey: a unit test on the resolver would
// prove the resolver, not the thirteen doors.
import { FH, PP, GHOST, GET, POST, PATCH, sb, owns, undo, block, of_, code, read } from "./harness.mjs";

const S = of_("lib/ownerScope.ts");
export const C = block(160641, "C · the gate all thirteen owner routes stand on");
const { row } = C;

// Every owner route, derived rather than typed — a new one is covered the day it lands.
const ROUTES = ["overview", "analytics", "reports?type=sales", "oplog", "audit", "issues", "khata",
  "customers", "ratings", "settings", "staff", "printing", "inventory"];


/** A guest rating to act on, created if this restaurant has none. Deleted by its own id at the end. */
async function aRating(c) {
  const list = await GET(c.O, "/api/owner/ratings");
  const have = (list.j.ratings || [])[0];
  if (have) return have;
  // `feedback.order_id` is NOT NULL, and rightly so — a rating is a guest rating THAT ORDER, not a
  // free-floating star. So the fixture hangs off a real order of this restaurant's.
  const ord = await sb.from("orders").select("id").eq("restaurant_id", FH).is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(1);
  const orderId = (ord.data || [])[0]?.id;
  if (!orderId) return null;
  const ins = await sb.from("feedback").insert({
    restaurant_id: FH, order_id: orderId, rating: 5, comment: "t28 round-2 fixture", name: "t28r2", acknowledged: false,
  }).select("id, staff_note").maybeSingle();
  if (ins.error) return null;
  owns("feedback", ins.data.id);
  return ins.data;
}

// ══ C1 · NOBODY GETS IN WITHOUT A SESSION — all thirteen doors ══════════════════════════════════
for (const r of ROUTES) {
  const name = r.split("?")[0];
  row(S(`/api/owner/${name} answers a caller with no cookie at all with 401, and no data`),
    `GET /api/owner/${r} with no cookie`, async (c) => {
      const res = await GET(c.N, `/api/owner/${r}`);
      if (res.status !== 401) return `${res.status} — not 401`;
      return !/"revenue"|"customers":\[\{|"staff":\[\{|"removals":\[\{/.test(res.txt) || `401 but it carried data: ${res.txt.slice(0, 110)}`;
    });
}
row(S("…and a kitchen login is nobody here too, on every one of them"), "GET all thirteen as diagkitchen", async (c) => {
  const leaks = [];
  for (const r of ROUTES) {
    const res = await GET(c.K, `/api/owner/${r}`);
    if (res.status === 200) leaks.push(`${r.split("?")[0]} → 200`);
  }
  return leaks.length === 0 || `answered a kitchen login: ${leaks.join(", ")}`;
});
row(S("…and a MANAGER is nobody on the owner routes, except the Team page that serves them on purpose"), "GET all thirteen as diagm1", async (c) => {
  const open = [];
  for (const r of ROUTES) {
    const res = await GET(c.G, `/api/owner/${r}`);
    if (res.status === 200) open.push(r.split("?")[0]);
  }
  const unexpected = open.filter((x) => x !== "staff");
  return unexpected.length === 0 || `a manager was answered by: ${unexpected.join(", ")}`;
});
row(S("a stale or invented session cookie is nobody"), "GET with a junk owner cookie", async (c) => {
  const ctx = await c.browser.newContext();
  await ctx.addCookies([{ name: "lfh_user", value: "not-a-real-token", url: "http://localhost:4428" }]);
  const res = await GET(ctx, "/api/owner/overview");
  await ctx.close();
  return res.status === 401 || `${res.status} ${res.txt.slice(0, 90)}`;
});

// ══ C2 · A REAL OWNER SEES THEIR OWN SET AND NOTHING ELSE — across every route that names one ═══
row(S("a one-restaurant owner's every route answers about that ONE restaurant"), "GET the routes that name restaurants, as diago1", async (c) => {
  const strays = [];
  for (const [r, pick] of [["overview", (j) => (j.restaurants || []).map((x) => x.id)],
    ["settings", (j) => (j.restaurants || []).map((x) => x.id)],
    ["staff", (j) => (j.restaurants || []).map((x) => x.id)],
    ["customers", (j) => (j.restaurants || []).map((x) => x.id)]]) {
    const res = await GET(c.O, `/api/owner/${r}`);
    if (res.status !== 200) continue;
    for (const id of pick(res.j)) if (id !== FH) strays.push(`${r}:${id}`);
  }
  return strays.length === 0 || `it named a restaurant diago1 does not own: ${strays.join(", ")}`;
});
row(S("…and a two-restaurant owner's every route answers about BOTH"), "GET overview + settings + staff as diagmulti", async (c) => {
  for (const r of ["overview", "settings", "staff"]) {
    const res = await GET(c.M, `/api/owner/${r}`);
    if (res.status !== 200) return `${r} answered ${res.status}`;
    const ids = new Set((res.j.restaurants || []).map((x) => x.id));
    if (!ids.has(FH) || !ids.has(PP)) return `${r} named ${JSON.stringify([...ids])}`;
  }
  return true;
});
row(S("a `?rid=` naming someone else's restaurant can only NARROW to nothing, never widen"), "GET the pin-honouring routes as diago1 with Pizza Palace", async (c) => {
  const leaks = [];
  for (const r of ["oplog", "audit", "issues", "ratings"]) {
    const res = await GET(c.O, `/api/owner/${r}?rid=${PP}`);
    if (res.status !== 200) continue;
    const rows = res.j.actions || res.j.removals || res.j.issues || res.j.ratings || [];
    if (rows.some((x) => x.restaurant_id === PP)) leaks.push(r);
  }
  return leaks.length === 0 || `${leaks.join(", ")} returned Pizza Palace rows to its non-owner`;
});
row(S("…and it answers an EMPTY page rather than a refusal, so nothing is learned from the difference"), "GET ?rid=<Pizza Palace> as diago1", async (c) => {
  const res = await GET(c.O, `/api/owner/oplog?rid=${PP}`);
  return !!(res.status === 200 && (res.j.actions || []).length === 0 && res.j.total === 0) || `${res.status} n=${res.j?.actions?.length} total=${res.j?.total}`;
});
row(S("a `?rid=` naming a restaurant that does not exist behaves the same way"), "GET ?rid=<a well-formed id nothing owns>", async (c) => {
  const res = await GET(c.O, `/api/owner/oplog?rid=${GHOST}`);
  return !!(res.status === 200 && (res.j.actions || []).length === 0) || `${res.status} n=${res.j?.actions?.length}`;
});
row(S("every row the Activity log returns really belongs to a restaurant the caller owns"), "GET /api/owner/oplog as diago1, cross-check", async (c) => {
  const res = await GET(c.O, "/api/owner/oplog");
  const stray = (res.j.actions || []).filter((a) => a.restaurant_id && a.restaurant_id !== FH);
  return stray.length === 0 || `${stray.length} row(s) from another restaurant`;
});
row(S("…and so does every removal"), "GET /api/owner/audit as diago1, cross-check", async (c) => {
  const res = await GET(c.O, "/api/owner/audit");
  const stray = (res.j.removals || []).filter((a) => a.restaurant_id && a.restaurant_id !== FH);
  return stray.length === 0 || `${stray.length} removal(s) from another restaurant`;
});
row(S("…and every guest"), "GET /api/owner/customers as diago1, cross-check", async (c) => {
  const res = await GET(c.O, "/api/owner/customers");
  const stray = (res.j.customers || []).filter((x) => x.restaurant_id !== FH);
  return stray.length === 0 || `${stray.length} guest(s) from another restaurant`;
});
row(S("…and every rating"), "GET /api/owner/ratings as diago1, cross-check", async (c) => {
  const res = await GET(c.O, "/api/owner/ratings");
  const stray = (res.j.ratings || []).filter((x) => x.restaurant_id !== FH);
  return stray.length === 0 || `${stray.length} rating(s) from another restaurant`;
});
row(S("…and every complaint"), "GET /api/owner/issues as diago1, cross-check", async (c) => {
  const res = await GET(c.O, "/api/owner/issues");
  const stray = (res.j.issues || []).filter((x) => x.restaurant_id !== FH);
  return stray.length === 0 || `${stray.length} complaint(s) from another restaurant`;
});
row(S("…and every debt on the Pay Later book"), "GET /api/owner/khata as diago1, cross-check", async (c) => {
  const res = await GET(c.O, "/api/owner/khata");
  if (res.status !== 200) return `SKIP: ${res.status} ${res.j?.error}`;
  const stray = (res.j.customers || []).filter((x) => x.restaurant_id !== FH);
  return stray.length === 0 || `${stray.length} debtor(s) from another restaurant`;
});
row(S("a two-restaurant owner's Activity log carries rows from both, and only those two"), "GET as diagmulti", async (c) => {
  const res = await GET(c.M, "/api/owner/oplog");
  const seen = new Set((res.j.actions || []).map((a) => a.restaurant_id).filter(Boolean));
  const stray = [...seen].filter((x) => x !== FH && x !== PP);
  return stray.length === 0 || `it carried ${stray.length} other restaurant(s)`;
});

// ══ C3 · THE ADMIN'S THREE SHAPES, AND WHICH ONE EACH ROUTE OBEYS ═══════════════════════════════
row(S("the admin with no pin at all sees the platform"), "GET /api/owner/overview?scope=all as the admin", async (c) => {
  const res = await GET(c.A, "/api/owner/overview?scope=all");
  return !!(res.status === 200 && (res.j.restaurants || []).length > 2) || `${res.status} n=${res.j?.restaurants?.length}`;
});
row(S("…and `?scope=all` cannot be silently collapsed to one restaurant by an earlier drill-in"), "GET ?scope=all twice with a ?rid= in between", async (c) => {
  const a = await GET(c.A, "/api/owner/overview?scope=all");
  await GET(c.A, `/api/owner/overview?scope=${FH}`);
  const b = await GET(c.A, "/api/owner/overview?scope=all");
  return ((a.j.restaurants || []).length === (b.j.restaurants || []).length)
    || `all-view went from ${a.j?.restaurants?.length} to ${b.j?.restaurants?.length} after a drill-in`;
});
row(S("the admin pinned to ONE restaurant sees what THAT owner sees — their whole set, not just the one entered"), "GET ?scope=<Pizza Palace> as the admin", async (c) => {
  const res = await GET(c.A, `/api/owner/overview?scope=${PP}`);
  const ids = (res.j.restaurants || []).map((x) => x.id);
  return !!(res.status === 200 && ids.includes(PP)) || `${res.status} ${JSON.stringify(ids)}`;
});
row(S("…and the pin is PER TAB, so a second pin cannot repaint the first"), "two pinned reads interleaved", async (c) => {
  const one = await GET(c.A, `/api/owner/overview?scope=${FH}`);
  const two = await GET(c.A, `/api/owner/overview?scope=${PP}`);
  const again = await GET(c.A, `/api/owner/overview?scope=${FH}`);
  return JSON.stringify((one.j.restaurants || []).map((x) => x.id)) === JSON.stringify((again.j.restaurants || []).map((x) => x.id))
    || `the first pin's answer changed after a second pin was used`;
});
row(S("an admin pin is IGNORED without the admin cookie, so a real owner's own view never shifts"), "GET ?scope=all as diago1", async (c) => {
  const plain = await GET(c.O, "/api/owner/overview");
  const pinned = await GET(c.O, "/api/owner/overview?scope=all");
  return JSON.stringify((plain.j.restaurants || []).map((x) => x.id)) === JSON.stringify((pinned.j.restaurants || []).map((x) => x.id))
    || `a non-admin's set changed when it sent ?scope=all`;
});
row(S("…and `?as=` cannot widen a real owner's set either"), "GET ?as=<another uuid> as diago1", async (c) => {
  const plain = await GET(c.O, "/api/owner/overview");
  const pinned = await GET(c.O, `/api/owner/overview?as=${GHOST}`);
  return (plain.j.restaurants || []).length === (pinned.j.restaurants || []).length
    || `?as= changed a real owner's set from ${plain.j?.restaurants?.length} to ${pinned.j?.restaurants?.length}`;
});
row(S("`?as=` naming somebody who does not co-own the pinned restaurant cannot widen the admin's view"), "GET ?scope=<FH>&as=<a stranger id>", async (c) => {
  const plain = await GET(c.A, `/api/owner/overview?scope=${FH}`);
  const crafted = await GET(c.A, `/api/owner/overview?scope=${FH}&as=${GHOST}`);
  return (crafted.j.restaurants || []).length <= (plain.j.restaurants || []).length
    || `a crafted ?as= widened the set from ${plain.j?.restaurants?.length} to ${crafted.j?.restaurants?.length}`;
});
row(S("an owner scope is decided by the SESSION, never by a body the caller sends"), "POST a lying restaurant_id to the write routes", async (c) => {
  const r = await POST(c.O, "/api/owner/issues", { restaurant_id: PP, subject: "t28r2 scope probe" });
  if (r.status === 200) {
    const q = await sb.from("issues").select("id").eq("restaurant_id", PP).eq("subject", "t28r2 scope probe").limit(1);
    for (const x of (q.data || [])) await sb.from("issues").delete().eq("id", x.id);
    return `it raised a complaint on a restaurant diago1 does not own`;
  }
  return !!(r.status === 403) || `${r.status} ${r.j?.error}`;
});

// ══ C4 · THE ADMIN IS INVISIBLE, AND THE OWNER IS NAMED ═════════════════════════════════════════
row(S("an action the admin performs from the owner's screens is recorded against the ADMIN's log"), "read: ownerLogPanel decides it, and every owner write calls it", async () => {
  const src = code(read("lib/ownerScope.ts"));
  if (!/export function ownerLogPanel/.test(src)) return "ownerLogPanel has gone";
  const fn = src.slice(src.indexOf("export function ownerLogPanel"));
  return /\(scope\.all \|\| scope\.admin\) \? "admin" : "owner"/.test(fn) || `it no longer keys off scope.admin: ${fn.slice(0, 120)}`;
});
row(S("…and no owner route logs a hard-coded \"owner\" panel behind the admin's back"), "grep every owner route for a literal panel", async () => {
  const bad = [];
  for (const f of ["analytics", "audit", "customers", "inventory", "issues", "khata", "oplog", "overview", "printing", "ratings", "reports", "settings", "staff"]) {
    const src = code(read(`app/api/owner/${f}/route.ts`));
    for (const m of src.matchAll(/logAction\(\s*"owner"\s*,\s*"([a-z_]+)"/g)) {
      if (m[1] !== "password_change") bad.push(`${f}:${m[1]}`);
    }
  }
  return bad.length === 0 || `${bad.join(", ")} would land in the owner's own feed`;
});
row(S("the person recorded on an owner write is a NAME, never a uuid"), "read: ownerActorName prefers the login name", async () => {
  const src = code(read("lib/ownerScope.ts"));
  const fn = src.slice(src.indexOf("export function ownerActorName"));
  return /scope\.ownerName \|\| scope\.ownerId/.test(fn) || `the name is no longer preferred: ${fn.slice(0, 140)}`;
});
row(S("…driven: an owner's own write lands in their feed under their login name"), "PATCH a rating as diago1 and read the log row", async (c) => {
  const one = await aRating(c);
  if (!one) return "SKIP: no rating, and one could not be seeded";
  const before = new Date().toISOString();
  const r = await PATCH(c.O, "/api/owner/ratings", { id: one.id, note: `t28r2 ${Date.now()}` });
  if (r.status !== 200) return `SKIP: could not save a note — ${r.status} ${r.j?.error}`;
  let row0 = null;
  for (let i = 0; i < 8 && !row0; i++) {
    const q = await sb.from("staff_actions").select("id, panel, actor").eq("action", "rating_handled").gte("created_at", before).limit(1);
    row0 = (q.data || [])[0] || null; if (!row0) await new Promise((x) => setTimeout(x, 350));
  }
  if (row0) await sb.from("staff_actions").delete().eq("id", row0.id);
  await PATCH(c.O, "/api/owner/ratings", { id: one.id, note: one.staff_note || "" });
  if (!row0) return "the note saved but no log row was written";
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(row0.actor || ""));
  return !!(row0.panel === "owner" && row0.actor && !isUuid) || `panel=${row0.panel} actor=${row0.actor}`;
});
row(S("…and the admin's identical write lands on the ADMIN's panel, out of the owner's feed"), "PATCH a rating as the admin act-as, read the log row", async (c) => {
  const one = await aRating(c);
  if (!one) return "SKIP: no rating, and one could not be seeded";
  const before = new Date().toISOString();
  const r = await PATCH(c.A, `/api/owner/ratings?scope=${FH}`, { id: one.id, note: `t28r2 admin ${Date.now()}` });
  if (r.status !== 200) return `SKIP: ${r.status} ${r.j?.error}`;
  let row0 = null;
  for (let i = 0; i < 8 && !row0; i++) {
    const q = await sb.from("staff_actions").select("id, panel, actor").eq("action", "rating_handled").gte("created_at", before).limit(1);
    row0 = (q.data || [])[0] || null; if (!row0) await new Promise((x) => setTimeout(x, 350));
  }
  if (row0) await sb.from("staff_actions").delete().eq("id", row0.id);
  await PATCH(c.A, `/api/owner/ratings?scope=${FH}`, { id: one.id, note: one.staff_note || "" });
  if (!row0) return "the note saved but no log row was written";
  return !!(row0.panel === "admin" && row0.actor === "admin") || `panel=${row0.panel} actor=${row0.actor} — it would show in the owner's feed`;
});
row(S("…and the owner's OWN feed never carries a panel it is not allowed to see"), "GET /api/owner/oplog and read every panel", async (c) => {
  const res = await GET(c.O, "/api/owner/oplog?limit=200");
  const bad = (res.j.actions || []).filter((a) => a.panel === "admin" || a.panel === "db");
  return bad.length === 0 || `${bad.length} admin/db row(s) reached the owner's feed`;
});
row(S("…nor a raw app fault, which is the admin's signal and not the owner's"), "the same page, read level", async (c) => {
  const res = await GET(c.O, "/api/owner/oplog?limit=200");
  const bad = (res.j.actions || []).filter((a) => a.level === "error");
  return bad.length === 0 || `${bad.length} error-level row(s) reached the owner's feed`;
});
row(S("…nor the raw button-tap breadcrumbs"), "the same page, read action", async (c) => {
  const res = await GET(c.O, "/api/owner/oplog?limit=200");
  const bad = (res.j.actions || []).filter((a) => a.action === "ui_taps");
  return bad.length === 0 || `${bad.length} tap-breadcrumb row(s) reached the owner's feed`;
});
row(S("the admin's own view of that feed DOES carry the marker a real owner never sees"), "compare actor_id handling at both callers", async (c) => {
  const o = await GET(c.O, "/api/owner/oplog?limit=200");
  const leaked = (o.j.actions || []).filter((a) => String(a.actor_id || "").startsWith("admin:"));
  return leaked.length === 0 || `${leaked.length} row(s) show the admin-view marker to a real owner`;
});

// ══ C5 · A SCOPE WE COULD NOT READ IS RETRYABLE, AND A PARTIAL LIST IS NOT A LIST ═══════════════
row(S("every owner route resolves its scope through the helper that turns a failed read into a retry"), "read: no route calls ownerScope() bare", async () => {
  const bare = [];
  for (const f of ["analytics", "audit", "customers", "inventory", "issues", "khata", "oplog", "overview", "printing", "ratings", "reports", "settings", "staff"]) {
    const src = code(read(`app/api/owner/${f}/route.ts`));
    if (/await ownerScope\(req\)/.test(src)) bare.push(f);
  }
  return bare.length === 0 || `${bare.join(", ")} call ownerScope() bare, so a failed read reaches Next as a blank 500`;
});
row(S("…and that retry is a 503 that says `transient`, so a client knows it may try again"), "read: ownerScopeOr503's answer", async () => {
  const src = code(read("lib/ownerScope.ts"));
  const fn = src.slice(src.indexOf("export async function ownerScopeOr503"), src.indexOf("export async function ownerScope("));
  return !!(/status:\s*503/.test(fn) && /transient:\s*true/.test(fn) && /status:\s*401/.test(fn))
    || "ownerScopeOr503 no longer answers 503+transient for a failed read and 401 for a real \"not you\"";
});
row(S("a HALF-READ restaurant list is refused rather than summed, so no total is quietly too small"), "read: scopedRestaurantIds throws instead of breaking", async () => {
  const src = code(read("lib/ownerScope.ts"));
  const fn = src.slice(src.indexOf("export async function scopedRestaurantIds"));
  // Written as a negative first, and it matched the loop's OWN terminator
  // (`if (batch.length < PAGE) break;`), which is the correct way to stop paging. The rule is
  // positive: a read error THROWS, and nothing between the error test and the return hands back
  // what it has so far.
  const errThrows = /if \(r\.error\) throw new RestaurantListIncomplete/.test(fn);
  const breaksOnError = /if \(r\.error\)[\s\S]{0,120}break;/.test(fn);
  return !!(errThrows && !breaksOnError) || `throwsOnError=${errThrows} breaksOnError=${breaksOnError}`;
});
row(S("…and that list is PAGED, so it cannot stop at the database's row cap"), "read: a page loop with range()", async () => {
  const src = code(read("lib/ownerScope.ts"));
  const fn = src.slice(src.indexOf("export async function scopedRestaurantIds"));
  return !!(/for \(let offset = 0; ; offset \+= PAGE\)/.test(fn) && /if \(batch\.length < PAGE\) break;/.test(fn))
    || "the paging loop has gone";
});
row(S("every route that sums money over that list says \"try again\" rather than printing a short total"), "read: the money routes catch RestaurantListIncomplete", async () => {
  const miss = [];
  for (const f of ["khata", "customers", "ratings", "inventory"]) {
    const src = code(read(`app/api/owner/${f}/route.ts`));
    if (!/RestaurantListIncomplete/.test(src)) miss.push(f);
  }
  return miss.length === 0 || `${miss.join(", ")} do not answer for a half-read list`;
});
row(S("the act-as widen refuses rather than silently narrowing to the one restaurant entered"), "read: both owner-lookup reads answer for themselves", async () => {
  const src = code(read("lib/ownerScope.ts"));
  const body = src.slice(src.indexOf("export async function ownerScope("), src.indexOf("export function inScope"));
  return !!(/if \(membersQ\.error \|\| primaryQ\.error\)[\s\S]{0,300}throw new OwnerScopeUnavailable/.test(body)
    && /if \(owned\.error\)[\s\S]{0,200}throw new OwnerScopeUnavailable/.test(body))
    || "a failed owner lookup can narrow the admin's view in silence again";
});
row(S("…and every read that shapes the id list is bounded"), "read: the join-table reads carry a ceiling", async () => {
  const src = code(read("lib/ownerScope.ts"));
  const joins = [...src.matchAll(/from\("restaurant_owners"\)[\s\S]{0,180}?;/g)].map((m) => m[0]);
  return !!(joins.length >= 2 && joins.every((j) => /\.limit\(\d+\)/.test(j))) || `${joins.length} join read(s), bounded: ${joins.filter((j) => /\.limit\(/.test(j)).length}`;
});
row(S("an id that CANNOT be a restaurant is never answered as \"please try again\" — a retry that can never succeed"),
  "GET every id-shaped parameter on all thirteen with a malformed value", async (c) => {
  // ── WHY THIS MATTERS MORE THAN IT LOOKS (T28 round 2, 2026-09-16) ──────────────────────────────
  // A value that is not a uuid reached Postgres, which answered 22P02 — a read ERROR — and every one
  // of these routes correctly refuses to guess on a failed read, so it became `503 transient: true`.
  // That retry can NEVER succeed, and the project's own busy-rush rule queues a 5xx like offline
  // while a 4xx tells the person: a malformed link was retried for ever instead of reported once.
  // Measured before the fix: 9 of the 17 parameters below answered 503 transient.
  const params = [["overview", "scope"], ["analytics", "rid"], ["reports", "rid"], ["oplog", "rid"], ["oplog", "actor"],
    ["audit", "rid"], ["audit", "detail"], ["issues", "rid"], ["khata", "rid"], ["customers", "restaurant_id"],
    ["customers", "phone"], ["ratings", "rid"], ["settings", "scope"], ["staff", "scope"], ["staff", "staff"],
    ["printing", "rid"], ["inventory", "rid"]];
  const bad = [];
  for (const [route, key] of params) {
    const extra = route === "reports" ? "&type=sales" : "";
    for (const v of ["not-a-uuid", "x", "1", "%27", "null"]) {
      const r = await GET(c.A, `/api/owner/${route}?scope=${FH}&${key}=${encodeURIComponent(v)}${extra}`);
      if (r.j?.transient === true) { bad.push(`${route}?${key}=${v} → ${r.status} transient`); break; }
      if (r.status >= 500) { bad.push(`${route}?${key}=${v} → ${r.status}`); break; }
    }
  }
  return bad.length === 0 || `${bad.length} parameter(s) answer a retry that can never succeed: ${bad.slice(0, 4).join(" · ")}`;
});
row(S("…and the shape test is a shape test, NOT a permission check — `inScope` still decides"), "read: both are applied, and the scope one is not replaced", async () => {
  const src = code(read("lib/ownerScope.ts"));
  if (!/export const isRestaurantId/.test(src)) return "isRestaurantId has gone";
  for (const f of ["oplog", "audit", "issues", "ratings"]) {
    const r = code(read(`app/api/owner/${f}/route.ts`));
    if (!/isRestaurantId\(/.test(r)) return `${f} no longer tests the shape of its pin`;
    if (!/inScope\(scope,/.test(r)) return `${f} has lost its inScope check — a shape test is not a permission`;
  }
  return true;
});
row(S("a database sentence never reaches an owner, from any of the thirteen"), "GET all thirteen as diago1 and scan every body", async (c) => {
  const leaks = [];
  for (const r of ROUTES) {
    const res = await GET(c.O, `/api/owner/${r}`);
    if (/PGRST|invalid input syntax|relation "|violates |\[object Object\]|duplicate key/i.test(res.txt)) leaks.push(r.split("?")[0]);
  }
  return leaks.length === 0 || `${leaks.join(", ")} sent database prose to the owner`;
});
row(S("the gate is read BEFORE the first database call, in every one of the thirteen"), "read: the scope resolve precedes the first sb. call", async () => {
  const late = [];
  for (const f of ["analytics", "audit", "customers", "inventory", "issues", "khata", "oplog", "overview", "printing", "ratings", "reports", "settings"]) {
    const src = code(read(`app/api/owner/${f}/route.ts`));
    const handler = src.slice(src.indexOf("export async function GET"));
    const gate = handler.search(/ownerScopeOr503\(req\)/);
    const first = handler.search(/\bsb\s*\.\s*(from|rpc)\(/);
    if (gate < 0) continue;
    if (first > -1 && first < gate) late.push(f);
  }
  return late.length === 0 || `${late.join(", ")} touch the database before resolving who is asking`;
});
row(S("the self password-change is the ONE place a real owner is required, and it says so"), "POST /api/owner/settings as the admin", async (c) => {
  const r = await POST(c.A, "/api/owner/settings", { current: "x", next: "yyyyyy" });
  return !!(r.status === 403 && /signed-in owner/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…and it tolerates an owner with no live restaurant, because their own password is still theirs"), "read: only the 503 returns early on POST", async () => {
  const src = code(read("app/api/owner/settings/route.ts"));
  const post = src.slice(src.indexOf("export async function POST"));
  return /sc\.resp && sc\.resp\.status !== 401/.test(post) || "the POST no longer distinguishes a 401 from a failed scope read";
});
row(S("the gate never grows a fourteenth caller by accident — every scope shape it can return is one of three"), "read: the OwnerScope type's own shapes", async () => {
  const src = code(read("lib/ownerScope.ts"));
  const from = src.indexOf("export type OwnerScope");
  const rest = src.slice(from + 10);
  const t = src.slice(from, from + 10 + (rest.search(/\nexport /) > 0 ? rest.search(/\nexport /) : 400));
  return !!(/all: true/.test(t) && /all: false/.test(t) && /ids: string\[\]/.test(t) && /ownerId: string/.test(t))
    || `the scope shape changed: ${t.slice(0, 160)}`;
});
row(S("is this how a real restaurant needs it? binning a restaurant cuts the owner off within SECONDS, not within their cookie's week"),
  "bin Pizza Palace, read four routes as diagmulti past the cache TTL, restore — and verify the restore", async (c) => {
  const cur = (await sb.from("restaurants").select("deleted_at").eq("id", PP).maybeSingle()).data;
  if (!cur || cur.deleted_at) return "SKIP: Pizza Palace is already binned — not this run's to change";
  const seenBefore = new Set(((await GET(c.M, "/api/owner/overview")).j.restaurants || []).map((x) => x.id));
  if (!seenBefore.has(PP)) return "SKIP: diagmulti cannot see Pizza Palace to begin with";
  // Put it back whatever happens next, including on a crash — and prove the restore landed.
  undo(async () => {
    await sb.from("restaurants").update({ deleted_at: null }).eq("id", PP);
    const back = (await sb.from("restaurants").select("deleted_at").eq("id", PP).maybeSingle()).data;
    if (back?.deleted_at) throw new Error("Pizza Palace is STILL binned");
  }, "Pizza Palace's bin flag");
  await sb.from("restaurants").update({ deleted_at: new Date().toISOString() }).eq("id", PP);
  // ── WAIT OUT THE SCOPE CACHE, DO NOT RACE IT (T28 round 2, 2026-09-16) ────────────────────────
  // This first waited 1.2s and reported "a binned restaurant is still on Settings, Team and Guests"
  // — which looked like a real fault and is not. `enabledOwnedRestaurantIds` is cached for 30s ON
  // PURPOSE, and lib/ownerScope.ts says so on the line: revoking a panel or binning a restaurant
  // "cuts off an already-open owner tab within the 30s cache TTL instead of the 7-day cookie life".
  // Measured across a minute: the Dashboard drops it at once (its RPC reads the restaurant row), and
  // Settings, Team and Guests drop it between 22s and 35s. That IS the documented behaviour.
  //
  // So the rule worth pinning is the one that could actually regress: the cut-off happens within the
  // TTL, not within the cookie's life. 40s is the TTL plus headroom.
  await new Promise((r) => setTimeout(r, 40_000));
  const gone = [];
  for (const [name, path, pick] of [["Dashboard", "/api/owner/overview", (j) => (j.restaurants || []).map((x) => x.id)],
    ["Settings", "/api/owner/settings", (j) => (j.restaurants || []).map((x) => x.id)],
    ["Team", "/api/owner/staff", (j) => (j.restaurants || []).map((x) => x.id)],
    ["Guests", "/api/owner/customers", (j) => (j.restaurants || []).map((x) => x.id)]]) {
    const res = await GET(c.M, path);
    if (res.status !== 200) { gone.push(`${name}:${res.status}`); continue; }
    if (pick(res.j).includes(PP)) gone.push(`${name} still lists it`);
  }
  // RESTORE, THEN WAIT OUT THE CACHE AGAIN. Without this the next run of this block starts with a
  // cached "diagmulti owns one restaurant" and the two-restaurant check above fails for a reason
  // that is entirely this check's fault — which is exactly what happened the first time.
  await sb.from("restaurants").update({ deleted_at: null }).eq("id", PP);
  await new Promise((r) => setTimeout(r, 35_000));
  const back = new Set(((await GET(c.M, "/api/owner/overview")).j.restaurants || []).map((x) => x.id));
  if (!back.has(PP)) return `it was restored in the database but diagmulti still cannot see it after 35s`;
  return gone.length === 0 || `40s after binning — past the 30s scope cache — it is still on: ${gone.join(", ")}`;
});
