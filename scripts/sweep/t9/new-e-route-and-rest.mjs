// SWEEP #8 · T9 · NEW CHECKS, block E — P62951–P63200.
// The route's own endpoints end to end, the ⋯ menu machinery, the "Sold out only" filter, the
// whole-table note, the guest chime contract, and the card-forget path.
import { row, APP, APPC, HTML, CSS, ROUTE, ROUTEC, PAGE, has, hasRe, lacks, lacksRe, P, src, contentHash } from "./lib.mjs";
import { readFileSync } from "node:fs";

const slice = (from, to) => { const a = APPC(); const i = a.indexOf(from); const j = a.indexOf(to); return i < 0 || j < 0 ? "" : a.slice(i, j); };
const rslice = (from, to) => { const r = ROUTEC(); const i = r.indexOf(from); const j = r.indexOf(to); return i < 0 || j < 0 ? "" : r.slice(i, j); };

// ══ E1 · THE GATE AND THE SCOPE ON EVERY REQUEST — P62951–P62985 ══
row("P62951", "the route gates every request through requireRole(\"kitchen\")", () => hasRe(ROUTEC(), /const g = await requireRole\(req, "kitchen"\);/));
row("P62952", "a database blip answers 503, so the panel stays logged in and retries", () =>
  hasRe(ROUTEC(), /return g\.transient\s*\n?\s*\? NextResponse\.json\(\{ error: "Server can't reach the database — retrying\." \}, \{ status: 503 \}\)/));
row("P62953", "only a genuinely bad cookie gets the 401 that bounces to /login", () =>
  hasRe(ROUTEC(), /: NextResponse\.json\(\{ error: "Not authorised — please log in\." \}, \{ status: 401 \}\)/));
row("P62954", "the GET handler gates before it reads anything", () => {
  const r = ROUTEC();
  const get = r.slice(r.indexOf("export async function GET("));
  return (get.indexOf("const g = await gate(req)") < get.indexOf("panelRestaurantId")) || "the restaurant is resolved before the gate";
});
row("P62955", "the POST handler gates before it reads anything", () => {
  const r = ROUTEC();
  const post = r.slice(r.indexOf("async function postImpl("));
  return (post.indexOf("const g = await gate(req)") < post.indexOf("panelRestaurantId")) || "the restaurant is resolved before the gate";
});
row("P62956", "both handlers refuse without a restaurant scope", () =>
  ((ROUTEC().match(/return err\("No restaurant scope — open this panel from the admin console\.", 400\)/g) || []).length === 2) || "one handler can run unscoped");
row("P62957", "the endpoint path is resolved OUTSIDE the try, so a failure can name what failed", () => {
  const r = ROUTEC();
  return ((r.match(/const \{ path = \[\] \} = await ctx\.params;\s*\n\s*try \{/g) || []).length === 2) || "the path is resolved inside the try";
});
row("P62958", "a caught GET failure names the endpoint in the log", () => hasRe(ROUTEC(), /detail: `GET \$\{path\.join\("\/"\) \|\| "\/"\}`/));
row("P62959", "a caught POST failure names the endpoint in the log", () => hasRe(ROUTEC(), /detail: `POST \$\{path\.join\("\/"\) \|\| "\/"\}`/));
row("P62960", "a caught failure is only logged when it is worth logging", () =>
  ((ROUTEC().match(/if \(worthLogging\(e\)\) logError\("kitchen"/g) || []).length === 2) || "a database refusal floods the log");
row("P62961", "both handlers answer through the ONE shared panelFailure(), so busy is told apart from broken", () =>
  ((ROUTEC().match(/return panelFailure\(e\);/g) || []).length === 2) || "one handler has its own error answer");
row("P62962", "must() keeps the SQLSTATE on the thrown error, which is what tells a refused value from a dead server", () =>
  hasRe(ROUTEC(), /e\.code = r\.error\.code; e\.details = r\.error\.details;/));
row("P62963", "an unknown GET endpoint answers 404, not 200", () => hasRe(ROUTEC(), /return err\("unknown GET endpoint", 404\)/));
row("P62964", "an unknown POST endpoint answers 404, not 200", () => hasRe(ROUTEC(), /return err\("unknown POST endpoint", 404\)/));
row("P62965", "a body that is not JSON is read as an empty object, never a crash", () =>
  hasRe(ROUTEC(), /async function readBody\(req: NextRequest\): Promise<any> \{ try \{ return await req\.json\(\); \} catch \{ return \{\}; \} \}/));
row("P62966", "a literal \"undefined\"/\"null\"/\"NaN\" id is refused before it reaches a uuid query", () =>
  hasRe(ROUTEC(), /if \(emptyIdSegment\(b\) \|\| emptyIdSegment\(c\)\) return err\("Missing id — please refresh and try again\."\)/));
row("P62967", "an offline replay is checked for a moved-underneath clash before it is applied", () =>
  hasRe(ROUTEC(), /const clash = await replayClash\(req, rid, a, b, c, body as Record<string, unknown> \| null\);\s*\n?\s*if \(clash\) return clashJson\(clash\);/));
row("P62968", "a live write costs no clash query at all", () => hasRe(ROUTE(), /A LIVE write carries no replay marker, so this returns without a single query/));
row("P62969", "the no-silent-overwrite gate runs for every action on this route, in one place", () =>
  hasRe(ROUTEC(), /const overwrite = await expectClash\(req, rid\);\s*\n?\s*if \(overwrite\) return clashJson\(overwrite\);/));
row("P62970", "the route is force-dynamic, so a board read is never served from a build cache", () => has(ROUTEC(), 'export const dynamic = "force-dynamic"'));
row("P62971", "the station heartbeat can never be the reason a board read fails", () => {
  // Stripping the comment out of `catch { /* … */ }` leaves `catch {  }` — two spaces — so the
  // pattern is written against the stripped shape rather than the source's.
  const f = rslice("async function touchStationSafe", "async function tableTagMap");
  return (/if \(!dev\) return;/.test(f) && /try \{[\s\S]*\} catch \{\s*\}/.test(f)) || "the heartbeat is not both device-guarded and swallowed";
});
row("P62972", "the heartbeat is only sent when this screen holds the station", () => hasRe(ROUTEC(), /if \(station\.mine\) await touchStationSafe\(rid, boardDev\);/));
row("P62973", "the table-mark read returns empty rather than failing the board", () => {
  const f = rslice("async function tableTagMap(rid: string)", "const must = (r: any)");
  return hasRe(f, /\} catch \{[\s\S]{0,200}return \{\};/);
});
row("P62974", "the table-mark read is scoped to this restaurant and limited", () =>
  hasRe(ROUTEC(), /from\("table_tags"\)\.select\("table_number, tag"\)\s*\n?\s*\.eq\("restaurant_id", rid\)\.limit\(500\)/));
row("P62975", "a restaurant with the marks module off gets an empty map, not marks nobody can clear", () =>
  hasRe(ROUTEC(), /if \(!\(await tableTagsLadder\(rid\)\)\.effective\) return \{\};/));
row("P62976", "the mark map keys are trimmed strings, so a stray space cannot break the lookup", () =>
  hasRe(ROUTEC(), /const t = String\(r\?\.table_number \?\? ""\)\.trim\(\);/));
row("P62977", "only genuinely marked tables get an entry", () => hasRe(ROUTEC(), /if \(t && tag\) out\[t\] = tag;/));
row("P62978", "the board read asks for one restaurant's menu items with an explicit column list and a limit", () =>
  hasRe(ROUTEC(), /from\("menu_items"\)\.select\("id,title,category,tags"\)\.eq\("restaurant_id", rid\)\.order\("category"\)\.limit\(2000\)/));
row("P62979", "the platform read drops the two big JSON columns and keeps every small one", () => {
  const sel = (ROUTEC().match(/from\("aggregator_orders"\)\.select\("([^"]+)"\)/) || [])[1] || "";
  return (!/payload/.test(sel) && !/status_history/.test(sel) && /kot_no/.test(sel)) || `the platform column list is ${sel}`;
});
row("P62980", "the platform read is scoped, status-filtered, ordered and limited", () =>
  hasRe(ROUTEC(), /from\("aggregator_orders"\)[\s\S]{0,400}\.eq\("restaurant_id", rid\)\.in\("status", \["new", "accepted", "preparing", "ready"\]\)\.order\("created_at"\)\.limit\(500\)/));
row("P62981", "the settings read names exactly the columns the board needs", () =>
  hasRe(ROUTEC(), /from\("settings"\)\.select\("kitchen_can_accept_platform, auto_print_kot, auto_print_kot_allowed, platform_channels, table_names"\)\.eq\("restaurant_id", rid\)\.maybeSingle\(\)/));
row("P62982", "the restaurant read is a single-row lookup with a column list", () =>
  hasRe(ROUTEC(), /from\("restaurants"\)\.select\("id, slug, name, logo_text, accent_color"\)\.eq\("id", rid\)\.maybeSingle\(\)/));
row("P62983", "the eight board reads run in parallel, not one after another", () =>
  hasRe(ROUTEC(), /const \[live, dishes, platform, settings, restaurant, platL, parcL, tableTags\] = await Promise\.all\(\[/));
row("P62984", "the targeted slice runs its three reads in parallel too", () =>
  hasRe(ROUTEC(), /const \[live, tags, sliceJobs\] = await Promise\.all\(\[/));
row("P62985", "the raw who-punched-it columns never leave the server", () =>
  ((ROUTEC().match(/stripPlacedBy\(live\.orders, true\)/g) || []).length === 2) || "one of the two board answers ships the raw columns");

// ══ E2 · WHICH TICKETS THE BOARD IS ALLOWED TO SHOW — P62986–P63010 ══
row("P62986", "a delivery channel only reaches the board when its module is effective AND the channel is on", () =>
  hasRe(ROUTEC(), /if \(platL\.effective\) \{ if \(kOn\("zomato"\)\) kSources\.add\("zomato"\); if \(kOn\("swiggy"\)\) kSources\.add\("swiggy"\); if \(kOn\("website"\)\) kSources\.add\("takeaway"\); \}/));
row("P62987", "a parcel reaches the board only when the parcel module is effective", () => hasRe(ROUTEC(), /if \(parcL\.effective\) kSources\.add\("parcel"\);/));
row("P62988", "the website channel is shown to the kitchen as \"takeaway\"", () => hasRe(ROUTEC(), /kOn\("website"\)\) kSources\.add\("takeaway"\)/));
row("P62989", "a channel switched off mid-service drops its tickets off the board too", () =>
  hasRe(ROUTEC(), /const platformRows = \(\(must\(platform\) \|\| \[\]\) as \{ source\?: string \}\[\]\)\.filter\(\(r\) => kSources\.has\(String\(r\.source\)\)\)/));
row("P62990", "a missing platform_channels object is read as nothing on, not as everything on", () =>
  hasRe(ROUTEC(), /\.platform_channels \|\| \{\}/));
row("P62991", "a channel is on only when it says so explicitly", () => hasRe(ROUTEC(), /const kOn = \(k: string\) => kChan\?\.\[k\]\?\.on === true;/));
row("P62992", "the board only ever ships received/preparing orders — a served one has left it", () =>
  hasRe(ROUTEC(), /liveOrdersAndItems\(rid, undefined, true\)/));
row("P62993", "the targeted slice filters the same way, server-side", () => hasRe(ROUTEC(), /liveOrdersAndItems\(rid, \[tbl\], true\)/));
row("P62994", "the ?table= parameter must be a NUMBER, or a bad value would 500 the refetch", () =>
  hasRe(ROUTEC(), /const tbl = tblRaw !== null && \/\^\\d\{1,6\}\$\/\.test\(tblRaw\.trim\(\)\) \? tblRaw\.trim\(\) : null;/));
row("P62995", "a bad ?table= means a FULL correct refresh, never an error", () => {
  const r = ROUTEC();
  const b = r.slice(r.indexOf("const tblRaw ="), r.indexOf("// Orders + dishes from the shared") > 0 ? r.indexOf("const [live, dishes, platform") : r.length);
  return hasRe(b, /if \(tbl\) \{/);
});
row("P62996", "the targeted slice answers ONLY orders, items, tags and jobs — never the whole board", () => {
  const r = ROUTEC();
  const ret = (r.match(/return ok\(\{ orders: stripPlacedBy\(live\.orders, true\), items: live\.items, tableTags: tags, printJobs: sliceJobs \}\)/) || [])[0];
  return !!ret || "the targeted slice's answer shape has changed";
});
row("P62997", "the table marks ride the targeted slice, or a new mark would wait for the 60s backstop", () =>
  hasRe(ROUTEC(), /tableTagMap\(rid\),\s*\n?\s*wantJobs \?/));
row("P62998", "the whoami answer is admin-only information and says so by shape", () =>
  hasRe(ROUTEC(), /return ok\(\{ actor, higherView: !g\.user && !simulate, simulated: simulate, asName: personLabel\(asPerson\) \}\)/));
row("P62999", "?view=real is only honoured for a request with NO staff cookie", () => hasRe(ROUTEC(), /const simulate = !g\.user && new URL\(req\.url\)\.searchParams\.get\("view"\) === "real";/));
row("P63000", "a signed-in cook is never told they are a higher view", () => hasRe(ROUTEC(), /higherView: !g\.user && !simulate/));
row("P63001", "the actor is the staff role when there is one, and admin when there is not", () =>
  hasRe(ROUTEC(), /const actor = g\.user \? g\.user\.role : simulate \? "kitchen" : "admin";/));
row("P63002", "the pinned person is resolved server-side, never taken from the query string", () =>
  hasRe(ROUTEC(), /const asPerson = await viewAsPerson\(req, rid, g, "kitchen"\);/));
row("P63003", "the auto-print flag the panel receives is BOTH the restaurant's setting and this room's turn", () =>
  hasRe(ROUTEC(), /autoPrintKot: autoOn && screenPrints/));
row("P63004", "autoOn requires the admin's allowance AND the owner's toggle", () =>
  hasRe(ROUTEC(), /const autoOn = !!\(\(must\(settings\) \|\| \{\}\)\.auto_print_kot && \(must\(settings\) \|\| \{\}\)\.auto_print_kot_allowed\);/));
row("P63005", "the self-healing net stands down when this room is not the printer", () =>
  hasRe(ROUTEC(), /const queuedFor = autoJobs && autoOn && screenPrints/));
row("P63006", "the queued-orders net is asked only about orders actually on the board", () =>
  hasRe(ROUTEC(), /\.filter\(\(o\) => o\.status === "received" \|\| o\.status === "preparing"\)\.map\(\(o\) => o\.id\)/));
row("P63007", "the retired \"both\" print target is gone from the route's derived answer", () => {
  const r = ROUTEC();
  const d = r.slice(r.indexOf("kotPrintTarget: target.kind"), r.indexOf("helper,"));
  return lacksRe(d, /"both"/);
});
row("P63008", "the derived kotPrintTarget keeps its three-value name so a weeks-old panel still reads it", () =>
  hasRe(ROUTEC(), /kotPrintTarget: target\.kind === "screen"\s*\n?\s*\? \(target\.panel === "manager" \? "counter" : "kitchen"\)\s*\n?\s*: "kitchen"/));
row("P63009", "the board ships the table display names, so the ticket reads what is written on the table", () =>
  hasRe(ROUTEC(), /tableNames: \(\(must\(settings\) \|\| \{\}\) as \{ table_names\?: Record<string, string> \}\)\.table_names \|\| \{\}/));
row("P63010", "the board ships the table marks", () => hasRe(ROUTEC(), /\n        tableTags,/));

// ══ E3 · THE FIVE WRITE PATHS, IN DETAIL — P63011–P63070 ══
const ACC = () => rslice('if (a === "orders" && c === "accept")', 'if (a === "orders" && c === "ready")');
const RDY = () => rslice('if (a === "orders" && c === "ready")', 'if (a === "orders" && c === "unready")');
const UNR = () => rslice('if (a === "orders" && c === "unready")', 'if (a === "items" && c === "status")');
const ITM = () => rslice('if (a === "items" && c === "status")', 'if (a === "platform" && c === "status")');
const PLT = () => rslice('if (a === "platform" && c === "status")', 'if (a === "dishes" && c === "sold-out")');
const SO = () => rslice('if (a === "dishes" && c === "sold-out")', 'if (a === "print-jobs" && b === "claim")');

row("P63011", "accept reads the order scoped to this restaurant before touching it", () => hasRe(ACC(), /\.eq\("id", b\)\.eq\("restaurant_id", rid\)\.maybeSingle\(\)/));
row("P63012", "accept refuses an order that is not on this restaurant's board, by name", () =>
  hasRe(ACC(), /if \(!cur\) return err\("That order isn't on this restaurant's board any more\.", 404\)/));
row("P63013", "accept never un-serves a dish that has already gone out", () => hasRe(ACC(), /i\.status === "served" \? "served" : "preparing"/));
row("P63014", "accept tolerates an order whose items JSON is not an array", () => hasRe(ACC(), /Array\.isArray\(cur\.items\) \? cur\.items\.map/));
row("P63015", "accept's update is scoped by restaurant as well as by id", () => hasRe(ACC(), /\.update\(\{ items, status: "preparing" \}\)\.eq\("id", b\)\.eq\("restaurant_id", rid\)/));
row("P63016", "accept only promotes the order_items rows that are still 'received'", () =>
  hasRe(ACC(), /\.update\(\{ status: "preparing" \}\)\.eq\("order_id", b\)\.eq\("restaurant_id", rid\)\.eq\("status", "received"\)/));
row("P63017", "accept is logged with the order and the device", () => hasRe(ACC(), /logAction\("kitchen", "order_accept", \{ \.\.\.adminMark, order_id: b, device_id: dev, restaurant_id: rid \}\)/));
row("P63018", "ready refuses a missing order the same way accept does", () =>
  hasRe(RDY(), /if \(!cur\) return err\("That order isn't on this restaurant's board any more\.", 404\)/));
row("P63019", "ready marks every not-served dish ready, and leaves served alone", () => hasRe(RDY(), /i\.status === "served" \? "served" : "ready"/));
row("P63020", "ready leaves the ORDER at 'preparing' — serving is the waiter's action", () =>
  hasRe(RDY(), /\.update\(\{ items, status: "preparing" \}\)/));
row("P63021", "ready's order_items update skips served rows", () => hasRe(RDY(), /\.neq\("status", "served"\)/));
row("P63022", "ready is logged", () => hasRe(RDY(), /logAction\("kitchen", "order_ready"/));
row("P63023", "unready refuses a missing order", () => hasRe(UNR(), /if \(!cur\) return err\("That order isn't on this restaurant's board any more\.", 404\)/));
row("P63024", "unready only accepts the three pre-served statuses", () => hasRe(UNR(), /const VALID = \["received", "preparing", "ready"\];/));
row("P63025", "unready coerces and drops anything unusable from the snapshot", () =>
  hasRe(UNR(), /\.map\(\(d: any\) => \(\{ id: String\(d\?\.id \?\? ""\), prev: String\(d\?\.prev \?\? ""\) \}\)\)/));
row("P63026", "unready caps the snapshot, because a ticket has tens of lines and never thousands", () => hasRe(UNR(), /\.slice\(0, 200\)/));
row("P63027", "unready refuses an empty snapshot with a sentence a person can act on", () =>
  hasRe(UNR(), /if \(!snap\.length\) return err\("Nothing to take back — refresh the board and try again\.", 400\)/));
row("P63028", "unready confirms every id really belongs to THIS order in THIS restaurant", () =>
  hasRe(UNR(), /\.eq\("order_id", b\)\.eq\("restaurant_id", rid\)\s*\n?\s*\.in\("id", snap\.map/));
row("P63029", "unready skips an id that is gone, or was never ours", () => hasRe(UNR(), /if \(wasNow === undefined\) continue;/));
row("P63030", "unready leaves a SERVED dish alone — un-serving is the tablet's own action", () => hasRe(UNR(), /if \(wasNow === "served"\) continue;/));
row("P63031", "unready skips a dish that is already where it is being put back to", () => hasRe(UNR(), /if \(wasNow === d\.prev\) continue;/));
row("P63032", "unready groups by target status, so a mixed ticket costs at most three updates", () =>
  hasRe(UNR(), /const groups = new Map<string, string\[\]>\(\);/));
row("P63033", "unready answers 409 when every dish has already moved on", () =>
  hasRe(UNR(), /if \(!groups\.size\) return err\("Those dishes have already moved on — refresh the board\.", 409\)/));
row("P63034", "unready clears served_at, so a row never keeps a time it no longer earns", () =>
  hasRe(UNR(), /\.update\(\{ status, served_at: null \}\)/));
row("P63035", "each unready update is scoped by order AND restaurant as well as by id", () =>
  hasRe(UNR(), /\.in\("id", ids\)\.eq\("order_id", b\)\.eq\("restaurant_id", rid\)/));
row("P63036", "unready rolls the parent order up from what the rows now say", () =>
  hasRe(UNR(), /const rows = must\(await sb\.from\("order_items"\)\.select\("status"\)\.eq\("order_id", b\)\.eq\("restaurant_id", rid\)\)/));
row("P63037", "the unready rollup is the SAME formula the single-dish path uses", () => {
  const u = UNR(), i = ITM();
  const f = /const overall = served === rows\.length && rows\.length > 0 \? "served" : anyActive \? "preparing" : "received";/;
  return (f.test(u) && f.test(i)) || "the two rollups have drifted apart";
});
row("P63038", "unready counts how many dishes moved, and says so in the log", () => hasRe(UNR(), /detail: `\$\{moved\} \$\{moved === 1 \? "dish" : "dishes"\} taken back`/));
row("P63039", "unready answers the count, so the panel can report honestly", () => hasRe(UNR(), /return ok\(\{ ok: true, count: moved \}\)/));
row("P63040", "items/status refuses a status that is not one of the four", () => hasRe(ITM(), /if \(!\["received", "preparing", "ready", "served"\]\.includes\(status\)\) return err\("invalid status"\)/));
row("P63041", "serving stamps served_at and any pre-served state clears it", () => hasRe(ITM(), /patch\.served_at = status === "served" \? nowIso\(\) : null;/));
row("P63042", "the dish update is scoped by restaurant, so a foreign id cannot be advanced", () =>
  hasRe(ITM(), /\.update\(patch\)\.eq\("id", b\)\.eq\("restaurant_id", rid\)\.select\("order_id"\)/));
row("P63043", "a tap that moved NO row answers 404 instead of reporting success", () =>
  hasRe(ITM(), /if \(!item\) return err\("That dish isn't on this restaurant's board any more — refresh and try again\.", 404\)/));
row("P63044", "the rollup only runs when the row had a parent order", () => hasRe(ITM(), /if \(item\.order_id\) \{/));
row("P63045", "the rollup update is scoped by restaurant", () => hasRe(ITM(), /\.update\(\{ status: overall \}\)\.eq\("id", item\.order_id\)\.eq\("restaurant_id", rid\)/));
row("P63046", "an order with zero rows never rolls up to 'served'", () => hasRe(ITM(), /served === rows\.length && rows\.length > 0/));
row("P63047", "moving one dish along is logged, which is what makes a cook's own Activity honest", () => hasRe(ITM(), /logAction\("kitchen", "item_status"/));
row("P63048", "platform/status refuses a status outside its four", () => hasRe(PLT(), /if \(!\["accepted", "preparing", "ready", "handed_over"\]\.includes\(status\)\) return err\("invalid status"\)/));
row("P63049", "platform/status confirms the ticket belongs to this restaurant first, because the RPC has no scope", () =>
  hasRe(PLT(), /from\("aggregator_orders"\)\.select\("id, status"\)\.eq\("id", b\)\.eq\("restaurant_id", rid\)\.maybeSingle\(\)/));
row("P63050", "platform/status refuses a ticket from another restaurant, by name", () =>
  hasRe(PLT(), /if \(!owns\) return err\("That platform order isn't for this restaurant\.", 404\)/));
row("P63051", "the accept-gate keys on the CURRENT state being 'new', not on the requested status", () => hasRe(PLT(), /if \(owns\.status === "new"\) \{/));
row("P63052", "the refusal names who does accept them", () => has(PLT(), '"The kitchen isn\'t allowed to accept platform orders — the manager accepts them."'));
row("P63053", "the platform push-back is best-effort and cannot fail the write", () => hasRe(PLT(), /void notifyAggregator\(row\?\.source, row\?\.external_id, status\)/));
row("P63054", "the RPC's answer is normalised whether it comes back as a row or an array", () => hasRe(PLT(), /const row = Array\.isArray\(data\) \? data\[0\] : data;/));
row("P63055", "an RPC error is thrown, so it reaches the one shared failure answer", () => hasRe(PLT(), /if \(error\) throw new Error\(error\.message\);/));
row("P63056", "sold-out reads the dish scoped to this restaurant's menu", () => hasRe(SO(), /from\("menu_items"\)\.select\("tags"\)\.eq\("id", b\)\.eq\("restaurant_id", rid\)\.maybeSingle\(\)/));
row("P63057", "sold-out refuses a dish that is not on this menu", () => hasRe(SO(), /if \(!cur\) return err\("That dish isn't on this restaurant's menu\.", 404\)/));
row("P63058", "the toggle is an explicit SET, so a double tap is harmless", () => hasRe(SO(), /const value = !!\(body && body\.value === true\);/));
row("P63059", "the tag is removed first and re-added, so it can never appear twice", () =>
  hasRe(SO(), /const tags = Array\.isArray\(cur\.tags\) \? cur\.tags\.filter\(\(t: string\) => t !== "sold-out"\) : \[\];\s*\n?\s*if \(value\) tags\.push\("sold-out"\);/));
row("P63060", "a dish with a non-array tags column is handled, not crashed on", () => hasRe(SO(), /Array\.isArray\(cur\.tags\) \?/));
row("P63061", "the 86 also purges the guest menu's cached bundle, or guests keep ordering a sold-out dish", () =>
  hasRe(SO(), /revalidateTag\(menuTag\(rid\), \{ expire: 0 \}\)/));
row("P63062", "that purge uses expire: 0, because the \"max\" profile would hand the OLD bundle to the next guest", () => hasRe(SO(), /\{ expire: 0 \}/));
row("P63063", "the purge is best-effort — it must never fail the 86 itself", () => hasRe(SO(), /try \{ revalidateTag[\s\S]{0,60}\} catch \{/));
row("P63064", "the 86 is logged with which way it went", () => hasRe(SO(), /logAction\("kitchen", value \? "sold_out_on" : "sold_out_off", \{ \.\.\.adminMark, detail: b/));
row("P63065", "raising an issue refuses with the real reason rather than a generic failure", () =>
  hasRe(ROUTEC(), /catch \(e\) \{ return err\(e instanceof Error \? e\.message : "Couldn't raise the issue\.", 400\); \}/));
row("P63066", "an issue names who raised it and in what role", () =>
  hasRe(ROUTEC(), /raisedBy: g\.user\?\.name \|\| g\.user\?\.username \|\| "Kitchen",\s*\n?\s*raisedRole: g\.user\?\.role \|\| "kitchen",/));
row("P63067", "an issue's subject is coerced to a string", () => hasRe(ROUTEC(), /subject: String\(ib\?\.subject \|\| ""\)/));
row("P63068", "an issue is scoped to this restaurant", () => hasRe(ROUTEC(), /await raiseIssue\(\{\s*\n?\s*rid,/));
row("P63069", "every by-id write on this route carries .eq(\"restaurant_id\", rid)", () => {
  const r = ROUTEC();
  const byId = [...r.matchAll(/\.update\([\s\S]{0,200}?\)\s*\.eq\("id", (\w+)\)([\s\S]{0,80})/g)];
  const bad = byId.filter((m) => !/restaurant_id/.test(m[2]));
  return bad.length === 0 || `${bad.length} by-id update(s) with no restaurant filter`;
});
row("P63070", "the service-role client is the only one used, and the restaurant filter is therefore the boundary", () =>
  hasRe(ROUTE(), /import \{ supabaseAdmin as sb \} from "@\/lib\/supabaseAdmin"/));

// ══ E4 · THE ⋯ MENU MACHINERY — P63071–P63105 ══
const MORE = () => slice("const MORE_MQ =", "bindDelegation();");
row("P63071", "the ⋯ menu is phone-only, at a named breakpoint", () => hasRe(APPC(), /const MORE_MQ = "\(max-width: 760px\)";/));
row("P63072", "the breakpoint the JS uses matches the one the stylesheet hides ⋯ at", () => {
  const c = CSS();
  return hasRe(c, /max-width:\s*760px/);
});
row("P63073", "the menu is built once and never duplicated", () => hasRe(MORE(), /if \(!bar \|\| !btn \|\| morePop\) return;/));
row("P63074", "the menu is a role=menu for a screen reader", () => hasRe(MORE(), /morePop\.setAttribute\("role", "menu"\)/));
row("P63075", "the menu starts hidden", () => hasRe(MORE(), /morePop\.hidden = true;/));
row("P63076", "each row carries a WORD, because an emoji reads badly as a menu line", () => {
  const labels = [...MORE().matchAll(/\["(\w+)", "([^"]+)"\]/g)].map((m) => m[2]);
  return (labels.length === 4 && labels.every((l) => l.length > 4)) || `labels: ${labels.join(", ")}`;
});
row("P63077", "the four movers are the set-once controls, not anything used during service", () => {
  const ids = [...MORE().matchAll(/\["(\w+)", "[^"]+"\]/g)].map((m) => m[1]);
  return (JSON.stringify(ids) === JSON.stringify(["muteBtn", "viewBtn", "themeToggle", "reportIssueBtn"])) || `movers: ${ids.join(", ")}`;
});
row("P63078", "the controls are MOVED, not rebuilt, so their handlers and ids travel with them", () =>
  hasRe(MORE(), /if \(el && el\.parentElement !== row\) row\.appendChild\(el\)/));
row("P63079", "each control's ORIGINAL slot is recorded before anything moves", () =>
  hasRe(MORE(), /function rememberHomes\(ids\) \{[\s\S]{0,300}MORE_HOME\.set\(id, el\.nextElementSibling\)/));
row("P63080", "a home is recorded only once, so a later move cannot overwrite the true one", () => hasRe(MORE(), /if \(MORE_HOME\.has\(id\)\) continue;/));
row("P63081", "going back to desktop restores each control to its authored slot, not merely \"into the bar\"", () =>
  hasRe(MORE(), /acts\.insertBefore\(el, home && home\.parentElement === acts \? home : btn\)/));
row("P63082", "a remembered sibling that has since left the bar falls back rather than throwing", () =>
  hasRe(MORE(), /home && home\.parentElement === acts \? home : btn/));
row("P63083", "the menu is closed on the way back to desktop", () => hasRe(MORE(), /if \(window\.__kdsCloseMore\) window\.__kdsCloseMore\(\);/));
row("P63084", "opening the menu sets aria-expanded true", () => hasRe(MORE(), /btn\.setAttribute\("aria-expanded", "true"\)/));
row("P63085", "closing the menu sets aria-expanded false", () => hasRe(MORE(), /btn\.setAttribute\("aria-expanded", "false"\)/));
row("P63086", "closing an already-closed menu is a no-op, so the back layer cannot be released twice", () =>
  hasRe(MORE(), /if \(!morePop \|\| morePop\.hidden\) return;/));
row("P63087", "the ⋯ button's own click does not bubble out and immediately re-close the menu", () => hasRe(MORE(), /btn\.onclick = \(e\) => \{ e\.stopPropagation\(\);/));
row("P63088", "the outside-click listener does nothing while the menu is closed", () => hasRe(MORE(), /if \(morePop\.hidden\) return;/));
row("P63089", "a click on the ⋯ button itself is not treated as an outside click", () => hasRe(MORE(), /!e\.target\.closest\("#moreBtn"\)/));
row("P63090", "the menu closes only after the moved button's own handler has run", () => hasRe(MORE(), /setTimeout\(closeMore, 120\)/));
row("P63091", "a tap on the row's label, not the button, does not close the menu on nothing", () => hasRe(MORE(), /&& e\.target\.closest\("button"\)/));
row("P63092", "syncMoreMenu is idempotent, so calling it on every media change is safe", () => {
  const m = MORE();
  return (/if \(el && el\.parentElement !== row\)/.test(m) && /if \(!el \|\| el\.parentElement === acts\) continue;/.test(m)) || "one direction is not guarded";
});
row("P63093", "syncMoreMenu bails harmlessly when the bar is not on the page", () => hasRe(MORE(), /if \(!acts \|\| !btn\) return;/));
row("P63094", "a browser with no matchMedia keeps the desktop layout rather than throwing", () => hasRe(MORE(), /try \{ phone = window\.matchMedia\(MORE_MQ\)\.matches; \} catch \{ phone = false; \}/));
row("P63095", "the media listener is wrapped, so an older engine simply keeps the boot layout", () =>
  hasRe(MORE(), /try \{ window\.matchMedia\(MORE_MQ\)\.addEventListener\("change", syncMoreMenu\); \} catch \(e\) \{/));
row("P63096", "syncMoreMenu runs at boot, so a phone opens with the menu already correct", () => hasRe(MORE(), /\nsyncMoreMenu\(\);/));
row("P63097", "the menu is appended to the bar, so it inherits the bar's stacking and skin", () => hasRe(MORE(), /bar\.appendChild\(morePop\)/));
row("P63098", "the menu is outside .top-actions, so the phone word-hiding rule stops applying inside it", () => {
  const c = CSS();
  const hideRule = (c.match(/\.top-actions[^{]*\.bw\s*\{[^}]*\}/) || [""])[0];
  return (hideRule.length > 0) || has(c, ".kds-more-pop");
});
row("P63099", "every class the ⋯ menu renders is styled", () => {
  const used = new Set([...MORE().matchAll(/className = "([\w-]+)"/g)].map((m) => m[1]));
  const c = CSS();
  const unstyled = [...used].filter((k) => !c.includes("." + k));
  return unstyled.length === 0 || `rendered but never styled: ${unstyled.join(", ")}`;
});
row("P63100", "Escape closes the menu", () => hasRe(MORE(), /if \(e\.key === "Escape"\) closeMore\(\)/));
row("P63101", "the menu exposes its close function for the desktop flip", () => has(MORE(), "window.__kdsCloseMore = closeMore"));
row("P63102", "the four movers include Report an issue, matching the waiter tablet's drawer", () => has(MORE(), '"reportIssueBtn", "Report an issue"'));
row("P63103", "the connection light is NOT a mover — it is read during service", () => lacksRe(MORE(), /lfhConnBadge/));
row("P63104", "the 86 board button is NOT a mover", () => lacksRe(MORE(), /"boardBtn"/));
row("P63105", "the printer-problem button is NOT a mover", () => lacksRe(MORE(), /"printerBtn"/));

// ══ E5 · THE "SOLD OUT ONLY" FILTER, THE WHOLE-TABLE NOTE, THE CHIME — P63106–P63200 ══
const RD = () => slice("function renderDishes(", "const RT_VOLATILE");
const SON = () => slice("function sharedOrderNote(rows)", "function ticketHtml(");
row("P63106", "the drawer has a \"sold out only\" filter", () => has(RD(), 'id="outOnlyBtn"'));
row("P63107", "the filter is deliberately NOT remembered between opens", () => hasRe(APPC(), /state\.dishOutOnly = false;\s*\n?\s*\$\("#drawerOverlay"\)\.hidden = false/));
row("P63108", "the filter resets on the drawer OPEN, not on close, so a crash cannot leave it on", () => {
  const a = APPC();
  const open = a.slice(a.indexOf("function openDrawer()"), a.indexOf("function closeDrawer()"));
  return hasRe(open, /state\.dishOutOnly = false;/);
});
row("P63109", "the filter narrows the list, and the search still applies on top of it", () =>
  hasRe(RD(), /\.filter\(\(d\) => !q \|\| \(d\.title \|\| ""\)\.toLowerCase\(\)\.includes\(q\)\)\s*\n?\s*\.filter\(\(d\) => !outOnly \|\| isOut\(d\)\)/));
row("P63110", "the switch carries a COUNT, so a cook can answer \"how many are off?\" without opening it", () =>
  hasRe(RD(), /<span class="oc">\$\{outCount\}<\/span>/));
row("P63111", "that count is of the WHOLE menu, not of the filtered list", () => hasRe(RD(), /const outCount = state\.dishes\.filter\(isOut\)\.length;/));
row("P63112", "the switch says which state it is in, for a screen reader as well as visually", () =>
  hasRe(RD(), /aria-pressed="\$\{outOnly \? "true" : "false"\}"/));
row("P63113", "the switch shows a filled or hollow mark, not colour alone", () => hasRe(RD(), /\$\{outOnly \? "◉" : "○"\}/));
row("P63114", "an empty filtered list says \"Nothing is sold out right now\", not \"no dishes\"", () =>
  has(RD(), '"Nothing is sold out right now"'));
row("P63115", "a search inside the filter gets its own honest message", () => hasRe(RD(), /No sold-out dish matches “\$\{esc\(q\)\}”/));
row("P63116", "that message escapes what the cook typed", () => hasRe(RD(), /No sold-out dish matches “\$\{esc\(q\)\}”/));
row("P63117", "toggling the filter repaints the drawer", () => hasRe(RD(), /ob\.onclick = \(\) => \{ state\.dishOutOnly = !state\.dishOutOnly; renderDishes\(\); \}/));
row("P63118", "the count on the switch is patched in place when a dish is flipped", () =>
  hasRe(RD(), /const oc = document\.querySelector\("#outOnlyBtn \.oc"\);\s*\n?\s*if \(oc\) oc\.textContent = String\(state\.dishes\.filter\(isOut\)\.length\);/));
row("P63119", "flipping a dish deliberately does NOT rebuild the list, so the UNDO's row stays on screen", () => {
  const s = RD();
  const set86 = s.slice(s.indexOf("const set86 ="), s.indexOf("{ const ob = document.getElementById"));
  return lacksRe(set86, /renderDishes\(\)/);
});
row("P63120", "the empty-state row cannot be tapped", () => hasRe(RD(), /pointer-events:none/));
row("P63121", "a sold-out row is marked with a class as well as a word", () => hasRe(RD(), /class="dish-row \$\{out \? "is-out" : ""\}"/));
row("P63122", "the dish title and its category are both escaped", () => hasRe(RD(), /\$\{esc\(d\.title\)\}<small>\$\{esc\(d\.category \|\| ""\)\}<\/small>/));
row("P63123", "a dish with no category renders an empty label, never \"undefined\"", () => hasRe(RD(), /esc\(d\.category \|\| ""\)/));
row("P63124", "the toggle button says the STATE, not the action, so it cannot be misread", () => hasRe(RD(), /\$\{out \? "SOLD OUT" : "available"\}/));
row("P63125", "the .outfilter and .oc classes are styled", () => {
  const c = CSS();
  return (c.includes(".outfilter") && c.includes(".oc")) || "one of the switch's classes is unstyled";
});
row("P63126", "a whole-table instruction is drawn ONCE, above the dishes", () => has(APPC(), 'class="onote" title="This note is for the whole table"'));
row("P63127", "the note is only treated as order-wide when there is more than one dish", () => hasRe(SON(), /if \(!Array\.isArray\(rows\) \|\| rows\.length < 2\) return "";/));
row("P63128", "the note is only treated as order-wide when EVERY dish carries the identical text", () =>
  hasRe(SON(), /if \(n !== first\) return "";/));
row("P63129", "an empty first note means nothing is collapsed", () => hasRe(SON(), /if \(!first\) return "";/));
row("P63130", "the comparison is on trimmed text, so whitespace cannot split one instruction into two", () => {
  const s = SON();
  return ((s.match(/\.trim\(\)/g) || []).length >= 2) || "one side of the comparison is not trimmed";
});
row("P63131", "a null note is read as empty, not as the string \"null\"", () => hasRe(SON(), /rows\[0\]\.note != null \? String\(rows\[0\]\.note\) : ""/));
row("P63132", "a per-dish note that differs stays on its own line", () =>
  hasRe(APPC(), /if \(r\.note && !\(orderNote && String\(r\.note\)\.trim\(\) === orderNote\)\) segs\.push/));
row("P63133", "the collapsed note is escaped where it is drawn", () => has(APPC(), '✎ ${esc(orderNote)}'));
row("P63134", "the order-wide ALLERGY list is NOT collapsed — it stays on every dish (owner, 2026-06-14)", () =>
  hasRe(APPC(), /const lineRemoved = \[\.\.\.new Set\(\[\.\.\.\(Array\.isArray\(r\.removed\) \? r\.removed : \[\]\), \.\.\.orderAllergies\]\)\]/));
row("P63135", "the note sits ABOVE the dishes, because reading it after the food is reading it too late", () => {
  const a = APPC();
  const ret = a.slice(a.indexOf('return `<div class="ticket st-'));
  return (ret.indexOf("${orderNoteHtml}") < ret.indexOf("${lines}")) || "the note is drawn below the dishes";
});
row("P63136", "the .onote class is styled", () => has(CSS(), ".onote"));
row("P63137", "the chime keys on a flag the SERVER computes, not on member_id", () => hasRe(APPC(), /const guestPlaced = \(o\) => !!o && o\.guest === 1;/));
row("P63138", "that flag is only present when true, so a floor of waiter tickets costs nothing", () =>
  hasRe(readFileSync(P("lib/liveBoard.ts"), "utf8"), /guest/));
row("P63139", "the raw placed-by columns are stripped before the board leaves the server", () => {
  const lb = readFileSync(P("lib/liveBoard.ts"), "utf8");
  return has(lb, "stripPlacedBy");
});
row("P63140", "a brand-new 'received' order chimes", () => hasRe(APPC(), /o\.status === "received" \|\| \(o\.status === "preparing" && guestPlaced\(o\)\)/));
row("P63141", "a guest's follow-up order, born 'preparing', chimes too", () => hasRe(APPC(), /o\.status === "preparing" && guestPlaced\(o\)/));
row("P63142", "a brand-new PLATFORM order chimes on the full path", () => hasRe(APPC(), /const freshPlat = \(data\.platform \|\| \[\]\)\.some\(\(p\) => p\.status === "new" && !state\.knownIds\.has\(p\.id\)\)/));
row("P63143", "the chime is suppressed on the very first load", () => {
  const a = APPC();
  const li = a.slice(a.indexOf("async function loadImpl()"));
  return (li.indexOf("if (state.knownIds) {") < li.indexOf("chime();")) || "the first paint can chime";
});
row("P63144", "knownIds covers both dine-in orders and platform tickets", () =>
  hasRe(APPC(), /const ids = new Set\(\[\.\.\.data\.orders\.map\(\(o\) => o\.id\), \.\.\.\(\(data\.platform \|\| \[\]\)\.map\(\(p\) => p\.id\)\)\]\)/));
row("P63145", "knownIds is REPLACED on a full read, so it stays bounded on a 24/7 display", () => hasRe(APPC(), /state\.knownIds = ids;/));
row("P63146", "the targeted path ADDS to knownIds rather than replacing it", () => hasRe(APPC(), /for \(const o of freshOrders\) state\.knownIds\.add\(o\.id\);/));
row("P63147", "forgetCardHtml exists, so a surgically-edited card can be told to redraw", () => has(APPC(), "function forgetCardHtml(orderId)"));
row("P63148", "forgetCardHtml ignores a null id", () => hasRe(APPC(), /if \(orderId == null\) return;/));
row("P63149", "forgetCardHtml escapes the id for the attribute selector where CSS.escape exists", () =>
  hasRe(APPC(), /window\.CSS && CSS\.escape \? CSS\.escape\(String\(orderId\)\) : orderId/));
row("P63150", "forgetCardHtml does nothing when the card is not on screen", () => hasRe(APPC(), /if \(card\) card\.__kdsHtml = null;/));
row("P63151", "the refused ✓ path calls it, or the ✓ never comes back", () => {
  const m = slice("function markItemReady(", "async function undoReady(");
  return hasRe(m.slice(m.indexOf("}).catch(")), /forgetCardHtml\(o \? o\.id : it\.order_id\)/);
});
row("P63152", "the take-back path calls it for EVERY ticket it touched", () => {
  const u = slice("async function undoReady(", "function moveCardToReady(");
  return hasRe(u, /for \(const id of touched\) forgetCardHtml\(id\);/);
});
row("P63153", "the take-back collects the tickets it touched, including a single-dish one with no order id", () =>
  hasRe(APPC(), /const touched = new Set\(orderId != null \? \[orderId\] : \[\]\);/));
row("P63154", "the take-back adds each restored dish's own order to that set", () => hasRe(APPC(), /if \(it\.order_id != null\) touched\.add\(it\.order_id\);/));
row("P63155", "the perf counters are created without clobbering an existing one", () =>
  hasRe(APPC(), /window\.__lfhPerf = window\.__lfhPerf \|\| \{ fullRenders: 0, patches: 0, tilesPatched: 0, lastMs: 0, longTasks: 0 \};/));
row("P63156", "the long-task observer is wrapped, so a browser without the API simply has no counter", () =>
  hasRe(APPC(), /if \(typeof PerformanceObserver === "function"\)/));
row("P63157", "the long-task observer only counts tasks over 50ms", () => hasRe(APPC(), /if \(e\.duration > 50\) window\.__lfhPerf\.longTasks\+\+/));
row("P63158", "the perf counters cost no network and no storage", () => {
  const a = APPC();
  const p = a.slice(a.indexOf("window.__lfhPerf ="), a.indexOf("const state = {"));
  return lacksRe(p, /fetch|localStorage|api\(/);
});
row("P63159", "the mute preference is remembered per device", () => hasRe(APPC(), /localStorage\.setItem\("kds_muted", state\.muted \? "1" : "0"\)/));
row("P63160", "the mute preference is read back at boot", () => hasRe(APPC(), /muted: localStorage\.getItem\("kds_muted"\) === "1"/));
row("P63161", "unmuting counts as the gesture that unlocks audio", () => hasRe(APPC(), /if \(!state\.muted\) primeAudio\(\);/));
row("P63162", "the mute button's own icon changes with the state", () => hasRe(APPC(), /\$\("#muteBtn"\)\.textContent = state\.muted \? "🔕" : "🔔"/));
row("P63163", "the three device keys are namespaced to this panel", () => {
  const keys = [...APPC().matchAll(/localStorage\.(?:get|set)Item\("([\w]+)"/g)].map((m) => m[1]);
  const bad = keys.filter((k) => !/^kds_/.test(k));
  return bad.length === 0 || `keys outside the kds_ namespace: ${bad.join(", ")}`;
});
row("P63164", "nothing on this panel writes a key another panel also owns", () => {
  const a = APPC();
  return lacksRe(a, /localStorage\.setItem\("(lfh_panel_theme|lfh_theme|aevidine_skin)"/);
});
row("P63165", "the clock is only written while it is genuinely on screen", () => {
  const a = APPC();
  const t = a.slice(a.indexOf("setInterval(() => {\n  const el = $(\"#clock\");"));
  return (/document\.hidden/.test(t.slice(0, 300)) && /getComputedStyle\(el\)\.display === "none"/.test(t.slice(0, 400))) || "the clock ticks into a hidden element";
});
row("P63166", "the clock shows hours and minutes only", () => hasRe(APPC(), /toLocaleTimeString\(\[\], \{ hour: "2-digit", minute: "2-digit" \}\)/));
row("P63167", "the clock uses the device's own locale, not a hard-coded format", () => hasRe(APPC(), /toLocaleTimeString\(\[\]/));
row("P63168", "the board's first read failure is classified before anything is said to the cook", () => {
  const a = APPC();
  const c = a.slice(a.indexOf("load().catch((e) => {"));
  return (c.indexOf("isOfflineErr") < c.indexOf('toast("Couldn\'t load the board')) || "the raw failure is toasted first";
});
row("P63169", "the boot read failure path has a final honest message for anything unclassified", () =>
  hasRe(APPC(), /toast\("Couldn't load the board — try again\. " \+ e\.message\)/));
row("P63170", "the realtime handlers are the only thing that triggers a targeted read", () => {
  const a = APPC();
  const calls = (a.match(/loadTables\(/g) || []).length;
  return calls === 2 || `loadTables is called from ${calls} places`;
});
row("P63171", "a breadcrumb marked full always takes the whole-board path", () => hasRe(APPC(), /detail && !detail\.full && detail\.tables && detail\.tables\.length/));
row("P63172", "a breadcrumb with no tables named takes the whole-board path", () => hasRe(APPC(), /: fullSoon\(\)/));
row("P63173", "fullSoon does nothing when a read is already in flight", () => hasRe(APPC(), /if \(loadInFlight\) \{ loadQueued = true; return; \}/));
row("P63174", "fullSoon cannot stack two pending reloads", () => hasRe(APPC(), /const fullSoon = \(\) => \{\s*\n?\s*if \(fullTimer\) return;/));
row("P63175", "the pending reload clears its own timer handle before it runs", () => hasRe(APPC(), /setTimeout\(\(\) => \{ fullTimer = null; markFullRead\(\); load\(\)/));
row("P63176", "markFullRead is a safe no-op before the realtime block defines it", () => hasRe(APPC(), /let markFullRead = \(\) => \{\};/));
row("P63177", "the x-ray ribbon is inserted at the very top of the panel", () => hasRe(APPC(), /document\.body\.insertBefore\(rb, document\.body\.firstChild\)/));
row("P63178", "the ribbon is only drawn for a higher view or the simulated one", () => hasRe(APPC(), /if \(!w \|\| \(!w\.higherView && !sim\)\) return;/));
row("P63179", "a whoami failure leaves the panel alone rather than breaking the board", () => hasRe(APPC(), /\}\)\.catch\(\(\) => \{\}\);\s*\n?\}\)\(\);/));
row("P63180", "the admin's crumb starts at the Dashboard, which is where they came from", () => has(APPC(), '<a id="xrayHome">Dashboard</a>'));
row("P63181", "leaving the console clears the act-as cookie on the way out", () =>
  hasRe(APPC(), /const goConsole = async \(href\) => \{[\s\S]{0,200}JSON\.stringify\(\{ clear: true \}\)/));
row("P63182", "Exit view clears the act-as cookie too", () => {
  const a = APPC();
  const ex = a.slice(a.indexOf('document.getElementById("xrayExit").onclick'));
  return hasRe(ex, /JSON\.stringify\(\{ clear: true \}\)/);
});
row("P63183", "both exits navigate the TOP window, not the iframe", () => {
  const a = APPC();
  return ((a.match(/window\.top\.location\.href/g) || []).length >= 2) || "one exit navigates only the frame";
});
row("P63184", "both exits fall back to this window if window.top is unreachable", () => {
  const a = APPC();
  return ((a.match(/catch \{ window\.location\.href =/g) || []).length >= 2) || "one exit has no fallback";
});
row("P63185", "the ribbon mirrors the restaurant name as soon as the board read lands", () =>
  hasRe(APPC(), /new MutationObserver\(mirror\)\.observe\(restEl, \{ childList: true, characterData: true, subtree: true \}\)/));
row("P63186", "the mirror only writes when the text actually differs", () => hasRe(APPC(), /if \(me && me\.textContent !== t\) me\.textContent = t;/));
row("P63187", "the pinned person's name is escaped everywhere the ribbon shows it", () => {
  const a = APPC();
  const xr = a.slice(a.indexOf("(function kitchenXray()"));
  const raw = [...xr.matchAll(/\$\{w\.asName\}/g)].length;
  return raw === 0 || `${raw} unescaped uses of the pinned name`;
});
row("P63188", "the ribbon's own styles are injected once, in a <style> of its own", () => {
  const a = APPC();
  const xr = a.slice(a.indexOf("(function kitchenXray()"));
  return ((xr.match(/document\.head\.appendChild\(s\)/g) || []).length === 1) || "the ribbon injects its styles more than once";
});
row("P63189", "the panel page forwards only rid, as and view — nothing else from the URL", () => {
  const p = PAGE();
  const params = (p.match(/searchParams: Promise<\{([^}]*)\}>/) || [])[1] || "";
  const keys = [...params.matchAll(/(\w+)\?:/g)].map((m) => m[1]);
  return (JSON.stringify(keys.sort()) === JSON.stringify(["as", "rid", "view"])) || `the page reads: ${keys.join(", ")}`;
});
row("P63190", "the ridQ helper adds view=real only when the pin is present", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("const ridQ = (path) => {"), a.indexOf("let blockedWallUp"));
  return (fn.indexOf("if (!PANEL_RID) return path;") < fn.indexOf("PANEL_VIEW_REAL")) || "the pin check does not come first";
});
row("P63191", "the ridQ helper encodes every value it appends", () => {
  const a = APPC();
  const fn = a.slice(a.indexOf("const ridQ = (path) => {"), a.indexOf("let blockedWallUp"));
  const appends = [...fn.matchAll(/\+= "&?\w+=" \+ ([^;]+);/g)].map((m) => m[1]);
  const bad = appends.filter((x) => !/encodeURIComponent/.test(x));
  return bad.length === 0 || `unencoded: ${bad.join(", ")}`;
});
row("P63192", "ridQ handles a path that already carries a query string", () => hasRe(APPC(), /path \+= \(path\.includes\("\?"\) \? "&" : "\?"\)/));
row("P63193", "the panel never puts a restaurant id in localStorage, where another tab would inherit it", () =>
  lacksRe(APPC(), /setItem\("[\w]*rid|setItem\([^)]*PANEL_RID/));
row("P63194", "the board's own state object starts with every key the render path reads", () => {
  // `[^}]*` stops at the first `}` — which is `tableNames: {}` — so it never saw the later keys.
  // Take the whole single-line declaration instead.
  const m = (APP().match(/^const state = \{.*$/m) || [""])[0];
  for (const k of ["orders", "items", "dishes", "platform", "platformAccept", "tableNames", "tableTags", "knownIds", "muted"])
    if (!m.includes(k)) return `state has no ${k} at boot`;
  return true;
});
row("P63195", "the board never renders before applyView has decided which layout is showing", () => {
  const a = APPC();
  return (a.indexOf("applyView();") < a.indexOf("load().catch((e) => {")) || "the first read paints before the layout is set";
});
row("P63196", "the delegated click handler is bound before the first paint", () => {
  const a = APPC();
  return (a.indexOf("bindDelegation();") < a.indexOf("load().catch((e) => {")) || "the first tickets are painted with no handler";
});
row("P63197", "the sound nudge is evaluated at boot, for an untouched wall display", () => {
  const a = APPC();
  return (a.indexOf("updateSoundNudge();") > 0 && a.indexOf("updateSoundNudge(); ") < a.indexOf("load().catch((e) => {")) || "the nudge is not checked at boot";
});
row("P63198", "the panel exposes no way to set a restaurant's settings from the kitchen screen", () => {
  const a = APPC();
  return lacksRe(a, /\/settings"|api\("POST", "\/settings/);
});
row("P63199", "the kitchen cannot accept a dine-in order — there is no such call anywhere", () =>
  lacksRe(APPC(), /\/orders\/\$\{[^}]+\}\/accept/));
row("P63200", "the route still HAS the accept endpoint, because the waiter tablet and manager use the same family", () =>
  hasRe(ROUTEC(), /if \(a === "orders" && c === "accept"\)/));

// ══ E6 · THE TWO FIXES THIS RUN MADE, AND THE RULES THEY RESTORE — P63201–P63220 ══
row("P63201", "the ticket header's age chip can never break its own text in half", () => hasRe(CSS(), /\.age \{[^}]*white-space: nowrap;/));
row("P63202", "the ticket header wraps as a ROW instead, so a long table name keeps both values whole", () =>
  hasRe(CSS(), /\.thead \{[^}]*flex-wrap: wrap; row-gap: 4px;/));
row("P63203", "that fix carries its own reason, naming what was measured", () => hasRe(CSS(), /THE HEADER WRAPS, AND THE AGE NEVER BREAKS IN HALF/));
row("P63204", "the retired \"both\" print target has no live branch left in the panel", () => {
  const a = APPC();   // comments stripped — the obituary is allowed to say the word
  return lacksRe(a, /=== "both"/);
});
row("P63205", "its obituary is still in the file, so nobody adds a third value back by accident", () =>
  hasRe(APP(), /"both" IS GONE, and this is its obituary/));
row("P63206", "the route still cannot produce a third print-target value", () => {
  const r = ROUTEC();
  const d = r.slice(r.indexOf("kotPrintTarget: target.kind"), r.indexOf("helper,"));
  const vals = [...d.matchAll(/"(\w+)"/g)].map((m) => m[1]).filter((v) => v !== "screen" && v !== "manager");
  return (new Set(vals).size <= 2 && vals.every((v) => v === "counter" || v === "kitchen")) || `it can answer: ${[...new Set(vals)].join(", ")}`;
});
row("P63207", "the ⚙️ Settings sheet keeps its Printing section when a COMPUTER owns the paper", () => {
  const s = slice("function renderKitchenSettings()", "function waitingWords()");
  return hasRe(s, /const printSection = \(!auto && tgt !== "counter" && !hlp\) \? "" :/);
});
row("P63208", "that sheet reads the helper from the SAME state the 🖨 sheet reads", () => {
  const set = slice("function renderKitchenSettings()", "function waitingWords()");
  const ps = slice("function printerStatusHtml()", "function paintPrinterSheetStatus()");
  const shape = /state\.helper && state\.helper\.owned \? state\.helper : null/;
  return (shape.test(set) && shape.test(ps)) || "the two sheets derive the helper differently";
});
// EXPECTATION CHANGED inside this same run, and the reason is worth keeping: the first version of
// the fix pre-escaped these two values AND the render site escaped them again, so a computer called
// "Shop's computer" printed on the sheet as "Shop&#39;s computer". Driving the screen caught it;
// reading it had not. The values are RAW here now and escaped once at the render site (P63226–P63228).
row("P63209", "the sheet names the printer AND the computer, not just \"a computer\"", () => {
  const s = slice("function renderKitchenSettings()", "function waitingWords()");
  return hasRe(s, /\$\{hlp\.printer\} — from \$\{hlp\.agent\}/);
});
row("P63210", "the sheet says a sleeping helper's tickets are waiting, rather than looking healthy", () => {
  const s = slice("function renderKitchenSettings()", "function waitingWords()");
  return hasRe(s, /hlp\.connected \? "" : " It has not been heard from for a while/);
});
// EXPECTATION CHANGED with P63209: the computer name now reaches the screen by two routes and each
// is escaped EXACTLY once — through `esc(where)` on the "Tickets print on" row, and directly as
// `esc(hlp.agent)` in the sentence under it. Asserting "at least two esc() calls" was asserting the
// double-escaping bug.
row("P63211", "the helper's computer name is escaped exactly once on each route to the screen", () => {
  const s = slice("function renderKitchenSettings()", "function waitingWords()");
  const direct = (s.match(/esc\(hlp\.agent\)/g) || []).length;
  const viaWhere = /<b>\$\{esc\(where\)\}<\/b>/.test(s);
  return (direct === 1 && viaWhere) || `direct esc(hlp.agent) uses: ${direct}; escaped at the where row: ${viaWhere}`;
});
row("P63212", "a restaurant with printing genuinely OFF still sees no Printing section at all", () => {
  const s = slice("function renderKitchenSettings()", "function waitingWords()");
  // off => auto false, tgt "kitchen", helper null → the guard must still collapse to ""
  return hasRe(s, /\(!auto && tgt !== "counter" && !hlp\) \? ""/);
});
row("P63213", "the counter-screen explanation is untouched by the helper case", () => {
  const s = slice("function renderKitchenSettings()", "function waitingWords()");
  return hasRe(s, /: tgt === "counter" && !auto \? `<p class="kset-note">Kitchen tickets print on <b>the counter screen<\/b>/);
});
row("P63214", "the panel's asset hashes were bumped with these edits, so no cook runs a half-old skin", () => {
  const h = HTML();
  for (const f of ["app.js", "style.css"]) {
    const tag = (h.match(new RegExp(f.replace(".", "\\.") + "\\?v=([0-9a-f]{8})")) || [])[1];
    const real = contentHash("public/panels/kitchen/" + f);
    if (tag !== real) return `${f}: tag ${tag}, file ${real}`;
  }
  return true;
});
row("P63215", "style.css still has the mixed line endings it shipped with — no wholesale flip", () => {
  const t = src("public/panels/kitchen/style.css");
  const crlf = (t.match(/\r\n/g) || []).length;
  const lines = t.split("\n").length;
  return (crlf > 0 && crlf < lines - 1) || `${crlf} CRLF of ${lines} lines — the file was rewritten wholesale`;
});
row("P63216", "no fix in this run reopened a rejected idea", () => {
  const a = APPC(), c = CSS();
  const sins = [];
  // R41 is specifically about `.top-actions .btn` INSIDE the phone block. Slicing from the @media
  // line to the end of the file also swept up .reprint, .hamburger and .kset-head .btn, which
  // legitimately carry 44px widths and have nothing to do with the bar he ruled on.
  const phone = c.slice(c.indexOf("@media (max-width: 760px)"));
  const barRule = (phone.match(/\.top-actions \.btn[^{]*\{[^}]*\}/) || [""])[0];
  if (/min-width/.test(barRule)) sins.push("R41 — a min-width on the phone bar buttons");
  if (/errText\(/.test(a)) sins.push("R21 — the shared errText helper");
  if (/age-ready/.test(a)) sins.push("R5 — an ageing signal on the Ready column");
  return sins.length === 0 || `reopened: ${sins.join("; ")}`;
});
row("P63217", "the header wrap costs nothing above the phone/wall widths where it is needed", () => {
  // flex-wrap only ever engages when the row cannot fit; there is no width-specific rule to drift.
  const c = CSS();
  const theadRules = [...c.matchAll(/\.thead\s*\{[^}]*\}/g)].length;
  return theadRules === 1 || `${theadRules} .thead rules — a second one can disagree with the first`;
});
row("P63218", "the age chip's nowrap is declared once, so a later rule cannot quietly undo it", () => {
  const c = CSS();
  return ((c.match(/white-space:\s*normal/g) || []).filter(Boolean).length === 0) || "something sets white-space back to normal";
});
row("P63219", "the two fixes changed no behaviour the owner deliberately chose", () => {
  const a = APPC();
  // the three rejections that touch this exact area must all still hold
  return (/window\.LFH_NO_PROFILE_AT_ALL = true/.test(a) && !/errText\(/.test(a) && !/col-\w+"\)\.hidden = true/.test(a)) || "a standing decision was disturbed";
});
row("P63220", "every ticket header value is still escaped after the header changes", () => {
  const a = APPC();
  return hasRe(a, /\$\{esc\(whereFor\(o, false\)\)\}/);
});

// ══ E7 · THE TWO THINGS DRIVING THE SCREEN FOUND THAT READING IT DID NOT — P63226–P63240 ══
row("P63226", "the settings sheet's `where` is RAW, because the render site escapes it", () => {
  const s = slice("function renderKitchenSettings()", "function waitingWords()");
  return hasRe(s, /const where = hlp \? `\$\{hlp\.printer\} — from \$\{hlp\.agent\}`/);
});
row("P63227", "…and the render site is the ONE place that escapes it", () => {
  const s = slice("function renderKitchenSettings()", "function waitingWords()");
  return ((s.match(/<b>\$\{esc\(where\)\}<\/b>/g) || []).length >= 1) || "the sheet inserts `where` unescaped";
});
row("P63228", "no value on the settings sheet is escaped twice", () => {
  const s = slice("function renderKitchenSettings()", "function waitingWords()");
  return lacksRe(s, /esc\(esc\(|esc\([^)]*esc\(/);
});
row("P63229", "printerStatusHtml keeps its OPPOSITE convention — pre-escaped pieces, raw insert", () => {
  const p = slice("function printerStatusHtml()", "function paintPrinterSheetStatus()");
  return (/const where = hlp \? \(esc\(hlp\.printer\) \+ " — from " \+ esc\(hlp\.agent\)\)/.test(p) &&
          /<b>\$\{where\}<\/b>/.test(p)) || "the 🖨 sheet's escaping convention has drifted";
});
row("P63230", "the two sheets are never copied into each other by accident — the note says which end escapes", () =>
  hasRe(APP(), /Two functions, two conventions, so do not copy one into/));
row("P63231", "a STALE station is not described as nobody", () => {
  const s = slice("function renderKitchenSettings()", "function waitingWords()");
  return hasRe(s, /: \(st && st\.active\)\s*\n?\s*\? `<b>\$\{holder\}<\/b> was printing and has stopped answering\./);
});
row("P63232", "that sentence says the tickets are waiting, not lost", () => {
  const s = slice("function renderKitchenSettings()", "function waitingWords()");
  return has(s, "the tickets are waiting, not lost");
});
row("P63233", "the \"nobody yet\" sentence is now reachable only when there really is no station", () => {
  const s = slice("function renderKitchenSettings()", "function waitingWords()");
  const i = s.indexOf("No screen has taken the printer yet");
  const j = s.indexOf("(st && st.active)");
  return (j > 0 && j < i) || "the stale branch does not precede the nobody branch";
});
row("P63234", "the row above and the note below can no longer give opposite answers", () => {
  const s = slice("function renderKitchenSettings()", "function waitingWords()");
  // every state the ROW can report (mine / active / stale / none) has a matching note branch
  const rowStates = /printingHere \? "THIS screen" : st && st\.active \? \(st\.stale \? holder \+ " \(gone quiet\)" : holder\) : "no screen yet"/.test(s);
  const noteStates = /printingHere[\s\S]{0,400}heldByOther[\s\S]{0,300}\(st && st\.active\)[\s\S]{0,300}No screen has taken/.test(s);
  return (rowStates && noteStates) || `row covers all states: ${rowStates}; note covers all states: ${noteStates}`;
});
row("P63235", "the holder label is escaped once, where it is built", () => {
  const s = slice("function renderKitchenSettings()", "function waitingWords()");
  return hasRe(s, /const holder = st && st\.active\s*\n?\s*\? `\$\{esc\(st\.active\.label/);
});
