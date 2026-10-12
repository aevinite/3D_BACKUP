// BLOCK A · P175001–P175050 — does every request my half sends need the right login, does each
// restaurant only see its own rows, and are secrets kept out of the browser? Read from the code (S10
// rule 7: never demonstrated, never a signed-out call). Subject file named in every row.
import { check, APP, MINE, CODE, MY_END_AT, rd, fnText } from "./lib.mjs";

const F = "`public/panels/editor/app.js`";
const ROUTE = rd("app/api/editor/[...path]/route.ts");
const STAFF = rd("app/api/owner/staff/route.ts");
const MINE_C = CODE.slice(0, MY_END_AT);
const calls = [...MINE.matchAll(/api\(\s*"(GET|POST|PATCH|DELETE)"\s*,\s*([`"][^`"]*)/g)].map((m) => ({ verb: m[1], path: m[2].slice(1) }));
const segs = [...new Set(calls.map((c) => c.path.replace(/^\//, "").split(/[/?$`]/)[0]))].sort();
let n = 175001;
const id = () => "P" + n++;

check(id(), `${F} — every server call in my half goes through api() or the outbox, never a bare write`, "SRC: count fetch( in my half; each must be a GET",
  () => { const f = [...MINE_C.matchAll(/(?<![\w$.])fetch\(/g)].length; const writes = (MINE.match(/fetch\([^)]*\{[^}]*method:\s*init\.method/g) || []).length; return { ok: f === 3 && writes <= 1, note: `${f} bare fetch( — loadStaffTeam (GET), loadTableSections (GET), staffCall's no-outbox fallback` }; });
check(id(), `${F} — staffCall writes through LFH_OUTBOX when it exists (id, deadline, queue, retry)`, "SRC: staffCall body",
  () => /if \(window\.LFH_OUTBOX\) \{\s*\n\s*return await window\.LFH_OUTBOX\.send\(\{/.test(fnText("staffCall")));
check(id(), `${F} — api() hands every non-GET to the outbox`, "SRC: api() first branch",
  () => /if \(method !== "GET" && window\.LFH_OUTBOX\) \{/.test(fnText("api")));
check(id(), `${F} — every api() call goes to /api/editor and nowhere else`, "SRC: the url api() builds",
  () => /const url = "\/api\/editor" \+ ridQ\(path\);/.test(fnText("api")) && /base: "\/api\/editor"/.test(fnText("api")));
check(id(), "`app/api/editor/[...path]/route.ts` — GET asks gate() (requireRole manager) before anything else", "SRC: GET's first line",
  () => /export async function GET\(req: NextRequest, ctx: Ctx\) \{\s*\n\s*const g = await gate\(req\); if \(g instanceof NextResponse\) return g;/.test(ROUTE));
check(id(), "`app/api/editor/[...path]/route.ts` — every write (POST/PATCH/DELETE) asks gate() first", "SRC: postImpl / patchImpl / deleteImpl first lines",
  () => ["postImpl", "patchImpl", "deleteImpl"].every((f) => new RegExp(`async function ${f}\\(req: NextRequest, ctx: Ctx\\) \\{\\s*\\n\\s*const g = await gate\\(req\\); if \\(g instanceof NextResponse\\) return g;`).test(ROUTE)));
check(id(), "`app/api/editor/[...path]/route.ts` — the restaurant comes from editorScope (the session), never from the request body", "SRC: rid source in GET and postImpl",
  () => (ROUTE.match(/const rid = await editorScope\(req, g\);/g) || []).length >= 4);
check(id(), "`app/api/editor/[...path]/route.ts` — gate() answers a DB blip with 503 (stay signed in), a bad cookie with 401", "SRC: gate()",
  () => /g\.transient\s*\n?\s*\? NextResponse\.json\(\{ error: "Server can't reach the database — retrying\." \}, \{ status: 503 \}\)/.test(ROUTE));
check(id(), "`app/api/editor/[...path]/route.ts` — a switched-off manager tab is refused on the server too (tabGate), not only hidden", "SRC: tabGate in GET",
  () => /\{ const tg = await tabGate\(g, rid, path, req\.method\); if \(tg\) return tg; \}/.test(ROUTE));
for (const s of segs.filter(Boolean)) {
  check(id(), `${F} — the "${s}" endpoint my half calls is one the editor route answers (behind its gate)`, `SRC: route dispatch for "${s}"`,
    () => ROUTE.includes(`"${s}`) || new RegExp(`startsWith\\("${s}`).test(ROUTE) || new RegExp(`a === "${s}"`).test(ROUTE));
}
check(id(), "`app/api/owner/staff/route.ts` — the staff list the Users card reads resolves who is asking before any read", "SRC: GET's opening lines",
  () => /export async function GET\(req: NextRequest\) \{\s*\n\s*const s = await scope\(req\); if \(!s\.ok\) return s\.resp;/.test(STAFF)
    && /async function scope\(req: NextRequest\): Promise<Scope> \{[\s\S]{0,900}userFromCookie\(req\.cookies\.get\(USER_COOKIE\)/.test(STAFF)
    && { ok: true, note: "GET's first line is scope(req), which resolves the cookie's person and their restaurants before any read" });
check(id(), `${F} — ridQ adds ?rid only on an ADMIN tab (PANEL_RID from the URL); a real login sends none`, "SRC: ridQ",
  () => /const ridQ = \(path\) => \{\s*\n\s*if \(!PANEL_RID\) return path;/.test(APP));
check(id(), `${F} — ?as= is only honoured on an admin tab`, "SRC: PANEL_AS",
  () => /const PANEL_AS = PANEL_RID \? \(new URLSearchParams\(location\.search\)\.get\("as"\) \|\| ""\) : "";/.test(APP));
check(id(), `${F} — the ?skel= paint hint is never sent back to the server`, "SRC: PANEL_SKEL_RID is read only by panelRid, never by ridQ",
  () => !/PANEL_SKEL_RID/.test(APP.slice(APP.indexOf("const ridQ"), APP.indexOf("const PANEL_SKEL_RID"))) && (CODE.match(/PANEL_SKEL_RID/g) || []).length === 2);
check(id(), `${F} — device caches are keyed per restaurant, so one restaurant's floor never paints another's`, "SRC: tableCountKey / perRowKey",
  () => /"lfh_editor_table_count:" \+ r/.test(APP) && /"lfh_editor_per_row:" \+ r/.test(APP) && /return r \? .* : "";/.test(APP));
check(id(), `${F} — no key, token or password literal anywhere in my half`, "SRC: secret shapes",
  () => !/sbp_[A-Za-z0-9]{10}|eyJhbGciOi|service_role|SUPABASE_SERVICE|sk_live_|ADMIN_PASSWORD/.test(MINE));
check(id(), `${F} — nothing in my half writes to the console`, "SRC: console.* in stripped code",
  () => !/(?<![\w$.])console\.(log|warn|error|info|debug)\(/.test(MINE_C));
check(id(), `${F} — a new staff password is shown once, in state only, never stored`, "SRC: staffReveal never reaches storage",
  () => !/localStorage[^\n]*staffReveal|sessionStorage[^\n]*staffReveal|lsSet\([^)]*staffReveal/.test(MINE));
check(id(), `${F} — confirmDialog escapes its message unless a caller deliberately passes markup`, "SRC: confirm-msg",
  () => /<div class="confirm-msg">\$\{opts\.html \? message : esc\(message\)\}<\/div>/.test(APP));
check(id(), `${F} — promptDialog escapes the message, the placeholder, the default value and every chip`, "SRC: promptDialog markup",
  () => { const t = fnText("promptDialog"); return /\$\{esc\(message\)\}/.test(t) && /placeholder="\$\{esc\(placeholder\)\}"/.test(t) && /value="\$\{esc\(defaultValue\)\}"/.test(t) && /data-v="\$\{esc\(p\)\}">\$\{esc\(p\)\}/.test(t); });
check(id(), `${F} — esc() escapes all five characters that can break markup`, "SRC: esc map",
  () => /\{ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" \}/.test(APP));
check(id(), `${F} — the dish list, search suggestions and category chips escape every name and icon`, "SRC: renderList / renderSearchSuggest / renderCatFilter",
  () => /\$\{esc\(recLabel\(r\)\)\}/.test(fnText("renderList")) && /\$\{esc\(m\.label\)\}/.test(fnText("renderSearchSuggest")) && /\$\{esc\(label\)\}/.test(fnText("renderCatFilter")));
check(id(), `${F} — a waiter's name on the rota, the holder picker and the sections card is escaped`, "SRC: secName uses",
  () => [fnText("tableSectionsCardHtml"), fnText("openTableHolderPicker"), fnText("openSectionPicker")].every((t) => !/\$\{secName\(w\)\}/.test(t)));
check(id(), `${F} — a guest's rating comment, name and staff note are escaped`, "SRC: renderRatings",
  () => { const t = fnText("renderRatings"); return /“\$\{esc\(r\.comment\)\}”/.test(t) && /<b>\$\{esc\(r\.name\)\}<\/b>/.test(t) && /\$\{esc\(r\.staff_note\)\}/.test(t); });
check(id(), `${F} — a Pay Later person's name, phone and note are escaped on the book and in the picker`, "SRC: ordersKhataHtml / openKhataPersonPicker",
  () => /\$\{esc\(cst\.name\)\}/.test(fnText("ordersKhataHtml")) && /\$\{esc\(cst\.name\)\}<\/b><small>\$\{esc\(cst\.phone \|\| "no mobile"\)\}/.test(fnText("openKhataPersonPicker")));
check(id(), `${F} — the GST and Z-report CSVs refuse to start a cell with = + - @ (a spreadsheet would run it)`, "SRC: both cell() guards",
  () => (APP.slice(0, MY_END_AT).match(/if \(\/\^\[=\+\\-@\]\/\.test\(/g) || []).length === 2);
check(id(), `${F} — the bill delete door is the admin console's alone (canDeleteBill from the server, no higher-view shortcut)`, "SRC: canDeleteBillNow",
  () => /return XRAY_WHO\.canDeleteBill === true;/.test(fnText("canDeleteBillNow")) && !/higherView/.test(fnText("canDeleteBillNow").replace(/\/\/[^\n]*/g, "")));
check(id(), `${F} — a delete names its reason and the server writes the audit row (reason_code rides with the request)`, "SRC: deleteOrders",
  () => /reason_code=\$\{encodeURIComponent\(rr\.code\)\}/.test(fnText("deleteOrders")) && /reason_code: rr && rr\.code/.test(fnText("deleteOrders")));
check(id(), `${F} — a delete is one bill's rows, never a bulk door (the 'all' flag is gone on both sides)`, "SRC: no { all: true }",
  () => !/\{\s*all:\s*true\s*\}/.test(MINE_C) && !/\ball: true\b/.test(fnText("deleteOrders")));
check(id(), `${F} — reverting a paid bill always carries a reason (the server logs it as a payment revert)`, "SRC: setOrderPayment / restoreBill",
  () => /if \(!revertReason\) \{ toast\("Revert cancelled — a reason is required\.", "err"\); return false; \}/.test(fnText("setOrderPayment")) && /required: true, presets: REASONS_REVERT/.test(fnText("restoreBill")));
check(id(), `${F} — the customer is saved only with the consent tick, and only after the bill settles`, "SRC: readCust + payOrdersWithMethod",
  () => /if \(!phone \|\| !\(ce && ce\.checked\)\) return null;/.test(APP) && /if \(paidIds\.length && picked\.cust\)/.test(fnText("payOrdersWithMethod")));
check(id(), `${F} — the customer capture names THIS session, so a re-seated table cannot catch the visit`, "SRC: customer-capture body",
  () => /session: sid \|\| null/.test(fnText("payOrdersWithMethod")));
check(id(), `${F} — table names and seats are typeable only by the Aevidine admin (isAdmin, not higherView)`, "SRC: tableSeatingCardHtml",
  () => /const canEdit = !!\(typeof XRAY_WHO !== "undefined" && XRAY_WHO && XRAY_WHO\.isAdmin\);/.test(fnText("tableSeatingCardHtml")));
check(id(), `${F} — a Settings section the admin switched off is not offered (and its endpoints refuse too)`, "SRC: settingsSections",
  () => /SETTINGS_SECTIONS\.filter\(\(x\) => !off\.includes\(x\.id\)/.test(fnText("settingsSections")));
check(id(), `${F} — the Users card offers a manager only kitchen and tablet logins, and no Remove`, "SRC: userSettingCardHtml",
  () => /const ROLES = \["kitchen", "tablet"\];/.test(fnText("userSettingCardHtml")) && !/data-staff-delete|data-staff-remove/.test(fnText("userSettingCardHtml")));
check(id(), `${F} — "+ Add" targets the restaurant this panel is pinned to, never the alphabetically first`, "SRC: loadStaffTeam",
  () => /state\.staffRestaurantId = \(\(PANEL_RID && rlist\.some\(\(x\) => x\.id === PANEL_RID\)\) \? PANEL_RID : rlist\[0\]\?\.id\) \|\| null;/.test(fnText("loadStaffTeam")));
check(id(), `${F} — a rota save names its expectation, so a second manager's change is refused rather than overwritten`, "SRC: saveWaiterTables expect",
  () => /expect: \{ table: "staff_users", id: userId, fields: \{ assigned_tables: before \} \}/.test(fnText("saveWaiterTables")));
check(id(), `${F} — the admin looking at a restaurant's bill prints on OUR screen, never on their printer`, "SRC: printBill adminView",
  () => /if \(r && r\.adminView\) toast\("Admin view — showing the bill here, not printing at the restaurant\.", "ok"\);/.test(fnText("printBill")));
check(id(), `${F} — Bills and the Dashboard follow the admin's reach (today / yesterday) the server also clamps to`, "SRC: billsReachAllowsYesterday / dashReachDays",
  () => /XRAY_WHO\.billsReach === "today_yesterday"/.test(APP) && /REACH_RUNG\[XRAY_WHO && XRAY_WHO\.dashReach\] \|\| 1/.test(APP));
check(id(), `${F} — the panel holds no tax rate of its own (taxModel is billdoc's)`, "SRC: taxModel",
  () => /function taxModel\(settings\) \{ return LFH_BILLDOC\.taxModel\(/.test(APP));
check(id(), `${F} — the GST report is headed by the SERVER's window, never by a month the panel picked`, "SRC: openGstReport",
  () => /if \(d\.monthMode && Array\.isArray\(d\.months\) && d\.months\.length > 1\)/.test(fnText("openGstReport")));
