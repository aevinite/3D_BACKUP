// SWEEP #10 · T11 · block B — THE PANEL'S OWN FUNCTIONS, RUN IN THE REAL PANEL. P180241–P180360.
//
// The real public/panels/kitchen/app.js, loaded by the real /kitchen page on this terminal's port and
// signed in as French House's kitchen login. Each row calls the panel's OWN function (they are
// top-level declarations, so they live in the frame's global scope) with a value and reads the answer.
// Nothing is re-implemented and nothing reaches the database.
import { check, openBoard, F } from "./lib.mjs";

const A = F.app;
let board = null;
const fr = async () => { if (!board) board = await openBoard(); return board.frame; };
/** Evaluate an expression string in the panel and compare to the expected value. */
const ev = (expr) => async () => (await fr()).evaluate(new Function(`return (${expr});`));
const eq = (expr, want) => async () => { const got = await (await fr()).evaluate(new Function(`return (${expr});`)); return { ok: JSON.stringify(got) === JSON.stringify(want), note: JSON.stringify(got) }; };
const P = "PANEL — the real function, called in the running panel";
const MIN = 60000, H = 60 * MIN;
const ago = (ms) => `new Date(Date.now() - ${ms}).toISOString()`;

// ── esc — P180241–P180248 ─────────────────────────────────────────────────────────────────────
check("P180241", A, "esc() escapes <, >, &, \" and '", P, eq(`esc("<b a=\\"1\\">&'")`, "&lt;b a=&quot;1&quot;&gt;&amp;&#39;"));
check("P180242", A, "esc(null) is an empty string, never 'null'", P, eq("esc(null)", ""));
check("P180243", A, "esc(undefined) is an empty string, never 'undefined'", P, eq("esc(undefined)", ""));
check("P180244", A, "esc(0) keeps the zero", P, eq("esc(0)", "0"));
check("P180245", A, "esc of an emoji/Hindi title passes it through untouched", P, eq(`esc("पनीर 🔥")`, "पनीर 🔥"));
check("P180246", A, "esc does not double-escape an already-escaped ampersand into nonsense twice", P, eq(`esc("&amp;")`, "&amp;amp;"));
check("P180247", A, "esc of a template-looking string keeps it literal", P, eq("esc('${x}')", "${x}"));
check("P180248", A, "esc of a number object stringifies, never '[object Object]' for a plain number", P, eq("esc(12.5)", "12.5"));

// ── table labels — P180249–P180262 ────────────────────────────────────────────────────────────
const withNames = (names, expr) => `(() => { const keep = state.tableNames; state.tableNames = ${JSON.stringify(names)}; try { return ${expr}; } finally { state.tableNames = keep; } })()`;
check("P180249", A, "a plain table reads T7", P, eq(withNames({}, "tshort(7)"), "T7"));
check("P180250", A, "a renamed table reads its NAME, not the number", P, eq(withNames({ 7: "Patio" }, "tshort(7)"), "Patio"));
check("P180251", A, "the name is looked up by the number as a string key", P, eq(withNames({ "7": "A1" }, "tshort(7)"), "A1"));
check("P180252", A, "a name of only spaces falls back to the number", P, eq(withNames({ 7: "   " }, "tshort(7)"), "T7"));
check("P180253", A, "a name with surrounding spaces is trimmed", P, eq(withNames({ 7: "  Bar  " }, "tshort(7)"), "Bar"));
check("P180254", A, "no table (null) reads T? — never Tnull", P, eq("tshort(null)", "T?"));
check("P180255", A, "no table (undefined) reads T?", P, eq("tshort(undefined)", "T?"));
check("P180256", A, "an empty-string table reads T?", P, eq('tshort("")', "T?"));
check("P180257", A, "table 0 is a real table (T0), not 'no table'", P, eq("tshort(0)", "T0"));
check("P180258", A, "tlong and tshort agree for a named table", P, eq(withNames({ 3: "Window" }, "[tshort(3), tlong(3)]"), ["Window", "Window"]));
check("P180259", A, "tlong of no table is T? — the screen and the paper agree", P, eq("tlong(null)", "T?"));
check("P180260", A, "whereFor uses the short form on screen and the long form on paper", P, eq(withNames({}, "[whereFor({table_number: 9}, false), whereFor({table_number: 9}, true)]"), ["T9", "T9"]));
check("P180261", A, "whereFor of a missing order is T?, never a crash", P, eq("whereFor(null, true)", "T?"));
check("P180262", A, "a table name containing markup is returned raw (escaped once at the render site)", P, eq(withNames({ 2: "<i>x</i>" }, "tshort(2)"), "<i>x</i>"));

// ── ages — P180263–P180290 ────────────────────────────────────────────────────────────────────
check("P180263", A, "a timestamp from 10s ago reads 'just now'", P, eq(`timeAgo(${ago(10000)})`, "just now"));
check("P180264", A, "a timestamp 1 minute ago reads 1m", P, eq(`timeAgo(${ago(MIN + 500)})`, "1m"));
check("P180265", A, "59 minutes reads 59m", P, eq(`timeAgo(${ago(59 * MIN + 500)})`, "59m"));
check("P180266", A, "60 minutes reads 1h 0m", P, eq(`timeAgo(${ago(60 * MIN + 500)})`, "1h 0m"));
check("P180267", A, "23h 59m stays in hours", P, eq(`timeAgo(${ago(23 * H + 59 * MIN + 500)})`, "23h 59m"));
check("P180268", A, "24 hours reads 1d 0h", P, eq(`timeAgo(${ago(24 * H + 500)})`, "1d 0h"));
check("P180269", A, "4 days 21 hours reads 4d 21h (the overnight table)", P, eq(`timeAgo(${ago(117 * H + 500)})`, "4d 21h"));
check("P180270", A, "a time in the FUTURE (device clock behind) reads 'just now', not a negative age", P, eq(`timeAgo(new Date(Date.now() + 3600000).toISOString())`, "just now"));
check("P180271", A, "a null timestamp says nothing — never '496071h'", P, eq("timeAgo(null)", ""));
check("P180272", A, "a garbage timestamp says nothing — never 'NaNh NaNm'", P, eq('timeAgo("not a date")', ""));
check("P180273", A, "an epoch-zero timestamp says nothing", P, eq('timeAgo("1970-01-01T00:00:00Z")', ""));
check("P180274", A, "ageMinutes of an empty string is null", P, eq('ageMinutes("")', null));
check("P180275", A, "29 minutes cooking: no warning", P, eq(`ageClass(${ago(29 * MIN + 500)})`, ""));
check("P180276", A, "30 minutes cooking: the half-hour warning", P, eq(`ageClass(${ago(30 * MIN + 500)})`, " age-warn"));
check("P180277", A, "119 minutes: still the warning step", P, eq(`ageClass(${ago(119 * MIN + 500)})`, " age-warn"));
check("P180278", A, "2 hours: the late step", P, eq(`ageClass(${ago(120 * MIN + 500)})`, " age-late"));
check("P180279", A, "23h 59m: still late, not stale", P, eq(`ageClass(${ago(1439 * MIN + 500)})`, " age-late"));
check("P180280", A, "24 hours: the stale (earlier day) step", P, eq(`ageClass(${ago(1440 * MIN + 500)})`, " age-stale"));
check("P180281", A, "an unreadable time gets no age class at all", P, eq('ageClass("x")', ""));
check("P180282", A, "the stale step's words say it is probably a table nobody closed", P, async () => { const t = await ev(`ageTitle(${ago(30 * H)})`)(); return { ok: /earlier day/.test(t) && /nobody closed/.test(t), note: t }; });
check("P180283", A, "the late step's words", P, eq(`ageTitle(${ago(3 * H)})`, "This ticket has been cooking a long time"));
check("P180284", A, "the warning step's words", P, eq(`ageTitle(${ago(40 * MIN)})`, "This ticket has been cooking over half an hour"));
check("P180285", A, "a fresh ticket has no hover words", P, eq(`ageTitle(${ago(5 * MIN)})`, ""));
check("P180286", A, "the three thresholds are 30 / 120 / 1440 minutes", P, eq("[AGE_WARN_MIN, AGE_LATE_MIN, AGE_STALE_MIN]", [30, 120, 1440]));
check("P180287", A, "orderTime of a bad value is Infinity (it sorts LAST, never first)", P, eq('orderTime("garbage") === Infinity && orderTime(null) === Infinity', true));
check("P180288", A, "cmpTime of two undateable tickets is 0, never NaN", P, eq("cmpTime(null, 'x')", 0));
check("P180289", A, "cmpTime puts the older ticket first", P, eq(`cmpTime(${ago(2 * H)}, ${ago(MIN)})`, -1));
check("P180290", A, "a dated ticket sorts before an undated one", P, eq(`cmpTime(${ago(MIN)}, null)`, -1));

// ── the whole-table note — P180291–P180300 ────────────────────────────────────────────────────
check("P180291", A, "two dishes with the same note → the note is the whole table's", P, eq('sharedOrderNote([{note:"no chilli"},{note:"no chilli"}])', "no chilli"));
check("P180292", A, "one dish alone never makes a whole-table note", P, eq('sharedOrderNote([{note:"no chilli"}])', ""));
check("P180293", A, "different notes stay per dish", P, eq('sharedOrderNote([{note:"a"},{note:"b"}])', ""));
check("P180294", A, "one dish with a note and one without stay per dish", P, eq('sharedOrderNote([{note:"a"},{note:""}])', ""));
check("P180295", A, "notes differing only by surrounding spaces count as the same instruction", P, eq('sharedOrderNote([{note:" a "},{note:"a"}])', "a"));
check("P180296", A, "all-empty notes are no note", P, eq('sharedOrderNote([{note:""},{note:"  "}])', ""));
check("P180297", A, "a null rows list is no note, not a crash", P, eq("sharedOrderNote(null)", ""));
check("P180298", A, "a null row inside the list is treated as no note", P, eq('sharedOrderNote([{note:"a"}, null])', ""));
check("P180299", A, "numeric notes are compared as text", P, eq("sharedOrderNote([{note:5},{note:'5'}])", "5"));
check("P180300", A, "case matters — 'No onion' and 'no onion' stay per dish", P, eq('sharedOrderNote([{note:"No onion"},{note:"no onion"}])', ""));

// ── which lane — P180301–P180316 ──────────────────────────────────────────────────────────────
const ph = (o, rows) => `orderPhase(${JSON.stringify(o)}, ${JSON.stringify(rows)})`;
check("P180301", A, "a received order is New whatever its dishes say", P, eq(ph({ status: "received" }, [{ status: "ready" }]), "new"));
check("P180302", A, "a preparing order with one cooking dish is Cooking", P, eq(ph({ status: "preparing" }, [{ status: "preparing" }]), "cooking"));
check("P180303", A, "all dishes ready → Ready", P, eq(ph({ status: "preparing" }, [{ status: "ready" }, { status: "ready" }]), "ready"));
check("P180304", A, "ready + served → Ready (still on the pass)", P, eq(ph({ status: "preparing" }, [{ status: "ready" }, { status: "served" }]), "ready"));
check("P180305", A, "all served → off the board", P, eq(ph({ status: "preparing" }, [{ status: "served" }]), "served"));
check("P180306", A, "cooking + served → still Cooking", P, eq(ph({ status: "preparing" }, [{ status: "preparing" }, { status: "served" }]), "cooking"));
check("P180307", A, "a preparing order with no dishes yet is Cooking", P, eq(ph({ status: "preparing" }, []), "cooking"));
check("P180308", A, "a served order with no dishes leaves the board", P, eq(ph({ status: "served" }, []), "served"));
check("P180309", A, "a received dish inside a preparing order keeps it Cooking", P, eq(ph({ status: "preparing" }, [{ status: "received" }, { status: "ready" }]), "cooking"));
check("P180310", A, "platform: new → New", P, eq('platPhase("new")', "new"));
check("P180311", A, "platform: accepted → Cooking", P, eq('platPhase("accepted")', "cooking"));
check("P180312", A, "platform: preparing → Cooking", P, eq('platPhase("preparing")', "cooking"));
check("P180313", A, "platform: ready → Ready", P, eq('platPhase("ready")', "ready"));
check("P180314", A, "platform: handed_over → off the board", P, eq('platPhase("handed_over")', "served"));
check("P180315", A, "platform: an unknown status is never put in a lane", P, eq('platPhase("weird")', "served"));
check("P180316", A, "rowsOf falls back to a legacy order's own items JSON when it has no dish rows", P, eq('rowsOf({id:"zz", status:"preparing", items:[{title:"Tea", qty:2}]}, []).map(r => [r.title, r.qty, r.status, r.fromDb])', [["Tea", 2, "preparing", false]]));

// ── restaurant name — P180317–P180324 ─────────────────────────────────────────────────────────
check("P180317", A, "the short brand label (logo_text) wins", P, eq('restDisplayName({logo_text:"FH", name:"French House"})', "FH"));
check("P180318", A, "a blank logo_text falls back to the name", P, eq('restDisplayName({logo_text:"  ", name:"French House"})', "French House"));
check("P180319", A, "a translated name object reads its English", P, eq('restDisplayName({name:{en:"Aangan", hi:"आँगन"}})', "Aangan"));
check("P180320", A, "a name object with no English reads any translation", P, eq('restDisplayName({name:{hi:"आँगन"}})', "आँगन"));
check("P180321", A, "nothing loaded yet → '' (never 'undefined')", P, eq("restDisplayName(null)", ""));
check("P180322", A, "a restaurant with no name at all → the neutral 'Restaurant', never a hard-coded brand", P, eq("restDisplayName({})", "Restaurant"));
check("P180323", A, "setRestName strips the *accent* wordmark stars", P, async () => { const f = await fr(); const t = await f.evaluate(() => { const el = document.getElementById("restName"); const keep = el.textContent; setRestName({ logo_text: "*Le* Bistro" }); const out = el.textContent; el.textContent = keep; return out; }); return { ok: t === "Le Bistro", note: t }; });
check("P180324", A, "the header shows THIS restaurant (French House), set from the board, not hard-coded", P, async () => { const t = await (await fr()).evaluate(() => document.getElementById("restName").textContent); return { ok: /french|FH|house/i.test(t), note: t }; });

// ── printer words — P180325–P180340 ──────────────────────────────────────────────────────────
const ww = (wait, stuck) => `(() => { const k1 = state.waiting, k2 = state.stuckAfterMs; state.waiting = ${JSON.stringify(wait)}; state.stuckAfterMs = ${stuck}; try { return waitingWords(); } finally { state.waiting = k1; state.stuckAfterMs = k2; } })()`;
check("P180325", A, "nothing waiting → 'none — everything has printed', not stuck", P, async () => { const w = await ev(ww({ n: 0, oldestMs: null }, 60000))(); return { ok: w.n === 0 && !w.stuck && /everything has printed/.test(w.text), note: w.text }; });
check("P180326", A, "one ticket 20s old: 'just now', not stuck", P, async () => { const w = await ev(ww({ n: 1, oldestMs: 20000 }, 60000))(); return { ok: !w.stuck && w.text === "1 ticket — oldest just now", note: w.text }; });
check("P180327", A, "the stuck threshold is the SERVER's number, not a copy", P, async () => { const a = await ev(ww({ n: 2, oldestMs: 90000 }, 60000))(); const b = await ev(ww({ n: 2, oldestMs: 90000 }, 120000))(); return a.stuck === true && b.stuck === false; });
check("P180328", A, "minutes read 'N min ago'", P, async () => { const w = await ev(ww({ n: 3, oldestMs: 5 * MIN }, 60000))(); return { ok: w.text === "3 tickets — oldest 5 min ago", note: w.text }; });
check("P180329", A, "hours read 'Nh ago'", P, async () => { const w = await ev(ww({ n: 3, oldestMs: 3 * H }, 60000))(); return { ok: /oldest 3h ago/.test(w.text), note: w.text }; });
check("P180330", A, "past a day it says days ('3d ago', owner 2026-09-13)", P, async () => { const w = await ev(ww({ n: 1, oldestMs: 3 * 24 * H }, 60000))(); return { ok: /oldest 3d ago/.test(w.text), note: w.text }; });
check("P180331", A, "a missing waiting block reads as nothing waiting", P, async () => { const w = await ev(ww(null, 60000))(); return w.n === 0; });
check("P180332", A, "a waiting count sent as a string still counts", P, async () => { const w = await ev(ww({ n: "4", oldestMs: 1000 }, 60000))(); return w.n === 4; });
check("P180333", A, "singular: '1 ticket', plural: 'N tickets'", P, async () => { const a = await ev(ww({ n: 1, oldestMs: 1 }, 60000))(); const b = await ev(ww({ n: 2, oldestMs: 1 }, 60000))(); return /^1 ticket /.test(a.text) && /^2 tickets /.test(b.text); });
const psh = (stateBits) => `(() => { const keep = {}; const s = ${JSON.stringify(stateBits)}; for (const k in s) { keep[k] = state[k]; state[k] = s[k]; } try { return printerStatusHtml(); } finally { for (const k in keep) state[k] = keep[k]; } })()`;
check("P180334", A, "the 🖨 sheet says 'this screen' when this screen is the printer", P, async () => { const h = await ev(psh({ autoPrintKot: true, kotPrintTarget: "kitchen", helper: null, printRefused: null, station: { active: null, mine: true } }))(); return { ok: /this screen/.test(h) && /THIS screen/.test(h) && /<b>ON<\/b>/.test(h), note: h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 120) }; });
check("P180335", A, "a STOPPED queue says 'nobody right now — printing is stopped…' (item 4 makes it reachable)", P, async () => { const h = await ev(psh({ autoPrintKot: false, kotPrintTarget: "kitchen", helper: null, printRefused: "paused" }))(); return /printing is stopped for this restaurant/.test(h) && !/<b>this screen<\/b>/.test(h); });
check("P180336", A, "slips switched off says 'nobody — switched off'", P, async () => { const h = await ev(psh({ autoPrintKot: false, helper: null, printRefused: "off" }))(); return /switched off for this restaurant/.test(h); });
check("P180337", A, "another panel named says 'another screen — not this one'", P, async () => { const h = await ev(psh({ helper: null, printRefused: "other_panel" }))(); return /another screen — not this one/.test(h); });
check("P180338", A, "a named person / a named computer each get their own words", P, async () => { const a = await ev(psh({ helper: null, printRefused: "other_person" }))(); const b = await ev(psh({ helper: null, printRefused: "other_device" }))(); return /one named person/.test(a) && /one named computer/.test(b); });
check("P180339", A, "a computer owning the slips names the printer AND the computer, escaped", P, async () => { const h = await ev(psh({ helper: { owned: true, printer: "POS<80>", agent: "Shop's PC", connected: true }, printRefused: "computer" }))(); return { ok: /POS&lt;80&gt; — from Shop&#39;s PC/.test(h) && /\(ready\)/.test(h), note: h.slice(0, 160) }; });
check("P180340", A, "a sleeping computer says the tickets are waiting, with minutes when it knows them", P, async () => { const h = await ev(psh({ helper: { owned: true, printer: "P", agent: "PC", connected: false, secondsAgo: 600 }, printRefused: "computer" }))(); return { ok: /asleep, tickets are waiting/.test(h) && /10 min/.test(h), note: h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(-140) }; });

// ── the fingerprint — P180341–P180352 ─────────────────────────────────────────────────────────
const sig = (a, b) => `boardSig(${a}) === boardSig(${b})`;
const D = (o) => JSON.stringify({ orders: [{ id: "1", status: "preparing", ...o }], items: [], dishes: [], platform: [], platformAccept: false });
check("P180341", A, "a heartbeat column (updated_at) changing does NOT repaint the board", P, eq(sig(D({ updated_at: "a" }), D({ updated_at: "b" })), true));
check("P180342", A, "last_activity_at / served_at / cart_updated_at are heartbeats too", P, eq(sig(D({ last_activity_at: 1, served_at: 1, cart_updated_at: 1 }), D({ last_activity_at: 2, served_at: 2, cart_updated_at: 2 })), true));
check("P180343", A, "an allergy edit DOES repaint (any drawn field flips the signature)", P, eq(sig(D({ allergies: [] }), D({ allergies: ["nuts"] })), false));
check("P180344", A, "a FUTURE column nobody listed still repaints (no hand-picked field list)", P, eq(sig(D({}), D({ some_new_column: 1 })), false));
check("P180345", A, "a status change repaints", P, eq(sig(D({ status: "preparing" }), D({ status: "received" })), false));
check("P180346", A, "renaming a table repaints even though the orders did not change", P, async () => (await fr()).evaluate((d) => { const keep = state.tableNames; const a = boardSig(JSON.parse(d)); state.tableNames = { ...keep, 99: "Renamed" }; const b = boardSig(JSON.parse(d)); state.tableNames = keep; return a !== b; }, D({})));
check("P180347", A, "a VIP mark appearing repaints", P, async () => (await fr()).evaluate((d) => { const keep = state.tableTags; const a = boardSig(JSON.parse(d)); state.tableTags = { ...keep, 99: "vip" }; const b = boardSig(JSON.parse(d)); state.tableTags = keep; return a !== b; }, D({})));
check("P180348", A, "auto-print flipping repaints", P, async () => (await fr()).evaluate((d) => { const keep = state.autoPrintKot; const a = boardSig(JSON.parse(d)); state.autoPrintKot = !keep; const b = boardSig(JSON.parse(d)); state.autoPrintKot = keep; return a !== b; }, D({})));
check("P180349", A, "stableRow drops exactly the four heartbeat columns", P, eq('Object.keys(stableRow({a:1, updated_at:1, last_activity_at:1, cart_updated_at:1, served_at:1})).join()', "a"));
check("P180350", A, "stableRow of null is an empty object", P, eq("JSON.stringify(stableRow(null))", "{}"));
check("P180351", A, "itemsByOrderId groups dishes by their order once", P, eq('(() => { const k = state.items; state.items = [{order_id:"a"},{order_id:"b"},{order_id:"a"},{order_id:null}, null]; try { const m = itemsByOrderId(); return [m.get("a").length, m.get("b").length, m.size]; } finally { state.items = k; } })()', [2, 1, 2]));
check("P180352", A, "guestPlaced is true only for guest: 1 exactly", P, eq('[guestPlaced({guest:1}), guestPlaced({guest:true}), guestPlaced({}), guestPlaced(null)]', [true, false, false, false]));

// ── wiring the panel owns at boot — P180353–P180360 ───────────────────────────────────────────
check("P180353", A, "the kitchen opted out of every profile surface (R7)", P, eq("[window.LFH_SUPPRESS_SETTINGS_BTN, window.LFH_NO_PROFILE_AT_ALL]", [true, true]));
check("P180354", A, "the render counters exist for a rush-hour diagnosis", P, eq('["fullRenders","patches","tilesPatched","lastMs","longTasks"].every(k => typeof __lfhPerf[k] === "number")', true));
check("P180355", A, "the board baseline was taken (knownIds set) on the first load", P, eq("state.knownIds instanceof Set", true));
check("P180356", A, "the printed-tickets memory is a Set of strings only", P, eq("[...printedIds].every(x => typeof x === 'string')", true));
check("P180357", A, "a staff tab carries NO admin pin (?rid / ?view / ?as are empty)", P, eq("[PANEL_RID, !!PANEL_VIEW_REAL, PANEL_AS]", ["", false, ""]));
check("P180358", A, "ridQ() leaves a staff tab's paths untouched", P, eq('ridQ("/board?x=1")', "/board?x=1"));
check("P180359", A, "the board is NOT on the 2-second poll — realtime is in charge", P, eq("!!window.LFH_RT", true));
check("P180360", A, "the board read asks for the queue's auto rows (?autojobs=1, the version handshake)", P, async () => { const f = await fr(); return /api\("GET", "\/board\?autojobs=1"\)/.test(await f.evaluate(() => loadImpl.toString())); });
