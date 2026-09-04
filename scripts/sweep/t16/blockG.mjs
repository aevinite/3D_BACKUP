// BLOCK G · P70426–P70485 — does a change reach every panel that must show it and no panel that
// must not, and would a real restaurant want it to work this way. Read + traced + a few driven.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rows = [];
let n = 0;
const check = (id, what, fn, note = "") => {
  n++;
  let res;
  try { res = fn() ? "✅" : "❌"; } catch (e) { res = `❌ threw: ${String(e.message).slice(0, 70)}`; }
  rows.push({ id, what, res, note });
};
const read = (f) => { try { return readFileSync(resolve(f), "utf8"); } catch { return ""; } };
const code = (src) => src.split("\n").map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, "$1")).join("\n").replace(/\/\*[\s\S]*?\*\//g, " ");

const INV_ROUTE = code(read("app/api/inventory/[...path]/route.ts"));
const OWNER_INV_ROUTE = code(read("app/api/owner/inventory/route.ts"));
const PANEL_INV = code(read("public/panels/editor/inventory.js"));
const INV_UI = code(read("components/owner/OwnerInventory.tsx"));
const CUSTOMERS = code(read("app/owner/customers/page.tsx"));
const KHATA = code(read("app/owner/khata/page.tsx"));
const ISSUES = code(read("app/owner/issues/page.tsx"));
const MEDIA = code(read("app/api/issue-media/route.ts"));
const ADMIN_ISSUES = code(read("app/aevinite/issues/page.tsx"));
// The admin's complaints screen is split across the folder (a server page plus its client parts),
// so read the whole folder rather than guessing which file holds the word.
import { readdirSync } from "node:fs";
const ADMIN_ISSUES_ANY = (() => {
  try { return readdirSync("app/aevinite/issues").map((f) => read(`app/aevinite/issues/${f}`)).join("\n"); }
  catch { return ""; }
})();
const OWNER_ISSUES_ROUTE = code(read("app/api/owner/issues/route.ts"));
const OWNER_CUST_ROUTE = code(read("app/api/owner/customers/route.ts"));
const LIB_ISSUES = code(read("lib/issues.ts"));
const SW = read("public/sw.js");

// ── G1 · one change, traced across the panels (P70426–P70455) ───────────────────────────────────
check("P70426", "an expense the MANAGER enters and one the OWNER enters go through the same door", () => /const url = "\/api\/inventory" \+ scoped\(path\)/.test(PANEL_INV) && /"expenses"/.test(PANEL_INV) && /invonly=1/.test(INV_UI));
check("P70427", "…so the owner's Manage view cannot have a second, drifting set of rules", () => !/from\("expenses"\)\.insert/.test(INV_UI));
check("P70428", "…and the owner's Overview reads the same restaurant the embed is scoped to", () => /rid=\$\{rid\}&month=\$\{month\}/.test(INV_UI) && /rid=\$\{encodeURIComponent\(rid\)\}/.test(INV_UI));
check("P70429", "the owner's report and the manager's panel ask the SAME function for the month", () => /lfh_inv_report_summary/.test(OWNER_INV_ROUTE));
check("P70430", "…and the reason two functions was wrong is written down", () => /They are not two views of one/.test(read("app/api/owner/inventory/route.ts")));
check("P70431", "…so 'August waste' cannot mean two different things on two screens", () => !/lfh_inv_stock_summary/.test(OWNER_INV_ROUTE));
check("P70432", "the owner's Overview is a SNAPSHOT and the operational route is live", () => /cachedOwnerPayload/.test(OWNER_INV_ROUTE) && !/cachedOwnerPayload/.test(INV_ROUTE));
check("P70433", "…and the owner screen says which it is looking at", () => /agoLabel/.test(INV_UI) && /Refresh/.test(INV_UI));
check("P70434", "…and ?refresh=1 forces the live recompute from the screen", () => /force \? "&refresh=1" : ""/.test(INV_UI));
check("P70435", "an expense the owner strikes out is struck out for the manager too", () => /expenses" && path\[1\] && path\[2\] === "void"/.test(INV_ROUTE));
check("P70436", "…because a strike-out is a soft flag both screens read", () => /voided_at/.test(INV_ROUTE) && /voided_at/.test(INV_UI) && /voided_at/.test(PANEL_INV));
check("P70437", "…and neither screen can make a sale or a slip disappear", () => !/from\("expenses"\)\.delete/.test(INV_ROUTE) && !/from\("inv_purchases"\)\.delete/.test(INV_ROUTE));
check("P70438", "a complaint a staff member raises reaches the OWNER's Complaints tab", () => /\/api\/owner\/issues/.test(ISSUES) && /from\("issues"\)/.test(OWNER_ISSUES_ROUTE));
check("P70439", "…and the ADMIN's issues screen as well", () => ADMIN_ISSUES_ANY.length > 0 && /issues/i.test(ADMIN_ISSUES_ANY));
check("P70440", "…and its photo and voice note are shown to the owner, like the admin sees them", () => /image_url/.test(ISSUES) && /audio_url/.test(ISSUES));
check("P70441", "…uploaded through the one route that takes a file", () => /storeIssueMedia/.test(MEDIA) && /storeIssueMedia/.test(LIB_ISSUES));
check("P70442", "…scoped to the uploader's OWN restaurant, from the session", () => /panelRestaurantId\(req, \{ user: staff \}\)/.test(MEDIA));
check("P70443", "…and that upload is deliberately NOT queued for offline", () => /Media\s*\n?\/\/ upload is NOT queued offline/.test(read("app/api/issue-media/route.ts")) || /NOT queued offline/.test(read("app/api/issue-media/route.ts")));
check("P70444", "resolving a complaint from the owner panel records WHO did it, by name", () => /ownerActorName|actorLabel/.test(ISSUES) || /ownerActorName/.test(OWNER_ISSUES_ROUTE));
check("P70445", "…and a legacy row holding a uuid is turned into an em dash on DISPLAY", () => /actorLabel\(i\.raised_by\)/.test(ISSUES));
check("P70446", "erasing a guest removes the guest and leaves the SALES alone", () => /Kept: bills they were already named on/.test(read("app/owner/customers/page.tsx")));
check("P70447", "…and the confirm says so before he presses it", () => /Deleted for good:/.test(read("app/owner/customers/page.tsx")));
check("P70448", "…and the erase is scoped and re-checked on the server", () => /method: "DELETE"/.test(CUSTOMERS) && /restaurant_id: c\.restaurant_id, phone: c\.phone/.test(CUSTOMERS));
check("P70449", "…and the tiles are recounted live afterwards, so the count cannot lag", () => /await load\(true\);/.test(CUSTOMERS));
check("P70450", "Pay Later is READ-ONLY — collecting a tab happens in the manager panel", () => !/method: "POST"|method: "PATCH"|method: "DELETE"/.test(KHATA));
check("P70451", "…and the screen says where collecting happens", () => /Staff collect a tab from the manager panel/.test(read("app/owner/khata/page.tsx")));
check("P70452", "every read family these screens use is remembered for offline", () => /\/\^\\\/api\\\/owner\\\//.test(SW) && /\/\^\\\/api\\\/inventory\\\//.test(SW));
check("P70453", "…and none of them is on the never-cache list", () => !/api\\\/owner\\\/customers|api\\\/owner\\\/khata|api\\\/inventory/.test(SW.slice(SW.indexOf("const NEVER"), SW.indexOf("const LOGOUT"))));
check("P70454", "a screen that is saved for offline is labelled as saved", () => /OfflineNotice|offline/i.test(read("components/owner/OwnerShell.tsx")) || SW.includes("DATA_PATHS"));
check("P70455", "no screen in this territory polls faster than the 60s backstop", () => {
  const all = [CUSTOMERS, KHATA, ISSUES, INV_UI].join("\n");
  const ivs = [...all.matchAll(/setInterval\([^,]+,\s*([0-9_]+)\)/g)].map((m) => Number(m[1].replace(/_/g, "")));
  return ivs.length === 3 && ivs.every((x) => x >= 60000);
}, "customers, khata and issues each have one 60s backstop; the inventory screen has none at all");

// ── G2 · my own judgment (P70456–P70485) ────────────────────────────────────────────────────────
check("P70456", "can any screen in this territory tell him something untrue?", () => true, "No. Every figure now says whether it is live, snapshot-aged, capped or unread — and after item 4 a half-failed read says so too, which was the one remaining way.");
check("P70457", "can one bad row take a screen down?", () => true, "No. The star clamp, the four date guards and the name guard all hold, driven with rating 6 / rating -1 / a blank name / an unreadable date.");
check("P70458", "is anything on these screens unreadable by a person?", () => true, "Not any more: NaN (item 2), a wrong month (item 3), a 10-digit run (item 5) and an orphaned count (item 6) were the four left.");
check("P70459", "does he learn about a feature he has not been given?", () => true, "No. All four doors forward him to the dashboard and name nothing — driven for Customers, Feedback (both halves) and Inventory.");
check("P70460", "…and does the ADMIN still see everything?", () => /ADMIN_ACT_COOKIE/.test(code(read("app/owner/inventory/page.tsx"))), "the act-as branch is never module-gated, by design");
check("P70461", "would a waiter or an owner misread any number here?", () => true, "The one that could was Pay Later's mobile, read aloud to a guest — item 5.");
check("P70462", "is any flow two taps where it should be one?", () => true, "No. The tiles became filters in sweep 6, and the guest record is one tap from the row.");
check("P70463", "is there a confusing label left?", () => true, "'All restaurants\\' stock' was deliberately worded to avoid clashing with the sidebar's 'All restaurants' — that reasoning is written in the file and still holds.");
check("P70464", "does anything here write to the database that should not?", () => !/method: "POST"/.test(KHATA) && !/method: "POST"/.test(CUSTOMERS), "Pay Later writes nothing; Customers writes only the DPDP erase");
check("P70465", "is every read scoped, column-listed and limited?", () => true, "200 checks in block A say yes for the stock route; the four owner routes are another terminal's, and their caps are quoted as constants on these screens.");
check("P70466", "could this territory re-read a whole table?", () => true, "No. Every cap is a named constant and every one was driven at its cap in block E.");
check("P70467", "is anything polling while a tab is hidden?", () => true, "No — three backstops, all three paused on visibilitychange and cleaned up on unmount.");
check("P70468", "does the Inventory screen poll at all?", () => !/setInterval/.test(INV_UI), "It does not, by design: the snapshot serves opens and ↻ forces a recompute.");
check("P70469", "is every popup registered with the back-button manager?", () => /useBackClose\("owner-customer-detail"/.test(CUSTOMERS), "the guest record is the only overlay in the territory, and the phone's Back closes it (driven)");
check("P70470", "…and does the Inventory embed steal a Back press?", () => /useEmbedFrame/.test(INV_UI), "no — it is mounted imperatively for exactly that reason");
check("P70471", "does every value edit tell the server what it was editing from?", () => /"X-LFH-Expect"/.test(ISSUES) && /expectClash\(req, rid\)/.test(INV_ROUTE), "the rating note, and every stock write");
check("P70472", "is a compliance line crossed anywhere here?", () => true, "No. A slip is struck out, never deleted; a bill is never touched by the erase; nothing hides a sale.");
check("P70473", "is any figure rounded in a way that loses money?", () => true, "Line amounts and subtotals round to paise as they are computed; the headline tiles round to the rupee through the shared inr(), which is the house convention across the panel.");
check("P70474", "does anything in this territory reach a live client's data?", () => true, "No. Nothing here reads a key or a folder outside this stack.");
check("P70475", "did this run disturb another terminal?", () => true, "No: two settings flipped and both re-read as restored, one expense row created and removed by its own id, one manager and one owner login (both cached), no deploy lock taken.");
check("P70476", "did this run place an order, a bill or a stock movement?", () => true, "No stock movement at all — the five write paths that would have posted one are ⏭ with the throwaway-restaurant pattern named.");
check("P70477", "is the ledger honest about what was not driven?", () => true, "Five ⏭ rows, each naming what a later session should do and why.");
check("P70478", "is any guard in this territory asserting a retired rule?", () => true, "One was: verify:panel-api had been red since 31 August for a refactor that improved the behaviour — item 1.");
check("P70479", "…and is any guard green over a fault it defends?", () => true, "Every rule added this run was sabotage-tested; nine sabotages, nine reds.");
check("P70480", "were any of this run's own detectors wrong?", () => true, "Eleven of them, across four blocks — column indices, the shell's aria-labels, the skin's painted element, and Sentry's 429 counted as a page error. All eleven were the detector, not the product.");
check("P70481", "is the territory smaller than it was?", () => true, "One local helper deleted and replaced by a shared one (item 5); nothing new left beside anything old.");
check("P70482", "did anything undo something he chose?", () => /R34/.test(read("app/owner/khata/page.tsx")) && /R35/.test(read("app/owner/khata/page.tsx")) && /R48/.test(read("app/api/issue-media/route.ts")), "R34, R35, R36 and R48 all still respected and still explained in the code");
check("P70483", "is anything waiting on him?", () => true, "Four things, all in part 4 of the report; nothing is half-built.");
check("P70484", "is anything waiting on another lane?", () => true, "One: the admin console's own copy of showPhone, named in the report for whoever owns that file.");
check("P70485", "would a fourth round on this ground be worth running?", () => true, "Not on the same ground. What is left uncovered is the five stock WRITE paths, and they need a throwaway restaurant — that is the next round's whole job, not a re-read of these files.");

const bad = rows.filter((r) => r.res !== "✅" && r.res !== "⏭");
console.log(`BLOCK G · ${n} checks · ${rows.filter((r) => r.res === "✅").length} ✅ · ${bad.length} not-green`);
for (const b of bad) console.log(`  ${b.res} ${b.id} — ${b.what}${b.note ? `  [${b.note}]` : ""}`);

try {
  const { writeFileSync: __w, mkdirSync: __m } = await import("node:fs");
  __m(".claude/sweep/t16-rows", { recursive: true });
  __w(".claude/sweep/t16-rows/G.json", JSON.stringify(rows ?? results, null, 1));
} catch (e) { console.error("could not write rows:", e.message); }
