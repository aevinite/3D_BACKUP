// t24-new-d.mjs — sweep #8 T24, block D: each GET endpoint in this half, read for what it
// actually returns and driven live for what a manager's screen actually gets.
import { check, nid, F } from "./t24-run.mjs";

const { src, GETBLK, endpointBlock, live, needLive, J, panel, chains } = F;
const code = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const B = (n) => code(endpointBlock(n));
const GC = code(GETBLK);
const count = (t, re) => (t.match(re) || []).length;

const NOISE = /\[object Object\]|\bundefined\b|\bNaN\b|-->|\$\{/;

// ── customer-recognize / customer-search — typed at, so they must stay tiny ────────────────────
check(nid(), "the repeat-customer lookup never lists — it answers about ONE number", "read GET /customer-recognize",
  () => /lfh_recognize_customer/.test(B("customer-recognize")) && !/\.select\(/.test(B("customer-recognize")));
check(nid(), "…and an empty number is a plain 'not known', not an error", "read GET /customer-recognize",
  () => /if \(!phone\) return ok\(\{ known: false \}\)/.test(B("customer-recognize")));
check(nid(), "…and the typed number is trimmed to 20 characters before it goes near the database", "read GET /customer-recognize",
  () => /\.trim\(\)\.slice\(0, 20\)/.test(B("customer-recognize")));
check(nid(), "…driven with no number, it answers 'not known' rather than 500", "driven live",
  () => needLive("custRecogNone") || (live("custRecogNone").status === 200 && J("custRecogNone").known === false));
check(nid(), "the number search asks for at most 12 rows, and the cap is a named constant", "read GET /customer-search",
  () => /const CUSTOMER_SEARCH_ROWS = 12;/.test(B("customer-search")) && /p_limit: CUSTOMER_SEARCH_ROWS/.test(B("customer-search")));
check(nid(), "…it says out loud whether that answer was COMPLETE, so the sheet never guesses from a row count", "read GET /customer-search",
  () => /whole: matches\.length < CUSTOMER_SEARCH_ROWS/.test(B("customer-search")));
check(nid(), "…fewer than three digits is answered with nothing, not with a scan", "read GET /customer-search",
  () => /if \(q\.length < 3\) return ok\(\{ matches: \[\] \}\)/.test(B("customer-search")));
check(nid(), "…and only digits are sent, so a pasted +91 spelling finds the same row", "read GET /customer-search",
  () => /replace\(\/\\D\/g, ""\)\.slice\(0, 15\)/.test(B("customer-search")));
check(nid(), "…driven with two digits, it answers an empty list", "driven live",
  () => needLive("custSearchShort") || (live("custSearchShort").status === 200 && Array.isArray(J("custSearchShort").matches) && J("custSearchShort").matches.length === 0));
check(nid(), "…driven with a real prefix, it answers a list and says whether that answer is whole", "driven live",
  () => needLive("custSearch") || (Array.isArray(J("custSearch").matches) && typeof J("custSearch").whole === "boolean"));
check(nid(), "…and a too-short query does NOT claim to be whole — the sheet keeps asking, which is the safe direction", "driven live",
  () => needLive("custSearchShort") || J("custSearchShort").whole !== true);

// ── table-sections ─────────────────────────────────────────────────────────────────────────────
check(nid(), "the sections roster is WAITERS only — a manager handing out tables gains no staff records", "read GET /table-sections",
  () => /\.eq\("role", "tablet"\)/.test(B("table-sections")) && !/permissions/.test(B("table-sections")));
check(nid(), "…and it names its columns rather than handing over the staff row", "read GET /table-sections",
  () => /select\("id, username, name, role, active, assigned_tables"\)/.test(B("table-sections")));
check(nid(), "…deleted staff are left out", "read GET /table-sections", () => /\.is\("deleted_at", null\)/.test(B("table-sections")));
check(nid(), "…and a restaurant with no table_count set still gets a sensible 12", "read GET /table-sections",
  () => /Number\(must\(settings\)\?\.table_count\) \|\| 12/.test(B("table-sections")));
check(nid(), "…driven live it answers the four things the section editor draws", "driven live",
  () => needLive("sections") || (live("sections").status !== 200 ? { ok: live("sections").status === 403, note: "permission refused, which is an honest answer" }
    : Array.isArray(J("sections").waiters) && typeof J("sections").tableCount === "number"));

// ── banquet ────────────────────────────────────────────────────────────────────────────────────
for (const [ep, key] of [["banquet/items", "bqItems"], ["banquet/bills", "bqBills"], ["banquet/bill", "bqBillNone"]]) {
  check(nid(), `${ep} refuses when Banquet is not enabled for this restaurant`, `read GET /${ep}`,
    () => /banquetLadder\(rid\)\)\.effective\) return err\("Banquet isn't enabled for this restaurant\.", 403\)/.test(B(ep)));
  check(nid(), `${ep} also needs the owner's banquet grant`, `read GET /${ep}`,
    () => /managerCan\(g, rid, "banquet"\)\)\) return permDenied\("use banquet billing"\)/.test(B(ep)));
  check(nid(), `${ep} answers honestly live — either its data or a 403 that says why`, "driven live",
    () => needLive(key) || ({ ok: live(key).status === 200 || (live(key).status === 403 && /Banquet|permission/.test(live(key).text)) || live(key).status === 400,
      note: `status ${live(key).status}` }));
}
check(nid(), "the banquet bill list is searched on the SERVER, so a search never pulls the whole ledger", "read GET /banquet/bills",
  () => /sel\.or\(`cust_name\.ilike/.test(B("banquet/bills")));
check(nid(), "…through safeSearch, so a customer called \"Sharma, R\" searches for what was typed", "read GET /banquet/bills",
  () => /safeSearch\(new URL\(req\.url\)\.searchParams\.get\("q"\), 40\)/.test(B("banquet/bills")));
check(nid(), "…and its row cap is bounded at 100 however big a ?limit= is typed", "read GET /banquet/bills",
  () => /Math\.min\(100, Math\.max\(1, Number\(new URL\(req\.url\)\.searchParams\.get\("limit"\)\) \|\| 40\)\)/.test(B("banquet/bills")));
check(nid(), "one banquet bill is fetched by id AND restaurant, never by id alone", "read GET /banquet/bill",
  () => /\.eq\("id", id\)\.eq\("restaurant_id", rid\)/.test(B("banquet/bill")));
check(nid(), "…and a missing id is a sentence, not a crash", "read GET /banquet/bill", () => /if \(!id\) return err\("id required"\)/.test(B("banquet/bill")));
check(nid(), "…and another restaurant's id reads as 'not found', which is the same answer as a typo", "read GET /banquet/bill",
  () => /if \(!bill\) return err\("bill not found", 404\)/.test(B("banquet/bill")));
check(nid(), "…and its order is fetched scoped too", "read GET /banquet/bill",
  () => /from\("orders"\)[\s\S]{0,200}?\.eq\("id", bill\.order_id\)\.eq\("restaurant_id", rid\)/.test(B("banquet/bill")));

// ── khata ──────────────────────────────────────────────────────────────────────────────────────
check(nid(), "the Pay Later book refuses when the module is off for this restaurant", "read GET /khata",
  () => /khataLadder\(rid\)\)\.effective\) return err\("Pay later \(khata\) isn't enabled/.test(B("khata")));
check(nid(), "…and when the owner has not granted it", "read GET /khata", () => /managerCan\(g, rid, "khata"\)\)\) return permDenied/.test(B("khata")));
check(nid(), "…and the owner panel calls the SAME function, so the two can never disagree on what is owed", "read GET /khata",
  () => /lfh_khata_outstanding/.test(B("khata")));
check(nid(), "…'collected today' is money RECEIVED today, keyed on the business day", "read GET /khata",
  () => /lfh_khata_collected", \{ p_restaurant_ids: \[rid\], p_from: businessDayStartIso\(\)/.test(B("khata")));
check(nid(), "…and every rupee figure is rounded to the paisa, not left as a float", "read GET /khata",
  () => count(B("khata"), /Math\.round\(/g) >= 3 && count(B("khata"), /\* 100\) \/ 100/g) >= 3);
check(nid(), "…driven live it answers people, a total and today's collection", "driven live",
  () => needLive("khata") || (live("khata").status !== 200 ? { ok: live("khata").status === 403, note: "refused, honestly" }
    : Array.isArray(J("khata").customers) && typeof J("khata").total === "number" && typeof J("khata").collectedToday === "number"));
check(nid(), "the person picker is capped at 8 rows, which is what the sheet shows", "read GET /khata/customers",
  () => /\.limit\(8\)/.test(B("khata/customers")));
check(nid(), "…and its search also goes through safeSearch", "read GET /khata/customers", () => /safeSearch\(new URL\(req\.url\)\.searchParams\.get\("q"\), 60\)/.test(B("khata/customers")));

// ── onhouse ────────────────────────────────────────────────────────────────────────────────────
check(nid(), "the On-the-house report needs the Dashboard permission, because that is where it lives", "read GET /onhouse",
  () => /managerCan\(g, rid, "view_dashboard"\)\)\) return permDenied\("view the dashboard"\)/.test(B("onhouse")));
check(nid(), "…it is keyed on the reserved payment method, so it lists exactly the comped bills", "read GET /onhouse",
  () => /\.eq\("payment_method", ON_THE_HOUSE_METHOD\)/.test(B("onhouse")));
check(nid(), "…?days= is clamped to 1…365 however big a number is typed", "read GET /onhouse",
  () => /Math\.min\(Math\.max\(Math\.round\(Number\([\s\S]{0,80}?\|\| 30, 1\), 365\)/.test(B("onhouse")));
check(nid(), "…driven with days=99999 it still answers, clamped", "driven live",
  () => needLive("onhouseDays") || ({ ok: live("onhouseDays").status === 200 || live("onhouseDays").status === 403, note: `status ${live("onhouseDays").status}` }));
check(nid(), "…orders are grouped into BILLS by session, like every other money view", "read GET /onhouse",
  () => /const key = o\.session_id \|\| o\.id;/.test(B("onhouse")));
check(nid(), "…and the read is bounded", "read GET /onhouse", () => /\.limit\(1000\)/.test(B("onhouse")));

// ── all ────────────────────────────────────────────────────────────────────────────────────────
check(nid(), "the boot bundle is five reads in parallel, not five round trips", "read GET /all", () => /await Promise\.all\(\[/.test(B("all")));
check(nid(), "…the select(*) reads are bounded so they can never become a whole-table scan", "read GET /all",
  () => count(B("all"), /\.limit\(/g) >= 3);
check(nid(), "…the restaurant's own identity rides along, so a printed bill is white-labelled to THIS restaurant", "read GET /all",
  () => /from\("restaurants"\)\.select\("id, slug, name, logo_text, accent_color, logo_url"\)/.test(B("all")));
check(nid(), "…and the settings row is put through panelSafeSettings on the way out", "read GET /all",
  () => /settings: panelSafeSettings\(must\(settings\)\)/.test(B("all")));
check(nid(), "…driven live, the bundle carries the four things the panel boots from", "driven live",
  () => needLive("all") || (Array.isArray(J("all").items) && Array.isArray(J("all").categories) && Array.isArray(J("all").filters) && !!J("all").settings));
check(nid(), "…and it is THIS restaurant's identity, not restaurant #1's, that comes back", "driven live",
  () => needLive("all") || (J("all").restaurant && typeof J("all").restaurant.id === "string" && J("all").restaurant.id.length === 36));
check(nid(), "…nothing in the bundle reads as leaked code text", "driven live, the JSON read as a person would read it",
  () => needLive("all") || ({ ok: !NOISE.test(JSON.stringify(J("all").restaurant || {}) + JSON.stringify(J("all").settings || {}).slice(0, 4000)), note: "" }));

// ── ratings ────────────────────────────────────────────────────────────────────────────────────
check(nid(), "guest ratings need the view_ratings power", "read GET /ratings", () => /managerCan\(g, rid, "view_ratings"\)\)\) return permDenied\("see guest ratings"\)/.test(B("ratings")));
check(nid(), "…the summary comes from one RPC, scoped to this restaurant", "read GET /ratings", () => /lfh_ratings_summary", \{ p_ids: \[rid\] \}/.test(B("ratings")));
check(nid(), "…the list names its columns and is capped at 200", "read GET /ratings", () => /\.limit\(200\)/.test(B("ratings")) && /select\("id, rating, comment, name, table_number, created_at, acknowledged/.test(B("ratings")));
check(nid(), "…?filter=unhandled narrows on the SERVER, not in the browser", "read GET /ratings", () => /rq = rq\.eq\("acknowledged", false\)/.test(B("ratings")));
check(nid(), "…a failed summary read does NOT hand the database's own sentence to the screen", "read GET /ratings",
  () => { const bad = [...B("ratings").matchAll(/err\([^;]{0,120}?\.error\.message/g)].map((m) => m[0].replace(/\s+/g, " "));
    return { ok: bad.length === 0, note: bad.join(" | ") }; });

// ── calls / issues / sessions ──────────────────────────────────────────────────────────────────
check(nid(), "waiter calls can be refetched for ONE table, so a breadcrumb never re-reads the floor", "read GET /calls", () => /cq = cq\.eq\("table_number", tbl\)/.test(B("calls")));
check(nid(), "…and the list is capped at 100", "read GET /calls", () => /\.limit\(100\)/.test(B("calls")));
check(nid(), "…driven live, both shapes answer a list", "driven live",
  () => needLive("calls") || (Array.isArray(J("calls")) && Array.isArray(J("callsTable"))));
check(nid(), "a complaint's photo or voice note is handed over as a SHORT-LIVED link, never the permanent one", "read GET /issues",
  () => /signRows\("issue-media", rows[\s\S]{0,80}?\["image_url", "audio_url"\]\)/.test(B("issues")));
check(nid(), "…open complaints come before resolved ones", "read GET /issues", () => /\.order\("status", \{ ascending: true \}\)/.test(B("issues")));
check(nid(), "…and the list is capped", "read GET /issues", () => /\.limit\(100\)/.test(B("issues")));
check(nid(), "the whole floor is assembled in ONE database call, not four round trips", "read GET /sessions", () => /lfh_floor_bundle/.test(B("sessions")));
check(nid(), "…?table=N asks for one table's slice", "read GET /sessions", () => /p_table: tbl \|\| null/.test(B("sessions")));
check(nid(), "…and an empty floor is an empty shape, never a null the panel would throw on", "read GET /sessions",
  () => /ok\(data \|\| \{ sessions: \[\], members: \[\], items: \[\], requests: \[\], blocklist: \[\] \}\)/.test(B("sessions")));
check(nid(), "…driven live, both shapes answer the five lists", "driven live",
  () => needLive("sessions") || (J("sessions") && ["sessions", "members", "items", "requests", "blocklist"].every((k) => Array.isArray(J("sessions")[k]))));

// ── platform ───────────────────────────────────────────────────────────────────────────────────
check(nid(), "the Platform board is refused only when BOTH modules are off", "read GET /platform",
  () => /if \(!plat\.effective && !parc\.effective\) return err\("The Platform board isn't enabled/.test(B("platform")));
check(nid(), "…a restaurant with every channel off gets an empty board and NO query at all", "read GET /platform",
  () => /if \(!sources\.length\) return ok\(\{ orders: \[\]/.test(B("platform")));
check(nid(), "…the polled read names its columns instead of dragging the whole webhook body back", "read GET /platform",
  () => /select\("id,source,items,total,status,kot_no,bill_no,invoice_no,invoice_at,created_at,customer_name,customer_phone,paid,printed_at,payment_method/.test(B("platform")));
check(nid(), "…the discount comes across as two JSON paths, not as the payload column", "read GET /platform",
  () => /discount:payload->discount,discount_note:payload->>discount_note/.test(B("platform")));
check(nid(), "…a handed-over ticket lingers about six minutes and then leaves the board", "read GET /platform",
  () => /Date\.now\(\) - 6 \* 60 \* 1000/.test(B("platform")));
check(nid(), "…cancelled tickets never show", "read GET /platform", () => !/status\.eq\.cancelled/.test(B("platform")));
check(nid(), "…and the board is capped at 200 rows", "read GET /platform", () => /\.limit\(200\)/.test(B("platform")));
check(nid(), "…driven live it answers the board plus which channels are live", "driven live",
  () => needLive("platform") || (live("platform").status !== 200 ? { ok: live("platform").status === 403, note: "refused, honestly" }
    : Array.isArray(J("platform").orders) && !!J("platform").channels));

// ── the Bills record window ────────────────────────────────────────────────────────────────────
const ORD = B("orders");
check(nid(), "a DELETED bill leaves the manager panel entirely", "read GET /orders", () => /oq = oq\.is\("deleted_at", null\)/.test(ORD));
check(nid(), "…and that filter is applied to the working list, not to the day's takings", "read GET /orders + /zreport",
  () => /oq = oq\.is\("deleted_at", null\)/.test(ORD) && !/deleted_at/.test(B("zreport").slice(0, B("zreport").indexOf("const [invQ"))));
check(nid(), "the bills window is computed on the SERVER, from the Access screen's own answer", "read GET /orders",
  () => /reach = billsReach\(\(await sb\.from\("restaurants"\)/.test(ORD));
check(nid(), "…and applied to the ?bills= fetch AND every ?history= search alike", "read GET /orders",
  () => /const wantsWindow = billsMode \|\| !!sp\.get\("history"\)/.test(ORD) && /if \(wantsWindow\) oq = oq\.gte\("created_at", windowStartIso\)/.test(ORD));
check(nid(), "…the plain LIVE floor read stays UNCLAMPED, so an open table's food cannot vanish at 5am", "read GET /orders",
  // The date SEARCH sets its own window and is not the board — only the window clamp counts here.
  () => ({ ok: count(ORD, /oq = oq\.gte\("created_at", windowStartIso\)/g) === 1
    && /if \(wantsWindow\) oq = oq\.gte\("created_at", windowStartIso\)/.test(ORD),
    note: `${count(ORD, /oq = oq\.gte\("created_at", windowStartIso\)/g)} window clamps, ${count(ORD, /oq = oq\.gte\("created_at"/g)} date filters in all` }));
check(nid(), "…the bills read names its columns; the live floor read keeps select(*) for the board's own shape", "read GET /orders",
  () => /billsMode \? BILLS_COLS : "\*"/.test(ORD));
check(nid(), "…and taxable_base + nontax_amount ride along, so a record card totals what the paper did", "read BILLS_COLS",
  () => /taxable_base,nontax_amount,mrp_amount,tax_rate/.test(ORD));
check(nid(), "an invoice pasted in whole resolves to its sequence number, not to a 13-digit nonsense", "read the inv/bill search",
  () => /histQ\.match\(\/\(\\d\+\)\(\?!\.\*\\d\)\/\)/.test(ORD));
check(nid(), "…and an unparseable one answers 'no bills', never a 500", "read the inv/bill search",
  () => /if \(!Number\.isFinite\(n\)\) return ok\(\[\]\)/.test(ORD));
check(nid(), "a DATE search means the restaurant's day in IST, not the server's timezone", "read the date search",
  () => /new Date\(`\$\{day\}T00:00:00\+05:30`\)/.test(ORD));
check(nid(), "…and an unparseable date answers 'no bills'", "read the date search", () => /if \(isNaN\(parsed\.getTime\(\)\)\) return ok\(\[\]\)/.test(ORD));
check(nid(), "…driven live with rubbish for a date, it answers an empty list and not an error", "driven live",
  () => needLive("ordersHistDate") || ({ ok: live("ordersHistDate").status === 200, note: `status ${live("ordersHistDate").status}` }));
check(nid(), "a CUSTOMER search resolves through session_members, because orders.customer_name is not a column", "read the cust search",
  () => /from\("session_members"\)\.select\("session_id"\)[\s\S]{0,120}?\.eq\("restaurant_id", rid\)\.ilike\("name"/.test(ORD));
check(nid(), "…and no match answers 'no bills'", "read the cust search", () => /if \(!sIds\.length\) return ok\(\[\]\)/.test(ORD));
check(nid(), "…driven live with a name nobody has, it answers an empty list", "driven live",
  () => needLive("ordersHistCust") || ({ ok: live("ordersHistCust").status === 200 && Array.isArray(J("ordersHistCust")) && J("ordersHistCust").length === 0, note: `status ${live("ordersHistCust").status}` }));
check(nid(), "the ONE-BOX search unions the fields instead of asking the person which one they meant", "read the any search",
  () => /const hit = new Set<string>\(\)/.test(ORD));
check(nid(), "…and it is still clamped to the same window as everything else on this path", "read the any search",
  () => /from\("sessions"\)[\s\S]{0,200}?gte\("created_at", /.test(ORD));
check(nid(), "…and it caps the sessions it will chase to 400", "read the any search", () => /\[\.\.\.hit\]\.slice\(0, 400\)/.test(ORD));
check(nid(), "the ONE-BOX search can still find a bill numbered TODAY on a table that opened LAST NIGHT", "read the window the sessions read uses",
  () => { const m = ORD.match(/from\("sessions"\)\.select\("id,bill_no,invoice_no,table_number,cust_name,cust_phone"\)[\s\S]{0,240}/);
    if (!m) return { ok: false, note: "the one-box sessions read is gone" };
    // A bill number is taken on the FIRST ORDER, not when the table opens (mig 040), so a session
    // created before the day boundary can carry TODAY's number. The Z-report says so in its own
    // comment. Filtering these sessions on created_at alone loses exactly that bill.
    const win = /gte\("created_at", windowStartIso\)/.test(m[0]);
    return { ok: !win, note: win ? "filtered on the session's own created_at, which a lazy bill number predates" : "" }; });
check(nid(), "each order carries its bill's invoice state, because an invoice lives on the session", "read the enrichment",
  () => /o\.invoice_no = s\.invoice_no; o\.invoice_voided = s\.invoice_voided/.test(ORD));
check(nid(), "…and whether the table is STILL SITTING, so the button picks the right door", "read the enrichment",
  () => /o\.session_status = s\.status/.test(ORD));
check(nid(), "…and whether the bill has already been on paper, so the button can say Reprint", "read the enrichment",
  () => /o\.bill_printed_at = s\.bill_printed_at/.test(ORD));
check(nid(), "…and the signed verification line the bill prints", "read the enrichment", () => /o\.chain_seq = ch\.seq; o\.chain_hash = ch\.chain_hash/.test(ORD));
check(nid(), "…taking the LATEST chain link if a re-issue ever produced two", "read the enrichment",
  () => /if \(!prev \|\| Number\(c\.seq\) > Number\(prev\.seq\)\)/.test(ORD));
check(nid(), "…and how a split was really paid, attached to every order of the bill", "read the enrichment",
  () => /if \(parts && parts\.length\) o\.pay_parts = parts/.test(ORD));
check(nid(), "the split parts read is scoped, columned and bounded", "read the enrichment",
  () => /from\("session_payments"\)\.select\("session_id,amount,method,note,created_at"\)[\s\S]{0,160}?\.limit\(2000\)/.test(ORD));
check(nid(), "…and a failure to read them is NOT fatal — the bill's own total still comes back", "read the enrichment",
  () => /for \(const pp of \(\(payQ\.data \|\| \[\]\)/.test(ORD));
check(nid(), "finished PARCEL bills ride along in the Bills record, inside the same window", "read the bills branch",
  () => /\.in\("status", \["handed_over", "cancelled"\]\)[\s\S]{0,120}?\.gte\("created_at", windowStartIso\)/.test(ORD));
check(nid(), "…only when the parcel module is on for this restaurant", "read the bills branch", () => /\(await parcelLadder\(rid\)\)\.effective/.test(ORD));
check(nid(), "…and the bills answer says how far back it reached, so the screen can label itself", "read the bills branch",
  () => /return ok\(\{ rows: orders, parcels, reach \}\)/.test(ORD));
check(nid(), "the live floor slice returns only the party sitting there NOW", "read the ?table= branch",
  () => /oq\.eq\("table_number", tbl\)\.eq\("archived", false\)\.is\("deleted_at", null\)/.test(ORD));
check(nid(), "…and a MERGED table's party is its parent's", "read the ?table= branch",
  () => /from\("table_merges"\)\.select\("parent_table"\)[\s\S]{0,180}?\.eq\("child_table", tbl\)/.test(ORD));
check(nid(), "…a party-less row counts only if it appeared AFTER the party sat down", "read the ?table= branch",
  () => /and\(session_id\.is\.null,created_at\.gte\.\$\{since\}\)/.test(ORD));
check(nid(), "…with 60 seconds of slack for an order that landed just before its session row existed", "read the ?table= branch",
  () => /- 60_000\)/.test(ORD));
check(nid(), "…and with sessions ON and no open party, the table holds nothing", "read the ?table= branch",
  () => /if \(setRow\?\.sessions_enabled\) oq = oq\.is\("session_id", null\)/.test(ORD));
check(nid(), "…driven live, one table's slice answers a list", "driven live",
  () => needLive("ordersTable") || ({ ok: Array.isArray(J("ordersTable")), note: `status ${live("ordersTable").status}` }));
check(nid(), "…and the bills window answers rows + parcels + reach", "driven live",
  () => needLive("ordersBills") || (J("ordersBills") && Array.isArray(J("ordersBills").rows) && Array.isArray(J("ordersBills").parcels) && typeof J("ordersBills").reach === "string"));
check(nid(), "…and every bill row it hands back belongs to this restaurant's own window", "driven live, dates read",
  () => { if (!live("ordersBills")) return "skip: no live answer";
    const r = J("ordersBills"); if (!r || !Array.isArray(r.rows) || !r.rows.length) return { ok: true, note: "no bills in the window today" };
    const days = r.reach === "today_yesterday" ? 2 : 1;
    const floor = Date.now() - (days + 1) * 864e5;
    const old = r.rows.filter((o) => new Date(o.created_at).getTime() < floor);
    return { ok: old.length === 0, note: old.length ? `${old.length} rows older than the window` : `${r.rows.length} rows, all inside it` }; });
check(nid(), "…and none of them is a binned bill", "driven live",
  () => { if (!live("ordersBills")) return "skip: no live answer";
    const rows = (J("ordersBills") || {}).rows || [];
    const del = rows.filter((o) => o.deleted_at);
    return { ok: del.length === 0, note: del.length ? `${del.length} deleted bills reached the panel` : `${rows.length} rows, none binned` }; });
