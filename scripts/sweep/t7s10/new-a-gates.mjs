// BLOCK A · from P176001 — DOES EVERY REQUEST IN MY THIRD NEED THE RIGHT LOGIN, AND STAY IN ITS OWN
// RESTAURANT? Read from the code only (S10-RULES §7: never by trying it). For every one of the server
// calls my third makes, the call is found, the editor route's handler for it is found, and the
// handler is shown to sit behind gate() (a signed-in manager, or the admin) and editorScope() (the
// restaurant taken from the SESSION, never from the request). Then the permission-scoped controls
// my third hides are each shown to be re-checked by the server — hiding is never the only guard.
import { check, MINE, MINE_CODE, MY_START_AT, lineAt, rd, APP } from "./lib.mjs";

const F = "`public/panels/editor/app.js`";
const ROUTE = rd("app/api/editor/[...path]/route.ts");
const PANELSCOPE = rd("lib/panelScope.ts");
let n = 176001;
const id = () => "P" + n++;
const C = (what, how, fn) => check(id(), `${F} — ${what}`, `SRC: ${how}`, fn);

// The four method bodies of the editor route, and the first lines each runs.
const IMPL = {
  GET: ROUTE.slice(ROUTE.indexOf("export async function GET("), ROUTE.indexOf("function invalidateFloorAfter(")),
  POST: ROUTE.slice(ROUTE.indexOf("async function postImpl("), ROUTE.indexOf("export const PATCH")),
  PATCH: ROUTE.slice(ROUTE.indexOf("async function patchImpl("), ROUTE.indexOf("export const DELETE")),
  DELETE: ROUTE.slice(ROUTE.indexOf("async function deleteImpl(")),
};
const gated = (m) => { const head = IMPL[m].slice(0, 2500); return /const g = await gate\(req\); if \(g instanceof NextResponse\) return g;/.test(head) && /const rid = await editorScope\(req, g\);\s*\n\s*if \(rid instanceof NextResponse\) return rid;/.test(head); };

// Every api() call in my third, with its method, its path expression and its line.
const calls = [...MINE.matchAll(/\bapi\(\s*"(GET|POST|PATCH|DELETE)"\s*,\s*([^,)]+(?:\([^)]*\))?[^,)]*)/g)]
  .map((m) => ({ method: m[1], path: m[2].trim(), line: lineAt(MY_START_AT + m.index) }));
// The literal segments a path expression names: "/sessions/" + id + "/close" → ["sessions", "close"].
const segs = (p) => [...p.matchAll(/["`/]([a-z][a-z-]*)/g)].map((m) => m[1]).filter((s) => !["api", "editor"].includes(s));
// Where the route answers it: a branch naming the first segment (and, when the call has one, the
// action segment after the id) inside the matching method's body.
function branchFor(method, path) {
  const s = segs(path);
  if (path.startsWith('"/" + kind') || path.startsWith('"/" + state.tab')) {
    // the menu editor's own writes: POST /items|/categories|/filters|/settings, DELETE /<kind>/<key>
    return method === "POST" ? /TABLES\[|const ENTITY|ENTITIES\[|tables\[a\]|TABLE_OF\[|kindTable/.test(IMPL.POST) || /\bitems: \{ name: "menu_items"/.test(ROUTE) : /deleteImpl[\s\S]*?(TABLES|ENTITIES|tables)\[/.test(ROUTE) || /items: \{ name: "menu_items"/.test(ROUTE);
  }
  const body = IMPL[method];
  if (!s.length) return false;
  const first = s[0], last = s.length > 1 ? s[s.length - 1] : null;
  if (method === "GET") return new RegExp(`p === "${first}"|p\\.startsWith\\("${first}|path\\[0\\] === "${first}"|a === "${first}"`).test(body) || /\?table=|"\/(sessions|orders|calls)" \+ q/.test(path);
  if (last && last !== first) return new RegExp(`a === "${first}"[^\\n]*(b|c) === "${last}"`).test(body);
  return new RegExp(`a === "${first}"|p === "${first}"`).test(body);
}

C("the editor route's GET handler signs the person in and pins their restaurant before its first read", "gate(req) then editorScope(req, g) open GET", () => gated("GET"));
C("…and POST does the same before its first write", "the opening lines of postImpl", () => gated("POST"));
C("…and PATCH", "the opening lines of patchImpl", () => gated("PATCH"));
C("…and DELETE", "the opening lines of deleteImpl", () => gated("DELETE"));
C("the gate admits a MANAGER (or the admin) only — gate() asks requireRole(req, \"manager\")", "read gate()", () => /async function gate\(req: NextRequest\)[\s\S]{0,120}requireRole\(req, "manager"\)/.test(ROUTE));
C("a database blip at sign-in answers 503 (stay signed in, retry), a bad cookie 401 — never a silent pass", "read gate()'s two refusals", () => /g\.transient[\s\S]{0,200}status: 503[\s\S]{0,200}status: 401/.test(ROUTE));
C("the restaurant a request acts on comes from the SESSION (panelRestaurantId), never from the body", "read editorScope()", () => /async function editorScope\([\s\S]{0,1600}panelRestaurantId|panelScope/.test(ROUTE));
C("the admin's 'view as' pin is honoured only through lib/panelScope, the one resolver", "lib/panelScope.ts exports panelRestaurantId", () => /export (async )?function panelRestaurantId/.test(PANELSCOPE));
C(`my third makes ${calls.length} server calls and every one goes through api() — the outbox, the deadline, the clash header`, "count api( calls; the only other is the photo upload", () => calls.length >= 35 && (MINE_CODE.match(/(?<![\w.$])fetch\(/g) || []).length === 1);
C("the one direct fetch (the dish photo) still carries the admin's restaurant pin through ridQ()", "read the upload line", () => /fetch\("\/api\/editor" \+ ridQ\("\/dish-photo"\)/.test(MINE));
C("no request body in my third names a restaurant — the server never takes one from the panel", "scan every api() body for restaurant_id / rid:", () => !calls.some((c) => { const i = MINE.indexOf(c.path); return /restaurant_id|\brid\s*:/.test(MINE.slice(i, i + 260).split("\n")[0]); }));
C("no key, token or service secret appears anywhere in my third", "scan for sbp_ / service_role / SUPABASE_ / secret", () => !/sbp_[a-z0-9]|service_role|SUPABASE_[A-Z_]*KEY|ADMIN_PASSWORD|Bearer [A-Za-z0-9]/.test(MINE));
C("my third never writes a key or a token to localStorage", "every localStorage.setItem key in my third", () => [...MINE.matchAll(/localStorage\.setItem\(([^,]+),/g)].every((m) => !/token|secret|key\b|password|session/i.test(m[1]) || /perRowKey|tableCountKey|SP_OPEN_KEY|floatKey|_tcKey|k\b/.test(m[1])));

// One row per call site: the route answers it, behind the gate above.
for (const c of calls) {
  C(`${c.method} ${c.path.slice(0, 60)} (app.js:${c.line}) has a handler in the editor route, behind the sign-in gate and the restaurant pin`,
    `find the ${c.method} branch for "${segs(c.path).join("/")}" in the route; its method opens with gate + editorScope`,
    () => gated(c.method) && branchFor(c.method, c.path));
}

// The controls my third HIDES by permission — each is re-checked by the server.
const hidden = [
  ["＋ Take order (tile, popup footer, QO/P)", /function takeOrdersAllowed\(\)/, /a === "order" && path\.length === 1[\s\S]{0,1800}managerCan\(g, rid, "take_orders"\)|take_orders/],
  ["🥡 Parcel", /parcelModuleOn/, /a === "parcel" && path\.length === 1[\s\S]{0,400}managerCan\(g, rid, "parcel"\)/],
  ["the Pay Later book behind 'Collect later'", /function khataOn\(\)/, /p === "khata"[\s\S]{0,200}managerCan\(g, rid, "khata"\)/],
  ["the table-type picker (🏷 Type ▾)", /function tagActionAllowed\(/, /table_tags|tableTag|tags_allowed/],
  ["the three Audit & logs views", /function logPartsAllowed\(\)/, /async function logPartAllowed\(/],
  ["the log-retention dropdown", /function retentionControl\(/, /function canSetRetention\(/],
  ["the floor's table operations (shift, merge, close)", /function tableOpsOn\(\)|tableOpsOn/, /async function tableOpsGate\(/],
  ["the menu editor's dish / category / tag writes", /function bindEditor\(\)/, /async function menuSubAllowed\(/],
  ["a dish photo upload", /dishPhotoFile/, /async function dishPhotoUpload\(/],
];
for (const [what, clientRe, serverRe] of hidden) {
  C(`${what}: hidden on the screen when not granted — and refused by the server on its own`, "the client gate exists in app.js; the server re-check exists in the route", () => clientRe.test(APP) && serverRe.test(ROUTE));
}
C("the table-close button asks the server, which refuses an unpaid table on its own", "read the sessions/:id/close branch", () => /a === "sessions" && c === "close"[\s\S]{0,1500}(unpaid|payment_status|still owes|not paid)/i.test(IMPL.POST));
C("an order's allergy edit is scoped to this restaurant's row in the update itself", "orders/:id/allergies reads .eq(\"restaurant_id\", rid)", () => /a === "orders" && c === "allergies"[\s\S]{0,600}\.eq\("restaurant_id", rid\)/.test(IMPL.POST));
C("a request answer only changes a still-pending row of THIS restaurant (first answer wins)", "requests/:id/resolve updates .eq(restaurant_id).eq(status, pending)", () => /a === "requests" && c === "resolve"[\s\S]{0,900}\.eq\("restaurant_id", rid\)\.eq\("status", "pending"\)/.test(IMPL.POST));
C("making someone head of a table is checked against this restaurant's session", "members/:id/make-head reads sessions .eq(restaurant_id)", () => /a === "members" && c === "make-head"[\s\S]{0,500}\.eq\("restaurant_id", rid\)/.test(IMPL.POST));
C("a dish's status change is scoped to this restaurant's order", "items/:id/status reads orders .eq(restaurant_id)", () => /a === "items" && c === "status"[\s\S]{0,700}\.eq\("restaurant_id", rid\)/.test(IMPL.POST));
C("a ticket cancel is refused once the ticket is on printed paper — by the SERVER (invoiceLockedByOrder), not just the hidden ✕", "the orders PATCH asks invoiceLockedByOrder", () => /patch\.status === "cancelled" && await invoiceLockedByOrder\(id, rid\)/.test(ROUTE));
C("…and a PAID ticket's cancel is refused by the server too (item 2 matches it on screen)", "the orders PATCH refuses a paid cancel", () => /patch\.status === "cancelled" && cur\.payment_status === "paid"/.test(ROUTE));
C("the Audit 'was the food made?' answer is re-checked on the server against the void-bills power (the power that cancels the ticket)", "audit/classify asks managerCan(void_bills) before the RPC", () => /a === "audit" && b === "classify"[\s\S]{0,200}managerCan\(g, rid, "void_bills"\)/.test(IMPL.POST));
C("the Audit list read is a TAB the restaurant can switch off for managers (tabGate 'log')", "TAB rule names p === \"audit\" for GET", () => /tab: "log", test: \(p, method\) => [^\n]*p === "audit"/.test(ROUTE));
C("the Z report read is restaurant-scoped on the server (every read .eq(restaurant_id, rid))", "the zreport branch's sb.from calls", () => { const i = ROUTE.indexOf('if (p === "zreport")'); const z = ROUTE.slice(i, i + 9000); const froms = (z.match(/sb\.from\("[a-z_]+"\)/g) || []).length; const scoped = (z.match(/\.eq\("restaurant_id", rid\)/g) || []).length; return froms > 0 && scoped >= froms - 1; });
C("the floor summary the stats strip reads is restaurant-scoped (the shared floor read takes rid)", "the summary branch", () => { const i = ROUTE.indexOf('if (p === "summary")'); return i > 0 && /\brid\b/.test(ROUTE.slice(i, i + 3000)); });
C("a guest ban removes only THIS restaurant's member (the blocklist write carries rid)", "the blocklist insert", () => /a === "blocklist"[\s\S]{0,1500}restaurant_id: rid/.test(IMPL.POST));
C("the waiter-call answer (PATCH /calls/:id) is scoped to this restaurant", "the calls PATCH", () => /a === "calls"[\s\S]{0,1200}\.eq\("restaurant_id", rid\)/.test(IMPL.PATCH));
C("R67 — nothing in my third tells a manager about a power they were NOT given (no 'ask your owner', no '🔒 set by' for a manager)", "scan my third's sentences; the owner's 🔒 line is behind higherView", () => !/ask your owner|you don't have (that|this) power|turned off for you|not allowed for you/i.test(MINE) && /if \(!\(typeof XRAY_WHO !== "undefined" && XRAY_WHO && XRAY_WHO\.higherView\)\)/.test(MINE));
C("the admin's no-password reach into this panel prints no hint of itself on a manager's screen", "the 'You did this from an admin panel' pill is in the activity log (T8's third), never in mine", () => !MINE.split("\n").filter((l) => !/^\s*\/\//.test(l)).some((l) => /admin console|from \/aevinite|Aevidine admin is viewing/i.test(l)));
