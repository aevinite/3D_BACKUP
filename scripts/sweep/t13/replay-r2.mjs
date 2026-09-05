// scripts/sweep/t13/replay-r2.mjs — re-runs the T12 round-2 ledger rows (P20601–P21100) that are
// about files THIS terminal owns. Round 2 was the tile popup, the money model, the records/partial
// handling and the egress budget — nearly all of it app/owner/page.tsx and the two routes.
//
// The audit/activity-log rows in that block (P20691–P20775, P20886–P20916, and the label/actor
// rows) are NOT here: /owner/activity/** and the shared audit modules are another sweep-#8
// terminal's territory, and two terminals editing one row is how three collisions happened.
import { chk, skip, code, src, styles, report, setOnly, count } from "./lib.mjs";

const PAGE = "app/owner/page.tsx";
const ANALYTICS = "app/api/owner/analytics/route.ts";
const OVERVIEW = "app/api/owner/overview/route.ts";
const p = code(PAGE), praw = src(PAGE), css = styles(PAGE);
const a = code(ANALYTICS), o = code(OVERVIEW);

const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));

/** the tileDetail() body — every popup row assertion reads this, so find it once */
const tileDetail = (() => {
  const m = /const tileDetail = \(\)[\s\S]*?\n      default: return null;\n    \}\n  \};/.exec(p);
  if (!m) throw new Error("tileDetail() not found");
  return m[0];
})();
const caseBody = (name) => {
  const m = new RegExp(`case "${name}": (?:return )?\\{([\\s\\S]*?)\\n      \\};?`).exec(tileDetail)
        || new RegExp(`case "${name}": return \\{([\\s\\S]*?)\\n      \\};`).exec(tileDetail);
  if (!m) throw new Error(`the ${name} popup case not found`);
  return m[1];
};

// ── the tile popup ───────────────────────────────────────────────────────────────────────────
chk("P20601", "tileDetail() returns null for anything that is not one of the five tiles", () =>
  /default: return null;/.test(tileDetail) ? true : "the default branch is gone — an unknown tile would render undefined");
chk("P20602", "the five tileOpen values are exactly the five tiles rendered", () => {
  const declared = /useState<null \| ("[a-z]+"(?: \| "[a-z]+")*)>\(null\)/.exec(
    /const \[tileOpen, setTileOpen\][\s\S]*?\(null\);/.exec(p)[0]);
  const types = declared[1].match(/"([a-z]+)"/g).map((s) => s.replace(/"/g, "")).sort();
  const cases = [...tileDetail.matchAll(/case "([a-z]+)":/g)].map((m) => m[1]).sort();
  const opens = [...p.matchAll(/setTileOpen\("([a-z]+)"\)/g)].map((m) => m[1]).sort();
  const eq = (x, y) => x.join(",") === y.join(",");
  return types.length === 5 && eq(types, cases) && eq(types, opens)
    ? true : `type=[${types}] cases=[${cases}] openers=[${opens}]`;
});
chk("P20603", "the popup is registered with the back-stack manager", () =>
  /useBackClose\("owner-kpi-tile", !!tileOpen, \(\) => setTileOpen\(null\)\)/.test(p)
    ? true : "the popup's back layer is gone");
chk("P20604", "…and its Escape listener is removed when it closes", () => {
  const m = /if \(!tileOpen\) return;([\s\S]*?)\}, \[tileOpen\]\);/.exec(p);
  if (!m) return "the tile Escape effect not found";
  return /return \(\) => document\.removeEventListener\("keydown", onKey\);/.test(m[1])
    ? true : "the listener is not cleaned up";
});
chk("P20605", "the popup can be closed four ways — ✕, backdrop, Escape and the phone's BACK", () => {
  const back = /useBackClose\("owner-kpi-tile"/.test(p);
  const bd = /<div className="ow2-tile-back" onClick=\{\(\) => setTileOpen\(null\)\}/.test(p);
  const x = /<button className="x" onClick=\{\(\) => setTileOpen\(null\)\} aria-label="Close">/.test(p);
  const esc = /if \(!tileOpen\) return;[\s\S]{0,200}?e\.key === "Escape"[\s\S]{0,30}?setTileOpen\(null\)/.test(p);
  return back && bd && x && esc ? true : `back=${back} backdrop=${bd} x=${x} escape=${esc}`;
});
chk("P20606", "opening a popup costs ZERO extra requests", () =>
  !/fetch\(/.test(tileDetail) ? true : "tileDetail() issues a request");
chk("P20607", "the popup's heading says WHOSE numbers these are", () =>
  /const who = activeRid\s*\n?\s*\? \(ov\?\.restaurants\.find\(\(r\) => r\.id === activeRid\)\?\.name \?\? "this restaurant"\)/.test(p)
    ? true : "the `who` line changed");
chk("P20608", "`who` never renders undefined before the overview lands", () =>
  /\?\? "this restaurant"\)/.test(p) && /: `all \$\{restCount\} restaurant\$\{restCount === 1 \? "" : "s"\}`/.test(p)
    ? true : "one of the two `who` fallbacks is gone");
chk("P20609", "a popup row's isTotal is EXPLICIT, never 'the last row'", () => {
  // the row tuple carries a 4th element; the renderer must read THAT, not compare an index
  const reads = /\{d\.rows\.map\(\(\[label, value, hint, isTotal\]\) => \(/.test(p);
  const cls = /className=\{`r\$\{isTotal \? " last" : ""\}`\}/.test(p);
  const noIndex = !/rows\.length - 1/.test(p);
  return reads && cls && noIndex ? true : `destructures=${reads} class=${cls} noIndexCompare=${noIndex}`;
});
chk("P20610", "only two popups declare a total at all", () => {
  const totals = count(tileDetail, /, true\]/g);
  return totals === 2 ? true : `${totals} rows are marked as a total, expected 2 (Expenses, On hand)`;
});
chk("P20611", "the Revenue popup's first line says what the figure already excludes", () =>
  /\["Revenue", inr\(kMain\?\.revenue \?\? 0\), "after discounts, cancelled bills never counted"\]/.test(caseBody("revenue"))
    ? true : "the Revenue hint changed");
chk("P20612", "the Revenue popup quotes NO cancellation FIGURE", () => {
  const b = caseBody("revenue");
  const rows = /rows: \[([\s\S]*?)\n        \],/.exec(b);
  if (!rows) return "the Revenue rows not found";
  // A bare /cancel/i was a detector fault: the first row's HINT legitimately says "after
  // discounts, cancelled bills never counted" — a sentence explaining what the figure excludes,
  // which is the opposite of quoting one. What must never appear is a cancellation NUMBER, i.e.
  // the money rollup's cancelled fields interpolated into a row value.
  const figures = /mt[?.!]*\.(cancelledOrders|cancelledValue)/.test(rows[1]);
  return !figures ? true : "a cancellation figure from the money rollup is back in the Revenue rows";
});
chk("P20613", "…and the note's link is gated on the same `logs` entitlement the sidebar uses", () =>
  /\{d\.audit && ov\?\.entitlements\?\.logs !== false \? \(/.test(p)
    ? true : "the audit link is no longer gated on `logs`");
chk("P20614", "the discount line only appears when a discount was actually given", () =>
  /\.\.\.\(mt && mt\.discount > 0 \? \[\["Discounts given"/.test(caseBody("revenue"))
    ? true : "the discount row is no longer conditional");
chk("P20615", "…and calls a discount money, because it is", () =>
  /money you gave away — already taken off the revenue above/.test(caseBody("revenue"))
    ? true : "the discount wording changed");
chk("P20616", "the Orders popup's 'Still open' can never be negative", () =>
  /Math\.max\(0, \(kMain\?\.orders \?\? 0\) - \(kMain\?\.paidOrders \?\? 0\)\)/.test(caseBody("orders"))
    ? true : "the Math.max(0, …) floor is gone");
chk("P20617", "…and its average names its own divisor", () =>
  /\["Average per paid order", inr\(kMain\?\.avg \?\? 0\), "revenue ÷ paid orders"\]/.test(caseBody("orders"))
    ? true : "the divisor caption changed");
chk("P20618", "the Today popup says it does not follow the period dropdown", () =>
  /This one does not follow the period above — it is always today\./.test(caseBody("today"))
    ? true : "the Today popup's note changed");
chk("P20619", "…and its 'See the full detail' link agrees with that sentence", () =>
  /q\.set\("range", t === "daysummary" \? "today" : globalRange\);/.test(p)
    ? true : "the Today link carries the dropdown's range again — one screen, two answers");
chk("P20620", "the Today popup's average is guarded against zero", () =>
  /inr\(todayOrd \? todayRev \/ todayOrd : 0\)/.test(caseBody("today")) ? true : "the zero guard is gone");
chk("P20621", "the Today popup's 'Tables open now' reads the OVERVIEW, not a second live count", () =>
  /String\(activeRid \? \(todayRow\?\.openTables \?\? 0\) : \(ov\?\.totals\.openTables \?\? 0\)\)/.test(caseBody("today"))
    ? true : "the open-tables figure no longer comes from the overview");
chk("P20622", "the Expenses popup's staff-pay hint pluralises both the payments and the people", () => {
  const b = caseBody("expenses");
  return /payment\$\{kMain!\.staffPay!\.entries === 1 \? "" : "s"\}/.test(b)
      && /\$\{kMain!\.staffPay!\.people === 1 \? "person" : "people"\}/.test(b)
    ? true : "one of the two plurals is gone";
});
chk("P20623", "the Expenses food line tells THREE states apart — unread, none, a real figure", () => {
  const b = caseBody("expenses");
  const unread = /couldn't read this — the figure above may be short/.test(b);
  const none = /none — every cancellation was caught before the kitchen started/.test(b);
  const real = /cancellation\$\{foodLostRows === 1 \? "" : "s"\} where the kitchen had already cooked it/.test(b);
  return unread && none && real ? true : `unread=${unread} none=${none} real=${real}`;
});
chk("P20624", "the Expenses note says a discount is NOT an expense, and why", () =>
  /A discount is not here — your revenue already has it taken off\./.test(caseBody("expenses"))
    ? true : "the discount sentence changed");
chk("P20625", "…and that a cancelled bill's value is not one either", () =>
  /a cancelled bill's value is not here either: nothing was charged for it/.test(caseBody("expenses"))
    ? true : "the cancellation sentence changed");
chk("P20626", "the On hand popup shows the subtraction line by line", () => {
  const b = caseBody("onhand");
  return /\["Revenue", inr\(kMain\?\.revenue \?\? 0\)\]/.test(b)
      && /\["Less staff pay", "− " \+ inr\(staffOut\)\]/.test(b)
      && /\["Less food made then binned", "− " \+ inr\(foodLost\)/.test(b)
      && /\["Money on hand", inr\(onHand\)/.test(b)
    ? true : "one of the four subtraction lines is gone";
});
chk("P20627", "…and admits when one of those costs could not be READ", () => {
  const b = caseBody("onhand");
  const flag = /const foodUnread = !!kMain && kMain\.foodLoss == null;/.test(tileDetail);
  const row = /foodUnread \? "we couldn\\u2019t read this — any food you lost is missing from the sum below" : undefined/.test(b);
  const total = /foodUnread \? "this may be too high, for the reason above" : undefined/.test(b);
  return flag && row && total ? true : `flag=${flag} rowHint=${row} totalHint=${total}`;
});
chk("P20628", "the On hand note says plainly it is not a bank balance", () =>
  /It is not a bank balance/.test(caseBody("onhand")) ? true : "the bank-balance sentence changed");
chk("P20629", "expensesOut is staff pay PLUS food lost, and nothing else", () =>
  /const expensesOut = staffOut \+ foodLost;/.test(p) ? true : "the expenses formula changed");
chk("P20630", "onHand is revenue minus that, so the three tiles reconcile on screen", () =>
  /const onHand = \(kMain\?\.revenue \?\? 0\) - expensesOut;/.test(p) ? true : "the on-hand formula changed");
chk("P20631", "foodLost reads the ingredient cost, never the cancelled bill's value", () => {
  const inRoute = /\.eq\("category", "food_loss"\)/.test(a) && /\.select\("amount"\)/.test(a);
  const inPage = /const foodLost = kMain\?\.foodLoss\?\.amount \?\? 0;/.test(p);
  return inRoute && inPage ? true : `route=${inRoute} page=${inPage}`;
});
chk("P20632", "the popup's footer link is a <Link> with NO onClick that closes the popup first", () => {
  const m = /<Link className="full" href=\{detailHref\(d\.open\)\}>([\s\S]*?)<\/Link>/.exec(p);
  if (!m) return "the footer link not found";
  const tag = /<Link className="full" href=\{detailHref\(d\.open\)\}>/.exec(p)[0];
  return !/onClick/.test(tag) ? true : "the footer link closes the popup on the same tap — it would race the router";
});
chk("P20633", "…and when Reports are off, the footer is a plain sentence rather than a dead link", () =>
  /\) : <span className="full off">Reports are switched off for this restaurant<\/span>\}/.test(p)
    ? true : "the off-state footer changed");
chk("P20634", "detailHref sends `view`, a SEPARATE name from `rid`", () => {
  const m = /const detailHref = \(t: string\) => \{([\s\S]*?)\n  \};/.exec(p)[1];
  return /q\.set\("view", activeRid \?\? "all"\);/.test(m) && /q\.set\("rid", scopePin\)/.test(m)
    ? true : "the two names have merged — a tab could re-scope its own permissions";
});
chk("P20635", "detailHref sends view=all from the all-restaurants view", () =>
  /q\.set\("view", activeRid \?\? "all"\);/.test(p) ? true : "view=all is gone");
chk("P20636", "detailHref carries the person pin when there is one", () =>
  /const a = asValue\(\); if \(a\) q\.set\("as", a\);/.test(p) ? true : "the person pin is gone");
chk("P20637", "the popup sheet is fixed inset:0, so no card can clip it", () =>
  /\.ow2-tile-wrap \{ position: fixed; inset: 0; z-index: 95;/.test(css) ? true : "the sheet is no longer fixed");
chk("P20638", "the sheet scrolls internally rather than growing past the viewport", () =>
  /\.ow2-tile \{ position: relative; width: min\(430px, 100%\); max-height: min\(88vh, 720px\); overflow-y: auto;/.test(css)
    ? true : "the sheet's internal scroll is gone");
chk("P20639", "the total row is marked by a border and weight, not by colour alone", () =>
  /\.ow2-tile \.r\.last \{ margin-top: 4px; border-top: 2px solid[^}]*\}/.test(css)
    && /\.ow2-tile \.r\.last \.l, \.ow2-tile \.r\.last \.v \{ font-weight: 800; \}/.test(css)
    ? true : "the total row is distinguished by colour alone");
chk("P20640", "the sheet's ✕ is a real button with an aria-label", () =>
  /<button className="x" onClick=\{\(\) => setTileOpen\(null\)\} aria-label="Close">/.test(p)
    ? true : "the close control is not a labelled button");

// ── the money model and the switched-off state ───────────────────────────────────────────────
chk("P20641", "all five tiles print an em dash and the reason when the server has refused this scope", () => {
  const dashes = count(p, /v=\{offNote \? "—" :/g);
  const subs = count(p, /sub=\{offNote \? offSub/g);
  return dashes === 5 && subs === 5 ? true : `${dashes} tiles print a dash, ${subs} print the reason`;
});
chk("P20642", "…and none of them opens a popup in that state", () =>
  count(p, /onOpen=\{offNote \? undefined :/g) === 5 ? true : "a tile still opens a popup with Reports off");
chk("P20643", "…and the '● live' pill goes with it", () =>
  /pill=\{offNote \? undefined : "● live"\}/.test(p) ? true : "the live pill survives the switched-off state");
chk("P20644", "loading is false once offNote is set, so no tile animates a blank for ever", () => {
  // Scoped to the <Kpi> CALL SITES. Unscoped, this also read `loading={loading}` inside the Kpi
  // component's own body — where it is the prop being forwarded to AnimatedNumber, not a tile
  // deciding whether to animate. A detector fault, found re-running this row in sweep #8.
  const tiles = [...praw.matchAll(/<Kpi k="([^"]+)"([\s\S]*?)\/>/g)].map((m) => ({ k: m[1], props: m[2] }));
  if (tiles.length !== 5) return `${tiles.length} <Kpi> call sites, expected 5`;
  const bad = tiles.filter((t) => {
    const l = /loading=\{([^}]*)\}/.exec(t.props);
    return !l || !/^!offNote &&/.test(l[1].trim());
  });
  return bad.length === 0 ? true : `tiles whose loading ignores offNote: ${JSON.stringify(bad.map((b) => b.k))}`;
});
chk("P20645", "the tile face uses the SHARED short money form", () =>
  /<span style=\{\{ fontVariantNumeric: "tabular-nums" \}\}>\{compactINR\(v\)\}<\/span>/.test(p)
    ? true : "the tile face no longer uses compactINR");
chk("P20646", "compact is only applied to MONEY tiles, never to a count", () => {
  const tiles = [...praw.matchAll(/<Kpi k="([^"]+)"([\s\S]*?)\/>/g)].map((m) => ({ k: m[1], props: m[2] }));
  const bad = tiles.filter((t) => /\bcompact\b/.test(t.props) && !/\bmoney\b/.test(t.props));
  return tiles.length === 5 && bad.length === 0
    ? true : `${tiles.length} tiles; compact-without-money on: ${JSON.stringify(bad.map((b) => b.k))}`;
});
chk("P20647", "a tile with no sparkline carries no empty 34px band", () =>
  /\.owx \.adm-stat\.ow2-kpi\.ow2-nospark \{ padding-bottom: 14px; \}/.test(css)
    ? true : "the nospark padding rule is gone");
chk("P20648", "the spark reserve rule is written with three classes", () =>
  /\.owx \.adm-stat\.ow2-kpi \{ padding-bottom: 44px; \}/.test(css) ? true : "the three-class reserve is gone");
chk("P20649", "sparkOf returns undefined under two points, so no line is drawn from one number", () =>
  /return pts\.length >= 2 \? pts : undefined;/.test(p) ? true : "the two-point floor is gone");
chk("P20650", "the delta chip is absent when there is no previous period", () => {
  const deltas = [...p.matchAll(/delta=\{([^}]*\}[^}]*)\}/g)].map((m) => m[1]);
  const guarded = deltas.filter((d) => /kMain\?\.prev \?/.test(d));
  return deltas.length >= 2 && guarded.length === deltas.length
    ? true : `${deltas.length} delta props, ${guarded.length} guarded on prev`;
});
chk("P20651", "the Expenses caption tells four states apart", () => {
  const m = /<Kpi k="Expenses"([\s\S]*?)\/>/.exec(praw)[1];
  const both = /staff pay \+ food lost/.test(m);
  const foodOnly = /cancellation\$\{foodLostRows === 1 \? "" : "s"\} where food was made/.test(m);
  const unread = /staff pay only — we couldn\\u2019t read the food figure/.test(m);
  const payroll = /staff payment\$\{kMain!\.staffPay!\.entries === 1 \? "" : "s"\}/.test(m);
  const nothing = /nothing recorded yet/.test(m);
  return both && foodOnly && unread && payroll && nothing
    ? true : `both=${both} foodOnly=${foodOnly} unread=${unread} payroll=${payroll} none=${nothing}`;
});
chk("P20652", "hasPayroll is derived from the payload, not from a flag the client guesses", () =>
  /const hasPayroll = !!kMain\?\.staffPay;/.test(p) ? true : "hasPayroll no longer reads the payload");
chk("P20653", "mt is undefined rather than the string 'err' when the money read failed", () =>
  /const mt = money === "err" \? undefined : \(money as MoneyTotals \| undefined\);/.test(p)
    ? true : "the 'err' sentinel could reach a money row");
chk("P20654", "kpiOf prefers paidOrders and falls back to orders", () =>
  /paidOrders: p\.kpis\.paidOrders \?\? p\.kpis\.orders/.test(p) ? true : "the fallback is gone");
chk("P20655", "kpiOf group scope sums paymentMethods orders for its paid count", () =>
  /const paidOrders = p\.paymentMethods\.reduce\(\(a, m\) => a \+ \(m\.orders \|\| 0\), 0\);/.test(p)
    ? true : "the group paid count changed source");
chk("P20656", "kpiOf never divides by zero", () =>
  /avg: paidOrders \? revenue \/ paidOrders : 0/.test(p) ? true : "the group average is unguarded");
chk("P20657", "todayRev/todayOrd fall back to the GROUP totals when no restaurant is drilled", () =>
  /const todayRev = activeRid \? \(todayRow\?\.revenueToday \?\? 0\) : \(ov\?\.totals\.revenueToday \?\? 0\);/.test(p)
    && /const todayOrd = activeRid \? \(todayRow\?\.ordersToday \?\? 0\) : \(ov\?\.totals\.ordersToday \?\? 0\);/.test(p)
    ? true : "the group fallback changed");
chk("P20658", "offSub is one constant, so the five tiles cannot word the same state five ways", () =>
  /const offSub = "Reports are switched off";/.test(p) && count(p, /offNote \? offSub/g) === 5
    ? true : "the shared off caption is gone or not used by all five");
chk("P20659", "offNote is SCOPED — a refusal about one restaurant does not blank the group view", () =>
  /const offNote = offScope && offScope\.scope === scopeKey \? offScope\.msg : null;/.test(p)
    ? true : "the refusal is no longer scoped");
chk("P20660", "pl() returns undefined for a refused scope, so no SNAPSHOT figure leaks through", () =>
  /\(offScope && offScope\.scope === scopeKey\) \? undefined\s*\n?\s*: cache\[/.test(p)
    ? true : "a stale snapshot could paint behind the refusal");
chk("P20661", "moneyOf() does the same", () =>
  /offNote \? undefined : moneyCache\[/.test(p) ? true : "moneyOf no longer withholds on a refusal");
chk("P20662", "a disabled answer sets landed", () => {
  const m = /if \(a\.error && a\.disabled\) \{(.*)\}\n/.exec(p);
  return /setLanded\(true\)/.test(m[1]) ? true : "landed is not set on the refusal";
});
chk("P20663", "…and does NOT drop the connection pill to a warning", () => {
  const m = /if \(a\.error && a\.disabled\) \{(.*)\}\n/.exec(p);
  return !/reportRealtime/.test(m[1]) ? true : "the refusal reports a connection state";
});
chk("P20664", "…and is never printed inside the red 'Couldn't load.' card", () => {
  const m = /if \(a\.error && a\.disabled\) \{(.*)\}\n/.exec(p);
  const clears = /setErr\(null\)/.test(m[1]);
  const banner = /\{err && <div className="adm-card" style=\{\{ borderColor: "var\(--adm-danger\)"/.test(p);
  const offCard = /\{offNote && !err && \(/.test(p);
  return clears && banner && offCard ? true : `clearsErr=${clears} redBannerReadsErr=${banner} offCardSeparate=${offCard}`;
});
chk("P20665", "a real error IS printed in the red card, and is not swallowed", () => {
  const m = /if \(a\.error\) throw new Error\(errText\(a\.error\)\);/.test(p);
  const caught = /catch \(e\) \{\s*\n\s*setErr\(errText\(e\)\);/.test(p);
  return m && caught ? true : `throws=${m} setsErr=${caught}`;
});
chk("P20666", "errText pulls the human parts out of a thrown plain object", () =>
  /\[o\.message, o\.error, o\.details, o\.code\]/.test(p) ? true : "the human fields are gone");
chk("P20667", "…and truncates a JSON fallback at 200 characters", () =>
  /JSON\.stringify\(e\)\.slice\(0, 200\)/.test(p) ? true : "the truncation is gone");
chk("P20668", "the switched-off card is muted, not red", () => {
  const m = /\{offNote && !err && \(([\s\S]*?)\n      \)\}/.exec(p);
  if (!m) return "the switched-off card not found";
  return !/adm-danger/.test(m[1]) && /fa-eye-slash/.test(m[1]) ? true : "the off card borrowed the danger colour";
});
chk("P20669", "loadNote is one string, so every card says the same thing in that state", () => {
  const decl = /const loadNote = offNote \? "Not shown — Reports are switched off\." : "Loading…";/.test(p);
  const uses = count(p, /\{loadNote\}/g);
  return decl && uses >= 8 ? true : `decl=${decl}, used ${uses} times`;
});
chk("P20670", "DishList takes that same note rather than hard-coding 'Loading…'", () =>
  /<DishList payload=\{pl\(globalRange\) as RestA \| undefined\} sort=\{dishSort\} note=\{loadNote\}/.test(p)
    ? true : "DishList no longer receives the shared note");

// ── records and partial ──────────────────────────────────────────────────────────────────────
chk("P20671", "the dashboard reads the server's `partial` key for records", () =>
  /else if \(Array\.isArray\(a\.partial\) && a\.partial\.includes\("records"\)\) \{/.test(p)
    ? true : "the client half of the partial-records contract is gone again");
chk("P20672", "…and holds the flag per RESTAURANT, not per payload", () =>
  /setRecsUnread\(\(m\) => \(\{ \.\.\.m, \[rid\]: true \}\)\);/.test(p) ? true : "recsUnread is not keyed by restaurant");
chk("P20673", "…and clears it when a later read succeeds", () =>
  /setRecsUnread\(\(m\) => \(m\[rid\] \? \{ \.\.\.m, \[rid\]: false \} : m\)\);/.test(p)
    ? true : "a later success does not clear the flag");
chk("P20674", "the Your-records card appears when the read failed, even with nothing to show", () =>
  /\{\(recordsUnread \|\| \(records && \(records\.bestDay \|\| records\.starDish\)\)\) && \(/.test(p)
    ? true : "the card would vanish silently again");
chk("P20675", "…in wording written for ONE restaurant", () =>
  /msg="We couldn&rsquo;t read your all-time records just now, so this card is short\./.test(praw)
    ? true : "the records strip borrows the group wording");
chk("P20676", "PartialStrip still renders nothing when there is nothing partial", () =>
  /if \(!keys \|\| !keys\.length\) return null;/.test(p) ? true : "the empty guard is gone");
chk("P20677", "each PartialStrip is filtered to the key its own card is about", () => {
  const strips = [...p.matchAll(/<PartialStrip keys=\{([^}]*(?:\}[^}]*)?)\}/g)].map((m) => m[1]);
  const bad = strips.filter((s) => !/filter\(\(k\) => k === "/.test(s) && !/recordsUnread/.test(s));
  return bad.length === 0 ? true : `unscoped strips: ${JSON.stringify(bad)}`;
});
chk("P20678", "…and the restaurant scope needs no categories or payments strip", () => {
  // the restaurant-scope reads its own single-restaurant RPCs, which either answer or throw;
  // only the heatmap is non-fatal there, so only busyHours can be partial
  // `[a-z]+` never matched "busyHours" — the capital H. A detector fault of exactly the kind
  // this ledger exists to stop being re-filed as a product fault.
  const keys = [...a.matchAll(/partial: \["(\w+)"\] as PartialKey\[\]/g)].map((m) => m[1]);
  return keys.length === 1 && keys[0] === "busyHours"
    ? true : `restaurant-scope partial keys = ${JSON.stringify(keys)}`;
});
chk("P20679", "the records read stays OUTSIDE the snapshot cache", () => {
  const cached = /cachedOwnerPayload\(\{[\s\S]*?\n    \}\);/.exec(a.slice(a.indexOf("const restBase")));
  return cached && !/lfh_owner_records/.test(cached[0]) ? true : "the unbounded records scan moved inside the cache";
});
chk("P20680", "the all-time records scan is asked for ONCE per restaurant per visit", () =>
  /!recsAsked\.current\.has\(rid\) \? "&records=1" : "";\s*\n\s*if \(recQ\) recsAsked\.current\.add\(rid!\);/.test(p)
    ? true : "the synchronous ask-time flag is gone");
chk("P20681", "…and the ask-flag clears when the read failed, so a retry is possible", () =>
  /recsAsked\.current\.delete\(rid\);/.test(p) ? true : "a failed records read can never be retried");
chk("P20682", "a failed records read leaves any PREVIOUS records in place", () => {
  // the failure branch touches recsUnread only — never setRecs
  const m = /else if \(Array\.isArray\(a\.partial\) && a\.partial\.includes\("records"\)\) \{([\s\S]*?)\}/.exec(p);
  return !/setRecs\(/.test(m[1]) ? true : "the failure branch blanks the records it already had";
});
chk("P20683", "the records strip names its own rolling window", () =>
  count(p, /LAST 30 DAYS \(ROLLING\)/g) === 2 ? true : "the rolling-window wording changed");
chk("P20684", "BIGGEST BILL says 'one sitting' when the table is unknown", () =>
  /: "one sitting"\}/.test(p) ? true : "the unknown-table wording changed");
chk("P20685", "REGULARS is drawn only above zero", () =>
  /\{\(records\.regulars \?\? 0\) > 0 && \(/.test(p) ? true : "the zero guard is gone");
chk("P20686", "records.fastHour prints 12-hour with upper-cased AM/PM", () =>
  /istWall12\(records\.fastHour\.at/.test(p) ? true : "fastHour no longer uses istWall12");
chk("P20687", "records.bestDay prints a weekday, so 'beat it' means something", () =>
  /toLocaleDateString\("en-IN", \{ weekday: "short", day: "numeric", month: "short", timeZone: IST \}\)/.test(p)
    ? true : "the best-day label lost its weekday");
chk("P20688", "the records card is restaurant-scope only, never drawn for the group", () => {
  // it renders inside the `(home && single) || restaurant` block, and `records` is keyed by rid
  const keyed = /const records = activeRid \? recs\[activeRid\] : null;/.test(p);
  const groupBlockHasNoRecords = (() => {
    const g = /\{view\.level === "home" && !single && \(([\s\S]*?)\n          \{highlights\}/.exec(p);
    return g ? !/rv-recs|Your records/.test(g[1]) : false;
  })();
  return keyed && groupBlockHasNoRecords ? true : `keyed=${keyed} absentFromGroup=${groupBlockHasNoRecords}`;
});
chk("P20689", "recs is keyed by restaurant, so drilling between two never shows the wrong one's", () =>
  /setRecs\(\(m\) => \(\{ \.\.\.m, \[rid\]: a\.records \}\)\)/.test(p) ? true : "recs is no longer keyed by rid");
chk("P20690", "recordsUnread is likewise keyed by restaurant", () =>
  /const recordsUnread = !!\(activeRid && recsUnread\[activeRid\]\);/.test(p)
    ? true : "recordsUnread is not read per restaurant");

// ── egress and conformance (the rows about MY files) ─────────────────────────────────────────
chk("P20776", "every overlay in page.tsx registers with the back-stack manager", () => {
  const overlays = count(praw, /role="dialog"/g);
  const layers = count(p, /useBackClose\(/g);
  return overlays >= 2 && layers >= 5 ? true : `${overlays} dialogs, ${layers} back layers`;
});
chk("P20777", "nothing hand-rolls pushState / popstate", () =>
  !/pushState|replaceState|popstate/.test(p) ? true : "history is hand-rolled again");
chk("P20778", "the tile popup was registered the moment it was built", () =>
  /useBackClose\("owner-kpi-tile"/.test(p) ? true : "the newest overlay has no back layer");
chk("P20779", "no poll is faster than the 60s backstop", () => {
  const all = [...p.matchAll(/useActiveAutoRefresh\([^,]*,\s*(\d+)\)/g)].map((m) => Number(m[1]));
  return all.length >= 1 && all.every((v) => v >= 60000) ? true : `intervals = ${JSON.stringify(all)}`;
});
chk("P20780", "every poll is activity-gated through the console's shared hook", () =>
  /useActiveAutoRefresh/.test(p) && !/setInterval/.test(p) ? true : "a raw interval appeared");
chk("P20783", "every read in page.tsx is scoped and capped", () => {
  const fetches = [...praw.matchAll(/fetch\(`([^`]*(?:`[^`]*`[^`]*)*)`/g)].map((m) => m[0]);
  const oplog = fetches.find((f) => /oplog/.test(f));
  return oplog && /limit=6/.test(oplog) && /rid=/.test(oplog)
    ? true : "the oplog read is no longer scoped-and-capped";
});
chk("P20784", "the mini feed asks for six rows, not a page", () =>
  /limit=6/.test(p) ? true : "the feed limit changed");
chk("P20786", "…and the unbounded one is paid for once", () =>
  /recsAsked\.current\.add\(rid!\)/.test(p) ? true : "the once-per-restaurant flag is gone");
chk("P20787", "the pre-warm warms ONE extra range, not seven", () => {
  const m = /const others = Array\.from\(new Set<Range>\(\[([^\]]*)\]\)\)/.exec(p);
  return /saved && saved !== globalRange \? saved : "today"/.test(m[1]) ? true : `warm list = ${m[1]}`;
});
chk("P20788", "…once per scope per visit", () =>
  /if \(warmedScopes\.current\.has\(sk\)\) return;/.test(p) ? true : "the per-scope guard is gone");
chk("P20789", "…and its timers are cleared on unmount", () =>
  /timers\.forEach\(clearTimeout\)/.test(p) ? true : "the timers leak");
chk("P20790", "analytics figures come from the compute-on-view snapshot cache", () =>
  count(a, /cachedOwnerPayload\(\{/g) === 2 ? true : "one scope lost its snapshot cache");
chk("P20791", "Refresh is the only thing that forces a recompute", () => {
  const forces = [...a.matchAll(/force: ([^,\n]*)/g)].map((m) => m[1].trim());
  return forces.length === 2 && forces.every((f) => f === 'sp.get("refresh") === "1"')
    ? true : `force = ${JSON.stringify(forces)}`;
});
chk("P20792", "there is no blind cron behind any of these numbers", () =>
  !/cron|setInterval/.test(a) && !/cron|setInterval/.test(o) ? true : "a scheduled job appeared");
chk("P20793", "page.tsx issues no write of its own", () => {
  const methods = [...praw.matchAll(/method:\s*"(\w+)"/g)].map((m) => m[1]);
  return methods.length === 0 ? true : `the dashboard issues: ${JSON.stringify(methods)}`;
});
chk("P20795", "…so lib/clash.ts has nothing to cover here", () =>
  !/expect:\s*\{/.test(p) && !/from "@\/lib\/clash"/.test(praw)
    ? true : "a clash expectation appeared on a read-only page");
chk("P20798", "no user action in page.tsx ends in a silent return", () => {
  // every onClick either sets state, navigates, or calls a named handler — none is `() => {}`
  const dead = [...praw.matchAll(/onClick=\{\(\)\s*=>\s*\{\s*\}\}/g)].length
             + [...praw.matchAll(/onClick=\{undefined\}/g)].length;
  return dead === 0 ? true : `${dead} dead taps`;
});
chk("P20800", "no new settings column is introduced", () =>
  !/settings[\s\S]{0,40}?(alter|add column)/i.test(p) ? true : "a settings column appeared");
chk("P20801", "no new module, permission or screen is introduced", () => {
  const keys = [...p.matchAll(/entitlements\?\.(\w+)/g)].map((m) => m[1]);
  const known = new Set(["reports", "staff", "issues", "logs"]);
  const unknown = [...new Set(keys)].filter((k) => !known.has(k));
  return unknown.length === 0 ? true : `unknown entitlement keys read: ${JSON.stringify(unknown)}`;
});
chk("P20804", "the .owx-scope chip still reads 'Owner overview' and does not name the page (R20)", () => {
  const shell = src("components/owner/OwnerShell.tsx");
  return /Owner overview/.test(shell) ? true : "the R20 scope chip wording changed";
});
chk("P20805", "nothing here re-suggests a kitchen profile (R7)", () =>
  !/kitchen[\s\S]{0,30}profile/i.test(p) ? true : "a kitchen profile appeared");
chk("P20806", "nothing here adds a bill-delete route (R27)", () =>
  !/delete[A-Za-z]*Bill|bill[_-]?delete/i.test(p) ? true : "a bill-delete path appeared");
chk("P20808", "a switched-off section renders NOTHING, not a disabled shell (module rule 6)", () =>
  /ov\?\.entitlements\?\.logs !== false && !actsOff && \(/.test(p)
    ? true : "the activity card is rendered disabled rather than withheld");
chk("P20823", "charts in my territory never use a restaurant's own accent", () => {
  const chartColours = [...p.matchAll(/(?:color|accentColor|curColor|prevColor|accent)=\{?([A-Za-z_.()"'#\w]+)/g)]
    .map((m) => m[1]);
  const bad = chartColours.filter((c) => /accentColor$/.test(c) && !/portfolioColor/.test(c));
  return bad.length === 0 ? true : `brand accents handed to a chart: ${JSON.stringify(bad)}`;
});
chk("P20825", "every chart card carries a period chip", () => {
  const chips = count(p, /className="ow2-tag"/g);
  return chips >= 6 ? true : `${chips} period chips`;
});
chk("P20826", "…and the heatmap's chip shows the CLAMPED window when they differ", () =>
  count(p, /HEAT_CLAMPED\[globalRange\] \? `Last \$\{HEAT_CLAMP_DAYS\} days`/g) >= 2
    ? true : "the clamp chip is gone from one of the two scopes");
chk("P20828", "a caption never claims more restaurants than the numbers cover", () =>
  /const restScopeText =\s*\n?\s*reportedCount === restCount/.test(p)
    ? true : "the coverage caption no longer counts the reported set");

report("T13 replay · T12 round 2 (P20601–P21100, the rows this terminal owns)", { minChecks: 90 });
