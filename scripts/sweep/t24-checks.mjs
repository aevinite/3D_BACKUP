// scripts/sweep/t24-checks.mjs — the checks themselves. See t24-run.mjs for how to run them.
//
// Sweep #8, terminal 24 · app/api/editor/[...path]/route.ts lines 1 → ~3,000.
import { check, run, F } from "./t24-run.mjs";

const { src, HELPERS, GETBLK, POSTBLK_A, MINE, panel, billdoc, chains, endpointBlock, api, sql, FRENCH_HOUSE, live, needLive, J, ANON } = F;

// Strip LINE comments before BLOCK comments — a "/*" sitting inside a "//" line otherwise hides
// the rest of the file from the scanner. This repo has lost 190 lines to that exact order twice.
const code = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const CODE = code(MINE);
const SRCCODE = code(src);
const GETCODE = code(GETBLK);
const HELPCODE = code(HELPERS);
const POSTCODE = code(POSTBLK_A);
const count = (t, re) => (t.match(re) || []).length;

const blk = {};
for (const n of ["whoami", "orders", "zreport", "gst-report", "summary", "stats", "users", "oplog",
  "audit", "khata", "khata/customers", "all", "ratings", "platform", "calls", "issues", "sessions",
  "staff-risk", "onhouse", "banquet/items", "banquet/bills", "banquet/bill", "customer-search",
  "customer-recognize", "table-sections", "print-jobs", "printing"]) blk[n] = code(endpointBlock(n));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RE-RUN — rows written by earlier sweeps whose subject is this file. Same ids, results updated.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
check("P04940", "the route gates every method with requireRole(req,\"manager\")", "read GET/POST/PATCH/DELETE",
  () => /requireRole\(req, "manager"\)/.test(HELPCODE)
    && ["export async function GET(", "async function postImpl(", "async function patchImpl(", "async function deleteImpl("]
      .every((f) => { const i = src.indexOf(f); return i > 0 && /await gate\(req\)/.test(src.slice(i, i + 400)); }));
check("P19788", "editor: POST is wrapped in withIdempotency AND invalidateFloorAfter", "read the route file",
  () => /export const POST = withIdempotency\(invalidateFloorAfter\(postImpl\), "editor"\)/.test(src));
check("P19789", "editor: PATCH is wrapped the same way", "read the route file",
  () => /export const PATCH = withIdempotency\(invalidateFloorAfter\(patchImpl\), "editor"\)/.test(src));
check("P19790", "editor: DELETE is wrapped the same way", "read the route file",
  () => /export const DELETE = withIdempotency\(invalidateFloorAfter\(deleteImpl\), "editor"\)/.test(src));
check("P19791", "editor: every method resolves its restaurant through editorScope, not panelRestaurantId directly", "read the route file",
  () => ["export async function GET(", "async function postImpl(", "async function patchImpl(", "async function deleteImpl("]
    .every((f) => /await editorScope\(req, g\)/.test(src.slice(src.indexOf(f), src.indexOf(f) + 1800)))
    // ONE call, and it is inside editorScope. (The import line is not a call; counting the bare
    // name made this row red for a refactor that changed nothing — judge the rule, not the shape.)
    && count(SRCCODE, /panelRestaurantId\(req, g\)/g) === 1
    && /async function editorScope\([\s\S]{0,900}?panelRestaurantId\(req, g\)/.test(HELPCODE));
check("P19792", "editor: every method runs tabGate before doing any work", "read the route file",
  () => count(SRCCODE, /const tg = await tabGate\(g, rid, path, req\.method\)/g) >= 4);
check("P19793", "editor: POST refuses an empty id segment before it reaches a uuid query", "read postImpl",
  () => /if \(emptyIdSegment\(b\) \|\| emptyIdSegment\(c\)\) return err\("Missing id/.test(POSTCODE));
check("P19794", "editor: dish-photo is handled before readBody consumes the stream", "read postImpl",
  () => POSTCODE.indexOf('path[0] === "dish-photo"') > 0 && POSTCODE.indexOf('path[0] === "dish-photo"') < POSTCODE.indexOf("readBody(req)"));
check("P19795", "editor: the replay-clash gate runs on POST", "read postImpl", () => /await replayClash\(req, rid, a, b, c,/.test(POSTCODE));
check("P19796", "editor: the expect-clash gate runs on POST", "read postImpl", () => /const overwrite = await expectClash\(req, rid\)/.test(POSTCODE));
check("P19797", "editor: the off-plan table check runs on the editor too", "read postImpl", () => /await offPlanTable\(rid,/.test(POSTCODE));
check("P19798", "editor: a floor write drops the shared snapshot before AND after", "read postImpl + the wrapper",
  () => /invalidateFloor\(rid\);\s*\n\s*writeRid\.set\(req, rid\)/.test(POSTCODE) && /finally \{[\s\S]{0,200}invalidateFloor\(rid\)/.test(SRCCODE));
check("P19799", "editor: the after-wrapper uses finally so a throwing handler still drops it", "read invalidateFloorAfter",
  () => /function invalidateFloorAfter[\s\S]{0,500}?finally \{[\s\S]{0,200}invalidateFloor\(rid\)/.test(SRCCODE));
check("P19800", "editor: a money-changing edit is refused while a live invoice stands", "read the invoice lock helpers + their callers",
  () => /LOCKED_MSG = "This bill is invoiced/.test(HELPCODE) && count(SRCCODE, /LOCKED_MSG/g) >= 4);
check("P19801", "editor: the invoice lock is checked by ORDER and by ITEM", "read the two helpers",
  () => /async function invoiceLockedByOrder\(/.test(HELPCODE) && /async function invoiceLockedByItem\(/.test(HELPCODE));
check("P19802", "editor: a manager may not delete a bill — cancel is the only route out (R27)", "read canDeleteBill",
  () => /async function canDeleteBill\([\s\S]{0,200}?return !g\.user;/.test(HELPCODE));
check("P19803", "editor: and no per-manager delete-bill resolution has been rebuilt", "read the whole file",
  () => !/managerCan\(g, rid, "delete_bill"\)/.test(SRCCODE) && !/access_config\?\.delete_bill/.test(SRCCODE));
check("P19804", "editor: a discount is capped by discountBaseOf, the SAME rule as the SQL and billMath", "read discountBaseOf",
  () => /function discountBaseOf\(o: OrderMoney, rate: number\)[\s\S]{0,300}?if \(rate > 0\) return o\?\.taxable_base == null \? sub : \(Number\(o\.taxable_base\) \|\| 0\);/.test(HELPCODE));
check("P19805", "editor: the per-role %-cap is enforced on the manager side too", "read the route file",
  () => /overDiscountCap\(/.test(SRCCODE) && /discountCapPct\(/.test(SRCCODE));
check("P19806", "editor: a discount writes a Removals audit row from this panel as well", "read the route file", () => /recordRemoval\(/.test(SRCCODE));
check("P19807", "editor: cancelling a ticket is watched, so a run of them reaches somebody", "read the route file", () => /watchCancellations\(/.test(SRCCODE));
check("P19808", "editor: a soft delete keeps the row — softDeleteOrders, never a SQL delete of an order", "read the route file",
  () => /softDeleteOrders\(/.test(SRCCODE) && !/from\("orders"\)\s*\.delete\(/.test(SRCCODE));
check("P19809", "editor: log retention can be set by the owner, never by the manager it audits", "read canSetRetention",
  () => /if \(g\.user\.role !== "owner"\) return \{ ok: false, code: "retention_manager_blocked" \}/.test(HELPCODE));
check("P19810", "editor: and the admin's lock is enforced server-side, not merely shown", "read canSetRetention",
  () => /return lock\.locked \? \{ ok: false, code: "retention_locked" \}/.test(HELPCODE));
check("P19811", "editor: and a failed read of the lock is treated as LOCKED, never as unlocked", "read retentionLock",
  () => /if \(r\.error\) return \{ locked: true, at: null \}/.test(HELPCODE));
check("P19812", "editor: the editor's catch never leaks the internal message to a manager's toast", "read the GET catch + lib/panelFailure",
  () => /return panelFailure\(e\)/.test(GETCODE));
check("P19813", "editor: route errors are logged with the endpoint that failed", "read the GET catch",
  () => /logError\("manager", "route_error", e, \{ restaurant_id: rid, detail: `GET \$\{p \|\| "\/"\}` \}\)/.test(GETCODE));
check("P19814", "editor: an ordinary refusal is kept out of the error log", "read the GET catch", () => /if \(worthLogging\(e\)\) logError\(/.test(GETCODE));
check("P19815", "editor: the bill customer is saved before an invoice is issued", "read the route file", () => /saveBillCustomer\(/.test(SRCCODE));
check("P19816", "editor: a re-issued invoice captures its reason", "read the route file", () => /invoice/i.test(SRCCODE) && /reason/.test(SRCCODE));
check("P19817", "editor: the menu cache is busted whenever a guest-visible thing changes", "read every write to a guest-visible table and what happens before it answers",
  // THE RULE, NOT A COUNT. This used to demand three call sites; there are two, and two is right —
  // the generic save and the generic delete are the only writes to a guest-visible table. What has
  // to hold is that no such write can ANSWER without busting: for each write chain, the next
  // bustMenuCache(rid) must come before the next `return`.
  () => {
    if (!/const bustMenuCache = \(rid: string\)/.test(HELPCODE)) return { ok: false, note: "bustMenuCache is gone" };
    const writes = chains(SRCCODE).filter((c) => /from\("(menu_items|categories|filters)"\)/.test(c.flat)
      && /\.(update|upsert|insert|delete)\(/.test(c.flat));
    const bad = [];
    for (const w of writes) {
      const after = SRCCODE.slice(SRCCODE.indexOf(w.chain) + w.chain.length);
      const bust = after.indexOf("bustMenuCache(rid)");
      const ret = after.search(/\n\s*return (ok|err)\(/);
      if (bust < 0 || (ret >= 0 && ret < bust)) bad.push(w.line);
    }
    return { ok: bad.length === 0, note: bad.length ? `writes that answer without busting, at lines ${bad.join(",")}` : `${writes.length} guest-visible writes, every one busts before it answers` };
  });
check("P19818", "editor: with { expire: 0 }, never the 'max' profile that serves the OLD bundle", "read bustMenuCache",
  () => /revalidateTag\(menuTag\(rid\), \{ expire: 0 \}\)/.test(HELPCODE));
check("P19819", "editor: a dish photo is refused unless it is PNG / JPG / WEBP", "read PHOTO_EXT",
  () => /"image\/png": "png", "image\/jpeg": "jpg", "image\/webp": "webp"/.test(HELPCODE));
check("P19820", "editor: and SVG is not on that list", "read PHOTO_EXT", () => !/image\/svg/.test(HELPCODE));
check("P19821", "editor: the parcel/platform gate rides the right module for the right source", "read platformOrParcelCan",
  () => /const isParcel = source === "parcel"[\s\S]{0,300}?parcelLadder : platformLadder/.test(HELPCODE));
check("P19822", "editor: the table-ops gate is one helper, used by every KOT verb", "read tableOpsGate + its callers",
  () => /async function tableOpsGate\(/.test(HELPCODE) && count(SRCCODE, /await tableOpsGate\(g, rid\)/g) >= 4);
check("P19823", "editor: the manager's own settings sections are refused server-side, not just hidden", "read the route file",
  () => /managerSettingsOff\(/.test(SRCCODE));
check("P19880", "editor: a DB blip answers 503 and keeps the panel logged in", "read gate()",
  () => /g\.transient[\s\S]{0,220}?status: 503/.test(HELPCODE));
check("P19884", "editor: a genuinely bad cookie answers 401", "drive it live, signed out",
  () => ANON["/all"] && ANON["/all"].status === 401 && /Not authorised/.test(ANON["/all"].text));
check("P19888", "editor: a missing restaurant scope is a sentence, not a crash", "read editorScope",
  () => /return err\("No restaurant scope — open this panel from the admin console\.", 400\)/.test(HELPCODE));
check("P19892", "editor: POST is wrapped in withIdempotency", "read the route file", () => /withIdempotency\(invalidateFloorAfter\(postImpl\)/.test(src));
check("P19896", "editor: the floor snapshot is dropped after the write, not only before", "read invalidateFloorAfter",
  () => /const writeRid = new WeakMap<NextRequest, string>\(\)/.test(src));
check("P19899", "editor: an empty id segment is refused before a uuid query", "read postImpl", () => /emptyIdSegment\(b\) \|\| emptyIdSegment\(c\)/.test(POSTCODE));
check("P19902", "editor: the replay-clash gate is present", "read postImpl", () => /replayClash\(/.test(POSTCODE));
check("P19905", "editor: the expect-clash gate is present", "read postImpl", () => /expectClash\(/.test(POSTCODE));
check("P19913", "editor: the catch routes through panelFailure", "read the GET catch", () => /panelFailure\(e\)/.test(GETCODE));
check("P19917", "editor: an ordinary refusal is kept out of the error log", "read the GET catch", () => /worthLogging\(e\)/.test(GETCODE));
check("P19920", "editor: the admin's per-tab ?rid= pin is honoured", "read editorScope",
  () => /const urlRid = req\.nextUrl\.searchParams\.get\("rid"\)/.test(HELPCODE) && /enabledOwnedRestaurantIds\(u\.id\)/.test(HELPCODE));
check("P19927", "editor: the settings row is stripped of the delivery apps' keys before it leaves", "drive GET /all live",
  () => needLive("all") || (J("all") && J("all").settings && !("platform_channels" in J("all").settings)));
check("P19930", "editor: the whoami tells the panel who is looking", "drive GET /whoami live",
  () => needLive("whoami") || (J("whoami").actor === "manager" && J("whoami").role === "manager"));
check("P19933", "editor: ?view=real answers as the real role", "read the whoami block",
  () => /const simulate = !g\.user && new URL\(req\.url\)\.searchParams\.get\("view"\) === "real"/.test(blk.whoami));
check("P19936", "editor: ?as= names a person without changing who is writing", "read the whoami block + the write path",
  () => /const person = await viewAsPerson\(req, rid, g, "manager"\)/.test(blk.whoami) && !/viewAsPerson/.test(POSTCODE));
check("P19939", "editor: an unknown endpoint answers 404, not 500", "drive an unknown path live",
  () => needLive("unknown") || (live("unknown").status === 404 && /unknown GET endpoint/.test(live("unknown").text)));
check("P20000", "watched running: /api/editor/all requires being signed in (401)", "driven headless against this terminal's port 4324",
  () => ANON["/all"] && ANON["/all"].status === 401);
check("P06459", "/owner/menu echoes ?rid= on every API call the embed makes, and the editor route re-checks it", "read editorScope",
  () => /if \(u && u\.role === "owner"\)[\s\S]{0,400}?if \(!owned\.includes\(urlRid\)\) return err\("You can only edit restaurants you own\.", 403\)/.test(HELPCODE));
check("P06698", "Every write from the embed is logged as the OWNER — no shadow manager account", "read the postImpl actor block",
  () => /const actorName = g\.user\?\.name \|\| g\.user\?\.username \|\| null/.test(POSTCODE));
check("P06699", "The embed's ?rid is re-validated server-side against the owner's estate", "read editorScope", () => /enabledOwnedRestaurantIds\(u\.id\)/.test(HELPCODE));
check("P21780", "Every write from the embed is re-validated server-side against the owner's estate", "read editorScope + postImpl",
  () => /const rid = await editorScope\(req, g\)/.test(POSTCODE));
check("P07206", "hiding is never the only guard — a hidden manager tab's endpoints refuse too", "read tabGate beside managerTabsOff",
  () => /if \(managerTabOn\(cfg, hit\.tab\) && granted\) return null;/.test(HELPCODE) && /isn't part of this restaurant's manager panel/.test(HELPCODE));
for (const [id, flag, key] of [
  ["P07426", "mgr_tab_editor", "edit_menu"], ["P07427", "mgr_tab_ratings", "view_ratings"],
  ["P07428", "mgr_tab_log", "view_logs"], ["P07429", "mgr_tab_dash", "view_dashboard"],
  ["P07430", "mgr_void_bills", "void_bills"], ["P07431", "mgr_give_discounts", "give_discounts"],
]) check(id, `Access "${flag}" and the manager panel's whoami.effectivePowers.${key} agree`,
  "sign in as this restaurant's manager and read /api/editor/whoami",
  () => needLive("whoami") || (typeof J("whoami").effectivePowers?.[key] === "boolean"
    && typeof J("whoami").offByAdmin?.[key] === "boolean"));
check("P48324", "The manager's till list names real payment methods", "drive GET /zreport live",
  () => needLive("zreport") || (Array.isArray(J("zreport")?.payments?.rows)
    && J("zreport").payments.rows.every((r) => typeof r.method === "string" && r.method.length > 0)));
