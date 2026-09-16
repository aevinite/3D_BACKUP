// BLOCK A · app/api/owner/staff/route.ts — 120 phases, P104351–P104400 + P160501–P160570.
//
// WHY THE BIGGEST SHARE. Measured before planning: 1,274 lines carrying 33 ledger rows — 26 per
// thousand lines, the THINNEST in this territory — and only 8 of those 33 drove anything. It also has
// more verbs than anything else here: a roster, a person's detail, create, record a payment, nine
// PATCH actions and a delete, each with its own hierarchy and permission rung. Almost all of these
// are DRIVEN, at five different callers.
import { FH, PP, GHOST, GET, POST, PATCH, DEL, sb, owns, undo, block, of_, code, read } from "./harness.mjs";

const S = of_("app/api/owner/staff/route.ts");
const ids = [...Array(50)].map((_, i) => `P${104351 + i}`).concat([...Array(70)].map((_, i) => `P${160501 + i}`));
export const A = block(ids, "A · the owner's Team page and everything it can do");
const { row } = A;

// fixtures this block creates, resolved once
const fx = {};
const uniq = () => `zzt28r2${Math.random().toString(36).slice(2, 8)}`;

// ══ A1 · WHO MAY SEE THE ROSTER AT ALL (the scope resolver, driven at six callers) ══════════════
row(S("a signed-in OWNER sees their own restaurant's team"), "GET /api/owner/staff as diago1", async (c) => {
  const r = await GET(c.O, "/api/owner/staff");
  fx.roster = r.j;
  return !!(r.status === 200 && Array.isArray(r.j.staff) && r.j.actor === "owner") || `${r.status} actor=${r.j?.actor}`;
});
row(S("…and every person on it belongs to a restaurant that owner owns"), "cross-check staff[].restaurant_id against restaurants[]", async (c) => {
  const r = await GET(c.O, "/api/owner/staff");
  const mine = new Set(r.j.restaurants.map((x) => x.id));
  const stray = r.j.staff.filter((s) => !mine.has(s.restaurant_id));
  return stray.length === 0 || `${stray.length} person(s) from a restaurant not in the list`;
});
row(S("an owner of TWO restaurants sees both teams, not one"), "GET as diagmulti", async (c) => {
  const r = await GET(c.M, "/api/owner/staff");
  const rids = new Set(r.j.restaurants?.map((x) => x.id));
  return !!(r.status === 200 && rids.has(FH) && rids.has(PP)) || `${r.status} ${JSON.stringify([...rids])}`;
});
row(S("…and a `?rid=` pin narrows that owner to the one restaurant they are looking at"), "GET as diagmulti with ?rid=<Pizza Palace>", async (c) => {
  const r = await GET(c.M, `/api/owner/staff?rid=${PP}`);
  const rids = r.j.restaurants?.map((x) => x.id) || [];
  return !!(r.status === 200 && rids.length === 1 && rids[0] === PP) || `${r.status} ${JSON.stringify(rids)}`;
});
row(S("…and a pin naming a restaurant they do NOT own cannot widen the set"), "GET as diago1 with ?rid=<Pizza Palace>", async (c) => {
  const r = await GET(c.O, `/api/owner/staff?rid=${PP}`);
  const rids = r.j.restaurants?.map((x) => x.id) || [];
  return !!(r.status === 200 && !rids.includes(PP)) || `${r.status} it listed ${JSON.stringify(rids)}`;
});
row(S("…and `?scope=all` keeps a multi-restaurant owner's full set"), "GET as diagmulti with ?scope=all", async (c) => {
  const r = await GET(c.M, "/api/owner/staff?scope=all");
  return !!(r.status === 200 && (r.j.restaurants || []).length >= 2) || `${r.status} n=${r.j?.restaurants?.length}`;
});
row(S("the ADMIN with no pin sees every restaurant"), "GET as the admin", async (c) => {
  const r = await GET(c.A, "/api/owner/staff");
  return !!(r.status === 200 && r.j.actor === "admin" && (r.j.restaurants || []).length > 2) || `${r.status} actor=${r.j?.actor} n=${r.j?.restaurants?.length}`;
});
row(S("…and the admin pinned to ONE restaurant sees that owner's set, not the platform"), "GET as the admin with ?scope=<French House>", async (c) => {
  const all = await GET(c.A, "/api/owner/staff");
  const r = await GET(c.A, `/api/owner/staff?scope=${FH}`);
  return !!(r.status === 200 && (r.j.restaurants || []).length < (all.j.restaurants || []).length) || `pinned ${r.j?.restaurants?.length} vs all ${all.j?.restaurants?.length}`;
});
row(S("a MANAGER reaches it, and sees only their own restaurant"), "GET as diagm1", async (c) => {
  const r = await GET(c.G, "/api/owner/staff");
  if (r.status === 403) return `SKIP: the Users section is switched off for this manager — ${r.j?.error}`;
  return !!(r.status === 200 && (r.j.restaurants || []).length === 1) || `${r.status} n=${r.j?.restaurants?.length}`;
});
row(S("a KITCHEN login is refused — it is not an owner, a manager or the admin"), "GET as diagkitchen", async (c) => {
  const r = await GET(c.K, "/api/owner/staff");
  return !!(r.status === 401 || r.status === 403) || `${r.status} ${JSON.stringify(r.j).slice(0, 90)}`;
});
row(S("nobody at all is refused, and told to log in"), "GET with no cookie of any kind", async (c) => {
  const r = await GET(c.N, "/api/owner/staff");
  return !!(r.status === 401 && /log in/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…and that refusal is a plain sentence, never a database message"), "the same call, reading the body", async (c) => {
  const r = await GET(c.N, "/api/owner/staff");
  return !/PGRST|invalid input|relation |syntax/i.test(JSON.stringify(r.j)) || JSON.stringify(r.j).slice(0, 120);
});

// ══ A2 · THE HIERARCHY, WHICH IS THE POINT OF THE WHOLE FILE ════════════════════════════════════
row(S("a manager's roster contains NO managers — never a peer, never an owner"), "GET as diagm1, read staff[].role", async (c) => {
  const r = await GET(c.G, "/api/owner/staff");
  if (r.status !== 200) return `SKIP: manager cannot open it — ${r.status}`;
  const bad = (r.j.staff || []).filter((s) => s.role !== "kitchen" && s.role !== "tablet");
  return bad.length === 0 || `it listed ${JSON.stringify(bad.map((b) => b.role))}`;
});
row(S("an owner's roster DOES contain managers, because an owner manages them"), "GET as diago1", async (c) => {
  const r = await GET(c.O, "/api/owner/staff");
  const roles = new Set((r.j.staff || []).map((s) => s.role));
  return roles.has("manager") || `roles seen: ${JSON.stringify([...roles])}`;
});
row(S("no roster at any caller contains an OWNER account"), "GET at owner, multi and admin", async (c) => {
  for (const [n, ctx] of [["owner", c.O], ["multi", c.M], ["admin", c.A]]) {
    const r = await GET(ctx, "/api/owner/staff");
    if ((r.j.staff || []).some((s) => s.role === "owner")) return `${n}'s roster lists an owner account`;
  }
  return true;
});
row(S("a `?view=real` admin tab is answered AS the manager, not as the admin"), "GET as the admin with ?scope=FH&view=real", async (c) => {
  const r = await GET(c.A, `/api/owner/staff?scope=${FH}&view=real`);
  return !!(r.status === 200 && r.j.actor === "manager") || `${r.status} actor=${r.j?.actor}`;
});
row(S("…and that view is NARROWED like a manager's — no managers in the list"), "the same call, reading staff[].role", async (c) => {
  const r = await GET(c.A, `/api/owner/staff?scope=${FH}&view=real`);
  const bad = (r.j.staff || []).filter((s) => s.role === "manager" || s.role === "owner");
  return bad.length === 0 || `${bad.length} account(s) a manager may not see`;
});
row(S("…and to ONE restaurant, so an admin's sibling restaurants are not listed inside a manager view"), "the same call, reading restaurants[]", async (c) => {
  const r = await GET(c.A, `/api/owner/staff?scope=${FH}&view=real`);
  return !!((r.j.restaurants || []).length === 1) || `n=${r.j?.restaurants?.length}`;
});

// ══ A3 · WHAT TRAVELS, AND WHAT MUST NOT ════════════════════════════════════════════════════════
row(S("no password hash ever reaches the browser"), "GET at four callers, scan the whole payload", async (c) => {
  for (const [n, ctx] of [["owner", c.O], ["multi", c.M], ["admin", c.A]]) {
    const r = await GET(ctx, "/api/owner/staff");
    if (/password_hash|pin_hash|"salt"/.test(r.txt)) return `${n}'s roster carries a hash`;
  }
  return true;
});
row(S("…but whether a PIN exists is answered, as a plain boolean"), "GET as diago1, read hasPin", async (c) => {
  const r = await GET(c.O, "/api/owner/staff");
  return !!(r.j.staff || []).every((s) => typeof s.hasPin === "boolean") || "hasPin is not a boolean on every row";
});
row(S("a login the admin has binned is GONE from the roster"), "bin a test login, re-read, restore", async (c) => {
  const name = uniq();
  const mk = await POST(c.O, "/api/owner/staff", { name, role: "kitchen", restaurant_id: FH });
  if (mk.status !== 200) return `could not create a fixture: ${mk.status} ${mk.j?.error}`;
  owns("staff_users", mk.j.id); fx.binTarget = mk.j.id;
  const before = await GET(c.O, "/api/owner/staff");
  const seenBefore = (before.j.staff || []).some((s) => s.id === mk.j.id);
  await sb.from("staff_users").update({ deleted_at: new Date().toISOString() }).eq("id", mk.j.id);
  const after = await GET(c.O, "/api/owner/staff");
  const seenAfter = (after.j.staff || []).some((s) => s.id === mk.j.id);
  await sb.from("staff_users").update({ deleted_at: null }).eq("id", mk.j.id);
  return !!(seenBefore && !seenAfter) || `before=${seenBefore} after=${seenAfter}`;
});
row(S("every restaurant on the page says what this caller may do about pay"), "GET as diago1, read restaurants[].payAccess", async (c) => {
  const r = await GET(c.O, "/api/owner/staff");
  return !!(r.j.restaurants || []).every((x) => x.payAccess && typeof x.payAccess.canSeePay === "boolean")
    || "a restaurant came back with no payAccess";
});
row(S("…and which waiter powers the admin has switched on for it"), "the same call, read restaurants[].modules", async (c) => {
  const r = await GET(c.O, "/api/owner/staff");
  return !!(r.j.restaurants || []).every((x) => x.modules && "payroll" in x.modules) || "a restaurant came back with no modules";
});
row(S("…and its floor size, which the Add-a-waiter form draws its table picker from"), "the same call, read restaurants[].tableCount", async (c) => {
  const r = await GET(c.O, "/api/owner/staff");
  return !!(r.j.restaurants || []).every((x) => typeof x.tableCount === "number") || "a restaurant came back with no tableCount";
});
row(S("a healthy answer carries no `tableCountUnread` flag"), "the same call — the flag rides along only when true", async (c) => {
  const r = await GET(c.O, "/api/owner/staff");
  return !!(r.j.restaurants || []).every((x) => !("tableCountUnread" in x)) || "the unread flag is present on a healthy read";
});
row(S("a kitchen login is marked as having no profile, and that is deliberate"), "GET as diago1, read profileEligible on a kitchen row", async (c) => {
  const r = await GET(c.O, "/api/owner/staff");
  const k = (r.j.staff || []).find((s) => s.role === "kitchen");
  if (!k) return "SKIP: no kitchen login on this restaurant";
  return k.profileEligible === false || `profileEligible=${k.profileEligible} — the owner ruled three times that kitchen has no profile`;
});
row(S("…and carries no completeness score, because it has nothing to complete"), "the same row", async (c) => {
  const r = await GET(c.O, "/api/owner/staff");
  const k = (r.j.staff || []).find((s) => s.role === "kitchen");
  if (!k) return "SKIP: no kitchen login";
  return k.completeness === null || `completeness=${JSON.stringify(k.completeness)}`;
});
row(S("a manager or waiter DOES carry a completeness score, as two numbers"), "GET as diago1, read a manager row", async (c) => {
  const r = await GET(c.O, "/api/owner/staff");
  const p = (r.j.staff || []).find((s) => s.role === "manager" && s.profileEligible);
  if (!p) return "SKIP: no profile-eligible manager";
  return !!(p.completeness && typeof p.completeness.filled === "number" && typeof p.completeness.total === "number")
    || JSON.stringify(p.completeness);
});

// ══ A4 · ONE PERSON'S RECORD ════════════════════════════════════════════════════════════════════
row(S("opening one person answers their record"), "GET ?staff=<a manager's id> as diago1", async (c) => {
  const r0 = await GET(c.O, "/api/owner/staff");
  const p = (r0.j.staff || []).find((s) => s.role === "manager" && s.profileEligible);
  if (!p) return "SKIP: no profile-eligible manager";
  fx.person = p.id;
  const r = await GET(c.O, `/api/owner/staff?staff=${p.id}`);
  return !!(r.status === 200 && r.j.person && r.j.person.id === p.id) || `${r.status} ${JSON.stringify(r.j).slice(0, 110)}`;
});
row(S("…and it says what this restaurant gives their ROLE, so \"Default (On)\" can name the default"), "the same call, read tree", async (c) => {
  if (!fx.person) return "SKIP: no person resolved";
  const r = await GET(c.O, `/api/owner/staff?staff=${fx.person}`);
  return !!(r.j.tree && typeof r.j.tree === "object") || `tree=${JSON.stringify(r.j.tree)}`;
});
row(S("…with the restaurant's connection KEYS stripped out of it — nothing on a person's page shows them"), "the same call, read tree.creds", async (c) => {
  if (!fx.person) return "SKIP: no person resolved";
  const r = await GET(c.O, `/api/owner/staff?staff=${fx.person}`);
  if (!r.j.tree) return "SKIP: no tree on this answer";
  return JSON.stringify(r.j.tree.creds) === "{}" || `creds=${JSON.stringify(r.j.tree.creds).slice(0, 90)}`;
});
row(S("…and no masked key of any shape survives anywhere in that payload"), "the same call, scan for the mask pattern", async (c) => {
  if (!fx.person) return "SKIP: no person resolved";
  const r = await GET(c.O, `/api/owner/staff?staff=${fx.person}`);
  return !/••••\d{4}|\*{4}\d{4}/.test(r.txt) || "a masked credential is in the payload";
});
row(S("…and it says whether the pay card exists for this restaurant at all"), "the same call, read payrollOn", async (c) => {
  if (!fx.person) return "SKIP";
  const r = await GET(c.O, `/api/owner/staff?staff=${fx.person}`);
  return typeof r.j.payrollOn === "boolean" || `payrollOn=${JSON.stringify(r.j.payrollOn)}`;
});
row(S("…and their recent activity, scoped to that one person"), "the same call, read activity[].", async (c) => {
  if (!fx.person) return "SKIP";
  const r = await GET(c.O, `/api/owner/staff?staff=${fx.person}`);
  return Array.isArray(r.j.activity) || `activity=${typeof r.j.activity}`;
});
row(S("…and that activity never carries the admin's own actions or a raw fault"), "the same call, read activity[].panel/level", async (c) => {
  if (!fx.person) return "SKIP";
  const r = await GET(c.O, `/api/owner/staff?staff=${fx.person}`);
  const bad = (r.j.activity || []).filter((a) => a.panel === "admin" || a.panel === "db" || a.action === "ui_taps");
  return bad.length === 0 || `${bad.length} row(s) an owner may not see`;
});
row(S("a KITCHEN login answers \"no profile\", as an answer rather than a refusal"), "GET ?staff=<a kitchen id>", async (c) => {
  const r0 = await GET(c.O, "/api/owner/staff");
  const k = (r0.j.staff || []).find((s) => s.role === "kitchen");
  if (!k) return "SKIP: no kitchen login";
  const r = await GET(c.O, `/api/owner/staff?staff=${k.id}`);
  return !!(r.j.notEligible === true && /profile/i.test(r.j.error || "")) || `${r.status} ${JSON.stringify(r.j).slice(0, 110)}`;
});
row(S("a person who does not exist answers 404 with a sentence, never a 500"), "GET ?staff=<a well-formed id nothing owns>", async (c) => {
  const r = await GET(c.O, `/api/owner/staff?staff=11111111-2222-3333-4444-555555555555`);
  return !!(r.status === 404 && /isn't on your staff/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…and so does a malformed one, without the database's words"), "GET ?staff=not-a-uuid", async (c) => {
  const r = await GET(c.O, "/api/owner/staff?staff=not-a-uuid");
  return !!(r.status >= 400 && r.status < 500 && !/invalid input|uuid|PGRST/i.test(JSON.stringify(r.j))) || `${r.status} ${JSON.stringify(r.j).slice(0, 110)}`;
});
row(S("ANOTHER restaurant's person is \"not on your staff\" — the same sentence, so nothing is learned from the difference"), "GET as diago1 for a Pizza Palace person", async (c) => {
  const m = await GET(c.M, `/api/owner/staff?rid=${PP}`);
  const other = (m.j.staff || [])[0];
  if (!other) return "SKIP: no staff on Pizza Palace";
  const r = await GET(c.O, `/api/owner/staff?staff=${other.id}`);
  return !!(r.status === 404 && /isn't on your staff/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("a manager may not open a PEER's record, and is told why in their own words"), "GET ?staff=<a manager> as diagm1", async (c) => {
  const o = await GET(c.O, "/api/owner/staff");
  const mgr = (o.j.staff || []).find((s) => s.role === "manager");
  if (!mgr) return "SKIP: no manager to try";
  const r = await GET(c.G, `/api/owner/staff?staff=${mgr.id}`);
  return !!(r.status === 403 || r.status === 404) || `${r.status} ${JSON.stringify(r.j).slice(0, 110)}`;
});

// ══ A5 · CREATING A LOGIN ═══════════════════════════════════════════════════════════════════════
row(S("an owner can add a waiter, and the password is handed back exactly once"), "POST {role:tablet}", async (c) => {
  const name = uniq();
  // `tables` is REQUIRED here and that is correct: French House has waiter sections switched on, so
  // an empty pick is refused ("their tablet shows only the tables you give them"). My first version
  // sent none and read the refusal as a fault — it is the product being right.
  const r = await POST(c.O, "/api/owner/staff", { name, role: "tablet", restaurant_id: FH, tables: [1, 2] });
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  owns("staff_users", r.j.id); fx.waiter = r.j.id; fx.waiterName = r.j.name;
  const again = await GET(c.O, `/api/owner/staff?staff=${r.j.id}`);
  return !!(typeof r.j.password === "string" && r.j.password.length >= 6 && !/password/.test(JSON.stringify(again.j.person || {})))
    || `password on create=${typeof r.j.password}; on re-read the person carries one: ${/password/.test(JSON.stringify(again.j.person || {}))}`;
});
row(S("…and a waiter is created with tables assigned, never with none"), "read assigned_tables on the row just created", async (c) => {
  if (!fx.waiter) return "SKIP: no waiter created";
  const q = await sb.from("staff_users").select("assigned_tables").eq("id", fx.waiter).maybeSingle();
  const t = q.data?.assigned_tables;
  return !!(Array.isArray(t) && t.length > 0) || `assigned_tables=${JSON.stringify(t)}`;
});
row(S("an owner can add a manager"), "POST {role:manager}", async (c) => {
  const r = await POST(c.O, "/api/owner/staff", { name: uniq(), role: "manager", restaurant_id: FH });
  if (r.status === 200) { owns("staff_users", r.j.id); fx.mgr = r.j.id; }
  return r.status === 200 || `${r.status} ${r.j?.error}`;
});
row(S("an owner can add a kitchen login"), "POST {role:kitchen}", async (c) => {
  const r = await POST(c.O, "/api/owner/staff", { name: uniq(), role: "kitchen", restaurant_id: FH });
  if (r.status === 200) { owns("staff_users", r.j.id); fx.kit = r.j.id; }
  return r.status === 200 || `${r.status} ${r.j?.error}`;
});
row(S("an owner can NEVER mint another owner — only the admin assigns owners"), "POST {role:owner}", async (c) => {
  const r = await POST(c.O, "/api/owner/staff", { name: uniq(), role: "owner", restaurant_id: FH });
  if (r.status === 200) { owns("staff_users", r.j.id); return "it created an OWNER account"; }
  return !!(r.status === 400 || r.status === 403) || `${r.status} ${r.j?.error}`;
});
row(S("…nor any role the ladder does not name"), "POST {role:superuser}", async (c) => {
  const r = await POST(c.O, "/api/owner/staff", { name: uniq(), role: "superuser", restaurant_id: FH });
  if (r.status === 200) { owns("staff_users", r.j.id); return "it created a role nothing enforces"; }
  return r.status >= 400 || `${r.status}`;
});
row(S("a MANAGER may add a waiter or a cook, and never a peer"), "POST {role:manager} as diagm1", async (c) => {
  const r = await POST(c.G, "/api/owner/staff", { name: uniq(), role: "manager", restaurant_id: FH });
  if (r.status === 200) { owns("staff_users", r.j.id); return "a manager created another manager"; }
  return r.status >= 400 || `${r.status} ${r.j?.error}`;
});
row(S("a login cannot be added to a restaurant that is not yours"), "POST as diago1 with restaurant_id=<Pizza Palace>", async (c) => {
  const r = await POST(c.O, "/api/owner/staff", { name: uniq(), role: "kitchen", restaurant_id: PP });
  if (r.status === 200) { owns("staff_users", r.j.id); return "it created a login on another owner's restaurant"; }
  return !!(r.status === 403 && /isn't yours/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…nor to a restaurant that does not exist"), "POST with a well-formed id nothing owns", async (c) => {
  const r = await POST(c.O, "/api/owner/staff", { name: uniq(), role: "kitchen", restaurant_id: GHOST });
  if (r.status === 200) { owns("staff_users", r.j.id); return "it created a login on a restaurant that does not exist"; }
  return r.status >= 400 || `${r.status}`;
});
row(S("a name of one real character is refused — a login name needs two"), "POST {name:'a'}", async (c) => {
  const r = await POST(c.O, "/api/owner/staff", { name: "a", role: "kitchen", restaurant_id: FH });
  if (r.status === 200) { owns("staff_users", r.j.id); return "a one-character login name was accepted"; }
  return !!(r.status === 400 && /2 characters/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…and ONE EMOJI is one glyph, not two characters"), "POST {name:'🍕'}", async (c) => {
  const r = await POST(c.O, "/api/owner/staff", { name: "🍕", role: "kitchen", restaurant_id: FH });
  if (r.status === 200) { owns("staff_users", r.j.id); return "a single emoji passed as a two-character name"; }
  return r.status === 400 || `${r.status} ${r.j?.error}`;
});
row(S("…and a name of nothing but spaces is refused"), "POST {name:'   '}", async (c) => {
  const r = await POST(c.O, "/api/owner/staff", { name: "   ", role: "kitchen", restaurant_id: FH });
  if (r.status === 200) { owns("staff_users", r.j.id); return "a blank name was accepted"; }
  return r.status === 400 || `${r.status}`;
});
row(S("the same login name twice at ONE restaurant is refused, with a sentence a person can act on"), "POST the name that already exists", async (c) => {
  if (!fx.waiterName) return "SKIP: no fixture name";
  const r = await POST(c.O, "/api/owner/staff", { name: fx.waiterName, role: "kitchen", restaurant_id: FH });
  if (r.status === 200) { owns("staff_users", r.j.id); return "a duplicate login name was accepted"; }
  return !!(r.status === 409 && /taken/i.test(r.j?.error || "") && !/duplicate key|constraint/i.test(r.j?.error || ""))
    || `${r.status} ${r.j?.error}`;
});
row(S("…and the raw database wording for that clash never reaches the screen"), "the same call, reading the body", async (c) => {
  if (!fx.waiterName) return "SKIP";
  const r = await POST(c.O, "/api/owner/staff", { name: fx.waiterName, role: "kitchen", restaurant_id: FH });
  if (r.status === 200) owns("staff_users", r.j.id);
  return !/23505|duplicate key value|violates unique/i.test(JSON.stringify(r.j)) || JSON.stringify(r.j).slice(0, 120);
});
row(S("a password shorter than six characters is refused"), "POST {password:'12345'}", async (c) => {
  const r = await POST(c.O, "/api/owner/staff", { name: uniq(), role: "kitchen", restaurant_id: FH, password: "12345" });
  if (r.status === 200) { owns("staff_users", r.j.id); return "a five-character password was accepted"; }
  return !!(r.status === 400 && /6 characters/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…and one over 128 characters too, so nothing unbounded is hashed"), "POST a 200-character password", async (c) => {
  const r = await POST(c.O, "/api/owner/staff", { name: uniq(), role: "kitchen", restaurant_id: FH, password: "x".repeat(200) });
  if (r.status === 200) { owns("staff_users", r.j.id); return "a 200-character password was accepted"; }
  return r.status === 400 || `${r.status} ${r.j?.error}`;
});
row(S("a login is created with its restaurant on it, always"), "read restaurant_id on every row this block created", async (c) => {
  const made = [fx.waiter, fx.mgr, fx.kit].filter(Boolean);
  if (!made.length) return "SKIP: nothing was created";
  const q = await sb.from("staff_users").select("id, restaurant_id").in("id", made);
  const stray = (q.data || []).filter((x) => x.restaurant_id !== FH);
  return stray.length === 0 || `${stray.length} row(s) landed on the wrong restaurant`;
});
row(S("the same request sent twice with one action key creates ONE person, not two"), "POST twice with the same X-LFH-Action-Id", async (c) => {
  const name = uniq(); const key = `t28r2-${Math.random().toString(36).slice(2)}`;
  const h = { "X-LFH-Action-Id": key, "content-type": "application/json" };
  const a = await POST(c.O, "/api/owner/staff", { name, role: "kitchen", restaurant_id: FH }, { headers: h });
  const b = await POST(c.O, "/api/owner/staff", { name, role: "kitchen", restaurant_id: FH }, { headers: h });
  if (a.status === 200) owns("staff_users", a.j.id);
  if (b.status === 200 && b.j.id && b.j.id !== a.j?.id) owns("staff_users", b.j.id);
  const q = await sb.from("staff_users").select("id").eq("restaurant_id", FH).eq("username", name).is("deleted_at", null);
  return !!((q.data || []).length === 1) || `${(q.data || []).length} people called ${name}`;
});

// ══ A6 · THE ACCOUNT ACTIONS ════════════════════════════════════════════════════════════════════
row(S("switching a login off needs a real true/false, never a truthy string"), "PATCH {action:set_active, active:'false'}", async (c) => {
  if (!fx.kit) return "SKIP: no fixture";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.kit, action: "set_active", active: "false" });
  return !!(r.status === 400 && /true\/false|true or false/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…and the string 'false' did NOT leave the account enabled-by-accident"), "read active on that row", async (c) => {
  if (!fx.kit) return "SKIP";
  const q = await sb.from("staff_users").select("active").eq("id", fx.kit).maybeSingle();
  return q.data?.active === true || `active=${q.data?.active} — a refused call changed state`;
});
row(S("switching a login off works, and ends its sessions"), "PATCH set_active:false, read token_version", async (c) => {
  if (!fx.kit) return "SKIP";
  const before = (await sb.from("staff_users").select("token_version").eq("id", fx.kit).maybeSingle()).data?.token_version || 0;
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.kit, action: "set_active", active: false });
  const after = (await sb.from("staff_users").select("active, token_version").eq("id", fx.kit).maybeSingle()).data;
  return !!(r.status === 200 && after.active === false && (after.token_version || 0) > before)
    || `${r.status} active=${after?.active} token ${before}→${after?.token_version}`;
});
row(S("…and switching it back ON does not end anybody's session again"), "PATCH set_active:true, read token_version", async (c) => {
  if (!fx.kit) return "SKIP";
  const before = (await sb.from("staff_users").select("token_version").eq("id", fx.kit).maybeSingle()).data?.token_version || 0;
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.kit, action: "set_active", active: true });
  const after = (await sb.from("staff_users").select("active, token_version").eq("id", fx.kit).maybeSingle()).data;
  return !!(r.status === 200 && after.active === true && (after.token_version || 0) === before)
    || `${r.status} active=${after?.active} token ${before}→${after?.token_version}`;
});
row(S("resetting a password answers the new one, and really changes the stored hash"), "PATCH reset_password, compare hashes", async (c) => {
  if (!fx.kit) return "SKIP";
  const before = (await sb.from("staff_users").select("password_hash").eq("id", fx.kit).maybeSingle()).data?.password_hash;
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.kit, action: "reset_password" });
  const after = (await sb.from("staff_users").select("password_hash").eq("id", fx.kit).maybeSingle()).data?.password_hash;
  return !!(r.status === 200 && typeof r.j.password === "string" && after && after !== before)
    || `${r.status} password=${typeof r.j?.password} hashChanged=${after !== before}`;
});
row(S("…and it clears any lock, so somebody locked out can sign in with the new one"), "the same call, read failed_count/locked_until", async (c) => {
  if (!fx.kit) return "SKIP";
  await sb.from("staff_users").update({ failed_count: 4, locked_until: new Date(Date.now() + 6e5).toISOString() }).eq("id", fx.kit);
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.kit, action: "reset_password" });
  const q = (await sb.from("staff_users").select("failed_count, locked_until").eq("id", fx.kit).maybeSingle()).data;
  return !!(r.status === 200 && (q.failed_count || 0) === 0 && !q.locked_until) || `${r.status} ${JSON.stringify(q)}`;
});
row(S("…and it ends that person's sessions, because their password changed"), "read token_version across a reset", async (c) => {
  if (!fx.kit) return "SKIP";
  const before = (await sb.from("staff_users").select("token_version").eq("id", fx.kit).maybeSingle()).data?.token_version || 0;
  await PATCH(c.O, "/api/owner/staff", { id: fx.kit, action: "reset_password" });
  const after = (await sb.from("staff_users").select("token_version").eq("id", fx.kit).maybeSingle()).data?.token_version || 0;
  return after > before || `token_version stayed ${before}`;
});
row(S("a role can be changed within the ladder"), "PATCH set_role kitchen→tablet", async (c) => {
  if (!fx.kit) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.kit, action: "set_role", role: "tablet" });
  const q = (await sb.from("staff_users").select("role").eq("id", fx.kit).maybeSingle()).data;
  if (r.status === 200 && q.role === "tablet") { await PATCH(c.O, "/api/owner/staff", { id: fx.kit, action: "set_role", role: "kitchen" }); return true; }
  return `${r.status} role=${q?.role}`;
});
row(S("…but never UP to owner"), "PATCH set_role → owner", async (c) => {
  if (!fx.kit) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.kit, action: "set_role", role: "owner" });
  const q = (await sb.from("staff_users").select("role").eq("id", fx.kit).maybeSingle()).data;
  return !!(r.status >= 400 && q.role !== "owner") || `${r.status} role=${q?.role}`;
});
row(S("…and a MANAGER cannot promote anybody to manager"), "PATCH set_role → manager, as diagm1", async (c) => {
  if (!fx.kit) return "SKIP";
  const r = await PATCH(c.G, "/api/owner/staff", { id: fx.kit, action: "set_role", role: "manager" });
  const q = (await sb.from("staff_users").select("role").eq("id", fx.kit).maybeSingle()).data;
  return !!(r.status >= 400 && q.role !== "manager") || `${r.status} role=${q?.role}`;
});
row(S("a name and phone edit saves both"), "PATCH {action:edit}", async (c) => {
  if (!fx.kit) return "SKIP";
  const nm = uniq();
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.kit, action: "edit", name: nm, phone: "9876500000" });
  const q = (await sb.from("staff_users").select("name, username, phone").eq("id", fx.kit).maybeSingle()).data;
  return !!(r.status === 200 && q.name === nm && q.phone === "9876500000") || `${r.status} ${JSON.stringify(q)}`;
});
row(S("…and a rename that collides with a living login is refused"), "PATCH edit to the waiter's name", async (c) => {
  if (!fx.kit || !fx.waiterName) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.kit, action: "edit", name: fx.waiterName });
  return !!(r.status === 409 && /taken/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…and an edit that changes nothing says so rather than writing"), "PATCH {action:edit} with no fields", async (c) => {
  if (!fx.kit) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.kit, action: "edit" });
  return !!(r.status === 400 && /nothing to change/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("an unknown action is refused, not silently ignored"), "PATCH {action:make_me_admin}", async (c) => {
  if (!fx.kit) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.kit, action: "make_me_admin" });
  return !!(r.status === 400 && /unknown action/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("a PATCH with no id at all is refused"), "PATCH {action:set_active} with no id", async (c) => {
  const r = await PATCH(c.O, "/api/owner/staff", { action: "set_active", active: true });
  return r.status === 400 || `${r.status} ${r.j?.error}`;
});
row(S("a PATCH naming ANOTHER restaurant's person is refused"), "PATCH a Pizza Palace person as diago1", async (c) => {
  const m = await GET(c.M, `/api/owner/staff?rid=${PP}`);
  const other = (m.j.staff || []).find((s) => s.role !== "owner");
  if (!other) return "SKIP: no staff on Pizza Palace";
  const r = await PATCH(c.O, "/api/owner/staff", { id: other.id, action: "set_active", active: false });
  const q = (await sb.from("staff_users").select("active").eq("id", other.id).maybeSingle()).data;
  return !!(r.status >= 400 && q.active !== false) || `${r.status} active=${q?.active} — it touched another restaurant's person`;
});

// ══ A7 · PER-PERSON PERMISSIONS ═════════════════════════════════════════════════════════════════
row(S("a permission key the enforcer does not read is refused, by name"), "PATCH set_permissions {not_a_power:'on'}", async (c) => {
  if (!fx.waiter) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.waiter, action: "set_permissions", permissions: { not_a_power: "on" } });
  return !!(r.status === 400 && /isn't a permission/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…and a mode the row does not offer is refused, naming the ones it does"), "PATCH a floor cap to 'pin'", async (c) => {
  if (!fx.waiter) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.waiter, action: "set_permissions", permissions: { tablet_take_orders: "maybe" } });
  return !!(r.status === 400 && /can only be set to/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("a MANAGER may take a power away but never grant one"), "PATCH set_permissions 'on' as diagm1", async (c) => {
  if (!fx.waiter) return "SKIP";
  const r = await PATCH(c.G, "/api/owner/staff", { id: fx.waiter, action: "set_permissions", permissions: { tablet_take_orders: "on" } });
  return !!(r.status === 403 && /only the owner/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…and 'off' from a manager is allowed, because reducing is theirs to do"), "PATCH set_permissions 'off' as diagm1", async (c) => {
  if (!fx.waiter) return "SKIP";
  const r = await PATCH(c.G, "/api/owner/staff", { id: fx.waiter, action: "set_permissions", permissions: { tablet_take_orders: "off" } });
  if (r.status === 200) { await PATCH(c.O, "/api/owner/staff", { id: fx.waiter, action: "set_permissions", permissions: { tablet_take_orders: null } }); return true; }
  return `${r.status} ${r.j?.error}`;
});
row(S("a waiter cap cannot be granted on a restaurant the admin has not switched that module on for"), "PATCH a module-gated cap", async (c) => {
  if (!fx.waiter) return "SKIP";
  const r0 = await GET(c.O, "/api/owner/staff");
  const mods = (r0.j.restaurants || []).find((x) => x.id === FH)?.modules || {};
  const off = ["banquet", "table_tags", "table_ops"].find((k) => mods[k] !== true);
  if (!off) return "SKIP: every gated module is switched on for this restaurant";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.waiter, action: "set_permissions", permissions: { [`tablet_${off}`]: "on" } });
  return !!(r.status === 403 && /isn't enabled|can't grant/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("a waiter cap cannot be given to a MANAGER account"), "PATCH tablet_* on a manager", async (c) => {
  if (!fx.mgr) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.mgr, action: "set_permissions", permissions: { tablet_take_orders: "on" } });
  // The shipped sentence names the ROLE and the KEY — *"tablet_take_orders isn't a permission a
  // manager has"* — which is more useful than the "waiter accounts only" wording I first asserted.
  return !!(r.status === 400 && /isn't a permission a manager has|waiter/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("setting a permission back to default REMOVES the key rather than storing a word"), "PATCH 'off' then null, read the stored object", async (c) => {
  if (!fx.waiter) return "SKIP";
  await PATCH(c.O, "/api/owner/staff", { id: fx.waiter, action: "set_permissions", permissions: { tablet_take_orders: "off" } });
  const mid = (await sb.from("staff_users").select("permissions").eq("id", fx.waiter).maybeSingle()).data?.permissions || {};
  await PATCH(c.O, "/api/owner/staff", { id: fx.waiter, action: "set_permissions", permissions: { tablet_take_orders: null } });
  const end = (await sb.from("staff_users").select("permissions").eq("id", fx.waiter).maybeSingle()).data?.permissions || {};
  return !!("tablet_take_orders" in mid && !("tablet_take_orders" in end)) || `mid=${JSON.stringify(mid)} end=${JSON.stringify(end)}`;
});
row(S("an empty permissions change says so rather than writing"), "PATCH set_permissions {}", async (c) => {
  if (!fx.waiter) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.waiter, action: "set_permissions", permissions: {} });
  return !!(r.status === 400 && /nothing to change/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("permissions must be an object — a list or a string is refused"), "PATCH set_permissions ['on']", async (c) => {
  if (!fx.waiter) return "SKIP";
  for (const v of [["on"], "on", 7]) {
    const r = await PATCH(c.O, "/api/owner/staff", { id: fx.waiter, action: "set_permissions", permissions: v });
    if (r.status < 400) return `${JSON.stringify(v)} was accepted (${r.status})`;
  }
  return true;
});

// ══ A8 · THE PAY LIST AND THE MONEY LEDGER ══════════════════════════════════════════════════════
row(S("nobody can be paid until the owner puts them on the pay list"), "POST record_payment for someone not enrolled", async (c) => {
  if (!fx.mgr) return "SKIP";
  const r = await POST(c.O, "/api/owner/staff", { action: "record_payment", staff_id: fx.mgr, kind: "salary", amount: 100, mode: "cash", paid_on: new Date().toISOString().slice(0, 10) });
  if (r.status === 200) { owns("staff_payments", r.j.payment?.id); return "a payment was recorded for somebody not on the pay list"; }
  if (r.status === 403) return "SKIP: pay is not this caller's to record here";
  return !!(r.status === 409 && /pay list/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("a pay RATE cannot be set for somebody not on the pay list either"), "PATCH set_job {pay_amount} before enrolling", async (c) => {
  if (!fx.mgr) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.mgr, action: "set_job", pay_type: "monthly", pay_amount: 20000 });
  if (r.status === 403) return "SKIP: job & pay is not this caller's to set";
  return !!(r.status === 409 && /pay list/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…but ordinary job facts stay editable either way"), "PATCH set_job {designation} before enrolling", async (c) => {
  if (!fx.mgr) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.mgr, action: "set_job", designation: "Floor lead" });
  if (r.status === 403) return "SKIP: job & pay is not this caller's to set";
  const q = (await sb.from("staff_users").select("designation").eq("id", fx.mgr).maybeSingle()).data;
  return !!(r.status === 200 && q.designation === "Floor lead") || `${r.status} ${JSON.stringify(q)} ${r.j?.error}`;
});
row(S("putting somebody on the pay list records WHO did it and when"), "PATCH set_payroll:true, read payroll_added_by", async (c) => {
  if (!fx.mgr) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.mgr, action: "set_payroll", in_payroll: true });
  if (r.status === 403) return "SKIP: not this caller's to change";
  const q = (await sb.from("staff_users").select("in_payroll, payroll_added_at, payroll_added_by").eq("id", fx.mgr).maybeSingle()).data;
  fx.enrolled = q?.in_payroll === true;
  return !!(r.status === 200 && q.in_payroll === true && q.payroll_added_by && q.payroll_added_at)
    || `${r.status} ${JSON.stringify(q)}`;
});
row(S("…and that name is a PERSON, never a uuid"), "read payroll_added_by", async (c) => {
  if (!fx.enrolled) return "SKIP: not enrolled";
  const q = (await sb.from("staff_users").select("payroll_added_by").eq("id", fx.mgr).maybeSingle()).data;
  return !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(q?.payroll_added_by || "")) || `payroll_added_by=${q?.payroll_added_by}`;
});
row(S("enrolling twice is answered as already-done, not as a second write"), "PATCH set_payroll:true again", async (c) => {
  if (!fx.enrolled) return "SKIP";
  const before = (await sb.from("staff_users").select("payroll_added_at").eq("id", fx.mgr).maybeSingle()).data?.payroll_added_at;
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.mgr, action: "set_payroll", in_payroll: true });
  const after = (await sb.from("staff_users").select("payroll_added_at").eq("id", fx.mgr).maybeSingle()).data?.payroll_added_at;
  return !!(r.status === 200 && before === after) || `${r.status} stamp ${before} → ${after}`;
});
row(S("`in_payroll` must be a real boolean"), "PATCH set_payroll with the string 'true'", async (c) => {
  if (!fx.mgr) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.mgr, action: "set_payroll", in_payroll: "true" });
  return r.status === 400 || `${r.status} ${r.j?.error}`;
});
row(S("a recorded payment stores WHO recorded it, from the session and never the body"), "POST record_payment with a lying recorded_by", async (c) => {
  if (!fx.enrolled) return "SKIP: not enrolled";
  const r = await POST(c.O, "/api/owner/staff", { action: "record_payment", staff_id: fx.mgr, kind: "salary", amount: 111, mode: "cash", paid_on: new Date().toISOString().slice(0, 10), recorded_by: "SOMEBODY ELSE" });
  if (r.status !== 200) return `SKIP: could not record — ${r.status} ${r.j?.error}`;
  owns("staff_payments", r.j.payment.id); fx.payment = r.j.payment.id;
  const q = (await sb.from("staff_payments").select("recorded_by, recorded_by_id, amount").eq("id", r.j.payment.id).maybeSingle()).data;
  return !!(q.recorded_by !== "SOMEBODY ELSE" && Number(q.amount) === 111) || `recorded_by=${q?.recorded_by} amount=${q?.amount}`;
});
row(S("…and a negative amount is refused, so the ledger cannot be reduced by adding to it"), "POST record_payment {amount:-500}", async (c) => {
  if (!fx.enrolled) return "SKIP";
  const r = await POST(c.O, "/api/owner/staff", { action: "record_payment", staff_id: fx.mgr, kind: "salary", amount: -500, mode: "cash", paid_on: new Date().toISOString().slice(0, 10) });
  if (r.status === 200) { owns("staff_payments", r.j.payment?.id); return "a negative payment was accepted"; }
  return r.status >= 400 || `${r.status}`;
});
row(S("…and an amount that is not a number at all"), "POST record_payment {amount:'lots'}", async (c) => {
  if (!fx.enrolled) return "SKIP";
  const r = await POST(c.O, "/api/owner/staff", { action: "record_payment", staff_id: fx.mgr, kind: "salary", amount: "lots", mode: "cash", paid_on: new Date().toISOString().slice(0, 10) });
  if (r.status === 200) { owns("staff_payments", r.j.payment?.id); return "a non-numeric payment was accepted"; }
  return r.status >= 400 || `${r.status}`;
});
row(S("a payment entry can be CANCELLED but never deleted — the row stays, struck through"), "PATCH void_payment, read the row", async (c) => {
  if (!fx.payment) return "SKIP: no payment recorded";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.mgr, action: "void_payment", staff_id: fx.mgr, payment_id: fx.payment, reason: "t28 round-2 check" });
  const q = (await sb.from("staff_payments").select("id, voided_at, void_reason, voided_by, amount").eq("id", fx.payment).maybeSingle()).data;
  return !!(r.status === 200 && q && q.voided_at && q.void_reason && Number(q.amount) === 111)
    || `${r.status} ${JSON.stringify(q)} ${r.j?.error}`;
});
row(S("…and cancelling needs a REASON, because an entry voided with no explanation is the hole this ledger exists not to have"), "PATCH void_payment with no reason", async (c) => {
  if (!fx.enrolled) return "SKIP";
  const mk = await POST(c.O, "/api/owner/staff", { action: "record_payment", staff_id: fx.mgr, kind: "bonus", amount: 50, mode: "cash", paid_on: new Date().toISOString().slice(0, 10) });
  if (mk.status !== 200) return "SKIP: could not record a second entry";
  owns("staff_payments", mk.j.payment.id); fx.payment2 = mk.j.payment.id;
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.mgr, action: "void_payment", staff_id: fx.mgr, payment_id: mk.j.payment.id, reason: "" });
  return !!(r.status === 400 && /why/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…and a two-letter reason is not a reason"), "PATCH void_payment with reason 'ok'", async (c) => {
  if (!fx.payment2) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.mgr, action: "void_payment", staff_id: fx.mgr, payment_id: fx.payment2, reason: "ok" });
  return r.status === 400 || `${r.status} ${r.j?.error}`;
});
row(S("cancelling the same entry twice is refused, so the ledger cannot count it out twice"), "PATCH void_payment on the already-voided one", async (c) => {
  if (!fx.payment) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.mgr, action: "void_payment", staff_id: fx.mgr, payment_id: fx.payment, reason: "t28 second attempt" });
  return !!(r.status === 400 && /already cancelled/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("an entry that does not exist answers 404, not a 500"), "PATCH void_payment with a bogus payment id", async (c) => {
  if (!fx.mgr) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.mgr, action: "void_payment", staff_id: fx.mgr, payment_id: "11111111-2222-3333-4444-555555555555", reason: "t28 check" });
  return !!(r.status === 404 || r.status === 400) || `${r.status} ${r.j?.error}`;
});
row(S("taking somebody OFF the pay list keeps every entry they were ever paid"), "PATCH set_payroll:false, count their entries", async (c) => {
  if (!fx.enrolled) return "SKIP";
  const before = (await sb.from("staff_payments").select("id", { count: "exact", head: true }).eq("staff_id", fx.mgr)).count ?? 0;
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.mgr, action: "set_payroll", in_payroll: false });
  const after = (await sb.from("staff_payments").select("id", { count: "exact", head: true }).eq("staff_id", fx.mgr)).count ?? 0;
  return !!(r.status === 200 && after === before) || `${r.status} entries ${before} → ${after}`;
});
row(S("a person with pay history is NEVER deleted, and the refusal says how many entries"), "DELETE that person", async (c) => {
  if (!fx.mgr) return "SKIP";
  const paid = (await sb.from("staff_payments").select("id", { count: "exact", head: true }).eq("staff_id", fx.mgr)).count ?? 0;
  if (!paid) return "SKIP: no pay history on the fixture";
  const r = await DEL(c.O, `/api/owner/staff?id=${fx.mgr}`);
  const still = (await sb.from("staff_users").select("id").eq("id", fx.mgr).maybeSingle()).data;
  return !!(r.status === 409 && !!still && /\d/.test(r.j?.error || "")) || `${r.status} stillThere=${!!still} ${r.j?.error}`;
});
row(S("a MANAGER can never delete a login — they can switch it off"), "DELETE as diagm1", async (c) => {
  if (!fx.kit) return "SKIP";
  const r = await DEL(c.G, `/api/owner/staff?id=${fx.kit}`);
  const still = (await sb.from("staff_users").select("id").eq("id", fx.kit).maybeSingle()).data;
  return !!(r.status === 403 && !!still && /disable/i.test(r.j?.error || "")) || `${r.status} stillThere=${!!still} ${r.j?.error}`;
});
row(S("a DELETE with no id is refused"), "DELETE with no query at all", async (c) => {
  const r = await DEL(c.O, "/api/owner/staff");
  return r.status === 400 || `${r.status} ${r.j?.error}`;
});
row(S("a login with NO pay history can be removed, and really goes"), "DELETE the clean fixture", async (c) => {
  const name = uniq();
  const mk = await POST(c.O, "/api/owner/staff", { name, role: "kitchen", restaurant_id: FH });
  if (mk.status !== 200) return `SKIP: could not create — ${mk.status}`;
  const r = await DEL(c.O, `/api/owner/staff?id=${mk.j.id}`);
  const still = (await sb.from("staff_users").select("id").eq("id", mk.j.id).maybeSingle()).data;
  if (still) owns("staff_users", mk.j.id);
  return !!(r.status === 200 && !still) || `${r.status} stillThere=${!!still}`;
});

// ══ A9 · NO SILENT OVERWRITES ═══════════════════════════════════════════════════════════════════
row(S("two people editing one person's details — the second is TOLD, not silently overwritten"), "PATCH edit twice with a stale X-LFH-Expect", async (c) => {
  if (!fx.waiter) return "SKIP";
  const cur = (await sb.from("staff_users").select("phone").eq("id", fx.waiter).maybeSingle()).data;
  const expect = { expect: { table: "staff_users", id: fx.waiter, fields: { phone: "0000000000" } } };
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.waiter, action: "edit", phone: "9990001111", ...expect },
    { headers: { "content-type": "application/json", "X-LFH-Expect": JSON.stringify(expect.expect) } });
  if (r.status === 409) return true;
  const now = (await sb.from("staff_users").select("phone").eq("id", fx.waiter).maybeSingle()).data;
  return `expected a 409 for a stale expectation; got ${r.status}, phone ${cur?.phone} → ${now?.phone}`;
});
row(S("…and a caller that sends NO expectation is unaffected, so nothing that never opted in breaks"), "PATCH edit with no header", async (c) => {
  if (!fx.waiter) return "SKIP";
  const r = await PATCH(c.O, "/api/owner/staff", { id: fx.waiter, action: "edit", phone: "9990002222" });
  const q = (await sb.from("staff_users").select("phone").eq("id", fx.waiter).maybeSingle()).data;
  return !!(r.status === 200 && q.phone === "9990002222") || `${r.status} phone=${q?.phone}`;
});
row(S("a body that is not JSON at all is answered calmly, never a 500"), "PATCH with raw bytes", async (c) => {
  const r = await PATCH(c.O, "/api/owner/staff", undefined, { data: Buffer.from("{not json", "utf8"), headers: { "content-type": "application/json" } });
  return !!(r.status >= 400 && r.status < 500) || `${r.status} ${r.txt.slice(0, 90)}`;
});
row(S("…and so is a completely empty body"), "PATCH with nothing", async (c) => {
  const r = await PATCH(c.O, "/api/owner/staff", undefined, { data: Buffer.from("", "utf8"), headers: { "content-type": "application/json" } });
  return !!(r.status >= 400 && r.status < 500) || `${r.status} ${r.txt.slice(0, 90)}`;
});
row(S("every write this route makes leaves a line in the Activity log"), "count staff_actions for the fixtures this block wrote", async (c) => {
  const q = await sb.from("staff_actions").select("id, action, actor, panel")
    .eq("restaurant_id", FH).in("action", ["staff_create", "staff_enable", "staff_disable", "staff_reset_password", "staff_set_role", "staff_set_permissions", "staff_payment", "staff_payment_void", "payroll_add", "payroll_remove", "staff_rename", "staff_job_edit", "staff_delete"])
    .gte("created_at", new Date(Date.now() - 20 * 60_000).toISOString()).limit(200);
  if (q.error) return `could not read the log: ${q.error.message}`;
  for (const x of (q.data || [])) owns("staff_actions", x.id);
  return !!((q.data || []).length >= 8) || `only ${(q.data || []).length} log rows for this block's writes`;
});
row(S("…and every one of those lines names a panel, never an empty one"), "the rows just counted", async (c) => {
  const q = await sb.from("staff_actions").select("id, panel, action")
    .eq("restaurant_id", FH).in("action", ["staff_create", "staff_disable", "staff_reset_password", "payroll_add", "staff_payment"])
    .gte("created_at", new Date(Date.now() - 20 * 60_000).toISOString()).limit(60);
  const bad = (q.data || []).filter((x) => !x.panel);
  return bad.length === 0 || `${bad.length} log row(s) with no panel`;
});
row(S("…and an OWNER's write is recorded against the owner panel, not the admin's"), "read panel on this block's own rows", async (c) => {
  const q = await sb.from("staff_actions").select("panel, action")
    .eq("restaurant_id", FH).eq("action", "staff_create")
    .gte("created_at", new Date(Date.now() - 20 * 60_000).toISOString()).limit(20);
  const rows = q.data || [];
  if (!rows.length) return "SKIP: no staff_create rows from this run";
  return rows.every((x) => x.panel === "owner") || `panels seen: ${JSON.stringify([...new Set(rows.map((x) => x.panel))])}`;
});

// ══ A10 · MONEY ON THE ROSTER, AND JUDGMENT ═════════════════════════════════════════════════════
row(S("a caller who may see pay gets figures; the payload never carries a rate they may not see"), "GET as diago1 and as diagm1, compare the pay keys", async (c) => {
  const o = await GET(c.O, "/api/owner/staff");
  const g = await GET(c.G, "/api/owner/staff");
  if (g.status !== 200) return "SKIP: the manager cannot open the roster";
  const mgrSeesPay = (g.j.restaurants || [])[0]?.payAccess?.canSeePay;
  const anyRate = (g.j.staff || []).some((s) => "pay_amount" in s);
  if (mgrSeesPay) return anyRate || "the manager may see pay but no row carries a rate";
  return !anyRate || "a rate travelled to a caller who may not see pay";
});
row(S("…and a row stripped of pay says so, rather than quietly missing a field"), "GET as the caller without pay rights", async (c) => {
  const g = await GET(c.G, "/api/owner/staff");
  if (g.status !== 200) return "SKIP";
  const acc = (g.j.restaurants || [])[0]?.payAccess;
  if (acc?.canSeePay) return "SKIP: this manager may see pay";
  return !!(g.j.staff || []).every((s) => s.payHidden === true) || "a stripped row carries no payHidden flag";
});
row(S("a healthy roster carries no `payUnread` flag — it rides along only when a read failed"), "GET as diago1", async (c) => {
  const r = await GET(c.O, "/api/owner/staff");
  return !(r.j.staff || []).some((s) => s.payUnread) || "payUnread is set on a healthy read";
});
row(S("…and when it is absent, the figures really are there rather than being zero-by-default"), "GET as diago1, read paidThisMonth", async (c) => {
  const r = await GET(c.O, "/api/owner/staff");
  const acc = (r.j.restaurants || []).find((x) => x.id === FH)?.payAccess;
  if (!acc?.canSeePay) return "SKIP: this caller may not see pay";
  const rows = (r.j.staff || []).filter((s) => s.restaurant_id === FH && !s.payHidden);
  return rows.every((s) => typeof s.paidThisMonth === "number") || "a visible row carries no paidThisMonth";
});
row(S("opening one person does not re-count the whole roster's money"), "GET ?staff=<id> and check no roster keys come back", async (c) => {
  if (!fx.person) return "SKIP";
  const r = await GET(c.O, `/api/owner/staff?staff=${fx.person}`);
  return !Array.isArray(r.j.staff) || "the detail answer carries the whole roster too";
});
row(S("the roster is bounded, so one enormous restaurant cannot be an unbounded read"), "read the shipped limit", async () => {
  const src = code(read("app/api/owner/staff/route.ts"));
  const rosterQ = src.slice(src.indexOf('from("staff_users")'));
  return /\.limit\(\d+\)/.test(rosterQ.slice(0, 700)) || "the roster read has no ceiling";
});
row(S("a person's payment history is bounded too"), "read the shipped limit on the payments read", async () => {
  const src = code(read("app/api/owner/staff/route.ts"));
  const pay = src.slice(src.indexOf('from("staff_payments")'));
  return /\.limit\(\d+\)/.test(pay.slice(0, 500)) || "the payment history read has no ceiling";
});
row(S("every read that decides a REFUSAL answers for itself, so a blip never reads as \"not yours\""), "read: the account reads go through rd() and answer transient()", async () => {
  const src = code(read("app/api/owner/staff/route.ts"));
  const reads = [...src.matchAll(/rd\("(target|account|person)"/g)].map((m) => m[1]);
  return !!(new Set(reads).size >= 3) || `only ${JSON.stringify(reads)} go through the read guard`;
});
row(S("…and the payroll gate refuses on doubt rather than guessing a feature is off"), "read: payrollByRid answers null on error and every caller refuses", async () => {
  const src = code(read("app/api/owner/staff/route.ts"));
  const fn = src.slice(src.indexOf("async function payrollByRid"), src.indexOf("const withoutPay"));
  const callers = (src.match(/if \(!payMap\) return|if \(!payrollOn\) return/g) || []).length;
  return !!(/return null;/.test(fn) && callers >= 3) || `errorReturnsNull=${/return null;/.test(fn)} callers refusing=${callers}`;
});
row(S("is this how a real restaurant needs it? a waiter added mid-shift can take an order the same minute"), "create a waiter and read back its tables + caps", async (c) => {
  const name = uniq();
  const mk = await POST(c.O, "/api/owner/staff", { name, role: "tablet", restaurant_id: FH, tables: [3] });
  if (mk.status !== 200) return `SKIP: could not create — ${mk.status} ${mk.j?.error}`;
  owns("staff_users", mk.j.id);
  const q = (await sb.from("staff_users").select("assigned_tables, active, permissions").eq("id", mk.j.id).maybeSingle()).data;
  return !!(q.active === true && Array.isArray(q.assigned_tables) && q.assigned_tables.length > 0)
    || `active=${q?.active} tables=${JSON.stringify(q?.assigned_tables)}`;
});
