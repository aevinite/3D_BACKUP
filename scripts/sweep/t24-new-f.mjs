// t24-new-f.mjs — sweep #8 T24, block F: the manager's floor read, the printer strip, the
// dashboard, the logs — and the write path's first branches.
import { check, nid, F } from "./t24-run.mjs";

const { src, HELPERS, GETBLK, POSTBLK_A, endpointBlock, live, needLive, J, panel, chains } = F;
const code = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const B = (n) => code(endpointBlock(n));
const HC = code(HELPERS);
const PC = code(POSTBLK_A);
const PANEL = code(panel);
const count = (t, re) => (t.match(re) || []).length;


// ── the floor summary ──────────────────────────────────────────────────────────────────────────
const S = B("summary");
check(nid(), "?table= must be a NUMBER — anything else means 'no targeted table', never an error", "read GET /summary",
  () => /\/\^\\d\{1,6\}\$\/\.test\(tblRaw\.trim\(\)\)/.test(S));
check(nid(), "…driven with ?table=abc it answers the whole floor, not a 500", "driven live",
  () => needLive("summaryBadTable") || ({ ok: live("summaryBadTable").status === 200, note: `status ${live("summaryBadTable").status}` }));
check(nid(), "whole-floor reads for the same restaurant inside 1.5s share ONE database call", "read GET /summary",
  () => /sharedFloorSummary\(`floor:\$\{rid\}`/.test(S));
check(nid(), "…and a targeted ?table= refetch is never shared, so a tile updates the instant its order lands", "read GET /summary",
  () => /tbl\s*\?\s*await sb\.rpc\("lfh_table_view_summary", \{ p_restaurant_id: rid, p_table: tbl \}\)/.test(S));
check(nid(), "the printer strip has its OWN shared key, not one folded into the floor read", "read GET /summary",
  () => /sharedFloorSummary\(`printer:\$\{rid\}`/.test(S));
check(nid(), "…so the waiter panel's own floor poll can never blank the manager's printer strip", "read GET /summary — what is inside the shared floor closure",
  // The fault this replaced: the printer payload lived INSIDE the `floor:${rid}` closure, which the
  // waiter route shares under the same key with a closure that has no printer in it. Whichever
  // panel read first decided for both. What has to hold is that the floor closure is a bare
  // lfh_table_view_summary call and nothing else.
  () => { const i = S.indexOf("sharedFloorSummary(`floor:");
    const closure = S.slice(i, S.indexOf("\n", i) + 1);
    return { ok: /lfh_table_view_summary/.test(closure) && !/printer|print_jobs|slow/.test(closure), note: closure.trim().slice(0, 100) }; });
check(nid(), "…and the key ENDS in the restaurant id, so invalidateFloor() still drops it after a write", "read GET /summary + lib/floorSummary",
  () => /printer:\$\{rid\}/.test(S) && /slow-orders:\$\{rid\}/.test(S) && /merges:\$\{rid\}/.test(S));
check(nid(), "a STUCK BILL raises the strip too, not only a stuck kitchen slip", "read GET /summary",
  () => /\.in\("kind", \["kot", "bill"\]\)/.test(S));
check(nid(), "…and the strip is told WHICH printer to go and look at", "read GET /summary", () => /select\("id, kind, note, count, reported_by, last_at, printer"\)/.test(S));
check(nid(), "…and how many are stacked up behind it, counted rather than listed", "read GET /summary", () => /const waiting = await waitingToPrint\(rid, "kot"\)/.test(S));
check(nid(), "an order nobody has accepted is raised on a CLOCK, not the instant it arrives", "read GET /summary",
  () => /const slowIso = new Date\(Date\.now\(\) - SLOW_ACCEPT_MS\)\.toISOString\(\)/.test(S));
check(nid(), "…and that read is scoped, columned, capped at five and rides the existing shared window", "read GET /summary",
  () => /select\("id, table_number, kot_no, created_at"\)[\s\S]{0,200}?\.limit\(5\)/.test(S));
check(nid(), "…and a targeted ?table= refetch pays for neither the printer strip nor the slow-order clock", "read GET /summary",
  () => /const printer = tbl \? null :/.test(S) && /const slowOrders = tbl \? null :/.test(S));
check(nid(), "merged tables ride along on every floor read, shared under their own key", "read GET /summary",
  () => /sharedFloorSummary\(`merges:\$\{rid\}`/.test(S) && /\.is\("ended_at", null\)\.limit\(200\)/.test(S));
check(nid(), "the answer is spread into a NEW object — a handler must never write into the shared snapshot", "read GET /summary",
  () => /\.\.\.\(data \|\| \{ tiles: \{\}, order_count: 0/.test(S));
check(nid(), "…and an empty floor still carries every list the panel reads, so nothing throws on undefined", "read GET /summary",
  () => /calls: \[\], requests: \[\], joiners: \[\], blocklist: \[\]/.test(S));
check(nid(), "the floor answers live with its tiles and its restaurant-wide aggregates", "driven live",
  () => needLive("summary") || (J("summary") && typeof J("summary") === "object" && "tiles" in J("summary") && Array.isArray(J("summary").merges)));
check(nid(), "…and the printer strip is on the whole-floor answer", "driven live",
  () => needLive("summary") || ("printer" in J("summary") || "slowOrders" in J("summary")));
check(nid(), "…and NOT on the targeted one", "driven live",
  () => needLive("summaryTable") || (!("printer" in (J("summaryTable") || {})) && !("slowOrders" in (J("summaryTable") || {}))));
check(nid(), "…and neither answer carries leaked code text where a person would read it", "driven live",
  () => needLive("summary") || !/\[object Object\]|-->|\$\{/.test(JSON.stringify(J("summary")).slice(0, 20000)));

// ── the printer's own reads ────────────────────────────────────────────────────────────────────
const PJ = B("print-jobs");
check(nid(), "a stopped queue holds every SCREEN too, not just the computer", "read counterPrintTarget",
  () => /const paused = st\?\.modules\?\.printing\?\.paused === true/.test(HC) && /const on = !paused &&/.test(HC));
check(nid(), "both rungs of mig 107 are asked — the admin allowed it AND the restaurant switched it on", "read counterPrintTarget",
  () => /st\?\.auto_print_kot === true && st\?\.auto_print_kot_allowed === true/.test(HC));
check(nid(), "a named COMPUTER takes the kitchen slips off every screen, including this one", "read counterPrintTarget",
  () => /if \(helper\.owned\) return \{ mayPrint: false, target, helper \}/.test(HC));
check(nid(), "with NO route at all the default room is the KITCHEN, so a manager screen does not start printing", "read counterPrintTarget",
  () => /const panelOk = route\.kind === "screen" \? route\.panel === "manager" : false/.test(HC));
check(nid(), "there is no 'backup' field left on that answer — the backup screen was deleted", "read counterPrintTarget", () => !/backup/.test(HC.slice(HC.indexOf("async function counterPrintTarget"), HC.indexOf("async function counterPrintTarget") + 1800)));
check(nid(), "'off' is a real answer the panel can act on, not an error", "read GET /print-jobs/pending", () => /return ok\(\{ jobs: \[\], off: true/.test(PJ));
check(nid(), "…and it still says WHO is printing, because that is what a manager needs to see", "read GET /print-jobs/pending",
  () => /target: t\.target, station, helper: t\.helper, helpers: owners/.test(PJ));
check(nid(), "…and how far behind the printer is, whether or not this screen may print", "read GET /print-jobs/pending", () => /waiting, stuckAfterMs: STUCK_AFTER_MS/.test(PJ));
check(nid(), "being NAMED by the admin on the Printing board IS the permission", "read GET /print-jobs/pending",
  () => /const namedMe = targets\.kot\.kind === "screen" && !!g\.user\?\.id && targets\.kot\.person === g\.user\.id/.test(PJ));
check(nid(), "…and the general permission still governs everyone the admin has NOT named", "read GET /print-jobs/pending",
  () => /const mayBePrinter = !g\.user \|\| namedMe \? true : await managerCan\(g, rid, "print_here"\)/.test(PJ));
check(nid(), "…and the refusal says WHICH of the two said no", "read GET /print-jobs/pending",
  () => /printRefused: !mayBePrinter \? "not_allowed" : mayKot\.ok \? null : mayKot\.why/.test(PJ));
check(nid(), "only the ACTIVE station is handed tickets — another screen gets the station's name instead", "read GET /print-jobs/pending",
  () => /if \(!station\.mine && station\.active && !station\.stale\) return ok\(\{ jobs: \[\]/.test(PJ));
check(nid(), "the station's heartbeat is touched only by the screen that HOLDS it", "read GET /print-jobs/pending",
  () => /if \(station\.mine\) \{ try \{ await touchStation\(rid, dv as string\)/.test(PJ));
check(nid(), "…and a failed touch is swallowed — the next read retries", "read GET /print-jobs/pending", () => /catch \{ \/\* next read retries \*\/ \}/.test(F.GETBLK));
check(nid(), "every kind's owner comes back in ONE pair of reads, not three", "read GET /print-jobs/pending",
  () => count(PJ, /helpersFor\(rid, \["kot", "bill", "banquet"\]\)/g) === 1 && !/helperFor\(rid,/.test(PJ));
check(nid(), "…and every kind's TARGET in one more, not three", "read GET /print-jobs/pending",
  () => count(PJ, /targetsFor\(rid, \["kot", "bill", "banquet"\]\)/g) === 1 && !/targetFor\(rid,/.test(PJ));
check(nid(), "…and the three of them are asked for together, not one after another", "read GET /print-jobs/pending",
  () => /await Promise\.all\(\[\s*helpersFor\(rid, \["kot", "bill", "banquet"\]\),\s*targetsFor\(rid, \["kot", "bill", "banquet"\]\),\s*stationView\(rid, dv\),\s*\]\)/.test(PJ));
check(nid(), "…and the poll does not ALSO ask helperFor/targetFor for the kitchen slips it already has", "read counterPrintTarget beside the poll",
  () => { const dup = /helperFor\(rid, "kot"\)/.test(HC) && /targetFor\(rid, "kot"\)/.test(HC) && /const t = await counterPrintTarget\(rid\);/.test(PJ);
    return { ok: !dup, note: dup ? "the printer address book is read four times per poll where two would do" : "" }; });
check(nid(), "the pending poll answers live, and says whether this screen may print", "driven live",
  () => needLive("pending") || (J("pending") && (Array.isArray(J("pending").jobs) || J("pending").off === true)));
check(nid(), "…and it names the room the paper goes to in plain words", "driven live",
  () => needLive("pending") || (typeof J("pending").target === "string" && /kitchen|counter/.test(J("pending").target)));

// ── the Printing board on the machine that has the printer ─────────────────────────────────────
const PR = B("printing");
check(nid(), "anyone who can open Settings gets the READ — is printing on, where does the paper go", "read GET /printing",
  () => /const board = await printBoardState\(rid, \{ deviceId: dv \}\)/.test(PR));
check(nid(), "…but only 'May set the printers up' gets the buttons, asked on the SERVER", "read GET /printing",
  () => /const maySetup = g\.user \? await managerCan\(g, rid, "print_setup"\) : true/.test(PR));
check(nid(), "the install text points at THIS site, taken from the request, never from a constant", "read originOfReq",
  () => /const proto = h\.get\("x-forwarded-proto"\) \|\| "https"/.test(HC) && /files: helperFiles\(originOfReq\(req\)\)/.test(PR));
check(nid(), "…and the browser's own operating system is guessed so nobody has to pick it off a list", "read osOfRequest",
  () => /os: osOfRequest\(req\)/.test(PR) && /ua\.includes\("windows"\)/.test(HC));
check(nid(), "…with the other two always one tap away", "read PANEL_OS_LIST", () => /const PANEL_OS_LIST: HelperOs\[\] = \["mac", "windows", "linux"\]/.test(HC));
check(nid(), "the board answers live, and says whether this person may set anything up", "driven live",
  // deviceId is null for a caller with no device cookie, which is a real shape and not a fault.
  () => needLive("printing") || (J("printing") && typeof J("printing").maySetup === "boolean"
    && (J("printing").deviceId === null || typeof J("printing").deviceId === "string")
    && ["mac", "windows", "linux"].includes(J("printing").os)));
check(nid(), "…and /printing and /printing/state answer the same thing", "driven live",
  () => needLive("printing") || needLive("printingState") || live("printing").status === live("printingState").status);
check(nid(), "a stuck reprint is fetched fresh from the database, never trusted to the panel's state", "read GET /print-jobs/:id",
  () => /from\("print_jobs"\)\.select\("id, order_id, reprint, status"\)\.eq\("id", path\[1\]\)\.eq\("restaurant_id", rid\)/.test(F.GETBLK));
check(nid(), "…and a job that is gone is a sentence, not a crash", "read GET /print-jobs/:id", () => /return err\("That print job is gone\.", 404\)/.test(F.GETBLK));
check(nid(), "…and so is an order that has since been removed", "read GET /print-jobs/:id", () => /return err\("That KOT's order is gone\.", 404\)/.test(F.GETBLK));
check(nid(), "…driven with an id that is not this restaurant's, it says 'gone' rather than showing it", "driven live",
  () => needLive("printJobGhost") || ({ ok: live("printJobGhost").status === 404 || live("printJobGhost").status === 400, note: `status ${live("printJobGhost").status}` }));

// ── the manager's dashboard ────────────────────────────────────────────────────────────────────
const ST = B("stats");
check(nid(), "the dashboard reaches exactly as far as the Access screen hands over, and no further", "read GET /stats",
  () => /clampDashRange\(new URL\(req\.url\)\.searchParams\.get\("range"\), reach\)/.test(ST));
check(nid(), "…the clamp is for EVERYONE — manager, owner and admin alike", "read GET /stats", () => !/higherView|isAdmin/.test(ST.slice(0, ST.indexOf("const now"))));
check(nid(), "…so ?range=year is silently answered as today, never as an error", "driven live",
  () => needLive("statsYear") || ({ ok: live("statsYear").status === 200 && ["today", "yesterday"].includes(J("statsYear").range), note: `answered ${J("statsYear") && J("statsYear").range}` }));
check(nid(), "'yesterday' is yesterday ALONE, its own 05:00-to-05:00 day", "read GET /stats",
  () => /const since = range === "yesterday" \? new Date\(dayStart\.getTime\(\) - 864e5\) : dayStart/.test(ST)
    && /const until = range === "yesterday" \? dayStart : now/.test(ST));
check(nid(), "the previous period is cut at the SAME elapsed time, so a half day never faces a whole one", "read GET /stats",
  () => /return t < sinceMs && t - prevSinceMs <= elapsedMs;/.test(ST));
check(nid(), "the day's orders are PAGED, so a busy restaurant is not truncated to the newest 1000", "read GET /stats",
  () => /const STATS_PAGE = 1000;/.test(ST) && /\.range\(from, from \+ STATS_PAGE - 1\)/.test(ST));
check(nid(), "…in doubling parallel waves, so a wide range is not twelve sequential round trips", "read GET /stats",
  () => /statsWave \*= 2;/.test(ST) && /await Promise\.all\(offsets\.map/.test(ST));
check(nid(), "…stopping the moment a wave comes back short", "read GET /stats", () => /if \(pages\.some\(\(page\) => page\.length < STATS_PAGE\)\) break;/.test(ST));
check(nid(), "…and saying so HONESTLY when the cap really was reached", "read GET /stats", () => /truncated: statsTruncated, statsCap: STATS_ROW_CAP/.test(ST));
check(nid(), "every ₹ figure is computed PER BILL, so a whole-bill discount is not clamped per order", "read GET /stats",
  () => /const billAgg = new Map</.test(ST) && /for \(const b of billAgg\.values\(\)\)/.test(ST));
check(nid(), "…and revenue is the stored bill total minus the grossed discount — the collected basis", "read GET /stats",
  () => /const amt = Math\.max\(0, \(Number\(b\.tot\) \|\| 0\) - b\.disc \* \(1 \+ rate\)\)/.test(ST));
check(nid(), "…so a later tax-rate change can never rewrite a past month", "read the comment beside it",
  () => /was net\*\(1\+currentRate\), which retroactively re-taxed old bills at today's rate/.test(F.GETBLK));
check(nid(), "the average is per BILL, not per order, because the card says '/bill'", "read GET /stats",
  () => /const avgOrder = billAgg\.size > 0 \? r2\(revenue \/ billAgg\.size\) : 0/.test(ST));
check(nid(), "every hour-of-day figure is bucketed in IST, never in the server's timezone", "read GET /stats",
  () => /const istHour = \(d: Date\) => new Date\(d\.getTime\(\) \+ IST_OFF\)\.getUTCHours\(\)/.test(ST));
check(nid(), "open tables is a rows-free head COUNT, so it cannot be capped at 1000", "read GET /stats",
  () => /select\("id", \{ count: "exact", head: true \}\)\.eq\("status", "open"\)/.test(ST));
check(nid(), "…and a FAILED read of it still raises, instead of quietly reporting an empty floor", "read GET /stats",
  () => /must\(openSessQ\);\s*const openTableCount = Number\(openSessQ\.count\) \|\| 0/.test(ST));
check(nid(), "the dish map is bounded, so a big menu does not silently lose dishes from Top dishes", "read GET /stats",
  () => /from\("menu_items"\)\.select\("id,title,category"\)\.eq\("restaurant_id", rid\)\.limit\(5000\)/.test(ST));
check(nid(), "the platform reads are bounded on BOTH ends on 'yesterday'", "read GET /stats",
  () => /\.gte\("created_at", since\.toISOString\(\)\)\.lt\("created_at", until\.toISOString\(\)\)/.test(ST));
check(nid(), "the heatmap field is kept as an empty array so an old cached panel does not throw", "read GET /stats", () => /heatmap: \[\] as number\[\]\[\]/.test(ST));
check(nid(), "the dashboard answers live with the cards the panel draws", "driven live",
  () => needLive("stats") || (live("stats").status !== 200 ? { ok: live("stats").status === 403, note: "refused, honestly" }
    : ["series", "hours", "revenue", "orderCount", "avgOrder", "live", "channels"].every((k) => J("stats")[k] != null)));
check(nid(), "…the hourly series has exactly 24 points, zero-filled", "driven live",
  () => needLive("stats") || (live("stats").status !== 200 ? "skip: refused" : J("stats").series.length === 24));
check(nid(), "…the big order number equals its own sub-line (paid + unpaid)", "driven live, the arithmetic redone",
  () => { if (!live("stats") || live("stats").status !== 200) return "skip: no dashboard answer";
    const s = J("stats"); return { ok: s.orderCount === s.paid + s.unpaid, note: `${s.orderCount} vs ${s.paid}+${s.unpaid}` }; });
check(nid(), "…no figure on it is NaN", "driven live, every number read",
  () => { if (!live("stats") || live("stats").status !== 200) return "skip: no dashboard answer";
    const bad = []; const walk = (o, p) => { for (const [k, v] of Object.entries(o || {})) {
      if (typeof v === "number" && !Number.isFinite(v)) bad.push(`${p}${k}`);
      else if (v && typeof v === "object" && !Array.isArray(v)) walk(v, `${p}${k}.`); } };
    walk(J("stats"), ""); return { ok: bad.length === 0, note: bad.join(", ") }; });
check(nid(), "…and 'yesterday' is answered only as far as the Access screen hands over", "driven live, against the reach whoami reports",
  // French House is on the default reach of TODAY, so ?range=yesterday is correctly clamped back
  // to today. Asserting "yesterday" flat would be asserting a permission this restaurant has not
  // been given — the clamp working IS the right answer here.
  () => { if (!live("statsYest") || live("statsYest").status !== 200) return "skip: the dashboard refused";
    const reach = (J("whoami") || {}).dashReach;
    const want = reach === "today_yesterday" ? "yesterday" : "today";
    return { ok: J("statsYest").range === want, note: `reach ${reach} → answered ${J("statsYest").range}` }; });

// ── the logs ───────────────────────────────────────────────────────────────────────────────────
const OP = B("oplog"), AU = B("audit"), US = B("users"), RK = B("staff-risk");
check(nid(), "a manager's activity log never shows the ADMIN's or the OWNER's actions", "read GET /oplog",
  () => /\.not\("panel", "in", "\(admin,owner,db\)"\)/.test(OP));
check(nid(), "…and the admin's own marker is stripped for any staff or owner reader", "read GET /oplog",
  () => /if \(g\.user\) for \(const row of rows\) if \(row\.actor_id === ADMIN_VIEW_ACTOR_ID\) row\.actor_id = null/.test(OP));
check(nid(), "an ERROR row arrives with its plain English sentence attached", "read GET /oplog",
  () => /if \(row\.level === "error" && row\.detail\) row\.plain = plainHeadline\(row\.detail\)/.test(OP));
check(nid(), "…only on error rows, so 200 ordinary rows do not carry paid-for payload", "read GET /oplog",
  () => /row\.level === "error" && row\.detail/.test(OP));
check(nid(), "…and the exact original text is never removed", "read GET /oplog", () => !/delete row\.detail/.test(OP));
check(nid(), "the log is capped at 200 rows", "read GET /oplog", () => /\.limit\(200\)/.test(OP));
check(nid(), "the removals record is capped, and the cap is clamped to 1…300", "read GET /audit",
  () => /Math\.min\(Math\.max\(parseInt\(String\(req\.nextUrl\.searchParams\.get\("limit"\) \|\| "100"\), 10\) \|\| 100, 1\), 300\)/.test(AU));
check(nid(), "…driven with ?limit=999 it still answers, clamped", "driven live",
  () => needLive("auditLimit") || ({ ok: live("auditLimit").status === 200 && (J("auditLimit") || []).length <= 300, note: `${(J("auditLimit") || []).length} rows` }));
check(nid(), "…and ?limit=0 does not become an unbounded read", "driven live",
  () => needLive("auditLimit0") || ({ ok: live("auditLimit0").status === 200 && (J("auditLimit0") || []).length <= 300, note: `${(J("auditLimit0") || []).length} rows` }));
check(nid(), "the whole snapshot (meta) is fetched only when ONE record is opened, never for the list", "read GET /audit",
  () => /if \(detailId\)/.test(AU) && !/select\("[^"]*,meta"\)[\s\S]{0,80}\.order\("at"/.test(AU));
check(nid(), "…but the ONE scalar the list needs comes across as a JSON path, not the whole snapshot", "read GET /audit",
  () => /made:meta->>made/.test(AU));
check(nid(), "a detail id that is not a number is refused before it reaches the database", "read GET /audit",
  () => /if \(!\/\^\\d\+\$\/\.test\(detailId\)\) return err\("bad id", 400\)/.test(AU));
check(nid(), "…driven with ?detail=abc it answers 400, not 500", "driven live",
  () => needLive("auditBadId") || ({ ok: live("auditBadId").status === 400, note: `status ${live("auditBadId").status}` }));
check(nid(), "…and a record belonging to another restaurant reads as 'not for this restaurant'", "read GET /audit",
  () => /return err\("That record isn't for this restaurant\.", 404\)/.test(AU));
check(nid(), "a 'was the food made?' answer is NOT listed as something taken out of the system", "read GET /audit",
  () => /\.neq\("kind", "removal_classified"\)/.test(AU));
check(nid(), "the admin stays invisible to a manager reading the removals record", "read GET /audit",
  () => /auditForReader\(\(rows \|\| \[\]\) as/.test(AU) && /forReader\(one\[0\]/.test(AU));
check(nid(), "the customer log's three reads are all bounded", "read GET /users", () => count(US, /\.limit\(/g) >= 5);
check(nid(), "…and the blocklist names its columns, including what a blocked guest left to ask to be let back in", "read GET /users",
  () => /unban_phone, unban_requested_at/.test(US));
check(nid(), "the staff-watch card needs the DASHBOARD permission, because that is the screen it sits on", "read GET /staff-risk",
  () => /managerCan\(g, rid, "view_dashboard"\)\)\) return permDenied\("view the dashboard"\)/.test(RK));
check(nid(), "…and it is clamped to the same two ranges as the dashboard around it", "read GET /staff-risk",
  () => /clampDashRange\(new URL\(req\.url\)\.searchParams\.get\("range"\), riskReach\)/.test(RK));
check(nid(), "…driven with ?range=year it answers today, not a year", "driven live",
  () => needLive("riskYear") || (live("riskYear").status !== 200 ? "skip: refused" : ["today", "yesterday"].includes(J("riskYear").range)));
check(nid(), "…it aggregates on the SERVER, so the browser gets a tally and not thousands of rows", "read GET /staff-risk",
  () => /const rows = Object\.entries\(by\)\.map/.test(RK));
check(nid(), "…it hides admin and owner rows exactly like the activity log", "read GET /staff-risk", () => /\.not\("panel", "in", "\(admin,owner,db\)"\)/.test(RK));
check(nid(), "…and it says so when it had to stop paging", "read GET /staff-risk", () => /return ok\(\{ range, rows, truncated \}\)/.test(RK));
check(nid(), "…and an action with no person on it is named, not dropped", "read GET /staff-risk", () => /r\.actor \|\| "— \(device only\)"/.test(RK));

// ── the write path's first branches ────────────────────────────────────────────────────────────
check(nid(), "every logged write is attributed to the signed-in person, by name AND by stable id", "read postImpl",
  () => /const log = \(\.\.\.a: Parameters<typeof logAction>\) => logAction\(a\[0\], a\[1\], \{ actor: actorName, \.\.\.\(g\.user \? \{ actor_id: g\.user\.id \}/.test(PC));
check(nid(), "…and an admin acting from a panel view carries the admin marker instead", "read postImpl", () => /: \{ actor_id: ADMIN_VIEW_ACTOR_ID \}/.test(PC));
check(nid(), "a bill sent to the printer records WHICH bill, not just 'a bill'", "read POST /print/send",
  () => /printedWhat = `bill\$\{sess\.bill_no != null \? ` #\$\{sess\.bill_no\}` : ""\}`/.test(PC));
check(nid(), "…and it is filed under the table, so it sits with the rest of that table's story", "read POST /print/send", () => /table_number: printedTable/.test(PC));
check(nid(), "…and it records WHO sent it, like every other write in this file", "read POST /print/send",
  // log() is the wrapper that fills in the acting person's name AND their stable id; logAction()
  // is the raw writer, and calling it directly here is what left the By column empty.
  () => { const raw = /await logAction\("editor", g\.user \? "print_sent"/.test(PC);
    return { ok: !raw && /await log\("editor", g\.user \? "print_sent"/.test(PC),
             note: raw ? "a manager's own print row is filed with no name on it" : "" }; });
check(nid(), "only a bill or a banquet sheet can be sent this way — it is not a print-anything verb", "read POST /print/send",
  () => /if \(kind !== "bill" && kind !== "banquet"\) return err\("Only a bill or a banquet sheet can be sent this way\.", 400\)/.test(PC));
check(nid(), "…and the row must belong to THIS restaurant before anything is queued", "read POST /print/send",
  () => /\.eq\("id", sid\)\.eq\("restaurant_id", rid\)/.test(PC) && /\.eq\("id", bid\)\.eq\("restaurant_id", rid\)/.test(PC));
check(nid(), "…'no computer owns this paper' is a normal answer, so every restaurant keeps working", "read POST /print/send",
  () => /if \(!own\.owned\) return ok\(\{ noRoute: true \}\)/.test(PC));
check(nid(), "the ADMIN looking at a client's panel does not make paper come out of the client's printer", "read POST /print/send",
  () => /if \(!g\.user && \(body as Record<string, unknown>\)\?\.force !== true\)[\s\S]{0,120}?return ok\(\{ adminView: true/.test(PC));
check(nid(), "…and a deliberate 'send it anyway' from the console IS audited", "read POST /print/send",
  () => /sent deliberately from the admin console/.test(PC));
check(nid(), "…and the person is told honestly that it is waiting if that computer is asleep", "read POST /print/send",
  () => /Saved — it prints at \$\{own\.printer\} as soon as \$\{own\.agent\} is back/.test(PC));
check(nid(), "a waiter section list is sanitised and clamped to this restaurant's real tables", "read POST /table-sections",
  () => /if \(Number\.isFinite\(n\) && n >= 1 && n <= cnt && !seen\.has\(n\)\)/.test(PC));
check(nid(), "…and the write is scoped to this restaurant AND to a waiter", "read POST /table-sections",
  () => /\.eq\("id", uid\)\.eq\("restaurant_id", rid\)\.eq\("role", "tablet"\)/.test(PC));
check(nid(), "…and an empty list is a legitimate 'this waiter serves nothing yet'", "read POST /table-sections", () => /"no tables"/.test(PC));
check(nid(), "…and a failure does NOT hand the database's own sentence to the screen", "read POST /table-sections",
  // THE RULE, NOT THE SHAPE. The first version of this row matched `if (x.error) return err(...)`
  // on ONE line — so wrapping the same thing in braces walked straight past it, which is what the
  // sabotage pass found. What must hold is that nothing built from a database reply's own
  // `.error.message` is ever handed to err().
  () => { const bad = [...PC.matchAll(/err\([^;]{0,120}?\.error\.message/g)].map((m) => m[0].replace(/\s+/g, " "));
    return { ok: bad.length === 0, note: bad.join(" | ") }; });
check(nid(), "…and no refusal anywhere in this half is built from a database reply's own words", "read the whole half",
  () => { const bad = [...code(F.HELPERS + F.GETBLK + F.POSTBLK_A).matchAll(/err\([^;]{0,120}?\.error\.message/g)]
      .map((m) => m[0].replace(/\s+/g, " "));
    return { ok: bad.length === 0, note: bad.length ? bad.join(" | ") : "no refusal carries Postgres prose" }; });
check(nid(), "a customer capture is refused unless the customer directory is on for this restaurant", "read POST /customer-capture",
  () => /if \(!ent\.customers\) return err\("The customer directory isn't enabled for this restaurant\.", 403\)/.test(PC));
check(nid(), "…the session it names is verified against this restaurant AND this table before it is used", "read POST /customer-capture",
  () => /\.eq\("restaurant_id", rid\)\.eq\("table_number", t\)/.test(PC));
check(nid(), "…and a merged child table resolves to the party's parent, or the visit is lost", "read POST /customer-capture",
  () => /const t = await mergeParentTable\(sb, rid, tRaw\)/.test(PC));
check(nid(), "…and nothing is stored without consent — the RPC is told so explicitly", "read POST /customer-capture", () => /p_consent: body\?\.consent === true/.test(PC));
check(nid(), "a new order from this panel is priced by the SERVER, never from what the screen sent", "read POST /order",
  () => /lfh_staff_place_order/.test(PC) && !/p_price/.test(PC));
check(nid(), "…it needs both rungs: order-taking on for the restaurant, and the take_orders grant", "read POST /order",
  () => /takeOrdersLadder\(rid\)\)\.effective\) return err\("Order-taking isn't enabled/.test(PC) && /managerCan\(g, rid, "take_orders"\)/.test(PC));
check(nid(), "…a table that does not exist is refused, with the real table count in the sentence", "read POST /order",
  () => /doesn't exist \(this place has \$\{tableCount\} tables\)/.test(PC));
check(nid(), "…a double tap within 3 seconds is warned about, and the warning is overridable", "read POST /order",
  () => /duplicateWarning: true/.test(PC) && /confirmDuplicate/.test(PC));
check(nid(), "…and 'send it anyway' reaches the RPC's own lock, not just the JavaScript guard", "read POST /order",
  () => /p_confirm_duplicate: body\?\.confirmDuplicate === true/.test(PC));
check(nid(), "…a REFUSAL is surfaced as an error, never as 'sent to the kitchen' with nothing placed", "read POST /order",
  () => /\.ok === false\)[\s\S]{0,140}?return err\(editErrMsg/.test(PC));
check(nid(), "…and who punched it rides along on the same update, with no extra round trip", "read POST /order",
  () => /placed_by_id: g\.user\?\.id \?\? null, placed_by: actorName/.test(PC));
check(nid(), "the duplicate check reads at most five recent rows, scoped to this table and restaurant", "read POST /order",
  () => /\.eq\("table_number", t\)\.eq\("restaurant_id", rid\)[\s\S]{0,140}?\.limit\(5\)/.test(PC));
check(nid(), "a complaint raised here carries who raised it and in what role", "read POST /issue",
  () => /raisedBy: g\.user\?\.name \|\| g\.user\?\.username \|\| "Manager"/.test(PC) && /raisedRole: g\.user\?\.role \|\| "manager"/.test(PC));
check(nid(), "…and a refused complaint is a 400 with a sentence, not a 500", "read POST /issue",
  () => /catch \(e\) \{ return err\(e instanceof Error \? e\.message : "Couldn't raise the issue\.", 400\); \}/.test(PC));

// ── the discount typed into a quick order, applied in the same request ─────────────────────────
check(nid(), "a quick-order discount is applied in the SAME request, never as a second call that can fail on its own", "read POST /order",
  () => /const rawDisc = Number\(body\?\.discount\)/.test(PC) && /lfh_staff_bill_discount/.test(PC));
check(nid(), "…and it needs the same give_discounts power the − Discount button needs", "read POST /order",
  () => /managerCan\(g, rid, "give_discounts"\)\)\) return permDenied\("give discounts"\)/.test(PC));
check(nid(), "…and the same role %-cap, so a quick order is not a way round a waiter's 5% limit", "read POST /order",
  () => /if \(overDiscountCap\(rawDisc, base, cap\)\) return err\(`That discount is over your \$\{cap\}% limit/.test(PC));
check(nid(), "…and the same money cap, so an MRP bottle stays at its legally final price", "read POST /order",
  () => /const base = discountBaseOf\(row \|\| \{\}, effectiveTaxRate\(await taxSettings\(rid\)\)\)/.test(PC));
check(nid(), "…and it ADDS to what the table already has, rather than silently wiping it", "read POST /order",
  () => /const already = sib\.reduce/.test(PC) && /p_amount: Math\.round\(\(already \+ amount\) \* 100\) \/ 100/.test(PC));
check(nid(), "…counting a cancelled order's discount as zero", "read POST /order", () => /o\.status === "cancelled" \? 0 : Number\(o\.discount\) \|\| 0/.test(PC));
check(nid(), "…reading the siblings from the SESSION, so a discount given seconds ago on another device is included", "read POST /order",
  () => /\.eq\("session_id", row\.session_id\)\.eq\("restaurant_id", rid\)/.test(PC));
check(nid(), "…a solo order (no session) is discounted on its own row, scoped", "read POST /order",
  () => /update\(\{ discount: amount, discount_note: note \}\)\.eq\("id", placedId\)\.eq\("restaurant_id", rid\)/.test(PC));
check(nid(), "…the note is trimmed to 200 characters before it is stored", "read POST /order", () => /String\(body\?\.discountNote \|\| ""\)\.slice\(0, 200\)/.test(PC));
check(nid(), "…the amount is clamped to the cap and rounded to the paisa", "read POST /order",
  () => /Math\.round\(Math\.min\(Math\.max\(rawDisc, 0\), base\) \* 100\) \/ 100/.test(PC));
check(nid(), "…and it is written into the Activity log with the amount and the reason", "read POST /order",
  () => /await log\("manager", "order_discount", \{ restaurant_id: rid, order_id: placedId/.test(PC));
check(nid(), "…and placing the order is logged with the table and the device", "read POST /order",
  () => /await log\("editor", "order_place", \{ restaurant_id: rid, table_number: t, device_id: dev/.test(PC));
check(nid(), "the sibling-discount read is bounded like every other read here", "read POST /order",
  () => { const m = PC.match(/from\("orders"\)\.select\("discount, status"\)[\s\S]{0,200}/);
    return { ok: !m || /\.limit\(/.test(m[0].split(")")[0] + m[0]), note: m ? m[0].replace(/\s+/g, " ").slice(0, 100) : "no sibling read" }; });
