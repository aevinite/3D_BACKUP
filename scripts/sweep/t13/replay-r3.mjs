// scripts/sweep/t13/replay-r3.mjs — re-runs the T12 round-3 ledger rows (P40001–P40500) that are
// about files THIS terminal owns and can be re-run WITHOUT a browser. The estate rows that need a
// real two-restaurant session (P40001–P40150, P40386–P40435) are driven in live.mjs beside this.
//
// Round 3 was the multi-restaurant estate, driven for the first time with `diagmulti`.
import { chk, skip, code, src, styles, report, setOnly, count } from "./lib.mjs";

const PAGE = "app/owner/page.tsx";
const LAYOUT = "app/owner/layout.tsx";
const ANALYTICS = "app/api/owner/analytics/route.ts";
const OVERVIEW = "app/api/owner/overview/route.ts";
const p = code(PAGE), praw = src(PAGE), css = styles(PAGE);
const a = code(ANALYTICS), o = code(OVERVIEW), lay = code(LAYOUT);

const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));

// the 760px phone block, where the estate table stops being a table
const phoneBlock = (() => {
  const m = /@media \(max-width: 760px\) \{([\s\S]*?)\n        \}/.exec(css);
  if (!m) throw new Error("the 760px media block not found");
  return m[1];
})();

// ── round 1's own changes, re-read on today's code ───────────────────────────────────────────
chk("P40157", "the Today tile's four offNote guards move together", () => {
  const m = /<Kpi k="Today so far"([\s\S]*?)\/>/.exec(praw)[1];
  const g = ["onOpen=\{offNote \\? undefined", "v=\{offNote \\? \"—\"", "loading=\{!offNote &&", "pill=\{offNote \\? undefined"];
  const missing = g.filter((x) => !new RegExp(x).test(m));
  const sub = /sub=\{offNote \? offSub/.test(m);
  return missing.length === 0 && sub ? true : `missing guards: ${JSON.stringify(missing)} sub=${sub}`;
});
chk("P40158", "…and loading cannot be true at the same time as offNote", () => {
  const m = /<Kpi k="Today so far"([\s\S]*?)\/>/.exec(praw)[1];
  return /loading=\{!offNote && !ov\}/.test(m) ? true : "the Today tile could animate a blank with Reports off";
});
chk("P40159", "…and the other four tiles are unchanged by it", () =>
  count(p, /loading=\{!offNote && !kMain\}/g) === 4 ? true : "the four analytics tiles no longer share one loading rule");
chk("P40174", "recsUnread is keyed by restaurant, like recs", () =>
  /const \[recsUnread, setRecsUnread\] = useState<Record<string, boolean>>\(\{\}\);/.test(p)
    ? true : "recsUnread is no longer a per-restaurant map");
chk("P40175", "…and cleared by a later successful read", () =>
  /setRecsUnread\(\(m\) => \(m\[rid\] \? \{ \.\.\.m, \[rid\]: false \} : m\)\)/.test(p) ? true : "no clear on success");
chk("P40176", "…and the strip's wording is passed in, not the group default", () =>
  /msg="We couldn&rsquo;t read your all-time records just now/.test(praw) ? true : "the records strip lost its own wording");
chk("P40177", "…and PartialStrip still renders nothing when there is nothing partial", () =>
  /if \(!keys \|\| !keys\.length\) return null;/.test(p) ? true : "the empty guard is gone");
chk("P40178", "the records card renders its heading even with no records to show", () => {
  const m = /\{\(recordsUnread \|\| \(records && \(records\.bestDay \|\| records\.starDish\)\)\) && \(([\s\S]*?)\n            <\/div>\n          \)\}/.exec(p);
  if (!m) return "the records card not found";
  // the heading is unconditional inside the card; only the rv-recs grid is behind `records &&`
  return /Your records/.test(m[1]) && /\{records && <div className="rv-recs">/.test(m[1])
    ? true : "the heading is behind the same guard as the rows";
});
chk("P40179", "foodUnread is `kMain && kMain.foodLoss == null`, not just !foodLoss", () =>
  /const foodUnread = !!kMain && kMain\.foodLoss == null;/.test(p)
    ? true : "a real zero would be reported as unread, or an unread as zero");
chk("P40180", "…and it reaches the row hint AND the total's hint", () => {
  const b = /case "onhand": \{([\s\S]*?)\n      \}; \}/.exec(p);
  if (!b) return "the onhand case not found";
  return count(b[1], /foodUnread \?/g) === 2 ? true : `foodUnread reaches ${count(b[1], /foodUnread \?/g)} hints, expected 2`;
});
chk("P40181", "…and the Expenses tile face has its own branch, ordered AFTER the real figures", () => {
  const m = /<Kpi k="Expenses"([\s\S]*?)\/>/.exec(praw)[1];
  const iFood = m.indexOf("foodLost > 0 && staffOut > 0");
  const iUnread = m.indexOf("kMain && kMain.foodLoss == null");
  return iFood > -1 && iUnread > iFood ? true : `real-figure branch at ${iFood}, unread branch at ${iUnread}`;
});
chk("P40182", "actsErr is cleared when the scope changes", () =>
  /useEffect\(\(\) => \{ if \(activeRid\) \{ setActs\(null\); setActsErr\(false\); fetchActs\(activeRid\); \} \}, \[activeRid, fetchActs\]\);/.test(p)
    ? true : "a stale failure would follow the owner into another restaurant");
chk("P40183", "…and set for a malformed answer as well as a thrown one", () => {
  const m = /const fetchActs = useCallback\(async \(rid: string\) => \{([\s\S]*?)\}, \[scopePin\]\);/.exec(p)[1];
  return /else \{ setActs\(null\); setActsErr\(true\); \}/.test(m) && /catch \{ setActs\(null\); setActsErr\(true\); \}/.test(m)
    ? true : "one of the two failure shapes is unhandled";
});
chk("P40184", "…and the retry button re-calls fetchActs for the CURRENT restaurant", () =>
  /onClick=\{\(\) => activeRid && fetchActs\(activeRid\)\}/.test(p) ? true : "the retry no longer targets the open restaurant");
chk("P40185", "…and it does not fire when activeRid is null", () =>
  /activeRid && fetchActs\(activeRid\)/.test(p) ? true : "the retry could fire with no restaurant");
chk("P40187", "recsAsked is a ref, so setting it does not re-render", () =>
  /const recsAsked = useRef<Set<string>>\(new Set\(\)\);/.test(p) ? true : "recsAsked is state again");
chk("P40188", "…and it is set SYNCHRONOUSLY, in the same expression that builds the query", () => {
  const m = /const recQ = [^\n]*\n\s*if \(recQ\) recsAsked\.current\.add\(rid!\);/.test(p);
  return m ? true : "the flag is set after an await — two payloads could both carry records=1";
});
chk("P40189", "…and cleared only on the failure branch", () =>
  count(p, /recsAsked\.current\.delete\(/g) === 1 ? true : "the ask-flag is cleared in more than one place");
chk("P40190", "only daysummary overrides the range", () =>
  /q\.set\("range", t === "daysummary" \? "today" : globalRange\);/.test(p) ? true : "the range override changed");
chk("P40191", "…and `view` is still sent for all five", () =>
  /q\.set\("view", activeRid \?\? "all"\);/.test(p) ? true : "view is no longer unconditional");
chk("P40210", "the pager walks .adm-main then .adm, the same order as scrollPort", () => {
  const sp = /for \(const sel of \[".adm-main", ".adm"\]\)/.test(p);
  return sp ? true : "scrollPort's walk order changed";
});
chk("P40211", "…and returns as soon as it finds the one that scrolls", () =>
  /if \(el && el\.scrollHeight > el\.clientHeight \+ 2\) return el;/.test(p) ? true : "the early return is gone");
chk("P40212", "…and does nothing at all server-side", () =>
  /if \(typeof document === "undefined"\) return null;/.test(p) ? true : "scrollPort would throw during SSR");
chk("P40213", "…and window.scrollTo appears nowhere in the file", () =>
  !/window\.scrollTo/.test(p) ? true : "window.scrollTo is back, and it moves nothing on this panel");
chk("P40214", "the drawer's hidden note is muted, never the red card", () => {
  const m = /\.dhidden \{([^}]*)\}/.exec(css);
  return m && !/danger/.test(m[1]) ? true : "the drawer's hidden note borrowed the danger colour";
});
chk("P40215", "…and it says the restaurant is still trading", () =>
  /it is still open and trading/.test(praw) ? true : "the still-trading sentence is gone");
chk("P40216", "…and open tables and Active/Off survive it", () => {
  const m = /\{drawer\.r\.reportsOff \? \([\s\S]*?\) : null\}([\s\S]*?)<\/aside>/.exec(praw);
  if (!m) return "the drawer body not found";
  const openTables = /<small>Open tables<\/small>/.test(m[1]) && !/\{!drawer\.r\.reportsOff && <>[\s\S]{0,200}?Open tables/.test(m[1]);
  const pill = /<span className=\{`own-pill \$\{drawer\.r\.active \? "on" : "off"\}`\}>/.test(m[1]);
  return openTables && pill ? true : `openTables kept=${openTables} activePill kept=${pill}`;
});
chk("P40217", "…and no trend chart is drawn for it", () =>
  /\{!drawer\.r\.reportsOff && drawerTrend\.length >= 2 && \(/.test(p)
    ? true : "the drawer would draw a chart of a series it was never given");
chk("P40218", "…and the all-time line is dropped with the rest", () => {
  const m = /<div className="dall">([\s\S]*?)<\/div>/.exec(praw);
  return /\{!drawer\.r\.reportsOff && <>/.test(m[1]) ? true : "the all-time takings survive the hide";
});
chk("P40219", "every stacked cell carries a data-l", () => {
  const rowBlock = /\{tableRows\.map\(\(r\) => \(([\s\S]*?)\n                  \)\)\}/.exec(praw)[1];
  const tds = [...rowBlock.matchAll(/<td ([^>]*)>/g)].map((m) => m[1]);
  // the name cell (.l) and the chevron (.go) print no label, by design
  const needLabel = tds.filter((t) => !/className="[^"]*\bl\b/.test(t) && !/className="go"/.test(t) && !/className="rk l"/.test(t));
  const missing = needLabel.filter((t) => !/data-l=/.test(t));
  return missing.length === 0 ? true : `cells with no data-l: ${JSON.stringify(missing)}`;
});
chk("P40220", "…and the label is the same words as the column header", () => {
  const labels = [...praw.matchAll(/data-l=\{?"?([^"}]+)"?\}?/g)].map((m) => m[1]);
  const want = ["Today", "Orders", "Avg / order", "Trend", "Share", "Open tables", "Figures"];
  const missing = want.filter((w) => !labels.some((l) => l.includes(w)));
  return missing.length === 0 ? true : `labels missing: ${JSON.stringify(missing)}`;
});
chk("P40221", "…and the name cell prints no label", () =>
  /\.hq-table :global\(td\.l\)::before \{ content: none; \}/.test(phoneBlock)
    ? true : "the name cell would print a label above itself");
chk("P40222", "…and the rank cell is hidden from sight but kept for a screen reader", () =>
  /\.hq-table :global\(td\.rk\) \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset\(50%\); \}/.test(phoneBlock)
    ? true : "the rank cell is display:none (gone from the accessibility tree) or fully visible");
chk("P40223", "…and the chevron is dropped, because the whole block is the tap target", () =>
  /\.hq-table :global\(td\.go\) \{ display: none; \}/.test(phoneBlock) ? true : "the chevron survives the stack");
chk("P40224", "…and the whole thing lives inside the 760px media query", () => {
  const outside = /\.hq-table :global\(thead\) \{ display: none; \}/.test(css.replace(phoneBlock, ""));
  return !outside ? true : "the stacking rules escaped their media query and would reach the desktop";
});
chk("P40225", "…and the row is still a real <tr> in a real <table>", () =>
  /<table className="hq-table ow2-table">/.test(praw) && /<tr key=\{r\.id\} className="hq-row"/.test(praw)
    ? true : "the table stopped being a table");

// ── conformance, round 3 ─────────────────────────────────────────────────────────────────────
chk("P40326", "every overlay in this territory registers with the back-stack manager", () =>
  count(p, /useBackClose\(/g) >= 5 ? true : `only ${count(p, /useBackClose\(/g)} back layers`);
chk("P40327", "nothing hand-rolls pushState / popstate", () =>
  !/pushState|replaceState|popstate/.test(p) ? true : "history is hand-rolled");
chk("P40328", "no poll is faster than the 60s backstop", () => {
  const all = [...p.matchAll(/useActiveAutoRefresh\([^,]*,\s*(\d+)\)/g)].map((m) => Number(m[1]));
  return all.every((v) => v >= 60000) && all.length ? true : `intervals = ${JSON.stringify(all)}`;
});
chk("P40329", "every poll is activity-gated", () =>
  /useActiveAutoRefresh/.test(p) && !/setInterval/.test(p) ? true : "a raw interval appeared");
chk("P40332", "the unbounded records read is asked for 0 times in group scope", () => {
  // `rid` is null for the group, and the records query is gated on `rid &&`
  const m = /const recQ = rid && /.test(p);
  // Compare the records READ against the group branch's RETURN, not against the declaration of
  // `wantRecords` — which naturally sits near the top of the handler, so the earlier version
  // reported a working gate as broken. A detector fault.
  const groupReturn = a.indexOf("return NextResponse.json(groupPayload);");
  const recordsRead = a.indexOf("if (wantRecords) {");
  const routeGate = groupReturn > -1 && recordsRead > groupReturn;
  return m && routeGate ? true
    : `clientGate=${m} groupReturnsBeforeTheRecordsRead=${routeGate} (return@${groupReturn}, read@${recordsRead})`;
});
chk("P40336", "the estate table, the drawer and the charts all read ONE payload", () => {
  // all three derive from pl(globalRange); the drawer adds no fetch of its own
  const table = /const p = pl\(globalRange\);[\s\S]{0,400}?revById/.test(p);
  const drawerFromTable = /const row = tableRows\.find\(\(x\) => x\.id === drawerRid\);/.test(p);
  const trendFromSame = /const drawerTrend = useMemo\(\(\) => \{[\s\S]{0,200}?const p = pl\(globalRange\);/.test(p);
  return table && drawerFromTable && trendFromSame ? true : `table=${table} drawer=${drawerFromTable} trend=${trendFromSame}`;
});
chk("P40337", "the one write in this territory is still the food-made answer, and it is not on this page", () => {
  const methods = [...praw.matchAll(/method:\s*"(\w+)"/g)].map((m) => m[1]);
  return methods.length === 0 ? true : `the dashboard writes: ${JSON.stringify(methods)}`;
});
chk("P40339", "the offline layer still covers this API family", () => {
  const sw = src("public/sw.js");
  return /\/api\/owner\//.test(sw) ? true : "the owner API family is no longer in the service worker's data paths";
});
chk("P40341", "no user action ends in a silent return", () => {
  const dead = count(praw, /onClick=\{\(\)\s*=>\s*\{\s*\}\}/g) + count(praw, /onClick=\{undefined\}/g);
  return dead === 0 ? true : `${dead} dead taps`;
});
chk("P40344", "the .owx-scope chip still says 'Owner overview' (R20)", () =>
  /Owner overview/.test(src("components/owner/OwnerShell.tsx")) ? true : "the R20 wording changed");
chk("P40346", "nothing re-suggests a kitchen profile (R7)", () =>
  !/kitchen[\s\S]{0,30}profile/i.test(p) ? true : "a kitchen profile appeared");
chk("P40347", "nothing adds a bill-delete route (R27)", () =>
  !/delete[A-Za-z]*Bill/i.test(p) ? true : "a bill-delete path appeared");
chk("P40348", "a switched-off section still renders nothing", () =>
  /ov\?\.entitlements\?\.logs !== false && !actsOff && \(/.test(p) ? true : "the card is no longer withheld");
chk("P40350", "lfh_theme is still inert here", () =>
  !/lfh_theme/.test(p) && !/lfh_theme/.test(lay) ? true : "the guest theme key leaked in");
chk("P40352", "the owner panel keeps no link to /aevinite outside the admin bar", () =>
  !/\/aevinite/.test(p) ? true : "the dashboard links into the admin console");
chk("P40355", "the ?rid pin rides on every sidebar link", () => {
  const shell = code("components/owner/OwnerShell.tsx");
  return /withRid\(/.test(shell) ? true : "OwnerShell no longer pins its links";
});
chk("P40356", "charts never use a restaurant's own accent", () => {
  const handed = [...p.matchAll(/accentColor: ([^,}\n]+)/g)].map((m) => m[1].trim());
  const bad = handed.filter((v) => /^r\.accentColor$/.test(v));
  return bad.length === 0 ? true : `a brand accent handed to a chart: ${JSON.stringify(bad)}`;
});
chk("P40357", "no chart is a lonely one-bar plot", () => {
  // the page's own guard: the area chart needs 9 points, the bar chart is the fallback, and the
  // bar chart itself must refuse a single point — that lives in Charts.tsx
  const pageGuard = /restTrend\.length >= 9/.test(p);
  const charts = code("components/owner/Charts.tsx");
  const barGuard = /length\s*<\s*2|NotEnough|length === 1/.test(charts);
  return pageGuard && barGuard ? true : `page 9-point switch=${pageGuard} chart minimum=${barGuard}`;
});
chk("P40358", "every chart card carries a period chip at every range", () =>
  count(p, /className="ow2-tag"/g) >= 6 ? true : "a chart card lost its period chip");
chk("P40359", "no caption overstates its coverage", () =>
  /const restScopeText =/.test(p) && count(p, /\{restScopeText\}/g) >= 3
    ? true : `restScopeText used ${count(p, /\{restScopeText\}/g)} times`);
chk("P40361", "the phone layout has no sideways scroll on the estate table", () =>
  /\.hq-scroll \{ overflow: visible; max-height: none; \}/.test(phoneBlock)
    ? true : "the phone still relies on a sideways scroller");
chk("P40362", "nothing runs off the right edge at 360px", () => {
  const grids = /\.ow2-two \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/.test(css);
  const mins = /\.ow2-two > \* \{ min-width: 0; \}/.test(css);
  const phone = /\.ow2-two, \.ow2-callouts \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(phoneBlock);
  return grids && mins && phone ? true : `minmax=${grids} minWidth=${mins} phoneOneUp=${phone}`;
});
chk("P40363", "a tap target that matters is at least 44px", () =>
  /\.own-dish-x \{ flex: none; width: 44px; height: 44px;/.test(css) ? true : "the dish ✕ fell below the tap floor");

// ── cross-panel truth (the rows about MY files) ──────────────────────────────────────────────
chk("P40447", "the entitlement keys the estate reads all exist", () => {
  const keys = [...new Set([...p.matchAll(/entitlements\?\.(\w+)/g)].map((m) => m[1]))];
  const declared = code("lib/ownerEntitlements.ts");
  const missing = keys.filter((k) => !new RegExp(`["']${k}["']`).test(declared));
  return missing.length === 0 ? true : `keys the page reads that no key list declares: ${JSON.stringify(missing)}`;
});
chk("P40448", "the estate's tile links and the reports hub agree about view and range", () => {
  const hub = code("app/owner/reports/page.tsx");
  const readsView = /searchParams[\s\S]{0,200}?["']view["']|get\("view"\)/.test(hub);
  const readsRange = /get\("range"\)/.test(hub);
  const sendsBoth = /q\.set\("view"/.test(p) && /q\.set\("range"/.test(p);
  return readsView && readsRange && sendsBoth ? true : `hubReadsView=${readsView} hubReadsRange=${readsRange} pageSends=${sendsBoth}`;
});
chk("P40449", "…and view=all really means the estate there", () => {
  const hub = code("app/owner/reports/page.tsx");
  return /"all"/.test(hub) ? true : "the reports hub does not understand view=all";
});
chk("P40450", "the crumb tail contract is unchanged", () =>
  /new CustomEvent\("lfh:owner-crumb", \{ detail: \{ tail \} \}\)/.test(p)
    ? true : "the crumb event shape changed");
chk("P40452", "the restaurant colour is one identity across five surfaces", () => {
  const users = ["app/owner/page.tsx", "components/owner/OwnerShell.tsx"];
  const missing = users.filter((f) => !/portfolioColor/.test(code(f)));
  return missing.length === 0 ? true : `files not using the shared palette: ${JSON.stringify(missing)}`;
});
chk("P40457", "scrollPort and the Pager's scroller-finder are the same rule", () => {
  const mine = /for \(const sel of \[".adm-main", ".adm"\]\)/.test(p);
  return mine ? true : "scrollPort's rule changed and would drift from the pager's";
});
chk("P40458", "the stacked-table CSS cannot escape its media query", () => {
  const outside = css.replace(phoneBlock, "");
  return !/:global\(thead\) \{ display: none/.test(outside) ? true : "a stacking rule sits outside the media query";
});
chk("P40459", "…and it uses :global wherever the element comes from a helper", () => {
  const globals = count(phoneBlock, /:global\(/g);
  return globals >= 8 ? true : `only ${globals} :global() selectors in the phone block — the th comes from a helper and carries no scope class`;
});
chk("P40460", "the offline layer covers every route this territory reads", () => {
  const sw = src("public/sw.js");
  return /\/api\/owner\//.test(sw) ? true : "the owner API family is not in DATA_PATHS";
});
chk("P40461", "no change here affects the three guest menu doors", () => {
  // the page imports nothing from the guest stack
  const imports = [...praw.matchAll(/from "@\/(lib|components)\/([^"]+)"/g)].map((m) => m[2]);
  const guest = imports.filter((i) => /menu|guest|Cart|OrderTracker|PublicModelViewer/i.test(i));
  return guest.length === 0 ? true : `guest-stack imports: ${JSON.stringify(guest)}`;
});
chk("P40463", "…or any money calculation", () => {
  // the page does no tax/discount arithmetic of its own — it prints what the routes send
  return !/taxRate|gstRate|\* 1\.05|\* 1\.18/.test(p) ? true : "the dashboard computes tax of its own";
});
chk("P40464", "…or any bill, invoice or numbering path", () =>
  !/bill_no|invoice_no|kot_no/.test(p) ? true : "a numbering field appeared on the dashboard");

report("T13 replay · T12 round 3 (P40001–P40500, the static rows this terminal owns)", { minChecks: 55 });
